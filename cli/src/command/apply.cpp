#include "command.hh"
#include <utility>
#include <vector>

namespace mainz::cli {
void apply(const Arguments& args)
{
    args.validate({"--output"}, {"--request", "--profile", "--set"});
    bool profile = args.options.contains("--profile");
    if (profile == args.options.contains("--request"))
        throw std::runtime_error("Supply exactly one of --request and --profile.");
    if (args.options.contains("--set") && !profile)
        throw std::runtime_error("--set requires --profile.");
    auto document = Document::read(read(args.input, pdf_limit));
    if (!profile) {
        changed(args, document.apply(read(args.options.at("--request"), json_limit)));
        return;
    }
    if (!document.prepared())
        throw Error("missing-contract", "PDF has no mainz.json attachment.");
    auto sets = JSON::parse(document.describe()).getDictItem("profileSets");
    auto available = JSON::makeArray();
    std::vector<std::pair<JSON, JSON>> matches;
    if (!sets.isNull())
        for (const auto& set : detail::array(sets)) {
            auto ids = JSON::makeArray();
            for (const auto& choice : detail::array(set.getDictItem("profiles"))) {
                ids.addArrayElement(choice.getDictItem("id"));
                if (detail::text(choice.getDictItem("id")) == args.options.at("--profile")
                    && (!args.options.contains("--set")
                        || detail::text(set.getDictItem("id")) == args.options.at("--set")))
                    matches.emplace_back(set, choice);
            }
            available.addArrayElement(detail::dictionary({{"set", set.getDictItem("id")}, {"profiles", ids}}));
        }
    if (matches.size() != 1)
        throw std::runtime_error(
            std::string(matches.empty() ? "Unknown profile selection. " : "Ambiguous profile ID. Use --set. ")
            + "Available set and profile IDs: " + available.unparse());
    const auto& [set, choice] = matches.front();
    changed(args,
        document.apply(detail::encode(choice.getDictItem("overrides"), json_limit),
            detail::encode(set.getDictItem("parameters"), json_limit)));
}
}
