// qa-verifier acceptance support for A13 "Durable automation" (DG5, T-DG5-QA-F). Setup and observation only; no
// assertion about an acceptance outcome lives here.
//
// Every suite that uses it runs on its OWN scratch database of the run's disposable cluster (pg-boss queue policies
// are global state of a database), with:
//  - the REAL API (Fastify inject, every response validated against docs/api/openapi.yaml by the harness);
//  - the REAL worker (`startWorker`, every registered domain handler, the outbox relay and the failure capture) on the
//    same database, or a REAL worker in a separate OS process (a13-child-worker.ts) that the suite kills;
//  - admin rules made live only through the public lifecycle of the contract: create -> dry run -> submit -> review by
//    the TO -> publish -> enable (docs/api/openapi.yaml, ADR-0043 §4).
// Fault injection (disclosed): a trigger the suite installs in ITS scratch database, as the cluster superuser, on
// work_item / inbox_notification rows whose dedupe key matches a pattern the test sets. Mode `raise` makes the insert
// throw (a transient error: the action's transaction rolls back), mode `block` makes it wait on an advisory lock the
// test holds (the job is then "mid-job": inside its transaction, not committed). No product file is touched; dropping
// the pattern is "fixing the cause".
// All people and data are SYNTHETIC. A rule review is a configuration review; nothing here approves anything real,
// and nothing touches the engineering gates DG0-DG7.
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";
import { migrate } from "../../../packages/db/src/migrate.ts";
import {
  createScratchDatabase,
  dropScratchDatabase,
  roleUrl,
  testDatabase,
} from "../../../packages/db/test/helpers.ts";
import { createBoss, startWorker, type RunningWorker } from "../../../apps/worker/src/index.ts";
import {
  call,
  createBu,
  createPool,
  createOrg,
  createUser,
  grant,
  signIn,
  startApi,
  uniq,
  type Res,
  type Session,
  type TestApi,
} from "./api.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;
type Pool = ReturnType<typeof createPool>;

export const RULES = "/api/v1/admin/automation-rules";
export const EXECUTIONS = "/api/v1/admin/automation-executions";
export const FAILURES = "/api/v1/admin/automation-failures";
export const quiet = { info: () => undefined, error: () => undefined };

/** The bounded retry policy of the worker in these suites: 2 retries (3 attempts), no delay, so a run takes seconds. */
export const QA_QUEUE_POLICY = { retryLimit: 2, retryDelay: 0, retryBackoff: false } as const;

