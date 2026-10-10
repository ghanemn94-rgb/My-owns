// The subjects a change request can name (T-DG4-FE-F2; ADR-0036 §2; BE-L `loadSubject`). For each subject type this
// reads the records of the transformation with their record version and their current values under the names the
// server compares a `from` against (the server refuses any other `from` with 422 proposed_change_invalid). Which records
// count as "approved" is decided by the server (422 change_request.subject_not_approved), never guessed here.
// SYNTHETIC data only in tests and demos.
import { useQuery } from "@tanstack/react-query";
import type {
  BenefitFormula,
  BudgetLine,
  ChangeKind,
  CharterViewBody,
  ChangeSubjectType,
  KpiDictionaryEntry,
  KpiVersion,
} from "@mth/shared/schemas";
import { KIND_SUBJECTS, KPI_VERSION_CHANGE_FIELDS } from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { p4Keys } from "../../api/p4.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";
import type { Initiative, Milestone, OutcomeKpi } from "../../api/types.ts";

/** A record the request can be raised on, with what the form needs to build `proposedChange`. */
export interface SubjectOption {
  readonly id: string;
  readonly label: string;
  /** The subject's record version (`subjectVersion`; the server's stale check). */
  readonly version: number;
  /** Current values, by the server's field names; null = Unknown. */
  readonly values: Readonly<Record<string, string | null>>;
  /** KPI subjects: the draft version that the request proposes (null when there is none). */
  readonly kpiDraftVersionId?: string | null;
  /** Benefit formulas: the current version (the one a benefit_logic request names). */
  readonly formulaCurrent?: { readonly id: string; readonly versionNo: number } | null;
}

export type FieldType = "text" | "decimal" | "date";

/** The `{from, to}` fields a person edits for a kind on a subject (KPI and formula kinds are derived, not typed). */
export function editableFields(
  kind: ChangeKind,
  subject: ChangeSubjectType,
): readonly { field: string; type: FieldType }[] {
  switch (kind) {
    case "business_scope":
      return subject === "charter"
        ? [
            { field: "scopeIn", type: "text" },
            { field: "scopeOut", type: "text" },
          ]
        : [
            { field: "name", type: "text" },
            { field: "objective", type: "text" },
            { field: "scopeIn", type: "text" },
            { field: "scopeOut", type: "text" },
          ];
    case "baseline":
      return subject === "outcome_kpi" ? [{ field: "baselineValue", type: "decimal" }] : [];
    case "target":
      return subject === "outcome_kpi"
        ? [
            { field: "targetValue", type: "decimal" },
            { field: "targetDate", type: "date" },
          ]
        : [];
    case "tom":
      return [{ field: "targetDesign", type: "text" }];
    case "cost":
    case "budget_rebaseline":
      return [{ field: "budgetAmount", type: "decimal" }];
    case "schedule_rebaseline":
      return [{ field: "approvedDate", type: "date" }];
    case "kpi_definition":
    case "benefit_logic":
      return [];
  }
}

/** The kinds that apply to a subject type (the 0052 CHECK `change_request_kind_subject`). */
export function kindsFor(subject: ChangeSubjectType): ChangeKind[] {
  return [...KIND_SUBJECTS.entries()].filter(([, subjects]) => subjects.includes(subject)).map(([k]) => k);
}

/** Subjects named per initiative (the form asks for the initiative first). */
export const PER_INITIATIVE: ReadonlySet<ChangeSubjectType> = new Set(["milestone", "budget_line"]);

/** A decimal string without insignificant zeros ("10.50" -> "10.5", "-0" -> "0"); used only to compare. */
export function normalizeDecimal(s: string): string {
  const m = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(s.trim());
  if (!m) return s;
  const int = m[2]!.replace(/^0+(?=\d)/, "");
  const frac = (m[3] ?? "").replace(/0+$/, "");
  const body = frac ? `${int}.${frac}` : int;
  return body === "0" ? "0" : `${m[1]}${body}`;
}

const sameText = (a: unknown, b: unknown) => {
  const s = (x: unknown) => (x === null || x === undefined ? null : String(x));
  const x = s(a);
  const y = s(b);
  if (x === null || y === null) return x === y;
  return normalizeDecimal(x) === normalizeDecimal(y);
};

/**
 * The `{field: {from, to}}` difference between a KPI's active version and its draft (ADR-0036 §2: "the changed version
 * fields"). Only fields both versions carry are compared; an empty result means the draft changes none of them.
 */
export function kpiVersionDiff(active: KpiVersion, draft: KpiVersion): Record<string, { from: unknown; to: unknown }> {
  const a = active as unknown as Record<string, unknown>;
  const d = draft as unknown as Record<string, unknown>;
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of KPI_VERSION_CHANGE_FIELDS) {
    if (!(f in a) || !(f in d)) continue;
    if (!sameText(a[f], d[f])) out[f] = { from: a[f] ?? null, to: d[f] ?? null };
  }
  return out;
}

const opts = { retry: shouldRetry, staleTime: 10_000 } as const;
const tBase = (tid: string) => `/api/v1/transformations/${tid}`;
const key = (tid: string, ...rest: string[]) => p4Keys.area("change-requests", tid, "subjects", ...rest);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * The records of one subject type (and, for milestones and budget lines, of one initiative). Only the chosen type is
 * read, so opening the form costs one request per choice.
 */
