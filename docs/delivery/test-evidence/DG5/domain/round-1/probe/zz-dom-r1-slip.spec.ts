// domain-reviewer DG5 round 1 (T-DG5-RG-DOM-R1): REQ-S12-012 as a user meets it, on the DEMO stack
// (e2e/support/with-demo-stack.sh). The demo TL moves the forecast of INI-03's last milestone ("Partner usage feed live
// for digital activation", approved 2026-09-28; DEP-01: INI-01 needs it by 2026-10-01) 5 days later, to 2026-10-03,
// through the real API. The production worker relays dependency.slipped and runs starter 9. The probe records the
// slip (GET /dependency-slips), finds the affected owner, and captures that owner's My Work and the Dependencies page
// (the work item's link) in the project language. It records, it does not judge: results-slip-<lang>.json.
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

test.setTimeout(900_000);

test("REQ-S12-012 as the affected owner sees it", async ({ browser, playwright }, info) => {
  const lang = langOf(info);
  // Only one project slips (the slip key is once per milestone version); the ar run moves it again by +5 more days.
  const tl = await demoApi(playwright, "tl");
  const worker = await startProductionWorker();
  let owner: string | null = null;
  try {
    const ms = await tl.call<Body>("GET", `/api/v1/initiatives/${INI03}/milestones`);
    save(`api/${lang}/slip-milestones-before.json`, ms);
    const items: Body[] = Array.isArray(ms) ? ms : (ms.items ?? []);
    const feed = items.find((m) => String(m.title ?? "").startsWith("Partner usage feed"));
    const current = String(feed?.forecastDate ?? feed?.approvedDate ?? "2026-09-28").slice(0, 10);
    const next = new Date(Date.parse(`${current}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10);
    await step("slip.patch-forecast", async () => {
      const r = await tl.call<Body>("PATCH", `/api/v1/milestones/${feed.id}`, { forecastDate: next }, { ifMatch: feed.version });
      save(`api/${lang}/slip-milestone-after.json`, r);
      return `${current} -> ${next}`;
    });
    let slips: Body = null;
    await step("slip.recorded", async () => {
      const until = Date.now() + 60_000;
      while (Date.now() < until) {
        slips = await tl.call<Body>("GET", `/api/v1/transformations/${ROAMING}/dependency-slips`);
        if ((slips.items ?? []).length > 0) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      save(`api/${lang}/dependency-slips.json`, slips);
      return JSON.stringify(slips.items?.[0]).slice(0, 600);
    });
    const affected: Body[] = slips?.items?.[0]?.affected ?? [];
    owner = affected.find((a) => a.ownerUserId)?.ownerUserId ?? null;
    // Which demo role user is the owner?
    let ownerRole: DemoRole | null = null;
    for (const role of ["sp", "tl", "bo", "fin", "kds", "wl", "to", "cm"] as DemoRole[]) {
      const s = await demoApi(playwright, role);
      if (s.userId === owner) ownerRole = role;
      await s.req.dispose();
    }
    await step("slip.owner", async () => `owner=${owner} role=${ownerRole}`);
    if (ownerRole) {
      const s = await demoApi(playwright, ownerRole);
      await step("slip.work-item", async () => {
        const until = Date.now() + 90_000;
        let w: Body = null;
        while (Date.now() < until) {
          w = await s.call<Body>("GET", "/api/v1/me/work-items");
          if (JSON.stringify(w).includes("dependency_slip")) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
        save(`api/${lang}/slip-owner-work-items.json`, w);
        if (!JSON.stringify(w).includes("dependency_slip")) throw new Error(`no dependency_slip work item: ${worker.output().slice(-800)}`);
      });
      await s.req.dispose();
      const p = await demoPage(browser, lang, ownerRole);
      await step("slip.ui.my-work", () => capture(p, lang, `slip-owner-my-work`, "/my-work"));
      await step("slip.ui.dependencies", () => capture(p, lang, `slip-owner-dependencies`, `/transformations/${ROAMING}/dependencies`));
      await step("slip.ui.roadmap", () => capture(p, lang, `slip-owner-roadmap`, `/transformations/${ROAMING}/roadmap`));
      await step("slip.ui.initiative-INI-01", () =>
        capture(p, lang, `slip-owner-initiative-INI-01`, `/transformations/${ROAMING}/initiatives/01995000-0000-7000-8000-000000000021`),
      );
      await p.context().close();
    }
  } finally {
    await worker.stop();
    await tl.req.dispose();
    save(`results-slip-${lang}.json`, results);
  }
  expect(results.filter((r) => !r.ok)).toEqual([]);
});
