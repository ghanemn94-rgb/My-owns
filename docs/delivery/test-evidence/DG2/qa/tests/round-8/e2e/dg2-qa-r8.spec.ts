// qa-verifier DG2 round 8 — independent regression of D-068 (F-DG2-290 strict UTF-8: a JSON body that is not valid
// UTF-8 is 400 validation.json with Content-Length AND chunked; an undecodable percent sequence in a query component
// is 400 validation.format; Arabic/emoji still round-trip verbatim) on candidate 9331e9d1 (T-DG2-REV-QA-R8).
// Authored by qa-verifier, NOT by an implementer. Runs in chromium-en (English LTR) and chromium-ar (Arabic RTL)
// against the REAL built SPA + API + PostgreSQL (e2e/support/qa-stack.sh). No server mocks: R8-05 only rewrites the
// browser's outgoing request body so the REAL server answers.
//   QA_SHOT_DIR=<dir> e2e/support/qa-stack.sh npx playwright test e2e/dg2-qa-r8.spec.ts --workers=1
//
// R8-01 (raw socket, production build): 8 invalid-UTF-8 shapes (lone FF, overlong C0 80 / E0 80 AF, CESU-8 surrogate,
//   > U+10FFFF, truncated 2- and 4-byte sequences, invalid byte inside a KEY) x 3 framings (Content-Length, one chunk,
//   the bad sequence SPLIT across two chunks), authenticated and unauthenticated: always 400 problem+json validation
//   with errors [{pointer:"", code:"validation.json"}], requestId = X-Request-Id; never 5xx; no charter is created.
// R8-02 (raw socket): VALID multi-byte text split mid-character across chunk boundaries (emoji F0 9F | 9A 80, Arabic
//   D8 | B9, ZWJ family) and with Content-Length: 201 and stored byte for byte (a streaming decoder must not reject or
//   alter it). No Unicode normalisation (e + U+0301 stays decomposed).
// R8-03 (query sweep): every GET operation of the contract that has query parameters (OIDC endpoints excluded):
//   each query parameter set to %FF answers 400 validation.format at /query/<name>; %C3, %ED%A0%80, %C0%80 and
//   %F4%90%80%80 on ?q= too; unauthenticated ?q=%FF stays 401. Controls: percent-encoded Arabic and emoji in ?q= are
//   200 and find the synthetic transformation by its Arabic/emoji name.
// R8-04 (UI): charter Case for change typed with Arabic, emoji (ZWJ sequence), RLM and a combining mark is saved and
//   shown verbatim after reload; the API returns the same code points. Axe.
// R8-05 (UI -> real server): the browser's POST /charter body is rewritten with an invalid UTF-8 byte; the server
//   answers 400 validation.json; the UI shows the localized problems.validation__json message; nothing is saved. Axe in
//   that error state.
// R8-06 (UI): searching the transformation list for Arabic and emoji text sends a valid query and finds the record; a
//   deep link /transformations?q=%FF never yields a 5xx and the SPA still renders the list. Axe.
// All data is SYNTHETIC. No business approval is implied (product G1–G6 never imply DG0–DG7).
import { mkdirSync, readFileSync } from "node:fs";
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

const DIR = process.env["QA_SHOT_DIR"] ?? "test-results/qa-r8";
async function qaShot(page: Page, lang: Lang, name: string) {
  mkdirSync(join(DIR, lang), { recursive: true });
  await page.screenshot({ path: join(DIR, lang, `${name}.png`), fullPage: true });
}

type Problem = { code: string; type: string; status: number; requestId: string; errors: { pointer: string; code: string }[] };
type Charter = { charter: { id: string; version: number; caseForChange: string | null; outOfScope: string | null } };

let lead: ApiSession;
let admin: ApiSession;

async function newTransformation(name: string): Promise<{ id: string; organizationId: string }> {
  return lead.call<{ id: string; organizationId: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name,
    mode: "end_to_end",
  });
}

test.beforeAll(async ({ playwright }) => {
  lead = await apiSession(playwright, "dev.lead");
  admin = await apiSession(playwright, "dev.admin");
});

