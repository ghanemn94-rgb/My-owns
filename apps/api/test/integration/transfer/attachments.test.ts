// T-C16 (ADR-0064 §5, §6 step 3; ADR-0066 §1, §4; p7-work-split §C.3, §C.6; D-248 O1; T-DG7-BE-E): the evidence-byte
// copy of a migration package, run for BOTH EvidenceStore adapters, each built as a fixture of the P6 store contract
// kit (src/modules/evidence/stores/contract.ts `EvidenceStoreFixture`):
//   - the filesystem adapter on a fresh temporary directory;
//   - the S3-compatible adapter against the in-process SigV4-verifying fake (test/support/fake-s3.ts), fresh prefix.
// Proves: copy-in writes every object under the SAME object name with equal size and SHA-256 and leaves no temporary;
// verify reports a missing object, a changed byte and a changed size (never skipped; the other entries still checked);
// copy-in refuses a damaged package and a target holding other bytes, writing nothing; a re-run is idempotent;
// readForExport reads through the port; copy-out then copy-in round-trips; the CLI's exit codes (§2 rule 4) and the
// verify report format; and copy-out lists the rows that name objects from a real PostgreSQL scratch database.
// Every byte, name and id below is SYNTHETIC. A copy approves nothing (no G1-G6, Finance or IT approval).
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import {
  ATTACHMENT_MANIFEST_SCHEMA_VERSION,
  buildPlan,
  canonicalAttachmentManifest,
  createDb,
  createPool,
  migrate,
  parseAttachmentManifest,
  sql,
  type AttachmentEntry,
  type AttachmentManifest,
} from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { runTransferAttachments } from "../../../src/cli/transfer-attachments.ts";
import type { EvidenceStoreFixture } from "../../../src/modules/evidence/stores/contract.ts";
import { FilesystemEvidenceStore } from "../../../src/modules/evidence/stores/filesystem.ts";
import { S3EvidenceStore } from "../../../src/modules/evidence/stores/s3.ts";
import type { EvidenceStore } from "../../../src/modules/evidence/store.ts";
import { createSecretProviderRegistry, secretValue } from "../../../src/modules/platform/index.ts";
import {
  ATTACHMENT_VERIFY_SCHEMA_VERSION,
  AttachmentCopyRefused,
  copyIn,
  copyOut,
  evidenceStoreObjectSource,
  listObjectRows,
  readForExport,
  verify,
  type ObjectRow,
} from "../../../src/modules/transfer/attachments.ts";
import { FakeS3 } from "../../support/fake-s3.ts";
import { testSecretBindings } from "../../support/secret-bindings.ts";

const BUCKET = "mth-evidence";
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

/** A contract-kit fixture plus the two test-only manipulations of the backing store T-C16 needs. */
interface Adapter {
  readonly fixture: EvidenceStoreFixture;
  /** Replaces an object's bytes behind the adapter's back (a damaged target). */
  overwrite(key: string, bytes: Buffer): Promise<void>;
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else out.push(relative(root, path).split(sep).join("/"));
    }
  };
  await visit(root);
  return out.sort();
}

let base = "";
const fake = new FakeS3({ buckets: [BUCKET] });
const access = fake.credentials[0]!;

function s3Secrets() {
  const registry = createSecretProviderRegistry({
    bindings: () =>
      testSecretBindings(
        ["S3_ACCESS", "S3_SECRET"].map((name) => ({
          provider: "test",
          name,
          consumer: "storage" as const,
          organization: null,
          hosts: ["127.0.0.1"],
        })),
      ),
  });
  const values: Record<string, string> = { S3_ACCESS: access.accessKeyId, S3_SECRET: access.secretAccessKey };
  registry.register({
    id: "test",
    get: (name) => Promise.resolve(name in values ? secretValue(values[name]!) : undefined),
  });
  return registry;
}

