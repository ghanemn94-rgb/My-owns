// The `registers` assembler (ADR-0045 §1, §3, §5, §12; B0122 Benefits Register, B0127 RAID, B0129 Executive Decision
// Log; REQ-S13-004, REQ-S13-008; T-DG5-KBE-C).
//
// One register per output, chosen by the parameters (`registersReportParameters` in @mth/shared/schemas): raid,
// benefits, kpis, decisions, dependencies or actions, with the filters of that register's DG2-DG4 list route. The rows
// are exactly those the list route returns for the same filters at the as-of instant, without pagination: each query
// below reads the same table or view with the same filter predicates and the same order as the route it names. The
// list routes keep their query schemas and presenters module-private (and `workflows` is outside reporting's module
// boundary), so the predicates are restated here; registers-report.test.ts compares every register, row by row,
// with its list route, so a drift fails a test. More than 5,000 rows: 422 report.too_large, nothing written.
//
// Values (ADR-0045 §5): benefit amounts carry their value basis and Finance state (pending = `submitted` is
// provisional, rule 1; the baseline copy is provisional unless validated, rule 3); missing amounts are Unknown and an
// unmonetised non-financial benefit's money value is n/a, never 0. Every other cell is a record field (rule 6). The
// three realized states are separate columns and are never added together (D-117, D-119, D-122); no total is shown,
// because the list screens show none. KPI definitions record their active `kpi_version` as a calculation version.
import type { DbOrTx, Tx } from "@mth/db";
import {
  MONEY_COLUMN,
  registersReportParameters,
  REPORT_MAX_TABLE_ROWS,
  sumDecimals,
  toColumnString,
  type RegistersReportParameters,
  type ReportColumn,
  type ReportRow,
  type ReportSection,
  type ReportValue,
} from "@mth/shared/schemas";
import { sql } from "kysely";
import {
  citedEvidence,
  codeValue,
  combinedApprovalState,
  countValue,
  dateValue,
  decimalValue,
  textValue,
  userNames,
  type Assembler,
  type AssemblyContext,
  type AssembledOutput,
  type EvidenceRef,
  type SourceRecord,
  type VersionRef,
} from "../assembler.ts";
import { reportRefusals } from "../definitions.ts";
import {
  benefitAmountState,
  benefitBaselineState,
  NOT_APPLICABLE,
  PROVISIONAL,
  type ValueState,
} from "../provisional.ts";

const SECTION = "register";
const L = (register: string, k: string) => `report.registers.${register}.${k}`;
const col = (
  register: string,
  key: string,
  valueKind: ReportColumn["valueKind"],
  unitKind: ReportColumn["unitKind"] = null,
): ReportColumn => ({ key, labelKey: L(register, key), valueKind, unitKind });

interface RegisterRows {
  readonly columns: ReportColumn[];
  readonly rows: ReportRow[];
  readonly sources: SourceRecord[];
  readonly versions: VersionRef[];
  readonly evidence: EvidenceRef[];
}

/** Refuses more than 5,000 rows before anything is written (the query fetches one more to know). */
function bounded<T>(rows: T[]): T[] {
  if (rows.length > REPORT_MAX_TABLE_ROWS) throw reportRefusals.tooLarge();
  return rows;
}

const source = (
  recordType: string,
  recordId: string,
  recordVersion: number,
  recordUpdatedAt: Date | string | null,
  validationState: SourceRecord["validationState"] = "not_applicable",
): SourceRecord => ({
  sectionKey: SECTION,
  recordType,
  recordId,
  recordVersion,
  recordUpdatedAt,
  approvalState: null,
  validationState,
});

const owner = (names: Map<string, string>, id: string | null): ReportValue =>
  id === null ? textValue(null) : textValue(names.get(id) ?? null, "system");

// ------------------------------------------------------------------------------------------------ RAID (T15)

