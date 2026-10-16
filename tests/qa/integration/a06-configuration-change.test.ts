// A06 "Configuration change" (qa-verifier, T-DG5-QA-A). Scenario (master prompt §20 A06): "Admin adds a field, changes
// a form rule and updates a workflow using the UI; a new published version works without application-code changes".
// Concrete check (REQ-S20-006, AN-04): with no deployment between steps, a record created under the new published
// version stores the added field, the changed rule rejects a value it previously accepted, and the updated workflow
// routes to the new step/approver; records pinned to the old version are unchanged.
//
// Every assertion is derived from the acceptance texts of the A06 rows in docs/delivery/requirements.csv
// (REQ-PB-093, REQ-S01-002, REQ-S02-001, REQ-S05-002, REQ-S06-001, REQ-S06-003, REQ-S06-004, REQ-S06-005,
// REQ-S06-006, REQ-S06-007, REQ-S06-008, REQ-S06-010, REQ-S10-015, REQ-S12-018, REQ-S16-010) and from
// docs/api/openapi.yaml. The configuration is changed ONLY through the Studio API operations the UI calls, through
// the full publish pipeline (draft -> preview -> configured review -> publish), never by writing configuration rows:
// the server process is the same one before and after each publish (no restart, no code change).
//
// Each publish changes the SHARED seeded keys (`forms`, `playbook`, `scoring-defaults`), so the suite runs on its OWN
// scratch database migrated from the same files (the pattern the harness documents for suites that change shared
// data). All data is SYNTHETIC. Every approval here (a configuration review by TO, a decision-route step by BO) is a
// synthetic in-product action on test data; it approves nothing real and never touches the engineering gates.
import { migrate } from "../../../packages/db/src/migrate.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import {
  mapParty,
  newDecision,
  requestBody,
  setupApprovalWorld,
  type ApprovalWorld,
} from "../../../apps/api/test/integration/approvals/approval-world.ts";
import { call, createUser, grant, signIn, startApi, type Res, type Session, type TestApi } from "../support/api.ts";
import { seedWorld, type World } from "../support/p4.ts";
import {
  coverWithException,
  decideGate,
  gateView,
  missingKeys,
  passGatesNatively,
  seedNativeGateWorld,
  submitGate,
  type NativeGateWorld,
} from "../support/gates-native.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let scratchDb: string;
let w: World;
let adm: Session; // ADM_METHOD (methodology admin): drafts and publishes
let admId: string;
let reviewer: Session; // TO: the configured reviewer of every kind (config_review_policy)
let lead: Session; // TL at BU a1: creates transformations, holds adoption.edit (T13)
let leadId: string;
let bo: Session; // BO at org: a business/KPI owner, never a Studio admin
let gw: NativeGateWorld; // an EXISTING transformation with G1 and G2 approved, pinned to the shipped versions

const V = "/api/v1/admin/methodology-versions";
const ifm = (v: number | string) => ({ "if-match": `"${v}"` });
let lastCall = "";
const send = (method: string, url: string, session: Session, body?: unknown, headers?: Record<string, string>) =>
  ((lastCall = `${method} ${url}`), call<Body>)(api.app, method, url, {
    session,
    ...(body !== undefined ? { body } : {}),
    ...(headers ? { headers } : {}),
  });
const show = (r: Res<Body>) => `${lastCall} -> ${r.status} ${JSON.stringify(r.body).slice(0, 700)}`;
function expectStatus(r: Res<Body>, status: number | number[]): Body {
  const ok = Array.isArray(status) ? status : [status];
  expect(ok, show(r)).toContain(r.status);
  return r.body;
}
function expectCode(r: Res<Body>, status: number, codes: string | string[]): void {
  expect(r.status, show(r)).toBe(status);
  expect(String(r.headers["content-type"])).toContain("application/problem+json");
  expect(Array.isArray(codes) ? codes : [codes], show(r)).toContain(r.body.code);
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_qa_a06");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  const a = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, a.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  admId = a.id;
  adm = await signIn(api.app, a.subject);
  reviewer = await signIn(api.app, w.office.subject); // TO @ org A (seedWorld)
  const l = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, l.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
  leadId = l.id;
  lead = await signIn(api.app, l.subject);
  const b = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, b.id, "BO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  bo = await signIn(api.app, b.subject);
  // created BEFORE any Studio publish: pinned to forms v1 and playbook v1; G1 and G2 approved natively (synthetic)
  gw = await seedNativeGateWorld(api, w, "A06");
  await passGatesNatively(api, gw, ["G1", "G2"], "2030-12-31");
}, 240_000);
afterAll(async () => {
  await api?.close();
  if (scratchDb) await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
}, 60_000);

// ------------------------------------------------------------------------------------------------ Studio helpers

async function newestPublished(kind: string, key: string): Promise<Body> {
  const r = await send("GET", `${V}?kind=${kind}&status=published`, adm);
  const items = (expectStatus(r, 200).items as Body[]).filter((v) => v.key === key);
  expect(items.length, `published ${kind}/${key}`).toBeGreaterThan(0);
  return items.find((v) => v.isNewestPublished) ?? items[0];
}
const versionOf = async (id: string): Promise<Body> => expectStatus(await send("GET", `${V}/${id}`, adm), 200);
async function newDraft(baseId: string, summary: string): Promise<Body> {
  const r = await send("POST", V, adm, { basedOnVersionId: baseId, changeSummary: summary });
  return expectStatus(r, 201);
}
async function putElement(id: string, type: string, key: string, attributes: Body, origin?: "source" | "admin") {
  const cur = await versionOf(id);
  return send(
    "PUT",
    `${V}/${id}/elements/${type}/${encodeURIComponent(key)}`,
    adm,
    {
      attributes,
      ...(origin ? { origin } : {}),
    },
    ifm(cur.version),
  );
}
async function removeElement(id: string, type: string, key: string) {
  const cur = await versionOf(id);
  return send(
    "POST",
    `${V}/${id}/elements/${type}/${encodeURIComponent(key)}/remove`,
    adm,
    undefined,
    ifm(cur.version),
  );
}
async function preview(id: string) {
  const cur = await versionOf(id);
  return send("POST", `${V}/${id}/preview`, adm, { samples: [] }, ifm(cur.version));
}
async function compat(id: string) {
  const cur = await versionOf(id);
  return send("POST", `${V}/${id}/compatibility-checks`, adm, undefined, ifm(cur.version));
}
async function publish(id: string) {
  const cur = await versionOf(id);
  return send("POST", `${V}/${id}/publish`, adm, undefined, ifm(cur.version));
}
async function submitReview(id: string) {
  const cur = await versionOf(id);
  return send("POST", `${V}/${id}/submit-review`, adm, { note: "Synthetic A06 change for review" }, ifm(cur.version));
}
async function approveReview(id: string, review: Body, as = reviewer) {
  return send(
    "POST",
    `${V}/${id}/reviews/${review.id}/decision`,
    as,
    { outcome: "approve", note: "Synthetic review" },
    ifm(review.version),
  );
}
/** The full UI pipeline: compatibility (and source coverage for methodology), preview, review by TO, publish. */
async function runPipeline(id: string, kind: string): Promise<Body> {
  expect(["pass", "warn"]).toContain(expectStatus(await compat(id), [200, 201]).result);
  if (kind === "methodology")
    expect(["pass", "warn"]).toContain(
      expectStatus(await send("POST", "/api/v1/admin/source-coverage/runs", adm, { versionId: id }), [200, 201]).result,
    );
  expect(expectStatus(await preview(id), [200, 201]).result).not.toBe("fail");
  const review = expectStatus(await submitReview(id), [200, 201]);
  expectStatus(await approveReview(id, review), 200);
  const p = expectStatus(await publish(id), 200);
  expect(p.status).toBe("published");
  return p;
}

