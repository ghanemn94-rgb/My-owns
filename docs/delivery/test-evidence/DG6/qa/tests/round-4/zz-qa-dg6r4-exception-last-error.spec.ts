// qa-verifier DG6 round 4 (T-DG6-REV-QA-R4): independent probe, NOT part of the frozen candidate. Copied into a
// disposable clone as e2e/zz-qa-dg6r4-exception-last-error.spec.ts and run LAST in the root acceptance run on
// apps/web/e2e/support/with-stack.sh (after a17-failing-connector-exception and a22-p6-operability have opened a
// connector exception and a heartbeat_missed exception on the same stack).
// Question (D-211 open question 1, and the F-DG6-221 repair in OperationsPages.tsx): what does "Last error" show, in en
// and ar, for each distinct lastErrorCode of the operational exceptions on this stack? FE-Z2 shows the catalogue text of
// the code (integrations.actionable.<code>.why, else problems.<code>) and, WITHOUT a catalogue text, the code itself.
// Recorded, not asserted beyond "the page renders and the value is never the server's English lastErrorMessage in ar".
// SYNTHETIC data only; nothing approves anything (no G1-G6 business approval; unrelated to DG0-DG7).
import { expect, test } from "@playwright/test";
import { apiSession, langOf, signIn, tr } from "../apps/web/e2e/support/ui.ts";

test.setTimeout(180_000);

type Body = Record<string, unknown>;

test("operational exception 'Last error' text per lastErrorCode, en and ar", async ({ page, playwright }, info) => {
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  // listOperationalExceptions requires organizationId (round-4 first run of this probe omitted it: a 400, probe defect).
  const me = await admin.call<Body>("GET", "/api/v1/me");
  const orgId = String((me["organization"] as Body | undefined)?.["id"] ?? "");
  const list = await admin.call<{ items: Body[] }>("GET", `/api/v1/admin/operations/exceptions?organizationId=${orgId}&limit=100`);
  const byCode = new Map<string, Body>();
  for (const x of list.items) if (!byCode.has(String(x.lastErrorCode))) byCode.set(String(x.lastErrorCode), x);
  console.log(`QA-R4 EXCEPTIONS ${lang}: ${list.items.length} exceptions; codes ${JSON.stringify([...byCode.keys()])}`);
  await signIn(page, lang, "dev.admin");
  const label = tr(lang, "adminP6.operations.lastError");
  for (const [code, x] of byCode) {
    await page.goto(`/admin/operations/exceptions/${String(x.id)}`);
    await expect(page.locator("main#main h1")).toBeVisible();
    const dd = page.locator("main#main dt", { hasText: label }).first().locator("xpath=following-sibling::dd[1]");
    await expect(dd).toBeVisible();
    const shown = ((await dd.textContent()) ?? "").trim();
    const hasText = (await dd.locator("[data-error-text]").count()) === 1;
    console.log(
      `QA-R4 LAST-ERROR ${lang}: code=${code} failureClass=${String(x.failureClass)} shown=${JSON.stringify(shown)} ` +
        `catalogueText=${hasText} serverMessage=${JSON.stringify(String(x.lastErrorMessage))}`,
    );
    if (lang === "ar") expect(shown, "never the server's English message in ar").not.toBe(String(x.lastErrorMessage));
    await page.screenshot({ path: `${process.env["E2E_SCREENSHOT_DIR"] ?? "."}/qa-r4-exception-${lang}-${code}.png` });
  }
  expect(byCode.size).toBeGreaterThan(0);
});
