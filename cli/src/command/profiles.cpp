#include "command.hh"
#include <iostream>

namespace mainz::cli {
void profiles(const Arguments& args)
{
    args.validate({});
    auto document = Document::read(read(args.input, pdf_limit));
    auto sets = JSON::parse(document.describe()).getDictItem("profileSets");
    check_interrupt();
    std::cout << (sets.isNull() ? JSON::makeArray() : sets).unparse() << "\n";
}
}
