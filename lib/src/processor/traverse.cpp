#include "engine.hh"
#include <algorithm>
#include <cmath>
#include <limits>
#include <utility>

namespace mainz::detail {
static Object checked_resources(Object source, bool editing)
{
    require(source.isDictionary(), "Missing Resources dictionary.");
    auto result = editing ? source.unsafeShallowCopy() : source;
    for (auto key : {"/XObject", "/ExtGState"}) {
        auto child = source.getKey(key);
        if (!child.isNull()) {
            require(child.isDictionary(), "Invalid resource subdictionary.");
            if (editing)
                result.replaceKey(key, child.unsafeShallowCopy());
        }
    }
    return result;
}
static bool group_supported(Object owner)
{
    auto group = owner.getKey("/Group");
    if (group.isNull())
        return true;
    if (!group.isDictionary())
        return false;
    auto isolated = group.getKey("/I"), knockout = group.getKey("/K"), space = group.getKey("/CS");
    return group.getKey("/S").isNameAndEquals("/Transparency") && isolated.isBool() && isolated.getBoolValue()
        && (knockout.isNull() || (knockout.isBool() && !knockout.getBoolValue()))
        && (space.isNameAndEquals("/DeviceGray") || space.isNameAndEquals("/DeviceRGB"));
}
static bool is_alpha_dict(Object alpha)
{
    if (!alpha.isDictionary())
        return false;
    std::size_t keys = 0;
    for (const auto& [key, val] : alpha.ditems()) {
        if (val.isNull())
            continue;
        if (key != "/Type" && key != "/CA" && key != "/ca")
            return false;
        ++keys;
    }
    return keys == 3 && alpha.getKey("/Type").isNameAndEquals("/ExtGState") && alpha.getKey("/CA").isNumber()
        && alpha.getKey("/ca").isNumber();
}
void Engine::verify_marker(Object resources, const std::string& key, bool editing)
{
    auto properties = resources.getKey("/Properties");
    require(properties.isDictionary(), "Missing marker properties.");
    if (!editing && properties.isIndirect()) {
        auto gen = properties.getObjGen();
        auto found = verified_markers.find(gen);
        if (found != verified_markers.end() && found->second.contains(key))
            return;
        auto item = properties.getKey(key);
        require(item.isDictionary() && empty_dictionary(item), "Marker must resolve to an empty dictionary.");
        if (verified_markers.size() < 4096 || found != verified_markers.end()) {
            auto& bucket = verified_markers[gen];
            if (bucket.size() < 256 && key.size() <= 4096)
                bucket.insert(key);
        }
        return;
    }
    auto item = properties.getKey(key);
    require(item.isDictionary() && empty_dictionary(item), "Marker must resolve to an empty dictionary.");
}
static std::uint8_t state_flags(const State& state) noexcept
{
    return static_cast<std::uint8_t>((state.normal ? 1U : 0U) | (state.mask ? 2U : 0U)
        | (state.stroke_overprint ? 4U : 0U) | (state.fill_overprint ? 8U : 0U) | (state.groups ? 16U : 0U)
        | (state.alpha_shape ? 32U : 0U) | (state.optional_content ? 64U : 0U) | (state.colors_supported ? 128U : 0U));
}
static Matrix normalize_matrix(Matrix matrix) noexcept
{
    for (double& value : matrix)
        if (value == 0)
            value = 0;
    return matrix;
}
void Engine::record_path_key(std::string_view path_key, const Matrix& matrix, bool latent)
{
    auto normalized = normalize_matrix(matrix);
    auto& bucket = latent ? latent_paths : fills;
    if (bucket.emplace(PathKey {normalized, path_key}).second) {
        budget.consume(64);
        if (recording_form)
            recording_path_bytes += 64;
    }
    if (recording_form) {
        budget.consume(path_key.size());
        recording_path_bytes += path_key.size();
        auto& recorded = latent ? recording_form->latents : recording_form->fills;
        recorded.push_back({normalized, std::string(path_key)});
    }
}
void Engine::record_path(
    const std::vector<Operation>& ops, std::size_t start, std::size_t end, const Matrix& matrix, bool latent)
{
    auto normalized = normalize_matrix(matrix);
    auto key = path_geometry(ops, start, end);
    auto& bucket = latent ? latent_paths : fills;
    std::string_view stored;
    if (auto found = bucket.find(PathKey {normalized, key}); found != bucket.end())
        stored = found->path;
    else {
        budget.consume(key.size());
        if (recording_form)
            recording_path_bytes += key.size();
        page_path_storage.push_back(std::move(key));
        stored = page_path_storage.back();
    }
    record_path_key(stored, normalized, latent);
}
std::string Engine::inspect(Record& record, const Content& content, std::size_t begin, std::size_t end,
    Object resources, const State& state, std::map<std::string, std::pair<double, double>>& alphas,
    std::map<std::string, std::string>& alpha_keys, std::size_t& next_alpha, std::vector<Replacement>& replacements,
    bool editing)
{
    const auto& ops = content.operations;
    require(state.supported(), "Unsupported editable painting context.", "unsupported-context");
    require(state.colors_supported, "Default color-space replacement is unsupported.", "unsupported-context");
    if (target_width_bound[record.target_idx] && record.strokes)
        record.scale = uniform_scale(state.matrix);
    auto original_paint = text(record.baseline.getDictItem("paint"));
    const auto& expected = paint_style(record, false);
    std::string alpha_name;
    auto scope_it = content.scopes.find(begin);
    if (scope_it != content.scopes.end()) {
        const auto& scope = scope_it->second;
        if (record.fill == FillKind::latent) {
            bool implicit_close = original_paint == "s" || original_paint == "b" || original_paint == "b*";
            require(implicit_close ? scope.closed_implicit : scope.closed_plain, "Open subpath cannot acquire fill.");
        }
        if (!editing && record.fill != FillKind::none && latent_pages.contains(record.page))
            record_path_key(scope.path_key, state.matrix, record.fill == FillKind::latent);
        require(scope.stroke_count == expected.stroke.size(),
            "Invalid operand count for " + std::string(ops[begin + 3].op), "pdf-syntax");
        require(scope.fill_count == expected.fill.size(), "Invalid operand count for " + std::string(ops[begin + 4].op),
            "pdf-syntax");
        require(ops[begin + 3].op == expected.stroke_op && ops[begin + 4].op == expected.fill_op
                && ops[end - 2].op == expected.paint && scope.width == expected.width_num,
            "Current paint disagrees with saved choices.");
        for (std::size_t i = 0; i < expected.stroke.size(); ++i)
            require(scope.stroke[i] == expected.stroke_nums[i], "Current stroke color disagrees with saved choices.");
        for (std::size_t i = 0; i < expected.fill.size(); ++i)
            require(scope.fill[i] == expected.fill_nums[i], "Current fill color disagrees with saved choices.");
        alpha_name = *scope.alpha_name;
    } else {
        require(end >= begin + 9, "Incomplete paint scope.");
        require(ops[begin + 1].op == "q" && ops[begin + 2].op == "w"
                && (ops[begin + 3].op == "G" || ops[begin + 3].op == "RG")
                && (ops[begin + 4].op == "g" || ops[begin + 4].op == "rg") && ops[begin + 5].op == "gs"
                && paint_op(ops[end - 2].op) && ops[end - 1].op == "Q",
            "Invalid paint-scope grammar.");
        count(ops[begin + 1], 0);
        count(ops[begin + 2], 1);
        count(ops[begin + 5], 1);
        count(ops[end - 2], 0);
        count(ops[end - 1], 0);
        count(ops[end], 0);
        std::vector<bool> closed;
        for (std::size_t i = begin + 6; i < end - 2; ++i) {
            const auto& op = ops[i];
            require(path_op(op.op), "Non-path operation inside paint scope.");
            auto n = op.op == "m" || op.op == "l"               ? 2
                : op.op == "c"                                  ? 6
                : op.op == "v" || op.op == "y" || op.op == "re" ? 4
                                                                : 0;
            count(op, n);
            for (int j = 0; j < n; ++j)
                operand(op, j);
            if (empty_move(ops, i, end - 2))
                continue;
            if (op.op == "m" || op.op == "re")
                closed.push_back(op.op == "re");
            else {
                require(!closed.empty(), "Path has no current subpath.");
                closed.back() = op.op == "h";
            }
        }
        require(!closed.empty(), "Empty paint path.");
        if (ops[end - 3].op != "m" && (original_paint == "s" || original_paint == "b" || original_paint == "b*"))
            closed.back() = true;
        if (record.fill == FillKind::latent)
            require(std::all_of(closed.begin(), closed.end(), [](bool v) { return v; }),
                "Open subpath cannot acquire fill.");
        if (!editing && record.fill != FillKind::none && latent_pages.contains(record.page))
            record_path(ops, begin + 6, end - 2, state.matrix, record.fill == FillKind::latent);
        count(ops[begin + 3], expected.stroke.size());
        count(ops[begin + 4], expected.fill.size());
        require(ops[begin + 3].op == expected.stroke_op && ops[begin + 4].op == expected.fill_op
                && ops[end - 2].op == expected.paint && operand(ops[begin + 2], 0) == expected.width_num,
            "Current paint disagrees with saved choices.");
        for (std::size_t i = 0; i < expected.stroke.size(); ++i)
            require(operand(ops[begin + 3], i) == expected.stroke_nums[i],
                "Current stroke color disagrees with saved choices.");
        for (std::size_t i = 0; i < expected.fill.size(); ++i)
            require(operand(ops[begin + 4], i) == expected.fill_nums[i],
                "Current fill color disagrees with saved choices.");
        alpha_name = name(ops[begin + 5], 0);
    }
    auto states = resources.getKey("/ExtGState");
    std::pair<double, double> actual;
    bool hit = false;
    if (!editing) {
        if (auto cached = alphas.find(alpha_name); cached != alphas.end()) {
            actual = cached->second;
            hit = true;
        } else if (states.isIndirect()) {
            if (auto dict_it = resource_alphas.find(states.getObjGen()); dict_it != resource_alphas.end())
                if (auto found = dict_it->second.find(alpha_name); found != dict_it->second.end()) {
                    actual = found->second;
                    hit = true;
                }
        }
    }
    if (!hit) {
        require(states.isDictionary(), "Missing alpha resources.");
        auto alpha = states.getKey(alpha_name);
        require(is_alpha_dict(alpha), "Invalid paint alpha resource.");
        actual = {alpha.getKey("/CA").getNumericValue(), alpha.getKey("/ca").getNumericValue()};
        // Reading keeps this owner's resources immutable; editing must observe every replacement.
        if (!editing && alpha_name.size() <= 4096) {
            if (alphas.size() < 256)
                alphas.emplace(alpha_name, actual);
            if (states.isIndirect()
                && (resource_alphas.size() < 4096 || resource_alphas.contains(states.getObjGen()))) {
                auto& bucket = resource_alphas[states.getObjGen()];
                if (bucket.size() < 256)
                    bucket.emplace(alpha_name, actual);
            }
        }
    }
    require(actual.first == expected.stroke_alpha_num && actual.second == expected.fill_alpha_num,
        "Current alpha disagrees with saved choices.");
    if (!editing)
        return alpha_name;
    const auto& next = paint_style(record, true);
    if (next.width == expected.width && next.stroke == expected.stroke && next.fill == expected.fill
        && next.stroke_op == expected.stroke_op && next.fill_op == expected.fill_op && next.paint == expected.paint
        && next.stroke_alpha == expected.stroke_alpha && next.fill_alpha == expected.fill_alpha)
        return alpha_name;
    std::string key = alpha_name;
    if (next.stroke_alpha != expected.stroke_alpha || next.fill_alpha != expected.fill_alpha) {
        auto replacement_alpha = Object::newDictionary();
        replacement_alpha.replaceKey("/Type", Object::newName("/ExtGState"));
        replacement_alpha.replaceKey("/CA", Object::newReal(next.stroke_alpha));
        replacement_alpha.replaceKey("/ca", Object::newReal(next.fill_alpha));
        auto signature = replacement_alpha.unparseResolved();
        if (alpha_keys.empty() && next_alpha == 0) {
            for (const auto& [existing_key, existing] : states.ditems()) {
                if (!existing_key.starts_with("/MainzAlpha") || !existing.isDictionary())
                    continue;
                alpha_keys.try_emplace(existing.unparseResolved(), existing_key);
            }
        }
        if (auto found = alpha_keys.find(signature); found != alpha_keys.end())
            key = found->second;
        else {
            while (states.hasKey("/MainzAlpha" + std::to_string(next_alpha)))
                ++next_alpha;
            key = "/MainzAlpha" + std::to_string(next_alpha++);
            states.replaceKey(key, replacement_alpha);
            alpha_keys.emplace(std::move(signature), key);
        }
    }
    std::string prefix = next.width + " w ";
    for (const auto& n : next.stroke)
        prefix += n + " ";
    prefix += next.stroke_op + " ";
    for (const auto& n : next.fill)
        prefix += n + " ";
    prefix += next.fill_op + " " + key + " gs";
    replacements.push_back({ops[begin + 2].begin, ops[begin + 5].end, prefix});
    replacements.push_back({ops[end - 2].begin, ops[end - 2].end, next.paint});
    return key;
}
std::size_t content_cache_bytes(const Content& content)
{
    auto size = sizeof(Content) + content.bytes->capacity() + content.operations.capacity() * sizeof(Operation)
        + content.operands.capacity() * sizeof(Operand)
        + content.ends.size() * (sizeof(std::size_t) * 2 + sizeof(void*) * 4) + content.scope_bytes;
    for (const auto& key : content.names)
        size += sizeof(std::string) + key.capacity() + sizeof(void*) * 4;
    return size;
}
std::shared_ptr<const Content> Engine::parsed(const std::string& data)
{
    auto found = index.contents.find(data);
    if (found != index.contents.end())
        return found->second;
    std::shared_ptr<const Content> result;
    if (previous) {
        auto cached = previous->contents.find(data);
        if (cached != previous->contents.end())
            result = cached->second;
    }
    if (!result)
        result = std::make_shared<Content>(tokenize(data));
    const auto size = content_cache_bytes(*result);
    // Retain visited syntax so obsolete input streams cannot crowd out the output.
    constexpr std::size_t cache_limit = std::size_t {32} * 1024 * 1024;
    if (size <= cache_limit - index.bytes) {
        index.contents.emplace(*result->bytes, result);
        index.bytes += size;
    }
    return result;
}
std::shared_ptr<const Content> Engine::stream_content(Object stream)
{
    if (stream.isIndirect()) {
        auto found = decoded_streams.find(stream.getObjGen());
        if (found != decoded_streams.end()) {
            budget.consume(found->second->bytes->size());
            return found->second;
        }
    }
    auto bytes = decode(stream, budget);
    auto content = parsed(bytes);
    if (stream.isIndirect())
        decoded_streams.emplace(stream.getObjGen(), content);
    return content;
}
Object Engine::styled_form(Object original, const std::string& data, Object resources)
{
    auto attributes = original.getDict().unsafeShallowCopy();
    auto signature = resources.unsafeShallowCopy();
    auto states = resources.getKey("/ExtGState");
    if (states.isDictionary()) {
        auto copied = states.unsafeShallowCopy();
        for (const auto& [state_name, alpha] : states.ditems()) {
            if (is_alpha_dict(alpha)) {
                auto resolved = Object::newDictionary();
                for (auto key : {"/Type", "/CA", "/ca"})
                    resolved.replaceKey(key, alpha.getKey(key).shallowCopy());
                copied.replaceKey(state_name, resolved);
            }
        }
        signature.replaceKey("/ExtGState", copied);
    }
    attributes.replaceKey("/Resources", signature);
    for (auto key : {"/Length", "/Filter", "/DecodeParms"})
        attributes.removeKey(key);
    constexpr std::size_t cache_limit = std::size_t {8} * 1024 * 1024;
    std::optional<std::pair<std::string, std::string>> key;
    // Tagged Forms retain their own structure-tree identity.
    if (!attributes.hasKey("/StructParent") && !attributes.hasKey("/StructParents") && data.size() <= cache_limit) {
        try {
            key.emplace(encode(attributes.getJSON(2), cache_limit - data.size()), data);
        } catch (const Error& error) {
            if (error.code() != "limit-exceeded")
                throw;
        }
    }
    if (key) {
        auto found = forms.find(*key);
        if (found != forms.end())
            return found->second;
    }
    auto result = original.copyStream();
    result.getDict().replaceKey("/Resources", resources);
    compress(result, data, budget);
    if (key) {
        auto size = key->first.size() + key->second.size() + sizeof(*key) + sizeof(Object) + sizeof(void*) * 4;
        if (size <= cache_limit - form_bytes) {
            form_bytes += size;
            forms.emplace(std::move(*key), result);
        }
    }
    return result;
}
static Matrix parse_form_matrix(Object dict, const Matrix& parent)
{
    auto matrix = dict.getKey("/Matrix");
    if (matrix.isNull())
        return parent;
    require(matrix.isArray() && matrix.getArrayNItems() == 6, "Invalid Form Matrix.");
    Matrix local {};
    for (int j = 0; j < 6; ++j) {
        auto n = matrix.getArrayItem(j);
        require(n.isNumber(), "Invalid Form Matrix number.");
        local[static_cast<std::size_t>(j)] = n.getNumericValue();
    }
    return multiply(parent, local);
}
static void apply_extgstate(
    const Operation& op, Object resources, State& state, std::set<std::string>& used_states, bool editing)
{
    count(op, 1);
    auto states = resources.getKeyIfDict("/ExtGState");
    auto alpha_key = name(op, 0);
    auto alpha = states.getKeyIfDict(alpha_key);
    if (editing)
        used_states.insert(alpha_key);
    require(alpha.isDictionary(), "Missing graphics-state resource.", "pdf-syntax");
    auto blend = alpha.getKey("/BM"), mask = alpha.getKey("/SMask");
    if (!blend.isNull())
        state.normal = blend.isNameAndEquals("/Normal");
    if (!mask.isNull())
        state.mask = !mask.isNameAndEquals("/None");
    auto stroke = alpha.getKey("/OP"), fill = alpha.getKey("/op");
    if (!stroke.isNull()) {
        require(stroke.isBool(), "Invalid stroke overprint.");
        state.stroke_overprint = state.fill_overprint = stroke.getBoolValue();
    }
    if (!fill.isNull()) {
        require(fill.isBool(), "Invalid fill overprint.");
        state.fill_overprint = fill.getBoolValue();
    }
    auto shape = alpha.getKey("/AIS");
    if (!shape.isNull()) {
        require(shape.isBool(), "Invalid alpha-is-shape setting.");
        state.alpha_shape = shape.getBoolValue();
    }
}
static std::string apply_stream_replacements(
    std::string_view data, std::vector<Replacement>& replacements, Budget& budget)
{
    std::sort(replacements.begin(), replacements.end(), [](const auto& a, const auto& b) { return a.begin < b.begin; });
    std::string result;
    result.reserve(data.size());
    std::size_t position = 0;
    for (const auto& edit : replacements) {
        require(position <= edit.begin && edit.begin <= edit.end && edit.end <= data.size(),
            "Overlapping style replacements.");
        require(
            edit.begin - position <= stream_limit - result.size(), "Edited stream exceeds 32 MiB.", "limit-exceeded");
        result.append(data, position, edit.begin - position);
        require(edit.bytes.size() <= stream_limit - result.size(), "Edited stream exceeds 32 MiB.", "limit-exceeded");
        result += edit.bytes;
        position = edit.end;
    }
    require(data.size() - position <= stream_limit - result.size(), "Edited stream exceeds 32 MiB.", "limit-exceeded");
    result.append(data, position, data.size() - position);
    budget.consume(result.size());
    return result;
}
struct Engine::FormTraversal {
    FormTraversal(Engine& engine, const std::shared_ptr<const Content>& content, Object resources,
        std::optional<std::size_t> region, const std::vector<Step>& path, std::size_t page, double unit, bool editing,
        std::size_t depth, bool* locator_changed)
        : engine(engine)
        , content(content)
        , resources(resources)
        , region(region)
        , path(path)
        , page(page)
        , unit(unit)
        , editing(editing)
        , depth(depth)
        , locator_changed(locator_changed)
    {
    }
    Engine& engine;
    const std::shared_ptr<const Content>& content;
    Object resources;
    std::optional<std::size_t> region;
    const std::vector<Step>& path;
    std::size_t page {0};
    double unit {1};
    bool editing {false};
    std::size_t depth {0};
    bool* locator_changed {nullptr};
    const std::unordered_map<std::string_view, std::size_t>* active_markers {nullptr};
    std::map<std::string, std::pair<double, double>> alphas;
    std::map<std::string, std::string> alpha_keys;
    std::size_t next_alpha {0}, next_form {0};
    std::vector<State> stack;
    std::map<std::string, std::size_t> invocations, rewritten_invocations;
    std::vector<Replacement> replacements;
    std::map<Step, std::pair<std::string, std::size_t>> step_rewrites;
    std::set<std::string> replaced_states, replaced_forms, used_states, used_forms;
    std::vector<std::size_t> oc_ends;
    bool inherited_unvisited_form {false};
    std::size_t region_end {std::numeric_limits<std::size_t>::max()}, region_depth {0};
    bool pending_clip {false}, pending_path {false}, text_object {false};
    std::size_t path_start {0};

