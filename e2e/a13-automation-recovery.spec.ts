// A13 "Durable automation" (qa-verifier, T-DG5-QA-F; shared-stack waits by T-DG5-QA-F2): the user-visible path of "failed jobs remain recoverable" and
// REQ-S12-002 "a failed execution appears in the queue and succeeds on retry without duplicating actions".
//
// Black-box on the REAL stack (apps/web/e2e/support/with-stack.sh) plus the BUILT production worker
// (`node apps/worker/dist/main.js`) as its own process. Per language:
//  1. a synthetic admin rule is made live through the public API lifecycle (create, dry run, submit, the TO's
//     configuration review, publish, enable): on a new transformation, one task (create_task) and one reminder
//     (notify) for the TO;
//  2. disclosed fault injection in the disposable database, as its owner: inserting THIS rule's reminder raises an
//     error (a partial failure: the task is written, the reminder is not), and the automation.evaluate queue's retry
//     limit is set to 0 so the failure lands in the queue at once instead of after the production backoff (~5 min);
//  3. the Lead creates a transformation; the execution fails and its entry appears in Administration > Automation >
//     Failure queue (asserted in the browser, en LTR / ar RTL);
//  4. the cause is removed; the technical administrator clicks Retry; the row shows Resolved;
//  5. database rows: exactly one task and one reminder for the event, one execution, now succeeded.
// <html lang/dir>, axe (0 serious/critical) and screenshots (QA_EVIDENCE_DIR, default test-results/qa-a13).
// All data is SYNTHETIC; a rule review is a configuration review and approves nothing real.
/// <reference lib="dom" />
import { mkdirSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  apiSession,
  backlog,
  eventJobs,
  poll,
  psql,
  send,
  startProductionWorker,
  type Api,
  type Body,
  type ProductionWorker,
} from "./support/a13-a22-stack.ts";
import { SYN_RETAIL, signIn, tr, type Lang } from "../apps/web/e2e/support/ui.ts";

const EVIDENCE_DIR = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a13");
const RULES = "/api/v1/admin/automation-rules";
const langOf = (name: string): Lang => (name.endsWith("-ar") ? "ar" : "en");
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function shot(page: Page, lang: Lang, name: string) {
  mkdirSync(path.join(EVIDENCE_DIR, lang), { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, lang, `${name}.png`), fullPage: true });
}
async function accessible(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}
const ok = (r: { status: number; body: Body }, status: number) => expect(r.status, JSON.stringify(r.body)).toBe(status);
/**
 * T-DG5-QA-F2 (D-165): in the shared root stack this file's worker starts after the earlier specs, so it first relays and
 * works off their backlog (every earlier event fans out to the domain queues and automation.evaluate). Each wait below
 * that depends on the worker is therefore on THIS spec's own event or failure entry, never on a drained queue, with a
 * bound that allows that backlog. The time each wait took is logged (stdout) for the evidence.
 */
