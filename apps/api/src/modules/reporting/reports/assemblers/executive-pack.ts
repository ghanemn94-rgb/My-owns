// The `executive_pack` assembler (ADR-0045 §1, §3, §5, §6; M0185; B0093 "Executive SteerCo | Monthly | … | Decisions,
// unblockers, benefit view"; REQ-S09-011; p5-work-split §F.3; T-DG5-KBE-D).
//
// One pack per transformation and reporting period (the period is required, RS07). Sections, in order: the
// transformation, then each ACTIVE workstream of the transformation by code. Each subject has two sections:
//  (a) `update_<subject>`: the latest SUBMITTED revision of its structured owner update for THIS period (portfolio's
//      `submittedUpdatesOfPeriod`), the eight M0185 fields verbatim as authored, with the revision number, submitter
//      and time; or the code `no_update_submitted` ("No update submitted" / "لم يُقدَّم تحديث") when there is none —
//      never a blank and never an older period's text. A workstream without a lead shows the owner as `no_owner`.
//  (b) `metrics_<subject>`: its current canonical metrics from the DG4 dashboard read model (ADR-0037; the same
//      engine, filters and narrowing as GET …/dashboard and GET …/workstreams/{w}/dashboard with the period filter):
//      each Template 10 area's RAG status, every headline (KPI-outcome count, benefit value per state, basis and
//      currency, never summed across bases or currencies; initiatives, open dependencies, decisions, adoption), and
//      the open RAID entries per type through the `raid_register` view of the DG4 RAID list route (narrowed to the
//      workstream's initiatives for a workstream).
// Nothing is typed into the pack: REQ-S09-011 "the executive pack's workstream section contains the submitted update
// text and current metrics without manual editing". Labels follow provisional.ts (ADR-0045 §5): planned value is a
// plan figure (n/a), forecast and submitted value are provisional (not Finance-validated), validated value is
// validated; an Unknown or Stale headline or RAG has no number and is never 0 or green.
// Snapshot approval state: not_applicable (ADR-0045 §3). Sources: each owner_update (its row `version`) and the
// revision cited (append-only, version 1), the transformation's active workstreams. Submitting an update and issuing a
// pack approve nothing; product gates G1-G6 are business approvals inside the product (never DG0-DG7).
import type {
  DashboardHeadline,
  DashboardValue,
  RagStatus,
  ReportField,
  ReportRecordRef,
  ReportSection,
} from "@mth/shared/schemas";
import type { OwnerUpdateRevisionRow } from "@mth/db";
import { emptyReportParameters } from "@mth/shared/schemas";
import { loadWorkstreamFacts, submittedUpdatesOfPeriod } from "../../../portfolio/index.ts";
import {
  computeAreas,
  factsOfWorkstream,
  loadAreaDefinitions,
  loadDashboardContext,
  presentAreas,
} from "../../dashboards/engine.ts";
import { resolveFilters } from "../../dashboards/filters.ts";
import {
  codeValue,
  countValue,
  decimalValue,
  textValue,
  timestampValue,
  userNames,
  type Assembler,
  type AssembledOutput,
  type AssemblyContext,
  type SourceRecord,
} from "../assembler.ts";
import { reportRefusals } from "../definitions.ts";
import {
  NOT_APPLICABLE,
  PROVISIONAL,
  STALE,
  UNKNOWN_MISSING,
  UNKNOWN_NOT_COMPUTABLE,
  VALIDATED,
  type ValueState,
} from "../provisional.ts";

const L = (k: string) => `report.executive_pack.${k}`;
/** The eight M0185 fields of a revision as (report key, text), in M0185 order. */
function revisionParts(r: OwnerUpdateRevisionRow): [string, string | null][] {
  return [
    ["achievements", r.achievements],
    ["next_steps", r.next_steps],
    ["milestones", r.milestones],
    ["outcomes", r.outcomes],
    ["adoption", r.adoption],
    ["risks", r.risks],
    ["dependencies", r.dependencies],
    ["asks", r.asks],
  ];
}
const RAID_TYPES = ["risk", "assumption", "issue", "dependency"] as const;

/** A section-key-safe slug of a workstream code (`WS-01` -> `ws_01`). */
export function subjectSlug(code: string): string {
  return (
    code
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "subject"
  );
}

// ------------------------------------------------------------------------------------------------ pure mapping

/** The ADR-0045 §5 label of a dashboard value headline by its metric (rule 1; rule 6 for the others). */
export function headlineState(metric: string): ValueState {
  switch (metric) {
    case "value.validated":
      return VALIDATED;
    case "value.forecast":
    case "value.submitted":
      return PROVISIONAL;
    default:
      return NOT_APPLICABLE;
  }
}

/** The value basis of a value headline (D-117, D-119, D-122), or null for the non-value metrics. */
export function headlineValueBasis(metric: string): "planned" | "forecast" | "submitted" | "validated" | null {
  switch (metric) {
    case "value.planned":
      return "planned";
    case "value.forecast":
      return "forecast";
    case "value.submitted":
      return "submitted";
    case "value.validated":
      return "validated";
    default:
      return null;
  }
}

