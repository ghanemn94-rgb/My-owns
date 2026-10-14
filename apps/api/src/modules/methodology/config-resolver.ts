// ConfigResolver (ADR-0039 §3; D-142 Q1; p5-work-split §A.1; T-DG5-BE-A): the one port through which every reader
// resolves configuration. `methodology` imports no other module; forms, procedures, automation, workflows, health and
// reporting receive the resolver from the composition root (server.ts) and call it.
//
//  - pinnedVersion: a transformation's pin of a kind; with no pin of that kind, version 1 of the kind's default key
//    ('playbook', 'scoring-defaults', and the keys slices B-H name). Never "the latest".
//  - element / elements: the resolved attributes of a version's elements. The DG2-DG4 catalogue rows are the
//    stable-identity registry (gate_definition, phase_definition, tom_dimension, gate_criterion_definition and the
//    source inventory source_element); a version's methodology_element row, where one exists, overrides the catalogue
//    attributes field by field (a full row therefore replaces them, ADR-0039 §2 "V's row when it exists, else the
//    catalogue's values"). Elements without a catalogue identity (admin-added, or the seeded scoring rows) come from
//    their rows alone. Order: catalogue order, then the others by ordinal and stable key. Removed elements are excluded
//    unless asked.
//  - withDraft: preview/test only. Resolves a transformation's pin of the draft's kind to the draft; never persisted.
//
// Pinned v1 is byte-identical: `playbook` v1 has no element rows, so every resolved element of a v1-pinned
// transformation is exactly the catalogue value (BE-C's v1 regression suite, p5-plan R2, proves it per reader).
import type { DbOrTx } from "@mth/db";
import type { ConfigElement, ConfigElementType, ConfigKind } from "@mth/shared/schemas";
import { configKindProvider, configKindProviders } from "./kinds.ts";

export type ResolvedElement = ConfigElement;

export interface PinnedVersion {
  readonly versionId: string;
  readonly versionNo: number;
  readonly key: string;
}

export interface ConfigResolver {
  /** The version a transformation uses for a kind: its pin; with no pin of that kind, version 1 of the kind's
   *  default key. Throws when the kind has no resolvable version (no default key or no version 1 seeded yet). */
  pinnedVersion(db: DbOrTx, transformationId: string, kind: ConfigKind): Promise<PinnedVersion>;
  /** The resolved attributes of one element of a version (row, else catalogue); null when the identity is unknown. */
  element(db: DbOrTx, versionId: string, type: ConfigElementType, stableKey: string): Promise<ResolvedElement | null>;
  /** All resolved elements of a type, catalogue order then admin-added by ordinal; removed ones excluded unless asked. */
  elements(
    db: DbOrTx,
    versionId: string,
    type: ConfigElementType,
    o?: { readonly includeRemoved?: boolean },
  ): Promise<ResolvedElement[]>;
  /** Preview/test only: resolve as if the transformation were pinned to `draftVersionId` (never persisted). */
  withDraft(draftVersionId: string): ConfigResolver;
}

/** One catalogue identity of an element type, in the attribute names of ADR-0039 §2. */
export interface CatalogueEntry {
  readonly stableKey: string;
  readonly ordinal: number;
  readonly sourceRef: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
}

/** The stable source-inventory sets, in the order of the coverage report (ADR-0039 §6). */
const SOURCE_SETS = [
  "mode",
  "phase",
  "gate",
  "template",
  "tom_dimension",
  "forum",
  "benefit_lifecycle_step",
  "launch_window",
  "roaming_example",
  "health_question",
] as const;

/**
 * The catalogue identities of an element type (ADR-0039 §2 "else the catalogue's values"). Types without a catalogue
 * (methodology text, checklists, routes, reminders, dashboards, layouts, scoring rows) have none: their elements exist
 * only as version rows.
 */
