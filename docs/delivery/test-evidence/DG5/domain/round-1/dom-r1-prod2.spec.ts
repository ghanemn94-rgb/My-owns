// domain-reviewer DG5 round 1 (T-DG5-RG2-DOM-R1): my own black-box probe of the PRODUCTION-initialized stack
// (apps/web/e2e/support/with-stack.sh: migrate + seed-dev, no environment marker = production database, AUTH_MODE=dev).
// Copied into the disposable clone as e2e/zz-dom-r1-prod.spec.ts and run in chromium-en and chromium-ar.
// Everything is SYNTHETIC (seed-dev users and records created here). The configuration review and publish below are
// synthetic in-product actions on test data; they approve nothing real and never touch the engineering gates DG0-DG7.
// Screenshots: E2E_SCREENSHOT_DIR/<lang>/dom-*.png. Facts: one JSON line per observation, prefixed "DOMFACT ".
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { asUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import { apiSession, langOf, shot, signIn, tr, trackRequests, type ApiSession, type Lang } from "../apps/web/e2e/support/ui.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ORG = "01920000-0000-7000-9000-000000000001";
const RETAIL = "01920000-0000-7000-9000-000000000102";
const DEV_ISSUER = "urn:mth:dev-local";
const fact = (o: Record<string, unknown>) => console.log("DOMFACT " + JSON.stringify(o));

const PLAYBOOK = readFileSync(path.join("docs", "source", "playbook.md"), "utf8");
const block = (ref: string) => {
  const line = PLAYBOOK.split("\n").find((l) => l.includes(`<!-- ${ref} -->`))!;
  return line.replace(` <!-- ${ref} -->`, "").trim();
};
const B0004 = block("B0004");
const QUESTIONS = ["Why change?", "What must become different?", "How will we execute?", "How will we prove value?"];
const DAY90 = ["B0136", "B0137", "B0138", "B0139", "B0140", "B0141"].map(block);
const B0150 = [...PLAYBOOK.slice(PLAYBOOK.indexOf("<!-- B0150 table -->"), PLAYBOOK.indexOf("<!-- B0151")).matchAll(/☐ (\d+)\. ([^|]+?)\s*\|/g)]
  .map((m) => [Number(m[1]), m[2]!.trim()] as const)
  .sort((a, b) => a[0] - b[0])
  .map(([, t]) => t);
const CLAIMS = /official PMI|PMI[- ]certified|certified by PMI|PMI standard|معتمد من PMI|معيار PMI الرسمي|\bDG[0-7]\b/i;

async function newUser(admin: ApiSession, username: string, lang: Lang, role: string, scope: Body): Promise<string> {
  const u = await admin.call<{ id: string }>("POST", "/api/v1/users", {
    organizationId: ORG,
    displayName: `Synthetic domain-review ${username}`,
    preferredLocale: lang,
    identity: { issuer: DEV_ISSUER, subject: username },
  });
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: u.id,
    roleCode: role,
    scope,
    reason: "Synthetic user for the domain review (approves nothing real)",
  });
  return u.id;
}