/**
 * A dashboard value as a report value: a count stays a count; money keeps its currency and value basis; a ratio is a
 * ratio. Unknown and Stale carry no number; not_applicable carries none either. Never 0 in place of Unknown.
 */
export function dashboardReportValue(v: DashboardValue, metric: string) {
  const isMoney = v.unit === "currency";
  const isRatio = v.unit === "ratio";
  const known = v.state === "value" || v.state === "zero";
  if (!known) {
    const state: ValueState =
      v.state === "stale"
        ? STALE
        : v.state === "not_applicable"
          ? NOT_APPLICABLE
          : v.reasonKey !== null
            ? UNKNOWN_NOT_COMPUTABLE
            : UNKNOWN_MISSING;
    if (!isMoney && !isRatio && v.kpiUnit === null) return countValue(null, state);
    return decimalValue(null, {
      unitKind: isMoney ? "currency" : isRatio ? "ratio" : (v.kpiUnit?.kind ?? "other"),
      currency: v.currency,
      valueBasis: headlineValueBasis(metric),
      state,
    });
  }
  if (!isMoney && !isRatio && v.kpiUnit === null && v.value !== null && /^\d+$/.test(v.value))
    return countValue(Number(v.value), NOT_APPLICABLE);
  return decimalValue(v.value, {
    unitKind: isMoney ? "currency" : isRatio ? "ratio" : (v.kpiUnit?.kind ?? "other"),
    currency: v.currency,
    valueBasis: headlineValueBasis(metric),
    state: headlineState(metric),
  });
}

/** An area RAG as a code value: Unknown and Stale carry no code (never green); the others are recorded facts. */
export function ragValue(status: RagStatus) {
  if (status === "unknown") return codeValue(null, "report.rag_status", UNKNOWN_NOT_COMPUTABLE);
  if (status === "stale") return codeValue(null, "report.rag_status", STALE);
  return codeValue(status, "report.rag_status", NOT_APPLICABLE);
}

/** Headline fields with unique keys (metric, basis, currency). */
export function headlineFields(headlines: readonly DashboardHeadline[]): ReportField[] {
  const seen = new Map<string, number>();
  return headlines.map((h) => {
    const base = subjectSlug([h.metric, h.headlineBasis ?? "", h.value.currency ?? ""].filter((x) => x).join("_"));
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const key = n === 1 ? base : `${base}_${n}`;
    return { key, labelKey: h.labelKey, value: dashboardReportValue(h.value, h.metric) };
  });
}

// ------------------------------------------------------------------------------------------------ assembly

interface Subject {
  readonly type: "transformation" | "workstream";
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly version: number;
  readonly updatedAt: Date | string | null;
  readonly leadUserId: string | null;
  readonly slug: string;
}

async function openRaidCounts(ctx: AssemblyContext, initiativeIds: readonly string[] | null) {
  if (initiativeIds !== null && initiativeIds.length === 0) return new Map<string, number>();
  let q = ctx.db
    .selectFrom("raid_register")
    .select(["entry_type"])
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("transformation_id", "=", ctx.transformation.id)
    .where("raid_status", "<>", "closed")
    .groupBy("entry_type");
  if (initiativeIds !== null) q = q.where("initiative_id", "in", [...initiativeIds]);
  const rows = await q.execute();
  return new Map(rows.map((r) => [r.entry_type ?? "", Number(r.n)] as const));
}