    void bind_markers()
    {
        active_markers = nullptr;
        if (!region)
            return;
        const auto& locators = engine.shape_locators[engine.region_shape[*region]];
        auto found = locators.find(path);
        if (found != locators.end())
            active_markers = &found->second;
    }

    void flush_rewrites()
    {
        if (step_rewrites.empty() || !region)
            return;
        const std::size_t step_depth = path.size();
        for (auto rec_idx : engine.region_records[*region]) {
            auto& record = engine.records.at(rec_idx);
            if (record.path.size() <= step_depth || !std::equal(path.begin(), path.end(), record.path.begin()))
                continue;
            auto rewrite = step_rewrites.find(record.path[step_depth]);
            if (rewrite == step_rewrites.end())
                continue;
            auto steps = array(record.locator.getDictItem("path"));
            steps[step_depth] = dictionary({{"resource", JSON::makeString(rewrite->second.first)},
                {"occurrence", JSON::makeInt(static_cast<long long>(rewrite->second.second))}});
            auto next_path = JSON::makeArray();
            for (const auto& step : steps)
                next_path.addArrayElement(step);
            record.locator = copy_object(record.locator);
            record.locator.addDictionaryMember("path", next_path);
        }
        step_rewrites.clear();
    }

    bool handle_figure_bdc(std::size_t& i, const State& state)
    {
        const auto& ops = content->operations;
        const auto& ends = content->ends;
        const auto& op = ops[i];
        if (op.op != "BDC" || *op.operands[0].name != "/Figure" || op.operands[1].type != QPDFTokenizer::tt_name)
            return false;
        const auto& key = *op.operands[1].name;
        auto marker_sv = std::string_view(key).substr(1);
        if (depth == 0) {
            auto found = engine.page_markers.find(std::make_pair(page, std::string(marker_sv)));
            if (found != engine.page_markers.end()) {
                require(!region && !pending_path && !text_object, "Nested or interrupted page region.");
                region = found->second;
                require(++engine.regions_found[*region] == 1, "Ambiguous page region.");
                engine.verify_marker(resources, key, editing);
                region_end = ends.at(i);
                region_depth = stack.size();
                invocations.clear();
                rewritten_invocations.clear();
                bind_markers();
                return true;
            }
        }
        if (!active_markers || !region)
            return false;
        auto match = active_markers->find(marker_sv);
        if (match == active_markers->end())
            return false;
        require(!pending_clip && !pending_path && !text_object, "Ambiguous or interrupted paint scope.");
        const auto rid = *region;
        auto r = engine.region_records[rid][match->second];
        require(++engine.records[r].found == 1, "Ambiguous paint marker.");
        engine.verify_marker(resources, key, editing);
        engine.records[r].unit = unit;
        engine.record_order[rid].push_back(r);
        auto effective = state;
        effective.optional_content = effective.optional_content || !oc_ends.empty();
        auto end = ends.at(i);
        if (editing) {
            used_states.insert(!engine.changed_targets.contains(engine.records[r].target_idx)
                    ? name(ops[i + 5], 0)
                    : engine.inspect(engine.records[r], *content, i, end, resources, effective, alphas, alpha_keys,
                          next_alpha, replacements, true));
            replaced_states.insert(name(ops[i + 5], 0));
        } else {
            static_cast<void>(engine.inspect(engine.records[r], *content, i, end, resources, effective, alphas,
                alpha_keys, next_alpha, replacements, false));
        }
        i = end;
        return true;
    }

