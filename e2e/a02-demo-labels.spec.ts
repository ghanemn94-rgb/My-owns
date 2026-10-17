// qa-verifier A02 (DG5, T-DG5-QA-E2): REQ-S18-001 and REQ-S21-001, RENDERED, on a REAL demo stack
// (e2e/support/with-demo-stack.sh: `mth-db seed-demo`, MTH_ENV=demo, the built SPA), in chromium-en and chromium-ar,
// signed in as the dataset's demo role users roaming.user.<role> through the dev sign-in (D-165). ADR-0050 §2:
//  (a) the persistent synthetic banner on EVERY visited screen, with its exact text in the language;
//  (b) the record badge "Illustrative example — synthetic" / "مثال توضيحي — اصطناعي" in record and form headers;
//  (c) "Synthetic demonstration - approves nothing real" / "عرض توضيحي اصطناعي - لا يعتمد أي شيء حقيقي" on every demo
//      product-gate decision, approval and Finance validation shown (REQ-S21-001, M0412);
//  (d) the illustrative label in a generated export: the file is produced by the REAL worker process
//      (apps/worker/dist/main.js) against the same database and downloaded through the API.
// Expected texts are the catalogue strings of the language (apps/web/src/i18n/<lang>/playbookP5.json), never the
// rendered DOM itself. Everything is SYNTHETIC and approves nothing real; nothing names DG0-DG7.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, langOf, trackRequests, type Lang } from "../apps/web/e2e/support/ui.ts";
import { readOoxml, xmlTexts } from "../packages/reporting/src/ooxml-read.ts";
import { startProductionWorker } from "./support/a13-a22-stack.ts";
import { DEMO_BU, catalogue, demoApi, demoPage, expectBanner } from "./support/a02-demo.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a02-labels");
/** The seeded International Roaming transformation (DEMO_TRANSFORMATION_ID). */
const ROAMING = "01995000-0000-7000-8000-000000000001";

test.setTimeout(240_000);

async function checkScreen(p: Page, lang: Lang, url: string): Promise<void> {
  await p.goto(url);
  await expect(p.locator("main#main h1")).toBeVisible();
  await expect(p.locator("html")).toHaveAttribute("lang", lang);
  await expect(p.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expectBanner(p, lang);
}

test("REQ-S18-001 / REQ-S21-001: banner on every visited screen, record badge in record headers, the synthetic approval label on demo G-approvals and Finance validations", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  const badge = catalogue(lang, "playbookP5.demo.recordBadge");
  const approvalLabel = catalogue(lang, "playbookP5.demo.approvalLabel");
  // The expected strings are the ADR-0050 §2 texts (the catalogue must not drift from them).
  expect(badge).toBe(lang === "en" ? "Illustrative example — synthetic" : "مثال توضيحي — اصطناعي");
  expect(approvalLabel).toBe(
    lang === "en" ? "Synthetic demonstration - approves nothing real" : "عرض توضيحي اصطناعي - لا يعتمد أي شيء حقيقي",
  );

  const tlApi = await demoApi(playwright, "tl");
  const created = await tlApi.call<Body>("POST", "/api/v1/transformations", {
    businessUnitId: DEMO_BU,
    name: `Synthetic QA-E2 ${lang.toUpperCase()} labels`,
    mode: "end_to_end",
  });
  const tl = await demoPage(browser, lang, "tl");
  const foreign: string[][] = [trackRequests(tl)];
  // (a) the banner on every screen the Lead visits, (b) the badge in record and form headers.
  const screens = [
    "/my-work",
    "/transformations",
    "/transformations/new",
    `/transformations/${created.id}`,
    `/transformations/${created.id}/edit`,
    `/transformations/${created.id}/diagnose`,
    `/transformations/${created.id}/gates`,
    `/transformations/${ROAMING}`,
    `/transformations/${ROAMING}/benefits`,
    `/walkthrough?transformationId=${created.id}`,
    "/playbook",
  ];
  for (const url of screens) await checkScreen(tl, lang, url);
  // (b) record headers: the badge in the header of each record view.
  for (const url of [
    `/transformations/${created.id}`,
    `/transformations/${created.id}/diagnose`,
    `/transformations/${ROAMING}`,
  ]) {
    await checkScreen(tl, lang, url);
    await expect(tl.locator("main [data-state='demo-record']").first(), `record badge on ${url}`).toHaveText(badge);
  }
  await tl.screenshot({ path: path.join(dir, "labels-record-header.png"), fullPage: true });
  await expectAccessible(tl, lang, "a02-labels-record");

  // (c) the seeded demo G-approvals of the roaming transformation, as the demo Sponsor.
  const spApi = await demoApi(playwright, "sp");
  const gates = await spApi.call<Body>("GET", `/api/v1/transformations/${ROAMING}/gates`);
  // Every product-gate page of the seeded transformation shows its G-gate decisions and approvals: each carries the label.
  const decided = (gates.items as Body[]).map((v) => v.gate);
  expect(decided.map((g) => g.gateCode)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6"]);
  const sp = await demoPage(browser, lang, "sp");
  foreign.push(trackRequests(sp));
  for (const g of decided) {
    await checkScreen(sp, lang, `/transformations/${ROAMING}/gates/${g.gateCode}`);
    const labels = sp.locator("[data-state='synthetic-approval']");
    await expect(labels.first(), `approval label on ${g.gateCode}`).toBeVisible();
    for (const text of await labels.allInnerTexts()) expect(text.trim()).toBe(approvalLabel);
  }
  await sp.screenshot({ path: path.join(dir, "labels-gate-approval.png"), fullPage: true });
  // Not covered here (handback §6): an approval opened from an inbox. The dataset routes no pending approval to a demo
  // role user, and a TOM change request needs an approved record, which the roaming canvas does not have.
  const fin = await demoPage(browser, lang, "fin");
  foreign.push(trackRequests(fin));
  await checkScreen(fin, lang, `/transformations/${ROAMING}/finance-validations`);
  await expect(fin.locator("[data-state='synthetic-approval']").first()).toHaveText(approvalLabel);
  await fin.screenshot({ path: path.join(dir, "labels-finance-queue.png"), fullPage: true });
  await expectAccessible(fin, lang, "a02-labels-finance");
  for (const p of [tl, sp, fin]) await p.context().close();
  await tlApi.req.dispose();
  await spApi.req.dispose();
  expect(foreign.flat()).toEqual([]);
});

test("REQ-S18-001 / ADR-0050 §2 b: the record badge in FORM headers (the edit form page and a create dialog)", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  const badge = catalogue(lang, "playbookP5.demo.recordBadge");
  const tlApi = await demoApi(playwright, "tl");
  const created = await tlApi.call<Body>("POST", "/api/v1/transformations", {
    businessUnitId: DEMO_BU,
    name: `Synthetic QA-E2 ${lang.toUpperCase()} form labels`,
    mode: "end_to_end",
  });
  const tl = await demoPage(browser, lang, "tl");
  const missing: string[] = [];
  // The edit form page of the record (its h1 header).
  await checkScreen(tl, lang, `/transformations/${created.id}/edit`);
  const editHeader = tl.locator("main#main h1").locator("xpath=..");
  if ((await editHeader.locator("[data-state='demo-record']").count()) === 0) missing.push("edit form page header");
  await tl.screenshot({ path: path.join(dir, "labels-edit-form-header.png"), fullPage: true });
  // A create dialog's header ("Add baseline" on Diagnose).
  await checkScreen(tl, lang, `/transformations/${created.id}/diagnose`);
  await tl.getByRole("button", { name: catalogue(lang, "kpi.baseline.add"), exact: true }).click();
  const dialog = tl.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if ((await dialog.locator("[data-state='demo-record']").count()) === 0) missing.push("create dialog header");
  await tl.screenshot({ path: path.join(dir, "labels-create-dialog-header.png"), fullPage: true });
  await tl.context().close();
  await tlApi.req.dispose();
  // Product defect D-QA-E2-1 while this fails: the forms show the banner but no record badge in their header.
  expect(missing, `form headers without the badge "${badge}"`).toEqual([]);
});

