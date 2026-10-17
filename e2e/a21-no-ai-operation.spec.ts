// qa-verifier A21 "No-AI operation" (DG5, T-DG5-QA-E; REQ-S01-004): "Core lifecycle, approvals, calculations and
// reports still work with AI and external notification channels disabled". The stack (e2e/support/with-demo-stack.sh)
// configures no AI adapter, no e-mail or other external notification adapter and runs no export worker: P5 ships
// none (p5-plan l.356, D-142 Q11), so "disabled" is the shipped configuration and no setting is changed here.
// User-visible path asserted, in chromium-en and chromium-ar:
//  1. a report is generated in the UI from the transformation's records and its snapshot opens in status generated;
//  2. the generated snapshot is readable in the user's language (lang/dir) and axe finds 0 serious/critical issues;
//  3. no request leaves the application origin during the whole path (no AI service, no mail relay, no CDN).
// The lifecycle, approvals and calculations with the same configuration are proven through the real API in
// tests/qa/integration/a02-a21-complete-lifecycle.test.ts. Everything is synthetic; nothing names DG0-DG7.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  apiSession,
  expectAccessible,
  langOf,
  signIn,
  tr,
  trackRequests,
  SYN_RETAIL,
} from "../apps/web/e2e/support/ui.ts";

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a21");

test("A21: a report is generated in the UI from the records with no AI, external notification or export channel", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  const foreign = trackRequests(page);

  // Setup through the native API (the Transformation Office creates the transformation).
  const office = await apiSession(playwright, "dev.office");
  const t = await office.call<{ id: string }>(
    "POST",
    "/api/v1/transformations",
    { businessUnitId: SYN_RETAIL, name: `Synthetic QA A21 ${lang.toUpperCase()}`, mode: "end_to_end" },
    { expect: 201 },
  );
  await office.req.dispose();

  await signIn(page, lang, "dev.office");
  await page.goto(`/transformations/${t.id}/reports`);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await page.locator("#report-definition").selectOption("charter");
  await page.getByRole("button", { name: tr(lang, "reportsP5.generate.submit"), exact: true }).click();
  await page.waitForURL(new RegExp(`/transformations/${t.id}/reports/[0-9a-f-]{36}$`));
  await expect(page.locator("[data-snapshot-status]")).toHaveAttribute("data-snapshot-status", "generated");
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await page.screenshot({ path: path.join(dir, "a21-report-generated.png"), fullPage: true });
  await expectAccessible(page, lang, "a21-snapshot");
  expect(foreign).toEqual([]);
});
