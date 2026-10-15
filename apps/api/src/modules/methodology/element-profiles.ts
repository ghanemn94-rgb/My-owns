// Element provenance, guiding-question tags and the reader namespaces in Studio (OpenAPI tag "methodology-reader";
// ADR-0049 §2, §6, §10-§11; REQ-PB-002, REQ-PB-011, REQ-S02-004 (Studio link edits); p5-work-split §I.2;
// T-DG5-BE-Q2):
//   GET /methodology/elements?provenance=&kind=&transformationId=   listMethodologyElements (session)
//   GET /methodology/guiding-questions                             listGuidingQuestions    (session)
//
// Profiles. The 56 seeded `methodology_element_profile` rows (0089) follow B0156-B0162 exactly: 50 custom extensions
// (B0158 phases, B0159 TOM dimensions, B0160 gates and templates T01-T16, B0161 the scoring model, the governance
// forums, the 30-60-90 launch windows and the health check, B0162 the roaming example and the traceability chain) and
// 6 benefit-lifecycle steps inspired by PMI Benefits Realization Management (B0156). No element is labelled a PMI
// standard: `foundation_inspired` is rendered "Inspired by …", never "PMI standard". Labels come from the element's
// source_element row, else the profile's own pair. Each template has exactly one guiding-question tag, no other kind
// has one. A version may override provenance and/or a template's question tag through Studio ("versioned publish
// only"): the `methodology_text` element `profile.<element_ref>` with attributes `provenance`/`questionTag`. The
// resolved profile of a version is the override when present, else the catalogue row (`overridden`). The source
// reference stays the catalogue's: it names the block that defines the element.
//
// Studio rules (ADR-0049 §6 mirrored before the database, with the §11 codes). The 0089 trigger
// methodology_element_reader_guard enforces them in the database; this file checks first on every Studio element write
// of the `methodology` kind (and in preview/compatibility, which re-run validateElement over the stored rows) by
// composing a check in front of the methodology kind's own validateElement hook (providers/methodology-kind.ts, BE-B,
// unchanged). Only `methodology_text` rows whose key is `profile.*`, `block.*` or `provenance.note`, or that use a
// reader attribute, are checked:
//   - a reader attribute outside its namespace, an unknown profile, a provenance outside the set, a question tag that
//     is unknown or not on a template, or links on a profile key -> 422 methodology_reader.invalid_override;
//   - an unknown block, a profile attribute on a block key, or links that are not arrays of at most 50 objects
//     {targetKind: template | procedure | requirement, targetKey} in the shapes of ADR-0049 §4
//     -> 422 methodology_reader.invalid_block_link;
//   - a label, help or body text that claims official PMI status or certification or names DG0-DG7 (the SQL rules
//     p5_claims_official_pmi and p5_mentions_engineering_gate themselves, so both layers agree)
//     -> 422 methodology_reader.prohibited_text.
// Configuration only: a Studio edit is not a business approval. Reading writes nothing.
import { sql, type DbOrTx } from "@mth/db";
import { uuid } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf } from "../access/index.ts";
import { parseQuery, problems, type HttpProblem, type ModuleDeps } from "../platform/index.ts";
import type { ConfigResolver } from "./config-resolver.ts";
import { configKindProvider, registerConfigKindProvider, type ConfigKindProviderHooks } from "./kinds.ts";
import { LINK_TARGET_KINDS, methodologyVersionRef, readerContext } from "./reader.ts";

// ------------------------------------------------------------------------------------------------ zod mirrors

export const ELEMENT_KINDS = [
  "phase",
  "gate",
  "tom_dimension",
  "template",
  "scoring_model",
  "forum",
  "launch_window",
  "health_check",
  "roaming_example",
  "traceability_chain",
  "benefit_lifecycle_step",
] as const;
export const PROVENANCES = ["custom_extension", "foundation_inspired"] as const;
export const QUESTION_CODES = ["why_change", "what_different", "how_execute", "how_prove_value"] as const;
const PROVENANCE_SOURCE_REFS = ["B0156", "B0158", "B0159", "B0160", "B0161", "B0162"] as const;

