// domain-reviewer DG5 round 1 (T-DG5-RG-DOM-R1), DEMO stack (e2e/support/with-demo-stack.sh). REQ-PB-086/087:
// (1) the seeded roaming transformation: GET its launch plan and GET its Day-90 test (does the demo plan carry one?);
// (2) a NEW synthetic transformation by the demo TL, a launch plan from 2026-10-01 (REQ-PB-086 acceptance date), then the
// launch-plan and Day-90 pages rendered in the project language. Records to DOM_OUT; results-day90-<lang>.json.
// SYNTHETIC data only; nothing approves anything real.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { demoApi, demoPage, DEMO_BU } from "./support/a02-demo.ts";
import { langOf, type Lang } from "../apps/web/e2e/support/ui.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const OUT = process.env["DOM_OUT"] ?? "dom-out";
const ROAMING = "01995000-0000-7000-8000-000000000001";
const results: { step: string; ok: boolean; detail?: string }[] = [];
const save = (rel: string, data: unknown) => {
  const p = path.join(OUT, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data, null, 2));
};
async function step(name: string, fn: () => Promise<unknown>) {
  try {
    const d = await fn();
    results.push({ step: name, ok: true, ...(d !== undefined ? { detail: String(d).slice(0, 600) } : {}) });
  } catch (e) {
    results.push({ step: name, ok: false, detail: String((e as Error).message ?? e).slice(0, 1500) });
  }
}
async function capture(p: Page, lang: Lang, name: string, url: string) {
  await p.goto(url);
  await expect(p.locator("main#main h1")).toBeVisible({ timeout: 20_000 });
  await p.waitForLoadState("networkidle").catch(() => undefined);
  await p.waitForTimeout(800);
  mkdirSync(path.join(OUT, "shots", lang), { recursive: true });
  await p.screenshot({ path: path.join(OUT, "shots", lang, `${name}.png`), fullPage: true });
  const text = await p.locator("body").innerText();
  save(`text/${lang}/${name}.txt`, `url=${url}\nhtml dir=${await p.locator("html").getAttribute("dir")}\n----\n${text}`);
}

test.setTimeout(600_000);

test("Day-90 leadership test: seeded roaming plan and a new plan", async ({ browser, playwright }, info) => {
  const lang = langOf(info);
  const tl = await demoApi(playwright, "tl");
  const raw = async (rel: string, url: string) => {
    const r = await tl.req.get(url);
    const body = await r.text();
    save(`api/${lang}/${rel}.json`, { status: r.status(), body: body ? JSON.parse(body) : null });
    return `status ${r.status()}`;
  };
  await step("roaming.launch-plan", () => raw("roaming-launch-plan", `/api/v1/transformations/${ROAMING}/launch-plan`));
  await step("roaming.day-90-test", () => raw("roaming-day-90-test", `/api/v1/transformations/${ROAMING}/day-90-test`));
  let tid = "";
  await step("new.transformation", async () => {
    const t = await tl.call<Body>("POST", "/api/v1/transformations", {
      businessUnitId: DEMO_BU,
      name: `Synthetic DOM-R1 ${lang.toUpperCase()} launch`,
      mode: "end_to_end",
    });
    tid = t.id;
    return tid;
  });
  await step("new.launch-plan", async () => {
    const r = await tl.call<Body>("POST", `/api/v1/transformations/${tid}/launch-plan`, { startDate: "2026-10-01" }, { expect: 201 });
    save(`api/${lang}/new-launch-plan.json`, r);
    return `${r.taskCount} tasks from ${r.startDate}`;
  });
  await step("new.launch-plan-tasks", () => raw("new-launch-plan-tasks", `/api/v1/transformations/${tid}/launch-plan/tasks?limit=100`));
  await step("new.day-90-test", () => raw("new-day-90-test", `/api/v1/transformations/${tid}/day-90-test`));
  const p = await demoPage(browser, lang, "tl");
  await step("ui.new.launch-plan", () => capture(p, lang, "new-launch-plan", `/transformations/${tid}/launch-plan`));
  await step("ui.new.day-90-test", () => capture(p, lang, "new-day-90-test", `/transformations/${tid}/day-90-test`));
  await step("ui.roaming.day-90-test", () => capture(p, lang, "roaming-day-90-test", `/transformations/${ROAMING}/day-90-test`));
  await p.context().close();
  await tl.req.dispose();
  save(`results-day90-${lang}.json`, results);
  expect(results.filter((r) => !r.ok)).toEqual([]);
});
