// Defines Source style schemas and resolves values, profiles, applicability, and preview requirements.

import type { Part } from "./model.ts";

export type Scalar = number | string;
export type Render = { overrides: Record<string, Scalar>; pages?: number[] };
export type PaintDuo = { color?: string; opacity?: string };
export type Quartet = {
  fill: PaintDuo;
  stroke: PaintDuo;
  width?: string;
  visibility: string;
};
export type Property = "display" | "stroke-width" | "stroke-color" | "fill-color" | "stroke-opacity" | "fill-opacity";
export type Schema = {
  type: "number" | "string";
  title?: string;
  description?: string;
  enum?: Scalar[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  pattern?: string;
  default?: Scalar;
};
export type Entry = {
  parameter: {
    schema: Schema;
    binding: { property: Property; targets: string[] };
    value?: Scalar;
  };
  baseline: { kind: "uniform"; value: Scalar } | { kind: "mixed" } | { kind: "unrepresentable"; reason: string };
  pages: string[];
};
export type Profile = {
  id: string;
  name: string;
  description?: string;
  overrides: Record<string, Scalar>;
};
export type ProfileSet = {
  id: string;
  name: string;
  description?: string;
  parameters: string[];
  profiles: Profile[];
};
export type Description = {
  version: 1;
  pageCount: number;
  pages: Record<string, { index: number; label?: string }>;
  parameters: Record<string, Entry>;
  groups?: { title: string; description?: string; parameters: string[] }[];
  profileSets?: ProfileSet[];
};

export function matchingProfile(
  set: ProfileSet,
  overrides: Record<string, Scalar>,
  drafts: Record<string, string>,
): Profile | undefined {
  return set.profiles.find((profile) =>
    set.parameters.every(
      (id) =>
        !Object.hasOwn(drafts, id) &&
        Object.hasOwn(overrides, id) === Object.hasOwn(profile.overrides, id) &&
        overrides[id] === profile.overrides[id],
    ),
  );
}

export function applyProfile(
  set: ProfileSet,
  profile: Profile,
  state: { overrides: Record<string, Scalar>; drafts: Record<string, string> },
) {
  const outside = <T>(values: Record<string, T>) =>
    Object.fromEntries(Object.entries(values).filter(([id]) => !set.parameters.includes(id)));
  return {
    overrides: { ...outside(state.overrides), ...profile.overrides },
    drafts: outside(state.drafts),
  };
}

export function groups(description: Description) {
  const supplied = description.groups ?? [];
  const used = new Set(supplied.flatMap((group) => group.parameters));
  const remaining = Object.keys(description.parameters)
    .toSorted()
    .filter((id) => !used.has(id));
  return [...supplied, ...(remaining.length ? [{ title: "Other controls", parameters: remaining }] : [])].map(
    (group) => ({
      ...group,
      title: group.title.replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, prefix, letter) => prefix + letter.toUpperCase()),
    }),
  );
}

export function objects(description: Description) {
  const bindings = new Map<string, string[]>();
  for (const [id, entry] of Object.entries(description.parameters)) {
    const key = JSON.stringify(entry.parameter.binding.targets.toSorted());
    const members = bindings.get(key) ?? [];
    members.push(id);
    bindings.set(key, members);
  }
  return (ids: string[]) => {
    const order = new Map(ids.map((id, index) => [id, index]));
    return ids.flatMap<{
      parameters: string[];
      quartet: Quartet | undefined;
    }>((id) => {
      const key = JSON.stringify(description.parameters[id].parameter.binding.targets.toSorted());
      const peers = bindings.get(key)!;
      const complete = peers.every((other) => order.has(other));
      const properties = Object.fromEntries(
        peers.map((other) => [description.parameters[other].parameter.binding.property, other]),
      ) as Partial<Record<Property, string>>;
      if (!complete || !properties.display || peers.length === 1) return [{ parameters: [id], quartet: undefined }];
      const members = peers.toSorted((a, b) => order.get(a)! - order.get(b)!);
      return id === members[0]
        ? [
            {
              parameters: members,
              quartet: {
                fill: { color: properties["fill-color"], opacity: properties["fill-opacity"] },
                stroke: {
                  color: properties["stroke-color"],
                  opacity: properties["stroke-opacity"],
                },
                width: properties["stroke-width"],
                visibility: properties.display,
              },
            },
          ]
        : [];
    });
  };
}

