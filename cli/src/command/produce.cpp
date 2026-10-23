#include "command.hh"
#include "producer.hh"
#include <charconv>
#include <cmath>
#include <fontconfig/fontconfig.h>
#include <pango/pangocairo.h>

namespace mainz::cli {
namespace {
    // Release process-owned font caches without resetting Cairo's still-shared objects.
    struct RendererCaches {
        ~RendererCaches()
        {
            pango_cairo_font_map_set_default(nullptr);
            FcFini();
        }
    };
}
void produce(const Arguments& args)
{
    RendererCaches caches;
    args.validate({"--declaration", "--output"}, {"--width", "--height", "--dpi"});
    ProduceOptions options;
    auto dimension = [&](const std::string& key) {
        const auto& bytes = args.options.at(key);
        double n {};
        auto [end, error] = std::from_chars(bytes.data(), bytes.data() + bytes.size(), n);
        if (error != std::errc {} || end != bytes.data() + bytes.size() || !std::isfinite(n) || n <= 0)
            throw std::runtime_error("Invalid " + key + ": expected a finite positive number.");
        return n;
    };
    if (args.options.contains("--width"))
        options.width = dimension("--width");
    if (args.options.contains("--height"))
        options.height = dimension("--height");
    if (args.options.contains("--dpi"))
        options.dpi = dimension("--dpi");
    auto result
        = mainz::produce(read(args.input, pdf_limit), read(args.options.at("--declaration"), json_limit), options);
    changed(args, result);
}
}