/** GET /transformations/{id}/raid (raid/register.ts): the `raid_register` view, filters type/status/owner, by id. */
async function raidRows(db: Tx, t: string, f: Extract<RegistersReportParameters, { register: "raid" }>["filters"]) {
  let q = db.selectFrom("raid_register").selectAll().where("transformation_id", "=", t);
  if (f.type !== undefined) q = q.where("entry_type", "=", f.type);
  if (f.status !== undefined) q = q.where("raid_status", "=", f.status);
  if (f.ownerUserId !== undefined) q = q.where("owner_user_id", "=", f.ownerUserId);
  const rows = bounded(
    await q
      .orderBy("id")
      .limit(REPORT_MAX_TABLE_ROWS + 1)
      .execute(),
  );
  const names = await userNames(
    db,
    rows.map((r) => r.owner_user_id),
  );
  const R = "raid";
  return {
    columns: [
      col(R, "code", "text"),
      col(R, "type", "code"),
      col(R, "description", "text"),
      col(R, "impact", "code"),
      col(R, "probability", "code"),
      col(R, "owner", "text"),
      col(R, "due_date", "date"),
      col(R, "mitigation", "text"),
      col(R, "status", "code"),
    ],
    rows: rows.map((r) => ({
      recordType: r.record_table!,
      recordId: r.id!,
      recordVersion: r.version!,
      cells: [
        textValue(r.code),
        codeValue(r.entry_type, "report.raid_type"),
        textValue(r.description),
        codeValue(r.impact, "report.raid_level"),
        // Probability does not apply to an Issue, Assumption or Dependency (DG4 rule): n/a, not Unknown.
        r.probability === null && r.entry_type !== "risk"
          ? codeValue(null, null, NOT_APPLICABLE)
          : codeValue(r.probability, "report.raid_level"),
        owner(names, r.owner_user_id),
        dateValue(r.due_date),
        textValue(r.mitigation),
        codeValue(r.raid_status, "report.raid_status"),
      ],
    })),
    sources: rows.map((r) => source(r.record_table!, r.id!, r.version!, r.updated_at)),
    versions: [],
    evidence: [],
  } satisfies RegisterRows;
}

// ------------------------------------------------------------------------------------------------ Benefits (T14)

/**
 * The Finance states of a benefit's value lines (the `benefit_value_line` view; benefits/register.ts `realizationFor`):
 * validated, sustained and pending (`submitted`) amounts summed SEPARATELY with decimal arithmetic, each with its count.
 */
async function valueLines(db: DbOrTx, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return db
    .selectFrom("benefit_value_line")
    .select(["benefit_id", "value_state", "amount"])
    .where("benefit_id", "in", [...ids])
    .where("value_state", "in", ["validated", "sustained", "submitted"])
    .execute();
}

/**
 * GET /transformations/{id}/benefits (benefits/register.ts): `benefit`, status (default active) and lifecycle step,
 * by id. Value (SAR) and the three realized states as the T14 register computes them (`valueSarOf`, `stateAmount`).
 */
