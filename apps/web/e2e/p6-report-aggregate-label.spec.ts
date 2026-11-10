// T-DG6-BE-Z9 regression (F-DG6-400; ADR-0051 §2 "Totals and rollups"; D-195 Q3; REQ-S10-002) on the REAL stack
// (support/with-stack.sh; no mocks), in chromium-en and chromium-ar. Ported from the domain reviewer's round-6 probe
// (docs/delivery/test-evidence/DG6/domain/round-6/probes/dom-r6-screens.spec.ts.txt):
//  - dev.lead creates a transformation (TL there); a SYNTHETIC Benefit Owner adds a revenue_uplift benefit (planned
//    300 SAR) and an avoided_cost benefit (planned 100 SAR) in a free monthly reporting period; dev.office (TO) marks
//    the first one sensitive and generates an executive pack and an executive dashboard snapshot for that period;
//  - dev.lead (the TL: no grant, not a named party) opens both snapshots: the executive pack's "Current metrics"
//    section of the transformation and the executive dashboard's Value area carry the label "Includes restricted
//    records" / "يشمل سجلات مقيدة" (their value headlines are computed over the facts that include the sensitive
//    benefit; the plan lines lie in a free future month, so the headline amounts themselves may read 0.00 at today's
//    business date: the label is decided from the records the aggregate includes, not from the amount), the title
//    is not shown, and a section whose figures include no benefit (the update, the Outcomes area) has no label;
//  - dev.office (admitted) opens the same snapshots: no label anywhere.
// Before T-DG6-BE-Z9 the TL saw the metrics unlabelled (the probe's "label count 0"). Each page: html lang/dir of the
// language, and axe reports 0 serious/critical issues. Marking a record sensitive is an access decision, never a
// business approval (G1-G6); nothing names DG0-DG7. Every record is SYNTHETIC.
//
// Budget (F-DG5-145/146/151; p6-work-split §2 rules 13 and 15): the test sets 120 s. Measured loaded worst case:
// docs/delivery/handbacks/DG6/T-DG6-BE-Z9-evidence/e2e-a22-a13-bez9.log (13.1 s, chromium-en, while the full
// `pnpm test` and an 82-file integration run used the same machine); 120 s is more than 9x that.
import { expect, test, type Page } from "@playwright/test";
import { syntheticUser } from "./support/p3-journey-setup.ts";
import { SYN_RETAIL, apiSession, expectAccessible, langOf, shot, signIn, tr, type Lang } from "./support/ui.ts";

const ORG = "01920000-0000-7000-9000-000000000001";
test.setTimeout(120_000);

/** One open monthly reporting period of the organization in a free month (periods never overlap). */
async function freePeriod(
  office: Awaited<ReturnType<typeof apiSession>>,
  lang: Lang,
): Promise<{ id: string; start: string; end: string }> {
  const P = `/api/v1/organizations/${ORG}/reporting-periods`;
  for (let i = 0; i < 96; i++) {
    const n = (lang === "en" ? 0 : 48) + i;
    const y = 2036 + Math.floor(n / 12);
    const m = (n % 12) + 1;
    const mm = String(m).padStart(2, "0");
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const start = `${y}-${mm}-01`;
    const end = `${y}-${mm}-${last}`;
    try {
      const p = await office.call<{ id: string; version: number }>(
        "POST",
        P,
        { frequency: "monthly", periodLabel: `${y}-${mm}`, periodStart: start, periodEnd: end },
        { expect: 201 },
      );
      await office.call("POST", `${P}/${p.id}/open`, undefined, { ifMatch: p.version });
      return { id: p.id, start, end };
    } catch {
      // that month exists already: try the next one
    }
  }
  throw new Error("no free monthly reporting period");
}

/** The labels shown in each report section of the snapshot page, by section key. */
async function labelsBySection(page: Page): Promise<Record<string, number>> {
  return page
    .locator("[data-report-section]")
    .evaluateAll((els) =>
      Object.fromEntries(
        els.map((e) => [
          e.getAttribute("data-report-section") ?? "?",
          e.querySelectorAll(":scope > [data-restricted-records='true']").length,
        ]),
      ),
    );
}

