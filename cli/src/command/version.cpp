#include "command.hh"
#include <cairo.h>
#include <fontconfig/fontconfig.h>
#include <iostream>
#include <librsvg/rsvg.h>
#include <libxml/parser.h>
#include <pango/pango.h>
#include <qpdf/QPDF.hh>

namespace mainz::cli {
void version()
{
    auto rsvg = std::to_string(rsvg_major_version) + '.' + std::to_string(rsvg_minor_version) + '.'
        + std::to_string(rsvg_micro_version);
    auto info = detail::dictionary({{"version", JSON::makeString(MAINZ_VERSION)}, {"contract", JSON::makeInt(1)},
        {"qpdf", JSON::makeString(QPDF::QPDFVersion())}, {"cairo", JSON::makeString(cairo_version_string())},
        {"librsvg", JSON::makeString(rsvg)}, {"libxml", JSON::makeString(xmlParserVersion)},
        {"pango", JSON::makeString(pango_version_string())}, {"fontconfig", JSON::makeInt(FcGetVersion())}});
    std::cout << detail::encode(info, json_limit) << '\n';
}
}
