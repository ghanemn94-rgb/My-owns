// P5 audit events on a transformation's trail have labelled actions, fields and values in Arabic and English
// (T-DG5-FE-A2, D-149; REQ-S15-007, M0302). The W6 merged-tree e2e found `transformation_config_pin.create` showing
// `methodology_version_id` as a "field without a translation" and `form_schema` as a "value without a translation".
//
// The test reads the API sources that write P5 events with a transformation id (audit_event.transformation_id, so
// `listTransformationAudit` returns them) and fails when any action code or changed field there has no label, or when
// any configuration kind or other P5 enum value has none. A new P5 field in one of these files fails here first.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTOMATION_SCOPE_LEVELS,
  AUTOMATION_VERSION_STATUSES,
  CONFIG_REVIEW_POLICY_KINDS,
  FORM_ATTACHMENT_STORES,
  GATE_REAPPROVAL_STATUSES,
  METHODOLOGY_MIGRATION_STATUSES,
  REVISION_SUBJECT_TYPES,
} from "@mth/shared/schemas";
import { createI18n } from "../i18n/index.ts";
import {
  AUDIT_CONFIG_KINDS,
  auditFieldKey,
  describeAuditAction,
  describeAuditChange,
  describeAuditValue,
} from "./auditChanges.ts";

const LOCALES = { en: createI18n("en").t, ar: createI18n("ar").t } as const;
const API = join(import.meta.dirname, "..", "..", "..", "api", "src", "modules");

/**
 * The API files whose P5 audit events carry a transformation id. Excluded, because their events never carry one (they
 * are organization-level Studio records): methodology/{drafts,elements,checks,publish,reviews,review-policies,
 * source-coverage,scoring-defaults}.ts, procedures/definitions.ts and automation/versions.ts.
 */
const P5_TRANSFORMATION_SOURCES = [
  "methodology/migrations.ts",
  "methodology/reapproval.ts",
  "methodology/revision-impact.ts",
  "forms/pin-initializer.ts",
  "forms/custom-values.ts",
  "forms/comments.ts",
  "forms/attachments.ts",
  "automation/rules.ts",
  "automation/lifecycle.ts",
  "automation/dry-run.ts",
] as const;

/** Every P5 action that can reach a transformation's trail, including those built at run time. */
const P5_ACTIONS = [
  // 0065 p3_instantiate_transformation (scoring_defaults pin), forms/pin-initializer.ts, methodology/migrations.ts
  "transformation_config_pin.create",
  "transformation_config_pin.migrate",
  "methodology_migration.create",
  "methodology_migration.preview", // passed to replan() as an argument
  "methodology_migration.submit",
  "methodology_migration.decide",
  "methodology_migration.execute",
  "methodology_migration.withdraw",
  "gate_reapproval.create",
  "gate_reapproval.supersede",
  "gate_reapproval.link_task",
  "gate_reapproval.satisfy", // workflows/gates.ts
  "revision_proposal.create",
  "form_custom_value.create",
  "form_custom_value.update",
  "form_record_comment.create",
  ...FORM_ATTACHMENT_STORES.flatMap((store) => [`${store}.create`, `${store}.remove`]), // forms/attachments.ts
  "automation_rule.create",
  "automation_rule.update",
  "automation_rule.enable",
  "automation_rule.disable",
  "automation_rule.effective_version",
  "automation_rule_version.submit",
  "automation_rule_version.review_approve",
  "automation_rule_version.review_request_changes",
  "automation_rule_version.publish",
  "automation_rule_version.supersede",
  "automation_rule_version.discard",
  "automation_dry_run.create",
  // P5 work items on a transformation (gate re-approval tasks) complete or cancel through the DG4 task actions.
  "work_item.complete",
  "work_item.cancel",
] as const;

/** Fields of P5 events that are written outside the scanned literal `{ from: … }` shape. */
const P5_EXTRA_FIELDS = [
  "satisfied_decision_id", // workflows/gates.ts gate_reapproval.satisfy
  "name_en", // automation/rules.ts automation_rule.update (NAME_COLUMNS)
  "name_ar",
  "description_en",
  "description_ar",
  "owner_user_id",
  "weights", // 0065 scoring_weight_set.create from the Studio default weights
] as const;

/** Enum values of P5 fields, each needing a label (field -> codes). */
const P5_VALUES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["kind", CONFIG_REVIEW_POLICY_KINDS],
  ["config_kind", CONFIG_REVIEW_POLICY_KINDS],
  ["status", METHODOLOGY_MIGRATION_STATUSES],
  ["status", GATE_REAPPROVAL_STATUSES],
  ["status", AUTOMATION_VERSION_STATUSES],
  ["status", ["active", "removed"]], // attachments
  ["status", ["open", "done", "cancelled"]], // work items
  ["scope_level", AUTOMATION_SCOPE_LEVELS],
  ["subject_type", REVISION_SUBJECT_TYPES],
  ["validation_result", ["pass", "fail"]],
  ["outcome", ["would_run", "forbidden", "invalid"]], // automation dry run (AutomationDryRun.outcome)
  ["plan_ready", [true, false] as unknown as string[]],
  ["enabled", [true, false] as unknown as string[]],
];

function sourceOf(file: string): string {
  return readFileSync(join(API, file), "utf8");
}

/** Action codes written in an `action:` property (plain or in a conditional) of a source file. */
function actionsIn(source: string): string[] {
  const out = new Set<string>();
  for (const line of source.split("\n")) {
    if (!/\baction:/.test(line)) continue;
    for (const m of line.matchAll(/"([a-z_]+\.[a-z_]+)"/g)) out.add(m[1]!);
  }
  return [...out];
}

