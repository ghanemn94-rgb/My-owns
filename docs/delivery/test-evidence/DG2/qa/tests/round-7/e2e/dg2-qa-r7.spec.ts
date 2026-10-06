// qa-verifier DG2 round 7 — independent regression of D-067 (F-DG2-260 lone UTF-16 surrogates refused centrally;
// router- and connection-level errors answer the declared problem+json 400 with the security headers) on candidate
// ede1a936 (T-DG2-REV-QA-R7). Authored by qa-verifier, NOT by an implementer. Runs in chromium-en (English LTR) and
// chromium-ar (Arabic RTL) against the REAL built SPA + API + PostgreSQL (e2e/support/qa-stack.sh, port-parameterised
// copy). No server mocks: R7-02 only rewrites the browser's outgoing request so the REAL server answers.
//   QA_SHOT_DIR=<dir> e2e/support/qa-stack-port.sh npx playwright test e2e/dg2-qa-r7.spec.ts --workers=1
//
// R7-01 (UI, charter create): Case for change with a lone surrogate inside visible text shows the localized
//   validation__invalid_character message on the field, sends NO mutating request and creates no charter. Axe.
// R7-02 (UI -> real server): the browser's POST /charter body is rewritten so Out of scope carries a lone surrogate
//   (JSON escape \ud800); the server answers 400 validation.invalid_character at /outOfScope and the UI shows the
//   localized message; nothing is saved. Axe in that error state.
// R7-03 (API): high and low lone surrogates (leading, middle, trailing) in a charter PATCH, in changeSummary and in a
//   body key are 400 invalid_character at the pointer; a valid surrogate pair (emoji) + Arabic is accepted verbatim;
//   refused requests change nothing.
// R7-04 (raw HTTP over the real socket): %ZZ and %ED%A0%80 in an API path, a bad SPA path, an oversized header, an
//   oversized URL and a malformed request line each answer 400 application/problem+json with the expected
//   errors[0].code, requestId = X-Request-Id, and the same security headers as a routed 404 problem; no 5xx, no
//   plain-JSON body, no FST_ERR/raw path echoed. The stack stays healthy afterwards.
// All data is SYNTHETIC. No business approval is implied (product G1–G6 never imply DG0–DG7).
import { mkdirSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  BASE,
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

const DIR = process.env["QA_SHOT_DIR"] ?? "test-results/qa-r7";
async function qaShot(page: Page, lang: Lang, name: string) {
  mkdirSync(join(DIR, lang), { recursive: true });
  await page.screenshot({ path: join(DIR, lang, `${name}.png`), fullPage: true });
}

const HIGH = "\ud800";
const LOW = "\udfff";
const SURROGATE_TEXT = `Synthetic${HIGH}case for change`;

function trackMutations(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "HEAD") sent.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return sent;
}

type Charter = {
  charter: { id: string; version: number; caseForChange: string | null; inScope: string | null; outOfScope: string | null };
};
type Problem = { code: string; type: string; status: number; requestId: string; errors: { pointer: string; code: string }[] };

let tid = "";
let lead: ApiSession;
const T = () => `/api/v1/transformations/${tid}`;

async function newTransformation(label: string, lang: Lang): Promise<string> {
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `QA r7 ${label} ${lang.toUpperCase()} (synthetic)`,
    mode: "end_to_end",
  });
  return created.id;
}

test.beforeAll(async ({ playwright }, info) => {
  lead = await apiSession(playwright, "dev.lead");
  tid = await newTransformation("surrogate", langOf(info));
});

