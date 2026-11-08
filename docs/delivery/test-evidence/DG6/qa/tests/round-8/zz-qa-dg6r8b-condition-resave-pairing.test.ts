// qa-verifier DG6 round 8 (T-DG6-REV-QA-R8, run d340cd64) on candidate 6cda8b33 (source d84d11a6): independent probe,
// NOT part of the frozen candidate. Copied into a disposable clone as
// apps/api/test/integration/access/zz-qa-dg6r8b-condition-resave-pairing.test.ts and run with tests/qa/support/with-pg.sh.
// Question (D-222 (2): "a re-save keeps the hidden literal unchanged"; ADR-0051 amendment, keepRestrictedLiterals pairs
// the k-th (field, op) condition of the request with the k-th stored one): what does the server store when the author,
// who sees markers, removes or reorders conditions?
//   P1: two restricted literals under one (field, op); the author deletes the FIRST and saves.
//   P2: a visible literal then a restricted one under one (field, op); the author deletes the visible one and saves.
//   P3: an `in` list of two restricted literals; the author removes the first element and saves.
//   P0 (control): the author changes only an unrelated condition; both hidden literals are kept.
// Each case logs the stored conditions; the assertions state the outcome D-222 requires (the remaining condition keeps
// ITS OWN hidden literal). Every value is SYNTHETIC; marking a record sensitive is an access decision, never a G1-G6
// business approval; nothing here relates to DG0-DG7.
import { AUTOMATION_RESTRICTED_LITERAL as M } from "@mth/shared/schemas";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, createUser, grant, seedWorld, signIn, startApi, type Res, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { launchedInitiative, pendingBenefit, seedClosureWorld, type ClosureWorld } from "../contract/p4-exercises-be-j.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let c: ClosureWorld;
let admin: { id: string; session: Session };
const H = { x: "", y: "", v: "" };
const R = "/api/v1/admin/automation-rules";
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(status);
  return res.body as Body;
};
const storedOf = async (ruleId: string) =>
  (
    (await api.db
      .selectFrom("automation_rule_version")
      .select(["conditions"])
      .where("automation_rule_id", "=", ruleId)
      .where("version_no", "=", 1)
      .executeTakeFirstOrThrow()) as { conditions: Body }
  ).conditions;

async function rule(conditions: Body[]): Promise<string> {
  const r = ok(
    await send("POST", R, {
      session: admin.session,
      body: {
        code: `qa.r8b.${randomUUID().slice(0, 8)}`,
        nameEn: "QA-R8 synthetic pairing probe",
        nameAr: "فحص اقتران تجريبي",
        scopeLevel: "organization",
        organizationId: c.b.organizationId,
        ownerUserId: admin.id,
        content: {
          triggerCodes: ["benefit.variance_evaluated"],
          conditions,
          actions: [{ type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } }],
          runAs: "service",
        },
      },
    }),
    201,
  );
  return r.id as string;
}

async function edit(ruleId: string, change: (conds: Body[]) => Body[], label: string) {
  const shown = ok(await send("GET", `${R}/${ruleId}/versions/1`, { session: admin.session }));
  const sent = change(shown.content.conditions);
  const saved = ok(
    await send("PATCH", `${R}/${ruleId}/versions/1`, {
      session: admin.session,
      headers: ifm(shown.version),
      body: { content: { ...shown.content, conditions: sent }, changeSummary: `QA-R8 ${label}` },
    }),
  );
  const now = await storedOf(ruleId);
  console.log(
    `QA-R8b ${label}: author saw ${JSON.stringify(shown.content.conditions)}; sent ${JSON.stringify(sent)}; ` +
      `stored now ${JSON.stringify(now)}; author response ${JSON.stringify(saved.content.conditions)} marker ${String(saved.includesRestrictedRecords)}`,
  );
  return { shown, now };
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
  const ini = await launchedInitiative(api.db, c.b);
  H.x = (await pendingBenefit(api, c, ini)).id;
  H.y = (await pendingBenefit(api, c, ini)).id;
  H.v = (await pendingBenefit(api, c, ini)).id; // stays visible
  const u = await createUser(api.db, c.b.organizationId);
  await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: c.b.organizationId }, c.b.organizationId);
  admin = { id: u.id, session: await signIn(api.app, u.subject) };
  for (const id of [H.x, H.y])
    ok(
      await send("PUT", `${c.b.base}/records/benefit/${id}/sensitivity`, {
        session: c.s.to.session,
        headers: ifm(0),
        body: { isSensitive: true, reason: "QA-R8 synthetic sensitive benefit" },
      }),
    );
  console.log(`QA-R8b ids: hidden X=${H.x} hidden Y=${H.y} visible V=${H.v}`);
}, 300_000);
afterAll(() => api?.close());

describe("QA-R8b: keepRestrictedLiterals when the author removes or reorders conditions (D-222 (2))", () => {
  it("P0 control: changing only an unrelated condition keeps both hidden literals", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
      { field: "severity", op: "eq", value: "high" },
    ]);
    const { shown, now } = await edit(id, (cs) => cs.map((x) => (x.field === "severity" ? { ...x, value: "critical" } : x)), "P0");
    expect(shown.content.conditions.slice(0, 2).map((x: Body) => x.value)).toEqual([M, M]);
    expect(now.map((x: Body) => x.value)).toEqual([H.x, H.y, "critical"]);
  });
  it("P1: two restricted literals under one (field, op); the author deletes the FIRST -> the remaining one should keep Y", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.x },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    const { now } = await edit(id, (cs) => cs.filter((_, i) => i !== 0), "P1 delete first restricted");
    expect(now.map((x: Body) => x.value), "the condition the author kept keeps its own literal (Y)").toEqual([H.y]);
  });
  it("P2: a visible literal then a restricted one; the author deletes the visible one -> the remaining one should keep Y", async () => {
    const id = await rule([
      { field: "benefitId", op: "neq", value: H.v },
      { field: "benefitId", op: "neq", value: H.y },
    ]);
    const { shown, now } = await edit(id, (cs) => cs.filter((_, i) => i !== 0), "P2 delete visible first");
    expect(shown.content.conditions.map((x: Body) => x.value)).toEqual([H.v, M]);
    expect(now.map((x: Body) => x.value), "the hidden literal survives the re-save").toEqual([H.y]);
  });
  it("P3: an `in` list of two restricted literals; the author removes the first element -> the list should keep [Y]", async () => {
    const id = await rule([{ field: "benefitId", op: "in", value: [H.x, H.y] }]);
    const { shown, now } = await edit(id, (cs) => cs.map((x) => ({ ...x, value: (x.value as string[]).slice(1) })), "P3 in-list drop first");
    expect(shown.content.conditions[0].value).toEqual([M, M]);
    expect(now[0].value, "the element the author kept keeps its own literal (Y)").toEqual([H.y]);
  });
});
