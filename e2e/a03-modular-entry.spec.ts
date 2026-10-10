// A03 "Modular entry", acceptance-level UI check on the REAL stack (qa-verifier, T-DG4-QA-C;
// apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, migrate, seed-dev, API serving the built SPA; no worker, no
// mocks). Run in chromium-en (English, LTR) and chromium-ar (Arabic, RTL).
// Scenario (master prompt §20 A03): "Existing transformation enters at Design with inherited evidence; missing
// baseline/outcome links are flagged and cannot silently pass gates." (REQ-PB-005, REQ-S03-005, REQ-S20-003)
//  1. The Modular-entry screen of a transformation entering at Design with an inherited G2 approval and no baseline or
//     outcome link shows both links as blocking missing items, G2 labelled Inherited and no gate labelled Approved.
//  2. On the G3 gate screen (every G3 criterion covered, so the submit control is enabled) the Lead submits: the dialog
//     shows the refusal gate.modular_links_missing listing both missing links, in the page's language, and the gate
//     stays unsubmitted (checked through the API).
// Each screen: <html lang dir> of the language, and axe with 0 serious or critical violations.
// Fixtures are created through the public API by the seeded synthetic dev users and fresh synthetic users. Screenshots
// go to QA_EVIDENCE_DIR (default test-results/qa-c). All data is SYNTHETIC; the inherited approval, exceptions and
// acceptances are synthetic in-product business actions that approve nothing real, and product gates G1-G6 never imply
// any engineering gate DG0-DG7.
/// <reference lib="dom" />
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { asUser, syntheticUser } from "../apps/web/e2e/support/p3-journey-setup.ts";
import {
  apiSession,
  expectAccessible,
  langOf,
  SYN_RETAIL,
  tr,
  type ApiSession,
  type Lang,
} from "../apps/web/e2e/support/ui.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const EVIDENCE_DIR = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-c");
const stamp = Date.now().toString(36);

let tid = "";
let base = "";
let lead: ApiSession;
let sponsor: ApiSession;

