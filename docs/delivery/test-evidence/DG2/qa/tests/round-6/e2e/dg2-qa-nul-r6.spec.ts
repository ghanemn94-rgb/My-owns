// qa-verifier DG2 round 6 — independent regression of D-066 (F-DG2-230 placeholders, F-DG2-231 U+0000 refused
// centrally, every 400 declared in the contract) on candidate bb3e7581 (T-DG2-REV-QA-R6). Authored by qa-verifier,
// NOT by an implementer. Runs in chromium-en (English LTR) and chromium-ar (Arabic RTL) against the REAL built SPA +
// API + PostgreSQL (e2e/support/qa-stack.sh, port-parameterised copy). No server mocks: R6-02 only rewrites the
// browser's outgoing request so the REAL server answers, which a hostile or buggy client could also do.
//   QA_SHOT_DIR=<dir> e2e/support/qa-stack-port.sh npx playwright test e2e/dg2-qa-nul-r6.spec.ts --workers=1
//
// R6-01 (UI, charter create): Case for change with U+0000 inside visible text shows the localized
//   validation__invalid_character message on the field (aria-invalid, description, focus), sends NO mutating request
//   and creates no charter. Axe: no serious/critical violation in that error state.
// R6-02 (UI -> real server): the browser's POST /charter body is rewritten so Out of scope carries U+0000; the server
//   answers 400 validation.invalid_character at /outOfScope and the UI shows the localized message; nothing is saved.
// R6-03 (UI, F-DG2-230): U+16FE4 alone and U+1D159 alone are blank (localized validation__blank), nothing is sent.
// R6-04 (API): U+0000 in a charter PATCH (inScope, outOfScope, caseForChange) and in a POST body key is 400
//   invalid_character at the field pointer; version, values and charter history are unchanged. U+0000 in a path id and
//   in a query string is 400 at /params/<name> and /query/<key>. U+16FE4 / U+1D159 alone are 400 validation.blank.
// R6-05 (API + contract): every GET operation with path parameters in docs/api/openapi.yaml, called with a malformed
//   LAST parameter, answers 400; the contract declares 400 for that operation; the single error is at /params/<name>.
// All data is SYNTHETIC. No business approval is implied (product G1–G6 never imply DG0–DG7).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
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

const DIR = process.env["QA_SHOT_DIR"] ?? "test-results/qa-r6";
async function qaShot(page: Page, lang: Lang, name: string) {
  mkdirSync(join(DIR, lang), { recursive: true });
  await page.screenshot({ path: join(DIR, lang, `${name}.png`), fullPage: true });
}

const NUL_TEXT = "Synthetic\u0000case for change";
const PLACEHOLDERS: readonly (readonly [string, string])[] = [
  ["U+16FE4 KHITAN SMALL SCRIPT FILLER alone", "\u{16FE4}"],
  ["U+1D159 MUSICAL SYMBOL NULL NOTEHEAD alone", "\u{1D159}"],
];

function trackMutations(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "HEAD") sent.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return sent;
}

type Charter = {
  charter: {
    id: string;
    version: number;
    caseForChange: string | null;
    inScope: string | null;
    outOfScope: string | null;
  };
};
type Problem = { code: string; type: string; errors: { pointer: string; code: string }[] };

let tid = "";
let lead: ApiSession;
const T = () => `/api/v1/transformations/${tid}`;

async function newTransformation(label: string, lang: Lang): Promise<string> {
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `QA r6 ${label} ${lang.toUpperCase()} (synthetic)`,
    mode: "end_to_end",
  });
  return created.id;
}

test.beforeAll(async ({ playwright }, info) => {
  lead = await apiSession(playwright, "dev.lead");
  tid = await newTransformation("nul", langOf(info));
});

