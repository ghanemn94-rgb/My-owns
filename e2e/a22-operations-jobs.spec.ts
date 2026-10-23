// A22 "Operational readiness" (qa-verifier, T-DG5-QA-F): the user-visible path of REQ-S12-022 "the jobs screen shows
// last success and next run for each scheduled job; a non-admin gets 403", and of the production side of the
// production/demo separation (REQ-S18-001/S18-003: a database that is not a demo database shows no synthetic banner;
// GET /environment says production).
//
// Black-box on the REAL stack (apps/web/e2e/support/with-stack.sh) plus the BUILT production worker
// (`node apps/worker/dist/main.js`) as its own process, so a run-now is really executed and recorded. Asserted in the
// browser (chromium-en: English LTR, chromium-ar: Arabic RTL):
//  - <html lang/dir> of the language; the screen title from the shipped catalogue;
//  - EVERY scheduled job of GET /api/v1/admin/jobs has its row, with last success ("Never run" chip, or the recorded
//    time) and next run (the API's instant, or the "Disabled" chip) - none empty;
//    F-DG5-142: the next run is recomputed at request time and a */15 job's next run (and, with the worker running, its
//    last success) changes at every quarter hour, so the row is compared with the jobs response the SCREEN itself
//    loaded (its own GET /api/v1/admin/jobs, captured from the page's network), never with an earlier read by the test.
//    That one snapshot is then bracketed by the test's own API reads before and after the screen's: same jobs, and
//    every value within [before, after] (they only move forward), so the screen still shows exactly what the API
//    computed. QA_A22_CROSS_BOUNDARY=1 waits after the first read until a quarter hour has passed, so a run proves a
//    boundary between the test's read and the screen's read cannot fail the spec;
//  - after "Run now" on one job and the worker's run, that row shows a recorded last success and the "Succeeded"
//    outcome, and the job's page lists the run;
//  - the auditor and the Transformation Lead get the no-permission state (and the API 403);
//  - no synthetic-demonstration banner on this production database; axe: 0 serious or critical issues.
// Screenshots go to QA_EVIDENCE_DIR (default test-results/qa-a22). All data is SYNTHETIC.
/// <reference lib="dom" />
import { mkdirSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, send, startProductionWorker, type Body, type ProductionWorker } from "./support/a13-a22-stack.ts";
import { signIn, tr, type Lang } from "../apps/web/e2e/support/ui.ts";

const EVIDENCE_DIR = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a22");
const langOf = (name: string): Lang => (name.endsWith("-ar") ? "ar" : "en");

async function shot(page: Page, lang: Lang, name: string) {
  mkdirSync(path.join(EVIDENCE_DIR, lang), { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, lang, `${name}.png`), fullPage: true });
}

