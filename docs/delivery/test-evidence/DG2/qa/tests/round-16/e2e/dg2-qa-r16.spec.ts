// qa-verifier DG2 round 16 — independent negative/regression probes for the D-076 repair on candidate 0cab0a8c
// (T-DG2-REV-QA-R16): FE14 (44f1cf0, F-DG2-530: a write still in flight when the tab's identity changed could write the
// previous user's record into the new user's cache; on refocus the page data was refetched under the new cookie while
// the header still showed the previous identity). Authored by qa-verifier, NOT by an implementer. Runs in chromium-en
// and chromium-ar against the REAL built API + PostgreSQL (e2e/support/qa-stack.sh).
//
// The in-flight writes are REAL: the browser's request is sent to the real API at once (route.fetch, A's cookie), so
// the server commits A's write; only the delivery of its answer to the page is held until tab 1 has learned of the new
// identity. Nothing is mocked or replaced.
//
// R16-01 CREATE in flight: A (dev.office) submits a new Finance record; while its answer is held, A signs out and B
//   (dev.lead, Retail only) signs in in a second tab; tab 1 is refocused after /me's 60 s staleTime, /me returns B;
//   then A's answer is delivered. Expected: B never sees A's record (its name is never in the document), B is not
//   navigated to A's record, no error banner, no page error; B opening A's record id gets not-found.
// R16-02 EDIT (PATCH) in flight, same sequence: A's new name is never in the document, B is not navigated to A's
//   record with A's updated data; B opening A's record id gets not-found (the cache holds nothing of A's).
// R16-03 ARCHIVE in flight, same sequence: A's archive reason and A's record never show for B.
// R16-04 positive regression: a normal create, edit, evidence file upload and archive still update the screen and
//   navigate as before, in one document (no reload), no page error.
// R16-05 header/data agreement on refocus (X6): tab 1 shows A's (dev.lead) list; in tab 2 A signs out and B
//   (dev.office) signs in; tab 1 is refocused after the list's 15 s staleTime but BEFORE /me's 60 s staleTime. No
//   moment ever shows A's name in the header together with B-only data (a Finance record dev.lead cannot read); the
//   header then shows B and the list shows B's data; a second refocus right after fetches no further /me.
// R16-06 CREATE answered BEFORE tab 1 learns of the new identity (added after a static read of the create handler: it
//   accepts the 201, then refreshes GET /me (F-DG1-210) and navigates to the new record with its code and name in the
//   navigation state). A (dev.office) submits a Finance record; the answer is held while A signs out and B (dev.lead)
//   signs in in a second tab; the answer is then delivered with NO refocus, so tab 1 still holds A's generation and the
//   handler's own /me refresh is the first to return B. Expected: B never sees A's record (name or code) and is not
//   navigated to it.
// All data is SYNTHETIC. No business approval is implied (product G1–G6 never imply DG0–DG7).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  SHOTS,
  apiSession,
  axeSummary,
  ensureLanguage,
  exactly,
  expectAccessible,
  fieldLabel,
  langOf,
  rowAction,
  shot,
  tr,
  type Lang,
} from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });

const SYN_FIN = "01920000-0000-7000-9000-000000000103"; // Synthetic Finance: dev.office (org-wide) reads it, dev.lead not
const OFFICE_NAME = "Synthetic Transformation Office";
const LEAD_NAME = "Synthetic Transformation Lead";

test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  mkdirSync(join(SHOTS, lang), { recursive: true });
  writeFileSync(join(SHOTS, lang, "axe-summary-qa-r16.json"), `${JSON.stringify(axeSummary, null, 2)}\n`);
});

