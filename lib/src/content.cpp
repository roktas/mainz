#include "content.hh"
#include <qpdf/Pl_QPDFTokenizer.hh>
#include <qpdf/QPDFObjectHandle.hh>

namespace mainz::detail {
using Object = QPDFObjectHandle;
using Token = QPDFTokenizer::Token;
class Tokens : public Object::TokenFilter {
public:
    explicit Tokens(const std::string& bytes)
        : Object::TokenFilter()
    {
        content.bytes = std::make_unique<std::string>(bytes);
        data = *content.bytes;
    }
    Content content;
    void handleToken(const Token& token) override
    {
        auto type = token.getType();
        require(type != QPDFTokenizer::tt_bad, "Invalid content token.", "pdf-syntax");
        if (type == QPDFTokenizer::tt_eof)
            return;
        auto start = offset;
        offset += token.getRawValue().size();
        if (type == QPDFTokenizer::tt_space || type == QPDFTokenizer::tt_comment)
            return;
        if (content.operands.size() == first)
            begin = start;
        if (type == QPDFTokenizer::tt_inline_image) {
            require(content.operands.size() == first && nesting.empty(), "Malformed inline image.", "pdf-syntax");
            require(content.operations.size() < 1000000, "Content operations exceed 1000000.", "limit-exceeded");
            content.operations.push_back({"inline-image", {}, start, offset, first, 0});
            return;
        }
        if (type == QPDFTokenizer::tt_array_open || type == QPDFTokenizer::tt_dict_open) {
            require(nesting.size() < 32, "Operand nesting exceeds 32.", "limit-exceeded");
            nesting.push_back(type);
        } else if (type == QPDFTokenizer::tt_array_close || type == QPDFTokenizer::tt_dict_close) {
            require(!nesting.empty()
                    && ((type == QPDFTokenizer::tt_array_close && nesting.back() == QPDFTokenizer::tt_array_open)
                        || (type == QPDFTokenizer::tt_dict_close && nesting.back() == QPDFTokenizer::tt_dict_open)),
                "Unbalanced content operand.", "pdf-syntax");
            nesting.pop_back();
        }
        if (type == QPDFTokenizer::tt_word && nesting.empty()) {
            require(content.operations.size() < 1000000, "Content operations exceed 1000000.", "limit-exceeded");
            content.operations.push_back({token.getValue(), {}, begin, offset, first, content.operands.size() - first});
            first = content.operands.size();
        } else {
            require(content.operands.size() - first < 50000, "Content operands exceed 50000.", "limit-exceeded");
            auto raw = data.substr(start, offset - start);
            auto value = type == QPDFTokenizer::tt_name
                ? std::string_view(*content.names.insert(token.getValue()).first)
                : raw;
            content.operands.push_back({type, value, raw});
        }
    }
    void handleEOF() override
    {
        require(content.operands.size() == first && nesting.empty(), "Trailing content operands.", "pdf-syntax");
        for (auto& op : content.operations)
            op.operands = std::span<const Operand>(content.operands).subspan(op.first, op.count);
    }

private:
    std::string_view data;
    std::size_t offset {0}, begin {0}, first {0};
    std::vector<QPDFTokenizer::token_type_e> nesting;
};
std::string name(const Operation& op, std::size_t i)
{
    require(
        i < op.operands.size() && op.operands[i].type == QPDFTokenizer::tt_name, "Expected a PDF name.", "pdf-syntax");
    return std::string(op.operands[i].value);
}
double operand(const Operation& op, std::size_t i)
{
    require(i < op.operands.size()
            && (op.operands[i].type == QPDFTokenizer::tt_integer || op.operands[i].type == QPDFTokenizer::tt_real),
        "Expected a PDF number.", "pdf-syntax");
    return pdf_number(op.operands[i].value);
}
void count(const Operation& op, std::size_t n)
{
    if (op.operands.size() != n)
        throw Error("pdf-syntax", "Invalid operand count for " + op.op);
}
Content tokenize(const std::string& data)
{
    Tokens tokens(data);
    Pl_QPDFTokenizer pipeline("Mainz content", &tokens, nullptr);
    pipeline.write(reinterpret_cast<const unsigned char*>(data.data()), data.size());
    pipeline.finish();
    auto& content = tokens.content;
    std::vector<std::size_t> marked;
    for (std::size_t i = 0; i < content.operations.size(); ++i) {
        const auto& op = content.operations[i];
        if (op.op == "BMC" || op.op == "BDC") {
            count(op, op.op == "BMC" ? 1 : 2);
            name(op, 0);
            require(marked.size() < 64, "Marked content exceeds depth 64.", "limit-exceeded");
            marked.push_back(i);
        } else if (op.op == "EMC") {
            count(op, 0);
            require(!marked.empty(), "Marked content underflow.", "pdf-syntax");
            content.ends[marked.back()] = i;
            marked.pop_back();
        }
    }
    require(marked.empty(), "Unclosed marked content.", "pdf-syntax");
    return std::move(content);
}
bool path_op(const std::string& op)
{
    return op == "m" || op == "l" || op == "c" || op == "v" || op == "y" || op == "h" || op == "re";
}
bool paint_op(const std::string& op)
{
    return op == "S" || op == "s" || op == "f" || op == "f*" || op == "B" || op == "B*" || op == "b" || op == "b*";
}
bool empty_move(const std::vector<Operation>& ops, std::size_t index, std::size_t end)
{
    return ops[index].op == "m" && (index + 1 == end || ops[index + 1].op == "m" || ops[index + 1].op == "re");
}
// Compare decimal coordinates exactly, without rounding the protected path tokens.
static void append_number(std::string& output, std::string_view raw)
{
    bool negative = raw.starts_with('-');
    if (negative || raw.starts_with('+'))
        raw.remove_prefix(1);
    auto point = raw.find('.');
    auto integer = raw.substr(0, point);
    auto fraction = point == raw.npos ? std::string_view {} : raw.substr(point + 1);
    auto first = integer.find_first_not_of('0');
    integer.remove_prefix(first == integer.npos ? integer.size() : first);
    auto last = fraction.find_last_not_of('0');
    fraction = fraction.substr(0, last == fraction.npos ? 0 : last + 1);
    if (negative && (!integer.empty() || !fraction.empty()))
        output += '-';
    output.append(integer.empty() ? "0" : integer);
    if (!fraction.empty()) {
        output += '.';
        output.append(fraction);
    }
}
std::string geometry(const std::vector<Operation>& ops, std::size_t start, std::size_t end, const Matrix& matrix)
{
    std::string result;
    for (auto n : matrix) {
        append_number(result, decimal(n));
        result += ' ';
    }
    for (std::size_t i = start; i < end; ++i) {
        if (empty_move(ops, i, end))
            continue;
        for (const auto& token : ops[i].operands) {
            if (token.type == QPDFTokenizer::tt_integer || token.type == QPDFTokenizer::tt_real)
                append_number(result, token.raw);
            else
                result += token.raw;
            result += ' ';
        }
        result += ops[i].op + " ";
    }
    return result;
}
}
