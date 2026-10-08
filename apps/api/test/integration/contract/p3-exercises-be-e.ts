// P3 contract exercises: capacity, resource demand and funding decisions (BE-E; p3-work-split §5). Every operation of
// test/support/p3-pending-be-e.ts is exercised here through `ctx.mirrored` (the contract validator plus the zod mirror
// of the success body), with at least one success and the AUD 403 of every mutation. All data is SYNTHETIC; every
// funding decision is a demo business record that approves nothing real, and nothing touches DG0-DG7.
import { fundingDecision, fundingDecisionPage } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import {
  capacity,
  capacityPage,
  capacityPlan,
  resourceRole,
  resourceRoleList,
} from "../../../src/modules/portfolio/capacity.ts";
import { resourceDemand, resourceDemandPage } from "../../../src/modules/portfolio/resource-demands.ts";
import type { P3ExerciseContext } from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { setGateStatus } from "../portfolio/fixtures.ts";
import {
  addMeasurableContribution,
  createInitiative,
  makeDirection,
  stageRanked,
  type Send,
} from "./p3-exercises-be-b.ts";

/** operationId -> zod mirror of its success body (from @mth/shared/schemas and the capacity route files). */
export const P3_MIRRORS_BE_E: Readonly<Record<string, z.ZodType>> = {
  listResourceRoles: resourceRoleList,
  createResourceRole: resourceRole,
  updateResourceRole: resourceRole,
  listCapacity: capacityPage,
  createCapacity: capacity,
  getCapacity: capacity,
  updateCapacity: capacity,
  getCapacityPlan: capacityPlan,
  listResourceDemands: resourceDemandPage,
  createResourceDemand: resourceDemand,
  getResourceDemand: resourceDemand,
  updateResourceDemand: resourceDemand,
  commitResourceDemand: resourceDemand,
  releaseResourceDemand: resourceDemand,
  listFundingDecisions: fundingDecisionPage,
  createFundingDecision: fundingDecision,
  getFundingDecision: fundingDecision,
};

