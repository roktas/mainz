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
        (jsonl ? std::cout : std::cerr) << detail::encode(event, pipeline_limit) << '\n';
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
        detail::request_at("/inputs",
            [&] { detail::require(paths.size() == definitions.size(), "Recipe Input bindings do not match."); });
        for (const auto& [id, path] : paths) {
            (void)path;
            detail::request_at("/inputs/" + detail::pointer(id),
                [&] { detail::require(definitions.contains(id), "Unknown Recipe Input binding."); });
        }
    }
    auto root = args.options.contains("--root") ? args.options.at("--root") : ".";
    if (args.options.contains("--root"))
        check_directory(root);
    std::map<std::string, std::string> raw_inputs;
    std::map<std::string, Document> parsed_inputs;
    std::size_t remaining = pdf_limit;
    for (const auto& [id, definition] : definitions) {
        (void)definition;
        auto file = mapped ? paths.at(id) : id;
        try {
            auto bytes = mapped ? read(file, remaining) : read_at(root, file, remaining);
            remaining -= bytes.size();
            if (operation == "apply") {
                try {
                    auto document = Document::read(bytes);
                    parsed_inputs.emplace(id, std::move(document));
                    check_interrupt();
                    continue;
                } catch (const Error&) {
                    // Retain raw bytes so resolve_recipe_bound reports multi-input validation errors.
                    check_interrupt();
                    raw_inputs.emplace(id, std::move(bytes));
                    continue;
                }
            }
            raw_inputs.emplace(id, std::move(bytes));
        } catch (const Interrupt&) {
            throw;
        } catch (const Error& error) {
            auto location = "/inputs/" + detail::pointer(id);
            auto reported = error.source().empty() ? Error(error.code(), error.what(), "request", location) : error;
            auto checks = JSON::makeArray();
            auto diagnostics = JSON::makeArray();
            diagnostics.addArrayElement(JSON::parse(reported.json()));
            checks.addArrayElement(detail::dictionary(
                {{"input", JSON::makeString(id)}, {"state", JSON::makeString("error")}, {"diagnostics", diagnostics}}));
            throw Error(reported.code(), reported.what(), "request", location,
                detail::encode(
                    detail::dictionary({{"state", JSON::makeString("error")}, {"inputs", checks}}), recipe_limit));
        } catch (const std::exception& error) {
            throw std::runtime_error("Cannot bind Recipe Input " + JSON::makeString(id).unparse() + " from "
                + JSON::makeString(file).unparse() + ": " + error.what());
        }
    }
    check_interrupt();
    detail::Bindings bound;
    for (const auto& [id, document] : parsed_inputs)
        bound.emplace(id, detail::BoundInput {document.pdf(), &document});
    for (const auto& [id, bytes] : raw_inputs)
        bound.emplace(id, detail::BoundInput {bytes, nullptr});
    auto resolved = detail::resolve_recipe_bound(recipe, bound, args.options.contains("--force"));
    check_interrupt();
    bool jsonl = args.options.contains("--jsonl");
    recipe_checks(JSON::parse(resolved.checks), jsonl, args.options.contains("--verbose"));
    std::string result;
    if (operation == "resolve")
        result = resolved.plan;
    else if (operation == "align") {
        install(args.options.at("--output"), resolved.aligned, "\n");
        result = "{\"ok\":true}";
    } else {
        auto output = detail::compose_bound(resolved.plan, bound);
        install(args.options.at("--output"), output.document.pdf());
        result = output.provenance;
    }
    if (jsonl) {
        auto prefix = "{\"type\":\"result\",\"operation\":" + detail::encode(JSON::makeString(operation), json_limit)
            + ",\"result\":";
        detail::require(result.size() <= pipeline_limit - prefix.size() - 1,
            "Serialized JSON exceeds the trusted byte limit.", "limit-exceeded");
        std::cout << prefix << result << "}\n";
    } else
        std::cout << result << '\n';
}
void apply(const Arguments& args) { recipe(args, "apply"); }
void resolve(const Arguments& args) { recipe(args, "resolve"); }
void align(const Arguments& args) { recipe(args, "align"); }
}
