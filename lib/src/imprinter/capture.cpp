#include "content.hh"
#include "internal.hh"
#include "pipeline.hh"
#include <algorithm>
#include <cmath>
#include <exception>
#include <limits>
#include <qpdf/Pipeline.hh>
#include <qpdf/QPDFObjGen.hh>

namespace mainz::imprinter {
namespace {
    using namespace detail;
    using Object = QPDFObjectHandle;
    using Box = std::array<double, 4>;
    struct Bound {
        Box box;
        Matrix matrix;
    };
    std::string decode(Object form, std::size_t& remaining)
    {
        Buffer output(std::size_t {32} * 1024 * 1024, remaining);
        bool filtered = false;
        auto ok = form.pipeStreamData(&output, &filtered, 0, qpdf_dl_generalized, true);
        if (output.failure)
            std::rethrow_exception(output.failure);
        require(ok, "Cannot decode rendered content.", "imprinter-error");
        return std::move(output.bytes);
    }
    double number(Object item)
    {
        require(item.isNumber(), "Expected a PDF number.", "pdf-syntax");
        return pdf_number(item.unparse());
    }
    template <std::size_t N> std::array<double, N> numbers(Object item)
    {
        require(item.isArray() && item.getArrayNItems() == N, "Invalid PDF array.", "pdf-syntax");
        std::array<double, N> result {};
        for (std::size_t i = 0; i < N; ++i)
            result[i] = number(item.getArrayItem(static_cast<int>(i)));
        return result;
    }
    JSON strings(const std::vector<std::string>& values)
    {
        auto result = JSON::makeArray();
        for (const auto& value : values)
            result.addArrayElement(JSON::makeString(value));
        return result;
    }
    struct State {
        Matrix matrix {identity};
        std::string width {"1"}, stroke_op {"G"}, fill_op {"g"};
        std::vector<std::string> stroke {"0"}, fill {"0"};
        double stroke_alpha {1}, fill_alpha {1}, miter {10};
        bool normal {true}, mask {false}, stroke_overprint {false}, fill_overprint {false}, alpha_shape {false},
            groups {true};
        std::vector<Box> clips;
    };
    bool fills(std::string_view paint) { return paint != "S" && paint != "s"; }
    bool strokes(std::string_view paint) { return paint != "f" && paint != "f*"; }
    struct Paint {
        std::size_t start, end;
        std::string op, key;
        std::string_view path;
        std::string width, stroke_op, fill_op, stroke_alpha, fill_alpha;
        std::vector<std::string> stroke, fill;
        JSON baseline;
        bool closed {false};
    };
    struct Edit {
        std::size_t first, last;
        std::string bytes;
    };
    Box extent(const std::vector<Operation>& ops, std::size_t start, std::size_t end, const Matrix& matrix)
    {
        constexpr auto infinity = std::numeric_limits<double>::infinity();
        Box box {infinity, infinity, -infinity, -infinity};
        auto point = [&](double x, double y) {
            auto tx = matrix[0] * x + matrix[2] * y + matrix[4];
            auto ty = matrix[1] * x + matrix[3] * y + matrix[5];
            require(std::isfinite(tx) && std::isfinite(ty), "Path extent arithmetic overflow.", "unsupported-context");
            box = {std::min(box[0], tx), std::min(box[1], ty), std::max(box[2], tx), std::max(box[3], ty)};
        };
        for (auto i = start; i < end; ++i) {
            const auto& op = ops[i];
            if (op.op == "re") {
                auto x = operand(op, 0), y = operand(op, 1), w = operand(op, 2), h = operand(op, 3);
                point(x, y);
                point(x + w, y);
                point(x + w, y + h);
                point(x, y + h);
            } else
                for (std::size_t j = 0; j < op.operands.size(); j += 2)
                    point(operand(op, j), operand(op, j + 1));
        }
        require(std::isfinite(box[0]), "Empty editable path.", "imprinter-error");
        return box;
    }
    bool closed(const std::vector<Operation>& ops, std::size_t start, std::size_t end, std::string_view paint)
    {
        std::vector<bool> subpaths;
        for (auto i = start; i < end; ++i) {
            if (empty_move(ops, i, end))
                continue;
            if (ops[i].op == "m" || ops[i].op == "re")
                subpaths.push_back(ops[i].op == "re");
            else {
                require(!subpaths.empty(), "Path has no initial point.", "pdf-syntax");
                subpaths.back() = ops[i].op == "h";
            }
        }
        if (!subpaths.empty() && (paint == "s" || paint == "b" || paint == "b*"))
            subpaths.back() = true;
        return !subpaths.empty() && std::all_of(subpaths.begin(), subpaths.end(), [](bool value) { return value; });
    }
    void prove_width(const std::vector<Operation>& ops, std::size_t start, std::size_t end, const State& state,
        const std::vector<Bound>& bounds, JSON schema)
    {
        uniform_scale(state.matrix);
        double maximum = std::numeric_limits<double>::infinity();
        for (const auto* key : {"maximum", "exclusiveMaximum"}) {
            auto limit = schema.getDictItem(key);
            if (!limit.isNull())
                maximum = std::min(maximum, detail::number(limit));
        }
        auto choices = schema.getDictItem("enum");
        if (!choices.isNull()) {
            double high = 0;
            for (const auto& choice : array(choices))
                high = std::max(high, detail::number(choice));
            maximum = std::min(maximum, high);
        }
        require(std::isfinite(maximum) && maximum > 0, "A width binding needs a finite positive maximum.",
            "imprinter-error");
        auto box = extent(ops, start, end, state.matrix);
        auto radius = maximum * (72 / 25.4) * std::max(std::sqrt(2.0), state.miter) / 2;
        require(std::isfinite(radius), "Stroke extent arithmetic overflow.", "unsupported-context");
        box = {box[0] - radius, box[1] - radius, box[2] + radius, box[3] + radius};
        for (auto n : box)
            require(std::isfinite(n), "Stroke extent arithmetic overflow.", "unsupported-context");
        for (const auto& clip : state.clips)
            box = {std::max(box[0], clip[0]), std::max(box[1], clip[1]), std::min(box[2], clip[2]),
                std::min(box[3], clip[3])};
        if (box[0] > box[2] || box[1] > box[3])
            return;
        for (const auto& bound : bounds) {
            const auto& m = bound.matrix;
            auto det = m[0] * m[3] - m[1] * m[2];
            require(std::isfinite(det) && det != 0, "Singular export bound.", "unsupported-context");
            for (auto x : {box[0], box[2]})
                for (auto y : {box[1], box[3]}) {
                    auto lx = (m[3] * (x - m[4]) - m[2] * (y - m[5])) / det;
                    auto ly = (-m[1] * (x - m[4]) + m[0] * (y - m[5])) / det;
                    require(lx >= bound.box[0] && lx <= bound.box[2] && ly >= bound.box[1] && ly <= bound.box[3],
                        "Maximum stroke width exceeds an export bound.", "imprinter-error");
                }
        }
    }
    Object resources_copy(Object resources)
    {
        require(resources.isDictionary(), "Located Forms require explicit resources.", "imprinter-error");
        auto copy = resources.unsafeShallowCopy();
        for (const auto* key : {"/XObject", "/ExtGState", "/Properties"}) {
            auto value = resources.getKey(key);
            require(value.isNull() || value.isDictionary(), "Invalid resource dictionary.", "pdf-syntax");
            copy.replaceKey(key, value.isNull() ? Object::newDictionary() : value.unsafeShallowCopy());
        }
        return copy;
    }
    class Capture {
    public:
        Capture(QPDF& document, JSON manifest, JSON definition, const std::string& target, std::string region,
            CaptureBudget& budget)
            : document(document)
            , manifest(manifest)
            , region(std::move(region))
            , budget(budget)
        {
            auto original = definition.getDictItem("display");
            display = original.isNull() ? "inline" : text(original);
            auto fill = definition.getDictItem("fill");
            require(fill.isNull() || fill.getBool(latent), "Expected a fill boolean.");
            for (const auto& [id, parameter] : object(manifest.getDictItem("parameters"))) {
                (void)id;
                auto binding = parameter.getDictItem("binding");
                if (text(binding.getDictItem("property")) == "stroke-width")
                    for (const auto& item : array(binding.getDictItem("targets")))
                        if (text(item) == target)
                            width_schema = parameter.getDictItem("schema");
            }
        }
        void form(Object form, State state, JSON path, std::vector<Bound> bounds, std::set<QPDFObjGen> active)
        {
            require(array(path).size() <= 16 && ++budget.visits <= 65536, "Form traversal exceeds its limit.",
                "limit-exceeded");
            require(active.insert(form.getObjGen()).second, "Cyclic Form invocation.", "imprinter-error");
            auto dict = form.getDict();
            auto matrix = dict.getKey("/Matrix");
            if (!matrix.isNull())
                state.matrix = multiply(state.matrix, numbers<6>(matrix));
            bounds.push_back({numbers<4>(dict.getKey("/BBox")), state.matrix});
            auto group = dict.getKey("/Group");
            if (!group.isNull()) {
                auto isolated = group.isDictionary() ? group.getKey("/I") : Object::newNull();
                auto knockout = group.isDictionary() ? group.getKey("/K") : Object::newNull();
                auto space = group.isDictionary() ? group.getKey("/CS") : Object::newNull();
                state.groups = state.groups && group.isDictionary()
                    && group.getKey("/S").isNameAndEquals("/Transparency") && isolated.isBool()
                    && isolated.getBoolValue() && (knockout.isNull() || (knockout.isBool() && !knockout.getBoolValue()))
                    && (space.isNameAndEquals("/DeviceGray") || space.isNameAndEquals("/DeviceRGB"));
            }
            auto resources = resources_copy(dict.getKey("/Resources"));
            dict.replaceKey("/Resources", resources);
            auto colors = resources.getKey("/ColorSpace");
            require(colors.isNull()
                    || (colors.isDictionary() && !colors.hasKey("/DefaultGray") && !colors.hasKey("/DefaultRGB")),
                "Default color replacement is unsupported.", "unsupported-context");
            auto content = tokenize(decode(form, budget.remaining));
            const auto& ops = content.operations;
            std::vector<State> stack;
            std::vector<Paint> paints;
            std::vector<Edit> edits;
            std::set<std::string> replaced_forms;
            std::optional<std::size_t> start;
            bool clipping = false;
            for (std::size_t i = 0; i < ops.size(); ++i) {
                const auto& op = ops[i];
                require(
                    op.op != "inline-image", "Inline images in editable source are unsupported.", "imprinter-error");
                if (path_op(op.op)) {
                    if (!start)
                        start = i;
                    count(op,
                        op.op == "h"                                        ? 0
                            : op.op == "c"                                  ? 6
                            : op.op == "re" || op.op == "v" || op.op == "y" ? 4
                                                                            : 2);
                } else if (paint_op(op.op)) {
                    count(op, 0);
                    require(start.has_value() && !clipping && state.normal && !state.mask && !state.stroke_overprint
                            && !state.fill_overprint && !state.alpha_shape && state.groups,
                        "Unsupported editable painting context.", "unsupported-context");
                    for (auto j = *start; j < i; ++j)
                        require(path_op(ops[j].op), "Non-path instruction interrupts editable geometry.",
                            "imprinter-error");
                    if (strokes(op.op) && width_schema)
                        prove_width(ops, *start, i, state, bounds, *width_schema);
                    auto stroke_alpha = decimal(state.stroke_alpha);
                    auto fill_alpha = fills(op.op) ? decimal(state.fill_alpha) : std::string("0");
                    auto baseline = dictionary({{"paint", JSON::makeString(std::string(op.op))},
                        {"width", JSON::makeString(state.width)},
                        {"stroke",
                            dictionary({{"operator", JSON::makeString(state.stroke_op)},
                                {"operands", strings(state.stroke)}})},
                        {"fill",
                            dictionary(
                                {{"operator", JSON::makeString(state.fill_op)}, {"operands", strings(state.fill)}})},
                        {"strokeOpacity", JSON::makeString(stroke_alpha)},
                        {"fillOpacity", JSON::makeString(fill_alpha)}, {"display", JSON::makeString(display)},
                        {"fillRule", JSON::makeString(op.op.ends_with('*') ? "evenodd" : "nonzero")}});
                    auto first = ops[*start].begin;
                    paints.push_back({first, op.end, std::string(op.op),
                        latent ? geometry(ops, *start, i, state.matrix) : std::string {},
                        std::string_view(*content.bytes).substr(first, op.begin - first), state.width, state.stroke_op,
                        state.fill_op, std::move(stroke_alpha), std::move(fill_alpha), state.stroke, state.fill,
                        baseline, latent && closed(ops, *start, i, op.op)});
                    start.reset();
                    clipping = false;
                } else if (op.op == "W" || op.op == "W*") {
                    count(op, 0);
                    require(start.has_value(), "Clip has no path.", "pdf-syntax");
                    for (auto j = *start; j < i; ++j)
                        require(
                            path_op(ops[j].op), "Non-path instruction interrupts clip geometry.", "imprinter-error");
                    state.clips.push_back(extent(ops, *start, i, state.matrix));
                    clipping = true;
                } else if (op.op == "n") {
                    count(op, 0);
                    start.reset();
                    clipping = false;
                } else if (op.op == "q") {
                    count(op, 0);
                    require(stack.size() < 64, "Graphics state exceeds depth 64.", "limit-exceeded");
                    stack.push_back(state);
                } else if (op.op == "Q") {
                    count(op, 0);
                    require(!stack.empty(), "Graphics-state underflow.", "pdf-syntax");
                    state = stack.back();
                    stack.pop_back();
                } else if (op.op == "cm") {
                    count(op, 6);
                    Matrix local {};
                    for (std::size_t j = 0; j < 6; ++j)
                        local[j] = operand(op, j);
                    state.matrix = multiply(state.matrix, local);
                } else if (op.op == "w" || op.op == "M") {
                    count(op, 1);
                    auto n = operand(op, 0);
                    require(n >= 0, "Negative line style.", "pdf-syntax");
                    if (op.op == "w")
                        state.width = decimal(n);
                    else
                        state.miter = n;
                } else if (op.op == "G" || op.op == "RG" || op.op == "g" || op.op == "rg") {
                    count(op, op.op.size() == 1 ? 1 : 3);
                    std::vector<std::string> values;
                    values.reserve(op.operands.size());
                    for (std::size_t j = 0; j < op.operands.size(); ++j)
                        values.push_back(decimal(operand(op, j)));
                    if (op.op == "G" || op.op == "RG") {
                        state.stroke_op = op.op;
                        state.stroke = std::move(values);
                    } else {
                        state.fill_op = op.op;
                        state.fill = std::move(values);
                    }
                } else if (op.op == "gs") {
                    count(op, 1);
                    apply_graphics_state(resources, name(op, 0), state);
                } else if (op.op == "Do") {
                    count(op, 1);
                    require(!start && !clipping, "Form interrupts a path.", "imprinter-error");
                    auto objects = resources.getKey("/XObject");
                    auto child = objects.getKey(name(op, 0));
                    require(child.isStream(), "Missing XObject.", "pdf-syntax");
                    require(child.getDict().getKey("/Subtype").isNameAndEquals("/Form"),
                        "Images in editable source are unsupported.", "unsupported-context");
                    require(!active.contains(child.getObjGen()), "Cyclic Form invocation.", "imprinter-error");
                    auto isolated = child.copyStream();
                    replaced_forms.insert(name(op, 0));
                    auto resource = "/MainzForm" + std::to_string(edits.size());
                    require(!objects.hasKey(resource), "Generated Form resource conflicts.", "imprinter-error");
                    objects.replaceKey(resource, isolated);
                    auto child_path = JSON::makeArray();
                    for (const auto& step : array(path))
                        child_path.addArrayElement(step);
                    child_path.addArrayElement(dictionary(
                        {{"resource", JSON::makeString(resource.substr(1))}, {"occurrence", JSON::makeInt(0)}}));
                    auto next_active = active;
                    next_active.insert(child.getObjGen());
                    this->form(isolated, state, child_path, bounds, std::move(next_active));
                    edits.push_back({op.begin, op.end, "\n" + resource + " Do\n"});
                } else {
                    require(op.op != "BT", "Text in editable source is unsupported.", "unsupported-context");
                    require(op.op != "sh", "Shading in editable source is unsupported.", "unsupported-context");
                    require(op.op != "K" && op.op != "k" && op.op != "CS" && op.op != "cs" && op.op != "SC"
                            && op.op != "sc" && op.op != "SCN" && op.op != "scn",
                        "Unsupported editable color space.", "unsupported-context");
                }
            }
            require(stack.empty() && !start && !clipping, "Incomplete rendered graphics object.", "pdf-syntax");
            for (const auto& key : replaced_forms)
                resources.getKey("/XObject").removeKey(key);
            emit_paints(paints, resources, path, edits);
            splice_stream(form, *content.bytes, edits);
        }

