// P5 contract exercises of BE-I2 (p5-work-split §D.4 and §2 rule 14; T-DG5-BE-I2): the three jobs-operations-view
// operations, each with a success and every declared refusal it can reach, through the validating client. Run now is
// an operational action (it starts a scheduled job once); nothing here decides a business approval. Synthetic data.
import { jobOperationDetail, jobOperationList, jobRunNowResult } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { call, signIn, type P5ExerciseContext } from "../../support/harness.ts";

export const P5_MIRRORS_BE_I2: Readonly<Record<string, z.ZodType>> = {
  listJobOperations: jobOperationList,
  getJobOperation: jobOperationDetail,
  runJobNow: jobRunNowResult,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export async function exerciseP5BeI2Operations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const J = "/api/v1/admin/jobs";
  const tech = await signIn(api.app, w.admin.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const lead = await signIn(api.app, w.leadA1.subject);

  // listJobOperations: 200; 400 (undeclared parameter); 403 (TL, AUD).
  const list = await mirrored("GET", J, { session: tech });
  expect(list.status).toBe(200);
  expect((list.body as Body).items.length).toBeGreaterThan(0);
  expect((await mirrored("GET", `${J}?bogus=1`, { session: tech })).status).toBe(400);
  expect((await mirrored("GET", J, { session: auditor })).status).toBe(403);
  expect((await mirrored("GET", J, { session: lead })).status).toBe(403);

  // getJobOperation: 200; 400 (malformed code, bad cursor); 403; 404.
  const code = "governance.meeting_series_generate";
  expect((await mirrored("GET", `${J}/${code}?limit=5`, { session: tech })).status).toBe(200);
  expect((await mirrored("GET", `${J}/Not-A-Code`, { session: tech })).status).toBe(400);
  expect((await mirrored("GET", `${J}/${code}?cursor=bogus`, { session: tech })).status).toBe(400);
  expect((await mirrored("GET", `${J}/${code}`, { session: auditor })).status).toBe(403);
  expect((await mirrored("GET", `${J}/no_such.job`, { session: tech })).status).toBe(404);

  // runJobNow: 202; 400; 403 (AUD); 404; 422 job.schedule_disabled.
  const run = `${J}/${code}/run`;
  const ran = await mirrored("POST", run, { session: tech });
  expect([ran.status, (ran.body as Body).code]).toEqual([202, code]);
  expect((await mirrored("POST", `${J}/Not-A-Code/run`, { session: tech })).status).toBe(400);
  expect((await mirrored("POST", run, { session: auditor })).status).toBe(403);
  expect((await mirrored("POST", `${J}/no_such.job/run`, { session: tech })).status).toBe(404);
  const S = `/api/v1/admin/job-schedules/${code}`;
  const v = (
    await api.db.selectFrom("job_schedule").select("version").where("code", "=", code).executeTakeFirstOrThrow()
  ).version;
  const off = await call<Body>(api.app, "PATCH", S, {
    session: tech,
    headers: { "if-match": `"${v}"` },
    body: { enabled: false },
  });
  expect(off.status).toBe(200);
  try {
    const disabled = await mirrored("POST", run, { session: tech });
    expect([disabled.status, (disabled.body as Body).code, (disabled.body as Body).detail]).toEqual([
      422,
      "job.schedule_disabled",
      "Enable the schedule before running it now.",
    ]);
  } finally {
    const on = await call<Body>(api.app, "PATCH", S, {
      session: tech,
      headers: { "if-match": `"${v + 1}"` },
      body: { enabled: true },
    });
    expect(on.status).toBe(200);
  }
}
