#ifndef MAINZ_CONTRACT_HH
#define MAINZ_CONTRACT_HH

#include "processor.hh"
#include <array>
#include <cstdint>
#include <initializer_list>
#include <map>
#include <qpdf/JSON.hh>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace mainz {
struct Resolution;
}

namespace mainz::detail {
struct BoundInput {
    const std::string& bytes;
    const Document* document {nullptr};
};
using Bindings = std::map<std::string, BoundInput>;
Bindings bind_inputs(const std::map<std::string, std::string>&);
Bindings bind_inputs(const std::map<std::string, Document>&);
Artifact compose_bound(const std::string& plan, const Bindings& inputs, const Document* previous = nullptr);
Resolution resolve_recipe_bound(const std::string& recipe, const Bindings& inputs, bool force = false);
using Matrix = std::array<double, 6>;
inline constexpr Matrix identity {1, 0, 0, 1, 0, 0};
void require(bool, std::string_view, std::string_view code = "invalid-contract");
std::string pointer(const std::string&);
JSON parse(const std::string&, const std::string& source, std::size_t limit = json_limit);
void identifier(const std::string&, std::string_view code = "invalid-contract");
std::string text(JSON);
double number(JSON);
double pdf_number(std::string_view);
std::string decimal(double);
std::vector<JSON> array(JSON);
std::map<std::string, JSON> object(JSON);
bool empty_array(JSON);
bool empty_object(JSON);
bool has_member(JSON, std::string_view key);
JSON member(JSON, const std::string& key);
std::set<std::string> fields(JSON, const std::set<std::string>& required, const std::set<std::string>& optional = {});
void annotations(JSON, const std::set<std::string>& present);
JSON dictionary(std::initializer_list<std::pair<std::string, JSON>>);
std::string encode(JSON, std::size_t limit, std::size_t& remaining);
std::string encode(JSON, std::size_t limit);
bool equal(JSON, JSON);
std::string sha256(std::string_view);
bool blank(const std::string&);
void publication(JSON, const std::string& source = "manifest");
template <class Function> auto request_at(const std::string& location, Function operation)
{
    try {
        return operation();
    } catch (const Error& error) {
        throw Error(
            error.code() == "invalid-contract" ? "invalid-request" : error.code(), error.what(), "request", location);
    }
}
std::vector<JSON> locators(JSON manifest, JSON region);
std::string baseline_ref(JSON region, JSON locator);
void validate_png_ihdr(std::string_view header, std::uint32_t max_edge, std::size_t max_pixels,
    std::string_view size_message, std::string_view invalid_message);
JSON png_metadata(std::string_view bytes);
JSON canonical_value(JSON);
void value(JSON, JSON schema, const std::string& property);
void schema(JSON, const std::string& property);
void semantics(const std::map<std::string, JSON>& parameters, const std::string& source = "manifest");
void profile_sets(JSON, const std::map<std::string, JSON>& parameters);
void page_metadata(JSON);
std::string pdf_title(JSON);
void document_metadata(JSON, std::size_t pages);
bool annotated(JSON pages);
void manifest(JSON, std::size_t pages);
Matrix multiply(const Matrix&, const Matrix&);
double uniform_scale(const Matrix&);
}
#endif
