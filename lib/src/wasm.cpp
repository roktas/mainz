#include "contract.hh"
#include "recipe.hh"
#include <cmath>
#include <cstdint>
#include <limits>
#include <list>
#include <optional>
#include <qpdf/JSON.hh>
#include <string>
#include <utility>

namespace {
std::optional<mainz::Document> document;
std::optional<mainz::Document> completed;
std::list<mainz::Document> validated_cache;
std::size_t validated_bytes {0};
std::uint32_t handle {0};
std::string result;
std::string provenance;
bool result_in_completed {false};
std::map<std::string, std::string> inputs;
int status {0};
const char* emergency {nullptr};

void clear_cache() noexcept
{
    validated_cache.clear();
    validated_bytes = 0;
}

const mainz::Document* find_cached(const std::string& bytes)
{
    for (auto it = validated_cache.begin(); it != validated_cache.end(); ++it) {
        if (it->pdf() == bytes) {
            validated_cache.splice(validated_cache.end(), validated_cache, it);
            return &*it;
        }
    }
    return nullptr;
}

void remember_cached(const mainz::Document& validated)
{
    const auto size = validated.cached_bytes();
    if (size > mainz::pdf_limit)
        return;
    for (auto it = validated_cache.begin(); it != validated_cache.end(); ++it) {
        if (it->pdf() == validated.pdf()) {
            validated_cache.splice(validated_cache.end(), validated_cache, it);
            return;
        }
    }
    while (!validated_cache.empty()
        && (validated_cache.size() >= mainz::input_limit || size > mainz::pdf_limit - validated_bytes)) {
        validated_bytes -= validated_cache.front().cached_bytes();
        validated_cache.pop_front();
    }
    validated_cache.push_back(validated);
    validated_bytes += size;
}

mainz::detail::Bindings bound_inputs()
{
    mainz::detail::Bindings bindings;
    for (const auto& [id, input] : inputs) {
        const mainz::Document* cached = nullptr;
        if (completed && completed->pdf() == input)
            cached = &*completed;
        else if (document && document->pdf() == input)
            cached = &*document;
        else
            cached = find_cached(input);
        bindings.emplace(id, mainz::detail::BoundInput {input, cached});
    }
    return bindings;
}

void release(std::string& buffer) noexcept
{
    if (buffer.capacity() > 65536)
        std::string().swap(buffer);
    else
        buffer.clear();
}

template <class Function> void boundary(Function operation, bool retain_completed = false) noexcept
{
    release(result);
    release(provenance);
    result_in_completed = false;
    status = 0;
    emergency = nullptr;
    if (!retain_completed)
        completed.reset();
    try {
        try {
            operation();
        } catch (const mainz::Error& error) {
            result_in_completed = false;
            completed.reset();
            clear_cache();
            result = error.json();
            status = 1;
        } catch (const std::exception& error) {
            result_in_completed = false;
            completed.reset();
            clear_cache();
            auto record = JSON::makeDictionary();
            record.addDictionaryMember("hostError", JSON::makeString(error.what()));
            result = record.unparse();
            status = 2;
        }
    } catch (...) {
        result_in_completed = false;
        completed.reset();
        clear_cache();
        // Error serialization can also fail when memory is exhausted.
        emergency = "{\"hostError\":\"WASM operation failed.\"}";
        status = 2;
    }
}
const mainz::Document& get(std::uint32_t id)
{
    if (!document || id != handle)
        throw std::runtime_error("Invalid document handle.");
    return *document;
}
std::string bytes(const char* data, std::size_t size, std::size_t limit)
{
    if (size > limit)
        throw mainz::Error("limit-exceeded", "WASM input exceeds its byte limit.");
    if (!data && size)
        throw std::runtime_error("Missing input buffer.");
    return size ? std::string(data, size) : std::string {};
}
void save(mainz::Document output)
{
    completed = std::move(output);
    result_in_completed = true;
}
}

