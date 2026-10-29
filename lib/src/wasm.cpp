#include "contract.hh"
#include <cstdint>
#include <limits>
#include <optional>
#include <qpdf/JSON.hh>
#include <string>
#include <utility>

namespace {
std::optional<mainz::Document> document;
std::optional<mainz::Document> completed;
std::optional<mainz::Document> last_input;
std::uint32_t handle {0};
std::string result;
std::string report;
std::map<std::string, std::string> inputs;
int status {0};
const char* emergency {nullptr};

template <class Function> void boundary(Function operation, bool retain_completed = false) noexcept
{
    result.clear();
    report.clear();
    status = 0;
    emergency = nullptr;
    if (!retain_completed)
        completed.reset();
    try {
        try {
            operation();
        } catch (const mainz::Error& error) {
            completed.reset();
            last_input.reset();
            result = error.json();
            status = 1;
        } catch (const std::exception& error) {
            completed.reset();
            last_input.reset();
            auto record = JSON::makeDictionary();
            record.addDictionaryMember("hostError", JSON::makeString(error.what()));
            result = record.unparse();
            status = 2;
        }
    } catch (...) {
        completed.reset();
        last_input.reset();
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
    result = output.pdf();
    completed = std::move(output);
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
            if (completed && completed->pdf() == input)
                document = std::move(completed);
            else if (last_input && last_input->pdf() == input) {
                completed.reset();
                document = *last_input;
            } else {
                completed.reset();
                last_input.reset();
                auto validated = mainz::Document::read(std::move(input));
                last_input = validated;
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
void mainz_apply(std::uint32_t id, const char* data, std::size_t size)
{
    boundary([&] { save(get(id).apply(bytes(data, size, mainz::json_limit))); });
}
void mainz_style(std::uint32_t id, const char* data, std::size_t size, const char* reset, std::size_t reset_size)
{
    boundary([&] {
        save(get(id).apply(bytes(data, size, mainz::json_limit), bytes(reset, reset_size, mainz::json_limit)));
    });
}
void mainz_reset(std::uint32_t id, const char* data, std::size_t size, int supplied)
{
    boundary([&] {
        save(get(id).reset(supplied ? std::optional<std::string>(bytes(data, size, mainz::json_limit)) : std::nullopt));
    });
}
void mainz_extract(std::uint32_t id, const char* data, std::size_t size)
{
    boundary([&] { save(get(id).extract(bytes(data, size, mainz::json_limit))); });
}
void mainz_input(const char* id_data, std::size_t id_size, const char* pdf_data, std::size_t pdf_size)
{
    boundary([&] {
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
    });
}
void mainz_clear_inputs()
{
    boundary([&] { inputs.clear(); }, true);
}
void mainz_compose(const char* data, std::size_t size)
{
    boundary([&] {
        auto output = mainz::compose(bytes(data, size, mainz::json_limit), inputs, last_input ? &*last_input : nullptr);
        save(std::move(output.document));
        report = std::move(output.report);
    });
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
const char* mainz_result() { return emergency ? emergency : result.data(); }
std::size_t mainz_size() { return emergency ? std::char_traits<char>::length(emergency) : result.size(); }
const char* mainz_report() { return report.data(); }
std::size_t mainz_report_size() { return report.size(); }
int mainz_status() { return status; }
}
