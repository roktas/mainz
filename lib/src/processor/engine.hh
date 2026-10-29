#ifndef MAINZ_PROCESSOR_ENGINE_HH
#define MAINZ_PROCESSOR_ENGINE_HH

#include "content.hh"
#include <compare>
#include <cstddef>
#include <map>
#include <memory>
#include <optional>
#include <qpdf/QPDF.hh>
#include <qpdf/QPDFPageObjectHelper.hh>
#include <set>
#include <string>
#include <string_view>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <vector>

namespace mainz::detail {
using Object = QPDFObjectHandle;
inline constexpr std::size_t stream_limit = std::size_t {32} * 1024 * 1024;
struct Budget {
    std::size_t remaining {pipeline_limit}, visits {0};
    std::size_t locator_remaining {locator_limit};
    void consume(std::size_t n)
    {
        require(n <= remaining, "Pipeline bytes exceed 512 MiB.", "limit-exceeded");
        remaining -= n;
    }
};
struct Index {
    std::unordered_map<std::string_view, std::shared_ptr<const Content>> contents;
    std::size_t bytes {0};
};
struct State {
    Matrix matrix {identity};
    bool normal {true}, mask {false}, stroke_overprint {false}, fill_overprint {false}, groups {true};
    bool colors_supported {true};
    bool supported() const { return normal && !mask && !stroke_overprint && !fill_overprint && groups; }
};
struct Step {
    std::string resource;
    std::size_t occurrence {};
    auto operator<=>(const Step&) const = default;
};
struct Record {
    std::string region, page, target, marker, fill;
    std::size_t baseline_key {0};
    std::vector<Step> path;
    JSON locator, baseline;
    double scale {1}, unit {1};
    std::size_t found {0};
};
struct Replacement {
    std::size_t begin, end;
    std::string bytes;
};
struct Style {
    std::string width, stroke_op, fill_op, paint, stroke_alpha, fill_alpha;
    std::vector<std::string> stroke, fill;
};
std::string decode(Object, Budget&, std::size_t limit = stream_limit);
void compress(Object, const std::string&, Budget&);
JSON copy_object(JSON);
JSON mapped_profiles(JSON, const std::map<std::string, std::string>&, const std::string& prefix = {});
JSON share_records(JSON);
class Engine {
public:
    explicit Engine(const std::string& input, Budget* shared_budget = nullptr, bool validated = false,
        std::shared_ptr<const Index> previous = {});
    std::string describe();
    void update(JSON next);
    std::string write(JSON next);
    std::string extract(JSON request, const std::string& input);
    static Composition compose(JSON job, const std::map<std::string, std::string>& inputs, const Document* previous);
    std::shared_ptr<const Index> take_index() { return std::make_shared<Index>(std::move(index)); }
    JSON manifest = JSON::makeDictionary();

private:
    QPDF document;
    Budget owned_budget;
    Budget& budget;
    Object payload;
    std::vector<QPDFPageObjectHelper> pages;
    std::vector<Record> records;
    std::map<std::tuple<std::string, std::vector<Step>, std::string>, std::size_t> record_index;
    std::map<std::string, std::size_t> regions_found;
    std::map<std::string, std::vector<std::size_t>> record_order;
    std::map<std::string, std::vector<std::size_t>> region_records;
    std::map<std::pair<std::string, std::string>, std::string> page_markers;
    std::map<std::string, JSON> parameters;
    std::map<std::string, std::map<std::string, std::string>> bindings;
    std::map<std::string, std::map<std::string, JSON>> choices, original_choices;
    std::set<QPDFObjGen> ancestors;
    std::vector<std::pair<std::string, bool>> paths;
    std::set<std::string> latent_pages;
    std::set<std::string> changed_targets, changed_pages;
    std::map<std::string, std::set<std::vector<Step>>> changed_paths;
    std::map<std::string, std::vector<std::size_t>> parameter_records;
    std::map<std::tuple<std::string, std::size_t, std::string, double, double, bool>, Style> styles;
    std::map<std::string, JSON> summaries;
    std::shared_ptr<const Index> previous;
    Index index;
    std::map<std::pair<std::string, std::string>, Object> forms;
    std::size_t form_bytes {0};
    std::shared_ptr<const Content> parsed(const std::string&);
    Object styled_form(Object, const std::string&, Object);
    void attachments(Object, std::set<QPDFObjGen>&, std::set<std::string>&, std::vector<Object>&, std::size_t);
    void traverse(bool editing);
    std::string owner(const std::string&, Object, State, const std::string& page, std::string region,
        const std::vector<Step>& path, double unit, bool editing, std::size_t depth);
    const Style& paint_style(const Record&, bool editing);
    std::string inspect(Record&, const std::vector<Operation>&, std::size_t begin, std::size_t end, Object,
        const State&, std::map<std::string, std::pair<double, double>>&, std::vector<Replacement>&, bool);
    std::optional<JSON> baseline(const Record&, const std::string&);
    JSON summary(const std::string&, JSON);
    JSON retained(const std::map<std::size_t, std::size_t>& indexes);
    std::string save(std::optional<JSON> next);
};
}
#endif
