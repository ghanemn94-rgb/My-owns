// qa-verifier DG6 clean re-gate round 1 (T-DG6-REV-QA-RG-R1): independent probe for REQ-S15-012 "the guided walkthrough
// can be completed by keyboard alone". The register notes disclose that the shipped keyboard spec performs steps 1 and 10
// only (the others are main journeys QA-D proved by keyboard). This probe extends the evidence to ALL TWELVE steps'
// native screens: from the walkthrough, each step link is opened with Enter (no click), and on the screen it opens:
//   - every visible, enabled control in main (button, link, input, select, textarea, [role=button|tab|checkbox|radio|
//     switch|combobox|menuitem]) is reached by sequential Tab from the skip link, each with a visible focus indicator;
//   - no visible element in main looks clickable (cursor: pointer) without being keyboard focusable (a mouse-only control).
// Kept outside the frozen candidate. Run on the DEMO stack from a DISPOSABLE clone (the walkthrough answers 409 elsewhere):
//   e2e/support/with-demo-stack.sh npx playwright test apps/web/e2e/zz-qa-rg-r1-walkthrough-keyboard-reach.spec.ts --workers=1
// Everything is SYNTHETIC; nothing approves anything real (G1-G6) or names DG0-DG7.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { langOf, shot, signIn, tr } from "./support/ui.ts";

test.setTimeout(900_000);
const OUT = process.env.E2E_SCREENSHOT_DIR ?? "test-results";

/** Every visible, enabled control in main, with a stable key, and the mouse-only suspects. */
async function controls(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main#main")!;
    const sel =
      "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=checkbox], [role=radio], [role=switch], [role=combobox], [role=menuitem], [tabindex]";
    const visible = (el: Element) => {
      const h = el as HTMLElement;
      const st = getComputedStyle(h);
      const r = h.getBoundingClientRect();
      return st.visibility !== "hidden" && st.display !== "none" && r.width > 0 && r.height > 0 && h.offsetParent !== null;
    };
    let n = 0;
    const out: { key: string; label: string; tabIndex: number }[] = [];
    for (const el of main.querySelectorAll(sel)) {
      const h = el as HTMLElement & { disabled?: boolean };
      if (!visible(h) || h.disabled || h.getAttribute("aria-disabled") === "true" || h.tabIndex < 0) continue;
      if (h.closest("[inert]")) continue;
      // Content of a CLOSED <details> is not in the tab order until its <summary> (itself a Tab stop) is opened with
      // Enter; the probe opens every summary by keyboard below and re-runs the inventory, so it is counted then.
      const closed = h.closest("details:not([open])");
      if (closed && !(h.tagName === "SUMMARY" && h.parentElement === closed)) continue;
      const key = `qa-k-${n++}`;
      h.setAttribute("data-qa-k", key);
      out.push({ key, label: (h.getAttribute("aria-label") ?? h.textContent ?? h.getAttribute("name") ?? h.tagName).trim().slice(0, 60), tabIndex: h.tabIndex });
    }
    const suspects: string[] = [];
    for (const el of main.querySelectorAll("*")) {
      const h = el as HTMLElement;
      if (!visible(h) || getComputedStyle(h).cursor !== "pointer") continue;
      if (h.matches(sel) || h.closest(sel) || h.tagName === "LABEL" || h.closest("label") || h.tagName === "SUMMARY" || h.closest("summary")) continue;
      suspects.push(`${h.tagName.toLowerCase()}.${(h.className || "").toString().slice(0, 40)}: ${(h.textContent ?? "").trim().slice(0, 40)}`);
    }
    return { controls: out, suspects };
  });
}