// Input buffers belong to the caller and can be freed after the synchronous call.
// Result bytes belong to the module until the next operation. Copy before calling again.
extern "C" {
std::uint32_t mainz_read(const char* data, std::size_t size)
{
    std::uint32_t opened {0};
    boundary(
        [&] {
            if (document)
                throw std::runtime_error("Close the active document before opening another.");
            if (handle == std::numeric_limits<std::uint32_t>::max())
                throw std::runtime_error("Document handle limit reached.");
            auto input = bytes(data, size, mainz::pdf_limit);
            // Only exact bytes of a fully validated document can reuse its description and syntax.
            if (completed && completed->pdf() == input) {
                document = std::move(completed);
                remember_cached(*document);
            } else if (const auto* cached = find_cached(input)) {
                completed.reset();
                document = *cached;
            } else {
                completed.reset();
                auto validated = mainz::Document::read(std::move(input));
                remember_cached(validated);
                document = std::move(validated);
            }
            completed.reset();
            opened = ++handle;
        },
        true);
    return opened;
}
void mainz_describe(std::uint32_t id)
{
    boundary([&] { result = get(id).describe(); });
}
void mainz_fingerprint(std::uint32_t id)
{
    boundary([&] { result = mainz::detail::sha256(get(id).pdf()); });
}
void mainz_reference(std::uint32_t id)
{
    boundary([&] { result = mainz::recipe_reference(get(id)); });
}
void mainz_check_recipe_input(
    std::uint32_t id, const char* key, std::size_t key_size, const char* data, std::size_t size)
{
    boundary([&] {
        result = mainz::check_recipe_input(bytes(data, size, mainz::recipe_limit), bytes(key, key_size, 4096), get(id));
    });
}
void mainz_style(std::uint32_t id, const char* data, std::size_t size, const char* reset, std::size_t reset_size)
{
    boundary([&] {
        save(get(id).style(bytes(data, size, mainz::json_limit), bytes(reset, reset_size, mainz::json_limit)));
    });
}
void mainz_reset(std::uint32_t id, const char* data, std::size_t size, int supplied)
{
    boundary([&] {
        mainz::detail::require(supplied == 0 || supplied == 1, "Supplied must be Boolean.", "invalid-request");
        mainz::detail::require(supplied || size == 0, "Reset IDs require supplied=1.", "invalid-request");
        save(get(id).reset(supplied ? std::optional<std::string>(bytes(data, size, mainz::json_limit)) : std::nullopt));
    });
}
void mainz_extract(std::uint32_t id, const char* data, std::size_t size)
{
    boundary([&] { save(get(id).extract(bytes(data, size, mainz::json_limit))); });
}
void mainz_preview(std::uint32_t id, double page)
{
    boundary([&] {
        const auto& active = get(id);
        if (!std::isfinite(page) || page < 0 || page > static_cast<double>(mainz::page_limit)
            || std::floor(page) != page)
            throw mainz::Error("invalid-request", "Preview page must be a physical page index.", "request", "");
        result = active.preview(static_cast<std::size_t>(page));
    });
}
void mainz_input(const char* id_data, std::size_t id_size, const char* pdf_data, std::size_t pdf_size)
{
    boundary(
        [&] {
            auto id = bytes(id_data, id_size, 4096);
            mainz::detail::identifier(id, "invalid-request");
            if (inputs.contains(id))
                throw mainz::Error("invalid-request", "Duplicate Input ID.");
            if (inputs.size() >= mainz::input_limit)
                throw mainz::Error("limit-exceeded", "Inputs exceed 32.");
            std::size_t remaining = mainz::pdf_limit;
            for (const auto& [key, input] : inputs) {
                (void)key;
                remaining -= input.size();
            }
            inputs.emplace(std::move(id), bytes(pdf_data, pdf_size, remaining));
        },
        true);
}
void mainz_clear_inputs()
{
    boundary([&] { inputs.clear(); }, true);
}
void mainz_compose(const char* data, std::size_t size)
{
    boundary(
        [&] {
            auto output = mainz::detail::compose_bound(bytes(data, size, mainz::json_limit), bound_inputs());
            save(std::move(output.document));
            provenance = std::move(output.provenance);
        },
        true);
}
void mainz_recipe_inputs(const char* data, std::size_t size)
{
    boundary([&] { result = mainz::recipe_inputs(bytes(data, size, mainz::recipe_limit)); });
}
void mainz_resolve_recipe(const char* data, std::size_t size, int force)
{
    boundary(
        [&] {
            mainz::detail::require(force == 0 || force == 1, "Force must be Boolean.", "invalid-request");
            auto resolved = mainz::detail::resolve_recipe_bound(
                bytes(data, size, mainz::recipe_limit), bound_inputs(), force == 1);
            // Resolution already encodes and bounds each member before returning it.
            result.reserve(
                41 + resolved.plan.size() + resolved.checks.size() + resolved.intent.size() + resolved.aligned.size());
            result = "{\"plan\":";
            result.append(resolved.plan);
            result.append(",\"checks\":");
            result.append(resolved.checks);
            result.append(",\"intent\":");
            result.append(resolved.intent);
            result.append(",\"aligned\":");
            result.append(resolved.aligned);
            result.push_back('}');
        },
        true);
}
void mainz_close(std::uint32_t id)
{
    boundary(
        [&] {
            get(id);
            document.reset();
        },
        true);
}
const char* mainz_result()
{
    if (emergency)
        return emergency;
    return result_in_completed && completed ? completed->pdf().data() : result.data();
}
std::size_t mainz_size()
{
    if (emergency)
        return std::char_traits<char>::length(emergency);
    return result_in_completed && completed ? completed->pdf().size() : result.size();
}
const char* mainz_provenance() { return provenance.data(); }
std::size_t mainz_provenance_size() { return provenance.size(); }
int mainz_status() { return status; }
}