const adapters: Record<string, () => Promise<Adapter>> = {
  filesystem: async () => {
    const root = join(base, randomUUID());
    await mkdir(root, { recursive: true });
    return {
      fixture: {
        store: new FilesystemEvidenceStore(root),
        listRaw: () => walk(root),
        age: () => Promise.resolve(),
        forbiddenInOutput: [root],
        dispose: () => rm(root, { recursive: true, force: true }),
      },
      overwrite: (key, bytes) => writeFile(join(root, key), bytes),
    };
  },
  "s3 (in-process SigV4-verifying fake)": () => {
    const prefix = `transfer/${randomUUID()}`;
    const store = new S3EvidenceStore({
      endpoint: fake.endpoint,
      region: fake.region,
      bucket: BUCKET,
      keyPrefix: prefix,
      accessKeyRef: { provider: "test", name: "S3_ACCESS" },
      secretKeyRef: { provider: "test", name: "S3_SECRET" },
      secrets: s3Secrets(),
      maxAttempts: 1,
    });
    return Promise.resolve({
      fixture: {
        store,
        listRaw: () =>
          Promise.resolve(
            fake
              .keys(BUCKET)
              .filter((k) => k.startsWith(`${prefix}/`))
              .map((k) => k.slice(prefix.length + 1)),
          ),
        age: () => Promise.resolve(),
        forbiddenInOutput: [fake.endpoint, BUCKET, access.accessKeyId],
        dispose: () => {
          store.destroy();
          return Promise.resolve();
        },
      },
      overwrite: (key, bytes) => {
        fake.seed(BUCKET, `${prefix}/${key}`, bytes, new Date());
        return Promise.resolve();
      },
    });
  },
};

/** A synthetic package directory: three entries, two of them the same bytes under different names. */
async function makePackage(): Promise<{ dir: string; manifest: AttachmentManifest; bytes: Map<string, Buffer> }> {
  const dir = await mkdtemp(join(base, "pkg-"));
  const org = uuidv7();
  const tr = uuidv7();
  const contents = [
    Buffer.from(`synthetic evidence A ${randomUUID()}`),
    Buffer.from(`synthetic evidence B ${randomUUID()} with more bytes`),
  ];
  const shared = contents[0]!;
  const objects: { name: string; data: Buffer; table: string }[] = [
    { name: `${org}/${tr}/${uuidv7()}/${uuidv7()}`, data: contents[0]!, table: "evidence_content" },
    { name: `${org}/${tr}/${uuidv7()}/${uuidv7()}`, data: contents[1]!, table: "evidence_content" },
    { name: `${org}/${tr}/exports/${uuidv7()}`, data: shared, table: "export_job" },
  ];
  const bytes = new Map<string, Buffer>();
  const items: AttachmentEntry[] = [];
  for (const o of objects) {
    const h = sha(o.data);
    await mkdir(join(dir, "attachments"), { recursive: true });
    await writeFile(join(dir, "attachments", h), o.data);
    bytes.set(o.name, o.data);
    items.push({
      objectName: o.name,
      sizeBytes: String(o.data.byteLength),
      sha256: h,
      parentTable: o.table,
      parentId: uuidv7(),
      file: `attachments/${h}`,
    });
  }
  const manifest: AttachmentManifest = { schemaVersion: ATTACHMENT_MANIFEST_SCHEMA_VERSION, exportId: uuidv7(), items };
  await writeFile(join(dir, "attachments.json"), canonicalAttachmentManifest(manifest));
  return { dir, manifest, bytes };
}

async function readAll(store: EvidenceStore, key: string): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const c of await store.get(key)) chunks.push(c);
  return Buffer.concat(chunks);
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err };
}

beforeAll(async () => {
  base = await mkdtemp(join(process.env["TMPDIR"] ?? tmpdir(), "mth-transfer-attachments-"));
  await fake.start();
});
afterAll(async () => {
  await fake.stop();
  if (base !== "") await rm(base, { recursive: true, force: true });
});

