// P5 contract exercises of KBE-E2 (p5-work-split §G.2 and §2 rule 14; T-DG5-KBE-E2): decideKpiRestatement and
// listKpiRestatementReissueOffers, each with a success and every declared refusal it can reach, through the validating
// client. Every value is synthetic; the one approval below is made by a synthetic Business Owner through the API, a
// demo business approval that approves nothing real, and nothing touches the engineering gates DG0-DG7.
//
// Declared but not reachable here: 401 (the identity hook's own suite); 429 (the rate limiter's own suite); 403 on the
// offers read (every caller who can see a transformation holds transformation.read, so a caller who cannot gets 404).
// The periods are quarterly of 2076 (no other exercise uses that year, and the quarterly frequency is slice G's own).
import { kpiRestatement, kpiRestatementReissueOfferList } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { ifMatch, seedKpiWorld } from "../kpi/fixtures.ts";
import { issuedKpiRegister, runRestatementEvents } from "../kpi-restatements/decision-fixtures.ts";
import { acceptedActual, quarter, quarterlyKpi, stepQuarter } from "../kpi-restatements/fixtures.ts";

export const P5_MIRRORS_KBE_E2: Readonly<Record<string, z.ZodType>> = {
  decideKpiRestatement: kpiRestatement,
  listKpiRestatementReissueOffers: kpiRestatementReissueOfferList,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export async function exerciseP5KbeE2Operations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored: m } = ctx;
  const code = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];
  const k = await seedKpiWorld(api, w);
  const office = await signIn(api.app, w.office.subject);
  const missing = crypto.randomUUID();

  // Fixtures: Q1 closed with an accepted, evaluated value; Q2 open. A KPI register issued while Q1 showed 90.
  const q1 = await quarter(api, w, 2076, 1, office);
  const q2 = await quarter(api, w, 2076, 2, office);
  const kpi = await quarterlyKpi(api, k);
  await stepQuarter(api, w, q1, "open", office);
  await acceptedActual(api, k, kpi.id, q1, "90");
  await stepQuarter(api, w, q1, "close", office);
  await stepQuarter(api, w, q2, "open", office);
  await issuedKpiRegister(api, k);

  // Two submitted restatements in turn: one rejected (FIN+KDS requester), then one approved.
  const submitted = async () => {
    const c = await m("POST", `${k.base}/kpi-definitions/${kpi.id}/restatements`, {
      session: k.s.finKds,
      body: { kpiVersionId: kpi.v1.id, reportingPeriodIds: [q1.id], reason: "Synthetic: a corrected source extract" },
    });
    expect(c.status).toBe(201);
    const id = (c.body as Body).id as string;
    const s = await m("POST", `${k.base}/kpi-restatements/${id}/submit`, { session: k.s.finKds, headers: ifMatch(1) });
    expect(s.status).toBe(200);
    return id;
  };
  const first = await submitted();
  const D = (id: string) => `${k.base}/kpi-restatements/${id}/decision`;
  const approve = { decision: "approve" };

  // decideKpiRestatement: 400; 428; 404; 409; 403 (no authority: AUD, TL; the requester); 422 (note); 200; 422.
  expect(
    (await m("POST", D(first), { session: k.s.bo, headers: ifMatch(2), body: { decision: "maybe" } })).status,
  ).toBe(400);
  expect(
    (await m("POST", D(first), { session: k.s.bo, headers: ifMatch(2), body: { decision: "reject", note: "" } }))
      .status,
  ).toBe(400);
  expect(code(await m("POST", D(first), { session: k.s.bo, body: approve }))).toEqual([428, "precondition_required"]);
  expect((await m("POST", D(missing), { session: k.s.bo, headers: ifMatch(2), body: approve })).status).toBe(404);
  expect((await m("POST", D(first), { session: k.s.outsider, headers: ifMatch(2), body: approve })).status).toBe(403);
  expect(code(await m("POST", D(first), { session: k.s.bo, headers: ifMatch(7), body: approve }))).toEqual([
    409,
    "version_conflict",
  ]);
  for (const s of [k.s.auditor, k.s.tl])
    expect(code(await m("POST", D(first), { session: s, headers: ifMatch(2), body: approve }))).toEqual([
      403,
      "kpi_restatement.no_authority",
    ]);
  expect(code(await m("POST", D(first), { session: k.s.finKds, headers: ifMatch(2), body: approve }))).toEqual([
    403,
    "kpi_restatement.self_decision",
  ]);
  expect(
    code(await m("POST", D(first), { session: k.s.bo, headers: ifMatch(2), body: { decision: "reject" } })),
  ).toEqual([422, "kpi_restatement.note_required"]);
  const rejected = await m("POST", D(first), {
    session: k.s.bo,
    headers: ifMatch(2),
    body: { decision: "reject", note: "Synthetic: the extract is not final" },
  });
  expect([rejected.status, (rejected.body as Body).status]).toEqual([200, "rejected"]);
  expect(code(await m("POST", D(first), { session: k.s.bo, headers: ifMatch(3), body: approve }))).toEqual([
    422,
    "kpi_restatement.not_submitted",
  ]);

  const second = await submitted();
  const approved = await m("POST", D(second), { session: k.s.bo, headers: ifMatch(2), body: approve });
  expect([approved.status, (approved.body as Body).status, (approved.body as Body).authorityRoleCode]).toEqual([
    200,
    "approved",
    "BO",
  ]);

  // listKpiRestatementReissueOffers: 200 (none before the run; one after it); 400; 404.
  const O = (id: string) => `${k.base}/kpi-restatements/${id}/reissue-offers`;
  const none = await m("GET", O(second), { session: k.s.auditor });
  expect([none.status, (none.body as Body).items]).toEqual([200, []]);
  expect((await runRestatementEvents(api, second)).map((r) => r.outcome)).toEqual(["done"]);
  const offers = await m("GET", O(second), { session: k.s.auditor });
  expect(offers.status).toBe(200);
  expect((offers.body as Body).items.map((o: Body) => [o.definitionCode, o.issueVersion, o.snapshotStatus])).toEqual([
    ["registers", 1, "issued"],
  ]);
  expect(
    (await m("GET", `${k.base}/kpi-restatements/not-a-uuid/reissue-offers`, { session: k.s.auditor })).status,
  ).toBe(400);
  expect((await m("GET", O(missing), { session: k.s.auditor })).status).toBe(404);
  expect((await m("GET", O(second), { session: k.s.outsider })).status).toBe(404);
}
