// release-auditor DG6 round 4 (T-DG6-AUDIT-RG-R4): do product API responses serve text that names an engineering
// delivery gate (DG0-DG7)? NOT part of the candidate: copied into a disposable clone at
// apps/api/test/integration/assistant/ (to reuse its world fixture) and run with
// `npx vitest run --project integration <file>`. Read-only GETs as the world's administrator on a freshly migrated
// production-initialized database (migrations 0001-0129). All data is SYNTHETIC. Nothing approves anything.
//
// The pattern excludes finding/task ids (F-DGx-..., T-DGx-...), which are not gate names.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../../support/harness.ts";
import { startAssistantWorld, type AssistantWorld, type Body } from "./be-u-fixtures.ts";

const DG = /(?<![FT]-)\bDG[0-7]\b/;
let a: AssistantWorld;

function hits(value: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof value === "string") {
    if (DG.test(value)) out.push({ path, text: value });
  } else if (Array.isArray(value)) value.forEach((v, i) => hits(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) hits(v, `${path}.${k}`, out);
}

beforeAll(async () => {
  a = await startAssistantWorld("mth_aud_r4_dg", { x: "Labelia", y: "Otherlabia" });
}, 240_000);

afterAll(async () => {
  await a?.close();
});

describe("AUD-R4: engineering gate names in served product text", () => {
  it("lists every served string naming DG0-DG7 on the admin and procedure read endpoints", async () => {
    const found: { path: string; text: string }[] = [];
    const get = async (url: string): Promise<Body> => {
      const r = await call<Body>(a.api.app, "GET", url, { session: a.admin });
      console.log(`[AUD-R4 dg] GET ${url} -> ${r.status}`);
      return r.status === 200 ? r.body : null;
    };
    const lists = [
      "/api/v1/admin/job-schedules",
      "/api/v1/admin/jobs",
      "/api/v1/admin/service-identities",
      "/api/v1/admin/automation-rules",
      "/api/v1/procedure-definitions",
    ];
    for (const url of lists) {
      const body = await get(url);
      hits(body, url, found);
      const items: Body[] = Array.isArray(body?.items) ? body.items : [];
      if (url === "/api/v1/procedure-definitions")
        for (const d of items) hits(await get(`/api/v1/procedure-definitions/${d.id}`), `getProcedureDefinition(${d.code ?? d.id})`, found);
      if (url === "/api/v1/admin/automation-rules")
        for (const r of items) hits(await get(`/api/v1/admin/automation-rules/${r.id}/versions`), `listAutomationRuleVersions(${r.code ?? r.id})`, found);
    }
    console.log(`[AUD-R4 dg] served strings naming DG0-DG7: ${found.length}`);
    for (const f of found) console.log(`[AUD-R4 dg] ${f.path}: ${JSON.stringify(f.text)}`);
    // Characterisation probe: the expectation states the product rule (REQ-S21-001 / M0007); it FAILS if any hit.
    expect.soft(found.length, "served product strings naming an engineering delivery gate").toBe(0);
  });
});
