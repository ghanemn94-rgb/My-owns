// The T-DG4-BE-R5 A/B byte-stability transcript (the BE-M2 method, `response-transcript.ts`). It drives the existing
// operations this task changed (F-DG4-103: updateGate, submitGate, decideGate on G1, G5 and G6, with every refusal a
// caller can reach without a race; F-DG4-100: completeWorkItem) plus the gate reads, and asserts only what holds before
// and after the change. When MTH_BE_R5_TRANSCRIPT names a file, every response is recorded (status, ETag, Location,
// body without requestId; ids, instants and hashes normalized) for a `cmp` against a run on the base commit's source.
// Unset, it is an ordinary regression test that records nothing. No response is expected to differ: the commit-time
// re-check answers differently only when a grant or session changes during the request (gate-commit-time.test.ts),
// and the work-item denial adds an audit row, not a response byte.
// All data is SYNTHETIC. Every gate decision is a demo business decision by a test person that approves nothing real,
// and nothing here touches the engineering delivery gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkItemOnce } from "../../../src/modules/tasks/index.ts";
import {
  call,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { responseTranscript } from "../../support/response-transcript.ts";
import {
  coverGate,
  g5Approval,
  pendingGate,
  plusDays,
  requesterApprover,
  seedGateWorld,
  stageGates,
  todayOf,
  type GateWorld,
} from "../contract/p4-exercises-be-k.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

/**
 * `call`, with the fixture transformation's random code ("TX" + 6 hex, createTransformationRow) replaced by a fixed
 * placeholder in the returned body, so the A and B runs compare with `cmp`. Fixture data, not a response byte the
 * product chooses; the shared normalizer is left as it is so no earlier transcript hash changes.
 */
const masked = (async (...args: Parameters<typeof call>) => {
  const res = await call(...args);
  if (res.body === undefined) return res;
  return { ...res, body: JSON.parse(JSON.stringify(res.body).replace(/"TX[0-9A-F]{6}"/g, '"TX<fixture>"')) };
}) as typeof call;
const t = responseTranscript(masked, "MTH_BE_R5_TRANSCRIPT");
afterAll(() => t.flush());
const r = t.call;
const RATIONALE = "Synthetic demo decision; approves nothing real.";

const versionOf = async (g: GateWorld, code: string) =>
  (
    await api.db
      .selectFrom("gate_instance")
      .select("version")
      .where("transformation_id", "=", g.b.transformationId)
      .where("gate_code", "=", code)
      .executeTakeFirstOrThrow()
  ).version;
const statuses = (...res: { status: number }[]) => res.map((x) => x.status);

describe("A/B transcript (T-DG4-BE-R5): existing gate and work-item responses", () => {
  it("updateGate (G5, G6): 428, 409, AUD 403, ADM-only/outsider 404, 422 role not allowed, 200, 422 submission pending", async () => {
    const g = await seedGateWorld(api, w);
    const P = `${g.gates}/G5`;
    const body = { approverRoleCode: "BO" };
    const v = await versionOf(g, "G5");
    const noMatch = await r(api.app, "PATCH", P, { session: g.s.to.session, body });
    const stale = await r(api.app, "PATCH", P, { session: g.s.to.session, headers: ifm(v + 7), body });
    const aud = await r(api.app, "PATCH", P, { session: g.b.s.auditor, headers: ifm(v), body });
    const adm = await r(api.app, "PATCH", P, { session: g.b.s.admin, headers: ifm(v), body });
    const outsider = await r(api.app, "PATCH", P, { session: g.b.s.outsider, headers: ifm(v), body });
    const g6Bo = await r(api.app, "PATCH", `${g.gates}/G6`, {
      session: g.s.to.session,
      headers: ifm(await versionOf(g, "G6")),
      body,
    });
    const ok = await r(api.app, "PATCH", P, { session: g.s.to.session, headers: ifm(v), body });
    expect(statuses(noMatch, stale, aud, adm, outsider, g6Bo, ok)).toEqual([428, 409, 403, 404, 404, 422, 200]);
    await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
    await pendingGate(api, g, "G5");
    const pending = await r(api.app, "PATCH", P, {
      session: g.s.to.session,
      headers: ifm(await versionOf(g, "G5")),
      body: { approverRoleCode: "SP" },
    });
    expect(pending.status).toBe(422);
  });

  it("submitGate: G5 out of sequence 422 first; G1 201 with accepted exceptions; the G1 view", async () => {
    const g = await seedGateWorld(api, w);
    await coverGate((m, u, o) => call(api.app, m, u, o), g, "G1", plusDays(await todayOf(api, g), 30));
    const S = (code: string) => `${g.gates}/${code}/submissions`;
    const body = { submissionNote: "Synthetic submission" };
    const early = await r(api.app, "POST", S("G5"), {
      session: g.b.s.tl,
      headers: ifm(await versionOf(g, "G5")),
      body,
    });
    const g1 = await r(api.app, "POST", S("G1"), {
      session: g.b.s.tl,
      headers: ifm(await versionOf(g, "G1")),
      body,
    });
    expect(statuses(early, g1)).toEqual([422, 201]);
    await r(api.app, "GET", `${g.gates}/G1`, { session: g.b.s.auditor });
  });

  it("submitGate G5/G6 refusals: AUD 403, outsider 404, 428, 409, criteria incomplete, out of sequence", async () => {
    const g = await seedGateWorld(api, w);
    const S = (code: string) => `${g.gates}/${code}/submissions`;
    const body = { submissionNote: "Synthetic submission" };
    await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
    const v = await versionOf(g, "G5");
    const aud = await r(api.app, "POST", S("G5"), { session: g.b.s.auditor, headers: ifm(v), body });
    const outsider = await r(api.app, "POST", S("G5"), { session: g.b.s.outsider, headers: ifm(v), body });
    const noMatch = await r(api.app, "POST", S("G5"), { session: g.b.s.tl, body });
    const stale = await r(api.app, "POST", S("G5"), { session: g.b.s.tl, headers: ifm(v + 3), body });
    const incomplete = await r(api.app, "POST", S("G5"), { session: g.b.s.tl, headers: ifm(v), body });
    expect(statuses(aud, outsider, noMatch, stale, incomplete)).toEqual([403, 404, 428, 409, 422]);
    const g6 = await r(api.app, "POST", S("G6"), {
      session: g.b.s.tl,
      headers: ifm(await versionOf(g, "G6")),
      body,
    });
    expect(g6.status).toBe(422);
    await r(api.app, "GET", g.gates, { session: g.b.s.auditor });
  });

  it("decideGate G5: outsider 404, ADM-only/AUD/BO/submitter 403, 409 superseded, 422 scale scope, SP 201, then 409", async () => {
    const g = await seedGateWorld(api, w);
    await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
    const both = await requesterApprover(api, w, g);
    const no = await pendingGate(api, g, "G5", both.id);
    const D = `${g.gates}/G5/decision`;
    const decide = (session: Session, body: unknown) => r(api.app, "POST", D, { session, body });
    const outsider = await decide(g.b.s.outsider, g5Approval(g, no));
    const adm = await decide(g.b.s.admin, g5Approval(g, no));
    const aud = await decide(g.b.s.auditor, g5Approval(g, no));
    const bo = await decide(g.b.s.bo, g5Approval(g, no));
    const submitter = await decide(both.session, g5Approval(g, no));
    const superseded = await decide(g.sp.session, g5Approval(g, no + 1));
    const noScope = await decide(g.sp.session, { submissionNo: no, outcome: "approved", rationale: RATIONALE });
    const ok = await decide(g.sp.session, g5Approval(g, no));
    const again = await decide(g.sp.session, g5Approval(g, no));
    expect(statuses(outsider, adm, aud, bo, submitter, superseded, noScope, ok, again)).toEqual([
      404, 403, 403, 403, 403, 409, 422, 201, 409,
    ]);
    await r(api.app, "GET", `${g.gates}/G5`, { session: g.b.s.auditor });
    await r(api.app, "GET", `${g.gates}/G5/submissions/${no}`, { session: g.b.s.auditor });
  });

  it("decideGate G6: changes requested 201, then a second submission approved 201 by the Sponsor", async () => {
    const g = await seedGateWorld(api, w);
    await stageGates(api, g, ["G1", "G2", "G3", "G4", "G5"], "realize");
    const D = `${g.gates}/G6/decision`;
    const first = await pendingGate(api, g, "G6");
    const changes = await r(api.app, "POST", D, {
      session: g.sp.session,
      body: { submissionNo: first, outcome: "changes_requested", rationale: RATIONALE },
    });
    const second = await pendingGate(api, g, "G6");
    const approved = await r(api.app, "POST", D, {
      session: g.sp.session,
      body: { submissionNo: second, outcome: "approved", rationale: RATIONALE },
    });
    expect(statuses(changes, approved)).toEqual([201, 201]);
    await r(api.app, "GET", `${g.gates}/G6`, { session: g.b.s.auditor });
  });

  it("completeWorkItem: AUD 403 work_item.not_assignee, outsider 404, 428, 409, assignee 200, then 422 closed", async () => {
    const created = await api.db.transaction().execute((tx) =>
      createWorkItemOnce(
        tx,
        { actorType: "service", actorUserId: null, requestId: "job:be-r5", source: "worker" },
        {
          organizationId: w.orgA.id,
          kind: "kpi_update_due",
          assigneeUserId: w.office.id,
          subjectType: "kpi_definition",
          subjectId: crypto.randomUUID(),
          linkPath: "/kpi/synthetic",
          messageKey: "tasks.kpi_update_due",
          messageParams: { periodLabel: "2026-10", kpiName: "Synthetic KPI" },
          periodLabel: "2026-10",
          dedupeKey: uniq("kpi.period_open:"),
        },
      ),
    );
    const C = `/api/v1/work-items/${created.workItemId}/complete`;
    const office = await signIn(api.app, w.office.subject);
    const auditor = await signIn(api.app, w.auditor.subject);
    const officeB = await signIn(api.app, w.officeB.subject);
    const aud = await r(api.app, "POST", C, { session: auditor, headers: ifm(1) });
    const outsider = await r(api.app, "POST", C, { session: officeB, headers: ifm(1) });
    const noMatch = await r(api.app, "POST", C, { session: office });
    const stale = await r(api.app, "POST", C, { session: office, headers: ifm(4) });
    const done = await r(api.app, "POST", C, { session: office, headers: ifm(1) });
    const again = await r(api.app, "POST", C, { session: office, headers: ifm(2) });
    expect(statuses(aud, outsider, noMatch, stale, done, again)).toEqual([403, 404, 428, 409, 200, 422]);
  });
});
