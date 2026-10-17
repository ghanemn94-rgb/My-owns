// T-DG5-FE-D3 (D-164 d, D-165; REQ-S12-002, REQ-S12-001): the automation builder's dry-run sample and the failure
// queue's layout, live against the real API (AUTH_MODE=dev stack), in chromium-en (LTR) and chromium-ar (RTL).
// SYNTHETIC data only; nothing here grants or records a G1-G6 business approval, and no DG0-DG7 label is shown.
//  - Added scope 1 (D-164 d): the dry run of a draft is pre-filled from the trigger's served `samplePayload` (BE-C4),
//    with its placeholder `transformationId` replaced by the transformation the builder selected. The pre-filled
//    `gate.submitted` sample passes as it is. The main refusal: an emptied sample is refused by the server with
//    422 `automation.dry_run_sample_invalid`, shown by its code with its en/ar text.
//  - Added scope 4 (QA-F P-4): in a 1280 px window the failure queue's Status and Actions columns are on screen
//    without horizontal scrolling. The list is served SYNTHETIC rows through `page.route` (a real failure needs a
//    worker retry-limit change, which A13 does); the rows carry long unbroken keys and messages, the worst case.
import { expect, test, type Page } from "@playwright/test";
import {
  SYN_RETAIL,
  apiSession,
  escape,
  expectAccessible,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
} from "./support/ui.ts";

const ORG = "01920000-0000-7000-9000-000000000001";
const NOBODY = "01920000-0000-7000-9000-000000000205";
const PLACEHOLDER = "00000000-0000-7000-8000-000000000000";
const NO_DG = /\bDG[0-7]\b/;

const h1 = (page: Page) => page.locator("main#main h1");
const alertOf = (page: Page) => page.locator("main [role='alert']").first();

/**
 * A SYNTHETIC role grant for dev.nobody (ADM_METHOD on the organization to author rules; WL on one transformation so the
 * builder can select it); returns the revoke to call in `finally`.
 */
async function grantNobody(
  admin: ApiSession,
  roleCode: string,
  scope: { type: "organization" | "transformation"; id: string },
): Promise<() => Promise<void>> {
  type Assignment = {
    id: string;
    roleCode: string;
    revokedAt: string | null;
    version: number;
    scope?: { type: string; id: string };
  };
  const active = async () =>
    (
      await admin.call<{ items: Assignment[] }>(
        "GET",
        `/api/v1/role-assignments?organizationId=${ORG}&userId=${NOBODY}`,
      )
    ).items.filter(
      (a) => a.roleCode === roleCode && a.revokedAt === null && (a.scope === undefined || a.scope.id === scope.id),
    );
  if ((await active()).length === 0)
    await admin.call("POST", "/api/v1/role-assignments", {
      userId: NOBODY,
      roleCode,
      scope,
      reason: "Synthetic grant for the FE-D3 journey",
    });
  return async () => {
    for (const a of await active())
      await admin.call(
        "POST",
        `/api/v1/role-assignments/${a.id}/revoke`,
        { reason: "End of the synthetic FE-D3 journey" },
        { ifMatch: a.version },
      );
  };
}

