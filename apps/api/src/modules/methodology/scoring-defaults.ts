// T06 default weights and scoring rubric as versioned Studio configuration (REQ-PB-093; ADR-0040 §5, ADR-0039 §2, §4,
// §12; p5-work-split §A.6; T-DG5-KBE-A):
//   PUT /admin/methodology-versions/{versionId}/scoring-defaults  putScoringDefaultsDraft           (methodology.configure)
//   GET /admin/scoring-defaults[?versionId=]                       getScoringDefaults                (methodology.read)
//   GET /transformations/{transformationId}/scoring-defaults       getTransformationScoringDefaults  (transformation.read)
//
// putScoringDefaultsDraft writes a `scoring_defaults` draft (stage editing or preview) the way putConfigElement does,
// in one transaction: commit-time authorization (methodology.configure in the caller's organization, ADM_METHOD),
// Zod validation (400; a weight is a decimal string, > 0, <= 100, at most two decimals: validation.weight_percent),
// If-Match on the DRAFT's version (428 missing, 409 stale), lock class `configDraft` on "scoring_defaults:<key>", the
// element invariants of invariants.ts, one audit event per element row written plus one for the version step (content
// hash recomputed, stage back to `editing`), no remote I/O. The body is the full set of default weights: a listed
// criterion's weight is set (normalized to two decimals), a criterion left out is removed from the draft (recorded,
// removed = true); each listed rubric's five levels are replaced, an unlisted rubric keeps its descriptors. A body that
// changes nothing writes nothing (no step, no audit event). The draft may total anything; the 100 % rule over 2-6
// criteria is applied at publish (publish.ts, 422 config_version.weights_total; the 0062 guard backs it).
//
// The reads return weights as decimal strings with their exact decimal total (never rounded, never a float), and the
// rubric levels with null descriptors as null (the UI renders "No descriptor defined"; nothing is invented).
// getScoringDefaults without versionId reads the newest published version of `scoring-defaults`, the one a
// transformation created now is pinned to (migration 0065); getTransformationScoringDefaults reads the version the
// transformation uses: its scoring_defaults pin, else version 1 (ADR-0039 §3; never "the latest").
// Configuration only: a default weight set approves nothing; a transformation's weight set stays its own record,
// approved by its Sponsor (DG3). Product gates G1-G6 are business approvals inside the product.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import {
  SCORING_DEFAULT_CRITERIA,
  scoringDefaultsPut,
  scoringDefaultsQuery,
  type ConfigElementType,
  type ScoringDefaults,
  type ScoringDefaultsPut,
} from "@mth/shared/schemas";
import { Decimal } from "decimal.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { resolvePinnedVersion } from "./config-resolver.ts";
import { recomputeContentSha256 } from "./content-hash.ts";
import {
  assertContentEditable,
  loadVersion,
  lockConfigDraft,
  requireStudioPermission,
  requireStudioWrite,
  versionParams,
  VERSIONS,
  type MethodologyVersionRow,
} from "./drafts.ts";
import { loadElementRow, prepareElementPut } from "./invariants.ts";
import { registerScoringDefaultsKindProvider } from "./providers/scoring-defaults-kind.ts";

/** The configuration key whose newest published version new transformations are pinned to (0065; ADR-0040 §5). */
export const SCORING_DEFAULTS_KEY = "scoring-defaults";
const KIND = "scoring_defaults";

const JSON_BODY = ["application/json"] as const;
const PUT_PATH = `${VERSIONS}/:versionId/scoring-defaults`;
const ADMIN_READ = "/api/v1/admin/scoring-defaults";
const TRANSFORMATION_READ = "/api/v1/transformations/:transformationId/scoring-defaults";
const transformationParams = z.strictObject({ transformationId: z.uuid() });

const CANONICAL = new Map<string, number>(SCORING_DEFAULT_CRITERIA.map((c, i) => [c, i]));
const canonicalIndex = (code: string): number => CANONICAL.get(code) ?? SCORING_DEFAULT_CRITERIA.length;

