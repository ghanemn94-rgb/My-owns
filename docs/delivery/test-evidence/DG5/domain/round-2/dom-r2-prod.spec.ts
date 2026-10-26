// domain-reviewer DG5 round 2 (T-DG5-RG2-DOM-R2): my own black-box probe of the PRODUCTION-initialized stack
// (apps/web/e2e/support/with-stack.sh: migrate + seed-dev, no environment marker = production database, AUTH_MODE=dev).
// Derived from my round-1 probes (dom-r1-prod.spec.ts, dom-r1-prod2.spec.ts) with their design faults removed:
// P3 now runs the 95 % draft through preview, compatibility and review before the publish refusal, discards it, then
// publishes 30/20/20/15/15 + a Feasibility rubric through the full pipeline in the UI. Each language runs on its OWN
// fresh stack (run-probe.sh), so no cross-project state is shared.
// Copied into the disposable clone as e2e/zz-dom-r2-prod.spec.ts. Everything is SYNTHETIC (seed-dev users and records
// created here). The configuration review and publish are synthetic in-product actions on test data; they approve
// nothing real and never touch the engineering gates DG0-DG7.
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

test("P1 reader and About: B0004 verbatim, the four questions, badges, the Realize note, no official claim", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.office");
  await page.goto("/playbook/reader");
  await expect(page.locator("main#main h1")).toBeVisible();
  await expect(page.locator("[data-source-text='statement']").first()).toBeVisible();
  let txt = await bodyText(page);
  fact({ p: "P1", lang, readerHasB0004: txt.includes(B0004), questions: QUESTIONS.map((q) => txt.includes(q)) });
  expect.soft(txt).toContain(B0004);
  for (const q of QUESTIONS) expect.soft(txt).toContain(q);
  expect.soft(await page.locator("[data-list='guiding-questions'] > li").count()).toBe(4);
  expect.soft(txt).toContain(tr(lang, "playbookP5.provenance.custom_extension"));
  const claim = txt.match(CLAIMS);
  fact({ p: "P1", lang, readerClaimMatch: claim ? claim[0] : null });
  await shot(page, lang, "dom-p1-reader");
  await page.locator("select[data-filter='phase']").selectOption("realize");
  await expect(page.locator("[data-state='realize-guidance']")).toContainText("aligns with PMI Benefits Realization Management logic");
  await shot(page, lang, "dom-p1-reader-realize");
  await page.goto("/about");
  await expect(page.locator("main#main h1")).toBeVisible();
  txt = await bodyText(page);
  fact({ p: "P1", lang, aboutHasB0004: txt.includes(B0004), aboutClaim: txt.match(CLAIMS)?.[0] ?? null, aboutLen: txt.length });
  expect.soft(txt).toContain(B0004);
  await shot(page, lang, "dom-p1-about");
  expect(foreign).toEqual([]);
});

