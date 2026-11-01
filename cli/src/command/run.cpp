#include "command.hh"
#include "recipe.hh"
#include <filesystem>
#include <iostream>

namespace mainz::cli {
void run(const Arguments& args)
{
    args.validate({"--output"}, {"--root"});
    if (args.input == "-" && !args.options.contains("--root"))
        throw std::runtime_error("Reading a Recipe from stdin requires --root.");
    auto recipe = read(args.input, json_limit);
    auto bindings = detail::object(detail::parse(recipe_inputs(recipe), "request"));
    auto root = args.options.contains("--root") ? std::filesystem::path(args.options.at("--root"))
                                                : std::filesystem::path(args.input).parent_path();
    if (root.empty())
        root = ".";
    std::map<std::string, Document> inputs;
    std::size_t remaining = pdf_limit;
    for (const auto& [id, definition] : bindings) {
        auto file = detail::text(definition.getDictItem("file"));
        try {
            auto bytes = read_at(root.string(), file, remaining);
            remaining -= bytes.size();
            auto document = detail::request_at(
                "/inputs/" + detail::pointer(id), [&] { return Document::read(std::move(bytes)); });
            inputs.emplace(id, std::move(document));
        } catch (const Error&) {
            throw;
        } catch (const std::exception& error) {
            throw std::runtime_error("Cannot bind Recipe Input " + JSON::makeString(id).unparse() + " from "
                + JSON::makeString(file).unparse() + ": " + error.what());
        }
    }
    auto resolved = resolve_recipe(recipe, inputs);
    for (const auto& warning : detail::array(JSON::parse(resolved.warnings)))
        std::cerr << warning.unparse() << "\n";
    check_interrupt();
    auto result = mainz::compose_validated(resolved.job, inputs);
    install(args.options.at("--output"), result.document.pdf());
    std::cout << result.report << "\n";
}
}
