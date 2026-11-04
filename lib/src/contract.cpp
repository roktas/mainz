#include "contract.hh"
#include "pipeline.hh"
#include <algorithm>
#include <charconv>
#include <cmath>
#include <limits>
#include <qpdf/BufferInputSource.hh>
#include <qpdf/QPDFCryptoProvider.hh>
#include <qpdf/QUtil.hh>

namespace mainz {
Error::Error(const std::string& code, const std::string& message, const std::string& source,
    const std::string& location, const std::string& details)
    : std::runtime_error(message)
    , code_(code)
    , source_(source)
{
    auto result = detail::dictionary({{"code", JSON::makeString(code)}, {"message", JSON::makeString(message)}});
    if (!source.empty()) {
        result.addDictionaryMember("source", JSON::makeString(source));
        result.addDictionaryMember("location", JSON::makeString(location));
    }
    if (!details.empty())
        result.addDictionaryMember("details", JSON::parse(details));
    record = result.unparse();
}
}

namespace mainz::detail {
std::string sha256(std::string_view bytes)
{
    auto digest = QPDFCryptoProvider::getImpl();
    digest->SHA2_init(256);
    digest->SHA2_update(reinterpret_cast<const unsigned char*>(bytes.data()), bytes.size());
    digest->SHA2_finalize();
    return QUtil::hex_encode(digest->SHA2_digest());
}
void require(bool ok, std::string_view message, std::string_view code)
{
    if (!ok)
        throw Error(std::string(code), std::string(message));
}
std::string pointer(const std::string& key)
{
    std::string result;
    for (char c : key)
        result += c == '~' ? "~0" : c == '/' ? "~1" : std::string(1, c);
    return result;
}
static void unicode(
    const std::string& string, bool id = false, std::string_view code = "invalid-contract", std::size_t limit = 4096)
{
    require(string.size() <= limit, "JSON string exceeds " + std::to_string(limit) + " bytes.", "limit-exceeded");
    require(!id || !string.empty(), "An ID must not be empty.", code);
    std::size_t position = 0;
    while (position < string.size()) {
        bool error = false;
        auto c = QUtil::get_next_utf8_codepoint(string, position, error);
        require(!error && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff), "Invalid Unicode.", code);
        require(!id || (c >= 32 && !(c >= 127 && c <= 159)), "An ID contains a control character.", code);
    }
}
void identifier(const std::string& string, std::string_view code) { unicode(string, true, code); }
class Guard : public JSON::Reactor {
public:
    explicit Guard(std::size_t limit, bool covers = false)
        : limit(limit)
        , covers(covers)
    {
    }
    void dictionaryStart() override { start(); }
    void arrayStart() override { start(); }
    void containerEnd(JSON const&) override { keys.pop_back(); }
    void topLevelScalar() override { }
    bool dictionaryItem(const std::string& key, JSON const& item) override
    {
        unicode(key);
        require(keys.back().insert(key).second, "Duplicate JSON member: " + key);
        check(item, key == "cover");
        return false;
    }
    bool arrayItem(JSON const& item) override
    {
        check(item);
        return false;
    }

private:
    std::vector<std::set<std::string>> keys;
    std::size_t count {0};
    std::size_t limit;
    bool covers;
    void start()
    {
        require(keys.size() < 32, "JSON nesting exceeds 32.", "limit-exceeded");
        keys.emplace_back();
    }
    void check(JSON item, bool cover = false)
    {
        require(++count <= limit, "JSON item count exceeds the trusted limit.", "limit-exceeded");
        std::string string;
        if (item.getString(string))
            unicode(string, false, "invalid-contract", covers && cover ? std::size_t {256} * 1024 : 4096);
        if (item.getNumber(string))
            number(item);
    }
};
JSON parse(const std::string& bytes, const std::string& source, std::size_t limit)
{
    try {
        const auto ceiling = source == "manifest" ? manifest_limit : limit;
        require(bytes.size() <= ceiling, "JSON exceeds the trusted byte limit.", "limit-exceeded");
        require(!bytes.starts_with("\xef\xbb\xbf"), "A JSON byte-order mark is not permitted.");
        // Validate the complete encoding before QPDF decodes escapes.
        std::size_t position = 0;
        while (position < bytes.size()) {
            bool error = false;
            auto c = QUtil::get_next_utf8_codepoint(bytes, position, error);
            require(!error && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff), "Invalid JSON UTF-8.");
        }
        BufferInputSource input("Mainz JSON", bytes);
        Guard guard(source == "manifest" ? 2000000 : 50000, source == "request" && limit == recipe_limit);
        return JSON::parse(input, &guard);
    } catch (const Error& error) {
        auto code = error.code();
        if (code != "limit-exceeded")
            code = source == "request" ? "invalid-request" : "invalid-contract";
        throw Error(code, error.what(), source, "");
    } catch (const std::exception& error) {
        throw Error(source == "request" ? "invalid-request" : "invalid-contract", error.what(), source, "");
    }
}
std::string text(JSON item)
{
    std::string result;
    require(item.getString(result), "Expected a string.");
    return result;
}
double number(JSON item)
{
    std::string encoded;
    require(item.getNumber(encoded), "Expected a number.");
    double result {};
    auto [end, error] = std::from_chars(encoded.data(), encoded.data() + encoded.size(), result);
    require(error == std::errc {} && end == encoded.data() + encoded.size() && std::isfinite(result),
        "Number is not a finite binary64 value.");
    return result;
}
double pdf_number(std::string_view string)
{
    if (string.starts_with('+')) {
        string.remove_prefix(1);
        require(!string.starts_with('-'), "Invalid PDF numeric string.");
    }
    double result {};
    auto [end, error] = std::from_chars(string.data(), string.data() + string.size(), result, std::chars_format::fixed);
    require(error != std::errc::invalid_argument && end == string.data() + string.size() && std::isfinite(result),
        "Invalid PDF numeric string.");
    require(error == std::errc {}, "Number is not a finite binary64 value.");
    return result;
}
std::string decimal(double n)
{
    require(std::isfinite(n), "Unrepresentable style number.", "unsupported-context");
    std::array<char, 32> buffer {};
    auto [end, error] = std::to_chars(buffer.data(), buffer.data() + buffer.size(), n);
    require(error == std::errc {}, "Cannot serialize style number.");
    std::string result(buffer.data(), end);
    auto exponent = result.find('e');
    if (exponent == std::string::npos)
        return result;
    int power = std::stoi(result.substr(exponent + 1));
    auto mantissa = result.substr(0, exponent);
    bool negative = mantissa.starts_with('-');
    if (negative)
        mantissa.erase(0, 1);
    auto dot = mantissa.find('.');
    int point = static_cast<int>(dot == std::string::npos ? mantissa.size() : dot) + power;
    if (dot != std::string::npos)
        mantissa.erase(dot, 1);
    if (point <= 0)
        result = "0." + std::string(static_cast<std::size_t>(-point), '0') + mantissa;
    else if (point >= static_cast<int>(mantissa.size()))
        result = mantissa + std::string(point - mantissa.size(), '0');
    else {
        mantissa.insert(point, ".");
        result = mantissa;
    }
    return (negative ? "-" : "") + result;
}
std::vector<JSON> array(JSON item)
{
    require(item.isArray(), "Expected an array.");
    std::vector<JSON> result;
    item.forEachArrayItem([&](JSON child) { result.push_back(child); });
    return result;
}
std::map<std::string, JSON> object(JSON item)
{
    require(item.isDictionary(), "Expected an object.");
    std::map<std::string, JSON> result;
    // QPDF exposes dictionary keys in JSON-escaped form.
    item.forEachDictItem([&](const std::string& key, JSON child) {
        result.emplace(key.find('\\') == key.npos ? key : text(JSON::parse("\"" + key + "\"")), child);
    });
    return result;
}
JSON member(JSON item, const std::string& key)
{
    if (std::none_of(key.begin(), key.end(), [](unsigned char c) { return c < 32 || c == '"' || c == '\\'; }))
        return item.getDictItem(key);
    auto encoded = JSON::makeString(key).unparse();
    return item.getDictItem(encoded.substr(1, encoded.size() - 2));
}
std::set<std::string> fields(JSON item, const std::set<std::string>& required, const std::set<std::string>& optional)
{
    std::set<std::string> present;
    for (const auto& [key, child] : object(item)) {
        (void)child;
        require(required.contains(key) || optional.contains(key), "Unknown field: " + key);
        present.insert(key);
    }
    for (const auto& key : required)
        require(present.contains(key), "Missing field: " + key);
    return present;
}
JSON dictionary(std::initializer_list<std::pair<std::string, JSON>> members)
{
    auto result = JSON::makeDictionary();
    for (const auto& [key, child] : members)
        result.addDictionaryMember(key, child);
    return result;
}
std::string encode(JSON item, std::size_t limit, std::size_t& remaining)
{
    Buffer output(limit, remaining);
    CompactJSON compact(output);
    item.write(&compact);
    return std::move(output.bytes);
}
std::string encode(JSON item, std::size_t limit)
{
    auto remaining = limit;
    return encode(item, limit, remaining);
}
bool equal(JSON a, JSON b)
{
    std::string encoded;
    if (a.getNumber(encoded) && b.getNumber(encoded))
        return number(a) == number(b);
    return a.unparse() == b.unparse();
}
bool numeric_property(const std::string& property)
{
    return property == "stroke-width" || property == "stroke-opacity" || property == "fill-opacity";
}
static bool color_property(const std::string& property)
{
    return property == "stroke-color" || property == "fill-color";
}
static void domain(JSON item, const std::string& property)
{
    if (numeric_property(property)) {
        double n = number(item);
        require(property == "stroke-width" ? n > 0 : n >= 0 && n <= 1, "Style number is outside the property domain.");
    } else if (color_property(property)) {
        auto color = text(item);
        require(color.size() == 7 && color[0] == '#'
                && color.find_first_not_of("0123456789abcdefABCDEF", 1) == std::string::npos,
            "Invalid RGB color.");
    } else
        require(property == "display" && (text(item) == "inline" || text(item) == "none"), "Invalid display value.");
}
static bool within_bounds(JSON item, JSON schema)
{
    auto members = object(schema);
    auto n = number(item);
    bool admitted = true;
    for (const auto& key : {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"}) {
        if (!members.contains(key))
            continue;
        auto bound = number(members.at(key));
        admitted = admitted
            && (key == std::string("minimum")                ? n >= bound
                    : key == std::string("maximum")          ? n <= bound
                    : key == std::string("exclusiveMinimum") ? n > bound
                                                             : n < bound);
    }
    return admitted;
}
void value(JSON item, JSON schema, const std::string& property)
{
    domain(item, property);
    auto members = object(schema);
    if (numeric_property(property))
        require(within_bounds(item, schema), "Value violates a schema bound.");
    if (members.contains("enum")) {
        auto choices = array(members.at("enum"));
        require(std::any_of(choices.begin(), choices.end(), [&](JSON choice) { return equal(item, choice); }),
            "Value is not in the schema enum.");
    }
}
Bindings bind_inputs(const std::map<std::string, std::string>& inputs)
{
    require(inputs.size() <= input_limit, "Inputs exceed 32.", "limit-exceeded");
    Bindings bindings;
    for (const auto& [id, bytes] : inputs)
        bindings.emplace(id, BoundInput {bytes});
    return bindings;
}
Bindings bind_inputs(const std::map<std::string, Document>& inputs)
{
    require(inputs.size() <= input_limit, "Inputs exceed 32.", "limit-exceeded");
    Bindings bindings;
    for (const auto& [id, document] : inputs)
        bindings.emplace(id, BoundInput {document.pdf(), &document});
    return bindings;
}
bool blank(const std::string& value)
{
    // Match the whitespace removed by ECMAScript String.trim() in annotation consumers.
    static constexpr std::u32string_view spaces = U"\t\n\v\f\r "
                                                  U"\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008"
                                                  U"\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
    std::size_t position = 0;
    while (position < value.size()) {
        bool error = false;
        auto c = QUtil::get_next_utf8_codepoint(value, position, error);
        require(!error, "Invalid Unicode.");
        if (spaces.find(static_cast<char32_t>(c)) == spaces.npos)
            return false;
    }
    return true;
}
void publication(JSON item, const std::string& source)
{
    try {
        fields(item, {"id", "compat"});
        auto id = text(item.getDictItem("id"));
        identifier(id);
        require(!blank(id), "Empty publication identity.");
        auto compat = number(item.getDictItem("compat"));
        require(compat >= 1 && compat <= 9007199254740991.0 && std::floor(compat) == compat,
            "Publication compat must be a positive safe integer.");
    } catch (const Error& error) {
        throw Error(error.code(), error.what(), source, "/publication");
    }
}
void semantics(const std::map<std::string, JSON>& parameters, const std::string& source)
{
    std::map<std::pair<std::string, std::string>, std::string> properties;
    for (const auto& [id, parameter] : parameters) {
        try {
            auto present = object(parameter);
            require(present.contains("family") == present.contains("key"), "Style family and key must occur together.");
            if (!present.contains("family"))
                continue;
            auto family = text(parameter.getDictItem("family")), key = text(parameter.getDictItem("key"));
            identifier(family);
            identifier(key);
            require(!blank(family) && !blank(key), "Empty Style family or key.");
            auto property = text(parameter.getDictItem("binding").getDictItem("property"));
            auto [item, added] = properties.emplace(std::make_pair(family, key), property);
            require(added || item->second == property, "Semantic key has conflicting paint properties.");
        } catch (const Error& error) {
            throw Error(error.code(), error.what(), source, "/parameters/" + pointer(id));
        }
    }
}
void annotations(JSON item, const std::set<std::string>& present)
{
    if (present.contains("description")) {
        auto description = text(item.getDictItem("description"));
        if (present.contains("details"))
            require(!blank(description), "Details require a nonempty description.");
    } else
        require(!present.contains("details"), "Details require a description.");
    if (present.contains("details"))
        text(item.getDictItem("details"));
}
void schema(JSON item, const std::string& property)
{
    std::set<std::string> optional {"$schema", "enum", "title", "description", "details", "default"};
    if (numeric_property(property))
        for (auto key : {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"})
            optional.insert(key);
    if (color_property(property))
        optional.insert("pattern");
    auto present = fields(item, {"type"}, optional);
    require(text(item.getDictItem("type")) == (numeric_property(property) ? "number" : "string"),
        "Schema type disagrees with property.");
    if (present.contains("$schema"))
        require(text(item.getDictItem("$schema")) == "https://json-schema.org/draft/2020-12/schema",
            "Unsupported schema dialect.");
    if (present.contains("title"))
        text(item.getDictItem("title"));
    annotations(item, present);
    if (present.contains("pattern"))
        require(text(item.getDictItem("pattern")) == "^#[0-9a-fA-F]{6}$", "Unsupported color pattern.");
    if (present.contains("enum")) {
        auto choices = array(item.getDictItem("enum"));
        require(!choices.empty(), "Empty enum.");
        bool admitted = false;
        std::set<double> numbers;
        std::set<std::string> strings;
        for (const auto& choice : choices) {
            domain(choice, property);
            require(numeric_property(property) ? numbers.insert(number(choice)).second
                                               : strings.insert(text(choice)).second,
                "Duplicate enum value.");
            // Enum and bounds intersect; an excluded choice does not invalidate the enum.
            admitted = (numeric_property(property) ? within_bounds(choice, item) : true) || admitted;
        }
        require(admitted, "Schema admits no property value.");
    } else if (numeric_property(property)) {
        double low = property == "stroke-width" ? std::numeric_limits<double>::denorm_min() : 0;
        double high = property == "stroke-width" ? std::numeric_limits<double>::max() : 1;
        for (auto key : {"minimum", "exclusiveMinimum", "maximum", "exclusiveMaximum"}) {
            if (!present.contains(key))
                continue;
            double bound = number(item.getDictItem(key));
            if (key == std::string("exclusiveMinimum"))
                bound = std::nextafter(bound, INFINITY);
            if (key == std::string("exclusiveMaximum"))
                bound = std::nextafter(bound, -INFINITY);
            if (key == std::string("minimum") || key == std::string("exclusiveMinimum"))
                low = std::max(low, bound);
            else
                high = std::min(high, bound);
        }
        require(std::isfinite(low) && std::isfinite(high) && low <= high, "Schema admits no property value.");
    }
    if (property == "display") {
        require(present.contains("enum"), "Display requires an enum.");
        auto choices = array(item.getDictItem("enum"));
        require(choices.size() == 2 && !equal(choices[0], choices[1]), "Display enum must contain inline and none.");
    }
    if (present.contains("default"))
        value(item.getDictItem("default"), item, property);
}
static std::vector<std::string> ids(JSON item, bool nonempty = true)
{
    std::vector<std::string> result;
    std::set<std::string> unique;
    for (const auto& child : array(item)) {
        auto id = text(child);
        unicode(id, true);
        require(unique.insert(id).second, "Duplicate ID: " + id);
        result.push_back(id);
    }
    require(!nonempty || !result.empty(), "Empty ID array.");
    return result;
}
static void resource(JSON item)
{
    auto name = text(item);
    auto letter = [](char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); };
    require(!name.empty() && letter(name.front())
            && std::all_of(name.begin() + 1, name.end(),
                [&](char c) { return letter(c) || (c >= '0' && c <= '9') || c == '.' || c == '-'; }),
        "Invalid resource name.");
}
static void color(JSON item, bool stroke)
{
    fields(item, {"operator", "operands"});
    auto op = text(item.getDictItem("operator"));
    require(stroke ? op == "G" || op == "RG" : op == "g" || op == "rg", "Invalid baseline color operator.");
    auto operands = array(item.getDictItem("operands"));
    require(operands.size() == (op.size() == 1 ? 1 : 3), "Invalid color operand count.");
    for (const auto& child : operands) {
        auto n = pdf_number(text(child));
        require(n >= 0 && n <= 1, "Invalid baseline color component.");
    }
}
std::vector<JSON> locators(JSON root, JSON region)
{
    auto direct = region.getDictItem("records");
    return array(
        direct.isNull() ? member(root.getDictItem("recordSets"), text(region.getDictItem("recordSet"))) : direct);
}
std::string baseline_ref(JSON region, JSON record)
{
    auto id = text(record.getDictItem("baseline"));
    auto refs = region.getDictItem("baselineRefs");
    return refs.isNull() ? id : text(member(refs, id));
}
void profile_sets(JSON sets, const std::map<std::string, JSON>& parameters)
{
    auto items = array(sets);
    std::set<std::string> set_ids, owned;
    for (const auto& set : items) {
        auto present = fields(set, {"id", "name", "parameters", "profiles"}, {"family", "description", "details"});
        if (present.contains("family")) {
            auto family = text(set.getDictItem("family"));
            identifier(family);
            require(!blank(family), "Empty Style family.");
        }
        auto id = text(set.getDictItem("id"));
        identifier(id);
        require(set_ids.insert(id).second, "Duplicate profile set ID.");
        require(
            text(set.getDictItem("name")).find_first_not_of(" \t\r\n") != std::string::npos, "Empty profile set name.");
        annotations(set, present);
        std::set<std::string> scope;
        for (const auto& parameter : ids(set.getDictItem("parameters"))) {
            require(parameters.contains(parameter) && owned.insert(parameter).second,
                "Unknown or repeated profile parameter.");
            scope.insert(parameter);
        }
        auto profiles = array(set.getDictItem("profiles"));
        require(!profiles.empty() && profiles.size() <= 32, "A profile set requires 1 to 32 profiles.");
        std::set<std::string> profile_ids, profile_names;
        for (const auto& profile : profiles) {
            auto fields_present = fields(profile, {"id", "name", "overrides"}, {"description", "details"});
            auto identity = text(profile.getDictItem("id"));
            identifier(identity);
            require(profile_ids.insert(identity).second, "Duplicate profile ID.");
            require(text(profile.getDictItem("name")).find_first_not_of(" \t\r\n") != std::string::npos,
                "Empty profile name.");
            if (present.contains("family"))
                require(profile_names.insert(text(profile.getDictItem("name"))).second,
                    "Duplicate profile name in a Style family.");
            annotations(profile, fields_present);
            for (const auto& [parameter, choice] : object(profile.getDictItem("overrides"))) {
                require(scope.contains(parameter), "Override is outside its profile set.");
                const auto& definition = parameters.at(parameter);
                value(choice, definition.getDictItem("schema"),
                    text(definition.getDictItem("binding").getDictItem("property")));
            }
        }
        require(object(profiles.front().getDictItem("overrides")).empty(),
            "The first profile must restore original styles.");
    }
}
void document_metadata(JSON metadata, std::size_t pages)
{
    fields(metadata, {"title", "coverPage"});
    auto title = text(metadata.getDictItem("title"));
    require(!blank(title) && title.size() <= 4096, "PDF title requires 1 to 4096 bytes.");
    std::size_t position {0};
    while (position < title.size()) {
        bool error {false};
        auto code = QUtil::get_next_utf8_codepoint(title, position, error);
        require(!error
                && (code == 9 || code == 10 || code == 13 || (code >= 32 && code <= 0xd7ff)
                    || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff)),
            "PDF title contains invalid XML text.");
    }
    auto page = number(metadata.getDictItem("coverPage"));
    require(page >= 1 && page <= static_cast<double>(pages) && std::floor(page) == page,
        "Cover page must identify a physical Output page.");
}

void page_metadata(JSON page)
{
    auto present = fields(page, {}, {"name", "tags", "preview"});
    for (const auto& key : {"name", "preview"})
        if (present.contains(key)) {
            auto string = text(page.getDictItem(key));
            unicode(string, true);
            require(!blank(string), "Page text must contain non-whitespace characters.");
        }
    if (present.contains("tags")) {
        std::set<std::string> seen;
        for (const auto& tag : array(page.getDictItem("tags"))) {
            auto string = text(tag);
            unicode(string, true);
            require(!blank(string) && seen.insert(string).second, "Page tags must be nonblank and unique.");
        }
    }
}
bool annotated(JSON pages)
{
    for (const auto& page : array(pages))
        if (!object(page).empty())
            return true;
    return false;
}
void manifest(JSON root, std::size_t page_count)
{
    auto present = fields(root, {"version", "pages", "regions", "baselines", "targets", "parameters"},
        {"groups", "recordSets", "profileSets", "publication"});
    require(number(root.getDictItem("version")) == 1, "Unsupported contract version.", "unsupported-version");
    if (present.contains("publication"))
        publication(root.getDictItem("publication"));
    auto pages = array(root.getDictItem("pages"));
    auto regions = object(root.getDictItem("regions"));
    auto baselines = object(root.getDictItem("baselines"));
    auto targets = object(root.getDictItem("targets"));
    auto parameters = object(root.getDictItem("parameters"));
    require(!pages.empty() && pages.size() == page_count, "Page array must match the PDF page count.");
    for (std::size_t index = 0; index < pages.size(); ++index) {
        try {
            page_metadata(pages[index]);
        } catch (const Error& error) {
            throw Error(error.code(), error.what(), "manifest", "/pages/" + std::to_string(index));
        }
    }
    auto paint = !parameters.empty();
    require(!regions.empty() == paint && !baselines.empty() == paint && !targets.empty() == paint,
        "Paint maps must be nonempty together or empty together.");
    require(paint || annotated(root.getDictItem("pages")), "Manifest has no paint or page metadata.");
    require(
        paint || (!present.contains("recordSets") && !present.contains("groups") && !present.contains("profileSets")),
        "Metadata-only manifests cannot contain paint presentation or record sets.");
    std::set<std::string> used_baselines;
    for (const auto& [id, item] : baselines) {
        unicode(id, true);
        fields(item, {"paint", "width", "stroke", "fill", "strokeOpacity", "fillOpacity", "display", "fillRule"});
        auto paint = text(item.getDictItem("paint"));
        require(std::set<std::string> {"S", "s", "f", "f*", "B", "B*", "b", "b*"}.contains(paint),
            "Invalid baseline painting operator.");
        require(pdf_number(text(item.getDictItem("width"))) >= 0, "Negative baseline width.");
        color(item.getDictItem("stroke"), true);
        color(item.getDictItem("fill"), false);
        for (auto key : {"strokeOpacity", "fillOpacity"}) {
            double n = pdf_number(text(item.getDictItem(key)));
            require(n >= 0 && n <= 1, "Invalid baseline alpha.");
        }
        domain(item.getDictItem("display"), "display");
        auto rule = text(item.getDictItem("fillRule"));
        require(rule == "nonzero" || rule == "evenodd", "Invalid fill rule.");
        if (paint != "S" && paint != "s")
            require((paint.ends_with('*')) == (rule == "evenodd"), "Fill rule disagrees with baseline paint.");
    }
    auto record_sets = root.getDictItem("recordSets");
    auto templates = present.contains("recordSets") ? object(record_sets) : std::map<std::string, JSON> {};
    require(!present.contains("recordSets") || !templates.empty(), "Empty record set table.");
    std::set<std::string> used_sets;
    std::size_t record_count = 0;
    for (const auto& [id, item] : regions) {
        unicode(id, true);
        bool shared = !item.getDictItem("recordSet").isNull();
        if (shared)
            fields(item, {"page", "marker", "recordSet", "baselineRefs"});
        else
            fields(item, {"page", "marker", "records"});
        auto page = number(item.getDictItem("page"));
        require(page >= 0 && page < static_cast<double>(page_count) && std::floor(page) == page,
            "Region page must be a physical page index.");
        resource(item.getDictItem("marker"));
        std::string set_id;
        std::map<std::string, JSON> refs;
        bool check_syntax = true;
        if (shared) {
            set_id = text(item.getDictItem("recordSet"));
            unicode(set_id, true);
            require(templates.contains(set_id), "Unknown record set.");
            check_syntax = used_sets.insert(set_id).second;
            refs = object(item.getDictItem("baselineRefs"));
            for (const auto& [slot, baseline] : refs) {
                unicode(slot, true);
                require(baselines.contains(text(baseline)), "Unknown baseline reference.");
            }
        }
        auto records = locators(root, item);
        require(!records.empty(), "Empty region.");
        require(records.size() <= 500000 - record_count, "Paint records exceed 500000.", "limit-exceeded");
        record_count += records.size();
        std::set<std::string> used_refs;
        for (const auto& record : records) {
            if (check_syntax) {
                fields(record, {"path", "marker", "baseline", "fill"});
                resource(record.getDictItem("marker"));
                auto path = array(record.getDictItem("path"));
                require(path.size() <= 16, "Form path exceeds 16.", "limit-exceeded");
                for (const auto& step : path) {
                    fields(step, {"resource", "occurrence"});
                    resource(step.getDictItem("resource"));
                    auto n = number(step.getDictItem("occurrence"));
                    require(n >= 0 && n <= 65536 && std::floor(n) == n, "Invalid Form occurrence.");
                }
                auto fill = text(record.getDictItem("fill"));
                require(fill == "existing" || fill == "latent" || fill == "none", "Invalid fill capability.");
            }
            if (shared) {
                auto slot = text(record.getDictItem("baseline"));
                require(refs.contains(slot), "Missing baseline reference.");
                used_refs.insert(slot);
            }
            auto baseline_id = baseline_ref(item, record);
            require(baselines.contains(baseline_id), "Unknown baseline.");
            used_baselines.insert(baseline_id);
            const auto& b = baselines.at(baseline_id);
            auto paint = text(b.getDictItem("paint"));
            auto fill = text(record.getDictItem("fill"));
            require((fill == "existing") == (paint != "S" && paint != "s"),
                "Fill capability disagrees with baseline paint.");
            if (fill == "latent")
                require(pdf_number(text(b.getDictItem("fillOpacity"))) == 0, "Latent fill has nonzero baseline alpha.");
        }
        require(used_refs.size() == refs.size(), "Unused baseline reference.");
    }
    require(used_sets.size() == templates.size(), "Unused record set.");
    require(used_baselines.size() == baselines.size(), "Unused baseline.");
    std::set<std::string> owned;
    for (const auto& [id, item] : targets) {
        unicode(id, true);
        for (const auto& region : ids(item)) {
            require(regions.contains(region), "Unknown target region.");
            require(owned.insert(region).second, "Region belongs to multiple targets.");
        }
    }
    require(owned.size() == regions.size(), "Region has no target.");
    std::set<std::pair<std::string, std::string>> bound;
    std::set<std::string> used_targets;
    for (const auto& [id, parameter] : parameters) {
        try {
            unicode(id, true);
            auto present = fields(parameter, {"schema", "binding"}, {"value", "family", "key"});
            auto binding = parameter.getDictItem("binding");
            fields(binding, {"targets", "property"});
            auto property = text(binding.getDictItem("property"));
            require(std::set<std::string> {"stroke-width", "stroke-color", "stroke-opacity", "fill-color",
                        "fill-opacity", "display"}
                        .contains(property),
                "Unsupported property.");
            schema(parameter.getDictItem("schema"), property);
            if (present.contains("value"))
                value(parameter.getDictItem("value"), parameter.getDictItem("schema"), property);
            bool eligible = false;
            for (const auto& target : ids(binding.getDictItem("targets"))) {
                require(targets.contains(target), "Unknown binding target.");
                bool target_eligible = false;
                for (const auto& region : ids(targets.at(target))) {
                    for (const auto& record : locators(root, regions.at(region))) {
                        auto paint = text(baselines.at(baseline_ref(regions.at(region), record)).getDictItem("paint"));
                        target_eligible = property == "display"
                            || (property.starts_with("stroke-") ? paint != "f" && paint != "f*"
                                                                : text(record.getDictItem("fill")) != "none");
                        if (target_eligible)
                            break;
                    }
                    if (target_eligible)
                        break;
                }
                require(target_eligible, "Binding target has no eligible records.");
                eligible = true;
                require(bound.emplace(target, property).second, "Conflicting property bindings.");
                used_targets.insert(target);
            }
            require(eligible, "Empty binding.");
        } catch (const Error& error) {
            throw Error(error.code(), error.what(), "manifest", "/parameters/" + pointer(id));
        }
    }
    require(used_targets.size() == targets.size(), "Every target requires a parameter binding.");
    semantics(parameters);
    if (present.contains("profileSets"))
        profile_sets(root.getDictItem("profileSets"), parameters);
    if (present.contains("groups")) {
        std::set<std::string> grouped;
        for (const auto& group : array(root.getDictItem("groups"))) {
            auto group_fields = fields(group, {"title", "parameters"}, {"description", "details"});
            text(group.getDictItem("title"));
            annotations(group, group_fields);
            for (const auto& id : ids(group.getDictItem("parameters"), false))
                require(parameters.contains(id) && grouped.insert(id).second, "Unknown or repeated UI parameter.");
        }
    }
}
Matrix multiply(const Matrix& a, const Matrix& b)
{
    Matrix result {a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]};
    for (auto n : result)
        require(std::isfinite(n), "Transform arithmetic overflow.", "unsupported-context");
    return result;
}
double uniform_scale(const Matrix& matrix)
{
    double x = std::hypot(matrix[0], matrix[1]), y = std::hypot(matrix[2], matrix[3]);
    require(std::isfinite(x) && std::isfinite(y) && x > 0 && y > 0 && std::abs(x / y - 1) <= 1e-9
            && std::abs((matrix[0] / x) * (matrix[2] / y) + (matrix[1] / x) * (matrix[3] / y)) <= 1e-9,
        "Width binding requires a nonsingular uniform transform.", "unsupported-context");
    return x;
}
}
