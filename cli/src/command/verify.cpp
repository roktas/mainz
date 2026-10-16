#include "command.hh"
#include <iostream>

namespace mainz::cli {
void verify(const Arguments& args)
{
    args.validate({});
    auto document = Document::read(read(args.input, pdf_limit));
    check_interrupt();
    if (!document.prepared())
        throw Error("missing-contract", "PDF has no mainz.json attachment.");
    std::cout << "{\"valid\":true,\"version\":1}\n";
}
}