async function shot(page: Page, lang: Lang, name: string) {
  const dir = path.join(EVIDENCE_DIR, lang);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

async function expectDocumentLanguage(page: Page, lang: Lang) {
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const office = await apiSession(playwright, "dev.office");
  const admin = await apiSession(playwright, "dev.admin");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic QA A03 Modular entry ${lang.toUpperCase()} ${stamp}`,
      mode: "modular",
      entryPhase: "design",
    })
  ).id;
  base = `/api/v1/transformations/${tid}`;
  const me = await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me");
  const sp = await syntheticUser(
    admin,
    me.organization.id,
    tid,
    `dev.qa-a03.sp.${lang}.${stamp}`,
    `Synthetic Waiver Sponsor qa-a03 ${lang}`,
    "SP",
    lang,
  );
  sponsor = await apiSession(playwright, sp.username);
  // The inherited G2 approval: verified evidence of the earlier approval, recorded by the Lead, accepted by the
  // synthetic Sponsor (an annotation, never a platform gate decision).
  const ev = await lead.call<{ id: string; version: number }>("POST", `${base}/evidence`, {
    kind: "note",
    title: "Synthetic QA prior G2 approval minute",
    ownerUserId: lead.userId,
    noteBody: "Synthetic minute of an earlier G2 approval.",
  });
  await office.call(
    "POST",
    `${base}/evidence/${ev.id}/review`,
    { result: "verified", accessibilityStatus: "accessible", note: "Synthetic QA review" },
    { ifMatch: ev.version },
  );
  const disp = await lead.call<{ id: string; version: number }>("POST", `${base}/gate-dispensations`, {
    kind: "inherited_approval",
    gateCode: "G2",
    approvingBody: "Synthetic QA prior programme board",
    approvedOn: "2026-01-15",
    evidenceId: ev.id,
  });
  await sponsor.call(
    "POST",
    `${base}/gate-dispensations/${disp.id}/decision`,
    { result: "accepted", note: "Synthetic QA acceptance (approves nothing real)" },
    { ifMatch: disp.version },
  );
  // Every mandatory G3 criterion covered by an exception the Lead requests and the Sponsor accepts, so only the
  // Modular-links precondition can refuse the submission.
  const expiresOn = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const view = await lead.call<Body>("GET", `${base}/gates/G3`);
  for (const c of view.criteria as Body[]) {
    if (!c.mandatory || c.completeness === "complete") continue;
    const ex = await lead.call<{ id: string; version: number }>("POST", `${base}/gate-exceptions`, {
      gateCode: "G3",
      criterionKey: c.key,
      reason: "Synthetic QA: criterion not exercised by the A03 acceptance check.",
      scope: `Synthetic QA: ${c.key} only`,
      compensatingAction: "Synthetic QA: complete before G4.",
      compensatingOwnerUserId: lead.userId,
      expiresOn,
    });
    await sponsor.call(
      "POST",
      `${base}/gate-exceptions/${ex.id}/decision`,
      { outcome: "accepted", note: "Synthetic QA decision" },
      { ifMatch: ex.version },
    );
  }
  const ready = await lead.call<Body>("GET", `${base}/gates/G3`);
  expect(ready.canSubmit, JSON.stringify(ready.criteria)).toBe(true);
});

test("A03 1. Modular entry at Design: baseline and outcome links flagged as blocking; G2 inherited, nothing approved", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  await page.goto(`/transformations/${tid}/modular-entry`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await expectDocumentLanguage(page, lang);
  await expect(page.locator("[data-mode='modular'][data-entry-phase='design']")).toBeVisible();
  await expect(page.locator("[data-missing='baseline_missing'][data-severity='blocking']")).toBeVisible();
  await expect(page.locator("[data-missing='outcome_link_missing'][data-severity='blocking']")).toBeVisible();
  await expect(page.locator("[data-gate='G2']")).toHaveAttribute("data-gate-label", "inherited");
  await expect(page.locator("[data-gate='G2']")).toContainText(tr(lang, "traceability.inheritedLabel"));
  await expect(page.locator("[data-gate-label='approved']")).toHaveCount(0);
  // The API reports the same two blocking links.
  const links = await lead.call<Body>("GET", `${base}/missing-links`);
  expect((links.items as Body[]).filter((i) => i.severity === "blocking").map((i) => i.code)).toEqual(
    expect.arrayContaining(["baseline_missing", "outcome_link_missing"]),
  );
  await shot(page, lang, "a03-01-modular-entry-missing-links");
  await expectAccessible(page, lang, "qa-a03-modular-entry");
  await tl.close();
});

test("A03 2. G3 submission is refused on screen with gate.modular_links_missing listing both links; G3 stays unsubmitted", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  await page.goto(`/transformations/${tid}/gates/G3`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await expectDocumentLanguage(page, lang);
  await page.getByRole("button", { name: tr(lang, "gates.submit.action"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: tr(lang, "gates.submit.confirm"), exact: true }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveAttribute("data-problem", "gate.modular_links_missing");
  const items = alert.locator("[data-modular-links-missing] [data-missing-link]");
  await expect(items).toHaveCount(2);
  await expect(alert.locator("[data-missing-link='baseline_missing']")).toContainText(
    tr(lang, "problems.baseline_missing"),
  );
  await expect(alert.locator("[data-missing-link='outcome_link_missing']")).toContainText(
    tr(lang, "problems.outcome_link_missing"),
  );
  await expect(alert).toContainText(tr(lang, "problems.gate__modular_links_missing"));
  await shot(page, lang, "a03-02-g3-refused-modular-links");
  await expectAccessible(page, lang, "qa-a03-g3-refusal");
  // Not silently passed: no submission was recorded.
  const g3 = await lead.call<Body>("GET", `${base}/gates/G3`);
  expect(g3.gate.status).toBe("draft");
  expect(g3.currentSubmission).toBeNull();
  await tl.close();
});
