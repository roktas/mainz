#ifndef MAINZ_IMPRINTER_HH
#define MAINZ_IMPRINTER_HH

#include "processor.hh"
#include <optional>
#include <string>

namespace mainz {
struct ImprintOptions {
    std::optional<double> width, height;
    double dpi {96};
    std::optional<std::string> preview;
};
// SVG and declaration bytes in; an independently validated, prepared PDF out.
Document imprint(const std::string& svg, const std::string& declaration, const ImprintOptions& = {});
}
#endif
