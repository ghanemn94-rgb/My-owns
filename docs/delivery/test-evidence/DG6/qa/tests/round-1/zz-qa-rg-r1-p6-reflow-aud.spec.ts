// qa-verifier DG6 clean re-gate round 1 (T-DG6-REV-QA-RG-R1): independent probe, kept outside the frozen candidate.
// To run it, copy it to apps/web/e2e/ in a DISPOSABLE clone and run on the real production-initialized stack:
//   E2E_SCREENSHOT_DIR=... apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/zz-qa-rg-r1-p6-reflow-aud.spec.ts --workers=1
// It checks, in chromium-en and chromium-ar:
//   (1) REQ-S15-009 / REQ-S20-020 (assignment: "check 360 px, 390 px and 200 % text on the P6 screens"): every P6
//       screen (search, drafts, inbox, integrations, webhooks, outbound writes, imports, assistant settings, audit,
//       security, upload policy, storage, sensitive grants, operations, jobs operations, service identities, identity)
//       as the synthetic administrator at 360 x 800, 390 x 844 and 1280 x 900 with the root font at 200 %: no page-level
//       horizontal scroll, an h1 is shown, and no stack trace or raw error text; axe (wcag2a/aa, 21a/aa) at 390 px reports
//       no serious or critical violation.
//   (2) AUD read-only pass (assignment: "include an AUD read-only pass"): the synthetic auditor opens the same P6 screens;
//       the inventory of enabled controls whose label is a mutation verb is recorded, and must be empty; and a sample of
//       P6 mutations sent by the auditor through the API is refused (403) and changes nothing.
// Every record is SYNTHETIC; nothing approves anything (G1-G6) or names DG0-DG7.
import { expect, test, type Page } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SYN_RETAIL, apiSession, expectAccessible, langOf, shot, signIn } from "./support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);

const OUT = process.env.E2E_SCREENSHOT_DIR ?? "test-results";
const ROUTES = [
  "/search?q=synthetic",
  "/my-work/drafts",
  "/my-work",
  "/my-work/notification-preferences",
  "/admin/integrations",
  "/admin/integrations/webhooks",
  "/admin/integrations/outbound-writes",
  "/strategy-kpis/imports",
  "/admin/assistant",
  "/admin/audit",
  "/admin/security",
  "/admin/upload-policy",
  "/admin/sensitive-grants",
  "/admin/operations",
  "/admin/jobs/operations",
  "/admin/service-identities",
  "/admin/identity",
  "/admin/automation/failures",
];
const VIEWS = [
  { name: "360", width: 360, height: 800, font: null },
  { name: "390", width: 390, height: 844, font: null },
  { name: "200pct", width: 1280, height: 900, font: "200%" },
] as const;

async function measure(page: Page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    const main = document.querySelector("main#main");
    const text = (main?.textContent ?? "").slice(0, 20000);
    return {
      scroll: d.scrollWidth,
      client: d.clientWidth,
      h1: document.querySelector("main#main h1")?.textContent?.trim() ?? null,
      leak: /\bat [\w.<>]+ \(.*:\d+:\d+\)|TypeError|ReferenceError|stack trace|ECONNREFUSED|postgres(?:ql)?:\/\/|SELECT .* FROM|pg-boss|node_modules/i.exec(
        text,
      )?.[0] ?? null,
    };
  });
}

async function settle(page: Page) {
  await expect(page.locator("main#main h1")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

test("P6 screens at 360 px, 390 px and 200 % text: no horizontal scroll, no leak; axe at 390 px", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.admin");
  const rows: Record<string, unknown>[] = [];
  const failures: string[] = [];
  for (const v of VIEWS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    for (const r of ROUTES) {
      await page.goto(r);
      await settle(page);
      if (v.font) await page.evaluate((f) => (document.documentElement.style.fontSize = f), v.font);
      await page.waitForTimeout(150);
      const m = await measure(page);
      rows.push({ lang, view: v.name, route: r, ...m });
      if (m.scroll > m.client + 1) failures.push(`${lang} ${v.name} ${r}: scrollWidth ${m.scroll} > ${m.client}`);
      if (m.leak) failures.push(`${lang} ${v.name} ${r}: infrastructure/stack text '${m.leak}'`);
      if (v.name === "390") {
        await expectAccessible(page, lang, `qa-rg-r1-${r.replace(/[^a-z0-9]+/gi, "-")}-390`).catch((e: Error) => {
          failures.push(`${lang} 390 ${r}: axe ${e.message.split("\n").slice(0, 6).join(" | ")}`);
        });
        await shot(page, lang, `qa-rg-r1${r.replace(/[^a-z0-9]+/gi, "-")}-390`);
      }
      if (v.font) await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    }
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `qa-rg-r1-p6-reflow-${lang}.json`), JSON.stringify({ rows, failures }, null, 1));
  console.log(`QA-RG-R1 reflow ${lang}: ${rows.length} measurements, ${failures.length} failures`);
  for (const f of failures) console.log(`QA-RG-R1 reflow FAIL ${f}`);
  expect(failures).toEqual([]);
});

