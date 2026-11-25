#include "content.hh"
#include <charconv>
#include <cmath>
#include <qpdf/BufferInputSource.hh>

namespace mainz::detail {
using Token = QPDFTokenizer::Token;
class Tokens {
public:
    explicit Tokens(const std::string& bytes)
    {
        content.bytes = std::make_unique<std::string>(bytes);
        data = *content.bytes;
    }
    Content content;
    void reset()
    {
        content.operations.clear();
        content.operands.clear();
        content.names.clear();
        content.ends.clear();
        content.scopes.clear();
        content.scope_bytes = 0;
        begin = 0;
        first = 0;
        starts.clear();
        nesting.clear();
    }
    void handleToken(const Token& token, std::size_t start, std::size_t end)
    {
        auto type = token.getType();
        append(type, start, end, type == QPDFTokenizer::tt_name ? token.getValue() : "");
    }
    bool scan()
    {
        // Strings, dictionaries, escaped names, and inline images stay with QPDF's complete lexer.
        if (data.find_first_of("()<>{}#") != data.npos)
            return false;
        static const std::set<std::string_view> operators {"q", "Q", "cm", "w", "G", "RG", "g", "rg", "gs", "m", "l",
            "c", "v", "y", "h", "re", "S", "s", "f", "f*", "B", "B*", "b", "b*", "n", "W", "W*", "Do", "BMC", "BDC",
            "EMC", "J", "j", "M", "d"};
        auto space = [](char c) { return c == '\0' || c == '\t' || c == '\n' || c == '\f' || c == '\r' || c == ' '; };
        auto digit = [](char c) { return c >= '0' && c <= '9'; };
        std::size_t position = 0;
        while (position < data.size()) {
            if (space(data[position])) {
                ++position;
                continue;
            }
            if (data[position] == '%') {
                position = data.find_first_of("\r\n", position);
                if (position == data.npos)
                    break;
                continue;
            }
            auto start = position++;
            if (data[start] == '[' || data[start] == ']') {
                append(data[start] == '[' ? QPDFTokenizer::tt_array_open : QPDFTokenizer::tt_array_close, start,
                    position, {});
                continue;
            }
            bool named = data[start] == '/';
            while (position < data.size() && !space(data[position]) && data[position] != '/' && data[position] != '%'
                && data[position] != '[' && data[position] != ']')
                ++position;
            auto raw = data.substr(start, position - start);
            auto type = QPDFTokenizer::tt_name;
            if (!named) {
                std::size_t n = raw.front() == '+' || raw.front() == '-' ? 1 : 0;
                auto first = n;
                while (n < raw.size() && digit(raw[n]))
                    ++n;
                auto digits = n - first;
                type = QPDFTokenizer::tt_integer;
                if (n < raw.size() && raw[n] == '.') {
                    type = QPDFTokenizer::tt_real;
                    first = ++n;
                    while (n < raw.size() && digit(raw[n]))
                        ++n;
                    digits += n - first;
                }
                if (!digits || n != raw.size()) {
                    if (!operators.contains(raw))
                        return false;
                    type = QPDFTokenizer::tt_word;
                }
            }
            append(type, start, position, named ? raw : std::string_view {});
        }
        return true;
    }
    void append(QPDFTokenizer::token_type_e type, std::size_t start, std::size_t end, std::string_view decoded)
    {
        require(type != QPDFTokenizer::tt_bad, "Invalid content token.", "pdf-syntax");
        if (type == QPDFTokenizer::tt_eof)
            return;
        if (type == QPDFTokenizer::tt_space || type == QPDFTokenizer::tt_comment)
            return;
        if (content.operands.size() == first)
            begin = start;
        if (type == QPDFTokenizer::tt_inline_image) {
            require(content.operands.size() == first && nesting.empty(), "Malformed inline image.", "pdf-syntax");
            require(content.operations.size() < 1000000, "Content operations exceed 1000000.", "limit-exceeded");
            starts.push_back(first);
            content.operations.push_back({"inline-image", {}, start, end});
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
            starts.push_back(first);
            content.operations.push_back({data.substr(start, end - start), {}, begin, end});
            first = content.operands.size();
        } else {
            require(content.operands.size() - first < 50000, "Content operands exceed 50000.", "limit-exceeded");
            auto raw = data.substr(start, end - start);
            auto name = type == QPDFTokenizer::tt_name ? &*content.names.emplace(decoded).first : nullptr;
            content.operands.push_back({type, raw, name});
        }
    }
    void handleEOF()
    {
        require(content.operands.size() == first && nesting.empty(), "Trailing content operands.", "pdf-syntax");
        content.operations.shrink_to_fit();
        content.operands.shrink_to_fit();
        for (std::size_t i = 0; i < content.operations.size(); ++i) {
            auto end = i + 1 < starts.size() ? starts[i + 1] : content.operands.size();
            content.operations[i].operands
                = std::span<const Operand>(content.operands).subspan(starts[i], end - starts[i]);
        }
    }

private:
    std::string_view data;
    std::size_t begin {0}, first {0};
    std::vector<std::size_t> starts;
    std::vector<QPDFTokenizer::token_type_e> nesting;
};
std::string name(const Operation& op, std::size_t i)
{
    require(
        i < op.operands.size() && op.operands[i].type == QPDFTokenizer::tt_name, "Expected a PDF name.", "pdf-syntax");
    return *op.operands[i].name;
}
double operand(const Operation& op, std::size_t i)
{
    require(i < op.operands.size()
            && (op.operands[i].type == QPDFTokenizer::tt_integer || op.operands[i].type == QPDFTokenizer::tt_real),
        "Expected a PDF number.", "pdf-syntax");
    return pdf_number(op.operands[i].raw);
}
static bool try_operand(const Operation& op, std::size_t i, double& result)
{
    if (i >= op.operands.size()
        || (op.operands[i].type != QPDFTokenizer::tt_integer && op.operands[i].type != QPDFTokenizer::tt_real))
        return false;
    auto raw = op.operands[i].raw;
    if (raw.starts_with('+')) {
        raw.remove_prefix(1);
        if (raw.starts_with('-'))
            return false;
    }
    auto [end, error] = std::from_chars(raw.data(), raw.data() + raw.size(), result, std::chars_format::fixed);
    return error == std::errc {} && end == raw.data() + raw.size() && std::isfinite(result);
}
void count(const Operation& op, std::size_t n)
{
    if (op.operands.size() != n)
        throw Error("pdf-syntax", "Invalid operand count for " + std::string(op.op));
}
Content tokenize(const std::string& data)
{
    Tokens tokens(data);
    if (!tokens.scan()) {
        tokens.reset();
        Buffer buffer(*tokens.content.bytes);
        BufferInputSource input("Mainz content", &buffer);
        QPDFTokenizer tokenizer;
        tokenizer.allowEOF();
        while (true) {
            auto token = tokenizer.readToken(input, "", true);
            if (token.getType() == QPDFTokenizer::tt_eof)
                break;
            tokens.handleToken(
                token, static_cast<std::size_t>(input.getLastOffset()), static_cast<std::size_t>(input.tell()));
            if (token.isWord("ID")) {
                char space {};
                input.read(&space, 1);
                tokenizer.expectInlineImage(input);
            }
        }
    }
    tokens.handleEOF();
    auto& content = tokens.content;
    std::vector<std::size_t> marked;
    for (std::size_t i = 0; i < content.operations.size(); ++i) {
        const auto& op = content.operations[i];
        if (op.op == "BMC" || op.op == "BDC") {
            if (op.op == "BMC") {
                count(op, 1);
                name(op, 0);
            } else {
                require(op.operands.size() >= 2, "Invalid operand count for BDC", "pdf-syntax");
                name(op, 0);
                if (op.operands[1].type == QPDFTokenizer::tt_name)
                    count(op, 2);
                else {
                    require(
                        op.operands[1].type == QPDFTokenizer::tt_dict_open, "Invalid BDC properties.", "pdf-syntax");
                    std::size_t depth = 0;
                    for (std::size_t j = 1; j < op.operands.size(); ++j) {
                        if (op.operands[j].type == QPDFTokenizer::tt_dict_open)
                            ++depth;
                        else if (op.operands[j].type == QPDFTokenizer::tt_dict_close) {
                            require(depth > 0, "Invalid BDC properties.", "pdf-syntax");
                            --depth;
                            require(depth > 0 || j + 1 == op.operands.size(), "Invalid operand count for BDC",
                                "pdf-syntax");
                        }
                    }
                    require(depth == 0, "Invalid BDC properties.", "pdf-syntax");
                }
            }
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
    // Pre-analyze valid paint scopes once per immutable stream so repeated Form invocations skip re-parsing.
    for (const auto& [begin, end] : content.ends) {
        const auto& open = content.operations[begin];
        if (open.op != "BDC" || open.operands.size() != 2 || open.operands[0].type != QPDFTokenizer::tt_name
            || *open.operands[0].name != "/Figure" || open.operands[1].type != QPDFTokenizer::tt_name)
            continue;
        if (end < begin + 9)
            continue;
        const auto& ops = content.operations;
        if (ops[begin + 1].op != "q" || !ops[begin + 1].operands.empty() || ops[begin + 2].op != "w"
            || ops[begin + 2].operands.size() != 1 || (ops[begin + 3].op != "G" && ops[begin + 3].op != "RG")
            || (ops[begin + 4].op != "g" && ops[begin + 4].op != "rg") || ops[begin + 5].op != "gs"
            || ops[begin + 5].operands.size() != 1 || ops[begin + 5].operands[0].type != QPDFTokenizer::tt_name
            || !paint_op(ops[end - 2].op) || !ops[end - 2].operands.empty() || ops[end - 1].op != "Q"
            || !ops[end - 1].operands.empty() || !ops[end].operands.empty())
            continue;
        const std::size_t stroke_n = ops[begin + 3].op.size() == 1 ? 1 : 3;
        const std::size_t fill_n = ops[begin + 4].op.size() == 1 ? 1 : 3;
        if (ops[begin + 3].operands.size() != stroke_n || ops[begin + 4].operands.size() != fill_n)
            continue;
        PaintScope scope;
        bool ok = try_operand(ops[begin + 2], 0, scope.width);
        scope.stroke_count = static_cast<std::uint8_t>(stroke_n);
        for (std::size_t j = 0; ok && j < stroke_n; ++j)
            ok = try_operand(ops[begin + 3], j, scope.stroke[j]);
        scope.fill_count = static_cast<std::uint8_t>(fill_n);
        for (std::size_t j = 0; ok && j < fill_n; ++j)
            ok = try_operand(ops[begin + 4], j, scope.fill[j]);
        if (!ok)
            continue;
        scope.alpha_name = ops[begin + 5].operands[0].name;
        std::vector<bool> closed;
        for (std::size_t i = begin + 6; i < end - 2; ++i) {
            const auto& op = ops[i];
            if (!path_op(op.op)) {
                ok = false;
                break;
            }
            const std::size_t n = op.op == "m" || op.op == "l"  ? 2
                : op.op == "c"                                  ? 6
                : op.op == "v" || op.op == "y" || op.op == "re" ? 4
                                                                : 0;
            if (op.operands.size() != n) {
                ok = false;
                break;
            }
            double value {};
            for (std::size_t j = 0; j < n; ++j)
                if (!try_operand(op, j, value)) {
                    ok = false;
                    break;
                }
            if (!ok)
                break;
            if (empty_move(ops, i, end - 2))
                continue;
            if (op.op == "m" || op.op == "re")
                closed.push_back(op.op == "re");
            else {
                if (closed.empty()) {
                    ok = false;
                    break;
                }
                closed.back() = op.op == "h";
            }
        }
        if (!ok || closed.empty())
            continue;
        bool all_closed = true;
        for (std::size_t k = 0; k + 1 < closed.size(); ++k)
            if (!closed[k]) {
                all_closed = false;
                break;
            }
        scope.closed_plain = all_closed && closed.back();
        scope.closed_implicit = all_closed && (closed.back() || ops[end - 3].op != "m");
        scope.path_key = path_geometry(ops, begin + 6, end - 2);
        content.scope_bytes += sizeof(PaintScope) + scope.path_key.capacity() + sizeof(void*) * 4;
        content.scopes.emplace(begin, std::move(scope));
    }
    return std::move(content);
}
bool path_op(std::string_view op)
{
    return op == "m" || op == "l" || op == "c" || op == "v" || op == "y" || op == "h" || op == "re";
}
bool paint_op(std::string_view op)
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
std::string path_geometry(const std::vector<Operation>& ops, std::size_t start, std::size_t end)
{
    std::string result;
    for (std::size_t i = start; i < end; ++i) {
        if (!path_op(ops[i].op) || empty_move(ops, i, end))
            continue;
        for (const auto& token : ops[i].operands) {
            if (token.type == QPDFTokenizer::tt_integer || token.type == QPDFTokenizer::tt_real)
                append_number(result, token.raw);
            else
                result += token.raw;
            result += ' ';
        }
        result += ops[i].op;
        result += ' ';
    }
    return result;
}
std::string geometry(const std::vector<Operation>& ops, std::size_t start, std::size_t end, const Matrix& matrix)
{
    std::string result;
    for (auto n : matrix) {
        append_number(result, decimal(n));
        result += ' ';
    }
    result += path_geometry(ops, start, end);
    return result;
}
}
