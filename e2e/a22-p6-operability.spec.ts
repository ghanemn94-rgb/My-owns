// A22 "Operational readiness", P6 extension (qa-verifier, T-DG6-QA-E), the user-visible path: "Health checks, logs,
// error alerts, admin job visibility and production/demo separation are demonstrated" (master prompt §20; REQ-S20-022),
// with REQ-S12-019 "create a visible operational exception". The API-level proof (log lines, redaction, the alert line,
// the in-app alert, the log scan, audit and concurrency) is tests/qa/integration/a22-p6-operability.test.ts.
//
// Black-box on the REAL stack (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, migrate, seed-dev, the built
// API serving the built SPA; the API's heartbeat watch runs every 60 s) plus the BUILT production worker
// (`node apps/worker/dist/main.js`) as its own OS process. In the browser (chromium-en: English LTR; chromium-ar:
// Arabic RTL), as the technical administrator (dev.admin), on Administration > Operations:
//  - the heartbeat card shows exactly the status the API reports, and Alive only while a worker beats (with that
//    worker's instance key);
//  - after the worker stops and more than 90 s pass (the rows are aged in the database, as superuser, to simulate the
//    elapsed time), the card shows Stale (never Alive) and the API's watch opens one heartbeat_missed exception that is
//    listed on the screen; the administrator acknowledges it and then resolves it with notes from the screen, and the
//    API reports the same states;
//  - a Transformation Lead (no operations.read) gets the no-permission state, and the API 403;
//  - <html lang/dir>, axe 0 serious or critical issues, a screenshot of each screen.
// All data is SYNTHETIC; acknowledging an exception approves nothing (G1-G6) and nothing names the engineering gates.
/// <reference lib="dom" />
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, langOf, shot, signIn, tr, trackRequests, type Lang } from "../apps/web/e2e/support/ui.ts";
import {
  apiSession,
  ownerUrl,
  poll,
  send,
  startProductionWorker,
  type Api,
  type Body,
  type ProductionWorker,
} from "./support/a13-a22-stack.ts";

test.describe.configure({ timeout: 240_000 });

const DEV_ISSUER = "urn:mth:dev-local";

/**
 * Simulates "more than 90 s without a beat" without waiting: every worker_heartbeat row is moved 5 minutes into the
 * past, as cluster superuser (the owner URL without its role option) with session_replication_role = replica, which
 * skips the forward-only guard trigger that a clock shift cannot satisfy.
 */
function ageHeartbeats(): void {
  const u = new URL(ownerUrl());
  u.search = "";
  execFileSync(
    "psql",
    [
      u.toString(),
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `BEGIN; SET LOCAL session_replication_role = replica;
       UPDATE worker_heartbeat SET started_at = least(started_at, now() - interval '10 minutes'),
              last_beat_at = now() - interval '5 minutes';
       COMMIT;`,
    ],
    { encoding: "utf8" },
  );
}

async function expectDocument(page: Page, lang: Lang): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