for (const [name, make] of Object.entries(adapters)) {
  describe(`T-C16: evidence bytes through the ${name} adapter`, () => {
    it("copy-in writes every object under the same name with equal size and SHA-256; verify finds nothing; no temporary is left", async () => {
      const a = await make();
      const { dir, manifest, bytes } = await makePackage();
      try {
        const result = await copyIn(a.fixture.store, dir, manifest);
        expect(result).toEqual({ written: 3, present: 0, mismatches: [] });
        for (const e of manifest.items) {
          const got = await readAll(a.fixture.store, e.objectName);
          expect(got.equals(bytes.get(e.objectName)!), e.objectName).toBe(true);
          expect([String(got.byteLength), sha(got)]).toEqual([e.sizeBytes, e.sha256]);
        }
        expect(await a.fixture.listRaw()).toEqual(manifest.items.map((e) => e.objectName).sort());
        expect(await verify(a.fixture.store, manifest)).toEqual([]);
        // A re-run (an interrupted copy started again) writes nothing and still verifies.
        expect(await copyIn(a.fixture.store, dir, manifest)).toEqual({ written: 0, present: 3, mismatches: [] });
      } finally {
        await a.fixture.dispose();
      }
    });

    it("verify reports a missing object, a changed byte and a changed size; every entry is checked, none skipped", async () => {
      const a = await make();
      const { dir, manifest, bytes } = await makePackage();
      try {
        await copyIn(a.fixture.store, dir, manifest);
        const [e0, e1, e2] = manifest.items as [AttachmentEntry, AttachmentEntry, AttachmentEntry];
        await a.fixture.store.discardUncommitted(e0.objectName); // a lost object (the adapter's own removal)
        const flipped = Buffer.from(bytes.get(e1.objectName)!);
        flipped[0] = flipped[0]! ^ 0x01;
        await a.overwrite(e1.objectName, flipped);
        await a.overwrite(e2.objectName, Buffer.concat([bytes.get(e2.objectName)!, Buffer.from("x")]));
        const found = await verify(a.fixture.store, manifest);
        expect(found.map((m) => [m.objectName, m.problem])).toEqual([
          [e0.objectName, "missing"],
          [e1.objectName, "sha256_mismatch"],
          [e2.objectName, "size_mismatch"],
        ]);
        expect(found[0]).toMatchObject({ actualSize: null, actualSha256: null, expectedSha256: e0.sha256 });
        expect(found[1]).toMatchObject({ actualSize: e1.sizeBytes, actualSha256: sha(flipped) });
        expect(found[2]!.actualSize).toBe(String(Number(e2.sizeBytes) + 1));
      } finally {
        await a.fixture.dispose();
      }
    });

    it("copy-in refuses a package whose file is missing or altered, before writing anything", async () => {
      const a = await make();
      const { dir, manifest } = await makePackage();
      try {
        const [e0, e1] = manifest.items as [AttachmentEntry, AttachmentEntry];
        await writeFile(join(dir, e1.file), "synthetic tampered bytes");
        await rm(join(dir, e0.file));
        const err = await copyIn(a.fixture.store, dir, manifest).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AttachmentCopyRefused);
        expect((err as AttachmentCopyRefused).reason).toBe("package");
        // e0's file is shared with the third entry, so both report it; e1 reports its changed bytes.
        expect((err as AttachmentCopyRefused).problems.map((p) => p.problem).sort()).toEqual([
          "missing",
          "missing",
          "size_mismatch",
        ]);
        expect(await a.fixture.listRaw()).toEqual([]);
      } finally {
        await a.fixture.dispose();
      }
    });

    it("copy-in refuses when the target already holds other bytes under a listed name, writing nothing", async () => {
      const a = await make();
      const { dir, manifest } = await makePackage();
      try {
        const e1 = manifest.items[1]!;
        await a.fixture.store.put(e1.objectName, Buffer.from("synthetic other installation"), 100);
        const err = await copyIn(a.fixture.store, dir, manifest).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AttachmentCopyRefused);
        expect((err as AttachmentCopyRefused).reason).toBe("target_conflict");
        expect((err as AttachmentCopyRefused).problems.map((p) => p.objectName)).toEqual([e1.objectName]);
        expect(await a.fixture.listRaw()).toEqual([e1.objectName]);
        expect((await readAll(a.fixture.store, e1.objectName)).toString()).toBe("synthetic other installation");
      } finally {
        await a.fixture.dispose();
      }
    });

    it("readForExport reads through the port (null for a missing object); the ObjectSource wraps it", async () => {
      const a = await make();
      try {
        const key = `${uuidv7()}/${uuidv7()}/${uuidv7()}/${uuidv7()}`;
        await a.fixture.store.put(key, Buffer.from("synthetic export read"), 100);
        expect(Buffer.from((await readForExport(a.fixture.store, { objectName: key }))!).toString()).toBe(
          "synthetic export read",
        );
        expect(await readForExport(a.fixture.store, { objectName: `${key}0` })).toBeNull();
        const source = evidenceStoreObjectSource(a.fixture.store);
        const ref = { objectName: key, parentTable: "evidence_content", parentId: uuidv7(), driver: null };
        expect(Buffer.from((await source.read(ref))!).toString()).toBe("synthetic export read");
      } finally {
        await a.fixture.dispose();
      }
    });

    it("copy-out then copy-in into a second store round-trips every object under its name; a missing or altered source object is reported", async () => {
      const src = await make();
      const dst = await make();
      const out = await mkdtemp(join(base, "copyout-"));
      try {
        const rows: ObjectRow[] = [];
        for (const [i, text] of ["synthetic one", "synthetic two", "synthetic one"].entries()) {
          const key = `${uuidv7()}/${uuidv7()}/${uuidv7()}/${uuidv7()}`;
          await src.fixture.store.put(key, Buffer.from(text), 100);
          rows.push({
            objectName: key,
            parentTable: i === 2 ? "export_job" : "evidence_content",
            parentId: uuidv7(),
            sha256: sha(text),
            sizeBytes: String(Buffer.byteLength(text)),
          });
        }
        const exportId = uuidv7();
        const copied = await copyOut(src.fixture.store, out, rows, exportId);
        expect(copied.problems).toEqual([]);
        expect(copied.filesWritten).toBe(2);
        expect(parseAttachmentManifest(copied.manifestText)).toEqual(copied.manifest);
        expect(copied.manifest.exportId).toBe(exportId);
        await writeFile(join(out, "attachments.json"), copied.manifestText);
        expect(await copyIn(dst.fixture.store, out, copied.manifest)).toEqual({
          written: 3,
          present: 0,
          mismatches: [],
        });
        for (const r of rows) expect(sha(await readAll(dst.fixture.store, r.objectName))).toBe(r.sha256);

        // A lost object and an object whose bytes no longer match its row: both reported, never skipped.
        const lost = { ...rows[0]!, objectName: `${rows[0]!.objectName}0` };
        const wrong = { ...rows[1]!, sha256: sha("synthetic expected other") };
        const bad = await copyOut(
          src.fixture.store,
          await mkdtemp(join(base, "copyout-bad-")),
          [lost, wrong],
          exportId,
        );
        expect(bad.problems.map((p) => [p.objectName, p.problem])).toEqual([
          [lost.objectName, "missing"],
          [wrong.objectName, "sha256_mismatch"],
        ]);
        expect(bad.manifest.items).toEqual([]);
      } finally {
        await src.fixture.dispose();
        await dst.fixture.dispose();
      }
    });
  });
}

