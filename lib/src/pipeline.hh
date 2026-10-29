#ifndef MAINZ_PIPELINE_HH
#define MAINZ_PIPELINE_HH
#include "contract.hh"
#include <cstddef>
#include <exception>
#include <qpdf/Pipeline.hh>
#include <string>

namespace mainz::detail {
class Buffer : public Pipeline {
public:
    Buffer(std::size_t limit, std::size_t& remaining)
        : Pipeline("Mainz bounded buffer", nullptr)
        , limit(limit)
        , remaining(remaining)
    {
    }
    void write(const unsigned char* p, std::size_t n) override
    {
        try {
            require(n <= limit - bytes.size(), "Buffer exceeds its byte limit.", "limit-exceeded");
            require(n <= remaining, "Pipeline byte budget exceeded.", "limit-exceeded");
            remaining -= n;
            bytes.append(reinterpret_cast<const char*>(p), n);
        } catch (...) {
            failure = std::current_exception();
            throw;
        }
    }
    void finish() override { }
    std::string bytes;
    std::exception_ptr failure;

private:
    std::size_t limit;
    std::size_t& remaining;
};
class CompactJSON : public Pipeline {
public:
    explicit CompactJSON(Buffer& output)
        : Pipeline("Mainz compact JSON", nullptr)
        , output(output)
    {
    }
    void write(const unsigned char* p, std::size_t n) override
    {
        std::size_t start = 0;
        for (std::size_t i = 0; i < n; ++i) {
            auto c = p[i];
            if (!quoted && (c == ' ' || c == '\n' || c == '\r' || c == '\t')) {
                if (i > start)
                    output.write(p + start, i - start);
                start = i + 1;
                continue;
            }
            if (escaped)
                escaped = false;
            else if (quoted && c == '\\')
                escaped = true;
            else if (c == '"')
                quoted = !quoted;
        }
        if (n > start)
            output.write(p + start, n - start);
    }
    void finish() override { output.finish(); }

private:
    Buffer& output;
    bool quoted {false}, escaped {false};
};
}
#endif