function watch(page: Page) {
  const st = { me: 0, tooMany: [] as string[], pageErrors: [] as string[] };
  page.on("request", (r) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === "/api/v1/me") st.me++;
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

async function signInUi(page: Page, lang: Lang, username: string) {
  await page.goto("/login");
  await anyDevField(page).fill(username);
  await anyDevField(page).press("Enter");
  await page.waitForURL("**/my-work");
  await ensureLanguage(page, lang);
}

/**
 * Records (in the page) every DOM moment where all `markers` are in the document at once and, if `header` is given,
 * the header's signed-in name (.user-box__name) is exactly `header` at that moment.
 */
async function installLeakObserver(page: Page, markers: string[], header: string | null = null) {
  await page.evaluate(
    ([ms, h]) => {
      const w = window as unknown as { __qaLeak: string[]; __qaDoc: number };
      w.__qaLeak = [];
      w.__qaDoc = w.__qaDoc ?? Math.random();
      // Where the first marker is: the element holding the text node (tag, role, data-state, dialog or not), so a
      // leak report says what showed it. Text typed into a form control is its value, never a text node.
      const where = (m: string) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!(n.nodeValue ?? "").includes(m)) continue;
          const el = n.parentElement;
          if (!el) return "?";
          const st = el.closest("[data-state]")?.getAttribute("data-state") ?? "-";
          const dlg = el.closest("[role='dialog'], dialog") ? "in-dialog" : "page";
          return `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""} state=${st} ${dlg}`;
        }
        return "split-across-nodes";
      };
      const check = () => {
        const text = document.body.textContent ?? "";
        const name = document.querySelector(".user-box__name")?.textContent?.trim() ?? null;
        if (ms.every((m) => text.includes(m)) && (h === null || name === h)) {
          const phase = (window as unknown as { __qaPhase?: string }).__qaPhase ?? "before-switch";
          w.__qaLeak.push(`${phase} | header=${name} | ${location.pathname} | ${where(ms[0]!)}`);
        }
      };
      check();
      new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
    },
    [markers, header] as const,
  );
}
const leaks = (page: Page) => page.evaluate(() => (window as unknown as { __qaLeak: string[] }).__qaLeak);
/**
 * The observer's hits that are NOT A's own view: A's own text while A is still signed in and shown in the header
 * (before the switch) is legitimate (dev run 4: A's typed archive reason, in A's own open dialog, under A's name).
 * Every raw hit is kept as an annotation.
 */
async function leaksForB(page: Page, info: Parameters<Parameters<typeof test>[1]>[1]) {
  const all = await leaks(page);
  info.annotations.push({ type: "observer-hits", description: all.length ? all.join(" ;; ") : "none" });
  return all.filter((e) => !e.startsWith(`before-switch | header=${OFFICE_NAME} |`));
}
const docId = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __qaDoc?: number };
    w.__qaDoc = w.__qaDoc ?? Math.random();
    return w.__qaDoc;
  });

/**
 * Sends the matching write to the REAL API at once (A's cookie; the server commits it) and holds only the delivery of
 * its answer to the page until `release()`.
 */
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

/** A signs out and B signs in in a REAL second tab of the same browser (UI only). */
async function otherTabSwitch(page: Page, to: string, toName: string) {
  const tab2 = await page.context().newPage();
  await tab2.goto("/about");
  await anySignOut(tab2).click();
  await tab2.waitForURL("**/login**");
  await anyDevField(tab2).fill(to);
  await anyDevField(tab2).press("Enter");
  await expect(tab2.getByText(toName).first()).toBeVisible();
  return tab2;
}

async function refocus(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
}

async function inAppGo(page: Page, path: string) {
  await page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  }, path);
}

