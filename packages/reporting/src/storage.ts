// The export-file store (ADR-0046 §5; `@mth/reporting/storage`). Dependency-free (Node built-ins only), because the
// API imports this subpath to stream downloads and must never load a renderer library.
//
// The ADR-0010 filesystem driver pattern: write to a temporary name, fsync, atomic rename, fsync the directory, under
// the configured evidence-store root with the key prefix `exports/`. Keys are opaque (`exports/<organizationId>/
// <exportJobId>.<ext>`), never user file names. P5 deletes no export file (retention is a later decision); `discard`
// removes only a file whose job never recorded it (a cancelled or failed run).
// P6 (T-DG6-BE-H2; ADR-0054 §2): `ExportFileStore` is the export-file storage port. Export files stay in the filesystem
// store under EVIDENCE_STORAGE_PATH: the saved Administration > Storage setting selects the EVIDENCE store only, because
// `export_job` records no storage driver, so moving exports to an object store would strand every earlier file (a
// per-job driver column is a later decision). EVIDENCE_STORAGE_DRIVER=s3 in the environment gives no export-file store:
// configuring it makes this store unavailable (never a silent fallback).
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** 200 MiB: the 0081 `file_size_bytes` ceiling (ADR-0046 §5); above it the job fails with export.too_large. */
export const EXPORT_MAX_BYTES = 200 * 1024 * 1024;

/** The 0081 `storage_key` CHECK. */
export const EXPORT_STORAGE_KEY = /^exports\/[A-Za-z0-9/_.-]{1,190}$/;
/** The 0081 `file_name` CHECK (ASCII, 5-200 characters). */
export const EXPORT_FILE_NAME = /^[A-Za-z0-9_.-]{5,200}$/;

export class ExportTooLarge extends Error {
  readonly code = "export.too_large";
  constructor() {
    super(`the export file exceeds ${EXPORT_MAX_BYTES} bytes`);
    this.name = "ExportTooLarge";
  }
}

export class ExportStoreUnavailable extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "ExportStoreUnavailable";
  }
}

export interface StoredExportFile {
  readonly key: string;
  readonly sha256: string;
  readonly size: number;
}

export interface ExportFileStore {
  /** Stores the bytes durably under `key` (atomic: a reader sees the whole file or none). */
  put(key: string, bytes: Uint8Array, maxBytes?: number): Promise<StoredExportFile>;
  /** The stored bytes as a stream; ExportStoreUnavailable when the object is missing. */
  get(key: string): Promise<AsyncIterable<Uint8Array>>;
  /** The object's size, or null when it does not exist. */
  head(key: string): Promise<{ size: number } | null>;
  /** Removes an object that no job recorded (idempotent). */
  discard(key: string): Promise<void>;
}

/** `exports/<organizationId>/<exportJobId>.<ext>` (both UUIDs, so the key always satisfies the 0081 CHECK). */
export function exportStorageKey(organizationId: string, exportJobId: string, extension: string): string {
  const key = `exports/${organizationId}/${exportJobId}.${extension}`;
  if (!EXPORT_STORAGE_KEY.test(key) || key.includes("..")) throw new Error("export store: invalid key");
  return key;
}

/** An ASCII download name: `<transformation code>_<output>_<snapshot id prefix>_<language>.<ext>`. */
export function exportFileName(parts: {
  transformationCode: string;
  definitionCode: string;
  snapshotId: string;
  language: string;
  extension: string;
}): string {
  const clean = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  const code = clean(parts.transformationCode).slice(0, 60) || "transformation";
  const name = `${code}_${clean(parts.definitionCode)}_${parts.snapshotId.slice(0, 8)}_${clean(parts.language)}.${clean(parts.extension)}`;
  if (!EXPORT_FILE_NAME.test(name)) throw new Error("export store: invalid file name");
  return name;
}

export class FilesystemExportStore implements ExportFileStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathOf(key: string): string {
    if (!EXPORT_STORAGE_KEY.test(key) || key.includes("..")) throw new Error("export store: invalid key");
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error("export store: key escapes the root");
    return p;
  }

  async put(key: string, bytes: Uint8Array, maxBytes = EXPORT_MAX_BYTES): Promise<StoredExportFile> {
    if (bytes.byteLength > maxBytes) throw new ExportTooLarge();
    const final = this.pathOf(key);
    const temp = `${final}.part`;
    try {
      await mkdir(dirname(final), { recursive: true, mode: 0o700 });
    } catch (err) {
      throw new ExportStoreUnavailable(`export store directory is not writable: ${(err as Error).message}`);
    }
    // A temporary left by a killed attempt of the same job is replaced (the job's lock serializes its attempts).
    await rm(temp, { force: true });
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (err) {
      try {
        await handle.close();
      } finally {
        await rm(temp, { force: true });
      }
      throw err;
    }
    await handle.close();
    await rename(temp, final);
    const dir = await open(dirname(final), "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
    return { key, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength };
  }

  async get(key: string): Promise<AsyncIterable<Uint8Array>> {
    const p = this.pathOf(key);
    try {
      await stat(p);
    } catch {
      throw new ExportStoreUnavailable("export file is missing from the store");
    }
    return createReadStream(p);
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const s = await stat(this.pathOf(key));
      return s.isFile() ? { size: s.size } : null;
    } catch {
      return null;
    }
  }

  async discard(key: string): Promise<void> {
    const p = this.pathOf(key);
    await rm(`${p}.part`, { force: true });
    await rm(p, { force: true });
  }
}

/** The export-file store for the environment's storage driver (filesystem; `s3` has no export-file store). */
export function createExportStore(storage: {
  readonly driver: "filesystem" | "s3";
  readonly path: string;
}): ExportFileStore {
  if (storage.driver !== "filesystem") {
    const unavailable = (): never => {
      throw new ExportStoreUnavailable(
        "export files are stored only by the filesystem driver; EVIDENCE_STORAGE_DRIVER=s3 has no export-file store",
      );
    };
    return {
      put: async () => unavailable(),
      get: async () => unavailable(),
      head: async () => unavailable(),
      discard: async () => unavailable(),
    };
  }
  return new FilesystemExportStore(storage.path);
}