export function useSubjectOptions(
  tid: string,
  subjectType: ChangeSubjectType | "",
  initiativeId: string,
): { options: SubjectOption[]; loading: boolean; error: unknown } {
  const on = (t: ChangeSubjectType) => subjectType === t && Boolean(tid);
  const charter = useQuery({
    queryKey: key(tid, "charter"),
    queryFn: () => api.get<CharterViewBody>(`${tBase(tid)}/charter`),
    enabled: on("charter"),
    ...opts,
  });
  const kpis = useQuery({
    queryKey: key(tid, "kpis"),
    queryFn: () => fetchAllPages<KpiDictionaryEntry>(`${tBase(tid)}/kpi-dictionary`),
    enabled: on("kpi_definition"),
    ...opts,
  });
  const outcomeKpis = useQuery({
    queryKey: key(tid, "outcome-kpis"),
    queryFn: () => fetchAllPages<OutcomeKpi>(`${tBase(tid)}/outcome-kpis`),
    enabled: on("outcome_kpi"),
    ...opts,
  });
  const canvas = useQuery({
    queryKey: key(tid, "tom-canvas"),
    queryFn: () =>
      api.get<{
        cells: {
          cell: { id: string; version: number; targetDesign: string | null };
          dimension: { sourceNameEn: string; nameAr?: string };
        }[];
      }>(`${tBase(tid)}/tom-canvas`),
    enabled: on("tom_canvas_cell"),
    ...opts,
  });
  const initiatives = useQuery({
    queryKey: key(tid, "initiatives"),
    queryFn: () => fetchAllPages<Initiative>("/api/v1/initiatives", { transformationId: tid }),
    enabled: on("initiative"),
    ...opts,
  });
  const formulas = useQuery({
    queryKey: key(tid, "formulas"),
    queryFn: () => fetchAllPages<BenefitFormula>("/api/v1/benefit-formulas", { transformationId: tid }),
    enabled: on("benefit_formula"),
    ...opts,
  });
  const milestones = useQuery({
    queryKey: key(tid, "milestones", initiativeId),
    queryFn: async () =>
      (await api.get<{ items: Milestone[] }>(`/api/v1/initiatives/${initiativeId}/milestones`)).items,
    enabled: on("milestone") && Boolean(initiativeId),
    ...opts,
  });
  const budgetLines = useQuery({
    queryKey: key(tid, "budget-lines", initiativeId),
    queryFn: () => fetchAllPages<BudgetLine>(`/api/v1/initiatives/${initiativeId}/budget-lines`),
    enabled: on("budget_line") && Boolean(initiativeId),
    ...opts,
  });

  const pickQuery = () => {
    switch (subjectType) {
      case "charter":
        return charter;
      case "kpi_definition":
        return kpis;
      case "outcome_kpi":
        return outcomeKpis;
      case "tom_canvas_cell":
        return canvas;
      case "initiative":
        return initiatives;
      case "benefit_formula":
        return formulas;
      case "milestone":
        return milestones;
      case "budget_line":
        return budgetLines;
      default:
        return null;
    }
  };
  const q = pickQuery();
  const loading = q !== null && q.isLoading && q.fetchStatus !== "idle";
  let options: SubjectOption[] = [];
  switch (subjectType) {
    case "charter": {
      const c = charter.data?.charter;
      options = c
        ? [{ id: c.id, label: "Charter", version: c.version, values: { scopeIn: c.inScope, scopeOut: c.outOfScope } }]
        : [];
      break;
    }
    case "kpi_definition":
      options = (kpis.data ?? [])
        .filter((e) => e.activeVersion !== null)
        .map((e) => ({
          id: e.definition.id,
          label: `${e.definition.name} (v${e.activeVersion!.versionNo})`,
          version: e.definition.version,
          values: {},
          kpiDraftVersionId: e.draftVersionId,
        }));
      break;
    case "outcome_kpi":
      options = (outcomeKpis.data ?? []).map((o) => ({
        id: o.id,
        label: `#${o.ordinal}`,
        version: o.version,
        values: { baselineValue: o.baselineValue, targetValue: o.targetValue, targetDate: o.targetDate },
      }));
      break;
    case "tom_canvas_cell":
      options = (canvas.data?.cells ?? []).map((c) => ({
        id: c.cell.id,
        label: c.dimension.sourceNameEn,
        version: c.cell.version,
        values: { targetDesign: c.cell.targetDesign },
      }));
      break;
    case "initiative":
      options = (initiatives.data ?? []).map((i) => ({
        id: i.id,
        label: `${i.code} ${i.name}`,
        version: i.version,
        values: { name: i.name, objective: i.objective, scopeIn: i.scopeIn, scopeOut: i.scopeOut },
      }));
      break;
    case "benefit_formula":
      options = (formulas.data ?? []).map((f) => ({
        id: f.id,
        label: `${f.code} ${f.benefitName}`,
        version: f.version,
        values: { currentVersionNo: str(f.currentVersionNo) },
        formulaCurrent:
          f.currentVersion && f.currentVersionNo !== null
            ? { id: f.currentVersion.id, versionNo: f.currentVersionNo }
            : null,
      }));
      break;
    case "milestone":
      options = (milestones.data ?? []).map((m) => ({
        id: m.id,
        label: m.title,
        version: m.version,
        values: { approvedDate: m.approvedDate, forecastDate: m.forecastDate },
      }));
      break;
    case "budget_line":
      options = (budgetLines.data ?? []).map((b) => ({
        id: b.id,
        label: b.label,
        version: b.version,
        values: { budgetAmount: b.budgetAmount, currency: b.currency },
      }));
      break;
    default:
      options = [];
  }
  return { options, loading, error: q?.error ?? null };
}

/** The versions of one KPI (to find the active and the draft version a KPI request compares). */
export function useKpiVersionPair(tid: string, kpiId: string, enabled: boolean) {
  return useQuery({
    queryKey: key(tid, "kpi-versions", kpiId),
    queryFn: () => fetchAllPages<KpiVersion>(`${tBase(tid)}/kpi-definitions/${kpiId}/versions`),
    enabled: Boolean(tid && kpiId && enabled),
    ...opts,
  });
}
