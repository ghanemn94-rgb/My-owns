// The side-by-side diff of two versions of one configuration (ADR-0039 §5; REQ-S06-007; p5-work-split §A.2;
// T-DG5-BE-B). Per (elementType, stableKey) of the kind's element types, the RESOLVED elements (catalogue overridden
// by each version's rows, config-resolver.ts) are compared: `added` (present in `to`, absent or removed in `from`),
// `removed` (the reverse), `changed` (field-level from/to of the resolved attributes, plus `ordinal`). The kind's
// provider adds the rows of its own tables (ADR-0041's added form fields). Titles and definitions are compared as
// content, never by hash (a seeded hash is opaque; ADR-0039 §1). Read-only.
import type { DbOrTx } from "@mth/db";
import { configKind, type ConfigDiffEntry, type ConfigElementType } from "@mth/shared/schemas";
import { resolveElements, type ResolvedElement } from "./config-resolver.ts";
import { canonicalContentJson } from "./content-hash.ts";
import type { MethodologyVersionRow } from "./drafts.ts";
import { configKindProvider, type ConfigElementChange } from "./kinds.ts";

export interface VersionDiff {
  readonly fromVersionId: string;
  readonly toVersionId: string;
  readonly titleChanged: boolean;
  readonly definitionChanged: boolean;
  readonly entries: ConfigDiffEntry[];
  /** The same changes in the provider-hook shape (resolved attributes before and after). */
  readonly changes: ConfigElementChange[];
}

/** Stable JSON for comparison (canonical where possible; never throws on a float written by an older path). */
function same(a: unknown, b: unknown): boolean {
  try {
    return canonicalContentJson(a ?? null) === canonicalContentJson(b ?? null);
  } catch {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
}

function fieldsOf(
  from: Readonly<Record<string, unknown>> | null,
  to: Readonly<Record<string, unknown>> | null,
): ConfigDiffEntry["fields"] {
  const f = new Map(Object.entries(from ?? {}));
  const t = new Map(Object.entries(to ?? {}));
  const names = [...new Set([...f.keys(), ...t.keys()])].sort();
  const out: ConfigDiffEntry["fields"] = [];
  for (const n of names) {
    const a = f.has(n) ? f.get(n) : null;
    const b = t.has(n) ? t.get(n) : null;
    if (!same(a, b)) out.push({ field: n, from: a ?? null, to: b ?? null });
  }
  return out;
}

const withOrdinal = (e: ResolvedElement): Record<string, unknown> => ({ ...e.attributes, ordinal: e.ordinal });

/** The diff of `to` against `from` (same kind and key; the caller checks). */
export async function diffVersions(
  db: DbOrTx,
  to: MethodologyVersionRow,
  from: MethodologyVersionRow,
): Promise<VersionDiff> {
  const provider = configKindProvider(configKind.parse(to.config_kind));
  const entries: ConfigDiffEntry[] = [];
  const changes: ConfigElementChange[] = [];
  for (const type of provider.elementTypes) {
    const [a, b] = await Promise.all([
      resolveElements(db, from.id, type, { includeRemoved: true }),
      resolveElements(db, to.id, type, { includeRemoved: true }),
    ]);
    const before = new Map(a.filter((e) => !e.removed).map((e) => [e.stableKey, e]));
    const after = new Map(b.filter((e) => !e.removed).map((e) => [e.stableKey, e]));
    const keys = [...new Set([...a.map((e) => e.stableKey), ...b.map((e) => e.stableKey)])];
    for (const key of keys) {
      const x = before.get(key);
      const y = after.get(key);
      if (x === undefined && y === undefined) continue;
      if (x === undefined && y !== undefined) {
        entries.push({ elementType: type, stableKey: key, change: "added", fields: fieldsOf(null, withOrdinal(y)) });
        changes.push({ elementType: type, stableKey: key, change: "added", from: null, to: y.attributes });
      } else if (x !== undefined && y === undefined) {
        entries.push({ elementType: type, stableKey: key, change: "removed", fields: fieldsOf(withOrdinal(x), null) });
        changes.push({ elementType: type, stableKey: key, change: "removed", from: x.attributes, to: null });
      } else if (x !== undefined && y !== undefined) {
        const fields = fieldsOf(withOrdinal(x), withOrdinal(y));
        if (fields.length === 0) continue;
        entries.push({ elementType: type, stableKey: key, change: "changed", fields });
        changes.push({ elementType: type, stableKey: key, change: "changed", from: x.attributes, to: y.attributes });
      }
    }
  }
  if (provider.diffRows !== undefined) {
    const seen = new Set(entries.map((e) => `${e.elementType}\u0000${e.stableKey}`));
    for (const r of await provider.diffRows(db, { versionId: to.id, againstVersionId: from.id })) {
      if (seen.has(`${r.elementType}\u0000${r.stableKey}`)) continue;
      entries.push({
        elementType: r.elementType,
        stableKey: r.stableKey,
        change: r.change,
        fields: fieldsOf(r.from, r.to),
      });
      changes.push(r);
    }
  }
  return {
    fromVersionId: from.id,
    toVersionId: to.id,
    titleChanged: from.title_en !== to.title_en || from.title_ar !== to.title_ar,
    definitionChanged: !same(from.definition, to.definition),
    entries,
    changes,
  };
}

/** The element types of a change list, deduplicated, in first-seen order. */
export function changedTypes(changes: readonly ConfigElementChange[]): ConfigElementType[] {
  return [...new Set(changes.map((c) => c.elementType))];
}
