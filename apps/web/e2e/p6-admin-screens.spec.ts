// P6 slices E, F, J and C screens against the REAL API (apps/web/e2e/support/with-stack.sh; T-DG6-FE-B; p6-work-split
// §E/F.12, §J/C.13), in English LTR and Arabic RTL. All data is SYNTHETIC (seeded dev users: dev.admin holds ADM_TECH
// and ADM_ACCESS, dev.auditor AUD, dev.office TO).
//  - Every screen renders from the API (no placeholder), passes axe (no serious or critical violation) and is captured
//    as a screenshot.
//  - REQ-S13-011 / REQ-S16-032: the technical admin narrows the upload policy with a reason; the saved policy is read back
//    from the server after a reload, and its audit event appears in Administration > Audit.
//  - The auditor reads Audit, the upload policy and Storage (operations.read) without any write control: no form, no
//    test, no save, and no write request.
//  - REQ-S12-024: a well-formed token that no notification carries is refused with the deep_link.forbidden text only.
//  - REQ-S12-019: the worker heartbeat is shown with a text label; in this stack no worker runs, so it is "Unknown" or
//    "Stale", never "Running".
//
// Budget (F-DG5-145/146/151; p6-work-split §2 rules 13 and 15): every test sets 60 s. The measured worst case under load
// is in docs/delivery/handbacks/DG6/T-DG6-FE-B-evidence/e2e-p6.log (the run also had the integration suite running on
// the same host); 60 s is at least 2x it (see the handback).
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, langOf, shot, signIn, tr, trackRequests, type Lang } from "./support/ui.ts";

const BUDGET_MS = 60_000;

const SCREENS: readonly { name: string; path: string; titleKey: string }[] = [
  { name: "audit", path: "/admin/audit", titleKey: "nav.p6.audit.title" },
  { name: "security", path: "/admin/security", titleKey: "nav.p6.security.title" },
  { name: "upload-policy", path: "/admin/upload-policy", titleKey: "nav.p6.uploadPolicy.title" },
  { name: "sensitive-grants", path: "/admin/sensitive-grants", titleKey: "nav.p6.sensitiveGrants.title" },
  { name: "operations", path: "/admin/operations", titleKey: "nav.p6.operations.title" },
  { name: "service-identities", path: "/admin/service-identities", titleKey: "nav.p6.serviceIdentities.title" },
  { name: "identity", path: "/admin/identity", titleKey: "nav.p6.identity.title" },
  { name: "storage", path: "/admin/storage", titleKey: "nav.p6.storage.title" },
  { name: "notifications", path: "/admin/notification-channels", titleKey: "nav.p6.notifications.title" },
];

async function open(page: Page, lang: Lang, path: string, titleKey: string) {
  await page.goto(path);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, titleKey));
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  // Wait for the first data region (or a state) of the screen: never a loading spinner in a screenshot.
  await expect(page.locator("[data-state='loading']")).toHaveCount(0);
}

