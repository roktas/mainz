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
        fields(plan, {"version", "sources", "parts"}, {"metadata"});
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
    auto metadata = plan.getDictItem("metadata");
    std::string title;
    std::size_t cover_page {1};
    if (object(plan).contains("metadata"))
        request_at("/metadata", [&] {
            document_metadata(metadata, expanded.size());
            title = text(metadata.getDictItem("title"));
            cover_page = static_cast<std::size_t>(number(metadata.getDictItem("coverPage")));
        });
    if (sources.size() == 1 && metadata.isNull()) {
        auto& [id, source] = *sources.begin();
        auto& engine = *source.engine;
        bool whole = expanded.size() == engine.pages.size();
        for (std::size_t index = 0; whole && index < expanded.size(); ++index) {
            auto content = std::get_if<SourcePage>(&expanded[index].content);
            whole = content && content->source == id && content->page == index;
        }
        if (whole) {
            auto provenance = JSON::makeArray(), parameters = JSON::makeDictionary();
            for (std::size_t index = 0; index < expanded.size(); ++index)
                provenance.addArrayElement(dictionary(
                    {{"source", JSON::makeString(id)}, {"page", JSON::makeInt(static_cast<long long>(index))},
                        {"part", JSON::makeInt(static_cast<long long>(expanded[index].part))},
                        {"copy", JSON::makeInt(static_cast<long long>(expanded[index].copy))}}));
            for (const auto& [parameter, record] : engine.parameters) {
                (void)record;
                parameters.addDictionaryMember(parameter,
                    dictionary({{"source", JSON::makeString(id)}, {"parameter", JSON::makeString(parameter)}}));
            }
            auto saved = engine.changed_targets.empty() ? inputs.at(source.input).bytes : engine.save(engine.manifest);
            auto syntax = engine.take_index();
            source.engine.reset();
            Engine reopened(saved, &budget, false, syntax);
            auto description = reopened.describe();
            auto mapping
                = encode(dictionary({{"version", JSON::makeInt(1)}, {"pages", provenance}, {"parameters", parameters}}),
                    json_limit, budget.remaining);
            return Artifact {Document(std::move(saved), std::move(description), !object(reopened.manifest).empty(),
                                 reopened.prepared(), reopened.take_index(), reopened.take_previews()),
                std::move(mapping)};
        }
    }
    for (auto& [id, source] : sources) {
        (void)id;
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
        struct Bookmark {
            Object item;
            std::size_t target;
            std::vector<std::size_t> children;
        };
        std::vector<Bookmark> bookmarks;
        std::vector<std::size_t> roots;
        const auto output_pages = tree.getAllPages();
        for (auto& [id, source] : sources) {
            auto& engine = *source.engine;
            struct Heading {
                Object title;
                std::size_t page, end, depth, target;
                std::optional<std::size_t> parent;
            };
            struct Pending {
                Object item;
                std::size_t depth, level;
                std::optional<std::size_t> parent;
            };
            std::map<QPDFObjGen, std::size_t> page_indexes;
            for (std::size_t index = 0; index < engine.pages.size(); ++index)
                page_indexes.emplace(engine.pages[index].getObjectHandle().getObjGen(), index);
            std::vector<Heading> headings;
            std::vector<Pending> pending {{engine.document.getRoot().getKey("/Outlines").getKey("/First"), 0, 0, {}}};
            std::set<QPDFObjGen> seen;
            while (!pending.empty()) {
                auto current = pending.back();
                pending.pop_back();
                auto item = current.item;
                if (!item.isDictionary() || (item.isIndirect() && !seen.insert(item.getObjGen()).second))
                    continue;
                require(++budget.visits <= 65536 && current.level < 64, "Outline traversal exceeds limits.",
                    "limit-exceeded");
                pending.push_back({item.getKey("/Next"), current.depth, current.level, current.parent});
                auto title = item.getKey("/Title");
                auto dest = item.getKey("/Dest");
                if (dest.isNull() && item.getKey("/A").getKey("/S").isNameAndEquals("/GoTo"))
                    dest = item.getKey("/A").getKey("/D");
                std::optional<std::size_t> page;
                if (dest.isArray() && dest.getArrayNItems() > 0) {
                    auto target = dest.getArrayItem(0);
                    if (target.isInteger() && target.getIntValue() >= 0
                        && static_cast<unsigned long long>(target.getIntValue()) < engine.pages.size())
                        page = static_cast<std::size_t>(target.getIntValue());
                    else if (target.isIndirect() && page_indexes.contains(target.getObjGen()))
                        page = page_indexes.at(target.getObjGen());
                }
                auto parent = current.parent;
                auto depth = current.depth;
                if (page && title.isString()) {
                    auto text = title.getUTF8Value();
                    if (text.size() <= 4096 && text.find_first_not_of(" \t\r\n") != std::string::npos) {
                        parent = headings.size();
                        headings.push_back(
                            {title, *page, engine.pages.size() - 1, depth, expanded.size(), current.parent});
                        ++depth;
                    }
                }
                pending.push_back({item.getKey("/First"), depth, current.level + 1, parent});
            }
            if (headings.empty())
                continue;
            std::vector<std::size_t> open;
            for (std::size_t index = 0; index < headings.size(); ++index) {
                while (!open.empty() && headings[open.back()].depth >= headings[index].depth) {
                    auto& previous = headings[open.back()];
                    previous.end = headings[index].page > previous.page ? headings[index].page - 1 : previous.page;
                    open.pop_back();
                }
                open.push_back(index);
            }
            // Range minima find each section's first retained Output occurrence without a page/section matrix.
            auto count = engine.pages.size();
            budget.consume(2 * count * sizeof(std::size_t));
            std::vector<std::size_t> first(2 * count, expanded.size());
            for (std::size_t index = 0; index < expanded.size(); ++index)
                if (auto content = std::get_if<SourcePage>(&expanded[index].content); content && content->source == id)
                    first[count + content->page] = std::min(first[count + content->page], index);
            for (auto index = count; index > 1; --index)
                first[index - 1] = std::min(first[2 * (index - 1)], first[2 * (index - 1) + 1]);
            std::vector<std::optional<std::size_t>> retained(headings.size());
            for (std::size_t index = 0; index < headings.size(); ++index) {
                const auto& heading = headings[index];
                auto target = expanded.size();
                for (auto left = count + heading.page, right = count + heading.end + 1; left < right;
                    left /= 2, right /= 2) {
                    if (left % 2)
                        target = std::min(target, first[left++]);
                    if (right % 2)
                        target = std::min(target, first[--right]);
                }
                headings[index].target = target;
            }
            // Non-monotonic targets must not detach retained children from their authored ancestors.
            for (auto index = headings.size(); index > 0; --index) {
                const auto& heading = headings[index - 1];
                if (heading.parent)
                    headings[*heading.parent].target = std::min(headings[*heading.parent].target, heading.target);
            }
            for (std::size_t index = 0; index < headings.size(); ++index) {
                const auto& heading = headings[index];
                auto target = heading.target;
                if (target == expanded.size())
                    continue;
                auto item = output.makeIndirectObject(
                    Object::newDictionary({{"/Title", Object::newUnicodeString(heading.title.getUTF8Value())},
                        {"/Dest",
                            Object::newArray({output_pages.at(target).getObjectHandle(), Object::newName("/Fit")})}}));
                auto parent = heading.parent;
                auto& siblings = parent ? bookmarks[*retained[*parent]].children : roots;
                siblings.push_back(bookmarks.size());
                retained[index] = bookmarks.size();
                bookmarks.push_back({item, target, {}});
            }
        }
        if (!roots.empty()) {
            auto root = output.makeIndirectObject(Object::newDictionary({{"/Type", Object::newName("/Outlines")}}));
            auto connect = [&](auto&& self, std::vector<std::size_t>& siblings, Object parent) -> std::size_t {
                std::stable_sort(siblings.begin(), siblings.end(),
                    [&](auto left, auto right) { return bookmarks[left].target < bookmarks[right].target; });
                std::size_t count = siblings.size();
                for (std::size_t index = 0; index < siblings.size(); ++index) {
                    auto& bookmark = bookmarks[siblings[index]];
                    auto item = bookmark.item;
                    item.replaceKey("/Parent", parent);
                    if (index)
                        item.replaceKey("/Prev", bookmarks[siblings[index - 1]].item);
                    if (index + 1 < siblings.size())
                        item.replaceKey("/Next", bookmarks[siblings[index + 1]].item);
                    auto children = self(self, bookmark.children, item);
                    if (children)
                        item.replaceKey("/Count", Object::newInteger(static_cast<long long>(children)));
                    count += children;
                }
                if (!siblings.empty()) {
                    parent.replaceKey("/First", bookmarks[siblings.front()].item);
                    parent.replaceKey("/Last", bookmarks[siblings.back()].item);
                }
                return count;
            };
            root.replaceKey("/Count", Object::newInteger(static_cast<long long>(connect(connect, roots, root))));
            output.getRoot().replaceKey("/Outlines", root);
        }
        prune_previews(output, managed_previews, next.getDictItem("pages"));
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
        if (!metadata.isNull()) {
            std::string escaped;
            for (char character : title)
                escaped += character == '\r' ? "&#13;"
                    : character == '&'       ? "&amp;"
                    : character == '<'       ? "&lt;"
                    : character == '>'       ? "&gt;"
                                             : std::string(1, character);
            auto xml = "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF "
                       "xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"><rdf:Description "
                       "rdf:about=\"\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" "
                       "xmlns:mainz=\"https://github.com/roktas/mainz/ns/1.0/\"><dc:title><rdf:Alt>"
                       "<rdf:li xml:lang=\"x-default\">"
                + escaped + "</rdf:li></rdf:Alt></dc:title><mainz:coverPage>" + std::to_string(cover_page)
                + "</mainz:coverPage></rdf:Description></rdf:RDF></x:xmpmeta>";
            auto stream = output.newStream(xml);
            stream.getDict().replaceKey("/Type", Object::newName("/Metadata"));
            stream.getDict().replaceKey("/Subtype", Object::newName("/XML"));
            output.getRoot().replaceKey("/Metadata", stream);
            output.getTrailer().replaceKey("/Info",
                output.makeIndirectObject(Object::newDictionary({{"/Title", Object::newUnicodeString(title)}})));
        }
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
                             reopened.prepared(), reopened.take_index(), reopened.take_previews()),
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
