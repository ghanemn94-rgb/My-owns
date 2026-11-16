// P7 contract exercises of BE-B (p7-work-split §B.1, §B.4 T-B7; §2 rule 1 with p6-work-split §2 rule 16;
// T-DG7-BE-B): getDeploymentStatus with its success and the declared refusals it can reach, through the
// contract-validating client `mirrored` (the success body also checked against the zod mirror), and getReadiness's
// 200 and 503 bodies with the P7 keys `storage` and `worker`, validated against the contract by `assertContract`
// (response-validation.test.ts reads the same ledger). The 503 comes from a separate Fastify app on the same pool with
// a storage probe that fails, so the shared contract database and its evidence store are never broken.
// Nothing here approves anything (no G1-G6, Finance or IT approval) or touches DG0-DG7.
import { createPool } from "@mth/db";
import Fastify from "fastify";
import { expect } from "vitest";
import type { z } from "zod";
import { deploymentStatusView, registerHealthRoutes } from "../../../src/modules/platform/index.ts";
import { readWorkerHeartbeat } from "../../../src/modules/operations/heartbeat.ts";
import { assertContract } from "../../support/contract.ts";
import { signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P7_MIRRORS_BE_B: Readonly<Record<string, z.ZodType>> = {
  getDeploymentStatus: deploymentStatusView,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const PATH = "/api/v1/admin/deployment";

export async function exerciseP7BeBOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored: m } = ctx;
  const tech = await signIn(api.app, w.admin.subject); // ADM_TECH + ADM_ACCESS at org A: operations.read
  const auditor = await signIn(api.app, w.auditor.subject); // AUD: operations.read
  const lead = await signIn(api.app, w.leadA1.subject); // TL: no operations.read
  const status = async (p: Promise<{ status: number; body: Body }>, expected: number, code?: string) => {
    const res = await p;
    expect(res.status, JSON.stringify(res.body)).toBe(expected);
    if (code) expect(res.body.code).toBe(code);
    return res;
  };

  // getDeploymentStatus: 200 (ADM_TECH, AUD), 400 (undeclared query), 401 (no session), 403 (TL).
  const ok = await status(m("GET", PATH, { session: tech }), 200);
  expect(ok.body.readiness.checks).toHaveProperty("storage");
  expect(ok.body.readiness.checks).toHaveProperty("worker");
  await status(m("GET", PATH, { session: auditor }), 200);
  await status(m("GET", `${PATH}?unexpected=1`, { session: tech }), 400);
  await status(m("GET", PATH), 401, "unauthenticated");
  await status(m("GET", PATH, { session: lead }), 403, "forbidden");

  // getReadiness with the P7 keys: the shared server's 200 (storage ok on the test filesystem store) ...
  const ready = await status(m("GET", "/readyz"), 200);
  expect(Object.keys(ready.body.checks).sort()).toEqual(["database", "migrations", "storage", "worker"]);
  // ... and a 503 with storage: fail, from the real health route on the same pool with a failing storage probe.
  const pool = createPool(api.config.databaseUrl!, { max: 2, applicationName: "contract-readyz-503" });
  const probeApp = Fastify();
  // As the platform hooks of the real server do (ADR-0007 §8): every response carries X-Request-Id.
  probeApp.addHook("onRequest", async (request, reply) => {
    reply.header("X-Request-Id", request.id);
  });
  registerHealthRoutes(probeApp, pool, undefined, {
    storage: async () => ({ status: "fail", driver: "filesystem", source: "environment", errorCode: "ENOENT" }),
    worker: async (d) => {
      const b = await readWorkerHeartbeat(d);
      return { status: b.status, newestBeatAt: b.newestBeatAt, staleAfterSeconds: b.staleAfterSeconds };
    },
  });
  try {
    const res = await probeApp.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode, res.body).toBe(503);
    assertContract("GET", "/readyz", { statusCode: res.statusCode, headers: res.headers, body: res.body });
    expect(res.json()).toMatchObject({ status: "not_ready", checks: { database: "ok", storage: "fail" } });
  } finally {
    await probeApp.close();
    await pool.end();
  }
}