async function newTransformation(name: string): Promise<string> {
  const r = await send("POST", "/api/v1/transformations", lead, { businessUnitId: w.a1, name, mode: "end_to_end" });
  return expectStatus(r, 201).id as string;
}
async function newStakeholderGroup(tx: string, name: string): Promise<string> {
  const r = await send("POST", `/api/v1/transformations/${tx}/stakeholder-groups`, lead, {
    name,
    impact: "H",
    currentStance: "neutral",
    requiredBehavior: "Synthetic behaviour: use the new process",
    interventionTypes: ["training"],
    ownerUserId: leadId,
  });
  return expectStatus(r, 201).id as string;
}
const customUrl = (tx: string, group: string) =>
  `/api/v1/transformations/${tx}/form-records/T13/${group}/custom-fields`;
const putCustom = (tx: string, group: string, values: Body, version: number | string) =>
  send("PUT", customUrl(tx, group), lead, { values }, ifm(version));
const storedValues = async (group: string) =>
  api.db
    .selectFrom("form_custom_value")
    .select(["field_values", "form_schema_version_id", "version"])
    .where("record_id", "=", group)
    .executeTakeFirst();
const t13Fields = async (tx: string, as: Session = lead): Promise<Body[]> =>
  expectStatus(await send("GET", `/api/v1/transformations/${tx}/form-schemas/T13`, as), 200).fields as Body[];

// The synthetic extension fields A06 adds to T13 (Stakeholder & Adoption Plan) and T03 (TOM Gap Matrix).
const SCORE = "qa_readiness_score";
const RATE = "qa_adoption_rate";
const BUDGET = "qa_change_budget";
const label = (en: string) => ({ labelEn: `Synthetic ${en}`, labelAr: `حقل تجريبي ${en}` });

// Shared state across the ordered scenario steps.
const S: Record<string, string> = {};

// ================================================================================================ forms: add a field

describe("A06 forms: an admin adds T13 fields and publishes; a new transformation uses them, an old one stays pinned", () => {
  it("REQ-S06-004/REQ-S05-002/REQ-S06-005: draft edits are validated, protected source columns cannot be deleted or retyped", async () => {
    S.txOld = await newTransformation("Synthetic A06 existing transformation (forms v1)");
    const base = await newestPublished("form_schema", "forms");
    S.formsV1 = base.id;
    const d = await newDraft(base.id, "Synthetic A06: T13 readiness fields, T03 extension");
    expect([d.status, d.draftStage]).toEqual(["draft", "editing"]);
    S.formsV2 = d.id;

    expectStatus(
      await putElement(
        d.id,
        "form_field",
        `T13.${SCORE}`,
        { ...label("readiness score"), fieldType: "number", min: "0", max: "100", scale: 0 },
        "admin",
      ),
      200,
    );
    expectStatus(
      await putElement(
        d.id,
        "form_field",
        `T13.${RATE}`,
        { ...label("adoption rate"), fieldType: "percentage" },
        "admin",
      ),
      200,
    );
    expectStatus(
      await putElement(
        d.id,
        "form_field",
        `T13.${BUDGET}`,
        { ...label("change budget"), fieldType: "currency", currencyCode: "SAR", scale: 2 },
        "admin",
      ),
      200,
    );
    // REQ-S05-002: adding an extension field to T03 is accepted (published below).
    expectStatus(
      await putElement(
        d.id,
        "form_field",
        "T03.qa_gap_note",
        { ...label("gap note"), fieldType: "text", maxLength: 500 },
        "admin",
      ),
      200,
    );

    // REQ-S06-005: a calculated field referencing an unknown field is rejected.
    expectCode(
      await putElement(
        d.id,
        "form_field",
        "T13.qa_calc",
        { ...label("calc"), fieldType: "calculated", expression: "qa_no_such_field * 2", resultUnitKind: "other" },
        "admin",
      ),
      422,
      "form_schema.calculated_formula_invalid",
    );
    // REQ-S05-002: deleting the T03 'Gap' source column is rejected; so is changing its type semantics.
    expectCode(await removeElement(d.id, "form_field", "T03.gap"), 422, [
      "config_version.source_element_protected",
      "form_schema.source_column_protected",
    ]);
    const retype = await putElement(d.id, "form_field", "T03.gap", { fieldType: "number" }, "source");
    expect(retype.status, show(retype)).toBe(422);
    const gap = (await t13FieldsOfVersion(d.id, "T03")).find((f: Body) => f.key === "gap");
    expect(gap, "T03 gap still present in the draft").toBeTruthy();
    expect(gap.fieldType).toBe("rich_text");
  });

  it("REQ-S06-007: the diff lists the added field; publish without preview or without the configured review is rejected", async () => {
    const diff = expectStatus(await send("GET", `${V}/${S.formsV2}/diff`, adm), 200);
    const added = (diff.entries as Body[])
      .filter((e) => e.change === "added")
      .map((e) => `${e.elementType}:${e.stableKey}`);
    expect(added).toEqual(
      expect.arrayContaining([`form_field:T13.${SCORE}`, `form_field:T13.${RATE}`, "form_field:T03.qa_gap_note"]),
    );

    expectCode(await publish(S.formsV2), 422, "config_version.preview_required");
    expect(["pass", "warn"]).toContain(expectStatus(await compat(S.formsV2), [200, 201]).result);
    expectStatus(await preview(S.formsV2), [200, 201]);
    expectCode(await publish(S.formsV2), 422, "config_version.review_required");
    // the author never reviews their own change
    const review = expectStatus(await submitReview(S.formsV2), [200, 201]);
    const self = await approveReview(S.formsV2, review, adm);
    expect(self.status, show(self)).toBe(403);
    expectStatus(await approveReview(S.formsV2, review), 200);
    const pub = expectStatus(await publish(S.formsV2), 200);
    expect([pub.status, pub.isNewestPublished]).toEqual(["published", true]);
  });

  it("REQ-S06-007: a published version is immutable (409)", async () => {
    const cur = await versionOf(S.formsV2);
    expectCode(
      await send("PATCH", `${V}/${S.formsV2}`, adm, { titleEn: "Synthetic edit after publish" }, ifm(cur.version)),
      409,
      "config_version.not_editable",
    );
    expectCode(
      await putElement(S.formsV2, "form_field", "T13.qa_late", { ...label("late"), fieldType: "text" }, "admin"),
      409,
      "config_version.not_editable",
    );
  });

  it("REQ-S06-004/REQ-S20-006: a NEW T13 record stores the added fields (no deployment between publish and use)", async () => {
    S.txNew = await newTransformation("Synthetic A06 new transformation (forms v2)");
    const fields = await t13Fields(S.txNew);
    const score = fields.find((f) => f.key === SCORE);
    expect(score).toMatchObject({ extension: true, protected: false, fieldType: "number", origin: "admin" });
    S.groupNew = await newStakeholderGroup(S.txNew, "Synthetic frontline agents");
    const r = await putCustom(
      S.txNew,
      S.groupNew,
      { [SCORE]: "80", [RATE]: "12%", [BUDGET]: { amount: "1500000.10", currencyCode: "SAR" } },
      0,
    );
    const body = expectStatus(r, 200);
    expect(body.formSchemaVersionId).toBe(S.formsV2);
    // REQ-S06-005: 12% stores 0.12 (a fraction string); currency is decimal SAR without float error.
    expect(body.values).toMatchObject({
      [SCORE]: "80",
      [RATE]: "0.12",
      [BUDGET]: { amount: "1500000.10", currencyCode: "SAR" },
    });
    const row = await storedValues(S.groupNew);
    expect(row?.form_schema_version_id).toBe(S.formsV2);
    const fv = (typeof row?.field_values === "string" ? JSON.parse(row.field_values) : row?.field_values) as Body;
    expect(fv[RATE]).toBe("0.12");
    expect(fv[BUDGET]).toEqual({ amount: "1500000.10", currencyCode: "SAR" });
    expect(fv[SCORE]).toBe("80");
    S.groupNewVersion = String(body.version);
  });

  it("REQ-S16-010: a custom-field value violating its schema is rejected before persistence", async () => {
    const before = await storedValues(S.groupNew);
    for (const bad of [
      { [SCORE]: "not-a-number" },
      { [SCORE]: "150" },
      { [SCORE]: 80 },
      { [BUDGET]: 1500000.1 },
      { qa_unknown: "x" },
    ]) {
      const r = await putCustom(S.txNew, S.groupNew, bad, S.groupNewVersion!);
      expect([400, 422], `${JSON.stringify(bad)} -> ${show(r)}`).toContain(r.status);
    }
    expect(await storedValues(S.groupNew)).toEqual(before);
    // core entities stay typed relational columns with foreign keys (stakeholder_group.owner_user_id -> app_user)
    const fk = await api.db
      .selectFrom("information_schema.table_constraints")
      .select("constraint_name")
      .where("table_name", "=", "stakeholder_group")
      .where("constraint_type", "=", "FOREIGN KEY")
      .execute();
    expect(fk.length).toBeGreaterThan(0);
  });

  it("REQ-S06-008: the existing transformation stays pinned to forms v1 (no new field, value refused)", async () => {
    const fields = await t13Fields(S.txOld);
    expect(fields.some((f) => f.key === SCORE)).toBe(false);
    const g = await newStakeholderGroup(S.txOld, "Synthetic legacy group");
    expectCode(await putCustom(S.txOld, g, { [SCORE]: "80" }, 0), 422, "form_record.custom_field_unknown");
    const pins = expectStatus(await send("GET", `/api/v1/transformations/${S.txOld}/config-pins`, lead), 200);
    const formPin = (pins.items as Body[]).find((p) => p.kind === "form_schema");
    expect(formPin?.versionId).toBe(S.formsV1);
  });
});

