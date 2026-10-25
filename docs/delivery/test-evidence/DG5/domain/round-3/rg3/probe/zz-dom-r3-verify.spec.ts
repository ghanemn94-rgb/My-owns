// domain-reviewer DG5 re-gate round 3 (T-DG5-RG-DOM-R3): re-runs my round-1 reproductions of F-DG5-120 (slip impact on
// screens), F-DG5-121 (the demo's Day-90 test) and F-DG5-122 (reader table blocks) on the DEMO stack
// (e2e/support/with-demo-stack.sh), in the project language (chromium-en, chromium-ar). It records; the judgement is
// in the review record. Output: DOM_OUT (api/, shots/, text/, results-verify-<lang>.json).
// SYNTHETIC data only; nothing here approves anything real.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startProductionWorker } from "./support/a13-a22-stack.ts";
import { demoApi, demoPage, type DemoRole } from "./support/a02-demo.ts";
import { langOf, type Lang } from "../apps/web/e2e/support/ui.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const OUT = process.env["DOM_OUT"] ?? "dom-out";
const ROAMING = "01995000-0000-7000-8000-000000000001";
const INI01 = "01995000-0000-7000-8000-000000000021";
const INI03 = "01995000-0000-7000-8000-000000000023";
const results: { step: string; ok: boolean; detail?: string }[] = [];
const save = (rel: string, data: unknown) => {
  const p = path.join(OUT, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data, null, 2));
};
async function step(name: string, fn: () => Promise<unknown>) {
  try {
    const d = await fn();
    results.push({ step: name, ok: true, ...(d !== undefined ? { detail: String(d).slice(0, 1500) } : {}) });
  } catch (e) {
    results.push({ step: name, ok: false, detail: String((e as Error).message ?? e).slice(0, 1500) });
  }
}
async function capture(p: Page, lang: Lang, name: string, url: string) {
  await p.goto(url);
  await expect(p.locator("main#main h1")).toBeVisible({ timeout: 30_000 });
  await p.waitForLoadState("networkidle").catch(() => undefined);
  await p.waitForTimeout(1000);
  mkdirSync(path.join(OUT, "shots", lang), { recursive: true });
  await p.screenshot({ path: path.join(OUT, "shots", lang, `${name}.png`), fullPage: true });
  const text = await p.locator("body").innerText();
  save(`text/${lang}/${name}.txt`, `url=${url}\nhtml dir=${await p.locator("html").getAttribute("dir")}\n----\n${text}`);
  return text;
}

test.setTimeout(1_200_000);

