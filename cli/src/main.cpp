#include "command.hh"
#include <iostream>
#include <map>
#include <string_view>

static int run(int argc, char* argv[])
{
    bool verify = argc > 1 && std::string_view(argv[1]) == "verify";
    try {
        using namespace mainz::cli;
        signals();
        if (argc == 2 && std::string_view(argv[1]) == "--version") {
            version();
            return 0;
        }
        if (argc < 3)
            throw std::runtime_error(
                "Usage: mainz COMMAND INPUT [--OPTION VALUE]; commands: describe, profiles, verify, "
                "apply, reset, extract, compose, produce");
        const std::map<std::string_view, void (*)(const Arguments&)> commands {{"describe", describe},
            {"profiles", profiles}, {"verify", mainz::cli::verify}, {"apply", apply}, {"reset", reset},
            {"extract", extract}, {"compose", compose}, {"produce", produce}};
        auto command = commands.find(argv[1]);
        if (command == commands.end())
            throw std::runtime_error("Unknown command.");
        Arguments args {argv[2], {}};
        for (int i = 3; i < argc; i += 2) {
            std::string key = argv[i];
            if (i + 1 >= argc || !key.starts_with("--") || !args.options.emplace(key, argv[i + 1]).second)
                throw std::runtime_error("Invalid or duplicate option.");
        }
        command->second(args);
        return 0;
    } catch (const mainz::cli::Interrupt& error) {
        std::cerr << "mainz: " << error.what() << '\n';
        return 130;
    } catch (const mainz::Error& error) {
        if (verify)
            std::cout << "{\"valid\":false,\"error\":" << error.json() << "}\n";
        std::cerr << error.json() << '\n';
        return 1;
    } catch (const std::exception& error) {
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