test("P2 navigation: TO 14 areas, ADM_TECH 3 areas, TL no Administration; colour from brand.primary", async ({ page, playwright }, info) => {
  const lang = langOf(info);
  const res: Record<string, string[]> = {};
  for (const u of ["dev.office", "dev.admin", "dev.lead", "dev.auditor", "dev.nobody"]) {
    const s = await apiSession(playwright, u);
    const nav = await s.call<Body>("GET", "/api/v1/me/navigation");
    res[u] = (nav.areas ?? nav.items ?? []).map((a: Body) => a.code);
  }
  fact({ p: "P2", lang, navigation: res });
  expect.soft(res["dev.office"]!.length).toBe(14);
  expect.soft(res["dev.admin"]!.length).toBe(3);
  expect.soft(res["dev.lead"]!).not.toContain("administration");
  await signIn(page, lang, "dev.office");
  const nav = page.getByRole("navigation", { name: tr(lang, "nav.primary"), exact: true });
  await expect(nav).toHaveAttribute("data-nav-state", "ready");
  const rendered = await nav.locator("a[data-area]").count();
  const bg = await nav.evaluate((el) => getComputedStyle(el).backgroundColor);
  fact({ p: "P2", lang, officeRenderedAreas: rendered, navBackground: bg });
  await shot(page, lang, "dom-p2-nav-office");
  const ad = await asUser(page.context().browser()!, lang, "dev.admin");
  const adNav = ad.page.getByRole("navigation", { name: tr(lang, "nav.primary"), exact: true });
  await expect(adNav).toHaveAttribute("data-nav-state", "ready");
  fact({ p: "P2", lang, adminRenderedAreas: await adNav.locator("a[data-area]").count() });
  await ad.page.goto("/admin/branding");
  await expect(ad.page.locator("main#main h1")).toBeVisible();
  const btxt = await bodyText(ad.page);
  fact({
    p: "P2",
    lang,
    brandingHasDefaultName: btxt.includes("Mobily Transformation Hub"),
    brandingMentions0078FF: /#0078FF/i.test(btxt),
    brandingProvisional: /provisional|مؤقت/i.test(btxt),
    wordmark: await ad.page.getByTestId("wordmark").innerText(),
  });
  await shot(ad.page, lang, "dom-p2-branding");
  await ad.close();
});

