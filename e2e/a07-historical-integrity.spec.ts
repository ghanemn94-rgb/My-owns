// A07 "Historical integrity" (qa-verifier, T-DG5-QA-B): the user-visible path of "Target/formula changes show impact
// and reapproval; previous period reports and approved snapshots remain intact" (REQ-S20-007; REQ-S13-007 "after a
// later KPI change, the issued snapshot still shows the old values and their versions"; REQ-S07-016 "the ... report
// issued earlier is unchanged and a reissue creates version 2").
//
// Black-box on the REAL stack (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, migrate, seed-dev, ONE API
// process serving the built SPA). Fixtures through the public API by the seeded synthetic dev users: a transformation,
// a synthetic Transformation Lead (preferred locale = the project's language), a KPI data steward and a Business Owner;
// a KPI with an active version 1 (target 100). In the browser the lead generates the KPI register and ISSUES it
// (version 1, target 100). The target then changes to 120 through a change request routed to, and decided by, the
// synthetic Business Owner (through the API: a synthetic in-product decision). In the browser again:
//   1. the issued snapshot still shows target 100 (never 120), version 1, the same SHA-256 and the KPI's version 1 in
//      its retained versions; the live preview of the same register shows 120;
//   2. the lead generates a reissue with a reason and issues it: it is version 2 and shows 120; version 1 shows the
//      superseded banner and still shows 100 with its original SHA-256.
// Asserted throughout: <html lang/dir> (en LTR, ar RTL), axe with 0 serious/critical issues on each screen, no foreign
// request, no engineering-gate name in product text. This spec publishes NO global configuration (nothing to restore,
// D-163). Screenshots: E2E_SCREENSHOT_DIR/<lang>/a07-*.png. All data is SYNTHETIC; issuing a report approves nothing,
// and the change-request decision approves nothing real.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { asUser, syntheticUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import {
  apiSession,
  expectAccessible,
  langOf,
  shot,
  SYN_RETAIL,
  tr,
  trackRequests,
  type ApiSession,
  type Lang,
} from "../apps/web/e2e/support/ui.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ORG = "01920000-0000-7000-9000-000000000001";

/** Arabic-Indic and extended digits to ASCII, grouping separators removed, trailing fractional zeros dropped. */
function numberOf(text: string): string | null {
  const ascii = text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٬,  \s‎‏؜]/g, "")
    .replace(/٫/g, ".");
  if (!/^-?\d+(\.\d+)?$/.test(ascii)) return null;
  return ascii.includes(".") ? ascii.replace(/0+$/, "").replace(/\.$/, "") : ascii;
}
async function rowNumbers(row: Locator): Promise<string[]> {
  return (await row.locator("td").allTextContents()).map(numberOf).filter((x): x is string => x !== null);
}

async function checkPage(page: Page, lang: Lang, name: string) {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  await expectAccessible(page, lang, name);
  await shot(page, lang, name);
}

interface World {
  tid: string;
  kpiId: string;
  kpiName: string;
  v1: string;
  lead: ApiSession;
  leadUser: string;
}