describe("T-C16: the transfer-attachments CLI (exit codes of p7-work-split §2 rule 4)", () => {
  it("copy-in exits 0; verify writes the mth-attachment-verify/1 report and exits 0; a damaged target makes verify exit 1", async () => {
    const root = await mkdtemp(join(base, "cli-store-"));
    const env = { EVIDENCE_STORAGE_DRIVER: "filesystem", EVIDENCE_STORAGE_PATH: root };
    const { dir, manifest } = await makePackage();
    const c = capture();
    expect(await runTransferAttachments(["copy-in", "--from", dir], env, c.io)).toBe(0);
    expect(c.out).toEqual(["transfer-attachments copy-in: copied 3 objects, 0 already present; 3 entries verified"]);
    const report = join(base, `verify-${randomUUID()}.json`);
    const v = capture();
    expect(await runTransferAttachments(["verify", "--from", dir, "--out", report], env, v.io)).toBe(0);
    const text = await readFile(report, "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(JSON.parse(text)).toEqual({
      schemaVersion: ATTACHMENT_VERIFY_SCHEMA_VERSION,
      attachmentManifestSha256: sha(await readFile(join(dir, "attachments.json"))),
      checked: 3,
      result: "matched",
      mismatches: [],
    });
    await writeFile(join(root, manifest.items[1]!.objectName), "synthetic damage");
    const bad = capture();
    expect(await runTransferAttachments(["verify", "--from", dir, "--out", report], env, bad.io)).toBe(1);
    const body = JSON.parse(await readFile(report, "utf8")) as { result: string; mismatches: { problem: string }[] };
    expect([body.result, body.mismatches.map((m) => m.problem)]).toEqual(["mismatched", ["size_mismatch"]]);
    expect(bad.err[0]).toBe("transfer-attachments verify: mismatch: 1 of 3 objects differ");
    // No evidence bytes are printed.
    expect([...bad.err, ...bad.out].join("\n")).not.toContain("synthetic damage");
  });

  it("refusals: usage 2, a damaged package 2 (nothing written), attachments.json not matching manifest.json 2, the s3 driver 3", async () => {
    const root = await mkdtemp(join(base, "cli-store-"));
    const env = { EVIDENCE_STORAGE_DRIVER: "filesystem", EVIDENCE_STORAGE_PATH: root };
    for (const argv of [
      [],
      ["copy"],
      ["copy-in"],
      ["verify", "--from", "x"],
      ["copy-in", "--from", "x", "--to", "y"],
    ]) {
      const c = capture();
      expect(await runTransferAttachments(argv, env, c.io), argv.join(" ")).toBe(2);
      expect(c.err[0]).toMatch(/^BLOCKED: usage: transfer-attachments /);
    }
    const { dir, manifest } = await makePackage();
    await writeFile(join(dir, manifest.items[1]!.file), "synthetic tamper");
    const c = capture();
    expect(await runTransferAttachments(["copy-in", "--from", dir], env, c.io)).toBe(2);
    expect(c.err[0]).toMatch(/^BLOCKED: transfer-attachments copy-in: refused: .*nothing was written$/);
    expect(await walk(root)).toEqual([]);

    const p2 = await makePackage();
    await writeFile(
      join(p2.dir, "manifest.json"),
      // Not a valid migration manifest: refused, never ignored.
      '{"schemaVersion":"mth-migration/1"}\n',
    );
    const m = capture();
    expect(await runTransferAttachments(["copy-in", "--from", p2.dir], env, m.io)).toBe(2);
    expect(m.err[0]).toMatch(/^BLOCKED: transfer-attachments copy-in: /);

    const s = capture();
    expect(
      await runTransferAttachments(
        ["copy-in", "--from", (await makePackage()).dir],
        { EVIDENCE_STORAGE_DRIVER: "s3" },
        s.io,
      ),
    ).toBe(3);
    expect(s.err[0]).toMatch(/^BLOCKED: transfer-attachments copy-in: the s3 evidence store is not reachable/);

    const o = capture();
    expect(await runTransferAttachments(["copy-out", "--to", root, "--out", join(root, "a.json")], env, o.io)).toBe(2);
    expect(o.err[0]).toBe("BLOCKED: transfer-attachments copy-out: DATABASE_URL is not set");
  });
});