    private:
        static void apply_graphics_state(Object resources, const std::string& key_name, State& state)
        {
            auto alpha = resources.getKey("/ExtGState").getKey(key_name);
            require(alpha.isDictionary(), "Missing graphics state.", "pdf-syntax");
            if (alpha.hasKey("/CA"))
                state.stroke_alpha = number(alpha.getKey("/CA"));
            if (alpha.hasKey("/ca"))
                state.fill_alpha = number(alpha.getKey("/ca"));
            if (alpha.hasKey("/LW")) {
                auto width = number(alpha.getKey("/LW"));
                require(width >= 0, "Negative line style.", "pdf-syntax");
                state.width = decimal(width);
            }
            if (alpha.hasKey("/ML")) {
                auto miter = number(alpha.getKey("/ML"));
                require(miter >= 0, "Negative line style.", "pdf-syntax");
                state.miter = miter;
            }
            if (alpha.hasKey("/BM"))
                state.normal = alpha.getKey("/BM").isNameAndEquals("/Normal");
            if (alpha.hasKey("/SMask"))
                state.mask = !alpha.getKey("/SMask").isNameAndEquals("/None");
            if (alpha.hasKey("/OP")) {
                auto stroke = alpha.getKey("/OP");
                require(stroke.isBool(), "Invalid overprint state.", "pdf-syntax");
                state.stroke_overprint = state.fill_overprint = stroke.getBoolValue();
            }
            if (alpha.hasKey("/op")) {
                auto fill = alpha.getKey("/op");
                require(fill.isBool(), "Invalid overprint state.", "pdf-syntax");
                state.fill_overprint = fill.getBoolValue();
            }
            if (alpha.hasKey("/AIS")) {
                auto shape = alpha.getKey("/AIS");
                require(shape.isBool(), "Invalid alpha-is-shape setting.", "pdf-syntax");
                state.alpha_shape = shape.getBoolValue();
            }
        }
        void emit_paints(const std::vector<Paint>& paints, Object resources, JSON path, std::vector<Edit>& edits)
        {
            std::set<std::string> filled;
            if (latent)
                for (const auto& paint : paints)
                    if (fills(paint.op))
                        filled.insert(paint.key);
            auto properties = resources.getKey("/Properties");
            auto states = resources.getKey("/ExtGState");
            auto baselines = manifest.getDictItem("baselines");
            auto records = manifest.getDictItem("regions").getDictItem(region).getDictItem("records");
            const bool hidden = display == "none";
            std::map<std::pair<std::string, std::string>, std::string> alphas;
            for (std::size_t i = 0; i < paints.size(); ++i) {
                const auto& paint = paints[i];
                auto fill = fills(paint.op)                                 ? "existing"
                    : latent && paint.closed && !filled.contains(paint.key) ? "latent"
                                                                            : "none";
                auto marker = "P" + std::to_string(i);
                require(!properties.hasKey("/" + marker), "Paint resource conflicts.", "imprinter-error");
                properties.replaceKey("/" + marker, Object::newDictionary());
                auto encoded_baseline = encode(paint.baseline, json_limit);
                auto found = budget.baselines.find(encoded_baseline);
                auto baseline_id
                    = found != budget.baselines.end() ? found->second : "B" + std::to_string(budget.baselines.size());
                if (found == budget.baselines.end()) {
                    metadata(encoded_baseline.size() + baseline_id.size() + 4);
                    budget.baselines.emplace(std::move(encoded_baseline), baseline_id);
                    baselines.addDictionaryMember(baseline_id, paint.baseline);
                }
                require(++budget.records <= 500000, "Paint records exceed 500000.", "limit-exceeded");
                auto record = dictionary({{"path", path}, {"marker", JSON::makeString(marker)},
                    {"baseline", JSON::makeString(baseline_id)}, {"fill", JSON::makeString(fill)}});
                metadata(encode(record, json_limit).size() + 1);
                records.addArrayElement(record);
                const std::string ca = hidden ? "0" : paint.stroke_alpha;
                const std::string fa = hidden ? "0" : paint.fill_alpha;
                auto pair = std::make_pair(ca, fa);
                auto alpha = alphas.find(pair);
                auto alpha_name = alpha != alphas.end() ? alpha->second : "/MainzAlpha" + std::to_string(alphas.size());
                if (alpha == alphas.end()) {
                    require(!states.hasKey(alpha_name), "Alpha resource conflicts.", "imprinter-error");
                    auto value = Object::newDictionary();
                    value.replaceKey("/Type", Object::newName("/ExtGState"));
                    value.replaceKey("/CA", Object::newReal(ca));
                    value.replaceKey("/ca", Object::newReal(fa));
                    states.replaceKey(alpha_name, document.makeIndirectObject(value));
                    alphas.emplace(std::move(pair), alpha_name);
                }
                std::string replacement;
                replacement.reserve(paint.path.size() + 96);
                replacement += "\n/Figure /";
                replacement += marker;
                replacement += " BDC\nq ";
                replacement += paint.width;
                replacement += " w ";
                for (const auto& n : paint.stroke) {
                    replacement += n;
                    replacement += ' ';
                }
                replacement += paint.stroke_op;
                replacement += ' ';
                for (const auto& n : paint.fill) {
                    replacement += n;
                    replacement += ' ';
                }
                replacement += paint.fill_op;
                replacement += ' ';
                replacement += alpha_name;
                replacement += " gs\n";
                replacement.append(paint.path);
                replacement += '\n';
                replacement += paint.op;
                replacement += "\nQ EMC\n";
                edits.push_back({paint.start, paint.end, std::move(replacement)});
            }
        }
        static void splice_stream(Object form, const std::string& source, std::vector<Edit>& edits)
        {
            std::string bytes;
            bytes.reserve(source.size() + edits.size() * 96);
            std::size_t offset = 0;
            std::sort(edits.begin(), edits.end(), [](const Edit& a, const Edit& b) { return a.first < b.first; });
            auto append = [&](std::string_view part) {
                require(
                    part.size() <= pdf_limit - bytes.size(), "Annotated stream exceeds its limit.", "limit-exceeded");
                bytes.append(part);
            };
            for (const auto& edit : edits) {
                require(edit.first >= offset && edit.last >= edit.first && edit.last <= source.size(),
                    "Overlapping capture edits.", "imprinter-error");
                append(std::string_view(source).substr(offset, edit.first - offset));
                append(edit.bytes);
                offset = edit.last;
            }
            append(std::string_view(source).substr(offset));
            form.replaceStreamData(bytes, Object::newNull(), Object::newNull());
        }
        QPDF& document;
        JSON manifest;
        std::string region, display;
        bool latent {false};
        CaptureBudget& budget;
        void metadata(std::size_t bytes)
        {
            require(bytes <= manifest_limit - budget.metadata, "Captured manifest exceeds 16 MiB.", "limit-exceeded");
            budget.metadata += bytes;
        }
        std::optional<JSON> width_schema;
    };
}
void annotate(QPDF& document, Object form, JSON manifest, JSON definition, const std::string& target,
    const std::string& region, const std::string& resource, CaptureBudget& budget)
{
    Capture capture(document, manifest, definition, target, region, budget);
    auto path = JSON::makeArray();
    path.addArrayElement(dictionary({{"resource", JSON::makeString(resource)}, {"occurrence", JSON::makeInt(0)}}));
    capture.form(form, State {}, path, {}, {});
}
}
