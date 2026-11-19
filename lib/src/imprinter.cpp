#include "contract.hh"
#include "imprinter/internal.hh"
#include "pipeline.hh"
#include <algorithm>
#include <qpdf/Buffer.hh>
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
    JSON declaration(const std::string& bytes, bool preview)
    {
        auto root = parse(bytes, "declaration");
        auto present = fields(root, {"targets", "parameters"}, {"groups", "profileSets", "publication", "page"});
        if (present.contains("publication"))
            publication(root.getDictItem("publication"), "declaration");
        auto targets = object(root.getDictItem("targets"));
        auto parameters = object(root.getDictItem("parameters"));
        require(targets.empty() == parameters.empty(), "Targets and parameters must be empty together.");
        if (present.contains("page")) {
            auto page = root.getDictItem("page");
            auto supplied = fields(page, {}, {"name", "tags"});
            require(!supplied.empty(), "Page annotations must not be empty.");
            page_metadata(page);
        }
        require(!targets.empty() || present.contains("page") || preview, "Declaration has no paint or page metadata.");
        require(!targets.empty() || (!present.contains("groups") && !present.contains("profileSets")),
            "Metadata-only declarations cannot contain paint presentation.");
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
            auto fields_present = fields(parameter, {"schema", "binding"}, {"value", "family", "key"});
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
        semantics(parameters, "declaration");
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
        if (!parameters.empty())
            root.addDictionaryMember("groups", groups);
        return root;
    }
    void embed(QPDF& document, JSON root)
    {
        manifest(root, 1);
        auto payload = detail::encode(root, manifest_limit);
        auto attachment = QPDFEFStreamObjectHelper::createEFStream(document, payload);
        attachment.setSubtype("application/json");
        QPDFEmbeddedFileDocumentHelper(document).replaceEmbeddedFile(
            "mainz.json", QPDFFileSpecObjectHelper::createFileSpec(document, "mainz.json", attachment));
    }
    Document finish(QPDF& document)
    {
        std::size_t remaining = pdf_limit;
        Buffer output(pdf_limit, remaining);
        QPDFWriter writer(document);
        writer.setOutputPipeline(&output);
        writer.setMinimumPDFVersion("1.7");
        writer.setDeterministicID(true);
        writer.write();
        require(document.getWarnings().empty(), "Produced PDF contains warnings.", "pdf-syntax");
        return Document::read(std::move(output.bytes));
    }
}
Document imprint(const std::string& svg, const std::string& bytes, const ImprintOptions& options)
{
    try {
        require(!options.preview || options.preview->size() <= pdf_limit, "Preview exceeds 128 MiB.", "limit-exceeded");
        auto source = declaration(bytes, options.preview.has_value());
        auto targets = JSON::makeDictionary(), parameters = JSON::makeDictionary(), overrides = JSON::makeDictionary();
        for (const auto& [id, definition] : object(source.getDictItem("targets"))) {
            (void)definition;
            targets.addDictionaryMember(id, JSON::makeArray());
        }
        for (const auto& [id, parameter] : object(source.getDictItem("parameters"))) {
            auto clean = dictionary(
                {{"schema", parameter.getDictItem("schema")}, {"binding", parameter.getDictItem("binding")}});
            for (const auto& field : {"family", "key"})
                if (object(parameter).contains(field))
                    clean.addDictionaryMember(field, parameter.getDictItem(field));
            parameters.addDictionaryMember(id, clean);
            if (object(parameter).contains("value"))
                overrides.addDictionaryMember(id, parameter.getDictItem("value"));
        }
        auto annotations = JSON::makeArray();
        annotations.addArrayElement(
            source.getDictItem("page").isNull() ? JSON::makeDictionary() : source.getDictItem("page"));
        auto root
            = dictionary({{"version", JSON::makeInt(1)}, {"pages", annotations}, {"regions", JSON::makeDictionary()},
                {"baselines", JSON::makeDictionary()}, {"targets", targets}, {"parameters", parameters}});
        if (!source.getDictItem("groups").isNull())
            root.addDictionaryMember("groups", source.getDictItem("groups"));
        if (!source.getDictItem("profileSets").isNull())
            root.addDictionaryMember("profileSets", source.getDictItem("profileSets"));
        if (!source.getDictItem("publication").isNull())
            root.addDictionaryMember("publication", source.getDictItem("publication"));
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
        imprinter::CaptureBudget budget;
        imprinter::render(svg, source.getDictItem("targets"), options, [&](std::string pdf, const std::string& target) {
            require(pdf.size() <= pdf_limit - rendered && runs < 65536, "Rendered source exceeds its limit.",
                "limit-exceeded");
            rendered += pdf.size();
            QPDF layer;
            layer.setSuppressWarnings(true);
            layer.setAttemptRecovery(false);
            layer.setImmediateCopyFrom(true);
            layer.processMemoryFile("Cairo SVG layer", pdf.data(), pdf.size());
            auto pages = QPDFPageDocumentHelper(layer).getAllPages();
            require(pages.size() == 1, "Rendered layer must have one page.", "imprinter-error");
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
                    dictionary(
                        {{"page", JSON::makeInt(0)}, {"marker", JSON::makeString(region)}, {"records", records}}));
                member(targets, target).addArrayElement(JSON::makeString(region));
                properties.replaceKey("/" + region, Object::newDictionary());
                imprinter::annotate(document, form, root, member(source.getDictItem("targets"), target), target, region,
                    resource, budget);
                require(!array(records).empty(), "Selected element has no editable paths.", "imprinter-error");
                content += "/Figure /" + region + " BDC\n";
            }
            content += "q /" + resource + " Do Q\n";
            if (!target.empty())
                content += "EMC\n";
            require(layer.getWarnings().empty(), "Rendered PDF contains warnings.", "pdf-syntax");
        });
        page.replaceKey("/Contents", document.newStream(content));
        QPDFPageDocumentHelper(document).addPage(QPDFPageObjectHelper(document.makeIndirectObject(page)), false);
        if (!object(parameters).empty() || annotated(root.getDictItem("pages")))
            embed(document, root);
        auto prepared = finish(document);
        if (!object(overrides).empty())
            prepared = prepared.style(overrides.unparse());
        if (!options.preview)
            return prepared;
        QPDF final;
        final.setSuppressWarnings(true);
        final.setAttemptRecovery(false);
        final.processMemoryFile("Mainz preview production", prepared.pdf().data(), prepared.pdf().size());
        QPDFEmbeddedFileDocumentHelper files(final);
        if (auto manifest = files.getEmbeddedFile("mainz.json")) {
            auto stream = manifest->getObjectHandle().getKey("/EF").getKey("/F").getStreamData();
            root = JSON::parse(std::string(reinterpret_cast<const char*>(stream->getBuffer()), stream->getSize()));
        }
        auto annotation = array(root.getDictItem("pages")).at(0);
        annotation.addDictionaryMember("preview", JSON::makeString("preview.png"));
        annotations = JSON::makeArray();
        annotations.addArrayElement(annotation);
        root.addDictionaryMember("pages", annotations);
        auto image = QPDFEFStreamObjectHelper::createEFStream(final, *options.preview);
        image.setSubtype("image/png");
        files.replaceEmbeddedFile("preview.png", QPDFFileSpecObjectHelper::createFileSpec(final, "preview.png", image));
        embed(final, root);
        return finish(final);
    } catch (const Error&) {
        throw;
    } catch (const std::exception& error) {
        throw Error("imprinter-error", error.what());
    }
}
}
