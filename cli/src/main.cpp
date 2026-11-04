#include "command.hh"
#include <iostream>
#include <map>
#include <string_view>

static constexpr std::string_view usage
    = "Usage: mainz COMMAND INPUT [--OPTION VALUE]; commands: describe, profiles, verify, "
      "style, reset, extract, compose, apply, resolve, align, imprint";

static int run(int argc, char* argv[])
{
    bool verify = argc > 1 && std::string_view(argv[1]) == "verify";
    bool jsonl = false;
    for (int i = 3; i < argc; ++i) {
        const std::string_view key = argv[i];
        jsonl = jsonl || key == "--jsonl";
        if (key != "--force" && key != "--verbose" && key != "--jsonl")
            ++i;
    }
    auto failure = [jsonl](JSON record) {
        if (jsonl) {
            if (!record.getDictItem("details").getDictItem("inputs").isNull())
                mainz::cli::recipe_checks(record.getDictItem("details"), true, true);
            record.addDictionaryMember("type", JSON::makeString("error"));
        }
        if (mainz::detail::text(record.getDictItem("code")) == "review-required")
            record.addDictionaryMember("message",
                JSON::makeString(
                    "Review the Input diagnostics. Retry with --force only if you accept the changed PDFs."));
        (jsonl ? std::cout : std::cerr) << mainz::detail::encode(record, mainz::pipeline_limit) << '\n';
    };
    try {
        using namespace mainz::cli;
        signals();
        if (argc == 2 && std::string_view(argv[1]) == "--help") {
            std::cout << usage << "\n";
            return 0;
        }
        if (argc == 2 && std::string_view(argv[1]) == "--version") {
            version();
            return 0;
        }
        if (argc < 3)
            throw std::runtime_error(std::string(usage));
        const std::map<std::string_view, void (*)(const Arguments&)> commands {{"describe", describe},
            {"profiles", profiles}, {"verify", mainz::cli::verify}, {"apply", apply}, {"reset", reset},
            {"extract", extract}, {"compose", compose}, {"resolve", resolve}, {"align", align}, {"style", style},
            {"imprint", imprint}};
        auto command = commands.find(argv[1]);
        if (command == commands.end())
            throw std::runtime_error("Unknown command.");
        Arguments args {argv[2], {}};
        for (int i = 3; i < argc; ++i) {
            std::string key = argv[i];
            if (key == "--force" || key == "--verbose" || key == "--jsonl") {
                if (!args.options.emplace(key, "").second)
                    throw std::runtime_error("Invalid or duplicate option.");
            } else {
                if (i + 1 >= argc || !key.starts_with("--"))
                    throw std::runtime_error("Invalid or duplicate option.");
                ++i;
                if (!args.options.emplace(key, argv[i]).second)
                    throw std::runtime_error("Invalid or duplicate option.");
            }
        }
        command->second(args);
        return 0;
    } catch (const mainz::cli::Interrupt& error) {
        if (jsonl)
            failure(mainz::detail::dictionary(
                {{"code", JSON::makeString("cancelled")}, {"message", JSON::makeString(error.what())}}));
        else
            std::cerr << "mainz: " << error.what() << '\n';
        return 130;
    } catch (const mainz::Error& error) {
        if (verify)
            std::cout << "{\"valid\":false,\"error\":" << error.json() << "}\n";
        failure(JSON::parse(error.json()));
        return 1;
    } catch (const std::exception& error) {
        if (jsonl)
            failure(mainz::detail::dictionary(
                {{"code", JSON::makeString("host-error")}, {"message", JSON::makeString(error.what())}}));
        else
            std::cerr << "mainz: " << error.what() << '\n';
        return 2;
    }
}

int main(int argc, char* argv[])
{
    auto status = run(argc, argv);
    std::cout.flush();
    if (!std::cout.good()) {
        std::cerr << "mainz: Cannot write stdout.\n";
        return 2;
    }
    return status;
}
