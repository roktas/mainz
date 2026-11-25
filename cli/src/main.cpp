#include "command.hh"
#include <iostream>
#include <map>
#include <string_view>

static constexpr std::string_view usage = "Usage: mainz COMMAND INPUT [OPTIONS]";
static constexpr std::string_view help = R"(
       mainz --help
       mainz --version

Commands and required options:
  describe PDF
  profiles PDF
  verify PDF
  style PDF --output PDF (--overrides JSON | --profile ID [--set ID])
  reset PDF --output PDF [--ids JSON]
  extract PDF --output PDF --pages JSON
  compose PLAN --output PDF --inputs JSON
  apply RECIPE --output PDF
  resolve RECIPE
  align RECIPE --output JSON
  imprint SVG --output PDF --declaration JSON

Recipe options: [--inputs JSON | --root DIRECTORY] [--force] [--verbose] [--jsonl]
Imprint options: [--width PIXELS] [--height PIXELS] [--dpi DPI] [--preview PNG]
)";

static bool valueless_flag(std::string_view key) { return key == "--force" || key == "--verbose" || key == "--jsonl"; }

static int run(int argc, char* argv[])
{
    const auto operation = argc > 1 ? std::string_view(argv[1]) : std::string_view {};
    const bool recipe = operation == "apply" || operation == "resolve" || operation == "align";
    bool jsonl = false;
    for (int i = 3; recipe && i < argc; ++i) {
        const std::string_view key = argv[i];
        jsonl = jsonl || key == "--jsonl";
        if (key.starts_with("--") && !valueless_flag(key))
            ++i;
    }
    try {
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
            if (argc == 2 && operation == "--help") {
                std::cout << usage << help;
                return 0;
            }
            if (argc == 2 && operation == "--version") {
                version();
                return 0;
            }
            if (argc < 3)
                throw std::runtime_error(std::string(usage));
            const std::map<std::string_view, void (*)(const Arguments&)> commands {{"describe", describe},
                {"profiles", profiles}, {"verify", mainz::cli::verify}, {"apply", apply}, {"reset", reset},
                {"extract", extract}, {"compose", compose}, {"resolve", resolve}, {"align", align}, {"style", style},
                {"imprint", imprint}};
            auto command = commands.find(operation);
            if (command == commands.end())
                throw std::runtime_error("Unknown command.");
            Arguments args {argv[2], {}};
            for (int i = 3; i < argc; ++i) {
                std::string key = argv[i];
                if (valueless_flag(key)) {
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
            auto parsed = JSON::parse(error.json());
            if (operation == "verify")
                std::cout << mainz::detail::encode(
                    mainz::detail::dictionary({{"valid", JSON::makeBool(false)}, {"error", parsed}}),
                    mainz::pipeline_limit)
                          << '\n';
            failure(std::move(parsed));
            return 1;
        } catch (const std::exception& error) {
            if (jsonl)
                failure(mainz::detail::dictionary(
                    {{"code", JSON::makeString("host-error")}, {"message", JSON::makeString(error.what())}}));
            else
                std::cerr << "mainz: " << error.what() << '\n';
            return 2;
        }
    } catch (...) {
        if (jsonl)
            std::cout << "{\"type\":\"error\",\"code\":\"host-error\",\"message\":\"CLI operation failed.\"}\n";
        else
            std::cerr << "mainz: Operation failed.\n";
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
