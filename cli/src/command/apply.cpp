#include "command.hh"
#include "recipe.hh"
#include <iostream>

namespace mainz::cli {
static void recipe(const Arguments& args, bool produce)
{
    if (produce)
        args.validate({"--output"}, {"--root", "--inputs"});
    else
        args.validate({}, {"--root", "--inputs"});
    const bool mapped = args.options.contains("--inputs");
    if (mapped && args.options.contains("--root"))
        throw std::runtime_error("Use --inputs for explicit bindings or --root for filename lookup.");
    auto recipe = read(args.input, recipe_limit);
    auto definitions = detail::object(detail::parse(recipe_inputs(recipe), "request", recipe_limit));
    std::map<std::string, std::string> paths;
    if (mapped) {
        paths = bindings(args.options.at("--inputs"));
        detail::request_at("", [&] {
            detail::require(paths.size() == definitions.size(), "Recipe Input bindings do not match.");
            for (const auto& [id, path] : paths) {
                (void)path;
                detail::require(definitions.contains(id), "Unknown Recipe Input binding.");
            }
        });
    }
    auto root = args.options.contains("--root") ? args.options.at("--root") : ".";
    std::map<std::string, Document> inputs;
    std::size_t remaining = pdf_limit;
    for (const auto& [id, definition] : definitions) {
        (void)definition;
        auto file = mapped ? paths.at(id) : id;
        try {
            auto bytes = mapped ? read(file, remaining) : read_at(root, file, remaining);
            remaining -= bytes.size();
            auto document = detail::request_at(
                "/inputs/" + detail::pointer(id), [&] { return Document::read(std::move(bytes)); });
            inputs.emplace(id, std::move(document));
        } catch (const Interrupt&) {
            throw;
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
    if (!produce) {
        std::cout << resolved.plan << "\n";
        return;
    }
    auto result = mainz::compose_validated(resolved.plan, inputs);
    install(args.options.at("--output"), result.document.pdf());
    std::cout << result.provenance << "\n";
}
void apply(const Arguments& args) { recipe(args, true); }
void resolve(const Arguments& args) { recipe(args, false); }
}
