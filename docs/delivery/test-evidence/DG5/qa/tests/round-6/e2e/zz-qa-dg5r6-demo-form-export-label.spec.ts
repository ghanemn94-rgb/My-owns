// qa-verifier DG5 round 6 (T-DG5-REV-QA-R6): REQ-S18-001 / REQ-PB-089 ("every demo ... export shows the synthetic label
// in en and ar") for the form framework's own export after repair T-DG5-BE-AA1 (F-DG5-124; the domain reviewer owns
// that finding: this is the qa acceptance check of the clause, not its closure). On the REAL demo stack
// (e2e/support/with-demo-stack.sh), chromium-en and chromium-ar, signed in as roaming.user.tl through the dev sign-in
// (D-165), THROUGH THE UI: the T01 (Diagnose) and T14 (Benefits register) "Export" dialogs, the CSV link and the JSON
// button are clicked and the downloaded files are read. Expected: the CSV's first line is BOM + the label of the page
// language, then the header; the JSON has illustrativeLabel = the same label. The label strings are the ADR-0050 §2
// texts. Revision 2: see the comment in the test. NOT part of the candidate. Everything is SYNTHETIC; nothing names or approves DG0-DG7 or G1-G6.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { langOf } from "../apps/web/e2e/support/ui.ts";
import { demoApi, demoPage } from "./support/a02-demo.ts";

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-r6-export");
const ROAMING = "01995000-0000-7000-8000-000000000001";
const LABEL = { en: "Illustrative example — synthetic", ar: "مثال توضيحي — اصطناعي" } as const;
const BOM = "﻿";

test("R6-EXPORT-LABEL: T01 and T14 form exports (CSV link, JSON button) downloaded through the UI carry the label", async ({ browser, playwright }, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  // Revision 2: the T14 Export button is on a benefit RECORD page (BenefitPage.tsx), not on the register page; the first
  // seeded benefit of the roaming transformation is opened (revision 1 waited for the button on /benefits and timed out).
  const tlApi = await demoApi(playwright, "tl");
  const benefits = await tlApi.call<{ items: { id: string }[] }>("GET", `/api/v1/transformations/${ROAMING}/benefits?limit=5`);
  const benefitId = benefits.items[0]!.id;
  const p = await demoPage(browser, lang, "tl");
  const out: Record<string, unknown> = {};
  for (const [rt, url] of [["T01", `/transformations/${ROAMING}/diagnose`], ["T14", `/transformations/${ROAMING}/benefits/${benefitId}`]] as const) {
    await p.goto(url);
    await expect(p.locator("main#main h1")).toBeVisible();
    await p.locator(`button[data-export='${rt}']`).first().click();
    const dlg = p.getByRole("dialog");
    await expect(dlg.locator("[data-export-rows]")).toBeVisible({ timeout: 20_000 });
    const [csvDl] = await Promise.all([p.waitForEvent("download"), dlg.locator("[data-download='csv']").click()]);
    const csvPath = path.join(dir, `r6-${rt}-${lang}.csv`);
    await csvDl.saveAs(csvPath);
    const [jsonDl] = await Promise.all([p.waitForEvent("download"), dlg.locator("[data-download='json']").click()]);
    const jsonPath = path.join(dir, `r6-${rt}-${lang}.json`);
    await jsonDl.saveAs(jsonPath);
    const csv = readFileSync(csvPath, "utf8");
    const lines = csv.split("\r\n");
    const json = JSON.parse(readFileSync(jsonPath, "utf8")) as { illustrativeLabel: string | null; language: string; rows: unknown[] };
    out[rt] = { csvFirst: lines[0], csvSecond: lines[1]?.slice(0, 60), csvLines: lines.length, jsonLabel: json.illustrativeLabel, jsonLanguage: json.language, jsonRows: json.rows.length };
    expect(lines[0], `${rt} CSV first line`).toBe(`${BOM}${LABEL[lang]}`);
    expect(lines.length, `${rt} CSV: label, header, records`).toBeGreaterThanOrEqual(3);
    expect(json.language).toBe(lang);
    expect(json.illustrativeLabel).toBe(LABEL[lang]);
    await p.keyboard.press("Escape");
  }
  writeFileSync(path.join(dir, "r6-export-label.json"), JSON.stringify(out, null, 1));
  console.info(`R6-EXPORT-LABEL ${lang}: ${JSON.stringify(out)}`);
  await p.context().close();
});