async function t13FieldsOfVersion(versionId: string, recordType: string): Promise<Body[]> {
  const r = await send("GET", `/api/v1/admin/form-schemas/${recordType}?versionId=${versionId}`, adm);
  if (r.status === 200) return r.body.fields as Body[];
  // the draft is not addressable through the form-schema reader: fall back to the resolved draft elements
  const e = expectStatus(await send("GET", `${V}/${versionId}/elements?elementType=form_field`, adm), 200);
  return (e.items as Body[])
    .filter((x) => String(x.stableKey).startsWith(`${recordType}.`))
    .map((x) => ({
      key: String(x.stableKey).slice(recordType.length + 1),
      fieldType: x.attributes.fieldType ?? x.catalogueAttributes.fieldType,
    }));
}

// ================================================================================================ forms: change a rule

describe("A06 forms: an admin changes the validation rule; the changed rule rejects a value it previously accepted", () => {
  it("REQ-S06-004/REQ-S20-006: max 100 -> 50 published; a new transformation refuses 80, the v2-pinned record keeps accepting it", async () => {
    const d = await newDraft(S.formsV2!, "Synthetic A06: readiness score max 50");
    S.formsV3 = d.id;
    expectStatus(
      await putElement(
        d.id,
        "form_field",
        `T13.${SCORE}`,
        { ...label("readiness score"), fieldType: "number", min: "0", max: "50", scale: 0, required: true },
        "admin",
      ),
      200,
    );
    const diff = expectStatus(await send("GET", `${V}/${d.id}/diff`, adm), 200);
    expect((diff.entries as Body[]).some((e) => e.stableKey === `T13.${SCORE}` && e.change === "changed")).toBe(true);
    await runPipeline(d.id, "form_schema");

    S.txNewer = await newTransformation("Synthetic A06 newer transformation (forms v3)");
    const g = await newStakeholderGroup(S.txNewer, "Synthetic back-office team");
    const refused = await putCustom(S.txNewer, g, { [SCORE]: "80" }, 0);
    expect(refused.status, show(refused)).toBe(400);
    expect(await storedValues(g)).toBeUndefined();
    expectStatus(await putCustom(S.txNewer, g, { [SCORE]: "40" }, 0), 200);

    // records pinned to the old version are unchanged and keep their rule
    const before = await storedValues(S.groupNew!);
    expect(before?.form_schema_version_id).toBe(S.formsV2);
    const again = await putCustom(S.txNew!, S.groupNew!, { [SCORE]: "80", [RATE]: "0.12" }, S.groupNewVersion!);
    expect(expectStatus(again, 200).formSchemaVersionId).toBe(S.formsV2);
  });
});

// ================================================================================================ methodology: invariants, coverage, route

