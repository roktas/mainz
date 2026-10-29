#include "engine.hh"
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <limits>
#include <sstream>
#include <unordered_set>
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
static std::vector<std::string> components(JSON color)
{
    std::vector<std::string> result;
    for (const auto& item : array(color.getDictItem("operands")))
        result.push_back(text(item));
    return result;
}
static std::vector<std::string> rgb(JSON value)
{
    auto hex = text(value);
    std::vector<std::string> result;
    for (int i = 1; i < 7; i += 2)
        result.push_back(decimal(std::stoi(hex.substr(i, 2), nullptr, 16) / 255.0));
    return result;
}
static Style style(const Record& record, const std::map<std::string, JSON>& selected)
{
    auto b = record.baseline;
    Style result {text(b.getDictItem("width")), text(b.getDictItem("stroke").getDictItem("operator")),
        text(b.getDictItem("fill").getDictItem("operator")), text(b.getDictItem("paint")),
        text(b.getDictItem("strokeOpacity")), text(b.getDictItem("fillOpacity")), components(b.getDictItem("stroke")),
        components(b.getDictItem("fill"))};
    for (const auto& [property, choice] : selected) {
        if (property == "stroke-width") {
            auto physical = number(choice);
            auto local = physical * (72.0 / 25.4) / record.unit / record.scale;
            require(std::isfinite(local) && local > 0, "Unrepresentable physical width.", "unsupported-context");
            result.width = decimal(local);
            require(pdf_number(result.width) > 0
                    && std::abs(pdf_number(result.width) * record.scale * record.unit * (25.4 / 72.0) - physical)
                        <= 1e-8,
                "Physical width cannot be serialized accurately.", "unsupported-context");
        } else if (property == "stroke-color") {
            result.stroke_op = "RG";
            result.stroke = rgb(choice);
        } else if (property == "fill-color") {
            result.fill_op = "rg";
            result.fill = rgb(choice);
        } else if (property == "stroke-opacity")
            result.stroke_alpha = decimal(number(choice));
        else if (property == "fill-opacity")
            result.fill_alpha = decimal(number(choice));
    }
    if (record.fill == "latent" && pdf_number(result.fill_alpha) > 0) {
        result.paint = result.paint == "s" ? "b" : "B";
        if (text(b.getDictItem("fillRule")) == "evenodd")
            result.paint += '*';
    }
    auto display = selected.contains("display") ? text(selected.at("display")) : text(b.getDictItem("display"));
    if (display == "none")
        result.stroke_alpha = result.fill_alpha = "0";
    return result;
}
static void marker(Object resources, const std::string& key)
{
    auto properties = resources.getKey("/Properties");
    require(properties.isDictionary(), "Missing marker properties.");
    auto item = properties.getKey(key);
    require(item.isDictionary() && item.getKeys().empty(), "Marker must resolve to an empty dictionary.");
}