async function accessible(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** The jobs responses the PAGE received (GET /api/v1/admin/jobs, 200), in arrival order; latest() is the last one. */
function screenJobs(page: Page): { latest: () => Body[] | null; count: () => number } {
  const bodies: (Body[] | undefined)[] = [];
  page.on("response", (r) => {
    if (r.request().method() !== "GET" || new URL(r.url()).pathname !== "/api/v1/admin/jobs" || r.status() !== 200)
      return;
    const slot = bodies.length;
    bodies.push(undefined);
    void r
      .json()
      .then((b: Body) => {
        bodies[slot] = b.items as Body[];
      })
      .catch(() => undefined);
  });
  return { latest: () => bodies.at(-1) ?? null, count: () => bodies.length };
}

/** a <= x <= b for ISO-8601 instants of one format, a missing value (null) ordered first. */
const within = (a: string | null, x: string | null, b: string | null): boolean =>
  (a ?? "") <= (x ?? "") && (x ?? "") <= (b ?? "");

// The next quarter hour after `now` (the quarter-hourly schedules fire then; Asia/Riyadh is UTC+3: UTC quarters match).
const nextQuarterHour = (now: number): number => Math.floor(now / 900_000) * 900_000 + 900_000;

let worker: ProductionWorker | null = null;
test.beforeAll(async () => {
  worker = await startProductionWorker();
});
test.afterAll(async () => {
  await worker?.stop();
});

test("A22 / REQ-S12-022: the jobs screen shows last success and next run for every scheduled job; run now is recorded; non-admins get 403", async ({
  page,
  browser,
  playwright,
  baseURL,
}, info) => {
  const crossBoundary = process.env["QA_A22_CROSS_BOUNDARY"] === "1";
  test.setTimeout(crossBoundary ? 1_200_000 : 150_000);
  const lang = langOf(info.project.name);
  const admin = await apiSession(playwright, baseURL!, "dev.admin");
  const env = await send(admin, "GET", "/api/v1/environment");
  expect(env.status).toBe(200);
  expect(env.body).toMatchObject({ kind: "production", synthetic: false });
  const jobs = await send(admin, "GET", "/api/v1/admin/jobs");
  expect(jobs.status).toBe(200);
  const items = jobs.body.items as Body[];
  expect(items.length).toBeGreaterThan(0);
  const readAt = Date.now();
  if (crossBoundary) {
    // Waits past the next quarter hour (+3 s), so the screen's own read below is on the other side of a boundary.
    const until = nextQuarterHour(readAt) + 3_000;
    console.log(
      `A22 cross-boundary: API read at ${new Date(readAt).toISOString()}, waiting until ${new Date(until).toISOString()}`,
    );
    await new Promise((res) => setTimeout(res, until - Date.now()));
  }

  const screen = screenJobs(page);
  await signIn(page, lang, "dev.admin");
  await page.goto("/admin/jobs/operations");
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "workflowsP5.jobs.title"));
  // Production database: no synthetic-demonstration banner anywhere on the screen.
  await expect(page.locator("[data-state='demo-synthetic']")).toHaveCount(0);
  await expect(page.getByText(tr(lang, "playbookP5.demo.banner"))).toHaveCount(0);

  // The register pages by 10; show every row on one page.
  await page.getByRole("combobox", { name: tr(lang, "common.table.pageSize") }).selectOption("100");
  for (const job of items)
    await expect(page.locator("tbody tr", { hasText: job.code }), `row of ${job.code}`).toHaveCount(1);
  // Every row against the one response the screen rendered (the latest the page received; F-DG5-142).
  let rendered: Body[] = [];
  await expect(async () => {
    const latest = screen.latest();
    expect(latest, "the screen's own GET /api/v1/admin/jobs").not.toBeNull();
    rendered = latest!;
    for (const job of rendered) {
      const row = page.locator("tbody tr", { hasText: job.code });
      await expect(row, `row of ${job.code}`).toHaveCount(1, { timeout: 2_000 });
      if (job.lastSuccessAt === null)
        await expect(row.locator("[data-status='never_run']").first(), `${job.code}: Never run`).toHaveText(
          tr(lang, "workflowsP5.jobs.neverRun"),
          { timeout: 2_000 },
        );
      else
        await expect(
          row.locator(`[data-last-success='${job.lastSuccessAt}']`),
          `${job.code}: last success`,
        ).toHaveCount(1, { timeout: 2_000 });
      if (job.nextRunAt !== null)
        await expect(row.locator(`[data-next-run='${job.nextRunAt}']`), `${job.code}: next run`).toHaveCount(1, {
          timeout: 2_000,
        });
      else
        await expect(
          row.locator(`[data-status='${job.nextRunUnknownReason}']`),
          `${job.code}: no next run`,
        ).toHaveCount(1, { timeout: 2_000 });
    }
  }).toPass({ timeout: 30_000 });
  // The screen's snapshot is the API's: the same jobs as the test's reads, each value between the read before the
  // screen's and the read after it (a next run and a last success only move forward; a disabled job stays disabled).
  const later = (await send(admin, "GET", "/api/v1/admin/jobs")).body.items as Body[];
  const byCode = (list: Body[]) => new Map(list.map((j) => [j.code as string, j]));
  const [b0, b1] = [byCode(items), byCode(later)];
  expect(rendered.map((j) => j.code).sort()).toEqual(items.map((j) => j.code).sort());
  expect(later.map((j) => j.code).sort()).toEqual(items.map((j) => j.code).sort());
  for (const job of rendered) {
    const [x, y] = [b0.get(job.code)!, b1.get(job.code)!];
    expect(within(x.lastSuccessAt, job.lastSuccessAt, y.lastSuccessAt), `${job.code}: last success`).toBe(true);
    expect([x.nextRunAt === null, job.nextRunAt === null, y.nextRunAt === null], `${job.code}: enabled`).toEqual([
      job.nextRunAt === null,
      job.nextRunAt === null,
      job.nextRunAt === null,
    ]);
    if (job.nextRunAt === null) expect(job.nextRunUnknownReason).toBe(x.nextRunUnknownReason);
    else expect(within(x.nextRunAt, job.nextRunAt, y.nextRunAt), `${job.code}: next run`).toBe(true);
  }
  if (crossBoundary) {
    // The run did cross a boundary: a */15 job's next run moved between the test's first read and the screen's.
    const quarter = rendered.find((j) => j.code === "approval.escalation_scan");
    expect(quarter?.nextRunAt, "approval.escalation_scan is scheduled").toBeTruthy();
    expect(quarter.nextRunAt > b0.get("approval.escalation_scan")!.nextRunAt, "a boundary was crossed").toBe(true);
    console.log(
      `A22 cross-boundary: approval.escalation_scan next run ${b0.get("approval.escalation_scan")!.nextRunAt} ` +
        `(test read) -> ${quarter.nextRunAt} (screen read, ${screen.count()} response(s))`,
    );
  }
  await accessible(page);
  await shot(page, lang, "a22-jobs-operations");

  // Run now, executed by the production worker: the row then shows a recorded last success and "Succeeded".
  const code = "reports.owner_update_tasks";
  const row = page.locator("tbody tr", { hasText: code });
  await row.locator("[data-action='run-now']").click();
  const ran = await (async () => {
    const until = Date.now() + 90_000;
    for (;;) {
      const r = await send(admin, "GET", `/api/v1/admin/jobs/${code}`);
      if (r.body?.job?.lastSuccessAt) return r.body;
      if (Date.now() > until) throw new Error(`the run of ${code} was not recorded; worker: ${worker?.output()}`);
      await new Promise((res) => setTimeout(res, 500));
    }
  })();
  await page.reload();
  await page.getByRole("combobox", { name: tr(lang, "common.table.pageSize") }).selectOption("100");
  const after = page.locator("tbody tr", { hasText: code });
  await expect(after.locator(`[data-last-success='${ran.job.lastSuccessAt}']`)).toHaveCount(1);
  await expect(after.locator("[data-status='succeeded']")).toHaveText(tr(lang, "workflowsP5.jobs.succeeded"));
  await shot(page, lang, "a22-jobs-after-run");
  await page.goto(`/admin/jobs/operations/${code}`);
  await expect(page.locator(`[data-job='${code}']`)).toBeVisible();
  await expect(page.getByText(tr(lang, "workflowsP5.jobs.noRuns"), { exact: true })).toHaveCount(0);
  await accessible(page);

  // Non-admins: the server's 403 is the no-permission state.
  for (const user of ["dev.auditor", "dev.lead"]) {
    const api = await apiSession(playwright, baseURL!, user);
    expect((await send(api, "GET", "/api/v1/admin/jobs")).status, `${user}: API`).toBe(403);
    const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
    try {
      const p = await ctx.newPage();
      await signIn(p, lang, user);
      await p.goto("/admin/jobs/operations");
      await expect(p.getByText(tr(lang, "common.state.noPermissionTitle"), { exact: true })).toBeVisible();
      await expect(p.locator("[data-action='run-now']")).toHaveCount(0);
      await expect(p.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      await shot(p, lang, `a22-jobs-403-${user}`);
    } finally {
      await ctx.close();
    }
  }
});
