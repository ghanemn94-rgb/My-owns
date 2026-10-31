// qa-verifier A20 "UX and branding" (DG6, T-DG6-QA-D), in chromium-en and chromium-ar on the real stack
// (apps/web/e2e/support/with-stack.sh). Master prompt §20 A20: "Arabic RTL/English LTR, keyboard flows and mobile review
// work; changing the primary brand token updates screens and output templates". Binding rows tested literally here:
//   REQ-S15-009 "e2e tests at 360 px approve a gate item and submit a KPI actual in Arabic and English";
//   REQ-S15-012 "... the guided walkthrough can be completed by keyboard alone" (the keyboard half for the main
//               journeys: a KPI actual submitted and a KPI actual accepted with the keyboard alone, the skip link and
//               the language switch; the walkthrough itself needs the demo database: see the handback);
//   REQ-S15-007 "a validation error returned by the API is shown in the selected language";
//   REQ-S15-003 "status chips are distinguishable in greyscale" (rendered chips carry a label; in greyscale the label
//               keeps >= 4.5:1 against the chip);
//   REQ-S20-020 "Arabic RTL/English LTR, keyboard flows and mobile review work".
// At 360 px each step asserts no page-level horizontal scroll and the primary action inside the viewport, and each
// result is read back through the API. Every record is SYNTHETIC; every approval is an in-product business approval of
// test data that approves nothing real; no text names an engineering gate.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { g1Records, syntheticUser, type SyntheticUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import {
  SYN_RETAIL,
  apiSession,
  confirmG1Agreements,
  expectAccessible,
  fieldLabel,
  langOf,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
  type Lang,
} from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a20-p6");
const PHONE = { width: 360, height: 800 };
const stamp = Date.now().toString(36);
let tid = "";
let T = "";
let kpiId = "";
let kpiName = "";
let periodId = "";
let sponsor: SyntheticUser;
let owner: SyntheticUser;
let reviewer: SyntheticUser;
let approvalId = "";
let lead: ApiSession;

async function shot(page: Page, lang: Lang, name: string) {
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  const office = await apiSession(playwright, "dev.office");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic QA A20 P6 ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  T = `/api/v1/transformations/${tid}`;
  const orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  const mk = (code: string, role: string, name: string) =>
    syntheticUser(admin, orgId, tid, `dev.qa20.${code}.${lang}.${stamp}`, `${name} ${lang}`, role, lang);
  sponsor = await mk("sp", "SP", "Synthetic QA Sponsor");
  owner = await mk("kds", "KDS", "Synthetic QA KPI owner");
  reviewer = await mk("bo", "BO", "Synthetic QA reviewer");
  await lead.call("POST", `${T}/role-mappings`, { partyCode: "SP", targetKind: "user", userId: sponsor.id });
  await lead.call("POST", `${T}/role-mappings`, { partyCode: "BO", targetKind: "user", userId: reviewer.id });
  // G1's records (the charter names the Sponsor as approver), submitted by the Lead: the gate item to approve.
  await g1Records(T, lead, office, sponsor.id);
  const gate = await lead.call<{ gate: { version: number } }>("GET", `${T}/gates/G1`);
  await lead.call(
    "POST",
    `${T}/gates/G1/submissions`,
    { submissionNote: `Synthetic QA G1 ${lang}` },
    { ifMatch: gate.gate.version },
  );
  // A business approval request routed by the "Business scope change" decision right to the mapped Sponsor.
  const decision = await lead.call<{ id: string; version: number }>("POST", "/api/v1/decisions", {
    transformationId: tid,
    title: `Synthetic QA keyboard scope change ${lang} ${stamp}`,
    ownerUserId: lead.userId,
    tomDimensionCode: "technology",
    options: [{ title: "Build" }, { title: "Buy" }],
  });
  const rights = await lead.call<{ items: { id: string; templateKey: string | null }[] }>(
    "GET",
    `${T}/decision-rights`,
  );
  approvalId = (
    await lead.call<{ id: string }>("POST", `${T}/approvals`, {
      approvalType: "decision_request",
      subjectId: decision.id,
      subjectVersion: decision.version,
      decisionRightId: rights.items.find((r) => r.templateKey === "business_scope_change")!.id,
      title: `Synthetic QA keyboard approval ${lang} ${stamp}`,
    })
  ).id;
  // A percentage KPI owned by the KPI owner, reviewed by the mapped Business Owner, and one open monthly period.
  kpiName = `Synthetic QA A20 adoption ${lang} ${stamp}`;
  const kpi = await lead.call<{ id: string; version: number }>("POST", `${T}/kpi-definitions`, {
    name: kpiName,
    unitKind: "percentage",
    polarity: "higher_is_better",
    frequency: "monthly",
    ownerUserId: owner.id,
  });
  await lead.call("POST", `${T}/kpi-definitions/${kpi.id}/activate`, undefined, { ifMatch: kpi.version });
  kpiId = kpi.id;
  const v = await lead.call<{ id: string; version: number }>("POST", `${T}/kpi-definitions/${kpiId}/versions`, {
    measureType: "higher_is_better",
    valueNature: "stock",
    aggregationRule: "last_value",
    targetValue: "0.25",
    targetDate: "2062-12-31",
    reviewerPartyCode: "BO",
  });
  await lead.call("POST", `${T}/kpi-versions/${v.id}/activate`, undefined, { ifMatch: v.version });
  const P = `/api/v1/organizations/${orgId}/reporting-periods`;
  const csrf = ((await (await office.req.get("/api/v1/me")).json()) as { csrfToken: string }).csrfToken;
  for (let i = 0; i < 120 && !periodId; i++) {
    const n = (lang === "en" ? 0 : 60) + i;
    const y = 2061 + Math.floor(n / 12);
    const m = (n % 12) + 1;
    const mm = String(m).padStart(2, "0");
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const res = await office.req.fetch(P, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
      data: {
        frequency: "monthly",
        periodLabel: `${y}-${mm}`,
        periodStart: `${y}-${mm}-01`,
        periodEnd: `${y}-${mm}-${last}`,
      },
    });
    if (res.status() !== 201) continue; // that month exists already (another spec): the next one
    const p = (await res.json()) as { id: string; version: number };
    await office.call("POST", `${P}/${p.id}/open`, undefined, { ifMatch: p.version });
    periodId = p.id;
  }
  expect(periodId, "an open synthetic monthly period").not.toBe("");
  await admin.req.dispose();
  await office.req.dispose();
});

