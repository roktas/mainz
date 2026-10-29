#include "command.hh"
#include <iostream>

namespace mainz::cli {
void compose(const Arguments& args)
{
    args.validate({"--inputs", "--output"});
    auto job = read(args.input, json_limit);
    auto bindings = detail::request_at(
        "", [&] { return detail::object(detail::parse(read(args.options.at("--inputs"), json_limit), "request")); });
    detail::require(bindings.size() <= input_limit, "Inputs exceed 32.", "limit-exceeded");
    std::map<std::string, std::string> inputs;
    std::size_t remaining = pdf_limit;
    for (const auto& [id, path] : bindings) {
        auto file = detail::request_at("/" + detail::pointer(id), [&] {
            detail::identifier(id, "invalid-request");
            return detail::text(path);
        });
        if (file == "-")
            throw std::runtime_error("Compose PDF bindings require file paths.");
        auto bytes = read(file, remaining);
        remaining -= bytes.size();
        inputs.emplace(id, std::move(bytes));
    }
    auto result = mainz::compose(job, inputs);
    install(args.options.at("--output"), result.document.pdf());
    std::cout << result.report << "\n";
}
}
