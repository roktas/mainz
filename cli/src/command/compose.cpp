#include "command.hh"
#include <iostream>

namespace mainz::cli {
void compose(const Arguments& args)
{
    args.validate({"--inputs", "--output"});
    auto job = read(args.input, json_limit);
    auto paths = bindings(args.options.at("--inputs"));
    std::map<std::string, std::string> inputs;
    std::size_t remaining = pdf_limit;
    for (const auto& [id, file] : paths) {
        auto bytes = read(file, remaining);
        remaining -= bytes.size();
        inputs.emplace(id, std::move(bytes));
    }
    auto result = mainz::compose(job, inputs);
    install(args.options.at("--output"), result.document.pdf());
    std::cout << result.report << "\n";
}
}
