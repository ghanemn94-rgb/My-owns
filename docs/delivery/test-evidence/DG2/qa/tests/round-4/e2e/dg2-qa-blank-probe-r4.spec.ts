// qa-verifier DG2 round 4 — diagnostic probe for F-DG2-210 (T-DG2-REV-QA-R4), adapted from dg2-qa-blank-probe-r3.
// Records the PATCH bodies the charter edit form sends when Out of scope is whitespace only (round 3: one PATCH
// {"changeSummary":"QA probe"} writing a content-free v2). Round-4 expectation: NO PATCH, versions unchanged.
// Then a control: visible text sends exactly one PATCH carrying the text verbatim. Real built SPA + API + PostgreSQL.
// All data is SYNTHETIC.
//   e2e/support/qa-stack-port.sh npx playwright test e2e/dg2-qa-blank-probe-r4.spec.ts --workers=1
import { expect, test } from "@playwright/test";
import { SYN_RETAIL, apiSession, fieldLabel, langOf, signIn, tr } from "../apps/web/e2e/support/ui.ts";

test("probe: no PATCH for a whitespace-only Out of scope; one verbatim PATCH for visible text", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const t = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `QA r4 probe ${lang} (synthetic)`,
    mode: "end_to_end",
  });
  const C = `/api/v1/transformations/${t.id}/charter`;
  await lead.call("POST", C, { transformationName: "QA r4 probe (synthetic)" });
  const bodies: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().endsWith("/charter")) bodies.push(r.postData() ?? "");
  });
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${t.id}/charter`);
  await page
    .getByRole("region", { name: tr(lang, "define.charter.fieldsTitle"), exact: true })
    .getByRole("button", { name: tr(lang, "define.charter.edit"), exact: true })
    .click();
  await page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope")).fill("   ");
  await page.getByLabel(fieldLabel(lang, "define.charter.changeSummary")).fill("QA probe");
  const response = page.waitForResponse((r) => r.request().method() === "PATCH", { timeout: 5000 }).catch(() => null);
  await page.getByRole("button", { name: tr(lang, "define.charter.saveVersion"), exact: true }).click();
  const res = await response;
  const versions = async () =>
    (await lead.call<{ items: { versionNo: number; changeSummary: string | null }[] }>("GET", `${C}/versions`)).items.map(
      (v) => [v.versionNo, v.changeSummary],
    );
  const v1 = await versions();
  console.log(`QA-R4 PROBE [${lang}] blank: PATCH bodies ${JSON.stringify(bodies)} -> status ${res?.status() ?? "none"}`);
  console.log(`QA-R4 PROBE [${lang}] blank: charter versions ${JSON.stringify(v1)}`);
  expect(bodies).toEqual([]);
  expect(v1).toEqual([[1, null]]);

  await page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope")).fill(" Wholesale (synthetic) ");
  const response2 = page.waitForResponse((r) => r.request().method() === "PATCH", { timeout: 5000 });
  await page.getByRole("button", { name: tr(lang, "define.charter.saveVersion"), exact: true }).click();
  const res2 = await response2;
  const v2 = await versions();
  console.log(`QA-R4 PROBE [${lang}] visible: PATCH bodies ${JSON.stringify(bodies)} -> status ${res2.status()}`);
  console.log(`QA-R4 PROBE [${lang}] visible: charter versions ${JSON.stringify(v2)}`);
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0]!)).toEqual({ outOfScope: " Wholesale (synthetic) ", changeSummary: "QA probe" });
  expect(res2.status()).toBe(200);
  expect(v2).toHaveLength(2);
});