type ElementRow = NonNullable<Awaited<ReturnType<typeof loadElementRow>>>;
type Actor = { userId: string; organizationId: string };

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};

/** Canonical JSON for "did this attribute object change" (key order independent). */
function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
              .map(([k, x]) => [k, norm(x)]),
          )
        : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

// ------------------------------------------------------------------------------------------------ presenter

/** The order of a version's scoring rows: ordinal, then the T06 criterion order. */
function byElementOrder(
  a: { stable_key: string; ordinal: number | null },
  b: { stable_key: string; ordinal: number | null },
): number {
  return (
    (a.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.ordinal ?? Number.MAX_SAFE_INTEGER) ||
    canonicalIndex(a.stable_key) - canonicalIndex(b.stable_key)
  );
}

/** One scoring_defaults version as the contract's ScoringDefaults (decimal weights and total; null descriptors kept). */
export async function toScoringDefaults(db: DbOrTx, v: MethodologyVersionRow): Promise<ScoringDefaults> {
  const [rows, newest] = await Promise.all([
    db
      .selectFrom("methodology_element")
      .select(["element_type", "stable_key", "ordinal", "attributes"])
      .where("methodology_version_id", "=", v.id)
      .where("element_type", "in", ["scoring_weight", "scoring_rubric"])
      .where("removed", "=", false)
      .execute(),
    db
      .selectFrom("methodology_version")
      .select(sql<number | null>`max(version_no)`.as("max_no"))
      .where("config_kind", "=", KIND)
      .where("key", "=", v.key)
      .where("status", "=", "published")
      .executeTakeFirst(),
  ]);
  const sorted = [...rows].sort(byElementOrder);
  const weights: ScoringDefaults["weights"] = [];
  const rubrics: ScoringDefaults["rubrics"] = [];
  let total = new Decimal(0);
  for (const r of sorted) {
    const a = asRecord(r.attributes);
    if (r.element_type === "scoring_weight") {
      const w = String(a["weightPercent"]);
      total = total.plus(new Decimal(w));
      weights.push({
        criterionCode: r.stable_key as ScoringDefaults["weights"][number]["criterionCode"],
        weightPercent: w,
      });
    } else {
      const levels = Array.isArray(a["levels"]) ? (a["levels"] as unknown[]) : [];
      rubrics.push({
        criterionCode: r.stable_key as ScoringDefaults["rubrics"][number]["criterionCode"],
        levels: levels.map((l) => {
          const x = asRecord(l);
          return {
            score: Number(x["score"]),
            descriptorEn: typeof x["descriptorEn"] === "string" ? x["descriptorEn"] : null,
            descriptorAr: typeof x["descriptorAr"] === "string" ? x["descriptorAr"] : null,
          };
        }),
      });
    }
  }
  const maxNo = newest?.max_no === null || newest?.max_no === undefined ? null : Number(newest.max_no);
  return {
    versionId: v.id,
    versionNo: v.version_no,
    status: v.status as ScoringDefaults["status"],
    isNewestPublished: v.status === "published" && maxNo === v.version_no,
    weights,
    weightTotal: total.toFixed(2),
    rubrics,
    version: v.version,
  };
}

/** A version of the scoring_defaults kind, else 404 (another kind's version is not a scoring-defaults resource). */
async function loadScoringVersion(db: DbOrTx, versionId: string, forUpdate = false): Promise<MethodologyVersionRow> {
  const v = await loadVersion(db, versionId, forUpdate);
  if (v.config_kind !== KIND) throw problems.notFound();
  return v;
}

/** The newest published version of `scoring-defaults` (version 1 is seeded by 0062, so one always exists). */
async function newestPublished(db: DbOrTx): Promise<MethodologyVersionRow> {
  const v = await db
    .selectFrom("methodology_version")
    .selectAll()
    .where("config_kind", "=", KIND)
    .where("key", "=", SCORING_DEFAULTS_KEY)
    .where("status", "=", "published")
    .orderBy("version_no", "desc")
    .limit(1)
    .executeTakeFirst();
  if (v === undefined) throw problems.notFound();
  return v;
}

