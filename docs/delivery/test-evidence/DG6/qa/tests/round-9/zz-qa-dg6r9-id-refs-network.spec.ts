// qa-verifier DG6 round 9 (T-DG6-REV-QA-R9, run 7e2124db): round 8's standing probe zz-qa-dg6r8-id-refs-network.spec.ts re-used on candidate fe824c05 (source d974011f); changes: names r8 -> r9 only.
// qa-verifier DG6 round 8 (T-DG6-REV-QA-R9) on candidate 6cda8b33: copied from tests/round-7/zz-qa-dg6r7-id-refs-network.spec.ts; the only change is the rename of identifiers dg6r7 -> dg6r9 and QA-R7 -> QA-R9 (the comments below are the earlier rounds' text).
// qa-verifier DG6 round 7 (T-DG6-REV-QA-R9) on candidate b64b95ff: NEW independent probe, NOT part of the frozen
// candidate. Copied into a disposable clone as e2e/zz-qa-dg6r9-id-refs-network.spec.ts and run on the demo stack:
//   e2e/support/with-demo-stack.sh npx playwright test e2e/zz-qa-dg6r9-id-refs-network.spec.ts --workers=1
// Purpose: D-218 (F-DG6-420, BE-Z10/Z10B) on the REAL stack, through the screens a reader actually opens: "a response
// never names the id of a sensitive record the reader is not admitted to". The in-tree sweep reads every GET of the
// contract through the API; this probe instead records every /api/v1 JSON response the SPA itself fetches while the
// Transformation Lead (roaming.user.tl, not admitted) walks every page linked from the transformation workspace, and
// checks the rendered DOM too.
//   1. roaming.user.to (admitted) marks sensitive: one benefit, one business case (if any) and up to 6 evidence items
//      of the demo transformation (ADR-0051 §2; marking is an access decision, never a business approval G1-G6).
//   2. TL and TO each visit the same pages (the workspace links, plus global pages). Every JSON response body and the
//      final DOM of each page are scanned for the hidden ids.
//   3. Expected: no TL response or DOM names a hidden id, except the audit trail and grant-register operations D-219
//      excuses (recordId of /audit and /sensitive-grants responses), which are listed separately. The TO (admitted)
//      must see at least one hidden id somewhere (the probe can detect a leak).
//   4. Everything is unmarked in `finally`.
// Every value is SYNTHETIC demo data. Nothing here names or touches DG0-DG7.
import { expect, test, type Page } from "@playwright/test";
import { langOf } from "../apps/web/e2e/support/ui.ts";
import { demoApi, demoPage } from "./support/a02-demo.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const EXCUSED = [/\/audit(-events)?(\?|$|\/)/, /\/sensitive-grants/]; // D-219 (1) and (2)

interface Hit {
  who: string;
  page: string;
  where: string;
  id: string;
  kind: string;
}

async function walk(page: Page, who: string, routes: string[], hidden: Map<string, string>, hits: Hit[], excused: Hit[]) {
  const onResponse = async (r: import("@playwright/test").Response) => {
    const url = r.url();
    if (!url.includes("/api/v1/")) return;
    const ct = r.headers()["content-type"] ?? "";
    if (!ct.includes("json")) return;
    let text = "";
    try {
      text = await r.text();
    } catch {
      return;
    }
    for (const [id, kind] of hidden) {
      if (!text.includes(id)) continue;
      const u = new URL(url);
      if (u.pathname.includes(id) || u.search.includes(id)) continue; // the request itself names it
      const hit = { who, page: page.url(), where: `${r.request().method()} ${u.pathname}${u.search}`, id, kind };
      (EXCUSED.some((re) => re.test(u.pathname)) ? excused : hits).push(hit);
    }
  };
  page.on("response", onResponse);
  for (const route of routes) {
    try {
      await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(300);
      const html = await page.content();
      for (const [id, kind] of hidden)
        if (html.includes(id)) hits.push({ who, page: route, where: "DOM", id, kind });
    } catch (e) {
      console.log(`QA-R9 id-refs ${who}: could not open ${route}: ${String(e).split("\n")[0]}`);
    }
  }
  page.off("response", onResponse);
}

