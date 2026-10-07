// P3 contract exercises of BE-A (T-DG3-BE-A; p3-work-split §5): readiness, the outcome hierarchy and the four gate
// dispensation operations. Every call goes through `ctx.mirrored` (OpenAPI status/body/headers + problem mirror), and
// every success body is parsed with the portfolio zod mirror listed in P3_MIRRORS_BE_A. All data is synthetic; the
// waiver accepted below is a demo business decision by a synthetic Sponsor and approves nothing real (it never creates
// a gate decision, and nothing here touches the engineering gates DG0-DG7).
import { gateDispensation, gateDispensationPage, outcomeHierarchy, transformationReadiness } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";
import type { P3ExerciseContext } from "../../support/harness.ts";

export const P3_MIRRORS_BE_A: Readonly<Record<string, z.ZodType>> = {
  getTransformationReadiness: transformationReadiness,
  getOutcomeHierarchy: outcomeHierarchy,
  listGateDispensations: gateDispensationPage,
  createGateDispensation: gateDispensation,
  decideGateDispensation: gateDispensation,
  revokeGateDispensation: gateDispensation,
};

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export async function exerciseP3BeAOperations(ctx: P3ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const p = await setupP2World(ctx.api, ctx.world, m);
  const T = `/api/v1/transformations/${p.transformationId}`;

  const readiness = await m("GET", `${T}/readiness`, { session: p.lead.session });
  expect(readiness.status).toBe(200);
  expect(readiness.body.missingDiagnosticAreas).toEqual([
    "economics",
    "customer",
    "operations",
    "capability",
    "technology",
  ]);
  const hierarchy = await m("GET", `${T}/outcome-hierarchy`, { session: p.auditor.session });
  expect([hierarchy.status, hierarchy.body.northStar]).toEqual([200, null]);

  // A waiver of G3 (End-to-End launch sequencing): recorded by the lead, accepted by the Sponsor (G3's approver).
  const created = await m("POST", `${T}/gate-dispensations`, {
    session: p.lead.session,
    body: { kind: "waiver", gateCode: "G3", reason: "Synthetic: pilot may launch before G3.", expiresOn: inDays(30) },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  // The read-only auditor never records one (403); a stale If-Match is 409; none at all is 428.
  expect(
    (
      await m("POST", `${T}/gate-dispensations`, {
        session: p.auditor.session,
        body: { kind: "waiver", gateCode: "G3", reason: "Synthetic", expiresOn: inDays(30) },
      })
    ).status,
  ).toBe(403);
  const D = `${T}/gate-dispensations/${created.body.id}`;
  expect((await m("POST", `${D}/decision`, { session: p.sponsor.session, body: { result: "accepted" } })).status).toBe(
    428,
  );
  expect(
    (await m("POST", `${D}/decision`, { session: p.sponsor.session, headers: ifm(9), body: { result: "accepted" } }))
      .status,
  ).toBe(409);
  const accepted = await m("POST", `${D}/decision`, {
    session: p.sponsor.session,
    headers: ifm(created.body.version),
    body: { result: "accepted", note: "Synthetic demo acceptance." },
  });
  expect([accepted.status, accepted.body.counts]).toEqual([200, true]);
  const listed = await m("GET", `${T}/gate-dispensations?limit=5`, { session: p.auditor.session });
  expect(listed.body.items.map((d: { id: string }) => d.id)).toEqual([created.body.id]);
  const revoked = await m("POST", `${D}/revoke`, {
    session: p.sponsor.session,
    headers: ifm(accepted.body.version),
    body: { reason: "Synthetic: revoked for the contract test." },
  });
  expect([revoked.status, revoked.body.status, revoked.body.counts]).toEqual([200, "revoked", false]);
  // Revoking again is not a legal transition.
  expect(
    (
      await m("POST", `${D}/revoke`, {
        session: p.sponsor.session,
        headers: ifm(revoked.body.version),
        body: { reason: "Synthetic again." },
      })
    ).status,
  ).toBe(422);
}