/** Keys of literal audit changes (`key: { from: …, to: … }`) in a source file. */
function changedFieldsIn(source: string): string[] {
  return [...new Set([...source.matchAll(/["']?([A-Za-z_][A-Za-z0-9_]*)["']?:\s*\{\s*from:/g)].map((m) => m[1]!))];
}

describe("P5 audit events: the scanned sources", () => {
  it("finds the P5 events and fields in every listed source (the scan still matches the code)", () => {
    for (const file of P5_TRANSFORMATION_SOURCES) {
      const source = sourceOf(file);
      expect(source, file).toMatch(/transformationId/);
      expect(changedFieldsIn(source).length, file).toBeGreaterThan(0);
    }
    const pins = sourceOf("forms/pin-initializer.ts");
    expect(actionsIn(pins)).toContain("transformation_config_pin.create");
    expect(changedFieldsIn(pins)).toEqual(expect.arrayContaining(["kind", "methodology_version_id", "version_no"]));
  });

  it("lists every action literal of the scanned sources", () => {
    const listed = new Set<string>(P5_ACTIONS);
    const unlisted = P5_TRANSFORMATION_SOURCES.flatMap((f) => actionsIn(sourceOf(f)).map((a) => `${f}: ${a}`)).filter(
      (entry) => !listed.has(entry.split(": ")[1]!),
    );
    expect(unlisted).toEqual([]);
  });
});

describe.each(Object.entries(LOCALES))("P5 audit events have labels (%s)", (_locale, t) => {
  it("labels every P5 action", () => {
    const missing = P5_ACTIONS.filter((action) => describeAuditAction(t, action, {}) === null);
    expect(missing).toEqual([]);
  });

  it("labels every changed field of the P5 sources", () => {
    const fields = [
      ...new Set([...P5_TRANSFORMATION_SOURCES.flatMap((f) => changedFieldsIn(sourceOf(f))), ...P5_EXTRA_FIELDS]),
    ];
    const missing = fields.filter((field) => describeAuditChange(t, field, { from: null, to: null }).label === null);
    expect(missing).toEqual([]);
  });

  it("shows no P5 field value as untranslated when it holds a valid value", () => {
    const samples: Record<string, unknown> = {
      methodology_version_id: "01920005-0200-7000-8000-000000000001",
      version_no: 2,
      field_values: { charter_sponsor_note: "x" },
      reviewer_role_code: "FIN",
      reviewed_by: "01920000-0000-7000-8000-000000000001",
      weights: { strategic_fit: "30.00", financial_value: "20.00", customer_impact: "20.00", feasibility: "15.00" },
    };
    const fields = [
      ...new Set([...P5_TRANSFORMATION_SOURCES.flatMap((f) => changedFieldsIn(sourceOf(f))), ...P5_EXTRA_FIELDS]),
    ];
    const enumFields = new Set(P5_VALUES.map(([field]) => auditFieldKey(field)));
    const untranslated = fields
      .filter((field) => !enumFields.has(auditFieldKey(field)))
      .filter(
        (field) => describeAuditValue(t, field, samples[auditFieldKey(field)] ?? "sample").kind === "untranslated",
      );
    expect(untranslated).toEqual([]);
  });

  it("labels every configuration kind, as `kind` and as `config_kind`", () => {
    expect([...AUDIT_CONFIG_KINDS].sort()).toEqual(
      [
        "automation_rule_set",
        "benefit_formula",
        "form_schema",
        "health_check_scheme",
        "methodology",
        "procedure",
        "scoring_defaults",
      ].sort(),
    );
    for (const field of ["kind", "config_kind"]) {
      for (const code of AUDIT_CONFIG_KINDS) {
        const v = describeAuditValue(t, field, code);
        expect(v, `${field}=${code}`).toMatchObject({ kind: "label", code });
      }
    }
  });

  it("labels every enum value of the P5 fields", () => {
    const missing = P5_VALUES.flatMap(([field, codes]) =>
      codes.filter((code) => describeAuditValue(t, field, code).kind !== "label").map((code) => `${field}=${code}`),
    );
    expect(missing).toEqual([]);
  });

  it("describes the instantiation's form_schema pin event (the D-149 reproduction) without a raw code", () => {
    const change = (field: string, to: unknown) => describeAuditChange(t, field, { from: null, to });
    expect(describeAuditAction(t, "transformation_config_pin.create", {})).toBeTruthy();
    expect(change("kind", "form_schema")).toMatchObject({ label: expect.any(String), to: { kind: "label" } });
    expect(change("methodology_version_id", "01920005-0200-7000-8000-000000000001")).toMatchObject({
      label: expect.any(String),
      to: { kind: "code", text: "01920005-0200-7000-8000-000000000001" },
    });
    expect(change("version_no", 1)).toMatchObject({ label: expect.any(String), to: { kind: "code" } });
  });
});

it("keeps the Arabic and English P5 labels distinct from the raw codes", () => {
  for (const code of CONFIG_REVIEW_POLICY_KINDS) {
    const enText = describeAuditValue(LOCALES.en, "kind", code);
    const arText = describeAuditValue(LOCALES.ar, "kind", code);
    expect(enText.kind === "label" && enText.text !== code, code).toBe(true);
    expect(arText.kind === "label" && /[؀-ۿ]/.test(arText.text), code).toBe(true);
  }
});
