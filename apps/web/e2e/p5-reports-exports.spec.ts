// FE-E screens against the REAL API (apps/web/e2e/support/with-stack.sh; T-DG5-FE-E; slice F): each screen's main path
// and its main refusal, in EN and AR, with axe (no serious or critical violation) and a screenshot. Each test works in
// its own fresh SYNTHETIC transformation created by the synthetic Transformation Lead (`dev.lead`, TL of SYN-RETAIL).
//  - REQ-S13-004 / S13-007 / S13-008 reports: the register output previews live (not stored), generates a snapshot
//    that says "Draft — not an issued report"; a stale issue (issued meanwhile through the API) is refused with its
//    translated problem and the screen reloads as issued; a reissue (reason) is generated and issued as v2, and v1 is
//    superseded with its content unchanged.
//  - REQ-S13-005 exports: an export started from a snapshot is an asynchronous job with its progress, listed under
//    "Your exports" and cancelled there; exporting a snapshot discarded meanwhile is refused (422
//    export.snapshot_discarded). The e2e stack runs no worker, so a job stays queued until cancelled: that is the real
//    state of an unrendered job; the rendering itself is covered by the worker's own tests (BE-M, BE-N).
//  - REQ-S09-011 owner updates: in an open period created for the test, the transformation's update submitted empty is
//    refused (422 owner_update.empty) and stays a saved draft; written and submitted, it shows "Submitted".
//  - REQ-S10-013 presentation: a meeting's presentation is live; a snapshot of another meeting is refused (422
//    presentation.snapshot_mismatch).
//  - REQ-S13-010 evidence register: a note shows "No checksum" and "Not stated".
// All data is SYNTHETIC. Nothing here is a business approval, and nothing touches the engineering gates DG0-DG7.
import { expect, test, type Page } from "@playwright/test";
import {
  SYN_RETAIL,
  apiSession,
  expectAccessible,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
  type Lang,
} from "./support/ui.ts";

const ORG = "01920000-0000-7000-9000-000000000001";
const h1 = (page: Page) => page.locator("main#main h1");
const alertOf = (page: Page) => page.locator("main [role='alert']").first();