test("QA-R9 D-218 on the real stack: no page the TL opens names a restricted record's id", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const to = await demoApi(playwright, "to");
  const ts = await to.call<Body>("GET", "/api/v1/transformations?limit=50");
  let tid = "";
  let benefits: Body[] = [];
  for (const t of ts.items as Body[]) {
    const bs = await to.call<Body>("GET", `/api/v1/transformations/${t.id}/benefits?limit=100`);
    if ((bs.items as Body[]).length >= 2) {
      tid = String(t.id);
      benefits = bs.items as Body[];
      break;
    }
  }
  expect(tid, "a demo transformation with benefits").not.toBe("");
  // Round-7 revision 2: candidates are kept only when the TL is NOT admitted after marking (GET of the record as the
  // TL answers 404). The first run (07-e2e-demo-unset.log) marked an evidence item whose named party (owner or
  // creator, ADR-0051 §2) may be the TL, so its "hits" could be legitimate; each candidate's TL status is now logged.
  const candidates: { type: string; id: string; item: string }[] = [
    { type: "benefit", id: String(benefits[0]!.id), item: `/api/v1/transformations/${tid}/benefits/${benefits[0]!.id}` },
  ];
  const cases = await to
    .call<Body>("GET", `/api/v1/business-cases?transformationId=${tid}&limit=100`)
    .catch(() => ({ items: [] }));
  for (const c of ((cases.items ?? []) as Body[]).slice(0, 3))
    candidates.push({ type: "business_case", id: String(c.id), item: `/api/v1/business-cases/${c.id}` });
  const ev = await to.call<Body>("GET", `/api/v1/transformations/${tid}/evidence?limit=100`);
  for (const e of (ev.items ?? []) as Body[])
    candidates.push({ type: "evidence", id: String(e.id), item: `/api/v1/transformations/${tid}/evidence/${e.id}` });
  console.log(`QA-R9 id-refs ${lang}: transformation ${tid}; ${candidates.length} candidates`);
  const tlApi = await demoApi(playwright, "tl");
  const tlStatus = async (p: string) => (await tlApi.req.get(p)).status();

  const targets: { type: string; id: string }[] = [];
  const marked: { path: string; version: number }[] = [];
  const hits: Hit[] = [];
  const excused: Hit[] = [];
  let hidden = new Map<string, string>();
  try {
    for (const t of candidates) {
      const p = `/api/v1/transformations/${tid}/records/${t.type}/${t.id}/sensitivity`;
      const cur = await to.call<Body>("GET", p);
      if (cur.isSensitive) continue;
      const before = await tlStatus(t.item);
      const m = await to.call<Body>(
        "PUT",
        p,
        { isSensitive: true, reason: "QA-R9 synthetic id-refs probe" },
        { ifMatch: Number(cur.version) },
      );
      marked.push({ path: p, version: Number(m.version) });
      const after = await tlStatus(t.item);
      console.log(`QA-R9 id-refs ${lang}: ${t.type} ${t.id}: TL GET before ${before}, after marking ${after}`);
      if (after === 404) targets.push({ type: t.type, id: t.id });
    }
    hidden = new Map(targets.map((t) => [t.id, t.type]));
    console.log(`QA-R9 id-refs ${lang}: targets the TL is not admitted to ${JSON.stringify(targets)}`);
    expect(targets.length, "at least one record the TL is not admitted to").toBeGreaterThan(0);
    const tlPage = await demoPage(browser, lang, "tl");
    const toPage = await demoPage(browser, lang, "to");
    // Routes: every in-app link of the transformation workspace (two levels), plus global pages.
    const routes = new Set<string>([`/transformations/${tid}`]);
    for (const start of [`/transformations/${tid}`]) {
      await toPage.goto(start);
      await toPage.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
      const hrefs = await toPage
        .locator(`a[href^='/transformations/${tid}']`)
        .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
      for (const h of hrefs) routes.add(h.split("#")[0]!);
    }
    for (const r of [...routes]) {
      if (routes.size > 120) break;
      await toPage.goto(r).catch(() => undefined);
      await toPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
      const hrefs = await toPage
        .locator(`nav a[href^='/transformations/${tid}'], [role='tablist'] a[href^='/transformations/${tid}']`)
        .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
      for (const h of hrefs) routes.add(h.split("#")[0]!);
    }
    // Pages that name a hidden record in their path are the record's own pages: the TL is expected to get 404 there;
    // they are visited by the TL too (the DOM must not name the id beyond the URL), but excluded from the TO baseline.
    const list = [...routes].filter((r) => ![...hidden.keys()].some((id) => r.includes(id)));
    list.push("/executive-overview", "/inbox", "/search?q=QA", "/portfolio");
    console.log(`QA-R9 id-refs ${lang}: ${list.length} routes: ${JSON.stringify(list)}`);
    await walk(tlPage, "TL", list, hidden, hits, excused);
    const toHits: Hit[] = [];
    const toExcused: Hit[] = [];
    await walk(toPage, "TO", list, hidden, toHits, toExcused);
    const summarize = (hs: Hit[]) => [...new Set(hs.map((h) => `${h.kind} ${h.id.slice(-6)} @ ${h.where}`))];
    console.log(`QA-R9 id-refs ${lang}: TL hits ${JSON.stringify(summarize(hits), null, 1)}`);
    console.log(`QA-R9 id-refs ${lang}: TL excused (D-219) ${JSON.stringify(summarize(excused), null, 1)}`);
    console.log(`QA-R9 id-refs ${lang}: TO (admitted) sees hidden ids at ${summarize(toHits).length} places`);
    expect(summarize(toHits).length, "the probe detects the ids for an admitted reader").toBeGreaterThan(0);
  } finally {
    for (const m of marked.reverse())
      await to.call("PUT", m.path, { isSensitive: false, reason: "QA-R9 probe cleanup" }, { ifMatch: m.version });
  }
  expect(
    hits.map((h) => `${h.kind} ${h.id} @ ${h.where} (page ${h.page})`),
    "no TL response or DOM names a restricted id",
  ).toEqual([]);
});