// ------------------------------------------------------------------------------------------------ the draft write

interface RowWrite {
  readonly type: ConfigElementType;
  readonly stableKey: string;
  readonly existing: ElementRow | undefined;
  /** null = remove (removed = true). */
  readonly attributes: Record<string, unknown> | null;
  readonly ordinal: number | null;
}

/** The element rows a put changes (rows that would not change are left out). */
async function plannedWrites(tx: Tx, current: MethodologyVersionRow, body: ScoringDefaultsPut): Promise<RowWrite[]> {
  const out: RowWrite[] = [];
  const weightBy = new Map(body.weights.map((w) => [w.criterionCode, w.weightPercent]));
  const rubricBy = new Map(body.rubrics.map((r) => [r.criterionCode, r.levels]));
  for (const code of SCORING_DEFAULT_CRITERIA) {
    // Weights: the body is the full set.
    const w = await loadElementRow(tx, current.id, "scoring_weight", code);
    const wanted = weightBy.get(code);
    if (wanted !== undefined) {
      const attributes = { ...asRecord(w?.attributes), weightPercent: new Decimal(wanted).toFixed(2) };
      const ordinal = w?.ordinal ?? canonicalIndex(code) + 1;
      const prepared = await prepareElementPut(tx, current, "scoring_weight", code, { attributes, ordinal });
      if (w === undefined || w.removed || w.ordinal !== ordinal || !sameJson(w.attributes, prepared.attributes))
        out.push({ type: "scoring_weight", stableKey: code, existing: w, attributes: prepared.attributes, ordinal });
    } else if (w !== undefined && !w.removed) {
      out.push({ type: "scoring_weight", stableKey: code, existing: w, attributes: null, ordinal: w.ordinal });
    }
    // Rubrics: a listed rubric's levels are replaced; an unlisted one is unchanged.
    const levels = rubricBy.get(code);
    if (levels !== undefined) {
      const r = await loadElementRow(tx, current.id, "scoring_rubric", code);
      const attributes = { ...asRecord(r?.attributes), levels: levels.map((l) => ({ ...l })) };
      const ordinal = r?.ordinal ?? canonicalIndex(code) + 1;
      const prepared = await prepareElementPut(tx, current, "scoring_rubric", code, { attributes, ordinal });
      if (r === undefined || r.removed || r.ordinal !== ordinal || !sameJson(r.attributes, prepared.attributes))
        out.push({ type: "scoring_rubric", stableKey: code, existing: r, attributes: prepared.attributes, ordinal });
    }
  }
  return out;
}

