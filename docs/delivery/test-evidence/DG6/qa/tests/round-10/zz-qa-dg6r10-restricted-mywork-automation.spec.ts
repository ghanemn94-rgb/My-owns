// qa-verifier DG6 round 10 (T-DG6-REV-QA-R10, session 094e31f2) on candidate 56415aee (source cde60365): independent
// probe, NOT part of the frozen candidate. Port of round 9's zz-qa-dg6r9-restricted-mywork-automation.spec.ts (itself
// round 8's reproduction of F-DG6-560 and F-DG6-561) to the version-bound token of D-231, `[restricted:<version>:<k>]`;
// the token literals move to the new form and every behaviour assertion stands. Copied into a disposable clone as
// e2e/zz-qa-dg6r10-restricted-mywork-automation.spec.ts and run on e2e/support/with-demo-stack.sh (AUTH_MODE=dev, D-165),
// chromium-en and chromium-ar.
//   A. (F-DG6-561) My Work / workspace header with a restricted work item: the label's title and screen-reader text are
//      the ITEM description (adminP6.restricted.hintItem), not the total one; 360/390 px reflow; axe.
//   B. (F-DG6-560, F-DG6-561) the author sees opaque version-bound tokens, the item description on each condition label,
//      axe clean, no id in the DOM; an API re-save keeps both literals.
//   C. (F-DG6-560) IN THE UI the author removes condition 1 and saves; the TO (admitted) reads [b2, critical].
//   C2. (F-DG6-580 class, D-231) right after C, WITHOUT a reload, the author saves again: the form has reloaded from the
//      saved response; the PATCH carries the current If-Match and tokens; the stored rule stays [b2, critical].
//   D. (D-226) IN THE UI the author types the bare marker "[restricted]" and saves: 422 restricted_marker_unknown.
//   E. (D-231) the 409 path: a second writer saves first; the author's save -> 409, the bilingual 'changed, re-apply'
//      alert, the form reloaded with the current version; re-apply and save -> 200, the hidden literal kept.
// Every value is SYNTHETIC demo data. Nothing approves anything (no G1-G6 business approval; unrelated to DG0-DG7).
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, langOf, tr, type ApiSession } from "../apps/web/e2e/support/ui.ts";
import { demoApi, demoPage } from "./support/a02-demo.ts";

