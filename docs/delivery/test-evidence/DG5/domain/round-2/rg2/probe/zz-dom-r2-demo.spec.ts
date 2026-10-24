// domain-reviewer DG5 re-gate round 2 (T-DG5-RG-DOM-R2; copied from my round-1 probe): my own probe of the DEMO-initialized stack. Copied into a disposable
// clone's e2e/ and run through e2e/support/with-demo-stack.sh (AUTH_MODE=dev, MTH_ENV=demo, seed-demo + seed-dev).
// It records, never repairs: API bodies, export files and EN/AR screenshots + page text go to DOM_OUT, and
// results.json lists each probe step with ok/false and the error. The source comparison is done afterwards by
// analyse.mjs against docs/source/playbook.blocks.json. Every record is SYNTHETIC; nothing here approves anything real.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startProductionWorker } from "./support/a13-a22-stack.ts";
import { demoApi, demoPage } from "./support/a02-demo.ts";
import { langOf, type Lang } from "../apps/web/e2e/support/ui.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const OUT = process.env["DOM_OUT"] ?? "dom-out";
const ROAMING = "01995000-0000-7000-8000-000000000001";
const results: { step: string; ok: boolean; detail?: string }[] = [];
const save = (rel: string, data: unknown) => {
  const p = path.join(OUT, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, typeof data === "string" || data instanceof Uint8Array ? data : JSON.stringify(data, null, 2));
};
async function step(name: string, fn: () => Promise<unknown>) {
  try {
    const d = await fn();
    results.push({ step: name, ok: true, ...(d !== undefined ? { detail: String(d).slice(0, 400) } : {}) });
  } catch (e) {
    results.push({ step: name, ok: false, detail: String((e as Error).message ?? e).slice(0, 1500) });
  }
}
async function capture(p: Page, lang: Lang, name: string, url: string) {
  await p.goto(url);
  await expect(p.locator("main#main h1")).toBeVisible({ timeout: 20_000 });
  await p.waitForLoadState("networkidle").catch(() => undefined);
  await p.waitForTimeout(800);
  const dir = await p.locator("html").getAttribute("dir");
  const htmlLang = await p.locator("html").getAttribute("lang");
  mkdirSync(path.join(OUT, "shots", lang), { recursive: true });
  await p.screenshot({ path: path.join(OUT, "shots", lang, `${name}.png`), fullPage: true });
  const text = await p.locator("body").innerText();
  save(`text/${lang}/${name}.txt`, `url=${url}\nhtml lang=${htmlLang} dir=${dir}\n----\n${text}`);
  return `lang=${htmlLang} dir=${dir}`;
}

test.setTimeout(1_500_000);

