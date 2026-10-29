#ifndef MAINZ_PRODUCER_HH
#define MAINZ_PRODUCER_HH

#include "processor.hh"
#include <optional>
#include <string>

namespace mainz {
struct ProduceOptions {
    std::optional<double> width, height;
    double dpi {96};
};
// SVG and declaration bytes in; an independently validated, prepared PDF out.
Document produce(const std::string& svg, const std::string& declaration, const ProduceOptions& = {});
}
#endif
