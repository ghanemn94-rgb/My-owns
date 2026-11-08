// qa-verifier DG6 round 8 (T-DG6-REV-QA-R8) on candidate 6cda8b33 (source d84d11a6): independent probe, NOT part of the
// frozen candidate. Copied into a disposable clone as e2e/zz-qa-dg6r8-restricted-mywork-automation.spec.ts and run on
// e2e/support/with-demo-stack.sh (demo-initialized stack, AUTH_MODE=dev, the demo role users roaming.user.* through the
// dev sign-in, D-165), chromium-en and chromium-ar.
// Question (D-225 open question; D-222, D-223; ADR-0051 §2; REQ-S10-002): on the REAL stack and screens, in both
// languages,
//   A. a work item of the TL whose subject and link name a benefit the TO then marks sensitive: the work-item, My Work
//      and workspace-header responses carry no benefit id, subjectId/recordId null, the link is the transformation home
//      and the marker is set; the My Work page and the workspace header show the inbox's restricted text with the
//      "Includes restricted records" label, link to the transformation home, never name the id, and pass axe (no serious
//      or critical issue); following the link lands on the transformation home;
//   B. an automation rule authored by a demo user (granted ADM_METHOD for this probe) whose conditions name two benefits
//      the TO then marks sensitive: the author sees the marker in place of each literal, the summary's neutral phrase
//      in en and ar, the flag, and on the rule screen the restricted label on those conditions, never the ids (axe
//      too); a re-save of the shown content keeps both literals (read back by the TO, who is admitted);
//   C. the re-save rule's ordinal pairing (keepRestrictedLiterals pairs the k-th condition with the same field and
//      operator in the request with the k-th in the stored version): the author deletes the FIRST of two restricted
//      conditions that share field and operator and saves; which literal is kept is logged and asserted (the author
//      deleted the first, so the second should remain).
// The work item is inserted directly into the stack's disposable database (synthetic setup, as the in-tree
// sensitive-reach tests insert worker-created rows). Every value is SYNTHETIC demo data. The sensitivity marks and the
// role grant are undone at the end. Nothing approves anything (no G1-G6 business approval; unrelated to DG0-DG7).
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, langOf, tr, type ApiSession } from "../apps/web/e2e/support/ui.ts";
import { demoApi, demoPage } from "./support/a02-demo.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(420_000);
const OUT = process.env["QA_PROBE_OUT"] ?? "test-results/qa-dg6r8";
const MARKER = "[restricted]";

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function psql(sql: string): string {
  const url = process.env["DATABASE_OWNER_URL"];
  if (!url) throw new Error("BLOCKED: DATABASE_OWNER_URL is not exported by the stack harness");
  return execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], { encoding: "utf8" }).trim();
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

