// qa-verifier DG6 round 10 (T-DG6-REV-QA-R10, session 094e31f2) on candidate 56415aee (source cde60365): round 9's standing probe re-used; changes: names r9 -> r10 only (the lines below are the earlier rounds' text).
// qa-verifier DG6 round 9 (T-DG6-REV-QA-R9, run 7e2124db): round 8's standing probe zz-qa-dg6r8-detail-axe.spec.ts re-used on candidate fe824c05 (source d974011f); changes: names r8 -> r9 only.
// qa-verifier DG6 round 8 (T-DG6-REV-QA-R8) on candidate 6cda8b33: copied from tests/round-7/zz-qa-dg6r7-detail-axe.spec.ts; the only change is the rename of identifiers dg6r7 -> dg6r9 and QA-R7 -> QA-R10 (the comments below are the earlier rounds' text).
// qa-verifier DG6 round 7 (T-DG6-REV-QA-R7) on candidate b64b95ff: copied from tests/round-6/zz-qa-dg6r6-detail-axe.spec.ts; the only change is the rename of identifiers dg6r6 -> dg6r9 and QA-R6 -> QA-R10 (the comments below are the round-6 text).
// qa-verifier DG6 round 6 (T-DG6-REV-QA-R6; copied unchanged from my round-5 probe except names): copied from round-4/zz-qa-dg6r4-detail-axe.spec.ts and re-run on candidate 832e5c82; identifiers renamed dg6r4 -> dg6r5 and QA-R4 -> QA-R5 (round 5); now dg6r5 -> dg6r9 (round 6) outside the provenance comments below.
// qa-verifier DG6 round 4 (T-DG6-REV-QA-R4): copied unchanged in its checks from round-3/zz-qa-dg6r3b-detail-axe.spec.ts (round 3) and re-run on candidate 4b84bf20; only names r3 -> r4.
// qa-verifier DG6 round 3 continuation (T-DG6-REV-QA-R4): independent probe, NOT part of the frozen candidate. Copied into
// a disposable copy as e2e/zz-qa-dg6r10-detail-axe.spec.ts and run inside apps/web/e2e/support/with-stack.sh with
// MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET exported (with-stack.sh binds that synthetic SecretRef, D-209).
// Why: e2e/a20-p6-axe.spec.ts skips 9 P6 detail routes ("NOT SCANNED"), and no other spec opens two of them at all:
//   /admin/sensitive-grants/:grantId and /admin/integrations/webhooks/:webhookId.
// This probe creates the records through the API (synthetic), then for each screen, in chromium-en and chromium-ar:
//   A. axe (wcag2a/aa, 21a/aa) reports 0 serious or critical issues at 1366 x 900, 390 x 844 and 360 x 800;
//   B. reflow: no horizontal scroll and the h1 visible at 360 x 800, 390 x 844, and at 1280 x 900 with the root font
//      size at 200 %;
//   C. AUD read-only: dev.auditor opens the sensitive-grant detail; no ENABLED write control (revoke) is offered, and
//      only GET requests are sent.
// All data is SYNTHETIC; nothing approves anything (no G1-G6 business approval; unrelated to DG0-DG7).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEV_USERS, SYN_RETAIL, apiSession, expectAccessible, langOf, signIn, type Lang } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);
const OUT = process.env["QA_PROBE_OUT"] ?? "test-results/qa-dg6r10";
const SECRET_VAR = "MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET";
const ids: { grantId: string; webhookId: string } = { grantId: "", webhookId: "" };

