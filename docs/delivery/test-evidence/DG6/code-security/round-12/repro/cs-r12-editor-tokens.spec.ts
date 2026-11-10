// code-security-reviewer, DG6 round 12 (T-DG6-REV-CS-R12), extending the round-11 probe (parts A and B unchanged in
// substance) with parts C and D for the FE-Z16 repair. NOT part of the candidate: copied into a disposable clone as
// e2e/zz-cs/cs-r12-editor-tokens.spec.ts and run on the production-initialized stack (apps/web/e2e/support/with-stack.sh,
// no worker), chromium-en and chromium-ar. All data SYNTHETIC. Marking a record sensitive is an access decision, never
// a business approval (G1-G6); nothing here touches DG0-DG7.
//
// A synthetic ADM_METHOD author (organization scope, not admitted to sensitive records) owns two draft rules
// [benefitId neq P, benefitId neq S, benefitId neq Q]; the TO marks S sensitive.
//   A. Double save (regression of round 11).
//   B. Concurrent edit -> 409 -> the bilingual "changed, re-apply" banner; the stale-token text is NOT shown.
//   C. FE-Z16 in the real editor: in rule B, paste (C1) rule A's S token (another rule), (C2) a token in the retired
//      form [restricted:<version>:<k>], (C3) rule B's own token from an earlier row version. Each: 422
//      restricted_token_stale; exactly one alert with the en/ar problem text; no "changed" banner; the form reloads the
//      stored values; the stored row and its version are unchanged and S is still tested; the hidden id never shows.
//   D. Observation: the same paste when the reload GET fails (network abort injected by the probe). Logs what the
//      editor then shows next to the problem text "The rule editor shows the version as it is stored now".
import { expect, test } from "@playwright/test";
import { apiSession, langOf, shot, signIn, SYN_RETAIL, tr } from "../../apps/web/e2e/support/ui.ts";
import { syntheticUser } from "../../apps/web/e2e/support/p3-journey-setup.ts";
import { psql } from "../support/a13-a22-stack.ts";

const ORG = "01920000-0000-7000-9000-000000000001";
const log = (s: string) => console.log(`CS-R12-E2E ${s}`);
test.describe.configure({ timeout: 600_000 });

