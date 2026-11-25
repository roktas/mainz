#include "command.hh"
#include <iostream>

namespace mainz::cli {
void describe(const Arguments& args)
{
    args.validate({});
    auto document = Document::read(read(args.input, pdf_limit));
    check_interrupt();
    std::cout << document.describe() << "\n";
}
}
