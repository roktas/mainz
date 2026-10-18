#include "engine.hh"
#include "pipeline.hh"
#include <algorithm>
#include <cmath>
#include <exception>
#include <qpdf/QPDFAcroFormDocumentHelper.hh>
#include <qpdf/QPDFEFStreamObjectHelper.hh>
#include <qpdf/QPDFEmbeddedFileDocumentHelper.hh>
#include <qpdf/QPDFFileSpecObjectHelper.hh>
#include <qpdf/QPDFPageDocumentHelper.hh>
#include <qpdf/QPDFPageLabelDocumentHelper.hh>
#include <qpdf/QPDFWriter.hh>
#include <utility>

namespace mainz::detail {
std::string decode(Object stream, Budget& budget, std::size_t limit)
{
    Buffer output(limit, budget.remaining);
    bool decoded = stream.isStream() && stream.pipeStreamData(&output, nullptr, 0, qpdf_dl_generalized);
    // QPDF converts pipeline exceptions into a failed decode. Preserve the original limit/allocation error.
    if (output.failure)
        std::rethrow_exception(output.failure);
    require(decoded, "Cannot decode PDF stream.", "pdf-syntax");
    return std::move(output.bytes);
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
        if (array(members).empty())
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
// Baseline identities remain local to each region; only locator syntax is shared.
JSON share_records(JSON root)
{
    auto result = JSON::makeDictionary();
    for (const auto& [key, value] : object(root))
        if (key != "regions" && key != "recordSets")
            result.addDictionaryMember(key, value);
    auto regions = JSON::makeDictionary(), sets = JSON::makeDictionary();
    std::map<std::string, std::string> known;
    std::size_t template_bytes = 0;
    for (const auto& [id, region] : object(root.getDictItem("regions"))) {
        std::map<std::string, std::string> slots;
        auto records = JSON::makeArray(), refs = JSON::makeDictionary();
        for (const auto& record : locators(root, region)) {
            auto baseline = baseline_ref(region, record);
            auto [slot, fresh] = slots.try_emplace(baseline, "b" + std::to_string(slots.size()));
            if (fresh)
                refs.addDictionaryMember(slot->second, JSON::makeString(baseline));
            auto locator = copy_object(record);
            locator.addDictionaryMember("baseline", JSON::makeString(slot->second));
            records.addArrayElement(locator);
        }
        auto encoded = encode(records, manifest_limit);
        auto found = known.find(encoded);
        std::string set_id;
        if (found == known.end()) {
            require(encoded.size() <= manifest_limit - template_bytes, "Record sets exceed 8 MiB.", "limit-exceeded");
            template_bytes += encoded.size();
            set_id = "r" + std::to_string(known.size());
            known.emplace(std::move(encoded), set_id);
            sets.addDictionaryMember(set_id, records);
        } else
            set_id = found->second;
        regions.addDictionaryMember(id,
            dictionary({{"page", region.getDictItem("page")}, {"marker", region.getDictItem("marker")},
                {"recordSet", JSON::makeString(set_id)}, {"baselineRefs", refs}}));
    }
    result.addDictionaryMember("regions", regions);
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
        for (int i = 0; i < entries.getArrayNItems(); i += 2) {
            auto key = entries.getArrayItem(i);
            require(key.isString(), "Invalid attachment name.");
            auto filename = key.getUTF8Value();
            require(names.insert(filename).second, "Duplicate attachment name.");
            auto spec = entries.getArrayItem(i + 1);
            require(spec.isDictionary(), "Invalid attachment Filespec.");
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
        for (const auto& kid : kids.getArrayAsVector())
            attachments(kid, seen, names, found, depth + 1);
    }
}
Engine::Engine(const std::string& input, Budget* shared_budget, bool validated, const Index* previous)
    : budget(shared_budget ? *shared_budget : owned_budget)
    , index(previous ? *previous : Index {})
{
    require(input.size() <= pdf_limit, "Input PDF exceeds 128 MiB.", "limit-exceeded");
    document.setSuppressWarnings(true);
    document.setAttemptRecovery(false);
    document.processMemoryFile("Mainz input", input.data(), input.size());
    require(!document.isEncrypted(), "Encrypted PDFs are unsupported.", "unsupported-context");
    for (const auto& item : document.getAllObjects()) {
        if (item.isDictionary())
            require(!item.getKey("/Type").isNameAndEquals("/Sig") && !item.getKey("/FT").isNameAndEquals("/Sig")
                    && !item.hasKey("/ByteRange"),
                "Signed PDFs are unsupported.", "unsupported-context");
    }
    require(document.getRoot().getKey("/Perms").isNull(), "Certification and usage-rights signatures are unsupported.",
        "unsupported-context");
    pages = QPDFPageDocumentHelper(document).getAllPages();
    require(!pages.empty(), "PDF has no pages.", "pdf-syntax");
    require(pages.size() <= page_limit, "Pages exceed 10000.", "limit-exceeded");
    std::set<QPDFObjGen> nodes;
    std::set<std::string> names;
    std::vector<Object> found;
    auto catalog_names = document.getRoot().getKey("/Names");
    require(catalog_names.isNull() || catalog_names.isDictionary(), "Invalid catalog Names dictionary.", "pdf-syntax");
    auto embedded = catalog_names.getKeyIfDict("/EmbeddedFiles");
    if (!embedded.isNull())
        attachments(embedded, nodes, names, found, 0);
    if (found.empty()) {
        require(document.getWarnings().empty(), "PDF contains structural warnings.", "pdf-syntax");
        return;
    }
    require(found.size() == 1, "Multiple Mainz manifest declarations.");
    auto spec = found.front();
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
    // Document operations reuse the JSON profile validation for their exact immutable input.
    manifest = validated ? JSON::parse(encoded) : parse(encoded, "manifest");
    try {
        if (!validated)
            detail::manifest(manifest, pages.size());
    } catch (const Error& error) {
        if (!error.source().empty())
            throw;
        throw Error(error.code(), error.what(), "manifest", "");
    }
    parameters = object(manifest.getDictItem("parameters"));
    for (const auto& [id, parameter] : parameters) {
        auto binding = parameter.getDictItem("binding");
        auto property = text(binding.getDictItem("property"));
        for (const auto& target : array(binding.getDictItem("targets"))) {
            bindings[text(target)][property] = id;
            if (object(parameter).contains("value"))
                choices[text(target)][property] = parameter.getDictItem("value");
        }
    }
    auto regions = object(manifest.getDictItem("regions"));
    std::map<std::string, std::pair<std::size_t, JSON>> baselines;
    for (const auto& [id, baseline] : object(manifest.getDictItem("baselines")))
        baselines.emplace(id, std::make_pair(baselines.size(), baseline));
    original_choices = choices;
    auto consume_locator = [&](std::size_t n) {
        require(n <= budget.locator_remaining, "Cumulative locator text exceeds 128 MiB.", "limit-exceeded");
        budget.locator_remaining -= n;
    };
    for (const auto& [target, region_ids] : object(manifest.getDictItem("targets")))
        for (const auto& region_id : array(region_ids)) {
            auto id = text(region_id);
            const auto& region = regions.at(id);
            auto page = text(region.getDictItem("page"));
            auto marker = text(region.getDictItem("marker"));
            auto page_key = std::make_pair(page, marker);
            require(page_markers.emplace(page_key, id).second, "Ambiguous page region marker.");
            regions_found[id] = 0;
            for (const auto& locator : locators(manifest, region)) {
                auto baseline_id = baseline_ref(region, locator);
                auto paint_marker = text(locator.getDictItem("marker"));
                auto fill = text(locator.getDictItem("fill"));
                consume_locator(
                    id.size() + page.size() + target.size() + paint_marker.size() + fill.size() + baseline_id.size());
                const auto& [baseline_key, original] = baselines.at(baseline_id);
                Record record {id, page, target, std::move(paint_marker), std::move(fill), baseline_key, {}, locator,
                    original, 1, 1, 0};
                for (const auto& step : array(locator.getDictItem("path"))) {
                    auto resource = text(step.getDictItem("resource"));
                    consume_locator(resource.size());
                    record.path.push_back(
                        {std::move(resource), static_cast<std::size_t>(number(step.getDictItem("occurrence")))});
                }
                auto paint = text(record.baseline.getDictItem("paint"));
                if (record.fill == "latent")
                    latent_pages.insert(page);
                for (const auto& [property, parameter_id] : bindings.at(target)) {
                    bool eligible = property == "display"
                        || (property.starts_with("stroke-") ? paint != "f" && paint != "f*" : record.fill != "none");
                    if (eligible) {
                        parameter_records[parameter_id].push_back(records.size());
                    }
                }
                require(record_index.emplace(std::make_tuple(id, record.path, record.marker), records.size()).second,
                    "Ambiguous paint marker.");
                region_records[id].push_back(records.size());
                records.push_back(std::move(record));
            }
        }
    // Only Document operations pass validated=true, for the exact immutable bytes accepted by read().
    // Editing checks changed occurrences; callers fully validate the serialized output.
    if (!validated) {
        traverse(false);
        for (const auto& [id, parameter] : parameters) {
            if (object(parameter.getDictItem("schema")).contains("default")) {
                auto result = summary(id, parameter);
                require(text(result.getDictItem("kind")) == "uniform"
                        && equal(result.getDictItem("value"), parameter.getDictItem("schema").getDictItem("default")),
                    "Schema default disagrees with baseline.");
            }
        }
    }
    require(document.getWarnings().empty(), "PDF contains structural warnings.", "pdf-syntax");
}

static std::string label(Object record)
{
    auto prefix = record.getKey("/P");
    std::string result = prefix.isString() ? prefix.getUTF8Value() : "";
    auto style = record.getKey("/S");
    auto start = record.getKey("/St");
    auto n = start.isInteger() ? start.getIntValue() : 1;
    require(n > 0 && n <= 1000000, "Page-label number exceeds limit.", "limit-exceeded");
    if (style.isNameAndEquals("/D"))
        return result + std::to_string(n);
    if (style.isNameAndEquals("/A") || style.isNameAndEquals("/a"))
        return result
            + std::string(static_cast<std::size_t>((n - 1) / 26 + 1),
                static_cast<char>((style.isNameAndEquals("/A") ? 'A' : 'a') + (n - 1) % 26));
    if (style.isNameAndEquals("/R") || style.isNameAndEquals("/r")) {
        const auto prefix_size = result.size();
        for (const auto& [amount, digits] :
            std::vector<std::pair<int, std::string>> {{1000, "M"}, {900, "CM"}, {500, "D"}, {400, "CD"}, {100, "C"},
                {90, "XC"}, {50, "L"}, {40, "XL"}, {10, "X"}, {9, "IX"}, {5, "V"}, {4, "IV"}, {1, "I"}})
            while (n >= amount) {
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
    if (parameters.empty())
        return dictionary(
            {{"version", JSON::makeInt(1)}, {"pageCount", JSON::makeInt(static_cast<long long>(pages.size()))},
                {"pages", JSON::makeDictionary()}, {"parameters", JSON::makeDictionary()}})
            .unparse();
    auto described_pages = JSON::makeDictionary();
    QPDFPageLabelDocumentHelper labels(document);
    for (const auto& [id, index] : object(manifest.getDictItem("pages"))) {
        auto page = dictionary({{"index", index}});
        if (labels.hasPageLabels())
            page.addDictionaryMember(
                "label", JSON::makeString(label(labels.getLabelForPage(static_cast<long long>(number(index))))));
        described_pages.addDictionaryMember(id, page);
    }
    auto described_parameters = JSON::makeDictionary();
    for (const auto& [id, parameter] : parameters) {
        std::map<double, std::string> affected;
        for (const auto& index : parameter_records.at(id)) {
            const auto& record = records.at(index);
            affected[number(member(manifest.getDictItem("pages"), record.page))] = record.page;
        }
        auto ids = JSON::makeArray();
        for (const auto& [index, page] : affected) {
            (void)index;
            ids.addArrayElement(JSON::makeString(page));
        }
        described_parameters.addDictionaryMember(
            id, dictionary({{"parameter", parameter}, {"baseline", summary(id, parameter)}, {"pages", ids}}));
    }
    auto result
        = dictionary({{"version", JSON::makeInt(1)}, {"pageCount", JSON::makeInt(static_cast<long long>(pages.size()))},
            {"pages", described_pages}, {"parameters", described_parameters}});
    for (const auto& field : {"groups", "profileSets"})
        if (object(manifest).contains(field))
            result.addDictionaryMember(field, manifest.getDictItem(field));
    return encode(result, json_limit, budget.remaining);
}
JSON Engine::retained(const std::map<std::size_t, std::size_t>& indexes)
{
    auto next = manifest;
    auto kept_pages = JSON::makeDictionary();
    std::set<std::string> page_ids, region_ids, baseline_ids, target_ids, parameter_ids;
    for (const auto& [id, index] : object(manifest.getDictItem("pages"))) {
        auto old_index = static_cast<std::size_t>(number(index));
        if (indexes.contains(old_index)) {
            kept_pages.addDictionaryMember(id, JSON::makeInt(static_cast<long long>(indexes.at(old_index))));
            page_ids.insert(id);
        }
    }
    auto kept_parameters = JSON::makeDictionary();
    for (auto [id, parameter] : parameters) {
        std::set<std::string> eligible;
        for (const auto& index : parameter_records.at(id))
            if (page_ids.contains(records.at(index).page))
                eligible.insert(records.at(index).target);
        auto binding = parameter.getDictItem("binding");
        auto targets = JSON::makeArray();
        for (const auto& target : array(binding.getDictItem("targets")))
            if (eligible.contains(text(target))) {
                targets.addArrayElement(target);
                target_ids.insert(text(target));
            }
        if (array(targets).empty())
            continue;
        binding.addDictionaryMember("targets", targets);
        parameter.addDictionaryMember("binding", binding);
        kept_parameters.addDictionaryMember(id, parameter);
        parameter_ids.insert(id);
    }
    auto kept_targets = JSON::makeDictionary();
    for (const auto& [id, regions] : object(manifest.getDictItem("targets"))) {
        if (!target_ids.contains(id))
            continue;
        auto kept = JSON::makeArray();
        for (const auto& region : array(regions))
            if (page_ids.contains(text(member(manifest.getDictItem("regions"), text(region)).getDictItem("page")))) {
                kept.addArrayElement(region);
                region_ids.insert(text(region));
            }
        kept_targets.addDictionaryMember(id, kept);
    }
    auto kept_regions = JSON::makeDictionary();
    for (const auto& [id, region] : object(manifest.getDictItem("regions"))) {
        if (!region_ids.contains(id))
            continue;
        kept_regions.addDictionaryMember(id, region);
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
    if (object(next).contains("groups")) {
        auto groups = JSON::makeArray();
        for (auto group : array(next.getDictItem("groups"))) {
            auto ids = JSON::makeArray();
            for (const auto& id : array(group.getDictItem("parameters")))
                if (parameter_ids.contains(text(id)))
                    ids.addArrayElement(id);
            if (!array(ids).empty()) {
                group.addDictionaryMember("parameters", ids);
                groups.addArrayElement(group);
            }
        }
        next.addDictionaryMember("groups", groups);
    }
    if (object(manifest).contains("profileSets")) {
        std::map<std::string, std::string> identities;
        for (const auto& id : parameter_ids)
            identities.emplace(id, id);
        next.addDictionaryMember("profileSets", mapped_profiles(manifest.getDictItem("profileSets"), identities));
    }
    return next;
}
std::string Engine::extract(JSON request, const std::string& input)
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
        return input;
    auto next = parameters.empty() ? JSON::makeDictionary() : retained(indexes);
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
    if (forms.hasAcroForm()) {
        std::set<QPDFObjGen> fields;
        auto retain_field = [&](auto&& self, Object field, std::size_t depth) -> bool {
            require(depth <= 32 && ++budget.visits <= 65536, "Field traversal exceeds limit.", "limit-exceeded");
            auto kids = field.getKey("/Kids");
            if (kids.isArray()) {
                std::vector<Object> kept;
                for (const auto& child : kids.getArrayAsVector())
                    if (self(self, child, depth + 1))
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
        for (const auto& field : root.getKey("/AcroForm").getKey("/Fields").getArrayAsVector())
            if (retain_field(retain_field, field, 0))
                kept_fields.push_back(field);
        if (kept_fields.empty())
            root.removeKey("/AcroForm");
        else {
            auto form = root.getKey("/AcroForm");
            form.replaceKey("/Fields", Object::newArray(kept_fields));
            auto order = form.getKey("/CO");
            if (order.isArray()) {
                const auto count = static_cast<std::size_t>(order.getArrayNItems());
                require(count <= 65536 - budget.visits, "Field traversal exceeds limit.", "limit-exceeded");
                budget.visits += count;
                std::vector<Object> kept;
                for (const auto& field : order.getArrayAsVector())
                    if (fields.contains(field.getObjGen()))
                        kept.push_back(field);
                form.replaceKey("/CO", Object::newArray(kept));
            }
        }
    }
    if (parameters.empty())
        return save(std::nullopt);
    if (!object(next.getDictItem("regions")).empty())
        return save(next);
    QPDFEmbeddedFileDocumentHelper files(document);
    auto spec = files.getEmbeddedFile("mainz.json")->getObjectHandle();
    auto associated = root.getKey("/AF");
    if (associated.isArray()) {
        std::vector<Object> kept;
        for (const auto& file : associated.getArrayAsVector())
            if (!file.isSameObjectAs(spec))
                kept.push_back(file);
        if (kept.empty())
            root.removeKey("/AF");
        else
            root.replaceKey("/AF", Object::newArray(kept));
    }
    files.removeEmbeddedFile("mainz.json");
    return save(std::nullopt);
}
std::string Engine::save(std::optional<JSON> next)
{
    if (next)
        payload.replaceStreamData(
            encode(share_records(*next), manifest_limit, budget.remaining), Object::newNull(), Object::newNull());
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
