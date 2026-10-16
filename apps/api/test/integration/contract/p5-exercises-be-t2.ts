// P5 contract exercises of BE-T2 (p5-work-split §J.4 and §2 rule 14; T-DG5-BE-T2): getDemoWalkthrough, with a success
// and every declared refusal it can reach, through the contract-validating client.
//  - In the contract test's shared database (no environment marker, so production; ADR-0050 §1, fail-safe), through
//    `mirrored`: 409 environment.not_demo (exact text), 400 (undeclared parameter, malformed id) and 401.
//  - In a scratch DEMO database of this run's cluster (seeded with the synthetic test dataset), through `call` (which
//    asserts the contract and records the exercised status): the 200 without a transformation (step 1 not completed),
//    the 200 for a transformation the caller reads, and the 404 for one it cannot read. The 200 body is also parsed
//    with its zod mirror here, because `mirrored` serves only the shared database; so getDemoWalkthrough is not in the
//    mirror map below. Declared but not reachable: 403 (the operation needs only a session; an unreadable
//    transformation answers 404, never 403) and 429 (the platform rate-limit sweep covers it).
// Nothing here approves anything; reading the walkthrough writes nothing.
import { migrate, seedDemo } from "@mth/db";
import { expect, inject } from "vitest";
import type { z } from "zod";
import { TEST_DEMO_MODULES } from "../../../../../packages/db/test/demo-fixture.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { demoWalkthrough } from "../../../src/modules/admin/walkthrough.ts";
import {
  call,
  createTransformationRow,
  seedWorld,
  signIn,
  startApi,
  type P5ExerciseContext,
} from "../../support/harness.ts";

export const P5_MIRRORS_BE_T2: Readonly<Record<string, z.ZodType>> = {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const W = "/api/v1/demo/walkthrough";
const NOT_DEMO = "This is available only in the demo environment.";

export async function exerciseP5BeT2Operations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const lead = await signIn(api.app, w.leadA1.subject);

  // getDemoWalkthrough outside a demo database: 409 environment.not_demo; 400; 401.
  const notDemo = await mirrored("GET", W, { session: lead });
  expect([notDemo.status, (notDemo.body as Body).code, (notDemo.body as Body).detail]).toEqual([
    409,
    "environment.not_demo",
    NOT_DEMO,
  ]);
  expect((await mirrored("GET", `${W}?x=1`, { session: lead })).status).toBe(400);
  expect((await mirrored("GET", `${W}?transformationId=not-a-uuid`, { session: lead })).status).toBe(400);
  expect((await mirrored("GET", W)).status).toBe(401);

  await exerciseInDemoDatabase();
}

/** getDemoWalkthrough's demo-only outcomes, on a scratch demo database (created and dropped here). */
async function exerciseInDemoDatabase(): Promise<void> {
  const { adminUrl } = inject("mthDb");
  const name = await createScratchDatabase(adminUrl, "mth_contract_walk");
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
    const api = await startApi({ database: name, env: { MTH_ENV: "demo" } });
    try {
      const w = await seedWorld(api.db);
      const lead = await signIn(api.app, w.office.subject);
      const outsider = await signIn(api.app, w.officeB.subject);
      const t = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);

      const none = await call<Body>(api.app, "GET", W, { session: lead });
      expect([none.status, none.body.transformationId, none.body.completedCount, none.body.total]).toEqual([
        200,
        null,
        0,
        12,
      ]);
      expect(demoWalkthrough.safeParse(none.body).success).toBe(true);

      const mine = await call<Body>(api.app, "GET", `${W}?transformationId=${t}`, { session: lead });
      expect([mine.status, mine.body.transformationId, mine.body.steps[0].completed]).toEqual([200, t, true]);
      expect(demoWalkthrough.safeParse(mine.body).success).toBe(true);

      const hidden = await call<Body>(api.app, "GET", `${W}?transformationId=${t}`, { session: outsider });
      expect(hidden.status).toBe(404);
    } finally {
      await api.close();
    }
  } finally {
    await dropScratchDatabase(adminUrl, name);
  }
}
