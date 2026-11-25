#include "engine.hh"
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <sstream>
#include <utility>

namespace mainz::detail {
static std::vector<std::string> components(JSON color)
{
    std::vector<std::string> result;
    for (const auto& item : array(color.getDictItem("operands")))
        result.push_back(text(item));
    return result;
}
static std::vector<std::string> rgb(JSON value)
{
    auto hex = text(value);
    std::vector<std::string> result;
    result.reserve(3);
    for (int i = 1; i < 7; i += 2)
        result.push_back(decimal(std::stoi(hex.substr(i, 2), nullptr, 16) / 255.0));
    return result;
}
static Style compute_style(const Record& record, const std::map<std::string, JSON>& selected)
{
    auto b = record.baseline;
    Style result {text(b.getDictItem("width")), text(b.getDictItem("stroke").getDictItem("operator")),
        text(b.getDictItem("fill").getDictItem("operator")), text(b.getDictItem("paint")),
        text(b.getDictItem("strokeOpacity")), text(b.getDictItem("fillOpacity")), components(b.getDictItem("stroke")),
        components(b.getDictItem("fill"))};
    for (const auto& [property, choice] : selected) {
        if (property == "stroke-width") {
            auto physical = number(choice);
            auto local = physical * (72.0 / 25.4) / record.unit / record.scale;
            require(std::isfinite(local) && local > 0, "Unrepresentable physical width.", "unsupported-context");
            result.width = decimal(local);
            require(pdf_number(result.width) > 0
                    && std::abs(pdf_number(result.width) * record.scale * record.unit * (25.4 / 72.0) - physical)
                        <= 1e-8,
                "Physical width cannot be serialized accurately.", "unsupported-context");
        } else if (property == "stroke-color") {
            result.stroke_op = "RG";
            result.stroke = rgb(choice);
        } else if (property == "fill-color") {
            result.fill_op = "rg";
            result.fill = rgb(choice);
        } else if (property == "stroke-opacity")
            result.stroke_alpha = decimal(number(choice));
        else if (property == "fill-opacity")
            result.fill_alpha = decimal(number(choice));
    }
    if (record.fill == FillKind::latent && pdf_number(result.fill_alpha) > 0) {
        result.paint = result.paint == "s" ? "b" : "B";
        if (text(b.getDictItem("fillRule")) == "evenodd")
            result.paint += '*';
    }
    auto display = selected.contains("display") ? text(selected.at("display")) : text(b.getDictItem("display"));
    if (display == "none")
        result.stroke_alpha = result.fill_alpha = "0";
    result.width_num = pdf_number(result.width);
    result.stroke_alpha_num = pdf_number(result.stroke_alpha);
    result.fill_alpha_num = pdf_number(result.fill_alpha);
    for (std::size_t i = 0; i < result.stroke.size(); ++i)
        result.stroke_nums[i] = pdf_number(result.stroke[i]);
    for (std::size_t i = 0; i < result.fill.size(); ++i)
        result.fill_nums[i] = pdf_number(result.fill[i]);
    return result;
}
const Style& Engine::paint_style(const Record& record, bool editing)
{
    auto key = std::make_tuple(record.target_idx, record.baseline_key, record.fill, record.scale, record.unit, editing);
    auto found = styles.find(key);
    if (found != styles.end())
        return found->second;
    auto selected = editing ? choices[record.target_idx] : original_choices[record.target_idx];
    if (!record.strokes)
        for (auto property : {"stroke-width", "stroke-color", "stroke-opacity"})
            selected.erase(property);
    if (record.fill == FillKind::none)
        for (auto property : {"fill-color", "fill-opacity"})
            selected.erase(property);
    return styles.emplace(key, compute_style(record, selected)).first->second;
}
std::optional<JSON> Engine::baseline(const Record& record, const std::string& property)
{
    auto b = record.baseline;
    if (property == "display")
        return b.getDictItem("display");
    if (property == "stroke-width") {
        auto width = pdf_number(text(b.getDictItem("width")));
        auto physical = width * record.scale * record.unit * (25.4 / 72.0);
        if (!std::isfinite(physical) || (width > 0 && physical == 0))
            return std::nullopt;
        return JSON::makeNumber(decimal(physical));
    }
    if (property == "stroke-opacity" || property == "fill-opacity")
        return JSON::makeNumber(
            decimal(pdf_number(text(b.getDictItem(property == "stroke-opacity" ? "strokeOpacity" : "fillOpacity")))));
    auto values = components(b.getDictItem(property == "stroke-color" ? "stroke" : "fill"));
    if (values.size() == 1)
        values.resize(3, values.front());
    std::ostringstream hex;
    hex << '#' << std::uppercase << std::hex << std::setfill('0');
    for (const auto& encoded : values) {
        auto n = pdf_number(encoded);
        auto byte = std::round(n * 255);
        if (byte / 255.0 != n)
            return std::nullopt;
        hex << std::setw(2) << static_cast<int>(byte);
    }
    return JSON::makeString(hex.str());
}
JSON Engine::summary(const std::string& id, JSON parameter)
{
    if (summaries.contains(id))
        return summaries.at(id);
    auto property = text(parameter.getDictItem("binding").getDictItem("property"));
    auto schema = parameter.getDictItem("schema");
    std::vector<JSON> colors;
    if (property.ends_with("color")) {
        auto annotation = schema.getDictItem("default");
        if (!annotation.isNull())
            colors.push_back(annotation);
        auto choices_enum = schema.getDictItem("enum");
        if (!choices_enum.isNull())
            for (const auto& choice : array(choices_enum))
                colors.push_back(choice);
    }
    JSON first;
    bool unrepresentable = false;
    std::string raw_first;
    std::set<std::tuple<std::size_t, double, double>> seen;
    for (const auto& index : parameter_records.at(id)) {
        const auto& record = records.at(index);
        auto key = std::make_tuple(record.baseline_key, property == "stroke-width" ? record.scale : 1,
            property == "stroke-width" ? record.unit : 1);
        if (!seen.insert(std::move(key)).second)
            continue;
        auto candidate = baseline(record, property);
        auto raw = candidate ? candidate->unparse() : "";
        if (!candidate && property == "stroke-width") {
            raw = decimal(pdf_number(text(record.baseline.getDictItem("width")))) + " " + decimal(record.scale) + " "
                + decimal(record.unit);
        } else if (!candidate) {
            auto color = components(record.baseline.getDictItem(property == "stroke-color" ? "stroke" : "fill"));
            if (color.size() == 1)
                color.resize(3, color.front());
            raw.clear();
            for (const auto& n : color)
                raw += decimal(pdf_number(n)) + " ";
        }
        if (candidate && !colors.empty()) {
            auto canonical = text(*candidate);
            for (const auto& choice : colors) {
                auto spelling = text(choice);
                if (std::equal(spelling.begin(), spelling.end(), canonical.begin(), canonical.end(),
                        [](char a, char b) { return (a >= 'a' && a <= 'f' ? a - 'a' + 'A' : a) == b; })) {
                    candidate = choice;
                    break;
                }
            }
        }
        if (raw_first.empty()) {
            raw_first = raw;
            if (candidate)
                first = *candidate;
        } else if (raw != raw_first)
            return summaries[id] = dictionary({{"kind", JSON::makeString("mixed")}});
        if (!candidate) {
            unrepresentable = true;
            continue;
        }
        try {
            value(*candidate, schema, property);
        } catch (const Error&) {
            unrepresentable = true;
        }
    }
    if (unrepresentable)
        return summaries[id] = dictionary({{"kind", JSON::makeString("unrepresentable")},
                   {"reason", JSON::makeString("The original paint has no value in this parameter's domain.")}});
    return summaries[id] = dictionary({{"kind", JSON::makeString("uniform")}, {"value", first}});
}
void Engine::update(JSON next, const std::set<std::size_t>* active_pages)
{
    changed_targets.clear();
    changed_pages.clear();
    changed_paths.assign(region_names.size(), {});
    region_locator_changed.assign(region_names.size(), 0);
    for (auto& target_choice : choices)
        target_choice.clear();
    std::unordered_set<std::size_t> invalidated;
    for (const auto& [id, parameter] : object(next.getDictItem("parameters"))) {
        auto previous_param = parameters.at(id);
        bool saved = !previous_param.getDictItem("value").isNull();
        bool supplied = !parameter.getDictItem("value").isNull();
        bool changed = saved != supplied
            || (saved && supplied && !equal(previous_param.getDictItem("value"), parameter.getDictItem("value")));
        if (changed)
            for (auto index : parameter_records.at(id))
                invalidated.insert(records.at(index).page);
        auto binding = parameter.getDictItem("binding");
        auto prop = text(binding.getDictItem("property"));
        for (const auto& target : array(binding.getDictItem("targets"))) {
            auto tid = target_ids.at(text(target));
            if (changed)
                changed_targets.insert(tid);
            if (supplied)
                choices[tid][prop] = parameter.getDictItem("value");
        }
    }
    for (const auto& record : records) {
        if (!changed_targets.contains(record.target_idx))
            continue;
        if (active_pages && !active_pages->contains(record.page))
            continue;
        changed_pages.insert(record.page);
        auto& paths = changed_paths[record.region_idx];
        for (std::size_t n = 1; n <= record.path.size(); ++n)
            paths.emplace(record.path.begin(), record.path.begin() + static_cast<std::ptrdiff_t>(n));
    }
    // Editing visits only changed occurrences; the caller validates the complete serialized result.
    traverse(true, active_pages);
    if (std::any_of(region_locator_changed.begin(), region_locator_changed.end(),
            [](std::uint8_t changed) { return changed != 0; })) {
        auto updated_regions = copy_object(next.getDictItem("regions"));
        for (std::size_t rid = 0; rid < region_names.size(); ++rid) {
            if (!region_locator_changed[rid])
                continue;
            const auto& id = region_names[rid];
            auto region = copy_object(member(updated_regions, id));
            auto refs = region.getDictItem("baselineRefs");
            auto locs = JSON::makeArray();
            for (auto index : region_records[rid]) {
                auto loc = records.at(index).locator;
                if (!refs.isNull()) {
                    loc = copy_object(loc);
                    loc.addDictionaryMember("baseline", member(refs, text(loc.getDictItem("baseline"))));
                }
                locs.addArrayElement(loc);
            }
            auto replaced = dictionary(
                {{"page", region.getDictItem("page")}, {"marker", region.getDictItem("marker")}, {"records", locs}});
            updated_regions.addDictionaryMember(id, replaced);
        }
        next.addDictionaryMember("regions", updated_regions);
    }
    if (!invalidated.empty()) {
        auto annotations = JSON::makeArray();
        auto page_list = array(next.getDictItem("pages"));
        for (std::size_t index = 0; index < page_list.size(); ++index) {
            if (!invalidated.contains(index) || page_list[index].getDictItem("preview").isNull()) {
                annotations.addArrayElement(page_list[index]);
                continue;
            }
            auto page = JSON::makeDictionary();
            for (const auto& [key, val] : object(page_list[index]))
                if (key != "preview")
                    page.addDictionaryMember(key, val);
            annotations.addArrayElement(page);
        }
        next.addDictionaryMember("pages", annotations);
    }
    manifest = std::move(next);
    parameters = object(manifest.getDictItem("parameters"));
}
std::string Engine::write(JSON next)
{
    update(next);
    return save(manifest);
}
}