test("domain probe on the demo stack", async ({ browser, playwright }, info) => {
  const lang = langOf(info);
  const tl = await demoApi(playwright, "tl");
  const get = async (rel: string, url: string) => {
    const b = await tl.call<Body>("GET", url);
    save(`api/${lang}/${rel}.json`, b);
    return b;
  };
  // ---------------------------------------------------------------- API reads (as the demo Transformation Lead)
  await step("api.environment", () => get("environment", "/api/v1/environment"));
  await step("api.navigation.tl", () => get("navigation-tl", "/api/v1/me/navigation"));
  for (const role of ["sp", "bo", "fin", "kds", "wl", "to", "cm"] as const) {
    await step(`api.navigation.${role}`, async () => {
      const s = await demoApi(playwright, role);
      save(`api/${lang}/navigation-${role}.json`, await s.call<Body>("GET", "/api/v1/me/navigation"));
      await s.req.dispose();
    });
  }
  await step("api.transformation", () => get("roaming", `/api/v1/transformations/${ROAMING}`));
  await step("api.traceability", () => get("traceability", `/api/v1/transformations/${ROAMING}/traceability`));
  await step("api.guiding-questions", () => get("guiding-questions", "/api/v1/methodology/guiding-questions"));
  for (const b of ["B0004", "B0016", "B0124", "B0031", "B0144", "B0145", "B0147"])
    await step(`api.block.${b}`, () => get(`block-${b}`, `/api/v1/methodology/blocks/${b}`));
  await step("api.blocks", () => get("blocks", "/api/v1/methodology/blocks"));
  await step("api.search.value-pools", () => get("search-value-pools", "/api/v1/methodology/search?q=value%20pools"));
  await step("api.health-questions", () => get("health-check-questions", "/api/v1/health-check-questions"));
  await step("api.launch-template", () => get("launch-plan-template", "/api/v1/launch-plan-template"));
  await step("api.health-checks", () => get("health-checks", `/api/v1/transformations/${ROAMING}/health-checks`));
  await step("api.launch-plan", () => get("launch-plan", `/api/v1/transformations/${ROAMING}/launch-plan`));
  await step("api.report-definitions", () => get("report-definitions", "/api/v1/report-definitions"));
  await step("api.gates", () => get("gates", `/api/v1/transformations/${ROAMING}/gates`));
  await step("api.walkthrough", () => get("walkthrough", "/api/v1/demo/walkthrough"));
  await step("api.coverage", () => get("coverage", "/api/v1/admin/coverage"));
  await step("api.branding", () => get("branding", "/api/v1/branding"));
  await step("api.day-90-test", async () => {
    const r = await tl.req.get(`/api/v1/transformations/${ROAMING}/day-90-test`);
    save(`api/${lang}/day-90-test.json`, { status: r.status(), body: await r.text() });
    return `status ${r.status()}`;
  });
  await step("api.methodology", () => get("methodology", `/api/v1/transformations/${ROAMING}/methodology`));

  // ---------------------------------------------------------------- exports from the demo transformation (worker)
  const worker = await startProductionWorker();
  try {
    const gates = (await tl.call<Body>("GET", `/api/v1/transformations/${ROAMING}/gates`)) as Body;
    const gateItems: Body[] = Array.isArray(gates) ? gates : (gates.items ?? gates.data ?? []);
    const g1 = gateItems.map((g) => g.gate ?? g).find((g) => (g.gateCode ?? g.code) === "G1");
    const jobs: { name: string; def: string; body: Body; formats: string[] }[] = [
      { name: "charter", def: "charter", body: {}, formats: ["pdf", "docx"] },
      { name: "roadmap", def: "roadmap", body: {}, formats: ["pptx", "xlsx"] },
      { name: "benefits", def: "registers", body: { parameters: { register: "benefits" } }, formats: ["pdf", "xlsx", "csv"] },
      ...(g1 ? [{ name: "gate-pack-G1", def: "gate_pack", body: { subjectId: g1.id }, formats: ["pptx", "pdf", "docx"] }] : []),
      { name: "tom", def: "tom", body: {}, formats: ["docx"] },
    ];
    for (const j of jobs) {
      await step(`export.${j.name}`, async () => {
        const snap = await tl.call<Body>("POST", `/api/v1/transformations/${ROAMING}/reports/${j.def}/generate`, j.body, {
          expect: 201,
        });
        save(`exports/${lang}/${j.name}.snapshot.json`, snap);
        const done: string[] = [];
        for (const format of j.formats) {
          const job = await tl.call<Body>("POST", "/api/v1/exports", { snapshotId: snap.id, format, language: lang }, {
            expect: 202,
          });
          let st: Body = null;
          const until = Date.now() + 180_000;
          while (Date.now() < until) {
            st = await tl.call<Body>("GET", `/api/v1/exports/${job.id}`);
            if (["succeeded", "failed", "cancelled"].includes(st.status)) break;
            await new Promise((r) => setTimeout(r, 1000));
          }
          if (st?.status !== "succeeded") throw new Error(`${format}: ${JSON.stringify(st)} ${worker.output().slice(-800)}`);
          const res = await tl.req.get(`/api/v1/exports/${job.id}/download`);
          save(`exports/${lang}/${j.name}.${format}`, new Uint8Array(await res.body()));
          done.push(format);
        }
        return done.join(",");
      });
    }
  } finally {
    await worker.stop();
  }

  // ---------------------------------------------------------------- rendered screens (EN and AR), demo users
  const p = await demoPage(browser, lang, "tl");
  const T = `/transformations/${ROAMING}`;
  const screens: [string, string][] = [
    ["my-work", "/my-work"],
    ["playbook", "/playbook"],
    ["reader", "/playbook/reader"],
    ["reader-B0004", "/playbook/reader/B0004"],
    ["reader-B0016", "/playbook/reader/B0016"],
    ["reader-B0124", "/playbook/reader/B0124"],
    ["reader-B0031", "/playbook/reader/B0031"],
    ["reader-B0158", "/playbook/reader/B0158"],
    ["about", "/about"],
    ["roaming", T],
    ["charter", `${T}/charter`],
    ["traceability", `${T}/traceability`],
    ["gates", `${T}/gates`],
    ["gate-G1", `${T}/gates/G1`],
    ["gate-G2", `${T}/gates/G2`],
    ["health-check", `${T}/health-check`],
    ["launch-plan", `${T}/launch-plan`],
    ["day-90-test", `${T}/day-90-test`],
    ["benefits", `${T}/benefits`],
    ["reports", `${T}/reports`],
    ["playbook-health-check", "/playbook/health-check"],
    ["playbook-launch-plan", "/playbook/launch-plan"],
    ["walkthrough", `/walkthrough?transformationId=${ROAMING}`],
    ["diagnose", `${T}/diagnose`],
  ];
  for (const [name, url] of screens) await step(`ui.tl.${name}`, () => capture(p, lang, `tl-${name}`, url));
  await p.context().close();
  const bo = await demoPage(browser, lang, "bo");
  await step("ui.bo.approvals", () => capture(bo, lang, "bo-approvals", "/my-work/approvals"));
  await bo.context().close();
  const fin = await demoPage(browser, lang, "fin");
  await step("ui.fin.finance-validation", () => capture(fin, lang, "fin-finance-validation", "/finance-validation"));
  await fin.context().close();
  await tl.req.dispose();
  save(`results-${lang}.json`, results);
  // The probe passes only if every step ran; the details are judged in analyse.mjs and the review record.
  expect(results.filter((r) => !r.ok)).toEqual([]);
});