// (default mode, see header)
test.setTimeout(420_000);
const OUT = process.env["QA_PROBE_OUT"] ?? "test-results/qa-dg6r10";
const T = (version: number, k: number) => `[restricted:${version}:${k}]`;

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function psql(sql: string): string {
  const url = process.env["DATABASE_OWNER_URL"];
  if (!url) throw new Error("BLOCKED: DATABASE_OWNER_URL is not exported by the stack harness");
  return execFileSync("psql", [url.replace(/\+/g, "%20"), "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], { encoding: "utf8" }).trim();
}

async function demoWorld(to: ApiSession) {
  const ts = await to.call<Body>("GET", "/api/v1/transformations?limit=50");
  for (const t of ts.items as Body[]) {
    const bs = await to.call<Body>("GET", `/api/v1/transformations/${t.id}/benefits?limit=100`);
    if ((bs.items as Body[]).length >= 2)
      return { tid: String(t.id), org: String(t.organizationId), benefits: (bs.items as Body[]).map((b) => String(b.id)) };
  }
  throw new Error("no demo transformation with two benefits");
}

async function mark(to: ApiSession, tid: string, bid: string, on: boolean, reason: string): Promise<void> {
  const p = `/api/v1/transformations/${tid}/records/benefit/${bid}/sensitivity`;
  const cur = await to.call<Body>("GET", p);
  if (Boolean(cur.isSensitive) === on) return;
  await to.call("PUT", p, { isSensitive: on, reason }, { ifMatch: Number(cur.version) });
}

const noIds = async (page: Page, ids: readonly string[], what: string) => {
  const html = await page.content();
  for (const id of ids) expect(html.includes(id), `${what}: the DOM names hidden id ${id}`).toBe(false);
};

test("QA-R10 A: a restricted work item on My Work and the workspace header (API and screen)", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  mkdirSync(OUT, { recursive: true });
  const to = await demoApi(playwright, "to");
  const tl = await demoApi(playwright, "tl");
  const w = await demoWorld(to);
  // Each project uses its own benefit so the two runs never share a mark.
  const bid = w.benefits[lang === "en" ? 0 : 1]!;
  const home = `/transformations/${w.tid}`;
  const itemId = randomUUID();
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  psql(
    `INSERT INTO audit_event (id, organization_id, transformation_id, actor_type, action, record_type, record_id, new_version, source, reason) VALUES (gen_random_uuid(), '${w.org}', '${w.tid}', 'system', 'work_item.create', 'work_item', '${itemId}', 1, 'api', 'QA-R10 synthetic probe setup'); INSERT INTO work_item (id, organization_id, transformation_id, kind, assignee_user_id, subject_type, subject_id, link_path, message_key, message_params, due_date, dedupe_key, created_source) VALUES ('${itemId}', '${w.org}', '${w.tid}', 'finance_validation_review', '${tl.userId}', 'benefit', '${bid}', '${home}/benefits/${bid}', 'approvals.task.decide', '{"title":"QA-R10 synthetic task about a benefit","approvalType":"decision_request","roundNo":1,"dueDate":null}', '${due}', 'qa.dg6r10.${lang}.${itemId}', 'api')`,
  );
  console.log(`QA-R10 A ${lang}: transformation ${w.tid}, benefit ${bid}, work item ${itemId}, due ${due}`);
  // Control: before marking the TL sees the subject id.
  const before = await tl.call<Body>("GET", `/api/v1/work-items/${itemId}`);
  expect(before.subjectId).toBe(bid);
  expect(before.includesRestrictedRecords).toBeUndefined();
  await mark(to, w.tid, bid, true, "QA-R10 synthetic sensitivity probe");
  try {
    await tl.call("GET", `/api/v1/transformations/${w.tid}/benefits/${bid}`, undefined, { expect: 404 });
    // API.
    const one = await tl.call<Body>("GET", `/api/v1/work-items/${itemId}`);
    const list = await tl.call<Body>("GET", "/api/v1/me/work-items?limit=100");
    const listed = (list.items as Body[]).find((x) => x.id === itemId)!;
    for (const [what, x] of [
      ["getWorkItem", one],
      ["listMyWorkItems", listed],
    ] as const) {
      console.log(`QA-R10 A ${lang} ${what}: ${JSON.stringify(x)}`);
      expect({ s: x.subjectId, l: x.linkPath, m: x.includesRestrictedRecords, k: x.messageKey, t: x.subjectType }).toEqual(
        { s: null, l: home, m: true, k: "inbox.restricted", t: "benefit" },
      );
    }
    const work = await tl.call<Body>("GET", "/api/v1/me/work?limit=100");
    const header = await tl.call<Body>("GET", `/api/v1/transformations/${w.tid}/summary`);
    for (const [what, b] of [
      ["listMyWorkItems", list],
      ["getMyWork", work],
      ["workspace header", header],
    ] as const)
      expect(JSON.stringify(b).includes(bid), `${what} names the hidden benefit id`).toBe(false);
    const mine = (work.sections as Body[]).flatMap((s) => s.items as Body[]).filter((x) => x.includesRestrictedRecords);
    console.log(`QA-R10 A ${lang} My Work restricted items: ${JSON.stringify(mine)}`);
    expect(mine.length).toBeGreaterThan(0);
    for (const m of mine) expect({ r: m.recordId, h: m.href, c: m.code }).toEqual({ r: null, h: home, c: null });
    const nextRestricted = (header.nextActions.items as Body[]).filter((x) => x.includesRestrictedRecords);
    console.log(`QA-R10 A ${lang} header next actions restricted: ${nextRestricted.length} of ${header.nextActions.items.length}`);

    // Screen: My Work.
    const page = await demoPage(browser, lang, "tl");
    await page.goto("/my-work");
    const restrictedText = tr(lang, "myWork.message.inbox__restricted");
    const links = page.locator("main a", { hasText: restrictedText });
    await expect(links.first()).toBeVisible({ timeout: 60_000 });
    const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    console.log(`QA-R10 A ${lang} My Work restricted links: ${JSON.stringify(hrefs)}`);
    for (const h of hrefs) expect(h).toBe(home);
    const labels = page.locator("main [data-restricted-records='true']");
    await expect(labels.first()).toBeVisible();
    await expect(labels.first()).toContainText(tr(lang, "access.includesRestrictedRecords"));
    const aTitles = await labels.evaluateAll((els) => els.map((e) => [e.getAttribute("title"), e.getAttribute("data-restricted-scope"), (e as HTMLElement).textContent]));
    console.log(`QA-R10 A ${lang} My Work label title/scope/text: ${JSON.stringify(aTitles)}`);
    for (const [title, scope, text] of aTitles) {
      expect(title).toBe(tr(lang, "adminP6.restricted.hintItem"));
      expect(scope).toBe("item");
      expect(text).toContain(tr(lang, "adminP6.restricted.hintItem"));
      expect(text).not.toContain(tr(lang, "adminP6.restricted.hint"));
    }
    console.log(`QA-R10 A ${lang} My Work labels: ${await labels.count()}; dir ${await page.locator("html").getAttribute("dir")}`);
    await noIds(page, [bid], "My Work");
    await page.screenshot({ path: path.join(OUT, `A-my-work-TL-${lang}.png`), fullPage: true });
    await expectAccessible(page, lang, "qa-r10-my-work-restricted");
    // Reflow: at 360 px and 390 px wide, the page with the restricted item and its label scrolls only vertically.
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.reload();
      await expect(links.first()).toBeVisible({ timeout: 60_000 });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`QA-R10 A ${lang} My Work at ${width} px: horizontal overflow ${over} px`);
      expect(over, `My Work at ${width} px scrolls horizontally`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(OUT, `A-my-work-TL-${lang}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();
    await expect(links.first()).toBeVisible({ timeout: 60_000 });
    // Following the link lands on the transformation home.
    await links.first().click();
    await expect(page).toHaveURL(new RegExp(`${home}$`));
    // Screen: the workspace header.
    const next = page.locator("[data-next-actions]");
    await expect(next).toBeVisible({ timeout: 60_000 });
    const headerLinks = next.locator("a", { hasText: restrictedText });
    console.log(`QA-R10 A ${lang} header restricted links: ${await headerLinks.count()}`);
    if (nextRestricted.length > 0) {
      await expect(headerLinks.first()).toHaveAttribute("href", home);
      await expect(next.locator("[data-restricted-records='true']").first()).toContainText(
        tr(lang, "access.includesRestrictedRecords"),
      );
    }
    await noIds(page, [bid], "workspace home");
    await page.screenshot({ path: path.join(OUT, `A-workspace-header-TL-${lang}.png`), fullPage: true });
    await expectAccessible(page, lang, "qa-r10-workspace-header-restricted");
    // The assignee completes it; the answer is redacted.
    const done = await tl.call<Body>("POST", `/api/v1/work-items/${itemId}/complete`, undefined, {
      ifMatch: Number(one.version),
    });
    expect({ st: done.status, s: done.subjectId, m: done.includesRestrictedRecords }).toEqual({ st: "done", s: null, m: true });
    await page.context().close();
  } finally {
    await mark(to, w.tid, bid, false, "QA-R10 probe cleanup");
  }
});

test("QA-R10 B/C: automation condition literals naming restricted benefits (API, screen, re-save, ordinal pairing)", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  mkdirSync(OUT, { recursive: true });
  const to = await demoApi(playwright, "to");
  const adm = await demoApi(playwright, "adm_access");
  const cm = await demoApi(playwright, "cm");
  const w = await demoWorld(to);
  const [b1, b2] = lang === "en" ? [w.benefits[0]!, w.benefits[1]!] : [w.benefits[1]!, w.benefits[0]!];
  const gid = randomUUID();
  psql(
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM scoped_assignment a JOIN role r ON r.id = a.role_id WHERE a.user_id = '${cm.userId}' AND r.code = 'ADM_METHOD' AND a.revoked_at IS NULL) THEN INSERT INTO audit_event (id, organization_id, actor_type, action, record_type, record_id, new_version, source, reason) VALUES (gen_random_uuid(), '${w.org}', 'system', 'scoped_assignment.create', 'scoped_assignment', '${gid}', 1, 'api', 'QA-R10 synthetic grant to author a rule'); INSERT INTO scoped_assignment (id, organization_id, user_id, role_id, scope_type, scope_id, reason, granted_by, created_by, updated_by) SELECT '${gid}', '${w.org}', '${cm.userId}', r.id, 'organization', '${w.org}', 'QA-R10 synthetic grant to author a rule', '${adm.userId}', '${adm.userId}', '${adm.userId}' FROM role r WHERE r.code = 'ADM_METHOD'; END IF; END $$`,
  );
  const R = "/api/v1/admin/automation-rules";
  let ruleId = "";
  try {
    const rule = await cm.call<Body>("POST", R, {
      code: `qa.dg6r10.${lang}.${Date.now()}`,
      nameEn: "QA-R10 synthetic variance follow-up",
      nameAr: "متابعة انحراف تجريبية QA-R10",
      scopeLevel: "organization",
      organizationId: w.org,
      ownerUserId: cm.userId,
      content: {
        triggerCodes: ["benefit.variance_evaluated"],
        conditions: [
          { field: "benefitId", op: "eq", value: b1 },
          { field: "benefitId", op: "eq", value: b2 },
          { field: "severity", op: "eq", value: "high" },
        ],
        actions: [{ type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } }],
        runAs: "service",
      },
    });
    ruleId = String(rule.id);
    console.log(`QA-R10 B ${lang}: rule ${ruleId}, benefits ${b1} ${b2}`);
    await mark(to, w.tid, b1, true, "QA-R10 synthetic sensitivity probe");
    await mark(to, w.tid, b2, true, "QA-R10 synthetic sensitivity probe");
    for (const b of [b1, b2])
      await cm.call("GET", `/api/v1/transformations/${w.tid}/benefits/${b}`, undefined, { expect: 404 });
    // B. API as the author.
    const v1 = await cm.call<Body>("GET", `${R}/${ruleId}/versions/1`);
    console.log(`QA-R10 B ${lang} author view: ${JSON.stringify({ c: v1.content.conditions, s: v1.summary, f: v1.includesRestrictedRecords })}`);
    expect(v1.content.conditions).toEqual([
      { field: "benefitId", op: "eq", value: T(Number(v1.version), 1) },
      { field: "benefitId", op: "eq", value: T(Number(v1.version), 2) },
      { field: "severity", op: "eq", value: "high" },
    ]);
    expect(v1.includesRestrictedRecords).toBe(true);
    expect(JSON.stringify(v1.summary.en)).toContain("a restricted record");
    expect(JSON.stringify(v1.summary.ar)).toContain("سجل مقيد");
    for (const p of [`${R}/${ruleId}`, `${R}/${ruleId}/versions`, `${R}/${ruleId}/versions/1`, `${R}?limit=100`]) {
      const b = await cm.call<Body>("GET", p);
      for (const id of [b1, b2]) expect(JSON.stringify(b).includes(id), `${p} names ${id}`).toBe(false);
    }
    // B. A re-save through the API of the shown content (only the severity changed) keeps both literals (control).
    const saved = await cm.call<Body>(
      "PATCH",
      `${R}/${ruleId}/versions/1`,
      {
        content: {
          ...v1.content,
          conditions: (v1.content.conditions as Body[]).map((c) => (c.field === "severity" ? { ...c, value: "critical" } : c)),
        },
      },
      { ifMatch: Number(v1.version) },
    );
    expect(saved.includesRestrictedRecords).toBe(true);
    const byTo = await to.call<Body>("GET", `${R}/${ruleId}/versions/1`);
    console.log(`QA-R10 B ${lang} after API re-save, TO (admitted) reads: ${JSON.stringify(byTo.content.conditions)}`);
    expect(byTo.content.conditions).toEqual([
      { field: "benefitId", op: "eq", value: b1 },
      { field: "benefitId", op: "eq", value: b2 },
      { field: "severity", op: "eq", value: "critical" },
    ]);
    // B. Screen as the author: the draft editor.
    const page = await demoPage(browser, lang, "cm");
    await page.goto(`/admin/automation-rules/${ruleId}/versions/1`);
    const valueBox = (n: number) => page.getByRole("textbox", { name: tr(lang, "workflowsP5.rules.conditionValue", { n }) });
    await expect(valueBox(1)).toBeVisible({ timeout: 60_000 });
    const values = [await valueBox(1).inputValue(), await valueBox(2).inputValue(), await valueBox(3).inputValue()];
    console.log(`QA-R10 B ${lang} editor values: ${JSON.stringify(values)}`);
    expect(values).toEqual([T(Number(saved.version), 1), T(Number(saved.version), 2), "critical"]);
    await expect(page.locator("form[data-form='edit-rule-content']")).toHaveAttribute("data-form-version", String(saved.version));
    const labels = page.locator("[data-restricted-records='true']");
    const n = await labels.count();
    const titles = await labels.evaluateAll((els) => els.map((e) => [e.getAttribute("title"), (e as HTMLElement).innerText]));
    console.log(`QA-R10 B ${lang} restricted labels on the editor: ${n}; title/text ${JSON.stringify(titles)}`);
    for (const [title] of titles) expect(title).toBe(tr(lang, "adminP6.restricted.hintItem"));
    for (const i of [1, 2])
      await expect(valueBox(i).locator("xpath=..").locator("[data-restricted-records='true']")).toContainText(
        tr(lang, "access.includesRestrictedRecords"),
      );
    await expect(valueBox(3).locator("xpath=..").locator("[data-restricted-records='true']")).toHaveCount(0);
    await noIds(page, [b1, b2], "rule editor");
    await page.screenshot({ path: path.join(OUT, `B-rule-editor-author-${lang}.png`), fullPage: true });
    await expectAccessible(page, lang, "qa-r10-rule-restricted-conditions");
    // C. In the UI, the author removes condition 1 and saves the draft.
    await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.removeCondition", { n: 1 }) }).click();
    const after = [await valueBox(1).inputValue(), await valueBox(2).inputValue()];
    console.log(`QA-R10 C ${lang} editor after removing condition 1: ${JSON.stringify(after)}`);
    await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.saveDraft") }).click();
    await expect
      .poll(async () => (await to.call<Body>("GET", `${R}/${ruleId}/versions/1`)).content.conditions.length, { timeout: 60_000 })
      .toBe(2);
    await page.screenshot({ path: path.join(OUT, `C-rule-editor-after-remove-${lang}.png`), fullPage: true });
    // C2 (F-DG6-580 class, D-231). Without a reload, the author clicks 'Save the draft' a second time.
    const v2 = await to.call<Body>("GET", `${R}/${ruleId}/versions/1`);
    await expect(page.locator("form[data-form='edit-rule-content']")).toHaveAttribute("data-form-version", String(v2.version), {
      timeout: 30_000,
    });
    const reloaded = [await valueBox(1).inputValue(), await valueBox(2).inputValue()];
    console.log(`QA-R10 C2 ${lang} editor after the save (no reload): version ${v2.version}, values ${JSON.stringify(reloaded)}`);
    expect(reloaded).toEqual([T(Number(v2.version), 1), "critical"]);
    await expect(valueBox(1).locator("xpath=..").locator("[data-restricted-records='true']")).toContainText(
      tr(lang, "access.includesRestrictedRecords"),
    );
    await expect(valueBox(2).locator("xpath=..").locator("[data-restricted-records='true']")).toHaveCount(0);
    const second = page.waitForResponse((r) => r.url().includes(`/automation-rules/${ruleId}/versions/1`) && r.request().method() === "PATCH");
    await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.saveDraft") }).click();
    const r2 = await second;
    const sent2 = JSON.parse(r2.request().postData() ?? "{}");
    console.log(
      `QA-R10 C2 ${lang} second save: status ${r2.status()}, If-Match ${JSON.stringify(r2.request().headers()["if-match"])}, sent ${JSON.stringify(sent2.content?.conditions)}`,
    );
    expect(r2.status()).toBe(200);
    expect(sent2.content.conditions[0].value).toBe(T(Number(v2.version), 1));
    expect(r2.request().headers()["if-match"]).toContain(String(v2.version));
    await expect(page.locator("[data-state='rule-changed-reapply']")).toHaveCount(0);
    const afterC2 = await to.call<Body>("GET", `${R}/${ruleId}/versions/1`);
    console.log(`QA-R10 C2 ${lang}: stored after the second save ${JSON.stringify(afterC2.content.conditions)}`);
    expect(afterC2.content.conditions).toEqual([
      { field: "benefitId", op: "eq", value: b2 },
      { field: "severity", op: "eq", value: "critical" },
    ]);
    await page.screenshot({ path: path.join(OUT, `C2-rule-editor-after-second-save-${lang}.png`), fullPage: true });
    await page.context().close();
    const afterDelete = await to.call<Body>("GET", `${R}/${ruleId}/versions/1`);
    const kept = afterDelete.content.conditions[0]?.value;
    console.log(
      `QA-R10 C ${lang}: in the UI the author removed condition 1 (benefitId eq ${b1}) and kept condition 2 (benefitId eq ${b2}); stored now ${JSON.stringify(afterDelete.content.conditions)}; kept literal is ${kept === b2 ? "the SECOND (intended)" : kept === b1 ? "the FIRST (the removed one)" : String(kept)}`,
    );
    expect(afterDelete.content.conditions).toEqual([
      { field: "benefitId", op: "eq", value: b2 },
      { field: "severity", op: "eq", value: "critical" },
    ]);
    // D. In the UI the author types the bare marker text as a value and saves: refused, nothing stored changes.
    const page2 = await demoPage(browser, lang, "cm");
    await page2.goto(`/admin/automation-rules/${ruleId}/versions/1`);
    const vb = (n: number) => page2.getByRole("textbox", { name: tr(lang, "workflowsP5.rules.conditionValue", { n }) });
    await expect(vb(1)).toBeVisible({ timeout: 60_000 });
    const shownD = [await vb(1).inputValue(), await vb(2).inputValue()];
    console.log(`QA-R10 D ${lang} editor values after C (positions renumbered for the new version): ${JSON.stringify(shownD)}`);
    expect(shownD).toEqual([T(Number(afterDelete.version), 1), "critical"]);
    await vb(2).fill("[restricted]");
    const respP = page2.waitForResponse((r) => r.url().includes(`/automation-rules/${ruleId}/versions/1`) && r.request().method() === "PATCH");
    await page2.getByRole("button", { name: tr(lang, "workflowsP5.rules.saveDraft") }).click();
    const resp = await respP;
    const pb = await resp.json();
    console.log(`QA-R10 D ${lang}: PATCH status ${resp.status()} code ${pb.code} errors ${JSON.stringify(pb.errors)}`);
    expect(resp.status()).toBe(422);
    expect(pb.code).toBe("automation_rule.restricted_marker_unknown");
    await expect(page2.getByText(tr(lang, "problems.automation_rule__restricted_marker_unknown")).first()).toBeVisible({ timeout: 30_000 });
    await page2.screenshot({ path: path.join(OUT, `D-rule-editor-bare-marker-refused-${lang}.png`), fullPage: true });
    await noIds(page2, [b1, b2], "rule editor (D)");
    await page2.context().close();
    const afterD = await to.call<Body>("GET", `${R}/${ruleId}/versions/1`);
    expect(afterD.content.conditions).toEqual(afterDelete.content.conditions);
    // E (D-231). The 409 path: the author's editor is open; the same author saves first from another tab (API, as
    // the author: it reads its own tokens). Revision b: run 40 used the TO as the second writer, which has no
    // automation.configure (403 at this step; a probe error, steps B-D had passed).
    const page3 = await demoPage(browser, lang, "cm");
    await page3.goto(`/admin/automation-rules/${ruleId}/versions/1`);
    const ve = (n: number) => page3.getByRole("textbox", { name: tr(lang, "workflowsP5.rules.conditionValue", { n }) });
    await expect(ve(1)).toBeVisible({ timeout: 60_000 });
    const otherTab = await cm.call<Body>("GET", `${R}/${ruleId}/versions/1`);
    await cm.call(
      "PATCH",
      `${R}/${ruleId}/versions/1`,
      { content: { ...otherTab.content, conditions: [otherTab.content.conditions[0], { field: "severity", op: "eq", value: "high" }] } },
      { ifMatch: Number(otherTab.version) },
    );
    const vE = await to.call<Body>("GET", `${R}/${ruleId}/versions/1`);
    // The author removes condition 2 (severity) and saves: 409.
    await page3.getByRole("button", { name: tr(lang, "workflowsP5.rules.removeCondition", { n: 2 }) }).click();
    const conflict = page3.waitForResponse((r) => r.url().includes(`/automation-rules/${ruleId}/versions/1`) && r.request().method() === "PATCH");
    await page3.getByRole("button", { name: tr(lang, "workflowsP5.rules.saveDraft") }).click();
    const rc = await conflict;
    console.log(`QA-R10 E ${lang}: author save after a concurrent save: status ${rc.status()} If-Match ${JSON.stringify(rc.request().headers()["if-match"])}`);
    expect(rc.status()).toBe(409);
    const alert = page3.locator("[data-state='rule-changed-reapply']");
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).toHaveText(tr(lang, "workflowsP5.rules.changedReapply"));
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(page3.locator("form[data-form='edit-rule-content']")).toHaveAttribute("data-form-version", String(vE.version), {
      timeout: 30_000,
    });
    const shownE = [await ve(1).inputValue(), await ve(2).inputValue()];
    console.log(`QA-R10 E ${lang}: alert ${JSON.stringify(await alert.innerText())}; form reloaded to version ${vE.version}: ${JSON.stringify(shownE)}; dir ${await page3.locator("html").getAttribute("dir")}`);
    expect(shownE).toEqual([T(Number(vE.version), 1), "high"]);
    await page3.screenshot({ path: path.join(OUT, `E-rule-editor-409-reapply-${lang}.png`), fullPage: true });
    await expectAccessible(page3, lang, "qa-r10-rule-changed-reapply");
    await noIds(page3, [b1, b2], "rule editor (E)");
    // Re-apply (remove condition 2) and save: 200, the hidden literal kept, the alert cleared.
    await page3.getByRole("button", { name: tr(lang, "workflowsP5.rules.removeCondition", { n: 2 }) }).click();
    const reapply = page3.waitForResponse((r) => r.url().includes(`/automation-rules/${ruleId}/versions/1`) && r.request().method() === "PATCH");
    await page3.getByRole("button", { name: tr(lang, "workflowsP5.rules.saveDraft") }).click();
    const rr = await reapply;
    const sentE = JSON.parse(rr.request().postData() ?? "{}");
    console.log(`QA-R10 E ${lang}: re-applied save ${rr.status()} sent ${JSON.stringify(sentE.content?.conditions)}`);
    expect(rr.status()).toBe(200);
    await expect(alert).toHaveCount(0);
    const afterE = await to.call<Body>("GET", `${R}/${ruleId}/versions/1`);
    console.log(`QA-R10 E ${lang}: stored ${JSON.stringify(afterE.content.conditions)}`);
    expect(afterE.content.conditions).toEqual([{ field: "benefitId", op: "eq", value: b2 }]);
    await page3.context().close();
  } finally {
    await mark(to, w.tid, b1, false, "QA-R10 probe cleanup");
    await mark(to, w.tid, b2, false, "QA-R10 probe cleanup");
    // the synthetic grant stays in the disposable database (see header)
  }
});
