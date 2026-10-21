#include "engine.hh"
#include "pipeline.hh"
#include <algorithm>
#include <cmath>
#include <new>
#include <qpdf/QPDFAcroFormDocumentHelper.hh>
#include <qpdf/QPDFEFStreamObjectHelper.hh>
#include <qpdf/QPDFEmbeddedFileDocumentHelper.hh>
#include <qpdf/QPDFFileSpecObjectHelper.hh>
#include <qpdf/QPDFNameTreeObjectHelper.hh>
#include <qpdf/QPDFPageDocumentHelper.hh>
#include <qpdf/QPDFPageLabelDocumentHelper.hh>
#include <qpdf/QPDFWriter.hh>
#include <utility>

namespace mainz::detail {
static Object destination(Object value, QPDF& document)
{
    if (value.isName() || value.isString()) {
        auto name = value.isName() ? value.getName().substr(1) : value.getUTF8Value();
        auto found = document.getRoot().getKey("/Dests").getKey("/" + name);
        auto tree = document.getRoot().getKey("/Names").getKey("/Dests");
        if (found.isNull() && tree.isDictionary())
            QPDFNameTreeObjectHelper(tree, document, false).findObject(name, found);
        value = found.isDictionary() ? found.getKey("/D") : found;
    }
    return value;
}
struct JobSource {
    // QPDF borrows its memory input; destroy the engine before its bytes.
    std::string bytes;
    std::unique_ptr<Engine> engine;
    JSON manifest = JSON::makeDictionary();
    std::set<std::size_t> pages;
    std::map<std::size_t, std::vector<std::pair<std::string, JSON>>> regions;
    std::map<std::string, std::string> targets;
    std::string prefix;
    std::string input;
};
struct JobPage {
    std::string source;
    std::size_t page {0}, part {0}, copy {0};
    double width {0}, height {0};
    bool padding {false};
};
Composition Engine::compose(JSON job, const std::map<std::string, std::string>& inputs)
{
    Budget budget;
    request_at("", [&] {
        fields(job, {"version", "sources", "parts"});
        require(number(job.getDictItem("version")) == 1, "Unsupported Job version.", "unsupported-version");
    });
    auto definitions = request_at("/sources", [&] { return object(job.getDictItem("sources")); });
    require(inputs.size() <= input_limit && definitions.size() <= input_limit, "Inputs or Sources exceed 32.",
        "limit-exceeded");
    std::size_t aggregate {0};
    for (const auto& [id, bytes] : inputs) {
        identifier(id, "invalid-request");
        require(bytes.size() <= pdf_limit - aggregate, "Aggregate Inputs exceed 128 MiB.", "limit-exceeded");
        aggregate += bytes.size();
    }
    std::map<std::string, JobSource> sources;
    std::set<std::string> used_inputs, used_sources;
    std::size_t source_bytes {0};
    for (const auto& [id, definition] : definitions) {
        auto location = "/sources/" + pointer(id);
        auto input = request_at(location, [&] {
            identifier(id, "invalid-request");
            fields(definition, {"input", "overrides"});
            auto key = text(definition.getDictItem("input"));
            identifier(key, "invalid-request");
            require(inputs.contains(key), "Missing Input binding.");
            object(definition.getDictItem("overrides"));
            return key;
        });
        used_inputs.insert(input);
        auto& source = sources[id];
        source.input = input;
        source.prefix = "s" + std::to_string(sources.size() - 1) + ":";
        source.bytes = inputs.at(input);
        try {
            source.engine = std::make_unique<Engine>(source.bytes, &budget);
        } catch (const Error& error) {
            throw Error(error.code(), error.what(), "request", location + "/input");
        }
        auto& original = *source.engine;
        auto overrides = definition.getDictItem("overrides");
        auto current = object(original.manifest).empty() ? std::map<std::string, JSON> {} : original.parameters;
        auto requested = object(overrides);
        for (const auto& entry : requested)
            request_at(location + "/overrides/" + pointer(entry.first), [&] {
                require(current.contains(entry.first), "Unknown Source parameter.");
                const auto& record = current.at(entry.first);
                value(entry.second, record.getDictItem("schema"),
                    text(record.getDictItem("binding").getDictItem("property")));
            });
        bool changed = false;
        for (const auto& [parameter, record] : current) {
            bool saved = object(record).contains("value"), supplied = requested.contains(parameter);
            changed = changed || saved != supplied
                || (saved && supplied && !equal(record.getDictItem("value"), requested.at(parameter)));
        }
        if (changed) {
            auto bytes = [&] {
                auto parameters = JSON::makeDictionary();
                for (const auto& [parameter, record] : current) {
                    auto updated = JSON::makeDictionary();
                    for (const auto& [key, item] : object(record))
                        if (key != "value")
                            updated.addDictionaryMember(key, item);
                    if (requested.contains(parameter))
                        updated.addDictionaryMember("value", member(overrides, parameter));
                    parameters.addDictionaryMember(parameter, updated);
                }
                auto next = copy_object(original.manifest);
                next.addDictionaryMember("parameters", parameters);
                return original.write(next);
            }();
            auto syntax = original.take_index();
            source.engine.reset();
            source.bytes = std::move(bytes);
            source.engine = std::make_unique<Engine>(source.bytes, &budget, false, syntax.get());
        }
        require(source.bytes.size() <= pdf_limit - source_bytes, "Processed Sources exceed 128 MiB.", "limit-exceeded");
        source_bytes += source.bytes.size();
        QPDFPageDocumentHelper(source.engine->document).pushInheritedAttributesToPage();
        for (auto item : source.engine->document.getAllObjects()) {
            require(++budget.visits <= 65536, "Job traversal exceeds 65536 visits.", "limit-exceeded");
            if (!item.isDictionary())
                continue;
            if (item.hasKey("/Dest"))
                item.replaceKey("/Dest", destination(item.getKey("/Dest"), source.engine->document));
            if (item.getKey("/S").isNameAndEquals("/GoTo"))
                item.replaceKey("/D", destination(item.getKey("/D"), source.engine->document));
        }
    }
    if (used_inputs.size() != inputs.size())
        throw Error("invalid-request", "Unused Input binding.", "request", "/sources");
    auto parts = request_at("/parts", [&] {
        auto result = array(job.getDictItem("parts"));
        require(!result.empty(), "Job requires at least one Part.");
        return result;
    });
    std::vector<JobPage> expanded;
    auto append = [&](JobPage page) {
        require(expanded.size() < page_limit, "Expanded pages exceed 10000.", "limit-exceeded");
        expanded.push_back(std::move(page));
    };
    for (std::size_t part_index = 0; part_index < parts.size(); ++part_index) {
        auto location = "/parts/" + std::to_string(part_index);
        auto part = parts[part_index];
        std::size_t copies {1};
        bool front {false};
        auto sequence = request_at(location, [&] {
            auto present = fields(part, {"pages"}, {"copies", "front"});
            if (present.contains("copies")) {
                auto count = number(part.getDictItem("copies"));
                require(count >= 1 && count <= 1000 && std::floor(count) == count,
                    "Copies must be an integer from 1 to 1000.");
                copies = static_cast<std::size_t>(count);
            }
            if (present.contains("front"))
                require(part.getDictItem("front").getBool(front), "Front must be Boolean.");
            auto items = array(part.getDictItem("pages"));
            require(!items.empty(), "Part requires at least one page.");
            require(items.size() <= page_limit / copies, "Repeated pages exceed 10000.", "limit-exceeded");
            return items;
        });
        std::vector<JobPage> pages;
        for (std::size_t i = 0; i < sequence.size(); ++i) {
            auto page = request_at(location + "/pages/" + std::to_string(i), [&] {
                const auto& item = sequence[i];
                JobPage result;
                result.part = part_index;
                if (object(item).contains("blank")) {
                    fields(item, {"blank"});
                    auto blank = item.getDictItem("blank");
                    fields(blank, {"width", "height"});
                    result.width = number(blank.getDictItem("width"));
                    result.height = number(blank.getDictItem("height"));
                    require(result.width > 0 && result.height > 0 && result.width <= 1e6 && result.height <= 1e6,
                        "Blank dimensions must be positive and at most 1000000 mm.");
                } else {
                    fields(item, {"source", "page"});
                    result.source = text(item.getDictItem("source"));
                    require(sources.contains(result.source), "Missing Source reference.");
                    auto& source = *sources.at(result.source).engine;
                    auto index = number(item.getDictItem("page"));
                    require(
                        index >= 0 && index < static_cast<double>(source.pages.size()) && std::floor(index) == index,
                        "Page index must be an integer within the Input.");
                    result.page = static_cast<std::size_t>(index);
                    auto page = source.pages.at(result.page);
                    auto box = page.getMediaBox().getArrayAsRectangle();
                    auto crop = page.getCropBox().getArrayAsRectangle();
                    auto left = std::max(box.llx, crop.llx), bottom = std::max(box.lly, crop.lly);
                    auto right = std::min(box.urx, crop.urx), top = std::min(box.ury, crop.ury);
                    if (right > left && top > bottom)
                        box = {left, bottom, right, top};
                    auto unit = page.getObjectHandle().getKey("/UserUnit");
                    auto scale = unit.isNull() ? 1 : unit.getNumericValue();
                    result.width = (box.urx - box.llx) * scale * 25.4 / 72;
                    result.height = (box.ury - box.lly) * scale * 25.4 / 72;
                    auto rotation = page.getAttribute("/Rotate", false);
                    if (rotation.isInteger() && rotation.getIntValue() % 90 == 0 && rotation.getIntValue() % 180 != 0)
                        std::swap(result.width, result.height);
                    require(std::isfinite(result.width) && std::isfinite(result.height) && result.width > 0
                            && result.height > 0 && result.width <= 1e6 && result.height <= 1e6,
                        "Page dimensions exceed composition limits.", "unsupported-context");
                    used_sources.insert(result.source);
                }
                return result;
            });
            pages.push_back(std::move(page));
        }
        for (std::size_t copy = 0; copy < copies; ++copy) {
            if (front && expanded.size() % 2) {
                auto padding = expanded.back();
                padding.source.clear();
                padding.part = part_index;
                padding.copy = copy;
                padding.padding = true;
                append(padding);
            }
            for (auto page : pages) {
                page.copy = copy;
                append(std::move(page));
            }
            if (front && pages.size() % 2) {
                auto padding = expanded.back();
                padding.source.clear();
                padding.padding = true;
                append(padding);
            }
        }
    }
    if (used_sources.size() != sources.size())
        throw Error("invalid-request", "Unused Source definition.", "request", "/sources");
    auto next = dictionary({{"version", JSON::makeInt(1)}});
    for (const auto& key : {"pages", "regions", "baselines", "targets", "parameters"})
        next.addDictionaryMember(key, JSON::makeDictionary());
    auto groups = JSON::makeArray();
    auto profile_sets = JSON::makeArray();
    auto provenance = JSON::makeArray();
    auto parameter_map = JSON::makeDictionary();
    for (auto& [id, source] : sources) {
        if (object(source.engine->manifest).empty())
            continue;
        std::map<std::size_t, std::size_t> selected;
        for (const auto& page : expanded)
            if (page.source == id)
                selected.emplace(page.page, page.page);
        source.manifest = source.engine->retained(selected);
        auto authored_pages = object(source.manifest.getDictItem("pages"));
        for (const auto& [id, physical] : authored_pages) {
            (void)id;
            source.pages.insert(static_cast<std::size_t>(number(physical)));
        }
        for (const auto& [id, region] : object(source.manifest.getDictItem("regions"))) {
            auto physical = authored_pages.at(text(region.getDictItem("page")));
            source.regions[static_cast<std::size_t>(number(physical))].emplace_back(id, region);
        }
        for (const auto& [baseline, record] : object(source.manifest.getDictItem("baselines")))
            next.getDictItem("baselines").addDictionaryMember(source.prefix + baseline, record);
        for (const auto& [target, regions] : object(source.manifest.getDictItem("targets"))) {
            for (const auto& region : array(regions))
                source.targets.emplace(text(region), target);
            next.getDictItem("targets").addDictionaryMember(source.prefix + target, JSON::makeArray());
        }
        for (const auto& [parameter, record] : object(source.manifest.getDictItem("parameters"))) {
            auto updated = copy_object(record);
            auto binding = copy_object(record.getDictItem("binding"));
            auto targets = JSON::makeArray();
            for (const auto& target : array(binding.getDictItem("targets")))
                targets.addArrayElement(JSON::makeString(source.prefix + text(target)));
            binding.addDictionaryMember("targets", targets);
            updated.addDictionaryMember("binding", binding);
            next.getDictItem("parameters").addDictionaryMember(source.prefix + parameter, updated);
            parameter_map.addDictionaryMember(source.prefix + parameter,
                dictionary({{"source", JSON::makeString(id)}, {"parameter", JSON::makeString(parameter)}}));
        }
        if (object(source.manifest).contains("profileSets")) {
            std::map<std::string, std::string> identities;
            for (const auto& [parameter, record] : object(source.manifest.getDictItem("parameters"))) {
                (void)record;
                identities.emplace(parameter, source.prefix + parameter);
            }
            for (const auto& set :
                array(mapped_profiles(source.manifest.getDictItem("profileSets"), identities, source.prefix)))
                profile_sets.addArrayElement(set);
        }
        if (object(source.manifest).contains("groups"))
            for (const auto& group : array(source.manifest.getDictItem("groups"))) {
                auto ids = JSON::makeArray();
                for (const auto& parameter : array(group.getDictItem("parameters")))
                    ids.addArrayElement(JSON::makeString(source.prefix + text(parameter)));
                auto updated = copy_object(group);
                updated.addDictionaryMember("parameters", ids);
                groups.addArrayElement(updated);
            }
    }
    QPDF output;
    output.emptyPDF();
    QPDFPageDocumentHelper tree(output);
    QPDFAcroFormDocumentHelper forms(output);
    QPDFEmbeddedFileDocumentHelper files(output);
    std::set<QPDFObjGen> inserted_pages;
    std::set<std::string> attached_inputs;
    for (auto& [id, source] : sources) {
        (void)id;
        if (!attached_inputs.insert(source.input).second)
            continue;
        QPDFEmbeddedFileDocumentHelper original_files(source.engine->document);
        for (const auto& [name, spec] : original_files.getEmbeddedFiles()) {
            if (name == "mainz.json")
                continue;
            auto key = inputs.size() == 1 ? name : "i" + std::to_string(attached_inputs.size() - 1) + ":" + name;
            files.replaceEmbeddedFile(key, QPDFFileSpecObjectHelper(output.copyForeignObject(spec->getObjectHandle())));
        }
    }
    std::vector<Object> labels;
    for (std::size_t index = 0; index < expanded.size(); ++index) {
        const auto& page = expanded[index];
        auto report = dictionary({{"part", JSON::makeInt(static_cast<long long>(page.part))},
            {"copy", JSON::makeInt(static_cast<long long>(page.copy))}});
        if (page.source.empty()) {
            auto blank = Object::newDictionary({{"/Type", Object::newName("/Page")},
                {"/MediaBox",
                    Object::newArray(
                        {Object::newInteger(0), Object::newInteger(0), Object::newReal(decimal(page.width * 72 / 25.4)),
                            Object::newReal(decimal(page.height * 72 / 25.4))})},
                {"/Resources", Object::newDictionary()}});
            tree.addPage(QPDFPageObjectHelper(blank), false);
            report.addDictionaryMember("blank",
                dictionary({{"width", JSON::makeNumber(decimal(page.width))},
                    {"height", JSON::makeNumber(decimal(page.height))}}));
            report.addDictionaryMember("padding", JSON::makeBool(page.padding));
            labels.push_back(Object::newInteger(static_cast<long long>(index)));
            labels.push_back(Object::newDictionary(
                {{"/S", Object::newName("/D")}, {"/St", Object::newInteger(static_cast<long long>(index) + 1)}}));
        } else {
            auto& source = sources.at(page.source);
            auto& engine = *source.engine;
            auto original = engine.pages.at(page.page).getObjectHandle();
            auto copied = output.copyForeignObject(original);
            if (!inserted_pages.insert(copied.getObjGen()).second)
                copied = output.makeIndirectObject(copied.shallowCopy());
            copied.removeKey("/Parent");
            tree.addPage(QPDFPageObjectHelper(copied), false);
            QPDFAcroFormDocumentHelper original_forms(engine.document);
            forms.fixCopiedAnnotations(copied, original, original_forms);
            QPDFPageLabelDocumentHelper source_labels(engine.document);
            if (source_labels.hasPageLabels())
                source_labels.getLabelsForPageRange(static_cast<long long>(page.page),
                    static_cast<long long>(page.page), static_cast<long long>(index), labels);
            else {
                labels.push_back(Object::newInteger(static_cast<long long>(index)));
                labels.push_back(Object::newDictionary(
                    {{"/S", Object::newName("/D")}, {"/St", Object::newInteger(static_cast<long long>(index) + 1)}}));
            }
            report.addDictionaryMember("source", JSON::makeString(page.source));
            report.addDictionaryMember("page", JSON::makeInt(static_cast<long long>(page.page)));
            if (!object(source.manifest).empty()) {
                auto page_id = "p" + std::to_string(index);
                if (source.pages.contains(page.page))
                    next.getDictItem("pages").addDictionaryMember(
                        page_id, JSON::makeInt(static_cast<long long>(index)));
                for (const auto& [id, region] : source.regions[page.page]) {
                    auto region_id = page_id + ":";
                    region_id += id;
                    auto locators_copy = JSON::makeArray(), refs = JSON::makeDictionary();
                    for (const auto& record : locators(source.manifest, region)) {
                        locators_copy.addArrayElement(record);
                        refs.addDictionaryMember(text(record.getDictItem("baseline")),
                            JSON::makeString(source.prefix + baseline_ref(region, record)));
                    }
                    auto updated = dictionary({{"page", region.getDictItem("page")},
                        {"marker", region.getDictItem("marker")}, {"records", locators_copy}, {"baselineRefs", refs}});
                    updated.addDictionaryMember("page", JSON::makeString(page_id));
                    next.getDictItem("regions").addDictionaryMember(region_id, updated);
                    member(next.getDictItem("targets"), source.prefix + source.targets.at(id))
                        .addArrayElement(JSON::makeString(region_id));
                }
            }
        }
        provenance.addArrayElement(report);
    }
    if (!labels.empty())
        output.getRoot().replaceKey("/PageLabels", Object::newDictionary({{"/Nums", Object::newArray(labels)}}));
    for (const auto& item : output.getAllObjects()) {
        require(++budget.visits <= 65536, "Job traversal exceeds 65536 visits.", "limit-exceeded");
        if (!item.isDictionary())
            continue;
        auto value = item.hasKey("/Dest")                ? item.getKey("/Dest")
            : item.getKey("/S").isNameAndEquals("/GoTo") ? item.getKey("/D")
                                                         : Object::newNull();
        if (value.isArray() && value.getArrayNItems() > 0) {
            auto page = value.getArrayItem(0);
            if (page.isDictionary() && page.getKey("/Type").isNameAndEquals("/Page")
                && !inserted_pages.contains(page.getObjGen()))
                value.setArrayItem(0, Object::newNull());
        }
    }
    if (!object(next.getDictItem("regions")).empty()) {
        if (!array(groups).empty())
            next.addDictionaryMember("groups", groups);
        if (!array(profile_sets).empty())
            next.addDictionaryMember("profileSets", profile_sets);
        auto stream = output.newStream(encode(share_records(next), manifest_limit, budget.remaining));
        stream.getDict().replaceKey("/Type", Object::newName("/EmbeddedFile"));
        stream.getDict().replaceKey("/Subtype", Object::newName("/application/json"));
        auto spec = QPDFFileSpecObjectHelper::createFileSpec(output, "mainz.json", QPDFEFStreamObjectHelper(stream));
        QPDFEmbeddedFileDocumentHelper(output).replaceEmbeddedFile("mainz.json", spec);
    }
    Buffer saved(pdf_limit, budget.remaining);
    QPDFWriter writer(output);
    writer.setOutputPipeline(&saved);
    writer.setDecodeLevel(qpdf_dl_none);
    writer.setDeterministicID(true);
    writer.write();
    require(output.getWarnings().empty(), "Composed PDF has structural warnings.", "pdf-syntax");
    auto syntax = sources.empty() ? std::shared_ptr<const Index> {} : sources.begin()->second.engine->take_index();
    next = JSON::makeNull();
    groups = JSON::makeNull();
    profile_sets = JSON::makeNull();
    for (auto& [id, source] : sources) {
        (void)id;
        source.manifest = JSON::makeNull();
        source.regions.clear();
        source.targets.clear();
        source.pages.clear();
        source.engine.reset();
    }
    Engine reopened(saved.bytes, &budget, false, syntax.get());
    auto description = reopened.describe();
    auto report
        = encode(dictionary({{"version", JSON::makeInt(1)}, {"pages", provenance}, {"parameters", parameter_map}}),
            json_limit, budget.remaining);
    return {Document(std::move(saved.bytes), std::move(description), !object(reopened.manifest).empty(),
                reopened.take_index()),
        std::move(report)};
}
}

namespace mainz {
using namespace detail;
Composition compose(const std::string& job, const std::map<std::string, std::string>& inputs)
{
    try {
        return Engine::compose(parse(job, "request"), inputs);
    } catch (const Error&) {
        throw;
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Composition allocation failed.");
    } catch (const std::exception& error) {
        throw Error("pdf-syntax", error.what());
    }
}
}
