// qa-verifier DG6 round 9 (T-DG6-REV-QA-R9, run 7e2124db): round 8's standing probe zz-qa-dg6r8-aud-reflow.spec.ts re-used on candidate fe824c05 (source d974011f); changes: names r8 -> r9 only.
// qa-verifier DG6 round 8 (T-DG6-REV-QA-R9) on candidate 6cda8b33: copied from tests/round-7/zz-qa-dg6r7-aud-reflow.spec.ts; the only change is the rename of identifiers dg6r7 -> dg6r9 and QA-R7 -> QA-R9 (the comments below are the earlier rounds' text).
// qa-verifier DG6 round 7 (T-DG6-REV-QA-R9) on candidate b64b95ff: copied from tests/round-6/zz-qa-dg6r6-aud-reflow.spec.ts; the only change is the rename of identifiers dg6r6 -> dg6r9 and QA-R6 -> QA-R9 (the comments below are the round-6 text).
// qa-verifier DG6 round 6 (T-DG6-REV-QA-R9; copied unchanged from my round-5 probe except names): copied from round-4/zz-qa-dg6r4-aud-reflow.spec.ts and re-run on candidate 832e5c82; identifiers renamed dg6r4 -> dg6r5 and QA-R4 -> QA-R5 (round 5); now dg6r5 -> dg6r9 (round 6) outside the provenance comments below.
// qa-verifier DG6 round 4 (T-DG6-REV-QA-R4): copied unchanged in its checks from round-3/zz-qa-dg6r3-aud-reflow.spec.ts (round 3) and re-run on candidate 4b84bf20; only names r3 -> r4.
// qa-verifier DG6 round 3 (T-DG6-REV-QA-R4): the round-2 probe zz-qa-dg6r2-aud-reflow.spec.ts re-run on candidate aa219bd2, unchanged except for its names (dg6r2 -> dg6r4).
// qa-verifier DG6 round 2 (T-DG6-REV-QA-R2; the round-1 probe re-run unchanged except for its names)
// Originally: qa-verifier DG6 round 1 (T-DG6-REV-QA-R1): independent probes, NOT part of the frozen candidate. Copied into a
// disposable copy as e2e/zz-qa-dg6r9-aud-reflow.spec.ts and run inside apps/web/e2e/support/with-stack.sh.
//  A. AUD read-only pass over the P6 screens (REQ-S10-004, REQ-S16-027, REQ-S20-012, ADR-0020): dev.auditor (AUD,
//     organization scope) opens every parameter-free P6 route plus the transformation-scoped imports and outbound-write
//     screens; on each, no ENABLED control in <main> carries a write label (labels taken from the en AND ar catalogues:
//     every catalogue string whose en text starts with a write verb, and its ar counterpart at the same key). Through
//     the API, every P6 mutation the auditor tries is refused (403/404) and the lists it can read are unchanged.
//  C. REQ-S15-007 clause 2 literally: a 400 VALIDATION problem from the API (not a business-rule refusal) is shown in
//     the selected language.
//  D. REQ-S17-001: a SUCCEEDED test-connector run's row counts and last success are visible in the UI (the register
//     notes say no test asserts the non-null counts of a succeeded run on screen).
//  E. REQ-S02-006 clause 2: clearing all browser storage (local, session, IndexedDB and the cookies) loses no submitted
//     business data (the notes say this clause rests on the frontend e2e only).
//  B. Reflow on the P6 screens (REQ-S15-009, REQ-S20-020): at 360 x 800, 390 x 844 and at 1280 x 900 with the root
//     font size at 200 %, the page has no horizontal scroll and the h1 is inside the viewport and not clipped.
// All data is SYNTHETIC; nothing here approves anything (no G1-G6 business approval; unrelated to DG0-DG7).
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SYN_RETAIL, apiSession, fieldLabel, langOf, signIn, tr, type Lang } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);
const OUT = process.env["QA_PROBE_OUT"] ?? "test-results/qa-dg6r9";
const stamp = Date.now().toString(36);