async function officeRecord(playwright: Parameters<typeof apiSession>[0], lang: Lang, tag: string) {
  const marker = `Synthetic QA R16 ${tag} ${lang.toUpperCase()} ${Date.now().toString(36)}`;
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

/** The common tail of R16-01..03: identity switch while the answer is held; refocus; deliver; B's view. */
async function switchWhileHeld(
  page: Page,
  held: { sent: boolean; release: () => void; delivered: boolean },
  w: ReturnType<typeof watch>,
  info: Parameters<Parameters<typeof test>[1]>[1],
  label: string,
  lang: Lang,
) {
  await expect.poll(() => held.sent, { message: "the write reached the server" }).toBe(true);
  const tab2 = await otherTabSwitch(page, "dev.lead", LEAD_NAME);
  // Refocus tab 1 after /me's 60 s staleTime, so that the pre-repair code (TanStack's own focus refetch) would also
  // refetch /me: the probe then compares like with like.
  await page.waitForTimeout(61_000);
  const meAt = w.me;
  await refocus(page);
  await expect(page.locator(".user-box__name")).toHaveText(LEAD_NAME, { timeout: 10_000 });
  await page.evaluate(() => ((window as unknown as { __qaPhase?: string }).__qaPhase = "B-shown, answer held"));
  // B's identity is in place in tab 1; only now is A's answer delivered.
  held.release();
  await page.evaluate(() => ((window as unknown as { __qaPhase?: string }).__qaPhase = "B-shown, answer delivered"));
  await expect.poll(() => held.delivered, { message: "A's answer delivered to the page" }).toBe(true);
  await page.waitForTimeout(2_500);
  info.annotations.push({ type: label, description: `after delivery: ${new URL(page.url()).pathname}; /me since refocus ${w.me - meAt}` });
  await expect(page.locator(".user-box__name")).toHaveText(LEAD_NAME);
  expect(w.me - meAt, "GET /me after the refocus").toBeLessThanOrEqual(4);
  // B's own preferred language applies to tab 1 now (dev run 2: dev.lead prefers AR); switch to this project's
  // language (a real preference save for B) for the rest of the probe.
  await ensureLanguage(page, lang);
  return tab2;
}

// ------------------------------------------------------------------------------------------------------------------
test("R16-01 a CREATE in flight when B signs in in another tab: B never sees A's record and is not navigated to it", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  const w = watch(page);
  const marker = `Synthetic QA R16-01 created by A ${lang.toUpperCase()} ${Date.now().toString(36)}`;
  await signInUi(page, lang, "dev.office");
  await page.goto("/transformations/new");
  await expect(page.locator(".user-box__name")).toHaveText(OFFICE_NAME);
  const doc = await docId(page);
  await page.getByLabel(fieldLabel(lang, "transformations.field.businessUnit")).selectOption(SYN_FIN);
  await page.getByLabel(fieldLabel(lang, "transformations.field.name")).fill(marker);
  // End-to-End is the default mode (dev run 1: the radio's accessible name also carries its guidance text).
  await installLeakObserver(page, [marker]);
  const held = await holdAnswer(page, "POST", (p) => p === "/api/v1/transformations");
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  const tab2 = await switchWhileHeld(page, held, w, info, "r16-01", lang);

  // The server committed A's record (A can read it, B cannot): the held answer WAS A's record.
  expect(held.status).toBe(201);
  const created = JSON.parse(held.body) as { id: string; name: string };
  expect(created.name).toBe(marker);
  const office = await apiSession(playwright, "dev.office");
  await office.call("GET", `/api/v1/transformations/${created.id}`);
  const lead = await apiSession(playwright, "dev.lead");
  await lead.call("GET", `/api/v1/transformations/${created.id}`, undefined, { expect: 404 });

  expect(new URL(page.url()).pathname, "B is not navigated to A's new record").not.toBe(`/transformations/${created.id}`);
  await expect(page.locator("[data-state='error']")).toHaveCount(0);
  await shot(page, lang, "qa-r16-01-b-after-delivery");
  await expectAccessible(page, lang, "qa-r16-01-b-after-delivery");
  // B opens A's record id in-app: not-found, and nothing of A's comes from the cache.
  await inAppGo(page, `/transformations/${created.id}`);
  await page.waitForTimeout(1_500);
  await expect(page.locator("[data-state='not-found'], [data-state='no-permission']").first()).toBeVisible();
  await navLink(page, lang, "transformations").click();
  await page.waitForTimeout(1_500);
  await expect(page.locator("main#main h1")).toBeVisible();
  expect(await docId(page), "same document throughout").toBe(doc);
  expect(await leaksForB(page, info), "A's record name in the document after the write was sent, outside A's own view").toEqual([]);
  await expect(page.getByText(marker)).toHaveCount(0);
  await tab2.close();
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
test("R16-02 an EDIT in flight when B signs in in another tab: A's updated record never lands in B's view or cache", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  const w = watch(page);
  const a = await officeRecord(playwright, lang, "R16-02 A-only");
  const newName = `${a.marker} edited by A`;
  await signInUi(page, lang, "dev.office");
  await page.goto(`/transformations/${a.id}/edit`);
  const name = page.getByLabel(fieldLabel(lang, "transformations.field.name"));
  await expect(name).toHaveValue(a.marker);
  const doc = await docId(page);
  await name.fill(newName);
  await installLeakObserver(page, [newName]);
  const held = await holdAnswer(page, "PATCH", (p) => p === `/api/v1/transformations/${a.id}`);
  await page.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  const tab2 = await switchWhileHeld(page, held, w, info, "r16-02", lang);

  expect(held.status).toBe(200);
  expect((JSON.parse(held.body) as { name: string }).name).toBe(newName);
  const back = await a.office.call<{ name: string }>("GET", `/api/v1/transformations/${a.id}`);
  expect(back.name, "the server committed A's edit").toBe(newName);

  await expect(page.locator("[data-state='error']")).toHaveCount(0);
  await shot(page, lang, "qa-r16-02-b-after-delivery");
  await expectAccessible(page, lang, "qa-r16-02-b-after-delivery");
  await inAppGo(page, `/transformations/${a.id}`);
  await page.waitForTimeout(1_500);
  await expect(page.locator("[data-state='not-found'], [data-state='no-permission']").first()).toBeVisible();
  await expect(page.getByText(newName)).toHaveCount(0);
  await expect(page.getByText(a.marker)).toHaveCount(0);
  await shot(page, lang, "qa-r16-02-b-on-a-detail-url");
  expect(await docId(page), "same document throughout").toBe(doc);
  expect(await leaksForB(page, info), "A's new name in the document after the edit was sent, outside A's own view").toEqual([]);
  await tab2.close();
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
test("R16-03 an ARCHIVE in flight when B signs in in another tab: A's archived record and reason never show for B", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  const w = watch(page);
  const a = await officeRecord(playwright, lang, "R16-03 A-only");
  const reason = `Synthetic QA R16-03 reason ${lang.toUpperCase()} ${Date.now().toString(36)}`;
  await signInUi(page, lang, "dev.office");
  await page.goto(`/transformations/${a.id}`);
  await expect(page.getByText(a.marker).first()).toBeVisible();
  const doc = await docId(page);
  await page.getByRole("button", { name: tr(lang, "transformations.archive.action"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "common.form.reason")).fill(reason);
  await installLeakObserver(page, [reason]);
  const held = await holdAnswer(page, "POST", (p) => p === `/api/v1/transformations/${a.id}/archive`);
  await dialog.getByRole("button", { name: tr(lang, "transformations.archive.confirm"), exact: true }).click();
  const tab2 = await switchWhileHeld(page, held, w, info, "r16-03", lang);

  expect(held.status).toBe(200);
  const back = await a.office.call<{ archivedAt: string | null }>("GET", `/api/v1/transformations/${a.id}`);
  expect(back.archivedAt, "the server committed A's archive").not.toBeNull();

  await expect(page.locator("[data-state='error']")).toHaveCount(0);
  await expect(page.getByText(a.marker)).toHaveCount(0);
  await shot(page, lang, "qa-r16-03-b-after-delivery");
  await expectAccessible(page, lang, "qa-r16-03-b-after-delivery");
  await navLink(page, lang, "transformations").click();
  await page.waitForTimeout(1_000);
  await inAppGo(page, `/transformations/${a.id}`);
  await page.waitForTimeout(1_500);
  await expect(page.locator("[data-state='not-found'], [data-state='no-permission']").first()).toBeVisible();
  await expect(page.getByText(a.marker)).toHaveCount(0);
  expect(await docId(page), "same document throughout").toBe(doc);
  expect(await leaksForB(page, info), "A's archive reason in the document after the archive was sent, outside A's own view").toEqual([]);
  await tab2.close();
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
test("R16-04 normal create, edit, evidence upload and archive still update the screen and navigate as before", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const w = watch(page);
  const marker = `Synthetic QA R16-04 ${lang.toUpperCase()} ${Date.now().toString(36)}`;
  await signInUi(page, lang, "dev.office");
  await navLink(page, lang, "transformations").click();
  await page.waitForURL("**/transformations");
  const doc = await docId(page);
  // Create (in-app navigation to the create page via the URL bar would reload; use the router).
  await inAppGo(page, "/transformations/new");
  await page.getByLabel(fieldLabel(lang, "transformations.field.businessUnit")).selectOption(SYN_FIN);
  await page.getByLabel(fieldLabel(lang, "transformations.field.name")).fill(marker);
  // End-to-End is the default mode (dev run 1: the radio's accessible name also carries its guidance text).
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  await page.waitForURL(/\/transformations\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByRole("status").filter({ hasText: tr(lang, "transformations.created") })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(marker);
  // Edit: back on the detail page with the new name, without a reload.
  await page.getByRole("link", { name: exactly(tr(lang, "common.action.edit")) }).first().click();
  await page.waitForURL(`**/transformations/${id}/edit`);
  await page.getByLabel(fieldLabel(lang, "transformations.field.name")).fill(`${marker} (edited)`);
  await page.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  await page.waitForURL(new RegExp(`/transformations/${id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${marker} (edited)`);
  await shot(page, lang, "qa-r16-04-after-edit");
  // Evidence: create a file item and upload its content; the download link appears without a reload.
  await inAppGo(page, `/transformations/${id}/evidence`);
  const reg = page.getByRole("region", { name: tr(lang, "evidence.register"), exact: true });
  await reg.getByRole("button", { name: tr(lang, "evidence.addKind.file"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "evidence.field.title")).fill("Synthetic QA R16-04 file");
  await dialog.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: tr(lang, "evidence.upload.title", { title: "Synthetic QA R16-04 file" }) }),
  ).toBeVisible();
  const upload = page.waitForResponse((r) => r.url().endsWith("/content") && r.request().method() === "POST");
  await dialog.getByLabel(fieldLabel(lang, "evidence.upload.file")).setInputFiles({
    name: "qa-r16-04.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("synthetic,rows\n1,2\n"),
  });
  await dialog.getByRole("button", { name: tr(lang, "evidence.upload.confirm"), exact: true }).click();
  expect((await upload).ok()).toBe(true);
  await expect(dialog).toHaveCount(0);
  await expect(reg.getByRole("link", { name: rowAction(lang, "evidence.download", "Synthetic QA R16-04 file") })).toBeVisible();
  await shot(page, lang, "qa-r16-04-after-upload");
  await expectAccessible(page, lang, "qa-r16-04-after-upload");
  // Archive: the note with the reason, no Edit link any more.
  await inAppGo(page, `/transformations/${id}`);
  await page.getByRole("button", { name: tr(lang, "transformations.archive.action"), exact: true }).click();
  await dialog.getByLabel(fieldLabel(lang, "common.form.reason")).fill("Synthetic QA R16-04 finished");
  await dialog.getByRole("button", { name: tr(lang, "transformations.archive.confirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("note")).toContainText("Synthetic QA R16-04 finished");
  await expect(page.getByRole("link", { name: exactly(tr(lang, "common.action.edit")) })).toHaveCount(0);
  await shot(page, lang, "qa-r16-04-archived");
  await expectAccessible(page, lang, "qa-r16-04-archived");
  expect(await docId(page), "one document throughout (no reload)").toBe(doc);
  await expect(page.locator(".user-box__name")).toHaveText(OFFICE_NAME);
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
test("R16-05 refocus with a new user before /me is stale: the header name and the data always belong to the same user", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const w = watch(page);
  const b = await officeRecord(playwright, lang, "R16-05 B-only"); // dev.office reads it; dev.lead (A) cannot
  await signInUi(page, lang, "dev.lead");
  await navLink(page, lang, "transformations").click();
  await page.waitForURL("**/transformations");
  await expect(page.locator(".user-box__name")).toHaveText(LEAD_NAME);
  await expect(page.locator("main#main h1")).toBeVisible();
  await expect(page.getByText(b.marker)).toHaveCount(0);
  const doc = await docId(page);
  await installLeakObserver(page, [b.marker], LEAD_NAME);
  const t0 = Date.now();
  const tab2 = await otherTabSwitch(page, "dev.office", OFFICE_NAME);
  // Past the list query's 15 s staleTime, well before /me's 60 s staleTime.
  await page.waitForTimeout(Math.max(0, 17_000 - (Date.now() - t0)));
  const meAt = w.me;
  await refocus(page);
  await expect(page.locator(".user-box__name")).toHaveText(OFFICE_NAME, { timeout: 10_000 });
  await expect(page.getByText(b.marker).first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1_000);
  const meAfter = w.me;
  expect(meAfter - meAt, "GET /me after the refocus").toBeLessThanOrEqual(3);
  // A second refocus right away: nothing is stale, so no further /me (no storm).
  await refocus(page);
  await page.waitForTimeout(1_500);
  expect(w.me - meAfter, "GET /me after a second refocus with nothing stale").toBe(0);
  info.annotations.push({ type: "r16-05", description: `/me after refocus ${meAfter - meAt}; after the 2nd ${w.me - meAfter}` });
  await shot(page, lang, "qa-r16-05-after-refocus");
  await expectAccessible(page, lang, "qa-r16-05-after-refocus");
  expect(await docId(page)).toBe(doc);
  expect(await leaks(page), "moments with A's name in the header together with B-only data").toEqual([]);
  await tab2.close();
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});

// ------------------------------------------------------------------------------------------------------------------
test("R16-06 a CREATE answered before the tab learns of B (the handler's own /me refresh returns B): B never sees A's record", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const w = watch(page);
  const marker = `Synthetic QA R16-06 created by A ${lang.toUpperCase()} ${Date.now().toString(36)}`;
  await signInUi(page, lang, "dev.office");
  await page.goto("/transformations/new");
  await expect(page.locator(".user-box__name")).toHaveText(OFFICE_NAME);
  const doc = await docId(page);
  await page.getByLabel(fieldLabel(lang, "transformations.field.businessUnit")).selectOption(SYN_FIN);
  await page.getByLabel(fieldLabel(lang, "transformations.field.name")).fill(marker);
  // Text typed into the name field is its value, never a text node: any hit is the record shown as text.
  await installLeakObserver(page, [marker]);
  const held = await holdAnswer(page, "POST", (p) => p === "/api/v1/transformations");
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  await expect.poll(() => held.sent, { message: "the write reached the server" }).toBe(true);
  const tab2 = await otherTabSwitch(page, "dev.lead", LEAD_NAME);
  await page.bringToFront();
  await page.evaluate(() => ((window as unknown as { __qaPhase?: string }).__qaPhase = "B signed in elsewhere, answer delivered"));
  const meAt = w.me;
  held.release();
  await expect.poll(() => held.delivered, { message: "A's answer delivered to the page" }).toBe(true);
  await page.waitForTimeout(4_000);
  expect(held.status).toBe(201);
  const created = JSON.parse(held.body) as { id: string; code: string; name: string };
  expect(created.name).toBe(marker);
  const lead = await apiSession(playwright, "dev.lead");
  await lead.call("GET", `/api/v1/transformations/${created.id}`, undefined, { expect: 404 });
  const path = new URL(page.url()).pathname;
  const header = (await page.locator(".user-box__name").textContent())?.trim() ?? null;
  const hits = await leaks(page);
  const codeShown = (await page.locator("body").textContent())?.includes(created.code) ?? false;
  const state = await page.locator("[data-state]").evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
  info.annotations.push({
    type: "r16-06",
    description: `after delivery: path ${path}; header ${header}; data-state ${JSON.stringify(state)}; A's code ${created.code} shown ${codeShown}; /me ${w.me - meAt}; observer ${JSON.stringify(hits)}`,
  });
  await shot(page, lang, "qa-r16-06-after-delivery");
  await expectAccessible(page, lang, "qa-r16-06-after-delivery");
  expect(header, "tab 1 now shows B").toBe(LEAD_NAME);
  expect(await docId(page)).toBe(doc);
  expect(hits, "A's new record's name shown as text in tab 1 (now B's)").toEqual([]);
  expect(codeShown, `A's new record's code ${created.code} shown to B`).toBe(false);
  expect(path, "B is not navigated to A's new record").not.toBe(`/transformations/${created.id}`);
  await tab2.close();
  expect(w.tooMany).toEqual([]);
  expect(w.pageErrors).toEqual([]);
});