    void replay_form(std::size_t rid, const ValidatedForm& cached, bool track_latent)
    {
        engine.budget.consume(cached.consumed_bytes);
        require(cached.visits <= 65536 - engine.budget.visits, "Form traversal exceeds limit.", "limit-exceeded");
        engine.budget.visits += cached.visits;
        const auto& reg_recs = engine.region_records[rid];
        for (const auto& [local_idx, scale] : cached.matched) {
            auto r = reg_recs[local_idx];
            require(++engine.records[r].found == 1, "Ambiguous paint marker.");
            engine.records[r].scale = scale;
            engine.records[r].unit = unit;
            engine.record_order[rid].push_back(r);
        }
        if (track_latent) {
            for (const auto& pk : cached.fills)
                engine.record_path_key(pk.path, pk.matrix, false);
            for (const auto& pk : cached.latents)
                engine.record_path_key(pk.path, pk.matrix, true);
        }
    }

    void visit_form(const Operation& op, const State& state)
    {
        count(op, 1);
        auto key = name(op, 0);
        auto next_key = key;
        auto occurrence = invocations[key]++;
        auto xobjects = resources.getKeyIfDict("/XObject");
        auto form = xobjects.getKeyIfDict(key);
        require(form.isStream(), "Missing XObject resource.", "pdf-syntax");
        if (!form.getDict().getKey("/Subtype").isNameAndEquals("/Form")) {
            ++rewritten_invocations[key];
            if (editing)
                used_forms.insert(next_key);
            return;
        }
        require(!pending_path && !text_object, "Form interrupts a graphics object.", "pdf-syntax");
        auto child_path = path;
        if (region)
            child_path.push_back({key.substr(1), occurrence});
        if (!editing || (region && engine.changed_paths[*region].contains(child_path))) {
            struct AncestorGuard {
                std::set<QPDFObjGen>& set;
                QPDFObjGen gen;
                ~AncestorGuard() { set.erase(gen); }
            };
            require(engine.ancestors.insert(form.getObjGen()).second, "Cyclic Form invocation.");
            AncestorGuard ancestor_guard {engine.ancestors, form.getObjGen()};
            auto dict = form.getDict();
            auto child_resources = dict.getKey("/Resources");
            if (region)
                require(child_resources.isDictionary(), "Located Form must have explicit Resources.");
            if (child_resources.isNull())
                child_resources = resources;
            child_resources = checked_resources(child_resources, editing);
            auto child_state = state;
            child_state.groups = state.groups && group_supported(dict);
            child_state.optional_content = state.optional_content || !oc_ends.empty() || dict.hasKey("/OC");
            auto defaults = resources.getKey("/ColorSpace");
            if (!defaults.isNull() && defaults.isDictionary()
                && (defaults.hasKey("/DefaultGray") || defaults.hasKey("/DefaultRGB")))
                child_state.groups = false;
            child_state.matrix = parse_form_matrix(dict, state.matrix);
            const bool can_cache_read = !editing && depth == 0 && region.has_value() && form.isIndirect();
            const bool can_cache_edit = editing && depth == 0 && region.has_value() && form.isIndirect()
                && !dict.hasKey("/StructParent") && !dict.hasKey("/StructParents");
            const bool track_latent = !editing && engine.latent_pages.contains(page);
            auto install_form_replacement = [&](const Object& form_copy) {
                while (xobjects.hasKey("/MainzForm" + std::to_string(next_form)))
                    ++next_form;
                next_key = "/MainzForm" + std::to_string(next_form++);
                xobjects.replaceKey(next_key, form_copy);
                replacements.push_back({op.begin, op.end, next_key + " Do"});
                replaced_forms.insert(key);
            };
            if (can_cache_read || can_cache_edit) {
                auto og = form.getObjGen();
                FormVisitKey visit_key {og.getObj(), og.getGen(), normalize_matrix(child_state.matrix), unit,
                    engine.region_shape[*region], child_path, state_flags(child_state), track_latent};
                auto& cache = editing ? engine.edited_forms : engine.validated_forms;
                if (auto found = cache.find(visit_key); found != cache.end()) {
                    replay_form(*region, found->second, track_latent);
                    if (editing && found->second.copy)
                        install_form_replacement(*found->second.copy);
                } else {
                    auto rem_before = engine.budget.remaining;
                    auto visits_before = engine.budget.visits;
                    auto order_before = engine.record_order[*region].size();
                    bool child_locator_changed = false;
                    ValidatedForm entry;
                    struct RecordGuard {
                        ValidatedForm*& slot;
                        std::size_t& bytes;
                        ~RecordGuard()
                        {
                            slot = nullptr;
                            bytes = 0;
                        }
                    } guard {engine.recording_form, engine.recording_path_bytes};
                    if (track_latent) {
                        engine.recording_form = &entry;
                        engine.recording_path_bytes = 0;
                    }
                    auto child_content = engine.stream_content(form);
                    auto rewritten = engine.owner(child_content, child_resources, child_state, page, region, child_path,
                        unit, editing, depth + 1, &child_locator_changed);
                    auto path_bytes = engine.recording_path_bytes;
                    auto owner_bytes = (rem_before - engine.budget.remaining) - path_bytes;
                    engine.recording_form = nullptr;
                    engine.recording_path_bytes = 0;
                    if (child_locator_changed && locator_changed)
                        *locator_changed = true;
                    std::optional<Object> copy;
                    if (editing && rewritten) {
                        copy = engine.styled_form(form, *rewritten, child_resources);
                        install_form_replacement(*copy);
                    }
                    if ((!editing || !child_locator_changed) && cache.size() < 4096) {
                        entry.consumed_bytes = owner_bytes;
                        entry.visits = engine.budget.visits - visits_before;
                        const auto base
                            = engine.region_records[*region].empty() ? 0 : engine.region_records[*region].front();
                        const auto& order = engine.record_order[*region];
                        entry.matched.reserve(order.size() - order_before);
                        for (std::size_t k = order_before; k < order.size(); ++k)
                            entry.matched.emplace_back(order[k] - base, engine.records[order[k]].scale);
                        entry.copy = std::move(copy);
                        cache.emplace(std::move(visit_key), std::move(entry));
                    }
                }
            } else {
                auto child_content = engine.stream_content(form);
                auto rewritten = engine.owner(child_content, child_resources, child_state, page, region, child_path,
                    unit, editing, depth + 1, locator_changed);
                if (editing && rewritten)
                    install_form_replacement(engine.styled_form(form, *rewritten, child_resources));
            }
        } else if (editing && form.getDict().getKey("/Resources").isNull()) {
            inherited_unvisited_form = true;
        }
        auto next_occurrence = rewritten_invocations[next_key]++;
        if (editing && region && (next_key != key || next_occurrence != occurrence)) {
            step_rewrites.emplace(
                Step {key.substr(1), occurrence}, std::make_pair(next_key.substr(1), next_occurrence));
            engine.region_locator_changed[*region] = 1;
            if (locator_changed)
                *locator_changed = true;
        }
        if (editing)
            used_forms.insert(next_key);
    }