const ADMIN_ROUTES = [
  "/admin/audit",
  "/admin/security",
  "/admin/upload-policy",
  "/admin/sensitive-grants",
  "/admin/operations",
  "/admin/service-identities",
  "/admin/identity",
  "/admin/storage",
  "/admin/notification-channels",
  "/admin/notification-deliveries",
  "/admin/integrations",
  "/admin/integrations/outbound-writes",
  "/admin/integrations/webhooks",
  "/admin/assistant",
];
const USER_ROUTES = ["/strategy-kpis/imports", "/search", "/my-work/drafts"];
const T_ROUTES = (id: string) => [`/transformations/${id}/imports`, `/transformations/${id}/outbound-writes`];

const WRITE_VERB =
  /^(Create|New|Add|Save|Submit|Delete|Remove|Run|Retry|Enable|Disable|Upload|Import|Commit|Approve|Reject|Confirm|Send|Test|Revoke|Grant|Rotate|Acknowledge|Resolve|Publish|Edit|Mark|Reapply|Configure|Request)\b/;

function flatten(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (prefix: string, node: unknown) => {
    if (typeof node === "string") out.set(prefix, node);
    else if (node && typeof node === "object")
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(prefix ? `${prefix}.${k}` : k, v);
  };
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")))
    walk(f.replace(/\.json$/, ""), JSON.parse(readFileSync(path.join(dir, f), "utf8")));
  return out;
}
const I18N = path.join("apps", "web", "src", "i18n");
const EN = flatten(path.join(I18N, "en"));
const AR = flatten(path.join(I18N, "ar"));
const writeLabels: Record<Lang, string[]> = { en: [], ar: [] };
for (const [k, v] of EN) {
  if (v.length > 40 || !WRITE_VERB.test(v)) continue;
  writeLabels.en.push(v.replace(/\{\{.*?\}\}/g, "").trim());
  const a = AR.get(k);
  if (a) writeLabels.ar.push(a.replace(/\{\{.*?\}\}/g, "").trim());
}
const isWrite = (lang: Lang, name: string) => {
  const n = name.replace(/\s+/g, " ").trim();
  return writeLabels[lang].some((l) => l.length > 1 && (n === l || n.startsWith(`${l}:`) || n.startsWith(`${l} `)));
};

async function settle(page: Page) {
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
}

