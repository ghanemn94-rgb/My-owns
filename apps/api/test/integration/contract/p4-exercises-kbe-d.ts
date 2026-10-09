// P4 contract exercises of KBE-D (T-DG4-KBE-D; p4-work-split §B.1, §1 S-10): the 16 slice B register operations
// (benefits, lifecycle, enablers, allocations, shared-benefit groups). Every call goes through `ctx.mirrored` (OpenAPI
// status/body/headers + problem mirror) and every success body is parsed with the zod mirror in P4_MIRRORS_KBE_D. All
// data is synthetic; nothing here grants a business or Finance approval or touches the engineering gates DG0-DG7.
import {
  benefit,
  benefitAllocations,
  benefitEnabler,
  benefitEnablerPage,
  benefitGroup,
  benefitGroupPage,
  benefitLifecycle,
  benefitRegisterPage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { ifm } from "../../support/p2-fixtures.ts";
import type { P4ExerciseContext } from "../../support/harness.ts";
import {
  acceptDeliverable,
  cxBody,
  financialBody,
  insertDeliverable,
  insertInitiative,
  planOutputs,
  seedBenefitWorld,
} from "../benefits/fixtures.ts";

export const P4_MIRRORS_KBE_D: Readonly<Record<string, z.ZodType>> = {
  listBenefits: benefitRegisterPage,
  createBenefit: benefit,
  getBenefit: benefit,
  updateBenefit: benefit,
  archiveBenefit: benefit,
  getBenefitLifecycle: benefitLifecycle,
  advanceBenefitLifecycle: benefit,
  listBenefitEnablers: benefitEnablerPage,
  createBenefitEnabler: benefitEnabler,
  removeBenefitEnabler: benefitEnabler,
  getBenefitAllocations: benefitAllocations,
  replaceBenefitAllocations: benefitAllocations,
  listBenefitGroups: benefitGroupPage,
  createBenefitGroup: benefitGroup,
  getBenefitGroup: benefitGroup,
  updateBenefitGroup: benefitGroup,
};

export async function exerciseP4KbeDOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const b = await seedBenefitWorld(ctx.api, ctx.world, m);
  const s = b.s;
  const B = `${b.base}/benefits`;

  // ------------------------------------------------------------------ register (ADR-0029 §1, §4)
  expect((await m("GET", B, { session: s.auditor })).status).toBe(200);
  const created = await m("POST", B, { session: s.bo, body: financialBody(b) });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect([created.body.code, created.body.lifecycleStep, created.body.realizationState]).toEqual([
    "B01",
    "identify",
    "not_enabled",
  ]);
  const id = created.body.id as string;
  // Two owners -> 400; no statement line -> 422; AUD -> 403.
  expect(
    (await m("POST", B, { session: s.bo, body: { ...financialBody(b), ownerUserId: [b.users.bo.id, b.users.tl.id] } }))
      .status,
  ).toBe(400);
  expect((await m("POST", B, { session: s.bo, body: financialBody(b, { financialStatementLine: null }) })).status).toBe(
    422,
  );
  expect((await m("POST", B, { session: s.auditor, body: financialBody(b) })).status).toBe(403);
  const cx = await m("POST", B, { session: s.tl, body: cxBody(b) });
  expect(cx.status, JSON.stringify(cx.body)).toBe(201);

  const I = `${B}/${id}`;
  expect((await m("GET", I, { session: s.auditor })).status).toBe(200);
  expect((await m("PATCH", I, { session: s.bo, body: { title: "No If-Match" } })).status).toBe(428);
  expect((await m("PATCH", I, { session: s.bo, headers: ifm(9), body: { title: "Stale" } })).status).toBe(409);
  const planned = await m("PATCH", I, {
    session: s.bo,
    headers: ifm(1),
    body: { ...planOutputs(b), plannedValue: "10000000" },
  });
  expect([planned.status, planned.body.version]).toEqual([200, 2]);

  // ------------------------------------------------------------------ lifecycle and enablers (ADR-0029 §2, §3)
  const L = `${I}/lifecycle`;
  const lifecycle = await m("GET", L, { session: s.auditor });
  expect([lifecycle.status, lifecycle.body.steps.length]).toEqual([200, 6]);
  expect((await m("POST", L, { session: s.tl, headers: ifm(2), body: { toStep: "plan" } })).status).toBe(403);
  expect((await m("POST", L, { session: s.bo, headers: ifm(2), body: { toStep: "enable" } })).status).toBe(422);
  const toPlan = await m("POST", L, { session: s.bo, headers: ifm(2), body: { toStep: "plan" } });
  expect([toPlan.status, toPlan.body.lifecycleStep]).toEqual([200, "plan"]);
  const toEnable = await m("POST", L, { session: s.bo, headers: ifm(3), body: { toStep: "enable" } });
  expect([toEnable.status, toEnable.body.lifecycleStep]).toEqual([200, "enable"]);
  expect((await m("POST", L, { session: s.bo, headers: ifm(4), body: { toStep: "measure" } })).status).toBe(422);

  const E = `${I}/enablers`;
  const ini = await insertInitiative(ctx.api.db, b);
  const deliverable = await insertDeliverable(ctx.api.db, b, ini);
  const enabler = await m("POST", E, { session: s.bo, body: { initiativeId: ini, deliverableId: deliverable } });
  expect([enabler.status, enabler.body.delivered]).toEqual([201, false]);
  expect((await m("POST", E, { session: s.bo, body: { initiativeId: ini, deliverableId: deliverable } })).status).toBe(
    409,
  );
  await acceptDeliverable(ctx.api.db, b, deliverable);
  const enablers = await m("GET", E, { session: s.auditor });
  expect([enablers.status, enablers.body.items[0].delivered]).toEqual([200, true]);
  const enabled = await m("GET", I, { session: s.auditor });
  expect(enabled.body.realizationState).toBe("enabled_not_yet_measured");
  const second = await m("POST", E, { session: s.tl, body: { initiativeId: ini } });
  expect(second.status).toBe(201);
  const R = `${b.base}/benefit-enablers/${second.body.id}/remove`;
  expect((await m("POST", R, { session: s.auditor, headers: ifm(1), body: { reason: "Not needed" } })).status).toBe(
    403,
  );
  const removed = await m("POST", R, { session: s.tl, headers: ifm(1), body: { reason: "Not needed" } });
  expect([removed.status, removed.body.status]).toEqual([200, "removed"]);
  expect((await m("POST", R, { session: s.tl, headers: ifm(2), body: { reason: "Again" } })).status).toBe(422);
  const toMeasure = await m("POST", L, { session: s.bo, headers: ifm(4), body: { toStep: "measure" } });
  expect([toMeasure.status, toMeasure.body.lifecycleStep]).toEqual([200, "measure"]);

  // ------------------------------------------------------------------ allocations (ADR-0029 §5; REQ-S08-013)
  const A = `${I}/allocations`;
  const ini2 = await insertInitiative(ctx.api.db, b);
  const none = await m("GET", A, { session: s.auditor });
  expect([none.status, none.body.unallocatedShare]).toEqual([200, "1.000000"]);
  const over = await m("PUT", A, {
    session: s.tl,
    headers: ifm(5),
    body: {
      allocations: [
        { initiativeId: ini, share: "0.6" },
        { initiativeId: ini2, share: "0.5" },
      ],
    },
  });
  expect([over.status, over.body.code]).toEqual([422, "benefit_allocation.over_100"]);
  const ok = await m("PUT", A, {
    session: s.tl,
    headers: ifm(5),
    body: {
      allocations: [
        { initiativeId: ini, share: "0.6" },
        { initiativeId: ini2, share: "0.3" },
      ],
    },
  });
  expect([ok.status, ok.body.unallocatedShare, ok.headers.etag]).toEqual([200, "0.100000", '"6"']);
  expect((await m("PUT", A, { session: s.auditor, headers: ifm(6), body: { allocations: [] } })).status).toBe(403);

  // ------------------------------------------------------------------ shared-benefit groups (ADR-0029 §6)
  const G = `${b.base}/benefit-groups`;
  expect((await m("GET", G, { session: s.auditor })).status).toBe(200);
  const group = await m("POST", G, { session: s.tl, body: { title: "Synthetic shared churn pool" } });
  expect([group.status, group.body.code, group.body.countedBenefitId]).toEqual([201, "BG-01", null]);
  expect((await m("POST", G, { session: s.auditor, body: { title: "x" } })).status).toBe(403);
  const GI = `${G}/${group.body.id}`;
  expect((await m("GET", GI, { session: s.auditor })).status).toBe(200);
  expect((await m("PATCH", GI, { session: s.tl, headers: ifm(1), body: { countedBenefitId: id } })).status).toBe(422);
  const joined = await m("PATCH", I, { session: s.bo, headers: ifm(6), body: { benefitGroupId: group.body.id } });
  expect([joined.status, joined.body.counting.exclusionReason]).toEqual([200, "group_counted_member_not_named"]);
  const named = await m("PATCH", GI, { session: s.tl, headers: ifm(1), body: { countedBenefitId: id } });
  expect([named.status, named.body.memberBenefitIds]).toEqual([200, [id]]);
  expect((await m("GET", I, { session: s.auditor })).body.counting.counted).toBe(true);

  // ------------------------------------------------------------------ archive
  const archived = await m("POST", `${B}/${cx.body.id}/archive`, {
    session: s.tl,
    headers: ifm(1),
    body: { reason: "Synthetic duplicate" },
  });
  expect([archived.status, archived.body.status, archived.body.counting.exclusionReason]).toEqual([
    200,
    "archived",
    "archived",
  ]);
  expect(
    (await m("POST", `${B}/${cx.body.id}/archive`, { session: s.tl, headers: ifm(2), body: { reason: "Again" } }))
      .status,
  ).toBe(422);
}