async function setup(
  playwright: Parameters<typeof apiSession>[0],
  lang: Lang,
): Promise<World & { kds: ApiSession; bo: ApiSession; boId: string }> {
  const admin = await apiSession(playwright, "dev.admin");
  const office = await apiSession(playwright, "dev.office");
  const tx = await office.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic A07 historical integrity ${lang.toUpperCase()}`,
    mode: "end_to_end",
  });
  const tag = `${lang}.${tx.id.slice(-6)}`;
  const tl = await syntheticUser(admin, ORG, tx.id, `qa.a07.tl.${tag}`, `Synthetic A07 lead ${lang}`, "TL", lang);
  const kdsU = await syntheticUser(
    admin,
    ORG,
    tx.id,
    `qa.a07.kds.${tag}`,
    `Synthetic A07 steward ${lang}`,
    "KDS",
    lang,
  );
  const boU = await syntheticUser(admin, ORG, tx.id, `qa.a07.bo.${tag}`, `Synthetic A07 owner ${lang}`, "BO", lang);
  const [lead, kds, bo] = await Promise.all([
    apiSession(playwright, tl.username),
    apiSession(playwright, kdsU.username),
    apiSession(playwright, boU.username),
  ]);
  const T = `/api/v1/transformations/${tx.id}`;
  const kpiName = `Synthetic A07 roaming activations ${lang}`;
  const def = await kds.call<Body>("POST", `${T}/kpi-definitions`, {
    name: kpiName,
    unitKind: "count",
    unitLabel: "activations",
    polarity: "higher_is_better",
    frequency: "monthly",
  });
  await kds.call("POST", `${T}/kpi-definitions/${def.id}/activate`, undefined, { ifMatch: def.version });
  const v1 = await kds.call<Body>("POST", `${T}/kpi-definitions/${def.id}/versions`, {
    measureType: "higher_is_better",
    valueNature: "flow",
    aggregationRule: "sum",
    submissionRoute: "direct_accept",
    targetValue: "100",
    targetDate: "2030-12-31",
  });
  await kds.call("POST", `${T}/kpi-versions/${v1.id}/activate`, undefined, { ifMatch: v1.version });
  return { tid: tx.id, kpiId: def.id, kpiName, v1: v1.id, lead, leadUser: tl.username, kds, bo, boId: boU.id };
}

/** Target 100 -> 120 through a change request decided by the synthetic Business Owner (the configured approver). */
async function changeTarget(w: World & { kds: ApiSession; bo: ApiSession; boId: string }): Promise<string> {
  const T = `/api/v1/transformations/${w.tid}`;
  const v2 = await w.kds.call<Body>("POST", `${T}/kpi-definitions/${w.kpiId}/versions`, {
    measureType: "higher_is_better",
    valueNature: "flow",
    aggregationRule: "sum",
    submissionRoute: "direct_accept",
    targetValue: "120",
    targetDate: "2030-12-31",
    changeReason: "Synthetic A07 stretch target",
  });
  await w.lead.call("POST", `${T}/role-mappings`, { partyCode: "BO", targetKind: "user", userId: w.boId });
  const def = await w.lead.call<Body>("GET", `${T}/kpi-definitions/${w.kpiId}`);
  const cr = await w.lead.call<Body>("POST", `${T}/change-requests`, {
    changeKind: "target",
    subjectType: "kpi_definition",
    subjectId: w.kpiId,
    subjectVersion: def.version,
    proposedRecordType: "kpi_version",
    proposedRecordId: v2.id,
    proposedChange: { targetValue: { from: "100", to: "120" } },
    reason: "Synthetic A07: a stretch target agreed by the business owner",
  });
  // The change shows its impact and needs a decision before it applies.
  const impact = await w.lead.call<Body>("GET", `${T}/change-requests/${cr.id}/impact-preview`);
  expect(impact.materiality).toBe("material");
  const sub = await w.lead.call<Body>("POST", `${T}/change-requests/${cr.id}/submit`, undefined, {
    ifMatch: cr.version,
  });
  expect((await w.lead.call<Body>("GET", `${T}/kpi-versions/${v2.id}`)).status).not.toBe("active");
  const appr = await w.bo.call<Body>("GET", `/api/v1/approvals/${sub.approvalId}`);
  await w.bo.call(
    "POST",
    `/api/v1/approvals/${sub.approvalId}/decisions`,
    {
      outcome: "approve",
      rationale: "Synthetic A07 decision (approves nothing real).",
      subjectVersion: appr.subjectVersion,
    },
    { ifMatch: appr.version },
  );
  expect((await w.lead.call<Body>("GET", `${T}/kpi-versions/${v2.id}`)).status).toBe("active");
  return v2.id;
}

test.describe.serial("A07 historical integrity", () => {
  test("an issued KPI register keeps target 100 after the target becomes 120; a reissue is version 2 with 120", async ({
    browser,
    playwright,
  }, info) => {
    test.setTimeout(240_000);
    const lang = langOf(info);
    const w = await setup(playwright, lang);
    const T = `/api/v1/transformations/${w.tid}`;
    const l = await asUser(browser, lang, w.leadUser);
    const page = l.page;
    const foreign = trackRequests(page);
    const row = () => page.locator(`[data-report-section] tr[data-record='${w.kpiId}']`).first();

    // ---- 0. the lead generates the KPI register and issues it in the UI (version 1, target 100)
    let v1Snapshot = "";
    let v1Sha = "";
    await test.step("0. issue the KPI register in the UI: version 1 shows target 100", async () => {
      const gen = await w.lead.call<Body>("POST", `${T}/reports/registers/generate`, {
        parameters: { register: "kpis" },
      });
      v1Snapshot = gen.id;
      await page.goto(`/transformations/${w.tid}/reports/${gen.id}`);
      await expect(page.locator("[data-snapshot-status]")).toHaveAttribute("data-snapshot-status", "generated");
      await expect(page.locator("[data-state='draft-not-issued']")).toBeVisible();
      await page.getByRole("button", { name: tr(lang, "reportsP5.snapshot.issue"), exact: true }).click();
      await expect(page.locator("[data-snapshot-status]")).toHaveAttribute("data-snapshot-status", "issued");
      await expect(page.locator("[data-issue-version]")).toHaveAttribute("data-issue-version", "1");
      expect(await rowNumbers(row())).toContain("100");
      const read = await w.lead.call<Body>("GET", `${T}/report-snapshots/${gen.id}`);
      expect([read.status, read.issueVersion]).toEqual(["issued", 1]);
      v1Sha = read.contentSha256;
      await checkPage(page, lang, "a07-issued-v1-target-100");
    });

    // ---- the later target change (approved by the synthetic Business Owner)
    const v2 = await changeTarget(w);

    await test.step("1. the issued snapshot still shows 100, version 1, the same SHA-256 and KPI version 1; live shows 120", async () => {
      await page.goto(`/transformations/${w.tid}/reports/${v1Snapshot}`);
      await expect(page.locator("[data-snapshot-status]")).toHaveAttribute("data-snapshot-status", "issued");
      await expect(page.locator("[data-issue-version]")).toHaveAttribute("data-issue-version", "1");
      await expect(page.locator(`[data-sha256='${v1Sha}']`).first()).toBeAttached();
      const numbers = await rowNumbers(row());
      expect(numbers).toContain("100");
      expect(numbers).not.toContain("120");
      await expect(page.locator("[data-table='snapshot-versions'] [data-version-kind='kpi_version']")).toHaveCount(1);
      const versions = await w.lead.call<Body>("GET", `${T}/report-snapshots/${v1Snapshot}/versions`);
      expect(
        (versions.items as Body[]).filter((x) => x.versionKind === "kpi_version").map((x) => x.referenceId),
      ).toEqual([w.v1]);
      await checkPage(page, lang, "a07-issued-v1-after-target-change");

      const live = await w.lead.call<Body>(
        "GET",
        `${T}/reports/registers/live?parameters=${encodeURIComponent('{"register":"kpis"}')}`,
      );
      expect(JSON.stringify(live.document)).toContain(w.kpiId);
      await page.goto(`/transformations/${w.tid}/reports`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const gen = page.locator("section").filter({
        has: page.getByRole("heading", { name: tr(lang, "reportsP5.generate.title") }),
      });
      await gen.getByLabel(new RegExp(`^${tr(lang, "reportsP5.generate.output")}`)).selectOption("registers");
      await gen.getByLabel(new RegExp(`^${tr(lang, "reportsP5.generate.register")}`)).selectOption("kpis");
      await gen.getByRole("button", { name: tr(lang, "reportsP5.generate.preview"), exact: true }).click();
      await expect(row()).toBeVisible();
      const liveNumbers = await rowNumbers(row());
      expect(liveNumbers).toContain("120");
      expect(liveNumbers).not.toContain("100");
      await checkPage(page, lang, "a07-live-register-target-120");
    });

    await test.step("2. a reissue with a reason, issued in the UI, is version 2 with 120; version 1 is superseded and unchanged", async () => {
      await page.goto(`/transformations/${w.tid}/reports/${v1Snapshot}`);
      const reissue = page.locator("section#reissue, #reissue").first();
      await reissue
        .getByLabel(new RegExp(tr(lang, "reportsP5.field.reason")))
        .fill("Synthetic A07: target restated to 120");
      await reissue.getByRole("button", { name: tr(lang, "reportsP5.snapshot.reissue"), exact: true }).click();
      await expect(page).not.toHaveURL(new RegExp(`${v1Snapshot}$`));
      await expect(page.locator("[data-snapshot-status]")).toHaveAttribute("data-snapshot-status", "generated");
      const reissueId = new URL(page.url()).pathname.split("/").pop()!;
      await page.getByRole("button", { name: tr(lang, "reportsP5.snapshot.issue"), exact: true }).click();
      await expect(page.locator("[data-snapshot-status]")).toHaveAttribute("data-snapshot-status", "issued");
      await expect(page.locator("[data-issue-version]")).toHaveAttribute("data-issue-version", "2");
      expect(await rowNumbers(row())).toContain("120");
      const v2Read = await w.lead.call<Body>("GET", `${T}/report-snapshots/${reissueId}`);
      expect([v2Read.issueVersion, v2Read.reissueOfId]).toEqual([2, v1Snapshot]);
      const v2Versions = await w.lead.call<Body>("GET", `${T}/report-snapshots/${reissueId}/versions`);
      expect((v2Versions.items as Body[]).map((x) => x.referenceId)).toContain(v2);
      await checkPage(page, lang, "a07-reissue-v2-target-120");

      await page.goto(`/transformations/${w.tid}/reports/${v1Snapshot}`);
      await expect(page.locator("[data-snapshot-status]")).toHaveAttribute("data-snapshot-status", "superseded");
      await expect(page.locator("[data-state='superseded']")).toBeVisible();
      await expect(page.locator("[data-issue-version]")).toHaveAttribute("data-issue-version", "1");
      await expect(page.locator(`[data-sha256='${v1Sha}']`).first()).toBeAttached();
      const numbers = await rowNumbers(row());
      expect(numbers).toContain("100");
      expect(numbers).not.toContain("120");
      const v1Read = await w.lead.call<Body>("GET", `${T}/report-snapshots/${v1Snapshot}`);
      expect([v1Read.status, v1Read.contentSha256, v1Read.issueVersion]).toEqual(["superseded", v1Sha, 1]);
      await checkPage(page, lang, "a07-v1-superseded-unchanged");
    });
    expect(foreign).toEqual([]);
    await l.close();
  });
});
