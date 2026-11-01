#ifndef MAINZ_CONTRACT_HH
#define MAINZ_CONTRACT_HH

#include "processor.hh"
#include <array>
#include <initializer_list>
#include <map>
#include <qpdf/JSON.hh>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace mainz::detail {
struct BoundInput {
    const std::string& bytes;
    const Document* document {nullptr};
};
using Bindings = std::map<std::string, BoundInput>;
Bindings bind_inputs(const std::map<std::string, std::string>&);
Bindings bind_inputs(const std::map<std::string, Document>&);
using Matrix = std::array<double, 6>;
inline constexpr Matrix identity {1, 0, 0, 1, 0, 0};
void require(bool, std::string_view, std::string_view code = "invalid-contract");
std::string pointer(const std::string&);
JSON parse(const std::string&, const std::string& source);
void identifier(const std::string&, std::string_view code = "invalid-contract");
std::string text(JSON);
double number(JSON);
double pdf_number(std::string_view);
std::string decimal(double);
std::vector<JSON> array(JSON);
std::map<std::string, JSON> object(JSON);
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
bool compatible_publication(JSON recorded, JSON current);
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
bool numeric_property(const std::string&);
void value(JSON, JSON schema, const std::string& property);
void schema(JSON, const std::string& property);
void semantics(const std::map<std::string, JSON>& parameters, const std::string& source = "manifest");
void profile_sets(JSON, const std::map<std::string, JSON>& parameters);
void manifest(JSON, std::size_t pages);
Matrix multiply(const Matrix&, const Matrix&);
double uniform_scale(const Matrix&);
}
#endif