export async function waitFor<T>(
  probe: () => Promise<T | null | undefined | false>,
  what: string,
  ms = 30_000,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

export interface ScratchEnv {
  readonly dbName: string;
  readonly appUrl: string;
  readonly api: TestApi;
  /** Cluster superuser on this scratch database: fault injection, pg-boss inspection and backend termination only. */
  readonly su: Pool;
  close(): Promise<void>;
}

export async function scratchEnv(prefix: string): Promise<ScratchEnv> {
  const { adminUrl } = testDatabase();
  const dbName = await createScratchDatabase(adminUrl, prefix);
  await migrate(roleUrl(adminUrl, dbName, "mth_owner"));
  const appUrl = roleUrl(adminUrl, dbName, "mth_app");
  const api = await startApi({ database: dbName });
  const su = createPool(roleUrl(adminUrl, dbName, null), { max: 3, applicationName: "qa-a13-su" });
  return {
    dbName,
    appUrl,
    api,
    su,
    async close() {
      await api.close().catch(() => undefined);
      await su.end().catch(() => undefined);
      await dropScratchDatabase(adminUrl, dbName);
    },
  };
}

// ------------------------------------------------------------------ people

export interface Person {
  readonly id: string;
  readonly session: Session;
}

/** One synthetic organization per scenario, so an organization-scoped rule only sees the events of its scenario. */
export interface OrgWorld {
  readonly orgId: string;
  readonly bu: string;
  readonly grantorId: string;
  /** ADM_METHOD: configures rules, repairs rule-execution failures. */
  readonly method: Person;
  /** TO: reviews rule versions; holds the rule's assignee role; creates transformations. */
  readonly office: Person;
  /** ADM_TECH: jobs view, job repair. */
  readonly tech: Person;
  readonly auditor: Person;
  /** A TL on the business unit: a non-admin. */
  readonly lead: Person;
}

export async function orgWorld(api: TestApi): Promise<OrgWorld> {
  const org = await createOrg(api.db);
  const bu = await createBu(api.db, org.id);
  const grantor = await createUser(api.db, org.id);
  const person = async (role: string, scope: { type: string; id: string }): Promise<Person> => {
    const u = await createUser(api.db, org.id);
    await grant(api.db, grantor.id, u.id, role, scope as never, org.id);
    return { id: u.id, session: await signIn(api.app, u.subject) };
  };
  const orgScope = { type: "organization", id: org.id };
  return {
    orgId: org.id,
    bu,
    grantorId: grantor.id,
    method: await person("ADM_METHOD", orgScope),
    office: await person("TO", orgScope),
    tech: await person("ADM_TECH", orgScope),
    auditor: await person("AUD", orgScope),
    lead: await person("TL", { type: "business_unit", id: bu }),
  };
}

// ------------------------------------------------------------------ rules (public lifecycle only)

export const etagOf = (r: Res<Body>): string => {
  const e = r.headers["etag"];
  expect(typeof e, `ETag of ${r.status} ${JSON.stringify(r.body)}`).toBe("string");
  return String(e);
};

export interface LiveRule {
  readonly id: string;
  readonly code: string;
  readonly versionId: string;
  readonly versionNo: number;
}

export const followUpTask = {
  type: "create_task",
  parameters: { assigneeRole: "TO", messageKey: "automation.message.follow_up" },
};
export const updateDueReminder = {
  type: "notify",
  parameters: { recipientRole: "TO", messageKey: "automation.message.update_due" },
};

/** The rule content of the A13 scenarios: on a new transformation, one task and one reminder for the TO. */
export const taskAndReminder = (actions: readonly Body[] = [followUpTask, updateDueReminder]) => ({
  triggerCodes: ["transformation.created"],
  conditions: [],
  actions,
  runAs: "service",
  servicePermissionCodes: [],
});

/**
 * Creates an admin rule through the API, dry-runs it against `sample`, submits it, has the TO approve the
 * configuration review, publishes and enables it. Every step asserts its contract status. Returns the live rule.
 */
export async function liveRule(
  api: TestApi,
  w: OrgWorld,
  codePrefix: string,
  content: Body,
  sample: { triggerCode: string; payload: Body },
): Promise<LiveRule> {
  const code = `${codePrefix}_${uniq("").toLowerCase()}`;
  const created = await call<Body>(api.app, "POST", RULES, {
    session: w.method.session,
    headers: { "if-match": '"0"' },
    body: {
      code,
      nameEn: `Synthetic A13 rule ${code}`,
      nameAr: `قاعدة تجريبية ${code}`,
      scopeLevel: "organization",
      organizationId: w.orgId,
      ownerUserId: w.method.id,
      content,
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const ruleId = created.body.id as string;
  const v1 = `${RULES}/${ruleId}/versions/1`;
  const dry = await call<Body>(api.app, "POST", `${v1}/dry-runs`, { session: w.method.session, body: sample });
  expect([dry.status, dry.body.outcome], JSON.stringify(dry.body)).toEqual([201, "pass"]);
  const draft = await call<Body>(api.app, "GET", v1, { session: w.method.session });
  const submitted = await call<Body>(api.app, "POST", `${v1}/submit`, {
    session: w.method.session,
    headers: { "if-match": etagOf(draft) },
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  const reviewed = await call<Body>(api.app, "POST", `${v1}/review`, {
    session: w.office.session,
    headers: { "if-match": etagOf(submitted) },
    body: { outcome: "approve", note: "Synthetic QA configuration review (approves nothing real)." },
  });
  expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
  const rule = await call<Body>(api.app, "GET", `${RULES}/${ruleId}`, { session: w.method.session });
  const published = await call<Body>(api.app, "POST", `${v1}/publish`, {
    session: w.method.session,
    headers: { "if-match": etagOf(rule) },
  });
  expect(published.status, JSON.stringify(published.body)).toBe(200);
  const rule2 = await call<Body>(api.app, "GET", `${RULES}/${ruleId}`, { session: w.method.session });
  const enabled = await call<Body>(api.app, "POST", `${RULES}/${ruleId}/enable`, {
    session: w.method.session,
    headers: { "if-match": etagOf(rule2) },
  });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
  expect(enabled.body.enabled).toBe(true);
  return { id: ruleId, code, versionId: published.body.id as string, versionNo: published.body.versionNo as number };
}

/** POST /transformations as the TO of the scenario's organization; returns the created body. */
export async function newTransformation(api: TestApi, w: OrgWorld, label: string): Promise<Body> {
  const r = await call<Body>(api.app, "POST", "/api/v1/transformations", {
    session: w.office.session,
    body: { businessUnitId: w.bu, name: `Synthetic QA A13 ${label} ${uniq("")}`, mode: "end_to_end" },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

export async function outboxOf(api: TestApi, transformationId: string, eventType = "transformation.created") {
  return api.db
    .selectFrom("outbox_event")
    .selectAll()
    .where("aggregate_id", "=", transformationId)
    .where("event_type", "=", eventType)
    .execute();
}

/**
 * The sample of a dry run: the COMPLETE schema-version-1 payload of a real transformation.created event (the v1 members of what the
 * outbox carries) (the contract's AutomationDryRunRequest rule for an event with a payload schema).
 */
export async function sampleFrom(
  api: TestApi,
  transformationId: string,
): Promise<{ triggerCode: string; payload: Body }> {
  const [e] = await outboxOf(api, transformationId);
  const p = (typeof e!.payload === "string" ? JSON.parse(e!.payload) : e!.payload) as Body;
  // The outbox now carries schema version 2 (v1 + launchPlan); the dry run takes the v1 members only.
  const { launchPlan: _v2Only, ...v1 } = p;
  void _v2Only;
  return { triggerCode: "transformation.created", payload: v1 };
}

// ------------------------------------------------------------------ observation (database rows)

/** The effects of a rule: work items and notifications keyed `automation:<rule code>:...` (ADR-0043 §2 key pattern). */
export async function effectsOf(api: TestApi, ruleCode: string) {
  const items = await api.db
    .selectFrom("work_item")
    .select(["id", "dedupe_key", "assignee_user_id", "transformation_id"])
    .where("dedupe_key", "like", `automation:${ruleCode}:%`)
    .execute();
  const notes = await api.db
    .selectFrom("inbox_notification")
    .selectAll()
    .where("dedupe_key", "like", `automation:${ruleCode}:%`)
    .execute();
  return { items, notes };
}

export async function executionsOf(api: TestApi, ruleId: string) {
  return api.db.selectFrom("automation_execution").selectAll().where("automation_rule_id", "=", ruleId).execute();
}

export async function actionResultsOf(api: TestApi, executionId: string) {
  return api.db
    .selectFrom("automation_action_result")
    .selectAll()
    .where("automation_execution_id", "=", executionId)
    .orderBy("attempt_no")
    .orderBy("ordinal")
    .execute();
}

// ------------------------------------------------------------------ fault injection (scratch database only)

export async function installFaults(su: Pool): Promise<void> {
  await su.query(`
    CREATE TABLE IF NOT EXISTS public.qa_a13_fault (pattern text PRIMARY KEY, mode text NOT NULL CHECK (mode IN ('raise','block')));
    GRANT SELECT ON public.qa_a13_fault TO mth_app;
    CREATE OR REPLACE FUNCTION public.qa_a13_fault_fn() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF EXISTS (SELECT 1 FROM public.qa_a13_fault f WHERE f.mode = 'raise' AND NEW.dedupe_key LIKE f.pattern) THEN
        RAISE EXCEPTION 'qa-a13 synthetic transient fault on %', TG_TABLE_NAME;
      END IF;
      IF EXISTS (SELECT 1 FROM public.qa_a13_fault f WHERE f.mode = 'block' AND NEW.dedupe_key LIKE f.pattern) THEN
        PERFORM pg_advisory_xact_lock_shared(7313013);
      END IF;
      RETURN NEW;
    END $f$;
    DROP TRIGGER IF EXISTS qa_a13_fault_wi ON public.work_item;
    CREATE TRIGGER qa_a13_fault_wi BEFORE INSERT ON public.work_item FOR EACH ROW EXECUTE FUNCTION public.qa_a13_fault_fn();
    DROP TRIGGER IF EXISTS qa_a13_fault_in ON public.inbox_notification;
    CREATE TRIGGER qa_a13_fault_in BEFORE INSERT ON public.inbox_notification FOR EACH ROW EXECUTE FUNCTION public.qa_a13_fault_fn();
  `);
}

export async function setFault(su: Pool, pattern: string, mode: "raise" | "block"): Promise<void> {
  await su.query(
    "INSERT INTO public.qa_a13_fault (pattern, mode) VALUES ($1, $2) ON CONFLICT (pattern) DO UPDATE SET mode = $2",
    [pattern, mode],
  );
}

export async function clearFault(su: Pool, pattern: string): Promise<void> {
  await su.query("DELETE FROM public.qa_a13_fault WHERE pattern = $1", [pattern]);
}

// ------------------------------------------------------------------ workers

export function qaBoss(appUrl: string, name: string) {
  const boss = createBoss(appUrl, {
    schedule: false,
    supervise: true,
    superviseIntervalSeconds: 1,
    monitorIntervalSeconds: 1,
    applicationName: name,
  });
  boss.on("error", () => undefined);
  return boss;
}

/** The production worker (every registered domain handler) in this process, with the QA retry policy. */
export async function inProcessWorker(env: ScratchEnv, boss: ReturnType<typeof createBoss>): Promise<RunningWorker> {
  return startWorker({
    db: env.api.db,
    boss,
    timeZone: "Asia/Riyadh",
    pollIntervalMs: 100,
    jobPollingIntervalSeconds: 0.5,
    queuePolicy: QA_QUEUE_POLICY,
    log: quiet,
  });
}

export const CHILD_APP_NAME = "qa-a13-child-worker";

/** The production worker in a separate OS process (a13-child-worker.ts); resolves when it reports READY. */
export async function childWorker(appUrl: string): Promise<{ child: ChildProcess; output: () => string }> {
  const child = spawn(
    process.execPath,
    ["--conditions=@mth/source", fileURLToPath(new URL("./a13-child-worker.ts", import.meta.url))],
    {
      env: { ...process.env, QA_CHILD_DB_URL: appUrl, QA_CHILD_POLICY: JSON.stringify(QA_QUEUE_POLICY) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let out = "";
  child.stdout!.on("data", (b: Buffer) => (out += b.toString()));
  child.stderr!.on("data", (b: Buffer) => (out += b.toString()));
  await waitFor(
    async () => {
      if (child.exitCode !== null) throw new Error(`child worker exited (${child.exitCode}) before READY: ${out}`);
      return out.includes("READY");
    },
    "child worker READY",
    60_000,
  );
  return { child, output: () => out };
}
