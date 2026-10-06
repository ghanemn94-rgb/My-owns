// qa-verifier DG2 round 3 — diagnostic probe for F-DG2-210 (T-DG2-REV-QA-R3). Authored by qa-verifier. Records the
// exact PATCH body the charter edit form sends when Out of scope is filled with whitespace only, and the charter
// versions that result. Real built SPA + API + PostgreSQL (e2e/support/qa-stack.sh). All data is SYNTHETIC.
//   e2e/support/qa-stack.sh npx playwright test e2e/dg2-qa-blank-probe-r3.spec.ts --project chromium-en --workers=1
import { expect, test } from "@playwright/test";
import { SYN_RETAIL, apiSession, fieldLabel, signIn, tr } from "../apps/web/e2e/support/ui.ts";

test("probe: the PATCH body for a whitespace-only Out of scope, and the resulting charter versions", async ({
  page,
  playwright,
}) => {
  const lead = await apiSession(playwright, "dev.lead");
  const t = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: "QA r3 probe (synthetic)",
    mode: "end_to_end",
  });
  const C = `/api/v1/transformations/${t.id}/charter`;
  await lead.call("POST", C, { transformationName: "QA r3 probe (synthetic)" });
  const bodies: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().endsWith("/charter")) bodies.push(r.postData() ?? "");
  });
  await signIn(page, "en", "dev.lead");
  await page.goto(`/transformations/${t.id}/charter`);
  await page
    .getByRole("region", { name: tr("en", "define.charter.fieldsTitle"), exact: true })
    .getByRole("button", { name: tr("en", "define.charter.edit"), exact: true })
    .click();
  await page.getByLabel(fieldLabel("en", "define.charter.field.outOfScope")).fill("   ");
  await page.getByLabel(fieldLabel("en", "define.charter.changeSummary")).fill("QA probe");
  const response = page.waitForResponse((r) => r.request().method() === "PATCH", { timeout: 5000 }).catch(() => null);
  await page.getByRole("button", { name: tr("en", "define.charter.saveVersion"), exact: true }).click();
  const res = await response;
  const versions = await lead.call<{ items: { versionNo: number; changeSummary: string | null }[] }>(
    "GET",
    `${C}/versions`,
  );
  console.log(`QA-R3 PROBE PATCH bodies: ${JSON.stringify(bodies)} -> status ${res?.status()}`);
  console.log(`QA-R3 PROBE charter versions: ${JSON.stringify(versions.items.map((v) => [v.versionNo, v.changeSummary]))}`);
  expect(bodies.length).toBe(1);
});