/** Puts `value` into a text field exactly (falls back to the native setter if the browser's input path altered it). */
async function setExact(page: Page, label: RegExp, value: string): Promise<string> {
  const field = page.getByLabel(label);
  await field.fill(value);
  if ((await field.inputValue()) === value) return "fill";
  await field.evaluate((el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  return "native-setter";
}

test("R7-01 charter create: a lone surrogate in Case for change is refused inline, localized; nothing is sent", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const id = await newTransformation("surrogate-ui", lang);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(`/transformations/${id}/charter`);
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  const label = fieldLabel(lang, "define.charter.field.caseForChange");
  const field = page.getByLabel(label);
  const msg = tr(lang, "problems.validation__invalid_character");
  const how = await setExact(page, label, SURROGATE_TEXT);
  const kept = await field.evaluate((el) => (el as HTMLTextAreaElement).value);
  console.log(`QA-R7 [${lang}] R7-01 value set via ${how}; field holds lone surrogate: ${/[\ud800-\udfff]/.test(kept) && !/[\ud800-\udbff][\udc00-\udfff]/.test(kept)}`);
  expect(kept).toBe(SURROGATE_TEXT);
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(new RegExp(escape(msg)));
  await expect(page.getByText(msg, { exact: false }).first()).toBeVisible();
  console.log(`QA-R7 [${lang}] R7-01 message "${msg}" shown, sent=${JSON.stringify(sent)}`);
  expect(sent).toEqual([]);
  expect((await lead.req.get(`/api/v1/transformations/${id}/charter`)).status()).toBe(404);
  await qaShot(page, lang, "qa-r7-01-charter-create-surrogate");
  await expectAccessible(page, lang, "qa-r7-charter-create-surrogate");
  expect(foreign).toEqual([]);
});

test("R7-02 charter create: a lone surrogate the client did not catch is refused by the real server, localized", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const id = await newTransformation("surrogate-server", lang);
  await signIn(page, lang, "dev.lead");
  const statuses: string[] = [];
  const bodies: string[] = [];
  page.on("response", async (r) => {
    if (r.request().method() === "POST" && r.url().endsWith("/charter")) {
      statuses.push(String(r.status()));
      bodies.push(await r.text().catch(() => ""));
    }
  });
  await page.route(`**/api/v1/transformations/${id}/charter`, async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
    body["outOfScope"] = `Synthetic${LOW}out of scope`;
    // Well-formed JSON.stringify writes the lone surrogate as the escape \udfff (valid JSON text).
    const text = JSON.stringify(body);
    expect(text).toContain("\\udfff");
    return route.continue({ postData: text });
  });
  await page.goto(`/transformations/${id}/charter`);
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  const field = page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope"));
  await field.fill("Synthetic out of scope");
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  const msg = tr(lang, "problems.validation__invalid_character");
  await expect.poll(() => statuses).toEqual(["400"]);
  const problem = JSON.parse(bodies[0]!) as Problem;
  expect(problem.errors).toEqual([expect.objectContaining({ pointer: "/outOfScope", code: "validation.invalid_character" })]);
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(new RegExp(escape(msg)));
  await expect(page.getByText(msg, { exact: false }).first()).toBeVisible();
  console.log(`QA-R7 [${lang}] R7-02 server ${statuses[0]} ${JSON.stringify(problem.errors)} shown as "${msg}"`);
  expect((await lead.req.get(`/api/v1/transformations/${id}/charter`)).status()).toBe(404);
  await qaShot(page, lang, "qa-r7-02-charter-create-surrogate-server");
  await expectAccessible(page, lang, "qa-r7-charter-create-surrogate-server");
});

test("R7-03 API: lone surrogates in body values and keys are 400 invalid_character; emoji/Arabic accepted verbatim", async ({}, info) => {
  const lang = langOf(info);
  await lead.call("POST", `${T()}/charter`, {
    transformationName: "QA r7 (synthetic)",
    inScope: "Synthetic in scope",
    outOfScope: "Synthetic out of scope",
  });
  const before = await lead.call<Charter>("GET", `${T()}/charter`);
  const versionsBefore = await (await lead.req.get(`${T()}/charter/versions`)).text();
  for (const field of ["inScope", "outOfScope", "caseForChange"] as const) {
    for (const value of [`Syn${HIGH}thetic`, `${LOW}Synthetic`, `Synthetic${HIGH}`, `${LOW}${HIGH}`]) {
      const body = await lead.call<Problem>(
        "PATCH",
        `${T()}/charter`,
        { [field]: value, changeSummary: "QA r7 surrogate probe (synthetic)" },
        { ifMatch: before.charter.version, expect: 400 },
      );
      expect(body.code).toBe("validation");
      expect(body.errors).toEqual([expect.objectContaining({ pointer: `/${field}`, code: "validation.invalid_character" })]);
    }
    console.log(`QA-R7 [${lang}] R7-03 PATCH charter ${field} with lone surrogates (4 shapes): 400 invalid_character at /${field}`);
  }
  const cs = await lead.call<Problem>(
    "PATCH",
    `${T()}/charter`,
    { inScope: "Synthetic visible", changeSummary: `QA${HIGH}summary` },
    { ifMatch: before.charter.version, expect: 400 },
  );
  expect(cs.errors).toEqual([expect.objectContaining({ pointer: "/changeSummary", code: "validation.invalid_character" })]);
  const key = await lead.call<Problem>(
    "PATCH",
    `${T()}/charter`,
    { [`in${HIGH}Scope`]: "Synthetic", changeSummary: "QA r7 (synthetic)" },
    { ifMatch: before.charter.version, expect: 400 },
  );
  expect(key.errors[0]?.code).toBe("validation.invalid_character");
  console.log(`QA-R7 [${lang}] R7-03 changeSummary ${JSON.stringify(cs.errors)}; body key ${JSON.stringify(key.errors)}`);
  const mid = await lead.call<Charter>("GET", `${T()}/charter`);
  expect(mid.charter).toEqual(before.charter);
  expect(await (await lead.req.get(`${T()}/charter/versions`)).text()).toBe(versionsBefore);
  // Negative control: a valid surrogate pair (emoji) with Arabic text is content and is stored verbatim.
  const good = "نطاق تجريبي 🚀 synthetic";
  await lead.call("PATCH", `${T()}/charter`, { inScope: good, changeSummary: "QA r7 emoji (synthetic)" }, { ifMatch: before.charter.version });
  const after = await lead.call<Charter>("GET", `${T()}/charter`);
  expect(after.charter.inScope).toBe(good);
  expect(after.charter.version).toBe(before.charter.version + 1);
  console.log(`QA-R7 [${lang}] R7-03 emoji+Arabic accepted verbatim; version ${before.charter.version} -> ${after.charter.version}`);
});

