// demo job handlers (P5; stub by T-DG5-BE-A; filled by T-DG5-BE-S). ADR-0050 §6, §10; REQ-S18-001.
//
// demo.reset (the in-app demo reset): the consumer of `demo.reset_requested`, which the API writes with its audit event
// after re-checking demo.reset at commit time. The worker of a DEMO deployment:
//   1. refuses unless this deployment is a demo one (MTH_ENV=demo) with MTH_DEMO_ADMIN_DATABASE_URL: the job fails
//      with `demo_reset.not_configured` / `environment.not_demo` (the failure queue records it; nothing is dropped);
//   2. ACKNOWLEDGES the request: the processed_message ledger row (consumer demo.reset, the event's idempotency key)
//      commits first, so a redelivery or a retry finds it and does nothing (it is never retried into a second drop);
//   3. runs the same reset as `mth-db reset-demo` (@mth/db resetDemo): session lock 730271 on the maintenance
//      database, the target must be a demo database, DROP … WITH (FORCE) and CREATE, migrate, seed with
//      run_kind = 'reset', requested_via = 'api' and requested_by = the requester's fixed demo user id; with the same
//      dev-issuer binding rule as the CLI (D-165; T-DG5-BE-T4: `demoDevIssuerBindingAllowed`, AUTH_MODE=dev and never
//      NODE_ENV=production), so an in-app reset of a dev-mode demo database keeps the dev sign-in.
// The previous database (with this job's own ledger row and the pg-boss rows inside it) goes with the drop, by design.
// If the worker stops mid-reset, `mth-db reset-demo` is the recovery path (ADR-0050 §6). A reset approves nothing.
import { loadConfig } from "@mth/config";
import {
  databaseNameOf,
  demoDevIssuerBindingAllowed,
  resetDemo,
  urlForDatabase,
  type DemoResetOptions,
  type DemoRunSummary,
  type Db,
} from "@mth/db";
import { demoResetRequestedV1, outboxEnvelope } from "@mth/shared/schemas";
import { runOnce } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

export const DEMO_RESET_QUEUE = "demo.reset";
export const DEMO_RESET_CONSUMER = "demo.reset";

export interface DemoResetSettings {
  readonly mthEnv: string;
  readonly adminUrl: string | null;
  /** The worker's DATABASE_URL (the demo database it serves); only its database name is used. */
  readonly databaseUrl: string;
  /**
   * D-165: bind the demo users to the dev issuer as `mth-db reset-demo` does (AUTH_MODE=dev, never NODE_ENV=production;
   * `demoDevIssuerBindingAllowed`). Absent = false: nothing is bound.
   */
  readonly devIssuerBinding?: boolean;
}

export interface DemoResetDeps {
  readonly settings: () => DemoResetSettings;
  readonly reset: (options: DemoResetOptions) => Promise<DemoRunSummary>;
}

/** A job failure with a stable code (the failure queue shows it). */
export class DemoResetJobError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "DemoResetJobError";
    this.code = code;
  }
}

/** The worker's reset settings from its environment (the configuration, and the CLI's dev-issuer binding rule). */
export function demoResetSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): DemoResetSettings {
  const c = loadConfig("worker", env);
  return {
    mthEnv: c.mthEnv,
    adminUrl: c.demoAdminDatabaseUrl,
    databaseUrl: c.databaseUrl!,
    devIssuerBinding: demoDevIssuerBindingAllowed({ NODE_ENV: env["NODE_ENV"], AUTH_MODE: env["AUTH_MODE"] }),
  };
}

const defaultDeps: DemoResetDeps = {
  settings: () => demoResetSettingsFromEnv(process.env),
  reset: resetDemo,
};

/** The demo database as mth_owner, reached through the admin URL (migrations and the seed run as the owner). */
export function demoOwnerUrl(adminUrl: string, databaseUrl: string): string {
  const u = new URL(urlForDatabase(adminUrl, databaseNameOf(databaseUrl)));
  u.searchParams.set("options", "-c role=mth_owner");
  return u.toString();
}

export type DemoResetOutcome =
  | { readonly outcome: "duplicate" }
  | { readonly outcome: "reset"; readonly runNo: number; readonly checksumSha256: string };

export async function handleDemoReset(
  db: Db,
  data: unknown,
  jobId: string,
  deps: DemoResetDeps = defaultDeps,
): Promise<DemoResetOutcome> {
  const envelope = outboxEnvelope.parse(data);
  const payload = demoResetRequestedV1.parse(envelope.payload);
  const s = deps.settings();
  if (s.mthEnv !== "demo")
    throw new DemoResetJobError("environment.not_demo", "This is available only in the demo environment.");
  if (s.adminUrl === null)
    throw new DemoResetJobError("demo_reset.not_configured", "Demo reset is not configured for this deployment.");
  const ack = await runOnce(db, DEMO_RESET_CONSUMER, envelope.idempotencyKey, async () => null);
  if (ack.outcome === "duplicate") return { outcome: "duplicate" };
  const summary = await deps.reset({
    mthEnv: s.mthEnv,
    adminUrl: s.adminUrl,
    ownerUrl: demoOwnerUrl(s.adminUrl, s.databaseUrl),
    requestedVia: "api",
    requestedBy: payload.requestedBy,
    source: "worker",
    requestId: `job:${jobId}`,
    devIssuerBinding: s.devIssuerBinding === true,
  });
  return { outcome: "reset", runNo: summary.runNo, checksumSha256: summary.checksumSha256 };
}

export function demoResetHandler(deps: DemoResetDeps = defaultDeps): JobHandler {
  return { queue: DEMO_RESET_QUEUE, handle: (db, data, jobId) => handleDemoReset(db, data, jobId, deps) };
}

export const DEMO_HANDLERS: readonly JobHandler[] = [demoResetHandler()];