const ok = (res: { status: number; body: unknown }, status: number, what: string) => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 500)}`).toBe(status);
  // Test bodies are asserted structurally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return res.body as any;
};

/** A SELECTED initiative (G1 staged approved, submitted, ranked by fixture, selected by the sponsor). Synthetic. */
export async function selectedInitiative(
  api: P3ExerciseContext["api"],
  send: Send,
  p: P2World,
  over: Record<string, unknown> = {},
): Promise<string> {
  const d = await makeDirection(send, p);
  const ini = await createInitiative(send, p, over);
  await addMeasurableContribution(send, p, ini.id, d);
  const I = `/api/v1/initiatives/${ini.id}`;
  ok(
    await send("POST", `${I}/submit`, { session: p.lead.session, headers: ifm(ini.version), body: {} }),
    200,
    "submit",
  );
  await stageRanked(api, ini.id, p.lead.id);
  const v = (await api.db.selectFrom("initiative").select("version").where("id", "=", ini.id).executeTakeFirstOrThrow())
    .version;
  ok(
    await send("POST", `${I}/select`, {
      session: p.sponsor.session,
      headers: ifm(v),
      body: { rationale: "Synthetic demo selection; approves nothing real." },
    }),
    200,
    "select",
  );
  return ini.id;
}

export async function exerciseP3BeEOperations(ctx: P3ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const p = await setupP2World(ctx.api, ctx.world, m);
  await setGateStatus(ctx.api, p, "G1", "approved");
  const T = `/api/v1/transformations/${p.transformationId}`;
  const lead = p.lead.session;
  const aud = p.auditor.session;

  // Resource roles: create (AUD 403), list, update (428, 409, 200).
  expect(
    (await m("POST", `${T}/resource-roles`, { session: aud, body: { code: "x", labelEn: "X", labelAr: "س" } })).status,
  ).toBe(403);
  const role = ok(
    await m("POST", `${T}/resource-roles`, {
      session: lead,
      body: { code: "data_engineer", labelEn: "Data engineer", labelAr: "مهندس بيانات" },
    }),
    201,
    "createResourceRole",
  );
  expect(ok(await m("GET", `${T}/resource-roles`, { session: aud }), 200, "list").items).toHaveLength(1);
  const R = `${T}/resource-roles/${role.id}`;
  expect((await m("PATCH", R, { session: lead, body: { labelEn: "Data engineers" } })).status).toBe(428);
  expect((await m("PATCH", R, { session: lead, headers: ifm(9), body: { labelEn: "Data engineers" } })).status).toBe(
    409,
  );
  expect((await m("PATCH", R, { session: aud, headers: ifm(1), body: { labelEn: "Data engineers" } })).status).toBe(
    403,
  );
  expect(
    ok(await m("PATCH", R, { session: lead, headers: ifm(1), body: { labelEn: "Data engineers" } }), 200, "updateRole")
      .version,
  ).toBe(2);

  // Capacity: create (AUD 403), get, list, update.
  const capBody = {
    transformationId: p.transformationId,
    resourceRoleId: role.id,
    periodMonth: "2027-01-01",
    availableFte: "2.00",
  };
  expect((await m("POST", "/api/v1/capacity", { session: aud, body: capBody })).status).toBe(403);
  const cap = ok(await m("POST", "/api/v1/capacity", { session: lead, body: capBody }), 201, "createCapacity");
  expect(cap.availableFte).toBe("2.00");
  ok(await m("GET", `/api/v1/capacity/${cap.id}`, { session: aud }), 200, "getCapacity");
  expect(
    ok(await m("GET", `/api/v1/capacity?transformationId=${p.transformationId}`, { session: aud }), 200, "listCapacity")
      .items,
  ).toHaveLength(1);
  expect(
    (await m("PATCH", `/api/v1/capacity/${cap.id}`, { session: aud, headers: ifm(1), body: { availableFte: "1.50" } }))
      .status,
  ).toBe(403);
  expect(
    ok(
      await m("PATCH", `/api/v1/capacity/${cap.id}`, {
        session: lead,
        headers: ifm(1),
        body: { availableFte: "1.50" },
      }),
      200,
      "updateCapacity",
    ).availableFte,
  ).toBe("1.50");

  // Resource demand of a draft initiative: create (AUD 403), get, list, update, commit, release.
  const ini = await createInitiative(m, p);
  const demandBody = { initiativeId: ini.id, resourceRoleId: role.id, periodMonth: "2027-01-01", demandFte: "1.00" };
  expect((await m("POST", "/api/v1/resource-demands", { session: aud, body: demandBody })).status).toBe(403);
  const demand = ok(
    await m("POST", "/api/v1/resource-demands", { session: lead, body: demandBody }),
    201,
    "createDemand",
  );
  expect([demand.status, demand.demandFte, demand.version]).toEqual(["planned", "1.00", 1]);
  const D = `/api/v1/resource-demands/${demand.id}`;
  ok(await m("GET", D, { session: aud }), 200, "getDemand");
  expect(
    ok(
      await m("GET", `/api/v1/resource-demands?transformationId=${p.transformationId}&initiativeId=${ini.id}`, {
        session: aud,
      }),
      200,
      "listDemand",
    ).items,
  ).toHaveLength(1);
  const upd = ok(
    await m("PATCH", D, { session: lead, headers: ifm(1), body: { demandFte: "1.25" } }),
    200,
    "updateDemand",
  );
  expect(upd.demandFte).toBe("1.25");
  expect((await m("POST", `${D}/commit`, { session: aud, headers: ifm(2), body: {} })).status).toBe(403);
  const committed = ok(
    await m("POST", `${D}/commit`, { session: p.office.session, headers: ifm(2), body: {} }),
    200,
    "commit",
  );
  expect([committed.status, committed.committedBy]).toEqual(["committed", p.office.id]);
  expect(
    (await m("POST", `${D}/release`, { session: aud, headers: ifm(3), body: { reason: "Synthetic release." } })).status,
  ).toBe(403);
  const released = ok(
    await m("POST", `${D}/release`, {
      session: p.office.session,
      headers: ifm(3),
      body: { reason: "Synthetic release." },
    }),
    200,
    "release",
  );
  expect(released.status).toBe("released");

  // The plan: role x month with the conflict flag.
  const plan = ok(await m("GET", `${T}/capacity-plan?from=2027-01-01&to=2027-12-31`, { session: aud }), 200, "plan");
  expect(plan.cells).toEqual([
    {
      resourceRoleId: role.id,
      periodMonth: "2027-01-01",
      availableFte: "1.50",
      demandFte: "0.00",
      committedDemandFte: "0.00",
      shortfallFte: "0.00",
      flag: null,
    },
  ]);

  // Funding: a selected initiative; AUD 403; SP records an approved decision -> funded; list and get.
  const selectedId = await selectedInitiative(ctx.api, m, p);
  const fundingBody = {
    initiativeId: selectedId,
    outcome: "approved",
    amount: "1500000.00",
    currency: "SAR",
    rationale: "Synthetic demo funding decision; approves nothing real.",
  };
  expect((await m("POST", "/api/v1/funding-decisions", { session: aud, body: fundingBody })).status).toBe(403);
  const funding = ok(
    await m("POST", "/api/v1/funding-decisions", { session: p.sponsor.session, body: fundingBody }),
    201,
    "fund",
  );
  expect([funding.outcome, funding.approverRoleCode, funding.onBehalfOfUserId]).toEqual(["approved", "SP", null]);
  expect(funding.decisionCode).toMatch(/^DEC-\d{2,}$/);
  ok(await m("GET", `/api/v1/funding-decisions/${funding.id}`, { session: aud }), 200, "getFunding");
  expect(
    ok(
      await m("GET", `/api/v1/funding-decisions?transformationId=${p.transformationId}&initiativeId=${selectedId}`, {
        session: aud,
      }),
      200,
      "listFunding",
    ).items,
  ).toHaveLength(1);
}