describe("A06 methodology: invariants, source coverage and the updated approval route", () => {
  it("REQ-S02-001: the published source-coverage report counts every element set", async () => {
    const r = expectStatus(await send("GET", "/api/v1/admin/source-coverage", adm), 200);
    const counts = Object.fromEntries((r.sets as Body[]).map((s) => [s.setCode, s.present]));
    expect(counts).toEqual({
      mode: 2,
      phase: 6,
      gate: 6,
      template: 16,
      tom_dimension: 10,
      forum: 5,
      benefit_lifecycle_step: 6,
      launch_window: 3,
      roaming_example: 1,
      health_question: 25,
    });
  });

  it("REQ-S02-001: deleting a template in a draft methodology fails the check and blocks publish", async () => {
    const base = await newestPublished("methodology", "playbook");
    S.playbookV1 = base.id;
    const d = await newDraft(base.id, "Synthetic A06: delete a template (must be refused at publish)");
    const els = expectStatus(await send("GET", `${V}/${d.id}/elements?elementType=source_element`, adm), 200);
    const tpl =
      (els.items as Body[]).find((e) => /T0?5\b|template\.T0?5|T05/.test(String(e.stableKey))) ??
      (els.items as Body[]).find((e) => /template/i.test(String(e.stableKey)));
    expect(
      tpl,
      `a template source element among ${JSON.stringify((els.items as Body[]).map((e) => e.stableKey)).slice(0, 400)}`,
    ).toBeTruthy();
    expectStatus(await removeElement(d.id, "source_element", tpl.stableKey), 200);
    try {
      const run = expectStatus(
        await send("POST", "/api/v1/admin/source-coverage/runs", adm, { versionId: d.id }),
        [200, 201],
      );
      expect(run.checkKind).toBe("source_coverage");
      expect(run.result).toBe("fail");
      const sets = (run.report?.sets ?? []) as Body[];
      const set = sets.find((x) => x.setCode === "template");
      expect(set, JSON.stringify(run.report).slice(0, 600)).toBeTruthy();
      expect([set.expected, set.present, set.result]).toEqual([16, 15, "fail"]);
      await compat(d.id);
      await preview(d.id);
      const p = await publish(d.id);
      expect(p.status, show(p)).toBe(422);
      expect((await versionOf(d.id)).status).toBe("draft");
    } finally {
      const cur = await versionOf(d.id);
      expectStatus(await send("POST", `${V}/${d.id}/discard`, adm, undefined, ifm(cur.version)), 200);
    }
  });

  it("REQ-S06-006: relabelling G3 succeeds; changing its stable ID, deleting a TOM dimension or an ADM approver is rejected", async () => {
    const d = await newDraft(S.playbookV1!, "Synthetic A06: decision route BO then FIN; G3 label");
    S.playbookV2 = d.id;
    expectStatus(
      await putElement(d.id, "gate", "G3", { labelEn: "Synthetic G3 relabel", labelAr: "تسمية تجريبية لبوابة 3" }),
      200,
    );
    // the approver change the Studio UI offers: G3's default approver Sponsor -> Business Owner (an allowed role)
    expectStatus(
      await putElement(d.id, "gate", "G3", {
        labelEn: "Synthetic G3 relabel",
        labelAr: "تسمية تجريبية لبوابة 3",
        defaultApproverRoleCode: "BO",
      }),
      200,
    );
    // ADM can never be configured as a gate approver
    const admGate = await putElement(d.id, "gate", "G3", { defaultApproverRoleCode: "ADM_METHOD" });
    expect(admGate.status, show(admGate)).toBe(422);
    // A stable identifier cannot be changed: re-declaring G3 as an admin element or moving its position is refused.
    const asAdmin = await (async () => {
      const cur = await versionOf(d.id);
      return send(
        "PUT",
        `${V}/${d.id}/elements/gate/G3`,
        adm,
        { origin: "admin", attributes: { labelEn: "x" } },
        ifm(cur.version),
      );
    })();
    expectCode(asAdmin, 422, ["config_version.stable_id_change", "config_version.source_element_protected"]);
    const moved = await (async () => {
      const cur = await versionOf(d.id);
      return send(
        "PUT",
        `${V}/${d.id}/elements/gate/G3`,
        adm,
        { ordinal: 6, attributes: { labelEn: "Synthetic G3 relabel" } },
        ifm(cur.version),
      );
    })();
    expectCode(moved, 422, "config_version.stable_id_change");
    const toms = expectStatus(await send("GET", `${V}/${d.id}/elements?elementType=tom_dimension`, adm), 200);
    expect((toms.items as Body[]).length).toBe(10);
    expectCode(
      await removeElement(d.id, "tom_dimension", toms.items[0].stableKey),
      422,
      "config_version.source_element_protected",
    );
    expectCode(
      await putElement(
        d.id,
        "approver_route",
        "approval.decision_request",
        { approverRoleCodes: ["ADM_METHOD", "FIN"], mode: "sequential" },
        "admin",
      ),
      422,
      ["config_version.admin_approver_forbidden", "config_version.approver_not_allowed"],
    );
  });

  it("REQ-S06-004/REQ-S10-015/REQ-S12-018: the route change is reviewed (impact + review task) and published", async () => {
    // an EXISTING transformation (created before the publish) keeps the single-step DG4 approval
    oldWorld = await setupApprovalWorld(api, w);
    expectStatus(
      await putElement(
        S.playbookV2!,
        "approver_route",
        "approval.decision_request",
        { ...label("decision route"), approverRoleCodes: ["BO", "FIN"], mode: "sequential" },
        "admin",
      ),
      200,
    );
    expect(["pass", "warn"]).toContain(expectStatus(await compat(S.playbookV2!), [200, 201]).result);
    expect(["pass", "warn"]).toContain(
      expectStatus(
        await send("POST", "/api/v1/admin/source-coverage/runs", adm, { versionId: S.playbookV2 }),
        [200, 201],
      ).result,
    );
    expectStatus(await preview(S.playbookV2!), [200, 201]);
    const review = expectStatus(await submitReview(S.playbookV2!), [200, 201]);
    expect(review.reviewerRoleCode).toBe("TO");
    // REQ-S12-018: proposing the methodology revision runs validation and impact and routes a review task
    const props = expectStatus(await send("GET", `/api/v1/admin/revision-proposals`, adm), 200);
    const prop = (props.items as Body[]).find((p) => p.subjectId === S.playbookV2);
    expect(prop, "a revision proposal for the draft").toBeTruthy();
    expect(prop.subjectType).toBe("methodology_version");
    expect(prop.validationResult).toBe("pass");
    expect(prop.impact).toHaveProperty("affectedTransformations");
    expect(prop.reviewTaskCount).toBeGreaterThanOrEqual(1);
    const tasks = await api.db
      .selectFrom("work_item")
      .select(["kind", "assignee_user_id"])
      .where("kind", "=", "config_review")
      .where("assignee_user_id", "=", w.office.id)
      .execute();
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expectStatus(await approveReview(S.playbookV2!, review), 200);
    expectStatus(await publish(S.playbookV2!), 200);
    const routes = expectStatus(await send("GET", "/api/v1/admin/approval-routes", adm), 200);
    const route = JSON.stringify(routes);
    expect(route).toContain("approval.decision_request");
    expect(route).toContain("sequential");
  });

  it("REQ-S06-004/REQ-S10-015/REQ-S20-006: a submission in a NEW transformation is routed to the new approvers in sequence", async () => {
    newWorld = await setupApprovalWorld(api, w);
    const routed = await request(newWorld, "target_state_design");
    const route = expectStatus(await send("GET", `/api/v1/approvals/${routed.id}/route`, newWorld.lead.session), 200);
    expect([route.routed, route.routeKey, route.mode]).toEqual([true, "approval.decision_request", "sequential"]);
    expect((route.steps as Body[]).map((x) => [x.stepNo, x.approverRoleCode, x.status])).toEqual([
      [1, "BO", "active"],
      [2, "FIN", "waiting"],
    ]);
    const rows = await routeRows(routed.id);
    expect(rows.map((r) => [r.step_no, r.approver_role_code, r.status])).toEqual([
      [1, "BO", "active"],
      [2, "FIN", "waiting"],
    ]);
    // sequential: step 2 (FIN) is not notified until step 1 approves
    expect(await decisionItems(routed.id, newWorld.fin.id)).toHaveLength(0);
    const a = expectStatus(await send("GET", `/api/v1/approvals/${routed.id}`, newWorld.bo.session), 200);
    const d1 = await send(
      "POST",
      `/api/v1/approvals/${routed.id}/route/steps/1/decision`,
      newWorld.bo.session,
      { outcome: "approve", note: "Synthetic step 1" },
      ifm(a.version),
    );
    expectStatus(d1, [200, 201]);
    expect((await routeRows(routed.id)).map((r) => r.status)).toEqual(["approved", "active"]);
    expect((await decisionItems(routed.id, newWorld.fin.id)).length).toBeGreaterThanOrEqual(1);
  });

  it("REQ-S20-006: the new transformation pinned to the published methodology keeps a complete working catalogue", async () => {
    const pins = expectStatus(
      await send("GET", `/api/v1/transformations/${newWorld.transformationId}/config-pins`, adm),
      200,
    );
    expect((pins.items as Body[]).find((p) => p.kind === "methodology")?.versionId).toBe(S.playbookV2);
    const cat = expectStatus(
      await send("GET", `/api/v1/transformations/${newWorld.transformationId}/methodology`, newWorld.lead.session),
      200,
    );
    const ref = expectStatus(
      await send("GET", `/api/v1/transformations/${oldWorld.transformationId}/methodology`, oldWorld.lead.session),
      200,
    );
    expect(cat.methodologyVersion.id).toBe(S.playbookV2);
    expect(cat.tomDimensions).toHaveLength(10);
    expect(cat.gateDefinitions).toHaveLength(6);
    for (const k of ["diagnosticDimensions", "diagnosticWorkstreams", "charterScopeChecks", "goodOutcomeCriteria"])
      expect((cat[k] as Body[]).length, k).toBe((ref[k] as Body[]).length);
    expect((cat.diagnosticDimensions as Body[]).length).toBeGreaterThan(0);
  });

  it("REQ-S06-004/REQ-S20-006: a G3 submission of a NEW transformation is routed to the new approver (BO); the existing one keeps SP", async () => {
    const before = await gateView(api, gw, "G3");
    expect(before.gate.approverRoleCode).toBe("SP");
    const gw2 = await seedNativeGateWorld(api, w, "A06-new");
    await passGatesNatively(api, gw2, ["G1", "G2"], "2030-12-31");
    // the G3 exceptions are decided by G3's configured approver, now the Business Owner (the Sponsor is refused)
    for (const key of await missingKeys(api, gw2, "G3"))
      await coverWithException(api, gw2, "G3", key, "2030-12-31", gw2.bo.session);
    const sub = await submitGate(api, gw2, "G3");
    expect(sub.status, show(sub)).toBe(201);
    expect(sub.body.approverRoleCode).toBe("BO");
    S.gw2 = gw2.transformationId;
    gwNew = gw2;
    // the decision follows the route: the Sponsor is refused, the Business Owner decides (synthetic approval)
    const body = {
      submissionNo: sub.body.submissionNo,
      outcome: "approved",
      rationale: "Synthetic QA approval of G3 (approves nothing real).",
    };
    const bySp = await decideGate(api, gw2, "G3", gw2.sp.session, body);
    expect(bySp.status, show(bySp)).toBe(403);
    const byBo = await decideGate(api, gw2, "G3", gw2.bo.session, body);
    expect(byBo.status, show(byBo)).toBe(201);
    // the existing transformation (pinned to the old methodology) still submits G3 to the Sponsor
    expect((await gateView(api, gw, "G3")).gate.approverRoleCode).toBe("SP");
  });

  it("REQ-S06-004 (display): the gate of the NEW transformation reports the approver its submissions are routed to", async () => {
    // GatesPage and GateDetailPage render gate.approverRoleCode as "Approver"; it must name the configured approver.
    const r = await send("GET", `${gwNew.gates}/G3`, gwNew.tl.session);
    const view = expectStatus(r, 200);
    const evidence = `${lastCall} -> ${r.status} gate=${JSON.stringify({ gateCode: view.gate.gateCode, status: view.gate.status, approverRoleCode: view.gate.approverRoleCode })} currentSubmission=${JSON.stringify({ submissionNo: view.currentSubmission?.submissionNo, approverRoleCode: view.currentSubmission?.approverRoleCode })}`;
    expect(view.gate.approverRoleCode, evidence).toBe("BO");
  });

  it("REQ-S06-008/REQ-S20-006: the existing transformation's approval is unchanged (no route steps)", async () => {
    const plain = await request(oldWorld, "target_state_design");
    expect(await routeRows(plain.id)).toHaveLength(0);
  });

  it("REQ-S06-010: a methodology admin who can publish receives 403 approving a funding reallocation; a business owner cannot use Studio", async () => {
    const decisionId = await newDecision(
      (m, u, o) => call(api.app, m, u, o),
      oldWorld,
      "Synthetic funding reallocation decision",
    );
    // the funding-reallocation right is approved by SteerCo: map it to the (synthetic) Sponsor of the transformation
    await mapParty((m, u, o) => call(api.app, m, u, o), oldWorld, "STEERCO", oldWorld.sponsor.id);
    const funding = await request({ ...oldWorld, decisionId }, "funding_reallocation");
    const a = expectStatus(await send("GET", `/api/v1/approvals/${funding.id}`, oldWorld.lead.session), 200);
    const r = await send(
      "POST",
      `/api/v1/approvals/${funding.id}/decisions`,
      adm,
      { outcome: "approve", rationale: "Synthetic", subjectVersion: 1 },
      ifm(a.version),
    );
    expect(r.status, show(r)).toBe(403);
    expect(((await send("GET", `/api/v1/approvals/${funding.id}`, oldWorld.lead.session)).body as Body).status).toBe(
      "pending",
    );
    const studio = await send("POST", V, bo, { basedOnVersionId: S.playbookV1 });
    expect(studio.status, show(studio)).toBe(403);
    void admId;
  });
});

