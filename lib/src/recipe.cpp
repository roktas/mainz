#include "recipe.hh"
#include "contract.hh"
#include <cmath>
#include <cstdint>
#include <new>

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
                auto present = fields(definition, {}, {"sha256", "pageCount", "publication", "title", "cover", "xmp"});
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
                if (present.contains("sha256")) {
                    auto digest = text(definition.getDictItem("sha256"));
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
                fields(source, {"input"}, {"profiles", "overrides"});
                auto input = text(source.getDictItem("input"));
                require(inputs.contains(input), "Missing Recipe Input.");
                used_inputs.insert(input);
            });
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
}

std::string recipe_inputs(const std::string& recipe)
{
    try {
        return detail::encode(read_recipe(recipe).getDictItem("inputs"), recipe_limit);
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Recipe allocation failed.");
    }
}
static Resolution resolve(const std::string& recipe, const detail::Bindings& inputs)
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
        auto warnings = JSON::makeArray();
        for (const auto& [id, definition] : definitions) {
            auto location = "/inputs/" + detail::pointer(id);
            auto description = detail::request_at(location, [&] {
                auto describe = [&](const Document& document) {
                    const auto& description = document.describe();
                    detail::require(description.size() <= metadata_remaining,
                        "Recipe metadata exceeds its byte budget.", "limit-exceeded");
                    metadata_remaining -= description.size();
                    return JSON::parse(description);
                };
                const auto& binding = inputs.at(id);
                return binding.document ? describe(*binding.document) : describe(Document::read(binding.bytes));
            });
            if (detail::object(definition).contains("pageCount"))
                detail::request_at(location + "/pageCount", [&] {
                    detail::require(
                        detail::equal(definition.getDictItem("pageCount"), description.getDictItem("pageCount")),
                        "Input page count does not match its explicit expectation.");
                });
            auto recorded_publication = definition.getDictItem("publication");
            auto current_publication = description.getDictItem("publication");
            bool compatible = !recorded_publication.isNull() && !current_publication.isNull()
                && detail::compatible_publication(recorded_publication, current_publication);
            bool publication_changed = !recorded_publication.isNull() && !compatible
                && !detail::equal(recorded_publication, current_publication);
            if (publication_changed)
                warnings.addArrayElement(detail::dictionary({{"code", JSON::makeString("input-incompatible")},
                    {"input", JSON::makeString(id)}, {"location", JSON::makeString(location + "/publication")},
                    {"message", JSON::makeString("Input has no compatible forward publication declaration.")},
                    {"expected", recorded_publication}, {"actual", current_publication}}));
            if (detail::object(definition).contains("sha256") && !compatible && !publication_changed) {
                const auto& bytes = inputs.at(id).bytes;
                auto actual = detail::sha256(bytes);
                if (actual != detail::text(definition.getDictItem("sha256")))
                    warnings.addArrayElement(detail::dictionary({{"code", JSON::makeString("input-changed")},
                        {"input", JSON::makeString(id)}, {"location", JSON::makeString(location + "/sha256")},
                        {"message",
                            JSON::makeString(
                                "Input bytes changed; fixed page references can select different content.")},
                        {"expected", definition.getDictItem("sha256")}, {"actual", JSON::makeString(actual)}}));
            }
            descriptions.emplace(id, description);
        }
        auto sources = JSON::makeDictionary();
        auto intent = JSON::makeDictionary();
        auto source_definitions = detail::object(root.getDictItem("sources"));
        for (const auto& [id, source] : source_definitions) {
            auto input = detail::text(source.getDictItem("input"));
            auto style = styles(source, descriptions.at(input), "/sources/" + detail::pointer(id));
            sources.addDictionaryMember(id,
                detail::dictionary(
                    {{"input", JSON::makeString(input)}, {"overrides", style.getDictItem("overrides")}}));
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
        return {
            detail::encode(plan, json_limit), detail::encode(warnings, json_limit), detail::encode(intent, json_limit)};
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Recipe allocation failed.");
    }
}
Resolution resolve_recipe(const std::string& recipe, const std::map<std::string, std::string>& inputs)
{
    try {
        return resolve(recipe, detail::bind_inputs(inputs));
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Recipe allocation failed.");
    }
}
Resolution resolve_recipe(const std::string& recipe, const std::map<std::string, Document>& inputs)
{
    try {
        return resolve(recipe, detail::bind_inputs(inputs));
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Recipe allocation failed.");
    }
}
}