const BACKLOG_MS = 240_000;
const timed = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
  const t = Date.now();
  const v = await run();
  console.log(`[a13] ${label}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
  return v;
};

let worker: ProductionWorker | null = null;
let queueBefore: string | null = null;
test.beforeAll(async () => {
  psql(`
    CREATE TABLE IF NOT EXISTS public.qa_a13_fault (pattern text PRIMARY KEY);
    GRANT SELECT ON public.qa_a13_fault TO mth_app;
    CREATE OR REPLACE FUNCTION public.qa_a13_fault_fn() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF EXISTS (SELECT 1 FROM public.qa_a13_fault f WHERE NEW.dedupe_key LIKE f.pattern) THEN
        RAISE EXCEPTION 'qa-a13 synthetic transient fault';
      END IF;
      RETURN NEW;
    END $f$;
    DROP TRIGGER IF EXISTS qa_a13_fault_in ON public.inbox_notification;
    CREATE TRIGGER qa_a13_fault_in BEFORE INSERT ON public.inbox_notification FOR EACH ROW EXECUTE FUNCTION public.qa_a13_fault_fn();`);
  worker = await startProductionWorker();
  // Started by the worker with the production policy; only the queue under test gets retry limit 0 (disclosed), and
  // the production values are restored in afterAll (D-163).
  [queueBefore] = psql(
    "SELECT retry_limit || ',' || retry_delay || ',' || retry_backoff FROM pgboss.queue WHERE name = 'automation.evaluate'",
  );
  psql(
    "UPDATE pgboss.queue SET retry_limit = 0, retry_delay = 0, retry_backoff = false WHERE name = 'automation.evaluate'",
  );
});
test.afterAll(async () => {
  // Restore what this file changed in the shared stack (D-163): the queue policy and the fault trigger.
  if (queueBefore) {
    const [limit, delay, backoff] = queueBefore.split(",");
    psql(
      `UPDATE pgboss.queue SET retry_limit = ${Number(limit)}, retry_delay = ${Number(delay)}, retry_backoff = ${backoff === "t" ? "true" : "false"} WHERE name = 'automation.evaluate'`,
    );
  }
  psql(`DROP TRIGGER IF EXISTS qa_a13_fault_in ON public.inbox_notification;
    DROP FUNCTION IF EXISTS public.qa_a13_fault_fn();
    DROP TABLE IF EXISTS public.qa_a13_fault;`);
  await worker?.stop();
});

async function liveRule(method: Api, office: Api, orgId: string, code: string, sample: Body): Promise<string> {
  const created = await send(
    method,
    "POST",
    RULES,
    {
      code,
      nameEn: `Synthetic QA A13 rule ${code}`,
      nameAr: `قاعدة تجريبية ${code}`,
      scopeLevel: "organization",
      organizationId: orgId,
      ownerUserId: method.userId,
      content: {
        triggerCodes: ["transformation.created"],
        conditions: [],
        actions: [
          { type: "create_task", parameters: { assigneeRole: "TO", messageKey: "automation.message.follow_up" } },
          { type: "notify", parameters: { recipientRole: "TO", messageKey: "automation.message.update_due" } },
        ],
        runAs: "service",
        servicePermissionCodes: [],
      },
    },
    { "if-match": '"0"' },
  );
  ok(created, 201);
  const v1 = `${RULES}/${created.body.id}/versions/1`;
  const dry = await send(method, "POST", `${v1}/dry-runs`, { triggerCode: "transformation.created", payload: sample });
  ok(dry, 201);
  expect(dry.body.outcome).toBe("pass");
  const draft = await send(method, "GET", v1);
  const sub = await send(method, "POST", `${v1}/submit`, undefined, { "if-match": draft.etag! });
  ok(sub, 200);
  const rev = await send(
    office,
    "POST",
    `${v1}/review`,
    { outcome: "approve", note: "Synthetic QA configuration review (approves nothing real)." },
    { "if-match": sub.etag! },
  );
  ok(rev, 200);
  const rule = await send(method, "GET", `${RULES}/${created.body.id}`);
  ok(await send(method, "POST", `${v1}/publish`, undefined, { "if-match": rule.etag! }), 200);
  const rule2 = await send(method, "GET", `${RULES}/${created.body.id}`);
  ok(await send(method, "POST", `${RULES}/${created.body.id}/enable`, undefined, { "if-match": rule2.etag! }), 200);
  return created.body.id as string;
}

test("A13 / REQ-S12-002: a failed execution appears in the failure queue and succeeds on retry from the screen without duplicating actions", async ({
  page,
  playwright,
  baseURL,
}, info) => {
  // Three backlog-bounded waits (own event relayed and evaluated, failure entry, retry resolved) plus the screens.
  test.setTimeout(3 * BACKLOG_MS + 120_000);
  const lang = langOf(info.project.name);
  const admin = await apiSession(playwright, baseURL!, "dev.admin");
  const office = await apiSession(playwright, baseURL!, "dev.office");
  const lead = await apiSession(playwright, baseURL!, "dev.lead");
  const method = await apiSession(playwright, baseURL!, "dev.nobody");
  const orgId = admin.organizationId;
  // dev.nobody becomes the methodology administrator who configures rules (once per stack).
  const has = psql(
    `SELECT count(*) FROM scoped_assignment a JOIN role r ON r.id = a.role_id WHERE a.user_id = ${q(method.userId)} AND r.code = 'ADM_METHOD' AND a.revoked_at IS NULL`,
  );
  let granted: { id: string; version: number } | null = null;
  if (has[0] === "0") {
    const g = await send(admin, "POST", "/api/v1/role-assignments", {
      userId: method.userId,
      roleCode: "ADM_METHOD",
      scope: { type: "organization", id: orgId },
      reason: "Synthetic QA A13: configures automation rules (approves nothing real)",
    });
    ok(g, 201);
    granted = { id: g.body.id, version: g.body.version };
  }
  try {
    const newTransformation = async (label: string) => {
      const r = await send(lead, "POST", "/api/v1/transformations", {
        businessUnitId: SYN_RETAIL,
        name: `Synthetic QA A13 ${label} ${lang} ${Date.now()}`,
        mode: "end_to_end",
      });
      ok(r, 201);
      return r.body.id as string;
    };
    const t0 = await newTransformation("sample");
    const [payload] = psql(
      `SELECT payload::text FROM outbox_event WHERE aggregate_id = ${q(t0)} AND event_type = 'transformation.created'`,
    );
    const { launchPlan: _v2, ...sample } = JSON.parse(payload!) as Body; // the dry run takes the v1 members
    void _v2;
    const code = `qa_a13_e2e_${lang}_${Date.now().toString(36)}`;
    const ruleId = await liveRule(method, office, orgId, code, sample);

    // The fault: this rule's reminder (action 2) cannot be written.
    psql(`INSERT INTO public.qa_a13_fault (pattern) VALUES (${q(`automation:${code}:%:2:%`)})`);
    let faultOn = true;
    try {
      const t1 = await newTransformation("failing");
      const [eventId, key] = psql(
        `SELECT id || chr(10) || idempotency_key FROM outbox_event WHERE aggregate_id = ${q(t1)} AND event_type = 'transformation.created'`,
      );
      const ownState = () => `${JSON.stringify(eventJobs(eventId!))}; ${backlog()}`;
      // Own event: relayed, and its automation.evaluate job finished (with retry limit 0, one attempt).
      await timed("own event relayed and evaluated", () =>
        poll(
          async () => {
            const s = eventJobs(eventId!);
            const evaluate = s.jobs.find((j) => j.name === "automation.evaluate");
            return s.published && evaluate !== undefined && ["completed", "failed"].includes(evaluate.state);
          },
          "this spec's transformation.created event to be relayed and evaluated",
          BACKLOG_MS,
          ownState,
        ),
      );
      const exec = await timed("own failed execution listed", () =>
        poll(
          async () => {
            const r = await send(admin, "GET", `/api/v1/admin/automation-executions?ruleId=${ruleId}&limit=100`);
            return (r.body?.items as Body[] | undefined)?.find((e) => e.triggerKey === key && e.status === "failed");
          },
          "the failed execution",
          60_000,
          () => `${ownState()}; worker: ${worker?.output().slice(-4000)}`,
        ),
      );
      const failure = await timed("own failure-queue entry listed", () =>
        poll(
          async () => {
            const r = await send(
              admin,
              "GET",
              "/api/v1/admin/automation-failures?source=rule_execution&status=open&limit=100",
            );
            return (r.body?.items as Body[] | undefined)?.find((f) => f.executionId === exec.id);
          },
          "the failure-queue entry",
          60_000,
          ownState,
        ),
      );
      const counts = () => ({
        tasks: Number(
          psql(`SELECT count(*) FROM work_item WHERE dedupe_key LIKE ${q(`automation:${code}:${key}:1:%`)}`)[0],
        ),
        reminders: Number(
          psql(
            `SELECT count(*) FROM inbox_notification WHERE dedupe_key LIKE ${q(`automation:${code}:${key}:2:%`)}`,
          )[0],
        ),
      });
      expect(counts(), "partial failure: the task is written, the reminder is not").toEqual({ tasks: 1, reminders: 0 });

      // The technical administrator sees it in the failure queue.
      await signIn(page, lang, "dev.admin");
      await page.goto("/admin/automation/failures");
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p5.automationFailures.title"));
      const row = page.locator("tbody tr", { hasText: failure.idempotencyKey });
      await expect(row).toHaveCount(1);
      await expect(row.getByText(tr(lang, "workflowsP5.failureStatus.open"), { exact: true })).toBeVisible();
      await expect(row.locator(`[data-error-code='${failure.errorCode}']`)).toHaveCount(1);
      await accessible(page);
      await shot(page, lang, "a13-failure-queue-open");

      // The cause is fixed; Retry from the screen.
      psql(`DELETE FROM public.qa_a13_fault WHERE pattern = ${q(`automation:${code}:%:2:%`)}`);
      faultOn = false;
      await row.locator("[data-action='retry-failure']").click();
      await timed("own retried entry resolved", () =>
        poll(
          async () => {
            const r = await send(admin, "GET", `/api/v1/admin/automation-failures/${failure.id}`);
            return r.body?.status === "resolved";
          },
          "the retried entry resolved",
          BACKLOG_MS,
          backlog,
        ),
      );
      await page.reload();
      // The queue lists open entries by default; show every status.
      await page.getByRole("combobox", { name: tr(lang, "workflowsP5.field.status"), exact: true }).selectOption("");
      const resolved = page.locator("tbody tr", { hasText: failure.idempotencyKey });
      await expect(resolved.getByText(tr(lang, "workflowsP5.failureStatus.resolved"), { exact: true })).toBeVisible();
      await expect(resolved.locator("[data-action='retry-failure']")).toHaveCount(0);
      await accessible(page);
      await shot(page, lang, "a13-failure-queue-resolved");

      // No duplicate: one task, one reminder, one execution (succeeded).
      expect(counts(), "after the retry: one task and one reminder").toEqual({ tasks: 1, reminders: 1 });
      expect(
        psql(
          `SELECT status FROM automation_execution WHERE automation_rule_id = ${q(ruleId)} AND trigger_key = ${q(key!)}`,
        ),
      ).toEqual(["succeeded"]);
    } finally {
      if (faultOn) psql(`DELETE FROM public.qa_a13_fault WHERE pattern = ${q(`automation:${code}:%:2:%`)}`);
      // D-163: the synthetic rule must not act on the other specs' transformations; switch it off.
      const cur = await send(method, "GET", `${RULES}/${ruleId}`);
      ok(
        await send(
          method,
          "POST",
          `${RULES}/${ruleId}/disable`,
          { reason: "Synthetic QA A13: end of the acceptance spec" },
          { "if-match": cur.etag! },
        ),
        200,
      );
    }
  } finally {
    // D-163: dev.nobody is a no-permission user for the other specs of the stack; take the grant back.
    if (granted)
      ok(
        await send(
          admin,
          "POST",
          `/api/v1/role-assignments/${granted.id}/revoke`,
          { reason: "Synthetic QA A13: restore the seeded state" },
          { "if-match": `"${granted.version}"` },
        ),
        200,
      );
  }
});
