// qa-verifier DG6 round 3 (T-DG6-REV-QA-R3): the round-2 probe zz-qa-dg6r2-demo-keyboard.spec.ts re-run on candidate aa219bd2, unchanged except for its names (dg6r2 -> dg6r3).
// qa-verifier DG6 round 2 (T-DG6-REV-QA-R2; the round-1 probe re-run unchanged except for its names)
// Originally: qa-verifier DG6 round 1 probe (T-DG6-REV-QA-R1), NOT part of the candidate. Copied into a disposable copy as
// e2e/zz-qa-dg6r3-demo-keyboard.spec.ts and run inside e2e/support/with-demo-stack.sh (the walkthrough answers only in a
// demo database).
// REQ-S15-012 clause 2 "the guided walkthrough can be completed by keyboard alone". The candidate proves steps 1 and 10
// by keyboard (p6-walkthrough-keyboard.spec.ts); the register notes say the other ten were never completed by keyboard
// in a test. This probe goes beyond: for EACH of the twelve step links of the seeded demo transformation, the link is
// reached by Tab and opened with Enter, and on the step's native screen
//   (a) every visible, enabled interactive control in <main> is reached by Tab (no keyboard-unreachable control),
//   (b) every Tab stop in <main> shows a visible focus indicator,
//   (c) no element in <main> is click-only (cursor: pointer, not focusable, not inside a focusable control).
// It does not perform every step's business action (some need another role's synthetic approval); it proves that each
// step's screen is operable by keyboard. Everything is SYNTHETIC; nothing approves anything real (no G1-G6 business
// approval) and nothing here relates to DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { langOf, signIn } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(1_800_000);
const OUT = process.env["QA_PROBE_OUT"] ?? "test-results/qa-dg6r3";

/** The skip link is the first Tab stop; Enter moves the focus start into main. */
async function skipToMain(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.locator("body").focus().catch(() => undefined);
  await page.keyboard.press("Tab");
  const isSkip = await page.evaluate(() => {
    const el = document.activeElement as HTMLAnchorElement | null;
    return !!el && el.tagName === "A" && (el.getAttribute("href") ?? "").startsWith("#");
  });
  if (isSkip) await page.keyboard.press("Enter");
  return isSkip;
}

async function auditKeyboard(page: Page, maxTabs = 250) {
  // Tag every candidate control in main.
  const controls = await page.evaluate(() => {
    const main = document.querySelector("main#main")!;
    const sel =
      "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=switch], [role=menuitem], [tabindex]";
    const out: { idx: number; desc: string; tabbable: boolean }[] = [];
    let i = 0;
    for (const el of Array.from(main.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none") continue;
      if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
      if (el.closest("[inert]")) continue;
      const roving = el.getAttribute("tabindex") === "-1" && !!el.closest("[role=tablist],[role=radiogroup],[role=grid],[role=menu],[role=listbox]");
      if (roving) continue;
      el.setAttribute("data-qa-kb", String(i));
      out.push({
        idx: i,
        desc: `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""} "${(el.getAttribute("aria-label") ?? el.innerText ?? (el as HTMLInputElement).name ?? "").trim().slice(0, 50)}"`,
        tabbable: el.tabIndex >= 0,
      });
      i++;
    }
    return out;
  });
  const clickOnly = await page.evaluate(() => {
    const main = document.querySelector("main#main")!;
    const res: string[] = [];
    for (const el of Array.from(main.querySelectorAll<HTMLElement>("*"))) {
      if (getComputedStyle(el).cursor !== "pointer") continue;
      if (el.closest("a[href],button,input,select,textarea,summary,label,[tabindex]:not([tabindex='-1']),[role=button],[role=tab],[role=link]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      res.push(`${el.tagName.toLowerCase()}.${el.className} "${(el.innerText ?? "").trim().slice(0, 40)}"`);
    }
    return res;
  });
  // Enter main through the skip link (the first Tab stop of every screen), then Tab through main until focus leaves it.
  await skipToMain(page);
  const visited = new Set<number>();
  const noFocusRing: string[] = [];
  let leftMainAfterEntering = 0;
  let enteredMain = false;
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        inMain: !!el.closest("main#main"),
        idx: el.getAttribute("data-qa-kb"),
        ring: (cs.outlineStyle !== "none" && cs.outlineWidth !== "0px") || cs.boxShadow !== "none",
        desc: `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.innerText ?? "").trim().slice(0, 40)}"`,
      };
    });
    if (!s) continue;
    if (s.inMain) {
      enteredMain = true;
      if (s.idx !== null) visited.add(Number(s.idx));
      if (!s.ring) noFocusRing.push(s.desc);
    } else if (enteredMain) {
      leftMainAfterEntering++;
      if (leftMainAfterEntering > 1) break;
    }
  }
  // Controls placed BEFORE the skip target (the breadcrumbs above the h1) are reached by Shift+Tab from it.
  if (controls.some((c) => !visited.has(c.idx))) {
    await skipToMain(page);
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Shift+Tab");
      const s = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return {
          inMain: !!el.closest("main#main"),
          idx: el.getAttribute("data-qa-kb"),
          ring: (cs.outlineStyle !== "none" && cs.outlineWidth !== "0px") || cs.boxShadow !== "none",
          desc: `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.innerText ?? "").trim().slice(0, 40)}"`,
        };
      });
      if (!s || !s.inMain) break;
      if (s.idx !== null) visited.add(Number(s.idx));
      if (!s.ring) noFocusRing.push(s.desc);
    }
  }
  const unreachable = controls.filter((c) => !visited.has(c.idx)).map((c) => `${c.desc}${c.tabbable ? "" : " (tabIndex<0)"}`);
  return { controls: controls.length, visited: visited.size, unreachable, noFocusRing: [...new Set(noFocusRing)], clickOnly };
}

