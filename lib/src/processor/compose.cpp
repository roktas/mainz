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
#include <variant>

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
struct PlanSource {
    std::unique_ptr<Engine> engine;
    JSON manifest = JSON::makeDictionary();
    std::map<std::size_t, JSON> pages;
    std::map<std::size_t, std::vector<std::pair<std::string, JSON>>> regions;
    std::map<std::string, std::string> targets;
    std::string prefix;
    std::string input;
};
struct SourcePage {
    std::string source;
    std::size_t page;
};
struct BlankPage {
    bool padding {false};
};
struct PlanPage {
    std::variant<SourcePage, BlankPage> content {BlankPage {}};
    std::size_t part {0}, copy {0};
    double width {0}, height {0};
};
Artifact Engine::compose(JSON plan, const Bindings& inputs, const Document* previous)
{
    Budget budget;
    request_at("", [&] {
        fields(plan, {"version", "sources", "parts"});
        require(number(plan.getDictItem("version")) == 1, "Unsupported Plan version.", "unsupported-version");
    });
    auto definitions = request_at("/sources", [&] { return object(plan.getDictItem("sources")); });
    require(inputs.size() <= input_limit && definitions.size() <= input_limit, "Inputs or Sources exceed 32.",
        "limit-exceeded");
    std::size_t aggregate {0};
    for (const auto& [id, binding] : inputs) {
        const auto& bytes = binding.bytes;
        identifier(id, "invalid-request");
        require(bytes.size() <= pdf_limit - aggregate, "Aggregate Inputs exceed 128 MiB.", "limit-exceeded");
        aggregate += bytes.size();
    }
    auto prepare = [&] {
        std::map<std::string, PlanSource> sources;
        std::set<std::string> used_inputs;
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
            try {
                const auto& binding = inputs.at(input);
                const auto* validated = binding.document;
                if (!validated && previous && previous->bytes == binding.bytes)
                    validated = previous;
                source.engine = std::make_unique<Engine>(binding.bytes, &budget, validated != nullptr,
                    validated ? validated->index : std::shared_ptr<const Index> {});
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
                // Validate the completed composition once, after every Source has been assembled.
                original.update(next);
            }
            auto size = inputs.at(input).bytes.size();
            require(size <= pdf_limit - source_bytes, "Processed Sources exceed 128 MiB.", "limit-exceeded");
            source_bytes += size;
            QPDFPageDocumentHelper(source.engine->document).pushInheritedAttributesToPage();
            for (auto item : source.engine->document.getAllObjects()) {
                require(++budget.visits <= 65536, "Plan traversal exceeds 65536 visits.", "limit-exceeded");
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
        return sources;
    };
    auto sources = prepare();
    auto expand = [&] {
        std::set<std::string> used_sources;
        auto parts = request_at("/parts", [&] {
            auto result = array(plan.getDictItem("parts"));
            require(!result.empty(), "Plan requires at least one Part.");
            return result;
        });
        std::vector<PlanPage> expanded;
        auto append = [&](PlanPage page) {
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
            std::vector<PlanPage> pages;
            for (std::size_t i = 0; i < sequence.size(); ++i) {
                auto page = request_at(location + "/pages/" + std::to_string(i), [&] {
                    const auto& item = sequence[i];
                    PlanPage result;
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
                        auto id = text(item.getDictItem("source"));
                        require(sources.contains(id), "Missing Source reference.");
                        auto& source = *sources.at(id).engine;
                        auto index = number(item.getDictItem("page"));
                        require(index >= 0 && index < static_cast<double>(source.pages.size())
                                && std::floor(index) == index,
                            "Page index must be an integer within the Input.");
                        auto physical = static_cast<std::size_t>(index);
                        result.content = SourcePage {id, physical};
                        auto page = source.pages.at(physical);
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
                        if (rotation.isInteger() && rotation.getIntValue() % 90 == 0
                            && rotation.getIntValue() % 180 != 0)
                            std::swap(result.width, result.height);
                        require(std::isfinite(result.width) && std::isfinite(result.height) && result.width > 0
                                && result.height > 0 && result.width <= 1e6 && result.height <= 1e6,
                            "Page dimensions exceed composition limits.", "unsupported-context");
                        used_sources.insert(id);
                    }
                    return result;
                });
                pages.push_back(std::move(page));
            }
            for (std::size_t copy = 0; copy < copies; ++copy) {
                if (front && expanded.size() % 2) {
                    auto padding = expanded.back();
                    padding.content = BlankPage {true};
                    padding.part = part_index;
                    padding.copy = copy;
                    append(padding);
                }
                for (auto page : pages) {
                    page.copy = copy;
                    append(std::move(page));
                }
                if (front && pages.size() % 2) {
                    auto padding = expanded.back();
                    padding.content = BlankPage {true};
                    append(padding);
                }
            }
        }
        if (used_sources.size() != sources.size())
            throw Error("invalid-request", "Unused Source definition.", "request", "/sources");
        return expanded;
    };
    auto expanded = expand();
    auto assemble = [&] {
        auto next = dictionary({{"version", JSON::makeInt(1)}});
        next.addDictionaryMember("pages", JSON::makeArray());
        for (const auto& key : {"regions", "baselines", "targets", "parameters"})
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
                if (auto content = std::get_if<SourcePage>(&page.content); content && content->source == id)
                    selected.emplace(content->page, content->page);
            std::vector<std::size_t> original_pages;
            for (auto& [physical, retained] : selected) {
                retained = original_pages.size();
                original_pages.push_back(physical);
            }
            source.manifest = source.engine->retained(selected);
            auto authored_pages = array(source.manifest.getDictItem("pages"));
            for (const auto& [physical, retained] : selected)
                source.pages.emplace(physical, authored_pages.at(retained));
            for (const auto& [id, region] : object(source.manifest.getDictItem("regions"))) {
                auto retained = static_cast<std::size_t>(number(region.getDictItem("page")));
                source.regions[original_pages.at(retained)].emplace_back(id, region);
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
        std::set<std::string> managed_previews;
        std::map<std::string, std::map<std::string, std::string>> attachment_names;
        std::map<std::string, std::string> attachment_prefixes;
        std::set<std::string> reserved_names;
        for (auto& [id, source] : sources) {
            (void)id;
            if (attachment_prefixes.contains(source.input))
                continue;
            auto prefix = inputs.size() == 1 ? "" : "i" + std::to_string(attachment_prefixes.size()) + ":";
            attachment_prefixes.emplace(source.input, prefix);
            QPDFEmbeddedFileDocumentHelper original_files(source.engine->document);
            for (const auto& [name, spec] : original_files.getEmbeddedFiles()) {
                (void)spec;
                if (name != "mainz.json")
                    reserved_names.insert(prefix + name);
            }
        }
        for (auto& [id, source] : sources) {
            (void)id;
            if (!attached_inputs.insert(source.input).second)
                continue;
            QPDFEmbeddedFileDocumentHelper original_files(source.engine->document);
            for (const auto& [name, spec] : original_files.getEmbeddedFiles()) {
                if (name == "mainz.json")
                    continue;
                auto key = attachment_prefixes.at(source.input) + name;
                auto copied = output.copyForeignObject(spec->getObjectHandle());
                if (source.engine->managed_previews.contains(name)) {
                    if (key.size() > 4096) {
                        std::size_t suffix = 0;
                        do {
                            require(
                                ++budget.visits <= 65536, "Preview attachment names exceed limit.", "limit-exceeded");
                            key = "preview" + std::to_string(suffix++) + ".png";
                        } while (reserved_names.contains(key));
                        reserved_names.insert(key);
                    }
                    copied = output.makeIndirectObject(copied.shallowCopy());
                    copied.replaceKey("/F", Object::newUnicodeString(key));
                    copied.replaceKey("/UF", Object::newUnicodeString(key));
                    managed_previews.insert(key);
                }
                attachment_names[source.input].emplace(name, key);
                files.replaceEmbeddedFile(key, QPDFFileSpecObjectHelper(copied));
            }
        }
        std::vector<Object> labels;
        for (std::size_t index = 0; index < expanded.size(); ++index) {
            const auto& page = expanded[index];
            auto annotation = JSON::makeDictionary();
            auto mapping = dictionary({{"part", JSON::makeInt(static_cast<long long>(page.part))},
                {"copy", JSON::makeInt(static_cast<long long>(page.copy))}});
            if (auto blank_page = std::get_if<BlankPage>(&page.content)) {
                auto blank = Object::newDictionary({{"/Type", Object::newName("/Page")},
                    {"/MediaBox",
                        Object::newArray({Object::newInteger(0), Object::newInteger(0),
                            Object::newReal(decimal(page.width * 72 / 25.4)),
                            Object::newReal(decimal(page.height * 72 / 25.4))})},
                    {"/Resources", Object::newDictionary()}});
                tree.addPage(QPDFPageObjectHelper(blank), false);
                mapping.addDictionaryMember("blank",
                    dictionary({{"width", JSON::makeNumber(decimal(page.width))},
                        {"height", JSON::makeNumber(decimal(page.height))}}));
                mapping.addDictionaryMember("padding", JSON::makeBool(blank_page->padding));
                labels.push_back(Object::newInteger(static_cast<long long>(index)));
                labels.push_back(Object::newDictionary(
                    {{"/S", Object::newName("/D")}, {"/St", Object::newInteger(static_cast<long long>(index) + 1)}}));
            } else {
                const auto& content = std::get<SourcePage>(page.content);
                auto& source = sources.at(content.source);
                auto& engine = *source.engine;
                auto original = engine.pages.at(content.page).getObjectHandle();
                auto copied = output.copyForeignObject(original);
                if (!inserted_pages.insert(copied.getObjGen()).second)
                    copied = output.makeIndirectObject(copied.shallowCopy());
                copied.removeKey("/Parent");
                tree.addPage(QPDFPageObjectHelper(copied), false);
                QPDFAcroFormDocumentHelper original_forms(engine.document);
                forms.fixCopiedAnnotations(copied, original, original_forms);
                QPDFPageLabelDocumentHelper source_labels(engine.document);
                if (source_labels.hasPageLabels())
                    source_labels.getLabelsForPageRange(static_cast<long long>(content.page),
                        static_cast<long long>(content.page), static_cast<long long>(index), labels);
                else {
                    labels.push_back(Object::newInteger(static_cast<long long>(index)));
                    labels.push_back(Object::newDictionary({{"/S", Object::newName("/D")},
                        {"/St", Object::newInteger(static_cast<long long>(index) + 1)}}));
                }
                mapping.addDictionaryMember("source", JSON::makeString(content.source));
                mapping.addDictionaryMember("page", JSON::makeInt(static_cast<long long>(content.page)));
                if (!object(source.manifest).empty()) {
                    auto page_id = "p" + std::to_string(index);
                    annotation = copy_object(source.pages.at(content.page));
                    if (auto preview = annotation.getDictItem("preview"); !preview.isNull())
                        annotation.addDictionaryMember(
                            "preview", JSON::makeString(attachment_names.at(source.input).at(text(preview))));
                    for (const auto& [id, region] : source.regions[content.page]) {
                        auto region_id = page_id + ":";
                        region_id += id;
                        auto locators_copy = JSON::makeArray(), refs = JSON::makeDictionary();
                        for (const auto& record : locators(source.manifest, region)) {
                            locators_copy.addArrayElement(record);
                            refs.addDictionaryMember(text(record.getDictItem("baseline")),
                                JSON::makeString(source.prefix + baseline_ref(region, record)));
                        }
                        auto updated = dictionary(
                            {{"page", region.getDictItem("page")}, {"marker", region.getDictItem("marker")},
                                {"records", locators_copy}, {"baselineRefs", refs}});
                        updated.addDictionaryMember("page", JSON::makeInt(static_cast<long long>(index)));
                        next.getDictItem("regions").addDictionaryMember(region_id, updated);
                        member(next.getDictItem("targets"), source.prefix + source.targets.at(id))
                            .addArrayElement(JSON::makeString(region_id));
                    }
                }
            }
            next.getDictItem("pages").addArrayElement(annotation);
            provenance.addArrayElement(mapping);
        }
        if (!labels.empty())
            output.getRoot().replaceKey("/PageLabels", Object::newDictionary({{"/Nums", Object::newArray(labels)}}));
        prune_previews(output, managed_previews, next.getDictItem("pages"), budget);
        for (const auto& item : output.getAllObjects()) {
            require(++budget.visits <= 65536, "Plan traversal exceeds 65536 visits.", "limit-exceeded");
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
        if (!object(next.getDictItem("regions")).empty() || annotated(next.getDictItem("pages"))) {
            if (!array(groups).empty())
                next.addDictionaryMember("groups", groups);
            if (!array(profile_sets).empty())
                next.addDictionaryMember("profileSets", profile_sets);
            auto stream = output.newStream(encode(share_records(next), manifest_limit, budget.remaining));
            stream.getDict().replaceKey("/Type", Object::newName("/EmbeddedFile"));
            stream.getDict().replaceKey("/Subtype", Object::newName("/application/json"));
            auto spec
                = QPDFFileSpecObjectHelper::createFileSpec(output, "mainz.json", QPDFEFStreamObjectHelper(stream));
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
        Engine reopened(saved.bytes, &budget, false, syntax);
        auto description = reopened.describe();
        auto mapping
            = encode(dictionary({{"version", JSON::makeInt(1)}, {"pages", provenance}, {"parameters", parameter_map}}),
                json_limit, budget.remaining);
        return Artifact {Document(std::move(saved.bytes), std::move(description), !object(reopened.manifest).empty(),
                             reopened.prepared(), reopened.take_index()),
            std::move(mapping)};
    };
    return assemble();
}
}

namespace mainz {
using namespace detail;
Artifact compose(const std::string& plan, const std::map<std::string, std::string>& inputs, const Document* previous)
{
    try {
        return Engine::compose(parse(plan, "request"), bind_inputs(inputs), previous);
    } catch (const Error&) {
        throw;
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Artifact allocation failed.");
    } catch (const std::exception& error) {
        throw Error("pdf-syntax", error.what());
    }
}
Artifact compose_validated(const std::string& plan, const std::map<std::string, Document>& inputs)
{
    try {
        return Engine::compose(parse(plan, "request"), bind_inputs(inputs), nullptr);
    } catch (const Error&) {
        throw;
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Artifact allocation failed.");
    } catch (const std::exception& error) {
        throw Error("pdf-syntax", error.what());
    }
}
}