// ---- raw HTTP over the real socket -----------------------------------------------------------------------------
type RawRes = { status: number; headers: Record<string, string>; body: string };
function raw(chunks: Buffer[]): Promise<RawRes> {
  const u = new URL(BASE);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(u.port || 80), u.hostname === "localhost" ? "127.0.0.1" : u.hostname);
    const parts: Buffer[] = [];
    const timer = setTimeout(() => socket.destroy(new Error("raw request timed out (server hung)")), 15_000);
    socket.on("data", (d: Buffer) => parts.push(d));
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      const out = Buffer.concat(parts).toString("utf8");
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
    // Write the pieces separately (with a pause) so the server really receives the chunks apart.
    (async () => {
      for (const c of chunks) {
        socket.write(c);
        await new Promise((r) => setTimeout(r, 30));
      }
    })().catch(reject);
  });
}

type Auth = { cookie: string; csrf: string } | null;
async function authOf(s: ApiSession): Promise<{ cookie: string; csrf: string }> {
  const state = await s.req.storageState();
  const cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const me = (await (await s.req.get("/api/v1/me")).json()) as { csrfToken: string };
  return { cookie, csrf: me.csrfToken };
}

/** A POST to `path` with `body` bytes, framed with Content-Length or chunked (split at the given byte offsets). */
function post(path: string, body: Buffer, auth: Auth, framing: "length" | "chunked" | { split: number[] }): Buffer[] {
  const host = new URL(BASE).host;
  const h = [
    `POST ${path} HTTP/1.1`,
    `Host: ${host}`,
    `Origin: ${BASE}`,
    "Content-Type: application/json",
    `Idempotency-Key: ${crypto.randomUUID()}`,
    "Connection: close",
  ];
  if (auth) h.push(`Cookie: ${auth.cookie}`, `X-CSRF-Token: ${auth.csrf}`);
  if (framing === "length") {
    h.push(`Content-Length: ${body.length}`);
    return [Buffer.from(`${h.join("\r\n")}\r\n\r\n`, "latin1"), body];
  }
  h.push("Transfer-Encoding: chunked");
  const cuts = framing === "chunked" ? [] : framing.split;
  const pieces: Buffer[] = [];
  let at = 0;
  for (const c of [...cuts, body.length]) {
    pieces.push(body.subarray(at, c));
    at = c;
  }
  const out: Buffer[] = [Buffer.from(`${h.join("\r\n")}\r\n\r\n`, "latin1")];
  for (const p of pieces.filter((x) => x.length)) {
    out.push(Buffer.concat([Buffer.from(`${p.length.toString(16)}\r\n`, "latin1"), p, Buffer.from("\r\n", "latin1")]));
  }
  out.push(Buffer.from("0\r\n\r\n", "latin1"));
  return out;
}

const b = (s: string) => Buffer.from(s, "utf8");
/** {"transformationName":"QA r8 (synthetic)","outOfScope":"Synthetic <bytes> text"} with raw bytes in the value. */
const valueBody = (bytes: number[]) =>
  Buffer.concat([b('{"transformationName":"QA r8 (synthetic)","outOfScope":"Synthetic '), Buffer.from(bytes), b(' text"}')]);
const keyBody = (bytes: number[]) =>
  Buffer.concat([b('{"transformationName":"QA r8 (synthetic)","out'), Buffer.from(bytes), b('Scope":"Synthetic"}')]);

const INVALID: [string, Buffer][] = [
  ["lone FF", valueBody([0xff])],
  ["overlong NUL C0 80", valueBody([0xc0, 0x80])],
  ["overlong '/' E0 80 AF", valueBody([0xe0, 0x80, 0xaf])],
  ["CESU-8 surrogate ED A0 80", valueBody([0xed, 0xa0, 0x80])],
  ["above U+10FFFF F4 90 80 80", valueBody([0xf4, 0x90, 0x80, 0x80])],
  ["truncated 2-byte C3", valueBody([0xc3])],
  ["truncated 4-byte F0 9F 9A", valueBody([0xf0, 0x9f, 0x9a])],
  ["invalid byte in a key (FE)", keyBody([0xfe])],
];

function problemIssues(res: RawRes, pointer: string, code: string): string[] {
  const issues: string[] = [];
  let body: Problem | undefined;
  try {
    body = JSON.parse(res.body) as Problem;
  } catch {
    body = undefined;
  }
  if (res.status !== 400) issues.push(`status ${res.status}`);
  if (!/^application\/problem\+json/.test(res.headers["content-type"] ?? "")) issues.push(`content-type ${res.headers["content-type"]}`);
  if (!body || body.code !== "validation" || body.status !== 400) issues.push(`body ${res.body.slice(0, 160)}`);
  if (body && JSON.stringify(body.errors?.map((e) => [e.pointer, e.code])) !== JSON.stringify([[pointer, code]]))
    issues.push(`errors ${JSON.stringify(body.errors)}`);
  if (body && body.requestId !== res.headers["x-request-id"]) issues.push("requestId != X-Request-Id");
  if (/FST_ERR|statusCode|�/.test(res.body)) issues.push("internals or U+FFFD echoed");
  return issues;
}

