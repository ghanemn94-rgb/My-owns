// T-DG5-REV-QA-R7C: copied from tests/round-7-r7-orphaned/e2e/ (written by this role's run T-DG5-REV-QA-R7, stopped by a container restart), re-read and re-run here; unchanged except where a comment says 'T-DG5-REV-QA-R7C'.
// qa-verifier DG5 round 7 (T-DG5-REV-QA-R7): an attempt to reproduce, and to explain, the D-182 failure of
// apps/web/e2e/p5-launch-health-kpi.spec.ts:159 (chromium-ar; after the second Submit, [data-assessment-status='submitted']
// was "not found" within 5 s). NOT part of the candidate; copied into a disposable clone's e2e/ for the run only.
// It replays the product spec's ending exactly (24 answers through the API, the 25th and the top-3 actions through the
// screen, waiting for the actions PUT and the assessment GET, then clicking Submit), and instead of a 5 s assertion it
// RECORDS: the submit response (status, the If-Match sent, the version the server held), the time until the submitted
// status appears (up to 60 s), and any alert text. The browser CPU is slowed through CDP (Emulation.setCPUThrottlingRate)
// at the rate in QA_CPU_RATE (default 1), to imitate full-suite load.
// It asserts only the outcome the product spec asserts (submitted visible), with a 60 s budget, so the record says whether
// a failure is "slow" (appears after 5 s) or "refused" (a non-2xx submit, e.g. a stale If-Match).
// Everything is SYNTHETIC; nothing here grants a business approval (G1-G6) or touches the delivery gates DG0-DG7.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, langOf, signIn, SYN_RETAIL, tr } from "../apps/web/e2e/support/ui.ts";

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r7-health");
const RATE = Number(process.env["QA_CPU_RATE"] ?? "1");
const h1 = (page: Page) => page.locator("main#main h1");