    std::optional<std::string> run(State state)
    {
        bind_markers();
        auto colors = resources.getKey("/ColorSpace");
        state.colors_supported = colors.isNull()
            || (colors.isDictionary() && !colors.hasKey("/DefaultGray") && !colors.hasKey("/DefaultRGB"));
        const auto& ops = content->operations;
        const auto& ends = content->ends;
        for (std::size_t i = 0; i < ops.size(); ++i) {
            const auto& op = ops[i];
            if ((op.op == "BMC" || op.op == "BDC") && *op.operands[0].name == "/OC")
                oc_ends.push_back(ends.at(i));
            if (handle_figure_bdc(i, state))
                continue;
            while (!oc_ends.empty() && i == oc_ends.back())
                oc_ends.pop_back();
            if (i == region_end) {
                require(stack.size() == region_depth && !pending_path && !text_object,
                    "Region does not contain complete graphics objects.");
                flush_rewrites();
                region.reset();
                active_markers = nullptr;
                invocations.clear();
                rewritten_invocations.clear();
                region_end = std::numeric_limits<std::size_t>::max();
            }
            if (op.op == "q") {
                count(op, 0);
                require(stack.size() < 64, "Graphics state exceeds depth 64.", "limit-exceeded");
                stack.push_back(state);
            } else if (op.op == "Q") {
                count(op, 0);
                require(!stack.empty(), "Graphics-state underflow.", "pdf-syntax");
                state = stack.back();
                stack.pop_back();
            } else if (op.op == "cm") {
                count(op, 6);
                Matrix local {};
                for (std::size_t j = 0; j < 6; ++j)
                    local[j] = operand(op, j);
                state.matrix = multiply(state.matrix, local);
            } else if (op.op == "gs") {
                apply_extgstate(op, resources, state, used_states, editing);
            } else if (op.op == "Do") {
                visit_form(op, state);
            } else if (op.op == "BT") {
                count(op, 0);
                require(!text_object && !pending_path, "Invalid text object.", "pdf-syntax");
                text_object = true;
            } else if (op.op == "ET") {
                count(op, 0);
                require(text_object, "Text-object underflow.", "pdf-syntax");
                text_object = false;
            }
            if (path_op(op.op)) {
                if (!pending_path)
                    path_start = i;
                pending_path = true;
            }
            if (op.op == "W" || op.op == "W*")
                pending_clip = true;
            if (paint_op(op.op) || op.op == "n") {
                if (!editing && pending_path && op.op != "n" && op.op != "S" && op.op != "s"
                    && engine.latent_pages.contains(page))
                    engine.record_path(ops, path_start, i, state.matrix, false);
                pending_path = pending_clip = false;
            }
        }
        require(stack.empty() && !pending_path && !text_object, "Unbalanced content graphics objects.", "pdf-syntax");
        flush_rewrites();
        if (!editing || replacements.empty())
            return std::nullopt;
        auto result = apply_stream_replacements(*content->bytes, replacements, engine.budget);
        if (!inherited_unvisited_form) {
            for (const auto& key : replaced_states)
                if (key.starts_with("/MainzAlpha") && !used_states.contains(key))
                    resources.getKey("/ExtGState").removeKey(key);
            for (const auto& key : replaced_forms)
                if (key.starts_with("/MainzForm") && !used_forms.contains(key))
                    resources.getKey("/XObject").removeKey(key);
        }
        return result;
    }
};
std::optional<std::string> Engine::owner(const std::shared_ptr<const Content>& content, Object resources, State state,
    std::size_t page, std::optional<std::size_t> region, const std::vector<Step>& path, double unit, bool editing,
    std::size_t depth, bool* locator_changed)
{
    require(depth <= 16 && ++budget.visits <= 65536, "Form traversal exceeds limit.", "limit-exceeded");
    if (!editing && latent_pages.contains(page))
        page_contents.push_back(content);
    FormTraversal traversal {*this, content, resources, region, path, page, unit, editing, depth, locator_changed};
    return traversal.run(state);
}
void Engine::traverse(bool editing, const std::set<std::size_t>* active_pages)
{
    styles.clear();
    validated_forms.clear();
    edited_forms.clear();
    regions_found.assign(region_names.size(), 0);
    for (auto& order : record_order)
        order.clear();
    fills.clear();
    latent_paths.clear();
    page_contents.clear();
    page_path_storage.clear();
    for (auto& record : records)
        record.found = 0;
    for (std::size_t p = 0; p < pages.size(); ++p) {
        if (editing && !changed_pages.contains(p))
            continue;
        fills.clear();
        latent_paths.clear();
        page_contents.clear();
        page_path_storage.clear();
        auto page = pages[p];
        auto owner_object = page.getObjectHandle();
        auto unit_object = owner_object.getKey("/UserUnit");
        double unit = 1;
        if (!unit_object.isNull()) {
            require(unit_object.isNumber(), "Invalid page UserUnit.");
            unit = unit_object.getNumericValue();
        }
        require(std::isfinite(unit) && unit > 0 && unit <= 75000, "Invalid page UserUnit.");
        auto streams = page.getPageContents();
        std::shared_ptr<const Content> page_content;
        if (streams.size() == 1)
            page_content = stream_content(streams.front());
        else {
            std::string data;
            for (const auto& stream : streams) {
                auto bytes = decode(stream, budget);
                require(bytes.size() < stream_limit - data.size(), "Page content exceeds 32 MiB.", "limit-exceeded");
                data += bytes;
                data += '\n';
            }
            page_content = parsed(data);
        }
        auto resources = checked_resources(page.getAttribute("/Resources", false), editing);
        State state;
        state.groups = group_supported(owner_object);
        auto rewritten = owner(page_content, resources, state, p, std::nullopt, {}, unit, editing, 0);
        for (const auto& digest : latent_paths)
            require(!fills.contains(digest), "Latent stroke duplicates a separate fill.");
        if (editing && rewritten) {
            owner_object.replaceKey("/Resources", resources);
            auto stream = document.newStream();
            compress(stream, *rewritten, budget);
            owner_object.replaceKey("/Contents", stream);
        }
    }
    for (std::size_t rid = 0; rid < region_names.size(); ++rid) {
        if (editing
            && (!changed_targets.contains(region_target[rid])
                || (active_pages && !active_pages->contains(region_page[rid]))))
            continue;
        require(regions_found[rid] == 1, "Missing page region: " + region_names[rid]);
        require(record_order[rid] == region_records[rid], "Paint locators are missing or out of execution order.");
    }
    for (const auto& record : records)
        if (!editing
            || (changed_targets.contains(record.target_idx) && (!active_pages || active_pages->contains(record.page))))
            require(record.found == 1, "Unresolved paint locator.");
}
}
