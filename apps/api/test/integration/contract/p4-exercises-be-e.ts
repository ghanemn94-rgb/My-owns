// P4 contract exercises of BE-E (T-DG4-BE-E; p4-work-split §E.3, §1 S-10): the 9 slice E operations of budget lines,
// the execution view and the schedule network. Every call goes through `ctx.mirrored` (OpenAPI status/body/headers +
// problem mirror) and every success body is parsed with the zod mirror in P4_MIRRORS_BE_E. All data is synthetic;
// nothing here grants a business or Finance approval or touches the engineering gates DG0-DG7.
import {
  budgetLine,
  budgetLinePage,
  initiativeExecution,
  initiativeSchedule,
  scheduleNetwork,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import type { P4ExerciseContext } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  ensureDefaultCalendar,
  insertInitiative,
  insertMilestone,
  newDependency,
  seedExecutionWorld,
} from "../portfolio/execution-fixtures.ts";

export const P4_MIRRORS_BE_E: Readonly<Record<string, z.ZodType>> = {
  listBudgetLines: budgetLinePage,
  createBudgetLine: budgetLine,
  getBudgetLine: budgetLine,
  updateBudgetLine: budgetLine,
  archiveBudgetLine: budgetLine,
  getInitiativeExecution: initiativeExecution,
  getScheduleNetwork: scheduleNetwork,
  createInitiativeSchedule: initiativeSchedule,
  updateInitiativeSchedule: initiativeSchedule,
};

export async function exerciseP4BeEOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const x = await seedExecutionWorld(ctx.api, ctx.world);
  const a = await insertInitiative(ctx.api.db, x, "INI-01");
  const b = await insertInitiative(ctx.api.db, x, "INI-02");
  await newDependency(m, x, a, b);
  await ensureDefaultCalendar(ctx.api, ctx.world, m);
  await insertMilestone(ctx.api.db, x, a, "2026-10-08", "2026-10-15");

  // ------------------------------------------------------------------ budget lines (ADR-0031 §7)
  const L = `/api/v1/initiatives/${a}/budget-lines`;
  const created = await m("POST", L, {
    session: x.s.fin,
    body: { label: "Synthetic licences", periodMonth: "2026-10-01", budgetAmount: "0.1", actualAmount: null },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect([created.body.currency, created.body.budgetAmount, created.headers.etag]).toEqual(["SAR", "0.1000", '"1"']);
  const second = await m("POST", L, { session: x.s.tl, body: { label: "Synthetic cloud", budgetAmount: "0.2" } });
  expect(second.status).toBe(201);
  expect((await m("POST", L, { session: x.s.auditor, body: { label: "Synthetic x" } })).status).toBe(403);
  expect((await m("POST", L, { session: x.s.admin, body: { label: "Synthetic x" } })).status).toBe(404);
  const bad = await m("POST", L, { session: x.s.tl, body: { label: "Synthetic bad", budgetAmount: "-1" } });
  expect([bad.status, bad.body.code]).toEqual([422, "budget_line.amount_invalid"]);
  const dup = await m("POST", L, { session: x.s.tl, body: { label: "SYNTHETIC CLOUD" } });
  expect([dup.status, dup.body.code]).toEqual([409, "budget_line.duplicate"]);

  const list = await m("GET", L, { session: x.s.auditor });
  expect([list.status, list.body.items.length]).toEqual([200, 2]);
  expect((await m("GET", L, { session: x.s.admin })).status).toBe(404);

  const I = `/api/v1/budget-lines/${created.body.id}`;
  expect((await m("GET", I, { session: x.s.auditor })).status).toBe(200);
  expect((await m("PATCH", I, { session: x.s.tl, body: { actualAmount: "0.05" } })).status).toBe(428);
  expect((await m("PATCH", I, { session: x.s.tl, headers: ifm(9), body: { actualAmount: "0.05" } })).status).toBe(409);
  const updated = await m("PATCH", I, { session: x.s.tl, headers: ifm(1), body: { actualAmount: "0.05" } });
  expect([updated.status, updated.body.actualAmount, updated.headers.etag]).toEqual([200, "0.0500", '"2"']);

  // ------------------------------------------------------------------ execution view
  const exec = await m("GET", `/api/v1/initiatives/${a}/execution`, { session: x.s.auditor });
  expect(exec.status, JSON.stringify(exec.body)).toBe(200);
  expect(exec.body.budgetTotals[0].budget).toEqual({
    status: "known",
    amount: "0.3000",
    knownAmount: "0.3000",
    missingCount: 0,
    reason: null,
  });
  expect(exec.body.milestones[0].slipWorkingDays).toEqual({ status: "known", value: 5, reason: null });
  expect(exec.body.onCriticalPath).toBeNull(); // no duration yet
  expect((await m("GET", `/api/v1/initiatives/${a}/execution`, { session: x.s.admin })).status).toBe(404);

  const A = `${I}/archive`;
  const archived = await m("POST", A, { session: x.s.fin, headers: ifm(2), body: { reason: "Synthetic: replaced" } });
  expect([archived.status, archived.body.status]).toEqual([200, "archived"]);
  const again = await m("POST", A, { session: x.s.fin, headers: ifm(3), body: { reason: "Synthetic again" } });
  expect([again.status, again.body.code]).toEqual([422, "budget_line.archived"]);

  // ------------------------------------------------------------------ durations and the network (ADR-0031 §8)
  const N = `/api/v1/transformations/${x.transformationId}/schedule-network`;
  const before = await m("GET", N, { session: x.s.auditor });
  expect([before.status, before.body.status, before.body.reason]).toEqual([200, "not_computable", "missing_durations"]);
  expect((await m("GET", N, { session: x.s.admin })).status).toBe(404);
  const sa = await m("POST", `/api/v1/initiatives/${a}/schedule`, {
    session: x.s.tl,
    body: { durationWorkingDays: 5 },
  });
  expect([sa.status, sa.headers.etag]).toEqual([201, '"1"']);
  const exists = await m("POST", `/api/v1/initiatives/${a}/schedule`, {
    session: x.s.wl,
    body: { durationWorkingDays: 6 },
  });
  expect([exists.status, exists.body.code]).toEqual([409, "initiative_schedule.exists"]);
  expect(
    (await m("POST", `/api/v1/initiatives/${b}/schedule`, { session: x.s.auditor, body: { durationWorkingDays: 1 } }))
      .status,
  ).toBe(403);
  expect(
    (await m("POST", `/api/v1/initiatives/${b}/schedule`, { session: x.s.to, body: { durationWorkingDays: 10 } }))
      .status,
  ).toBe(201);
  const S = `/api/v1/initiatives/${a}/schedule`;
  expect((await m("PATCH", S, { session: x.s.tl, body: { durationWorkingDays: 4 } })).status).toBe(428);
  expect((await m("PATCH", S, { session: x.s.tl, headers: ifm(5), body: { durationWorkingDays: 4 } })).status).toBe(
    409,
  );
  expect(
    (await m("PATCH", S, { session: x.s.auditor, headers: ifm(1), body: { durationWorkingDays: 4 } })).status,
  ).toBe(403);
  const changed = await m("PATCH", S, { session: x.s.wl, headers: ifm(1), body: { durationWorkingDays: 4 } });
  expect([changed.status, changed.body.durationWorkingDays, changed.body.version]).toEqual([200, 4, 2]);

  const after = await m("GET", N, { session: x.s.tl });
  expect([after.body.status, after.body.projectDurationWorkingDays, after.body.criticalPaths]).toEqual([
    "computed",
    14,
    [[a, b]],
  ]);
}
