#include "command.hh"

namespace mainz::cli {
void apply(const Arguments& args)
{
    args.validate({"--request", "--output"});
    auto document = Document::read(read(args.input, pdf_limit));
    changed(args, document.apply(read(args.options.at("--request"), json_limit)));
}
}