async function writeRow(tx: Tx, request: FastifyRequest, current: MethodologyVersionRow, actor: Actor, w: RowWrite) {
  const audit = auditContextOf(request);
  const e = w.existing;
  if (w.attributes === null) {
    // Removal of a criterion's default weight from the draft (recorded; the row stays, removed = true).
    const row = e!;
    const updated = await tx
      .updateTable("methodology_element")
      .set({
        removed: true,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: actor.userId,
      })
      .where("id", "=", row.id)
      .where("version", "=", row.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, audit, {
      action: "methodology_element.remove",
      recordType: "methodology_element",
      recordId: row.id,
      organizationId: actor.organizationId,
      priorVersion: row.version,
      newVersion: updated.version,
      changes: { removed: { from: false, to: true } },
    });
    return;
  }
  if (e === undefined) {
    const id = uuidv7();
    await tx
      .insertInto("methodology_element")
      .values({
        id,
        methodology_version_id: current.id,
        element_type: w.type,
        stable_key: w.stableKey,
        origin: "source",
        removed: false,
        ordinal: w.ordinal,
        attributes: JSON.stringify(w.attributes),
        created_by: actor.userId,
        updated_by: actor.userId,
      })
      .execute();
    await record(tx, audit, {
      action: "methodology_element.put",
      recordType: "methodology_element",
      recordId: id,
      organizationId: actor.organizationId,
      newVersion: 1,
      changes: {
        element_type: { from: null, to: w.type },
        stable_key: { from: null, to: w.stableKey },
        origin: { from: null, to: "source" },
        attributes: { from: null, to: w.attributes },
        ordinal: { from: null, to: w.ordinal },
      },
    });
    return;
  }
  const updated = await tx
    .updateTable("methodology_element")
    .set({
      attributes: JSON.stringify(w.attributes),
      ordinal: w.ordinal,
      removed: false,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", e.id)
    .where("version", "=", e.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "methodology_element.put",
    recordType: "methodology_element",
    recordId: e.id,
    organizationId: actor.organizationId,
    priorVersion: e.version,
    newVersion: updated.version,
    changes: {
      attributes: { from: e.attributes, to: w.attributes },
      ...(e.ordinal !== w.ordinal ? { ordinal: { from: e.ordinal, to: w.ordinal } } : {}),
      ...(e.removed ? { removed: { from: true, to: false } } : {}),
    },
  });
}

async function putScoringDefaults(tx: Tx, request: FastifyRequest, versionId: string): Promise<MethodologyVersionRow> {
  const actor = await requireStudioWrite(tx, request, "methodology.configure");
  const body = parseBody(scoringDefaultsPut, request.body);
  const expected = requireIfMatch(request);
  const probe = await loadScoringVersion(tx, versionId);
  await lockConfigDraft(tx, probe.config_kind, probe.key);
  const current = await loadScoringVersion(tx, versionId, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  assertContentEditable(current);
  const before = await toScoringDefaults(tx, current);
  const writes = await plannedWrites(tx, current, body);
  if (writes.length === 0) return current; // nothing changes: nothing is written
  for (const w of writes) await writeRow(tx, request, current, actor, w);
  const hash = await recomputeContentSha256(tx, current.id);
  const updated = await tx
    .updateTable("methodology_version")
    .set({
      content_sha256: hash,
      // A content change in preview returns the draft to editing (ADR-0039 §1; the 0062 guard requires it).
      draft_stage: "editing",
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const after = await toScoringDefaults(tx, updated);
  await record(tx, auditContextOf(request), {
    action: "methodology_version.scoring_defaults_put",
    recordType: "methodology_version",
    recordId: current.id,
    organizationId: actor.organizationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      content_sha256: { from: current.content_sha256, to: hash },
      ...(current.draft_stage !== "editing" ? { draft_stage: { from: current.draft_stage, to: "editing" } } : {}),
      ...(sameJson(before.weights, after.weights) ? {} : { weights: { from: before.weights, to: after.weights } }),
      ...(sameJson(before.rubrics, after.rubrics) ? {} : { rubrics: { from: before.rubrics, to: after.rubrics } }),
    },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

export function registerScoringDefaultsRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  // The scoring_defaults kind's provider hooks (p5-work-split §A.1 "registered by ... KBE-A").
  registerScoringDefaultsKindProvider();

  app.put(
    PUT_PATH,
    { config: { access: { permission: "methodology.configure" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { versionId } = parse(versionParams, request.params, "params");
      const row = await db.transaction().execute((tx) => putScoringDefaults(tx, request, versionId));
      return sendVersioned(reply, 200, await toScoringDefaults(db, row));
    },
  );

  app.get(ADMIN_READ, { config: { access: { permission: "methodology.read" } } }, async (request) => {
    const query = parseQuery(scoringDefaultsQuery, request.query);
    requireStudioPermission(principalOf(request), "methodology.read");
    const v = query.versionId === undefined ? await newestPublished(db) : await loadScoringVersion(db, query.versionId);
    return toScoringDefaults(db, v);
  });

  app.get(TRANSFORMATION_READ, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const pinned = await resolvePinnedVersion(db, transformationId, KIND);
    if (pinned === null) throw problems.notFound();
    return toScoringDefaults(db, await loadVersion(db, pinned.versionId));
  });

  return [`PUT ${PUT_PATH}`, `GET ${ADMIN_READ}`, `GET ${TRANSFORMATION_READ}`];
}
