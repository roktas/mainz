#include "command.hh"
#include <array>
#include <cerrno>
#include <csignal>
#include <cstdlib>
#include <fcntl.h>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <set>
#include <sys/stat.h>
#include <unistd.h>
#include <utility>

namespace mainz::cli {
volatile std::sig_atomic_t interrupted = 0;
static void interrupt(int signal) { interrupted = signal; }
void check_interrupt()
{
    if (interrupted)
        throw Interrupt();
}
std::string read(const std::string& path, std::size_t limit)
{
    if (path.find('\0') != path.npos)
        throw std::runtime_error("Input path contains a null byte.");
    std::ifstream file;
    if (path != "-")
        file.open(path, std::ios::binary);
    std::istream& input = path == "-" ? std::cin : file;
    if (!input.good())
        throw std::runtime_error("Cannot open input.");
    std::string result;
    std::array<char, 8192> buffer {};
    while (input.read(buffer.data(), buffer.size()) || input.gcount()) {
        check_interrupt();
        auto count = static_cast<std::size_t>(input.gcount());
        if (count > limit - result.size())
            throw mainz::Error("limit-exceeded", "Input exceeds its byte limit.");
        result.append(buffer.data(), count);
    }
    check_interrupt();
    if (!input.eof())
        throw std::runtime_error("Cannot read input.");
    return result;
}
namespace {
    class Descriptor {
    public:
        explicit Descriptor(int value)
            : value(value)
        {
            if (value < 0)
                throw std::runtime_error("Cannot open recipe root or Input without following symlinks.");
        }
        Descriptor(const Descriptor&) = delete;
        Descriptor& operator=(const Descriptor&) = delete;
        ~Descriptor() { close(value); }
        int value;
    };
}
std::map<std::string, std::string> bindings(const std::string& path)
{
    auto definitions
        = detail::request_at("", [&] { return detail::object(detail::parse(read(path, json_limit), "request")); });
    detail::require(definitions.size() <= input_limit, "Inputs exceed 32.", "limit-exceeded");
    std::map<std::string, std::string> result;
    for (const auto& [id, value] : definitions) {
        auto file = detail::request_at("/" + detail::pointer(id), [&] {
            detail::identifier(id, "invalid-request");
            return detail::text(value);
        });
        if (file == "-")
            throw std::runtime_error("PDF bindings require file paths.");
        result.emplace(id, std::move(file));
    }
    return result;
}
std::string read_at(const std::string& root, const std::string& file, std::size_t limit)
{
    if (root.find('\0') != root.npos || file.find('\0') != file.npos)
        throw std::runtime_error("Input path contains a null byte.");
    auto path = std::filesystem::path(file);
    if (path.empty() || path.is_absolute() || file.find_first_of("\\:") != file.npos)
        throw std::runtime_error("Input lookup requires a relative path ID. Use --inputs for this ID.");
    auto directory_path = path.parent_path();
    for (const auto& component : path)
        if (component.empty() || component == "." || component == "..")
            throw std::runtime_error("Input lookup rejects empty, . and .. path components. Use --inputs for this ID.");
    if (file.find("//") != file.npos)
        throw std::runtime_error("Input lookup rejects empty path components. Use --inputs for this ID.");
    Descriptor directory(open(root.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC));
    for (const auto& component : directory_path) {
        Descriptor next(openat(directory.value, component.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
        std::swap(directory.value, next.value);
    }
    Descriptor input(openat(directory.value, path.filename().c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC));
    struct stat info {};
    if (fstat(input.value, &info) != 0 || !S_ISREG(info.st_mode))
        throw std::runtime_error("Recipe Inputs must be regular files.");
    std::string result;
    std::array<char, 8192> buffer {};
    for (;;) {
        check_interrupt();
        auto count = ::read(input.value, buffer.data(), buffer.size());
        if (count < 0 && errno == EINTR)
            continue;
        if (count < 0)
            throw std::runtime_error("Cannot read recipe Input.");
        if (count == 0)
            break;
        auto size = static_cast<std::size_t>(count);
        if (size > limit - result.size())
            throw mainz::Error("limit-exceeded", "Input exceeds its byte limit.");
        result.append(buffer.data(), size);
    }
    check_interrupt();
    return result;
}
// POSIX no-clobber installation: the result appears only after a complete write.
class Output {
public:
    explicit Output(const std::string& destination)
        : destination(destination)
    {
        auto path = std::filesystem::path(destination);
        auto parent = path.parent_path();
        if (parent.empty())
            parent = ".";
        temporary = (parent / ".mainz-XXXXXX").string();
        descriptor = mkstemp(temporary.data());
        if (descriptor < 0)
            throw std::runtime_error("Cannot create output temporary file.");
    }
    Output(const Output&) = delete;
    Output& operator=(const Output&) = delete;
    ~Output()
    {
        if (descriptor >= 0)
            close(descriptor);
        if (!temporary.empty())
            unlink(temporary.c_str());
    }
    void install(const std::string& bytes)
    {
        std::size_t position = 0;
        while (position < bytes.size()) {
            check_interrupt();
            auto n = ::write(descriptor, bytes.data() + position, bytes.size() - position);
            if (n < 0 && errno == EINTR)
                continue;
            if (n <= 0)
                throw std::runtime_error("Cannot write output.");
            position += static_cast<std::size_t>(n);
        }
        if (fsync(descriptor) != 0)
            throw std::runtime_error("Cannot flush output.");
        auto file = std::exchange(descriptor, -1);
        if (close(file) != 0)
            throw std::runtime_error("Cannot close output.");
        check_interrupt();
        if (link(temporary.c_str(), destination.c_str()) != 0)
            throw std::runtime_error(errno == EEXIST ? "Output already exists." : "Cannot install output.");
        if (unlink(temporary.c_str()) == 0)
            temporary.clear();
    }

private:
    std::string destination, temporary;
    int descriptor {-1};
};

void install(const std::string& path, const std::string& bytes) { Output(path).install(bytes); }
void signals()
{
    struct sigaction action = {};
    action.sa_handler = interrupt;
    sigemptyset(&action.sa_mask);
    if (sigaction(SIGINT, &action, nullptr) != 0 || sigaction(SIGTERM, &action, nullptr) != 0)
        throw std::runtime_error("Cannot install interruption handlers.");
    action.sa_handler = SIG_IGN;
    if (sigaction(SIGPIPE, &action, nullptr) != 0)
        throw std::runtime_error("Cannot install stdout failure handler.");
}
void Arguments::validate(
    std::initializer_list<std::string_view> required, std::initializer_list<std::string_view> optional) const
{
    std::set<std::string_view> allowed(required);
    allowed.insert(optional);
    const std::set<std::string_view> files {
        "--overrides", "--ids", "--pages", "--inputs", "--declaration", "--preview"};
    std::size_t stdin_count = input == "-" ? 1 : 0;
    for (const auto& key : required)
        if (!options.contains(std::string(key)))
            throw std::runtime_error("Missing option: " + std::string(key));
    for (const auto& [key, path] : options) {
        if (!allowed.contains(key))
            throw std::runtime_error("Unexpected option: " + key);
        if (key == "--output") {
            if (path.empty() || path == "-")
                throw std::runtime_error("An explicit output file is required.");
        } else if (path == "-" && files.contains(key))
            ++stdin_count;
    }
    if (stdin_count > 1)
        throw std::runtime_error("Only one input can use stdin.");
}
void changed(const Arguments& args, const Document& document)
{
    install(args.options.at("--output"), document.pdf());
    std::cout << "{\"ok\":true}\n";
}
}
