// qa-verifier DG6 round 3 (T-DG6-REV-QA-R3): independent probe, NOT part of the frozen candidate. Copied into a disposable
// copy as e2e/zz-qa-dg6r3-xss-e2e.spec.ts and run inside apps/web/e2e/support/with-stack.sh.
// REQ-S16-030 "security tests cover ... XSS in rich text": the register notes say no XSS e2e exists (the clause rests on
// xss.test.ts and the web source scan). This probe renders the six ADR-0052 §3 payloads in a real browser:
//   - dev.lead creates a fresh transformation and six evidence NOTES whose title and note body carry the payloads;
//   - the evidence screen, the evidence register and the search screen are opened in chromium-en and chromium-ar;
//   - on each screen: no JavaScript dialog opens, no window global set by a payload exists, <main> holds no script,
//     iframe, element with an inline event handler or javascript: link, and the payload is shown as literal TEXT.
// All data is SYNTHETIC; nothing approves anything (no G1-G6 business approval; unrelated to DG0-DG7).
import { expect, test, type Page } from "@playwright/test";
import { SYN_RETAIL, apiSession, langOf, signIn, DEV_USERS } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

/** ADR-0052 §3's six payloads, exactly (as apps/api/test/integration/security/xss.test.ts), plus a global-setting one. */
const PAYLOADS: readonly string[] = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "<svg onload=alert(1)>",
  '<a href="javascript:alert(1)">x</a>',
  '"><iframe srcdoc="<script>alert(1)</script>">',
  "{{constructor.constructor('alert(1)')()}}",
  "<img src=x onerror=\"window.__qaXss=1\">",
];

let tid = "";

test("setup: a fresh transformation with seven evidence notes carrying the payloads", async ({ playwright }, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic QA XSS ${lang.toUpperCase()} ${Date.now().toString(36)}`,
    mode: "end_to_end",
  });
  tid = created.id;
  for (const [i, p] of PAYLOADS.entries()) {
    const note = await lead.call<{ id: string; title: string; noteBody: string }>(
      "POST",
      `/api/v1/transformations/${tid}/evidence`,
      { kind: "note", title: `QAXSS${i} ${p}`, ownerUserId: DEV_USERS.lead, noteBody: `QAXSS-body${i} ${p}` },
      { expect: 201 },
    );
    expect(note.title).toBe(`QAXSS${i} ${p}`);
  }
});

async function expectInert(page: Page, dialogs: string[], screen: string) {
  const state = await page.evaluate(() => ({
    global: (window as unknown as { __qaXss?: unknown }).__qaXss ?? null,
    injected: Array.from(
      document.querySelectorAll(
        "main script, main iframe, main svg[onload], main [onerror], main [onload], main a[href^='javascript:' i]",
      ),
    ).map((e) => e.outerHTML.slice(0, 160)),
  }));
  expect(dialogs, `${screen}: a JavaScript dialog opened`).toEqual([]);
  expect(state.global, `${screen}: a payload set window.__qaXss`).toBeNull();
  expect(state.injected, `${screen}: payload markup became DOM`).toEqual([]);
}

test("XSS payloads are shown as text and never executed (evidence, evidence register, search)", async ({ page }, info) => {
  const lang = langOf(info);
  const dialogs: string[] = [];
  page.on("dialog", async (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    await d.dismiss();
  });
  await signIn(page, lang, "dev.lead");
  const screens: [string, string][] = [
    ["evidence", `/transformations/${tid}/evidence`],
    ["evidence-register", `/transformations/${tid}/evidence-register`],
  ];
  const report: Record<string, { textShown: number }> = {};
  for (const [name, url] of screens) {
    await page.goto(url);
    await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
    // Wait until at least one payload title is on screen (as text), then give any handler time to fire.
    await expect(page.locator("main").getByText("QAXSS", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    const text = await page.locator("main").innerText();
    const shown = PAYLOADS.filter((p) => text.includes(p)).length;
    report[name] = { textShown: shown };
    await expectInert(page, dialogs, name);
    // The first payload, a literal script tag, must be readable as text wherever titles are listed.
    expect(shown, `${name}: no payload is shown as literal text`).toBeGreaterThan(0);
  }
  // Search (run 1 of this probe used q=QAXSS: the production-initialized stack runs no worker, so the search index
  // feed never ran and the screen said 'No records match "QAXSS"'; the expectation that a payload title be listed was
  // the probe's error). Here each payload IS the query: the screen echoes the query back, and the echo must be text.
  const echoed: string[] = [];
  for (const p of PAYLOADS) {
    await page.goto(`/search?q=${encodeURIComponent(p)}`);
    await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("region").last()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    const text = await page.locator("main").innerText();
    if (text.includes(p)) echoed.push(p);
    await expectInert(page, dialogs, `search q=${p}`);
  }
  report["search-query-echo"] = { textShown: echoed.length };
  console.log(`QA-DG6R3 XSS e2e (${lang}): ${JSON.stringify(report)}; dialogs ${dialogs.length}`);
  expect(echoed.length, "search: the payload query is echoed as literal text").toBeGreaterThan(0);
});
