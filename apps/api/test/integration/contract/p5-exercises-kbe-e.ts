// P5 contract exercises of KBE-E (p5-work-split §G.1 and §2 rule 14; T-DG5-KBE-E): the six KPI-restatement operations
// (list, create, get, reconciliation, submit, withdraw), each with a success and every declared refusal it can reach,
// through the validating client. Every value is synthetic; a restatement here is never decided (the decision is
// KBE-E2's), so nothing approves anything, and nothing touches the engineering gates DG0-DG7.
//
// Declared but not reachable here: 401 (the identity hook's own suite); 429 (the rate limiter's own suite); 403 on the
// reads (every caller who can see a transformation holds transformation.read, so a caller who cannot gets 404).
// The periods are quarterly of 2074 (no other exercise uses the quarterly frequency, so they never overlap).
import { kpiRestatement, kpiRestatementPage, kpiRestatementReconciliation } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { ifMatch, seedKpiWorld } from "../kpi/fixtures.ts";
import { postVersion } from "../kpi-p4/kbe-b-fixtures.ts";
import { acceptedActual, quarter, quarterlyKpi, RESTATED_FLOW, stepQuarter } from "../kpi-restatements/fixtures.ts";

export const P5_MIRRORS_KBE_E: Readonly<Record<string, z.ZodType>> = {
  listKpiRestatements: kpiRestatementPage,
  createKpiRestatement: kpiRestatement,
  getKpiRestatement: kpiRestatement,
  getKpiRestatementReconciliation: kpiRestatementReconciliation,
  submitKpiRestatement: kpiRestatement,
  withdrawKpiRestatement: kpiRestatement,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export async function exerciseP5KbeEOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored: m } = ctx;
  const code = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];
  const k = await seedKpiWorld(api, w);
  const office = await signIn(api.app, w.office.subject);
  const missing = crypto.randomUUID();

  // Fixtures: Q1 closed with an accepted, evaluated value; Q2 closed with none; Q3 open.
  const q1 = await quarter(api, w, 2074, 1, office);
  const q2 = await quarter(api, w, 2074, 2, office);
  const q3 = await quarter(api, w, 2074, 3, office);
  const kpi = await quarterlyKpi(api, k);
  await stepQuarter(api, w, q1, "open", office);
  await acceptedActual(api, k, kpi.id, q1, "90");
  await stepQuarter(api, w, q1, "close", office);
  await stepQuarter(api, w, q2, "open", office);
  await stepQuarter(api, w, q2, "close", office);
  await stepQuarter(api, w, q3, "open", office);
  const draft = await postVersion(api, k, kpi.id, {
    ...RESTATED_FLOW,
    targetValue: "120",
    changeReason: "Synthetic draft",
  });
  expect(draft.status).toBe(201);

  const L = `${k.base}/kpi-definitions/${kpi.id}/restatements`;
  const I = (id: string) => `${k.base}/kpi-restatements/${id}`;
  const body = (periods: string[], extra: Record<string, unknown> = {}) => ({
    kpiVersionId: kpi.v1.id,
    reportingPeriodIds: periods,
    reason: "Synthetic: a corrected source extract",
    ...extra,
  });

  // createKpiRestatement: 400; 403 (AUD); 404; 422 (version, periods, open period); 201; 409.
  expect((await m("POST", L, { session: k.s.kds, body: body([q1.id], { extra: 1 }) })).status).toBe(400);
  expect((await m("POST", L, { session: k.s.auditor, body: body([q1.id]) })).status).toBe(403);
  // Writes are authorized at commit time: a caller outside the transformation gets 403 (commitTimeDenial).
  expect((await m("POST", L, { session: k.s.outsider, body: body([q1.id]) })).status).toBe(403);
  expect(
    (await m("POST", `${k.base}/kpi-definitions/${missing}/restatements`, { session: k.s.kds, body: body([q1.id]) }))
      .status,
  ).toBe(404);
  expect(code(await m("POST", L, { session: k.s.kds, body: body([q1.id], { kpiVersionId: draft.body.id }) }))).toEqual([
    422,
    "kpi_restatement.version_not_approved",
  ]);
  expect(code(await m("POST", L, { session: k.s.kds, body: body([]) }))).toEqual([
    422,
    "kpi_restatement.periods_required",
  ]);
  expect(code(await m("POST", L, { session: k.s.kds, body: body([q3.id]) }))).toEqual([
    422,
    "kpi_restatement.period_not_closed",
  ]);
  // A draft whose period has no value: submit 422 nothing_to_reconcile; then withdrawn (draft -> withdrawn).
  const empty = await m("POST", L, { session: k.s.kds, body: body([q2.id]) });
  expect(empty.status).toBe(201);
  expect(code(await m("POST", L, { session: k.s.kds, body: body([q1.id]) }))).toEqual([
    409,
    "kpi_restatement.open_exists",
  ]);
  expect(code(await m("POST", `${I(empty.body.id)}/submit`, { session: k.s.kds, headers: ifMatch(1) }))).toEqual([
    422,
    "kpi_restatement.nothing_to_reconcile",
  ]);
  const w0 = await m("POST", `${I(empty.body.id)}/withdraw`, { session: k.s.kds, headers: ifMatch(1) });
  expect([w0.status, w0.body.status]).toEqual([200, "withdrawn"]);

  const created = await m("POST", L, { session: k.s.kds, body: body([q1.id]) });
  expect([created.status, created.body.status]).toEqual([201, "draft"]);
  const id = created.body.id as string;

  // listKpiRestatements: 200; 400; 404.
  const list = await m("GET", `${L}?limit=1`, { session: k.s.auditor });
  expect([list.status, list.body.items[0].id]).toEqual([200, id]);
  expect((await m("GET", `${L}?limit=0`, { session: k.s.auditor })).status).toBe(400);
  expect((await m("GET", L, { session: k.s.outsider })).status).toBe(404);

  // getKpiRestatement: 200; 400; 404.
  expect((await m("GET", I(id), { session: k.s.auditor })).status).toBe(200);
  expect((await m("GET", `${k.base}/kpi-restatements/not-a-uuid`, { session: k.s.auditor })).status).toBe(400);
  expect((await m("GET", I(missing), { session: k.s.auditor })).status).toBe(404);

  // getKpiRestatementReconciliation: 200 (draft preview); 400; 404.
  const preview = await m("GET", `${I(id)}/reconciliation`, { session: k.s.auditor });
  expect([preview.status, preview.body.retained, preview.body.rows.length]).toEqual([200, false, 2]);
  expect(
    (await m("GET", `${k.base}/kpi-restatements/not-a-uuid/reconciliation`, { session: k.s.auditor })).status,
  ).toBe(400);
  expect((await m("GET", `${I(missing)}/reconciliation`, { session: k.s.outsider })).status).toBe(404);

  // submitKpiRestatement: 400 (malformed If-Match); 403 (AUD); 404; 428; 409; 200; 422 (not_draft).
  const S = `${I(id)}/submit`;
  expect((await m("POST", S, { session: k.s.kds, headers: { "if-match": "nope" } })).status).toBe(400);
  expect((await m("POST", S, { session: k.s.auditor, headers: ifMatch(1) })).status).toBe(403);
  expect((await m("POST", `${I(missing)}/submit`, { session: k.s.kds, headers: ifMatch(1) })).status).toBe(404);
  expect((await m("POST", S, { session: k.s.kds })).status).toBe(428);
  expect((await m("POST", S, { session: k.s.kds, headers: ifMatch(5) })).status).toBe(409);
  const submitted = await m("POST", S, { session: k.s.kds, headers: ifMatch(1) });
  expect([submitted.status, submitted.body.status, submitted.body.version]).toEqual([200, "submitted", 2]);
  expect(code(await m("POST", S, { session: k.s.kds, headers: ifMatch(2) }))).toEqual([
    422,
    "kpi_restatement.not_draft",
  ]);
  const retained = await m("GET", `${I(id)}/reconciliation`, { session: k.s.auditor });
  expect([retained.body.retained, retained.body.rows]).toEqual([true, preview.body.rows]);

  // withdrawKpiRestatement: 400; 403 (AUD; a holder who is not the requester); 404; 428; 409; 200; 422.
  const W = `${I(id)}/withdraw`;
  expect((await m("POST", W, { session: k.s.kds, headers: { "if-match": "nope" } })).status).toBe(400);
  expect((await m("POST", W, { session: k.s.auditor, headers: ifMatch(2) })).status).toBe(403);
  expect(code(await m("POST", W, { session: k.s.bo, headers: ifMatch(2) }))).toEqual([403, "forbidden"]);
  expect((await m("POST", `${I(missing)}/withdraw`, { session: k.s.kds, headers: ifMatch(2) })).status).toBe(404);
  expect((await m("POST", W, { session: k.s.kds })).status).toBe(428);
  expect((await m("POST", W, { session: k.s.kds, headers: ifMatch(1) })).status).toBe(409);
  const withdrawn = await m("POST", W, { session: k.s.kds, headers: ifMatch(2) });
  expect([withdrawn.status, withdrawn.body.status]).toEqual([200, "withdrawn"]);
  expect(code(await m("POST", W, { session: k.s.kds, headers: ifMatch(3) }))).toEqual([
    422,
    "kpi_restatement.not_withdrawable",
  ]);
  const page = (await m("GET", L, { session: k.s.auditor })).body as Body;
  expect(page.items.map((r: Body) => r.status)).toEqual(["withdrawn", "withdrawn"]);
}
