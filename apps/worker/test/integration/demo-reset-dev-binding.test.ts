// The in-app demo reset keeps the dev sign-in (T-DG5-BE-T4; BE-T3 handback §6.4; D-165), against a real PostgreSQL:
// `handleDemoReset` acknowledges the request in the processed_message ledger of its own database, then calls resetDemo
// with the deployment's dev-issuer binding (`demoDevIssuerBindingAllowed`, the CLI's rule), true in a dev-mode stack
// and false otherwise. The reset itself is a recording stand-in (the real drop and re-seed, with and without the
// binding, are proven by apps/api/test/integration/environment/environment.test.ts and
// packages/db/test/integration/demo-dev-binding.test.ts). Every value is SYNTHETIC; nothing here approves anything.
import type { DemoResetOptions, DemoRunSummary } from "@mth/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleDemoReset, type DemoResetSettings } from "../../src/handlers/demo.ts";
import { workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
beforeAll(async () => {
  env = await workerEnv();
}, 120_000);
afterAll(() => env.close());

const envelope = (key: string) => ({
  outboxEventId: randomUUID(),
  eventType: "demo.reset_requested",
  schemaVersion: 1,
  idempotencyKey: key,
  organizationId: randomUUID(),
  payload: { requestedBy: randomUUID(), latestRunNo: 0 },
});

async function run(settings: DemoResetSettings, key: string) {
  const calls: DemoResetOptions[] = [];
  const reset = async (options: DemoResetOptions): Promise<DemoRunSummary> => {
    calls.push(options);
    return { runNo: 1, checksumSha256: "0".repeat(64) } as DemoRunSummary;
  };
  const outcome = await handleDemoReset(env.db, envelope(key), "job-dev-binding", { settings: () => settings, reset });
  return { outcome, calls };
}

const settingsOf = (devIssuerBinding: boolean | undefined): DemoResetSettings => ({
  mthEnv: "demo",
  adminUrl: "postgres://mth_admin@127.0.0.1:5432/postgres",
  databaseUrl: "postgres://mth_app@127.0.0.1:5432/mth_demo_synthetic",
  ...(devIssuerBinding === undefined ? {} : { devIssuerBinding }),
});

describe("the in-app demo reset and the dev-issuer binding", () => {
  it("passes devIssuerBinding = true to resetDemo in a dev-mode stack, after acknowledging the request", async () => {
    const key = `demo.reset_requested:${randomUUID()}`;
    const { outcome, calls } = await run(settingsOf(true), key);
    expect(outcome).toEqual({ outcome: "reset", runNo: 1, checksumSha256: "0".repeat(64) });
    expect(calls.map((c) => [c.devIssuerBinding, c.requestedVia, c.source])).toEqual([[true, "api", "worker"]]);
    const ack = await env.db
      .selectFrom("processed_message")
      .select("idempotency_key")
      .where("consumer", "=", "demo.reset")
      .where("idempotency_key", "=", key)
      .execute();
    expect(ack).toHaveLength(1);
    // A redelivery does nothing (no second reset).
    const again = await run(settingsOf(true), key);
    expect([again.outcome, again.calls.length]).toEqual([{ outcome: "duplicate" }, 0]);
  });

  it("passes devIssuerBinding = false otherwise (unset or false)", async () => {
    for (const binding of [false, undefined]) {
      const { calls } = await run(settingsOf(binding), `demo.reset_requested:${randomUUID()}`);
      expect(calls.map((c) => c.devIssuerBinding)).toEqual([false]);
    }
  });
});
