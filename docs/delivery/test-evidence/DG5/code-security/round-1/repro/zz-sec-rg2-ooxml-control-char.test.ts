// code-security-reviewer DG5 corrected re-gate round 1 (T-DG5-RG2-SEC-R1): end-to-end reproduction of a DOCX / PPTX
// export that is not well-formed XML 1.0 when accepted user text contains a C0 control character.
// Disposable probe: copied into the disposable clone as tests/qa/integration/zz-sec-rg2-ooxml-control-char.test.ts and
// run there with tests/qa/support/with-pg.sh; never part of the candidate.
//
// Steps (the REAL API and the REAL worker export runner on a migrated, demo-seeded scratch database; synthetic data):
//  1. a user with TO + TL renames the demo transformation through PATCH /transformations/{id} to a name that contains
//     U+000B (the character Word puts on the clipboard for a manual line break): the API accepts it (only U+0000 and
//     lone surrogates are refused, packages/shared/src/schemas/common.ts:94);
//  2. the charter (DOCX) and the roadmap (PPTX) are generated and exported; the worker reports the jobs `succeeded`
//     and the download is 200;
//  3. the downloaded parts are checked against the XML 1.0 Char production (§2.2): a raw U+0000-U+0008, U+000B,
//     U+000C, U+000E-U+001F makes the part not well-formed, so Word / PowerPoint refuse the file or offer a repair.
// The XLSX of the same name is checked for comparison (xlsx/sheet.ts xmlText replaces such characters with U+FFFD).
import { readOoxml } from "../../../packages/reporting/src/ooxml-read.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo } from "../../../packages/db/src/index.ts";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../support/api.ts";
import { exportFile } from "../support/a15.ts";

type Body = any;
const ORG = DEMO_ANCHORS.organizationId;
const T_ID = DEMO_ANCHORS.transformationId;
const T = `/api/v1/transformations/${T_ID}`;
const NAME = "International Roaming\u000Bprogramme (pasted)";
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

let api: TestApi;
let scratch: string | null = null;
let s: Session;

async function forbiddenParts(bytes: Uint8Array): Promise<string[]> {
  const { parts } = await readOoxml(bytes, /\.xml$/);
  const out: string[] = [];
  for (const [name, xml] of parts) {
    const i = xml.search(FORBIDDEN);
    if (i >= 0)
      out.push(`${name}: U+${xml.charCodeAt(i).toString(16).padStart(4, "0")} in ${JSON.stringify(xml.slice(Math.max(0, i - 40), i + 20))}`);
  }
  return out;
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_sec_rg2_ooxml");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const u = await createUser(api.db, ORG);
  for (const role of ["TO", "TL"]) await grant(api.db, DEMO_ANCHORS.users.sp, u.id, role, { type: "organization", id: ORG }, ORG);
  s = await signIn(api.app, u.subject);
}, 300_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("C0 control character in accepted user text -> DOCX / PPTX export", () => {
  it("the API accepts the name; the worker reports success; the DOCX and PPTX parts are not well-formed XML 1.0", async () => {
    const t = await call<Body>(api.app, "GET", T, { session: s });
    expect(t.status).toBe(200);
    const patch = await call<Body>(api.app, "PATCH", T, {
      session: s,
      body: { name: NAME },
      headers: { "if-match": `"${t.body.version}"` },
    });
    console.info(`REPRO rename status ${patch.status}; stored name ${JSON.stringify(patch.body?.name)}`);
    expect(patch.status).toBe(200);

    const results: Record<string, string> = {};
    for (const [code, format] of [
      ["charter", "docx"],
      ["roadmap", "pptx"],
      ["roadmap", "xlsx"],
    ] as const) {
      const snap = await call<Body>(api.app, "POST", `${T}/reports/${code}/generate`, { session: s, body: {} });
      expect(snap.status, `${code}: ${JSON.stringify(snap.body).slice(0, 200)}`).toBe(201);
      const out = await exportFile(api, s, { snapshotId: snap.body.id, format, language: "en" });
      const bad = await forbiddenParts(out.bytes);
      results[`${code}.${format}`] =
        `job ${out.job.status}, ${out.bytes.byteLength} bytes, not-well-formed parts: ${bad.length === 0 ? "none" : bad.join(" | ")}`;
    }
    console.info(`REPRO results: ${JSON.stringify(results, null, 1)}`);
    // The defect: these two expectations FAIL on the candidate (the parts contain a raw U+000B).
    expect(results["charter.docx"]).toMatch(/not-well-formed parts: none$/);
    expect(results["roadmap.pptx"]).toMatch(/not-well-formed parts: none$/);
  }, 300_000);
});
