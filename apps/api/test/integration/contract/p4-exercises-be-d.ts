// P4 contract exercises of BE-D (T-DG4-BE-D; p4-work-split §E.1, §1 S-10): the 11 slice E operations of the T15 RAID
// register, the integrated RAID + decision log, RAID-linked actions and the action register. Every call goes through
// `ctx.mirrored` (OpenAPI status/body/headers + problem mirror) and every success body is parsed with the zod mirror in
// P4_MIRRORS_BE_D. BE-D2 appends its corrective-case exercises to this file after BE-D (no new seam file). All data is
// synthetic; nothing here grants a business or Finance approval or touches the engineering gates DG0-DG7.
import { raidAction, raidActionPage, raidDecisionLogPage, raidEntry, raidEntryPage } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import type { P4ExerciseContext } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser, insertInitiative, seedBenefitWorld } from "../benefits/fixtures.ts";

export const P4_MIRRORS_BE_D: Readonly<Record<string, z.ZodType>> = {
  listRaidEntries: raidEntryPage,
  createRaidEntry: raidEntry,
  getRaidEntry: raidEntry,
  updateRaidEntry: raidEntry,
  closeRaidEntry: raidEntry,
  listRaidEntryActions: raidActionPage,
  createRaidEntryAction: raidAction,
  getRaidDecisionLog: raidDecisionLogPage,
  listActionRegister: raidActionPage,
  getActionRegisterItem: raidAction,
  updateActionRegisterItem: raidAction,
};

