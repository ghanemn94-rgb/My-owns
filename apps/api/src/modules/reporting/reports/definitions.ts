// Report definitions and the slice F report refusals (ADR-0045 §1, §11; REQ-S13-004; p5-work-split §F.1; T-DG5-KBE-C).
//
// `report_definition` is the read-only catalogue seeded by 0080: the ten M0253 outputs, the executive pack (M0185) and
// the meeting pack (M0212). Rows come from migrations only (mth_app has SELECT). Every refusal below carries the exact
// ADR-0045 §11 English text (p5-work-split §2 rule 15); its `code` is the i18n key the web translates.
import type { DbOrTx, ReportDefinitionRow } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import type { ReportDefinition, ReportDefinitionCode } from "@mth/shared/schemas";
import { HttpProblem, problems } from "../../platform/index.ts";

/** The ADR-0045 §11 report and report-snapshot refusals with their exact English texts. */
export const reportRefusals = {
  subjectInvalid: () =>
    problems.businessRule(
      "report.subject_invalid",
      "The subject must be a record of this transformation of the type this output reports on.",
    ),
  periodRequired: () => problems.businessRule("report.period_required", "This output needs a reporting period."),
  periodNotAllowed: () => problems.businessRule("report.period_not_allowed", "This output takes no reporting period."),
  parametersInvalid: () =>
    problems.businessRule("report.parameters_invalid", "The report settings are not valid for this output."),
  tooLarge: () =>
    problems.businessRule(
      "report.too_large",
      "The selection is too large for one report (more than 5,000 rows in a table); narrow the filters.",
    ),
  notGenerated: () =>
    problems.businessRule("report_snapshot.not_generated", "Only a generated snapshot can be issued or discarded."),
  notIssued: () =>
    problems.businessRule("report_snapshot.not_issued", "Only the current issued snapshot can be reissued."),
  seriesChanged: (currentVersion?: number) =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.versionConflict,
      code: "report_snapshot.series_changed",
      title: "Version conflict",
      detail: "This report was issued or reissued meanwhile; reload it.",
      ...(currentVersion === undefined ? {} : { currentVersion }),
    }),
} as const;

export function toReportDefinition(r: ReportDefinitionRow): ReportDefinition {
  return {
    code: r.code as ReportDefinitionCode,
    ordinal: r.ordinal,
    outputKind: r.output_kind as ReportDefinition["outputKind"],
    subjectType: r.subject_type as ReportDefinition["subjectType"],
    needsReportingPeriod: r.needs_reporting_period,
    formats: r.formats as ReportDefinition["formats"],
    labelEn: r.label_en,
    labelAr: r.label_ar,
    descriptionEn: r.description_en,
    descriptionAr: r.description_ar,
    sourceRef: r.source_ref,
    playbookRef: r.playbook_ref,
  };
}

/** The twelve definitions in catalogue order. */
export async function listReportDefinitions(db: DbOrTx): Promise<ReportDefinition[]> {
  const rows = await db.selectFrom("report_definition").selectAll().orderBy("ordinal").execute();
  return rows.map(toReportDefinition);
}

/** One definition by code (the code is already a validated enum member; a missing row is a 404). */
export async function loadReportDefinition(db: DbOrTx, code: ReportDefinitionCode): Promise<ReportDefinitionRow> {
  const row = await db.selectFrom("report_definition").selectAll().where("code", "=", code).executeTakeFirst();
  if (row === undefined) throw problems.notFound();
  return row;
}
