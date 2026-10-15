// ADR-0046 §5: the export-file store (filesystem driver): atomic write, SHA-256 and size, keys under exports/.
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createExportStore,
  EXPORT_MAX_BYTES,
  exportFileName,
  exportStorageKey,
  ExportStoreUnavailable,
  ExportTooLarge,
  FilesystemExportStore,
} from "./storage.ts";

const dirs: string[] = [];
const fresh = async () => {
  const d = await mkdtemp(join(process.env["TMPDIR"] ?? tmpdir(), "mth-export-store-"));
  dirs.push(d);
  return d;
};
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const ORG = "0190a000-0000-7000-8000-000000000001";
const JOB = "0190a000-0000-7000-8000-000000000002";

async function collect(it: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const p of it) parts.push(Buffer.from(p));
  return Buffer.concat(parts);
}

describe("FilesystemExportStore", () => {
  it("stores bytes atomically and returns their SHA-256 and size; replaces a leftover temporary", async () => {
    const root = await fresh();
    const store = new FilesystemExportStore(root);
    const key = exportStorageKey(ORG, JOB, "csv");
    expect(key).toBe(`exports/${ORG}/${JOB}.csv`);
    const bytes = new TextEncoder().encode("﻿a,b\r\n");
    const stored = await store.put(key, bytes);
    expect(stored).toEqual({ key, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
    expect((await collect(await store.get(key))).equals(Buffer.from(bytes))).toBe(true);
    expect(await store.head(key)).toEqual({ size: bytes.byteLength });
    expect(await readdir(join(root, "exports", ORG))).toEqual([`${JOB}.csv`]);
    await store.put(key, bytes);
    await store.discard(key);
    expect(await store.head(key)).toBeNull();
    await store.discard(key);
  });

  it("refuses keys outside exports/ and files above 200 MiB; a missing file is unavailable", async () => {
    const store = new FilesystemExportStore(await fresh());
    await expect(store.put("evidence/x.csv", new Uint8Array(1))).rejects.toThrow(/invalid key/);
    await expect(store.put("exports/../x.csv", new Uint8Array(1))).rejects.toThrow(/invalid key/);
    await expect(store.put(exportStorageKey(ORG, JOB, "csv"), new Uint8Array(2), 1)).rejects.toBeInstanceOf(
      ExportTooLarge,
    );
    expect(EXPORT_MAX_BYTES).toBe(209715200);
    await expect(store.get(exportStorageKey(ORG, JOB, "xlsx"))).rejects.toBeInstanceOf(ExportStoreUnavailable);
  });

  it("the s3 driver is unavailable in P5 (never a silent fallback)", async () => {
    const s3 = createExportStore({ driver: "s3", path: "/nowhere" });
    await expect(s3.put(exportStorageKey(ORG, JOB, "csv"), new Uint8Array(1))).rejects.toBeInstanceOf(
      ExportStoreUnavailable,
    );
  });

  it("file names are ASCII and match the 0081 CHECK", () => {
    expect(
      exportFileName({
        transformationCode: "TR-001 تحول",
        definitionCode: "registers",
        snapshotId: JOB,
        language: "ar",
        extension: "xlsx",
      }),
    ).toBe("TR-001_registers_0190a000_ar.xlsx");
  });
});