export async function exerciseP4BeDOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const b = await seedBenefitWorld(ctx.api, ctx.world, m);
  const s = b.s;
  const wl = await extraUser(ctx.api, ctx.world, b, "WL");
  const R = `${b.base}/raid`;

  // ------------------------------------------------------------------ register (ADR-0031 §1-§3)
  expect((await m("GET", R, { session: s.auditor })).status).toBe(200);
  expect((await m("GET", R, { session: s.admin })).status).toBe(404);
  const risk = await m("POST", R, {
    session: wl.session,
    body: {
      type: "risk",
      description: "Synthetic vendor delay",
      impact: "high",
      probability: "medium",
      ownerUserId: wl.id,
      dueDate: "2026-12-31",
      mitigation: "Synthetic second supplier",
    },
  });
  expect(risk.status, JSON.stringify(risk.body)).toBe(201);
  expect([risk.body.code, risk.body.status, risk.headers.etag]).toEqual(["R-01", "open", '"1"']);
  const bad = await m("POST", R, {
    session: s.tl,
    body: { type: "opportunity", description: "x", impact: "low", ownerUserId: wl.id },
  });
  expect([bad.status, bad.body.errors[0].code]).toEqual([400, "raid.type_invalid"]);
  const issueH = await m("POST", R, {
    session: s.tl,
    body: { type: "issue", description: "Synthetic issue", impact: "low", probability: "high", ownerUserId: wl.id },
  });
  expect([issueH.status, issueH.body.code]).toEqual([422, "raid.probability_not_applicable"]);
  expect(
    (
      await m("POST", R, {
        session: s.auditor,
        body: { type: "issue", description: "Synthetic issue", impact: "low", ownerUserId: wl.id },
      })
    ).status,
  ).toBe(403);
  const ini = await insertInitiative(ctx.api.db, b);
  const dep = await m("POST", R, {
    session: s.tl,
    body: {
      type: "dependency",
      description: "Synthetic data feed needed",
      impact: "medium",
      ownerUserId: wl.id,
      toInitiativeId: ini,
    },
  });
  expect(dep.status, JSON.stringify(dep.body)).toBe(201);
  expect([dep.body.recordTable, dep.body.probability, dep.body.initiativeId]).toEqual(["dependency", null, ini]);
  expect(dep.body.code).toMatch(/^DEP-[0-9]{2,6}$/);

  const I = `${R}/${risk.body.id}`;
  expect((await m("GET", I, { session: s.auditor })).status).toBe(200);
  expect((await m("GET", I, { session: s.admin })).status).toBe(404);
  expect((await m("PATCH", I, { session: s.tl, body: { impact: "low" } })).status).toBe(428);
  expect((await m("PATCH", I, { session: s.tl, headers: ifm(9), body: { impact: "low" } })).status).toBe(409);
  expect((await m("PATCH", I, { session: s.auditor, headers: ifm(1), body: { impact: "low" } })).status).toBe(403);
  const moved = await m("PATCH", I, { session: s.tl, headers: ifm(1), body: { status: "in_progress" } });
  expect([moved.status, moved.body.status, moved.body.version]).toEqual([200, "in_progress", 2]);
  const noProb = await m("PATCH", I, { session: s.tl, headers: ifm(2), body: { probability: null } });
  expect([noProb.status, noProb.body.code]).toEqual([422, "raid.probability_required"]);

  // ------------------------------------------------------------------ actions (ADR-0031 §4)
  const A = `${I}/actions`;
  const action = await m("POST", A, {
    session: s.tl,
    body: { title: "Synthetic supplier call", ownerUserId: wl.id, dueDate: "2020-01-05", followUpDate: "2020-01-02" },
  });
  expect(action.status, JSON.stringify(action.body)).toBe(201);
  expect([action.body.sourceKind, action.body.raidEntryId, action.body.overdue]).toEqual([
    "raid_entry",
    risk.body.id,
    true,
  ]);
  expect(
    (await m("POST", A, { session: s.bo, body: { title: "Not mine to assign", ownerUserId: wl.id } })).status,
  ).toBe(403);
  expect((await m("POST", A, { session: s.auditor, body: { title: "x", ownerUserId: wl.id } })).status).toBe(403);
  const listed = await m("GET", A, { session: s.auditor });
  expect([listed.status, listed.body.items.length]).toEqual([200, 1]);
  const depAction = await m("POST", `${R}/${dep.body.id}/actions`, {
    session: s.tl,
    body: { title: "Synthetic feed check", ownerUserId: wl.id },
  });
  expect([depAction.status, depAction.body.sourceKind]).toEqual([201, "dependency"]);

  const AR = `${b.base}/action-register`;
  const register = await m("GET", `${AR}?sourceKind=raid_entry&overdue=true`, { session: s.auditor });
  expect([register.status, register.body.items.map((x: { id: string }) => x.id)]).toEqual([200, [action.body.id]]);
  expect((await m("GET", AR, { session: s.admin })).status).toBe(404);
  const AI = `${AR}/${action.body.id}`;
  expect((await m("GET", AI, { session: s.auditor })).status).toBe(200);
  expect((await m("PATCH", AI, { session: wl.session, body: { status: "in_progress" } })).status).toBe(428);
  expect((await m("PATCH", AI, { session: s.auditor, headers: ifm(1), body: { status: "done" } })).status).toBe(403);
  const done = await m("PATCH", AI, { session: wl.session, headers: ifm(1), body: { status: "done" } });
  expect([done.status, done.body.status, done.body.overdue]).toEqual([200, "done", false]);
  const illegal = await m("PATCH", AI, { session: wl.session, headers: ifm(2), body: { status: "cancelled" } });
  expect([illegal.status, illegal.body.code]).toEqual([422, "invalid_transition"]);

  // ------------------------------------------------------------------ decision log and close (ADR-0031 §2, §1)
  const log = await m("GET", `${b.base}/raid-decision-log`, { session: s.auditor });
  expect(log.status).toBe(200);
  expect(log.body.items.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([risk.body.id, dep.body.id]));
  const closed = await m("POST", `${I}/close`, {
    session: s.tl,
    headers: ifm(2),
    body: { closureNote: "Synthetic: mitigated" },
  });
  expect([closed.status, closed.body.status, closed.body.closureNote]).toEqual([200, "closed", "Synthetic: mitigated"]);
  const again = await m("PATCH", I, { session: s.tl, headers: ifm(3), body: { impact: "low" } });
  expect([again.status, again.body.code]).toEqual([422, "raid.closed"]);
  expect(
    (await m("POST", `${I}/close`, { session: s.tl, headers: ifm(3), body: { closureNote: "Twice" } })).body.code,
  ).toBe("raid.closed");
  const depClosed = await m("POST", `${R}/${dep.body.id}/close`, {
    session: s.tl,
    headers: ifm(1),
    body: { closureNote: "Synthetic: feed delivered" },
  });
  expect([depClosed.status, depClosed.body.status, depClosed.body.recordStatus]).toEqual([200, "closed", "resolved"]);
}
