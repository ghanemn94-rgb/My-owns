// domain-reviewer DG5 round-6 probe (new in round 6; it re-runs and extends the round-5 F-DG5-124 probe
// dom-r5-forms.spec.ts). Disposable clone only. SYNTHETIC data only; nothing here approves anything; nothing relates to
// DG0-DG7 or to the product gates G1-G6.
//  - PROBE_STACK=demo (e2e/support/with-demo-stack.sh; AUTH_MODE=dev, MTH_ENV=demo): the native form-record export
//    files (exportFormRecords) of T14 and T01 in CSV and JSON, en and ar, fetched by the API AND downloaded through the
//    real export dialog buttons ("Download CSV" / "Download JSON") in the en and ar UI. Each file must carry the
//    illustrative label in its language ("Illustrative example — synthetic" / "مثال توضيحي — اصطناعي") as the CSV's
//    first row (after the BOM, before the header) and as the JSON `illustrativeLabel`; the data rows must be intact.
//  - PROBE_STACK=prod (apps/web/e2e/support/with-stack.sh; production path, no environment marker): the same files for a
//    transformation created here must carry NO label row and `illustrativeLabel: null`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { apiSession, langOf, signIn, SYN_RETAIL } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["PROBE_OUT"]!;
const STACK = process.env["PROBE_STACK"] ?? "demo";
const DEMO_T = "01995000-0000-7000-8000-000000000001";
const LABEL = { en: "Illustrative example — synthetic", ar: "مثال توضيحي — اصطناعي" } as const;
const BOM = "﻿";
const save = (sub: string, name: string, data: string) => {
  mkdirSync(join(OUT, sub), { recursive: true });
  writeFileSync(join(OUT, sub, name), data);
};
const shot = async (page: Page, lang: string, name: string) => {
  mkdirSync(join(OUT, "shots", lang), { recursive: true });
  await page.screenshot({ path: join(OUT, "shots", lang, `${name}.png`), fullPage: true });
};
const results: string[] = [];
const record = (tag: string, line: string) => {
  results.push(line);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `results-${STACK}-${tag}.txt`), results.join("\n") + "\n");
};

/** Checks one export body; returns a one-line summary. */
function judge(body: string, format: string, lang: "en" | "ar", labelled: boolean): string {
  if (format === "csv") {
    const lines = body.split("\r\n");
    const first = lines[0] ?? "";
    const header = lang === "ar" ? "معرّف السجل" : "Record ID";
    if (labelled) {
      expect(first, "CSV line 1 = BOM + label").toBe(BOM + LABEL[lang]);
      expect(lines[1]!.startsWith(header), "CSV line 2 = header").toBe(true);
    } else {
      expect(first.startsWith(BOM + header), "CSV line 1 = BOM + header").toBe(true);
      expect(body.includes(LABEL.en) || body.includes(LABEL.ar), "no label anywhere").toBe(false);
    }
    const dataRows = lines.filter((l) => /^[0-9a-f]{8}-/.test(l)).length;
    return `csv ${lang}: line1=${JSON.stringify(first.slice(0, 60))} line2=${JSON.stringify((lines[1] ?? "").slice(0, 60))} dataRows=${dataRows} crlfEnd=${body.endsWith("\r\n")}`;
  }
  const j = JSON.parse(body) as { illustrativeLabel: unknown; language: string; rows: unknown[]; columns: unknown[] };
  expect(j.illustrativeLabel, "JSON illustrativeLabel").toBe(labelled ? LABEL[lang] : null);
  expect(j.language).toBe(lang);
  return `json ${lang}: illustrativeLabel=${JSON.stringify(j.illustrativeLabel)} rows=${j.rows.length} columns=${j.columns.length}`;
}

let tid = DEMO_T;

test.beforeAll(async ({ playwright }) => {
  if (STACK !== "prod") return;
  // Production-path stack: create one transformation with one filled T01 item (synthetic), as p5-forms.spec.ts does.
  const lead = await apiSession(playwright, "dev.lead");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic DOM-R6 export probe ${Date.now().toString(36)}`,
      mode: "end_to_end",
    })
  ).id;
  const T = `/api/v1/transformations/${tid}`;
  const items = await lead.call<{ items: { id: string; version: number }[] }>("GET", `${T}/diagnostic-items?limit=100`);
  const first = items.items[0]!;
  await lead.call(
    "PATCH",
    `${T}/diagnostic-items/${first.id}`,
    { currentState: "Synthetic current state", rootCause: "Synthetic root cause", confidence: "M" },
    { ifMatch: first.version },
  );
});

test("API: the 8 form-record export files (en project only)", async ({ playwright }, info) => {
  test.skip(langOf(info) !== "en");
  const user = STACK === "prod" ? "dev.lead" : "roaming.user.tl";
  const s = await apiSession(playwright, user);
  const env = await s.req.get("/api/v1/environment");
  const envBody = await env.json().catch(() => null);
  save(`api-${STACK}`, "environment.json", JSON.stringify({ status: env.status(), body: envBody }, null, 1));
  record("api", `[${STACK}] GET /environment ${env.status()} ${JSON.stringify(envBody)}`);
  const labelled = STACK !== "prod";
  for (const rt of ["T14", "T01"])
    for (const lang of ["en", "ar"] as const)
      for (const format of ["csv", "json"]) {
        const res = await s.req.get(`/api/v1/transformations/${tid}/form-records/${rt}/export?format=${format}&lang=${lang}`);
        const body = await res.text();
        save(`api-${STACK}`, `export-${rt}-${lang}.${format}`, body);
        expect(res.status()).toBe(200);
        record("api", `[${STACK}] API ${rt} ${res.status()} ${res.headers()["content-type"]} ${judge(body, format, lang, labelled)}`);
      }
});

test("UI: download CSV and JSON through the T14 and T01 export dialogs", async ({ page }, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info) as "en" | "ar";
  const labelled = STACK !== "prod";
  await signIn(page, lang, STACK === "prod" ? "dev.lead" : "roaming.user.tl");
  const targets: { rt: string; url: string }[] = [];
  if (STACK !== "prod") {
    await page.goto(`/transformations/${tid}/benefits`);
    await page.waitForLoadState("networkidle");
    const href = await page.locator(`a[href*='/transformations/${tid}/benefits/']`).first().getAttribute("href");
    targets.push({ rt: "T14", url: href! });
  }
  targets.push({ rt: "T01", url: `/transformations/${tid}/diagnose` });
  for (const { rt, url } of targets) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.locator(`[data-export='${rt}']`).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("[data-export-rows]")).toBeVisible();
    const dialogText = await dialog.innerText();
    save(`ui-${STACK}`, `${lang}-${rt}-dialog.txt`, dialogText);
    await shot(page, lang, `${STACK}-${rt}-export-dialog`);
    for (const format of ["csv", "json"]) {
      const [dl] = await Promise.all([page.waitForEvent("download"), dialog.locator(`[data-download='${format}']`).click()]);
      const path = join(OUT, `ui-${STACK}`, `${lang}-download-${dl.suggestedFilename()}`);
      await dl.saveAs(path);
      const body = readFileSync(path, "utf8");
      record(
        `ui-${lang}`,
        `[${STACK}] UI ${lang} ${rt} file=${dl.suggestedFilename()} dialogHasLabel=${/Illustrative example|مثال توضيحي/.test(dialogText)} ${judge(body, format, lang, labelled)}`,
      );
    }
    await page.keyboard.press("Escape");
  }
});
