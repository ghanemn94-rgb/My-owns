// The `executive_dashboard` assembler (ADR-0045 §1, §3, §5, §12; B0094 Template 10 Executive Transformation Dashboard;
// ADR-0037; REQ-S13-004, REQ-S13-008; p5-work-split §F.4; T-DG5-KBE-D2).
//
// One dashboard per transformation and reporting period (the period is required, RS07; 422 report.period_required
// without one). It is the DG4 read model, not a new calculation: the same engine, filters and order as
// GET …/transformations/{t}/dashboard?periodId= (dashboards/transformation.ts: resolveFilters, loadDashboardContext,
// computeAreas, presentAreas), so the report shows exactly what the screen shows. Sections:
//  - `overview`: the business date and time zone of the read model and the RAG policy source;
//  - per Template 10 area, in the seeded area order, `area_<code>` (metrics): the area's RAG and every headline (the
//    executive pack's mapping, executive-pack.ts `ragValue` / `headlineFields`: counts, money per currency and headline
//    basis, never summed across bases or currencies);
//  - per area, `items_<code>` (table): the area's items with their record type, code, label, RAG, due date, owner and
//    value. A value is placed in the column of its unit kind and value basis (`value_<basis>_<kind>`), so no column
//    mixes units or bases (D-117, D-119, D-122; ADR-0037 N5); the other cells of that column are n/a.
// Labels (ADR-0045 §5): a KPI actual shown by the read model is an accepted actual (rule 4: validated) unless Stale; a
// benefit's validated value is Finance-validated (rule 1); an initiative's planned value is a plan figure (n/a); a
// headline follows executive-pack.ts `headlineState`. Unknown and Stale - a RAG, a headline or an item value - carry
// no number and no colour code: never 0 and never green (shared rule 5). No table carries a report total.
// Lineage (T-DG5-KBE-D4, D-165): the snapshot records the `kpi_version` and calculation versions of every KPI value it
// shows and cites the KPI definitions and actuals as sources (`kpiLineage`), so a KPI restatement offers its reissue.
// Snapshot approval state: not_applicable (ADR-0045 §3). Nothing here approves anything; product gates G1-G6 are
// business approvals inside the product, and nothing here touches the engineering gates DG0-DG7.
import {
  emptyReportParameters,
  KPI_UNIT_KINDS,
  type DashboardItem,
  type DashboardValue,
  type ReportColumn,
  type ReportRow,
  type ReportSection,
  type ReportUnitKind,
  type ReportValue,
  type ReportValueBasis,
} from "@mth/shared/schemas";
import type { KpiStatusFact } from "../../dashboards/areas.ts";
import {
  computeAreas,
  loadAreaDefinitions,
  loadDashboardContext,
  presentAreas,
  type DashboardFacts,
} from "../../dashboards/engine.ts";
import { resolveFilters } from "../../dashboards/filters.ts";
import {
  codeValue,
  dateValue,
  decimalValue,
  textValue,
  userNames,
  type Assembler,
  type AssembledOutput,
  type AssemblyContext,
  type SourceRecord,
  type VersionRef,
} from "../assembler.ts";
import { reportRefusals } from "../definitions.ts";
import {
  NOT_APPLICABLE,
  STALE,
  UNKNOWN_MISSING,
  UNKNOWN_NOT_COMPUTABLE,
  VALIDATED,
  type ValueState,
} from "../provisional.ts";
import { headlineFields, ragValue } from "./executive-pack.ts";

const L = (k: string) => `report.executive_dashboard.${k}`;

/** The value basis of an item's value by its record type (D-117, D-119, D-122), or null when it shows none. */
export function itemValueBasis(recordType: string): ReportValueBasis | null {
  switch (recordType) {
    case "outcome_kpi":
    case "adoption_metric_link":
      return "actual";
    case "benefit":
      return "validated";
    case "initiative":
      return "planned";
    default:
      return null;
  }
}