async function newTransformation(lead: ApiSession, lang: Lang, what: string): Promise<{ id: string; code: string }> {
  return lead.call<{ id: string; code: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-E ${lang.toUpperCase()} ${what}`,
    mode: "end_to_end",
  });
}

const SNAPSHOT_URL = /\/transformations\/[0-9a-f-]+\/reports\/([0-9a-f-]{36})$/;

test("Reports: live preview, a generated draft snapshot, a stale issue refused, reissue v2 and v1 superseded", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");
  const t = await newTransformation(lead, lang, "reports");
  const T = `/api/v1/transformations/${t.id}`;
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${t.id}/reports`);
  await expect(h1(page)).toHaveText(tr(lang, "reportsP5.reports.title"));
  const form = page.locator("[data-form='generate-report']");
  await form.locator("#report-definition").selectOption("registers");
  await form.locator("#report-register").selectOption("raid");
  await form.getByRole("button", { name: tr(lang, "reportsP5.generate.preview") }).click();
  const preview = page.locator("[data-live-preview='registers']");
  await expect(preview.locator("[data-state='live-not-stored']")).toBeVisible();
  await expect(preview.locator("[data-transformation-code='true']")).toHaveText(t.code);
  await expectAccessible(page, lang, "p5-reports");
  await shot(page, lang, "p5-reports");
  // Generate: the snapshot opens as a draft, never mistaken for an issued report.
  await form.getByRole("button", { name: tr(lang, "reportsP5.generate.submit") }).click();
  await expect(page).toHaveURL(SNAPSHOT_URL);
  const v1 = SNAPSHOT_URL.exec(page.url())![1]!;
  await expect(page.locator("[data-state='draft-not-issued']")).toHaveText(tr(lang, "reportsP5.snapshot.draftBanner"));
  await expect(page.locator("[data-document-facts] [data-transformation-code='true']")).toHaveText(t.code);
  await expectAccessible(page, lang, "p5-report-snapshot-draft");
  await shot(page, lang, "p5-report-snapshot-draft");
  // The refusal: the snapshot is issued meanwhile (through the API); issuing the stale screen is refused, translated.
  await lead.call("POST", `${T}/report-snapshots/${v1}/issue`, {}, { ifMatch: 1 });
  await page
    .locator("[data-form='issue-snapshot']")
    .getByRole("button", { name: tr(lang, "reportsP5.snapshot.issue") })
    .click();
  // The screen reloads as issued, and the translated refusal stays visible above the actions.
  await expect(page.locator("[data-snapshot-status='issued']").first()).toBeVisible();
  const alert = page.locator("[data-snapshot-actions] [role='alert']");
  await expect(alert).toHaveAttribute("data-problem", /^(version_conflict|report_snapshot\.not_generated)$/);
  await expect(page.locator("[data-issue-version='1']")).toBeVisible();
  await shot(page, lang, "p5-report-snapshot-stale-issue");
  // Reissue from the current records (a reason is required), then issue it: v2; v1 becomes superseded.
  const reissue = page.locator("[data-form='reissue-snapshot']");
  await reissue.locator("textarea").fill("Synthetic: the RAID register changed");
  await reissue.getByRole("button", { name: tr(lang, "reportsP5.snapshot.reissue") }).click();
  await expect(page).not.toHaveURL(new RegExp(`${v1}$`));
  await expect(page.locator("[data-state='draft-not-issued']")).toBeVisible();
  await page
    .locator("[data-form='issue-snapshot']")
    .getByRole("button", { name: tr(lang, "reportsP5.snapshot.issue") })
    .click();
  await expect(page.locator("[data-issue-version='2']")).toBeVisible();
  await expectAccessible(page, lang, "p5-report-snapshot-issued");
  await shot(page, lang, "p5-report-snapshot-issued-v2");
  await page.goto(`/transformations/${t.id}/reports/${v1}`);
  await expect(page.locator("[data-state='superseded']")).toBeVisible();
  await expect(page.locator("[data-issue-version='1']")).toBeVisible();
  await shot(page, lang, "p5-report-snapshot-superseded");
  expect(foreign).toEqual([]);
});

test("Exports: an asynchronous job with progress, listed and cancelled; a snapshot discarded meanwhile is refused", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(90_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");
  const t = await newTransformation(lead, lang, "exports");
  const T = `/api/v1/transformations/${t.id}`;
  const gen = () =>
    lead.call<{ id: string }>("POST", `${T}/reports/registers/generate`, {
      parameters: { register: "raid", filters: {} },
    });
  const s1 = await gen();
  const s2 = await gen();
  await signIn(page, lang, "dev.lead");
  // The refusal first: s2's screen is open, s2 is discarded meanwhile, the export is refused (translated).
  await page.goto(`/transformations/${t.id}/reports/${s2.id}`);
  const exportForm = page.locator("[data-form='create-export']");
  await expect(exportForm).toBeVisible();
  await lead.call("POST", `${T}/report-snapshots/${s2.id}/discard`, { reason: "Synthetic discard" }, { ifMatch: 1 });
  await exportForm.getByRole("button", { name: tr(lang, "reportsP5.exports.start") }).click();
  await expect(alertOf(page)).toHaveAttribute("data-problem", "export.snapshot_discarded");
  await expect(alertOf(page)).toContainText(tr(lang, "problems.export__snapshot_discarded"));
  await shot(page, lang, "p5-export-refused-discarded");
  // The main path: export s1 as CSV in the other language; the job shows its progress.
  await page.goto(`/transformations/${t.id}/reports/${s1.id}`);
  const form = page.locator("[data-form='create-export']");
  await form.locator("#export-format").selectOption("csv");
  await form.locator("#export-language").selectOption(lang === "en" ? "ar" : "en");
  await form.getByRole("button", { name: tr(lang, "reportsP5.exports.start") }).click();
  const started = page.locator("[data-started-export] [data-export-status]");
  await expect(started).toHaveAttribute("data-export-status", /queued|running|succeeded/);
  await expect(page.locator("[data-started-export] progress")).toBeVisible();
  await shot(page, lang, "p5-export-started");
  // Your exports: the job, its progress, cancel (If-Match).
  await page.goto(`/transformations/${t.id}/exports`);
  await expect(h1(page)).toHaveText(tr(lang, "reportsP5.exports.title"));
  const row = page.locator("[data-export-row]").first();
  await expect(row.locator("[data-export-status]")).toHaveAttribute("data-export-status", /queued|running|succeeded/);
  await expectAccessible(page, lang, "p5-exports");
  await shot(page, lang, "p5-exports");
  const status = await row.locator("[data-export-status]").getAttribute("data-export-status");
  if (status === "queued" || status === "running") {
    await row.getByRole("button", { name: tr(lang, "reportsP5.exports.cancel") }).click();
    await expect(row.locator("[data-export-status]")).toHaveAttribute("data-export-status", "cancelled");
    await shot(page, lang, "p5-exports-cancelled");
  }
  expect(foreign).toEqual([]);
});

