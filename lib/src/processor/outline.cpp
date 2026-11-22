#include "engine.hh"
#include <algorithm>
#include <qpdf/QPDFPageDocumentHelper.hh>

namespace mainz::detail {
void compose_outlines(QPDF& output, const std::vector<OutlineInput>& sources, Budget& budget)
{
    struct Bookmark {
        Object item;
        std::size_t target;
        std::vector<std::size_t> children;
    };
    std::vector<Bookmark> bookmarks;
    std::vector<std::size_t> roots;
    const auto output_pages = QPDFPageDocumentHelper(output).getAllPages();
    const auto output_count = output_pages.size();
    struct Block {
        std::string source;
        std::size_t start, end;
    };
    std::vector<Block> blocks;
    const bool grouped = sources.size() > 1
        && std::all_of(sources.begin(), sources.end(), [](const auto& entry) { return !entry.title.empty(); });
    std::vector<std::pair<std::size_t, std::string>> order;
    for (const auto& source : sources)
        for (const auto& [position, page] : source.retained) {
            (void)page;
            order.emplace_back(position, source.id);
        }
    std::sort(order.begin(), order.end());
    for (const auto& [position, id] : order) {
        if (!grouped)
            break;
        if (blocks.empty() || blocks.back().source != id) {
            if (!blocks.empty())
                blocks.back().end = position;
            blocks.push_back({id, position, output_count});
        }
    }
    for (auto& source : sources) {
        const auto& id = source.id;
        struct Heading {
            Object title;
            std::size_t page, end, depth;
            std::optional<std::size_t> parent;
        };
        struct Pending {
            Object item;
            std::size_t depth, level;
            std::optional<std::size_t> parent;
        };
        std::map<QPDFObjGen, std::size_t> page_indexes;
        for (std::size_t index = 0; index < source.pages.size(); ++index)
            page_indexes.emplace(source.pages[index].getObjectHandle().getObjGen(), index);
        std::vector<Heading> headings;
        std::vector<Pending> pending {{source.document.getRoot().getKey("/Outlines").getKey("/First"), 0, 0, {}}};
        std::set<QPDFObjGen> seen;
        while (!pending.empty()) {
            auto current = pending.back();
            pending.pop_back();
            auto item = current.item;
            if (!item.isDictionary() || (item.isIndirect() && !seen.insert(item.getObjGen()).second))
                continue;
            require(++budget.visits <= 65536 && current.level + (grouped ? 1 : 0) < 64,
                "Outline traversal exceeds limits.", "limit-exceeded");
            pending.push_back({item.getKey("/Next"), current.depth, current.level, current.parent});
            auto title = item.getKey("/Title");
            auto dest = item.getKey("/Dest");
            if (dest.isNull() && item.getKey("/A").getKey("/S").isNameAndEquals("/GoTo"))
                dest = item.getKey("/A").getKey("/D");
            std::optional<std::size_t> page;
            if (dest.isArray() && dest.getArrayNItems() > 0) {
                auto target = dest.getArrayItem(0);
                if (target.isInteger() && target.getIntValue() >= 0
                    && static_cast<unsigned long long>(target.getIntValue()) < source.pages.size())
                    page = static_cast<std::size_t>(target.getIntValue());
                else if (target.isIndirect() && page_indexes.contains(target.getObjGen()))
                    page = page_indexes.at(target.getObjGen());
            }
            auto parent = current.parent;
            auto depth = current.depth;
            if (page && title.isString()) {
                auto text = title.getUTF8Value();
                if (text.size() <= 4096 && text.find_first_not_of(" \t\r\n") != std::string::npos) {
                    parent = headings.size();
                    headings.push_back({title, *page, source.pages.size() - 1, depth, current.parent});
                    ++depth;
                }
            }
            pending.push_back({item.getKey("/First"), depth, current.level + 1, parent});
        }
        std::vector<std::size_t> open;
        for (std::size_t index = 0; index < headings.size(); ++index) {
            while (!open.empty() && headings[open.back()].depth >= headings[index].depth) {
                auto& previous = headings[open.back()];
                previous.end = headings[index].page > previous.page ? headings[index].page - 1 : previous.page;
                open.pop_back();
            }
            open.push_back(index);
        }
        // Index section intervals once; each retained page visits only its matching sections.
        const auto count = source.pages.size();
        if (!headings.empty())
            budget.consume(2 * count * sizeof(std::vector<std::size_t>));
        std::vector<std::vector<std::size_t>> sections(headings.empty() ? 0 : 2 * count);
        for (std::size_t index = 0; index < headings.size(); ++index) {
            const auto& heading = headings[index];
            for (auto left = count + heading.page, right = count + heading.end + 1; left < right;
                left /= 2, right /= 2) {
                if (left % 2) {
                    budget.consume(sizeof(std::size_t));
                    sections[left++].push_back(index);
                }
                if (right % 2) {
                    budget.consume(sizeof(std::size_t));
                    sections[--right].push_back(index);
                }
            }
        }
        std::vector<Block> spans;
        if (grouped) {
            for (const auto& block : blocks)
                if (block.source == id)
                    spans.push_back(block);
        } else
            spans.push_back({id, 0, output_count});
        for (const auto& block : spans) {
            std::optional<std::size_t> group;
            if (grouped) {
                require(++budget.visits <= 65536, "Outline traversal exceeds limits.", "limit-exceeded");
                auto item = output.makeIndirectObject(
                    Object::newDictionary({{"/Title", Object::newUnicodeString(source.title)},
                        {"/Dest",
                            Object::newArray(
                                {output_pages.at(block.start).getObjectHandle(), Object::newName("/Fit")})}}));
                group = bookmarks.size();
                roots.push_back(*group);
                bookmarks.push_back({item, block.start, {}});
            }
            if (headings.empty())
                continue;
            std::map<std::size_t, std::size_t> touched;
            std::vector<bool> visited(count, false);
            const auto begin = std::lower_bound(
                source.retained.begin(), source.retained.end(), std::pair {block.start, std::size_t {0}});
            for (auto occurrence = begin; occurrence != source.retained.end() && occurrence->first < block.end;
                ++occurrence) {
                const auto [position, page] = *occurrence;
                if (visited[page])
                    continue;
                visited[page] = true;
                for (auto node = count + page; node; node /= 2)
                    for (auto index : sections[node]) {
                        std::optional<std::size_t> ancestor = index;
                        while (ancestor && !touched.contains(*ancestor)) {
                            require(++budget.visits <= 65536, "Outline traversal exceeds limits.", "limit-exceeded");
                            touched.emplace(*ancestor, position);
                            ancestor = headings[*ancestor].parent;
                        }
                    }
            }
            std::map<std::size_t, std::size_t> retained;
            for (const auto& [index, target] : touched) {
                const auto& heading = headings[index];
                auto item = output.makeIndirectObject(
                    Object::newDictionary({{"/Title", Object::newUnicodeString(heading.title.getUTF8Value())},
                        {"/Dest",
                            Object::newArray({output_pages.at(target).getObjectHandle(), Object::newName("/Fit")})}}));
                auto parent = heading.parent;
                auto& siblings = parent ? bookmarks[retained.at(*parent)].children
                    : group             ? bookmarks[*group].children
                                        : roots;
                siblings.push_back(bookmarks.size());
                retained[index] = bookmarks.size();
                bookmarks.push_back({item, target, {}});
            }
        }
    }
    if (!roots.empty()) {
        auto root = output.makeIndirectObject(Object::newDictionary({{"/Type", Object::newName("/Outlines")}}));
        auto connect = [&](auto&& self, std::vector<std::size_t>& siblings, Object parent) -> std::size_t {
            std::stable_sort(siblings.begin(), siblings.end(),
                [&](auto left, auto right) { return bookmarks[left].target < bookmarks[right].target; });
            std::size_t count = siblings.size();
            for (std::size_t index = 0; index < siblings.size(); ++index) {
                auto& bookmark = bookmarks[siblings[index]];
                auto item = bookmark.item;
                item.replaceKey("/Parent", parent);
                if (index)
                    item.replaceKey("/Prev", bookmarks[siblings[index - 1]].item);
                if (index + 1 < siblings.size())
                    item.replaceKey("/Next", bookmarks[siblings[index + 1]].item);
                auto children = self(self, bookmark.children, item);
                if (children)
                    item.replaceKey("/Count", Object::newInteger(static_cast<long long>(children)));
                count += children;
            }
            if (!siblings.empty()) {
                parent.replaceKey("/First", bookmarks[siblings.front()].item);
                parent.replaceKey("/Last", bookmarks[siblings.back()].item);
            }
            return count;
        };
        root.replaceKey("/Count", Object::newInteger(static_cast<long long>(connect(connect, roots, root))));
        output.getRoot().replaceKey("/Outlines", root);
    }
}
}