async function benefitRows(
  db: Tx,
  t: string,
  f: Extract<RegistersReportParameters, { register: "benefits" }>["filters"],
) {
  let q = db.selectFrom("benefit").selectAll().where("transformation_id", "=", t);
  q = q.where("status", "=", f.status ?? "active");
  if (f.lifecycleStep !== undefined) q = q.where("lifecycle_step", "=", f.lifecycleStep);
  const rows = bounded(
    await q
      .orderBy("id")
      .limit(REPORT_MAX_TABLE_ROWS + 1)
      .execute(),
  );
  const ids = rows.map((r) => r.id);
  const lines = await valueLines(db, ids);
  const counting =
    ids.length === 0
      ? []
      : await db
          .selectFrom("benefit_counting")
          .select(["benefit_id", "counted", "exclusion_reason"])
          .where("benefit_id", "in", ids)
          .execute();
  const names = await userNames(
    db,
    rows.map((r) => r.owner_user_id),
  );
  const B = "benefits";
  const out: ReportRow[] = [];
  const sources: SourceRecord[] = [];
  for (const r of rows) {
    const currency = r.currency.trim();
    const unmonetised = r.value_class === "non_financial" && r.valuation_method_id === null;
    const mine = lines.filter((l) => l.benefit_id === r.id);
    /** One Finance state's amount: n/a unmonetised; Unknown when a line has no amount; the sum otherwise. */
    const amount = (state: "validated" | "sustained" | "submitted", basis: "validated" | "sustained" | "submitted") => {
      const amounts = mine.filter((l) => l.value_state === state).map((l) => l.amount);
      if (unmonetised) return decimalValue(null, { unitKind: "currency", valueBasis: basis, state: NOT_APPLICABLE });
      if (amounts.some((a) => a === null))
        return decimalValue(null, {
          unitKind: "currency",
          currency,
          valueBasis: basis,
          state: benefitAmountState("unknown", state),
        });
      // No line in this state: nothing is pending or realized (a known 0.0000 with no validation of its own).
      const st: ValueState = amounts.length === 0 ? NOT_APPLICABLE : benefitAmountState("known", state);
      return decimalValue(toColumnString(sumDecimals(amounts as string[]), MONEY_COLUMN), {
        unitKind: "currency",
        currency,
        valueBasis: basis,
        state: st,
      });
    };
    const pendingCount = mine.filter((l) => l.value_state === "submitted").length;
    const planned = unmonetised
      ? decimalValue(null, { unitKind: "currency", valueBasis: "planned", state: NOT_APPLICABLE })
      : decimalValue(r.planned_value === null ? null : toColumnString(r.planned_value, MONEY_COLUMN), {
          unitKind: "currency",
          currency,
          valueBasis: "planned",
        });
    const baselineState = benefitBaselineState(r.baseline_validation_status);
    const c = counting.find((x) => x.benefit_id === r.id);
    const countedCode = c === undefined ? null : c.counted ? "counted" : (c.exclusion_reason ?? "not_counted");
    out.push({
      recordType: "benefit",
      recordId: r.id,
      recordVersion: r.version,
      cells: [
        textValue(r.code),
        textValue(r.title),
        codeValue(r.benefit_type, "report.benefit_type"),
        codeValue(r.value_class, "report.benefit_value_class"),
        // The baseline is a measure in its own unit (free-text `baseline_unit`): unit kind `other`.
        decimalValue(r.baseline_value, { unitKind: "other", valueBasis: "baseline", state: baselineState }),
        textValue(r.baseline_unit),
        decimalValue(r.target_value, { unitKind: "other", valueBasis: "target" }),
        planned,
        amount("validated", "validated"),
        amount("sustained", "sustained"),
        amount("submitted", "submitted"),
        countValue(pendingCount, pendingCount > 0 ? PROVISIONAL : NOT_APPLICABLE),
        owner(names, r.owner_user_id),
        codeValue(r.status_rag ?? "unknown", "report.rag"),
        codeValue(r.lifecycle_step, "report.benefit_step"),
        codeValue(countedCode, "report.benefit_counting"),
      ],
    });
    const pendingOrUnvalidated = pendingCount > 0 || (r.baseline_value !== null && baselineState === PROVISIONAL);
    sources.push(
      source("benefit", r.id, r.version, r.updated_at, pendingOrUnvalidated ? "provisional" : "not_applicable"),
    );
  }
  const evidence = await benefitEvidence(db, t, ids);
  return {
    columns: [
      col(B, "code", "text"),
      col(B, "title", "text"),
      col(B, "benefit_type", "code"),
      col(B, "value_class", "code"),
      col(B, "baseline", "decimal", "other"),
      col(B, "baseline_unit", "text"),
      col(B, "target", "decimal", "other"),
      col(B, "planned_value", "decimal", "currency"),
      col(B, "realized_validated", "decimal", "currency"),
      col(B, "realized_sustained", "decimal", "currency"),
      col(B, "pending", "decimal", "currency"),
      col(B, "pending_count", "count"),
      col(B, "owner", "text"),
      col(B, "status", "code"),
      col(B, "lifecycle_step", "code"),
      col(B, "counting", "code"),
    ],
    rows: out,
    sources,
    versions: [],
    evidence,
  } satisfies RegisterRows;
}