test("R8-01 raw socket: invalid UTF-8 JSON bodies are 400 validation.json for every framing, with and without a session", async ({}, info) => {
  const lang = langOf(info);
  const t = await newTransformation(`QA r8 invalid-utf8 ${lang.toUpperCase()} (synthetic)`);
  const path = `/api/v1/transformations/${t.id}/charter`;
  const auth = await authOf(lead);
  const failures: string[] = [];
  let n = 0;
  for (const [name, body] of INVALID) {
    // the offset of the first byte after 'Synthetic ' / 'out' (where the bad bytes begin): split one byte into them
    const badAt = body.findIndex((x) => x >= 0x80) + 1;
    for (const framing of ["length", "chunked", { split: [badAt] }] as const) {
      for (const who of [auth, null]) {
        const res = await raw(post(path, body, who, framing));
        const issues = problemIssues(res, "", "validation.json");
        const label = `${name} / ${typeof framing === "string" ? framing : `chunked split@${badAt}`} / ${who ? "session" : "no session"}`;
        if (issues.length) failures.push(`${label}: ${issues.join("; ")}`);
        n++;
      }
    }
  }
  console.log(`QA-R8 [${lang}] R8-01 ${n} raw requests (8 shapes x 3 framings x 2 auth): ${failures.length ? "FAILURES " + JSON.stringify(failures) : "all 400 problem+json validation.json at pointer \"\""}`);
  expect(failures).toEqual([]);
  expect((await lead.req.get(path)).status()).toBe(404);
  expect((await lead.req.get("/readyz")).status()).toBe(200);
});

test("R8-02 raw socket: valid multi-byte text split mid-character across chunks round-trips byte for byte", async ({}, info) => {
  const lang = langOf(info);
  const cases: [string, string][] = [
    ["emoji", "Synthetic 🚀 launch"],
    ["arabic", "عينة نطاق التحول"],
    ["zwj family + skin tone", "👩🏽‍💻 👨‍👩‍👧‍👦 فريق"],
    ["decomposed e + U+0301 (no NFC)", "Synthétic café"],
  ];
  const auth = await authOf(lead);
  for (const [name, text] of cases) {
    for (const framing of ["length", "split"] as const) {
      const t = await newTransformation(`QA r8 roundtrip ${name} ${framing} ${lang.toUpperCase()} (synthetic)`);
      const path = `/api/v1/transformations/${t.id}/charter`;
      const body = b(JSON.stringify({ transformationName: "QA r8 (synthetic)", outOfScope: text }));
      // every split point that falls INSIDE a multi-byte character (continuation byte at the cut)
      const cuts: number[] = [];
      for (let i = 1; i < body.length; i++) if ((body[i]! & 0xc0) === 0x80) cuts.push(i);
      const res = await raw(post(path, body, auth, framing === "length" ? "length" : { split: cuts }));
      expect(res.status, `${name} ${framing}: ${res.body}`).toBe(201);
      const got = await lead.call<Charter>("GET", path);
      expect(got.charter.outOfScope).toBe(text);
      expect(b(got.charter.outOfScope ?? "").equals(b(text))).toBe(true);
      console.log(`QA-R8 [${lang}] R8-02 ${name} via ${framing === "length" ? "Content-Length" : `${cuts.length + 1} chunks cut mid-character`}: 201, stored verbatim (${b(text).length} bytes)`);
    }
  }
});

