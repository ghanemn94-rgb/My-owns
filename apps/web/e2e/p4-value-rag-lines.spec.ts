// F-DG4-143 and F-DG4-144 (T-DG4-FE-R8; D-127) on the REAL stack (support/with-stack.sh; no mocks). SYNTHETIC data. No
// product gate (G1-G6) is decided here, and none implies an engineering gate (DG0-DG7).
//  1. F-DG4-143 (ADR-0037 amendment N4 items 1 and 4; REQ-S13-003 "distinguish zero, unknown and not applicable"), on
//     qa's round-4 world: one transformation with SAR margin uplift 70, SAR revenue uplift 300 and USD revenue uplift 11
//     planned 2026-01..06, and SAR avoided cost 45 planned only in 2099-01..06 (nothing due on the non-cash basis);
//     nothing validated. As the read-only auditor, the T10 Value area and the Executive Overview (?tr=<id>) show the
//     non-cash SAR line as 'Not applicable' (data-value-state='not_applicable') with its reason, never 'Unknown', 0 or
//     green; the valued lines read 100 % Red.
//  2. F-DG4-144 (ADR-0037 §4; REQ-S13-002): in a business unit of its own with 51 transformations (so the count left by
//     other specs never matters), the business-unit chip shows the too_many note and sends no request; each remedy the
//     note names lifts the block: the phase chip (narrowed to a phase none is in, the note becomes none_matching, and
//     clearing it brings too_many back), and the transformation chip (the request carries exactly that transformation).
// Every step: a full-page screenshot per language and axe with 0 serious or critical issues.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { asUser, syntheticUser } from "./support/p3-journey-setup.ts";
import {
  SYN_RETAIL,
  apiSession,
  expectAccessible,
  langOf,
  shot,
  tr,
  type ApiSession,
  type Lang,
} from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

let tid = "";
let lead: ApiSession;
const stamp = Date.now().toString(36);

async function go(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main#main h1")).toBeVisible();
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic P4 value RAG lines ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  const T = `/api/v1/transformations/${tid}`;
  const orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  const bo = await syntheticUser(admin, orgId, tid, `dev.p4rl.bo.${lang}.${stamp}`, `Synthetic BO ${lang}`, "BO", lang);
  const boApi = await apiSession(playwright, bo.username);
  for (const [key, valueClass, benefitType, line, currency, amount, start, end] of [
    ["margin", "margin_uplift", "revenue", "Gross margin - roaming", "SAR", "70", "2026-01-01", "2026-06-30"],
    ["revenue", "revenue_uplift", "revenue", "Revenue - roaming", "SAR", "300", "2026-01-01", "2026-06-30"],
    ["revenueUsd", "revenue_uplift", "revenue", "Revenue - roaming", "USD", "11", "2026-01-01", "2026-06-30"],
    ["avoided", "avoided_cost", "cost", "Opex - network", "SAR", "45", "2099-01-01", "2099-06-30"],
  ] as const) {
    const b = await boApi.call<{ id: string }>("POST", `${T}/benefits`, {
      title: `Synthetic RAG lines ${key} ${lang} ${stamp}`,
      description: "Synthetic demo benefit (F-DG4-143 world).",
      benefitType,
      valueClass,
      ownerUserId: bo.id,
      currency,
      financialStatementLine: line,
    });
    await boApi.call("POST", `${T}/benefits/${b.id}/plan-values`, {
      valueKind: "planned",
      periodStart: start,
      periodEnd: end,
      amount,
    });
  }
  // The API's line is correct (qa's integration probe Q1): non-cash SAR is not_applicable, nothing planned to date.
  const dash = await lead.call<{
    areas: { code: string; rag: { status: string; ruleParams: { lines?: Record<string, unknown>[] } } }[];
  }>("GET", `${T}/dashboard`);
  const value = dash.areas.find((a) => a.code === "value")!;
  expect(value.rag.status).toBe("red");
  expect(value.rag.ruleParams.lines).toContainEqual({
    currency: "SAR",
    headlineBasis: "non_cash",
    gapRatio: null,
    status: "not_applicable",
    reasonKey: "dashboard.value.nothing_planned",
  });
});

const flat = async (l: Locator) => (await l.innerText()).replace(/\s+/g, " ").trim();

