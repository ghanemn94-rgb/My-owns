// qa-verifier DG5 clean re-gate round 2 (T-DG5-RG-QA-R2): adversarial re-verification of F-DG5-140 on the frozen
// candidate 5df44203 (source edbf5ce). Round 1 (zz-qa-dg5rg1-aud-launch.spec.ts) showed the read-only auditor an
// ENABLED "Launch a procedure" form on /playbook/procedures that could only end in 403.
// This probe, on the REAL stack (apps/web/e2e/support/with-stack.sh, AUTH_MODE=dev), per language (chromium-en/-ar):
//  1. For every seeded dev user WITHOUT procedure.launch (dev.auditor = AUD, dev.admin = ADM_ACCESS + ADM_TECH):
//     - no form[data-form='launch-procedure'], no Launch button anywhere on the page, no enabled control at all
//       inside section#launch; the read-only note (role=note) in the page language, html lang/dir correct;
//     - a sweep of EVERY enabled button/input/select/textarea on the whole page, logged (none may be a launch);
//     - the server backstop: the round-1 POST /api/v1/procedure-instances as that user -> 403, nothing created;
//     - after a reload and after a client-side navigation away and back, still no form (no stale render).
//  2. For every dev user WITH procedure.launch (dev.lead = TL, dev.office = TO): the form and an enabled Launch, no
//     read-only note (regression: the fix must not hide the form from launching roles).
// Copied into the disposable clone's apps/web/e2e/ for the run only. Everything is SYNTHETIC.
import { expect, test } from "@playwright/test";
import { apiSession, langOf, shot, signIn, SYN_RETAIL, tr } from "./support/ui.ts";

const NON_LAUNCHERS = ["dev.auditor", "dev.admin"] as const;
const LAUNCHERS = ["dev.lead", "dev.office"] as const;

for (const user of NON_LAUNCHERS)
  test(`QA RG2 F-DG5-140: ${user} (no procedure.launch) gets the read-only note, no launch control; server 403`, async ({
    page,
    playwright,
  }, info) => {
    test.setTimeout(150_000);
    const lang = langOf(info);
    const lead = await apiSession(playwright, "dev.lead");
    const T = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic qa RG2 launch ${user} ${lang} ${Date.now()}`,
      mode: "end_to_end",
    });
    await signIn(page, lang, user);
    const check = async (when: string) => {
      await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p5.myProcedures.title"));
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      const section = page.locator("section#launch");
      await expect(section).toBeVisible();
      const note = section.locator("[role='note'][data-state='read-only']");
      await expect(note).toHaveText(tr(lang, "workflowsP5.procedures.launchReadOnly"));
      await expect(page.locator("form[data-form='launch-procedure']")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: tr(lang, "workflowsP5.procedures.launch"), exact: true }),
      ).toHaveCount(0);
      const inSection = await section.locator("button, input, select, textarea, [contenteditable='true']").count();
      expect(inSection, `${when}: controls inside section#launch`).toBe(0);
      const enabled = await page
        .locator("main#main")
        .locator("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])")
        .evaluateAll((els) =>
          els.map((e) => {
            const el = e as HTMLElement;
            const form = el.closest("form");
            return `${el.tagName.toLowerCase()}[type=${el.getAttribute("type") ?? ""}] "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 60)}" form=${form?.getAttribute("data-form") ?? form?.getAttribute("role") ?? "-"} section=${el.closest("section")?.id ?? "-"}`;
          }),
        );
      console.info(`QA-RG2-AUDL ${lang} ${user} ${when}: enabled controls in main: ${enabled.length}\n  ${enabled.join("\n  ")}`);
      expect(enabled.filter((s) => /launch/i.test(s)), `${when}: launch controls`).toEqual([]);
    };
    await page.goto("/playbook/procedures");
    await check("first load");
    await shot(page, lang, `qa-rg2-launch-${user}-read-only`);
    await page.reload();
    await check("after reload");
    await page.goto("/my-work");
    await expect(page.locator("main#main h1")).toBeVisible();
    await page.goBack();
    await check("after back navigation");
    // Server backstop (the round-1 reproduction's request), with CSRF and an Idempotency-Key from the helper.
    const u = await apiSession(playwright, user);
    await u.call(
      "POST",
      "/api/v1/procedure-instances",
      { procedureCode: "gate_review", transformationId: T.id },
      { expect: 403 },
    );
    const after = await lead.call<{ items: unknown[] }>("GET", `/api/v1/procedure-instances?transformationId=${T.id}`);
    console.info(`QA-RG2-AUDL ${lang} ${user}: POST as ${user} -> 403; instances afterwards: ${after.items.length}`);
    expect(after.items).toHaveLength(0);
    await u.req.dispose();
    await lead.req.dispose();
  });

for (const user of LAUNCHERS)
  test(`QA RG2 F-DG5-140 regression: ${user} (holds procedure.launch) still gets the form and an enabled Launch`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    const lang = langOf(info);
    await signIn(page, lang, user);
    await page.goto("/playbook/procedures");
    await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p5.myProcedures.title"));
    const form = page.locator("form[data-form='launch-procedure']");
    await expect(form).toBeVisible();
    await expect(page.locator("section#launch [data-state='read-only']")).toHaveCount(0);
    await expect(form.getByRole("button", { name: tr(lang, "workflowsP5.procedures.launch"), exact: true })).toBeEnabled();
    const options = await form.locator("select").first().locator("option").count();
    console.info(`QA-RG2-AUDL ${lang} ${user}: launch form offered with ${options - 1} procedure option(s)`);
    expect(options).toBeGreaterThan(1);
    await shot(page, lang, `qa-rg2-launch-${user}-form`);
  });