test("F-DG6-400: report metrics sections are labelled for the TL and not for the TO", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const stamp = Date.now().toString(36);
  const TITLE = `Synthetic BE-Z9 SECRET ${lang} ${stamp}`;
  const admin = await apiSession(playwright, "dev.admin");
  const lead = await apiSession(playwright, "dev.lead");
  const office = await apiSession(playwright, "dev.office");
  const tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic BE-Z9 restricted metrics ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  const T = `/api/v1/transformations/${tid}`;
  const bo = await syntheticUser(
    admin,
    ORG,
    tid,
    `dev.bez9.bo.${lang}.${stamp}`,
    `Synthetic BO BE-Z9 ${lang}`,
    "BO",
    lang,
  );
  const boApi = await apiSession(playwright, bo.username);
  const period = await freePeriod(office, lang);
  const benefit = async (title: string, benefitType: string, valueClass: string, line: string, amount: string) => {
    const b = await boApi.call<{ id: string }>("POST", `${T}/benefits`, {
      title,
      description: "Synthetic benefit (T-DG6-BE-Z9 regression).",
      benefitType,
      valueClass,
      ownerUserId: bo.id,
      currency: "SAR",
      financialStatementLine: line,
    });
    await boApi.call("POST", `${T}/benefits/${b.id}/plan-values`, {
      valueKind: "planned",
      periodStart: period.start,
      periodEnd: period.end,
      amount,
    });
    return b.id;
  };
  const secret = await benefit(TITLE, "revenue", "revenue_uplift", "Revenue - roaming", "300");
  await benefit(`Synthetic plain BE-Z9 ${lang} ${stamp}`, "cost", "avoided_cost", "Opex - network", "100");
  await office.call(
    "PUT",
    `${T}/records/benefit/${secret}/sensitivity`,
    { isSensitive: true, reason: "Synthetic commercially sensitive benefit" },
    { ifMatch: 0 },
  );
  const snapshot = async (code: string) =>
    (
      await office.call<{ id: string }>(
        "POST",
        `${T}/reports/${code}/generate`,
        { reportingPeriodId: period.id, parameters: {} },
        { expect: 201 },
      )
    ).id;
  const pack = await snapshot("executive_pack");
  const dashboard = await snapshot("executive_dashboard");
  const label = tr(lang, "access.includesRestrictedRecords");
  expect(label).toBe(lang === "en" ? "Includes restricted records" : "يشمل سجلات مقيدة");

  for (const [user, role] of [
    ["dev.lead", "TL"],
    ["dev.office", "TO"],
  ] as const) {
    await page.context().clearCookies();
    await signIn(page, lang, user);
    for (const [id, name, labelled, plain] of [
      [pack, "executive-pack", "metrics_transformation", "update_transformation"],
      [dashboard, "executive-dashboard", "area_value", "area_outcomes"],
    ] as const) {
      await page.goto(`/transformations/${tid}/reports/${id}`);
      await expect(page.locator(`[data-report-section='${labelled}']`)).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      const labels = await labelsBySection(page);
      const main = await page.locator("main#main").innerText();
      if (role === "TL") {
        await expect(
          page.locator(`[data-report-section='${labelled}'] > [data-restricted-records='true']`),
          `${lang} TL ${name}: ${labelled} is labelled`,
        ).toHaveText(new RegExp(label));
        expect(labels[plain], `${lang} TL ${name}: ${plain} includes no restricted value`).toBe(0);
        expect(main.includes(TITLE), `${lang} TL ${name}: the benefit's title is not shown`).toBe(false);
      } else {
        expect(
          Object.values(labels).reduce((a, b) => a + b, 0),
          `${lang} TO ${name}: admitted to every record, no label`,
        ).toBe(0);
      }
      await expectAccessible(page, lang, `bez9-${role.toLowerCase()}-${name}`);
      await shot(page, lang, `bez9-${role.toLowerCase()}-${name}`);
    }
  }
});
