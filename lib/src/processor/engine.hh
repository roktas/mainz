#ifndef MAINZ_PROCESSOR_ENGINE_HH
#define MAINZ_PROCESSOR_ENGINE_HH

#include "content.hh"
#include <array>
#include <compare>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <deque>
#include <functional>
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
#include <unordered_set>
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
struct OutlineInput {
    std::string id, title;
    QPDF& document;
    const std::vector<QPDFPageObjectHelper>& pages;
    std::vector<std::pair<std::size_t, std::size_t>> retained;
};
void compose_outlines(QPDF&, const std::vector<OutlineInput>&, Budget&);
struct ObjGenHash {
    std::size_t operator()(const QPDFObjGen& gen) const noexcept
    {
        return (static_cast<std::size_t>(static_cast<unsigned int>(gen.getObj())) << 16U)
            ^ static_cast<std::size_t>(static_cast<unsigned int>(gen.getGen()));
    }
};
struct PathKey {
    Matrix matrix;
    std::string_view path;
    bool operator==(const PathKey& other) const noexcept { return matrix == other.matrix && path == other.path; }
};
struct PathKeyHash {
    std::size_t operator()(const PathKey& key) const noexcept
    {
        std::size_t hash = std::hash<std::string_view> {}(key.path);
        for (double value : key.matrix) {
            std::uint64_t bits = 0;
            std::memcpy(&bits, &value, sizeof(bits));
            hash ^= std::hash<std::uint64_t> {}(bits) + 0x9e3779b97f4a7c15ULL + (hash << 6U) + (hash >> 2U);
        }
        return hash;
    }
};
struct Index {
    std::unordered_map<std::string_view, std::shared_ptr<const Content>> contents;
    std::size_t bytes {0};
};
struct Previews {
    std::vector<std::string> pages;
    std::map<std::string, std::shared_ptr<const std::string>> images;
    std::size_t bytes {0};
};
struct State {
    Matrix matrix {identity};
    bool normal {true}, mask {false}, stroke_overprint {false}, fill_overprint {false}, groups {true};
    bool alpha_shape {false}, optional_content {false};
    bool colors_supported {true};
    bool supported() const
    {
        return normal && !mask && !stroke_overprint && !fill_overprint && !alpha_shape && !optional_content && groups;
    }
};
struct Step {
    std::string resource;
    std::size_t occurrence {};
    auto operator<=>(const Step&) const = default;
};
struct FormVisitKey {
    int obj {0};
    int gen {0};
    Matrix matrix {};
    double unit {1};
    std::size_t shape {0};
    std::vector<Step> path;
    std::uint8_t flags {0};
    bool track_latent {false};
    auto operator<=>(const FormVisitKey&) const = default;
};
struct OwnedPathKey {
    Matrix matrix {};
    std::string path;
};
struct ValidatedForm {
    std::size_t consumed_bytes {0};
    std::size_t visits {0};
    std::vector<std::pair<std::size_t, double>> matched;
    std::vector<OwnedPathKey> fills;
    std::vector<OwnedPathKey> latents;
    std::optional<Object> copy;
};
enum class FillKind : std::uint8_t { none, latent, existing };
struct Record {
    std::size_t region_idx {0};
    std::size_t page {0};
    std::size_t target_idx {0};
    std::string marker;
    FillKind fill {FillKind::none};
    std::size_t baseline_key {0};
    bool strokes {true};
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
    double width_num {0}, stroke_alpha_num {0}, fill_alpha_num {0};
    std::array<double, 3> stroke_nums {}, fill_nums {};
};
bool qpdf_limit_message(std::string_view);
bool empty_dictionary(Object);
std::string decode(Object, Budget&, std::size_t limit = stream_limit);
void compress(Object, const std::string&, Budget&);
JSON copy_object(JSON);
JSON mapped_profiles(JSON, const std::map<std::string, std::string>&, const std::string& prefix = {});
class RecordSetCatalog {
public:
    struct CanonicalSet {
        std::string set_id;
        std::vector<std::string> slot_order;
        std::vector<std::size_t> slot_counts;
        std::size_t record_count {0};
        std::size_t static_bytes {0};
    };
    struct CanonicalRegion {
        std::string set_id;
        JSON baseline_refs;
        std::size_t record_count {0};
        std::size_t fixed_locator_bytes {0};
    };
    CanonicalRegion canonicalize(JSON manifest, JSON old_sets,
        std::unordered_map<std::string, CanonicalSet>& existing_sets, JSON region, Budget& budget,
        const std::map<std::string, std::string>* baseline_ids = nullptr, std::string_view target_id = {},
        bool track_locator_bytes = false);
    JSON take_sets() { return std::move(sets); }

private:
    std::string register_set(JSON records, std::string encoded);
    JSON sets = JSON::makeDictionary();
    std::unordered_map<std::string, std::string> known;
    std::size_t template_bytes {0};
};
JSON share_records(JSON, Budget&);
void prune_previews(QPDF&, const std::set<std::string>& managed, JSON pages);
std::size_t content_cache_bytes(const Content&);
class Engine {
public:
    explicit Engine(const std::string& input, Budget* shared_budget = nullptr, bool validated = false,
        std::shared_ptr<const Index> previous = {});
    std::string describe();
    std::string preview(std::size_t page);
    bool prepared() const { return !parameters.empty(); }
    void update(JSON next, const std::set<std::size_t>* active_pages = nullptr);
    std::string write(JSON next);
    std::optional<std::string> extract(JSON request);
    static Artifact compose(JSON plan, const Bindings& inputs, const Document* previous);
    std::shared_ptr<const Index> take_index() { return std::make_shared<Index>(std::move(index)); }
    std::shared_ptr<const Previews> take_previews() { return std::make_shared<Previews>(std::move(previews)); }
    JSON manifest = JSON::makeDictionary();

private:
    struct Composer;
    struct FormTraversal;
    friend struct Composer;
    friend struct FormTraversal;
    QPDF document;
    Budget owned_budget;
    Budget& budget;
    Object payload;
    std::map<std::string, Object> files;
    std::set<std::string> managed_previews;
    std::map<std::string, JSON> images;
    Previews previews;
    std::vector<QPDFPageObjectHelper> pages;
    std::vector<std::string> region_names;
    std::vector<std::size_t> region_target;
    std::vector<std::size_t> region_page;
    std::vector<std::size_t> region_shape;
    std::unordered_map<std::string, std::size_t> target_ids;
    std::vector<Record> records;
    std::vector<std::map<std::vector<Step>, std::unordered_map<std::string_view, std::size_t>>> shape_locators;
    std::vector<std::size_t> regions_found;
    std::vector<std::vector<std::size_t>> record_order;
    std::vector<std::vector<std::size_t>> region_records;
    std::vector<std::uint8_t> region_locator_changed;
    std::map<FormVisitKey, ValidatedForm> validated_forms;
    std::map<FormVisitKey, ValidatedForm> edited_forms;
    ValidatedForm* recording_form {nullptr};
    std::size_t recording_path_bytes {0};
    std::map<std::pair<std::size_t, std::string>, std::size_t> page_markers;
    std::map<std::string, JSON> parameters;
    std::vector<std::map<std::string, JSON>> choices, original_choices;
    std::vector<bool> target_width_bound;
    std::set<QPDFObjGen> ancestors;
    std::unordered_set<PathKey, PathKeyHash> fills, latent_paths;
    std::vector<std::shared_ptr<const Content>> page_contents;
    std::deque<std::string> page_path_storage;
    std::unordered_set<std::size_t> latent_pages, changed_pages, changed_targets;
    std::vector<std::set<std::vector<Step>>> changed_paths;
    std::map<std::string, std::vector<std::size_t>> parameter_records;
    std::map<std::tuple<std::size_t, std::size_t, FillKind, double, double, bool>, Style> styles;
    std::map<std::string, JSON> summaries;
    std::shared_ptr<const Index> previous;
    Index index;
    std::unordered_map<QPDFObjGen, std::shared_ptr<const Content>, ObjGenHash> decoded_streams;
    std::unordered_map<QPDFObjGen, std::unordered_set<std::string>, ObjGenHash> verified_markers;
    std::unordered_map<QPDFObjGen, std::unordered_map<std::string, std::pair<double, double>>, ObjGenHash>
        resource_alphas;
    std::map<std::pair<std::string, std::string>, Object> forms;
    std::size_t form_bytes {0};
    std::vector<Object> load_document(const std::string& input, bool validated);
    void load_manifest(Object spec, bool validated);
    void index_manifest(bool validated);
    std::shared_ptr<const Content> parsed(const std::string&);
    std::shared_ptr<const Content> stream_content(Object);
    Object styled_form(Object, const std::string&, Object);
    void attachments(Object, std::set<QPDFObjGen>&, std::set<std::string>&, std::vector<Object>&, std::size_t);
    void load_previews(bool validate);
    JSON image(const std::string& file);
    void verify_marker(Object resources, const std::string& key, bool editing);
    void traverse(bool editing, const std::set<std::size_t>* active_pages = nullptr);
    std::optional<std::string> owner(const std::shared_ptr<const Content>&, Object, State, std::size_t page,
        std::optional<std::size_t> region, const std::vector<Step>& path, double unit, bool editing, std::size_t depth,
        bool* locator_changed = nullptr);
    const Style& paint_style(const Record&, bool editing);
    void record_path_key(std::string_view path_key, const Matrix&, bool latent);
    void record_path(const std::vector<Operation>&, std::size_t start, std::size_t end, const Matrix&, bool latent);
    std::string inspect(Record&, const Content&, std::size_t begin, std::size_t end, Object, const State&,
        std::map<std::string, std::pair<double, double>>&, std::map<std::string, std::string>&, std::size_t&,
        std::vector<Replacement>&, bool);
    std::optional<JSON> baseline(const Record&, const std::string&);
    JSON summary(const std::string&, JSON);
    JSON retained(const std::map<std::size_t, std::size_t>& indexes);
    std::string save(std::optional<JSON> next);
};
}
#endif
