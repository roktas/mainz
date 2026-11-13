#include "recipe.hh"
#include "contract.hh"
#include <cmath>
#include <cstdint>
#include <new>
#include <utility>

namespace mainz {
namespace {
    using namespace detail;

    void cover(JSON item)
    {
        auto value = text(item);
        constexpr std::string_view prefix = "data:image/png;base64,";
        require(value.starts_with(prefix), "A cover must be an embedded PNG.");
        require(value.size() <= std::size_t {256} * 1024, "Cover exceeds 256 KiB.", "limit-exceeded");
        auto data = std::string_view(value).substr(prefix.size());
        require(!data.empty() && data.size() % 4 == 0, "Invalid cover base64.");
        constexpr std::string_view alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        auto padding = data.ends_with("==") ? 2U : data.ends_with('=') ? 1U : 0U;
        std::uint32_t accumulator {0};
        unsigned bits {0};
        std::string header;
        for (std::size_t i = 0; i < data.size() - padding; ++i) {
            auto digit = alphabet.find(data[i]);
            require(digit != alphabet.npos, "Invalid cover base64.");
            accumulator = (accumulator << 6U) | static_cast<std::uint32_t>(digit);
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                if (header.size() < 24)
                    header.push_back(static_cast<char>((accumulator >> bits) & 255U));
            }
        }
        require(bits == padding * 2 && (accumulator & ((1U << bits) - 1)) == 0, "Invalid cover base64 padding.");
        require(header.size() == 24 && header.substr(0, 8) == std::string("\x89PNG\r\n\x1a\n", 8)
                && header.substr(8, 8) == std::string("\0\0\0\x0dIHDR", 8),
            "Invalid cover PNG header.");
        auto dimension = [&](std::size_t offset) {
            std::uint32_t result {0};
            for (std::size_t i = offset; i < offset + 4; ++i)
                result = (result << 8U) | static_cast<unsigned char>(header[i]);
            return result;
        };
        require(dimension(16) > 0 && dimension(16) <= 512 && dimension(20) > 0 && dimension(20) <= 512,
            "Cover dimensions must be from 1 to 512 pixels.", "limit-exceeded");
    }