test("Dry run: the gate.submitted sample is pre-filled with the selected transformation and passes; an emptied sample is refused", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(150_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const admin = await apiSession(playwright, "dev.admin");
  // The served catalogue carries the trigger's example payload (BE-C4; D-164 d).
  const catalogue = await admin.call<{ triggers: { code: string; samplePayload?: Record<string, unknown> }[] }>(
    "GET",
    "/api/v1/admin/automation-catalogue",
  );
  const sample = catalogue.triggers.find((x) => x.code === "gate.submitted")?.samplePayload;
  expect(sample, "the catalogue serves gate.submitted's samplePayload (BE-C4, D-164 d)").toBeTruthy();
  expect(sample!["transformationId"]).toBe(PLACEHOLDER);
  const lead = await apiSession(playwright, "dev.lead");
  const target = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-D3 ${lang.toUpperCase()} dry-run sample`,
    mode: "end_to_end",
  });
  const revokeMethod = await grantNobody(admin, "ADM_METHOD", { type: "organization", id: ORG });
  const revokeRead = await grantNobody(admin, "WL", { type: "transformation", id: target.id });
  try {
    await signIn(page, lang, "dev.nobody");
    await page.goto("/admin/automation");
    await expect(h1(page)).toHaveText(tr(lang, "nav.p5.automation.title"));
    await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.create"), exact: true }).click();
    const form = page.locator("[data-form='create-rule']");
    await form.getByLabel(tr(lang, "workflowsP5.field.code")).fill(`synthetic.fed3.${lang}.${Date.now()}`);
    await form
      .getByLabel(`${tr(lang, "workflowsP5.builder.name")} (${tr(lang, "workflowsP5.lang.en")})`)
      .fill("Synthetic FE-D3 submission follow-up");
    await form
      .getByLabel(`${tr(lang, "workflowsP5.builder.name")} (${tr(lang, "workflowsP5.lang.ar")})`)
      .fill("متابعة تقديم اصطناعية");
    await form.getByLabel(tr(lang, "workflowsP5.rules.scope")).selectOption("transformation");
    // The scope select (its generated id is not stable) is the first select offering the new transformation; the
    // action's target-transformation select, after it, offers it too.
    const scopeSelect = form.locator(`select:has(option[value='${target.id}'])`).first();
    await expect(scopeSelect).toHaveAccessibleName(
      new RegExp(`^${escape(tr(lang, "workflowsP5.field.transformation"))}`),
    );
    await scopeSelect.selectOption(target.id);
    await form.locator("#create-trigger-gate\\.submitted").check();
    await form.locator("#create-action-role-0").fill("TO");
    await form.getByRole("button", { name: tr(lang, "workflowsP5.rules.createSubmit"), exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/automation\/rules\/[0-9a-f-]+$/);
    await expect(page.locator("[data-panel='dry-run'] [data-status='not_run']")).toBeVisible();

    // The pre-filled sample: the served example, its transformation replaced by the builder's.
    const payload = page.getByLabel(tr(lang, "workflowsP5.dryRun.payload"));
    await expect(payload).toHaveValue(new RegExp(target.id));
    expect(JSON.parse(await payload.inputValue())).toEqual({ ...sample, transformationId: target.id });
    await expect(page.getByText(tr(lang, "workflowsP5.dryRun.payloadHint"), { exact: true })).toBeVisible();

    // The main refusal: an emptied sample does not match the trigger's event schema.
    await payload.fill("{}");
    await page.getByRole("button", { name: tr(lang, "workflowsP5.dryRun.run"), exact: true }).click();
    await expect(alertOf(page)).toHaveAttribute("data-problem", "automation.dry_run_sample_invalid");
    await expect(alertOf(page)).toContainText(tr(lang, "problems.automation__dry_run_sample_invalid"));
    await expect(page.locator("[data-dry-run-result]")).toHaveCount(0);
    await shot(page, lang, "fed3-dry-run-refused");

    // The main path: the pre-filled sample, as served, passes.
    await page.reload();
    await expect(payload).toHaveValue(new RegExp(target.id));
    await page.getByRole("button", { name: tr(lang, "workflowsP5.dryRun.run"), exact: true }).click();
    await expect(page.locator("[data-dry-run-result]")).toBeVisible();
    await expect(page.locator("[data-dry-run-result]")).toHaveAttribute("data-dry-run-result", "pass");
    await expect(page.locator("[data-dry-run-result]")).toContainText(tr(lang, "workflowsP5.dryRun.noSideEffects"));
    await expect(page.locator("[data-panel='dry-run'] > p [data-status='pass']")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    await expectAccessible(page, lang, "fed3-dry-run-sample");
    await shot(page, lang, "fed3-dry-run-sample");
    expect(await page.locator("main").innerText()).not.toMatch(NO_DG);
  } finally {
    await revokeRead();
    await revokeMethod();
  }
  expect(foreign, "no request leaves the application origin").toEqual([]);
});

test("Failure queue at 1280 px: Status and Actions are on screen without horizontal scrolling", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const uuid = () => crypto.randomUUID();
  const failure = (n: number, status: "open" | "resolved") => ({
    id: uuid(),
    source: "rule_execution",
    organizationId: ORG,
    executionId: uuid(),
    jobScheduleCode: null,
    queueName: "automation.evaluate",
    jobId: uuid(),
    idempotencyKey: `automation.rule:${uuid()}:v${n}:gate.decided:${uuid()}:action-1`,
    errorCode: "automation.action_forbidden",
    errorMessage: `synthetic.target_outside_scope:transformation=${uuid()};rule_scope=${uuid()};action=create_task`,
    attempts: 1,
    firstFailedAt: "2026-10-16T08:00:00Z",
    lastFailedAt: `2026-10-16T08:0${n}:00Z`,
    status,
    retryCount: status === "resolved" ? 1 : 0,
    lastRetryBy: null,
    lastRetryAt: null,
    resolvedAt: status === "resolved" ? "2026-10-16T09:00:00Z" : null,
    dismissedBy: null,
    dismissedAt: null,
    dismissReason: null,
    allowedActions: status === "open" ? ["retry", "dismiss"] : [],
    version: 1,
    updatedAt: "2026-10-16T08:00:00Z",
  });
  const rows = [failure(1, "open"), failure(2, "resolved")];
  await page.route(/\/api\/v1\/admin\/automation-failures(\?.*)?$/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, json: { items: rows, nextCursor: null } })
      : route.fallback(),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, lang, "dev.admin");
  await page.goto("/admin/automation/failures");
  const wrap = page.locator("[data-register='p5-automation-failures'] .table-wrap");
  await expect(wrap.locator("tbody tr")).toHaveCount(2);
  // No horizontal overflow: every column, Status and Actions included, is inside the visible region.
  const overflow = await wrap.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, "the failure table does not scroll horizontally at 1280 px").toBeLessThanOrEqual(0);
  const region = (await wrap.boundingBox())!;
  for (const name of [tr(lang, "workflowsP5.field.status"), tr(lang, "workflowsP5.actions")]) {
    const th = wrap.locator("thead th", { hasText: name }).first();
    const box = (await th.boundingBox())!;
    expect(box.x, `${name} starts inside the region`).toBeGreaterThanOrEqual(region.x - 1);
    expect(box.x + box.width, `${name} ends inside the region`).toBeLessThanOrEqual(region.x + region.width + 1);
    expect(box.x + box.width, `${name} ends inside the window`).toBeLessThanOrEqual(1280);
  }
  const open = wrap.locator("tbody tr").filter({ has: page.locator("[data-action='retry-failure']") });
  // Horizontally inside the region and the 1280 px window (the row may be below the fold; only the inline axis counts).
  for (const target of [
    open.locator("[data-action='retry-failure']"),
    open.locator("[data-action='dismiss-failure']"),
    open.getByText(tr(lang, "workflowsP5.failureStatus.open"), { exact: true }),
  ]) {
    const box = (await target.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(Math.max(0, region.x - 1));
    expect(box.x + box.width).toBeLessThanOrEqual(Math.min(1280, region.x + region.width + 1));
  }
  // Keyboard: the row action takes focus inside the region (no scrolling needed to reach it).
  await open.locator("[data-action='retry-failure']").focus();
  await expect(open.locator("[data-action='retry-failure']")).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expectAccessible(page, lang, "fed3-failure-queue-1280");
  await shot(page, lang, "fed3-failure-queue-1280");
  expect(foreign, "no request leaves the application origin").toEqual([]);
});