let tId = "";
test.beforeAll(async ({ playwright }) => {
  const lead = await apiSession(playwright, "dev.lead");
  const t = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic QA DG6R1 probe ${stamp}`,
    mode: "end_to_end",
  });
  tId = t.id;
});

test("A. AUD read-only: no enabled write control on the P6 screens; every P6 mutation refused", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  expect(writeLabels.en.length).toBeGreaterThan(50);
  expect(writeLabels.ar.length).toBeGreaterThan(50);
  await signIn(page, lang, "dev.auditor");
  const report: Record<string, unknown>[] = [];
  const offending: string[] = [];
  for (const route of [...ADMIN_ROUTES, ...USER_ROUTES, ...T_ROUTES(tId)]) {
    await page.goto(route);
    await settle(page);
    await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    const h1 = (await page.locator("main#main h1").first().innerText()).trim();
    const states = await page.locator("main#main [data-state]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-state")),
    );
    const controls = await page
      .locator("main#main")
      .locator("button, a[role=button], input[type=submit], input[type=file]")
      .evaluateAll((els) =>
        els
          .filter((e) => !(e as HTMLButtonElement).disabled && e.getAttribute("aria-disabled") !== "true")
          .filter((e) => (e as HTMLElement).offsetParent !== null || e.getAttribute("type") === "file")
          .map((e) => (e.getAttribute("aria-label") ?? (e as HTMLElement).innerText ?? e.getAttribute("type") ?? "").trim()),
      );
    const writes = controls.filter((c) => isWrite(lang, c) || c === "file");
    report.push({ route, h1, states, controls, writes });
    for (const w of writes) offending.push(`${route}: "${w}"`);
  }

  // API: the auditor's P6 mutations are refused and change nothing.
  const aud = await apiSession(playwright, "dev.auditor");
  const T = `/api/v1/transformations/${tId}`;
  const before = {
    connectors: await aud.req.get("/api/v1/admin/connectors"),
    imports: await aud.req.get(`${T}/imports`),
    writes: await aud.req.get(`${T}/outbound-writes`),
  };
  const beforeBodies = {
    connectors: before.connectors.ok() ? await before.connectors.text() : `status ${before.connectors.status()}`,
    imports: before.imports.ok() ? await before.imports.text() : `status ${before.imports.status()}`,
    writes: before.writes.ok() ? await before.writes.text() : `status ${before.writes.status()}`,
  };
  const attempts: [string, string, unknown][] = [
    ["POST", "/api/v1/admin/connectors", { name: "QA probe", kind: "test", config: {} }],
    ["PUT", "/api/v1/admin/upload-policy", { allowed: ["exe"], maxBytes: 1 }],
    ["POST", "/api/v1/admin/sensitive-grants", { recordType: "benefit", recordId: tId, userId: aud.userId }],
    ["PUT", "/api/v1/admin/storage", { driver: "filesystem" }],
    ["POST", "/api/v1/admin/storage/test", {}],
    ["PUT", "/api/v1/admin/notification-channels/email", { enabled: true }],
    ["POST", "/api/v1/admin/notification-channels/email/test", {}],
    ["POST", "/api/v1/admin/webhooks", { name: "QA probe" }],
    ["PUT", "/api/v1/admin/assistant", { provider: "test" }],
    ["POST", "/api/v1/admin/assistant/enable", {}],
    ["POST", `${T}/imports`, { templateVersion: "kpi-actuals-v1" }],
    ["POST", `${T}/outbound-writes`, { action: "x", payload: {} }],
    ["PUT", "/api/v1/admin/service-identities/01920000-0000-7000-9000-000000000999", { enabled: false }],
    ["POST", "/api/v1/admin/operations/exceptions/01920000-0000-7000-9000-000000000999/acknowledge", {}],
  ];
  const api: Record<string, number> = {};
  const me = (await (await aud.req.get("/api/v1/me")).json()) as { csrfToken: string; organization: { id: string } };
  // A fully VALID connector definition (the body test D uses as the administrator): the auditor must get 403, so the
  // refusal is authorization, not validation (attempt 2 of this probe showed that sloppy bodies answer 400 first).
  attempts.unshift([
    "POST",
    "/api/v1/admin/connectors",
    {
      organizationId: me.organization.id,
      code: `qa-dg6r9-aud-${stamp}`,
      nameEn: "QA DG6R1 auditor attempt",
      nameAr: "محاولة المدقق",
      adapterKind: "test_adapter",
      targetKind: "kpi_actual",
      config: {
        sourceSystemId: "synthetic.qa-dg6r9:aud",
        endpointUrl: null,
        credentialRefs: {},
        fieldMappings: [],
        targetTransformationId: tId,
        cadence: "manual",
        retryMaxAttempts: 0,
        retryBackoffSeconds: 60,
        commitMode: "manual",
        commitOnBehalfOf: null,
        outboundActions: [],
        reconciliationRule: "none",
        adapterSettings: { mode: "healthy", fixture: { rows: [], controlColumn: "value" } },
        reason: "QA DG6R1 auditor attempt (must be refused)",
      },
    },
  ]);
  let validConnector = 0;
  for (const [i, [method, url, body]] of attempts.entries()) {
    const res = await aud.req.fetch(url, {
      method,
      headers: { "X-CSRF-Token": me.csrfToken, "Idempotency-Key": crypto.randomUUID(), "If-Match": '"1"' },
      data: body,
    });
    if (i === 0) validConnector = res.status();
    else api[`${method} ${url}`] = res.status();
  }
  api["POST /api/v1/admin/connectors (valid body)"] = validConnector;
  const after = {
    connectors: await (await aud.req.get("/api/v1/admin/connectors")).text(),
    imports: await (await aud.req.get(`${T}/imports`)).text(),
    writes: await (await aud.req.get(`${T}/outbound-writes`)).text(),
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    path.join(OUT, `aud-${lang}.json`),
    JSON.stringify({ lang, writeLabelCount: writeLabels[lang].length, screens: report, api, beforeStatus: {
      connectors: before.connectors.status(), imports: before.imports.status(), writes: before.writes.status() } }, null, 1),
  );
  console.log(`AUD ${lang}: ${report.length} screens; offending ${JSON.stringify(offending)}; api ${JSON.stringify(api)}`);
  expect(offending).toEqual([]);
  // Every attempt is refused (never 2xx); the valid connector definition is refused by authorization (403).
  for (const [k, s] of Object.entries(api)) expect([400, 403, 404, 409, 422, 428], k).toContain(s);
  expect(validConnector, "a valid connector create by the auditor").toBe(403);
  if (before.connectors.ok()) expect(after.connectors).toBe(beforeBodies.connectors);
  if (before.imports.ok()) expect(after.imports).toBe(beforeBodies.imports);
  if (before.writes.ok()) expect(after.writes).toBe(beforeBodies.writes);
});

test("C. REQ-S15-007: a field VALIDATION error (400) returned by the API is shown in the selected language", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await page.goto("/transformations/new");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "transformations.createTitle"));
  const unit = page.getByLabel(fieldLabel(lang, "transformations.field.businessUnit"));
  const v = await unit.locator("option", { hasText: "SYN-RETAIL" }).first().evaluate((o) => (o as HTMLOptionElement).value);
  await unit.selectOption(v);
  await page.getByLabel(fieldLabel(lang, "transformations.field.name")).fill(`Synthetic QA DG6R1 validation ${stamp}`);
  // The browser's request is valid; the probe rewrites businessUnitId on the wire so the SERVER answers a real 400
  // validation problem (validation.invalid_format at /body/businessUnitId), bypassing any client-side check.
  let served: { status: number; body: string } | null = null;
  await page.route("**/api/v1/transformations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    body["businessUnitId"] = "not-a-uuid";
    const res = await route.fetch({ postData: JSON.stringify(body) });
    served = { status: res.status(), body: await res.text() };
    await route.fulfill({ response: res });
  });
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  await expect.poll(() => served?.status ?? 0, { timeout: 30_000 }).toBe(400);
  const expected = tr(lang, "problems.validation__invalid_format");
  const main = page.locator("main#main");
  await expect(main.getByText(expected).first()).toBeVisible({ timeout: 15_000 });
  const text = await main.innerText();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `validation-${lang}.json`), JSON.stringify({ served, expected, mainText: text.slice(0, 2000) }, null, 1));
  await page.screenshot({ path: path.join(OUT, `validation-${lang}.png`) });
  console.log(`VALIDATION ${lang}: server ${served!.status} ${served!.body.slice(0, 300)}; shown "${expected}"`);
  expect(served!.body).toContain("validation.invalid_format");
  // The API's English developer message is never what the user reads in Arabic.
  if (lang === "ar") expect(text).not.toContain("Invalid UUID");
  expect(text).not.toContain("The request is not valid.");
});

test("D. REQ-S17-001: a succeeded test-connector run shows its row counts and the last success on screen", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const admin = await apiSession(playwright, "dev.admin");
  const me = await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me");
  // Three synthetic rows for KPI ids that do not exist: the run reads and stages them and the validation rejects them,
  // so every count is a real, non-null number (3 read, 3 staged, 3 rejected).
  const rows = [1, 2, 3].map((n) => ({
    source_record_id: `QA-R1-${n}`,
    kpi_id: crypto.randomUUID(),
    scope_kind: "transformation",
    scope_id: tId,
    period_label: "2044-01",
    value: String(n),
    data_as_of: "2044-01-31",
  }));
  const c = await admin.call<{ id: string; version: number }>(
    "POST",
    "/api/v1/admin/connectors",
    {
      organizationId: me.organization.id,
      code: `qa-dg6r9-ok-${lang}-${stamp}`,
      nameEn: `QA DG6R1 synthetic healthy source ${lang}`,
      nameAr: `مصدر اصطناعي سليم ${lang}`,
      adapterKind: "test_adapter",
      targetKind: "kpi_actual",
      config: {
        sourceSystemId: `synthetic.qa-dg6r9:${lang}`,
        endpointUrl: null,
        credentialRefs: {},
        fieldMappings: [],
        targetTransformationId: tId,
        cadence: "manual",
        retryMaxAttempts: 0,
        retryBackoffSeconds: 60,
        commitMode: "manual",
        commitOnBehalfOf: null,
        outboundActions: [],
        reconciliationRule: "none",
        adapterSettings: { mode: "healthy", fixture: { rows, controlColumn: "value" } },
        reason: "QA DG6R1 synthetic healthy connector",
      },
    },
    { expect: 201 },
  );
  await admin.call("POST", `/api/v1/admin/connectors/${c.id}/enable`, { reason: null }, { ifMatch: c.version });
  const queued = await admin.call<{ id: string }>("POST", `/api/v1/admin/connectors/${c.id}/runs`, {});
  type Run = { id: string; status: string; rowsRead: number | null; rowsStaged: number | null; rowsRejected: number | null; rowsDuplicate: number | null; finishedAt: string | null };
  let run: Run | null = null;
  await expect
    .poll(
      async () => {
        const list = await admin.call<{ items: Run[] }>("GET", `/api/v1/admin/connectors/${c.id}/runs?limit=10`);
        run = list.items[0] ?? null;
        return run?.status ?? "none";
      },
      { timeout: 90_000, intervals: [2_000] },
    )
    .toBe("succeeded");
  const r = run as unknown as Run;
  console.log(`CONNECTOR RUN ${lang}: queued ${JSON.stringify(queued).slice(0, 120)} -> ${JSON.stringify(r)}`);
  for (const k of ["rowsRead", "rowsStaged", "rowsRejected", "rowsDuplicate"] as const) expect(r[k], k).not.toBeNull();
  await signIn(page, lang, "dev.admin");
  await page.goto(`/admin/integrations/connectors/${c.id}`);
  await expect(page.locator("main#main h1")).toBeVisible();
  const counts = await page.locator("main#main [data-count]").evaluateAll((els) => els.map((e) => e.getAttribute("data-count")));
  const lastSuccess = await page.locator("[data-last-success]").first().evaluate((e) => ({
    attr: e.getAttribute("data-last-success"),
    text: (e as HTMLElement).innerText,
  }));
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `connector-counts-${lang}.png`), fullPage: true });
  let detail: string[] = [];
  const runLink = page.locator(`a[href*='/runs/${r.id}']`).first();
  if (await runLink.count()) {
    await runLink.click();
    await expect(page.locator("main#main h1")).toBeVisible();
    detail = await page.locator("main#main [data-count]").evaluateAll((els) => els.map((e) => e.getAttribute("data-count")));
    await page.screenshot({ path: path.join(OUT, `connector-run-${lang}.png`), fullPage: true });
  }
  writeFileSync(path.join(OUT, `connector-counts-${lang}.json`), JSON.stringify({ run: r, counts, detail, lastSuccess }, null, 1));
  console.log(`CONNECTOR UI ${lang}: list counts ${JSON.stringify(counts)}; detail counts ${JSON.stringify(detail)}; last success ${JSON.stringify(lastSuccess)}`);
  const shown = [...counts, ...detail];
  for (const k of ["rowsRead", "rowsStaged", "rowsRejected", "rowsDuplicate"] as const)
    expect(shown, `${k}=${r[k]} visible`).toContain(String(r[k]));
  expect(lastSuccess.attr).not.toBe("never");
});

test("E. REQ-S02-006: clearing ALL browser storage (local, session, IndexedDB, cookies) loses no submitted business data", async ({
  page,
  context,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await page.goto("/transformations/new");
  const unit = page.getByLabel(fieldLabel(lang, "transformations.field.businessUnit"));
  const v = await unit.locator("option", { hasText: "SYN-RETAIL" }).first().evaluate((o) => (o as HTMLOptionElement).value);
  await unit.selectOption(v);
  const name = `Synthetic QA DG6R1 storage ${lang} ${stamp}`;
  await page.getByLabel(fieldLabel(lang, "transformations.field.name")).fill(name);
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  await page.waitForURL(/\/transformations\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const before = await page.evaluate(async () => ({
    local: Object.keys(localStorage).length,
    session: Object.keys(sessionStorage).length,
    idb: "databases" in indexedDB ? (await indexedDB.databases()).map((d) => d.name) : [],
  }));
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    if ("databases" in indexedDB) for (const d of await indexedDB.databases()) if (d.name) indexedDB.deleteDatabase(d.name);
  });
  await context.clearCookies();
  const after = await page.evaluate(() => ({ local: Object.keys(localStorage).length, session: Object.keys(sessionStorage).length }));
  // A new sign-in from the cleared browser: the record is read back from the server, by screen and by API.
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${id}`);
  await expect(page.locator("main#main")).toContainText(name, { timeout: 30_000 });
  const api = await page.request.get(`/api/v1/transformations/${id}`);
  const body = (await api.json()) as { name?: string };
  console.log(`STORAGE ${lang}: before ${JSON.stringify(before)} after ${JSON.stringify(after)}; API ${api.status()} name ${body.name}`);
  expect(api.status()).toBe(200);
  expect(body.name).toBe(name);
});

