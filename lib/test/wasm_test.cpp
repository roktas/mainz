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
void mainz_check_recipe_input(
    std::uint32_t id, const char* key, std::size_t key_size, const char* data, std::size_t size);
void mainz_extract(std::uint32_t id, const char* data, std::size_t size);
void mainz_input(const char* id_data, std::size_t id_size, const char* pdf_data, std::size_t pdf_size);
void mainz_clear_inputs();
void mainz_resolve_recipe(const char* data, std::size_t size, int force);
void mainz_close(std::uint32_t id);
const char* mainz_result();
std::size_t mainz_size();
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

std::string minimal_pdf()
{
    QPDF pdf;
    pdf.emptyPDF();
    auto page = QPDFObjectHandle::newDictionary({{"/Type", QPDFObjectHandle::newName("/Page")},
        {"/MediaBox",
            QPDFObjectHandle::newArray({QPDFObjectHandle::newInteger(0), QPDFObjectHandle::newInteger(0),
                QPDFObjectHandle::newInteger(72), QPDFObjectHandle::newInteger(72)})},
        {"/Resources", QPDFObjectHandle::newDictionary()}});
    QPDFPageDocumentHelper(pdf).addPage(QPDFPageObjectHelper(page), false);
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

    const std::string recipe
        = R"({"version":1,"inputs":{"a":{}},"sources":{"s":{"input":"a"}},"parts":[{"pages":[{"source":"s","page":0}]}]})";
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
    return 0;
}
