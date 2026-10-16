#ifndef MAINZ_PROCESSOR_HH
#define MAINZ_PROCESSOR_HH

#include <cstddef>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>

namespace mainz {
namespace detail {
    class Engine;
    struct Index;
}
inline constexpr std::size_t pdf_limit = std::size_t {128} * 1024 * 1024;
inline constexpr std::size_t manifest_limit = std::size_t {8} * 1024 * 1024;
inline constexpr std::size_t locator_limit = std::size_t {128} * 1024 * 1024;
inline constexpr std::size_t json_limit = std::size_t {1024} * 1024;
inline constexpr std::size_t input_limit = 32;
inline constexpr std::size_t page_limit = 10000;

class Error : public std::runtime_error {
public:
    Error(const std::string& code, const std::string& message, const std::string& source = {},
        const std::string& location = {});
    const std::string& code() const { return code_; }
    const std::string& source() const { return source_; }
    const std::string& json() const { return record; }

private:
    std::string code_, source_;
    std::string record;
};

// Owns validated bytes. Operations leave this document and its input unchanged.
class Document {
public:
    static Document read(std::string bytes);
    const std::string& pdf() const { return bytes; }
    const std::string& describe() const { return description; }
    bool prepared() const { return has_contract; }
    Document apply(const std::string& request) const;
    Document reset(const std::optional<std::string>& ids = std::nullopt) const;
    Document extract(const std::string& pages) const;

private:
    friend class detail::Engine;
    enum class Change : unsigned char { apply, reset, reset_all };
    Document(std::string bytes, std::string description, bool prepared, std::shared_ptr<const detail::Index> index);
    Document change(const std::string& request, Change) const;
    std::string bytes;
    std::string description;
    bool has_contract;
    std::shared_ptr<const detail::Index> index;
};

struct Composition {
    Document document;
    std::string report;
};
Composition compose(const std::string& job, const std::map<std::string, std::string>& inputs);
}
#endif