/** OpenAPI `MethodologyElementProfile`. */
export const methodologyElementProfile = z.strictObject({
  elementRef: z.string(),
  kind: z.enum(ELEMENT_KINDS),
  stableKey: z.string(),
  ordinal: z.number().int(),
  labelEn: z.string(),
  labelAr: z.string(),
  provenance: z.enum(PROVENANCES),
  provenanceSourceRef: z.enum(PROVENANCE_SOURCE_REFS),
  questionTag: z.enum(QUESTION_CODES).nullable(),
  sourceRefs: z.array(z.string().regex(/^B0[0-9]{3}$/)).max(10),
  overridden: z.boolean(),
});
/** OpenAPI `MethodologyElementProfileList`. */
export const methodologyElementProfileList = z.strictObject({
  methodologyVersion: methodologyVersionRef,
  items: z.array(methodologyElementProfile).max(100),
});
/** OpenAPI `GuidingQuestion`. */
export const guidingQuestion = z.strictObject({
  code: z.enum(QUESTION_CODES),
  ordinal: z.number().int(),
  textEn: z.string(),
  textAr: z.string(),
  sourceRef: z.string(),
});
/** OpenAPI `GuidingQuestionList`. */
export const guidingQuestionList = z.strictObject({ items: z.array(guidingQuestion).max(4) });

export type MethodologyElementProfile = z.infer<typeof methodologyElementProfile>;

// ------------------------------------------------------------------------------------------------ refusals (§11)

const READER_REFUSALS = {
  invalidOverride: [
    "methodology_reader.invalid_override",
    "A provenance or question-tag override must name a seeded element, use an allowed value, and tag only a template.",
  ],
  invalidBlockLink: [
    "methodology_reader.invalid_block_link",
    "A block link must name an existing block and a template, procedure or requirement in the allowed format.",
  ],
  prohibitedText: [
    "methodology_reader.prohibited_text",
    "Reader text must not claim official PMI status or certification, or name an engineering delivery gate.",
  ],
} as const;

/** The ADR-0049 §11 refusals of the reader namespaces (also used by platform/db-errors.ts). */
export const readerRefusals = {
  invalidOverride: (): HttpProblem => problems.businessRule(...READER_REFUSALS.invalidOverride),
  invalidBlockLink: (): HttpProblem => problems.businessRule(...READER_REFUSALS.invalidBlockLink),
  prohibitedText: (): HttpProblem => problems.businessRule(...READER_REFUSALS.prohibitedText),
};

// ------------------------------------------------------------------------------------------------ resolved profiles

const PROFILE_PREFIX = "profile.";

interface ProfileRow {
  readonly element_ref: string;
  readonly element_kind: string;
  readonly stable_key: string;
  readonly ordinal: number;
  readonly label_en: string | null;
  readonly label_ar: string | null;
  readonly source_label_en: string | null;
  readonly source_label_ar: string | null;
  readonly provenance: string;
  readonly provenance_source_ref: string;
  readonly question_tag: string | null;
  readonly source_refs: string[];
}

const kindOrder = (k: string) => ELEMENT_KINDS.findIndex((x) => x === k);

/**
 * The resolved profiles of a version: the 56 catalogue rows in kind order (the OpenAPI enum order) then ordinal, each
 * overridden by the version's `profile.<element_ref>` element when present (not removed).
 */
