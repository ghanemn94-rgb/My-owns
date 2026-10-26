// code-security-reviewer DG5 corrected re-gate round 2 (T-DG5-RG2-SEC-R2): end-to-end re-verification of F-DG5-100.
// Disposable probe: copied into the disposable clone as tests/qa/integration/zz-sec-rg2r2-ooxml-control-char.test.ts
// and run there with tests/qa/support/with-pg.sh; never part of the candidate.
//
// The REAL API and the REAL worker export runner (apps/worker/src/reports/export-runner.ts, via tests/qa/support/a15.ts
// runWorker) on a migrated, demo-seeded scratch database (synthetic data):
//  1. a TO + TL user renames the demo transformation to a name holding U+000B, U+0001 and U+001F (the API accepts it)
//     and records a RAID risk whose description holds U+000C and U+0008;
//  2. charter, roadmap and the RAID register are generated and exported as DOCX, PPTX and XLSX in en and ar (a format a
//     definition does not offer is recorded as n/a; each format must be exported in each language at least once);
//  3. each job's outcome is recorded (not asserted by a helper), and every XML part of each succeeded download is checked
//     against the XML 1.0 Char production by an INDEPENDENT scanner (raw characters and numeric references, parsed),
//     and by the candidate's own strict checker (ooxml-read.ts malformedParts) for comparison;
//  4. the stored transformation name still holds U+000B (ADR-0046 amendment D-191: stored text is not changed).
// Expected on the fixed candidate: every job succeeded, every part well-formed, U+FFFD in place of each character.
import { readOoxml, malformedParts } from "../../../packages/reporting/src/ooxml-read.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo } from "../../../packages/db/src/index.ts";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../support/api.ts";
import { runWorker } from "../support/a15.ts";

type Body = any;
const ORG = DEMO_ANCHORS.organizationId;
const T_ID = DEMO_ANCHORS.transformationId;
const T = `/api/v1/transformations/${T_ID}`;
const NAME = "International Roaming\u000Bprogramme\u0001(pasted)\u001F";
const RISK = "Supplier\u000Cdelay\u0008risk (pasted)";

let api: TestApi;
let scratch: string | null = null;
let s: Session;
let userId: string;

const okCp = (cp: number) =>
  cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
