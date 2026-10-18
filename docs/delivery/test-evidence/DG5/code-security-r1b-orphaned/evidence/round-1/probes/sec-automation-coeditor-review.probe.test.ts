// code-security-reviewer DG5 round-1 probe (T-DG5-REV-SEC-R1B). NOT part of the candidate: copied into the disposable
// clone at apps/api/test/integration/automation/ and run there against a disposable PostgreSQL.
// Question: ADR-0043 §4 / 0074 automation_rule_version_review_sod: the reviewer is never the version's author. The
// check is on authored_by (the creator) only. User A (ADM_METHOD) creates a rule (v1 draft). User B (ADM_METHOD + TO,
// the dual role the shipped lifecycle test uses) rewrites the whole content, dry-runs, submits, reviews and publishes.
// Synthetic data only; a configuration review approves nothing in the business; nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

let api: TestApi;
let w: World;
let creator: Session;
let creatorId: string;
let both: Session;
let bothId: string;
let txA: string;
const R = "/api/v1/admin/automation-rules";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const a = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, a.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  creatorId = a.id;
  creator = await signIn(api.app, a.subject);
  const b = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, b.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  await grant(api.db, w.grantor.id, b.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  bothId = b.id;
  both = await signIn(api.app, b.subject);
  txA = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
}, 60_000);
afterAll(() => api.close());

const notify = (role: string) => ({ type: "notify", parameters: { recipientRole: role, messageKey: "automation.message.update_due" } });
const content = (gate: string, role: string) => ({
  triggerCodes: ["gate.decided"],
  conditions: [{ field: "gateCode", op: "eq", value: gate }],
  actions: [notify(role)],
  runAs: "service",
});
const sample = (transformationId: string, gateCode: string) => ({
  triggerCode: "gate.decided",
  payload: {
    gateInstanceId: crypto.randomUUID(),
    transformationId,
    gateCode,
    submissionId: crypto.randomUUID(),
    submissionNo: 1,
    gateDecisionId: crypto.randomUUID(),
    outcome: "approved",
    decidedBy: crypto.randomUUID(),
    nextPhase: null,
    scaleScopeItemIds: [],
    conditionIds: [],
  },
});

describe("SEC probe: automation rule version co-editor review", () => {
  it("B rewrites A's draft, then B submits, reviews and publishes it", async () => {
    const created = await call<Body>(api.app, "POST", R, {
      session: creator,
      body: {
        code: `test.${uniq("sec").toLowerCase()}`,
        nameEn: "Synthetic co-editor probe rule",
        nameAr: "قاعدة فحص تجريبية",
        scopeLevel: "organization",
        organizationId: w.orgA.id,
        ownerUserId: creatorId,
        content: content("G3", "TL"),
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const v1 = `${R}/${created.body.id as string}/versions/1`;
    const verOf = async () => (await call<Body>(api.app, "GET", v1, { session: both })).body.version as number;
    const patch = await call<Body>(api.app, "PATCH", v1, {
      session: both,
      headers: ifm(await verOf()),
      body: { content: content("G4", "SP"), changeSummary: "Rewritten by the co-editor (synthetic)" },
    });
    console.log("B PATCH", patch.status, patch.body?.code ?? "", "authoredBy", patch.body?.authoredBy, "creator", creatorId);
    expect(patch.status).toBe(200);
    const dr = await call<Body>(api.app, "POST", `${v1}/dry-runs`, { session: both, body: sample(txA, "G4") });
    console.log("B dry run", dr.status, dr.body?.outcome);
    const sub = await call<Body>(api.app, "POST", `${v1}/submit`, { session: both, headers: ifm(await verOf()) });
    console.log("B submit", sub.status, sub.body?.code ?? "", sub.body?.status);
    const rev = await call<Body>(api.app, "POST", `${v1}/review`, {
      session: both,
      headers: ifm(await verOf()),
      body: { outcome: "approve", note: "Co-editor approves own rewrite (synthetic)." },
    });
    console.log("B review", rev.status, rev.body?.code ?? "", rev.body?.status, "reviewedBy", rev.body?.reviewedBy, "B", bothId);
    let pub: Body = null;
    if (rev.status === 200) {
      pub = await call<Body>(api.app, "POST", `${v1}/publish`, { session: both, headers: ifm(await verOf()) });
      console.log("B publish", pub.status, pub.body?.code ?? "", pub.body?.status);
    }
    expect([rev.status, rev.body?.code]).toEqual([403, "automation_rule_version.self_review"]);
  });
});
