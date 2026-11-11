// domain-reviewer DG6 round 5 (T-DG6-REV-DOM-RG-R5): F-DG6-990 re-verification, extended past the round-4 audit probe.
// NOT part of the candidate: copied into a disposable clone at apps/api/test/integration/assistant/ (to reuse its
// world fixture) and run with `npx vitest run --configLoader runner --project integration <file>`.
// Read-only GETs on a freshly migrated, production-initialized database (migrations 0001 -> latest). All data SYNTHETIC.
// Nothing approves anything.
//
// It differs from the auditor's probe (zz-aud-r4-served-dg-labels) in four ways:
//   1. service identities are read WITH the required organizationId (the audit's bare call got 400), list and detail;
//   2. procedure definitions are read by CODE (the audit's detail call by id got 400) in BOTH seeded procedures
//      configuration versions (v1 superseded, v2 published), list and detail;
//   3. the audit trail (/api/v1/audit-events) is read as AUD and as the administrator, every page, so the D-239 history
//      texts are measured where a product user would actually see them;
//   4. three patterns are counted: GATE (DG0-DG7 as a word, F-/T- ids excluded, the audit's rule), ANY (any DG0-DG7
//      token, including task ids such as T-DG5-ARCH-02) and REF (an internal decision or ADR id).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../../support/harness.ts";
import { startAssistantWorld, type AssistantWorld, type Body } from "./be-u-fixtures.ts";

const GATE = /(?<![FT]-)\bDG[0-7]\b/;
const ANY = /DG[0-7]/;
const REF = /(?<![A-Za-z0-9_])(?:D-\d{3}|ADR-\d{4})(?![0-9])/;
const PROCEDURE_VERSIONS = ["01920005-0300-7000-8000-000000000001", "01920005-0300-7000-8000-000000000002"];
let a: AssistantWorld;

type Hit = { path: string; text: string };
function walk(value: unknown, path: string, re: RegExp, out: Hit[]): void {
  if (typeof value === "string") {
    if (re.test(value)) out.push({ path, text: value });
  } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, re, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, `${path}.${k}`, re, out);
}

beforeAll(async () => {
  a = await startAssistantWorld("mth_dom_r5_dg", { x: "Labelia", y: "Otherlabia" });
}, 240_000);

afterAll(async () => {
  await a?.close();
});

describe("DOM-R5: engineering gate names in served product text", () => {
  it("configuration endpoints serve no DG0-DG7 name and no internal decision/ADR id", async () => {
    const org = a.w.orgA.id;
    const gate: Hit[] = [];
    const any: Hit[] = [];
    const ref: Hit[] = [];
    const get = async (url: string): Promise<Body> => {
      const r = await call<Body>(a.api.app, "GET", url, { session: a.admin });
      console.log(`[DOM-R5 dg] GET ${url} -> ${r.status}`);
      expect(r.status, url).toBe(200);
      return r.body;
    };
    const scanBody = (body: Body, label: string) => {
      walk(body, label, GATE, gate);
      walk(body, label, ANY, any);
      walk(body, label, REF, ref);
    };
    const counts: Record<string, number> = {};
    const lists = [
      "/api/v1/admin/job-schedules?limit=100",
      "/api/v1/admin/jobs", // no query parameters (listJobOperations)
      `/api/v1/admin/service-identities?organizationId=${org}&limit=100`,
      "/api/v1/admin/automation-rules?limit=100",
      ...PROCEDURE_VERSIONS.map((v) => `/api/v1/procedure-definitions?limit=100&versionId=${v}`),
    ];
    for (const url of lists) {
      const body = await get(url);
      scanBody(body, url);
      const items: Body[] = Array.isArray(body?.items) ? body.items : [];
      counts[url] = items.length;
      if (url.startsWith("/api/v1/admin/service-identities"))
        for (const s of items)
          scanBody(await get(`/api/v1/admin/service-identities/${s.id}`), `getServiceIdentity(${s.code ?? s.id})`);
      if (url.startsWith("/api/v1/procedure-definitions")) {
        const v = new URL(url, "http://x").searchParams.get("versionId");
        for (const d of items) scanBody(await get(`/api/v1/procedure-definitions/${d.code}?versionId=${v}`), `getProcedureDefinition(${d.code}@${v})`);
      }
      if (url.startsWith("/api/v1/admin/automation-rules"))
        for (const r of items) scanBody(await get(`/api/v1/admin/automation-rules/${r.id}/versions`), `listAutomationRuleVersions(${r.code ?? r.id})`);
    }
    console.log(`[DOM-R5 dg] items per list: ${JSON.stringify(counts)}`);
    console.log(`[DOM-R5 dg] config GATE hits: ${gate.length}; ANY DG token: ${any.length}; decision/ADR ids: ${ref.length}`);
    for (const h of [...gate, ...any, ...ref]) console.log(`[DOM-R5 dg] config ${h.path}: ${JSON.stringify(h.text)}`);
    for (const n of Object.values(counts)) expect(n).toBeGreaterThan(0);
    expect.soft(gate, "served configuration strings naming an engineering delivery gate").toEqual([]);
    expect.soft(any, "served configuration strings holding any DG0-DG7 token").toEqual([]);
    expect.soft(ref, "served configuration strings citing an internal decision/ADR id").toEqual([]);
  });

  it("the audit trail: what an AUD reader sees (D-239's history texts are measured, not asserted away)", async () => {
    const org = a.w.orgA.id;
    for (const [who, session] of [["AUD", a.auditor], ["ADM", a.admin]] as const) {
      const gate: Hit[] = [];
      const any: Hit[] = [];
      let cursor: string | undefined;
      let n = 0;
      for (let page = 0; page < 400; page++) {
        const url = `/api/v1/audit-events?organizationId=${org}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const r = await call<Body>(a.api.app, "GET", url, { session });
        expect(r.status, url).toBe(200);
        const items: Body[] = r.body.items ?? [];
        n += items.length;
        walk(items, `audit[${who}]`, GATE, gate);
        walk(items, `audit[${who}]`, ANY, any);
        cursor = r.body.nextCursor ?? r.body.next_cursor ?? undefined;
        if (!cursor) break;
      }
      const distinct = (hs: Hit[]) => [...new Set(hs.map((h) => h.text))];
      console.log(`[DOM-R5 dg] audit as ${who}: ${n} events; GATE hits ${gate.length}; ANY DG token hits ${any.length}`);
      for (const t of distinct(gate)) console.log(`[DOM-R5 dg] audit ${who} GATE distinct: ${JSON.stringify(t).slice(0, 300)}`);
      for (const t of distinct(any)) console.log(`[DOM-R5 dg] audit ${who} ANY distinct: ${JSON.stringify(t).slice(0, 300)}`);
    }
  });
});
