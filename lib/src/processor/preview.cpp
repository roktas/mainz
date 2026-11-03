#include "engine.hh"
#include <cstdint>
#include <qpdf/QPDFEmbeddedFileDocumentHelper.hh>
#include <qpdf/QPDFFileSpecObjectHelper.hh>
#include <qpdf/QPDFNameTreeObjectHelper.hh>
#include <string_view>
#include <zlib.h>

namespace mainz::detail {
namespace {
    std::uint32_t integer(std::string_view bytes, std::size_t offset)
    {
        std::uint32_t value {0};
        for (std::size_t i = 0; i < 4; ++i)
            value = (value << 8U) | static_cast<std::uint32_t>(static_cast<unsigned char>(bytes.at(offset + i)));
        return value;
    }
    JSON png(std::string_view bytes)
    {
        require(bytes.starts_with("\x89PNG\r\n\x1a\n"), "Invalid preview PNG signature.");
        std::size_t offset = 8, chunks = 0;
        std::uint32_t width = 0, height = 0;
        unsigned char depth = 0, color = 0;
        bool palette = false, data = false, data_ended = false;
        std::size_t data_bytes = 0;
        while (offset < bytes.size()) {
            require(++chunks <= 65536, "PNG chunks exceed 65536.", "limit-exceeded");
            require(bytes.size() - offset >= 12, "Truncated PNG chunk.");
            auto size = static_cast<std::size_t>(integer(bytes, offset));
            require(size <= bytes.size() - offset - 12, "PNG chunk exceeds its payload.");
            auto type = bytes.substr(offset + 4, 4);
            for (char c : type)
                require((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'), "Invalid PNG chunk type.");
            require(type[2] >= 'A' && type[2] <= 'Z', "Invalid PNG reserved chunk bit.");
            auto checksum
                = crc32(0, reinterpret_cast<const Bytef*>(bytes.data() + offset + 4), static_cast<uInt>(size + 4));
            require(checksum == integer(bytes, offset + size + 8), "PNG chunk checksum mismatch.");
            require(type != "acTL" && type != "fcTL" && type != "fdAT", "Animated PNG previews are unsupported.");
            auto payload = bytes.substr(offset + 8, size);
            require(chunks != 1 || type == "IHDR", "PNG must start with IHDR.");
            if (type == "IHDR") {
                require(chunks == 1 && size == 13, "Invalid or repeated PNG header.");
                width = integer(payload, 0);
                height = integer(payload, 4);
                require(
                    width > 0 && height > 0 && width <= 2147483647 && height <= 2147483647, "Invalid PNG dimensions.");
                require(width <= 16777216 && height <= 16777216 / width, "Preview pixels exceed 16777216.",
                    "limit-exceeded");
                depth = static_cast<unsigned char>(payload[8]);
                color = static_cast<unsigned char>(payload[9]);
                bool valid = color == 0 ? depth == 1 || depth == 2 || depth == 4 || depth == 8 || depth == 16
                    : color == 3        ? depth == 1 || depth == 2 || depth == 4 || depth == 8
                    : color == 2 || color == 4 || color == 6 ? depth == 8 || depth == 16
                                                             : false;
                require(valid && payload[10] == 0 && payload[11] == 0 && (payload[12] == 0 || payload[12] == 1),
                    "Unsupported PNG header.");
            } else if (type == "PLTE") {
                require(!palette && !data && color != 0 && color != 4 && size > 0 && size <= 768 && size % 3 == 0,
                    "Invalid PNG palette.");
                require(color != 3 || size / 3 <= (std::size_t {1} << depth), "PNG palette exceeds its bit depth.");
                palette = true;
            } else if (type == "IDAT") {
                require(!data_ended && (color != 3 || palette), "Invalid PNG image-data order.");
                data = true;
                data_bytes += size;
            } else if (type == "IEND") {
                require(size == 0 && data && data_bytes > 0 && offset + 12 == bytes.size(), "Invalid PNG ending.");
                return dictionary({{"width", JSON::makeInt(width)}, {"height", JSON::makeInt(height)}});
            } else {
                require(type[0] >= 'a' && type[0] <= 'z', "Unknown critical PNG chunk.");
                if (data)
                    data_ended = true;
            }
            offset += size + 12;
        }
        throw Error("invalid-contract", "PNG has no IEND chunk.");
    }
}
JSON Engine::image(const std::string& file)
{
    if (auto found = images.find(file); found != images.end())
        return found->second;
    auto stream = files.at(file).getKey("/EF").getKey("/F");
    auto bytes = decode(stream, budget, pdf_limit);
    auto descriptor = png(bytes);
    if (bytes.size() <= manifest_limit - previews.bytes) {
        previews.bytes += bytes.size();
        previews.images.emplace(file, std::make_shared<const std::string>(std::move(bytes)));
    }
    descriptor.addDictionaryMember("file", JSON::makeString(file));
    images.emplace(file, descriptor);
    return descriptor;
}
void Engine::load_previews(bool validate)
{
    auto entries = array(manifest.getDictItem("pages"));
    for (std::size_t page = 0; page < entries.size(); ++page) {
        auto preview = entries[page].getDictItem("preview");
        if (preview.isNull())
            continue;
        try {
            auto file = text(preview);
            previews.pages[page] = file;
            require(file != "mainz.json" && files.contains(file), "Missing preview PNG attachment.");
            auto spec = files.at(file);
            require(spec.getKey("/F").isString() && spec.getKey("/UF").isString()
                    && spec.getKey("/F").getUTF8Value() == file && spec.getKey("/UF").getUTF8Value() == file,
                "Preview Filespec names do not match.");
            auto ef = spec.getKey("/EF");
            require(ef.isDictionary(), "Preview attachment has no embedded payload.");
            auto stream = ef.getKey("/F"), unicode_stream = ef.getKey("/UF");
            require(stream.isStream() && unicode_stream.isStream() && stream.isSameObjectAs(unicode_stream),
                "Preview attachment payload references differ.");
            require(stream.getDict().getKey("/Subtype").isNameAndEquals("/image/png"),
                "Preview attachment must use image/png.");
            if (managed_previews.insert(file).second && validate)
                image(file);
        } catch (const Error& error) {
            throw Error(error.code(), error.what(), "manifest", "/pages/" + std::to_string(page) + "/preview");
        }
    }
}
std::string Engine::preview(std::size_t page)
{
    if (page >= pages.size())
        throw Error("invalid-request", "Preview page is outside the PDF.", "request", "");
    if (object(manifest).empty())
        return {};
    auto value = array(manifest.getDictItem("pages")).at(page).getDictItem("preview");
    if (value.isNull())
        return {};
    return decode(files.at(text(value)).getKey("/EF").getKey("/F"), budget, pdf_limit);
}
void prune_previews(QPDF& document, const std::set<std::string>& managed, JSON pages, Budget& budget)
{
    if (managed.empty())
        return;
    std::set<std::string> used;
    for (const auto& page : array(pages))
        if (auto preview = page.getDictItem("preview"); !preview.isNull())
            used.insert(text(preview));
    QPDFEmbeddedFileDocumentHelper files(document);
    QPDFNameTreeObjectHelper tree(document.getRoot().getKey("/Names").getKey("/EmbeddedFiles"), document, false);
    std::map<std::string, Object> removed;
    for (const auto& file : managed)
        if (!used.contains(file))
            if (auto spec = files.getEmbeddedFile(file)) {
                removed.emplace(file, spec->getObjectHandle());
                // The file helper also destroys the Filespec, including surviving references outside this tree.
                tree.find(file).remove();
            }
    if (removed.empty())
        return;
    std::set<QPDFObjGen> seen;
    std::set<std::string> named;
    std::vector<Object> pending {document.getTrailer()};
    while (!pending.empty()) {
        require(++budget.visits <= 65536, "Preview reference traversal exceeds 65536 visits.", "limit-exceeded");
        auto object = pending.back();
        pending.pop_back();
        if (object.isIndirect() && !seen.insert(object.getObjGen()).second)
            continue;
        if (object.isStream())
            object = object.getDict();
        if (object.isString())
            named.insert(object.getUTF8Value());
        if (object.isDictionary()) {
            auto keys = object.getKeys();
            require(keys.size() <= 65536 - budget.visits - pending.size(), "Preview references exceed limit.",
                "limit-exceeded");
            for (const auto& key : keys)
                pending.push_back(object.getKey(key));
        } else if (object.isArray()) {
            auto count = static_cast<std::size_t>(object.getArrayNItems());
            require(
                count <= 65536 - budget.visits - pending.size(), "Preview references exceed limit.", "limit-exceeded");
            for (const auto& item : object.getArrayAsVector())
                pending.push_back(item);
        }
    }
    for (const auto& [file, spec] : removed)
        if (named.contains(file) || seen.contains(spec.getObjGen())
            || seen.contains(spec.getKey("/EF").getKey("/F").getObjGen()))
            files.replaceEmbeddedFile(file, QPDFFileSpecObjectHelper(spec));
}
}
