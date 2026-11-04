#include "recipe.hh"
#include "command.hh"
#include <iostream>

namespace mainz::cli {
void recipe_checks(JSON report, bool jsonl, bool verbose)
{
    for (const auto& input : detail::array(report.getDictItem("inputs"))) {
        if (!jsonl && !verbose && detail::text(input.getDictItem("state")) != "review")
            continue;
        auto event = JSON::makeDictionary();
        for (const auto& [key, value] : detail::object(input))
            event.addDictionaryMember(key, value);
        event.addDictionaryMember("type", JSON::makeString("input"));
        (jsonl ? std::cout : std::cerr) << detail::encode(event, recipe_limit) << '\n';
    }
}
static void recipe(const Arguments& args, const std::string& operation)
{
    if (operation != "resolve")
        args.validate({"--output"}, {"--root", "--inputs", "--force", "--verbose", "--jsonl"});
    else
        args.validate({}, {"--root", "--inputs", "--force", "--verbose", "--jsonl"});
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
        } catch (const Error& error) {
            auto checks = JSON::makeArray();
            auto diagnostics = JSON::makeArray();
            diagnostics.addArrayElement(JSON::parse(error.json()));
            checks.addArrayElement(detail::dictionary(
                {{"input", JSON::makeString(id)}, {"state", JSON::makeString("error")}, {"diagnostics", diagnostics}}));
            auto record = JSON::parse(error.json());
            throw Error(detail::text(record.getDictItem("code")), detail::text(record.getDictItem("message")),
                "request", "/inputs/" + detail::pointer(id),
                detail::encode(
                    detail::dictionary({{"state", JSON::makeString("error")}, {"inputs", checks}}), recipe_limit));
        } catch (const std::exception& error) {
            throw std::runtime_error("Cannot bind Recipe Input " + JSON::makeString(id).unparse() + " from "
                + JSON::makeString(file).unparse() + ": " + error.what());
        }
    }
    auto resolved = resolve_recipe(recipe, inputs, args.options.contains("--force"));
    bool jsonl = args.options.contains("--jsonl");
    recipe_checks(JSON::parse(resolved.checks), jsonl, args.options.contains("--verbose"));
    check_interrupt();
    std::string result;
    if (operation == "resolve")
        result = resolved.plan;
    else if (operation == "align") {
        install(args.options.at("--output"), resolved.aligned + "\n");
        result = "{\"ok\":true}";
    } else {
        auto output = mainz::compose_validated(resolved.plan, inputs);
        install(args.options.at("--output"), output.document.pdf());
        result = output.provenance;
    }
    if (jsonl)
        std::cout << detail::encode(detail::dictionary({{"type", JSON::makeString("result")},
                                        {"operation", JSON::makeString(operation)}, {"result", JSON::parse(result)}}),
            pipeline_limit)
                  << '\n';
    else
        std::cout << result << '\n';
}
void apply(const Arguments& args) { recipe(args, "apply"); }
void resolve(const Arguments& args) { recipe(args, "resolve"); }
void align(const Arguments& args) { recipe(args, "align"); }
}
