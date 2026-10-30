// qa-verifier A12 extension to P6 (T-DG6-QA-B; master prompt §20 A12 "Cross-transformation unauthorized reads/writes,
// exports, search results, evidence URLs and AI retrieval are denied"): the USER-VISIBLE paths, in chromium-en and
// chromium-ar, on the real stack (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, migrate, seed-dev, the
// built API serving the built SPA) plus the BUILT production worker (apps/worker/dist/main.js), which builds the search
// index from the audit feed exactly as in operation. The API-level proof of every row is
// tests/qa/integration/a12-p6-scope-isolation.test.ts; this spec checks what a person scoped to transformation X SEES:
//  1. global search: X's record is listed; Y's word gives the empty state and no Y text (REQ-S15-010, REQ-S10-004);
//  2. a forwarded notification deep link to a Y record: the refusal page, no Y title (REQ-S12-024); its recipient
//     (who can read Y) is taken to the record;
//  3. Y's evidence page and Y's evidence download URL show nothing of Y (REQ-S10-004, REQ-S13-013);
//  4. Y's reports page (exports start there) shows nothing of Y (REQ-S10-004);
//  5. the assistant, asked about Y, shows no Y text; asked about X, it cites X (REQ-S17-007);
//  6. a scope revoked AFTER indexing: Y's record found while granted, gone after the revocation, no reindex.
// Each page: html lang/dir of the language, and axe reports 0 serious/critical issues.
// Fixture steps disclosed: (a) the deep-link token of the notification is written with psql as the database owner,
// as the lazy issue of ADR-0051 §3 does when a notification leaves the inbox (no channel adapter runs in this stack);
// (b) the assistant is switched on with the LOCAL test adapter (NODE_ENV=development; no network) and switched off
// again at the end, so later specs (A21) still see the shipped "no AI" configuration.
// Users are the SYNTHETIC seed-dev users; dev.nobody receives a TL assignment on X only. Nothing names DG0-DG7; no
// real business, Finance or IT approval is granted.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  apiSession,
  expectAccessible,
  langOf,
  signIn,
  tr,
  trackRequests,
  SYN_RETAIL,
  type ApiSession,
  type Lang,
} from "../apps/web/e2e/support/ui.ts";
import { poll, psql, startProductionWorker, type ProductionWorker } from "./support/a13-a22-stack.ts";

test.setTimeout(240_000); // the worker's index feed runs once a minute; setup waits for it once per language

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a12-p6");
const NOBODY = "dev.nobody";

interface World {
  lang: Lang;
  xWord: string;
  yWord: string;
  zWord: string;
  X: { id: string; name: string };
  Y: { id: string; name: string };
  Z: { id: string; name: string };
  xRisk: string;
  yRisk: string;
  yAction: string;
  yEvidence: { id: string; title: string };
  token: string;
  zAssignment: { id: string; version: number };
}

let w: World;
let worker: ProductionWorker | undefined;