test("round-2 verification of F-DG5-120, F-DG5-121, F-DG5-122", async ({ browser, playwright }, info) => {
  const lang = langOf(info);
  const tl = await demoApi(playwright, "tl");
  // ------------------------------------------------------------------ F-DG5-121: the roaming plan's Day-90 test
  const raw = async (rel: string, url: string) => {
    const r = await tl.req.get(url);
    const body = await r.text();
    const parsed = body ? JSON.parse(body) : null;
    save(`api/${lang}/${rel}.json`, { status: r.status(), body: parsed });
    return { status: r.status(), body: parsed };
  };
  let d90: Body = null;
  await step("d90.roaming.launch-plan", async () => {
    const r = await raw("roaming-launch-plan", `/api/v1/transformations/${ROAMING}/launch-plan`);
    return `status ${r.status} start ${r.body?.startDate} tasks ${r.body?.taskCount}`;
  });
  await step("d90.roaming.day-90-test", async () => {
    const r = await raw("roaming-day-90-test", `/api/v1/transformations/${ROAMING}/day-90-test`);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    d90 = r.body;
    return `status ${r.status} scheduled ${d90.scheduledDate} status ${d90.status} questions ${(d90.questions ?? []).length} answered ${d90.answeredCount}`;
  });
  const p = await demoPage(browser, lang, "tl");
  await step("d90.ui.before", async () => {
    const t = await capture(p, lang, "roaming-day-90-test", `/transformations/${ROAMING}/day-90-test`);
    return t.includes("Generate the launch plan first") || t.includes("أنشئ خطة الإطلاق أولًا") ? "STILL-SAYS-GENERATE" : "no 'generate first' text";
  });
  // Answer one question as the demo TL (if this language's run reaches it first) to show the test is operable.
  await step("d90.answer.q1", async () => {
    const cur = await tl.call<Body>("GET", `/api/v1/transformations/${ROAMING}/day-90-test`);
    const q = (cur.questions ?? []).find((x: Body) => x.code === "q1");
    if (q?.response) return `already answered: ${JSON.stringify(q.response).slice(0, 200)}`;
    const r = await tl.call<Body>(
      "PUT",
      `/api/v1/transformations/${ROAMING}/day-90-test/responses/q1`,
      { answer: "yes", comment: `Synthetic DOM-R2 ${lang} answer` },
      { ifMatch: cur.version },
    );
    save(`api/${lang}/roaming-day-90-answer-q1.json`, r);
    return `PUT q1 ok: answered ${r.answeredCount} status ${r.status}`;
  });
  await step("d90.ui.after", async () => {
    await capture(p, lang, "roaming-day-90-test-after-answer", `/transformations/${ROAMING}/day-90-test`);
  });
  // ------------------------------------------------------------------ F-DG5-122: reader table blocks
  const readerChecks = async (name: string, url: string) => {
    const t = await capture(p, lang, name, url);
    const pipes = t.split("\n").filter((l) => l.includes("|---|") || /\|\s*\|/.test(l)).length;
    const brs = (t.match(/<br\s*\/?>/gi) ?? []).length;
    const overflow = await p.evaluate(() =>
      Array.from(document.querySelectorAll("table[data-block-table='callout']")).map((tbl) => {
        const wrap = tbl.closest(".table-wrap") as HTMLElement | null;
        const r = tbl.getBoundingClientRect();
        return {
          tableWidth: Math.round(r.width),
          wrapClient: wrap?.clientWidth ?? null,
          wrapScroll: wrap?.scrollWidth ?? null,
          left: Math.round(r.left),
          right: Math.round(r.right),
          viewport: window.innerWidth,
        };
      }),
    );
    return `rawPipeLines=${pipes} rawBr=${brs} callouts=${JSON.stringify(overflow)}`;
  };
  await step("reader.list", () => readerChecks("reader", "/playbook/reader"));
  await step("reader.B0016", () => readerChecks("reader-B0016", "/playbook/reader/B0016"));
  await step("reader.B0124", () => readerChecks("reader-B0124", "/playbook/reader/B0124"));
  await step("reader.B0003", () => readerChecks("reader-B0003", "/playbook/reader/B0003"));
  await step("reader.B0024", () => readerChecks("reader-B0024", "/playbook/reader/B0024"));
  await step("reader.search", () => readerChecks("reader-search-pmi", "/playbook/reader?q=PMI"));
  await p.setViewportSize({ width: 390, height: 844 });
  await step("reader.B0016.narrow", () => readerChecks("reader-B0016-390", "/playbook/reader/B0016"));
  await step("reader.B0124.narrow", () => readerChecks("reader-B0124-390", "/playbook/reader/B0124"));
  await p.context().close();

  // ------------------------------------------------------------------ F-DG5-120: a real critical slip (worker relays)
  const worker = await startProductionWorker();
  try {
    const ms = await tl.call<Body>("GET", `/api/v1/initiatives/${INI03}/milestones`);
    save(`api/${lang}/slip-milestones-before.json`, ms);
    const items: Body[] = Array.isArray(ms) ? ms : (ms.items ?? []);
    const feed = items.find((m) => String(m.title ?? "").startsWith("Partner usage feed"));
    const current = String(feed?.forecastDate ?? feed?.approvedDate ?? "2026-09-28").slice(0, 10);
    const next = new Date(Date.parse(`${current}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10);
    const before = await tl.call<Body>("GET", `/api/v1/transformations/${ROAMING}/dependency-slips`);
    const nBefore = (before.items ?? []).length;
    await step("slip.patch-forecast", async () => {
      await tl.call<Body>("PATCH", `/api/v1/milestones/${feed.id}`, { forecastDate: next }, { ifMatch: feed.version });
      return `${current} -> ${next}`;
    });
    let slips: Body = null;
    await step("slip.recorded", async () => {
      const until = Date.now() + 90_000;
      while (Date.now() < until) {
        slips = await tl.call<Body>("GET", `/api/v1/transformations/${ROAMING}/dependency-slips`);
        if ((slips.items ?? []).length > nBefore) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      save(`api/${lang}/dependency-slips.json`, slips);
      if ((slips.items ?? []).length <= nBefore) throw new Error("no new slip recorded");
      return JSON.stringify(slips.items?.[0]).slice(0, 900);
    });
    const newest: Body = slips?.items?.[0];
    const affected: Body[] = newest?.affected ?? [];
    const owner = affected.find((a) => a.ownerUserId)?.ownerUserId ?? null;
    let ownerRole: DemoRole | null = null;
    for (const role of ["sp", "tl", "bo", "fin", "kds", "wl", "to", "cm"] as DemoRole[]) {
      const s = await demoApi(playwright, role);
      if (s.userId === owner) ownerRole = role;
      await s.req.dispose();
    }
    await step("slip.owner", async () => `owner=${owner} role=${ownerRole}`);
    if (!ownerRole) throw new Error("no owner role");
    const s = await demoApi(playwright, ownerRole);
    await step("slip.work-item", async () => {
      const until = Date.now() + 120_000;
      let w: Body = null;
      while (Date.now() < until) {
        w = await s.call<Body>("GET", "/api/v1/me/work-items");
        const n = JSON.stringify(w).split("dependency_slip").length - 1;
        if (n > 0) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      save(`api/${lang}/slip-owner-work-items.json`, w);
      if (!JSON.stringify(w).includes("dependency_slip")) throw new Error(`no dependency_slip work item: ${worker.output().slice(-800)}`);
    });
    await s.req.dispose();
    const op = await demoPage(browser, lang, ownerRole);
    await step("slip.ui.my-work", async () => {
      const t = await capture(op, lang, "slip-owner-my-work", "/my-work");
      const lines = t.split("\n").filter((l) => l.includes("DEP-01") || l.includes("dependency") || l.includes("اعتمادية") || l.includes("الاعتمادية"));
      return lines.join(" || ");
    });
    await step("slip.ui.dependencies", async () => {
      await capture(op, lang, "slip-owner-dependencies", `/transformations/${ROAMING}/dependencies`);
      const sec = op.locator("[data-dependency-slips='transformation']");
      await expect(sec).toBeVisible();
      const ba = await op.locator("[data-before-after='forecast-INI-01']").evaluateAll((els) =>
        els.map((e) => `${e.getAttribute("data-before")}->${e.getAttribute("data-after")}: ${(e as HTMLElement).innerText}`),
      );
      const change = await op.locator("[data-change-days]").evaluateAll((els) => els.map((e) => e.getAttribute("data-change-days")));
      const slipDays = await op.locator("[data-slip-days]").evaluateAll((els) => els.map((e) => e.getAttribute("data-slip-days")));
      const reason = await op.locator("[data-critical-reason]").evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.trim()));
      await sec.screenshot({ path: path.join(OUT, "shots", lang, "slip-owner-dependencies-section.png") });
      return `forecast INI-01=${JSON.stringify(ba)} change=${JSON.stringify(change)} slipDays=${JSON.stringify(slipDays)} reason=${JSON.stringify(reason)}`;
    });
    await step("slip.ui.my-work-link", async () => {
      await op.goto("/my-work");
      await expect(op.locator("main#main h1")).toBeVisible({ timeout: 30_000 });
      const link = op.locator("a", { hasText: "DEP-01" }).first();
      await expect(link).toBeVisible({ timeout: 30_000 });
      const href = await link.getAttribute("href");
      await link.click();
      await expect(op.locator("[data-dependency-slips='transformation']")).toBeVisible({ timeout: 30_000 });
      return `link ${href} -> ${op.url()}`;
    });
    await step("slip.ui.initiative-INI-01", async () => {
      await capture(op, lang, "slip-owner-initiative-INI-01", `/transformations/${ROAMING}/initiatives/${INI01}`);
      const sec = op.locator("[data-dependency-slips='initiative']");
      await expect(sec).toBeVisible();
      await sec.screenshot({ path: path.join(OUT, "shots", lang, "slip-owner-initiative-INI-01-section.png") });
      const ba = await sec.locator("[data-before-after^='forecast-']").evaluateAll((els) =>
        els.map((e) => `${e.getAttribute("data-before")}->${e.getAttribute("data-after")}`),
      );
      return `initiative section forecast=${JSON.stringify(ba)}`;
    });
    await op.context().close();
  } finally {
    await worker.stop();
    await tl.req.dispose();
    save(`results-verify-${lang}.json`, results);
  }
  expect(results.filter((r) => !r.ok)).toEqual([]);
});
