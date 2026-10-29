#include "contract.hh"
#include "internal.hh"
#include "pipeline.hh"
#include <algorithm>
#include <cairo-pdf.h>
#include <cmath>
#include <exception>
#include <librsvg/rsvg.h>
#include <libxml/parser.h>
#include <map>
#include <memory>
#include <regex>
#include <set>
#include <sstream>
#include <string_view>

namespace mainz::producer {
namespace {
    using namespace detail;
    using Handle = std::unique_ptr<RsvgHandle, decltype(&g_object_unref)>;
    using Xml = std::unique_ptr<xmlDoc, decltype(&xmlFreeDoc)>;
    using XmlText = std::unique_ptr<xmlChar, decltype(xmlFree)>;
    using Surface = std::unique_ptr<cairo_surface_t, decltype(&cairo_surface_destroy)>;
    using Context = std::unique_ptr<cairo_t, decltype(&cairo_destroy)>;
    std::string attribute(xmlNode* node, const char* name)
    {
        XmlText bytes(xmlGetProp(node, BAD_CAST name), xmlFree);
        return bytes ? reinterpret_cast<const char*>(bytes.get()) : "";
    }
    bool named(xmlNode* node, const char* name) { return xmlStrEqual(node->name, BAD_CAST name); }
    bool compositing(std::string css)
    {
        // Bound regex recursion without limiting authored CSS whitespace.
        constexpr std::string_view whitespace = " \t\r\n\f\v";
        auto end = css.begin();
        bool previous = false;
        for (auto c : css) {
            auto current = whitespace.find(c) != std::string_view::npos;
            if (!previous || !current)
                *end++ = c;
            previous = current;
        }
        css.erase(end, css.end());
        static const std::regex properties(
            "(?:^|[;{])\\s*(?:opacity|mask|filter|mix-blend-mode)\\s*:", std::regex::icase);
        return std::regex_search(css, properties);
    }
    void success(gboolean ok, GError* error)
    {
        std::unique_ptr<GError, decltype(&g_error_free)> owned(error, g_error_free);
        require(ok, error ? error->message : "SVG rendering failed.", "producer-error");
    }
    Handle handle(const std::string& bytes)
    {
        GError* error = nullptr;
        Handle result(rsvg_handle_new_from_data(reinterpret_cast<const guint8*>(bytes.data()), bytes.size(), &error),
            g_object_unref);
        success(result != nullptr, error);
        rsvg_handle_set_dpi(result.get(), 96);
        return result;
    }
    double dimension(double n)
    {
        require(std::isfinite(n) && n > 0, "Dimensions must be finite and positive.", "producer-error");
        return n;
    }
    struct Viewport {
        RsvgRectangle rectangle {};
        double width {}, height {}, scale {};
        Viewport(RsvgHandle* svg, const ProduceOptions& options)
        {
            auto dpi = dimension(options.dpi);
            double iw {}, ih {};
            if (!rsvg_handle_get_intrinsic_size_in_pixels(svg, &iw, &ih)) {
                gboolean has_box = false;
                RsvgRectangle box {};
                rsvg_handle_get_intrinsic_dimensions(svg, nullptr, nullptr, nullptr, nullptr, &has_box, &box);
                require(has_box, "SVG needs absolute dimensions or a viewBox.", "producer-error");
                iw = box.width;
                ih = box.height;
            }
            iw = dimension(dimension(iw) * dpi / 96);
            ih = dimension(dimension(ih) * dpi / 96);
            double fit = 1;
            if (options.width)
                fit = dimension(*options.width) / iw;
            if (options.height)
                fit = options.width ? std::min(fit, dimension(*options.height) / ih) : dimension(*options.height) / ih;
            rectangle = {0, 0, iw, ih};
            width = dimension(iw * fit * (72 / dpi));
            height = dimension(ih * fit * (72 / dpi));
            scale = dimension(fit * (72 / dpi));
        }
    };
    cairo_status_t write(void* closure, const unsigned char* bytes, unsigned int size) noexcept
    {
        try {
            static_cast<detail::Buffer*>(closure)->write(bytes, size);
            return CAIRO_STATUS_SUCCESS;
        } catch (...) {
            return CAIRO_STATUS_WRITE_ERROR;
        }
    }
    struct Run {
        std::vector<std::string> ids;
        std::string target;
    };
    class Source {
    public:
        explicit Source(const std::string& bytes)
            : svg(nullptr, g_object_unref)
            , document(nullptr, xmlFreeDoc)
        {
            require(bytes.size() <= pdf_limit, "SVG exceeds 128 MiB.", "limit-exceeded");
            static const std::regex declarations("<!DOCTYPE|<!ENTITY", std::regex::icase);
            require(!std::regex_search(bytes, declarations), "SVG declarations and entities are unsupported.",
                "producer-error");
            document.reset(xmlReadMemory(bytes.data(), static_cast<int>(bytes.size()), nullptr, nullptr,
                XML_PARSE_NONET + XML_PARSE_NOERROR + XML_PARSE_NOWARNING));
            require(document != nullptr && document->intSubset == nullptr && document->extSubset == nullptr,
                "Invalid SVG XML.", "producer-error");
            root = xmlDocGetRootElement(document.get());
            require(root && named(root, "svg"), "Expected an SVG root.", "producer-error");
            visit(root, 0);
            svg = handle(bytes);
        }
        void select(JSON targets, const Viewport& viewport)
        {
            static const std::regex selector(
                "^#([A-Za-z_][A-Za-z0-9_-]*)(?:\\s*>\\s*use\\.([A-Za-z_][A-Za-z0-9_-]*))?$");
            for (const auto& [target, definition] : object(targets)) {
                auto display = definition.getDictItem("display");
                for (const auto& choice : array(definition.getDictItem("selectors"))) {
                    std::smatch match;
                    auto expression = text(choice);
                    require(
                        std::regex_match(expression, match, selector), "Unsupported SVG selector.", "producer-error");
                    auto parent = ids.find(match[1].str());
                    std::vector<xmlNode*> selected;
                    if (parent != ids.end()) {
                        if (!match[2].matched)
                            selected.push_back(parent->second);
                        else
                            for (auto child = parent->second->children; child; child = child->next) {
                                if (child->type != XML_ELEMENT_NODE || !named(child, "use"))
                                    continue;
                                std::istringstream classes(attribute(child, "class"));
                                std::string item;
                                while (classes >> item)
                                    if (item == match[2].str()) {
                                        selected.push_back(child);
                                        break;
                                    }
                            }
                    }
                    require(
                        !selected.empty(), "Selector has no whole-element matches: " + expression, "producer-error");
                    for (auto node : selected) {
                        require(named(node, "g") || named(node, "use"), "Select groups or direct use placements.",
                            "producer-error");
                        for (auto ancestor = node; ancestor; ancestor = ancestor->parent)
                            if (ancestor->type == XML_ELEMENT_NODE) {
                                require(!named(ancestor, "defs") && !named(ancestor, "symbol"),
                                    "Selected element occurs inside a template.", "producer-error");
                                require(!owners.contains(ancestor), "Overlapping target selections.", "producer-error");
                            }
                        require(!branches.contains(node), "Overlapping target selections.", "producer-error");
                        RsvgRectangle ink {}, logical {};
                        GError* error = nullptr;
                        auto authored_id = attribute(node, "id");
                        require(!authored_id.empty(), "Selected use placements need authored IDs.", "producer-error");
                        auto id = "#" + authored_id;
                        auto ok = rsvg_handle_get_geometry_for_layer(
                            svg.get(), id.c_str(), &viewport.rectangle, &ink, &logical, &error);
                        success(ok, error);
                        auto visible = ink.width > 0 && ink.height > 0;
                        require(!(!visible && display.isNull())
                                && !(visible && !display.isNull() && text(display) == "none"),
                            "Authored display must agree with source visibility.", "producer-error");
                        owners.emplace(node, target);
                        for (auto ancestor = node->parent; ancestor; ancestor = ancestor->parent)
                            branches.insert(ancestor);
                    }
                }
            }
            for (auto child = root->children; child; child = child->next)
                walk(child);
            std::string css;
            for (const auto& [node, target] : owners) {
                (void)target;
                auto id = attribute(node, "id");
                // CSS escapes make arbitrary authored use IDs safe in the materialization rule.
                css += '#';
                for (auto c : id) {
                    const char hex[] = "0123456789abcdef";
                    auto byte = static_cast<unsigned char>(c);
                    if (byte >= 128) {
                        css += c;
                        continue;
                    }
                    css += '\\';
                    css += hex[byte / 16];
                    css += hex[byte % 16];
                    css += ' ';
                }
                css += " { display: inline !important; }\n";
            }
            svg = handle(serialize());
            GError* error = nullptr;
            auto ok = rsvg_handle_set_stylesheet(
                svg.get(), reinterpret_cast<const guint8*>(css.data()), css.size(), &error);
            success(ok, error);
        }
        std::string paint(const Run& run, const Viewport& viewport) const
        {
            std::size_t remaining = pdf_limit;
            detail::Buffer output(pdf_limit, remaining);
            Surface surface(cairo_pdf_surface_create_for_stream(write, &output, viewport.width, viewport.height),
                cairo_surface_destroy);
            Context context(cairo_create(surface.get()), cairo_destroy);
            cairo_scale(context.get(), viewport.scale, viewport.scale);
            for (const auto& id : run.ids) {
                GError* error = nullptr;
                auto selector = "#" + id;
                auto ok
                    = rsvg_handle_render_layer(svg.get(), context.get(), selector.c_str(), &viewport.rectangle, &error);
                success(ok, error);
            }
            cairo_show_page(context.get());
            cairo_surface_finish(surface.get());
            if (output.failure)
                std::rethrow_exception(output.failure);
            require(cairo_status(context.get()) == CAIRO_STATUS_SUCCESS
                    && cairo_surface_status(surface.get()) == CAIRO_STATUS_SUCCESS,
                "Cairo PDF rendering failed.", "producer-error");
            return std::move(output.bytes);
        }
        Handle svg;
        std::vector<Run> runs;