/** The Value RAG lines of qa's world, rendered by each line's status. */
async function expectLines(page: Page, lang: Lang) {
  const lines = page.locator("section[data-area='value'] [data-value-rag-lines]").first();
  await expect(lines).toBeVisible();
  await expect(lines).toHaveAttribute("data-value-rag-lines", "4");
  // The n/a line: 'Not applicable' with its reason; never Unknown, never a number, never green.
  const na = lines.locator("[data-rag-line-basis='non_cash'][data-rag-line-currency='SAR']");
  await expect(na).toHaveAttribute("data-rag-line-status", "not_applicable");
  const naValue = na.locator("[data-value-state='not_applicable']");
  await expect(naValue).toHaveCount(1);
  await expect(naValue).toContainText(tr(lang, "dashboards.state.not_applicable"));
  await expect(naValue).toContainText(tr(lang, "dashboards.reason.dashboard__value__nothing_planned"));
  await expect(na.locator("[data-value-state='unknown']")).toHaveCount(0);
  const naText = await flat(na);
  expect(naText).not.toContain(tr(lang, "dashboards.state.unknown"));
  expect(naText).not.toMatch(/\d\s?%/);
  await expect(na.locator("[data-rag='not_applicable']")).toBeVisible();
  await expect(na.locator("[data-rag='green']")).toHaveCount(0);
  // The valued lines: 100 %, Red; no line of this world is Unknown.
  for (const [basis, currency] of [
    ["profit_and_cash", "SAR"],
    ["top_line", "SAR"],
    ["top_line", "USD"],
  ] as const) {
    const l = lines.locator(`[data-rag-line-basis='${basis}'][data-rag-line-currency='${currency}']`);
    await expect(l).toHaveAttribute("data-rag-line-status", "red");
    await expect(l.locator("[data-value-state='value'] .amount")).toHaveText("100 %");
  }
  await expect(lines.locator("[data-value-state='unknown']")).toHaveCount(0);
}

test("1. F-DG4-143: a not_applicable Value RAG line reads Not applicable with its reason on T10 and the Executive Overview", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const aud = await asUser(browser, lang, "dev.auditor");
  const page = aud.page;
  await go(page, `/transformations/${tid}/dashboard`);
  await expectLines(page, lang);
  await page.locator("section[data-area='value']").scrollIntoViewIfNeeded();
  await shot(page, lang, "p4rl-01-t10-value-rag-lines");
  await expectAccessible(page, lang, "p4rl-t10");
  await go(page, `/executive-overview?tr=${tid}`);
  await expect(page.locator(`[data-row='${tid}']`)).toBeVisible();
  await expectLines(page, lang);
  await page.locator("section[data-area='value']").scrollIntoViewIfNeeded();
  await shot(page, lang, "p4rl-02-overview-value-rag-lines");
  await expectAccessible(page, lang, "p4rl-overview");
  await aud.close();
});

test("2. F-DG4-144: in a unit of 51, every remedy the too_many note names lifts the block", async ({
  browser,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const office = await apiSession(playwright, "dev.office");
  const orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  const unit = await admin.call<{ id: string }>("POST", `/api/v1/organizations/${orgId}/business-units`, {
    code: `SYN-RL-${lang.toUpperCase()}-${stamp}`.toUpperCase(),
    nameEn: `Synthetic RAG-lines unit ${lang} ${stamp}`,
    nameAr: `وحدة اصطناعية ${lang} ${stamp}`,
  });
  const ids: string[] = [];
  for (let n = 0; n < 51; n++)
    ids.push(
      (
        await office.call<{ id: string }>("POST", "/api/v1/transformations", {
          businessUnitId: unit.id,
          name: `Synthetic BU limit ${lang} ${stamp} ${n}`,
          mode: "end_to_end",
        })
      ).id,
    );
  const to = await asUser(browser, lang, "dev.office");
  const page = to.page;
  const withIds: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/overview?") && r.url().includes("transformationId=")) withIds.push(r.url());
  });
  await go(page, "/executive-overview");
  await page.locator("[data-filter='bu']").selectOption(unit.id);
  const tooMany = page.locator("[data-filter-blocked='too_many']");
  await expect(tooMany).toBeVisible();
  await expect(tooMany).toContainText(tr(lang, "dashboards.filter.blocked.too_many"));
  await shot(page, lang, "p4rl-03-bu-too-many");
  await expectAccessible(page, lang, "p4rl-bu-too-many");
  expect(withIds).toHaveLength(0);
  // Remedy 1, the phase chip: no transformation of the unit is in Realize, so the block is lifted (none_matching).
  await page.locator("[data-filter='phase']").selectOption("realize");
  await expect(page.locator("[data-filter-blocked='none_matching']")).toBeVisible();
  await expect(tooMany).toHaveCount(0);
  await expect(page.locator("[data-filter-blocked='none_matching']")).toContainText(
    tr(lang, "dashboards.filter.blocked.none_matching"),
  );
  await shot(page, lang, "p4rl-04-bu-phase-none-matching");
  await expectAccessible(page, lang, "p4rl-bu-phase");
  // Clearing the phase brings the limit back.
  await page.locator("[data-chip='phase']").click();
  await expect(tooMany).toBeVisible();
  // Remedy 2, the transformation chip: the request carries exactly that transformation of the unit.
  const target = ids[50]!;
  await page.goto(`/executive-overview?bu=${unit.id}&tr=${target}`);
  await expect(page.locator(`[data-row='${target}']`)).toBeVisible();
  await expect(page.locator("[data-filter-blocked]")).toHaveCount(0);
  const last = new URL(withIds[withIds.length - 1]!);
  expect(last.searchParams.getAll("transformationId")).toEqual([target]);
  await shot(page, lang, "p4rl-05-bu-transformation-chip");
  await expectAccessible(page, lang, "p4rl-bu-chip");
  await to.close();
});