function problems(xml: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < xml.length; i++) {
    const c = xml.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < xml.length) {
      const d = xml.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        i++;
        continue;
      }
    }
    if (!okCp(c)) out.push(`raw U+${c.toString(16).toUpperCase().padStart(4, "0")} near ${JSON.stringify(xml.slice(Math.max(0, i - 30), i + 10))}`);
  }
  for (const m of xml.matchAll(/&#(x[0-9a-fA-F]+|[0-9]+);/g)) {
    const cp = m[1]!.startsWith("x") ? parseInt(m[1]!.slice(1), 16) : parseInt(m[1]!, 10);
    if (!okCp(cp)) out.push(`reference ${m[0]}`);
  }
  return out;
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_sec_rg2r2_ooxml");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), { mthEnv: "demo", runKind: "seed", requestedVia: "cli", requestedBy: null });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const u = await createUser(api.db, ORG);
  userId = u.id;
  for (const role of ["TO", "TL"]) await grant(api.db, DEMO_ANCHORS.users.sp, u.id, role, { type: "organization", id: ORG }, ORG);
  s = await signIn(api.app, u.subject);
}, 300_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("F-DG5-100 re-verification: C0 characters in accepted user text -> DOCX / PPTX / XLSX exports", () => {
  it("every job succeeds and every XML part is well-formed XML 1.0 (U+FFFD in place); stored text unchanged", async () => {
    const t = await call<Body>(api.app, "GET", T, { session: s });
    expect(t.status).toBe(200);
    const patch = await call<Body>(api.app, "PATCH", T, { session: s, body: { name: NAME }, headers: { "if-match": `"${t.body.version}"` } });
    console.info(`REPRO rename status ${patch.status}; stored name ${JSON.stringify(patch.body?.name)}`);
    expect(patch.status).toBe(200);
    const risk = await call<Body>(api.app, "POST", `${T}/raid`, {
      session: s,
      body: { type: "risk", description: RISK, impact: "medium", probability: "low", ownerUserId: userId },
    });
    console.info(`REPRO raid status ${risk.status}; stored description ${JSON.stringify(risk.body?.description)}`);
    expect(risk.status).toBe(201);

    const results: Record<string, string> = {};
    let bad = 0;
    for (const [code, body] of [
      ["charter", {}],
      ["roadmap", {}],
      ["registers", { parameters: { register: "raid" } }],
    ] as const) {
      const snap = await call<Body>(api.app, "POST", `${T}/reports/${code}/generate`, { session: s, body });
      expect(snap.status, `${code}: ${JSON.stringify(snap.body).slice(0, 300)}`).toBe(201);
      for (const format of ["docx", "pptx", "xlsx"] as const) {
        for (const language of ["en", "ar"] as const) {
          const key = `${code}.${format}.${language}`;
          const created = await call<Body>(api.app, "POST", "/api/v1/exports", { session: s, body: { snapshotId: snap.body.id, format, language } });
          // A definition offers only some formats (the charter has no PPTX): 422 export.format_not_offered is recorded, not exported.
          if (created.status === 422 && created.body?.code === "export.format_not_offered") {
            results[key] = "n/a (422 export.format_not_offered)";
            continue;
          }
          expect(created.status, `${key} create ${JSON.stringify(created.body).slice(0, 300)}`).toBe(202);
          const outcome = await runWorker(api, created.body.id);
          const job = (await call<Body>(api.app, "GET", `/api/v1/exports/${created.body.id}`, { session: s })).body;
          const dl = await call<Body>(api.app, "GET", `/api/v1/exports/${created.body.id}/download`, { session: s });
          if (outcome.outcome !== "succeeded" || dl.status !== 200) {
            bad += 1;
            results[key] = `FAIL outcome ${JSON.stringify(outcome)}; job ${job.status} ${job.errorCode ?? ""}; download ${dl.status}`;
            continue;
          }
          const bytes = new Uint8Array(dl.raw.rawPayload);
          const { parts } = await readOoxml(bytes, /\.(?:xml|rels)$/);
          const own: string[] = [];
          let fffd = false;
          let named = false;
          for (const [name, xml] of parts) {
            for (const p of problems(xml)) own.push(`${name}: ${p}`);
            if (xml.includes("�")) fffd = true;
            if (xml.includes("International Roaming�programme�(pasted)")) named = true;
          }
          const theirs = await malformedParts(bytes);
          const pass = own.length === 0 && theirs.length === 0 && fffd && (code === "registers" || named);
          if (!pass) bad += 1;
          results[key] =
            `${pass ? "PASS" : "FAIL"} job ${job.status}, ${bytes.byteLength} bytes (= fileSizeBytes ${job.fileSizeBytes}), ` +
            `independent scan: ${own.length === 0 ? "none" : own.slice(0, 3).join(" | ")}; malformedParts: ${theirs.length === 0 ? "none" : theirs.slice(0, 3).join(" | ")}; ` +
            `U+FFFD present: ${fffd}; name with U+FFFD: ${named}`;
        }
      }
    }
    console.info(`REPRO results: ${JSON.stringify(results, null, 1)}`);
    const after = await call<Body>(api.app, "GET", T, { session: s });
    console.info(`REPRO stored name after exports ${JSON.stringify(after.body.name)}`);
    expect(after.body.name).toBe(NAME);
    expect(bad, JSON.stringify(results, null, 1)).toBe(0);
    expect(Object.keys(results)).toHaveLength(18);
    // Each OOXML format was actually exported (and checked) in both languages at least once.
    for (const format of ["docx", "pptx", "xlsx"])
      for (const language of ["en", "ar"])
        expect(
          Object.entries(results).filter(([k, v]) => k.endsWith(`.${format}.${language}`) && v.startsWith("PASS")).length,
          `${format}.${language} exported`,
        ).toBeGreaterThan(0);
  }, 600_000);
});
