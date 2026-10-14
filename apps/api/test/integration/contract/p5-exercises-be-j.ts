// P5 contract exercises of BE-J (p5-work-split §E.1 and §2 rule 14; T-DG5-BE-J): listDependencySlips with a success
// (a real critical slip written by the DG4 milestone write) and every declared refusal it can reach (400, 401, 404),
// and the createTransformation extension (`launchPlan`, ADR-0044 §2) through the validating client. Every value is
// SYNTHETIC; nothing here is a business approval.
import { dependencySlipPage } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { call, signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  insertAudited,
  insertMilestone,
  newDependency,
  seedExecutionWorld,
  setDuration,
} from "../portfolio/execution-fixtures.ts";

export const P5_MIRRORS_BE_J: Readonly<Record<string, z.ZodType>> = {
  listDependencySlips: dependencySlipPage,
};

export async function exerciseP5BeJOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);

  // createTransformation with the optional 90-day plan (201; the v2 event carries it).
  const office = await signIn(api.app, w.office.subject);
  const created = await mirrored("POST", "/api/v1/transformations", {
    session: office,
    body: {
      businessUnitId: w.a1,
      name: "Synthetic contract launch plan",
      mode: "end_to_end",
      launchPlan: { startDate: "2026-10-01" },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);

  // A critical slip: A -> B on the computed critical path, A's milestone moved 5 days later.
  const x = await seedExecutionWorld(api, w);
  const ini = async (code: string, owner: string) =>
    insertAudited(api.db, x, "initiative", { code, name: `Synthetic ${code}`, executive_owner_user_id: owner });
  const a = await ini("INI-01", x.users.tl.id);
  const b = await ini("INI-02", x.users.bo.id);
  await newDependency(send, x, a, b);
  await setDuration(send, x, a, 5);
  await setDuration(send, x, b, 10);
  const m = await insertMilestone(api.db, x, a, null, "2026-11-01");
  await insertMilestone(api.db, x, b, null, "2026-12-01");
  const moved = await send("PATCH", `/api/v1/milestones/${m}`, {
    session: x.s.tl,
    headers: ifm(1),
    body: { forecastDate: "2026-11-06" },
  });
  expect(moved.status, JSON.stringify(moved.body)).toBe(200);

  const url = `/api/v1/transformations/${x.transformationId}/dependency-slips`;
  // 200 (TL, and AUD reads); 400; 401; 404 (outside scope).
  const list = await mirrored("GET", `${url}?limit=10`, { session: x.s.tl });
  expect(list.status).toBe(200);
  expect(list.body.items).toHaveLength(1);
  expect(list.body.items[0]).toMatchObject({ slipDays: 5, criticalReason: "critical_path" });
  expect((await mirrored("GET", url, { session: x.s.auditor })).status).toBe(200);
  expect((await mirrored("GET", `${url}?limit=0`, { session: x.s.tl })).status).toBe(400);
  expect((await mirrored("GET", url)).status).toBe(401);
  expect((await mirrored("GET", url, { session: x.s.outsider })).status).toBe(404);
}
