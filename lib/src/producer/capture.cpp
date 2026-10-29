#include "content.hh"
#include "internal.hh"
#include "pipeline.hh"
#include <algorithm>
#include <cmath>
#include <exception>
#include <limits>
#include <qpdf/Pipeline.hh>
#include <qpdf/QPDFObjGen.hh>
#include <tuple>

namespace mainz::producer {
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
        require(ok, "Cannot decode rendered content.", "producer-error");
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
        bool normal {true}, mask {false}, overprint {false}, groups {true};
        std::vector<Box> clips;
    };
    bool fills(std::string_view paint) { return paint != "S" && paint != "s"; }
    bool strokes(std::string_view paint) { return paint != "f" && paint != "f*"; }
    struct Paint {
        std::size_t start, end;
        std::string op, path, key;
        JSON baseline;
        bool closed;
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
        require(std::isfinite(box[0]), "Empty editable path.", "producer-error");
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
        double maximum = INFINITY;
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
            "producer-error");
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
                        "Maximum stroke width exceeds an export bound.", "producer-error");
                }
        }
    }
    Object resources_copy(Object resources)
    {
        require(resources.isDictionary(), "Located Forms require explicit resources.", "producer-error");
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
            require(active.insert(form.getObjGen()).second, "Cyclic Form invocation.", "producer-error");
            auto dict = form.getDict();
            auto matrix = dict.getKey("/Matrix");
            if (!matrix.isNull())
                state.matrix = multiply(state.matrix, numbers<6>(matrix));
            bounds.push_back({numbers<4>(dict.getKey("/BBox")), state.matrix});
            auto group = dict.getKey("/Group");
            if (!group.isNull())
                state.groups = state.groups && group.isDictionary()
                    && group.getKey("/S").isNameAndEquals("/Transparency") && group.getKey("/I").isBool()
                    && group.getKey("/I").getBoolValue()
                    && (!group.getKey("/K").isBool() || !group.getKey("/K").getBoolValue());
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
                require(op.op != "inline-image", "Inline images in editable source are unsupported.", "producer-error");
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
                    require(start.has_value() && !clipping && state.normal && !state.mask && !state.overprint
                            && state.groups,
                        "Unsupported editable painting context.", "unsupported-context");
                    for (auto j = *start; j < i; ++j)
                        require(
                            path_op(ops[j].op), "Non-path instruction interrupts editable geometry.", "producer-error");
                    if (strokes(op.op) && width_schema)
                        prove_width(ops, *start, i, state, bounds, *width_schema);
                    auto baseline = dictionary({{"paint", JSON::makeString(std::string(op.op))},
                        {"width", JSON::makeString(state.width)},
                        {"stroke",
                            dictionary({{"operator", JSON::makeString(state.stroke_op)},
                                {"operands", strings(state.stroke)}})},
                        {"fill",
                            dictionary(
                                {{"operator", JSON::makeString(state.fill_op)}, {"operands", strings(state.fill)}})},
                        {"strokeOpacity", JSON::makeString(decimal(state.stroke_alpha))},
                        {"fillOpacity", JSON::makeString(fills(op.op) ? decimal(state.fill_alpha) : "0")},
                        {"display", JSON::makeString(display)},
                        {"fillRule", JSON::makeString(op.op.ends_with('*') ? "evenodd" : "nonzero")}});
                    auto first = ops[*start].begin;
                    paints.push_back({first, op.end, std::string(op.op), content.bytes->substr(first, op.begin - first),
                        geometry(ops, *start, i, state.matrix), baseline, closed(ops, *start, i, op.op)});
                    start.reset();
                    clipping = false;
                } else if (op.op == "W" || op.op == "W*") {
                    count(op, 0);
                    require(start.has_value(), "Clip has no path.", "pdf-syntax");
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
                    auto alpha = resources.getKey("/ExtGState").getKey(name(op, 0));
                    require(alpha.isDictionary(), "Missing graphics state.", "pdf-syntax");
                    if (alpha.hasKey("/CA"))
                        state.stroke_alpha = number(alpha.getKey("/CA"));
                    if (alpha.hasKey("/ca"))
                        state.fill_alpha = number(alpha.getKey("/ca"));
                    if (alpha.hasKey("/LW"))
                        state.width = decimal(number(alpha.getKey("/LW")));
                    if (alpha.hasKey("/ML"))
                        state.miter = number(alpha.getKey("/ML"));
                    if (alpha.hasKey("/BM"))
                        state.normal = alpha.getKey("/BM").isNameAndEquals("/Normal");
                    if (alpha.hasKey("/SMask"))
                        state.mask = !alpha.getKey("/SMask").isNameAndEquals("/None");
                    for (const auto* key : {"/OP", "/op"})
                        if (alpha.hasKey(key)) {
                            require(alpha.getKey(key).isBool(), "Invalid overprint state.", "pdf-syntax");
                            state.overprint = state.overprint || alpha.getKey(key).getBoolValue();
                        }
                } else if (op.op == "Do") {
                    count(op, 1);
                    require(!start && !clipping, "Form interrupts a path.", "producer-error");
                    auto objects = resources.getKey("/XObject");
                    auto child = objects.getKey(name(op, 0));
                    require(child.isStream(), "Missing XObject.", "pdf-syntax");
                    require(child.getDict().getKey("/Subtype").isNameAndEquals("/Form"),
                        "Images in editable source are unsupported.", "unsupported-context");
                    require(!active.contains(child.getObjGen()), "Cyclic Form invocation.", "producer-error");
                    auto isolated = child.copyStream();
                    replaced_forms.insert(name(op, 0));
                    auto resource = "/MainzForm" + std::to_string(edits.size());
                    require(!objects.hasKey(resource), "Generated Form resource conflicts.", "producer-error");
                    objects.replaceKey(resource, isolated);
                    auto child_path = JSON::makeArray();
                    for (const auto& step : array(path))
                        child_path.addArrayElement(step);
                    child_path.addArrayElement(dictionary(
                        {{"resource", JSON::makeString(resource.substr(1))}, {"occurrence", JSON::makeInt(0)}}));
                    this->form(isolated, state, child_path, bounds, active);
                    edits.push_back({op.begin, op.end, "\n" + resource + " Do\n"});
                } else {
                    require(op.op != "BT", "Text in editable source is unsupported.", "unsupported-context");
                    require(op.op != "K" && op.op != "k" && op.op != "CS" && op.op != "cs" && op.op != "SC"
                            && op.op != "sc" && op.op != "SCN" && op.op != "scn",
                        "Unsupported editable color space.", "unsupported-context");
                }
            }
            require(stack.empty() && !start && !clipping, "Incomplete rendered graphics object.", "pdf-syntax");
            for (const auto& key : replaced_forms)
                resources.getKey("/XObject").removeKey(key);
            std::set<std::string> filled;
            for (const auto& paint : paints)
                if (fills(paint.op))
                    filled.insert(paint.key);
            std::map<std::pair<std::string, std::string>, std::string> alphas;
            for (std::size_t i = 0; i < paints.size(); ++i) {
                const auto& paint = paints[i];
                auto fill = fills(paint.op)                                 ? "existing"
                    : latent && paint.closed && !filled.contains(paint.key) ? "latent"
                                                                            : "none";
                auto marker = "P" + std::to_string(i);
                auto properties = resources.getKey("/Properties");
                require(!properties.hasKey("/" + marker), "Paint resource conflicts.", "producer-error");
                properties.replaceKey("/" + marker, Object::newDictionary());
                auto baselines = manifest.getDictItem("baselines");
                auto key = paint.baseline.unparse();
                auto found = budget.baselines.find(key);
                auto baseline_id
                    = found != budget.baselines.end() ? found->second : "B" + std::to_string(budget.baselines.size());
                if (found == budget.baselines.end()) {
                    metadata(encode(paint.baseline, json_limit).size() + baseline_id.size() + 4);
                    budget.baselines.emplace(std::move(key), baseline_id);
                    baselines.addDictionaryMember(baseline_id, paint.baseline);
                }
                auto records = manifest.getDictItem("regions").getDictItem(region).getDictItem("records");
                require(++budget.records <= 500000, "Paint records exceed 500000.", "limit-exceeded");
                auto record = dictionary({{"path", path}, {"marker", JSON::makeString(marker)},
                    {"baseline", JSON::makeString(baseline_id)}, {"fill", JSON::makeString(fill)}});
                metadata(encode(record, json_limit).size() + 1);
                records.addArrayElement(record);
                auto b = paint.baseline;
                auto hidden = display == "none";
                auto ca = hidden ? "0" : text(b.getDictItem("strokeOpacity"));
                auto fa = hidden ? "0" : text(b.getDictItem("fillOpacity"));
                auto pair = std::make_pair(ca, fa);
                auto alpha = alphas.find(pair);
                auto alpha_name = alpha != alphas.end() ? alpha->second : "/MainzAlpha" + std::to_string(alphas.size());
                if (alpha == alphas.end()) {
                    auto states = resources.getKey("/ExtGState");
                    require(!states.hasKey(alpha_name), "Alpha resource conflicts.", "producer-error");
                    auto value = Object::newDictionary();
                    value.replaceKey("/Type", Object::newName("/ExtGState"));
                    value.replaceKey("/CA", Object::newReal(ca));
                    value.replaceKey("/ca", Object::newReal(fa));
                    states.replaceKey(alpha_name, document.makeIndirectObject(value));
                    alphas.emplace(pair, alpha_name);
                }
                std::string prefix = "\n/Figure /" + marker + " BDC\nq " + text(b.getDictItem("width")) + " w ";
                for (const auto* color : {"stroke", "fill"}) {
                    auto item = b.getDictItem(color);
                    for (const auto& n : array(item.getDictItem("operands")))
                        prefix += text(n) + " ";
                    prefix += text(item.getDictItem("operator")) + " ";
                }
                prefix += alpha_name + " gs\n";
                edits.push_back({paint.start, paint.end, prefix + paint.path + "\n" + paint.op + "\nQ EMC\n"});
            }
            const auto& source = *content.bytes;
            std::string bytes;
            std::size_t offset = 0;
            std::sort(edits.begin(), edits.end(), [](const Edit& a, const Edit& b) { return a.first < b.first; });
            auto append = [&](std::string_view part) {
                require(
                    part.size() <= pdf_limit - bytes.size(), "Annotated stream exceeds its limit.", "limit-exceeded");
                bytes.append(part);
            };
            for (const auto& edit : edits) {
                require(edit.first >= offset && edit.last >= edit.first && edit.last <= source.size(),
                    "Overlapping capture edits.", "producer-error");
                append(std::string_view(source).substr(offset, edit.first - offset));
                append(edit.bytes);
                offset = edit.last;
            }
            append(std::string_view(source).substr(offset));
            form.replaceStreamData(bytes, Object::newNull(), Object::newNull());
        }

    private:
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
