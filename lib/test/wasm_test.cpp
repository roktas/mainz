#include "contract.hh"
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <qpdf/JSON.hh>
#include <qpdf/QPDF.hh>
#include <qpdf/QPDFPageDocumentHelper.hh>
#include <qpdf/QPDFWriter.hh>
#include <string>
#include <string_view>

extern "C" {
std::uint32_t mainz_read(const char* data, std::size_t size);
void mainz_describe(std::uint32_t id);
void mainz_fingerprint(std::uint32_t id);
void mainz_reference(std::uint32_t id);
void mainz_check_recipe_input(
    std::uint32_t id, const char* key, std::size_t key_size, const char* data, std::size_t size);
void mainz_style(std::uint32_t id, const char* data, std::size_t size, const char* reset, std::size_t reset_size);
void mainz_reset(std::uint32_t id, const char* data, std::size_t size, int supplied);
void mainz_extract(std::uint32_t id, const char* data, std::size_t size);
void mainz_preview(std::uint32_t id, double page);
void mainz_input(const char* id_data, std::size_t id_size, const char* pdf_data, std::size_t pdf_size);
void mainz_clear_inputs();
void mainz_compose(const char* data, std::size_t size);
void mainz_recipe_inputs(const char* data, std::size_t size);
void mainz_resolve_recipe(const char* data, std::size_t size, int force);
void mainz_close(std::uint32_t id);
const char* mainz_result();
std::size_t mainz_size();
const char* mainz_provenance();
std::size_t mainz_provenance_size();
int mainz_status();
}

namespace {
void expect(bool condition, const char* message)
{
    if (!condition) {
        std::cerr << "wasm_test failed: " << message << '\n';
        std::exit(1);
    }
}

std::string minimal_pdf(int width = 72)
{
    QPDF pdf;
    pdf.emptyPDF();
    auto page = QPDFObjectHandle::newDictionary({{"/Type", QPDFObjectHandle::newName("/Page")},
        {"/MediaBox",
            QPDFObjectHandle::newArray({QPDFObjectHandle::newInteger(0), QPDFObjectHandle::newInteger(0),
                QPDFObjectHandle::newInteger(width), QPDFObjectHandle::newInteger(72)})},
        {"/Resources", QPDFObjectHandle::newDictionary()}});
    QPDFPageDocumentHelper(pdf).addPage(QPDFPageObjectHelper(page), false);
    QPDFWriter writer(pdf);
    writer.setOutputMemory();
    writer.write();
    auto buffer = writer.getBufferSharedPointer();
    return {reinterpret_cast<const char*>(buffer->getBuffer()), buffer->getSize()};
}

std::string minimal_prepared_pdf()
{
    QPDF pdf;
    pdf.emptyPDF();
    auto contents = QPDFObjectHandle::newStream(
        &pdf, "/Figure /Reg BDC /Figure /Ink BDC q 1 w 0 G 0 g /A gs 0 0 10 10 re S Q EMC EMC");
    auto resources = QPDFObjectHandle::newDictionary({
        {"/Properties",
            QPDFObjectHandle::newDictionary(
                {{"/Reg", QPDFObjectHandle::newDictionary()}, {"/Ink", QPDFObjectHandle::newDictionary()}})},
        {"/ExtGState",
            QPDFObjectHandle::newDictionary({{"/A",
                QPDFObjectHandle::newDictionary({{"/Type", QPDFObjectHandle::newName("/ExtGState")},
                    {"/CA", QPDFObjectHandle::newInteger(1)}, {"/ca", QPDFObjectHandle::newInteger(0)}})}})},
    });
    auto page = QPDFObjectHandle::newDictionary({
        {"/Type", QPDFObjectHandle::newName("/Page")},
        {"/MediaBox",
            QPDFObjectHandle::newArray({QPDFObjectHandle::newInteger(0), QPDFObjectHandle::newInteger(0),
                QPDFObjectHandle::newInteger(72), QPDFObjectHandle::newInteger(72)})},
        {"/Contents", contents},
        {"/Resources", resources},
    });
    QPDFPageDocumentHelper(pdf).addPage(QPDFPageObjectHelper(page), false);
    const std::string manifest
        = R"({"version":1,"pages":[{"name":"cover"}],"regions":{"r":{"page":0,"marker":"Reg","records":[{"path":[],"marker":"Ink","baseline":"b","fill":"none"}]}},"baselines":{"b":{"paint":"S","width":"1","stroke":{"operator":"G","operands":["0"]},"fill":{"operator":"g","operands":["0"]},"strokeOpacity":"1","fillOpacity":"0","display":"inline","fillRule":"nonzero"}},"targets":{"t":["r"]},"parameters":{"opacity":{"schema":{"type":"number","minimum":0,"maximum":1},"binding":{"targets":["t"],"property":"stroke-opacity"}}}})";
    auto ef_stream = QPDFObjectHandle::newStream(&pdf, manifest);
    ef_stream.replaceDict(QPDFObjectHandle::newDictionary({{"/Type", QPDFObjectHandle::newName("/EmbeddedFile")},
        {"/Subtype", QPDFObjectHandle::newName("/application/json")}}));
    auto filespec = pdf.makeIndirectObject(QPDFObjectHandle::newDictionary({
        {"/Type", QPDFObjectHandle::newName("/Filespec")},
        {"/F", QPDFObjectHandle::newUnicodeString("mainz.json")},
        {"/UF", QPDFObjectHandle::newUnicodeString("mainz.json")},
        {"/EF", QPDFObjectHandle::newDictionary({{"/F", ef_stream}, {"/UF", ef_stream}})},
    }));
    auto names = QPDFObjectHandle::newDictionary({{"/EmbeddedFiles",
        QPDFObjectHandle::newDictionary(
            {{"/Names", QPDFObjectHandle::newArray({QPDFObjectHandle::newUnicodeString("mainz.json"), filespec})}})}});
    pdf.getRoot().replaceKey("/Names", names);
    QPDFWriter writer(pdf);
    writer.setOutputMemory();
    writer.write();
    auto buffer = writer.getBufferSharedPointer();
    return {reinterpret_cast<const char*>(buffer->getBuffer()), buffer->getSize()};
}

std::string_view result_view() { return {mainz_result(), mainz_size()}; }
}