/** The unit kind of a dashboard value: money, the KPI's own kind, the computed ratio, else `other`. */
export function dashboardUnitKind(v: DashboardValue): ReportUnitKind {
  if (v.unit === "currency") return "currency";
  if (v.kpiUnit !== null) return v.kpiUnit.kind;
  if (v.unit === "ratio") return "ratio";
  return "other";
}

/**
 * The ADR-0045 §5 label of an item value: Unknown and Stale first (no number); a known KPI actual is an accepted one
 * (rule 4: validated); a validated benefit value is validated (rule 1); a planned value is a plan figure (rule 6).
 */
export function itemValueState(v: DashboardValue, recordType: string): ValueState {
  if (v.state === "stale") return STALE;
  if (v.state === "unknown") return v.reasonKey !== null ? UNKNOWN_NOT_COMPUTABLE : UNKNOWN_MISSING;
  if (v.state === "not_applicable") return NOT_APPLICABLE;
  return itemValueBasis(recordType) === "planned" ? NOT_APPLICABLE : VALIDATED;
}

/** The report value of an item's dashboard value (never 0 in place of Unknown or Stale). */
export function itemReportValue(v: DashboardValue, recordType: string): ReportValue {
  return decimalValue(v.state === "value" || v.state === "zero" ? v.value : null, {
    unitKind: dashboardUnitKind(v),
    currency: v.currency,
    valueBasis: itemValueBasis(recordType),
    state: itemValueState(v, recordType),
  });
}

interface ValueColumn {
  readonly key: string;
  readonly basis: ReportValueBasis | null;
  readonly unitKind: ReportUnitKind;
}

/** The value columns of an area's items: one per (basis, unit kind) present, in KPI_UNIT_KINDS order. */
export function valueColumns(items: readonly DashboardItem[]): ValueColumn[] {
  const present = new Map<string, ValueColumn>();
  for (const i of items) {
    if (i.value === null) continue;
    const basis = itemValueBasis(i.recordType);
    const unitKind = dashboardUnitKind(i.value);
    const key = `value_${basis ?? "none"}_${unitKind}`;
    if (!present.has(key)) present.set(key, { key, basis, unitKind });
  }
  const rank = (c: ValueColumn) => KPI_UNIT_KINDS.indexOf(c.unitKind);
  return [...present.values()].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
}

/** One item as a table row: descriptive cells, then one cell per value column (n/a outside its own column). */
export function itemRow(
  i: DashboardItem,
  columns: readonly ValueColumn[],
  names: ReadonlyMap<string, string>,
  recordVersion: number,
): ReportRow {
  const own = i.value === null ? null : `value_${itemValueBasis(i.recordType) ?? "none"}_${dashboardUnitKind(i.value)}`;
  return {
    recordType: i.recordType,
    recordId: i.recordId,
    recordVersion,
    cells: [
      codeValue(i.recordType, "report.record_type"),
      textValue(i.code, "system", i.code === null ? NOT_APPLICABLE : undefined),
      textValue(i.label, "user", i.label === null ? NOT_APPLICABLE : undefined),
      i.rag === null ? codeValue(null, "report.rag_status", NOT_APPLICABLE) : ragValue(i.rag),
      dateValue(i.dueDate, i.dueDate === null ? NOT_APPLICABLE : undefined),
      i.ownerUserId === null
        ? textValue(null, "system", NOT_APPLICABLE)
        : textValue(names.get(i.ownerUserId) ?? null, "system"),
      ...columns.map((c) =>
        own === c.key && i.value !== null
          ? itemReportValue(i.value, i.recordType)
          : decimalValue(null, { unitKind: c.unitKind, valueBasis: c.basis, state: NOT_APPLICABLE }),
      ),
    ],
  };
}

/** The stored table of each item record type (executive_decision items are T16 `decision` rows). */
const ITEM_TABLES = {
  outcome: "outcome",
  outcome_kpi: "outcome_kpi",
  benefit: "benefit",
  initiative: "initiative",
  dependency: "dependency",
  executive_decision: "decision",
  adoption_metric_link: "adoption_metric_link",
} as const;