type RawRes = { status: number; headers: Record<string, string>; body: string };
function raw(request: string): Promise<RawRes> {
  const u = new URL(BASE);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(u.port || 80), u.hostname === "localhost" ? "127.0.0.1" : u.hostname);
    let out = "";
    socket.setEncoding("utf8");
    socket.on("data", (d: string) => (out += d));
    socket.on("error", (e) => (out === "" ? reject(e) : undefined));
    socket.on("close", () => {
      const i = out.indexOf("\r\n\r\n");
      const head = i >= 0 ? out.slice(0, i) : out;
      let body = i >= 0 ? out.slice(i + 4) : "";
      const [statusLine = "", ...lines] = head.split("\r\n");
      const headers: Record<string, string> = {};
      for (const line of lines) {
        const j = line.indexOf(":");
        headers[line.slice(0, j).toLowerCase()] = line.slice(j + 1).trim();
      }
      if (headers["transfer-encoding"] === "chunked") {
        let dechunked = "";
        let rest = body;
        for (;;) {
          const k = rest.indexOf("\r\n");
          const n = parseInt(rest.slice(0, k), 16);
          if (!n) break;
          dechunked += rest.slice(k + 2, k + 2 + n);
          rest = rest.slice(k + 2 + n + 2);
        }
        body = dechunked;
      }
      resolve({ status: Number(statusLine.split(" ")[1]), headers, body });
    });
    socket.write(request);
  });
}

const TRANSPORT = new Set(["x-request-id", "content-type", "content-length", "date", "connection", "keep-alive", "transfer-encoding"]);
const securityHeadersOf = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).filter(([k]) => !TRANSPORT.has(k)));

test("R7-04 raw HTTP: router- and connection-level errors are 400 problem+json with the routed security headers", async ({}, info) => {
  const lang = langOf(info);
  const host = new URL(BASE).host;
  const ref = await raw(`GET /api/v1/no-such-path HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
  expect(ref.status).toBe(404);
  const refSec = securityHeadersOf(ref.headers);
  expect(refSec["content-security-policy"]).toContain("default-src 'self'");
  const cases: [string, string, string][] = [
    ["API path %ZZ", `GET /api/v1/transformations/%ZZ HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`, "validation.format"],
    ["API path %ED%A0%80 (CESU-8 lone surrogate)", `GET /api/v1/transformations/%ED%A0%80 HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`, "validation.format"],
    ["POST archive with %ZZ id", `POST /api/v1/transformations/${tid}/tom-gaps/%ZZ/archive HTTP/1.1\r\nHost: ${host}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`, "validation.format"],
    ["SPA path %ZZ", `GET /transformations/%ZZ HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`, "validation.format"],
    ["oversized header", `GET /api/v1/me HTTP/1.1\r\nHost: ${host}\r\nX-Synthetic: ${"a".repeat(20_000)}\r\n\r\n`, "validation.headers_too_large"],
    ["oversized URL", `GET /api/v1/transformations?q=${"a".repeat(20_000)} HTTP/1.1\r\nHost: ${host}\r\n\r\n`, "validation.headers_too_large"],
    ["malformed request line", "NOT A REQUEST\r\n\r\n", "validation.malformed_request"],
  ];
  const failures: string[] = [];
  for (const [name, request, code] of cases) {
    const res = await raw(request);
    let body: Problem | undefined;
    try {
      body = JSON.parse(res.body) as Problem;
    } catch {
      body = undefined;
    }
    const sec = securityHeadersOf(res.headers);
    const problems: string[] = [];
    if (res.status !== 400) problems.push(`status ${res.status}`);
    if (!/^application\/problem\+json/.test(res.headers["content-type"] ?? "")) problems.push(`content-type ${res.headers["content-type"]}`);
    if (!body || body.status !== 400 || body.code !== "validation" || body.type !== "urn:mth:problem:validation") problems.push("not a validation problem");
    if (body?.errors?.[0]?.code !== code) problems.push(`errors[0].code ${body?.errors?.[0]?.code}`);
    if (!body?.requestId || body.requestId !== res.headers["x-request-id"]) problems.push("requestId != X-Request-Id");
    if (/FST_ERR|%ZZ|%ED|statusCode/.test(res.body)) problems.push("internals echoed");
    for (const [k, v] of Object.entries(refSec)) if (sec[k] !== v) problems.push(`header ${k}=${sec[k]} (routed: ${v})`);
    console.log(`QA-R7 [${lang}] R7-04 ${name}: ${res.status} ${res.headers["content-type"]} ${JSON.stringify(body?.errors)} sec-headers=${Object.keys(sec).length}/${Object.keys(refSec).length} ${problems.length ? "PROBLEMS " + problems.join("; ") : "ok"}`);
    if (problems.length) failures.push(`${name}: ${problems.join("; ")}`);
  }
  expect(failures).toEqual([]);
  // The stack is still healthy and the transformation unchanged.
  expect((await lead.req.get("/readyz")).status()).toBe(200);
  expect((await lead.req.get(T())).status()).toBe(200);
});