export async function loadCatalogue(db: DbOrTx, type: ConfigElementType): Promise<CatalogueEntry[]> {
  switch (type) {
    case "phase": {
      const rows = await db.selectFrom("phase_definition").selectAll().orderBy("ordinal").execute();
      return rows.map((r) => ({
        stableKey: r.code,
        ordinal: r.ordinal,
        sourceRef: r.source_ref,
        attributes: {
          labelEn: r.source_name_en,
          labelAr: r.name_ar,
          helpEn: r.source_purpose_en,
          helpAr: r.purpose_ar,
        },
      }));
    }
    case "gate": {
      const rows = await db.selectFrom("gate_definition").selectAll().orderBy("ordinal").execute();
      return rows.map((r) => ({
        stableKey: r.code,
        ordinal: r.ordinal,
        sourceRef: r.source_ref,
        attributes: {
          labelEn: r.source_name_en,
          labelAr: r.name_ar,
          helpEn: r.source_decision_question_en,
          helpAr: r.decision_question_ar,
          defaultApproverRoleCode: r.default_approver_role_code,
          submissionEnabled: r.submission_enabled,
        },
      }));
    }
    case "tom_dimension": {
      const rows = await db.selectFrom("tom_dimension").selectAll().orderBy("ordinal").execute();
      return rows.map((r) => ({
        stableKey: r.code,
        ordinal: r.ordinal,
        sourceRef: r.source_ref,
        attributes: {
          labelEn: r.label_en,
          labelAr: r.label_ar,
          helpEn: r.source_design_question_en,
          helpAr: r.design_question_ar,
        },
      }));
    }
    case "gate_criterion": {
      const rows = await db
        .selectFrom("gate_criterion_definition as c")
        .innerJoin("gate_definition as g", "g.id", "c.gate_definition_id")
        .select([
          "c.key",
          "c.label_en",
          "c.label_ar",
          "c.description_en",
          "c.description_ar",
          "c.mandatory",
          "c.source_ref",
          "g.code as gate_code",
          "g.ordinal as gate_ordinal",
          "c.ordinal",
        ])
        .orderBy("g.ordinal")
        .orderBy("c.ordinal")
        .execute();
      return rows.map((r, i) => ({
        stableKey: r.key,
        ordinal: i + 1,
        sourceRef: r.source_ref,
        attributes: {
          labelEn: r.label_en,
          labelAr: r.label_ar,
          helpEn: r.description_en,
          helpAr: r.description_ar,
          mandatory: r.mandatory,
          gateCode: r.gate_code,
        },
      }));
    }
    case "template":
    case "source_element": {
      let q = db.selectFrom("source_element").selectAll();
      if (type === "template") q = q.where("set_code", "=", "template");
      const rows = await q.execute();
      const setOrder = new Map<string, number>(SOURCE_SETS.map((s, i) => [s, i]));
      rows.sort((a, b) => (setOrder.get(a.set_code) ?? 99) - (setOrder.get(b.set_code) ?? 99) || a.ordinal - b.ordinal);
      return rows.map((r) => ({
        stableKey: type === "template" ? r.stable_key : `${r.set_code}.${r.stable_key}`,
        ordinal: r.ordinal,
        sourceRef: r.source_ref,
        attributes: { labelEn: r.source_label_en, labelAr: r.label_ar },
      }));
    }
    default: {
      // T-DG5-BE-D (ADR-0041 §2): a kind provider's own catalogue (form_schema: native forms and source columns).
      for (const provider of configKindProviders()) {
        if (provider.catalogue === undefined || !provider.elementTypes.includes(type)) continue;
        const entries = await provider.catalogue(db, type);
        if (entries !== null) return [...entries];
      }
      return [];
    }
  }
}

