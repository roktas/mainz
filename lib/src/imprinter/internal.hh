#ifndef MAINZ_IMPRINTER_INTERNAL_HH
#define MAINZ_IMPRINTER_INTERNAL_HH

#include "imprinter.hh"
#include <cstddef>
#include <functional>
#include <map>
#include <qpdf/JSON.hh>
#include <qpdf/QPDF.hh>
#include <string>

namespace mainz::imprinter {
struct CaptureBudget {
    std::size_t remaining {pdf_limit}, visits {0}, records {0}, metadata {0};
    std::map<std::string, std::string> baselines;
};
void render(const std::string& svg, JSON targets, const ImprintOptions&,
    const std::function<void(std::string, const std::string&)>&);
void annotate(QPDF&, QPDFObjectHandle form, JSON manifest, JSON definition, const std::string& target,
    const std::string& region, const std::string& resource, CaptureBudget&);
}
#endif