/** A UUIDv7 (RFC 9562: 48-bit ms time, version 7, variant 10, random rest) for the fixture's audit row. */
function uuidv7(): string {
  const b = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function mkTransformation(office: ApiSession, name: string) {
  return office.call<{ id: string; name: string }>(
    "POST",
    "/api/v1/transformations",
    { businessUnitId: SYN_RETAIL, name, mode: "end_to_end" },
    { expect: 201 },
  );
}

async function risk(session: ApiSession, tId: string, description: string, ownerUserId: string) {
  return session.call<{ id: string }>(
    "POST",
    `/api/v1/transformations/${tId}/raid`,
    { type: "risk", description, impact: "medium", probability: "low", ownerUserId },
    { expect: 201 },
  );
}

async function searchHits(s: ApiSession, q: string): Promise<{ transformationId: string; title: string }[]> {
  const r = await s.req.get(`/api/v1/search?q=${encodeURIComponent(q)}&limit=100`);
  expect(r.status()).toBe(200);
  return ((await r.json()) as { items: { transformationId: string; title: string }[] }).items;
}

async function assistant(admin: ApiSession, on: boolean): Promise<void> {
  const cur = await admin.call<{ enabled: boolean; version: number }>("GET", "/api/v1/admin/assistant");
  if (cur.enabled === on) return;
  if (on) {
    const saved = await admin.call<{ version: number }>(
      "PUT",
      "/api/v1/admin/assistant",
      {
        providerKind: "test_adapter",
        endpointUrl: null,
        apiStyle: null,
        modelName: null,
        credentialRef: null,
        authorizationReference: "IT-APPROVAL-SYNTHETIC-QA-A12",
        requestTimeoutMs: 30000,
        maxOutputTokens: 1024,
        maxContextRecords: 8,
        reason: "Synthetic QA A12: configure the local test adapter",
      },
      { ifMatch: cur.version },
    );
    await admin.call(
      "POST",
      "/api/v1/admin/assistant/enable",
      { reason: "Synthetic QA A12: on" },
      { ifMatch: saved.version },
    );
  } else {
    await admin.call(
      "POST",
      "/api/v1/admin/assistant/disable",
      { reason: "Synthetic QA A12: off again" },
      { ifMatch: cur.version },
    );
  }
}

test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(240_000); // hooks have their own timeout: the setup waits for the worker's index feed
  const lang = langOf(info);
  const tag = lang.toUpperCase();
  const office = await apiSession(playwright, "dev.office");
  const admin = await apiSession(playwright, "dev.admin");
  const nobody = await apiSession(playwright, NOBODY);
  // Words unique to THIS setup (Playwright re-runs beforeAll after a failed test restarts the worker): the number of
  // earlier setups in this stack, as letters, so a later setup never finds an earlier setup's records by its word.
  const earlier = Number(psql(`SELECT count(*) FROM transformation WHERE name LIKE 'Synthetic QA A12 %'`)[0]) / 3;
  const run = String.fromCharCode(97 + (earlier % 26)) + String.fromCharCode(97 + Math.floor(earlier / 26));
  const xWord = `Qaxanthe${lang}${run}`;
  const yWord = `Qayorvik${lang}${run}`;
  const zWord = `Qazembla${lang}${run}`;
  const X = await mkTransformation(office, `Synthetic QA A12 ${tag} ${xWord} transformation`);
  const Y = await mkTransformation(office, `Synthetic QA A12 ${tag} ${yWord} transformation`);
  const Z = await mkTransformation(office, `Synthetic QA A12 ${tag} ${zWord} transformation`);
  // dev.nobody: TL on X (kept) and TL on Z (revoked in test 6). Never on Y.
  await admin.call(
    "POST",
    "/api/v1/role-assignments",
    {
      userId: nobody.userId,
      roleCode: "TL",
      scope: { type: "transformation", id: X.id },
      reason: "Synthetic QA A12 scope X",
    },
    { expect: 201 },
  );
  const zA = await admin.call<{ id: string; version: number }>(
    "POST",
    "/api/v1/role-assignments",
    {
      userId: nobody.userId,
      roleCode: "TL",
      scope: { type: "transformation", id: Z.id },
      reason: "Synthetic QA A12 scope Z",
    },
    { expect: 201 },
  );
  const xRisk = `Synthetic ${xWord} supplier risk`;
  const yRisk = `Synthetic ${yWord} confidential tariff risk`;
  await risk(office, X.id, xRisk, office.userId);
  const yr = await risk(office, Y.id, yRisk, office.userId);
  await risk(office, Z.id, `Synthetic ${zWord} migration risk`, office.userId);
  const yAction = `Synthetic ${yWord} renegotiation action`;
  const act = await office.call<{ id: string }>(
    "POST",
    `/api/v1/transformations/${Y.id}/raid/${yr.id}/actions`,
    { title: yAction, ownerUserId: office.userId },
    { expect: 201 },
  );
  const ev = await office.call<{ id: string; title: string }>(
    "POST",
    `/api/v1/transformations/${Y.id}/evidence`,
    { kind: "note", title: `Synthetic ${yWord} board memo`, noteBody: "Synthetic note", ownerUserId: office.userId },
    { expect: 201 },
  );
  // (a) the notification the action sent to its owner dev.office; its deep-link token, as the lazy issue writes it.
  const ids = psql(
    `SELECT id FROM inbox_notification WHERE link_path LIKE '%/${act.id}%' AND recipient_user_id = '${office.userId}'`,
  );
  expect(ids.length, "the RAID action did not notify its owner").toBe(1);
  const token = randomBytes(32).toString("base64url");
  // One transaction, as issueDeepLink does it: the token, the version step and the audit event
  // inbox_notification.link_issued with prior and new version (the database refuses the update without it).
  psql(
    `WITH n AS (UPDATE inbox_notification SET link_token = '${token}', version = version + 1 WHERE id = '${ids[0]}' ` +
      `RETURNING id, organization_id, transformation_id, version) ` +
      `INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, actor_user_id, action, record_type, ` +
      `record_id, prior_version, new_version, request_id, source) ` +
      `SELECT '${uuidv7()}', organization_id, transformation_id, 'service', NULL, 'inbox_notification.link_issued', ` +
      `'inbox_notification', id, version - 1, version, 'job:qa-a12-p6-e2e', 'worker' FROM n`,
  );

  // The production worker builds the index from the audit feed; run the feed now and wait until X, Y and Z are found.
  worker ??= await startProductionWorker();
  // Run the feed now (202); the once-a-minute schedule would also pick the records up.
  await admin.call("POST", "/api/v1/admin/jobs/search.index_feed/run", undefined, { expect: 202 });
  // Wait on the index itself (owner psql: a read of the fixture state, not subject to the search rate limit): a RAID
  // document for each of X, Y and Z. The UI checks below then go through the real search route.
  await poll(
    async () =>
      Number(
        psql(
          `SELECT count(DISTINCT transformation_id) FROM search_document WHERE record_type = 'raid_entry' ` +
            `AND transformation_id IN ('${X.id}', '${Y.id}', '${Z.id}')`,
        )[0],
      ) === 3,
    "the search index to contain X, Y and Z",
    150_000,
  );
  // Positive control through the API: dev.office (TO on the organization) finds Y, so Y's absence for dev.nobody is
  // authorization, not an empty index.
  expect((await searchHits(office, yWord)).length).toBeGreaterThan(0);
  await assistant(admin, true);
  w = { lang, xWord, yWord, zWord, X, Y, Z, xRisk, yRisk, yAction, yEvidence: ev, token, zAssignment: zA };
  for (const s of [office, admin, nobody]) await s.req.dispose();
});