const Style& Engine::paint_style(const Record& record, bool editing)
{
    auto key = std::make_tuple(record.target, record.baseline_key, record.fill, record.scale, record.unit, editing);
    auto found = styles.find(key);
    if (found != styles.end())
        return found->second;
    auto selected = editing ? choices[record.target] : original_choices[record.target];
    auto paint = text(record.baseline.getDictItem("paint"));
    if (paint == "f" || paint == "f*")
        for (auto property : {"stroke-width", "stroke-color", "stroke-opacity"})
            selected.erase(property);
    if (record.fill == "none")
        for (auto property : {"fill-color", "fill-opacity"})
            selected.erase(property);
    return styles.emplace(std::move(key), style(record, selected)).first->second;
}
std::string Engine::inspect(Record& record, const std::vector<Operation>& ops, std::size_t begin, std::size_t end,
    Object resources, const State& state, std::map<std::string, std::pair<double, double>>& alphas,
    std::vector<Replacement>& replacements, bool editing)
{
    require(state.supported(), "Unsupported editable painting context.", "unsupported-context");
    require(state.colors_supported, "Default color-space replacement is unsupported.", "unsupported-context");
    bool width_bound = bindings.at(record.target).contains("stroke-width");
    auto original_paint = text(record.baseline.getDictItem("paint"));
    if (width_bound && original_paint != "f" && original_paint != "f*")
        record.scale = uniform_scale(state.matrix);
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
    if (record.fill == "latent")
        require(
            std::all_of(closed.begin(), closed.end(), [](bool v) { return v; }), "Open subpath cannot acquire fill.");
    if (!editing && record.fill != "none" && latent_pages.contains(record.page))
        paths.emplace_back(geometry(ops, begin + 6, end - 2, state.matrix), record.fill == "latent");
    const auto& expected = paint_style(record, false);
    count(ops[begin + 3], expected.stroke.size());
    count(ops[begin + 4], expected.fill.size());
    require(ops[begin + 3].op == expected.stroke_op && ops[begin + 4].op == expected.fill_op
            && ops[end - 2].op == expected.paint && operand(ops[begin + 2], 0) == pdf_number(expected.width),
        "Current paint disagrees with saved choices.");
    for (std::size_t i = 0; i < expected.stroke.size(); ++i)
        require(operand(ops[begin + 3], i) == pdf_number(expected.stroke[i]),
            "Current stroke color disagrees with saved choices.");
    for (std::size_t i = 0; i < expected.fill.size(); ++i)
        require(operand(ops[begin + 4], i) == pdf_number(expected.fill[i]),
            "Current fill color disagrees with saved choices.");
    auto alpha_name = name(ops[begin + 5], 0);
    auto states = resources.getKey("/ExtGState");
    std::pair<double, double> actual;
    auto cached = alphas.find(alpha_name);
    if (!editing && cached != alphas.end())
        actual = cached->second;
    else {
        require(states.isDictionary(), "Missing alpha resources.");
        auto alpha = states.getKey(alpha_name);
        static const std::set<std::string> alpha_keys {"/Type", "/CA", "/ca"};
        require(alpha.isDictionary() && alpha.getKeys() == alpha_keys
                && alpha.getKey("/Type").isNameAndEquals("/ExtGState") && alpha.getKey("/CA").isNumber()
                && alpha.getKey("/ca").isNumber(),
            "Invalid paint alpha resource.");
        actual = {alpha.getKey("/CA").getNumericValue(), alpha.getKey("/ca").getNumericValue()};
        // Reading keeps this owner's resources immutable; editing must observe every replacement.
        if (!editing && alphas.size() < 256 && alpha_name.size() <= 4096)
            alphas.emplace(alpha_name, actual);
    }
    require(actual.first == pdf_number(expected.stroke_alpha) && actual.second == pdf_number(expected.fill_alpha),
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
        for (std::size_t i = 0;; ++i) {
            key = "/MainzAlpha" + std::to_string(i);
            if (!states.hasKey(key)) {
                states.replaceKey(key, replacement_alpha);
                break;
            }
            auto existing = states.getKey(key);
            if (existing.isDictionary() && existing.unparseResolved() == replacement_alpha.unparseResolved())
                break;
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
    auto size = sizeof(Content) + result->bytes->capacity() + result->operations.capacity() * sizeof(Operation)
        + result->operands.capacity() * sizeof(Operand)
        + result->ends.size() * (sizeof(std::size_t) * 2 + sizeof(void*) * 4);
    for (const auto& key : result->names)
        size += sizeof(std::string) + key.capacity() + sizeof(void*) * 4;
    // Retain visited syntax so obsolete input streams cannot crowd out the output.
    constexpr std::size_t cache_limit = std::size_t {32} * 1024 * 1024;
    if (size <= cache_limit - index.bytes) {
        index.contents.emplace(*result->bytes, result);
        index.bytes += size;
    }
    return result;
}
Object Engine::styled_form(Object original, const std::string& data, Object resources)
{
    auto attributes = original.getDict().unsafeShallowCopy();
    auto signature = resources.unsafeShallowCopy();
    auto states = resources.getKey("/ExtGState");
    if (states.isDictionary()) {
        auto copied = states.unsafeShallowCopy();
        for (const auto& name : states.getKeys()) {
            auto alpha = states.getKey(name);
            if (alpha.isDictionary() && alpha.getKeys() == std::set<std::string> {"/Type", "/CA", "/ca"}
                && alpha.getKey("/Type").isNameAndEquals("/ExtGState") && alpha.getKey("/CA").isNumber()
                && alpha.getKey("/ca").isNumber()) {
                auto resolved = Object::newDictionary();
                for (auto key : {"/Type", "/CA", "/ca"})
                    resolved.replaceKey(key, alpha.getKey(key).shallowCopy());
                copied.replaceKey(name, resolved);
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
std::string Engine::owner(const std::string& data, Object resources, State state, const std::string& page,
    std::string region, const std::vector<Step>& path, double unit, bool editing, std::size_t depth)
{
    require(depth <= 16 && ++budget.visits <= 65536, "Form traversal exceeds limit.", "limit-exceeded");
    auto content = parsed(data);
    const auto& ops = content->operations;
    const auto& ends = content->ends;
    auto colors = resources.getKey("/ColorSpace");
    state.colors_supported
        = colors.isNull() || (colors.isDictionary() && !colors.hasKey("/DefaultGray") && !colors.hasKey("/DefaultRGB"));
    std::map<std::string, std::pair<double, double>> alphas;
    std::vector<State> stack;
    std::map<std::string, std::size_t> invocations, rewritten_invocations;
    std::vector<Replacement> replacements;
    std::set<std::string> replaced_states, replaced_forms;
    std::set<std::string> used_states, used_forms;
    std::size_t region_end = std::numeric_limits<std::size_t>::max(), region_depth = 0;
    bool pending_clip = false, pending_path = false, text_object = false;
    std::size_t path_start = 0;
    for (std::size_t i = 0; i < ops.size(); ++i) {
        const auto& op = ops[i];
        if (op.op == "BDC" && name(op, 0) == "/Figure" && op.operands[1].type == QPDFTokenizer::tt_name) {
            auto key = name(op, 1);
            auto region_key = std::make_pair(page, key.substr(1));
            if (depth == 0 && page_markers.contains(region_key)) {
                require(region.empty() && !pending_path && !text_object, "Nested or interrupted page region.");
                region = page_markers.at(region_key);
                require(++regions_found[region] == 1, "Ambiguous page region.");
                marker(resources, key);
                region_end = ends.at(i);
                region_depth = stack.size();
                invocations.clear();
                rewritten_invocations.clear();
            } else if (!region.empty()) {
                auto match = record_index.find(std::make_tuple(region, path, key.substr(1)));
                if (match != record_index.end()) {
                    require(!pending_clip && !pending_path && !text_object, "Ambiguous or interrupted paint scope.");
                    auto r = match->second;
                    require(++records[r].found == 1, "Ambiguous paint marker.");
                    marker(resources, key);
                    records[r].unit = unit;
                    record_order[region].push_back(r);
                    used_states.insert(editing && !changed_targets.contains(records[r].target)
                            ? name(ops[i + 5], 0)
                            : inspect(records[r], ops, i, ends.at(i), resources, state, alphas, replacements, editing));
                    replaced_states.insert(name(ops[i + 5], 0));
                    i = ends.at(i);
                    continue;
                }
            }
        }
        if (i == region_end) {
            require(stack.size() == region_depth && !pending_path && !text_object,
                "Region does not contain complete graphics objects.");
            region.clear();
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
            Matrix local;
            for (std::size_t j = 0; j < 6; ++j)
                local[j] = operand(op, j);
            state.matrix = multiply(state.matrix, local);
        } else if (op.op == "gs") {
            count(op, 1);
            auto states = resources.getKeyIfDict("/ExtGState");
            auto alpha = states.getKeyIfDict(name(op, 0));
            used_states.insert(name(op, 0));
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
        } else if (op.op == "Do") {
            count(op, 1);
            auto key = name(op, 0);
            auto next_key = key;
            auto occurrence = invocations[key]++;
            auto xobjects = resources.getKeyIfDict("/XObject");
            auto form = xobjects.getKeyIfDict(key);
            require(form.isStream(), "Missing XObject resource.", "pdf-syntax");
            if (form.getDict().getKey("/Subtype").isNameAndEquals("/Form")) {
                require(!pending_path && !text_object, "Form interrupts a graphics object.", "pdf-syntax");
                auto child_path = path;
                if (!region.empty())
                    child_path.push_back({key.substr(1), occurrence});
                if (!editing || (!region.empty() && changed_paths.at(region).contains(child_path))) {
                    require(ancestors.insert(form.getObjGen()).second, "Cyclic Form invocation.");
                    auto dict = form.getDict();
                    auto child_resources = dict.getKey("/Resources");
                    if (!region.empty())
                        require(child_resources.isDictionary(), "Located Form must have explicit Resources.");
                    if (child_resources.isNull())
                        child_resources = resources;
                    child_resources = checked_resources(child_resources, editing);
                    auto child_state = state;
                    child_state.groups = state.groups && group_supported(dict);
                    auto defaults = resources.getKey("/ColorSpace");
                    if (!defaults.isNull() && defaults.isDictionary()
                        && (defaults.hasKey("/DefaultGray") || defaults.hasKey("/DefaultRGB")))
                        child_state.groups = false;
                    auto matrix = dict.getKey("/Matrix");
                    if (!matrix.isNull()) {
                        require(matrix.isArray() && matrix.getArrayNItems() == 6, "Invalid Form Matrix.");
                        Matrix local;
                        for (int j = 0; j < 6; ++j) {
                            auto n = matrix.getArrayItem(j);
                            require(n.isNumber(), "Invalid Form Matrix number.");
                            local[j] = n.getNumericValue();
                        }
                        child_state.matrix = multiply(state.matrix, local);
                    }
                    auto decoded = decode(form, budget);
                    auto rewritten = owner(
                        decoded, child_resources, child_state, page, region, child_path, unit, editing, depth + 1);
                    ancestors.erase(form.getObjGen());
                    if (editing && rewritten != decoded) {
                        auto copy = styled_form(form, rewritten, child_resources);
                        for (std::size_t j = 0;; ++j) {
                            next_key = "/MainzForm" + std::to_string(j);
                            if (!xobjects.hasKey(next_key))
                                break;
                        }
                        xobjects.replaceKey(next_key, copy);
                        replacements.push_back({op.begin, op.end, next_key + " Do"});
                        replaced_forms.insert(key);
                    }
                }
                auto next_occurrence = rewritten_invocations[next_key]++;
                if (editing && !region.empty() && (next_key != key || next_occurrence != occurrence))
                    for (auto it = record_index.lower_bound({region, child_path, ""}); it != record_index.end(); ++it) {
                        auto& record = records.at(it->second);
                        if (record.region != region || record.path.size() < child_path.size()
                            || !std::equal(child_path.begin(), child_path.end(), record.path.begin()))
                            break;
                        auto steps = array(record.locator.getDictItem("path"));
                        steps[path.size()] = dictionary({{"resource", JSON::makeString(next_key.substr(1))},
                            {"occurrence", JSON::makeInt(static_cast<long long>(next_occurrence))}});
                        auto next_path = JSON::makeArray();
                        for (const auto& step : steps)
                            next_path.addArrayElement(step);
                        record.locator = copy_object(record.locator);
                        record.locator.addDictionaryMember("path", next_path);
                    }
            } else
                ++rewritten_invocations[key];
            used_forms.insert(next_key);
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
            if (!editing && pending_path && op.op != "n" && op.op != "S" && op.op != "s" && latent_pages.contains(page))
                paths.emplace_back(geometry(ops, path_start, i, state.matrix), false);
            pending_path = pending_clip = false;
        }
    }
    require(stack.empty() && !pending_path && !text_object, "Unbalanced content graphics objects.", "pdf-syntax");
    if (!editing || replacements.empty())
        return data;
    std::sort(replacements.begin(), replacements.end(), [](const auto& a, const auto& b) { return a.begin < b.begin; });
    std::string result;
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
    for (const auto& key : replaced_states)
        if (key.starts_with("/MainzAlpha") && !used_states.contains(key))
            resources.getKey("/ExtGState").removeKey(key);
    for (const auto& key : replaced_forms)
        if (key.starts_with("/MainzForm") && !used_forms.contains(key))
            resources.getKey("/XObject").removeKey(key);
    return result;
}
void Engine::traverse(bool editing)
{
    styles.clear();
    regions_found.clear();
    record_order.clear();
    paths.clear();
    for (auto& record : records)
        record.found = 0;
    auto page_ids = object(manifest.getDictItem("pages"));
    std::map<std::size_t, std::string> ids;
    for (const auto& [id, index] : page_ids)
        ids[static_cast<std::size_t>(number(index))] = id;
    for (std::size_t p = 0; p < pages.size(); ++p) {
        if (editing && (!ids.contains(p) || !changed_pages.contains(ids.at(p))))
            continue;
        paths.clear();
        auto page = pages[p];
        auto owner_object = page.getObjectHandle();
        auto unit_object = owner_object.getKey("/UserUnit");
        double unit = 1;
        if (!unit_object.isNull()) {
            require(unit_object.isNumber(), "Invalid page UserUnit.");
            unit = unit_object.getNumericValue();
        }
        require(std::isfinite(unit) && unit > 0 && unit <= 75000, "Invalid page UserUnit.");
        std::string data;
        for (const auto& stream : page.getPageContents()) {
            auto bytes = decode(stream, budget);
            require(bytes.size() < stream_limit - data.size(), "Page content exceeds 32 MiB.", "limit-exceeded");
            data += bytes;
            data += '\n';
        }
        auto resources = checked_resources(page.getAttribute("/Resources", false), editing);
        State state;
        state.groups = group_supported(owner_object);
        auto rewritten = owner(data, resources, state, ids.contains(p) ? ids.at(p) : "", "", {}, unit, editing, 0);
        std::unordered_set<std::string_view> fills;
        for (const auto& [geometry, latent] : paths)
            if (!latent)
                fills.insert(geometry);
        for (const auto& [geometry, latent] : paths)
            require(!latent || !fills.contains(geometry), "Latent stroke duplicates a separate fill.");
        if (editing && rewritten != data) {
            owner_object.replaceKey("/Resources", resources);
            auto stream = document.newStream();
            compress(stream, rewritten, budget);
            owner_object.replaceKey("/Contents", stream);
        }
    }
    for (const auto& [id, region] : object(manifest.getDictItem("regions"))) {
        (void)region;
        if (editing && !changed_targets.contains(records.at(region_records.at(id).front()).target))
            continue;
        require(regions_found[id] == 1, "Missing page region: " + id);
        require(record_order[id] == region_records.at(id), "Paint locators are missing or out of execution order.");
    }
    for (const auto& record : records)
        if (!editing || changed_targets.contains(record.target))
            require(record.found == 1, "Unresolved paint locator.");
}
std::optional<JSON> Engine::baseline(const Record& record, const std::string& property)
{
    auto b = record.baseline;
    if (property == "display")
        return b.getDictItem("display");
    if (property == "stroke-width") {
        auto width = pdf_number(text(b.getDictItem("width")));
        auto physical = width * record.scale * record.unit * (25.4 / 72.0);
        if (!std::isfinite(physical) || (width > 0 && physical == 0))
            return std::nullopt;
        return JSON::makeNumber(decimal(physical));
    }
    if (property == "stroke-opacity" || property == "fill-opacity")
        return JSON::makeNumber(
            decimal(pdf_number(text(b.getDictItem(property == "stroke-opacity" ? "strokeOpacity" : "fillOpacity")))));
    auto values = components(b.getDictItem(property == "stroke-color" ? "stroke" : "fill"));
    if (values.size() == 1)
        values.resize(3, values.front());
    std::ostringstream hex;
    hex << '#' << std::uppercase << std::hex << std::setfill('0');
    for (const auto& encoded : values) {
        auto n = pdf_number(encoded);
        auto byte = std::round(n * 255);
        if (byte / 255.0 != n)
            return std::nullopt;
        hex << std::setw(2) << static_cast<int>(byte);
    }
    return JSON::makeString(hex.str());
}
JSON Engine::summary(const std::string& id, JSON parameter)
{
    if (summaries.contains(id))
        return summaries.at(id);
    auto property = text(parameter.getDictItem("binding").getDictItem("property"));
    auto schema = parameter.getDictItem("schema");
    std::vector<JSON> colors;
    if (property.ends_with("color")) {
        auto annotation = schema.getDictItem("default");
        if (!annotation.isNull())
            colors.push_back(annotation);
        auto choices = schema.getDictItem("enum");
        if (!choices.isNull())
            for (const auto& choice : array(choices))
                colors.push_back(choice);
    }
    JSON first;
    bool unrepresentable = false;
    std::string raw_first;
    std::set<std::tuple<std::size_t, double, double>> seen;
    for (const auto& index : parameter_records.at(id)) {
        const auto& record = records.at(index);
        auto key = std::make_tuple(record.baseline_key, property == "stroke-width" ? record.scale : 1,
            property == "stroke-width" ? record.unit : 1);
        if (!seen.insert(std::move(key)).second)
            continue;
        auto candidate = baseline(record, property);
        auto raw = candidate ? candidate->unparse() : "";
        if (!candidate && property == "stroke-width") {
            raw = decimal(pdf_number(text(record.baseline.getDictItem("width")))) + " " + decimal(record.scale) + " "
                + decimal(record.unit);
        } else if (!candidate) {
            auto color = components(record.baseline.getDictItem(property == "stroke-color" ? "stroke" : "fill"));
            if (color.size() == 1)
                color.resize(3, color.front());
            raw.clear();
            for (const auto& n : color)
                raw += decimal(pdf_number(n)) + " ";
        }
        if (candidate && !colors.empty()) {
            auto canonical = text(*candidate);
            for (const auto& choice : colors) {
                auto spelling = text(choice);
                if (std::equal(spelling.begin(), spelling.end(), canonical.begin(), canonical.end(),
                        [](char a, char b) { return (a >= 'a' && a <= 'f' ? a - 'a' + 'A' : a) == b; })) {
                    candidate = choice;
                    break;
                }
            }
        }
        if (raw_first.empty()) {
            raw_first = raw;
            if (candidate)
                first = *candidate;
        } else if (raw != raw_first)
            return summaries[id] = dictionary({{"kind", JSON::makeString("mixed")}});
        if (!candidate) {
            unrepresentable = true;
            continue;
        }
        try {
            value(*candidate, schema, property);
        } catch (const Error&) {
            unrepresentable = true;
        }
    }
    if (unrepresentable)
        return summaries[id] = dictionary({{"kind", JSON::makeString("unrepresentable")},
                   {"reason", JSON::makeString("The original paint has no value in this parameter's domain.")}});
    return summaries[id] = dictionary({{"kind", JSON::makeString("uniform")}, {"value", first}});
}
void Engine::update(JSON next)
{
    changed_targets.clear();
    changed_pages.clear();
    changed_paths.clear();
    choices.clear();
    for (const auto& [id, parameter] : object(next.getDictItem("parameters"))) {
        auto previous = parameters.at(id);
        bool saved = object(previous).contains("value"), supplied = object(parameter).contains("value");
        bool changed = saved != supplied
            || (saved && supplied && !equal(previous.getDictItem("value"), parameter.getDictItem("value")));
        auto binding = parameter.getDictItem("binding");
        for (const auto& target : array(binding.getDictItem("targets"))) {
            auto name = text(target);
            if (changed)
                changed_targets.insert(name);
            if (supplied)
                choices[name][text(binding.getDictItem("property"))] = parameter.getDictItem("value");
        }
    }
    for (const auto& record : records) {
        auto& paths = changed_paths[record.region];
        if (!changed_targets.contains(record.target))
            continue;
        changed_pages.insert(record.page);
        for (std::size_t n = 1; n <= record.path.size(); ++n)
            paths.emplace(record.path.begin(), record.path.begin() + static_cast<std::ptrdiff_t>(n));
    }
    // Editing visits only changed occurrences; the caller validates the complete serialized result.
    traverse(true);
    auto updated_regions = JSON::makeDictionary();
    for (auto [id, region] : object(next.getDictItem("regions"))) {
        auto locators = JSON::makeArray();
        for (auto index : region_records.at(id))
            locators.addArrayElement(records.at(index).locator);
        region = copy_object(region);
        region.addDictionaryMember("records", locators);
        updated_regions.addDictionaryMember(id, region);
    }
    next.addDictionaryMember("regions", updated_regions);
    manifest = std::move(next);
    parameters = object(manifest.getDictItem("parameters"));
}
std::string Engine::write(JSON next)
{
    update(next);
    return save(manifest);
}
}
