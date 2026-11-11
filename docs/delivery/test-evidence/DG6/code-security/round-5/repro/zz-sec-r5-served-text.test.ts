// Code-security reviewer, DG6 clean re-gate round 5 (T-DG6-REV-CS-RG-R5): F-DG6-990 served-text probe, NOT product
// code. Copy to apps/api/test/integration/assistant/ in a DISPOSABLE clone (it reuses be-u-fixtures' world) and run
//   npx vitest run --project integration apps/api/test/integration/assistant/zz-sec-r5-served-text.test.ts
//
// Extends the round-4 audit probe (zz-aud-r4-served-dg-labels.test.ts): the same five read endpoints, PLUS the service
// identities list WITH its required organizationId (the audit's bare call answered 400) and every identity's detail,
// and getProcedureDefinition by CODE (the audit probe called it by id: 400, silently skipped) for the current version
// and for both seeded configuration versions (0069 v1 superseded, 0095 v2 published; 0130 rewrote both).
// Each served string is tested with the product rule itself (`mentionsEngineeringGate`, the 0089 mirror), with the
// audit's regex, and (observation only) for internal engineering references (D-nnn, ADR-nnnn).
// Read-only GETs as the world's administrator on a freshly migrated production-initialized database. SYNTHETIC data.
// Nothing here approves anything (G1-G6) or touches DG0-DG7.
import { mentionsEngineeringGate } from "@mth/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../../support/harness.ts";
import { startAssistantWorld, type AssistantWorld, type Body } from "./be-u-fixtures.ts";

const AUDIT_DG = /(?<![FT]-)\bDG[0-7]\b/;
const INTERNAL_REFERENCE = /(?<![A-Za-z0-9_])(?:D-\d{3}|ADR-\d{4})(?![0-9])/;
let a: AssistantWorld;

interface Hit {
  path: string;
  text: string;
}
function walk(value: unknown, path: string, out: { strings: number; gate: Hit[]; audit: Hit[]; refs: Hit[] }): void {
  if (typeof value === "string") {
    out.strings += 1;
    if (mentionsEngineeringGate(value)) out.gate.push({ path, text: value });
    if (AUDIT_DG.test(value)) out.audit.push({ path, text: value });
    if (INTERNAL_REFERENCE.test(value)) out.refs.push({ path, text: value });
  } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, `${path}.${k}`, out);
}

beforeAll(async () => {
  a = await startAssistantWorld("mth_sec_r5_txt", { x: "Labelia", y: "Otherlabia" });
}, 240_000);

afterAll(async () => {
  await a?.close();
});

describe("SEC-R5: engineering gate names in served product text (F-DG6-990)", () => {
  it("no served string on the job, service identity, automation and procedure read endpoints names DG0-DG7", async () => {
    const out = { strings: 0, gate: [] as Hit[], audit: [] as Hit[], refs: [] as Hit[] };
    const statuses: string[] = [];
    const get = async (url: string): Promise<Body> => {
      const r = await call<Body>(a.api.app, "GET", url, { session: a.admin });
      statuses.push(`${url} -> ${r.status}`);
      return r.status === 200 ? r.body : null;
    };
    const org = a.w.orgA.id;
    const lists = [
      "/api/v1/admin/job-schedules",
      "/api/v1/admin/jobs",
      `/api/v1/admin/service-identities?organizationId=${org}&limit=100`,
      `/api/v1/admin/service-identities?organizationId=${org}&subjectKind=job&limit=100`,
      "/api/v1/admin/automation-rules",
      "/api/v1/procedure-definitions",
    ];
    for (const url of lists) {
      const body = await get(url);
      walk(body, url, out);
      const items: Body[] = Array.isArray(body?.items) ? body.items : [];
      if (url.startsWith("/api/v1/procedure-definitions"))
        for (const d of items)
          for (const cv of ["", "?versionId=01920005-0300-7000-8000-000000000001", "?versionId=01920005-0300-7000-8000-000000000002"])
            walk(await get(`/api/v1/procedure-definitions/${d.code}${cv}`), `getProcedureDefinition(${d.code}${cv})`, out);
      if (url.startsWith("/api/v1/admin/automation-rules"))
        for (const r of items) walk(await get(`/api/v1/admin/automation-rules/${r.id}/versions`), `versions(${r.code})`, out);
      if (url.includes("service-identities?") && !url.includes("subjectKind"))
        for (const s of items) walk(await get(`/api/v1/admin/service-identities/${s.id}`), `getServiceIdentity(${s.code})`, out);
    }
    for (const s of statuses) console.log(`[SEC-R5 txt] GET ${s}`);
    console.log(`[SEC-R5 txt] strings examined: ${out.strings}`);
    console.log(`[SEC-R5 txt] engineering-gate rule hits: ${out.gate.length}; audit-regex hits: ${out.audit.length}`);
    for (const h of [...out.gate, ...out.audit]) console.log(`[SEC-R5 txt] GATE ${h.path}: ${JSON.stringify(h.text)}`);
    console.log(`[SEC-R5 txt] internal-reference (observation) hits: ${out.refs.length}`);
    for (const h of out.refs) console.log(`[SEC-R5 txt] REF ${h.path}: ${JSON.stringify(h.text)}`);
    expect(statuses.filter((s) => !s.endsWith("-> 200"))).toEqual([]);
    expect(out.strings).toBeGreaterThan(500);
    expect(out.gate).toEqual([]);
    expect(out.audit).toEqual([]);
  });
});
