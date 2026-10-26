// qa-verifier DG5 round 2 (T-DG5-RG2-QA-R2; carried from my round-1 probe, unchanged otherwise) probe: the AUD read-only pass over the P5 screens, with 390 px reflow and
// 200 % text, in chromium-en and chromium-ar (assignment §4: "include an AUD read-only pass; check 390 px and 200 % text
// on the P5 screens"). Runs on apps/web/e2e/support/with-stack.sh in a DISPOSABLE clone only (copied to e2e/ there).
//
// Per screen, signed in as the SYNTHETIC auditor dev.auditor (AUD, organization scope):
//   R1 the page renders an h1 inside main (or the product's own forbidden/not-found state, recorded as such);
//   R2 visiting it sends no write request (no POST/PUT/PATCH/DELETE to /api/);
//   R3 no ENABLED write control is offered in main (buttons whose visible text starts with a write verb of the page
//      language, taken from the catalogue's own action labels);
//   R4 axe (wcag2a/aa, 21a/aa): no serious or critical violation;
//   R5 390 px wide: no page-level horizontal overflow (wide tables scroll inside their own regions);
//   R6 200 % text (root font-size 200 % at 1280 px): no page-level horizontal overflow.
// Every finding is listed in the console (QA-R1-AUD lines) and the test fails on any R2-R6 problem.
// All data SYNTHETIC; nothing approves anything real; no engineering gate is named.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, langOf, signIn, SYN_RETAIL, tr, type Lang } from "../apps/web/e2e/support/ui.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

/** Write verbs: the catalogue's own action labels (the start of a button's visible text). */
function writeVerbs(lang: Lang): RegExp {
  const keys = [
    "studio.create.action",
    "studio.publish.action",
    "studio.discard.action",
    "studio.review.submit",
    "studio.defaults.saveDraft",
    "studio.defaults.createDraft",
    "forms.schema.addField",
    "forms.edit.save",
  ];
  const words = new Set<string>();
  for (const k of keys) {
    try {
      words.add(tr(lang, k).split(/\s+/)[0]!);
    } catch {
      /* key absent: skipped */
    }
  }
  const extra =
    lang === "en"
      ? ["Save", "Publish", "Submit", "Approve", "Create", "Generate", "Delete", "Discard", "Add", "New", "Retry", "Enable", "Disable", "Record", "Upload", "Roll", "Launch", "Start", "Run", "Reset", "Issue", "Reissue", "Propose", "Withdraw", "Answer", "Complete"]
      : ["حفظ", "احفظ", "نشر", "انشر", "إرسال", "أرسل", "اعتماد", "اعتمد", "إنشاء", "أنشئ", "توليد", "ولّد", "حذف", "احذف", "تجاهل", "إضافة", "أضف", "جديد", "إعادة", "أعد", "تفعيل", "فعّل", "تعطيل", "عطّل", "سجّل", "تسجيل", "رفع", "ارفع", "تشغيل", "شغّل", "إطلاق", "أطلق", "إصدار", "أصدر", "اقترح", "سحب", "اسحب", "أجب", "أكمل"];
  for (const w of extra) words.add(w);
  const esc = [...words].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // A whole word: "Create" matches "Create draft", never the sort header "Created sorted descending".
  return new RegExp(`^\\s*(?:${esc.join("|")})(?=\\s|$|:)`);
}

async function overflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number; culprit: string | null }> {
  return page.evaluate(() => {
    const d = document.documentElement;
    let culprit: string | null = null;
    if (d.scrollWidth > d.clientWidth + 1) {
      for (const el of Array.from(document.querySelectorAll("main *"))) {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.right > d.clientWidth + 1 || r.left < -1) {
          culprit = `${el.tagName.toLowerCase()}${(el as HTMLElement).className ? "." + String((el as HTMLElement).className).split(" ")[0] : ""} [${Math.round(r.left)},${Math.round(r.right)}]`;
          break;
        }
      }
    }
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, culprit };
  });
}

const SCREENS = (T: string) => [
  "/playbook/reader",
  "/playbook/reader/B0031",
  "/about",
  "/playbook/procedures",
  "/playbook/launch-plan",
  "/playbook/health-check",
  "/admin/studio",
  "/admin/studio/scoring-defaults",
  "/admin/studio/review-policies",
  "/admin/studio/revision-proposals",
  "/admin/source-coverage",
  "/admin/methodology-migrations",
  "/admin/forms",
  "/admin/forms/T13",
  "/admin/procedures",
  "/admin/coverage",
  "/admin/automation",
  "/admin/automation/executions",
  "/admin/automation/failures",
  "/admin/jobs/operations",
  "/admin/approval-routes",
  "/admin/health-schemes",
  "/admin/branding",
  "/admin/demo",
  "/evidence-reports/reports",
  "/evidence-reports/exports",
  "/evidence-reports/presentation",
  "/evidence-reports/evidence-register",
  "/initiatives-roadmaps/updates",
  "/my-work/notification-preferences",
  `${T}/reports`,
  `${T}/exports`,
  `${T}/presentation`,
  `${T}/owner-updates`,
  `${T}/evidence-register`,
  `${T}/launch-plan`,
  `${T}/day-90-test`,
  `${T}/health-check`,
  `${T}/financial-metrics`,
  `${T}/config-pins`,
  `${T}/methodology-migrations`,
  `${T}/gate-conditions`,
];