/** The evidence linked to the listed benefits (ADR-0029 `benefit_evidence`), with its current revision. */
async function benefitEvidence(db: Tx, t: string, ids: readonly string[]): Promise<EvidenceRef[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .selectFrom("benefit_evidence as l")
    .innerJoin("evidence as e", "e.id", "l.evidence_id")
    .leftJoin("evidence_content as c", "c.id", "e.current_content_id")
    .select(["e.id as evidenceId", "c.id as contentId", "c.revision", "c.sha256", "e.review_status as reviewStatus"])
    .where("e.transformation_id", "=", t)
    .where("l.benefit_id", "in", [...ids])
    .where("e.status", "=", "active")
    .orderBy("e.id")
    .execute();
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const r of rows) {
    if (seen.has(r.evidenceId)) continue;
    seen.add(r.evidenceId);
    out.push({
      sectionKey: SECTION,
      evidenceId: r.evidenceId,
      contentId: r.contentId,
      contentRevision: r.revision,
      contentSha256: r.sha256 === null ? null : r.sha256.trim(),
      reviewStatus: r.reviewStatus as EvidenceRef["reviewStatus"],
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ KPIs

/**
 * GET /transformations/{id}/kpi-definitions (kpi/support.ts `listPage`): `kpi_definition`, archived excluded unless
 * asked, newest change first (updated_at DESC, id DESC). The active version's number and target are shown, and each
 * active version is recorded as a `kpi_version` calculation version (ADR-0045 §3).
 */
async function kpiRows(db: Tx, t: string, f: Extract<RegistersReportParameters, { register: "kpis" }>["filters"]) {
  let q = db.selectFrom("kpi_definition").selectAll().where("transformation_id", "=", t);
  if (!(f.includeArchived ?? false)) q = q.where("status", "<>", "archived");
  const rows = bounded(
    await q
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .limit(REPORT_MAX_TABLE_ROWS + 1)
      .execute(),
  );
  const ids = rows.map((r) => r.id);
  const active =
    ids.length === 0
      ? []
      : await db
          .selectFrom("kpi_version")
          .select(["id", "kpi_definition_id", "version_no", "target_value", "currency", "unit_kind"])
          .where("kpi_definition_id", "in", ids)
          .where("status", "=", "active")
          .execute();
  const names = await userNames(
    db,
    rows.map((r) => r.owner_user_id),
  );
  const K = "kpis";
  return {
    columns: [
      col(K, "name", "text"),
      col(K, "unit_kind", "code"),
      col(K, "polarity", "code"),
      col(K, "frequency", "code"),
      col(K, "owner", "text"),
      col(K, "status", "code"),
      col(K, "active_version", "count"),
      col(K, "target", "text"),
    ],
    rows: rows.map((r) => {
      const v = active.find((a) => a.kpi_definition_id === r.id);
      // Targets of different KPIs have different units, so the target is shown as the decimal text of its own KPI
      // (one column never mixes units as numbers); its unit kind is the column next to it.
      return {
        recordType: "kpi_definition",
        recordId: r.id,
        recordVersion: r.version,
        cells: [
          textValue(r.name),
          codeValue(r.unit_kind, "report.kpi_unit_kind"),
          codeValue(r.polarity, "report.kpi_polarity"),
          codeValue(r.frequency, "report.kpi_frequency"),
          owner(names, r.owner_user_id),
          codeValue(r.status, "report.kpi_status"),
          countValue(v?.version_no ?? null),
          textValue(v?.target_value ?? null, "system", v === undefined ? undefined : NOT_APPLICABLE),
        ],
      };
    }),
    sources: rows.map((r) => source("kpi_definition", r.id, r.version, r.updated_at)),
    versions: active.map((v) => ({
      versionKind: "kpi_version" as const,
      referenceId: v.id,
      referenceKey: `kpi_definition:${v.kpi_definition_id}`,
      versionLabel: `v${v.version_no}`,
    })),
    evidence: [],
  } satisfies RegisterRows;
}

// ------------------------------------------------------------------------------------------------ Decisions

/** GET /decisions?transformationId= (workflows/decisions.ts): `decision`, filters kind/status/TOM dimension, by id. */
async function decisionRows(
  db: Tx,
  t: string,
  f: Extract<RegistersReportParameters, { register: "decisions" }>["filters"],
) {
  let q = db.selectFrom("decision").selectAll().where("transformation_id", "=", t);
  if (f.kind) q = q.where("kind", "=", f.kind);
  if (f.status) q = q.where("status", "=", f.status);
  if (f.tomDimensionCode) q = q.where("tom_dimension_code", "=", f.tomDimensionCode);
  const rows = bounded(
    await q
      .orderBy("id")
      .limit(REPORT_MAX_TABLE_ROWS + 1)
      .execute(),
  );
  const names = await userNames(
    db,
    rows.map((r) => r.owner_user_id),
  );
  const D = "decisions";
  return {
    columns: [
      col(D, "code", "text"),
      col(D, "title", "text"),
      col(D, "kind", "code"),
      col(D, "owner", "text"),
      col(D, "due_date", "date"),
      col(D, "status", "code"),
      col(D, "outcome", "text"),
      col(D, "decided_at", "timestamp"),
    ],
    rows: rows.map((r) => ({
      recordType: "decision",
      recordId: r.id,
      recordVersion: r.version,
      cells: [
        textValue(r.code),
        textValue(r.title),
        codeValue(r.kind, "report.decision_kind"),
        owner(names, r.owner_user_id),
        dateValue(r.due_date),
        codeValue(r.status, "report.decision_status"),
        // Not decided yet: the outcome and its time do not apply (n/a), they are not missing.
        r.status === "open" ? textValue(null, "user", NOT_APPLICABLE) : textValue(r.outcome_text),
        r.decided_at === null && r.status === "open" ? dateTimeNa() : timestampOf(r.decided_at),
      ],
    })),
    sources: rows.map((r) => source("decision", r.id, r.version, r.updated_at)),
    versions: [],
    evidence: await citedEvidence(
      db,
      t,
      "decision",
      rows.map((r) => r.id),
      SECTION,
    ),
  } satisfies RegisterRows;
}

const dateTimeNa = (): ReportValue => ({ type: "timestamp", value: null, validation: "not_applicable", reason: null });
const timestampOf = (v: Date | null): ReportValue =>
  v === null
    ? { type: "timestamp", value: null, validation: "unknown", reason: "missing" }
    : { type: "timestamp", value: v.toISOString(), validation: "not_applicable", reason: null };

// ------------------------------------------------------------------------------------------------ Dependencies (T08)

/**
 * GET /dependencies?transformationId= (workflows/t08-dependencies.ts): `dependency`, initiative on either end,
 * archived excluded unless asked, newest change first (updated_at DESC, id DESC).
 */
async function dependencyRows(
  db: Tx,
  t: string,
  f: Extract<RegistersReportParameters, { register: "dependencies" }>["filters"],
) {
  let q = db.selectFrom("dependency").selectAll().where("transformation_id", "=", t);
  if (f.initiativeId !== undefined) {
    const ini = f.initiativeId;
    q = q.where((eb) => eb.or([eb("from_initiative_id", "=", ini), eb("to_initiative_id", "=", ini)]));
  }
  if (!(f.includeArchived ?? false)) q = q.where("status", "<>", "archived");
  const rows = bounded(
    await q
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .limit(REPORT_MAX_TABLE_ROWS + 1)
      .execute(),
  );
  const names = await userNames(
    db,
    rows.map((r) => r.owner_user_id),
  );
  const P = "dependencies";
  return {
    columns: [
      col(P, "code", "text"),
      col(P, "description", "text"),
      col(P, "from", "text"),
      col(P, "to", "text"),
      col(P, "dependency_type", "code"),
      col(P, "needed_by", "date"),
      col(P, "owner", "text"),
      col(P, "impact", "code"),
      col(P, "status", "code"),
    ],
    rows: rows.map((r) => ({
      recordType: "dependency",
      recordId: r.id,
      recordVersion: r.version,
      cells: [
        textValue(r.code),
        textValue(r.description),
        textValue(r.from_label ?? r.from_kind),
        textValue(r.to_label ?? r.to_kind),
        codeValue(r.dependency_type, "report.dependency_type"),
        dateValue(r.needed_by),
        owner(names, r.owner_user_id),
        codeValue(r.impact, "report.raid_level"),
        codeValue(r.status, "report.dependency_status"),
      ],
    })),
    sources: rows.map((r) => source("dependency", r.id, r.version, r.updated_at)),
    versions: [],
    evidence: await citedEvidence(
      db,
      t,
      "dependency",
      rows.map((r) => r.id),
      SECTION,
    ),
  } satisfies RegisterRows;
}

// ------------------------------------------------------------------------------------------------ Actions

const OPEN_ACTION = ["open", "in_progress"];

/**
 * GET /transformations/{id}/action-register (raid/actions.ts): `action_item`, filters source kind, owner, status and
 * overdue (due before today's business date while open or in progress), by id. Today is the as-of business date.
 */
async function actionRows(
  db: Tx,
  t: string,
  f: Extract<RegistersReportParameters, { register: "actions" }>["filters"],
  today: string,
) {
  let q = db.selectFrom("action_item").selectAll().where("transformation_id", "=", t);
  switch (f.sourceKind) {
    case "workshop":
      q = q.where("source_workshop_item_id", "is not", null);
      break;
    case "raid_entry":
      q = q.where("raid_entry_id", "is not", null);
      break;
    case "dependency":
      q = q.where("dependency_id", "is not", null);
      break;
    case "corrective_case":
      q = q.where("corrective_case_id", "is not", null);
      break;
    case "none":
      q = q
        .where("source_workshop_item_id", "is", null)
        .where("raid_entry_id", "is", null)
        .where("dependency_id", "is", null)
        .where("corrective_case_id", "is", null);
      break;
    default:
      break;
  }
  if (f.ownerUserId !== undefined) q = q.where("owner_user_id", "=", f.ownerUserId);
  if (f.status !== undefined) q = q.where("status", "=", f.status);
  if (f.overdue !== undefined) {
    const overdue = sql<boolean>`(due_date IS NOT NULL AND due_date < ${today}::date AND status IN ('open', 'in_progress'))`;
    q = q.where(f.overdue ? overdue : sql<boolean>`NOT ${overdue}`);
  }
  const rows = bounded(
    await q
      .orderBy("id")
      .limit(REPORT_MAX_TABLE_ROWS + 1)
      .execute(),
  );
  const names = await userNames(
    db,
    rows.map((r) => r.owner_user_id),
  );
  const A = "actions";
  const sourceKind = (r: (typeof rows)[number]) =>
    r.source_workshop_item_id !== null
      ? "workshop"
      : r.raid_entry_id !== null
        ? "raid_entry"
        : r.dependency_id !== null
          ? "dependency"
          : r.corrective_case_id !== null
            ? "corrective_case"
            : "none";
  return {
    columns: [
      col(A, "title", "text"),
      col(A, "source_kind", "code"),
      col(A, "owner", "text"),
      col(A, "due_date", "date"),
      col(A, "status", "code"),
      col(A, "overdue", "code"),
    ],
    rows: rows.map((r) => {
      const due = r.due_date === null ? null : String(r.due_date).slice(0, 10);
      const overdue = due !== null && due < today && OPEN_ACTION.includes(r.status);
      return {
        recordType: "action_item",
        recordId: r.id,
        recordVersion: r.version,
        cells: [
          textValue(r.title),
          codeValue(sourceKind(r), "report.action_source"),
          owner(names, r.owner_user_id),
          dateValue(r.due_date),
          codeValue(r.status, "report.action_status"),
          codeValue(overdue ? "yes" : "no", "report.yes_no"),
        ],
      };
    }),
    sources: rows.map((r) => source("action_item", r.id, r.version, r.updated_at)),
    versions: [],
    evidence: await citedEvidence(
      db,
      t,
      "action_item",
      rows.map((r) => r.id),
      SECTION,
    ),
  } satisfies RegisterRows;
}

// ------------------------------------------------------------------------------------------------ assembler

async function rowsOf(ctx: AssemblyContext, p: RegistersReportParameters): Promise<RegisterRows> {
  const { db } = ctx;
  const t = ctx.transformation.id;
  switch (p.register) {
    case "raid":
      return raidRows(db, t, p.filters);
    case "benefits":
      return benefitRows(db, t, p.filters);
    case "kpis":
      return kpiRows(db, t, p.filters);
    case "decisions":
      return decisionRows(db, t, p.filters);
    case "dependencies":
      return dependencyRows(db, t, p.filters);
    case "actions":
      return actionRows(db, t, p.filters, ctx.asOfDate);
  }
}

async function assemble(ctx: AssemblyContext): Promise<AssembledOutput> {
  const p = ctx.parameters as RegistersReportParameters;
  const r = await rowsOf(ctx, p);
  const section: ReportSection = {
    key: SECTION,
    titleKey: `report.registers.${p.register}.title`,
    kind: "table",
    sources: r.rows.map((x) => ({ recordType: x.recordType, recordId: x.recordId, recordVersion: x.recordVersion })),
    columns: r.columns,
    rows: r.rows,
    totals: [],
    emptyKey: "report.empty.no_records",
  };
  const filters: ReportSection = {
    key: "filters",
    titleKey: "report.registers.filters",
    kind: "list",
    sources: [],
    items: Object.entries(p.filters)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => ({ record: null, value: textValue(`${k}=${String(v)}`, "system") })),
    emptyKey: "report.registers.no_filters",
  };
  return {
    subject: { code: ctx.transformation.code, label: ctx.transformation.name },
    approvalState: combinedApprovalState(r.sources.map((s) => s.approvalState)),
    sections: [filters, section],
    sources: r.sources,
    versions: r.versions,
    evidence: r.evidence,
  };
}

export const registersAssembler: Assembler = {
  code: "registers",
  parseParameters(raw) {
    const r = registersReportParameters.safeParse(raw ?? {});
    if (!r.success) throw reportRefusals.parametersInvalid();
    return r.data;
  },
  assemble,
};
