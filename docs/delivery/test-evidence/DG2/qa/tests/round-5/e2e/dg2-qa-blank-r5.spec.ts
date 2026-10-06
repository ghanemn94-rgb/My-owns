// qa-verifier DG2 round 5 — independent regression check of F-DG2-180 (the visible-content predicate now also excludes
// Cc, Cs and Default_Ignorable code points) on candidate 2f81c60a (T-DG2-REV-QA-R5). Authored by qa-verifier, NOT by
// an implementer. Complements the unchanged round-3/round-4 specs (whitespace and format-character values).
//
// Runs in chromium-en (English LTR) and chromium-ar (Arabic RTL) against the REAL built SPA + API + PostgreSQL
// (e2e/support/qa-stack.sh, port-parameterised copy); no mocks. Copy to e2e/ in a disposable clone and run:
//   QA_SHOT_DIR=<dir> e2e/support/qa-stack-port.sh npx playwright test e2e/dg2-qa-blank-r5.spec.ts --workers=1
//
// R5-01 (UI, charter create, Case for change): each invisible-only value (a variation selector ALONE; a mix of
//   Default_Ignorable code points; C0 control characters) shows the localized validation__blank message on the field
//   (aria-invalid, aria-describedby, focus), sends NO mutating request and creates no charter. Axe has no serious or
//   critical violation in the error state. Then an emoji + VS16 (visible) is stored verbatim.
// R5-02 (API, charter Out of scope edit): the same invisible-only values are a 400 `validation.blank` at
//   /outOfScope, and the charter version is unchanged; a variation selector alone is never stored.
// All data is SYNTHETIC. No business approval is implied (product G1–G6 never imply DG0–DG7).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  SYN_RETAIL,
  apiSession,
  escape,
  expectAccessible,
  fieldLabel,
  langOf,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
  type Lang,
} from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "default" });

const DIR = process.env["QA_SHOT_DIR"] ?? "test-results/qa-r5";
async function qaShot(page: Page, lang: Lang, name: string) {
  mkdirSync(join(DIR, lang), { recursive: true });
  await page.screenshot({ path: join(DIR, lang, `${name}.png`), fullPage: true });
}

/** F-DG2-180 invisible-only classes. None has a visible code point. */
const INVISIBLE_R5: readonly (readonly [string, string])[] = [
  ["variation selector alone (U+FE0F)", "️"],
  ["Default_Ignorable mix (VS1, CGJ, Mongolian FVS1, Khmer U+17B4, VS17)", "︀͏᠋឴\u{E0100}"],
  ["C0 controls (U+0007, U+0001) with a space", "\u0007 \u0001"],
];
/** Visible: an emoji with VS16 must remain content and be stored verbatim. */
const EMOJI_VS16 = "✔️";

function trackMutations(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "HEAD") sent.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return sent;
}

type Charter = { charter: { version: number; caseForChange: string | null; outOfScope: string | null } };

let tid = "";
let lead: ApiSession;
const T = () => `/api/v1/transformations/${tid}`;

test.beforeAll(async ({ playwright }, info) => {
  lead = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `QA r5 invisible ${langOf(info).toUpperCase()} (synthetic)`,
    mode: "end_to_end",
  });
  tid = created.id;
});

test("R5-01 charter create: invisible-only Case for change (VS alone, Default_Ignorable, Cc) is refused; emoji+VS16 is verbatim", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  expect((await lead.req.get(`${T()}/charter`)).status()).toBe(404);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(`/transformations/${tid}/charter`);
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  const field = page.getByLabel(fieldLabel(lang, "define.charter.field.caseForChange"));
  const msg = tr(lang, "problems.validation__blank");
  let i = 0;
  for (const [kind, value] of INVISIBLE_R5) {
    i += 1;
    await field.fill(value);
    // The browser keeps the value as typed (otherwise this would test something else).
    expect(await field.inputValue(), `${kind}: field value`).toBe(value);
    await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription(new RegExp(escape(msg)));
    await expect(field).toBeFocused();
    await expect(page.getByText(msg, { exact: false }).first()).toBeVisible();
    console.log(`QA-R5 [${lang}] charter create ${kind}: blank message shown, sent=${JSON.stringify(sent)}`);
    expect(sent).toEqual([]);
    expect((await lead.req.get(`${T()}/charter`)).status()).toBe(404);
    await qaShot(page, lang, `qa-r5-01-charter-create-invisible-${i}`);
    await expectAccessible(page, lang, `qa-r5-charter-create-invisible-${i}`);
  }
  await field.fill(EMOJI_VS16);
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await expect(page.locator("[data-state='charter-version']")).toHaveAttribute("data-charter-version", "1");
  const saved = await lead.call<Charter>("GET", `${T()}/charter`);
  expect(saved.charter.caseForChange).toBe(EMOJI_VS16);
  console.log(`QA-R5 [${lang}] charter create emoji+VS16 stored verbatim: ${JSON.stringify(saved.charter.caseForChange)}`);
  expect(foreign).toEqual([]);
});

test("R5-02 API: invisible-only Out of scope is 400 validation.blank at /outOfScope; the charter version is unchanged", async ({}, info) => {
  const lang = langOf(info);
  if ((await lead.req.get(`${T()}/charter`)).status() === 404)
    await lead.call("POST", `${T()}/charter`, { transformationName: "QA r5 (synthetic)" });
  const before = await lead.call<Charter>("GET", `${T()}/charter`);
  for (const [kind, value] of INVISIBLE_R5) {
    const body = await lead.call<{ code: string; errors: { pointer: string; code: string }[] }>(
      "PATCH",
      `${T()}/charter`,
      { outOfScope: value, changeSummary: "QA r5 invisible probe (synthetic)" },
      { ifMatch: before.charter.version, expect: 400 },
    );
    expect(body.code).toBe("validation");
    expect(body.errors).toContainEqual(expect.objectContaining({ pointer: "/outOfScope", code: "validation.blank" }));
    console.log(`QA-R5 [${lang}] API PATCH charter outOfScope ${kind}: 400 ${JSON.stringify(body.errors)}`);
  }
  const after = await lead.call<Charter>("GET", `${T()}/charter`);
  expect(after.charter.version).toBe(before.charter.version);
  expect(after.charter.outOfScope).toBe(before.charter.outOfScope);
});
