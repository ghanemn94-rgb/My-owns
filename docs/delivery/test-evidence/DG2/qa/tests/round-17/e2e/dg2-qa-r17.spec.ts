// qa-verifier DG2 round 17 — independent negative/regression probes for the D-077 repair on candidate ddaab3cc
// (T-DG2-REV-QA-R17): FE15 (ac81298) binds every effect of a user action to the session generation it began under
// (auth/sessionBound.ts) and confirms GET /me on every in-app navigation (and before a page GET when the last /me is
// older than 2 s). Authored by qa-verifier, NOT by an implementer. Runs in chromium-en and chromium-ar against the REAL
// built API + PostgreSQL (e2e/support/qa-stack.sh). In-flight writes are REAL (route.fetch with the browser's own
// cookie; the server commits them); only the delivery of the answer to the page is held. Nothing is mocked.
//
// "A" is the person who acts in tab 1; "B" signs in in a second tab of the same browser (A signed out there first).
// Two orders are probed for every write:
//   LEARN-FIRST : tab 1 learns of B through an IN-APP NAVIGATION (no refocus) while A's answer is held; then deliver.
//   DELIVER-FIRST: A's answer is delivered while tab 1 still believes it is A (no refocus, no navigation); tab 1 then
//                  learns of B through the handler's own follow-up requests or the next in-app navigation.
// In both, B must never see A's record (name, code) under B's header, and B must never be navigated to it.
//
// R17-01 transformation CREATE, learn-first via an in-app navigation (the R16-06 class through another discovery path).
// R17-02 transformation EDIT, deliver-first.        R17-03 transformation ARCHIVE, deliver-first.
// R17-04 organisation CREATE (dev.admin), (a) learn-first and (b) deliver-first; (c) characterises D-077's declared 2 s
//        residual (switch and answer within 2 s of tab 1's last /me): what must hold there is asserted, the path recorded.
// Deliver-first probes wait 2.5 s after the form is ready (a person filling it in), i.e. outside that residual.
// R17-05 user SAVE (dev.admin edits a synthetic user's display name), (a) learn-first and (b) deliver-first.
// R17-06 header/data agreement after an in-app navigation, (a) at once (no wait) and (b) 5 s later; GET /me goes first.
// R17-07 an in-app session END lands ONCE on sign-in with the message, bounded /me, no stale shell.
// R17-08 a 403 is never a session end: (a) no-permission read; (b) 403 csrf after the same person's new session,
//        then the same person's next save updates and navigates.
// R17-09 same-identity admin flows still navigate/update: organisation create -> its page; user save -> "Saved.".
// All data is SYNTHETIC. No business approval is implied (product G1–G6 never imply DG0–DG7).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  SHOTS,
  apiSession,
  axeSummary,
  ensureLanguage,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  tr,
  type Lang,
} from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });

const SYN_FIN = "01920000-0000-7000-9000-000000000103"; // Synthetic Finance: dev.office (org-wide) reads it, dev.lead not
const ORG = "01920000-0000-7000-9000-000000000001";
const OFFICE_NAME = "Synthetic Transformation Office";
const LEAD_NAME = "Synthetic Transformation Lead";
const ADMIN_NAME = "Synthetic Dev Admin";
const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  mkdirSync(join(SHOTS, lang), { recursive: true });
  writeFileSync(join(SHOTS, lang, "axe-summary-qa-r17.json"), `${JSON.stringify(axeSummary, null, 2)}\n`);
});

/** An annotation that is also printed to the run's log (list reporter), so the evidence carries the measured values. */
function note(info: TestInfo, a: { type: string; description: string }) {
  info.annotations.push(a);
  console.log(`[${info.project.name}] ${a.type}: ${a.description}`);
}