let oldWorld: ApprovalWorld;
let gwNew: NativeGateWorld;
let newWorld: ApprovalWorld;
async function request(q: ApprovalWorld, right: string): Promise<Body> {
  const r = await send(
    "POST",
    `/api/v1/transformations/${q.transformationId}/approvals`,
    q.lead.session,
    requestBody(q.decisionId, q.rights[right]!, 1),
  );
  if (r.status === 409) {
    // one open approval per subject: a second right on the same decision needs a fresh decision; use the open one's id
    throw new Error(`approval already open: ${show(r)}`);
  }
  return expectStatus(r, 201);
}
const routeRows = (approvalId: string) =>
  api.db
    .selectFrom("approval_route_step")
    .select(["step_no", "approver_role_code", "status"])
    .where("approval_id", "=", approvalId)
    .orderBy("step_no")
    .execute();
const decisionItems = (approvalId: string, userId: string) =>
  api.db
    .selectFrom("work_item")
    .select(["id"])
    .where("subject_type", "=", "approval")
    .where("subject_id", "=", approvalId)
    .where("assignee_user_id", "=", userId)
    .where("kind", "=", "approval_decision")
    .execute();

// ================================================================================================ scoring defaults

// ================================================================================================ migration and parallel route

describe("A06 version 3: a parallel route and a changed G2 criterion; deliberate migration of an existing transformation", () => {
  let gateDecisionsBefore: unknown[];
  it("REQ-S10-015: after publishing a parallel route, both approvers of a new submission are notified at once", async () => {
    const d = await newDraft(S.playbookV2!, "Synthetic A06: parallel decision route; G2 criterion mandatory flip");
    S.playbookV3 = d.id;
    expectStatus(
      await putElement(
        d.id,
        "approver_route",
        "approval.decision_request",
        { ...label("decision route"), approverRoleCodes: ["BO", "FIN"], mode: "parallel" },
        "admin",
      ),
      200,
    );
    const crit = expectStatus(await send("GET", `${V}/${d.id}/elements?elementType=gate_criterion`, adm), 200);
    const g2 = (crit.items as Body[]).find((c) => (c.attributes.gateCode ?? c.catalogueAttributes.gateCode) === "G2");
    expect(
      g2,
      `a G2 criterion among ${JSON.stringify((crit.items as Body[]).map((c) => [c.stableKey, c.attributes, c.catalogueAttributes])).slice(0, 1500)}`,
    ).toBeTruthy();
    const mandatory = (g2.attributes.mandatory ?? g2.catalogueAttributes.mandatory) === true;
    S.g2Criterion = g2.stableKey;
    expectStatus(await putElement(d.id, "gate_criterion", g2.stableKey, { mandatory: !mandatory }), 200);
    await runPipeline(d.id, "methodology");

    const q = await setupApprovalWorld(api, w);
    const routed = await request(q, "target_state_design");
    const route = expectStatus(await send("GET", `/api/v1/approvals/${routed.id}/route`, q.lead.session), 200);
    expect([route.routed, route.mode]).toEqual([true, "parallel"]);
    expect((route.steps as Body[]).map((x) => [x.approverRoleCode, x.status])).toEqual([
      ["BO", "active"],
      ["FIN", "active"],
    ]);
    expect((await decisionItems(routed.id, q.bo.id)).length).toBeGreaterThanOrEqual(1);
    expect((await decisionItems(routed.id, q.fin.id)).length).toBeGreaterThanOrEqual(1);
  });

  it("REQ-S06-008: the existing transformation still renders v1 forms; the forms migration preview lists the new required field", async () => {
    const fields = await t13Fields(gw.transformationId, gw.tl.session);
    expect(fields.some((f) => f.key === SCORE)).toBe(false);
    // the existing transformation has a T13 record the new required field would apply to
    const g = await send("POST", `/api/v1/transformations/${gw.transformationId}/stakeholder-groups`, gw.tl.session, {
      name: "Synthetic existing stakeholder group",
      impact: "M",
      currentStance: "support",
      requiredBehavior: "Synthetic behaviour",
      interventionTypes: ["comms"],
      ownerUserId: gw.tl.id,
    });
    expectStatus(g, 201);
    // the published v3 really declares the field required
    const v3 = expectStatus(await send("GET", `/api/v1/admin/form-schemas/T13?versionId=${S.formsV3}`, adm), 200);
    expect((v3.fields as Body[]).find((f) => f.key === SCORE)).toMatchObject({ required: true, extension: true });
    const r = await send("POST", `/api/v1/transformations/${gw.transformationId}/methodology-migrations`, adm, {
      configKind: "form_schema",
      toVersionId: S.formsV3,
      reason: "Synthetic A06: move to forms v3",
    });
    const m = expectStatus(r, 201);
    expect([m.fromVersionId, m.toVersionId, m.status]).toEqual([S.formsV1, S.formsV3, expect.any(String)]);
    const req = (m.items as Body[]).filter((i) => i.itemKind === "new_required_field");
    expect(
      req.map((i) => i.stableKey),
      JSON.stringify(m.items).slice(0, 800),
    ).toContain(`T13.${SCORE}`);
    // the plan only explains: the pin has not moved
    const pins = expectStatus(
      await send("GET", `/api/v1/transformations/${gw.transformationId}/config-pins`, adm),
      200,
    );
    expect((pins.items as Body[]).find((p) => p.kind === "form_schema")?.versionId).toBe(S.formsV1);
    const cur = expectStatus(
      await send("GET", `/api/v1/transformations/${gw.transformationId}/methodology-migrations/${m.id}`, adm),
      200,
    );
    expectStatus(
      await send(
        "POST",
        `/api/v1/transformations/${gw.transformationId}/methodology-migrations/${m.id}/withdraw`,
        adm,
        undefined,
        ifm(cur.version),
      ),
      200,
    );
  });

  it("REQ-S06-008: the methodology migration lists a required G2 re-approval; executed after approval, history is unchanged", async () => {
    const T = `/api/v1/transformations/${gw.transformationId}`;
    gateDecisionsBefore = await api.db
      .selectFrom("gate_decision")
      .selectAll()
      .where("transformation_id", "=", gw.transformationId)
      .orderBy("id")
      .execute();
    expect(gateDecisionsBefore.length).toBeGreaterThanOrEqual(2);
    const m = expectStatus(
      await send("POST", `${T}/methodology-migrations`, adm, {
        configKind: "methodology",
        toVersionId: S.playbookV3,
        reason: "Synthetic A06: move to playbook v3",
      }),
      201,
    );
    expect(m.fromVersionId).toBe(S.playbookV1);
    const re = (m.items as Body[]).filter((i) => i.itemKind === "reapproval").map((i) => i.gateCode);
    expect(re, JSON.stringify(m.items).slice(0, 800)).toContain("G2");
    // submit, synthetic Sponsor approval (in-product business approval of test data), execute
    const sub = expectStatus(
      await send("POST", `${T}/methodology-migrations/${m.id}/submit`, adm, undefined, ifm(m.version)),
      200,
    );
    const self = await send(
      "POST",
      `${T}/methodology-migrations/${m.id}/decision`,
      adm,
      { outcome: "approve", rationale: "Synthetic" },
      ifm(sub.version),
    );
    expect(self.status, show(self)).toBe(403);
    const dec = expectStatus(
      await send(
        "POST",
        `${T}/methodology-migrations/${m.id}/decision`,
        gw.sp.session,
        { outcome: "approve", rationale: "Synthetic QA approval of a test migration" },
        ifm(sub.version),
      ),
      200,
    );
    const ex = expectStatus(
      await send("POST", `${T}/methodology-migrations/${m.id}/execute`, adm, undefined, ifm(dec.version)),
      200,
    );
    expect(ex.status).toBe("executed");
    const after = await api.db
      .selectFrom("gate_decision")
      .selectAll()
      .where("transformation_id", "=", gw.transformationId)
      .orderBy("id")
      .execute();
    expect(after).toEqual(gateDecisionsBefore);
    const ra = expectStatus(await send("GET", `${T}/gate-reapprovals`, gw.tl.session), 200);
    expect(JSON.stringify(ra)).toContain('"G2"');
    const pins = expectStatus(await send("GET", `${T}/config-pins`, adm), 200);
    expect((pins.items as Body[]).find((p) => p.kind === "methodology")?.versionId).toBe(S.playbookV3);
  });
});

