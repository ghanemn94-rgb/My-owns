// The Diagnose screen reflows at 390 px and with 200 % text (T-DG5-FE-Y1, D-174; F-DG5-144, REQ-S15-009, REQ-S15-012
// WCAG 2.1 SC 1.4.10), against the REAL API, in chromium-en and chromium-ar. It is the qa-verifier's round-3
// reproduction (docs/delivery/test-evidence/DG5/qa/tests/round-3/e2e/zz-qa-dg5r3-diagnose-reflow.spec.ts, R3-DIAG;
// read, not imported) turned into a product test: it opens /transformations/<T>/diagnose at 390 x 900, and at
// 1280 x 900 with the root font at 200 %, and asserts that
//  - the page does not scroll horizontally (document.documentElement.scrollWidth - innerWidth <= 1);
//  - every workstream card (article.workstream) fits the viewport;
//  - every table region in a workstream card is a keyboard-focusable (tabIndex 0), named region (role=region and a
//    non-empty localized aria-label), so a wide register scrolls inside its own region, not the page.
// Set-up check (so the test cannot pass trivially): at 390 px at least one workstream register really scrolls
// horizontally inside its region; that is the condition of the finding (the Customer register's min-content sized
// every card).
// Two stacks, one spec (no skipped test on either):
//  - the DEMO stack (e2e/support/with-demo-stack.sh; GET /environment answers `synthetic: true`): the SYNTHETIC
//    International Roaming transformation, signed in as `roaming.user.tl`, as the qa reproduction did;
//  - the production-marked stack (apps/web/e2e/support/with-stack.sh): a transformation this spec creates, with two
//    SYNTHETIC findings in its first workstream, signed in as the SYNTHETIC `dev.lead`.
// It collects every measurement first and then asserts once, so the failure names each failing case.
//
// The same pattern elsewhere (D-174): the optimistic-concurrency conflict banner (.conflict, components/States.tsx and
// RecordForm.tsx) is also a grid with one implicit `auto` track whose item is a table (the compare table, with
// no-wrap column headers), so at 390 px the table's min-content sized the track and the page scrolled sideways. The
// second test makes a real 409 on the transformation edit form at 390 px (a concurrent change through the real API,
// as journeys.spec.ts does) and asserts the same: no page-level horizontal scroll, and the banner and its compare
// table fit the viewport. Nothing here approves anything real, and nothing touches the engineering delivery gates
// DG0-DG7.
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { apiSession, BASE, fieldLabel, langOf, shot, SHOTS, signIn, SYN_RETAIL, tr } from "./support/ui.ts";

const ROAMING = "01995000-0000-7000-8000-000000000001";

interface Measure {
  W: number;
  pageOverflow: number;
  cards: { code: string; left: number; right: number }[];
  regions: { where: string; tabIndex: number; role: string | null; name: string; scrolls: boolean }[];
}

