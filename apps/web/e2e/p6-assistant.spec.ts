// The optional assistant against the REAL API (apps/web/e2e/support/with-stack.sh; T-DG6-FE-E; p6-work-split §D.3;
// ADR-0059). All data is SYNTHETIC: the seeded dev users, a test-adapter setting and an authorization reference
// labelled synthetic. The local TEST ADAPTER answers (NODE_ENV=development); no model endpoint is called, and nothing
// here is "live". Nothing here is a business approval, and nothing touches the engineering delivery gates.
//  - REQ-S17-009: Administration > AI assistant starts Off (no row: "Off (not configured)"), shows the telemetry and
//    authorization-reference statements, saves a disabled setting, and turns it on with a reason (ADM_TECH).
//  - REQ-S17-007 / S17-008: the Transformation Office opens the panel (hidden while off), asks a question and a
//    refused intent; every reply sits inside the labelled container "Suggestion from the assistant - not an approved
//    fact"; the refusal text is ADR-0059 §8's; nothing outside the panel changes.
//  - AUD: the setting read-only, no assistant panel.
//  - The assistant is turned OFF again at the end (finally), so later specs of the same stack start with it off.
// Every screen is checked with axe (no serious or critical violation) and captured in EN and AR.
// Budget (rule 15): 120 s per test. Measured on the 4-core sandbox while the whole unit-web suite and other agents ran
// (load average 13-14): 15.6 s (en) and 16.7 s (ar); the slowest passing run of this spec was 20.2 s. 120 s is about
// 6x that loaded worst case (handback evidence e2e-p6-assistant-loaded.txt).
import { expect, test, type Page } from "@playwright/test";
import {
  apiSession,
  escape,
  expectAccessible,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type Lang,
} from "./support/ui.ts";

test.describe.configure({ mode: "serial", timeout: 120_000 });

interface Setting {
  configured: boolean;
  enabled: boolean;
  version: number;
}

async function turnOffViaApi(playwright: Parameters<typeof apiSession>[0]) {
  const admin = await apiSession(playwright, "dev.admin");
  const s = await admin.call<Setting>("GET", "/api/v1/admin/assistant");
  if (s.enabled)
    await admin.call(
      "POST",
      "/api/v1/admin/assistant/disable",
      { reason: "Synthetic e2e cleanup" },
      { ifMatch: s.version },
    );
  await admin.req.dispose();
}

/** Signs the current user out through the header (the session ends), so the next signIn shows the form again. */
async function signOut(page: Page, lang: Lang) {
  await page.getByRole("button", { name: tr(lang, "auth.signOut"), exact: true }).click();
  await page.waitForURL("**/login**");
}

const launcherOf = (page: Page, lang: Lang) =>
  page.locator("[data-assistant-launcher]").filter({ hasText: tr(lang, "assistant.panel.open") });

