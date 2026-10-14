// The `roadmap` assembler (ADR-0045 §1, §3, §5; B0078 Roadmap waves, B0080 Roadmap and initiative charters;
// REQ-S13-004; T-DG5-KBE-C2).
//
// Reads what GET /transformations/{id}/roadmap shows (portfolio/roadmap.ts `loadRoadmap`, ADR-0023 §3), without
// pagination, in the same order:
//  - `waves`: every roadmap wave (`loadWaves`: ordinal, id), with its bilingual source name;
//  - `initiatives`: every initiative of the transformation (by code), with its wave, owners, planned dates and status;
//  - `milestones`: every milestone (`loadMilestones`: initiative, forecast date, id), with its approved, forecast and
//    actual dates;
//  - `dependencies`: the initiative-to-initiative dependencies (not archived, both ends initiatives, by code).
// The roadmap read model and its presenters are private to `portfolio` (its index exports none of them), so the queries
// restate its tables, predicates and order (the KBE-C registers precedent); roadmap-report.test.ts compares every
// section with the roadmap route. The schedule flags (portfolio/schedule.ts) are computed there and are not exported;
// the report does not recompute them (ADR-0045 §1: an assembler computes no business value), and lists the records only.
//
// Values: every cell is a record field (ADR-0045 §5 rule 6); a missing date is Unknown (rule 5), never a guessed date.
// A milestone's actual date applies only once it is achieved. Approval state: not_applicable (ADR-0045 §3).
import { emptyReportParameters, type ReportColumn, type ReportSection, type ReportValue } from "@mth/shared/schemas";
import {
  codeValue,
  dateValue,
  textValue,
  userNames,
  type Assembler,
  type AssemblyContext,
  type AssembledOutput,
  type SourceRecord,
} from "../assembler.ts";
import { reportRefusals } from "../definitions.ts";
import { NOT_APPLICABLE } from "../provisional.ts";