/** GET /me count, 429s, page errors, and the ordered API request/finish log (for "/me goes first"). */
function watch(page: Page) {
  const st = { me: 0, tooMany: [] as string[], pageErrors: [] as string[], log: [] as string[], timed: [] as string[] };
  const t0 = Date.now();
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (!p.startsWith("/api/")) return;
    if (r.method() === "GET" && p === "/api/v1/me") st.me++;
    st.log.push(`send ${r.method()} ${p}`);
    st.timed.push(`+${Date.now() - t0} send ${r.method()} ${p}`);
  });
  page.on("requestfinished", (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith("/api/")) {
      st.log.push(`done ${r.method()} ${p}`);
      st.timed.push(`+${Date.now() - t0} done ${r.method()} ${p}`);
    }
  });
  page.on("response", (r) => {
    if (r.status() === 429) st.tooMany.push(`${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  page.on("pageerror", (e) => st.pageErrors.push(e.message));
  return st;
}

const anyDevField = (page: Page) =>
  page.getByLabel(
    new RegExp(`^(?:${tr("ar", "auth.dev.username")}|${tr("en", "auth.dev.username")})(?:\\s*\\(.*\\))?$`),
  );
const anySignOut = (page: Page) =>
  page.getByRole("button", { name: new RegExp(`^(?:${tr("ar", "auth.signOut")}|${tr("en", "auth.signOut")})$`) });
const navLink = (page: Page, lang: Lang, area: string) =>
  page
    .getByRole("navigation", { name: tr(lang, "nav.primary") })
    .getByRole("link", { name: tr(lang, `nav.areas.${area}.label`), exact: true });
const header = (page: Page) => page.locator(".user-box__name");

async function signInUi(page: Page, lang: Lang, username: string) {
  await page.goto("/login");
  await anyDevField(page).fill(username);
  await anyDevField(page).press("Enter");
  await page.waitForURL("**/my-work");
  await ensureLanguage(page, lang);
}

/**
 * Records every DOM moment where all `markers` are in the document as TEXT (a typed value is never a text node) and,
 * if `name` is given, the header's signed-in name is exactly `name` at that moment.
 */
async function installLeakObserver(page: Page, markers: string[], name: string | null = null) {
  await page.evaluate(
    ([ms, h]) => {
      const w = window as unknown as { __qaLeak: string[] };
      w.__qaLeak = [];
      const check = () => {
        const text = document.body.textContent ?? "";
        const n = document.querySelector(".user-box__name")?.textContent?.trim() ?? null;
        if (ms.every((m) => text.includes(m)) && (h === null || n === h)) {
          const phase = (window as unknown as { __qaPhase?: string }).__qaPhase ?? "before-switch";
          const st = [...document.querySelectorAll("[data-state]")].map((e) => e.getAttribute("data-state")).join(",");
          w.__qaLeak.push(`${phase} | header=${n} | ${location.pathname} | states=${st}`);
        }
      };
      check();
      new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
    },
    [markers, name] as const,
  );
}
const leaks = (page: Page) => page.evaluate(() => (window as unknown as { __qaLeak: string[] }).__qaLeak);

/** Records every change of (path, header name, `marker` shown as text, data-states) with a time, sampled every 20 ms. */
async function installTimeline(page: Page, marker: string) {
  await page.evaluate((m) => {
    const w = window as unknown as { __qaTl: string[]; __qaTlLast: string };
    w.__qaTl = [];
    w.__qaTlLast = "";
    const t0 = performance.now();
    const sample = () => {
      const n = document.querySelector(".user-box__name")?.textContent?.trim() ?? "-";
      const st = [...document.querySelectorAll("[data-state]")].map((e) => e.getAttribute("data-state")).join(",");
      const s = `${location.pathname} | header=${n} | marker=${(document.body.textContent ?? "").includes(m)} | states=${st}`;
      if (s !== w.__qaTlLast) {
        w.__qaTlLast = s;
        w.__qaTl.push(`+${Math.round(performance.now() - t0)} ${s}`);
      }
    };
    sample();
    new MutationObserver(sample).observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(sample, 20);
  }, marker);
}
const timeline = (page: Page) => page.evaluate(() => (window as unknown as { __qaTl: string[] }).__qaTl);
const phase = (page: Page, p: string) =>
  page.evaluate((x) => ((window as unknown as { __qaPhase?: string }).__qaPhase = x), p);
/** Hits that are not A's own screen (A's header). Raw hits are kept as an annotation. */
async function leaksNotA(page: Page, info: TestInfo, aName: string) {
  const all = await leaks(page);
  note(info, { type: "observer-hits", description: all.length ? all.join(" ;; ") : "none" });
  return all.filter((e) => !e.includes(`| header=${aName} |`));
}
const docId = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __qaDoc?: number };
    w.__qaDoc = w.__qaDoc ?? Math.random();
    return w.__qaDoc;
  });

/** Sends the matching request to the REAL API at once (the server commits it); holds only its delivery to the page. */
async function holdAnswer(page: Page, method: string, path: (p: string) => boolean) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const st = { sent: false, status: 0, body: "", delivered: false, release };
  await page.route(
    (u) => path(u.pathname),
    async (route) => {
      if (route.request().method() !== method) return route.fallback();
      const response = await route.fetch();
      st.status = response.status();
      st.body = await response.text();
      st.sent = true;
      await gate;
      await route.fulfill({ response, body: st.body });
      st.delivered = true;
    },
  );
  return st;
}

/** In a REAL second tab of the same browser: sign out, then (optionally) sign `to` in. UI only. */
async function otherTab(page: Page, to: string | null, toName?: string) {
  const tab2 = await page.context().newPage();
  await tab2.goto("/about");
  await anySignOut(tab2).click();
  await tab2.waitForURL("**/login**");
  if (to) {
    await anyDevField(tab2).fill(to);
    await anyDevField(tab2).press("Enter");
    await expect(tab2.getByText(toName!).first()).toBeVisible();
  }
  return tab2;
}

async function inAppGo(page: Page, path: string) {
  await page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  }, path);
}

/** Logs every router history write (pushState/replaceState) of the document, from its first script. */
async function logHistory(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __qaNav: string[] };
    w.__qaNav = [];
    for (const m of ["pushState", "replaceState"] as const) {
      const orig = history[m].bind(history);
      history[m] = (s: unknown, t: string, u?: string | URL | null) => {
        w.__qaNav.push(`${m} ${u === undefined || u === null ? "" : new URL(String(u), location.href).pathname}`);
        return orig(s, t, u);
      };
    }
  });
}
const navLog = (page: Page) => page.evaluate(() => (window as unknown as { __qaNav: string[] }).__qaNav);

async function officeRecord(playwright: Parameters<typeof apiSession>[0], lang: Lang, tag: string) {
  const marker = `Synthetic QA ${tag} ${lang.toUpperCase()} ${stamp()}`;
  const office = await apiSession(playwright, "dev.office");
  const rec = await office.call<{ id: string; code: string; version: number }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_FIN,
    name: marker,
    mode: "end_to_end",
  });
  const lead = await apiSession(playwright, "dev.lead");
  await lead.call("GET", `/api/v1/transformations/${rec.id}`, undefined, { expect: 404 });
  return { marker, office, lead, ...rec };
}

/** After B is in place in tab 1: B's header, then this project's language (a real preference save for B). */
async function bInPlace(page: Page, lang: Lang, bName: string) {
  await expect(header(page)).toHaveText(bName, { timeout: 10_000 });
  await ensureLanguage(page, lang);
}

// ------------------------------------------------------------------------------------------------------------------
test("R17-01 CREATE held; tab 1 learns of B by an in-app navigation; then A's 201 arrives: B never sees it", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const w = watch(page);
  const marker = `Synthetic QA R17-01 by A ${lang.toUpperCase()} ${stamp()}`;
  await signInUi(page, lang, "dev.office");
  await page.goto("/transformations/new");
  await expect(header(page)).toHaveText(OFFICE_NAME);
  const doc = await docId(page);
  await page.getByLabel(fieldLabel(lang, "transformations.field.businessUnit")).selectOption(SYN_FIN);
  await page.getByLabel(fieldLabel(lang, "transformations.field.name")).fill(marker);
  await installLeakObserver(page, [marker]);
  const held = await holdAnswer(page, "POST", (p) => p === "/api/v1/transformations");
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  await expect.poll(() => held.sent, { message: "the write reached the server" }).toBe(true);
  const tab2 = await otherTab(page, "dev.lead", LEAD_NAME);
  await page.bringToFront();
  await phase(page, "B signed in elsewhere; in-app navigation");
  await navLink(page, lang, "myWork").click(); // no refocus event: an in-app navigation only
  await expect(header(page)).toHaveText(LEAD_NAME, { timeout: 10_000 });
  await phase(page, "B shown; answer delivered");
  held.release();
  await expect.poll(() => held.delivered).toBe(true);
  await page.waitForTimeout(3_000);
  expect(held.status).toBe(201);
  const created = JSON.parse(held.body) as { id: string; code: string; name: string };
  expect(created.name).toBe(marker);
  const path = new URL(page.url()).pathname;
  const body = (await page.locator("body").textContent()) ?? "";
  note(info, { type: "r17-01", description: `path ${path}; A's code ${created.code} shown ${body.includes(created.code)}` });
  await bInPlace(page, lang, LEAD_NAME);
  await shot(page, lang, "qa-r17-01-b-after-delivery");
  await expectAccessible(page, lang, "qa-r17-01-b-after-delivery");
  expect(path, "B is not navigated to A's new record").not.toBe(`/transformations/${created.id}`);
  expect(body.includes(created.code), `A's code ${created.code} shown to B`).toBe(false);
  expect(await leaksNotA(page, info, OFFICE_NAME), "A's record shown under B").toEqual([]);
  expect(await docId(page)).toBe(doc);
  await tab2.close();
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
test("R17-02 EDIT answered while tab 1 still believes it is A: B never sees A's new name under B's header", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const w = watch(page);
  const a = await officeRecord(playwright, lang, "R17-02 A-only");
  const newName = `${a.marker} edited by A`;
  await signInUi(page, lang, "dev.office");
  await page.goto(`/transformations/${a.id}/edit`);
  const name = page.getByLabel(fieldLabel(lang, "transformations.field.name"));
  await expect(name).toHaveValue(a.marker);
  const doc = await docId(page);
  await name.fill(newName);
  await installLeakObserver(page, [a.marker]); // the new name contains the old marker: any A text is caught
  await installTimeline(page, a.marker);
  await page.waitForTimeout(2_500); // outside D-077's 2 s residual window (see R17-04c)
  const mark = w.timed.length;
  const held = await holdAnswer(page, "PATCH", (p) => p === `/api/v1/transformations/${a.id}`);
  await page.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  await expect.poll(() => held.sent).toBe(true);
  const tab2 = await otherTab(page, "dev.lead", LEAD_NAME);
  await page.bringToFront();
  await phase(page, "B signed in elsewhere; answer delivered (tab 1 unaware)");
  held.release();
  await expect.poll(() => held.delivered).toBe(true);
  await page.waitForTimeout(3_000);
  expect(held.status).toBe(200);
  const after = { path: new URL(page.url()).pathname, header: (await header(page).textContent())?.trim() };
  note(info, { type: "r17-02-timeline", description: JSON.stringify(await timeline(page)) });
  note(info, { type: "r17-02-api", description: JSON.stringify(w.timed.slice(mark)) });
  // If the handler's own follow-ups did not reveal B yet, the next in-app navigation must.
  await phase(page, "in-app navigation");
  await inAppGo(page, `/transformations/${a.id}`);
  await page.waitForTimeout(2_000);
  await bInPlace(page, lang, LEAD_NAME);
  note(info, { type: "r17-02", description: `after delivery: ${JSON.stringify(after)}` });
  await expect(page.locator("[data-state='not-found'], [data-state='no-permission']").first()).toBeVisible();
  await expect(page.getByText(a.marker)).toHaveCount(0);
  await shot(page, lang, "qa-r17-02-b-on-a-record");
  await expectAccessible(page, lang, "qa-r17-02-b-on-a-record");
  expect(await leaksNotA(page, info, OFFICE_NAME), "A's record under B's header").toEqual([]);
  expect(await docId(page)).toBe(doc);
  await tab2.close();
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
test("R17-03 ARCHIVE answered while tab 1 still believes it is A: B never sees A's record or reason", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const w = watch(page);
  const a = await officeRecord(playwright, lang, "R17-03 A-only");
  const reason = `Synthetic QA R17-03 reason ${stamp()}`;
  await signInUi(page, lang, "dev.office");
  await page.goto(`/transformations/${a.id}`);
  await expect(page.getByText(a.marker).first()).toBeVisible();
  const doc = await docId(page);
  await page.getByRole("button", { name: tr(lang, "transformations.archive.action"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "common.form.reason")).fill(reason);
  await installLeakObserver(page, [a.marker]);
  await installTimeline(page, a.marker);
  await page.waitForTimeout(2_500); // outside D-077's 2 s residual window (see R17-04c)
  const mark = w.timed.length;
  const held = await holdAnswer(page, "POST", (p) => p === `/api/v1/transformations/${a.id}/archive`);
  await dialog.getByRole("button", { name: tr(lang, "transformations.archive.confirm"), exact: true }).click();
  await expect.poll(() => held.sent).toBe(true);
  const tab2 = await otherTab(page, "dev.lead", LEAD_NAME);
  await page.bringToFront();
  await phase(page, "B signed in elsewhere; answer delivered (tab 1 unaware)");
  held.release();
  await expect.poll(() => held.delivered).toBe(true);
  await page.waitForTimeout(3_000);
  expect(held.status).toBe(200);
  const after = { path: new URL(page.url()).pathname, header: (await header(page).textContent())?.trim() };
  note(info, { type: "r17-03-timeline", description: JSON.stringify(await timeline(page)) });
  note(info, { type: "r17-03-api", description: JSON.stringify(w.timed.slice(mark)) });
  await phase(page, "in-app navigation");
  await inAppGo(page, "/transformations");
  await page.waitForTimeout(2_000);
  await bInPlace(page, lang, LEAD_NAME);
  note(info, { type: "r17-03", description: `after delivery: ${JSON.stringify(after)}` });
  await expect(page.getByText(a.marker)).toHaveCount(0);
  await expect(page.getByText(reason)).toHaveCount(0);
  await shot(page, lang, "qa-r17-03-b-list");
  expect(await leaksNotA(page, info, OFFICE_NAME), "A's record under B's header").toEqual([]);
  expect(await docId(page)).toBe(doc);
  await tab2.close();
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
// R17-04c characterises D-077's declared 2 s residual (4): the switch and the answer both come within 2 s of tab 1's last
// GET /me (dev run 2: the post-create list refetch is then sent without a recheck, under B's cookie, and the handler
// navigates the tab, still showing A, to A's new organisation; that navigation's /me then shows B "no permission").
// Inside the window it asserts only what must hold even there: A's organisation's name never shows under B's header,
// and B ends on a no-permission page. The path is recorded, not asserted.
for (const order of ["learn-first", "deliver-first", "inside-2s-window"] as const) {
  const letter = { "learn-first": "a", "deliver-first": "b", "inside-2s-window": "c" }[order];
  test(`R17-04${letter} ORGANISATION create across an identity change (${order}): B never sees or opens it`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const lang = langOf(info);
    const w = watch(page);
    const s = stamp().toUpperCase();
    const code = `QA17${s}`.slice(0, 20);
    const nameEn = `Synthetic QA R17-04 org ${lang.toUpperCase()} ${s}`;
    await signInUi(page, lang, "dev.admin");
    await page.goto("/admin/organizations");
    await expect(header(page)).toHaveText(ADMIN_NAME);
    const doc = await docId(page);
    await page.getByRole("button", { name: tr(lang, "admin.organizations.new") }).click();
    await page.getByLabel(fieldLabel(lang, "common.field.code")).fill(code);
    await page.getByLabel(fieldLabel(lang, "common.field.nameEn")).fill(nameEn);
    await page.getByLabel(fieldLabel(lang, "common.field.nameAr")).fill(`منظمة اصطناعية ${s}`);
    // The stamp is in the code and in both names (EN shows nameEn, AR shows nameAr; dev run 4): any of them as text.
    await installLeakObserver(page, [s]);
    await installTimeline(page, s);
    const held = await holdAnswer(page, "POST", (p) => p === "/api/v1/organizations");
    // A real person takes longer than 2 s to fill the form (and another tab to sign out and in): outside the residual.
    if (order !== "inside-2s-window") await page.waitForTimeout(2_500);
    const mark = w.timed.length;
    await page.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
    await expect.poll(() => held.sent).toBe(true);
    const tab2 = await otherTab(page, "dev.lead", LEAD_NAME);
    await page.bringToFront();
    if (order === "learn-first") {
      await phase(page, "in-app navigation, answer held");
      await inAppGo(page, "/about");
      await expect(header(page)).toHaveText(LEAD_NAME, { timeout: 10_000 });
    }
    await phase(page, "answer delivered");
    held.release();
    await expect.poll(() => held.delivered).toBe(true);
    await page.waitForTimeout(3_000);
    expect(held.status, held.body).toBe(201);
    const org = JSON.parse(held.body) as { id: string };
    const orgPath = `/admin/organizations/${org.id}`;
    const after = { path: new URL(page.url()).pathname, header: (await header(page).textContent())?.trim() };
    note(info, { type: "r17-04", description: `${order} after delivery: ${JSON.stringify(after)}; A's org id ${org.id}` });
    note(info, { type: "r17-04-timeline", description: JSON.stringify(await timeline(page)) });
    note(info, { type: "r17-04-api", description: JSON.stringify(w.timed.slice(mark)) });
    if (order === "inside-2s-window" && after.path === orgPath) {
      await expect(page.locator("[data-state='no-permission'], [data-state='not-found']").first()).toBeVisible();
      await expect(header(page)).toHaveText(LEAD_NAME);
    }
    if (order !== "learn-first") {
      await phase(page, "in-app navigation");
      await inAppGo(page, "/about");
    }
    await bInPlace(page, lang, LEAD_NAME);
    await shot(page, lang, `qa-r17-04-${order}-b`);
    const hits = await leaksNotA(page, info, ADMIN_NAME);
    note(info, { type: "r17-04-observer", description: JSON.stringify(info.annotations.find((x) => x.type === "observer-hits")?.description) });
    if (order !== "inside-2s-window") expect(after.path, "B is not navigated to A's new organisation").not.toBe(orgPath);
    expect((await page.locator("body").textContent())?.includes(s), "A's organisation (code or either name) shown to B").toBe(false);
    expect(hits, "A's organisation under B's header").toEqual([]);
    expect(await docId(page)).toBe(doc);
    await tab2.close();
    expect(w.tooMany).toEqual([]);
    expect(w.pageErrors).toEqual([]);
  });
}

// ------------------------------------------------------------------------------------------------------------------
for (const order of ["learn-first", "deliver-first"] as const) {
  test(`R17-05${order === "learn-first" ? "a" : "b"} USER save across an identity change (${order}): B never sees A's change`, async ({
    page,
    playwright,
  }, info) => {
    test.setTimeout(120_000);
    const lang = langOf(info);
    const w = watch(page);
    const s = stamp();
    const admin = await apiSession(playwright, "dev.admin");
    const u = await admin.call<{ id: string }>("POST", "/api/v1/users", {
      organizationId: ORG,
      displayName: `Synthetic QA R17-05 user ${s}`,
      email: `qa-r17-05-${s}@example.invalid`,
      preferredLocale: lang,
    });
    const newName = `Synthetic QA R17-05 renamed by A ${lang.toUpperCase()} ${s}`;
    await signInUi(page, lang, "dev.admin");
    await page.goto(`/admin/users/${u.id}`);
    const field = page.getByLabel(fieldLabel(lang, "admin.users.displayName"));
    await expect(field).toHaveValue(`Synthetic QA R17-05 user ${s}`);
    const doc = await docId(page);
    await field.fill(newName);
    await installLeakObserver(page, [`R17-05`, s]); // the user's old or new name as text
    await installTimeline(page, s);
    await page.waitForTimeout(2_500); // outside D-077's 2 s residual window (see R17-04c)
    const mark = w.timed.length;
    const held = await holdAnswer(page, "PATCH", (p) => p === `/api/v1/users/${u.id}`);
    await page.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
    await expect.poll(() => held.sent).toBe(true);
    const tab2 = await otherTab(page, "dev.lead", LEAD_NAME);
    await page.bringToFront();
    if (order === "learn-first") {
      await phase(page, "in-app navigation, answer held");
      await inAppGo(page, "/about");
      await expect(header(page)).toHaveText(LEAD_NAME, { timeout: 10_000 });
    }
    await phase(page, "answer delivered");
    held.release();
    await expect.poll(() => held.delivered).toBe(true);
    await page.waitForTimeout(3_000);
    expect(held.status, held.body).toBe(200);
    const after = { path: new URL(page.url()).pathname, header: (await header(page).textContent())?.trim() };
    note(info, { type: "r17-05-timeline", description: JSON.stringify(await timeline(page)) });
    note(info, { type: "r17-05-api", description: JSON.stringify(w.timed.slice(mark)) });
    note(info, { type: "r17-05", description: `${order} after delivery: ${JSON.stringify(after)}` });
    // Dev run 3: after a deliver-first save tab 1 is still on the user's page; pushing the SAME path is not a
    // navigation (no /me), so navigate elsewhere first, then open the user's page as B.
    await phase(page, "in-app navigation");
    await inAppGo(page, "/about");
    await bInPlace(page, lang, LEAD_NAME);
    await inAppGo(page, `/admin/users/${u.id}`);
    await page.waitForTimeout(2_000);
    await expect(header(page)).toHaveText(LEAD_NAME);
    await shot(page, lang, `qa-r17-05-${order}-b-on-user`);
    await expect(page.getByText(newName)).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: tr(lang, "common.state.saved") })).toHaveCount(0);
    expect(await leaksNotA(page, info, ADMIN_NAME), "A's user change under B's header").toEqual([]);
    expect(await docId(page)).toBe(doc);
    await tab2.close();
    expect(w.tooMany).toEqual([]);
    expect(w.pageErrors).toEqual([]);
  });
}

// ------------------------------------------------------------------------------------------------------------------
for (const delay of [0, 5_000]) {
  test(`R17-06${delay ? "b" : "a"} in-app navigation ${delay ? "5 s" : "at once"} after another sign-in: GET /me goes first; header and data agree`, async ({
    page,
    playwright,
  }, info) => {
    test.setTimeout(120_000);
    const lang = langOf(info);
    const w = watch(page);
    const b = await officeRecord(playwright, lang, `R17-06 office-only d${delay}`); // A = dev.office sees it; B = dev.lead not
    await signInUi(page, lang, "dev.office");
    await navLink(page, lang, "transformations").click();
    await expect(page.getByText(b.marker).first()).toBeVisible();
    await navLink(page, lang, "myWork").click();
    await page.waitForURL("**/my-work");
    const doc = await docId(page);
    await installLeakObserver(page, [b.marker], LEAD_NAME); // B's header over A's (office-only) record
    const tab2 = await otherTab(page, "dev.lead", LEAD_NAME);
    await page.bringToFront();
    if (delay) await page.waitForTimeout(delay);
    const mark = w.log.length;
    const meAt = w.me;
    await navLink(page, lang, "transformations").click(); // the list is still in the cache, maybe fresh
    await page.waitForURL("**/transformations");
    await expect(header(page)).toHaveText(LEAD_NAME, { timeout: 10_000 });
    await page.waitForTimeout(1_500);
    const seq = w.log.slice(mark);
    note(info, { type: "r17-06", description: `api after click: ${JSON.stringify(seq)}` });
    const firstSend = seq.find((e) => e.startsWith("send "));
    expect(firstSend, "the first request after the navigation").toBe("send GET /api/v1/me");
    const meDone = seq.indexOf("done GET /api/v1/me");
    const pageGetBefore = seq.slice(0, meDone).filter((e) => e.startsWith("send GET") && !e.endsWith("/api/v1/me"));
    expect(pageGetBefore, "page GETs sent before /me answered").toEqual([]);
    expect(w.me - meAt, "GET /me for one navigation").toBeLessThanOrEqual(2);
    await ensureLanguage(page, lang);
    await expect(page.getByText(b.marker)).toHaveCount(0);
    await shot(page, lang, `qa-r17-06-${delay}-b-list`);
    await expectAccessible(page, lang, `qa-r17-06-${delay}-b-list`);
    expect(await leaks(page), "B's header over A's record").toEqual([]);
    expect(await docId(page)).toBe(doc);
    await tab2.close();
    expect(w.tooMany).toEqual([]);
    expect(w.pageErrors).toEqual([]);
  });
}

// ------------------------------------------------------------------------------------------------------------------
test("R17-07 an in-app session end lands ONCE on sign-in with the message, bounded /me, no stale shell", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const lang = langOf(info);
  const w = watch(page);
  await logHistory(page);
  await signInUi(page, lang, "dev.office");
  await navLink(page, lang, "transformations").click();
  await page.waitForURL("**/transformations");
  const doc = await docId(page);
  const tab2 = await otherTab(page, null); // signed out elsewhere; nobody signs in
  await page.bringToFront();
  const meAt = w.me;
  const navAt = (await navLog(page)).length;
  await navLink(page, lang, "myWork").click();
  const message = tr(lang, "auth.errors.session_expired");
  await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible({ timeout: 1_500 });
  await expect(page.getByLabel(fieldLabel(lang, "auth.dev.username"))).toBeVisible({ timeout: 1_500 });
  const paths = new Set<string>();
  for (let i = 0; i < 30; i++) {
    paths.add(new URL(page.url()).pathname);
    await page.waitForTimeout(100);
  }
  const hist = (await navLog(page)).slice(navAt);
  note(info, { type: "r17-07", description: `history writes: ${JSON.stringify(hist)}; /me ${w.me - meAt}` });
  expect([...paths]).toEqual(["/login"]);
  expect(hist.filter((h) => h.endsWith(" /login")), "router writes to /login").toHaveLength(1);
  expect(w.me - meAt, "GET /me after the end").toBeLessThanOrEqual(3);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expect(page.getByRole("navigation", { name: tr(lang, "nav.primary") })).toHaveCount(0);
  await expect(anySignOut(page)).toHaveCount(0);
  await expect(header(page)).toHaveCount(0);
  await shot(page, lang, "qa-r17-07-session-ended");
  await expectAccessible(page, lang, "qa-r17-07-session-ended");
  expect(await docId(page)).toBe(doc);
  await tab2.close();
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
test("R17-08 a 403 is never a session end; the same person's next save after a new session updates and navigates", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const w = watch(page);
  const a = await officeRecord(playwright, lang, "R17-08");
  // (a) dev.lead opens an office-only record in-app: not visible, still signed in, no sign-in page.
  await signInUi(page, lang, "dev.lead");
  await inAppGo(page, `/transformations/${a.id}`);
  await expect(page.locator("[data-state='not-found'], [data-state='no-permission']").first()).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(new URL(page.url()).pathname).toBe(`/transformations/${a.id}`);
  await expect(header(page)).toHaveText(LEAD_NAME);
  await expect(page.getByText(tr(lang, "auth.errors.session_expired"))).toHaveCount(0);
  await shot(page, lang, "qa-r17-08a-no-permission");
  // (b) dev.office on the edit page; in tab 2 the SAME person signs out and in again (a new session, a new CSRF token).
  await anySignOut(page).click();
  await page.waitForURL("**/login**");
  await signInUi(page, lang, "dev.office");
  await page.goto(`/transformations/${a.id}/edit`);
  const name = page.getByLabel(fieldLabel(lang, "transformations.field.name"));
  await expect(name).toHaveValue(a.marker);
  const doc = await docId(page);
  const tab2 = await otherTab(page, "dev.office", OFFICE_NAME);
  await page.bringToFront();
  await name.fill(`${a.marker} first try`);
  const refused = page.waitForResponse((r) => r.request().method() === "PATCH");
  await page.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  const r = await refused;
  const refusedBody = await r.text();
  note(info, { type: "r17-08", description: `first save: ${r.status()} ${refusedBody.slice(0, 160)}` });
  expect(r.status()).toBe(403);
  await expect(page.getByRole("alert").first()).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(new URL(page.url()).pathname, "a 403 is not a session end").toBe(`/transformations/${a.id}/edit`);
  await expect(header(page)).toHaveText(OFFICE_NAME);
  await expect(page.getByText(tr(lang, "auth.errors.session_expired"))).toHaveCount(0);
  await shot(page, lang, "qa-r17-08b-403-csrf");
  await expectAccessible(page, lang, "qa-r17-08b-403-csrf");
  // The person navigates in-app (GET /me confirms the new session), comes back and saves: it updates and navigates.
  await inAppGo(page, `/transformations/${a.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(a.marker);
  await inAppGo(page, `/transformations/${a.id}/edit`);
  await expect(name).toHaveValue(a.marker);
  await name.fill(`${a.marker} saved`);
  await page.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  await page.waitForURL(new RegExp(`/transformations/${a.id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${a.marker} saved`);
  await expect(header(page)).toHaveText(OFFICE_NAME);
  expect(await docId(page)).toBe(doc);
  await tab2.close();
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
test("R17-09 same-identity admin flows still navigate and update: organisation create and user save", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(90_000);
  const lang = langOf(info);
  const w = watch(page);
  const s = stamp().toUpperCase();
  const nameEn = `Synthetic QA R17-09 org ${lang.toUpperCase()} ${s}`;
  await signInUi(page, lang, "dev.admin");
  await navLink(page, lang, "admin").click();
  const doc = await docId(page);
  await inAppGo(page, "/admin/organizations");
  await page.getByRole("button", { name: tr(lang, "admin.organizations.new") }).click();
  await page.getByLabel(fieldLabel(lang, "common.field.code")).fill(`QA17P${s}`.slice(0, 20));
  await page.getByLabel(fieldLabel(lang, "common.field.nameEn")).fill(nameEn);
  await page.getByLabel(fieldLabel(lang, "common.field.nameAr")).fill(`منظمة اصطناعية ${s}`);
  await page.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await page.waitForURL(/\/admin\/organizations\/[0-9a-f-]{36}$/);
  // The organisation's page shows its name in the UI language (dev run 4: AR shows the Arabic name).
  await expect(page.getByRole("heading", { level: 1 })).toContainText(lang === "ar" ? `منظمة اصطناعية ${s}` : nameEn);
  await shot(page, lang, "qa-r17-09-org-created");
  const admin = await apiSession(playwright, "dev.admin");
  const u = await admin.call<{ id: string }>("POST", "/api/v1/users", {
    organizationId: ORG,
    displayName: `Synthetic QA R17-09 user ${s}`,
    email: `qa-r17-09-${s.toLowerCase()}@example.invalid`,
    preferredLocale: lang,
  });
  await inAppGo(page, `/admin/users/${u.id}`);
  const field = page.getByLabel(fieldLabel(lang, "admin.users.displayName"));
  await expect(field).toHaveValue(`Synthetic QA R17-09 user ${s}`);
  await field.fill(`Synthetic QA R17-09 user ${s} renamed`);
  await page.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  await expect(page.getByText(tr(lang, "common.state.saved")).first()).toBeVisible();
  await expect(page.getByText(`Synthetic QA R17-09 user ${s} renamed`).first()).toBeVisible();
  await shot(page, lang, "qa-r17-09-user-saved");
  await expectAccessible(page, lang, "qa-r17-09-user-saved");
  expect(await docId(page), "one document (no reload)").toBe(doc);
  await expect(header(page)).toHaveText(ADMIN_NAME);
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});
