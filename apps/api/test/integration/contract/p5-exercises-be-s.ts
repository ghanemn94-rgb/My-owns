// P5 contract exercises of BE-S (p5-work-split §J.1 and §2 rule 14; T-DG5-BE-S): the three environment operations, each
// with a success and every declared refusal it can reach, through the contract-validating client.
//  - In the contract test's shared database (no environment marker, so production; ADR-0050 §1, fail-safe), through
//    `mirrored`: getEnvironment and getDemoEnvironmentStatus (with their zod mirrors) and requestDemoReset's refusals
//    (409 environment.not_demo, 400, 401, 403, 428).
//  - In a scratch DEMO database of this run's cluster (seeded with the synthetic test dataset), through `call` (which
//    asserts the contract and records the exercised status): requestDemoReset's 202, its stale If-Match 409,
//    409 demo_reset.in_progress and 409 demo_reset.not_configured. Its 202 body is parsed with its mirror here, because
//    `mirrored` serves only the shared database; so requestDemoReset is not in the mirror map below.
// Nothing here approves anything.
import { migrate, seedDemo } from "@mth/db";
import { expect, inject } from "vitest";
import type { z } from "zod";
import { TEST_DEMO_MODULES } from "../../../../../packages/db/test/demo-fixture.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { demoEnvironmentStatus, demoResetRequest, environmentInfo } from "../../../src/modules/admin/environment.ts";
import { call, seedWorld, signIn, startApi, type P5ExerciseContext } from "../../support/harness.ts";

export const P5_MIRRORS_BE_S: Readonly<Record<string, z.ZodType>> = {
  getEnvironment: environmentInfo,
  getDemoEnvironmentStatus: demoEnvironmentStatus,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export async function exerciseP5BeSOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const tech = await signIn(api.app, w.admin.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const lead = await signIn(api.app, w.leadA1.subject);

  // getEnvironment: 200 (any signed-in user); 400 (undeclared parameter); 401.
  const env = await mirrored("GET", "/api/v1/environment", { session: lead });
  expect([env.status, (env.body as Body).kind, (env.body as Body).synthetic]).toEqual([200, "production", false]);
  expect((await mirrored("GET", "/api/v1/environment?x=1", { session: lead })).status).toBe(400);
  expect((await mirrored("GET", "/api/v1/environment")).status).toBe(401);

  // getDemoEnvironmentStatus: 200 (ADM_TECH); 400; 401; 403 (AUD, TL).
  const S = "/api/v1/admin/environment";
  // Version 0 (no run): until the proposed ETagOrZero patch lands (BE-S handback), this read skips only the contract
  // assertion (the zod mirror still runs); the contract-validated 200 is the demo database's below (ETag "1").
  const status = await mirrored("GET", S, { session: tech, contract: false });
  expect([status.status, (status.body as Body).kind, (status.body as Body).version]).toEqual([200, "production", 0]);
  expect((await mirrored("GET", `${S}?x=1`, { session: tech })).status).toBe(400);
  expect((await mirrored("GET", S)).status).toBe(401);
  expect((await mirrored("GET", S, { session: auditor })).status).toBe(403);
  expect((await mirrored("GET", S, { session: lead })).status).toBe(403);

  // requestDemoReset: 409 environment.not_demo; 400 (malformed If-Match); 401; 403 (AUD); 428.
  const R = `${S}/demo-resets`;
  const notDemo = await mirrored("POST", R, { session: tech, headers: { "if-match": '"0"' } });
  expect([notDemo.status, (notDemo.body as Body).code, (notDemo.body as Body).detail]).toEqual([
    409,
    "environment.not_demo",
    "This is available only in the demo environment.",
  ]);
  expect((await mirrored("POST", R, { session: tech, headers: { "if-match": "*" } })).status).toBe(400);
  expect((await mirrored("POST", R, { headers: { "if-match": '"0"' } })).status).toBe(401);
  expect((await mirrored("POST", R, { session: auditor, headers: { "if-match": '"0"' } })).status).toBe(403);
  expect((await mirrored("POST", R, { session: tech })).status).toBe(428);

  await exerciseInDemoDatabase();
}

/** requestDemoReset's demo-only outcomes, on a scratch demo database (created and dropped here). */
async function exerciseInDemoDatabase(): Promise<void> {
  const { adminUrl } = inject("mthDb");
  const name = await createScratchDatabase(adminUrl, "mth_contract_demo");
  try {
    const ownerUrl = roleUrl(adminUrl, name, "mth_owner");
    await migrate(ownerUrl);
    await seedDemo(ownerUrl, {
      mthEnv: "demo",
      runKind: "seed",
      requestedVia: "cli",
      requestedBy: null,
      modules: TEST_DEMO_MODULES,
    });
    const R = "/api/v1/admin/environment/demo-resets";
    let adminSubject = "";
    const unconfigured = await startApi({ database: name, env: { MTH_ENV: "demo" } });
    try {
      const w = await seedWorld(unconfigured.db);
      adminSubject = w.admin.subject;
      const s = await signIn(unconfigured.app, adminSubject);
      const res = await call<Body>(unconfigured.app, "POST", R, { session: s, headers: { "if-match": '"1"' } });
      expect([res.status, res.body.code]).toEqual([409, "demo_reset.not_configured"]);
    } finally {
      await unconfigured.close();
    }
    const api = await startApi({ database: name, env: { MTH_ENV: "demo", MTH_DEMO_ADMIN_DATABASE_URL: adminUrl } });
    try {
      const s = await signIn(api.app, adminSubject);
      const status = await call<Body>(api.app, "GET", "/api/v1/admin/environment", { session: s });
      expect([status.status, status.headers["etag"]]).toEqual([200, '"1"']);
      expect(demoEnvironmentStatus.safeParse(status.body).success).toBe(true);
      const stale = await call<Body>(api.app, "POST", R, { session: s, headers: { "if-match": '"0"' } });
      expect([stale.status, stale.body.code]).toEqual([409, "version_conflict"]);
      const queued = await call<Body>(api.app, "POST", R, { session: s, headers: { "if-match": '"1"' } });
      expect(queued.status).toBe(202);
      expect(demoResetRequest.safeParse(queued.body).success).toBe(true);
      const again = await call<Body>(api.app, "POST", R, { session: s, headers: { "if-match": '"1"' } });
      expect([again.status, again.body.code]).toEqual([409, "demo_reset.in_progress"]);
    } finally {
      await api.close();
    }
  } finally {
    await dropScratchDatabase(adminUrl, name);
  }
}
