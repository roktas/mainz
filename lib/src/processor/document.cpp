#include "engine.hh"
#include "pipeline.hh"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <exception>
#include <mutex>
#include <qpdf/QPDFAcroFormDocumentHelper.hh>
#include <qpdf/QPDFEmbeddedFileDocumentHelper.hh>
#include <qpdf/QPDFFileSpecObjectHelper.hh>
#include <qpdf/QPDFLogger.hh>
#include <qpdf/QPDFPageDocumentHelper.hh>
#include <qpdf/QPDFPageLabelDocumentHelper.hh>
#include <qpdf/QPDFWriter.hh>
#include <qpdf/global.hh>
#include <string_view>
#include <utility>
#include <zlib.h>

namespace mainz::detail {
static void configure_qpdf_limits()
{
    static std::once_flag configured;
    std::call_once(configured, [] {
        auto logger = QPDFLogger::defaultLogger();
        logger->setWarn(logger->discard());
        logger->setError(logger->discard());
        qpdf::global::limits::flate_max_memory(static_cast<std::uint32_t>(pdf_limit));
        qpdf::global::limits::png_max_memory(static_cast<std::uint32_t>(stream_limit));
        qpdf::global::limits::tiff_max_memory(static_cast<std::uint32_t>(stream_limit));
        qpdf::global::limits::run_length_max_memory(static_cast<std::uint32_t>(pdf_limit));
        qpdf::global::limits::dct_max_memory(static_cast<std::uint32_t>(pdf_limit));
        qpdf::global::limits::max_stream_filters(8);
    });
}
bool qpdf_limit_message(std::string_view message)
{
    return message.find("memory limit exceeded") != std::string_view::npos
        || message.find("exceeds PL_Flate memory limit") != std::string_view::npos
        || message.find("too many filters") != std::string_view::npos;
}
bool empty_dictionary(Object dict)
{
    for (const auto& [key, val] : dict.ditems()) {
        (void)key;
        if (!val.isNull())
            return false;
    }
    return true;
}
static bool decode_parms_exceed_limit(Object parms)
{
    auto check_dict = [](Object dict) {
        if (!dict.isDictionary())
            return false;
        for (const auto& key : {"/Columns", "/Colors", "/BitsPerComponent"}) {
            auto value = dict.getKey(key);
            if (value.isInteger()) {
                auto n = value.getIntValue();
                if (n > 0 && static_cast<unsigned long long>(n) > stream_limit / 2)
                    return true;
            }
        }
        return false;
    };
    if (parms.isDictionary())
        return check_dict(parms);
    if (parms.isArray())
        for (int i = 0, n = parms.getArrayNItems(); i < n; ++i)
            if (check_dict(parms.getArrayItem(i)))
                return true;
    return false;
}
std::string decode(Object stream, Budget& budget, std::size_t limit)
{
    const auto limit_errors = qpdf::global::limit_errors();
    Buffer output(limit, budget.remaining);
    bool filtered = false;
    bool decoded = stream.isStream() && stream.pipeStreamData(&output, &filtered, 0, qpdf_dl_generalized);
    // QPDF converts pipeline exceptions into a failed decode. Preserve the original limit/allocation error.
    if (output.failure)
        std::rethrow_exception(output.failure);
    if (!decoded || !filtered) {
        if (qpdf::global::limit_errors() > limit_errors
            || (stream.isStream() && decode_parms_exceed_limit(stream.getDict().getKey("/DecodeParms"))))
            throw Error("limit-exceeded", "PDF stream filter exceeds limit.");
        if (auto* owner = stream.getOwningQPDF())
            for (const auto& warning : owner->getWarnings())
                if (qpdf_limit_message(warning.what()))
                    throw Error("limit-exceeded", warning.what());
        throw Error("pdf-syntax", "Cannot decode PDF stream.");
    }
    return std::move(output.bytes);
}
void compress(Object stream, const std::string& data, Budget& budget)
{
    require(data.size() <= stream_limit, "Stream exceeds 32 MiB.", "limit-exceeded");
    auto size = compressBound(static_cast<uLong>(data.size()));
    std::string output(size, '\0');
    auto status = compress2(reinterpret_cast<Bytef*>(output.data()), &size, reinterpret_cast<const Bytef*>(data.data()),
        static_cast<uLong>(data.size()), Z_BEST_SPEED);
    require(status != Z_MEM_ERROR, "Stream compression allocation failed.", "limit-exceeded");
    require(status == Z_OK, "Cannot compress PDF stream.", "pdf-syntax");
    output.resize(size);
    budget.consume(output.size());
    stream.replaceStreamData(output, Object::newName("/FlateDecode"), Object::newNull());
}
JSON copy_object(JSON original)
{
    auto copy = JSON::makeDictionary();
    for (const auto& [key, item] : object(original))
        copy.addDictionaryMember(key, item);
    return copy;
}
JSON mapped_profiles(JSON sets, const std::map<std::string, std::string>& parameters, const std::string& prefix)
{
    auto result = JSON::makeArray();
    for (const auto& set : array(sets)) {
        auto members = JSON::makeArray();
        for (const auto& member : array(set.getDictItem("parameters")))
            if (parameters.contains(text(member)))
                members.addArrayElement(JSON::makeString(parameters.at(text(member))));
        if (empty_array(members))
            continue;
        auto updated = copy_object(set);
        updated.addDictionaryMember("id", JSON::makeString(prefix + text(set.getDictItem("id"))));
        updated.addDictionaryMember("parameters", members);
        auto profiles = JSON::makeArray();
        for (const auto& profile : array(set.getDictItem("profiles"))) {
            auto choice = copy_object(profile);
            auto overrides = JSON::makeDictionary();
            for (const auto& [id, value] : object(profile.getDictItem("overrides")))
                if (parameters.contains(id))
                    overrides.addDictionaryMember(parameters.at(id), value);
            choice.addDictionaryMember("overrides", overrides);
            profiles.addArrayElement(choice);
        }
        updated.addDictionaryMember("profiles", profiles);
        result.addArrayElement(updated);
    }
    return result;
}
static void add_locator_bytes(std::size_t& total, std::size_t n)
{
    require(n <= locator_limit - total, "Cumulative locator text exceeds 128 MiB.", "limit-exceeded");
    total += n;
}
static void add_scaled_locator_bytes(std::size_t& total, std::size_t factor, std::size_t len)
{
    if (factor == 0)
        return;
    require(len <= (locator_limit - total) / factor, "Cumulative locator text exceeds 128 MiB.", "limit-exceeded");
    total += factor * len;
}
static void accumulate_static_locator_bytes(const JSON& record, std::size_t& total)
{
    add_locator_bytes(total, text(record.getDictItem("marker")).size());
    add_locator_bytes(total, text(record.getDictItem("fill")).size());
    for (const auto& step : array(record.getDictItem("path")))
        add_locator_bytes(total, text(step.getDictItem("resource")).size());
}
std::string RecordSetCatalog::register_set(JSON records, std::string encoded)
{
    if (auto found = known.find(encoded); found != known.end())
        return found->second;
    require(encoded.size() <= manifest_limit - template_bytes, "Record sets exceed 16 MiB.", "limit-exceeded");
    template_bytes += encoded.size();
    auto set_id = "r" + std::to_string(known.size());
    known.emplace(std::move(encoded), set_id);
    sets.addDictionaryMember(set_id, records);
    return set_id;
}
RecordSetCatalog::CanonicalRegion RecordSetCatalog::canonicalize(JSON manifest, JSON old_sets,
    std::unordered_map<std::string, CanonicalSet>& existing_sets, JSON region, Budget& budget,
    const std::map<std::string, std::string>* baseline_ids, std::string_view target_id, bool track_locator_bytes)
{
    auto remap = [&](const std::string& id) -> std::string { return baseline_ids ? baseline_ids->at(id) : id; };
    if (region.getDictItem("records").isNull() && !old_sets.isNull()) {
        auto old_id = text(region.getDictItem("recordSet"));
        auto refs_map = object(region.getDictItem("baselineRefs"));
        std::unordered_set<std::string> unique_baselines;
        bool distinct = true;
        for (const auto& [slot, baseline] : refs_map) {
            (void)slot;
            if (!unique_baselines.insert(remap(text(baseline))).second) {
                distinct = false;
                break;
            }
        }
        if (distinct) {
            auto cached = existing_sets.find(old_id);
            if (cached == existing_sets.end()) {
                std::unordered_map<std::string, std::size_t> slot_idx;
                std::vector<std::string> slot_order;
                std::vector<std::size_t> slot_counts;
                auto records = JSON::makeArray();
                std::size_t count = 0, static_bytes = 0;
                for (const auto& record : array(member(old_sets, old_id))) {
                    auto old_slot = text(record.getDictItem("baseline"));
                    auto [it, fresh] = slot_idx.try_emplace(old_slot, slot_order.size());
                    if (fresh) {
                        slot_order.push_back(old_slot);
                        slot_counts.push_back(0);
                    }
                    ++slot_counts[it->second];
                    auto locator = copy_object(record);
                    locator.addDictionaryMember("baseline", JSON::makeString("b" + std::to_string(it->second)));
                    records.addArrayElement(locator);
                    if (track_locator_bytes) {
                        ++count;
                        accumulate_static_locator_bytes(record, static_bytes);
                    }
                }
                auto encoded = encode(records, manifest_limit, budget.remaining);
                auto new_id = register_set(records, std::move(encoded));
                cached = existing_sets
                             .emplace(old_id,
                                 CanonicalSet {std::move(new_id), std::move(slot_order), std::move(slot_counts), count,
                                     static_bytes})
                             .first;
            }
            const auto& cs = cached->second;
            auto refs = JSON::makeDictionary();
            std::size_t fixed_bytes = cs.static_bytes;
            if (track_locator_bytes)
                add_scaled_locator_bytes(fixed_bytes, cs.record_count, target_id.size());
            for (std::size_t s = 0; s < cs.slot_order.size(); ++s) {
                auto mapped = remap(text(refs_map.at(cs.slot_order[s])));
                refs.addDictionaryMember("b" + std::to_string(s), JSON::makeString(mapped));
                if (track_locator_bytes)
                    add_scaled_locator_bytes(fixed_bytes, cs.slot_counts[s], mapped.size());
            }
            return CanonicalRegion {cs.set_id, refs, cs.record_count, fixed_bytes};
        }
    }
    std::unordered_map<std::string, std::string> slots;
    auto records = JSON::makeArray(), refs = JSON::makeDictionary();
    std::size_t record_count {0}, fixed_bytes {0};
    for (const auto& record : locators(manifest, region)) {
        auto baseline = remap(baseline_ref(region, record));
        auto [slot, fresh] = slots.try_emplace(baseline, "b" + std::to_string(slots.size()));
        if (fresh)
            refs.addDictionaryMember(slot->second, JSON::makeString(baseline));
        auto locator = copy_object(record);
        locator.addDictionaryMember("baseline", JSON::makeString(slot->second));
        records.addArrayElement(locator);
        if (track_locator_bytes) {
            ++record_count;
            add_locator_bytes(fixed_bytes, target_id.size());
            add_locator_bytes(fixed_bytes, baseline.size());
            accumulate_static_locator_bytes(record, fixed_bytes);
        }
    }
    auto encoded = encode(records, manifest_limit, budget.remaining);
    auto set_id = register_set(records, std::move(encoded));
    return CanonicalRegion {std::move(set_id), refs, record_count, fixed_bytes};
}
// Baseline identities remain local to each region; only locator syntax is shared.
JSON share_records(JSON root, Budget& budget)
{
    auto result = JSON::makeDictionary();
    for (const auto& [key, value] : object(root))
        if (key != "regions" && key != "recordSets")
            result.addDictionaryMember(key, value);
    RecordSetCatalog catalog;
    std::unordered_map<std::string, RecordSetCatalog::CanonicalSet> existing_sets;
    auto old_sets = root.getDictItem("recordSets");
    auto regions = JSON::makeDictionary();
    for (const auto& [id, region] : object(root.getDictItem("regions"))) {
        auto entry = catalog.canonicalize(root, old_sets, existing_sets, region, budget);
        regions.addDictionaryMember(id,
            dictionary({{"page", region.getDictItem("page")}, {"marker", region.getDictItem("marker")},
                {"recordSet", JSON::makeString(entry.set_id)}, {"baselineRefs", entry.baseline_refs}}));
    }
    auto sets = catalog.take_sets();
    result.addDictionaryMember("regions", regions);
    if (!empty_object(sets))
        result.addDictionaryMember("recordSets", sets);
    return result;
}
void Engine::attachments(Object tree, std::set<QPDFObjGen>& seen, std::set<std::string>& names,
    std::vector<Object>& found, std::size_t depth)
{
    require(depth <= 32 && ++budget.visits <= 65536, "Attachment traversal exceeds limit.", "limit-exceeded");
    require(tree.isDictionary(), "Invalid EmbeddedFiles name tree.");
    if (tree.isIndirect())
        require(seen.insert(tree.getObjGen()).second, "Cyclic or repeated attachment node.");
    auto entries = tree.getKey("/Names"), kids = tree.getKey("/Kids");
    require(entries.isNull() || kids.isNull(), "Name tree node has Names and Kids.");
    if (!entries.isNull()) {
        require(entries.isArray() && entries.getArrayNItems() % 2 == 0, "Invalid attachment name array.");
        const auto count = static_cast<std::size_t>(entries.getArrayNItems() / 2);
        require(count <= 65536 - budget.visits, "Attachment traversal exceeds limit.", "limit-exceeded");
        budget.visits += count;
        for (int i = 0; i < entries.getArrayNItems(); i += 2) {
            auto key = entries.getArrayItem(i);
            require(key.isString(), "Invalid attachment name.");
            auto filename = key.getUTF8Value();
            require(names.insert(filename).second, "Duplicate attachment name.");
            auto spec = entries.getArrayItem(i + 1);
            require(spec.isDictionary(), "Invalid attachment Filespec.");
            files.emplace(filename, spec);
            bool named = filename == "mainz.json";
            bool referenced = spec.getKey("/F").isString() && spec.getKey("/F").getUTF8Value() == "mainz.json";
            referenced
                = referenced || (spec.getKey("/UF").isString() && spec.getKey("/UF").getUTF8Value() == "mainz.json");
            require(named == referenced, "Inconsistent Mainz attachment declaration.");
            if (named)
                found.push_back(spec);
        }
    }
    if (!kids.isNull()) {
        require(kids.isArray(), "Invalid name tree Kids.");
        for (int i = 0, n = kids.getArrayNItems(); i < n; ++i)
            attachments(kids.getArrayItem(i), seen, names, found, depth + 1);
    }
}
static void reject_signed_objects(QPDF& document, unsigned long limit_errors)
{
    auto reject_tree = [&](Object root_object) {
        std::vector<std::pair<Object, std::size_t>> stack;
        stack.emplace_back(root_object, 0);
        while (!stack.empty()) {
            auto [current, depth] = stack.back();
            stack.pop_back();
            if (current.isDictionary()) {
                require(!current.getKey("/Type").isNameAndEquals("/Sig")
                        && !current.getKey("/Type").isNameAndEquals("/DocTimeStamp")
                        && !current.getKey("/FT").isNameAndEquals("/Sig") && !current.hasKey("/ByteRange"),
                    "Signed PDFs are unsupported.", "unsupported-context");
                for (const auto& [key, value] : current.ditems()) {
                    (void)key;
                    if (!value.isIndirect() && (value.isDictionary() || value.isArray())) {
                        require(depth < 64, "Direct object nesting exceeds limit.", "limit-exceeded");
                        stack.emplace_back(value, depth + 1);
                    }
                }
            } else if (current.isArray()) {
                for (int i = 0, n = current.getArrayNItems(); i < n; ++i) {
                    auto item = current.getArrayItem(i);
                    if (!item.isIndirect() && (item.isDictionary() || item.isArray())) {
                        require(depth < 64, "Direct object nesting exceeds limit.", "limit-exceeded");
                        stack.emplace_back(item, depth + 1);
                    }
                }
            }
        }
    };
    try {
        for (const auto& item : document.getAllObjects())
            if (item.isDictionary() || item.isArray())
                reject_tree(item);
    } catch (const Error&) {
        throw;
    } catch (const std::exception& error) {
        if (qpdf::global::limit_errors() > limit_errors || qpdf_limit_message(error.what()))
            throw Error("limit-exceeded", error.what());
        throw;
    }
}
struct ParsedLocator {
    std::string marker;
    std::string baseline_slot;
    FillKind fill {FillKind::none};
    std::size_t fill_text_size {0};
    std::vector<Step> path;
    std::size_t resource_bytes {0};
    JSON json;
};
static std::vector<ParsedLocator> parse_locator_array(const std::vector<JSON>& items)
{
    std::vector<ParsedLocator> parsed_items;
    parsed_items.reserve(items.size());
    for (const auto& locator : items) {
        auto paint_marker = text(locator.getDictItem("marker"));
        auto fill_text = text(locator.getDictItem("fill"));
        auto slot = text(locator.getDictItem("baseline"));
        FillKind kind = fill_text == "existing" ? FillKind::existing
            : fill_text == "latent"             ? FillKind::latent
                                                : FillKind::none;
        std::vector<Step> steps;
        std::size_t resource_bytes = 0;
        for (const auto& step : array(locator.getDictItem("path"))) {
            auto resource = text(step.getDictItem("resource"));
            resource_bytes += resource.size();
            steps.push_back({std::move(resource), static_cast<std::size_t>(number(step.getDictItem("occurrence")))});
        }
        parsed_items.push_back({std::move(paint_marker), std::move(slot), kind, fill_text.size(), std::move(steps),
            resource_bytes, locator});
    }
    return parsed_items;
}
Engine::Engine(const std::string& input, Budget* shared_budget, bool validated, std::shared_ptr<const Index> previous)
    : budget(shared_budget ? *shared_budget : owned_budget)
    , previous(std::move(previous))
{
    auto found = load_document(input, validated);
    if (found.empty()) {
        require(document.getWarnings().empty(), "PDF contains structural warnings.", "pdf-syntax");
        return;
    }
    require(found.size() == 1, "Multiple Mainz manifest declarations.");
    load_manifest(found.front(), validated);
    index_manifest(validated);
    require(document.getWarnings().empty(), "PDF contains structural warnings.", "pdf-syntax");
}
std::vector<Object> Engine::load_document(const std::string& input, bool validated)
{
    require(input.size() <= pdf_limit, "Input PDF exceeds 128 MiB.", "limit-exceeded");
    configure_qpdf_limits();
    const auto limit_errors = qpdf::global::limit_errors();
    document.setSuppressWarnings(true);
    document.setAttemptRecovery(false);
    try {
        document.processMemoryFile("Mainz input", input.data(), input.size());
    } catch (const std::exception& error) {
        if (qpdf::global::limit_errors() > limit_errors || qpdf_limit_message(error.what()))
            throw Error("limit-exceeded", error.what());
        throw;
    }
    require(!document.isEncrypted(), "Encrypted PDFs are unsupported.", "unsupported-context");
    if (!validated)
        reject_signed_objects(document, limit_errors);
    if (auto acro = document.getRoot().getKeyIfDict("/AcroForm"); acro.isDictionary()) {
        auto flags = acro.getKey("/SigFlags");
        require(!flags.isInteger() || flags.getIntValue() == 0, "Signed PDFs are unsupported.", "unsupported-context");
    }
    require(document.getRoot().getKey("/Perms").isNull(), "Certification and usage-rights signatures are unsupported.",
        "unsupported-context");
    pages = QPDFPageDocumentHelper(document).getAllPages();
    require(!pages.empty(), "PDF has no pages.", "pdf-syntax");
    require(pages.size() <= page_limit, "Pages exceed 10000.", "limit-exceeded");
    previews.pages.resize(pages.size());
    std::set<QPDFObjGen> nodes;
    std::set<std::string> names;
    std::vector<Object> found;
    auto catalog_names = document.getRoot().getKey("/Names");
    require(catalog_names.isNull() || catalog_names.isDictionary(), "Invalid catalog Names dictionary.", "pdf-syntax");
    auto embedded = catalog_names.getKeyIfDict("/EmbeddedFiles");
    if (!embedded.isNull())
        attachments(embedded, nodes, names, found, 0);
    return found;
}
void Engine::load_manifest(Object spec, bool validated)
{
    require(spec.getKey("/F").isString() && spec.getKey("/UF").isString()
            && spec.getKey("/F").getUTF8Value() == "mainz.json" && spec.getKey("/UF").getUTF8Value() == "mainz.json",
        "Wrong manifest Filespec names.");
    auto ef = spec.getKey("/EF");
    require(ef.isDictionary(), "Missing manifest EF dictionary.");
    payload = ef.getKey("/F");
    auto unicode_payload = ef.getKey("/UF");
    require(payload.isStream() && unicode_payload.isStream() && payload.getObjGen() == unicode_payload.getObjGen(),
        "Manifest EF references differ.");
    require(payload.getDict().getKey("/Subtype").isNameAndEquals("/application/json"),
        "Manifest media type is not application/json.");
    auto encoded = decode(payload, budget, manifest_limit);
    // Exact validated Input bytes reuse manifest and painting validation.
    manifest = validated ? JSON::parse(encoded) : parse(encoded, "manifest");
    try {
        if (!validated)
            detail::manifest(manifest, pages.size());
    } catch (const Error& error) {
        if (!error.source().empty())
            throw;
        throw Error(error.code(), error.what(), "manifest", "");
    }
    load_previews(!validated);
}
void Engine::index_manifest(bool validated)
{
    parameters = object(manifest.getDictItem("parameters"));
    auto target_map = object(manifest.getDictItem("targets"));
    std::vector<std::map<std::string, std::string>> bindings(target_map.size());
    choices.resize(target_map.size());
    target_width_bound.assign(target_map.size(), false);
    for (const auto& [target, region_ids] : target_map) {
        (void)region_ids;
        target_ids.emplace(target, target_ids.size());
    }
    for (const auto& [id, parameter] : parameters) {
        auto binding = parameter.getDictItem("binding");
        auto property = text(binding.getDictItem("property"));
        bool has_value = !parameter.getDictItem("value").isNull();
        for (const auto& target : array(binding.getDictItem("targets"))) {
            auto tid = target_ids.at(text(target));
            bindings[tid][property] = id;
            if (property == "stroke-width")
                target_width_bound[tid] = true;
            if (has_value)
                choices[tid][property] = parameter.getDictItem("value");
        }
    }
    original_choices = choices;
    auto regions = object(manifest.getDictItem("regions"));
    struct BaselineEntry {
        std::size_t key {0};
        JSON json;
        bool strokes {true};
    };
    std::unordered_map<std::string, BaselineEntry> baselines;
    for (const auto& [id, baseline] : object(manifest.getDictItem("baselines"))) {
        auto paint = text(baseline.getDictItem("paint"));
        baselines.emplace(id, BaselineEntry {baselines.size(), baseline, paint != "f" && paint != "f*"});
    }
    std::unordered_map<std::string, std::vector<ParsedLocator>> parsed_sets;
    if (auto record_sets = manifest.getDictItem("recordSets"); !record_sets.isNull())
        for (const auto& [set_id, items] : object(record_sets))
            parsed_sets.emplace(set_id, parse_locator_array(array(items)));
    auto consume_locator = [&](std::size_t n) {
        require(n <= budget.locator_remaining, "Cumulative locator text exceeds 128 MiB.", "limit-exceeded");
        budget.locator_remaining -= n;
    };
    region_names.reserve(regions.size());
    region_target.reserve(regions.size());
    region_page.reserve(regions.size());
    region_shape.reserve(regions.size());
    region_records.resize(regions.size());
    regions_found.assign(regions.size(), 0);
    record_order.resize(regions.size());
    region_locator_changed.assign(regions.size(), 0);
    using ShapeKey = std::tuple<std::size_t, std::string, std::vector<std::pair<std::string, std::size_t>>>;
    std::map<ShapeKey, std::size_t> shared_shapes;
    std::vector<std::size_t> shape_exemplar;
    for (const auto& [target, region_ids] : target_map) {
        auto tid = target_ids.at(target);
        const auto& target_bindings = bindings[tid];
        for (const auto& region_id : array(region_ids)) {
            auto id = text(region_id);
            const auto& region = regions.at(id);
            auto rid = region_names.size();
            region_names.push_back(id);
            region_target.push_back(tid);
            auto page = static_cast<std::size_t>(number(region.getDictItem("page")));
            region_page.push_back(page);
            auto marker = text(region.getDictItem("marker"));
            require(page_markers.emplace(std::make_pair(page, std::move(marker)), rid).second,
                "Ambiguous page region marker.");
            std::vector<ParsedLocator> inline_locators;
            const std::vector<ParsedLocator>* items = nullptr;
            std::unordered_map<std::string, std::string> refs;
            bool shared = region.getDictItem("records").isNull();
            std::size_t shape_id = 0;
            if (shared) {
                auto set_id = text(region.getDictItem("recordSet"));
                items = &parsed_sets.at(set_id);
                std::vector<std::pair<std::string, std::size_t>> ref_keys;
                auto ref_objs = object(region.getDictItem("baselineRefs"));
                ref_keys.reserve(ref_objs.size());
                for (const auto& [slot, baseline] : ref_objs) {
                    auto bname = text(baseline);
                    ref_keys.emplace_back(slot, baselines.at(bname).key);
                    refs.emplace(slot, std::move(bname));
                }
                auto [it, fresh] = shared_shapes.try_emplace(
                    ShapeKey {tid, std::move(set_id), std::move(ref_keys)}, shape_exemplar.size());
                shape_id = it->second;
                if (fresh)
                    shape_exemplar.push_back(rid);
            } else {
                inline_locators = parse_locator_array(array(region.getDictItem("records")));
                items = &inline_locators;
                shape_id = shape_exemplar.size();
                shape_exemplar.push_back(rid);
            }
            region_shape.push_back(shape_id);
            auto& reg_recs = region_records[rid];
            reg_recs.reserve(items->size());
            for (const auto& loc : *items) {
                const auto& baseline_id = shared ? refs.at(loc.baseline_slot) : loc.baseline_slot;
                consume_locator(id.size() + target.size() + loc.marker.size() + loc.fill_text_size + baseline_id.size()
                    + loc.resource_bytes);
                const auto& base = baselines.at(baseline_id);
                if (loc.fill == FillKind::latent)
                    latent_pages.insert(page);
                const auto record_idx = records.size();
                for (const auto& [property, parameter_id] : target_bindings) {
                    bool eligible = property == "display"
                        || (property.starts_with("stroke-") ? base.strokes : loc.fill != FillKind::none);
                    if (eligible)
                        parameter_records[parameter_id].push_back(record_idx);
                }
                reg_recs.push_back(record_idx);
                records.push_back({rid, page, tid, loc.marker, loc.fill, base.key, base.strokes, loc.path, loc.json,
                    base.json, 1, 1, 0});
            }
        }
    }
    // Build non-allocating per-(shape, path) marker indexes once records has its final address.
    shape_locators.resize(shape_exemplar.size());
    for (std::size_t s = 0; s < shape_exemplar.size(); ++s) {
        const auto& exemplar = region_records[shape_exemplar[s]];
        for (std::size_t local = 0; local < exemplar.size(); ++local) {
            const auto& rec = records[exemplar[local]];
            auto& bucket = shape_locators[s][rec.path];
            require(bucket.emplace(rec.marker, local).second, "Ambiguous paint marker.");
        }
    }
    // Editing and composition pass validated=true only for exact bytes accepted by read().
    // Editing checks changed occurrences; callers fully validate the serialized output.
    if (!validated && !parameters.empty()) {
        traverse(false);
        for (const auto& [id, parameter] : parameters) {
            if (!parameter.getDictItem("schema").getDictItem("default").isNull()) {
                auto result = summary(id, parameter);
                require(text(result.getDictItem("kind")) == "uniform"
                        && equal(result.getDictItem("value"), parameter.getDictItem("schema").getDictItem("default")),
                    "Schema default disagrees with baseline.");
            }
        }
    }
}

static std::string label(Object record)
{
    auto prefix = record.getKey("/P");
    std::string result;
    if (prefix.isString()) {
        auto raw = prefix.getUTF8Value();
        require(raw.size() <= 4096, "Page label exceeds 4096 bytes.", "limit-exceeded");
        result = std::move(raw);
    }
    auto style = record.getKey("/S");
    auto start = record.getKey("/St");
    auto n = start.isInteger() ? start.getIntValue() : 1;
    require(n > 0 && n <= 1000000, "Page-label number exceeds limit.", "limit-exceeded");
    if (style.isNameAndEquals("/D")) {
        auto digits = std::to_string(n);
        require(digits.size() <= 4096 - result.size(), "Page label exceeds 4096 bytes.", "limit-exceeded");
        return result + digits;
    }
    if (style.isNameAndEquals("/A") || style.isNameAndEquals("/a")) {
        const auto repeat = static_cast<std::size_t>((n - 1) / 26 + 1);
        require(repeat <= 4096 - result.size(), "Page label exceeds 4096 bytes.", "limit-exceeded");
        return result
            + std::string(repeat, static_cast<char>((style.isNameAndEquals("/A") ? 'A' : 'a') + (n - 1) % 26));
    }
    if (style.isNameAndEquals("/R") || style.isNameAndEquals("/r")) {
        const auto prefix_size = result.size();
        static constexpr std::array<std::pair<int, std::string_view>, 13> numerals {
            {{1000, "M"}, {900, "CM"}, {500, "D"}, {400, "CD"}, {100, "C"}, {90, "XC"}, {50, "L"}, {40, "XL"},
                {10, "X"}, {9, "IX"}, {5, "V"}, {4, "IV"}, {1, "I"}}};
        for (const auto& [amount, digits] : numerals)
            while (n >= amount) {
                require(digits.size() <= 4096 - result.size(), "Page label exceeds 4096 bytes.", "limit-exceeded");
                result += digits;
                n -= amount;
            }
        if (style.isNameAndEquals("/r"))
            for (auto i = prefix_size; i < result.size(); ++i) {
                auto& c = result[i];
                if (c >= 'A' && c <= 'Z')
                    c += 'a' - 'A';
            }
    }
    return result;
}
std::string Engine::describe()
{
    auto described_pages = JSON::makeArray();
    auto metadata = empty_object(manifest) ? std::vector<JSON> {} : array(manifest.getDictItem("pages"));
    QPDFPageLabelDocumentHelper labels(document);
    std::size_t label_bytes = 0;
    for (std::size_t index = 0; index < pages.size(); ++index) {
        auto page = metadata.empty() ? JSON::makeDictionary() : copy_object(metadata.at(index));
        if (auto preview = page.getDictItem("preview"); !preview.isNull())
            page.addDictionaryMember("preview", image(text(preview)));
        if (labels.hasPageLabels()) {
            auto entry = labels.getLabelForPage(static_cast<long long>(index));
            if (entry.isDictionary()) {
                auto text_label = label(entry);
                require(
                    text_label.size() <= manifest_limit - label_bytes, "Page labels exceed 16 MiB.", "limit-exceeded");
                label_bytes += text_label.size();
                budget.consume(text_label.size());
                page.addDictionaryMember("label", JSON::makeString(text_label));
            }
        }
        described_pages.addArrayElement(page);
    }
    auto described_parameters = JSON::makeDictionary();
    for (const auto& [id, parameter] : parameters) {
        std::set<std::size_t> affected;
        for (const auto& index : parameter_records.at(id))
            affected.insert(records.at(index).page);
        auto ids = JSON::makeArray();
        for (auto page : affected)
            ids.addArrayElement(JSON::makeInt(static_cast<long long>(page)));
        described_parameters.addDictionaryMember(
            id, dictionary({{"parameter", parameter}, {"baseline", summary(id, parameter)}, {"pages", ids}}));
    }
    auto result
        = dictionary({{"version", JSON::makeInt(1)}, {"pageCount", JSON::makeInt(static_cast<long long>(pages.size()))},
            {"pages", described_pages}, {"parameters", described_parameters}});
    for (const auto& field : {"groups", "profileSets", "publication"})
        if (!manifest.getDictItem(field).isNull())
            result.addDictionaryMember(field, manifest.getDictItem(field));
    return encode(result, manifest_limit, budget.remaining);
}
JSON Engine::retained(const std::map<std::size_t, std::size_t>& indexes)
{
    auto next = JSON::makeDictionary();
    for (const auto& [key, item] : object(manifest))
        if (key != "publication" && key != "groups" && key != "profileSets")
            next.addDictionaryMember(key, item);
    auto kept_pages = JSON::makeArray();
    auto authored = array(manifest.getDictItem("pages"));
    std::vector<JSON> ordered(indexes.size());
    for (const auto& [old_index, new_index] : indexes)
        ordered.at(new_index) = authored.at(old_index);
    for (const auto& page : ordered)
        kept_pages.addArrayElement(page);
    std::unordered_set<std::string> region_ids, baseline_ids, target_ids_kept, parameter_ids;
    auto kept_parameters = JSON::makeDictionary();
    for (const auto& [id, original_parameter] : parameters) {
        std::unordered_set<std::size_t> eligible;
        for (const auto& index : parameter_records.at(id))
            if (indexes.contains(records.at(index).page))
                eligible.insert(records.at(index).target_idx);
        auto binding = copy_object(original_parameter.getDictItem("binding"));
        auto targets = JSON::makeArray();
        for (const auto& target : array(binding.getDictItem("targets"))) {
            auto tname = text(target);
            if (eligible.contains(target_ids.at(tname))) {
                targets.addArrayElement(target);
                target_ids_kept.insert(std::move(tname));
            }
        }
        if (empty_array(targets))
            continue;
        auto parameter = copy_object(original_parameter);
        binding.addDictionaryMember("targets", targets);
        parameter.addDictionaryMember("binding", binding);
        kept_parameters.addDictionaryMember(id, parameter);
        parameter_ids.insert(id);
    }
    auto kept_targets = JSON::makeDictionary();
    auto all_regions = manifest.getDictItem("regions");
    for (const auto& [id, regions] : object(manifest.getDictItem("targets"))) {
        if (!target_ids_kept.contains(id))
            continue;
        auto kept = JSON::makeArray();
        for (const auto& region : array(regions)) {
            auto rname = text(region);
            if (indexes.contains(static_cast<std::size_t>(number(member(all_regions, rname).getDictItem("page"))))) {
                kept.addArrayElement(region);
                region_ids.insert(std::move(rname));
            }
        }
        kept_targets.addDictionaryMember(id, kept);
    }
    auto kept_regions = JSON::makeDictionary();
    for (const auto& [id, region] : object(all_regions)) {
        if (!region_ids.contains(id))
            continue;
        auto kept = copy_object(region);
        auto page = static_cast<std::size_t>(number(region.getDictItem("page")));
        kept.addDictionaryMember("page", JSON::makeInt(static_cast<long long>(indexes.at(page))));
        kept_regions.addDictionaryMember(id, kept);
        if (auto refs = region.getDictItem("baselineRefs"); !refs.isNull())
            for (const auto& [slot, baseline] : object(refs)) {
                (void)slot;
                baseline_ids.insert(text(baseline));
            }
        else
            for (const auto& record : locators(manifest, region))
                baseline_ids.insert(baseline_ref(region, record));
    }
    auto kept_baselines = JSON::makeDictionary();
    for (const auto& [id, baseline] : object(manifest.getDictItem("baselines")))
        if (baseline_ids.contains(id))
            kept_baselines.addDictionaryMember(id, baseline);
    next.addDictionaryMember("pages", kept_pages);
    next.addDictionaryMember("regions", kept_regions);
    next.addDictionaryMember("baselines", kept_baselines);
    next.addDictionaryMember("targets", kept_targets);
    next.addDictionaryMember("parameters", kept_parameters);
    if (!parameter_ids.empty() && !manifest.getDictItem("groups").isNull()) {
        auto groups = JSON::makeArray();
        for (const auto& original_group : array(manifest.getDictItem("groups"))) {
            auto ids = JSON::makeArray();
            for (const auto& id : array(original_group.getDictItem("parameters")))
                if (parameter_ids.contains(text(id)))
                    ids.addArrayElement(id);
            if (!empty_array(ids)) {
                auto group = copy_object(original_group);
                group.addDictionaryMember("parameters", ids);
                groups.addArrayElement(group);
            }
        }
        next.addDictionaryMember("groups", groups);
    }
    if (!parameter_ids.empty() && !manifest.getDictItem("profileSets").isNull()) {
        std::map<std::string, std::string> identities;
        for (const auto& id : parameter_ids)
            identities.emplace(id, id);
        next.addDictionaryMember("profileSets", mapped_profiles(manifest.getDictItem("profileSets"), identities));
    }
    return next;
}
std::optional<std::string> Engine::extract(JSON request)
{
    std::vector<JSON> items;
    try {
        items = array(request);
        require(!items.empty(), "Select at least one page.");
        require(items.size() <= pages.size(), "Selection exceeds the input page count.");
    } catch (const Error& error) {
        throw Error("invalid-request", error.what(), "request", "");
    }
    std::map<std::size_t, std::size_t> indexes;
    std::vector<std::size_t> selected;
    for (std::size_t i = 0; i < items.size(); ++i) {
        try {
            auto index = number(items[i]);
            require(index >= 0 && index < static_cast<double>(pages.size()) && std::floor(index) == index,
                "Page index must be an integer within the input PDF.");
            auto page = static_cast<std::size_t>(index);
            require(indexes.emplace(page, i).second, "Duplicate page index.");
            selected.push_back(page);
        } catch (const Error& error) {
            throw Error("invalid-request", error.what(), "request", "/" + std::to_string(i));
        }
    }
    if (selected.size() == pages.size() && std::is_sorted(selected.begin(), selected.end()))
        return std::nullopt;
    auto next = empty_object(manifest) ? JSON::makeDictionary() : retained(indexes);
    QPDFPageDocumentHelper page_tree(document);
    page_tree.pushInheritedAttributesToPage();
    QPDFPageLabelDocumentHelper labels(document);
    std::vector<Object> new_labels;
    if (labels.hasPageLabels())
        for (std::size_t i = 0; i < selected.size(); ++i)
            labels.getLabelsForPageRange(static_cast<long long>(selected[i]), static_cast<long long>(selected[i]),
                static_cast<long long>(i), new_labels);
    QPDFAcroFormDocumentHelper forms(document);
    std::set<QPDFObjGen> widgets;
    for (const auto& index : selected)
        for (const auto& widget : forms.getWidgetAnnotationsForPage(pages.at(index)))
            widgets.insert(widget.getObjectHandle().getObjGen());
    for (const auto& page : pages)
        page_tree.removePage(page);
    for (const auto& index : selected)
        page_tree.addPage(pages.at(index), false);
    for (std::size_t i = 0; i < pages.size(); ++i)
        if (!indexes.contains(i))
            document.replaceObject(pages.at(i).getObjectHandle().getObjGen(), Object::newNull());
    auto root = document.getRoot();
    if (!new_labels.empty())
        root.replaceKey("/PageLabels", Object::newDictionary({{"/Nums", Object::newArray(new_labels)}}));
    if (auto acro = root.getKeyIfDict("/AcroForm"); acro.isDictionary()) {
        std::set<QPDFObjGen> fields;
        auto retain_field = [&](auto&& self, Object field, std::size_t depth) -> bool {
            require(depth <= 32 && ++budget.visits <= 65536, "Field traversal exceeds limit.", "limit-exceeded");
            if (!field.isDictionary())
                return false;
            auto kids = field.getKey("/Kids");
            if (kids.isArray()) {
                std::vector<Object> kept;
                for (int i = 0, n = kids.getArrayNItems(); i < n; ++i)
                    if (auto child = kids.getArrayItem(i); self(self, child, depth + 1))
                        kept.push_back(child);
                if (kept.empty())
                    return false;
                field.replaceKey("/Kids", Object::newArray(kept));
            } else if (!widgets.contains(field.getObjGen()))
                return false;
            fields.insert(field.getObjGen());
            return true;
        };
        std::vector<Object> kept_fields;
        if (auto field_list = acro.getKey("/Fields"); field_list.isArray())
            for (int i = 0, n = field_list.getArrayNItems(); i < n; ++i)
                if (auto field = field_list.getArrayItem(i); retain_field(retain_field, field, 0))
                    kept_fields.push_back(field);
        if (kept_fields.empty())
            root.removeKey("/AcroForm");
        else {
            acro.replaceKey("/Fields", Object::newArray(kept_fields));
            auto order = acro.getKey("/CO");
            if (order.isArray()) {
                const auto count = static_cast<std::size_t>(order.getArrayNItems());
                require(count <= 65536 - budget.visits, "Field traversal exceeds limit.", "limit-exceeded");
                budget.visits += count;
                std::vector<Object> kept;
                for (int i = 0, n = order.getArrayNItems(); i < n; ++i)
                    if (auto field = order.getArrayItem(i); fields.contains(field.getObjGen()))
                        kept.push_back(field);
                acro.replaceKey("/CO", Object::newArray(kept));
            }
        }
    }
    if (empty_object(manifest))
        return save(std::nullopt);
    if (!empty_object(next.getDictItem("regions")) || annotated(next.getDictItem("pages")))
        return save(next);
    QPDFEmbeddedFileDocumentHelper files(document);
    if (auto embedded = files.getEmbeddedFile("mainz.json")) {
        auto spec = embedded->getObjectHandle();
        auto associated = root.getKey("/AF");
        if (associated.isArray()) {
            std::vector<Object> kept;
            for (int i = 0, n = associated.getArrayNItems(); i < n; ++i)
                if (auto file = associated.getArrayItem(i); !file.isSameObjectAs(spec))
                    kept.push_back(file);
            if (kept.empty())
                root.removeKey("/AF");
            else
                root.replaceKey("/AF", Object::newArray(kept));
        }
        files.removeEmbeddedFile("mainz.json");
    }
    return save(std::nullopt);
}
std::string Engine::save(std::optional<JSON> next)
{
    prune_previews(document, managed_previews, next ? next->getDictItem("pages") : JSON::makeArray());
    if (next)
        compress(payload, encode(share_records(*next, budget), manifest_limit, budget.remaining), budget);
    Buffer output(pdf_limit, budget.remaining);
    QPDFWriter writer(document);
    writer.setOutputPipeline(&output);
    writer.setDecodeLevel(qpdf_dl_none);
    writer.setDeterministicID(true);
    writer.write();
    require(document.getWarnings().empty(), "PDF output has structural warnings.", "pdf-syntax");
    return std::move(output.bytes);
}

}
