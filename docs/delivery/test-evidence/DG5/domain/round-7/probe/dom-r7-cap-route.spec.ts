// domain-reviewer DG5 round-7 probe (D-181 scope; T-DG5-REV-DOM-R7C). Disposable clone only (copied to <clone>/probe/).
// The pre-existing helper fetchAllPages (apps/web/src/api/queries.ts:104-119) follows at most 20 pages of
// PAGINATION.maxLimit (100) and then stops with no error. It still feeds transformation lists that wave AB2 did not move
// to useAllTransformations: the executive overview's "Transformation" filter (traceability/api.ts:330
// useReadableTransformations) and the organization Finance validation queue (benefits/api.ts:311).
// Method: the browser's GET /api/v1/transformations list is answered by a route handler that serves the REAL items the
// API returns, followed by SYNTHETIC filler rows (cloned from a real row with new ids), 100 per page with a nextCursor,
// TOTAL rows in all. Per-transformation finance-queue requests for synthetic ids get an empty page. The probe then
// counts what the screen offers or queries, and looks for any notice that the list is incomplete. EN and AR.
// SYNTHETIC data only; nothing here approves anything real; G1-G6 never relate to DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, langOf, signIn } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["PROBE_OUT"]!;
const TOTAL = Number(process.env["CAP_TOTAL"] ?? "2150");
type Row = Record<string, unknown> & { id: string; code: string; name: string };

const record = (name: string, data: unknown) => {
  mkdirSync(join(OUT, "cap"), { recursive: true });
  writeFileSync(join(OUT, "cap", `${name}.json`), JSON.stringify(data, null, 1));
};
const shot = async (page: Page, lang: string, name: string) => {
  mkdirSync(join(OUT, "shots", lang), { recursive: true });
  await page.screenshot({ path: join(OUT, "shots", lang, `${name}.png`), fullPage: false });
};
const synthId = (i: number) => `0192ffff-0000-7000-9000-${String(i).padStart(12, "0")}`;

async function realRows(playwright: Parameters<typeof apiSession>[0], user: string): Promise<Row[]> {
  const s = await apiSession(playwright, user);
  const out: Row[] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ sort: "code:asc", limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const p: { items: Row[]; nextCursor: string | null } = await s.call("GET", `/api/v1/transformations?${q}`);
    out.push(...p.items);
    cursor = p.nextCursor;
  } while (cursor);
  return out;
}

/** Installs the list route; returns the full row set it serves and a log of the pages served. */
async function installRoute(page: Page, real: Row[]) {
  const template = real[0]!;
  const rows: Row[] = [...real];
  for (let i = rows.length; i < TOTAL; i++)
    rows.push({ ...template, id: synthId(i), code: `ZZSYN-${String(i).padStart(5, "0")}`, name: `Synthetic cap filler ${i}` });
  const served: number[] = [];
  await page.route(
    (url) => url.pathname === "/api/v1/transformations",
    async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const u = new URL(route.request().url());
      const off = Number(u.searchParams.get("cursor") ?? "0");
      const lim = Math.min(Number(u.searchParams.get("limit") ?? "50"), 100);
      served.push(off);
      const items = rows.slice(off, off + lim);
      const next = off + lim < rows.length ? String(off + lim) : null;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, nextCursor: next }) });
    },
  );
  await page.route(/\/api\/v1\/transformations\/0192ffff-[^/]+\/finance-validations/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: null }) }),
  );
  return { rows, served };
}

test("executive overview: the Transformation filter with more than 2000 readable transformations", async ({ page, playwright }, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  const real = await realRows(playwright, "dev.office");
  await signIn(page, lang, "dev.office");
  const { rows, served } = await installRoute(page, real);
  await page.goto("/executive-overview");
  const sel = page.locator("select[data-filter='transformation']").first();
  await expect(sel).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => sel.locator("option").count(), { timeout: 60_000 }).toBeGreaterThan(1000);
  await page.waitForTimeout(2000);
  const offered = (await sel.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).filter(Boolean);
  const hint = await page.locator("[id$='-tr-hint']").first().innerText();
  const notes = await page.locator("[role='alert'], [role='note'], .banner").allInnerTexts();
  const missing = rows.filter((r) => !offered.includes(r.id)).map((r) => r.code);
  const result = {
    lang,
    dir: await page.locator("html").getAttribute("dir"),
    servedTotal: rows.length,
    realRows: real.length,
    pagesRequested: served.length,
    offered: offered.length,
    missingCount: missing.length,
    missingFirst: missing.slice(0, 5),
    missingLast: missing.slice(-3),
    hint,
    notes,
  };
  record(`${lang}-executive-overview-filter`, result);
  await shot(page, lang, "r7-cap-executive-overview-filter");
  expect(result.dir).toBe(lang === "ar" ? "rtl" : "ltr");
  // The defect assertion: every readable transformation is offered (or the screen says the list is incomplete).
  expect({ missingCount: result.missingCount }).toEqual({ missingCount: 0 });
});

test("finance validation queue: transformations whose queues are read, with more than 2000 readable transformations", async ({ page, playwright }, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  const real = await realRows(playwright, "dev.office");
  await signIn(page, lang, "dev.office");
  const { rows, served } = await installRoute(page, real);
  const queued = new Set<string>();
  page.on("request", (r) => {
    const m = /\/api\/v1\/transformations\/([0-9a-f-]{36})\/finance-validations/.exec(r.url());
    if (m) queued.add(m[1]!);
  });
  await page.goto("/finance-validation");
  await expect(page.locator("#finance-queue")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => queued.size, { timeout: 120_000 }).toBeGreaterThan(1000);
  await expect(page.locator("#finance-queue").getByText(/Loading|جارٍ التحميل|جار التحميل/)).toHaveCount(0, { timeout: 120_000 });
  await page.waitForTimeout(2000);
  const notArchived = rows.filter((r) => r["archivedAt"] === null || r["archivedAt"] === undefined);
  const missing = notArchived.filter((r) => !queued.has(r.id)).map((r) => r.code);
  const notes = await page.locator("#finance-queue [role='alert'], #finance-queue [role='note'], #finance-queue .banner").allInnerTexts();
  const result = {
    lang,
    dir: await page.locator("html").getAttribute("dir"),
    servedTotal: rows.length,
    realRows: real.length,
    pagesRequested: served.length,
    queuesRead: queued.size,
    missingCount: missing.length,
    missingFirst: missing.slice(0, 5),
    missingLast: missing.slice(-3),
    notes,
  };
  record(`${lang}-finance-validation-queue`, result);
  await shot(page, lang, "r7-cap-finance-validation-queue");
  expect(result.dir).toBe(lang === "ar" ? "rtl" : "ltr");
  expect({ missingCount: result.missingCount }).toEqual({ missingCount: 0 });
});