test("QA-R8 A: a restricted work item on My Work and the workspace header (API and screen)", async ({
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
    `INSERT INTO work_item (id, organization_id, transformation_id, kind, assignee_user_id, subject_type, subject_id, link_path, message_key, message_params, due_date, dedupe_key, created_source) VALUES ('${itemId}', '${w.org}', '${w.tid}', 'finance_validation_review', '${tl.userId}', 'benefit', '${bid}', '${home}/benefits/${bid}', 'approvals.task.decide', '{"title":"QA-R8 synthetic task about a benefit","approvalType":"decision_request","roundNo":1,"dueDate":null}', '${due}', 'qa.dg6r8.${lang}.${itemId}', 'api')`,
  );
  console.log(`QA-R8 A ${lang}: transformation ${w.tid}, benefit ${bid}, work item ${itemId}, due ${due}`);
  // Control: before marking the TL sees the subject id.
  const before = await tl.call<Body>("GET", `/api/v1/work-items/${itemId}`);
  expect(before.subjectId).toBe(bid);
  expect(before.includesRestrictedRecords).toBeUndefined();
  await mark(to, w.tid, bid, true, "QA-R8 synthetic sensitivity probe");
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
      console.log(`QA-R8 A ${lang} ${what}: ${JSON.stringify(x)}`);
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
    console.log(`QA-R8 A ${lang} My Work restricted items: ${JSON.stringify(mine)}`);
    expect(mine.length).toBeGreaterThan(0);
    for (const m of mine) expect({ r: m.recordId, h: m.href, c: m.code }).toEqual({ r: null, h: home, c: null });
    const nextRestricted = (header.nextActions.items as Body[]).filter((x) => x.includesRestrictedRecords);
    console.log(`QA-R8 A ${lang} header next actions restricted: ${nextRestricted.length} of ${header.nextActions.items.length}`);

    // Screen: My Work.
    const page = await demoPage(browser, lang, "tl");
    await page.goto("/my-work");
    const restrictedText = tr(lang, "inbox.restricted");
    const links = page.locator("main a", { hasText: restrictedText });
    await expect(links.first()).toBeVisible({ timeout: 60_000 });
    const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    console.log(`QA-R8 A ${lang} My Work restricted links: ${JSON.stringify(hrefs)}`);
    for (const h of hrefs) expect(h).toBe(home);
    const labels = page.locator("main [data-restricted-records='true']");
    await expect(labels.first()).toBeVisible();
    await expect(labels.first()).toContainText(tr(lang, "access.includesRestrictedRecords"));
    console.log(`QA-R8 A ${lang} My Work labels: ${await labels.count()}; dir ${await page.locator("html").getAttribute("dir")}`);
    await noIds(page, [bid], "My Work");
    await page.screenshot({ path: path.join(OUT, `A-my-work-TL-${lang}.png`), fullPage: true });
    await expectAccessible(page, lang, "qa-r8-my-work-restricted");
    // Reflow: at 360 px and 390 px wide, the page with the restricted item and its label scrolls only vertically.
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.reload();
      await expect(links.first()).toBeVisible({ timeout: 60_000 });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`QA-R8 A ${lang} My Work at ${width} px: horizontal overflow ${over} px`);
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
    console.log(`QA-R8 A ${lang} header restricted links: ${await headerLinks.count()}`);
    if (nextRestricted.length > 0) {
      await expect(headerLinks.first()).toHaveAttribute("href", home);
      await expect(next.locator("[data-restricted-records='true']").first()).toContainText(
        tr(lang, "access.includesRestrictedRecords"),
      );
    }
    await noIds(page, [bid], "workspace home");
    await page.screenshot({ path: path.join(OUT, `A-workspace-header-TL-${lang}.png`), fullPage: true });
    await expectAccessible(page, lang, "qa-r8-workspace-header-restricted");
    // The assignee completes it; the answer is redacted.
    const done = await tl.call<Body>("POST", `/api/v1/work-items/${itemId}/complete`, undefined, {
      ifMatch: Number(one.version),
    });
    expect({ st: done.status, s: done.subjectId, m: done.includesRestrictedRecords }).toEqual({ st: "done", s: null, m: true });
    await page.context().close();
  } finally {
    await mark(to, w.tid, bid, false, "QA-R8 probe cleanup");
  }
});