const asObject = (v: unknown): Readonly<Record<string, unknown>> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Resolves every element of one type of a version (ADR-0039 §2). */
export async function resolveElements(
  db: DbOrTx,
  versionId: string,
  type: ConfigElementType,
  o: { readonly includeRemoved?: boolean } = {},
): Promise<ResolvedElement[]> {
  const [catalogue, rows] = await Promise.all([
    loadCatalogue(db, type),
    db
      .selectFrom("methodology_element")
      .select(["stable_key", "origin", "removed", "ordinal", "attributes"])
      .where("methodology_version_id", "=", versionId)
      .where("element_type", "=", type)
      .execute(),
  ]);
  const byKey = new Map(rows.map((r) => [r.stable_key, r]));
  const out: ResolvedElement[] = [];
  for (const c of catalogue) {
    const row = byKey.get(c.stableKey);
    byKey.delete(c.stableKey);
    out.push({
      elementType: type,
      stableKey: c.stableKey,
      origin: "source",
      removed: row?.removed ?? false,
      ordinal: row?.ordinal ?? c.ordinal,
      sourceRef: c.sourceRef,
      catalogueAttributes: { ...c.attributes },
      attributes: { ...c.attributes, ...asObject(row?.attributes) },
      overridden: row !== undefined,
    });
  }
  const rest = [...byKey.values()].sort(
    (a, b) =>
      (a.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.ordinal ?? Number.MAX_SAFE_INTEGER) ||
      (a.stable_key < b.stable_key ? -1 : a.stable_key > b.stable_key ? 1 : 0),
  );
  for (const r of rest) {
    const attributes = asObject(r.attributes);
    const ref = new Map(Object.entries(attributes)).get("sourceRef");
    out.push({
      elementType: type,
      stableKey: r.stable_key,
      origin: r.origin === "admin" ? "admin" : "source",
      removed: r.removed,
      ordinal: r.ordinal,
      sourceRef: typeof ref === "string" ? ref : null,
      catalogueAttributes: {},
      attributes: { ...attributes },
      overridden: true,
    });
  }
  return o.includeRemoved === true ? out : out.filter((e) => !e.removed);
}

/** A transformation's pin of a kind, with the pin row's own fields; null when it has none. */
export async function loadPin(db: DbOrTx, transformationId: string, kind: ConfigKind) {
  return db
    .selectFrom("transformation_config_pin as p")
    .innerJoin("methodology_version as v", "v.id", "p.methodology_version_id")
    .select([
      "p.methodology_version_id as versionId",
      "v.version_no as versionNo",
      "v.key as key",
      "p.last_migration_id as lastMigrationId",
      "p.pinned_at as pinnedAt",
      "p.version as version",
    ])
    .where("p.transformation_id", "=", transformationId)
    .where("p.kind", "=", kind)
    .executeTakeFirst();
}

/** Version 1 of a kind's default key (ADR-0039 §3), or null when the kind has none yet. */
export async function defaultVersionOf(db: DbOrTx, kind: ConfigKind): Promise<PinnedVersion | null> {
  const key = configKindProvider(kind).defaultKey;
  if (key === null) return null;
  const v = await db
    .selectFrom("methodology_version")
    .select(["id", "version_no", "key"])
    .where("config_kind", "=", kind)
    .where("key", "=", key)
    .where("version_no", "=", 1)
    .executeTakeFirst();
  return v === undefined ? null : { versionId: v.id, versionNo: v.version_no, key: v.key };
}

/** The pinned version, else version 1 of the default key; null when neither exists. */
export async function resolvePinnedVersion(
  db: DbOrTx,
  transformationId: string,
  kind: ConfigKind,
): Promise<PinnedVersion | null> {
  const pin = await loadPin(db, transformationId, kind);
  if (pin !== undefined) return { versionId: pin.versionId, versionNo: pin.versionNo, key: pin.key };
  return defaultVersionOf(db, kind);
}

function makeResolver(draftVersionId: string | null): ConfigResolver {
  const resolver: ConfigResolver = {
    async pinnedVersion(db, transformationId, kind) {
      if (draftVersionId !== null) {
        const draft = await db
          .selectFrom("methodology_version")
          .select(["id", "version_no", "key", "config_kind"])
          .where("id", "=", draftVersionId)
          .executeTakeFirst();
        if (draft !== undefined && draft.config_kind === kind)
          return { versionId: draft.id, versionNo: draft.version_no, key: draft.key };
      }
      const resolved = await resolvePinnedVersion(db, transformationId, kind);
      if (resolved === null) throw new Error(`ConfigResolver: configuration kind ${kind} has no resolvable version`);
      return resolved;
    },
    async element(db, versionId, type, stableKey) {
      const all = await resolveElements(db, versionId, type, { includeRemoved: true });
      return all.find((e) => e.stableKey === stableKey) ?? null;
    },
    elements(db, versionId, type, o = {}) {
      return resolveElements(db, versionId, type, o);
    },
    withDraft(id) {
      return makeResolver(id);
    },
  };
  return Object.freeze(resolver);
}

/** The composition root's resolver (server.ts wires it into the modules that read configuration). */
export function createConfigResolver(): ConfigResolver {
  return makeResolver(null);
}