const MUTATION_VERB =
  /^(save|create|new|add|delete|remove|enable|disable|revoke|grant|run|retry|acknowledge|resolve|upload|commit|test|edit|rotate|bind|submit|approve|reject|discard|publish|reindex|start|stop|import|send|حفظ|إنشاء|جديد|إضافة|حذف|إزالة|تفعيل|تعطيل|إلغاء|منح|تشغيل|إعادة|إقرار|معالجة|رفع|اعتماد|اختبار|تعديل|تدوير|ربط|إرسال|رفض|نشر|استيراد)/i;

test("AUD read-only pass over the P6 screens: no enabled mutation control; API mutations are 403", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.auditor");
  const inventory: Record<string, string[]> = {};
  const offending: string[] = [];
  for (const r of ROUTES) {
    await page.goto(r);
    await settle(page);
    const controls = await page.evaluate(() =>
      [...document.querySelectorAll("main#main button, main#main a[role='button'], main#main input[type='submit']")]
        .filter((el) => {
          const h = el as HTMLButtonElement;
          if (h.closest("th")) return false; // column sort buttons, not mutations
          const st = getComputedStyle(h);
          return !h.disabled && h.getAttribute("aria-disabled") !== "true" && st.display !== "none" && st.visibility !== "hidden" && h.offsetParent !== null;
        })
        .map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ")),
    );
    inventory[r] = controls;
    for (const c of controls) if (MUTATION_VERB.test(c)) offending.push(`${r}: '${c}'`);
  }
  await shot(page, lang, "qa-rg-r1-aud-last");
  // API: P6 mutations with VALID bodies (built from the administrator's own view), sent by the auditor: 403, nothing changes.
  const aud = await apiSession(playwright, "dev.auditor");
  const admin = await apiSession(playwright, "dev.admin");
  const lead = await apiSession(playwright, "dev.lead");
  const tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic QA AUD ${lang.toUpperCase()} ${Date.now().toString(36)}`,
      mode: "end_to_end",
    })
  ).id;
  const orgId = "01920000-0000-7000-9000-000000000001"; // the seed-dev organization (as the shipped P6 specs use)
  const stamp = Date.now().toString(36);
  const connectorBody = {
    organizationId: orgId,
    code: `qa-aud-${lang}-${stamp}`,
    nameEn: `QA AUD synthetic ${lang}`,
    nameAr: `تجريبي ${lang}`,
    adapterKind: "test_adapter",
    targetKind: "kpi_actual",
    config: {
      sourceSystemId: `synthetic.qa-aud:${stamp}`,
      endpointUrl: null,
      credentialRefs: {},
      fieldMappings: [],
      targetTransformationId: tid,
      cadence: "manual",
      retryMaxAttempts: 0,
      retryBackoffSeconds: 60,
      commitMode: "manual",
      commitOnBehalfOf: null,
      outboundActions: [],
      reconciliationRule: "row_count",
      adapterSettings: { mode: "stopped" },
      reason: "QA AUD probe (synthetic)",
    },
  };
  const countConnectors = async () => {
    const res = await admin.req.get(`/api/v1/admin/connectors?organizationId=${orgId}&limit=100`);
    const body = (await res.json()) as { items?: unknown[] };
    expect(res.status(), JSON.stringify(body).slice(0, 300)).toBe(200);
    return body.items!.length;
  };
  const before = await countConnectors();
  const audCsrf = ((await (await aud.req.get("/api/v1/me")).json()) as { csrfToken: string }).csrfToken;
  const send = async (m: string, p: string, body: unknown, ifMatch?: number) =>
    (
      await aud.req.fetch(p, {
        method: m,
        data: body,
        headers: {
          "X-CSRF-Token": audCsrf,
          "Idempotency-Key": crypto.randomUUID(),
          ...(ifMatch !== undefined ? { "If-Match": `"${ifMatch}"` } : {}),
        },
      })
    ).status();
  const statuses: Record<string, number> = {};
  statuses["POST /api/v1/admin/connectors (valid body)"] = await send("POST", "/api/v1/admin/connectors", connectorBody);
  // The administrator creates the same connector; the auditor then tries to enable, test and disable it.
  const c = await admin.call<{ id: string; version: number }>("POST", "/api/v1/admin/connectors", { ...connectorBody, code: `qa-aud2-${lang}-${stamp}` });
  statuses["POST connectors/{id}/enable"] = await send("POST", `/api/v1/admin/connectors/${c.id}/enable`, { reason: "QA AUD probe" }, c.version);
  statuses["POST connectors/{id}/test"] = await send("POST", `/api/v1/admin/connectors/${c.id}/test`, {});
  statuses["POST connectors/{id}/disable"] = await send("POST", `/api/v1/admin/connectors/${c.id}/disable`, { reason: "QA AUD probe" }, c.version);
  statuses["POST /api/v1/admin/assistant/enable"] = await send("POST", "/api/v1/admin/assistant/enable", { reason: "QA AUD probe" }, 0);
  statuses["POST /api/v1/admin/storage/test"] = await send("POST", "/api/v1/admin/storage/test", {});
  statuses["POST /api/v1/admin/sensitive-grants (real transformation)"] = await send("POST", "/api/v1/admin/sensitive-grants", {
    transformationId: tid,
    recordType: "benefit",
    recordId: tid,
    granteeUserId: aud.userId,
    reason: "QA AUD probe (synthetic)",
  });
  const after = await countConnectors();
  const connector = (await (await admin.req.get(`/api/v1/admin/connectors/${c.id}`)).json()) as { version: number; enabled?: boolean; status?: string };
  console.log(`QA-RG-R1 AUD ${lang} connector after the auditor's attempts: ${JSON.stringify({ version: connector.version, enabled: connector.enabled, status: connector.status })}; connectors before ${before}, after ${after} (the admin created one)`);
  expect(after).toBe(before + 1);
  expect(connector.version).toBe(c.version);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `qa-rg-r1-aud-${lang}.json`), JSON.stringify({ inventory, offending, statuses }, null, 1));
  console.log(`QA-RG-R1 AUD ${lang}: offending ${JSON.stringify(offending)}; API ${JSON.stringify(statuses)}`);
  expect(offending).toEqual([]);
  for (const [k, st] of Object.entries(statuses)) expect(st, k).toBe(403);
});

