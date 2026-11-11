// code-security-reviewer DG6 round 7 (T-DG6-REV-CS-RG-R7, session 5fd9c5d0) on candidate 10f71f24 (source d8868b2a5).
// Independent probe, NOT part of the frozen candidate. Copied into a disposable clone as
// apps/api/test/integration/access/zz-sec-r7-dryrun-condition-oracle.test.ts and run with tests/qa/support/with-pg.sh.
//
// Question (assignment, D-228 (4) / D-229): can a rule author who is shown a restricted token instead of a hidden condition
// literal learn WHICH sensitive record the literal names through a served response other than the version read?
// Candidate channel: POST .../dry-runs returns `conditionsMet` for a sample event the author chooses. If the author already
// holds a candidate id, `conditionsMet` confirms or denies it (a 1-bit oracle). The probe records what happens for:
//   D1 sample benefitId = the hidden id X, D2 = a visible id V, D3 = a random uuid; also whether a hidden id in a sample
//   is refused like an unknown reference, and whether any dry-run response or list names X.
// Every value is SYNTHETIC; marking a record sensitive is an access decision, never a G1-G6 business approval; nothing
// here relates to DG0-DG7.
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
const H = { x: "", v: "" };
const R = "/api/v1/admin/automation-rules";
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(status);
  return res.body as Body;
};
const mark = async (id: string, on: boolean) => {
  const p = `${c.b.base}/records/benefit/${id}/sensitivity`;
  const cur = ok(await send("GET", p, { session: c.s.to.session }));
  ok(await send("PUT", p, { session: c.s.to.session, headers: ifm(cur.version), body: { isSensitive: on, reason: "SEC-R7 synthetic sensitivity" } }));
};
const sample = (benefitId: string) => ({
  triggerCode: "benefit.variance_evaluated",
  payload: {
    benefitId,
    measurementId: randomUUID(),
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
    plannedAmount: "1000000.00",
    measuredAmount: "850000.00",
    variance: "-150000.00",
    offTrack: true,
  },
});

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
  const ini = await launchedInitiative(api.db, c.b);
  H.x = (await pendingBenefit(api, c, ini)).id;
  H.v = (await pendingBenefit(api, c, ini)).id;
  const u = await createUser(api.db, c.b.organizationId);
  await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: c.b.organizationId }, c.b.organizationId);
  admin = { id: u.id, session: await signIn(api.app, u.subject) };
  console.log(`SEC-R7 ids: hidden X=${H.x} visible V=${H.v}`);
}, 300_000);
afterAll(() => api?.close());

describe("SEC-R7 dry-run conditionsMet as a membership oracle for a hidden condition literal", () => {
  it("records conditionsMet for X, V and a random id, and whether any response names X", async () => {
    const created = ok(
      await send("POST", R, {
        session: admin.session,
        body: {
          code: `sec.r7.${randomUUID().slice(0, 8)}`,
          nameEn: "SEC-R7 synthetic oracle probe",
          nameAr: "فحص تجريبي",
          scopeLevel: "organization",
          organizationId: c.b.organizationId,
          ownerUserId: admin.id,
          content: {
            triggerCodes: ["benefit.variance_evaluated"],
            // The author writes X while X is visible; X is then marked sensitive (the D-226 scenario: a record that
            // became hidden after the rule was written).
            conditions: [{ field: "benefitId", op: "eq", value: H.x }],
            actions: [{ type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } }],
            runAs: "service",
          },
        },
      }),
      201,
    );
    const v1 = `${R}/${created.id}/versions/1`;
    await mark(H.x, true);
    const shown = ok(await send("GET", v1, { session: admin.session }));
    console.log(`SEC-R7 author sees conditions ${JSON.stringify(shown.content.conditions)} includesRestrictedRecords=${String(shown.includesRestrictedRecords)}`);
    expect(JSON.stringify(shown).includes(H.x), "version read names X").toBe(false);
    const out: Record<string, unknown> = {};
    for (const [label, id] of [["X(hidden)", H.x], ["V(visible)", H.v], ["random", randomUUID()]] as const) {
      const res = await send("POST", `${v1}/dry-runs`, { session: admin.session, body: sample(id) });
      out[label] = { status: res.status, conditionsMet: res.body?.conditionsMet, outcome: res.body?.outcome, code: res.body?.code };
      console.log(`SEC-R7 dry run ${label}: ${JSON.stringify(out[label])}; response names X: ${JSON.stringify(res.body).includes(H.x)}`);
    }
    const list = ok(await send("GET", `${v1}/dry-runs`, { session: admin.session }));
    console.log(`SEC-R7 dry-run list names X: ${JSON.stringify(list).includes(H.x)}`);
    expect(JSON.stringify(list).includes(H.x), "dry-run list names X").toBe(false);
    console.log(`SEC-R7 RESULT ${JSON.stringify(out)}`);
  });
});