test("Diagnose: no page-level horizontal scroll at 390 px or with 200 % text; every workstream card fits the viewport and its register scrolls in a focusable, named region", async ({
  browser,
  playwright,
}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  const devLead = await apiSession(playwright, "dev.lead");
  const demo = (await devLead.call<{ synthetic: boolean }>("GET", "/api/v1/environment")).synthetic === true;
  let T = ROAMING;
  if (!demo) {
    T = (
      await devLead.call<{ id: string }>("POST", "/api/v1/transformations", {
        businessUnitId: SYN_RETAIL,
        name: `Synthetic diagnose reflow ${lang.toUpperCase()} ${Date.now()}`,
        mode: "end_to_end",
      })
    ).id;
    const base = `/api/v1/transformations/${T}`;
    const methodology = await devLead.call<{ diagnosticWorkstreams: { code: string }[] }>("GET", `${base}/methodology`);
    for (const statement of [
      "Synthetic: order fallout between the CRM and billing hand-off",
      "Synthetic: roaming bill shock complaints from postpaid customers",
    ])
      await devLead.call("POST", `${base}/diagnostic-findings`, {
        workstreamCode: methodology.diagnosticWorkstreams[0]!.code,
        kind: "root_cause",
        statement,
        status: "confirmed",
      });
  }

  const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await context.newPage();
  await signIn(page, lang, demo ? "roaming.user.tl" : "dev.lead");

  const failures: string[] = [];
  const report: string[] = [];
  for (const [label, width, font] of [
    ["390 px", 390, 0],
    ["200 % text", 1280, 200],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/transformations/${T}/diagnose`);
    await expect(page.locator("main#main h1")).toBeVisible();
    await expect(page.locator("article.workstream").first()).toBeVisible();
    if (font) await page.evaluate((f) => (document.documentElement.style.fontSize = `${f}%`), font);
    await page.waitForLoadState("networkidle");
    const states = page
      .locator("main [data-state='no-permission'], main [data-state='error']")
      .filter({ visible: true });
    if ((await states.count()) > 0)
      failures.push(`${label} — set-up: the screen shows ${await states.first().getAttribute("data-state")}`);
    const m: Measure = await page.evaluate(() => {
      const W = window.innerWidth;
      return {
        W,
        pageOverflow: document.documentElement.scrollWidth - W,
        cards: Array.from(document.querySelectorAll<HTMLElement>("article.workstream")).map((a) => {
          const r = a.getBoundingClientRect();
          return { code: a.dataset["workstream"] ?? "?", left: Math.round(r.left), right: Math.round(r.right) };
        }),
        regions: Array.from(document.querySelectorAll<HTMLElement>("article.workstream .table-wrap")).map((el) => ({
          where: `${el.closest("article.workstream")?.getAttribute("data-workstream") ?? "?"}: ${el.querySelector("caption")?.textContent?.trim() ?? "(no caption)"}`,
          tabIndex: el.tabIndex,
          role: el.getAttribute("role"),
          name: (el.getAttribute("aria-label") ?? "").trim(),
          scrolls: el.scrollWidth > el.clientWidth + 1,
        })),
      };
    });
    if (m.pageOverflow > 1) failures.push(`${label} — the page scrolls ${m.pageOverflow} px horizontally`);
    if (m.cards.length === 0) failures.push(`${label} — set-up: no workstream card rendered`);
    for (const c of m.cards)
      if (c.left < -1 || c.right > m.W + 1)
        failures.push(
          `${label} — workstream card ${c.code} runs off the viewport [${c.left}..${c.right}] of ${m.W} px`,
        );
    for (const r of m.regions)
      if (r.tabIndex !== 0 || r.role !== "region" || r.name === "")
        failures.push(
          `${label} — bare table wrapper ${r.where} (tabIndex ${r.tabIndex}, role ${r.role ?? "none"}, name ${JSON.stringify(r.name)})`,
        );
    const scrolling = m.regions.filter((r) => r.scrolls).length;
    if (width === 390 && scrolling === 0)
      failures.push(`${label} — set-up: no workstream register scrolls inside its region (the finding's condition)`);
    report.push(
      `${label}: overflow ${m.pageOverflow} px, ${m.cards.length} card(s), ${m.regions.length} region(s), ${scrolling} scrolling`,
    );
    const tag = width === 390 ? "390" : "200pct";
    await shot(page, lang, `y1-diagnose-reflow-${tag}`);
    // The card whose register scrolls (the finding's widest card), captured on its own as visual evidence.
    const wide = page.locator("article.workstream", { has: page.locator(".table-wrap") }).first();
    mkdirSync(join(SHOTS, lang), { recursive: true });
    await wide.screenshot({ path: join(SHOTS, lang, `y1-diagnose-reflow-${tag}-card.png`) });
  }
  await context.close();
  console.info(`Diagnose reflow ${lang} (${demo ? "demo" : "production-marked"} stack): ${report.join("; ")}`);
  expect(failures).toEqual([]);
});

test("Conflict banner: a 409 at 390 px shows its compare table without page-level horizontal scroll", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const T = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic conflict reflow ${lang.toUpperCase()} ${Date.now()}`,
      mode: "end_to_end",
    })
  ).id;
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${T}/edit`);
  const name = page.getByLabel(fieldLabel(lang, "transformations.field.name"));
  await expect(name).toBeVisible();
  await name.fill(`Synthetic ${lang.toUpperCase()} conflict reflow (my edit)`);
  // Someone else saves first (same session cookie, through the real API with CSRF + If-Match).
  const me = await (await page.request.get("/api/v1/me")).json();
  const current = await (await page.request.get(`/api/v1/transformations/${T}`)).json();
  const other = await page.request.patch(`/api/v1/transformations/${T}`, {
    headers: { "X-CSRF-Token": me.csrfToken, "If-Match": `"${current.version}"`, Origin: BASE },
    data: { description: "Changed concurrently by another session (synthetic)" },
  });
  expect(other.status()).toBe(200);
  await page.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  const conflict = page.locator("[data-state='conflict']");
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText(tr(lang, "common.conflict.title"));
  // Set-up: the compare table is shown (it is the item that widened the track).
  await expect(conflict.locator("table tbody tr").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  const m = await page.evaluate(() => {
    const W = window.innerWidth;
    const box = (sel: string) => {
      const r = document.querySelector("[data-state='conflict'] " + sel)?.getBoundingClientRect();
      return r ? { left: Math.round(r.left), right: Math.round(r.right) } : null;
    };
    const b = document.querySelector("[data-state='conflict']")!.getBoundingClientRect();
    return {
      W,
      pageOverflow: document.documentElement.scrollWidth - W,
      banner: { left: Math.round(b.left), right: Math.round(b.right) },
      table: box("table"),
    };
  });
  const failures: string[] = [];
  if (m.pageOverflow > 1) failures.push(`390 px — the page scrolls ${m.pageOverflow} px horizontally`);
  for (const [what, r] of [
    ["conflict banner", m.banner],
    ["compare table", m.table],
  ] as const)
    if (!r || r.left < -1 || r.right > m.W + 1)
      failures.push(
        `390 px — the ${what} runs off the viewport ${r ? `[${r.left}..${r.right}]` : "(missing)"} of ${m.W} px`,
      );
  await shot(page, lang, "y1-conflict-reflow-390");
  console.info(`Conflict reflow ${lang}: ${JSON.stringify(m)}`);
  expect(failures).toEqual([]);
});
