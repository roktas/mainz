#include "processor.hh"
#include "processor/engine.hh"
#include <new>
#include <utility>

namespace mainz {
using namespace detail;
Document::Document(std::string input, std::string description, bool prepared, std::shared_ptr<const Index> index)
    : bytes(std::move(input))
    , description(std::move(description))
    , has_contract(prepared)
    , index(std::move(index))
{
}
Document Document::read(std::string input)
{
    try {
        Engine engine(input);
        return Document(std::move(input), engine.describe(), !object(engine.manifest).empty(), engine.take_index());
    } catch (const Error&) {
        throw;
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Processor allocation failed.");
    } catch (const std::exception& error) {
        throw Error("pdf-syntax", error.what());
    }
}
Document Document::change(const std::string& input, Change operation) const
{
    try {
        require(has_contract, "PDF has no mainz.json attachment.", "missing-contract");
        auto request = operation == Change::reset_all ? JSON::makeArray() : parse(input, "request");
        auto current = object(JSON::parse(description).getDictItem("parameters"));
        for (auto& [id, parameter] : current) {
            (void)id;
            parameter = parameter.getDictItem("parameter");
        }
        std::set<std::string> ids;
        bool changed = false;
        try {
            if (operation != Change::apply) {
                for (const auto& item : array(request)) {
                    auto id = text(item);
                    require(current.contains(id), "Unknown parameter: " + id);
                    require(ids.insert(id).second, "Duplicate reset ID: " + id);
                }
                if (operation == Change::reset_all)
                    for (const auto& [id, parameter] : current) {
                        (void)parameter;
                        ids.insert(id);
                    }
            } else
                for (const auto& [id, item] : object(request)) {
                    try {
                        require(current.contains(id), "Unknown parameter: " + id);
                        auto parameter = current.at(id);
                        auto binding = parameter.getDictItem("binding");
                        value(item, parameter.getDictItem("schema"), text(binding.getDictItem("property")));
                        changed = changed || !object(parameter).contains("value")
                            || !equal(parameter.getDictItem("value"), item);
                        parameter.addDictionaryMember("value", item);
                        ids.insert(id);
                    } catch (const Error& error) {
                        throw Error("invalid-request", error.what(), "request", "/" + pointer(id));
                    }
                }
        } catch (const Error& error) {
            if (!error.source().empty())
                throw;
            throw Error("invalid-request", error.what(), "request", "");
        }
        if (operation != Change::apply)
            for (const auto& id : ids)
                changed = changed || object(current.at(id)).contains("value");
        if (!changed)
            return *this;
        Budget budget;
        auto syntax = index;
        auto output = [&] {
            Engine engine(bytes, &budget, true, syntax.get());
            auto next = JSON::makeDictionary();
            for (const auto& [id, parameter] : current) {
                if (operation != Change::apply && ids.contains(id)) {
                    auto copy = JSON::makeDictionary();
                    for (const auto& [key, item] : object(parameter))
                        if (key != "value")
                            copy.addDictionaryMember(key, item);
                    next.addDictionaryMember(id, copy);
                } else
                    next.addDictionaryMember(id, parameter);
            }
            engine.manifest.addDictionaryMember("parameters", next);
            auto output = engine.write(engine.manifest);
            syntax = engine.take_index();
            return output;
        }();
        // Release the editing graph before allocating the independently validated output graph.
        Engine reopened(output, &budget, false, syntax.get());
        return Document(std::move(output), reopened.describe(), true, reopened.take_index());
    } catch (const Error&) {
        throw;
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Processor allocation failed.");
    } catch (const std::exception& error) {
        throw Error("pdf-syntax", error.what());
    }
}
Document Document::apply(const std::string& request) const { return change(request, Change::apply); }
Document Document::reset(const std::optional<std::string>& ids) const
{
    return change(ids.value_or("[]"), ids ? Change::reset : Change::reset_all);
}
Document Document::extract(const std::string& pages) const
{
    try {
        Budget budget;
        auto output = [&] {
            Engine engine(bytes, &budget, true, index.get());
            return engine.extract(parse(pages, "request"), bytes);
        }();
        if (output == bytes)
            return *this;
        Engine reopened(output, &budget, false, index.get());
        return Document(
            std::move(output), reopened.describe(), !object(reopened.manifest).empty(), reopened.take_index());
    } catch (const Error&) {
        throw;
    } catch (const std::bad_alloc&) {
        throw Error("limit-exceeded", "Processor allocation failed.");
    } catch (const std::exception& error) {
        throw Error("pdf-syntax", error.what());
    }
}
}