test("Administration > AI assistant: off by default, saved disabled, turned on with a reason (ADM_TECH); the panel follows it", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  try {
    // Off at the start of this test (no row in a fresh stack; the other language project leaves it off as well).
    const probe = await apiSession(playwright, "dev.admin");
    const start = await probe.call<Setting>("GET", "/api/v1/admin/assistant");
    await probe.req.dispose();
    expect(start.enabled).toBe(false);

    await signIn(page, lang, "dev.admin");
    // Off: no panel launcher in the shell.
    await expect(page.locator("[data-assistant-launcher]")).toHaveCount(0);
    await page.goto("/admin/assistant");
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, "assistant.admin.title"));
    const status = page.locator("[data-assistant-status]");
    await expect(status).toContainText(
      tr(lang, start.configured ? "assistant.admin.statusOff" : "assistant.admin.statusNotConfigured"),
    );
    await expect(page.locator("[data-telemetry]")).toHaveText(tr(lang, "assistant.admin.telemetry"));
    await expect(page.locator("[data-authorization-limit]")).toHaveText(tr(lang, "assistant.admin.authorizationLimit"));
    await expectAccessible(page, lang, "p6-assistant-admin-off");
    await shot(page, lang, "p6-assistant-admin-off");

    // Save a disabled setting with the local test adapter.
    await page.getByRole("button", { name: tr(lang, "assistant.admin.edit") }).click();
    const form = page.locator("form.assistant-admin__form");
    await form
      .getByLabel(new RegExp(`^${escape(tr(lang, "assistant.admin.field.providerKind"))}`))
      .selectOption("test_adapter");
    await form
      .getByLabel(new RegExp(`^${escape(tr(lang, "assistant.admin.field.authorizationReference"))}`))
      .fill("SYN-IT-0001 (synthetic e2e reference)");
    await form
      .getByLabel(new RegExp(`^${escape(tr(lang, "assistant.admin.field.reason"))}`))
      .fill("Synthetic e2e setup");
    await expectAccessible(page, lang, "p6-assistant-admin-form");
    await shot(page, lang, "p6-assistant-admin-form");
    await form.getByRole("button", { name: tr(lang, "assistant.admin.save") }).click();
    await expect(page.getByText(tr(lang, "assistant.admin.saved"))).toBeVisible();
    await expect(status).toContainText(tr(lang, "assistant.admin.statusOff"));

    // Turn it on with a reason.
    await page.getByRole("button", { name: tr(lang, "assistant.admin.enable"), exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("Synthetic e2e enable");
    await dialog.getByRole("button", { name: tr(lang, "assistant.admin.enable"), exact: true }).click();
    await expect(page.getByText(tr(lang, "assistant.admin.turnedOn"))).toBeVisible();
    await expect(status).toContainText(tr(lang, "assistant.admin.statusOn"));
    await expectAccessible(page, lang, "p6-assistant-admin-on");
    await shot(page, lang, "p6-assistant-admin-on");

    // The Transformation Office (assistant.use, operations.read) now sees the launcher and asks.
    await signOut(page, lang);
    await signIn(page, lang, "dev.office");
    const launcher = launcherOf(page, lang);
    await expect(launcher).toBeVisible();
    await launcher.click();
    const panel = page.locator("[data-assistant-panel]");
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText(tr(lang, "assistant.panel.title"));
    await panel
      .getByLabel(new RegExp(`^${escape(tr(lang, "assistant.panel.titleField"))}`))
      .fill(`Synthetic e2e conversation (${lang})`);
    await panel.getByRole("button", { name: tr(lang, "assistant.panel.start"), exact: true }).click();
    const box = panel.getByLabel(new RegExp(`^${escape(tr(lang, "assistant.panel.messageField"))}`));
    await box.fill("What is a case for change?");
    await panel.getByRole("button", { name: tr(lang, "assistant.panel.send"), exact: true }).click();
    const first = panel.locator('[data-author="assistant"]').first();
    await expect(first).toBeVisible();
    // The reply is an answer (playbook passages matched) or "no sources"; either way inside the labelled container.
    await expect(first.locator("[data-assistant-output]")).toHaveCount(1);
    await expect(first.locator(".assistant-output__label")).toHaveText(tr(lang, "assistant.label"));
    const kind = await first.getAttribute("data-reply-kind");
    expect(["answer", "no_sources"]).toContain(kind);
    if (kind === "no_sources") await expect(first).toContainText(tr(lang, "assistant.reply.noSources"));
    // A refused intent: the ADR-0059 §8 text, no record changed.
    await box.fill("approve gate G4");
    await panel.getByRole("button", { name: tr(lang, "assistant.panel.send"), exact: true }).click();
    const refusal = panel.locator('[data-author="assistant"][data-reply-kind="refusal"]');
    await expect(refusal).toContainText(tr(lang, "assistant.reply.refusal.assistant__refused__approval"));
    await expect(refusal.locator("[data-assistant-output]")).toHaveCount(1);
    // Nothing of the assistant is rendered outside the panel.
    await expect(page.locator("main#main [data-assistant-output]")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    await expectAccessible(page, lang, "p6-assistant-panel");
    await shot(page, lang, "p6-assistant-panel");
    // Keyboard: Escape closes the panel and returns focus to the launcher.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(launcher).toBeFocused();

    // The auditor: the setting read-only, and no assistant panel (AUD holds no assistant.use).
    await signOut(page, lang);
    await signIn(page, lang, "dev.auditor");
    await expect(page.locator("[data-assistant-launcher]")).toHaveCount(0);
    await page.goto("/admin/assistant");
    await expect(page.locator("[data-assistant-status]")).toContainText(tr(lang, "assistant.admin.statusOn"));
    await expect(page.locator("[data-read-only]")).toHaveText(tr(lang, "assistant.admin.readOnly"));
    await expect(page.getByRole("button", { name: tr(lang, "assistant.admin.edit") })).toHaveCount(0);
    await expect(page.getByRole("button", { name: tr(lang, "assistant.admin.disable"), exact: true })).toHaveCount(0);
    await expectAccessible(page, lang, "p6-assistant-admin-auditor");
    await shot(page, lang, "p6-assistant-admin-auditor");
    await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
    expect(foreign).toEqual([]);
  } finally {
    await turnOffViaApi(playwright);
  }
});