test("CS-R12: rule editor tokens: double save, concurrent edit, stale-token refusals (Z16)", async ({ page, playwright }, info) => {
  const lang = langOf(info);
  const stamp = Date.now().toString(36);
  const admin = await apiSession(playwright, "dev.admin");
  const lead = await apiSession(playwright, "dev.lead");
  const office = await apiSession(playwright, "dev.office");
  const tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic CS R12 rule ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  const T = `/api/v1/transformations/${tid}`;
  const bo = await syntheticUser(admin, ORG, tid, `dev.csr12.bo.${lang}.${stamp}`, `Synthetic BO CS R12 ${lang}`, "BO", lang);
  const boApi = await apiSession(playwright, bo.username);
  const mk = (title: string) =>
    boApi.call<{ id: string }>("POST", `${T}/benefits`, {
      title,
      description: "Synthetic (code-security probe).",
      benefitType: "revenue",
      valueClass: "revenue_uplift",
      ownerUserId: bo.id,
      currency: "SAR",
      financialStatementLine: "Revenue - roaming",
    });
  const S = await mk(`Synthetic CSR12 SECRET ${lang} ${stamp}`);
  const P = await mk(`Synthetic CSR12 open P ${lang} ${stamp}`);
  const Q = await mk(`Synthetic CSR12 open Q ${lang} ${stamp}`);
  const anon = (s: string) => s.replaceAll(S.id, "<S>").replaceAll(P.id, "<P>").replaceAll(Q.id, "<Q>");
  const authorName = `dev.csr12.method.${lang}.${stamp}`;
  const authorId = (await syntheticUser(admin, ORG, tid, authorName, `Synthetic rule author CS R12 ${lang}`, "BO", lang)).id;
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: authorId,
    roleCode: "ADM_METHOD",
    scope: { type: "organization", id: ORG },
    reason: "Synthetic rule author for the code-security probe (approves nothing real)",
  });
  const author = await apiSession(playwright, authorName);
  const ruleBody = (code: string) => ({
    code,
    nameEn: `Synthetic exclusion rule CS R12 ${stamp}`,
    nameAr: `قاعدة استثناء تجريبية ${stamp}`,
    scopeLevel: "organization",
    organizationId: ORG,
    ownerUserId: authorId,
    content: {
      triggerCodes: ["benefit.variance_evaluated"],
      conditions: [
        { field: "benefitId", op: "neq", value: P.id },
        { field: "benefitId", op: "neq", value: S.id },
        { field: "benefitId", op: "neq", value: Q.id },
      ],
      actions: [{ type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } }],
      runAs: "service",
    },
  });
  const ruleA = await author.call<{ id: string }>("POST", "/api/v1/admin/automation-rules", ruleBody(`test.csr12a.${lang}.${stamp}`));
  const ruleB = await author.call<{ id: string }>("POST", "/api/v1/admin/automation-rules", ruleBody(`test.csr12b.${lang}.${stamp}`));
  await office.call("PUT", `${T}/records/benefit/${S.id}/sensitivity`, { isSensitive: true, reason: "Synthetic commercially sensitive benefit" }, { ifMatch: 0 });
  const stored = (ruleId: string) =>
    anon(psql(`SELECT version || ' ' || conditions::text FROM automation_rule_version WHERE automation_rule_id = '${ruleId}' AND version_no = 1`)[0]!);
  const label = tr(lang, "access.includesRestrictedRecords");
  const banner = tr(lang, "workflowsP5.rules.changedReapply");
  const staleText = tr(lang, "problems.automation_rule__restricted_token_stale");
  const form = page.locator('[data-form="edit-rule-content"]');
  const screen = async (ruleId: string, step: string) => {
    await page.waitForTimeout(1000);
    const values = await form.locator("[data-condition-row] input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    const text = await page.locator("main#main").innerText().catch(() => "");
    const badges = await form.locator('[data-restricted-records="true"]').count();
    const fromVersion = await form.getAttribute("data-form-version");
    log(`${lang} ${step} EDITOR form-version=${fromVersion} values=${anon(JSON.stringify(values))} badges=${badges} labelCount=${text.split(label).length - 1} banner=${text.includes(banner)} secretTitle=${text.includes("SECRET")} hasS=${text.includes(S.id)}`);
    log(`${lang} ${step} DB stored (version conditions): ${stored(ruleId)}`);
    await shot(page, lang, `cs-r12-editor-${step}`);
    return { values, text, fromVersion };
  };
  const patches: { status: number; ifMatch: string; body: string }[] = [];
  page.on("response", async (r) => {
    if (r.request().method() === "PATCH" && r.url().includes("/versions/1"))
      patches.push({ status: r.status(), ifMatch: r.request().headers()["if-match"] ?? "", body: anon(r.request().postData() ?? "") });
  });
  const save = async () => {
    const n = patches.length;
    await form.getByRole("button", { name: tr(lang, "workflowsP5.rules.saveDraft") }).click();
    await expect.poll(() => patches.length, { timeout: 30_000 }).toBeGreaterThan(n);
    await page.waitForLoadState("networkidle");
    return patches.at(-1)!;
  };

  await page.context().clearCookies();
  await signIn(page, lang, authorName);

  // ---- A. double save
  await page.goto(`/admin/automation-rules/${ruleA.id}/versions/1`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await expect(form).toBeVisible({ timeout: 30_000 });
  const a1 = await screen(ruleA.id, "A1-read");
  expect(a1.text.includes(S.id)).toBe(false);
  await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.removeCondition", { n: 1 }) }).click();
  const pa1 = await save();
  log(`${lang} A PATCH 1 -> ${pa1.status} If-Match ${pa1.ifMatch} ${pa1.body}`);
  const a2 = await screen(ruleA.id, "A2-after-remove-and-save");
  const pa2 = await save();
  log(`${lang} A PATCH 2 -> ${pa2.status} If-Match ${pa2.ifMatch} ${pa2.body}`);
  const a3 = await screen(ruleA.id, "A3-after-second-save");
  log(`${lang} A badges after save 1 / save 2 (restricted label recognises the tag form): ${await form.locator('[data-restricted-records="true"]').count()}`);
  expect(pa1.status).toBe(200);
  // D-233: the token is the opaque issuer-tag form; the web shows it with the restricted label.
  expect(a2.values[0]).toMatch(/^\[restricted:[0-9a-f]{24}:1\]$/);
  expect(a1.values.find((x) => x.startsWith("[restricted:"))).toMatch(/^\[restricted:[0-9a-f]{24}:2\]$/);
  expect(a2.values[0], "a save re-issues a fresh tag").not.toBe(a1.values.find((x) => x.startsWith("[restricted:")));
  expect(pa2.status, "the second save of an untouched form succeeds with the current tokens").toBe(200);
  // The token sent is the one served by the version being replaced (the response of save 1), never the read-1 token.
  expect(pa2.body).toContain(a2.values[0]!);
  expect(pa2.body).not.toContain(a1.values.find((x) => x.startsWith("[restricted:"))!);
  expect(pa2.body).not.toMatch(/\[restricted:\d+:\d+\]/);
  const sa = stored(ruleA.id);
  expect(sa.indexOf("<S>"), "S still tested, before Q").toBeGreaterThan(-1);
  expect(sa.indexOf("<Q>")).toBeGreaterThan(sa.indexOf("<S>"));
  expect(sa.includes("<P>")).toBe(false);
  expect(sa.split("<Q>").length - 1, "Q tested once").toBe(1);
  expect(a3.text.includes(S.id)).toBe(false);

  // ---- B. concurrent edit -> 409 -> banner, reload; re-save keeps S
  await page.goto(`/admin/automation-rules/${ruleB.id}/versions/1`);
  await page.waitForLoadState("networkidle");
  await expect(form).toBeVisible({ timeout: 30_000 });
  const b1 = await screen(ruleB.id, "B1-read");
  // A second session of the same author removes condition 3 (Q) with the current tokens.
  const v = await author.call<{ version: number; content: { conditions: unknown[] } } & Record<string, unknown>>(
    "GET",
    `/api/v1/admin/automation-rules/${ruleB.id}/versions/1`,
  );
  await author.call("PATCH", `/api/v1/admin/automation-rules/${ruleB.id}/versions/1`, { content: { ...v.content, conditions: v.content.conditions.slice(0, 2) } }, { ifMatch: v.version });
  log(`${lang} B second session removed condition 3; stored: ${stored(ruleB.id)}`);
  // The editor removes condition 1 (P) and saves with its stale version.
  await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.removeCondition", { n: 1 }) }).click();
  const pb1 = await save();
  log(`${lang} B PATCH 1 -> ${pb1.status} If-Match ${pb1.ifMatch} ${pb1.body}`);
  await expect(page.getByText(banner)).toBeVisible({ timeout: 30_000 });
  const b2 = await screen(ruleB.id, "B2-after-409");
  expect(pb1.status).toBe(409);
  expect(b2.text.includes(staleText), "a 409 never shows the stale-token text").toBe(false);
  expect(b2.values.length, "the form shows the current version (two conditions)").toBe(2);
  expect(b2.fromVersion).not.toBe(b1.fromVersion);
  // Re-apply (remove condition 1 = P) and save.
  await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.removeCondition", { n: 1 }) }).click();
  const pb2 = await save();
  log(`${lang} B PATCH 2 -> ${pb2.status} If-Match ${pb2.ifMatch} ${pb2.body}`);
  const b3 = await screen(ruleB.id, "B3-after-reapply");
  expect(pb2.status).toBe(200);
  const sb = stored(ruleB.id);
  expect(sb.includes("<S>"), "S still tested").toBe(true);
  expect(sb.includes("<P>") || sb.includes("<Q>")).toBe(false);
  expect(b3.text.includes(S.id)).toBe(false);

  // ---- C. FE-Z16: stale-token refusals through the real editor (the rule does not change)
  const tokenA = a3.values.find((x) => x.startsWith("[restricted:"))!;
  const tokenBold = b2.values.find((x) => x.startsWith("[restricted:"))!;
  const retired = `[restricted:${b3.fromVersion}:1]`;
  const alerts = form.locator('[data-problem="automation_rule.restricted_token_stale"]');
  for (const [step, pasted] of [
    ["C1-other-rule", tokenA],
    ["C2-retired-form", retired],
    ["C3-own-earlier-version", tokenBold],
  ] as const) {
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(form).toBeVisible({ timeout: 30_000 });
    const before = await screen(ruleB.id, `${step}-before`);
    const storedBefore = stored(ruleB.id);
    // Overwrite the last condition's value (rule B now holds one condition, the S token) with the pasted token.
    const inputs = form.locator("[data-condition-row] input");
    const n = await inputs.count();
    await inputs.nth(n - 1).fill(pasted);
    const p = await save();
    log(`${lang} ${step} PATCH -> ${p.status} If-Match ${p.ifMatch} ${p.body}`);
    await expect(alerts).toHaveCount(1, { timeout: 30_000 });
    const after = await screen(ruleB.id, `${step}-after-422`);
    const alertText = await alerts.first().innerText();
    log(`${lang} ${step} alert role=${await alerts.first().getAttribute("role")} text-matches=${alertText.includes(staleText)} banner=${after.text.includes(banner)} page-alerts=${await page.locator('[data-problem="automation_rule.restricted_token_stale"]').count()}`);
    expect(p.status).toBe(422);
    expect(alertText).toContain(staleText);
    expect(await alerts.first().getAttribute("role")).toBe("alert");
    expect(after.text.includes(banner), "no 'changed' banner on a stale-token 422").toBe(false);
    expect(await page.locator('[data-problem="automation_rule.restricted_token_stale"]').count(), "one alert").toBe(1);
    expect(after.values, "the form shows the stored version again").toEqual(before.values);
    expect(after.fromVersion).toBe(before.fromVersion);
    expect(stored(ruleB.id), "nothing stored").toBe(storedBefore);
    expect(storedBefore.includes("<S>")).toBe(true);
    expect(after.text.includes(S.id)).toBe(false);
    expect(await page.locator("html").getAttribute("dir")).toBe(lang === "ar" ? "rtl" : "ltr");
  }
  // C4: the author re-applies a real change with this version's own values: it saves, and the alert clears.
  const pc4 = await save();
  log(`${lang} C4 untouched re-save -> ${pc4.status} If-Match ${pc4.ifMatch} ${pc4.body}`);
  expect(pc4.status).toBe(200);
  await expect(alerts).toHaveCount(0, { timeout: 30_000 });
  expect(stored(ruleB.id).includes("<S>")).toBe(true);

  // ---- D. observation: the reload GET fails after a stale-token 422
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(form).toBeVisible({ timeout: 30_000 });
  await screen(ruleB.id, "D-before");
  let armed = false;
  await page.route("**/api/v1/admin/automation-rules/*/versions/1", (route) =>
    armed && route.request().method() === "GET" ? route.abort("failed") : route.continue(),
  );
  page.on("response", (r) => {
    if (r.request().method() === "PATCH" && r.url().includes("/versions/1") && r.status() === 422) armed = true;
  });
  const inputsD = form.locator("[data-condition-row] input");
  await inputsD.nth((await inputsD.count()) - 1).fill(tokenA);
  const pd = await save();
  await page.waitForTimeout(1500);
  const d = await screen(ruleB.id, "D-after-422-reload-failed");
  log(`${lang} D PATCH -> ${pd.status}; reload aborted=${armed}; stale text shown=${d.text.includes(staleText)}; form still holds the pasted token=${d.values.includes(tokenA)}`);
  await page.unroute("**/api/v1/admin/automation-rules/*/versions/1");

  for (const p of patches) log(`${lang} PATCH sent: ${p.status} ${p.ifMatch} ${p.body}`);
});