interface ItemRecord {
  readonly version: number;
  readonly updatedAt: Date | string | null;
}

/** The row version (and update time) at the as-of instant of every item record, by `<recordType>:<id>`. */
async function itemRecords(
  db: AssemblyContext["db"],
  items: readonly DashboardItem[],
): Promise<Map<string, ItemRecord>> {
  const out = new Map<string, ItemRecord>();
  for (const [recordType, table] of Object.entries(ITEM_TABLES)) {
    const ids = [...new Set(items.filter((i) => i.recordType === recordType).map((i) => i.recordId))];
    if (ids.length === 0) continue;
    const rows = await db.selectFrom(table).select(["id", "version", "updated_at"]).where("id", "in", ids).execute();
    for (const r of rows) out.set(`${recordType}:${r.id}`, { version: r.version, updatedAt: r.updated_at });
  }
  return out;
}

/**
 * T-DG5-KBE-D4 (D-165; QA-B P-1; REQ-S13-007 "source record revisions … calculation versions", REQ-S07-016 "offer
 * report reissue"): the KPI status behind a dashboard item that shows a KPI (an outcome KPI or an adoption indicator),
 * by `<recordType>:<recordId>`; other items show no KPI.
 */
export function kpiStatusesByItem(facts: Pick<DashboardFacts, "outcomes" | "indicators">): Map<string, KpiStatusFact> {
  const out = new Map<string, KpiStatusFact>();
  for (const o of facts.outcomes) for (const k of o.kpis) out.set(`outcome_kpi:${k.outcomeKpiId}`, k.status);
  for (const i of facts.indicators) out.set(`adoption_metric_link:${i.metricLinkId}`, i.status);
  return out;
}

