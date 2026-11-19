#include "command.hh"

namespace mainz::cli {
void extract(const Arguments& args)
{
    args.validate({"--pages", "--output"});
    auto document = Document::read(read(args.input, pdf_limit));
    changed(args, document.extract(read(args.options.at("--pages"), json_limit)));
}
}
