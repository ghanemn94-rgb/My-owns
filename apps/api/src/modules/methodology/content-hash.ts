// The canonical content hash of a Studio configuration version (ADR-0039 §1; T-DG5-BE-A).
//
//   content_sha256 = SHA-256 (hex) of the UTF-8 bytes of the canonical JSON of
//                    { definition, titleEn, titleAr, elements }
//   elements       = the version's methodology_element rows as { elementType, stableKey, origin, removed, ordinal,
//                    attributes }, sorted by (elementType, stableKey)
//   canonical JSON = object keys sorted by Unicode code point, no insignificant whitespace; numbers are integers
//                    (decimals are strings, so no float formatting ever enters the hash).
//
// Every content write recomputes it (drafts, elements); check runs and review requests are recorded against exactly
// this value, so a stale run never satisfies publish. A SEEDED version's hash is an opaque identity set by its migration
// and is never recomputed or compared across versions (p5-work-split §A.10 item 6): only Studio drafts are hashed here.
import { createHash } from "node:crypto";
import type { DbOrTx } from "@mth/db";

export interface HashedElement {
  readonly elementType: string;
  readonly stableKey: string;
  readonly origin: string;
  readonly removed: boolean;
  readonly ordinal: number | null;
  readonly attributes: unknown;
}

export interface HashedContent {
  readonly definition: unknown;
  readonly titleEn: string;
  readonly titleAr: string;
  readonly elements: readonly HashedElement[];
}

/** Code-point order (not UTF-16 code units): the two differ only for keys with characters above U+FFFF. */
function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
  const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    const d = (x.at(i) ?? 0) - (y.at(i) ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/**
 * Canonical JSON of `value` (ADR-0039 §1). A non-integer or non-finite number is a programming error here: the schemas
 * (`onlyIntegerNumbers`) refuse it before any write, so it can never reach a stored hash.
 */
export function canonicalContentJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("content hash: numbers must be integers (decimals are strings)");
    return String(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalContentJson(v)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareCodePoints(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalContentJson(v)}`).join(",")}}`;
  }
  throw new Error(`content hash: unsupported value of type ${typeof value}`);
}

/** The ADR-0039 §1 hash of a version's content. Pure: same content, same hash, on every machine and locale. */
export function contentSha256(content: HashedContent): string {
  const elements = [...content.elements]
    .map((e) => ({
      elementType: e.elementType,
      stableKey: e.stableKey,
      origin: e.origin,
      removed: e.removed,
      ordinal: e.ordinal,
      attributes: e.attributes,
    }))
    .sort((a, b) => compareCodePoints(a.elementType, b.elementType) || compareCodePoints(a.stableKey, b.stableKey));
  const text = canonicalContentJson({
    definition: content.definition,
    titleEn: content.titleEn,
    titleAr: content.titleAr,
    elements,
  });
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The element rows of a version in their hashed shape (ADR-0039 §1). */
export async function loadHashedElements(db: DbOrTx, versionId: string): Promise<HashedElement[]> {
  const rows = await db
    .selectFrom("methodology_element")
    .select(["element_type", "stable_key", "origin", "removed", "ordinal", "attributes"])
    .where("methodology_version_id", "=", versionId)
    .execute();
  return rows.map((r) => ({
    elementType: r.element_type,
    stableKey: r.stable_key,
    origin: r.origin,
    removed: r.removed,
    ordinal: r.ordinal,
    attributes: r.attributes,
  }));
}

/**
 * Recomputes the hash of a Studio version from its stored definition, titles and element rows (inside the writer's
 * transaction, after its element writes). Callers write the result with their own version step and audit event.
 */
export async function recomputeContentSha256(
  db: DbOrTx,
  versionId: string,
  overrides: Partial<Pick<HashedContent, "definition" | "titleEn" | "titleAr">> = {},
): Promise<string> {
  const v = await db
    .selectFrom("methodology_version")
    .select(["definition", "title_en", "title_ar"])
    .where("id", "=", versionId)
    .executeTakeFirstOrThrow();
  return contentSha256({
    definition: overrides.definition ?? v.definition,
    titleEn: overrides.titleEn ?? v.title_en,
    titleAr: overrides.titleAr ?? v.title_ar,
    elements: await loadHashedElements(db, versionId),
  });
}