test.afterAll(async () => {
  await lead?.req.dispose();
});

/** No page-level horizontal scroll; each action lies inside the viewport width once scrolled into view vertically. */
async function expectFits(page: Page, width: number, actions: Locator[], what: string) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    `${what}: page scroll width`,
  ).toBeLessThanOrEqual(width);
  for (const [n, a] of actions.entries()) {
    await a.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, window.scrollY));
    const box = await a.boundingBox();
    expect(box, `${what}: action ${n} rendered`).not.toBeNull();
    expect(box!.x, `${what}: action ${n} start`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${what}: action ${n} end`).toBeLessThanOrEqual(width);
  }
}

/** The focused element shows a visible indicator (outline or box-shadow). */
async function expectFocusVisible(page: Page, what: string) {
  const s = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    return { outline: cs.outlineStyle, width: cs.outlineWidth, shadow: cs.boxShadow, tag: el.tagName };
  });
  expect(s, `${what}: something has focus`).not.toBeNull();
  expect(
    (s!.outline !== "none" && s!.width !== "0px") || s!.shadow !== "none",
    `${what}: visible focus ${JSON.stringify(s)}`,
  ).toBe(true);
}

/** Tab forward until `target` has focus (fails when it is not reachable within `max` stops). */
async function tabTo(page: Page, target: Locator, what: string, max = 200) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) {
      await expectFocusVisible(page, what);
      return;
    }
    await page.keyboard.press("Tab");
  }
  await expect(target, `${what}: reachable by keyboard`).toBeFocused();
}

const dirOf = (lang: Lang) => (lang === "ar" ? "rtl" : "ltr");

test("REQ-S15-009 360 px: the Sponsor approves the submitted gate item G1", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await page.setViewportSize(PHONE);
  await signIn(page, lang, sponsor.username);
  await page.goto(`/transformations/${tid}/gates/G1`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", dirOf(lang));
  const decide = page.getByRole("button", { name: tr(lang, "gates.decision.action"), exact: true });
  await expectFits(page, PHONE.width, [decide], "gate page");
  await shot(page, lang, "a20-360-gate");
  await decide.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: tr(lang, "gates.outcome.approved"), exact: true }).check();
  await confirmG1Agreements(dialog, lang);
  await dialog
    .getByLabel(fieldLabel(lang, "gates.decision.rationale"))
    .fill("Synthetic QA approval at 360 px (approves nothing real).");
  const confirm = dialog.getByRole("button", { name: tr(lang, "gates.decision.confirm"), exact: true });
  await expectFits(page, PHONE.width, [confirm], "gate decision dialog");
  await shot(page, lang, "a20-360-gate-decision");
  await expectAccessible(page, lang, "a20-360-gate-decision");
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expectFits(page, PHONE.width, [], "gate after decision");
  const view = await lead.call<{ gate: { status: string } }>("GET", `${T}/gates/G1`);
  expect(view.gate.status).toBe("approved");
  await shot(page, lang, "a20-360-gate-approved");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  expect(foreign).toEqual([]);
});

test("REQ-S15-009 + REQ-S15-012 360 px, keyboard alone: the KPI owner submits a KPI actual", async ({ page }, info) => {
  const lang = langOf(info);
  await page.setViewportSize(PHONE);
  await signIn(page, lang, owner.username);
  await page.goto(`/transformations/${tid}/kpis/${kpiId}/actuals`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", dirOf(lang));
  const form = page.locator("form").filter({ has: page.locator("fieldset[data-step='1']") });
  const period = form.getByLabel(fieldLabel(lang, "kpiP4.field.period"));
  const value = form.getByLabel(
    new RegExp(`^${tr(lang, "kpiP4.field.actual").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  const submit = form.locator("[data-action='submit-actual']");
  await expectFits(page, PHONE.width, [submit], "KPI actual form");
  // From here on: key presses only.
  await page.locator("body").focus();
  await tabTo(page, period, "period select");
  const options = await period.locator("option").count();
  for (let i = 0; i <= options && (await period.inputValue()) !== periodId; i++) await page.keyboard.press("ArrowDown");
  await expect(period).toHaveValue(periodId);
  await tabTo(page, value, "actual value");
  await page.keyboard.type("12.5");
  await tabTo(page, submit, "submit actual");
  await shot(page, lang, "a20-360-kpi-actual-keyboard");
  await page.keyboard.press("Enter");
  const confirmation = page.locator("[data-state='kpi-update-confirmation']");
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(tr(lang, "kpiP4.actualStatus.submitted"));
  await expectFits(page, PHONE.width, [], "KPI actual confirmation");
  await shot(page, lang, "a20-360-kpi-actual-submitted");
  const actuals = await lead.call<{
    items: { status: string; currentValueNo: number; values: { valueNo: number; value: string }[] }[];
  }>("GET", `${T}/kpi-definitions/${kpiId}/actuals`);
  const submitted = actuals.items.filter((a) => a.status === "submitted");
  expect(submitted).toHaveLength(1);
  const v = submitted[0]!.values.find((x) => x.valueNo === submitted[0]!.currentValueNo)!.value;
  // A percentage KPI: "12.5" typed in the form is 12.5 %, stored as the exact decimal fraction 0.125.
  expect(v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")).toBe("0.125");
});

test("REQ-S15-007: an error returned by the API is shown in the selected language (an already-read reminder)", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, reviewer.username);
  const item = page.locator("#inbox li[data-notification][data-read='false']").first();
  await expect(item).toBeVisible();
  const notificationId = (await item.getAttribute("data-notification"))!;
  // The same reminder is marked read in another session first (the API then refuses the second mark).
  const other = await apiSession(playwright, reviewer.username);
  const inbox = await other.call<{ items: { id: string; version: number }[] }>("GET", "/api/v1/me/inbox");
  const n = inbox.items.find((x) => x.id === notificationId)!;
  await other.call("POST", `/api/v1/me/inbox/${notificationId}/read`, undefined, { ifMatch: n.version });
  await other.req.dispose();
  const refused = page.waitForResponse((r) => r.url().includes(`/me/inbox/${notificationId}/read`));
  await item.locator("[data-action='mark-read']").click();
  const res = await refused;
  expect(res.status(), "the API refuses the stale mark").toBeGreaterThanOrEqual(400);
  const problem = (await res.json()) as { code: string };
  const key = `problems.${problem.code.replace(/\./g, "__")}`;
  const other_: Lang = lang === "en" ? "ar" : "en";
  const shown = page.getByRole("alert").filter({ hasText: tr(lang, key) });
  await expect(shown, `the ${problem.code} text in ${lang}`).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: tr(other_, key) })).toHaveCount(0);
  await shot(page, lang, "a20-api-error-localized");
});