describe("A06 scoring defaults (REQ-PB-093): weights and rubric changed in Studio apply to new transformations only", () => {
  const W = (sf: string, fv: string, ci: string, fe: string, tv: string) => [
    { criterionCode: "strategic_fit", weightPercent: sf },
    { criterionCode: "financial_value", weightPercent: fv },
    { criterionCode: "customer_impact", weightPercent: ci },
    { criterionCode: "feasibility", weightPercent: fe },
    { criterionCode: "time_to_value", weightPercent: tv },
  ];
  const FEAS = {
    criterionCode: "feasibility",
    levels: [1, 2, 3, 4, 5].map((score) => ({
      score,
      descriptorEn: `Synthetic A06 feasibility ${score}`,
      descriptorAr: `قابلية تنفيذ تجريبية ${score}`,
    })),
  };
  const putDefaults = async (id: string, weights: Body) => {
    const cur = await versionOf(id);
    return send("PUT", `${V}/${id}/scoring-defaults`, adm, { weights, rubrics: [FEAS] }, ifm(cur.version));
  };

  it("publishing defaults that total 95% is rejected", async () => {
    S.txBeforeScoring = await newTransformation("Synthetic A06 transformation before the new weights");
    const base = await newestPublished("scoring_defaults", "scoring-defaults");
    S.scoringV1 = base.id;
    const d = await newDraft(base.id, "Synthetic A06: weights total 95");
    expectStatus(await putDefaults(d.id, W("25", "20", "20", "15", "15")), 200);
    await compat(d.id);
    await preview(d.id);
    const review = await submitReview(d.id);
    if (review.status === 201 || review.status === 200) await approveReview(d.id, review.body);
    expectCode(await publish(d.id), 422, "config_version.weights_total");
    expect((await versionOf(d.id)).status).toBe("draft");
    const cur = await versionOf(d.id);
    expectStatus(await send("POST", `${V}/${d.id}/discard`, adm, undefined, ifm(cur.version)), 200);
  });

  it("30/20/20/15/15 and a new Feasibility rubric: a new transformation starts with them, an existing one keeps 25/25", async () => {
    const d = await newDraft(S.scoringV1!, "Synthetic A06: weights 30/20/20/15/15");
    const put = expectStatus(await putDefaults(d.id, W("30", "20", "20", "15", "15")), 200);
    expect(put.weightTotal).toMatch(/^100(\.0+)?$/);
    await runPipeline(d.id, "scoring_defaults");
    const txAfter = await newTransformation("Synthetic A06 transformation after the new weights");
    const after = expectStatus(await send("GET", `/api/v1/transformations/${txAfter}/scoring-defaults`, lead), 200);
    const pct = (b: Body) =>
      Object.fromEntries((b.weights as Body[]).map((x) => [x.criterionCode, x.weightPercent.replace(/\.0+$/, "")]));
    expect(after.versionId).toBe(d.id);
    expect(pct(after)).toMatchObject({
      strategic_fit: "30",
      financial_value: "20",
      customer_impact: "20",
      feasibility: "15",
      time_to_value: "15",
    });
    const rub = (after.rubrics as Body[]).find((r) => r.criterionCode === "feasibility");
    expect(rub.levels[0].descriptorEn).toBe("Synthetic A06 feasibility 1");
    const before = expectStatus(
      await send("GET", `/api/v1/transformations/${S.txBeforeScoring}/scoring-defaults`, lead),
      200,
    );
    expect(before.versionId).toBe(S.scoringV1);
    expect(pct(before)).toMatchObject({ strategic_fit: "25", financial_value: "25", customer_impact: "20" });
  });
});

