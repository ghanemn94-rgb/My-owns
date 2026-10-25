// F-DG5-100 (code-security round 1; REQ-S13-005; ADR-0046 §3): a C0 control character in accepted user text never makes
// an export a corrupt OOXML package. Against the run's disposable PostgreSQL, through the API and the worker's export
// runner (apps/worker reports.export), as the reviewer's reproduction did:
//  1. the API accepts a transformation name and a RAID description holding U+000B (Word's manual line break on the
//     clipboard) and U+0001 (only U+0000 and lone surrogates are refused at input);
//  2. the charter (DOCX), the roadmap (PPTX, XLSX) and the RAID register (XLSX) are generated and exported, in en and
//     ar; each job succeeds (the formats each output offers, migration 0080);
//  3. every XML part of each downloaded package is well-formed XML 1.0 (parsed by the strict checker of
//     packages/reporting/src/ooxml-read.ts), and the user text is kept with U+FFFD in place of each forbidden character.
// A package that still held such a character would be a RenderError (export.render_failed, nothing stored): see
// xml-chars.test.ts and exports.test.ts. All data is SYNTHETIC; an export approves nothing (DG0-DG7 untouched).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { malformedParts, readOoxml } from "../../../../../packages/reporting/src/ooxml-read.ts";
import { FilesystemExportStore } from "../../../../../packages/reporting/src/storage.ts";
import { runExport } from "../../../../worker/src/reports/export-runner.ts";
import { call, seedWorld, startApi, testEvidenceDir, type TestApi, type World } from "../../support/harness.ts";
import { setupP2World, type P2World } from "../../support/p2-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
const NAME = "International Roaming\u000Bprogramme (pasted)";
const DESC = "Supplier\u0001delay\u000B(pasted)";
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};

/** Requests one export and delivers it once to the worker's handler; returns the job and the downloaded bytes. */
async function exportFile(snapshotId: string, format: "docx" | "pptx" | "xlsx", language: "en" | "ar") {
  const job = ok(
    await call<Body>(api.app, "POST", "/api/v1/exports", {
      session: p.lead.session,
      body: { snapshotId, format, language },
    }),
    202,
    "requestExport",
  );
  const row = await api.db
    .selectFrom("outbox_event")
    .selectAll()
    .where("idempotency_key", "=", `export_job.requested:${job.id}`)
    .executeTakeFirstOrThrow();
  const outcome = await runExport(
    api.db,
    {
      outboxEventId: row.id,
      eventType: row.event_type,
      schemaVersion: row.schema_version,
      idempotencyKey: row.idempotency_key,
      organizationId: row.organization_id,
      payload: row.payload,
    },
    row.id,
    { retryCount: 0, retryLimit: 5 },
    { store: new FilesystemExportStore(testEvidenceDir()) },
  );
  const after = ok(
    await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session: p.lead.session }),
    200,
    "getExport",
  );
  const file = await call(api.app, "GET", `/api/v1/exports/${job.id}/download`, { session: p.lead.session });
  return { outcome, job: after, status: file.status, bytes: new Uint8Array(file.raw.rawPayload) };
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe("F-DG5-100: a C0 control character in a record title -> well-formed DOCX, PPTX and XLSX exports", () => {
  it("the API accepts the text; each export job succeeds and every XML part of every package parses", async () => {
    const t = ok(await call<Body>(api.app, "GET", T, { session: p.lead.session }), 200, "getTransformation");
    const renamed = ok(
      await call<Body>(api.app, "PATCH", T, {
        session: p.lead.session,
        body: { name: NAME },
        headers: { "if-match": `"${t.version}"` },
      }),
      200,
      "updateTransformation",
    );
    expect(renamed.name).toBe(NAME); // accepted and stored as entered (the input rule is unchanged)
    ok(
      await call<Body>(api.app, "POST", `${T}/raid`, {
        session: p.lead.session,
        body: { type: "risk", description: DESC, impact: "medium", probability: "high", ownerUserId: p.lead.id },
      }),
      201,
      "createRaidEntry",
    );
    const generate = async (definition: string) =>
      ok(
        await call<Body>(api.app, "POST", `${T}/reports/${definition}/generate`, {
          session: p.lead.session,
          body: definition === "registers" ? { parameters: { register: "raid", filters: {} } } : {},
        }),
        201,
        `generate ${definition}`,
      ).id as string;
    const snapshots: Record<string, string> = {};
    for (const d of ["charter", "roadmap", "registers"]) snapshots[d] = await generate(d);

    const results: Record<string, string> = {};
    for (const [definition, format] of [
      ["charter", "docx"],
      ["roadmap", "pptx"],
      ["roadmap", "xlsx"],
      ["registers", "xlsx"],
    ] as const) {
      for (const language of ["en", "ar"] as const) {
        const out = await exportFile(snapshots[definition]!, format, language);
        expect(out.outcome, `${format} ${language}`).toMatchObject({ outcome: "succeeded" });
        expect([out.job.status, out.status], `${format} ${language}`).toEqual(["succeeded", 200]);
        const bad = await malformedParts(out.bytes);
        const k = `${definition}.${language}.${format}`;
        results[k] =
          `job ${out.job.status}, ${out.bytes.byteLength} bytes, not-well-formed parts: ${bad.length === 0 ? "none" : bad.join(" | ")}`;
        // The reviewer's final assertion, for every package of the matrix.
        expect(results[k], k).toMatch(/not-well-formed parts: none$/);
        const { parts } = await readOoxml(out.bytes, /\.xml$/);
        const data = [...parts.values()].map((xml) => xml.replace(/<[^>]*>/g, "")).join("|");
        expect(data, `${k}: the name is kept, U+000B replaced`).toContain(
          "International Roaming\uFFFDprogramme (pasted)",
        );
        if (definition === "registers")
          expect(data, `${k}: the description is kept`).toContain("Supplier\uFFFDdelay\uFFFD(pasted)");
        expect(FORBIDDEN.test(data), k).toBe(false);
      }
    }
    console.info(`F-DG5-100 results: ${JSON.stringify(results, null, 1)}`);
    expect(Object.keys(results)).toHaveLength(8);
  }, 300_000);
});