describe("T-C16: copy-out reads the rows that name objects from PostgreSQL (scratch database)", () => {
  let scratch = "";
  afterAll(async () => {
    if (scratch !== "") await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
  }, 60_000);

  it("the plan's storage_key columns are evidence_content and export_job; their rows are listed and copy-out exits 0 with their manifest", async () => {
    const { adminUrl } = inject("mthDb");
    scratch = await createScratchDatabase(adminUrl, "mth_transfer_attachments");
    await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
    const root = await mkdtemp(join(base, "cli-db-store-"));
    const store = new FilesystemEvidenceStore(root);
    const data = Buffer.from("synthetic evidence for copy-out");
    const key = `${uuidv7()}/${uuidv7()}/${uuidv7()}/${uuidv7()}`;
    await store.put(key, data, 100);
    const contentId = uuidv7();
    // Test-only SYNTHETIC row, written as the cluster superuser with replication-role triggers (foreign keys and user
    // triggers) off for this one transaction: the row's parents are irrelevant to which objects are listed.
    const superDb = createDb(createPool(roleUrl(adminUrl, scratch, null), { max: 1 }));
    try {
      await superDb.transaction().execute(async (tx) => {
        await sql`SET LOCAL session_replication_role = replica`.execute(tx);
        await tx
          .insertInto("evidence_content")
          .values({
            id: contentId,
            organization_id: uuidv7(),
            transformation_id: uuidv7(),
            evidence_id: uuidv7(),
            revision: 1,
            storage_key: key,
            sha256: sha(data),
            size_bytes: String(data.byteLength),
            content_type: "text/plain",
            detected_type: "txt",
            file_name: "synthetic.txt",
            uploaded_by: uuidv7(),
          })
          .execute();
      });
    } finally {
      await superDb.destroy();
    }
    const app = createDb(createPool(roleUrl(adminUrl, scratch, "mth_app"), { max: 1 }));
    try {
      expect((await buildPlan(app)).objectColumns).toEqual([
        { table: "evidence_content", column: "storage_key" },
        { table: "export_job", column: "storage_key" },
      ]);
      expect(await listObjectRows(app)).toEqual([
        {
          objectName: key,
          parentTable: "evidence_content",
          parentId: contentId,
          sha256: sha(data),
          sizeBytes: String(data.byteLength),
        },
      ]);
    } finally {
      await app.destroy();
    }
    const out = await mkdtemp(join(base, "cli-db-out-"));
    const c = capture();
    const code = await runTransferAttachments(
      ["copy-out", "--to", out, "--out", join(out, "attachments.json")],
      {
        EVIDENCE_STORAGE_DRIVER: "filesystem",
        EVIDENCE_STORAGE_PATH: root,
        DATABASE_URL: roleUrl(adminUrl, scratch, "mth_app"),
      },
      c.io,
    );
    expect([code, c.err]).toEqual([0, []]);
    expect(c.out).toEqual(["transfer-attachments copy-out: copied 1 objects (1 distinct files, 31 bytes)"]);
    const manifest = parseAttachmentManifest(await readFile(join(out, "attachments.json"), "utf8"));
    expect(manifest.items).toEqual([
      {
        objectName: key,
        sizeBytes: String(data.byteLength),
        sha256: sha(data),
        parentTable: "evidence_content",
        parentId: contentId,
        file: `attachments/${sha(data)}`,
      },
    ]);
    expect((await readFile(join(out, manifest.items[0]!.file))).equals(data)).toBe(true);
  }, 240_000);
});