const S = {
  waves: "waves",
  initiatives: "initiatives",
  milestones: "milestones",
  dependencies: "dependencies",
} as const;
const L = (k: string) => `report.roadmap.${k}`;
const column = (key: string, valueKind: ReportColumn["valueKind"]): ReportColumn => ({
  key,
  labelKey: L(key),
  valueKind,
  unitKind: null,
});
const day = (v: string | Date | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
const source = (
  sectionKey: string,
  recordType: string,
  r: { id: string; version: number; updated_at: Date | string },
): SourceRecord => ({
  sectionKey,
  recordType,
  recordId: r.id,
  recordVersion: r.version,
  recordUpdatedAt: r.updated_at,
  approvalState: null,
  validationState: "not_applicable",
});

async function assemble(ctx: AssemblyContext): Promise<AssembledOutput> {
  const { db } = ctx;
  const tId = ctx.transformation.id;

  const waves = await db
    .selectFrom("roadmap_wave")
    .selectAll()
    .where("transformation_id", "=", tId)
    .orderBy("ordinal")
    .orderBy("id")
    .execute();
  const initiatives = await db
    .selectFrom("initiative")
    .selectAll()
    .where("transformation_id", "=", tId)
    .orderBy("code")
    .execute();
  const milestones = await db
    .selectFrom("milestone")
    .selectAll()
    .where("transformation_id", "=", tId)
    .orderBy("initiative_id")
    .orderBy("forecast_date")
    .orderBy("id")
    .execute();
  const dependencies = await db
    .selectFrom("dependency")
    .selectAll()
    .where("transformation_id", "=", tId)
    .where("status", "<>", "archived")
    .where("from_initiative_id", "is not", null)
    .where("to_initiative_id", "is not", null)
    .orderBy("code")
    .execute();

  const names = await userNames(db, [
    ...waves.map((r) => r.owner_user_id),
    ...initiatives.flatMap((r) => [r.executive_owner_user_id, r.workstream_lead_user_id]),
    ...milestones.map((r) => r.owner_user_id),
    ...dependencies.map((r) => r.owner_user_id),
  ]);
  const person = (id: string | null): ReportValue =>
    id === null ? textValue(null) : textValue(names.get(id) ?? null, "system");
  const waveCode = new Map(waves.map((w) => [w.id, w.code] as const));
  const initiativeCode = new Map(initiatives.map((i) => [i.id, i.code] as const));
  // A wave or initiative reference: its code; none is n/a for an initiative not yet placed in a wave.
  const waveOf = (id: string | null): ReportValue =>
    id === null ? textValue(null, "system", NOT_APPLICABLE) : textValue(waveCode.get(id) ?? null, "system");
  const ref = (recordType: string) => (r: { id: string; version: number }) => ({
    recordType,
    recordId: r.id,
    recordVersion: r.version,
  });

  const sources: SourceRecord[] = [];
  const sections: ReportSection[] = [];

  sections.push({
    key: S.waves,
    titleKey: L("waves"),
    kind: "table",
    sources: waves.map(ref("roadmap_wave")),
    columns: [
      column("code", "text"),
      column("name_en", "text"),
      column("name_ar", "text"),
      column("purpose_en", "text"),
      column("purpose_ar", "text"),
      column("planned_start", "date"),
      column("planned_end", "date"),
      column("owner", "text"),
      column("status", "code"),
    ],
    rows: waves.map((w) => ({
      ...ref("roadmap_wave")(w),
      cells: [
        textValue(w.code, "system"),
        // The bilingual wave texts are catalogue texts (B0078), stored in both languages.
        textValue(w.name_en, "system"),
        textValue(w.name_ar, "system"),
        textValue(w.purpose_en, "system"),
        textValue(w.purpose_ar, "system"),
        dateValue(day(w.planned_start)),
        dateValue(day(w.planned_end)),
        person(w.owner_user_id),
        codeValue(w.status, "report.wave_status"),
      ],
    })),
    totals: [],
    emptyKey: "report.empty.no_records",
  });
  for (const w of waves) sources.push(source(S.waves, "roadmap_wave", w));

  sections.push({
    key: S.initiatives,
    titleKey: L("initiatives"),
    kind: "table",
    sources: initiatives.map(ref("initiative")),
    columns: [
      column("code", "text"),
      column("name", "text"),
      column("wave", "text"),
      column("executive_owner", "text"),
      column("workstream_lead", "text"),
      column("objective", "text"),
      column("planned_start", "date"),
      column("planned_end", "date"),
      column("status", "code"),
    ],
    rows: initiatives.map((i) => ({
      ...ref("initiative")(i),
      cells: [
        textValue(i.code, "system"),
        textValue(i.name),
        waveOf(i.wave_id),
        person(i.executive_owner_user_id),
        person(i.workstream_lead_user_id),
        textValue(i.objective),
        dateValue(day(i.planned_start)),
        dateValue(day(i.planned_end)),
        codeValue(i.status, "report.initiative_status"),
      ],
    })),
    totals: [],
    emptyKey: "report.empty.no_records",
  });
  for (const i of initiatives) sources.push(source(S.initiatives, "initiative", i));

  sections.push({
    key: S.milestones,
    titleKey: L("milestones"),
    kind: "table",
    sources: milestones.map(ref("milestone")),
    columns: [
      column("initiative", "text"),
      column("title", "text"),
      column("wave", "text"),
      column("approved_date", "date"),
      column("forecast_date", "date"),
      column("actual_date", "date"),
      column("owner", "text"),
      column("status", "code"),
    ],
    rows: milestones.map((m) => ({
      ...ref("milestone")(m),
      cells: [
        textValue(initiativeCode.get(m.initiative_id) ?? null, "system"),
        textValue(m.title),
        waveOf(m.wave_id),
        dateValue(day(m.approved_date)),
        dateValue(day(m.forecast_date)),
        // The actual date exists only once the milestone is achieved: n/a before, Unknown if achieved without one.
        dateValue(day(m.actual_date), m.status === "achieved" ? undefined : NOT_APPLICABLE),
        person(m.owner_user_id),
        codeValue(m.status, "report.milestone_status"),
      ],
    })),
    totals: [],
    emptyKey: "report.empty.no_records",
  });
  for (const m of milestones) sources.push(source(S.milestones, "milestone", m));

  sections.push({
    key: S.dependencies,
    titleKey: L("dependencies"),
    kind: "table",
    sources: dependencies.map(ref("dependency")),
    columns: [
      column("code", "text"),
      column("from_initiative", "text"),
      column("to_initiative", "text"),
      column("type", "code"),
      column("description", "text"),
      column("needed_by", "date"),
      column("owner", "text"),
      column("status", "code"),
    ],
    rows: dependencies.map((d) => ({
      ...ref("dependency")(d),
      cells: [
        textValue(d.code, "system"),
        textValue(initiativeCode.get(d.from_initiative_id!) ?? null, "system"),
        textValue(initiativeCode.get(d.to_initiative_id!) ?? null, "system"),
        codeValue(d.dependency_type, "report.dependency_type"),
        textValue(d.description),
        dateValue(day(d.needed_by)),
        person(d.owner_user_id),
        codeValue(d.status, "report.dependency_status"),
      ],
    })),
    totals: [],
    emptyKey: "report.empty.no_records",
  });
  for (const d of dependencies) sources.push(source(S.dependencies, "dependency", d));

  return {
    subject: { code: ctx.transformation.code, label: ctx.transformation.name },
    approvalState: "not_applicable",
    sections,
    sources,
    versions: [],
    evidence: [],
  };
}

export const roadmapAssembler: Assembler = {
  code: "roadmap",
  parseParameters(raw) {
    const r = emptyReportParameters.safeParse(raw ?? {});
    if (!r.success) throw reportRefusals.parametersInvalid();
    return r.data;
  },
  assemble,
};