const MODES = [
  { name: "360", width: 360, height: 800, font: null },
  { name: "390", width: 390, height: 844, font: null },
  { name: "200pct", width: 1280, height: 900, font: "200%" },
] as const;

for (const who of ["dev.admin", "dev.lead"] as const) {
  test(`B. reflow at 360 px, 390 px and 200 % text on the P6 screens (${who})`, async ({ page }, info) => {
    const lang = langOf(info);
    await signIn(page, lang, who);
    const routes = who === "dev.admin" ? ADMIN_ROUTES : [...USER_ROUTES, ...T_ROUTES(tId)];
    const results: Record<string, unknown>[] = [];
    const bad: string[] = [];
    for (const m of MODES) {
      await page.setViewportSize({ width: m.width, height: m.height });
      for (const route of routes) {
        await page.goto(route);
        // The product's CSP (style-src 'self') refuses an injected <style> (probe attempt 2); the root font size is set
        // through the CSSOM instead, as a user stylesheet or text zoom would scale rem-based text.
        if (m.font) await page.evaluate((f) => document.documentElement.style.setProperty("font-size", f, "important"), m.font);
        await settle(page);
        const r = await page.evaluate(() => {
          const se = document.scrollingElement as HTMLElement;
          const h1 = document.querySelector("main#main h1") as HTMLElement;
          const b = h1.getBoundingClientRect();
          return {
            scrollW: se.scrollWidth,
            clientW: se.clientWidth,
            h1Left: Math.round(b.left),
            h1Right: Math.round(b.right),
            h1Clipped: h1.scrollWidth > h1.clientWidth + 1,
            rootFont: getComputedStyle(document.documentElement).fontSize,
          };
        });
        results.push({ mode: m.name, route, ...r });
        if (r.scrollW > r.clientW + 1) bad.push(`${m.name} ${route}: page scrolls horizontally (${r.scrollW} > ${r.clientW})`);
        if (r.h1Left < -1 || r.h1Right > r.clientW + 1) bad.push(`${m.name} ${route}: h1 outside the viewport`);
        if (r.h1Clipped) bad.push(`${m.name} ${route}: h1 clipped`);
        if (m.font) expect(r.rootFont).toBe("32px");
      }
      mkdirSync(path.join(OUT, "shots"), { recursive: true });
      await page.screenshot({ path: path.join(OUT, "shots", `${lang}-${who}-${m.name}-last.png`) });
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, `reflow-${lang}-${who}.json`), JSON.stringify(results, null, 1));
    console.log(`REFLOW ${lang} ${who}: ${results.length} checks; problems ${JSON.stringify(bad)}`);
    expect(bad).toEqual([]);
  });
}