    std::size_t integer(JSON item, std::size_t maximum)
    {
        auto value = number(item);
        require(value >= 0 && value <= static_cast<double>(maximum) && std::floor(value) == value,
            "Expected an integer within its limit.");
        return static_cast<std::size_t>(value);
    }
    void selector(JSON item, bool profile)
    {
        auto present = fields(item, profile ? std::set<std::string> {} : std::set<std::string> {"value"},
            profile ? std::set<std::string> {"set", "id", "family", "name", "all"}
                    : std::set<std::string> {"id", "family", "key", "all"});
        if (present.contains("id")) {
            require(!present.contains("family") && !present.contains("name") && !present.contains("key")
                    && !present.contains("all"),
                "Local and semantic selectors cannot be combined.");
            identifier(text(item.getDictItem("id")));
            if (profile) {
                require(present.contains("set"), "A local profile requires its set ID.");
                identifier(text(item.getDictItem("set")));
            }
        } else {
            require(
                present.contains("family") && present.contains(profile ? "name" : "key") && !present.contains("set"),
                "A semantic selector requires its family and name or key.");
            for (const auto& key : {"family", profile ? "name" : "key"}) {
                auto value = text(item.getDictItem(key));
                identifier(value);
                require(!blank(value), "Empty semantic selector.");
            }
            if (present.contains("all")) {
                bool all {false};
                require(item.getDictItem("all").getBool(all), "Selector all must be Boolean.");
            }
        }
        if (!profile) {
            auto value = item.getDictItem("value");
            std::string scalar;
            require(value.isNull() || value.getString(scalar) || value.getNumber(scalar),
                "An override requires a scalar or null reset.");
        }
    }
    JSON read_recipe(const std::string& bytes)
    {
        auto root = parse(bytes, "request", recipe_limit);
        request_at("", [&] {
            fields(root, {"version", "inputs", "sources", "parts"}, {"metadata"});
            require(number(root.getDictItem("version")) == 1, "Unsupported Recipe version.", "unsupported-version");
        });
        if (object(root).contains("metadata"))
            request_at("/metadata", [&] { document_metadata(root.getDictItem("metadata"), page_limit); });
        auto inputs = request_at("/inputs", [&] { return object(root.getDictItem("inputs")); });
        auto sources = request_at("/sources", [&] { return object(root.getDictItem("sources")); });
        require(inputs.size() <= input_limit && sources.size() <= input_limit, "Inputs or Sources exceed 32.",
            "limit-exceeded");
        for (const auto& [id, definition] : inputs)
            request_at("/inputs/" + pointer(id), [&] {
                identifier(id);
                auto present = fields(
                    definition, {}, {"sha256", "pageCount", "pageNamesSha256", "publication", "title", "cover", "xmp"});
                if (present.contains("title"))
                    require(text(definition.getDictItem("title")).size() <= 4096, "Input title exceeds 4096 bytes.",
                        "limit-exceeded");
                if (present.contains("cover"))
                    request_at("/inputs/" + pointer(id) + "/cover", [&] { cover(definition.getDictItem("cover")); });
                if (present.contains("xmp")) {
                    auto metadata = object(definition.getDictItem("xmp"));
                    require(metadata.size() <= 32, "Input XMP exceeds 32 fields.", "limit-exceeded");
                    for (const auto& [key, value] : metadata)
                        require(!key.empty() && key.size() <= 128 && text(value).size() <= 4096,
                            "Input XMP field exceeds its byte limit.", "limit-exceeded");
                }
                if (present.contains("publication"))
                    publication(definition.getDictItem("publication"));
                for (const auto& key : {"sha256", "pageNamesSha256"})
                    if (present.contains(key)) {
                        auto digest = text(definition.getDictItem(key));
                        require(digest.size() == 64 && digest.find_first_not_of("0123456789abcdef") == digest.npos,
                            "SHA-256 must contain 64 lowercase hexadecimal characters.");
                    }
                if (present.contains("pageCount"))
                    require(
                        integer(definition.getDictItem("pageCount"), page_limit) > 0, "Page count must be positive.");
            });
        std::set<std::string> used_inputs, used_sources;
        for (const auto& [id, source] : sources) {
            auto location = "/sources/" + pointer(id);
            request_at(location, [&] {
                identifier(id);
                fields(source, {"input"}, {"profiles", "overrides", "title"});
                auto input = text(source.getDictItem("input"));
                require(inputs.contains(input), "Missing Recipe Input.");
                used_inputs.insert(input);
            });
            if (object(source).contains("title"))
                request_at(location + "/title", [&] { pdf_title(source.getDictItem("title")); });
            for (const auto& key : {"profiles", "overrides"}) {
                if (!object(source).contains(key))
                    continue;
                auto items = request_at(location + "/" + key, [&] { return array(source.getDictItem(key)); });
                for (std::size_t i = 0; i < items.size(); ++i)
                    request_at(location + "/" + key + "/" + std::to_string(i),
                        [&] { selector(items[i], std::string_view(key) == "profiles"); });
            }
        }
        auto parts = request_at("/parts", [&] {
            auto items = array(root.getDictItem("parts"));
            require(!items.empty() && items.size() <= page_limit, "Recipe requires 1 to 10000 Parts.");
            return items;
        });
        for (std::size_t i = 0; i < parts.size(); ++i) {
            auto location = "/parts/" + std::to_string(i);
            auto pages = request_at(location, [&] {
                const auto& part = parts[i];
                auto present = fields(part, {"pages"}, {"copies", "front"});
                if (present.contains("copies"))
                    require(integer(part.getDictItem("copies"), 1000) > 0, "Copies must be positive.");
                if (present.contains("front")) {
                    bool front {false};
                    require(part.getDictItem("front").getBool(front), "Front must be Boolean.");
                }
                auto items = array(part.getDictItem("pages"));
                require(!items.empty() && items.size() <= page_limit, "Part requires 1 to 10000 page selectors.");
                return items;
            });
            for (std::size_t j = 0; j < pages.size(); ++j)
                request_at(location + "/pages/" + std::to_string(j), [&] {
                    const auto& page = pages[j];
                    if (object(page).contains("blank")) {
                        fields(page, {"blank"});
                        auto size = page.getDictItem("blank");
                        fields(size, {"width", "height"});
                        for (const auto& key : {"width", "height"}) {
                            auto value = number(size.getDictItem(key));
                            require(value > 0 && value <= 1000000, "Invalid Blank dimensions.");
                        }
                    } else {
                        auto present = fields(page, {"source"}, {"page", "pages"});
                        require(
                            present.contains("page") != present.contains("pages"), "Supply page or pages, not both.");
                        auto source = text(page.getDictItem("source"));
                        require(sources.contains(source), "Missing Recipe Source.");
                        used_sources.insert(source);
                        if (present.contains("page"))
                            integer(page.getDictItem("page"), page_limit - 1);
                        else
                            require(text(page.getDictItem("pages")) == "all", "Unknown page selector.");
                    }
                });
        }
        request_at("/inputs", [&] { require(used_inputs.size() == inputs.size(), "Unused Recipe Input."); });
        request_at("/sources", [&] { require(used_sources.size() == sources.size(), "Unused Recipe Source."); });
        return root;
    }
    void cardinality(JSON query, std::size_t size)
    {
        bool all {false};
        query.getDictItem("all").getBool(all);
        require(size > 0, "Unknown style selector.");
        require(size == 1 || all, "Ambiguous semantic selector; use all: true or an exact local ID.");
    }
    JSON styles(JSON source, JSON description, const std::string& location)
    {
        auto parameters = object(description.getDictItem("parameters"));
        auto sets = description.getDictItem("profileSets");
        std::map<std::string, JSON> overrides;
        std::map<std::pair<std::string, std::string>, std::vector<std::string>> semantic_parameters;
        for (const auto& [id, entry] : parameters) {
            auto parameter = entry.getDictItem("parameter");
            if (object(parameter).contains("family"))
                semantic_parameters[{text(parameter.getDictItem("family")), text(parameter.getDictItem("key"))}]
                    .push_back(id);
        }
        std::set<std::string> chosen_sets, assigned;
        auto selected_profiles = JSON::makeDictionary();
        auto profiles
            = object(source).contains("profiles") ? array(source.getDictItem("profiles")) : std::vector<JSON> {};
        for (std::size_t i = 0; i < profiles.size(); ++i)
            request_at(location + "/profiles/" + std::to_string(i), [&] {
                const auto& query = profiles[i];
                std::vector<std::pair<JSON, JSON>> matches;
                for (const auto& set : sets.isNull() ? std::vector<JSON> {} : array(sets)) {
                    bool local = object(query).contains("id");
                    if (local ? !equal(set.getDictItem("id"), query.getDictItem("set"))
                              : !equal(set.getDictItem("family"), query.getDictItem("family")))
                        continue;
                    for (const auto& profile : array(set.getDictItem("profiles")))
                        if (equal(profile.getDictItem(local ? "id" : "name"), query.getDictItem(local ? "id" : "name")))
                            matches.emplace_back(set, profile);
                }
                cardinality(query, matches.size());
                for (const auto& [set, profile] : matches) {
                    require(chosen_sets.insert(text(set.getDictItem("id"))).second, "Overlapping profile choices.");
                    selected_profiles.addDictionaryMember(text(set.getDictItem("id")), profile.getDictItem("id"));
                    for (const auto& [id, value] : object(profile.getDictItem("overrides")))
                        overrides.emplace(id, value);
                }
            });
        auto edits
            = object(source).contains("overrides") ? array(source.getDictItem("overrides")) : std::vector<JSON> {};
        for (std::size_t i = 0; i < edits.size(); ++i)
            request_at(location + "/overrides/" + std::to_string(i), [&] {
                const auto& query = edits[i];
                std::vector<std::string> matches;
                if (object(query).contains("id")) {
                    auto id = text(query.getDictItem("id"));
                    if (parameters.contains(id))
                        matches.push_back(id);
                } else {
                    auto found
                        = semantic_parameters.find({text(query.getDictItem("family")), text(query.getDictItem("key"))});
                    if (found != semantic_parameters.end())
                        matches = found->second;
                }
                cardinality(query, matches.size());
                auto value = query.getDictItem("value");
                for (const auto& id : matches) {
                    require(assigned.insert(id).second, "Duplicate parameter assignment.");
                    if (value.isNull())
                        overrides.erase(id);
                    else {
                        auto parameter = parameters.at(id).getDictItem("parameter");
                        detail::value(value, parameter.getDictItem("schema"),
                            text(parameter.getDictItem("binding").getDictItem("property")));
                        overrides.insert_or_assign(id, value);
                    }
                }
            });
        auto result = JSON::makeDictionary();
        for (const auto& [id, value] : overrides)
            result.addDictionaryMember(id, value);
        auto edited = JSON::makeArray();
        for (const auto& id : assigned)
            edited.addArrayElement(JSON::makeString(id));
        return dictionary({{"overrides", result}, {"profiles", selected_profiles}, {"edits", edited}});
    }
    JSON reference(const Document& document)
    {
        auto description = JSON::parse(document.describe());
        auto result = dictionary({{"sha256", JSON::makeString(sha256(document.pdf()))},
            {"pageCount", description.getDictItem("pageCount")}});
        std::string names = "mainz-page-names-v1\n";
        bool named = false;
        for (const auto& page : array(description.getDictItem("pages"))) {
            std::string encoded = "-;";
            if (object(page).contains("name")) {
                auto name = text(page.getDictItem("name"));
                encoded = std::to_string(name.size()) + ":" + name + ";";
                named = true;
            }
            require(encoded.size() <= manifest_limit - names.size(), "Page names exceed their byte budget.",
                "limit-exceeded");
            names += encoded;
        }
        if (named)
            result.addDictionaryMember("pageNamesSha256", JSON::makeString(sha256(names)));
        if (!description.getDictItem("publication").isNull())
            result.addDictionaryMember("publication", description.getDictItem("publication"));
        return result;
    }
    JSON diagnostic(const std::string& code, const std::string& message, const std::string& location,
        JSON expected = JSON::makeNull(), JSON actual = JSON::makeNull())
    {
        auto result = dictionary({{"code", JSON::makeString(code)}, {"message", JSON::makeString(message)},
            {"location", JSON::makeString(location)}});
        if (!expected.isNull() || !actual.isNull()) {
            result.addDictionaryMember("expected", expected);
            result.addDictionaryMember("actual", actual);
        }
        return result;
    }
    JSON check(JSON root, const std::string& id, const Document& document)
    {
        auto location = "/inputs/" + pointer(id);
        auto definition = member(root.getDictItem("inputs"), id);
        auto description = JSON::parse(document.describe());
        auto current = reference(document);
        auto diagnostics = JSON::makeArray();
        std::string state = "ready";
        auto result = [&] {
            return dictionary({{"input", JSON::makeString(id)}, {"state", JSON::makeString(state)},
                {"diagnostics", diagnostics}, {"reference", current}});
        };
        try {
            for (const auto& [source_id, source] : object(root.getDictItem("sources")))
                if (text(source.getDictItem("input")) == id)
                    static_cast<void>(styles(source, description, "/sources/" + pointer(source_id)));
            auto parts = array(root.getDictItem("parts"));
            auto sources = object(root.getDictItem("sources"));
            auto count = integer(description.getDictItem("pageCount"), page_limit);
            for (std::size_t i = 0; i < parts.size(); ++i) {
                auto pages = array(parts[i].getDictItem("pages"));
                for (std::size_t j = 0; j < pages.size(); ++j) {
                    const auto& page = pages[j];
                    if (!object(page).contains("page"))
                        continue;
                    auto source = sources.at(text(page.getDictItem("source")));
                    if (text(source.getDictItem("input")) != id)
                        continue;
                    request_at("/parts/" + std::to_string(i) + "/pages/" + std::to_string(j), [&] {
                        require(integer(page.getDictItem("page"), page_limit - 1) < count,
                            "Recipe page is outside its Input.");
                    });
                }
            }
        } catch (const Error& error) {
            state = "error";
            diagnostics.addArrayElement(JSON::parse(error.json()));
            return result();
        }
        if (equal(definition.getDictItem("sha256"), current.getDictItem("sha256")))
            return result();
        auto before = definition.getDictItem("publication");
        auto after = current.getDictItem("publication");
        if (!before.isNull() && !after.isNull() && !equal(before, after)) {
            state = "error";
            diagnostics.addArrayElement(diagnostic("input-incompatible",
                "The publication identity or compat value vetoes this Recipe. Force cannot override this restriction.",
                location + "/publication", before, after));
            return result();
        }
        if (!before.isNull() && after.isNull())
            diagnostics.addArrayElement(
                diagnostic("publication-missing", "The recorded publication declaration is missing from this PDF.",
                    location + "/publication", before, after));
        if (definition.getDictItem("sha256").isNull())
            diagnostics.addArrayElement(diagnostic("reference-missing",
                "This Recipe has no recorded PDF fingerprint. Review the selected PDF before continuing.", location));
        if (!equal(definition.getDictItem("pageCount"), current.getDictItem("pageCount")))
            diagnostics.addArrayElement(diagnostic("page-count-changed",
                "The physical page count differs from the saved reference. Existing positions can select different "
                "content.",
                location + "/pageCount", definition.getDictItem("pageCount"), current.getDictItem("pageCount")));
        auto old_names = definition.getDictItem("pageNamesSha256");
        auto new_names = current.getDictItem("pageNamesSha256");
        if (old_names.isNull() || new_names.isNull())
            diagnostics.addArrayElement(diagnostic("page-names-unverified",
                "Ordered page names are unavailable for comparison. Review the selected PDF's page positions.",
                location + "/pageNamesSha256", old_names, new_names));
        else if (!equal(old_names, new_names))
            diagnostics.addArrayElement(diagnostic("page-names-changed",
                "The ordered page names changed. Saved positions can select different content.",
                location + "/pageNamesSha256", old_names, new_names));
        else {
            std::set<std::string> names;
            bool complete = true;
            for (const auto& page : array(description.getDictItem("pages")))
                if (page.getDictItem("name").isNull() || !names.insert(text(page.getDictItem("name"))).second)
                    complete = false;
            if (!complete)
                diagnostics.addArrayElement(diagnostic("page-names-unverified",
                    "Some page names are missing or repeated. Their physical order cannot be verified.",
                    location + "/pageNamesSha256"));
        }
        state = array(diagnostics).empty() ? "update" : "review";
        if (state == "update")
            diagnostics.addArrayElement(diagnostic("input-updated",
                "The PDF changed; its recorded page sequence and Recipe choices still match.", location,
                definition.getDictItem("sha256"), current.getDictItem("sha256")));
        return result();
    }
    JSON report(JSON checks)
    {
        auto rank = [](const std::string& state) {
            return state == "error" ? 3 : state == "review" ? 2 : state == "update" ? 1 : 0;
        };
        std::string state = "ready";
        for (const auto& item : array(checks)) {
            auto next = text(item.getDictItem("state"));
            if (rank(next) > rank(state))
                state = next;
        }
        return dictionary({{"state", JSON::makeString(state)}, {"inputs", checks}});
    }

}