export async function resolveProfiles(
  db: DbOrTx,
  resolver: ConfigResolver,
  versionId: string,
): Promise<MethodologyElementProfile[]> {
  const [rows, texts] = await Promise.all([
    db
      .selectFrom("methodology_element_profile as p")
      .leftJoin("source_element as s", "s.id", "p.source_element_id")
      .select([
        "p.element_ref",
        "p.element_kind",
        "p.stable_key",
        "p.ordinal",
        "p.label_en",
        "p.label_ar",
        "s.source_label_en",
        "s.label_ar as source_label_ar",
        "p.provenance",
        "p.provenance_source_ref",
        "p.question_tag",
        "p.source_refs",
      ])
      .execute() as Promise<ProfileRow[]>,
    resolver.elements(db, versionId, "methodology_text"),
  ]);
  const overrides = new Map(
    texts
      .filter((e) => e.stableKey.startsWith(PROFILE_PREFIX))
      .map((e) => [e.stableKey.slice(PROFILE_PREFIX.length), new Map(Object.entries(e.attributes))]),
  );
  const sorted = [...rows].sort(
    (a, b) => kindOrder(a.element_kind) - kindOrder(b.element_kind) || a.ordinal - b.ordinal,
  );
  return sorted.map((r): MethodologyElementProfile => {
    const o = overrides.get(r.element_ref);
    const isTemplate = r.element_kind === "template";
    const provenance = PROVENANCES.find((p) => p === (o?.get("provenance") ?? r.provenance)) ?? "custom_extension";
    const tag = isTemplate ? (o?.get("questionTag") ?? r.question_tag) : null;
    const questionTag = QUESTION_CODES.find((q) => q === tag) ?? null;
    return {
      elementRef: r.element_ref,
      kind: ELEMENT_KINDS.find((k) => k === r.element_kind) ?? "phase",
      stableKey: r.stable_key,
      ordinal: r.ordinal,
      labelEn: r.label_en ?? r.source_label_en ?? r.element_ref,
      labelAr: r.label_ar ?? r.source_label_ar ?? r.element_ref,
      provenance,
      provenanceSourceRef: PROVENANCE_SOURCE_REFS.find((s) => s === r.provenance_source_ref) ?? "B0160",
      questionTag,
      sourceRefs: r.source_refs,
      // The version records an override of this element (even one that restates the seeded value).
      overridden: o !== undefined && (o.has("provenance") || (isTemplate && o.has("questionTag"))),
    };
  });
}

// ------------------------------------------------------------------------------------------------ Studio rules (§6)

const READER_ATTRIBUTES = ["provenance", "questionTag", "linksAdded", "linksRemoved"] as const;
const TEXT_ATTRIBUTES = ["labelEn", "labelAr", "helpEn", "helpAr", "bodyEn", "bodyAr"] as const;
const LINK_KEY: ReadonlyMap<string, RegExp> = new Map([
  ["template", /^T(0[1-9]|1[0-6])$/],
  ["requirement", /^REQ-[A-Z0-9]+-[0-9]{3}$/],
  ["procedure", /^[a-z][a-z0-9_]{0,62}$/],
]);

/** A link list is an array of at most 50 objects {targetKind, targetKey} in the ADR-0049 §4 shapes. */
function validLinkList(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 50) return false;
  return (value as unknown[]).every((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
    const entries = new Map(Object.entries(item as Record<string, unknown>));
    const kind = entries.get("targetKind");
    const key = entries.get("targetKey");
    if (typeof kind !== "string" || typeof key !== "string") return false;
    if (!LINK_TARGET_KINDS.some((k) => k === kind)) return false;
    return LINK_KEY.get(kind)?.test(key) === true;
  });
}

/** True when any text runs foul of the two SQL text rules (ADR-0049 §7), evaluated by the database functions. */
async function anyProhibited(db: DbOrTx, texts: readonly string[]): Promise<boolean> {
  if (texts.length === 0) return false;
  const r = await sql<{ bad: boolean }>`
    SELECT coalesce(bool_or(p5_claims_official_pmi(t) OR p5_mentions_engineering_gate(t)), false) AS bad
      FROM unnest(${texts}::text[]) AS t`.execute(db);
  return r.rows[0]?.bad === true;
}

/**
 * The reader-namespace rules of ADR-0049 §6 for one `methodology_text` element write, with the §11 codes (the same
 * order as methodology_element_reader_guard: namespace and shape first, then the text rules). Other rows pass.
 */