// ================================================================================================ procedures

describe("A06 procedures (REQ-S06-001, REQ-S06-003)", () => {
  const PROC = "qa_a06_readiness_review";
  const step = (stepKey: string, ordinal: number, extra: Body = {}) => ({
    stepKey,
    ordinal,
    stepKind: "task",
    nameEn: `Synthetic step ${stepKey}`,
    nameAr: `خطوة تجريبية ${stepKey}`,
    responsibleRoleCode: "TL",
    slaWorkingDays: 5,
    ...extra,
  });
  const definition = (): Body => ({
    nameEn: "Synthetic A06 readiness review",
    nameAr: "مراجعة جاهزية تجريبية",
    purposeEn: "Synthetic purpose: review readiness before rollout",
    purposeAr: "غرض تجريبي: مراجعة الجاهزية قبل الإطلاق",
    trigger: {
      kind: "manual",
      event: null,
      descriptionEn: "Launched by the Transformation Lead",
      descriptionAr: "يطلقه قائد التحول",
    },
    scope: { level: "transformation", descriptionEn: "One transformation", descriptionAr: "تحول واحد" },
    inputSchema: [
      { key: "urgent", fieldType: "text", labelEn: "Urgent (yes/no)", labelAr: "عاجل (نعم/لا)", required: true },
    ],
    launchRoleCodes: ["TL"],
    responsibleRoleCodes: ["TL"],
    slaWorkingDays: 10,
    validationRulesEn: "Synthetic: the urgent input is required",
    validationRulesAr: "تجريبي: إدخال الاستعجال مطلوب",
    approval: { mode: "none", roleCodes: [] },
    escalation: null,
    expectedOutputsEn: "Synthetic readiness note",
    expectedOutputsAr: "ملاحظة جاهزية تجريبية",
    completion: { rule: "all_steps_closed", descriptionEn: "Every step closed", descriptionAr: "إغلاق جميع الخطوات" },
    effectiveFrom: "2026-01-01",
    steps: [
      step("prepare", 1),
      step("check_people", 2, { parallelGroup: "checks" }),
      step("check_process", 2, { parallelGroup: "checks" }),
      step("escalate", 3, { condition: { inputKey: "urgent", operator: "eq", value: "yes" } }),
      step("close_out", 4),
    ],
  });

  it("REQ-S06-003: the ten seeded procedures are published", async () => {
    const r = expectStatus(await send("GET", "/api/v1/procedure-definitions", lead), 200);
    expect((r.items as Body[]).length).toBe(10);
  });

  it("REQ-S06-001: a definition missing a trigger or a completion condition is rejected", async () => {
    const base = (
      expectStatus(await send("GET", `${V}?kind=procedure&status=published`, adm), 200).items as Body[]
    ).find((v) => v.isNewestPublished);
    expect(base, "a published procedures version").toBeTruthy();
    const d = await newDraft(base.id, "Synthetic A06: readiness review procedure");
    S.procV2 = d.id;
    const putDef = async (body: Body) => {
      const cur = await versionOf(d.id);
      return send("PUT", `/api/v1/admin/procedure-definitions/${d.id}/${PROC}`, adm, body, ifm(cur.version));
    };
    const { trigger: _t, ...noTrigger } = definition();
    expectCode(await putDef(noTrigger), 422, "procedure_definition.trigger_required");
    const { completion: _c, ...noCompletion } = definition();
    expectCode(await putDef(noCompletion), 422, "procedure_definition.completion_required");
    expectStatus(await putDef(definition()), [200, 201]);
  });

  it("REQ-S06-001/REQ-S06-004: the procedure with a parallel and a conditional step publishes and runs on a new transformation", async () => {
    await runPipeline(S.procV2!, "procedure");
    const tx = await newTransformation("Synthetic A06 transformation running the new procedure");
    const launched = await send("POST", "/api/v1/procedure-instances", lead, {
      procedureCode: PROC,
      transformationId: tx,
      inputValues: { urgent: "no" },
    });
    let inst = expectStatus(launched, 201);
    const statuses = (b: Body) => Object.fromEntries((b.steps as Body[]).map((x) => [x.stepKey, x.status]));
    expect(statuses(inst)).toMatchObject({ prepare: "active", check_people: "pending", check_process: "pending" });
    const complete = async (key: string) => {
      const cur = expectStatus(await send("GET", `/api/v1/procedure-instances/${inst.id}`, lead), 200);
      const r = await send(
        "POST",
        `/api/v1/procedure-instances/${inst.id}/steps/${key}/complete`,
        lead,
        { note: "Synthetic done" },
        ifm(cur.version),
      );
      return expectStatus(r, 200);
    };
    inst = await complete("prepare");
    // parallel: both steps of the group are active at once
    expect(statuses(inst)).toMatchObject({ check_people: "active", check_process: "active" });
    inst = await complete("check_people");
    expect(statuses(inst).close_out).toBe("pending");
    inst = await complete("check_process");
    // conditional: urgent = no -> the escalation step does not apply
    expect(statuses(inst)).toMatchObject({ escalate: "not_applicable", close_out: "active" });
    inst = await complete("close_out");
    expect(inst.status).toBe("completed");
  });
});