    private:
        Xml document;
        xmlNode* root {};
        std::map<std::string, xmlNode*> ids;
        std::map<xmlNode*, std::string> owners;
        std::set<xmlNode*> branches;
        bool source_ids_required {false};
        std::size_t nodes {0};
        std::string serialize() const
        {
            xmlChar* raw = nullptr;
            int size = 0;
            xmlDocDumpMemoryEnc(document.get(), &raw, &size, "UTF-8");
            XmlText owned(raw, xmlFree);
            require(raw && size >= 0 && static_cast<std::size_t>(size) <= pdf_limit,
                "Serialized SVG exceeds its limit.", "limit-exceeded");
            return {reinterpret_cast<const char*>(raw), static_cast<std::size_t>(size)};
        }
        void visit(xmlNode* node, std::size_t depth)
        {
            if (node->type != XML_ELEMENT_NODE)
                return;
            require(depth < 64 && ++nodes <= 1000000, "SVG tree exceeds its limit.", "limit-exceeded");
            require(!xmlHasProp(node, BAD_CAST "mask") && !xmlHasProp(node, BAD_CAST "filter")
                    && !xmlHasProp(node, BAD_CAST "opacity") && !compositing(attribute(node, "style")),
                "Masks, filters, and group opacity are unsupported.", "producer-error");
            if (named(node, "style")) {
                XmlText bytes(xmlNodeGetContent(node), xmlFree);
                if (bytes) {
                    std::string_view css(reinterpret_cast<const char*>(bytes.get()));
                    source_ids_required = source_ids_required || css.find('[') != css.npos || css.find('\\') != css.npos
                        || css.find("MainzSource") != css.npos;
                }
                require(!bytes || !compositing(reinterpret_cast<const char*>(bytes.get())),
                    "Compositing CSS is unsupported.", "producer-error");
            }
            auto id = attribute(node, "id");
            if (!id.empty())
                require(ids.emplace(id, node).second, "Duplicate SVG ID.", "producer-error");
            for (auto child = node->children; child; child = child->next)
                visit(child, depth + 1);
        }
        void walk(xmlNode* node)
        {
            if (node->type != XML_ELEMENT_NODE || named(node, "defs") || named(node, "style") || named(node, "title")
                || named(node, "desc") || named(node, "metadata"))
                return;
            if (owners.contains(node) || !branches.contains(node)) {
                auto id = attribute(node, "id");
                if (id.empty()) {
                    require(!source_ids_required, "Source paint roots need authored IDs for this stylesheet.",
                        "producer-error");
                    id = "MainzSource" + std::to_string(nodes++);
                    require(!ids.contains(id), "Generated source ID conflicts.", "producer-error");
                    xmlSetProp(node, BAD_CAST "id", BAD_CAST id.c_str());
                }
                auto target = owners.contains(node) ? owners.at(node) : "";
                if (runs.empty() || runs.back().target != target)
                    runs.push_back({{}, target});
                runs.back().ids.push_back(id);
            } else {
                require(named(node, "g"), "Selections may split only ordinary groups.", "producer-error");
                for (auto child = node->children; child; child = child->next)
                    walk(child);
            }
        }
    };
}
void render(const std::string& bytes, JSON targets, const ProduceOptions& options,
    const std::function<void(std::string, const std::string&)>& consume)
{
    Source source(bytes);
    Viewport viewport(source.svg.get(), options);
    source.select(targets, viewport);
    for (const auto& run : source.runs)
        consume(source.paint(run, viewport), run.target);
}
}