test("P3b Studio: a 95 % scoring-defaults draft goes through preview, review and is refused at publish in the UI; the Studio elements show the custom-extension badge", async ({
  page,
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const tag = `${lang}${Date.now().toString(36)}`;
  const admName = `dom.r2.adm95.${tag}`;
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
  // The refused draft stays a draft; discard it so the next draft of the same key can be created (one open draft per key).
  expect.soft(v.status).toBe("draft");
  await adm.call("POST", `/api/v1/admin/methodology-versions/${versionId}/discard`, undefined, { ifMatch: v.version });
});

test("P3 Studio: 30/20/20/15/15 + Feasibility rubric through preview, review and publish in the UI; immutable; only new transformations take it; separation", async ({
  page,
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const office = await apiSession(playwright, "dev.office");
  const tag = `${lang}${Date.now().toString(36)}`;
  const admName = `dom.r2.adm.${tag}`;
  await newUser(admin, admName, lang, "ADM_METHOD", { type: "organization", id: ORG });
  const adm = await apiSession(playwright, admName);
  const before = await office.call<Body>("POST", "/api/v1/transformations", { businessUnitId: RETAIL, name: `Synthetic DOM before ${tag}`, mode: "end_to_end" });
  const pub = await adm.call<Body>("GET", "/api/v1/admin/methodology-versions?kind=scoring_defaults&status=published");
  const base = pub.items.find((v: Body) => v.isNewestPublished);
  await signIn(page, lang, admName);
  await page.goto("/admin/studio");
  await expect(page.locator("main#main h1")).toBeVisible();
  const studioTxt = await bodyText(page);
  fact({ p: "P3", lang, studioBadge: studioTxt.includes(tr(lang, "playbookP5.provenance.custom_extension")), studioClaim: studioTxt.match(CLAIMS)?.[0] ?? null });
  await shot(page, lang, "dom-p3-studio-home");
  await page.getByRole("button", { name: tr(lang, "studio.create.action"), exact: true }).click();
  const create = page.getByRole("dialog");
  await create.locator("select").first().selectOption(base.id);
  await create.getByLabel(tr(lang, "studio.field.changeSummary")).fill("Synthetic domain review: 30/20/20/15/15 and Feasibility rubric");
  await create.getByRole("button", { name: tr(lang, "studio.create.submit"), exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/studio\/versions\/[0-9a-f-]+$/);
  const versionUrl = new URL(page.url()).pathname;
  const versionId = versionUrl.split("/").pop()!;
  await page.getByRole("link", { name: tr(lang, "studio.defaults.openEditor"), exact: true }).click();
  const w = (c: string) => page.locator(`input[data-weight='${c}']`);
  for (const [c, v] of [["strategic_fit", "30"], ["financial_value", "20"], ["customer_impact", "20"], ["feasibility", "15"], ["time_to_value", "15"]] as const) await w(c).fill(v);
  await expect(page.locator("[data-weight-total]")).toHaveAttribute("data-weight-total", "100.00");
  const feas = `Synthetic DOM feasibility (${tag}): requires capabilities not yet in place`;
  await page.getByLabel(tr(lang, "studio.defaults.descriptorLabel", { criterion: tr(lang, "studio.criterion.feasibility"), score: 1, language: tr(lang, "common.language.name.en") }), { exact: true }).fill(feas);
  await page.getByRole("button", { name: tr(lang, "studio.defaults.saveDraft"), exact: true }).click();
  await expect(page.locator("[data-state='saved-draft']")).toBeVisible();
  await shot(page, lang, "dom-p3-weights-30");
  await page.goto(versionUrl);
  await expect(page.locator("[data-table='diff']")).toBeVisible();
  await shot(page, lang, "dom-p3-diff");
  for (const kind of ["preview", "compatibility"]) {
    await page.locator(`[data-run-check='${kind}']`).click();
    await expect(page.locator(`[data-check-kind='${kind}'] [data-check]`)).toHaveAttribute("data-check", /^(pass|warn)$/);
  }
  await page.getByRole("button", { name: tr(lang, "studio.review.submit"), exact: true }).click();
  const submit = page.getByRole("dialog");
  await submit.getByLabel(tr(lang, "studio.review.note")).fill("Synthetic domain review");
  await submit.getByRole("button", { name: tr(lang, "studio.review.submit"), exact: true }).click();
  await expect(submit).toHaveCount(0);
  await page.locator("[data-state='pending-review']").getByRole("link").click();
  const reviewUrl = new URL(page.url()).pathname;
  const o = await asUser(browser, lang, "dev.office");
  await o.page.goto(reviewUrl);
  await o.page.getByRole("button", { name: tr(lang, "studio.review.decide"), exact: true }).click();
  const decide = o.page.getByRole("dialog");
  await decide.locator("select").first().selectOption("approve");
  await decide.getByLabel(tr(lang, "studio.review.decisionNote")).fill("Synthetic: approved for the domain review");
  await decide.getByRole("button", { name: tr(lang, "studio.review.record"), exact: true }).click();
  await expect(decide).toHaveCount(0);
  await shot(o.page, lang, "dom-p3-review-approved");
  await o.close();
  await page.goto(versionUrl);
  await page.locator("[data-action='publish']").click();
  await expect(page.locator("main [data-state='immutable']")).toBeVisible();
  await shot(page, lang, "dom-p3-published");
  // A published version is immutable: the scoring-defaults editor endpoint refuses it (body as the editor sends it).
  const v = await adm.call<Body>("GET", `/api/v1/admin/methodology-versions/${versionId}`);
  fact({ p: "P3", lang, publishedStatus: v.status, draftStage: v.draftStage ?? null });
  // A NEW transformation after the publish vs the EXISTING one.
  const after = await office.call<Body>("POST", "/api/v1/transformations", { businessUnitId: RETAIL, name: `Synthetic DOM after ${tag}`, mode: "end_to_end" });
  const ws = async (t: string) => (await office.call<Body>("GET", `/api/v1/transformations/${t}/prioritization/weight-sets`)).items ?? [];
  const sd = async (t: string) => office.call<Body>("GET", `/api/v1/transformations/${t}/scoring-defaults`);
  const [wsB, wsA, sdB, sdA] = [await ws(before.id), await ws(after.id), await sd(before.id), await sd(after.id)];
  const feasOf = (s: Body) => s.rubrics?.find((r: Body) => r.criterionCode === "feasibility")?.levels?.[0];
  fact({ p: "P3", lang, beforeWeightSets: wsB.map((x: Body) => ({ src: x.source ?? x.origin, w: x.weights ?? x.criteria })), afterWeightSets: wsA.map((x: Body) => ({ src: x.source ?? x.origin, w: x.weights ?? x.criteria })), beforeFeas1: feasOf(sdB), afterFeas1: feasOf(sdA), beforeWeights: sdB.weights, afterWeights: sdA.weights });
  expect.soft(JSON.stringify(sdA.weights ?? wsA)).toContain("30");
  // A published version is immutable: the editor endpoint refuses a well-formed body (the new defaults' own shape).
  const put = await adm.req.fetch(`/api/v1/admin/methodology-versions/${versionId}/scoring-defaults`, {
    method: "PUT",
    headers: { "X-CSRF-Token": (await (await adm.req.get("/api/v1/me")).json()).csrfToken, "If-Match": `"${v.version}"` },
    data: { weights: sdA.weights, rubrics: sdA.rubrics },
  });
  fact({ p: "P3", lang, putPublishedStatus: put.status(), putBody: (await put.text()).slice(0, 300) });
  expect.soft([409, 422]).toContain(put.status());
  // Separation: a methodology admin cannot decide a business approval; an owner (TL) cannot write Studio.
  const lead = await apiSession(playwright, "dev.lead");
  const leadDraft = await lead.req.fetch("/api/v1/admin/methodology-versions", {
    method: "POST",
    headers: { "X-CSRF-Token": (await (await lead.req.get("/api/v1/me")).json()).csrfToken, "Idempotency-Key": crypto.randomUUID() },
    data: { kind: "scoring_defaults", baseVersionId: base.id, changeSummary: "should be refused" },
  });
  fact({ p: "P3", lang, leadStudioWriteStatus: leadDraft.status() });
  expect.soft(leadDraft.status()).toBe(403);
  // Separation: the ADM_METHOD user has no transformation.read, so the business record is not available to it (403 or 404).
  const admT = await adm.req.get(`/api/v1/transformations/${after.id}`);
  fact({ p: "P3", lang, admMethodTransformationRead: admT.status() });
  expect.soft([403, 404]).toContain(admT.status());
  const o2 = await asUser(browser, lang, "dev.office");
  await o2.page.goto(`/transformations/${after.id}/prioritization`);
  await expect(o2.page.locator("main#main h1")).toBeVisible();
  fact({ p: "P3", lang, afterPrioritizationText: (await bodyText(o2.page)).match(/30(\.00)?\s*%|%\s*30/)?.[0] ?? null });
  await shot(o2.page, lang, "dom-p3-after-prioritization");
  await o2.page.goto(`/transformations/${before.id}/prioritization`);
  await expect(o2.page.locator("main#main h1")).toBeVisible();
  await shot(o2.page, lang, "dom-p3-before-prioritization");
  await o2.close();
});

test("P4 health check, launch plan, Day-90 test (Transformation Lead)", async ({ page, playwright }, info) => {
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const office = await apiSession(playwright, "dev.office");
  const tag = `${lang}${Date.now().toString(36)}`;
  const t = await office.call<Body>("POST", "/api/v1/transformations", { businessUnitId: RETAIL, name: `Synthetic DOM health ${tag}`, mode: "end_to_end" });
  const leadName = `dom.r2.tl.${tag}`;
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
  const admName = `dom.r2.auto.${tag}`;
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
        code: `dom.r2.${type}.${tag}`.toLowerCase().replace(/[^a-z0-9_.]/g, "_").slice(0, 60),
        nameEn: `Synthetic ${type}`,
        nameAr: `اصطناعي ${type}`,
        scopeLevel: "organization",
        organizationId: ORG,
        ownerUserId: adm.userId,
        content: { triggerCodes: ["gate.submitted"], actions: [{ type, parameters: type === "create_task" ? { assigneeRole: "TL", messageKey: "automation.message.follow_up" } : {} }], runAs: "service" },
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
