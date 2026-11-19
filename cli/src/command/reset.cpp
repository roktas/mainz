#include "command.hh"
#include <optional>

namespace mainz::cli {
void reset(const Arguments& args)
{
    args.validate({"--output"}, {"--ids"});
    auto document = Document::read(read(args.input, pdf_limit));
    changed(args,
        document.reset(args.options.contains("--ids")
                ? std::optional<std::string>(read(args.options.at("--ids"), json_limit))
                : std::nullopt));
}
}