int main()
{
    using namespace mainz::detail;
    auto pdf = minimal_pdf();

    auto missing = mainz_read(nullptr, 4);
    expect(missing == 0 && mainz_status() == 2, "null buffer with nonzero size must return status 2");
    expect(result_view().find("hostError") != std::string_view::npos, "status 2 must return hostError JSON");

    auto handle = mainz_read(pdf.data(), pdf.size());
    expect(handle != 0 && mainz_status() == 0, "valid PDF read must succeed");

    auto second = mainz_read(pdf.data(), pdf.size());
    expect(second == 0 && mainz_status() == 2, "opening a second active document must fail with status 2");

    mainz_describe(handle + 1);
    expect(mainz_status() == 2, "invalid handle must fail with status 2");

    mainz_describe(handle);
    expect(mainz_status() == 0, "describe must succeed for active handle");
    auto described = JSON::parse(std::string(result_view()));
    expect(number(described.getDictItem("pageCount")) == 1, "pageCount must be 1");

    mainz_fingerprint(handle);
    expect(mainz_status() == 0 && mainz_size() == 64, "fingerprint must return 64-char sha256 hex");
    const std::string hex_digest(result_view());

    mainz_reference(handle);
    expect(mainz_status() == 0, "reference must succeed for active handle");
    auto reference = JSON::parse(std::string(result_view()));
    expect(text(reference.getDictItem("sha256")) == hex_digest && number(reference.getDictItem("pageCount")) == 1,
        "reference must match fingerprint and pageCount");

    const std::string recipe
        = R"({"version":1,"inputs":{"a":{}},"sources":{"s":{"input":"a"}},"parts":[{"pages":[{"source":"s","page":0}]}]})";
    mainz_recipe_inputs(recipe.data(), recipe.size());
    expect(mainz_status() == 0 && has_member(JSON::parse(std::string(result_view())), "a"),
        "recipe_inputs must parse and return input declarations");

    mainz_preview(handle, -1.0);
    expect(
        mainz_status() == 1 && text(JSON::parse(std::string(result_view())).getDictItem("code")) == "invalid-request",
        "negative preview page must fail with invalid-request");

    mainz_reset(handle, "[]", 2, 2);
    expect(
        mainz_status() == 1 && text(JSON::parse(std::string(result_view())).getDictItem("code")) == "invalid-request",
        "non-Boolean supplied flag in reset must fail with invalid-request");

    mainz_reset(handle, "[]", 2, 0);
    expect(
        mainz_status() == 1 && text(JSON::parse(std::string(result_view())).getDictItem("code")) == "invalid-request",
        "reset with supplied=0 and nonzero size must fail with invalid-request");

    mainz_style(handle, "{}", 2, "[]", 2);
    expect(
        mainz_status() == 1 && text(JSON::parse(std::string(result_view())).getDictItem("code")) == "missing-contract",
        "style on ordinary PDF must fail with missing-contract");

    const char invalid_utf8[] = {'\xff', '\xfe'};
    mainz_check_recipe_input(handle, invalid_utf8, sizeof(invalid_utf8), recipe.data(), recipe.size());
    expect(mainz_status() == 1, "invalid UTF-8 recipe key must fail with status 1");
    expect(text(JSON::parse(std::string(result_view())).getDictItem("code")) == "invalid-request",
        "invalid UTF-8 recipe key must return invalid-request");

    const std::string pages = "[0]";
    mainz_extract(handle, pages.data(), pages.size());
    expect(mainz_status() == 0 && mainz_size() > 0 && result_view().starts_with("%PDF-"),
        "extract must return valid PDF bytes");

    mainz_close(handle);
    expect(mainz_status() == 0, "close must succeed");

    // Exercise mainz_style, mainz_reset, and completed Document reuse across input, resolve_recipe, and compose.
    auto prepared = minimal_prepared_pdf();
    auto prep_h = mainz_read(prepared.data(), prepared.size());
    expect(prep_h != 0 && mainz_status() == 0, "prepared PDF read must succeed");
    mainz_reset(prep_h, nullptr, 0, 0);
    expect(mainz_status() == 0 && result_view().starts_with("%PDF-"), "full reset with supplied=0 must succeed");
    const std::string style_overrides = R"({"opacity":0.5})";
    mainz_style(prep_h, style_overrides.data(), style_overrides.size(), "[]", 2);
    expect(mainz_status() == 0 && result_view().starts_with("%PDF-") && result_view() != prepared,
        "style on prepared PDF must succeed and update output bytes");
    const std::string styled_bytes(result_view());
    mainz_input("styled", 6, styled_bytes.data(), styled_bytes.size());
    expect(mainz_status() == 0, "registering completed output as input must succeed");
    const std::string styled_recipe
        = R"({"version":1,"inputs":{"styled":{}},"sources":{"s":{"input":"styled"}},"parts":[{"pages":[{"source":"s","page":0}]}]})";
    mainz_resolve_recipe(styled_recipe.data(), styled_recipe.size(), 1);
    expect(mainz_status() == 0, "resolve_recipe reusing completed document must succeed");
    const std::string styled_plan
        = R"({"version":1,"sources":{"s":{"input":"styled","overrides":{}}},"parts":[{"pages":[{"source":"s","page":0}]}]})";
    mainz_compose(styled_plan.data(), styled_plan.size());
    expect(
        mainz_status() == 0 && result_view().starts_with("%PDF-"), "compose reusing completed document must succeed");
    expect(mainz_provenance_size() > 0
            && has_member(JSON::parse(std::string(mainz_provenance(), mainz_provenance_size())), "pages"),
        "compose must publish provenance JSON");
    mainz_close(prep_h);
    mainz_clear_inputs();

    // Verify LRU eviction beyond 32 cached documents and duplicate input ID rejection.
    for (int i = 0; i < 35; ++i) {
        auto distinct = minimal_pdf(72 + i);
        auto h = mainz_read(distinct.data(), distinct.size());
        expect(h != 0 && mainz_status() == 0, "reading distinct PDF into bounded LRU cache must succeed");
        mainz_close(h);
    }
    mainz_input("dup", 3, pdf.data(), pdf.size());
    expect(mainz_status() == 0, "first registration of dup input must succeed");
    mainz_input("dup", 3, pdf.data(), pdf.size());
    expect(
        mainz_status() == 1 && text(JSON::parse(std::string(result_view())).getDictItem("code")) == "invalid-request",
        "duplicate input ID must fail with invalid-request");
    mainz_clear_inputs();

    mainz_clear_inputs();
    for (int i = 0; i < 32; ++i) {
        auto id = "in" + std::to_string(i);
        mainz_input(id.data(), id.size(), pdf.data(), pdf.size());
        expect(mainz_status() == 0, "registering up to 32 inputs must succeed");
    }
    const std::string extra = "in32";
    mainz_input(extra.data(), extra.size(), pdf.data(), pdf.size());
    expect(mainz_status() == 1 && text(JSON::parse(std::string(result_view())).getDictItem("code")) == "limit-exceeded",
        "registering a 33rd input must fail with limit-exceeded");

    mainz_resolve_recipe(recipe.data(), recipe.size(), 2);
    expect(
        mainz_status() == 1 && text(JSON::parse(std::string(result_view())).getDictItem("code")) == "invalid-request",
        "non-Boolean force must fail with invalid-request");

    mainz_clear_inputs();
    expect(mainz_status() == 0, "clear inputs must succeed");

    // Exercise multi-input cache reuse across compose and recipe resolution, plus recovery after error.
    auto pdf_a = minimal_pdf(72);
    auto pdf_b = minimal_pdf(144);
    auto h1 = mainz_read(pdf_a.data(), pdf_a.size());
    expect(h1 != 0 && mainz_status() == 0, "first cached input read must succeed");
    mainz_close(h1);
    auto h2 = mainz_read(pdf_b.data(), pdf_b.size());
    expect(h2 != 0 && mainz_status() == 0, "second cached input read must succeed");
    mainz_close(h2);
    mainz_input("a", 1, pdf_a.data(), pdf_a.size());
    expect(mainz_status() == 0, "registering input a must succeed");
    mainz_input("b", 1, pdf_b.data(), pdf_b.size());
    expect(mainz_status() == 0, "registering input b must succeed");
    const std::string multi_plan
        = R"({"version":1,"sources":{"sa":{"input":"a","overrides":{}},"sb":{"input":"b","overrides":{}}},"parts":[{"pages":[{"source":"sa","page":0},{"source":"sb","page":0}]}]})";
    mainz_compose(multi_plan.data(), multi_plan.size());
    expect(mainz_status() == 0 && result_view().starts_with("%PDF-"),
        "multi-input compose with cached inputs must succeed");
    const std::string multi_recipe
        = R"({"version":1,"inputs":{"a":{},"b":{}},"sources":{"sa":{"input":"a"},"sb":{"input":"b"}},"parts":[{"pages":[{"source":"sa","page":0},{"source":"sb","page":0}]}]})";
    mainz_resolve_recipe(multi_recipe.data(), multi_recipe.size(), 1);
    expect(mainz_status() == 0, "multi-input recipe resolve with cached inputs must succeed");
    mainz_compose("{", 1);
    expect(mainz_status() == 1, "invalid compose plan must fail and clear cache cleanly");
    mainz_compose(multi_plan.data(), multi_plan.size());
    expect(mainz_status() == 0 && result_view().starts_with("%PDF-"), "compose must succeed after error cleared cache");
    mainz_clear_inputs();
    expect(mainz_status() == 0, "final clear inputs must succeed");
    return 0;
}