export async function validateReaderElement(
  db: DbOrTx,
  input: {
    readonly elementType: string;
    readonly stableKey: string;
    readonly attributes: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  const a = new Map(Object.entries(input.attributes));
  const has = (k: string) => a.has(k) && a.get(k) !== undefined;
  const key = input.stableKey;
  const ns = key.startsWith(PROFILE_PREFIX)
    ? "profile"
    : key.startsWith("block.")
      ? "block"
      : key === "provenance.note"
        ? "note"
        : null;
  const usesReader = READER_ATTRIBUTES.some(has);
  if (ns === null && !usesReader) return;
  const usesProfile = has("provenance") || has("questionTag");
  const usesLinks = has("linksAdded") || has("linksRemoved");
  if (input.elementType !== "methodology_text" || ns === null || (ns === "note" && usesReader))
    throw usesProfile ? readerRefusals.invalidOverride() : readerRefusals.invalidBlockLink();

  if (ns === "profile") {
    const prof = await db
      .selectFrom("methodology_element_profile")
      .select("element_kind")
      .where("element_ref", "=", key.slice(PROFILE_PREFIX.length))
      .executeTakeFirst();
    if (prof === undefined || usesLinks) throw readerRefusals.invalidOverride();
    if (has("provenance") && !PROVENANCES.some((p) => p === a.get("provenance")))
      throw readerRefusals.invalidOverride();
    if (has("questionTag")) {
      const tag = a.get("questionTag");
      if (prof.element_kind !== "template" || typeof tag !== "string") throw readerRefusals.invalidOverride();
      const q = await db.selectFrom("guiding_question").select("code").where("code", "=", tag).executeTakeFirst();
      if (q === undefined) throw readerRefusals.invalidOverride();
    }
  } else if (ns === "block") {
    const ref = key.slice("block.".length);
    const block = /^B0[0-9]{3}$/.test(ref)
      ? await db.selectFrom("playbook_block").select("block_ref").where("block_ref", "=", ref).executeTakeFirst()
      : undefined;
    if (block === undefined || usesProfile) throw readerRefusals.invalidBlockLink();
    for (const k of ["linksAdded", "linksRemoved"])
      if (has(k) && !validLinkList(a.get(k))) throw readerRefusals.invalidBlockLink();
  }

  const texts = TEXT_ATTRIBUTES.map((k) => a.get(k)).filter((v): v is string => typeof v === "string");
  if (await anyProhibited(db, texts)) throw readerRefusals.prohibitedText();
}

/** Marks the composed hook, so registering twice never wraps twice. */
const COMPOSED = new WeakSet<object>();

/**
 * Puts validateReaderElement in front of the `methodology` kind's validateElement hook (BE-B's provider is
 * registered by the element routes, before this runs; its own checks still follow). Idempotent.
 */
export function registerReaderStudioRules(): void {
  const current = configKindProvider("methodology");
  const base = current.validateElement;
  if (base !== undefined && COMPOSED.has(base)) return;
  const validateElement: NonNullable<ConfigKindProviderHooks["validateElement"]> = async (db, input) => {
    await validateReaderElement(db, input);
    if (base !== undefined) await base(db, input);
  };
  COMPOSED.add(validateElement);
  // The other hooks are kept as they are; the default key and element types are the registry's own.
  const { kind: _kind, defaultKey: _defaultKey, elementTypes: _types, ...hooks } = current;
  registerConfigKindProvider("methodology", { ...hooks, validateElement });
}

// ------------------------------------------------------------------------------------------------ routes

const ELEMENTS = "/api/v1/methodology/elements";
const QUESTIONS = "/api/v1/methodology/guiding-questions";
const elementsQuery = z.strictObject({
  provenance: z.enum(PROVENANCES).optional(),
  kind: z.enum(ELEMENT_KINDS).optional(),
  transformationId: uuid.optional(),
});

export function registerMethodologyElementProfileRoutes(
  app: FastifyInstance,
  { db }: ModuleDeps,
  resolver: ConfigResolver,
): string[] {
  registerReaderStudioRules();

  app.get(ELEMENTS, { config: { access: { permission: "authenticated" } } }, async (request) => {
    const query = parseQuery(elementsQuery, request.query);
    const ctx = await readerContext(db, principalOf(request), resolver, query.transformationId);
    const profiles = await resolveProfiles(db, resolver, ctx.version.versionId);
    return {
      methodologyVersion: ctx.version,
      items: profiles.filter(
        (p) =>
          (query.provenance === undefined || p.provenance === query.provenance) &&
          (query.kind === undefined || p.kind === query.kind),
      ),
    };
  });

  app.get(QUESTIONS, { config: { access: { permission: "authenticated" } } }, async (request) => {
    parseQuery(z.strictObject({}), request.query);
    const rows = await db.selectFrom("guiding_question").selectAll().orderBy("ordinal").execute();
    return {
      items: rows.map((r) => ({
        code: QUESTION_CODES.find((q) => q === r.code) ?? "why_change",
        ordinal: r.ordinal,
        textEn: r.text_en,
        textAr: r.text_ar,
        sourceRef: r.source_ref,
      })),
    };
  });

  return [`GET ${ELEMENTS}`, `GET ${QUESTIONS}`];
}
