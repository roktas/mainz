#ifndef MAINZ_COMMAND_HH
#define MAINZ_COMMAND_HH
#include "contract.hh"
#include <cstddef>
#include <initializer_list>
#include <map>
#include <stdexcept>
#include <string>
#include <string_view>

namespace mainz::cli {
class Interrupt final : public std::runtime_error {
public:
    Interrupt()
        : std::runtime_error("Operation cancelled.")
    {
    }
};
struct Arguments {
    std::string input;
    std::map<std::string, std::string> options;
    void validate(
        std::initializer_list<std::string_view> required, std::initializer_list<std::string_view> optional = {}) const;
};
std::string read(const std::string&, std::size_t);
void check_interrupt();
void signals();
void install(const std::string&, const std::string&);
void changed(const Arguments&, const Document&);
void describe(const Arguments&);
void profiles(const Arguments&);
void verify(const Arguments&);
void apply(const Arguments&);
void reset(const Arguments&);
void extract(const Arguments&);
void compose(const Arguments&);
void produce(const Arguments&);
void version();
}
#endif
