#ifndef MAINZ_CONTENT_HH
#define MAINZ_CONTENT_HH
#include "contract.hh"
#include <cstddef>
#include <map>
#include <memory>
#include <qpdf/QPDFTokenizer.hh>
#include <set>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace mainz::detail {
struct Operand {
    QPDFTokenizer::token_type_e type;
    std::string_view value, raw;
};
struct Operation {
    std::string op;
    std::span<const Operand> operands;
    std::size_t begin {}, end {};
    std::size_t first {}, count {};
};
struct Content {
    Content() = default;
    Content(const Content&) = delete;
    Content& operator=(const Content&) = delete;
    Content(Content&&) = default;
    Content& operator=(Content&&) = default;
    // Operands and operation spans borrow these stable allocations, including after a move.
    std::unique_ptr<std::string> bytes;
    std::vector<Operation> operations;
    std::vector<Operand> operands;
    std::set<std::string> names;
    std::map<std::size_t, std::size_t> ends;
};
std::string name(const Operation&, std::size_t);
double operand(const Operation&, std::size_t);
void count(const Operation&, std::size_t);
Content tokenize(const std::string&);
bool path_op(const std::string&);
bool paint_op(const std::string&);
bool empty_move(const std::vector<Operation>&, std::size_t, std::size_t);
std::string geometry(const std::vector<Operation>&, std::size_t, std::size_t, const Matrix&);
}
#endif