test("REQ-S18-001 / ADR-0050 §2 d: an export generated by the worker in a demo database prints the illustrative label in the language", async ({
  playwright,
}, info) => {
  const lang = langOf(info);
  const badge = catalogue(lang, "playbookP5.demo.recordBadge");
  const tlApi = await demoApi(playwright, "tl");
  const created = await tlApi.call<Body>("POST", "/api/v1/transformations", {
    businessUnitId: DEMO_BU,
    name: `Synthetic QA-E2 ${lang.toUpperCase()} export`,
    mode: "end_to_end",
  });
  const API = `/api/v1/transformations/${created.id}`;
  const snap = await tlApi.call<Body>("POST", `${API}/reports/charter/generate`, {}, { expect: 201 });
  const worker = await startProductionWorker();
  const files: Record<string, string> = {};
  try {
    for (const format of ["docx"] as const) {
      const job = await tlApi.call<Body>(
        "POST",
        "/api/v1/exports",
        { snapshotId: snap.id, format, language: lang },
        {
          expect: 202,
        },
      );
      let done: Body = null;
      const until = Date.now() + 120_000;
      while (Date.now() < until) {
        done = await tlApi.call<Body>("GET", `/api/v1/exports/${job.id}`);
        if (["succeeded", "failed", "cancelled"].includes(done.status)) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      expect(done?.status, `export ${format}: ${JSON.stringify(done)}\n${worker.output().slice(-1500)}`).toBe(
        "succeeded",
      );
      const res = await tlApi.req.get(`/api/v1/exports/${job.id}/download`);
      expect(res.status()).toBe(200);
      const bytes = new Uint8Array(await res.body());
      expect(bytes.byteLength).toBe(done.fileSizeBytes);
      const parts = await readOoxml(bytes, /^word\/(document|header\d*)\.xml$/);
      files[format] = [...parts.parts.values()].map((xml) => xmlTexts(xml).join("")).join("\n");
    }
  } finally {
    await worker.stop();
  }
  // The illustrative label of the language is printed in each file; the other language's label is not.
  const other = catalogue(lang === "en" ? "ar" : "en", "playbookP5.demo.recordBadge");
  for (const [format, text] of Object.entries(files)) {
    expect(text, `${format} carries the ${lang} illustrative label`).toContain(badge);
    expect(text, `${format} is in ${lang}`).not.toContain(other);
  }
  await tlApi.req.dispose();
});
