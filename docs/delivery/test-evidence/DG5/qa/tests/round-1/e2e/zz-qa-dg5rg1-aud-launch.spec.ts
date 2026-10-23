// qa-verifier DG5 clean re-gate round 1 (T-DG5-RG-QA-R1) — follow-up of the AUD probe (zz-qa-dg5rg1-aud-p5.spec.ts),
// which found an ENABLED "Launch" submit on Playbook and Procedures > My procedures for the read-only auditor
// (dev.auditor). This probe drives it: the auditor chooses the seeded gate-review procedure and a transformation and
// presses Launch. Recorded and asserted: the HTTP status of POST /api/v1/procedure-instances (must be a refusal: 403),
// the alert the screen shows, that no procedure instance exists afterwards for that transformation (read as the lead),
// and that the URL did not move to an instance page. For contrast, the same screen for the lead (dev.lead) is recorded.
// Runs on the REAL stack (apps/web/e2e/support/with-stack.sh), copied into the disposable clone for the run only.
// Everything is SYNTHETIC; nothing names DG0-DG7.
import { expect, test } from "@playwright/test";
import { apiSession, fieldLabel, langOf, shot, signIn, SYN_RETAIL, tr } from "./support/ui.ts";

test("QA AUD launch: the auditor's enabled Launch on My procedures is refused by the server; nothing is created", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const T = await lead.call<{ id: string; code: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic qa AUD launch ${lang} ${Date.now()}`,
    mode: "end_to_end",
  });
  await signIn(page, lang, "dev.auditor");
  await page.goto("/playbook/procedures");
  const form = page.locator("form[data-form='launch-procedure']");
  await expect(form).toBeVisible();
  const proc = form.getByLabel(fieldLabel(lang, "workflowsP5.procedures.procedure"));
  const options = await proc.locator("option").allInnerTexts();
  console.info(`QA-AUDL ${lang}: the auditor is offered ${options.length - 1} procedures to launch`);
  const gateReview = await proc.locator("option").evaluateAll((os) =>
    (os as HTMLOptionElement[]).map((o) => o.value).find((v) => v === "gate_review"),
  );
  expect(gateReview, "the seeded gate_review procedure is offered").toBe("gate_review");
  await proc.selectOption("gate_review");
  const tx = form.getByLabel(fieldLabel(lang, "workflowsP5.field.transformation"));
  await tx.selectOption(T.id);
  const posted = page.waitForResponse((r) => r.url().endsWith("/api/v1/procedure-instances") && r.request().method() === "POST");
  await form.getByRole("button", { name: tr(lang, "workflowsP5.procedures.launch"), exact: true }).click();
  const res = await posted;
  const body = await res.text();
  console.info(`QA-AUDL ${lang}: POST /procedure-instances -> ${res.status()} ${body.slice(0, 300)}`);
  const alert = form.locator("[role='alert']").first();
  await expect(alert).toBeVisible();
  console.info(`QA-AUDL ${lang}: on-screen alert: ${(await alert.innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
  await shot(page, lang, "qa-aud-launch-refused");
  expect(page.url()).toMatch(/\/playbook\/procedures$/);
  const after = await lead.call<{ items: unknown[] }>("GET", `/api/v1/procedure-instances?transformationId=${T.id}`);
  console.info(`QA-AUDL ${lang}: procedure instances of the transformation after the attempt: ${after.items.length}`);
  expect(res.status()).toBe(403);
  expect(after.items).toHaveLength(0);
});