async function heartbeatOf(admin: Api): Promise<Body> {
  const r = await send(admin, "GET", "/api/v1/admin/operations/heartbeat");
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

let worker: ProductionWorker | null = null;
test.afterAll(async () => {
  await worker?.stop();
});

test("A22 / REQ-S20-022: the Operations screen shows the worker heartbeat as the API reports it, and a missed heartbeat as one exception the administrator acknowledges and resolves", async ({
  page,
  playwright,
  baseURL,
}, info) => {
  const lang = langOf(info);
  const base = baseURL!;
  const foreign = trackRequests(page);
  const admin = await apiSession(playwright, base, "dev.admin");
  const orgId = admin.organizationId;
  const aliveLabel = tr(lang, "adminP6.operations.heartbeatStatus.alive");

  // ---- 1. Before this spec's worker: the card shows the API's status, and never "Alive" unless the API says alive.
  await signIn(page, lang, "dev.admin");
  await page.goto("/admin/operations");
  await expectDocument(page, lang);
  const card = page.locator("[data-heartbeat]");
  await expect(card).toBeVisible();
  const initial = (await heartbeatOf(admin)).status as string;
  expect(["unknown", "stale", "alive"]).toContain(initial);
  await expect(card).toHaveAttribute("data-heartbeat", initial);
  if (initial !== "alive") await expect(card.locator("p").first()).not.toContainText(aliveLabel);

  // ---- 2. The built worker beats: the card shows Alive with its instance key.
  worker = await startProductionWorker();
  const instanceKey = /"instanceKey":"(worker-[0-9a-f]{24})"/.exec(worker.output())?.[1];
  expect(instanceKey, worker.output()).toBeDefined();
  await poll(
    async () => {
      const h = await heartbeatOf(admin);
      return h.status === "alive" && (h.instances as Body[]).some((i) => i.instanceKey === instanceKey) ? h : null;
    },
    "the worker's first beat",
    60_000,
  );
  await page.reload();
  await expectDocument(page, lang);
  await expect(card).toHaveAttribute("data-heartbeat", "alive");
  await expect(card.locator("p").first()).toContainText(aliveLabel);
  await expect(page.locator("table[data-table='worker-instances']")).toContainText(instanceKey!);
  await expectAccessible(page, lang, "a22-p6-operations-alive");
  await shot(page, lang, "a22-p6-operations-alive");

  // ---- 3. The worker stops and > 90 s pass: Stale (never Alive); the watch opens one heartbeat_missed exception.
  await worker.stop();
  worker = null;
  ageHeartbeats();
  expect((await heartbeatOf(admin)).status).toBe("stale");
  await page.reload();
  await expect(card).toHaveAttribute("data-heartbeat", "stale");
  await expect(card.locator("p").first()).not.toContainText(aliveLabel);
  const opened = await poll(
    async () => {
      const l = await send(
        admin,
        "GET",
        `/api/v1/admin/operations/exceptions?organizationId=${orgId}&sourceKind=worker&limit=100`,
      );
      expect(l.status, JSON.stringify(l.body)).toBe(200);
      const open = (l.body.items as Body[]).filter((e) => e.failureClass === "heartbeat_missed" && e.status === "open");
      return open.length > 0 ? open : null;
    },
    "the API heartbeat watch (every 60 s) to open heartbeat_missed",
    90_000,
  );
  expect(opened, JSON.stringify(opened)).toHaveLength(1);
  const exceptionId: string = opened[0].id;

  await page.reload();
  const link = page.locator(`a[href='/admin/operations/exceptions/${exceptionId}']`);
  await expect(link).toBeVisible();
  await expect(link).toContainText(tr(lang, "adminP6.operations.failureClassValue.heartbeat_missed"));
  await expectAccessible(page, lang, "a22-p6-operations-stale");
  await shot(page, lang, "a22-p6-operations-stale");

  // ---- 4. Acknowledge, then resolve, from the screen; the API reports the same states.
  await link.click();
  await page.waitForURL(`**/admin/operations/exceptions/${exceptionId}`);
  await expectDocument(page, lang);
  const facts = page.locator(`[data-exception='${exceptionId}']`);
  await expect(facts).toHaveAttribute("data-status", "open");
  await expectAccessible(page, lang, "a22-p6-exception-open");
  await page.locator("[data-action='acknowledge']").click();
  await page.getByLabel(tr(lang, "adminP6.operations.acknowledgeNote")).fill("Synthetic QA acknowledgement");
  await page
    .locator("form")
    .getByRole("button", { name: tr(lang, "adminP6.operations.acknowledge") })
    .click();
  await expect(facts).toHaveAttribute("data-status", "acknowledged");
  expect((await send(admin, "GET", `/api/v1/admin/operations/exceptions/${exceptionId}`)).body).toMatchObject({
    status: "acknowledged",
    acknowledgeNote: "Synthetic QA acknowledgement",
  });
  await page.locator("[data-action='resolve']").click();
  await page.getByLabel(tr(lang, "adminP6.operations.resolveNote")).fill("Synthetic QA resolution");
  await page
    .locator("form")
    .getByRole("button", { name: tr(lang, "adminP6.operations.resolve") })
    .click();
  await expect(facts).toHaveAttribute("data-status", "resolved");
  await expect(page.locator("[data-action='acknowledge'], [data-action='resolve']")).toHaveCount(0);
  expect((await send(admin, "GET", `/api/v1/admin/operations/exceptions/${exceptionId}`)).body).toMatchObject({
    status: "resolved",
    resolution: "manual",
    resolutionNote: "Synthetic QA resolution",
  });
  await expectAccessible(page, lang, "a22-p6-exception-resolved");
  await shot(page, lang, "a22-p6-exception-resolved");

  // ---- 5. A Transformation Lead (no operations.read): no-permission on the screen, 403 from the API.
  const subject = `qa.a22p6.tl.${lang}.${Date.now().toString(36)}`;
  const u = await send(admin, "POST", "/api/v1/users", {
    organizationId: orgId,
    displayName: `QA A22 synthetic lead ${lang}`,
    email: `${subject}@example.invalid`,
    identity: { issuer: DEV_ISSUER, subject },
  });
  expect(u.status, JSON.stringify(u.body)).toBe(201);
  const units = await send(admin, "GET", `/api/v1/organizations/${orgId}/business-units`);
  const unit = (units.body.items as Body[])[0];
  const g = await send(admin, "POST", "/api/v1/role-assignments", {
    userId: u.body.id,
    roleCode: "TL",
    scope: { type: "business_unit", id: unit.id },
    reason: "QA A22 synthetic non-admin",
  });
  expect(g.status, JSON.stringify(g.body)).toBe(201);
  const tl = await apiSession(playwright, base, subject);
  expect((await send(tl, "GET", "/api/v1/admin/operations/heartbeat")).status).toBe(403);
  await page.context().clearCookies();
  await signIn(page, lang, subject);
  await page.goto("/admin/operations");
  await expectDocument(page, lang);
  await expect(page.locator("[data-heartbeat]")).toHaveCount(0);
  // Both sections (heartbeat, exceptions) show the no-permission state.
  await expect(page.getByText(tr(lang, "common.state.noPermissionTitle"), { exact: true })).toHaveCount(2);
  await expectAccessible(page, lang, "a22-p6-operations-forbidden");
  await shot(page, lang, "a22-p6-operations-forbidden");

  expect(foreign).toEqual([]);
  for (const a of [admin, tl]) await a.ctx.dispose().catch(() => undefined);
});