async function assemble(ctx: AssemblyContext): Promise<AssembledOutput> {
  // definitions.ts / snapshots.ts already require the period (RS07); a missing one here is a programming error.
  if (ctx.period === null) throw reportRefusals.periodRequired();
  const { db } = ctx;
  const tId = ctx.transformation.id;
  const t = await db
    .selectFrom("transformation")
    .select(["id", "organization_id", "code", "name", "status", "current_phase", "currency", "version", "updated_at"])
    .where("id", "=", tId)
    .executeTakeFirstOrThrow();
  const workstreams = await db
    .selectFrom("workstream")
    .select(["id", "code", "name", "lead_user_id", "version", "updated_at"])
    .where("transformation_id", "=", tId)
    .where("status", "=", "active")
    .orderBy("code")
    .orderBy("id")
    .execute();
  const subjects: Subject[] = [
    {
      type: "transformation",
      id: tId,
      code: t.code,
      name: t.name,
      version: t.version,
      updatedAt: t.updated_at,
      leadUserId: null,
      slug: "transformation",
    },
    ...workstreams.map(
      (w): Subject => ({
        type: "workstream",
        id: w.id,
        code: w.code,
        name: w.name,
        version: w.version,
        updatedAt: w.updated_at,
        leadUserId: w.lead_user_id,
        slug: subjectSlug(w.code),
      }),
    ),
  ];

  const updates = await submittedUpdatesOfPeriod(db, tId, ctx.period.id);
  const names = await userNames(db, [
    ...workstreams.map((w) => w.lead_user_id),
    ...[...updates.values()].map((u) => u.revision.submitted_by),
  ]);

  // The dashboard read model (ADR-0037) with the period filter, computed once for the transformation.
  const filters = await resolveFilters(db, {
    organizationId: t.organization_id,
    transformationIds: [tId],
    periodId: ctx.period.id,
  });
  const scope = {
    id: t.id,
    organizationId: t.organization_id,
    code: t.code,
    name: t.name,
    status: t.status,
    currentPhase: t.current_phase,
    currency: t.currency.trim(),
  };
  const dctx = await loadDashboardContext(db, [scope], filters);
  const defs = await loadAreaDefinitions(db);

  const sections: ReportSection[] = [];
  const sources: SourceRecord[] = [];
  for (const s of subjects) {
    const updateKey = `update_${s.slug}`;
    const metricsKey = `metrics_${s.slug}`;
    const subjectRef = { recordType: s.type, recordId: s.id, recordVersion: s.version };
    // (a) the update.
    const u = updates.get(`${s.type}:${s.id}`);
    const fields: ReportField[] = [
      { key: "subject", labelKey: L("subject"), value: textValue(`${s.code} ${s.name}`, "system") },
    ];
    if (s.type === "workstream")
      fields.push({
        key: "owner",
        labelKey: L("owner"),
        value:
          s.leadUserId === null
            ? codeValue("no_owner", L("owner_state"))
            : textValue(names.get(s.leadUserId) ?? null, "system"),
      });
    const sectionSources: ReportRecordRef[] = [subjectRef];
    if (u === undefined) {
      fields.push({
        key: "update_state",
        labelKey: L("update_state"),
        value: codeValue("no_update_submitted", L("update_state")),
      });
    } else {
      const r = u.revision;
      fields.push(
        { key: "update_state", labelKey: L("update_state"), value: codeValue("submitted", L("update_state")) },
        { key: "revision_no", labelKey: L("revision_no"), value: countValue(r.revision_no) },
        { key: "submitted_at", labelKey: L("submitted_at"), value: timestampValue(r.submitted_at) },
        {
          key: "submitted_by",
          labelKey: L("submitted_by"),
          value: textValue(names.get(r.submitted_by) ?? null, "system"),
        },
        ...revisionParts(r).map(([key, text]) => ({
          key,
          labelKey: L(key),
          // A part the owner left empty is not applicable (no number, never a placeholder text).
          value: text === null ? textValue(null, "user", NOT_APPLICABLE) : textValue(text, "user"),
        })),
      );
      sectionSources.push({ recordType: "owner_update", recordId: u.update.id, recordVersion: u.update.version });
      sources.push(
        {
          sectionKey: updateKey,
          recordType: "owner_update",
          recordId: u.update.id,
          recordVersion: u.update.version,
          recordUpdatedAt: u.update.updated_at,
          approvalState: null,
          validationState: "not_applicable",
        },
        {
          sectionKey: updateKey,
          recordType: "owner_update_revision",
          recordId: r.id,
          // Revision rows are append-only (OU15): their version is always 1.
          recordVersion: 1,
          recordUpdatedAt: r.created_at,
          approvalState: null,
          validationState: "not_applicable",
        },
      );
    }
    sections.push({ key: updateKey, titleKey: L("update"), kind: "fields", sources: sectionSources, fields });
    sources.push({
      sectionKey: updateKey,
      recordType: s.type,
      recordId: s.id,
      recordVersion: s.version,
      recordUpdatedAt: s.updatedAt,
      approvalState: null,
      validationState: "not_applicable",
    });

    // (b) the metrics.
    let initiativeIds: readonly string[] | null = null;
    let narrowed = dctx;
    if (s.type === "workstream") {
      const ws = await loadWorkstreamFacts(db, tId, s.id);
      initiativeIds = ws?.initiativeIds ?? [];
      narrowed = { ...dctx, facts: factsOfWorkstream(dctx.facts, initiativeIds) };
    }
    const areas = presentAreas(narrowed, computeAreas(narrowed.facts, dctx.clock, dctx.policy), defs, {
      drillTransformationIds: [tId],
      workstream: s.type === "workstream",
    });
    const raid = await openRaidCounts(ctx, initiativeIds);
    const metrics: ReportField[] = [
      ...areas.map((a) => ({
        key: `rag_${a.code}`,
        labelKey: `report.t10_area.${a.code}`,
        value: ragValue(a.rag.status),
      })),
      ...headlineFields(areas.flatMap((a) => a.headlines)),
      ...RAID_TYPES.map((type) => ({
        key: `open_raid_${type}`,
        labelKey: L(`open_raid_${type}`),
        value: countValue(raid.get(type) ?? 0),
      })),
    ];
    // The subject record is already a source of its update section (one source row per record, RS-unique).
    sections.push({ key: metricsKey, titleKey: L("metrics"), kind: "metrics", sources: [subjectRef], fields: metrics });
  }

  return {
    subject: { code: ctx.transformation.code, label: ctx.transformation.name },
    approvalState: "not_applicable",
    sections,
    sources,
    versions: [],
    evidence: [],
  };
}

export const executivePackAssembler: Assembler = {
  code: "executive_pack",
  parseParameters(raw) {
    const r = emptyReportParameters.safeParse(raw ?? {});
    if (!r.success) throw reportRefusals.parametersInvalid();
    return r.data;
  },
  assemble,
};
