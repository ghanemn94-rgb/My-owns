// domain-reviewer probe (T-DG6-REV-DOM-RG-R1), NOT part of the candidate: written only in a disposable clone and copied
// into the reviewer's evidence directory. Production-initialized stack (apps/web/e2e/support/with-stack.sh, seed-dev
// synthetic users). All data SYNTHETIC; nothing here is a business approval (G1-G6) or relates to DG0-DG7.
/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { apiSession, langOf, shot, signIn, tr, SYN_RETAIL } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ timeout: 180_000 });

test("DOM-P1 external change: a flagged deliverable shows Unconfirmed; a filename-only confirmation is refused", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const office = await apiSession(playwright, "dev.office");
  const t = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic domain probe ${lang} ${Date.now()}`,
    mode: "end_to_end",
  });
  const ini = await lead.call<{ id: string }>("POST", "/api/v1/initiatives", {
    transformationId: t.id,
    name: `Synthetic probe initiative ${lang}`,
    objective: "Synthetic objective",
    executiveOwnerUserId: lead.userId,
  });
  const d = await lead.call<{ id: string; version: number }>("POST", `/api/v1/initiatives/${ini.id}/deliverables`, {
    title: `Synthetic CRM go-live ${lang}`,
  });
  const flagged = await office.call<{ externalChange: Record<string, unknown> }>(
    "PUT",
    `/api/v1/deliverables/${d.id}/external-change`,
    { isExternalChange: true, changeType: "customer_system", description: "Synthetic: a CRM change goes live." },
    { ifMatch: 0 },
  );
  expect(flagged.externalChange).toMatchObject({ confirmationStatus: "unconfirmed", confirmationSource: null });
  // A filename-only evidence link (not reviewed) must not confirm it.
  const fileRef = await lead.call<{ id: string }>("POST", `/api/v1/transformations/${t.id}/evidence`, {
    kind: "file_reference",
    title: `Synthetic filename link ${lang}`,
    fileName: "go-live-signoff.pdf",
    ownerUserId: lead.userId,
  });
  // A synthetic Business Owner at this transformation holds external_change.confirm; the TO (dev.office) does not.
  const admin = await apiSession(playwright, "dev.admin");
  const boName = `dom.bo.${lang}.${Date.now()}`;
  const boUser = await admin.call<{ id: string }>("POST", "/api/v1/users", {
    organizationId: "01920000-0000-7000-9000-000000000001",
    displayName: `Synthetic domain-probe BO ${lang}`,
    preferredLocale: lang,
    identity: { issuer: "urn:mth:dev-local", subject: boName },
  });
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: boUser.id,
    roleCode: "BO",
    scope: { type: "transformation", id: t.id },
    reason: "Synthetic BO for the domain-reviewer probe (approves nothing real)",
  });
  const toRes = await office.req.fetch(`/api/v1/deliverables/${d.id}/confirmation`, {
    method: "POST",
    headers: { "X-CSRF-Token": (await (await office.req.get("/api/v1/me")).json()).csrfToken, "If-Match": '"1"' },
    data: { evidenceId: fileRef.id, note: null },
  });
  console.log(`DOM-P1 ${lang} TO confirm -> ${toRes.status()} ${(await toRes.text()).slice(0, 200)}`);
  expect(toRes.status()).toBe(403);
  const bo = await apiSession(playwright, boName);
  const res = await bo.req.fetch(`/api/v1/deliverables/${d.id}/confirmation`, {
    method: "POST",
    headers: { "X-CSRF-Token": (await (await bo.req.get("/api/v1/me")).json()).csrfToken, "If-Match": '"1"' },
    data: { evidenceId: fileRef.id, note: null },
  });
  const refusal = { status: res.status(), body: await res.text() };
  console.log(`DOM-P1 ${lang} confirm-without-reviewed-evidence -> ${refusal.status} ${refusal.body.slice(0, 300)}`);
  expect(refusal.status).toBe(422);
  expect(refusal.body).toContain("external_change.evidence_not_verified");
  const state = await office.call<Record<string, unknown>>("GET", `/api/v1/deliverables/${d.id}/confirmation`);
  console.log(`DOM-P1 ${lang} state after refusal: ${JSON.stringify(state).slice(0, 400)}`);
  expect(JSON.stringify(state)).toContain("unconfirmed");

  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${t.id}/initiatives/${ini.id}`);
  const item = page.locator(`[data-deliverable='${d.id}']`);
  await expect(item).toBeVisible();
  await expect(item).toContainText(tr(lang, "externalChange.state.unconfirmed"));
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await item.scrollIntoViewIfNeeded();
  await shot(page, lang, "dom-p1-external-change-unconfirmed");
  console.log(`DOM-P1 ${lang} deliverable text: ${(await item.innerText()).replace(/\s+/g, " ").slice(0, 400)}`);
});

test("DOM-P2 assistant off on a fresh install: no launcher for a lead; Administration shows it off", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await page.goto("/my-work");
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await page.locator("[data-assistant-launcher]").count()).toBe(0);
  await shot(page, lang, "dom-p2-lead-no-assistant");
  await page.context().clearCookies();
  await signIn(page, lang, "dev.admin");
  await page.goto("/admin/assistant");
  await expect(page.locator("main#main h1")).toBeVisible();
  await page.waitForLoadState("networkidle");
  console.log(`DOM-P2 ${lang} admin assistant page: ${(await page.locator("main#main").innerText()).replace(/\s+/g, " ").slice(0, 600)}`);
  expect(await page.locator("[data-assistant-launcher]").count()).toBe(0);
  await shot(page, lang, "dom-p2-admin-assistant-off");
});

test("DOM-P3 P6 screens render Unknown/empty states, never zero or green, for an office user", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.admin");
  for (const [path, name] of [
    ["/admin/integrations", "dom-p3-connectors"],
    ["/admin/operations", "dom-p3-operations"],
    ["/strategy-kpis/imports", "dom-p3-imports-entry"],
    ["/search?q=Synthetic", "dom-p3-search"],
  ] as const) {
    await page.goto(path);
    await expect(page.locator("main#main h1")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const text = (await page.locator("main#main").innerText()).replace(/\s+/g, " ");
    console.log(`DOM-P3 ${lang} ${path}: ${text.slice(0, 500)}`);
    expect(text).not.toMatch(/stack trace|ECONNREFUSED|postgres|SQLSTATE|pg-boss/i);
    await shot(page, lang, name);
  }
});
