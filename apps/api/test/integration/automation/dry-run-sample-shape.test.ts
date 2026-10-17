// T-DG5-BE-C3 (D-163; QA-A O-1; ADR-0043 §4 "evaluates the draft against a sample event (validated against the
// trigger's payload schema)"; REQ-S12-002) against a real PostgreSQL: the dry-run sample of an event trigger with an
// outbox payload schema is the COMPLETE event payload, and the contract says so:
//  - the OpenAPI AutomationDryRunRequest description names the complete payload, and its example is a valid
//    gate.submitted v1 payload (the 10 members of the outbox schema) that the server accepts (201);
//  - a sample carrying only the catalogue's condition fields for gate.submitted is refused 422
//    automation.dry_run_sample_invalid with the ADR-0043 §9 text, and nothing is written.
// All data is synthetic; a dry run writes only its own record and approves nothing (no G1-G6 business approval, no
// engineering gate DG0-DG7).
import { readFileSync } from "node:fs";
import { outboxPayloadSchema } from "@mth/shared/schemas";
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
const component = spec.components.schemas.AutomationDryRunRequest;

async function gateSubmittedRule(): Promise<string> {
  const res = await call<Body>(api.app, "POST", R, {
    session: author,
    body: {
      code: `test.${uniq("ds").toLowerCase()}`,
      nameEn: "Synthetic dry-run sample rule",
      nameAr: "قاعدة تجريبية لعينة التشغيل التجريبي",
      scopeLevel: "organization",
      organizationId: w.orgA.id,
      ownerUserId: authorId,
      content: {
        triggerCodes: ["gate.submitted"],
        conditions: [{ field: "gateCode", op: "eq", value: "G3" }],
        actions: [{ type: "notify", parameters: { recipientRole: "TL", messageKey: "automation.message.update_due" } }],
        runAs: "service",
      },
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return `${R}/${res.body.id as string}/versions/1`;
}
const dryRun = (versionUrl: string, body: unknown) =>
  call<Body>(api.app, "POST", `${versionUrl}/dry-runs`, { session: author, body });
const dryRunCount = async () =>
  (
    await api.db
      .selectFrom("automation_dry_run")
      .select((e) => e.fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow()
  ).n;

describe("QA-A O-1: the dry-run sample of gate.submitted is the complete outbox payload (ADR-0043 §4)", () => {
  it("the contract describes the complete payload and its example is a valid gate.submitted v1 payload", () => {
    expect(component.description).toContain("COMPLETE event payload");
    expect(component.description).toContain("not only the trigger's conditionFields");
    expect(component.description).toContain("automation.dry_run_sample_invalid");
    const [example] = component.examples as Body[];
    expect(example.triggerCode).toBe("gate.submitted");
    expect(Object.keys(example.payload)).toHaveLength(10);
    const schema = outboxPayloadSchema("gate.submitted", 1);
    expect(schema).not.toBeNull();
    expect(schema!.safeParse(example.payload).success).toBe(true);
  });

  it("the server accepts the documented sample (201) and refuses the condition fields alone (422, nothing written)", async () => {
    const v1 = await gateSubmittedRule();
    const trigger = await api.db
      .selectFrom("automation_trigger")
      .select(["condition_fields", "trigger_kind"])
      .where("code", "=", "gate.submitted")
      .executeTakeFirstOrThrow();
    expect(trigger.trigger_kind).toBe("event");

    // The catalogue's condition fields only (what the builder catalogue lists), with the transformation.
    const before = await dryRunCount();
    const fieldsOnly = Object.fromEntries([
      ["transformationId", txA],
      ...trigger.condition_fields.map((f) => [f, f === "gateCode" ? "G3" : "x"]),
    ]);
    const refused = await dryRun(v1, { triggerCode: "gate.submitted", payload: fieldsOnly });
    expect([refused.status, refused.body.code, refused.body.detail]).toEqual([
      422,
      "automation.dry_run_sample_invalid",
      "The sample event does not match the trigger's event fields.",
    ]);
    expect(await dryRunCount()).toBe(before);

    // The documented example, pointed at a transformation of the rule's organization.
    const [example] = component.examples as Body[];
    const accepted = await dryRun(v1, { ...example, payload: { ...example.payload, transformationId: txA } });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body.conditionsMet).toBe(true);
    expect(Number(await dryRunCount())).toBe(Number(before) + 1);
  });
});
