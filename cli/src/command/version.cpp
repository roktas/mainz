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
    std::cout << "{\"version\":\"" << MAINZ_VERSION << "\",\"contract\":1,\"qpdf\":\"" << QPDF::QPDFVersion()
              << "\",\"cairo\":\"" << cairo_version_string() << "\",\"librsvg\":\"" << rsvg_major_version << '.'
              << rsvg_minor_version << '.' << rsvg_micro_version << "\",\"libxml\":\"" << xmlParserVersion
              << "\",\"pango\":\"" << pango_version_string() << "\",\"fontconfig\":" << FcGetVersion() << "}\n";
}
}
