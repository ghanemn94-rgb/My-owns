// My procedures offers the launch form only to a user who may launch (T-DG5-FE-RG1, F-DG5-140; REQ-S06-002;
// ADR-0042 §4) on the REAL stack (support/with-stack.sh, AUTH_MODE=dev), chromium-en and chromium-ar. It is the
// qa-verifier's reproduction (docs/delivery/test-evidence/DG5/qa/tests/round-1/e2e/zz-qa-dg5rg1-aud-launch.spec.ts;
// read, not imported) turned into a product test:
//  1. dev.auditor (AUD, read-only) opens /playbook/procedures: the "Launch a procedure" section shows the read-only
//     note; no launch form, no procedure choice and no Launch button is offered (screen, axe, screenshot). The
//     server-side refusal stays the backstop: the same launch sent through the API as the auditor is 403, and no
//     procedure instance exists for the transformation afterwards (the reproduction's final assertions).
//  2. dev.lead (TL, a launching role) opens the same page: the form with an enabled Launch button, as before, and a
//     launch of the gate-review procedure creates an instance and opens it.
// Everything is SYNTHETIC; nothing here approves anything real, and nothing names an engineering delivery gate.
import { expect, test } from "@playwright/test";
import { apiSession, expectAccessible, fieldLabel, langOf, shot, signIn, SYN_RETAIL, tr } from "./support/ui.ts";

test("1. the auditor gets a read-only note, not a launch form; the server still refuses a launch (403), nothing is created", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const T = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic launch permission AUD ${lang} ${Date.now()}`,
    mode: "end_to_end",
  });
  await signIn(page, lang, "dev.auditor");
  await page.goto("/playbook/procedures");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p5.myProcedures.title"));
  const section = page.locator("section#launch");
  await expect(section.getByRole("heading", { level: 2 })).toHaveText(tr(lang, "workflowsP5.procedures.launchTitle"));
  const note = section.locator("[data-state='read-only']");
  await expect(note).toHaveText(tr(lang, "workflowsP5.procedures.launchReadOnly"));
  await expect(note).toHaveAttribute("role", "note");
  await expect(page.locator("form[data-form='launch-procedure']")).toHaveCount(0);
  await expect(section.getByRole("button")).toHaveCount(0);
  await expect(section.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: tr(lang, "workflowsP5.procedures.launch"), exact: true })).toHaveCount(
    0,
  );
  // The rest of the page still renders for the auditor.
  await expect(page.locator("section#my-steps h2")).toHaveText(tr(lang, "workflowsP5.procedures.myStepsTitle"));
  await expect(page.locator("section#instances h2")).toHaveText(tr(lang, "workflowsP5.procedures.instancesTitle"));
  await expectAccessible(page, lang, "p5-launch-permission-aud");
  await shot(page, lang, "p5-rg1-launch-aud-read-only");
  // The backstop: the same launch the form used to send, as the auditor, through the API.
  const aud = await apiSession(playwright, "dev.auditor");
  // (with its CSRF token and an Idempotency-Key, so the 403 is the authorization refusal, not a request defect)
  await aud.call(
    "POST",
    "/api/v1/procedure-instances",
    { procedureCode: "gate_review", transformationId: T.id },
    {
      expect: 403,
    },
  );
  const after = await lead.call<{ items: unknown[] }>("GET", `/api/v1/procedure-instances?transformationId=${T.id}`);
  expect(after.items).toHaveLength(0);
  await aud.req.dispose();
  await lead.req.dispose();
});

test("2. a launching role (Transformation Lead) still gets the form with an enabled Launch, and the launch works", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const T = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic launch permission TL ${lang} ${Date.now()}`,
    mode: "end_to_end",
  });
  await signIn(page, lang, "dev.lead");
  await page.goto("/playbook/procedures");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p5.myProcedures.title"));
  const form = page.locator("form[data-form='launch-procedure']");
  await expect(form).toBeVisible();
  await expect(page.locator("section#launch [data-state='read-only']")).toHaveCount(0);
  const launch = form.getByRole("button", { name: tr(lang, "workflowsP5.procedures.launch"), exact: true });
  await expect(launch).toBeEnabled();
  await form.getByLabel(fieldLabel(lang, "workflowsP5.procedures.procedure")).selectOption("gate_review");
  await form.getByLabel(fieldLabel(lang, "workflowsP5.field.transformation")).selectOption(T.id);
  await expectAccessible(page, lang, "p5-launch-permission-tl");
  await shot(page, lang, "p5-rg1-launch-tl-form");
  const posted = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/procedure-instances") && r.request().method() === "POST",
  );
  await launch.click();
  expect((await posted).status()).toBe(201);
  await expect(page).toHaveURL(/\/playbook\/procedures\/[0-9a-f-]{36}$/);
  const after = await lead.call<{ items: unknown[] }>("GET", `/api/v1/procedure-instances?transformationId=${T.id}`);
  expect(after.items).toHaveLength(1);
  await lead.req.dispose();
});
