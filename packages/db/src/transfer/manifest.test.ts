// T-C3 (pure part; ADR-0064 §2.1, §5; D-244 O2; p7-work-split §C.6): the manifest's canonical bytes are stable and in
// the ADR's key order, schemaVersion is mth-migration/1, the reader accepts exactly the canonical form, and
// demoChecksum is set exactly for a demo source. The marker read and the equality with datasetChecksum() run on a real
// database in test/integration/transfer-export.test.ts. Synthetic values only.
import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MANIFEST_SCHEMA_VERSION,
  canonicalAttachmentManifest,
  canonicalManifest,
  MANIFEST_SCHEMA_VERSION,
  ManifestFormatError,
  manifestSchemaVersion,
  parseAttachmentManifest,
  parseManifest,
  type MigrationManifest,
} from "./manifest.ts";

const HEX = (c: string) => c.repeat(64);
const ID = "01920007-0000-7000-8000-000000000001";

const manifest = (over: Partial<MigrationManifest> = {}): MigrationManifest => ({
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  exportId: ID,
  sourceEnvironment: "demo",
  demoChecksum: HEX("d"),
  migrationLevel: "0147_p7_transfer_export_job",
  createdAt: "2026-11-12T20:00:00.000Z",
  appVersion: "0.1.0",
  tables: [
    {
      name: "organization",
      file: "tables/organization.ndjson",
      loadPhase: 1,
      rowCount: "9007199254740993",
      fileSha256: HEX("a"),
      contentDigest: HEX("a"),
      columns: ["id", "created_by"],
      deferredColumns: ["created_by"],
    },
  ],
  excludedTables: [{ name: "session", rule: "exclude_credential", reason: "Synthetic reason" }],
  rewrittenColumns: [{ table: "storage_setting", column: "s3_access_key_ref", rule: "secret_ref_unbind" }],
  attachmentManifest: { file: "attachments.json", sha256: HEX("b"), count: 0, bytes: "0" },
  totals: { tables: 1, rows: "9007199254740993" },
  ...over,
});

describe("the migration manifest (ADR-0064 §2.1)", () => {
  it("has stable canonical bytes: ADR key order, compact, one final newline", () => {
    const text = canonicalManifest(manifest());
    expect(canonicalManifest(manifest())).toBe(text);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.indexOf("\n")).toBe(text.length - 1);
    expect(Object.keys(JSON.parse(text) as object)).toEqual([
      "schemaVersion",
      "exportId",
      "sourceEnvironment",
      "demoChecksum",
      "migrationLevel",
      "createdAt",
      "appVersion",
      "tables",
      "excludedTables",
      "rewrittenColumns",
      "attachmentManifest",
      "totals",
    ]);
    // The same object built with its keys in another order gives the same bytes.
    const shuffled = Object.fromEntries(Object.entries(manifest()).reverse()) as unknown as MigrationManifest;
    expect(canonicalManifest(shuffled)).toBe(text);
    // Large counts are decimal strings, never numbers that lose precision.
    expect(text).toContain('"rowCount":"9007199254740993"');
  });

  it("schemaVersion is mth-migration/1 and the reader returns the same manifest", () => {
    const text = canonicalManifest(manifest());
    expect(manifestSchemaVersion(text)).toBe("mth-migration/1");
    expect(parseManifest(text)).toEqual(manifest());
  });

  it("refuses another schema version, a non-canonical text and an extra key", () => {
    const text = canonicalManifest(manifest());
    expect(() => parseManifest(text.replace("mth-migration/1", "mth-migration/2"))).toThrow(
      "unsupported manifest schema version 'mth-migration/2'",
    );
    expect(() => parseManifest(`${JSON.stringify(JSON.parse(text), null, 1)}\n`)).toThrow(ManifestFormatError);
    expect(() => parseManifest(text.replace('"totals"', '"extra":1,"totals"'))).toThrow(ManifestFormatError);
  });

  it("demoChecksum is set exactly for a demo source (D-244 O2)", () => {
    for (const env of ["production", "unmarked"] as const) {
      expect(parseManifest(canonicalManifest(manifest({ sourceEnvironment: env, demoChecksum: null })))).toMatchObject({
        sourceEnvironment: env,
        demoChecksum: null,
      });
      expect(() => parseManifest(canonicalManifest(manifest({ sourceEnvironment: env })))).toThrow(/demoChecksum/);
    }
    expect(() => parseManifest(canonicalManifest(manifest({ demoChecksum: null })))).toThrow(/demoChecksum/);
  });
});

describe("the attachment manifest (ADR-0064 §5)", () => {
  it("round-trips canonically and names each file by its SHA-256", () => {
    const a = {
      schemaVersion: ATTACHMENT_MANIFEST_SCHEMA_VERSION,
      exportId: ID,
      items: [
        {
          objectName: "org/tx/evidence/01920007-0000-7000-8000-0000000000aa",
          sizeBytes: "12",
          sha256: HEX("c"),
          parentTable: "evidence_content",
          parentId: ID,
          file: `attachments/${HEX("c")}`,
        },
      ],
    } as const;
    const text = canonicalAttachmentManifest(a);
    expect(parseAttachmentManifest(text)).toEqual(a);
    expect(() => parseAttachmentManifest(text.replace(`attachments/${HEX("c")}`, `attachments/${HEX("e")}`))).toThrow(
      /does not name its SHA-256/,
    );
  });
});