/** Tab from the skip link through the page (up to `max` stops) and collect the qa keys reached. */
async function tabSweep(page: Page, lang: "en" | "ar", max: number) {
  // The sweep starts at the skip link (the first Tab stop of a fresh screen, proven by the shipped keyboard spec); it is
  // focused directly because opening the <details> above moved the sequential focus starting point.
  const skip = page.getByRole("link", { name: tr(lang, "common.a11y.skipToContent"), exact: true });
  await skip.focus();
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  const reached = new Set<string>();
  const noRing: string[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        key: el.getAttribute("data-qa-k"),
        inMain: !!el.closest("main#main"),
        ring: (cs.outlineStyle !== "none" && cs.outlineWidth !== "0px") || cs.boxShadow !== "none",
        label: (el.getAttribute("aria-label") ?? el.textContent ?? el.tagName).trim().slice(0, 40),
      };
    });
    if (s === null) continue;
    if (s.key) reached.add(s.key);
    if (s.inMain && !s.ring) noRing.push(s.label);
    if (!s.inMain && reached.size > 0) break; // left main after visiting it: the sweep is complete
  }
  return { reached, noRing };
}

test("REQ-S15-012 probe: every walkthrough step's screen is fully operable by keyboard (demo database)", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.office");
  const env = (await (await page.request.get("/api/v1/environment")).json()) as { synthetic?: boolean };
  test.skip(env.synthetic !== true, "needs a DEMO database (with-demo-stack.sh)");
  // The demo's own transformation: the first one the walkthrough picker offers.
  await page.goto("/walkthrough");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "playbookP5.walkthrough.title"));
  const picker = page.locator("[data-filter='walkthrough-transformation']");
  await expect.poll(async () => picker.locator("option[value]:not([value=''])").count(), { timeout: 30_000 }).toBeGreaterThan(0);
  const first = await picker.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean)[0]);
  expect(first).toBeTruthy();
  const report: Record<string, unknown>[] = [];
  const failures: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.goto(`/walkthrough?transformationId=${first}`);
    const links = page.locator("[data-step-link]");
    await expect(links).toHaveCount(12);
    const step = (await links.nth(i).getAttribute("data-step-link")) ?? `step-${i + 1}`;
    await links.nth(i).focus();
    await page.keyboard.press("Enter");
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page.locator("main#main h1")).toBeVisible({ timeout: 30_000 });
    const url = new URL(page.url()).pathname + new URL(page.url()).search;
    // After an in-app navigation the shell keeps the focus start where the activated link was (shipped spec, FE-F2), so
    // the sweep starts from a fresh load of the step's screen, where the skip link is the first Tab stop.
    await page.goto(url);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page.locator("main#main h1")).toBeVisible({ timeout: 30_000 });
    // Open every closed <details> by keyboard (focus its summary, press Enter), so their content joins the sweep.
    for (let k = 0; k < 20; k++) {
      const summary = page.locator("main#main details:not([open]) > summary").first();
      if ((await summary.count()) === 0) break;
      await summary.focus();
      await page.keyboard.press("Enter");
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    const c = await controls(page);
    const sweep = await tabSweep(page, lang, Math.min(600, c.controls.length * 2 + 60));
    const missed = c.controls.filter((x) => !sweep.reached.has(x.key)).map((x) => x.label);
    report.push({ step, url, controls: c.controls.length, reached: sweep.reached.size, missed, suspects: c.suspects, noRing: sweep.noRing });
    if (missed.length > 0) failures.push(`${lang} ${step} ${url}: not reached by Tab: ${JSON.stringify(missed.slice(0, 10))}`);
    if (c.suspects.length > 0) failures.push(`${lang} ${step} ${url}: pointer-only elements: ${JSON.stringify(c.suspects.slice(0, 10))}`);
    if (sweep.noRing.length > 0) failures.push(`${lang} ${step} ${url}: focus without a visible indicator: ${JSON.stringify(sweep.noRing.slice(0, 10))}`);
    await shot(page, lang, `qa-rg-r1-walkthrough-step-${String(i + 1).padStart(2, "0")}-${step}`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `qa-rg-r1-walkthrough-keyboard-${lang}.json`), JSON.stringify({ report, failures }, null, 1));
  for (const r of report) console.log(`QA-RG-R1 keyboard ${lang} ${JSON.stringify({ step: r.step, url: r.url, controls: r.controls, reached: r.reached })}`);
  for (const f of failures) console.log(`QA-RG-R1 keyboard FAIL ${f}`);
  expect(failures).toEqual([]);
});