test("Owner updates: an empty submit is refused and stays a draft; written and submitted it is Submitted", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(90_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");
  const office = await apiSession(playwright, "dev.office");
  const t = await newTransformation(lead, lang, "updates");
  // One open monthly period of the organization for this test (a free month: periods never overlap).
  const P = `/api/v1/organizations/${ORG}/reporting-periods`;
  let periodId = "";
  for (let i = 0; i < 120 && !periodId; i++) {
    const n = (lang === "en" ? 0 : 60) + i;
    const y = 2041 + Math.floor(n / 12);
    const mm = String((n % 12) + 1).padStart(2, "0");
    const last = new Date(Date.UTC(y, (n % 12) + 1, 0)).getUTCDate();
    try {
      const p = await office.call<{ id: string; version: number }>(
        "POST",
        P,
        {
          frequency: "monthly",
          periodLabel: `${y}-${mm}`,
          periodStart: `${y}-${mm}-01`,
          periodEnd: `${y}-${mm}-${last}`,
        },
        { expect: 201 },
      );
      await office.call("POST", `${P}/${p.id}/open`, undefined, { ifMatch: p.version });
      periodId = p.id;
    } catch {
      // that month exists already: try the next one
    }
  }
  expect(periodId, "an open monthly period").not.toBe("");
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${t.id}/owner-updates`);
  await expect(h1(page)).toHaveText(tr(lang, "reportsP5.updates.title"));
  await page.locator("#update-period").selectOption(periodId);
  const card = page.locator(`[data-update-subject='${t.code}']`);
  await expect(card).toHaveAttribute("data-update-status", "none");
  await expect(card).toContainText(tr(lang, "reportsP5.updates.status.none"));
  await expectAccessible(page, lang, "p5-owner-updates");
  await shot(page, lang, "p5-owner-updates");
  // The refusal: submitting with no field written (the draft is saved, the submit is refused, translated).
  await card.getByRole("button", { name: new RegExp(tr(lang, "reportsP5.updates.write")) }).click();
  await card.getByRole("button", { name: tr(lang, "reportsP5.updates.submit"), exact: true }).click();
  await expect(card.locator("[role='alert']")).toHaveAttribute("data-problem", "owner_update.empty");
  await expect(card.locator("[role='alert']")).toContainText(tr(lang, "problems.owner_update__empty"));
  await shot(page, lang, "p5-owner-update-empty-refused");
  await card.getByRole("button", { name: tr(lang, "reportsP5.updates.cancel") }).click();
  await expect(card).toHaveAttribute("data-update-status", "draft");
  await expect(card.locator("[data-state='draft-not-submitted']")).toBeVisible();
  // Written and submitted.
  await card.getByRole("button", { name: new RegExp(tr(lang, "reportsP5.updates.edit")) }).click();
  await card.locator("#update-achievements").fill("Synthetic: the pilot stores went live.");
  await card.locator("#update-asks").fill("Synthetic: confirm the wave 2 budget.");
  await card.getByRole("button", { name: tr(lang, "reportsP5.updates.submit"), exact: true }).click();
  await expect(card).toHaveAttribute("data-update-status", "submitted");
  await expect(card.locator("[data-update-field='achievements']")).toContainText(
    "Synthetic: the pilot stores went live.",
  );
  await expectAccessible(page, lang, "p5-owner-update-submitted");
  await shot(page, lang, "p5-owner-update-submitted");
  expect(foreign).toEqual([]);
});

test("Presentation: a meeting's pack is live; a snapshot of another meeting is refused", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(90_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");
  const t = await newTransformation(lead, lang, "presentation");
  const T = `/api/v1/transformations/${t.id}`;
  const forums = await lead.call<{ items: { id: string; templateKey: string }[] }>("GET", `${T}/forums`);
  const forum = forums.items.find((f) => f.templateKey === "executive_steerco") ?? forums.items[0]!;
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const meeting = (n: number) =>
    lead.call<{ id: string }>("POST", `${T}/meetings`, {
      forumId: forum.id,
      scheduledDate: day(n),
      startTime: "10:00",
      durationMinutes: 60,
    });
  const a = await meeting(20);
  const b = await meeting(27);
  const packOfB = await lead.call<{ id: string }>("POST", `${T}/reports/meeting_pack/generate`, { subjectId: b.id });
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${t.id}/meetings/${a.id}`);
  await page.locator("[data-link='presentation'] a").click();
  await expect(h1(page)).toHaveText(tr(lang, "reportsP5.presentation.title"));
  await expect(page.locator("[data-presentation-loaded='live']")).toBeVisible();
  await expect(page.locator("[data-state='live-mode']")).toHaveText(tr(lang, "reportsP5.presentation.liveNote"));
  await expectAccessible(page, lang, "p5-presentation");
  await shot(page, lang, "p5-presentation-live");
  // The refusal: meeting B's pack asked for in meeting A's presentation.
  await page.goto(`/transformations/${t.id}/meetings/${a.id}/presentation?snapshotId=${packOfB.id}`);
  await expect(page.locator("main [role='alert']").first()).toContainText(
    tr(lang, "problems.presentation__snapshot_mismatch"),
  );
  await shot(page, lang, "p5-presentation-mismatch");
  // B's own pack in B's presentation: the snapshot mode.
  await page.goto(`/transformations/${t.id}/meetings/${b.id}/presentation?snapshotId=${packOfB.id}`);
  await expect(page.locator(`[data-presentation-snapshot='${packOfB.id}']`)).toBeVisible();
  await expect(page.locator("[data-state='snapshot-mode']")).toBeVisible();
  expect(foreign).toEqual([]);
});

test("Evidence register: a note shows no checksum and Not stated; the register is read-only for the auditor", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(60_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");
  const t = await newTransformation(lead, lang, "evidence");
  const T = `/api/v1/transformations/${t.id}`;
  await lead.call("POST", `${T}/evidence`, {
    kind: "note",
    title: `Synthetic note ${lang}`,
    ownerUserId: lead.userId,
    evidenceType: "observation",
    noteBody: "Synthetic observation from the pilot stores.",
  });
  await signIn(page, lang, "dev.auditor");
  await page.goto("/evidence-reports/evidence-register");
  await expect(h1(page)).toHaveText(tr(lang, "reportsP5.evidence.title"));
  await page.goto(`/transformations/${t.id}/evidence-register`);
  const row = page.locator("[data-evidence-kind='note']").first();
  await expect(row).toContainText(`Synthetic note ${lang}`);
  await expect(row).toContainText(tr(lang, "reportsP5.evidence.noChecksum"));
  await expect(row.locator("[data-not-stated]")).toHaveCount(3);
  await expect(page.locator("main form")).toHaveCount(0);
  await expectAccessible(page, lang, "p5-evidence-register");
  await shot(page, lang, "p5-evidence-register");
  expect(foreign).toEqual([]);
});
