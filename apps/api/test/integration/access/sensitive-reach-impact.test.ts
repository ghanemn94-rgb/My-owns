// A sensitive benefit in the change-impact preview and the frozen impact assessment (T-DG6-BE-Z5; F-DG6-300, which
// names workflows/impact.ts "read but not run"; ADR-0051 §2; REQ-S10-002 "a sensitive benefit is hidden from a
// workstream member without the grant"; M0188), against the run's disposable PostgreSQL. Every value is SYNTHETIC.
// Marking a record sensitive is an access decision, never a business approval (G1-G6); the change request is never
// approved here, and nothing touches DG0-DG7.
//
// The world of change-requests.test.ts: a KPI with a draft version, and a benefit that measures it (created by the TL,
// so the TL is a named party and admitted). A TO marks the benefit sensitive. Then:
//   - negative: AUD (no grant, not a named party) gets 404 on the benefit; the impact preview (draft and saved) and the
//     frozen assessment never show its id, code or title; the preview counts it in the contract's `hiddenItemCount`
//     ("affected records outside the caller's scope, never shown as 'no impact'"), so the verdict stays truthful;
//   - positive: the TL and the TO see the benefit's item, and `hiddenItemCount` is 0.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { person } from "../approvals/approval-world.ts";
import { benefitOn, kpiWithDraft, setupChangeWorld, type ChangeWorld } from "../workflows/change-fixtures.ts";
import { call, seedWorld, startApi, type Res, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let c: ChangeWorld;
let to: Session;
const TITLE = "Synthetic CONFIDENTIAL BE-Z5 NPS uplift";
const S = { benefitId: "", code: "", body: {} as Record<string, unknown>, crId: "" };
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: Res<Body>, status = 200) => {
  expect(res.status, JSON.stringify(res.body).slice(0, 600)).toBe(status);
  return res.body as Body;
};
const leaks = (body: unknown) => {
  const t = JSON.stringify(body);
  return [TITLE, S.benefitId, `${S.code} `].filter((n) => t.includes(n));
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const caller = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
  c = await setupChangeWorld(api, w, caller);
  to = (await person(api, w, c.transformationId, "TO")).session;
  const k = await kpiWithDraft(caller, c);
  S.benefitId = await benefitOn(caller, c, k.kpiId);
  const cur = ok(await send("GET", `${c.base}/benefits/${S.benefitId}`, { session: c.lead.session }));
  S.code = cur.code;
  ok(
    await send("PATCH", `${c.base}/benefits/${S.benefitId}`, {
      session: c.lead.session,
      headers: ifm(cur.version),
      body: { title: TITLE },
    }),
  );
  S.body = {
    changeKind: "target",
    subjectType: "kpi_definition",
    subjectId: k.kpiId,
    subjectVersion: k.kpiVersion,
    proposedRecordType: "kpi_version",
    proposedRecordId: k.v2.id,
    proposedChange: { targetValue: { from: "100", to: "120" } },
    reason: "Synthetic: a stretch target agreed by the business owner",
  };
  S.crId = ok(await send("POST", `${c.base}/change-requests`, { session: c.lead.session, body: S.body }), 201).id;
  ok(
    await send("PUT", `${c.base}/records/benefit/${S.benefitId}/sensitivity`, {
      session: to,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic commercially sensitive benefit" },
    }),
  );
}, 240_000);
afterAll(() => api?.close());

describe("ADR-0051 §2: a sensitive benefit in the change-impact preview (F-DG6-300)", () => {
  it("control: AUD gets 404 on the benefit; the TL (its creator) and the TO read it", async () => {
    expect((await send("GET", `${c.base}/benefits/${S.benefitId}`, { session: c.auditor.session })).status).toBe(404);
    for (const s of [c.lead.session, to])
      expect((await send("GET", `${c.base}/benefits/${S.benefitId}`, { session: s })).status).toBe(200);
  });

  it("the draft and saved previews omit the benefit for AUD and count it in hiddenItemCount", async () => {
    const draftUrl = `${c.base}/change-requests/impact-preview`;
    const savedUrl = `${c.base}/change-requests/${S.crId}/impact-preview`;
    for (const [what, run] of [
      ["draft", (s: Session) => send("POST", draftUrl, { session: s, body: S.body })],
      ["saved", (s: Session) => send("GET", savedUrl, { session: s })],
    ] as const) {
      const admitted = ok(await run(c.lead.session));
      const item = admitted.items.filter((i: Body) => i.recordId === S.benefitId);
      expect(
        item.map((i: Body) => i.label),
        `${what}: the TL sees the item`,
      ).toEqual([TITLE]);
      expect(admitted.hiddenItemCount).toBe(0);
      expect(ok(await run(to)).hiddenItemCount, `${what}: TO`).toBe(0);
      const aud = ok(await run(c.auditor.session));
      expect(leaks(aud), `${what}: AUD`).toEqual([]);
      expect(aud.items.length, `${what}: AUD`).toBe(admitted.items.length - 1);
      expect(aud.hiddenItemCount, `${what}: never shown as "no impact"`).toBe(1);
    }
  });

  it("the frozen assessment's items omit the benefit for AUD; the TL still sees it", async () => {
    ok(await send("POST", `${c.base}/change-requests/${S.crId}/submit`, { session: c.lead.session, headers: ifm(1) }));
    const url = `${c.base}/change-requests/${S.crId}/impact-assessments`;
    const tl = ok(await send("GET", url, { session: c.lead.session }));
    expect(JSON.stringify(tl)).toContain(TITLE);
    const aud = ok(await send("GET", url, { session: c.auditor.session }));
    expect(leaks(aud)).toEqual([]);
    const one = ok(
      await send("GET", `${c.base}/impact-assessments/${aud.items[0].id}`, { session: c.auditor.session }),
    );
    expect(leaks(one)).toEqual([]);
  });
});