test.afterAll(async ({ playwright }) => {
  test.setTimeout(60_000); // stops the worker (SIGTERM, up to 25 s)
  const admin = await apiSession(playwright, "dev.admin");
  await assistant(admin, false);
  await admin.req.dispose();
  await worker?.stop();
  worker = undefined;
});

/** No Y record text on the page. `typed`: the page echoes the user's own query (search box, empty state), so the bare
 * word is not checked there; every Y record's own text still is. */
async function expectNoY(page: Page, typed = false) {
  const text = await page.locator("body").innerText();
  const needles = [w.Y.name, w.yRisk, w.yAction, w.yEvidence.title, w.Y.id, ...(typed ? [] : [w.yWord])];
  for (const s of needles) expect(text, `page shows "${s}"`).not.toContain(s);
}

async function expectLangDir(page: Page, lang: Lang) {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

async function screenshot(page: Page, name: string) {
  const dir = path.join(EVIDENCE, w.lang);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test("A12-1 search: the X-scoped user sees X's record and gets the empty state for Y's word", async ({ page }) => {
  const lang = w.lang;
  const foreign = trackRequests(page);
  await signIn(page, lang, NOBODY);
  await page.goto(`/search?q=${encodeURIComponent(w.xWord)}`);
  await expectLangDir(page, lang);
  await expect(page.getByRole("main")).toContainText(w.xRisk);
  await page.goto(`/search?q=${encodeURIComponent(w.yWord)}`);
  await expect(page.getByText(tr(lang, "productivity.search.empty", { q: w.yWord }), { exact: true })).toBeVisible();
  await expectNoY(page, true);
  await expectLangDir(page, lang);
  await screenshot(page, "a12-search-y-empty");
  await expectAccessible(page, lang, "a12-search-y-empty");
  expect(foreign).toEqual([]);
});

test("A12-2 deep link: a forwarded link to a Y record shows the refusal and no title; its recipient opens it", async ({
  page,
  browser,
}) => {
  const lang = w.lang;
  await signIn(page, lang, NOBODY);
  await page.goto(`/l/${w.token}`);
  await expect(page.getByText(tr(lang, "adminP6.deepLink.forbiddenTitle"), { exact: true })).toBeVisible();
  await expectNoY(page);
  await expectLangDir(page, lang);
  await screenshot(page, "a12-deep-link-forbidden");
  await expectAccessible(page, lang, "a12-deep-link-forbidden");
  // The recipient (dev.office reads Y) is taken to the action register entry in Y.
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const recipientPage = await ctx.newPage();
  await signIn(recipientPage, lang, "dev.office");
  await recipientPage.goto(`/l/${w.token}`);
  await recipientPage.waitForURL(new RegExp(`/transformations/${w.Y.id}/action-register/`));
  await ctx.close();
});

test("A12-3 evidence: Y's evidence page and download URL show nothing of Y to the X-scoped user", async ({ page }) => {
  const lang = w.lang;
  await signIn(page, lang, NOBODY);
  await page.goto(`/transformations/${w.Y.id}/evidence`);
  await expect(page.getByText(tr(lang, "common.state.notFoundBody"), { exact: true })).toBeVisible();
  await expectNoY(page);
  await expectLangDir(page, lang);
  await screenshot(page, "a12-evidence-y");
  await expectAccessible(page, lang, "a12-evidence-y");
  for (const suffix of ["", "/content"]) {
    const res = await page.request.get(`/api/v1/transformations/${w.Y.id}/evidence/${w.yEvidence.id}${suffix}`);
    expect([403, 404]).toContain(res.status());
    const body = await res.text();
    expect(body).not.toContain(w.yEvidence.title);
    expect(body).not.toContain(w.yWord);
  }
});

test("A12-4 exports: Y's reports page shows nothing of Y and an export of Y is refused", async ({ page }) => {
  const lang = w.lang;
  await signIn(page, lang, NOBODY);
  await page.goto(`/transformations/${w.Y.id}/reports`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await expectNoY(page);
  await expectLangDir(page, lang);
  await screenshot(page, "a12-reports-y");
  await expectAccessible(page, lang, "a12-reports-y");
  const csrf = ((await (await page.request.get("/api/v1/me")).json()) as { csrfToken: string }).csrfToken;
  const res = await page.request.post("/api/v1/exports", {
    headers: { "x-csrf-token": csrf, origin: new URL(page.url()).origin },
    data: {
      report: { definitionCode: "registers", subjectId: w.Y.id, parameters: { register: "raid" } },
      format: "csv",
      language: lang,
    },
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
  expect(await res.text()).not.toContain(w.yWord);
});

async function askAssistant(page: Page, lang: Lang, title: string, question: string) {
  const launcher = page.getByRole("button", { name: tr(lang, "assistant.panel.open") }).first();
  await expect(launcher, "the assistant launcher is not shown to a signed-in TL while the assistant is on").toBeVisible(
    {
      timeout: 15_000,
    },
  );
  await launcher.click();
  const panel = page
    .getByRole("dialog")
    .or(page.locator("[aria-labelledby]").filter({ hasText: tr(lang, "assistant.panel.intro") }))
    .first();
  await panel
    .getByLabel(new RegExp(`^${tr(lang, "assistant.panel.titleField").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
    .fill(title);
  await panel.getByRole("button", { name: tr(lang, "assistant.panel.start"), exact: true }).click();
  await panel
    .getByLabel(new RegExp(`^${tr(lang, "assistant.panel.messageField").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
    .fill(question);
  await panel.getByRole("button", { name: tr(lang, "assistant.panel.send"), exact: true }).click();
  const reply = panel.locator("[data-assistant-output]").last();
  await expect(reply).toBeVisible();
  return { panel, reply };
}

test("A12-5 assistant: asked about Y it shows no Y text; asked about X it cites X", async ({ page }) => {
  const lang = w.lang;
  await signIn(page, lang, NOBODY);
  await page.goto("/my-work");
  // Diagnostic record (handback): what the shell's availability read answers this user, and whether the assistant is
  // usable through its own API (conversations are "assistant.use").
  const setting = await page.request.get("/api/v1/admin/assistant");
  const conversations = await page.request.get("/api/v1/assistant/conversations?limit=1");
  console.info(
    `A12-5 ${lang}: GET /api/v1/admin/assistant as ${NOBODY} -> ${setting.status()} ${(await setting.text()).slice(0, 300)}; ` +
      `GET /api/v1/assistant/conversations -> ${conversations.status()}`,
  );
  const { panel, reply } = await askAssistant(page, lang, "Synthetic QA Y probe", `Summarize the ${w.yWord} risks`);
  await expect(reply).toContainText(tr(lang, "assistant.label"));
  // The panel shows the user's own question (it contains Y's word); the assistant's output must not carry Y.
  const out = await panel.locator("[data-assistant-output]").allInnerTexts();
  for (const t of out)
    for (const s of [w.yWord, w.Y.name, w.yRisk, w.yAction, w.yEvidence.title]) expect(t).not.toContain(s);
  await expectLangDir(page, lang);
  await screenshot(page, "a12-assistant-y");
  await expectAccessible(page, lang, "a12-assistant-y");

  await page.goto("/my-work");
  const x = await askAssistant(page, lang, "Synthetic QA X probe", `Summarize the ${w.xWord} risks`);
  await expect(x.reply).toContainText(w.xRisk);
});

test("A12-6 revoked after indexing: Z's record is found while granted and gone after the revocation (no reindex)", async ({
  page,
  playwright,
}) => {
  const lang = w.lang;
  await signIn(page, lang, NOBODY);
  await page.goto(`/search?q=${encodeURIComponent(w.zWord)}`);
  await expect(page.getByRole("main")).toContainText(w.zWord);
  const admin = await apiSession(playwright, "dev.admin");
  await admin.call(
    "POST",
    `/api/v1/role-assignments/${w.zAssignment.id}/revoke`,
    { reason: "Synthetic QA A12 revoke Z" },
    { ifMatch: w.zAssignment.version },
  );
  await admin.req.dispose();
  // API-level probes with the browser's existing session and with a fresh session, recorded for the handback.
  const before = await page.request.get(`/api/v1/search?q=${encodeURIComponent(w.zWord)}&limit=100`);
  console.info(
    `A12-6 ${lang}: existing session after revoke: search -> ${before.status()} ${(await before.text()).slice(0, 400)}`,
  );
  const fresh = await apiSession(playwright, NOBODY);
  const freshSearch = await fresh.req.get(`/api/v1/search?q=${encodeURIComponent(w.zWord)}&limit=100`);
  const freshText = await freshSearch.text();
  const freshZ = await fresh.req.get(`/api/v1/transformations/${w.Z.id}`);
  console.info(
    `A12-6 ${lang}: fresh session after revoke: search -> ${freshSearch.status()} ${freshText.slice(0, 600)}; ` +
      `GET /transformations/Z -> ${freshZ.status()}`,
  );
  await fresh.req.dispose();
  expect(freshZ.status(), "Z is still readable after the revocation").toBe(404);
  expect(freshText, "the API search still returns Z after the revocation").not.toContain(w.zWord);
  // The revocation may end the session (the API suite records that it does); sign in again either way.
  await signIn(page, lang, NOBODY);
  await page.goto(`/search?q=${encodeURIComponent(w.zWord)}`);
  await expect(page.getByText(tr(lang, "productivity.search.empty", { q: w.zWord }), { exact: true })).toBeVisible();
  await expectLangDir(page, lang);
  await screenshot(page, "a12-search-z-revoked");
  await expectAccessible(page, lang, "a12-search-z-revoked");
});