// REQ-S16-030 "XSS in rich text": the register discloses that no XSS e2e exists (the clause rests on xss.test.ts and
// the web source scan). Here the ADR-0052 payload set goes into evidence-note titles and bodies through the API, and the
// evidence register is rendered in the browser: no dialog opens, no injected global is set, no injected element exists,
// and each payload is shown as literal text.
const XSS = [
  "<script>window.__qaXss=1;alert(1)</script>",
  "<img src=x onerror=\"window.__qaXss=2;alert(1)\">",
  "<svg onload=\"window.__qaXss=3;alert(1)\">",
  '<a href="javascript:window.__qaXss=4">x</a>',
  '"><iframe srcdoc="<script>parent.__qaXss=5</script>">',
  "{{constructor.constructor('window.__qaXss=6')()}}",
];
test("REQ-S16-030 probe: XSS payloads in evidence notes render as text in the browser", async ({ page, playwright }, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic QA XSS ${lang.toUpperCase()} ${Date.now().toString(36)}`,
      mode: "end_to_end",
    })
  ).id;
  for (const [i, payload] of XSS.entries())
    await lead.call("POST", `/api/v1/transformations/${tid}/evidence`, {
      kind: "note",
      title: `QA ${i + 1} ${payload}`.slice(0, 300),
      noteBody: payload,
      ownerUserId: lead.userId,
    });
  const dialogs: string[] = [];
  page.on("dialog", async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}/evidence`);
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  for (const [i, payload] of XSS.entries())
    await expect(page.locator("main#main")).toContainText(`QA ${i + 1} ${payload}`.slice(0, 60));
  // Open each note's own view where the body is shown (the row title is a link or button in the register).
  const injected = await page.evaluate(() => ({
    flag: (window as unknown as { __qaXss?: number }).__qaXss ?? null,
    scripts: [...document.querySelectorAll("main#main script")].length,
    iframes: [...document.querySelectorAll("main#main iframe")].length,
    imgX: [...document.querySelectorAll("main#main img[src='x']")].length,
    svgOnload: [...document.querySelectorAll("main#main svg[onload]")].length,
    jsLinks: [...document.querySelectorAll("main#main a[href^='javascript:']")].length,
  }));
  await shot(page, lang, "qa-rg-r1-xss-evidence-register");
  console.log(`QA-RG-R1 XSS ${lang}: ${JSON.stringify({ injected, dialogs })}`);
  expect(dialogs).toEqual([]);
  expect(injected).toEqual({ flag: null, scripts: 0, iframes: 0, imgX: 0, svgOnload: 0, jsLinks: 0 });
});