// ================================================================================================ automation dry run

describe("A06 automation builder (REQ-S12-002): a dry run creates no tasks", () => {
  it("a dry run of an admin rule plans its action and writes no work item or notification", async () => {
    const rule = await send("POST", "/api/v1/admin/automation-rules", adm, {
      code: "qa.a06.g2_follow_up",
      nameEn: "Synthetic A06 follow-up on G2 submission",
      nameAr: "متابعة تجريبية عند تقديم البوابة 2",
      scopeLevel: "organization",
      organizationId: w.orgA.id,
      ownerUserId: admId,
      content: {
        triggerCodes: ["gate.submitted"],
        conditions: [{ field: "gateCode", op: "eq", value: "G2" }],
        actions: [
          { type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.review_needed" } },
        ],
        runAs: "service",
      },
    });
    const r = expectStatus(rule, 201);
    // the suite's PRIVATE scratch database: no other suite writes here, so whole-table counts are exact
    const count = async () => ({
      work: Number(
        (
          await api.db
            .selectFrom("work_item")
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .executeTakeFirstOrThrow()
        ).n,
      ),
      notes: Number(
        (
          await api.db
            .selectFrom("inbox_notification")
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .executeTakeFirstOrThrow()
        ).n,
      ),
    });
    const before = await count();
    const dry = await send("POST", `/api/v1/admin/automation-rules/${r.id}/versions/1/dry-runs`, adm, {
      triggerCode: "gate.submitted",
      payload: await g2SubmittedSample(),
    });
    const body = expectStatus(dry, 201);
    expect(body.conditionsMet).toBe(true);
    expect((body.plannedActions as Body[]).map((a) => [a.actionType, a.outcome])).toEqual([
      ["create_task", "would_run"],
    ]);
    expect(await count()).toEqual(before);
  });
});

/** A synthetic gate.submitted v1 sample built from the existing transformation's real G2 submission. */
async function g2SubmittedSample(): Promise<Body> {
  const sub = await api.db
    .selectFrom("gate_submission")
    .selectAll()
    .where("transformation_id", "=", gw.transformationId)
    .where("gate_code", "=", "G2")
    .orderBy("submission_no", "desc")
    .executeTakeFirstOrThrow();
  const row = sub as Body;
  return {
    gateInstanceId: row.gate_instance_id,
    transformationId: gw.transformationId,
    gateCode: "G2",
    submissionId: row.id,
    submissionNo: row.submission_no,
    snapshotSha256: "0".repeat(64),
    approverRoleCode: "SP",
    approverUserId: null,
    submittedBy: gw.tl.id,
    supersededSubmissionId: null,
  };
}

// ================================================================================================ branding

describe("A06 branding (REQ-S01-002): the product name is configuration", () => {
  it("a fresh install shows 'Mobily Transformation Hub'; a saved name is served at once without a code change", async () => {
    const tech = await signIn(api.app, w.admin.subject); // ADM_TECH @ org A
    const fresh = expectStatus(await send("GET", "/api/v1/branding", lead), 200);
    expect([fresh.versionNo, fresh.source, fresh.productNameEn]).toEqual([0, "default", "Mobily Transformation Hub"]);
    const cur = expectStatus(await send("GET", "/api/v1/admin/branding", tech), 200);
    const put = await send(
      "PUT",
      "/api/v1/admin/branding",
      tech,
      {
        productNameEn: "Synthetic QA Hub",
        productNameAr: "منصة الاختبار التجريبية",
        primaryColour: cur.primaryColour,
        secondaryColour: cur.secondaryColour,
        fontLatin: cur.fontLatin,
        fontArabic: cur.fontArabic,
        logo: { mode: "keep" },
      },
      ifm(cur.version),
    );
    expectStatus(put, 200);
    const after = expectStatus(await send("GET", "/api/v1/branding", lead), 200);
    expect([after.source, after.productNameEn, after.productNameAr]).toEqual([
      "configured",
      "Synthetic QA Hub",
      "منصة الاختبار التجريبية",
    ]);
    // BO cannot change branding
    const denied = await send("PUT", "/api/v1/admin/branding", bo, { productNameEn: "x" }, ifm(after.versionNo));
    expect([400, 403]).toContain(denied.status);
  });
});