test("REQ-S15-012 keyboard alone: the reviewer accepts the KPI actual from the review queue", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, reviewer.username);
  await page.goto(`/transformations/${tid}/kpi-review`);
  await expect(page.locator("main#main h1")).toBeVisible();
  const row = page.locator("#kpi-review-queue tr", { hasText: kpiName });
  const accept = row.locator("[data-action='accept-actual']");
  await expect(accept).toBeVisible();
  await page.locator("body").focus();
  await tabTo(page, accept, "accept action");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const submit = dialog.locator("[data-action='submit']");
  for (let i = 0; i < 30 && !(await submit.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press("Tab");
  await expect(submit).toBeFocused();
  await expectFocusVisible(page, "dialog submit");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#kpi-review-queue tr", { hasText: kpiName })).toHaveCount(0);
  const actuals = await lead.call<{ items: { status: string }[] }>("GET", `${T}/kpi-definitions/${kpiId}/actuals`);
  expect(actuals.items.filter((a) => a.status === "accepted")).toHaveLength(1);
  await shot(page, lang, "a20-keyboard-accepted");
});

test("REQ-S15-012 keyboard alone: the Sponsor decides a business approval request (approve with rationale)", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, sponsor.username);
  await page.goto(`/my-work/approvals/${approvalId}`);
  await expect(page.locator("main#main h1")).toBeVisible();
  const decide = page.locator("[data-action='decide']");
  await expect(decide).toBeVisible();
  await page.locator("body").focus();
  await tabTo(page, decide, "decide action");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const outcome = dialog.getByLabel(fieldLabel(lang, "approvals.decide.outcome"));
  const rationale = dialog.getByLabel(fieldLabel(lang, "approvals.decide.rationale"));
  const submit = dialog.locator("[data-action='submit']");
  await tabTo(page, outcome, "outcome select", 30);
  const options = await outcome.locator("option").count();
  for (let i = 0; i <= options && (await outcome.inputValue()) !== "approve"; i++)
    await page.keyboard.press("ArrowDown");
  await expect(outcome).toHaveValue("approve");
  await tabTo(page, rationale, "rationale", 30);
  await page.keyboard.type("Synthetic QA keyboard approval (approves nothing real)");
  await tabTo(page, submit, "submit decision", 30);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-approval-status='approved']").first()).toBeVisible();
  const after = await lead.call<{ status: string; decisions: unknown[] }>("GET", `/api/v1/approvals/${approvalId}`);
  expect([after.status, after.decisions.length]).toEqual(["approved", 1]);
  await shot(page, lang, "a20-keyboard-approval-approved");
});