test("R6-01 charter create: U+0000 in Case for change is refused inline with the localized message; nothing is sent", async ({
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
  const msg = tr(lang, "problems.validation__invalid_character");
  expect(msg).not.toBe(tr(lang, "problems.validation__blank"));
  await field.fill(NUL_TEXT);
  expect(await field.inputValue(), "the browser keeps U+0000 in the field").toBe(NUL_TEXT);
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(new RegExp(escape(msg)));
  await expect(field).toBeFocused();
  await expect(page.getByText(msg, { exact: false }).first()).toBeVisible();
  console.log(`QA-R6 [${lang}] R6-01 charter create NUL: message "${msg}" shown, sent=${JSON.stringify(sent)}`);
  expect(sent).toEqual([]);
  expect((await lead.req.get(`${T()}/charter`)).status()).toBe(404);
  await qaShot(page, lang, "qa-r6-01-charter-create-nul");
  await expectAccessible(page, lang, "qa-r6-charter-create-nul");
  expect(foreign).toEqual([]);
});

test("R6-02 charter create: a U+0000 the client did not catch is refused by the real server and shown localized", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const id = await newTransformation("nul-server", lang);
  await signIn(page, lang, "dev.lead");
  const statuses: string[] = [];
  page.on("response", (r) => {
    if (r.request().method() === "POST" && r.url().endsWith("/charter")) statuses.push(String(r.status()));
  });
  // Rewrite the outgoing body only; the request still goes to the real API.
  await page.route(`**/api/v1/transformations/${id}/charter`, async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
    body["outOfScope"] = "Synthetic\u0000out of scope";
    return route.continue({ postData: JSON.stringify(body) });
  });
  await page.goto(`/transformations/${id}/charter`);
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  const field = page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope"));
  await field.fill("Synthetic out of scope");
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  const msg = tr(lang, "problems.validation__invalid_character");
  await expect.poll(() => statuses).toEqual(["400"]);
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(new RegExp(escape(msg)));
  await expect(page.getByText(msg, { exact: false }).first()).toBeVisible();
  console.log(`QA-R6 [${lang}] R6-02 server 400 on /outOfScope shown as "${msg}"; responses=${JSON.stringify(statuses)}`);
  expect((await lead.req.get(`/api/v1/transformations/${id}/charter`)).status()).toBe(404);
  await qaShot(page, lang, "qa-r6-02-charter-create-nul-server");
  await expectAccessible(page, lang, "qa-r6-charter-create-nul-server");
});

test("R6-03 charter create: U+16FE4 alone and U+1D159 alone are blank (F-DG2-230); nothing is sent", async ({ page }, info) => {
  const lang = langOf(info);
  const id = await newTransformation("placeholder", lang);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(`/transformations/${id}/charter`);
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  const field = page.getByLabel(fieldLabel(lang, "define.charter.field.caseForChange"));
  const msg = tr(lang, "problems.validation__blank");
  let i = 0;
  for (const [kind, value] of PLACEHOLDERS) {
    i += 1;
    await field.fill(value);
    expect(await field.inputValue(), `${kind}: field value`).toBe(value);
    await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription(new RegExp(escape(msg)));
    console.log(`QA-R6 [${lang}] R6-03 ${kind}: blank message shown, sent=${JSON.stringify(sent)}`);
    expect(sent).toEqual([]);
    await qaShot(page, lang, `qa-r6-03-placeholder-${i}`);
    await expectAccessible(page, lang, `qa-r6-charter-placeholder-${i}`);
  }
  expect((await lead.req.get(`/api/v1/transformations/${id}/charter`)).status()).toBe(404);
});

test("R6-04 API: U+0000 in body, body key, path and query is 400 validation.invalid_character; nothing changes", async ({}, info) => {
  const lang = langOf(info);
  if ((await lead.req.get(`${T()}/charter`)).status() === 404)
    await lead.call("POST", `${T()}/charter`, {
      transformationName: "QA r6 (synthetic)",
      inScope: "Synthetic in scope",
      outOfScope: "Synthetic out of scope",
    });
  const before = await lead.call<Charter>("GET", `${T()}/charter`);
  const versionsBefore = await lead.req.get(`${T()}/charter/versions`);
  const versionsBeforeText = versionsBefore.ok() ? await versionsBefore.text() : `status ${versionsBefore.status()}`;
  for (const field of ["inScope", "outOfScope", "caseForChange"] as const) {
    for (const value of ["Synthetic\u0000middle", "\u0000Synthetic leading", "Synthetic trailing\u0000"]) {
      const body = await lead.call<Problem>(
        "PATCH",
        `${T()}/charter`,
        { [field]: value, changeSummary: "QA r6 NUL probe (synthetic)" },
        { ifMatch: before.charter.version, expect: 400 },
      );
      expect(body.code).toBe("validation");
      expect(body.errors).toEqual([expect.objectContaining({ pointer: `/${field}`, code: "validation.invalid_character" })]);
    }
    console.log(`QA-R6 [${lang}] R6-04 PATCH charter ${field} with U+0000 (3 positions): 400 invalid_character at /${field}`);
  }
  // NUL in the changeSummary (a field not stored on the charter itself).
  const cs = await lead.call<Problem>(
    "PATCH",
    `${T()}/charter`,
    { inScope: "Synthetic visible", changeSummary: "QA\u0000summary" },
    { ifMatch: before.charter.version, expect: 400 },
  );
  expect(cs.errors).toEqual([expect.objectContaining({ pointer: "/changeSummary", code: "validation.invalid_character" })]);
  // NUL in an object key of the body.
  const key = await lead.call<Problem>(
    "PATCH",
    `${T()}/charter`,
    { ["in\u0000Scope"]: "Synthetic", changeSummary: "QA r6 (synthetic)" },
    { ifMatch: before.charter.version, expect: 400 },
  );
  expect(key.errors[0]?.code).toBe("validation.invalid_character");
  console.log(`QA-R6 [${lang}] R6-04 NUL in body key: 400 ${JSON.stringify(key.errors)}`);
  // NUL in a path id and in a query string.
  const path = await lead.req.get(`/api/v1/transformations/${encodeURIComponent("\u0000")}`);
  expect(path.status()).toBe(400);
  const pathBody = (await path.json()) as Problem;
  expect(pathBody.errors).toEqual([
    expect.objectContaining({ pointer: "/params/transformationId", code: "validation.invalid_character" }),
  ]);
  const query = await lead.req.get(`/api/v1/transformations?q=${encodeURIComponent("Syn\u0000")}`);
  expect(query.status()).toBe(400);
  const queryBody = (await query.json()) as Problem;
  expect(queryBody.errors).toEqual([expect.objectContaining({ pointer: "/query/q", code: "validation.invalid_character" })]);
  console.log(
    `QA-R6 [${lang}] R6-04 path NUL: ${path.status()} ${JSON.stringify(pathBody.errors)}; query NUL: ${query.status()} ${JSON.stringify(queryBody.errors)}`,
  );
  // F-DG2-230 placeholders through the API.
  for (const [kind, value] of PLACEHOLDERS) {
    const body = await lead.call<Problem>(
      "PATCH",
      `${T()}/charter`,
      { outOfScope: value, changeSummary: "QA r6 placeholder probe (synthetic)" },
      { ifMatch: before.charter.version, expect: 400 },
    );
    expect(body.errors).toContainEqual(expect.objectContaining({ pointer: "/outOfScope", code: "validation.blank" }));
    console.log(`QA-R6 [${lang}] R6-04 PATCH outOfScope ${kind}: 400 ${JSON.stringify(body.errors)}`);
  }
  const after = await lead.call<Charter>("GET", `${T()}/charter`);
  expect(after.charter).toEqual(before.charter);
  const versionsAfter = await lead.req.get(`${T()}/charter/versions`);
  const versionsAfterText = versionsAfter.ok() ? await versionsAfter.text() : `status ${versionsAfter.status()}`;
  expect(versionsAfterText).toBe(versionsBeforeText);
  console.log(`QA-R6 [${lang}] R6-04 charter unchanged: version ${after.charter.version}; history unchanged`);
});