/** Pure: a version row per distinct reference, keyed uniquely (report_snapshot_version_key): `key`, then `key:label`. */
export function uniqueVersions(refs: readonly VersionRef[]): VersionRef[] {
  const out: VersionRef[] = [];
  const keys = new Set<string>();
  const seen = new Set<string>();
  for (const r of refs) {
    const id = `${r.versionKind}|${r.referenceId ?? ""}|${r.referenceKey}|${r.versionLabel}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const key = keys.has(`${r.versionKind}|${r.referenceKey}`) ? `${r.referenceKey}:${r.versionLabel}` : r.referenceKey;
    keys.add(`${r.versionKind}|${key}`);
    out.push({ ...r, referenceKey: key });
  }
  return out;
}

/**
 * The KPI lineage of the values the dashboard shows (D-165): for each KPI status with an evaluation, the evaluation's
 * `kpi_version` (the calculation version its value, target and RAG were computed with, as the KPI register records it)
 * and its calculation run's rule and engine versions (`calculation_engine`); and as sources, the KPI definition and
 * the period's actual (validated once accepted, ADR-0045 §5 rule 4). A KPI without an evaluation (Unknown) still cites
 * its definition. Read only.
 */
async function kpiLineage(
  db: AssemblyContext["db"],
  shown: readonly { readonly sectionKey: string; readonly status: KpiStatusFact }[],
): Promise<{ versions: VersionRef[]; sources: SourceRecord[] }> {
  const evaluationIds = [
    ...new Set(shown.flatMap((x) => (x.status.evaluationId === null ? [] : [x.status.evaluationId]))),
  ];
  const evaluations =
    evaluationIds.length === 0
      ? []
      : await db
          .selectFrom("kpi_evaluation as e")
          .innerJoin("kpi_version as v", "v.id", "e.kpi_version_id")
          .innerJoin("calculation_run as r", "r.id", "e.calculation_run_id")
          .select([
            "e.id",
            "e.kpi_definition_id",
            "e.kpi_version_id",
            "e.scope_kind",
            "e.scope_id",
            "e.reporting_period_id",
            "v.version_no",
            "r.kpi_rules_version",
            "r.formula_engine_version",
          ])
          .where("e.id", "in", evaluationIds)
          .orderBy("e.id")
          .execute();
  const definitionIds = [...new Set(shown.map((x) => x.status.kpiDefinitionId))];
  const definitions =
    definitionIds.length === 0
      ? []
      : await db
          .selectFrom("kpi_definition")
          .select(["id", "version", "updated_at"])
          .where("id", "in", definitionIds)
          .execute();
  const actuals = [];
  for (const e of evaluations) {
    const a = await db
      .selectFrom("kpi_actual")
      .select(["id", "version", "updated_at", "accepted_value_no"])
      .where("kpi_definition_id", "=", e.kpi_definition_id)
      .where("scope_kind", "=", e.scope_kind)
      .where("scope_id", "=", e.scope_id)
      .where("reporting_period_id", "=", e.reporting_period_id)
      .executeTakeFirst();
    if (a !== undefined) actuals.push({ ...a, evaluationId: e.id });
  }

  const versions: VersionRef[] = [];
  for (const e of [...evaluations].sort((a, b) => a.kpi_definition_id.localeCompare(b.kpi_definition_id)))
    versions.push({
      versionKind: "kpi_version",
      referenceId: e.kpi_version_id,
      referenceKey: `kpi_definition:${e.kpi_definition_id}`,
      versionLabel: `v${e.version_no}`,
    });
  for (const e of evaluations) {
    versions.push({
      versionKind: "calculation_engine",
      referenceId: null,
      referenceKey: "kpi_rules",
      versionLabel: e.kpi_rules_version,
    });
    versions.push({
      versionKind: "calculation_engine",
      referenceId: null,
      referenceKey: "formula_engine",
      versionLabel: e.formula_engine_version,
    });
  }

  const sources: SourceRecord[] = [];
  const sectionOf = new Map<string, string>();
  for (const x of shown)
    if (!sectionOf.has(x.status.kpiDefinitionId)) sectionOf.set(x.status.kpiDefinitionId, x.sectionKey);
  const sectionOfEvaluation = new Map<string, string>();
  for (const x of shown)
    if (x.status.evaluationId !== null && !sectionOfEvaluation.has(x.status.evaluationId))
      sectionOfEvaluation.set(x.status.evaluationId, x.sectionKey);
  for (const d of definitions)
    sources.push({
      sectionKey: sectionOf.get(d.id)!,
      recordType: "kpi_definition",
      recordId: d.id,
      recordVersion: d.version,
      recordUpdatedAt: d.updated_at,
      approvalState: null,
      validationState: "not_applicable",
    });
  for (const a of actuals)
    sources.push({
      sectionKey: sectionOfEvaluation.get(a.evaluationId)!,
      recordType: "kpi_actual",
      recordId: a.id,
      recordVersion: a.version,
      recordUpdatedAt: a.updated_at,
      approvalState: null,
      validationState: a.accepted_value_no === null ? "provisional" : "validated",
    });
  return { versions: uniqueVersions(versions), sources };
}

const ITEM_COLUMNS: ReportColumn[] = ["record_type", "code", "label", "rag", "due_date", "owner"].map((key) => ({
  key,
  labelKey: L(key),
  valueKind: key === "record_type" || key === "rag" ? "code" : key === "due_date" ? "date" : "text",
  unitKind: null,
}));

async function assemble(ctx: AssemblyContext): Promise<AssembledOutput> {
  // definitions.ts / snapshots.ts already require the period (RS07); a missing one here is the same refusal.
  if (ctx.period === null) throw reportRefusals.periodRequired();
  const { db } = ctx;
  const t = await db
    .selectFrom("transformation")
    .select(["id", "organization_id", "code", "name", "status", "current_phase", "currency", "version", "updated_at"])
    .where("id", "=", ctx.transformation.id)
    .executeTakeFirstOrThrow();
  const filters = await resolveFilters(db, {
    organizationId: t.organization_id,
    transformationIds: [t.id],
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
  const areas = presentAreas(dctx, computeAreas(dctx.facts, dctx.clock, dctx.policy), await loadAreaDefinitions(db), {
    drillTransformationIds: [t.id],
    workstream: false,
  });
  const allItems = areas.flatMap((a) => a.items);
  const names = await userNames(
    db,
    allItems.map((i) => i.ownerUserId),
  );
  const records = await itemRecords(db, allItems);

  const tRef = { recordType: "transformation", recordId: t.id, recordVersion: t.version };
  const sources: SourceRecord[] = [
    {
      sectionKey: "overview",
      recordType: "transformation",
      recordId: t.id,
      recordVersion: t.version,
      recordUpdatedAt: t.updated_at,
      approvalState: null,
      validationState: "not_applicable",
    },
  ];
  const sections: ReportSection[] = [
    {
      key: "overview",
      titleKey: L("overview"),
      kind: "fields",
      sources: [tRef],
      fields: [
        { key: "business_date", labelKey: L("business_date"), value: dateValue(filters.businessDate) },
        { key: "timezone", labelKey: L("timezone"), value: textValue(filters.timezone, "system") },
        {
          key: "policy_source",
          labelKey: L("policy_source"),
          value: codeValue(dctx.policy.source, L("policy_source")),
        },
      ],
    },
  ];
  const seen = new Set<string>(["transformation:" + t.id]);
  for (const a of areas) {
    sections.push({
      key: `area_${a.code}`,
      titleKey: `report.t10_area.${a.code}`,
      kind: "metrics",
      sources: [tRef],
      fields: [{ key: "rag", labelKey: L("rag"), value: ragValue(a.rag.status) }, ...headlineFields(a.headlines)],
    });
    // Each item is a stored record: it is a source row with its version at the as-of instant (one row per record).
    const columns = valueColumns(a.items);
    const rows = a.items.map((i) =>
      itemRow(i, columns, names, records.get(`${i.recordType}:${i.recordId}`)?.version ?? 1),
    );
    const sectionKey = `items_${a.code}`;
    for (const i of a.items) {
      const k = `${i.recordType}:${i.recordId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const r = records.get(k);
      sources.push({
        sectionKey,
        recordType: i.recordType,
        recordId: i.recordId,
        recordVersion: r?.version ?? 1,
        recordUpdatedAt: r?.updatedAt ?? null,
        approvalState: null,
        validationState: "not_applicable",
      });
    }
    sections.push({
      key: sectionKey,
      titleKey: L("items"),
      kind: "table",
      sources: rows.map((r) => ({ recordType: r.recordType, recordId: r.recordId, recordVersion: r.recordVersion })),
      columns: [
        ...ITEM_COLUMNS,
        ...columns.map((c) => ({
          key: c.key,
          labelKey: L(c.key),
          valueKind: "decimal" as const,
          unitKind: c.unitKind,
        })),
      ],
      rows,
      totals: [],
      emptyKey: "report.empty.no_records",
    });
  }

  // D-165: the KPI definitions, actuals and calculation versions behind the KPI values shown (one source row per record).
  const statusOf = kpiStatusesByItem(dctx.facts);
  const shown = areas.flatMap((a) =>
    a.items.flatMap((i) => {
      const status = statusOf.get(`${i.recordType}:${i.recordId}`);
      return status === undefined ? [] : [{ sectionKey: `items_${a.code}`, status }];
    }),
  );
  const lineage = await kpiLineage(db, shown);
  for (const src of lineage.sources) {
    const k = `${src.recordType}:${src.recordId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    sources.push(src);
  }

  return {
    subject: { code: ctx.transformation.code, label: ctx.transformation.name },
    approvalState: "not_applicable",
    sections,
    sources,
    versions: lineage.versions,
    evidence: [],
  };
}

export const executiveDashboardAssembler: Assembler = {
  code: "executive_dashboard",
  parseParameters(raw) {
    const r = emptyReportParameters.safeParse(raw ?? {});
    if (!r.success) throw reportRefusals.parametersInvalid();
    return r.data;
  },
  assemble,
};