test("REQ-S15-012: every walkthrough step screen is operable by keyboard alone (demo database)", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "roaming.user.to"); // the demo role user of the seeded International Roaming dataset (D-165)
  const env = (await (await page.request.get("/api/v1/environment")).json()) as { synthetic?: boolean };
  expect(env.synthetic, "this probe needs the demo stack").toBe(true);
  await page.goto("/walkthrough");
  const picker = page.locator("[data-filter='walkthrough-transformation']");
  await expect(picker).toBeVisible();
  // The seeded demo transformation (the roaming example): the first non-empty option of the demo TO.
  const tId = await picker.locator("option").evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => o.value).find((v) => v) ?? "");
  expect(tId).not.toBe("");
  const results: Record<string, unknown>[] = [];
  const problems: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.goto(`/walkthrough?transformationId=${tId}`);
    const links = page.locator("[data-step-link]");
    await expect(links).toHaveCount(12, { timeout: 30_000 });
    const link = links.nth(i);
    const code = (await link.getAttribute("data-step-link")) ?? `step-${i + 1}`;
    // Reach the link by Tab (from the skip link into main) and open it with Enter.
    await skipToMain(page);
    let reached = false;
    for (let t = 0; t < 150 && !reached; t++) {
      await page.keyboard.press("Tab");
      reached = await link.evaluate((el) => el === document.activeElement);
    }
    if (!reached) {
      problems.push(`${code}: step link not reachable by Tab`);
      continue;
    }
    const before = page.url();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.url(), { timeout: 30_000 }).not.toBe(before);
    // Attempt 2 of this probe audited the walkthrough page itself once (the URL changed before the DOM): wait until the
    // walkthrough's step list is gone and the step screen's h1 is shown.
    await expect(page.locator("[data-step-link]")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    const a = await auditKeyboard(page);
    results.push({ step: i + 1, code, url: new URL(page.url()).pathname, ...a });
    for (const u of a.unreachable) problems.push(`${code} ${new URL(page.url()).pathname}: unreachable ${u}`);
    for (const n of a.noFocusRing) problems.push(`${code}: no visible focus on ${n}`);
    for (const c of a.clickOnly) problems.push(`${code}: click-only ${c}`);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, `walkthrough-keyboard-${lang}.partial.json`), JSON.stringify({ tId, results, problems }, null, 1));
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `walkthrough-keyboard-${lang}.json`), JSON.stringify({ tId, results, problems }, null, 1));
  console.log(`WALKTHROUGH-KB ${lang}: ${results.length} step screens; problems ${JSON.stringify(problems)}`);
  expect(results).toHaveLength(12);
  expect(problems).toEqual([]);
});