async function bodyText(page: Page): Promise<string> {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

test.describe.configure({ mode: "default" });
test.setTimeout(240_000);

test("P3b Studio: a 95 % scoring-defaults draft goes through preview, review and is refused at publish in the UI; the Studio elements show the custom-extension badge", async ({
  page,
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const tag = `${lang}${Date.now().toString(36)}`;
  const admName = `dom.r1.adm95.${tag}`;
  await newUser(admin, admName, lang, "ADM_METHOD", { type: "organization", id: ORG });
  const adm = await apiSession(playwright, admName);
  const mpub = await adm.call<Body>("GET", "/api/v1/admin/methodology-versions?kind=methodology&status=published");
  const mv = mpub.items.find((v: Body) => v.isNewestPublished) ?? mpub.items[0];
  await signIn(page, lang, admName);
  await page.goto(`/admin/studio/versions/${mv.id}`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.waitForTimeout(1000);
  const typeSelect = page.locator("#elements select, section select").filter({ has: page.locator("option[value='template']") }).first();
  if ((await typeSelect.count()) > 0) await typeSelect.selectOption("template");
  await page.waitForTimeout(2000);
  const vt = await bodyText(page);
  fact({ p: "P3b", lang, methodologyVersionPageBadge: vt.includes(tr(lang, "playbookP5.provenance.custom_extension")), badgeCount: await page.locator("[data-provenance], .provenance-badge").count(), claim: vt.match(CLAIMS)?.[0] ?? null });
  await shot(page, lang, "dom-p3b-methodology-version-elements");
  const pub = await adm.call<Body>("GET", "/api/v1/admin/methodology-versions?kind=scoring_defaults&status=published");
  const base = pub.items.find((v: Body) => v.isNewestPublished);
  const drafts = await adm.call<Body>("GET", "/api/v1/admin/methodology-versions?kind=scoring_defaults&status=draft");
  for (const d of drafts.items) if (["editing", "preview"].includes(d.draftStage)) await adm.call("POST", `/api/v1/admin/methodology-versions/${d.id}/discard`, undefined, { ifMatch: d.version });
  await page.goto("/admin/studio");
  await page.getByRole("button", { name: tr(lang, "studio.create.action"), exact: true }).click();
  const create = page.getByRole("dialog");
  await create.locator("select").first().selectOption(base.id);
  await create.getByLabel(tr(lang, "studio.field.changeSummary")).fill("Synthetic domain review: a 95 % total");
  await create.getByRole("button", { name: tr(lang, "studio.create.submit"), exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/studio\/versions\/[0-9a-f-]+$/);
  const versionUrl = new URL(page.url()).pathname;
  const versionId = versionUrl.split("/").pop()!;
  await page.getByRole("link", { name: tr(lang, "studio.defaults.openEditor"), exact: true }).click();
  const w = (c: string) => page.locator(`input[data-weight='${c}']`);
  for (const [c, v] of [["strategic_fit", "25"], ["financial_value", "20"], ["customer_impact", "20"], ["feasibility", "15"], ["time_to_value", "15"]] as const) await w(c).fill(v);
  await expect(page.locator("[data-weight-total]")).toHaveAttribute("data-weight-total", "95.00");
  await page.getByRole("button", { name: tr(lang, "studio.defaults.saveDraft"), exact: true }).click();
  await expect(page.locator("[data-state='saved-draft']")).toBeVisible();
  await page.goto(versionUrl);
  const checks: Record<string, string | null> = {};
  for (const kind of ["preview", "compatibility"]) {
    await page.locator(`[data-run-check='${kind}']`).click();
    await page.waitForTimeout(2500);
    checks[kind] = await page.locator(`[data-check-kind='${kind}'] [data-check]`).first().getAttribute("data-check").catch(() => null);
  }
  fact({ p: "P3b", lang, checks95: checks });
  await shot(page, lang, "dom-p3b-95-checks");
  const submitBtn = page.getByRole("button", { name: tr(lang, "studio.review.submit"), exact: true });
  if ((await submitBtn.count()) > 0) {
    await submitBtn.click();
    const submit = page.getByRole("dialog");
    await submit.getByLabel(tr(lang, "studio.review.note")).fill("Synthetic domain review: 95 %");
    await submit.getByRole("button", { name: tr(lang, "studio.review.submit"), exact: true }).click();
    await page.waitForTimeout(1500);
    const pending = page.locator("[data-state='pending-review']").getByRole("link");
    if ((await pending.count()) > 0) {
      await pending.click();
      const reviewUrl = new URL(page.url()).pathname;
      const o = await asUser(browser, lang, "dev.office");
      await o.page.goto(reviewUrl);
      await o.page.getByRole("button", { name: tr(lang, "studio.review.decide"), exact: true }).click();
      const decide = o.page.getByRole("dialog");
      await decide.locator("select").first().selectOption("approve");
      await decide.getByLabel(tr(lang, "studio.review.decisionNote")).fill("Synthetic: to test the publish refusal");
      await decide.getByRole("button", { name: tr(lang, "studio.review.record"), exact: true }).click();
      await expect(decide).toHaveCount(0);
      await o.close();
    }
  }
  await page.goto(versionUrl);
  await page.waitForTimeout(1500);
  const pubBtn = page.locator("[data-action='publish']");
  fact({ p: "P3b", lang, publishOffered: await pubBtn.count() });
  if ((await pubBtn.count()) > 0) {
    const resp = page.waitForResponse((r) => r.url().endsWith("/publish") && r.request().method() === "POST");
    await pubBtn.click();
    const r = await resp;
    await page.waitForTimeout(1500);
    const t = await bodyText(page);
    fact({ p: "P3b", lang, publish95Status: r.status(), publish95Body: (await r.text()).slice(0, 300), shownMessage: t.match(/(Default weights must total[^.]*\.)|(100\s*%[^.]{0,80})/)?.[0] ?? null });
  }
  await shot(page, lang, "dom-p3b-95-publish-refused");
  const v = await adm.call<Body>("GET", `/api/v1/admin/methodology-versions/${versionId}`);
  fact({ p: "P3b", lang, finalStatus: v.status, draftStage: v.draftStage });
});

test("P4 health check, launch plan, Day-90 test (Transformation Lead)", async ({ page, playwright }, info) => {
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const office = await apiSession(playwright, "dev.office");
  const tag = `${lang}${Date.now().toString(36)}`;
  const t = await office.call<Body>("POST", "/api/v1/transformations", { businessUnitId: RETAIL, name: `Synthetic DOM health ${tag}`, mode: "end_to_end" });
  const leadName = `dom.r1.tl.${tag}`;
  await newUser(admin, leadName, lang, "TL", { type: "transformation", id: t.id });
  const lead = await apiSession(playwright, leadName);
  const HC = `/api/v1/transformations/${t.id}/health-checks`;
  let a = await lead.call<Body>("POST", HC, { assessmentDate: "2026-10-05" });
  for (let i = 1; i <= 25; i++) {
    const code = `q${String(i).padStart(2, "0")}`;
    if (i === 25) break;
    a = await lead.call<Body>("PUT", `${HC}/${a.id}/answers/${code}`, { response: i <= 10 ? "yes" : "no" }, { ifMatch: a.version });
  }
  fact({ p: "P4", lang, incomplete: { score: a.score, band: a.band, completion: a.completion } });
  await signIn(page, lang, leadName);
  await page.goto(`/transformations/${t.id}/health-check`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.waitForTimeout(1500);
  let txt = await bodyText(page);
  const missing = lang === "en" ? B0150.filter((q) => !txt.includes(q)) : [];
  fact({ p: "P4", lang, healthQuestionsRendered: await page.locator("[data-question]").count(), enMissingVerbatim: missing, incompleteShown: /Incomplete \(24\/25\)|24\/25|٢٤/.test(txt) });
  await shot(page, lang, "dom-p4-health-incomplete");
  a = await lead.call<Body>("PUT", `${HC}/${a.id}/answers/q25`, { response: "no" }, { ifMatch: a.version });
  fact({ p: "P4", lang, complete10: { score: a.score, band: a.band } });
  await page.reload();
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.waitForTimeout(1500);
  txt = await bodyText(page);
  fact({ p: "P4", lang, band10Text: txt.includes("Execution risk is material; strengthen direction, TOM, governance or benefits.") });
  await shot(page, lang, "dom-p4-health-10");
  // Launch plan from 2026-10-01.
  const lp = await lead.req.fetch(`/api/v1/transformations/${t.id}/launch-plan`, {
    method: "POST",
    headers: { "X-CSRF-Token": (await (await lead.req.get("/api/v1/me")).json()).csrfToken, "Idempotency-Key": crypto.randomUUID() },
    data: { startDate: "2026-10-01" },
  });
  fact({ p: "P4", lang, launchPlanCreate: lp.status(), body: (await lp.text()).slice(0, 300) });
  await page.goto(`/transformations/${t.id}/launch-plan`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, lang, "dom-p4-launch-plan");
  await page.goto(`/transformations/${t.id}/day-90-test`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.waitForTimeout(1500);
  txt = await bodyText(page);
  fact({ p: "P4", lang, day90Verbatim: DAY90.map((q) => txt.includes(q)) });
  await shot(page, lang, "dom-p4-day90");
  await page.goto("/playbook/health-check");
  await expect(page.locator("main#main h1")).toBeVisible();
  await shot(page, lang, "dom-p4-playbook-health");
});

test("P5 automation: a human-only action is refused; forms show the question tag; reports screen", async ({ page, playwright }, info) => {
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const tag = `${lang}${Date.now().toString(36)}`;
  const admName = `dom.r1.auto.${tag}`;
  await newUser(admin, admName, lang, "ADM_METHOD", { type: "organization", id: ORG });
  const adm = await apiSession(playwright, admName);
  const cat = await adm.call<Body>("GET", "/api/v1/admin/automation-catalogue");
  const triggers = (cat.triggers ?? cat.items ?? []).map((x: Body) => x.code);
  fact({ p: "P5", lang, catalogueKeys: Object.keys(cat), triggers: triggers.slice(0, 60) });
  const csrf = (await (await adm.req.get("/api/v1/me")).json()).csrfToken;
  for (const type of ["approve_gate", "attest_finance_value", "decide_investment", "create_task"]) {
    const r = await adm.req.fetch("/api/v1/admin/automation-rules", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
      data: {
        code: `dom.r1.${type}.${tag}`.toLowerCase().replace(/[^a-z0-9_.]/g, "_").slice(0, 60),
        nameEn: `Synthetic ${type}`,
        nameAr: `اصطناعي ${type}`,
        scopeLevel: "organization",
        organizationId: ORG,
        ownerUserId: adm.userId,
        content: { triggerCodes: ["gate.submitted"], actions: [{ type, parameters: type === "create_task" ? { assigneeRoleCode: "TL", titleEn: "Synthetic", titleAr: "اصطناعي" } : {} }], runAs: "service" },
      },
    });
    fact({ p: "P5", lang, action: type, status: r.status(), body: (await r.text()).slice(0, 300) });
  }
  await signIn(page, lang, admName);
  await page.goto("/admin/automation");
  await expect(page.locator("main#main h1")).toBeVisible();
  await shot(page, lang, "dom-p5-automation");
  const office = await apiSession(playwright, "dev.office");
  const tx = await office.call<Body>("POST", "/api/v1/transformations", { businessUnitId: RETAIL, name: `Synthetic DOM forms ${tag}`, mode: "end_to_end" });
  const op = await asUser(page.context().browser()!, lang, "dev.office");
  for (const [u, n] of [["diagnose", "t01"], ["charter", "t02"], ["define", "t03-t05"], ["raid", "t15"], ["executive-decisions", "t16"]] as const) {
    await op.page.goto(`/transformations/${tx.id}/${u}`);
    await expect(op.page.locator("main#main h1")).toBeVisible();
    await op.page.waitForTimeout(1200);
    const tags = await op.page.locator("[data-question-tag]").evaluateAll((els) => els.map((e) => e.getAttribute("data-question-tag")));
    fact({ p: "P5", lang, screen: u, questionTags: tags, demoLabel: (await bodyText(op.page)).includes("synthetic") });
    await shot(op.page, lang, `dom-p5-form-${n}`);
  }
  await op.close();
  await page.goto("/admin/forms");
  await expect(page.locator("main#main h1")).toBeVisible();
  await shot(page, lang, "dom-p5-forms");
});
