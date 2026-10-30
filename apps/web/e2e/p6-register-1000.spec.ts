// The 1,000-initiative register against the REAL API (apps/web/e2e/support/with-stack.sh; T-DG6-FE-D; p6-work-split
// §H/G.6; ADR-0057 §4, §5). REQ-S15-013 acceptance (A20): "on a register with 1,000 initiatives, sorting, filtering,
// paging and hiding a column all work, and the API returns paginated results". REQ-S15-010: saved views and chips;
// global search; contextual help. All data is SYNTHETIC (1,000 initiatives created through POST /api/v1/initiatives
// by the seeded dev Transformation Lead in a fresh transformation per language). Nothing here is a business approval,
// and nothing touches the engineering delivery gates.
//  - The API returns pages: every list request of the register carries `limit=25`, and the first page answers 25
//    items with a `nextCursor`.
//  - Sorting is the server's: the first row after "Code, descending" is the API's first item for `sort=-code`.
//  - Filtering is the server's: `q` narrows 1,000 to the one matching initiative; a chip names it and removes it.
//  - Paging: three pages forward hold 75 different initiatives; Previous returns to the earlier page.
//  - Hiding a column and saving the view as the default stores the choice on the server: after a reload the column
//    is still hidden (no browser storage involved); the view is deleted at the end.
//  - The auditor sees the shared view, applies it, and is offered no write.
// Every screen is checked with axe (no serious or critical violation) and captured in EN and AR.
// Budget (rules 13, 15): 300 s per test. Measured on the 4-core sandbox while the integration suite and other agents
// ran (load average 14.1 at start, 19.9 at end; handback evidence e2e-p6-register-1000-run4.txt): setup 28.4 s (en)
// and 35.2 s (ar), the register test 29.1 s / 31.9 s, the auditor and search test 13.6 s / 14.2 s. The worst case is
// 35.2 s; 300 s is about 8x that.
import { expect, test, type Page } from "@playwright/test";
import { SYN_RETAIL, apiSession, expectAccessible, langOf, shot, signIn, tr, trackRequests } from "./support/ui.ts";

test.describe.configure({ mode: "serial", timeout: 300_000 });

const COUNT = 1000;
const NAME = (n: number) => `Synthetic register item ${String(n).padStart(4, "0")}`;
let tid = "";
let viewName = "";

interface ListPage {
  items: { id: string; code: string; name: string }[];
  nextCursor: string | null;
}

const rowsOf = (page: Page) => page.locator("[data-register='initiatives'] table tbody tr");
const firstCode = async (page: Page) => (await rowsOf(page).first().locator("bdi.code").textContent())?.trim();
const codesOnPage = async (page: Page) =>
  (await rowsOf(page).locator("td:first-child bdi.code").allTextContents()).map((s) => s.trim());