test("QA-R8 B/C: automation condition literals naming restricted benefits (API, screen, re-save, ordinal pairing)", async ({
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
  const grant = await adm.call<Body>("POST", "/api/v1/role-assignments", {
    userId: cm.userId,
    roleCode: "ADM_METHOD",
    scope: { type: "organization", id: w.org },
    reason: "QA-R8 synthetic grant to author a rule",
  });
  const R = "/api/v1/admin/automation-rules";
  let ruleId = "";
  try {
    const rule = await cm.call<Body>("POST", R, {
      code: `qa.dg6r8.${lang}.${Date.now()}`,
      nameEn: "QA-R8 synthetic variance follow-up",
      nameAr: "متابعة انحراف تجريبية QA-R8",
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
    console.log(`QA-R8 B ${lang}: rule ${ruleId}, benefits ${b1} ${b2}`);
    await mark(to, w.tid, b1, true, "QA-R8 synthetic sensitivity probe");
    await mark(to, w.tid, b2, true, "QA-R8 synthetic sensitivity probe");
    for (const b of [b1, b2])
      await cm.call("GET", `/api/v1/transformations/${w.tid}/benefits/${b}`, undefined, { expect: 404 });
    // B. API as the author.
    const v1 = await cm.call<Body>("GET", `${R}/${ruleId}/versions/1`);
    console.log(`QA-R8 B ${lang} author view: ${JSON.stringify({ c: v1.content.conditions, s: v1.summary, f: v1.includesRestrictedRecords })}`);
    expect(v1.content.conditions).toEqual([
      { field: "benefitId", op: "eq", value: MARKER },
      { field: "benefitId", op: "eq", value: MARKER },
      { field: "severity", op: "eq", value: "high" },
    ]);
    expect(v1.includesRestrictedRecords).toBe(true);
    expect(JSON.stringify(v1.summary.en)).toContain("a restricted record");
    expect(JSON.stringify(v1.summary.ar)).toContain("سجل مقيد");
    for (const p of [`${R}/${ruleId}`, `${R}/${ruleId}/versions`, `${R}/${ruleId}/versions/1`, `${R}?limit=100`]) {
      const b = await cm.call<Body>("GET", p);
      for (const id of [b1, b2]) expect(JSON.stringify(b).includes(id), `${p} names ${id}`).toBe(false);
    }
    // B. Screen as the author.
    const page = await demoPage(browser, lang, "cm");
    await page.goto(`/admin/automation/rules/${ruleId}`);
    const conds = page.locator("[data-condition]");
    await expect(conds.first()).toBeVisible({ timeout: 60_000 });
    const texts = await conds.allInnerTexts();
    console.log(`QA-R8 B ${lang} rule screen conditions: ${JSON.stringify(texts)}`);
    for (const i of [0, 1]) {
      await expect(conds.nth(i).locator("[data-restricted-records='true']")).toContainText(
        tr(lang, "access.includesRestrictedRecords"),
      );
    }
    await expect(conds.nth(2).locator("[data-restricted-records='true']")).toHaveCount(0);
    await noIds(page, [b1, b2], "rule screen");
    await page.screenshot({ path: path.join(OUT, `B-rule-screen-author-${lang}.png`), fullPage: true });
    await expectAccessible(page, lang, "qa-r8-rule-restricted-conditions");
    await page.context().close();
    // B. A re-save of the shown content (only the severity changed) keeps both literals.
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
    const byTo = await to.call<Body>("GET", `${R}/${ruleId}/versions/1`);
    console.log(`QA-R8 B ${lang} after re-save, TO (admitted) reads: ${JSON.stringify(byTo.content.conditions)}`);
    expect(byTo.content.conditions).toEqual([
      { field: "benefitId", op: "eq", value: b1 },
      { field: "benefitId", op: "eq", value: b2 },
      { field: "severity", op: "eq", value: "critical" },
    ]);
    // C. The author deletes the FIRST restricted condition and saves.
    const shown = await cm.call<Body>("GET", `${R}/${ruleId}/versions/1`);
    const sent = (shown.content.conditions as Body[]).filter((_, i) => i !== 0);
    await cm.call<Body>("PATCH", `${R}/${ruleId}/versions/1`, { content: { ...shown.content, conditions: sent } }, {
      ifMatch: Number(saved.version) ,
    });
    const afterDelete = await to.call<Body>("GET", `${R}/${ruleId}/versions/1`);
    const kept = afterDelete.content.conditions[0]?.value;
    console.log(
      `QA-R8 C ${lang}: author deleted condition 0 (benefitId eq ${b1}) and kept condition 1 (benefitId eq ${b2}); stored now ${JSON.stringify(afterDelete.content.conditions)}; kept literal is ${kept === b2 ? "the SECOND (intended)" : kept === b1 ? "the FIRST (the deleted one)" : String(kept)}`,
    );
    expect(kept, "the condition the author kept (the second) keeps its own literal").toBe(b2);
  } finally {
    await mark(to, w.tid, b1, false, "QA-R8 probe cleanup");
    await mark(to, w.tid, b2, false, "QA-R8 probe cleanup");
    const g = await adm.call<Body>("GET", `/api/v1/role-assignments/${grant.id}`);
    await adm.call("POST", `/api/v1/role-assignments/${grant.id}/revoke`, { reason: "End of the QA-R8 probe" }, {
      ifMatch: Number(g.version),
    });
  }
});