test.describe("QA-R1 AUD read-only pass, 390 px and 200 % text on the P5 screens", () => {
  let tx = "";
  let page: Page;
  const writes: string[] = [];
  const table: string[] = [];
  test.beforeAll(async ({ playwright, browser }, info) => {
    test.setTimeout(180_000);
    const lead = await apiSession(playwright, "dev.lead");
    tx = (
      await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
        businessUnitId: SYN_RETAIL,
        name: "Synthetic QA-R1 AUD probe transformation",
        mode: "end_to_end",
      })
    ).id;
    // A launch plan so the plan and Day-90 screens have content (synthetic).
    await lead.call("POST", `/api/v1/transformations/${tx}/launch-plan`, { startDate: "2026-10-01" });
    const lang = langOf(info);
    const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
    page = await ctx.newPage();
    page.on("request", (r) => {
      if (r.url().includes("/api/") && !["GET", "HEAD", "OPTIONS"].includes(r.method()) && !r.url().includes("/auth/"))
        writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    await signIn(page, lang, "dev.auditor");
  });
  test.afterAll(async ({}, info) => {
    console.info(`QA-R1-AUD ${langOf(info)} screens (${table.length}):\n${table.join("\n")}`);
    await page?.context().close();
  });

  for (let i = 0; i < 42; i++)
    test(`AUD screen ${String(i + 1).padStart(2, "0")}: read-only, axe, 390 px, 200 % text`, async ({}, info) => {
      test.setTimeout(120_000);
      const lang = langOf(info);
      const verbs = writeVerbs(lang);
      const path = SCREENS(`/transformations/${tx}`)[i]!;
      const problems: string[] = [];
      writes.length = 0;
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(path);
      const h1 = (await page.locator("main h1").first().textContent({ timeout: 30_000 }).catch(() => null))?.trim() ?? null;
      await page.waitForTimeout(500);
      const p5 = await page.locator("[data-p5-screen]").first().getAttribute("data-p5-screen", { timeout: 2_000 }).catch(() => null);
      const htmlLang = await page.locator("html").getAttribute("lang");
      const htmlDir = await page.locator("html").getAttribute("dir");
      if (htmlLang !== lang || htmlDir !== (lang === "ar" ? "rtl" : "ltr")) problems.push(`html lang/dir ${htmlLang}/${htmlDir}`);
      if (h1 === null) problems.push("R1 no h1 in main");
      const buttons = page.locator("main button:visible, main a.button:visible, main [role='button']:visible");
      const n = await buttons.count();
      const offered: string[] = [];
      for (let b = 0; b < n; b++) {
        const el = buttons.nth(b);
        const text = ((await el.innerText().catch(() => "")) || "").trim().replace(/\s+/g, " ");
        if (!verbs.test(text)) continue;
        const disabled = (await el.isDisabled().catch(() => false)) || (await el.getAttribute("aria-disabled")) === "true";
        if (!disabled) offered.push(text.slice(0, 60));
      }
      if (offered.length > 0) problems.push(`R3 enabled write controls ${JSON.stringify(offered)}`);
      const ax = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const serious = ax.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      if (serious.length > 0)
        problems.push(`R4 axe ${serious.map((v) => `${v.id}(${v.nodes.map((x) => x.target.join(" ")).slice(0, 3).join(", ")})`).join("; ")}`);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      const o390 = await overflow(page);
      if (o390.scrollWidth > o390.clientWidth + 1) problems.push(`R5 390px overflow ${o390.scrollWidth}>${o390.clientWidth} ${o390.culprit}`);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
      await page.waitForTimeout(300);
      const o200 = await overflow(page);
      if (o200.scrollWidth > o200.clientWidth + 1) problems.push(`R6 200% overflow ${o200.scrollWidth}>${o200.clientWidth} ${o200.culprit}`);
      await page.evaluate(() => (document.documentElement.style.fontSize = ""));
      if (writes.length > 0) problems.push(`R2 write requests on visit ${JSON.stringify(writes)}`);
      const row = `${path} | screen=${p5} | h1=${JSON.stringify(h1)} | writeControls=${offered.length} | axeSerious=${serious.length} | 390=${o390.scrollWidth}/${o390.clientWidth} | 200%=${o200.scrollWidth}/${o200.clientWidth} | writes=${writes.length} | problems=${JSON.stringify(problems)}`;
      table.push(row);
      console.info(`QA-R1-AUD ${lang} ${row}`);
      expect(problems, path).toEqual([]);
    });
});