test("R7-HEALTH-RACE: health check submit after saving the top-3 actions", async ({ page, playwright }, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  const lead = await apiSession(playwright, "dev.lead");
  const { id: tid } = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `QA7 health race ${lang} ${info.repeatEachIndex}`,
    mode: "end_to_end",
  });
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}/health-check`);
  await expect(h1(page)).toHaveText(tr(lang, "launchHealthP5.health.title"), { timeout: 30_000 });
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.health.start"), exact: true }).click();
  await expect(page.locator("[data-assessment-status='draft']")).toBeVisible({ timeout: 30_000 });
  const list = await lead.call<{ items: { id: string }[] }>("GET", `/api/v1/transformations/${tid}/health-checks`);
  const aid = list.items[0]!.id;
  for (let i = 1; i <= 24; i++) {
    const a = await lead.call<{ version: number }>("GET", `/api/v1/transformations/${tid}/health-checks/${aid}`);
    await lead.call("PUT", `/api/v1/transformations/${tid}/health-checks/${aid}/answers/q${String(i).padStart(2, "0")}`, { response: i <= 17 ? "yes" : "no" }, { ifMatch: a.version });
  }
  await page.reload();
  await expect(page.locator("[data-question]")).toHaveCount(25, { timeout: 30_000 });
  const q25 = page.locator("[data-form='answer-q25']");
  await q25.getByLabel(tr(lang, "launchHealthP5.health.response.no"), { exact: true }).check();
  await q25.getByRole("button", { name: tr(lang, "launchHealthP5.health.saveAnswer", { n: 25 }), exact: true }).click();
  await expect(page.locator("[data-field='score'] [data-score='17']")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.health.submit"), exact: true }).click();
  await expect(page.locator("main [role='alert']").first()).toContainText(tr(lang, "problems.health_check__actions_required"), { timeout: 30_000 });
  for (const n of [1, 2, 3]) await page.getByLabel(tr(lang, "launchHealthP5.health.actionText", { n }), { exact: true }).fill(`Synthetic action ${n}`);
  // Count every GET of the assessment after the actions save (the product spec waits for the first one only).
  const gets: { at: number; version: number | null }[] = [];
  const t0 = Date.now();
  page.on("response", async (r) => {
    if (r.request().method() === "GET" && new RegExp(`/health-checks/${aid}$`).test(r.url())) {
      let v: number | null = null;
      try { v = ((await r.json()) as { version: number }).version; } catch { /* ignore */ }
      gets.push({ at: Date.now() - t0, version: v });
    }
  });
  const saved = page.waitForResponse((r) => r.request().method() === "PUT" && /\/actions$/.test(r.url()));
  const reloaded = page.waitForResponse((r) => r.request().method() === "GET" && new RegExp(`/health-checks/${aid}$`).test(r.url()));
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.health.saveActions"), exact: true }).click();
  const savedRes = await saved;
  const savedVersion = ((await savedRes.json()) as { version?: number }).version ?? null;
  await reloaded;
  await expect(page.locator("[data-form='health-actions'] [role='alert']")).toHaveCount(0);
  const submitRes = page.waitForResponse((r) => r.request().method() === "POST" && /\/submit$/.test(r.url()), { timeout: 60_000 });
  const clickAt = Date.now() - t0;
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.health.submit"), exact: true }).click();
  const sr = await submitRes;
  const ifMatch = sr.request().headers()["if-match"] ?? null;
  const submitStatus = sr.status();
  const submitAt = Date.now() - t0;
  let shownAt: number | null = null;
  try {
    await expect(page.locator("[data-assessment-status='submitted']")).toBeVisible({ timeout: 60_000 });
    shownAt = Date.now() - t0;
  } catch { /* recorded below */ }
  const alerts = (await page.locator("main [role='alert']").allInnerTexts()).join(" | ");
  const server = await lead.call<{ version: number; status: string }>("GET", `/api/v1/transformations/${tid}/health-checks/${aid}`);
  const rec = { lang, rate: RATE, rep: info.repeatEachIndex, savedStatus: savedRes.status(), savedVersion, gets, clickAt, ifMatch, submitStatus, submitAt, shownAt, msSubmitToShown: shownAt === null ? null : shownAt - clickAt, alerts, serverStatus: server.status, serverVersion: server.version };
  mkdirSync(EVIDENCE, { recursive: true });
  appendFileSync(path.join(EVIDENCE, "r7-health-race.jsonl"), JSON.stringify(rec) + "\n");
  console.info(`R7-HEALTH-RACE ${JSON.stringify(rec)}`);
  expect(submitStatus, `submit refused: ${alerts}`).toBeLessThan(300);
  expect(shownAt, "submitted status never shown within 60 s").not.toBeNull();
});

// Added by T-DG5-REV-QA-R7C: R7-HEALTH-SLOWGET. Hypothesis for D-182: after the refused first Submit (422), useRunner
// shows the alert BEFORE its refresh (invalidate + refetch of the assessment) completes (automation/ui.tsx: setError,
// then await refresh()). If that refetch is still in flight when the product spec clicks "Save actions", the spec's
// `reloaded` waiter (any GET of the assessment after the click is registered) can resolve with THAT older GET, and the
// spec clicks Submit while the screen still holds the pre-actions version: a stale If-Match. This test replays the
// product spec's ending with ITS OWN waits and ITS 5 s assertion budget, and delays every GET of the assessment by
// QA_SLOW_MS (route fulfilment after a pause = a slow server under load). REPORTED: which GET resolved `reloaded`
// (its version vs the PUT's version), the If-Match sent, the submit status, whether "submitted" was visible within
// 5 s, and the alert. ASSERTED: nothing about the product (the record is the result).
test("R7-HEALTH-SLOWGET: the product spec's waits with a slow assessment GET", async ({ page, playwright }, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  const SLOW = Number(process.env["QA_SLOW_MS"] ?? "1500");
  const lead = await apiSession(playwright, "dev.lead");
  const { id: tid } = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `QA7 health slowget ${lang} ${info.repeatEachIndex}`,
    mode: "end_to_end",
  });
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}/health-check`);
  await expect(h1(page)).toHaveText(tr(lang, "launchHealthP5.health.title"), { timeout: 30_000 });
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.health.start"), exact: true }).click();
  await expect(page.locator("[data-assessment-status='draft']")).toBeVisible({ timeout: 30_000 });
  const list = await lead.call<{ items: { id: string }[] }>("GET", `/api/v1/transformations/${tid}/health-checks`);
  const aid = list.items[0]!.id;
  for (let i = 1; i <= 24; i++) {
    const a = await lead.call<{ version: number }>("GET", `/api/v1/transformations/${tid}/health-checks/${aid}`);
    await lead.call("PUT", `/api/v1/transformations/${tid}/health-checks/${aid}/answers/q${String(i).padStart(2, "0")}`, { response: i <= 17 ? "yes" : "no" }, { ifMatch: a.version });
  }
  await page.reload();
  await expect(page.locator("[data-question]")).toHaveCount(25, { timeout: 30_000 });
  const q25 = page.locator("[data-form='answer-q25']");
  await q25.getByLabel(tr(lang, "launchHealthP5.health.response.no"), { exact: true }).check();
  await q25.getByRole("button", { name: tr(lang, "launchHealthP5.health.saveAnswer", { n: 25 }), exact: true }).click();
  await expect(page.locator("[data-field='score'] [data-score='17']")).toBeVisible({ timeout: 30_000 });
  // From here on, every GET of this assessment is answered after SLOW ms (the request goes to the real API at once).
  const getRe = new RegExp(`/health-checks/${aid}$`);
  let seq = 0;
  const issued: { n: number; at: number }[] = [];
  const t0 = Date.now();
  await page.route((u) => getRe.test(u.pathname), async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const n = ++seq;
    issued.push({ n, at: Date.now() - t0 });
    const res = await route.fetch();
    await new Promise((r) => setTimeout(r, SLOW));
    await route.fulfill({ response: res, headers: { ...res.headers(), "x-qa-seq": String(n) } });
  });
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.health.submit"), exact: true }).click();
  await expect(page.locator("main [role='alert']").first()).toContainText(tr(lang, "problems.health_check__actions_required"), { timeout: 30_000 });
  const alertAt = Date.now() - t0;
  for (const n of [1, 2, 3]) await page.getByLabel(tr(lang, "launchHealthP5.health.actionText", { n }), { exact: true }).fill(`Synthetic action ${n}`);
  // The product spec's waits, verbatim in substance (p5-launch-health-kpi.spec.ts:202-209).
  const saved = page.waitForResponse((r) => r.request().method() === "PUT" && /\/actions$/.test(r.url()));
  const reloaded = page.waitForResponse((r) => r.request().method() === "GET" && getRe.test(new URL(r.url()).pathname));
  const saveClickAt = Date.now() - t0;
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.health.saveActions"), exact: true }).click();
  const savedRes = await saved;
  const savedVersion = ((await savedRes.json()) as { version?: number }).version ?? null;
  const rl = await reloaded;
  const reloadedSeq = Number(rl.headers()["x-qa-seq"] ?? "0");
  const reloadedVersion = ((await rl.json()) as { version?: number }).version ?? null;
  const reloadedIssuedAt = issued.find((x) => x.n === reloadedSeq)?.at ?? null;
  await expect(page.locator("[data-form='health-actions'] [role='alert']")).toHaveCount(0);
  const submitRes = page.waitForResponse((r) => r.request().method() === "POST" && /\/submit$/.test(r.url()), { timeout: 30_000 });
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.health.submit"), exact: true }).click();
  const sr = await submitRes;
  const ifMatch = sr.request().headers()["if-match"] ?? null;
  let within5s = true;
  try { await expect(page.locator("[data-assessment-status='submitted']")).toBeVisible({ timeout: 5_000 }); } catch { within5s = false; }
  const alerts = (await page.locator("main [role='alert']").allInnerTexts()).join(" | ");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const server = await lead.call<{ version: number; status: string }>("GET", `/api/v1/transformations/${tid}/health-checks/${aid}`);
  const rec = { probe: "slowget", lang, slowMs: SLOW, rep: info.repeatEachIndex, alertAt, saveClickAt, issued, savedStatus: savedRes.status(), savedVersion, reloadedSeq, reloadedIssuedAt, reloadedIssuedBeforeSaveClick: reloadedIssuedAt !== null && reloadedIssuedAt < saveClickAt, reloadedVersion, ifMatch, submitStatus: sr.status(), submittedVisibleWithin5s: within5s, alerts: alerts.slice(0, 300), serverStatus: server.status, serverVersion: server.version };
  mkdirSync(EVIDENCE, { recursive: true });
  appendFileSync(path.join(EVIDENCE, "r7-health-slowget.jsonl"), JSON.stringify(rec) + "\n");
  console.info(`R7-HEALTH-SLOWGET ${JSON.stringify(rec)}`);
});
