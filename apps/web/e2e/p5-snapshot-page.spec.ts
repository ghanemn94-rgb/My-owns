// The report snapshot page against the REAL API (apps/web/e2e/support/with-stack.sh; T-DG5-FE-G2, QA-C O1): in the
// project's language (chromium-ar Arabic RTL, chromium-en English LTR) the SHA-256 checksum is one LTR run that stays
// inside its card (the full value kept), and the source-records table shows translated section and record-type labels
// ("Register", "RAID entry"), never the raw codes `register` and `raid_entry`. The main refusal: issuing a snapshot
// that was issued meanwhile is refused with its code. SYNTHETIC transformation and RAID entry; a snapshot is not a
// business approval.
import { expect, test } from "@playwright/test";
import { SYN_RETAIL, apiSession, expectAccessible, langOf, shot, signIn, tr, trackRequests } from "./support/ui.ts";

const SNAPSHOT_URL = /\/transformations\/[0-9a-f-]+\/reports\/([0-9a-f-]{36})$/;

test("Snapshot page: the checksum wraps inside its card as an LTR run; source records show translated labels; a stale issue is refused", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");
  const t = await lead.call<{ id: string; code: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-G2 ${lang.toUpperCase()} snapshot page`,
    mode: "end_to_end",
  });
  const T = `/api/v1/transformations/${t.id}`;
  await lead.call("POST", `${T}/raid`, {
    type: "risk",
    description: `Synthetic: the roaming tariff file may arrive late (${lang}).`,
    impact: "high",
    probability: "medium",
    ownerUserId: lead.userId,
  });

  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${t.id}/reports`);
  const form = page.locator("[data-form='generate-report']");
  await form.locator("#report-definition").selectOption("registers");
  await form.locator("#report-register").selectOption("raid");
  await form.getByRole("button", { name: tr(lang, "reportsP5.generate.submit") }).click();
  await expect(page).toHaveURL(SNAPSHOT_URL);
  const id = SNAPSHOT_URL.exec(page.url())![1]!;

  // The checksum: 64 hex characters, LTR, inside its card (no overflow), the full value kept.
  const checksum = page.locator("main [data-sha256]").first();
  await expect(checksum).toHaveText(/^[0-9a-f]{64}$/);
  await expect(checksum).toHaveAttribute("dir", "ltr");
  const value = (await checksum.textContent())!;
  await expect(checksum).toHaveAttribute("title", value);
  const fits = await checksum.evaluate((el) => {
    const card = el.closest("section, .card")!;
    const a = el.getBoundingClientRect();
    const b = card.getBoundingClientRect();
    return a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && card.scrollWidth <= card.clientWidth + 1;
  });
  expect(fits, "the checksum stays inside its card").toBe(true);

  // The source records: translated labels, never the raw codes.
  const sources = page.locator("[data-table='snapshot-sources']");
  const row = sources.locator("tbody tr").first();
  await expect(row.locator("[data-section-key='register']")).toHaveText(tr(lang, "reportsP5.sourceSection.register"));
  await expect(row.locator("[data-record-type='raid_entry']")).toHaveText(
    tr(lang, "reportsP5.sourceRecordType.raid_entry"),
  );
  await expect(sources).not.toContainText("raid_entry");
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expectAccessible(page, lang, "p5-snapshot-page-labels");
  await shot(page, lang, "p5-snapshot-page-labels");

  // The main refusal: the snapshot was issued meanwhile (through the API), so the screen's issue is refused by code.
  await lead.call("POST", `${T}/report-snapshots/${id}/issue`, {}, { ifMatch: 1 });
  await page
    .locator("[data-form='issue-snapshot']")
    .getByRole("button", { name: tr(lang, "reportsP5.snapshot.issue") })
    .click();
  await expect(page.locator("[data-snapshot-actions] [role='alert']")).toHaveAttribute(
    "data-problem",
    /^(version_conflict|report_snapshot\.not_generated)$/,
  );
  await shot(page, lang, "p5-snapshot-page-refused");
  expect(foreign).toEqual([]);
});