test("R8-03 query sweep: undecodable percent sequences in any query parameter are 400 validation.format", async ({}, info) => {
  const lang = langOf(info);
  const arabicName = `QA r8 بحث عينة ${lang} 🛰️ (synthetic)`;
  const t = await newTransformation(arabicName);
  // GET operations with query parameters, extracted from the candidate's docs/api/openapi.yaml by
  // 21-query-ops.py (python3 + PyYAML; the workspace root has no YAML parser) into QA_R8_QUERY_OPS.
  const ops = JSON.parse(readFileSync(process.env["QA_R8_QUERY_OPS"] ?? "test-results/qa-r8-query-ops.json", "utf8")) as {
    operationId: string;
    path: string;
    query: string[];
  }[];
  expect(ops.length).toBeGreaterThan(25);
  const ADMIN_OPS = new Set(["listOrganizations", "listBusinessUnits", "listUsers", "listRoleAssignments"]);
  const SKIP = new Set(["startOidcLogin", "completeOidcLogin"]);
  const fill = (p: string) =>
    p
      .replace("{transformationId}", t.id)
      .replace("{organizationId}", t.organizationId)
      .replace("{gateCode}", "G2")
      .replace(/\{[A-Za-z]+\}/g, "01a10000-0000-7000-8000-000000000000");
  const failures: string[] = [];
  let checked = 0;
  for (const op of ops) {
    if (SKIP.has(op.operationId)) continue;
    const p = op.path;
    for (const q of op.query.map((name) => ({ name }))) {
      const who = ADMIN_OPS.has(op.operationId) ? admin : lead;
      const res = await who.req.get(`${fill(p)}?${q.name}=%FF`);
      const text = await res.text();
      const body = (() => {
        try {
          return JSON.parse(text) as Problem;
        } catch {
          return undefined;
        }
      })();
      checked++;
      if (res.status() !== 400 || body?.errors?.[0]?.code !== "validation.format" || body?.errors?.[0]?.pointer !== `/query/${q.name}`)
        failures.push(`${op.operationId} ?${q.name}=%FF -> ${res.status()} ${text.slice(0, 160)}`);
    }
  }
  for (const seq of ["%C3", "%ED%A0%80", "%C0%80", "%F4%90%80%80", "abc%FFdef"]) {
    const res = await lead.req.get(`/api/v1/transformations?q=${seq}`);
    const body = (await res.json()) as Problem;
    checked++;
    if (res.status() !== 400 || body.errors?.[0]?.code !== "validation.format" || body.errors?.[0]?.pointer !== "/query/q")
      failures.push(`listTransformations ?q=${seq} -> ${res.status()} ${JSON.stringify(body)}`);
  }
  console.log(`QA-R8 [${lang}] R8-03 ${checked} query probes: ${failures.length ? "FAILURES " + JSON.stringify(failures) : "all 400 validation.format at /query/<name>"}`);
  expect(failures).toEqual([]);
  // authentication keeps precedence
  const anon = await fetch(`${BASE}/api/v1/transformations?q=%FF`);
  expect(anon.status).toBe(401);
  // controls: valid percent-encoded Arabic and emoji are content and find the record
  for (const needle of ["بحث عينة", "🛰️"]) {
    const res = await lead.req.get(`/api/v1/transformations?q=${encodeURIComponent(needle)}`);
    expect(res.status(), needle).toBe(200);
    const list = (await res.json()) as { items: { id: string; name: string }[] };
    expect(list.items.map((x) => x.id)).toContain(t.id);
    expect(list.items.find((x) => x.id === t.id)!.name).toBe(arabicName);
  }
  console.log(`QA-R8 [${lang}] R8-03 unauthenticated ?q=%FF -> 401; Arabic and emoji ?q= -> 200 and the record is found with its exact name`);
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

test("R8-04 UI: Arabic, emoji, RLM and combining marks in the charter round-trip verbatim", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const t = await newTransformation(`QA r8 UI roundtrip ${lang.toUpperCase()} (synthetic)`);
  const text = "حالة التغيير ‏الاصطناعية 🚀 👩🏽‍💻 Synthétic — تجربة";
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${t.id}/charter`);
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  const label = fieldLabel(lang, "define.charter.field.caseForChange");
  const how = await setExact(page, label, text);
  const statuses: number[] = [];
  page.on("response", (r) => {
    if (r.request().method() === "POST" && r.url().endsWith("/charter")) statuses.push(r.status());
  });
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await expect.poll(() => statuses).toEqual([201]);
  const api = await lead.call<Charter>("GET", `/api/v1/transformations/${t.id}/charter`);
  expect(api.charter.caseForChange).toBe(text);
  await page.reload();
  await expect(page.getByText("حالة التغيير", { exact: false }).first()).toBeVisible();
  const shown = await page.evaluate(() => document.body.innerText);
  expect(shown).toContain(text.trim());
  console.log(`QA-R8 [${lang}] R8-04 value set via ${how}; POST ${statuses[0]}; API and the reloaded page show the exact ${[...text].length} code points`);
  await qaShot(page, lang, "qa-r8-04-charter-arabic-emoji");
  await expectAccessible(page, lang, "qa-r8-charter-arabic-emoji");
  expect(foreign).toEqual([]);
});

test("R8-05 UI -> real server: an invalid UTF-8 body is refused with the localized validation__json message", async ({ page }, info) => {
  const lang = langOf(info);
  const t = await newTransformation(`QA r8 UI invalid-utf8 ${lang.toUpperCase()} (synthetic)`);
  await signIn(page, lang, "dev.lead");
  const statuses: number[] = [];
  const bodies: string[] = [];
  page.on("response", async (r) => {
    if (r.request().method() === "POST" && r.url().endsWith("/charter")) {
      // Record status and body TOGETHER once the body is read (round-8 attempt 2 raced: status pushed before the body).
      const text = await r.text().catch(() => "");
      bodies.push(text);
      statuses.push(r.status());
    }
  });
  await page.route(`**/api/v1/transformations/${t.id}/charter`, async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    const text = req.postData() ?? "{}";
    const at = text.indexOf("Synthetic out of scope");
    expect(at).toBeGreaterThan(0);
    const bytes = Buffer.from(text, "utf8");
    const cut = Buffer.byteLength(text.slice(0, at), "utf8") + "Synthetic ".length;
    const tampered = Buffer.concat([bytes.subarray(0, cut), Buffer.from([0xff, 0xfe]), bytes.subarray(cut)]);
    return route.continue({ postData: tampered });
  });
  await page.goto(`/transformations/${t.id}/charter`);
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope")).fill("Synthetic out of scope");
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await expect.poll(() => statuses).toEqual([400]);
  const problem = JSON.parse(bodies[0]!) as Problem;
  expect(problem.errors).toEqual([expect.objectContaining({ pointer: "", code: "validation.json" })]);
  const msg = tr(lang, "problems.validation__json");
  await expect(page.getByText(new RegExp(escape(msg))).first()).toBeVisible();
  console.log(`QA-R8 [${lang}] R8-05 server ${statuses[0]} ${JSON.stringify(problem.errors)} shown as "${msg}"`);
  expect((await lead.req.get(`/api/v1/transformations/${t.id}/charter`)).status()).toBe(404);
  await qaShot(page, lang, "qa-r8-05-charter-invalid-utf8-server");
  await expectAccessible(page, lang, "qa-r8-charter-invalid-utf8-server");
});

test("R8-06 UI: Arabic/emoji search finds the record; a deep link with ?q=%FF never yields a 5xx", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const name = `QA r8 قائمة ${lang} 🧭 (synthetic)`;
  const t = await newTransformation(name);
  await signIn(page, lang, "dev.lead");
  const apiStatuses: string[] = [];
  page.on("response", (r) => {
    if (new URL(r.url()).pathname === "/api/v1/transformations") apiStatuses.push(`${r.status()} ${new URL(r.url()).search}`);
  });
  await page.goto("/transformations");
  const search = page.getByLabel(tr(lang, "common.filter.search"), { exact: true });
  for (const needle of ["قائمة", "🧭"]) {
    await search.fill(needle);
    await search.press("Enter");
    await expect(page.getByRole("link", { name: new RegExp(escape(name)) }).first()).toBeVisible();
  }
  console.log(`QA-R8 [${lang}] R8-06 search requests ${JSON.stringify(apiStatuses)}`);
  expect(apiStatuses.filter((s) => !s.startsWith("200"))).toEqual([]);
  await qaShot(page, lang, "qa-r8-06-search-arabic-emoji");
  await expectAccessible(page, lang, "qa-r8-search-arabic-emoji");
  // deep link with an undecodable query: the document request and every API request stay below 500
  const doc = await page.goto("/transformations?q=%FF");
  const docStatus = doc?.status() ?? 0;
  expect(docStatus).toBeLessThan(500);
  await page.waitForLoadState("networkidle");
  const after = [...apiStatuses];
  console.log(`QA-R8 [${lang}] R8-06 deep link /transformations?q=%FF: document ${docStatus} ${doc?.headers()["content-type"]}; API ${JSON.stringify(after.slice(-2))}`);
  expect(after.filter((s) => Number(s.split(" ")[0]) >= 500)).toEqual([]);
  if (docStatus === 200) {
    await expect(page.getByRole("search")).toBeVisible();
    await qaShot(page, lang, "qa-r8-06-deeplink-ff");
    await expectAccessible(page, lang, "qa-r8-deeplink-ff");
  }
  expect(t.id).toBeTruthy();
  expect(foreign).toEqual([]);
});