test("setup: a sensitive evidence note with an explicit grant, and a webhook endpoint (synthetic)", async ({ playwright }, info) => {
  const lang = langOf(info);
  const stamp = `${lang}-${Date.now().toString(36)}`;
  const lead = await apiSession(playwright, "dev.lead");
  const office = await apiSession(playwright, "dev.office");
  const admin = await apiSession(playwright, "dev.admin");
  const t = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic QA R4 detail ${stamp}`,
    mode: "end_to_end",
  });
  const ev = await lead.call<{ id: string }>(
    "POST",
    `/api/v1/transformations/${t.id}/evidence`,
    { kind: "note", title: `Synthetic restricted note ${stamp}`, ownerUserId: DEV_USERS.lead, noteBody: "Synthetic." },
    { expect: 201 },
  );
  await office.call(
    "PUT",
    `/api/v1/transformations/${t.id}/records/evidence/${ev.id}/sensitivity`,
    { isSensitive: true, reason: "Synthetic QA: restricted for the probe" },
    { ifMatch: 0 },
  );
  const grant = await office.call<{ id: string }>(
    "POST",
    "/api/v1/admin/sensitive-grants",
    { transformationId: t.id, recordType: "evidence", recordId: ev.id, granteeUserId: DEV_USERS.lead, reason: "Synthetic QA grant" },
    { expect: 201 },
  );
  ids.grantId = grant.id;

  expect(process.env[SECRET_VAR], `${SECRET_VAR} must be exported before the stack starts`).toBeTruthy();
  const me = await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me");
  const res = await admin.req.post("/api/v1/admin/connectors", {
    headers: { "X-CSRF-Token": await csrf(admin.req), "Idempotency-Key": crypto.randomUUID() },
    data: {
      organizationId: me.organization.id,
      code: `qa-r4-wh-${stamp}`,
      nameEn: `QA R4 synthetic webhook ${lang}`,
      nameAr: `ويب هوك اصطناعي ${lang}`,
      adapterKind: "webhook",
      targetKind: "kpi_actual",
      config: {
        sourceSystemId: `synthetic.qa-r4:wh-${stamp}`,
        endpointUrl: null,
        credentialRefs: {},
        fieldMappings: [],
        targetTransformationId: t.id,
        cadence: "manual",
        retryMaxAttempts: 0,
        retryBackoffSeconds: 60,
        commitMode: "manual",
        commitOnBehalfOf: null,
        outboundActions: [],
        reconciliationRule: "none",
        adapterSettings: {},
        reason: "QA R4 synthetic webhook connector",
      },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const c = (await res.json()) as { id: string };
  const etag = res.headers()["etag"]!;
  const en = await admin.req.post(`/api/v1/admin/connectors/${c.id}/enable`, {
    headers: { "X-CSRF-Token": await csrf(admin.req), "If-Match": etag },
    data: { reason: null },
  });
  expect(en.status(), await en.text()).toBe(200);
  const ep = await admin.call<{ id: string }>("POST", "/api/v1/admin/webhooks", {
    connectorId: c.id,
    label: `QA R4 synthetic sender ${lang}`,
    signingSecretRef: { provider: "env", name: SECRET_VAR },
    toleranceSeconds: 300,
  });
  ids.webhookId = ep.id;
  console.log(`QA-R5 setup ${lang}: grant ${ids.grantId}, webhook ${ids.webhookId}`);
});

async function csrf(req: import("@playwright/test").APIRequestContext): Promise<string> {
  return ((await (await req.get("/api/v1/me")).json()) as { csrfToken: string }).csrfToken;
}

async function reflow(page: Page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    const h1 = document.querySelector("main#main h1") as HTMLElement | null;
    const r = h1?.getBoundingClientRect();
    return {
      scrollWidth: d.scrollWidth,
      clientWidth: d.clientWidth,
      h1: h1?.innerText.trim().slice(0, 60) ?? null,
      h1InView: !!r && r.left >= -1 && r.right <= d.clientWidth + 1 && r.width > 0,
    };
  });
}

const SCREENS = () => [
  { name: "admin-sensitive-grant", url: `/admin/sensitive-grants/${ids.grantId}` },
  { name: "admin-webhook", url: `/admin/integrations/webhooks/${ids.webhookId}` },
];

test("A+B: axe 0 serious/critical and reflow on the two unscanned detail screens", async ({ page }, info) => {
  const lang: Lang = langOf(info);
  await signIn(page, lang, "dev.admin");
  const report: Record<string, unknown> = {};
  const dir = path.join(OUT, lang);
  mkdirSync(dir, { recursive: true });
  for (const s of SCREENS()) {
    for (const vp of [
      { name: "1366", width: 1366, height: 900, text200: false },
      { name: "390", width: 390, height: 844, text200: false },
      { name: "360", width: 360, height: 800, text200: false },
      { name: "1280-text200", width: 1280, height: 900, text200: true },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(s.url);
      await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      await page.waitForLoadState("networkidle");
      // Run 1 used page.addStyleTag, which the product's CSP (style-src 'self') refuses (32-...-unset.log); the root font
      // size is set through the CSSOM instead, as the round-1/2 reflow probe does.
      if (vp.text200)
        await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
      const r = await reflow(page);
      report[`${s.name}@${vp.name}`] = r;
      await page.screenshot({ path: path.join(dir, `${s.name}--${vp.name}.png`), fullPage: true });
      if (!vp.text200) await expectAccessible(page, lang, `${s.name}@${vp.name}`);
      expect(r.scrollWidth, `${s.name}@${vp.name}: horizontal scroll`).toBeLessThanOrEqual(r.clientWidth);
      expect(r.h1InView, `${s.name}@${vp.name}: h1 in the viewport`).toBe(true);
    }
  }
  writeFileSync(path.join(dir, "detail-reflow.json"), JSON.stringify(report, null, 2));
  console.log(`QA-R5 DETAIL ${lang}: ${JSON.stringify(report)}`);
});

test("C: the auditor (AUD) reads the sensitive-grant detail with no enabled write control and sends only GETs", async ({ page }, info) => {
  const lang: Lang = langOf(info);
  await signIn(page, lang, "dev.auditor");
  const methods: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) methods.push(r.method());
  });
  await page.goto(`/admin/sensitive-grants/${ids.grantId}`);
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  const enabledButtons = await page
    .locator("main#main button:not([disabled]):not([aria-disabled='true'])")
    .evaluateAll((bs) => bs.map((b) => (b as HTMLElement).innerText.trim()).filter((x) => x));
  const forms = await page.locator("main#main form").count();
  console.log(`QA-R5 AUD ${lang}: enabled buttons ${JSON.stringify(enabledButtons)}; forms ${forms}; methods ${JSON.stringify([...new Set(methods)])}`);
  const revoke = lang === "ar" ? /^(إلغاء|إلغاء هذه المنحة)$/ : /^Revoke/;
  expect(enabledButtons.filter((b) => revoke.test(b)), "AUD sees no enabled revoke").toEqual([]);
  expect([...new Set(methods)].filter((m) => m !== "GET"), "AUD sends only GETs").toEqual([]);
  // Positive control (the detector works): the office lead (TO, sensitive_record.grant) is offered the revoke.
  await page.context().clearCookies();
  await signIn(page, lang, "dev.office");
  await page.goto(`/admin/sensitive-grants/${ids.grantId}`);
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  const toButtons = await page
    .locator("main#main button:not([disabled]):not([aria-disabled='true'])")
    .evaluateAll((bs) => bs.map((b) => (b as HTMLElement).innerText.trim()).filter((x) => x));
  console.log(`QA-R5 TO control ${lang}: enabled buttons ${JSON.stringify(toButtons)}`);
  expect(toButtons.filter((b) => revoke.test(b)).length, "control: TO is offered the revoke").toBeGreaterThan(0);
});