std::string recipe_inputs(const std::string& recipe)
{
    try {
        return detail::encode(read_recipe(recipe).getDictItem("inputs"), recipe_limit);
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Recipe allocation failed.");
    }
}
std::string recipe_reference(const Document& input)
{
    try {
        return detail::encode(reference(input), recipe_limit);
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Recipe allocation failed.");
    }
}
std::string check_recipe_input(const std::string& recipe, const std::string& id, const Document& input)
{
    try {
        auto root = read_recipe(recipe);
        detail::request_at("/inputs/" + detail::pointer(id),
            [&] { detail::require(detail::object(root.getDictItem("inputs")).contains(id), "Unknown Recipe Input."); });
        return detail::encode(check(root, id, input), recipe_limit);
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Recipe allocation failed.");
    }
}
static Resolution resolve(const std::string& recipe, const detail::Bindings& inputs, bool force)
{
    try {
        auto root = read_recipe(recipe);
        auto definitions = detail::object(root.getDictItem("inputs"));
        detail::request_at("/inputs",
            [&] { detail::require(inputs.size() == definitions.size(), "Recipe Input bindings do not match."); });
        std::size_t remaining = pdf_limit;
        for (const auto& [id, binding] : inputs) {
            const auto& bytes = binding.bytes;
            detail::request_at("/inputs/" + detail::pointer(id), [&] {
                detail::require(definitions.contains(id), "Unknown Recipe Input binding.");
                detail::require(bytes.size() <= remaining, "Aggregate Inputs exceed 128 MiB.", "limit-exceeded");
            });
            remaining -= bytes.size();
        }
        std::map<std::string, JSON> descriptions;
        std::size_t metadata_remaining = pipeline_limit;
        auto checks = JSON::makeArray();
        for (const auto& [id, definition] : definitions) {
            static_cast<void>(definition);
            auto location = "/inputs/" + detail::pointer(id);
            try {
                const auto& binding = inputs.at(id);
                auto assess = [&](const Document& document) {
                    detail::require(document.describe().size() <= metadata_remaining,
                        "Recipe metadata exceeds its byte budget.", "limit-exceeded");
                    metadata_remaining -= document.describe().size();
                    descriptions.emplace(id, JSON::parse(document.describe()));
                    checks.addArrayElement(check(root, id, document));
                };
                if (binding.document)
                    assess(*binding.document);
                else
                    assess(detail::request_at(location, [&] { return Document::read(binding.bytes); }));
            } catch (const Error& error) {
                auto diagnostics = JSON::makeArray();
                diagnostics.addArrayElement(JSON::parse(error.json()));
                checks.addArrayElement(detail::dictionary({{"input", JSON::makeString(id)},
                    {"state", JSON::makeString("error")}, {"diagnostics", diagnostics}}));
            }
        }
        auto checked = report(checks);
        auto details = detail::encode(checked, recipe_limit);
        if (detail::text(checked.getDictItem("state")) == "error")
            for (const auto& item : detail::array(checks))
                if (detail::text(item.getDictItem("state")) == "error") {
                    auto error = detail::array(item.getDictItem("diagnostics")).front();
                    throw Error(detail::text(error.getDictItem("code")), detail::text(error.getDictItem("message")),
                        "request",
                        error.getDictItem("location").isNull()
                            ? "/inputs/" + detail::pointer(detail::text(item.getDictItem("input")))
                            : detail::text(error.getDictItem("location")),
                        details);
                }
        auto sources = JSON::makeDictionary();
        auto intent = JSON::makeDictionary();
        auto source_definitions = detail::object(root.getDictItem("sources"));
        for (const auto& [id, source] : source_definitions) {
            auto input = detail::text(source.getDictItem("input"));
            auto style = styles(source, descriptions.at(input), "/sources/" + detail::pointer(id));
            auto definition = detail::dictionary(
                {{"input", JSON::makeString(input)}, {"overrides", style.getDictItem("overrides")}});
            if (detail::object(source).contains("title"))
                definition.addDictionaryMember("title", source.getDictItem("title"));
            sources.addDictionaryMember(id, definition);
            intent.addDictionaryMember(id,
                detail::dictionary(
                    {{"profiles", style.getDictItem("profiles")}, {"edits", style.getDictItem("edits")}}));
        }
        auto parts = JSON::makeArray();
        std::size_t expanded {0};
        auto declared_parts = detail::array(root.getDictItem("parts"));
        for (std::size_t i = 0; i < declared_parts.size(); ++i) {
            const auto& part = declared_parts[i];
            auto location = "/parts/" + std::to_string(i);
            auto copies = detail::object(part).contains("copies") ? integer(part.getDictItem("copies"), 1000) : 1;
            bool front {false};
            part.getDictItem("front").getBool(front);
            auto pages = JSON::makeArray();
            std::size_t length {0};
            auto append = [&](JSON page) {
                detail::require(length < page_limit / copies, "Repeated Recipe pages exceed 10000.", "limit-exceeded");
                pages.addArrayElement(page);
                ++length;
            };
            auto selectors = detail::array(part.getDictItem("pages"));
            for (std::size_t j = 0; j < selectors.size(); ++j)
                detail::request_at(location + "/pages/" + std::to_string(j), [&] {
                    const auto& page = selectors[j];
                    if (detail::object(page).contains("blank")) {
                        append(page);
                        return;
                    }
                    auto source = detail::text(page.getDictItem("source"));
                    auto input = detail::text(source_definitions.at(source).getDictItem("input"));
                    auto count = integer(descriptions.at(input).getDictItem("pageCount"), page_limit);
                    if (detail::object(page).contains("pages")) {
                        detail::require(
                            count <= page_limit / copies - length, "Recipe expansion exceeds 10000.", "limit-exceeded");
                        for (std::size_t index = 0; index < count; ++index)
                            append(detail::dictionary({{"source", JSON::makeString(source)},
                                {"page", JSON::makeNumber(std::to_string(index))}}));
                    } else {
                        detail::require(integer(page.getDictItem("page"), page_limit - 1) < count,
                            "Recipe page is outside its Input.");
                        append(page);
                    }
                });
            detail::request_at(location, [&] {
                auto count = copies * (length + (front && length % 2 ? 1 : 0)) + (front && expanded % 2 ? 1 : 0);
                detail::require(
                    count <= page_limit - expanded, "Expanded Recipe pages exceed 10000.", "limit-exceeded");
                expanded += count;
            });
            parts.addArrayElement(detail::dictionary({{"pages", pages},
                {"copies", JSON::makeNumber(std::to_string(copies))}, {"front", JSON::makeBool(front)}}));
        }
        auto plan = detail::dictionary({{"version", JSON::makeNumber("1")}, {"sources", sources}, {"parts", parts}});
        if (auto metadata = root.getDictItem("metadata"); !metadata.isNull()) {
            detail::request_at("/metadata", [&] { detail::document_metadata(metadata, expanded); });
            plan.addDictionaryMember("metadata", metadata);
        }
        auto encoded_plan = detail::encode(plan, json_limit);
        if (!force && detail::text(checked.getDictItem("state")) == "review")
            throw Error("review-required", "Review the changed Recipe Inputs before explicitly accepting them.",
                "request", "/inputs", details);
        auto aligned = JSON::makeDictionary();
        for (const auto& item : detail::array(checks)) {
            auto id = detail::text(item.getDictItem("input"));
            auto definition = JSON::makeDictionary();
            for (const auto& [key, value] : detail::object(item.getDictItem("reference")))
                definition.addDictionaryMember(key, value);
            if (detail::text(item.getDictItem("state")) == "ready")
                for (const auto& key : {"title", "cover", "xmp"})
                    if (detail::object(definitions.at(id)).contains(key))
                        definition.addDictionaryMember(key, definitions.at(id).getDictItem(key));
            aligned.addDictionaryMember(id, definition);
        }
        root.addDictionaryMember("inputs", aligned);
        return {
            std::move(encoded_plan), details, detail::encode(intent, json_limit), detail::encode(root, recipe_limit)};
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Recipe allocation failed.");
    }
}
Resolution resolve_recipe(const std::string& recipe, const std::map<std::string, std::string>& inputs, bool force)
{
    try {
        return resolve(recipe, detail::bind_inputs(inputs), force);
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Recipe allocation failed.");
    }
}
Resolution resolve_recipe(const std::string& recipe, const std::map<std::string, Document>& inputs, bool force)
{
    try {
        return resolve(recipe, detail::bind_inputs(inputs), force);
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Recipe allocation failed.");
    }
}
}