type Op = { method: string; path: string; operationId: string; declares400: boolean };

test("R6-05 contract: every GET-by-id with a malformed last path parameter is the declared 400 at /params/<name>", async ({
  playwright,
}, info) => {
  const lang = langOf(info);
  const doc = (await SwaggerParser.parse(join(process.cwd(), "docs/api/openapi.yaml"))) as unknown as {
    paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>;
  };
  const ops: Op[] = [];
  let total = 0;
  for (const [p, item] of Object.entries(doc.paths)) {
    for (const [m, op] of Object.entries(item)) {
      if (!["get", "post", "put", "patch", "delete"].includes(m)) continue;
      total += 1;
      if (m === "get" && /\{[A-Za-z]+\}/.test(p))
        ops.push({ method: "GET", path: p, operationId: op.operationId ?? "?", declares400: "400" in (op.responses ?? {}) });
    }
  }
  expect(total).toBe(161);
  const sessions = [lead, await apiSession(playwright, "dev.office"), await apiSession(playwright, "dev.admin")];
  const results: string[] = [];
  const failures: string[] = [];
  for (const op of ops) {
    const names = [...op.path.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]!);
    const last = names[names.length - 1]!;
    const url = op.path.replace(/\{([A-Za-z]+)\}/g, (_, n: string) => {
      if (n === last) return "NOT-VALID";
      if (n === "transformationId") return tid;
      if (n === "gateCode") return "G1";
      if (n === "dimensionCode") return "strategy";
      if (n === "submissionNo" || n === "versionNo") return "1";
      return crypto.randomUUID();
    });
    let status = 0;
    let body: Problem | undefined;
    for (const s of sessions) {
      const res = await s.req.get(url);
      status = res.status();
      body = status === 400 ? ((await res.json()) as Problem) : undefined;
      if (status !== 401 && status !== 403) break;
    }
    const ok =
      op.declares400 &&
      status === 400 &&
      body?.code === "validation" &&
      body.errors.length === 1 &&
      body.errors[0]!.pointer === `/params/${last}`;
    const line = `${op.operationId} GET ${op.path} -> ${status} ${body ? JSON.stringify(body.errors) : ""} declares400=${op.declares400}`;
    results.push(line);
    if (!ok) failures.push(line);
  }
  console.log(`QA-R6 [${lang}] R6-05 contract operations=${total}; GET with path params=${ops.length}`);
  for (const r of results) console.log(`QA-R6 [${lang}] R6-05 ${r}`);
  expect(ops.length).toBeGreaterThan(30);
  expect(failures).toEqual([]);
});