test("REQ-S15-012 / REQ-S20-020 keyboard: the skip link reaches main content and the language switch flips the direction", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await page.goto("/my-work");
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.locator("body").focus();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: tr(lang, "common.a11y.skipToContent") });
  await expect(skip).toBeFocused();
  await expectFocusVisible(page, "skip link");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  // The language switch, reached and pressed with the keyboard only.
  const other: Lang = lang === "en" ? "ar" : "en";
  const sw = page.getByRole("button", {
    name: tr(lang, "common.language.switchTo", { language: other === "ar" ? "العربية" : "English" }),
    exact: true,
  });
  await page.locator("body").focus();
  await tabTo(page, sw, "language switch");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", other);
  await expect(page.locator("html")).toHaveAttribute("dir", dirOf(other));
  const back = page.getByRole("button", {
    name: tr(other, "common.language.switchTo", { language: lang === "ar" ? "العربية" : "English" }),
    exact: true,
  });
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("dir", dirOf(lang));
});

test("REQ-S15-003: rendered status chips carry a label and stay legible in greyscale", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}/kpis/${kpiId}`);
  await expect(page.locator("main#main h1")).toBeVisible();
  // Greyscale rendering for the screenshot (through the CSSOM: the CSP rightly refuses an injected <style>). The ratio
  // below is computed from luminance alone, which is what greyscale keeps.
  await page.evaluate(() => {
    document.documentElement.style.filter = "grayscale(1)";
  });
  const chips = page.locator(".status-chip:visible, .lifecycle-chip:visible");
  const count = await chips.count();
  expect(count, "status chips rendered on the KPI page").toBeGreaterThan(0);
  const report = await chips.evaluateAll((els) => {
    const lum = (rgb: string) => {
      const m = rgb.match(/\d+(\.\d+)?/g)!.map(Number);
      const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(m[0]!) + 0.7152 * lin(m[1]!) + 0.0722 * lin(m[2]!);
    };
    const bgOf = (el: Element): string => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const b = getComputedStyle(e).backgroundColor;
        if (b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent") return b;
      }
      return "rgb(255, 255, 255)";
    };
    return els.map((el) => {
      const fg = lum(getComputedStyle(el).color);
      const bg = lum(bgOf(el));
      const [hi, lo] = fg > bg ? [fg, bg] : [bg, fg];
      return { text: (el.textContent ?? "").trim(), ratio: (hi + 0.05) / (lo + 0.05) };
    });
  });
  for (const r of report) {
    expect(r.text.length, `chip label "${r.text}"`).toBeGreaterThan(0);
    expect(r.ratio, `chip "${r.text}" in greyscale (luminance contrast)`).toBeGreaterThanOrEqual(4.5);
  }
  await shot(page, lang, "a20-status-chips-greyscale");
});
