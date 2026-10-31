#include "contract.hh"
#include "pipeline.hh"
#include "producer/internal.hh"
#include <algorithm>
#include <qpdf/Pipeline.hh>
#include <qpdf/QPDFEFStreamObjectHelper.hh>
#include <qpdf/QPDFEmbeddedFileDocumentHelper.hh>
#include <qpdf/QPDFFileSpecObjectHelper.hh>
#include <qpdf/QPDFPageDocumentHelper.hh>
#include <qpdf/QPDFWriter.hh>
#include <set>

namespace mainz {
namespace {
    using namespace detail;
    using Object = QPDFObjectHandle;
    JSON declaration(const std::string& bytes)
    {
        auto root = parse(bytes, "declaration");
        auto present = fields(root, {"targets", "parameters"}, {"groups", "profileSets"});
        auto targets = object(root.getDictItem("targets"));
        auto parameters = object(root.getDictItem("parameters"));
        require(!targets.empty() && !parameters.empty(), "Targets and parameters must not be empty.");
        for (const auto& [id, target] : targets) {
            identifier(id);
            auto fields_present = fields(target, {"selectors"}, {"fill", "display"});
            auto selectors = array(target.getDictItem("selectors"));
            require(!selectors.empty(), "Target selectors must not be empty.");
            std::set<std::string> unique;
            for (const auto& selector : selectors)
                require(unique.insert(text(selector)).second, "Repeated selector.");
            if (fields_present.contains("fill")) {
                bool value = false;
                require(target.getDictItem("fill").getBool(value), "Target fill must be a boolean.");
            }
            if (fields_present.contains("display")) {
                auto display = text(target.getDictItem("display"));
                require(display == "inline" || display == "none", "Invalid target display.");
            }
        }
        std::set<std::pair<std::string, std::string>> bound;
        std::set<std::string> used_targets;
        for (const auto& [id, parameter] : parameters) {
            identifier(id);
            auto fields_present = fields(parameter, {"schema", "binding"}, {"value"});
            auto binding = parameter.getDictItem("binding");
            fields(binding, {"targets", "property"});
            auto property = text(binding.getDictItem("property"));
            require(std::set<std::string> {"stroke-width", "stroke-color", "stroke-opacity", "fill-color",
                        "fill-opacity", "display"}
                        .contains(property),
                "Unsupported parameter property.");
            schema(parameter.getDictItem("schema"), property);
            if (fields_present.contains("value"))
                value(parameter.getDictItem("value"), parameter.getDictItem("schema"), property);
            auto selected = array(binding.getDictItem("targets"));
            require(!selected.empty(), "Binding targets must not be empty.");
            for (const auto& target : selected) {
                auto target_id = text(target);
                require(targets.contains(target_id) && bound.emplace(target_id, property).second,
                    "Unknown, duplicate, or conflicting binding target.");
                used_targets.insert(target_id);
            }
        }
        require(used_targets.size() == targets.size(), "Every target requires a parameter binding.");
        if (present.contains("profileSets"))
            profile_sets(root.getDictItem("profileSets"), parameters);
        auto groups = present.contains("groups") ? root.getDictItem("groups") : JSON::makeArray();
        std::set<std::string> grouped;
        for (const auto& group : array(groups)) {
            auto group_fields = fields(group, {"title", "parameters"}, {"description", "details"});
            text(group.getDictItem("title"));
            annotations(group, group_fields);
            for (const auto& id : array(group.getDictItem("parameters")))
                require(parameters.contains(text(id)) && grouped.insert(text(id)).second,
                    "Unknown or repeated group parameter.");
        }
        auto remaining = JSON::makeArray();
        for (const auto& [id, definition] : parameters) {
            (void)definition;
            if (!grouped.contains(id))
                remaining.addArrayElement(JSON::makeString(id));
        }
        if (!array(remaining).empty())
            groups.addArrayElement(
                dictionary({{"title", JSON::makeString("Other controls")}, {"parameters", remaining}}));
        root.addDictionaryMember("groups", groups);
        return root;
    }
}
Document produce(const std::string& svg, const std::string& bytes, const ProduceOptions& options)
{
    try {
        auto source = declaration(bytes);
        auto targets = JSON::makeDictionary(), parameters = JSON::makeDictionary(), overrides = JSON::makeDictionary();
        for (const auto& [id, definition] : object(source.getDictItem("targets"))) {
            (void)definition;
            targets.addDictionaryMember(id, JSON::makeArray());
        }
        for (const auto& [id, parameter] : object(source.getDictItem("parameters"))) {
            auto clean = dictionary(
                {{"schema", parameter.getDictItem("schema")}, {"binding", parameter.getDictItem("binding")}});
            parameters.addDictionaryMember(id, clean);
            if (object(parameter).contains("value"))
                overrides.addDictionaryMember(id, parameter.getDictItem("value"));
        }
        auto root = dictionary({{"version", JSON::makeInt(1)}, {"pages", dictionary({{"page", JSON::makeInt(0)}})},
            {"regions", JSON::makeDictionary()}, {"baselines", JSON::makeDictionary()}, {"targets", targets},
            {"parameters", parameters}, {"groups", source.getDictItem("groups")}});
        if (!source.getDictItem("profileSets").isNull())
            root.addDictionaryMember("profileSets", source.getDictItem("profileSets"));
        QPDF document;
        document.emptyPDF();
        auto page = Object::newDictionary(), resources = Object::newDictionary(), objects = Object::newDictionary(),
             properties = Object::newDictionary();
        page.replaceKey("/Type", Object::newName("/Page"));
        resources.replaceKey("/XObject", objects);
        resources.replaceKey("/Properties", properties);
        page.replaceKey("/Resources", resources);
        std::string content;
        std::size_t runs = 0, rendered = 0;
        producer::CaptureBudget budget;
        producer::render(svg, source.getDictItem("targets"), options, [&](std::string pdf, const std::string& target) {
            require(pdf.size() <= pdf_limit - rendered && runs < 65536, "Rendered source exceeds its limit.",
                "limit-exceeded");
            rendered += pdf.size();
            QPDF layer;
            layer.setSuppressWarnings(true);
            layer.setAttemptRecovery(false);
            layer.setImmediateCopyFrom(true);
            layer.processMemoryFile("Cairo SVG layer", pdf.data(), pdf.size());
            auto pages = QPDFPageDocumentHelper(layer).getAllPages();
            require(pages.size() == 1, "Rendered layer must have one page.", "producer-error");
            if (runs == 0)
                page.replaceKey("/MediaBox", pages[0].getMediaBox().shallowCopy());
            auto form = document.copyForeignObject(pages[0].getFormXObjectForPage());
            // Cairo's synthetic page group is not an authored compositing boundary between source runs.
            auto group = form.getDict().getKey("/Group");
            require(group.isNull()
                    || (group.isDictionary() && group.getKey("/S").isNameAndEquals("/Transparency")
                        && group.getKey("/CS").isNameAndEquals("/DeviceRGB") && group.getKey("/I").isBool()
                        && group.getKey("/I").getBoolValue() && !group.hasKey("/K")),
                "Unexpected Cairo page compositing context.", "unsupported-context");
            form.getDict().removeKey("/Group");
            auto resource = "L" + std::to_string(runs), region = "R" + std::to_string(runs++);
            objects.replaceKey("/" + resource, form);
            if (!target.empty()) {
                auto records = JSON::makeArray();
                root.getDictItem("regions").addDictionaryMember(region,
                    dictionary({{"page", JSON::makeString("page")}, {"marker", JSON::makeString(region)},
                        {"records", records}}));
                member(targets, target).addArrayElement(JSON::makeString(region));
                properties.replaceKey("/" + region, Object::newDictionary());
                producer::annotate(document, form, root, member(source.getDictItem("targets"), target), target, region,
                    resource, budget);
                require(!array(records).empty(), "Selected element has no editable paths.", "producer-error");
                content += "/Figure /" + region + " BDC\n";
            }
            content += "q /" + resource + " Do Q\n";
            if (!target.empty())
                content += "EMC\n";
            require(layer.getWarnings().empty(), "Rendered PDF contains warnings.", "pdf-syntax");
        });
        page.replaceKey("/Contents", document.newStream(content));
        QPDFPageDocumentHelper(document).addPage(QPDFPageObjectHelper(document.makeIndirectObject(page)), false);
        manifest(root, 1);
        auto payload = detail::encode(root, manifest_limit);
        auto attachment = QPDFEFStreamObjectHelper::createEFStream(document, payload);
        attachment.setSubtype("application/json");
        QPDFEmbeddedFileDocumentHelper(document).replaceEmbeddedFile(
            "mainz.json", QPDFFileSpecObjectHelper::createFileSpec(document, "mainz.json", attachment));
        std::size_t remaining = pdf_limit;
        Buffer output(pdf_limit, remaining);
        QPDFWriter writer(document);
        writer.setOutputPipeline(&output);
        writer.setMinimumPDFVersion("1.7");
        writer.setDeterministicID(true);
        writer.write();
        require(document.getWarnings().empty(), "Produced PDF contains warnings.", "pdf-syntax");
        auto prepared = Document::read(std::move(output.bytes));
        if (object(overrides).empty())
            return prepared;
        return prepared.apply(overrides.unparse());
    } catch (const Error&) {
        throw;
    } catch (const std::exception& error) {
        throw Error("producer-error", error.what());
    }
}
}