test("setup: a fresh transformation with 1,000 synthetic initiatives (through the API)", async ({
  playwright,
}, info) => {
  const lang = langOf(info);
  const started = Date.now();
  const lead = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic 1,000-initiative register ${lang.toUpperCase()}`,
    mode: "end_to_end",
  });
  tid = created.id;
  viewName = `Synthetic 1000 view ${lang}`;
  let next = 1;
  const worker = async () => {
    while (next <= COUNT) {
      const n = next++;
      await lead.call("POST", "/api/v1/initiatives", { transformationId: tid, name: NAME(n) });
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  const first = await lead.call<ListPage>("GET", `/api/v1/initiatives?transformationId=${tid}&limit=100`);
  expect(first.items).toHaveLength(100);
  expect(first.nextCursor).not.toBeNull();
  await lead.req.dispose();
  console.log(`setup ${lang}: ${COUNT} initiatives in ${Date.now() - started} ms`);
});

test("REQ-S15-013 A20: sort, filter, page and hide a column on 1,000 initiatives; the view persists on the server", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const started = Date.now();
  const foreign = trackRequests(page);
  const listRequests: URL[] = [];
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.pathname === "/api/v1/initiatives" && u.searchParams.get("limit") !== "100") listRequests.push(u);
  });
  await signIn(page, lang, "dev.lead");
  const firstPage = page.waitForResponse(
    (r) => r.url().includes("/api/v1/initiatives?") && r.url().includes("limit=25") && r.status() === 200,
  );
  await page.goto(`/transformations/${tid}/portfolio`);
  const body = (await (await firstPage).json()) as ListPage;
  // The API returns paginated results: 25 of 1,000, and a cursor for the next page.
  expect(body.items).toHaveLength(25);
  expect(body.nextCursor).not.toBeNull();
  await expect(rowsOf(page)).toHaveCount(25);
  expect(listRequests.every((u) => u.searchParams.get("limit") === "25")).toBe(true);

  // Sorting (server): Code descending equals the API's own first item for sort=-code.
  const lead = await apiSession(playwright, "dev.lead");
  const apiDesc = await lead.call<ListPage>("GET", `/api/v1/initiatives?transformationId=${tid}&sort=-code&limit=1`);
  const apiName = await lead.call<ListPage>("GET", `/api/v1/initiatives?transformationId=${tid}&sort=name&limit=1`);
  const codeHeader = page.getByRole("columnheader", { name: new RegExp(tr(lang, "portfolio.field.code")) });
  await expect(codeHeader).toHaveAttribute("aria-sort", "ascending");
  await codeHeader.getByRole("button").click();
  await expect(codeHeader).toHaveAttribute("aria-sort", "descending");
  await expect.poll(() => firstCode(page)).toBe(apiDesc.items[0]!.code);
  expect(listRequests.some((u) => u.searchParams.get("sort") === "-code")).toBe(true);
  const nameHeader = page.getByRole("columnheader", { name: new RegExp(tr(lang, "portfolio.field.name")) });
  await nameHeader.getByRole("button").click();
  await expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
  await expect(rowsOf(page).first()).toContainText(apiName.items[0]!.name);

  // Paging (server cursor): three pages hold 75 different initiatives; Previous goes back.
  const seen = new Set<string>();
  for (let p = 1; p <= 3; p++) {
    await expect(page.locator(".pager__info")).toContainText(String(p));
    // The previous page stays visible (aria-busy) until the next one arrives: wait for the table to settle.
    await expect(page.locator("[data-register='initiatives'] [aria-busy='false']:has(table)")).toHaveCount(1);
    const codes = await codesOnPage(page);
    expect(codes).toHaveLength(25);
    for (const c of codes) seen.add(c);
    if (p < 3) {
      const before = codes[0];
      await page.getByRole("button", { name: tr(lang, "common.table.next"), exact: true }).click();
      await expect.poll(() => firstCode(page)).not.toBe(before);
    }
  }
  expect(seen.size).toBe(75);
  expect(listRequests.filter((u) => u.searchParams.has("cursor")).length).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: tr(lang, "common.table.previous"), exact: true }).click();
  await expect(page.locator(".pager__info")).toContainText("2");

  // Filtering (server): q narrows 1,000 to one; the chip names the filter and removes it.
  const q = page.getByLabel(tr(lang, "productivity.register.q"), { exact: true });
  await q.fill("item 0042");
  await q.press("Enter");
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(rowsOf(page).first()).toContainText(NAME(42));
  expect(listRequests.some((u) => u.searchParams.get("q") === "item 0042")).toBe(true);
  const chips = page.getByRole("group", { name: tr(lang, "productivity.chips.label") });
  await expect(chips).toContainText(tr(lang, "productivity.register.q"));
  await expectAccessible(page, lang, "p6-register-1000-filtered");
  await shot(page, lang, "p6-register-1000-filtered");
  await chips.getByRole("button").first().click();
  await expect(rowsOf(page)).toHaveCount(25);

  // Hiding a column, saved as the default view (server), survives a reload.
  await page.getByRole("button", { name: tr(lang, "common.table.columns") }).click();
  await page.getByRole("checkbox", { name: tr(lang, "portfolio.field.wave"), exact: true }).uncheck();
  const table = page.locator("[data-register='initiatives'] table");
  await expect(table.locator("thead")).not.toContainText(tr(lang, "portfolio.field.wave"));
  await expect(page.locator("[data-view-state]")).toHaveAttribute("data-view-state", "unsaved");
  await page.getByRole("button", { name: tr(lang, "productivity.views.saveAs") }).click();
  await page.getByLabel(tr(lang, "productivity.views.name"), { exact: true }).fill(viewName);
  await page.getByLabel(tr(lang, "productivity.views.makeDefault")).check();
  await expectAccessible(page, lang, "p6-register-1000-save-view");
  await shot(page, lang, "p6-register-1000-save-view");
  await page.getByRole("button", { name: tr(lang, "productivity.views.saveSubmit") }).click();
  await expect(page.locator("[data-view-state]")).toHaveAttribute("data-view-state", "saved");
  // Share it so the auditor can apply it (TL holds saved_view.share).
  await page.locator("[data-view-action='share']").click();
  await expect(page.locator("[data-view-shared]")).toBeVisible();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(rowsOf(page)).toHaveCount(25);
  await expect(page.locator("[data-saved-view-select] option:checked")).toContainText(viewName);
  await expect(table.locator("thead")).not.toContainText(tr(lang, "portfolio.field.wave"));
  await expect(table.locator("thead")).toContainText(tr(lang, "portfolio.field.name"));
  await expectAccessible(page, lang, "p6-register-1000-view");
  await shot(page, lang, "p6-register-1000-view");

  // Contextual help of the list screen.
  await page.locator("[data-help='lists'] [data-help-toggle]").click();
  await expect(page.locator("[data-help-topic='lists.saved_views']")).toBeVisible();
  await expectAccessible(page, lang, "p6-register-1000-help");
  await shot(page, lang, "p6-register-1000-help");
  expect(foreign).toEqual([]);
  await lead.req.dispose();
  console.log(`register ${lang}: ${Date.now() - started} ms`);
});

test("the auditor applies the shared view and is offered no write; global search shows its designed states", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const started = Date.now();
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET" && new URL(req.url()).pathname.startsWith("/api/v1/saved-views")) writes.push(req.url());
  });
  await signIn(page, lang, "dev.auditor");
  await page.goto(`/transformations/${tid}/portfolio`);
  await expect(rowsOf(page)).toHaveCount(25);
  await expect(page.locator("[data-view-readonly]")).toHaveText(tr(lang, "productivity.views.applyOnly"));
  await expect(page.locator("[data-view-action]")).toHaveCount(0);
  const select = page.locator("[data-saved-view-select]");
  const option = select.locator("option", { hasText: viewName });
  await select.selectOption({ value: (await option.getAttribute("value"))! });
  const table = page.locator("[data-register='initiatives'] table");
  await expect(table.locator("thead")).not.toContainText(tr(lang, "portfolio.field.wave"));
  await expectAccessible(page, lang, "p6-register-1000-auditor");
  await shot(page, lang, "p6-register-1000-auditor");
  expect(writes).toEqual([]);

  // Global search from the header (the index is maintained by the worker, which this stack does not run: the page
  // shows whatever the API answers, including its stale state, and never claims "nothing exists" while stale).
  const box = page.getByRole("search", { name: tr(lang, "productivity.search.globalLabel") });
  await box.getByLabel(tr(lang, "productivity.search.queryLabel")).fill("x");
  await box.getByRole("button", { name: tr(lang, "productivity.search.globalLabel") }).click();
  await expect(box.getByRole("alert")).toHaveText(tr(lang, "problems.search__query_too_short"));
  await box.getByLabel(tr(lang, "productivity.search.queryLabel")).fill("register item");
  await box.getByRole("button", { name: tr(lang, "productivity.search.globalLabel") }).click();
  await expect(page.getByRole("heading", { level: 1, name: tr(lang, "productivity.search.title") })).toBeVisible();
  await expect(
    page.locator("[data-results], [data-state='empty'], [data-state='empty-stale'], [data-state='error']").first(),
  ).toBeVisible();
  await expectAccessible(page, lang, "p6-search");
  await shot(page, lang, "p6-search");

  // Cleanup: the lead deletes the view (If-Match), so later specs of the same stack start without it.
  const lead = await apiSession(playwright, "dev.lead");
  const views = await lead.call<{ items: { id: string; name: string; version: number }[] }>(
    "GET",
    `/api/v1/saved-views?listKey=initiatives&transformationId=${tid}`,
  );
  for (const v of views.items.filter((x) => x.name === viewName)) {
    const res = await lead.req.fetch(`/api/v1/saved-views/${v.id}`, {
      method: "DELETE",
      headers: { "If-Match": `"${v.version}"`, "X-CSRF-Token": await csrf(lead) },
    });
    expect(res.status(), `DELETE view: ${await res.text()}`).toBe(200);
  }
  await lead.req.dispose();
  console.log(`auditor+search ${lang}: ${Date.now() - started} ms`);
});

async function csrf(session: Awaited<ReturnType<typeof apiSession>>): Promise<string> {
  const me = (await (await session.req.get("/api/v1/me")).json()) as { csrfToken: string };
  return me.csrfToken;
}