for (const s of SCREENS) {
  test(`P6 screen ${s.name}: renders from the API for the administrator, axe clean`, async ({ page }, info) => {
    test.setTimeout(BUDGET_MS);
    const lang = langOf(info);
    const foreign = trackRequests(page);
    await signIn(page, lang, "dev.admin");
    await open(page, lang, s.path, s.titleKey);
    await expect(page.locator("[data-p6-screen]")).toBeVisible();
    await expect(page.locator("[data-p6-feature]")).toHaveCount(0);
    await expect(page.locator("[data-state='error']")).toHaveCount(0);
    await expectAccessible(page, lang, `p6-${s.name}`);
    await shot(page, lang, `p6-${s.name}`);
    await expect(page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
    expect(foreign).toEqual([]);
  });
}

test("P6 upload policy: the administrator narrows it with a reason; it persists and is audited", async ({
  page,
}, info) => {
  test.setTimeout(BUDGET_MS);
  const lang = langOf(info);
  await signIn(page, lang, "dev.admin");
  await open(page, lang, "/admin/upload-policy", "nav.p6.uploadPolicy.title");
  const form = page.locator("form[data-form='upload-policy']");
  const max = form.locator("#upload-max-mib");
  // A different limit per language project, so each run is a real change on the shared stack.
  const mib = lang === "en" ? "20" : "21";
  await max.fill(mib);
  await form.getByRole("button", { name: tr(lang, "adminP6.common.save"), exact: true }).click();
  // No reason: the inline error, and nothing is saved.
  await expect(form.getByText(tr(lang, "adminP6.common.reasonInvalid"))).toBeVisible();
  await form.locator("textarea#upload-policy-reason").fill(`Synthetic e2e narrowing (${lang})`);
  await form.getByRole("button", { name: tr(lang, "adminP6.common.save"), exact: true }).click();
  await expect(page.locator("[data-max-bytes]")).toHaveAttribute("data-max-bytes", String(Number(mib) * 1024 * 1024));
  await expect(page.locator("[data-state='saved']")).toBeVisible();
  await shot(page, lang, "p6-upload-policy-saved");
  // Read back from the server after a full reload.
  await page.reload();
  await expect(page.locator("[data-policy-default='false']")).toBeVisible();
  await expect(page.locator("[data-max-bytes]")).toHaveAttribute("data-max-bytes", String(Number(mib) * 1024 * 1024));
  // The audit trail lists the change with its reason.
  await open(page, lang, "/admin/audit", "nav.p6.audit.title");
  const table = page.getByRole("table", { name: tr(lang, "adminP6.audit.listTitle") });
  await expect(table.getByText(`Synthetic e2e narrowing (${lang})`)).toBeVisible();
  await expect(table.getByText("upload_policy.changed").first()).toBeVisible();
  await shot(page, lang, "p6-audit-after-change");
});

test("P6 auditor: reads Audit, the upload policy and Storage without any write control", async ({ page }, info) => {
  test.setTimeout(BUDGET_MS);
  const lang = langOf(info);
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/api/v1/admin/")) writes.push(r.url());
  });
  await signIn(page, lang, "dev.auditor");
  await open(page, lang, "/admin/audit", "nav.p6.audit.title");
  await expect(page.getByRole("table", { name: tr(lang, "adminP6.audit.listTitle") })).toBeVisible();
  await expect(page.locator("main button", { hasText: tr(lang, "adminP6.common.save") })).toHaveCount(0);
  await shot(page, lang, "p6-auditor-audit");
  await open(page, lang, "/admin/upload-policy", "nav.p6.uploadPolicy.title");
  await expect(page.locator("[data-state='read-only']")).toBeVisible();
  await expect(page.locator("form[data-form='upload-policy']")).toHaveCount(0);
  await expectAccessible(page, lang, "p6-auditor-upload-policy");
  await shot(page, lang, "p6-auditor-upload-policy");
  await open(page, lang, "/admin/storage", "nav.p6.storage.title");
  await expect(page.locator("[data-storage-driver]")).toBeVisible();
  await expect(page.locator("[data-state='read-only']")).toBeVisible();
  await expect(page.locator("main form")).toHaveCount(0);
  await shot(page, lang, "p6-auditor-storage");
  expect(writes).toEqual([]);
});

test("P6 deep link: an unknown token is refused with the forbidden text only", async ({ page }, info) => {
  test.setTimeout(BUDGET_MS);
  const lang = langOf(info);
  await signIn(page, lang, "dev.office");
  // A synthetic, well-formed token (43 base64url characters) that no notification carries.
  await page.goto("/l/abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "nav.p6.deepLink.title"));
  const refusal = page.locator("[data-state='deep-link-forbidden']");
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText(tr(lang, "problems.deep_link__forbidden"));
  await expectAccessible(page, lang, "p6-deep-link-forbidden");
  await shot(page, lang, "p6-deep-link-forbidden");
});

test("P6 operations: the heartbeat has a text label and is never Running without a worker", async ({ page }, info) => {
  test.setTimeout(BUDGET_MS);
  const lang = langOf(info);
  await signIn(page, lang, "dev.admin");
  await open(page, lang, "/admin/operations", "nav.p6.operations.title");
  const hb = page.locator("[data-heartbeat]");
  await expect(hb).toBeVisible();
  // The e2e stack runs no worker: the status is unknown (no beat) or stale (an old beat), never alive.
  await expect(hb).not.toHaveAttribute("data-heartbeat", "alive");
  await expect(hb.locator(".status-chip")).not.toHaveClass(/on-track/);
  await expect(hb).not.toContainText(tr(lang, "adminP6.operations.heartbeatStatus.alive"));
});