export function applicable(description: Description, pages: Iterable<number>): string[] {
  const scope = new Set(pages);
  return groups(description)
    .flatMap((group) => group.parameters)
    .filter((id) => description.parameters[id].pages.some((page) => scope.has(description.pages[page].index)));
}

export function available(source: { id: string; input: { description: Description } }, parts: Part[]): string[] {
  return applicable(source.input.description, usedPages(source, parts));
}

export function draftError(
  source: { id: string; input: { name: string; description: Description }; drafts: Record<string, string> },
  parts: Part[],
): string | undefined {
  if (!Object.keys(source.drafts).length) return;
  const scope = new Set(available(source, parts));
  for (const [id, text] of Object.entries(source.drafts)) {
    if (!scope.has(id)) continue;
    const entry = source.input.description.parameters[id];
    if (feedback(entry, text))
      return `${source.input.name}: fix ${entry.parameter.schema.title ?? id} before Download.`;
  }
}

function usedPages(source: { id: string }, parts: Part[]): number[] {
  return parts.flatMap((part) =>
    part.pages.flatMap((page) =>
      "source" in page.content && page.content.source === source.id ? [page.content.page] : [],
    ),
  );
}

export function bufferPages(
  source: { id: string; input: { description: Description } },
  parts: Part[],
): number[] | undefined {
  const pages = [...new Set(usedPages(source, parts))].toSorted((a, b) => a - b);
  const count = source.input.description.pageCount;
  if (!pages.length || count < 32 || pages.length * 4 > count) return;
  return pages;
}

export function needsRender(
  source: { id: string; overrides: Record<string, Scalar>; input: { description: Description } },
  parts: Part[],
  rendered: Render,
): boolean {
  const used = usedPages(source, parts);
  const eligible = applicable(source.input.description, used);
  return (
    eligible.length > 0 &&
    ((rendered.pages !== undefined && used.some((page) => !rendered.pages!.includes(page))) ||
      eligible.some(
        (id) =>
          Object.hasOwn(source.overrides, id) !== Object.hasOwn(rendered.overrides, id) ||
          source.overrides[id] !== rendered.overrides[id],
      ))
  );
}

export function resolve(entry: Entry, overrides: Record<string, Scalar>, id: string): Entry {
  const parameter = { ...entry.parameter };
  delete parameter.value;
  if (Object.hasOwn(overrides, id)) parameter.value = overrides[id];
  return { ...entry, parameter };
}

export function current(entry: Entry, draft?: string): string {
  if (draft !== undefined) return draft;
  if (Object.hasOwn(entry.parameter, "value")) return String(entry.parameter.value);
  return entry.baseline.kind === "uniform" ? String(entry.baseline.value) : "";
}

export function step(entry: Entry, text: string, direction: -1 | 1): string | undefined {
  if (feedback(entry, text)) return undefined;
  const property = entry.parameter.binding.property;
  let next: string;
  if (property.endsWith("color")) {
    next =
      "#" +
      text
        .slice(1)
        .match(/../g)!
        .map((channel) =>
          Math.max(0, Math.min(255, parseInt(channel, 16) + direction * 8))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    if (next.toLowerCase() === text.toLowerCase()) return undefined;
  } else if (property === "stroke-width") {
    next = String(Number((Number(text) * 1.05 ** direction).toPrecision(4)));
    if (Number(next) === Number(text)) return undefined;
  } else return undefined;
  return feedback(entry, next) ? undefined : next;
}

// Field feedback helps entry. The processor remains the authority for PDF operations.
export function feedback(entry: Entry, text: string): string | undefined {
  const { schema, binding } = entry.parameter;
  if (!text.trim()) return "Enter a value or reset this control.";
  const value = schema.type === "number" ? Number(text) : text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "Enter a finite number.";
    if (binding.property === "stroke-width" ? value <= 0 : value < 0 || value > 1)
      return binding.property === "stroke-width"
        ? "Width must be greater than zero."
        : "Opacity must be between 0 and 1.";
    if (
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum) ||
      (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) ||
      (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum)
    )
      return "This value is outside the declared range.";
  } else if (binding.property.endsWith("color") && !/^#[0-9a-fA-F]{6}$/.test(value)) {
    return "Use # followed by six hexadecimal digits.";
  }
  if (schema.enum && !schema.enum.includes(value)) return "Choose a declared value.";
  return undefined;
}
