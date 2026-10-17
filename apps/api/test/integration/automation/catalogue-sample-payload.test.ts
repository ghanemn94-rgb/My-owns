// T-DG5-BE-C4 (D-164 d; BE-C3 handback §5.2; ADR-0043 §2, §4; REQ-S12-002) against a real PostgreSQL: the builder
// catalogue serves `AutomationTrigger.samplePayload` for every trigger that has a payload schema.
//  - every served samplePayload parses with its trigger's schema (outboxPayloadSchema(code, 1)); every event trigger
//    with a schema has one; no other trigger has one; the response matches the zod mirror;
//  - the transformationId of a sample is the documented placeholder, and the contract says so;
//  - the gate.submitted sample, with transformationId replaced by a transformation of the rule's organization, gives
//    a 201 dry run.
// All data is synthetic; a dry run writes only its own record and approves nothing (no G1-G6 business approval, no
// engineering gate DG0-DG7).
import { readFileSync } from "node:fs";
import { automationCatalogue, outboxPayloadSchema } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
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
let author: Session;
let authorId: string;
let txA: string;

const R = "/api/v1/admin/automation-rules";
const CAT = "/api/v1/admin/automation-catalogue";
const PLACEHOLDER = "00000000-0000-7000-8000-000000000000";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  authorId = u.id;
  author = await signIn(api.app, u.subject);
  txA = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
}, 60_000);
afterAll(() => api.close());

const spec = parseYaml(readFileSync(new URL("../../../../../docs/api/openapi.yaml", import.meta.url), "utf8")) as Body;

async function catalogue(): Promise<Body> {
  const res = await call<Body>(api.app, "GET", CAT, { session: author });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(automationCatalogue.safeParse(res.body).success).toBe(true);
  return res.body;
}

describe("D-164 (d): AutomationTrigger.samplePayload", () => {
  it("the contract documents the optional member and its placeholder", () => {
    const component = spec.components.schemas.AutomationTrigger;
    expect(component.required).not.toContain("samplePayload");
    expect(component.properties.samplePayload.type).toBe("object");
    expect(component.properties.samplePayload.description).toContain(PLACEHOLDER);
    expect(component.properties.samplePayload.description).toContain(
      "replaced by the builder with the selected transformation",
    );
  });

  it("every served samplePayload parses with its trigger's schema; every trigger with a schema has one", async () => {
    const triggers = (await catalogue()).triggers as Body[];
    const rows = await api.db.selectFrom("automation_trigger").select(["code", "trigger_kind"]).execute();
    expect(triggers.map((t) => t.code).sort()).toEqual(rows.map((r) => r.code).sort());
    let served = 0;
    for (const t of triggers) {
      const schema = t.triggerKind === "event" ? outboxPayloadSchema(t.code, 1) : null;
      if (schema === null) {
        expect(t.samplePayload, t.code).toBeUndefined();
        continue;
      }
      expect(t.samplePayload, t.code).toBeDefined();
      const parsed = schema.safeParse(t.samplePayload);
      expect(parsed.success, `${t.code}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      if ("transformationId" in t.samplePayload) expect(t.samplePayload.transformationId, t.code).toBe(PLACEHOLDER);
      served += 1;
    }
    // gate.submitted, gate.decided and the KPI, benefit, check, blocker, procedure and job events of 0074/0075.
    expect(served).toBeGreaterThanOrEqual(15);
    // T-DG5-BE-T5 (D-167): dependency.slipped v1 is registered, so its trigger has a sample too.
    for (const code of ["gate.submitted", "gate.decided", "procedure_step.activated", "dependency.slipped"])
      expect(triggers.find((t) => t.code === code)?.samplePayload, code).toBeDefined();
    for (const code of ["automation.tick_daily", "gate.submission_requested"])
      expect(triggers.find((t) => t.code === code)?.samplePayload, code).toBeUndefined();
  });

  it("the gate.submitted sample, its transformationId replaced by one of the rule's organization, dry-runs 201", async () => {
    const sample = ((await catalogue()).triggers as Body[]).find((t) => t.code === "gate.submitted").samplePayload;
    const rule = await call<Body>(api.app, "POST", R, {
      session: author,
      body: {
        code: `test.${uniq("sp").toLowerCase()}`,
        nameEn: "Synthetic catalogue sample rule",
        nameAr: "قاعدة تجريبية لعينة الفهرس",
        scopeLevel: "organization",
        organizationId: w.orgA.id,
        ownerUserId: authorId,
        content: {
          triggerCodes: ["gate.submitted"],
          conditions: [{ field: "gateCode", op: "eq", value: "G3" }],
          actions: [
            { type: "notify", parameters: { recipientRole: "TL", messageKey: "automation.message.update_due" } },
          ],
          runAs: "service",
        },
      },
    });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const res = await call<Body>(api.app, "POST", `${R}/${rule.body.id as string}/versions/1/dry-runs`, {
      session: author,
      body: { triggerCode: "gate.submitted", payload: { ...sample, transformationId: txA } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.conditionsMet).toBe(true);
  });
});
