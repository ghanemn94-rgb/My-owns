// EvidenceStore (ADR-0010): the bytes of file evidence live outside the database, in a private store that is never
// web-served. P2 ships the filesystem adapter (EVIDENCE_STORAGE_DRIVER=filesystem): an atomic write (temporary file,
// fsync, rename) with the SHA-256 and size computed WHILE streaming, and reads only through the API route that applies
// the parent record's authorization. Keys are opaque (organization/transformation/evidence/UUIDv7), never user
// filenames. The optional S3-compatible adapter is a P6 increment (IT approval, licence review); configuring it here
// makes every content operation 503 (never a silent fallback).
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

/** Hard ceiling of the evidence_content.size_bytes CHECK is 1 GiB; the API accepts at most this much per upload. */
export const EVIDENCE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * T-DG2-BE18A (F-DG2-460, defence in depth): the start-up sweep removes a TEMPORARY object (`<uuid>.part`) only when
 * it was last written more than this long ago. A temporary is owned by a live upload only while that request runs:
 *  - its body must arrive within Node's requestTimeout (300 s, platform/connection-hygiene.ts), and every write updates
 *    the file's mtime, so a live temporary is at most 300 s old while the body streams;
 *  - phase 3 (commit-time authorisation, the row lock, the content row, finalise) follows at once and is bounded by the
 *    pool checkout timeout (10 s) and the statement / idle-in-transaction timeouts (30 s each);
 *  - shutdown adds at most the grace and the backstop (10 s).
 * That is under 10 minutes for the longest legitimate ownership on ANY API instance sharing the store. One hour is six
 * times that, and leaves a large margin for clock skew between instances (on shared storage the mtime may come from
 * another host's clock). So no live request, on this instance or another, can own a temporary the sweep removes.
 */
export const STALE_TEMPORARY_AGE_MS = 60 * 60 * 1000;

/** The only names the sweep ever removes: an upload's temporary object (a UUID key + `.part`). */
const TEMPORARY_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.part$/;
/** Keys are organization/transformation/evidence/uuid: temporaries live exactly 3 directories below the root. */
const KEY_DEPTH = 3;

export interface RemovedTemporary {
  /** The temporary's path relative to the store root (opaque identifiers only, never content). */
  readonly key: string;
  readonly sizeBytes: number;
  readonly ageMs: number;
}

export interface SweepResult {
  readonly removed: number;
  /** Temporaries younger than the threshold (possibly owned by a live upload), left alone. */
  readonly keptFresh: number;
}

export interface StoredObject {
  readonly key: string;
  readonly sha256: string;
  readonly size: number;
}

export class EvidenceTooLarge extends Error {
  readonly maxBytes: number;
  constructor(maxBytes: number) {
    super(`evidence content exceeds ${maxBytes} bytes`);
    this.name = "EvidenceTooLarge";
    this.maxBytes = maxBytes;
  }
}
export class EvidenceStoreUnavailable extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "EvidenceStoreUnavailable";
  }
}

export type EvidenceBody = AsyncIterable<Uint8Array | string> | Uint8Array;

export interface EvidenceStore {
  /** `receive` + `finalise` in one call (tests and tools; the upload route uses the two steps, T-DG2-BE17). */
  put(key: string, body: EvidenceBody, maxBytes: number): Promise<StoredObject>;
  /**
   * T-DG2-BE17 step 1: streams `body` into the key's TEMPORARY object (never readable through `get`), computing the
   * SHA-256 over the raw bytes and enforcing `maxBytes` while streaming, and makes it durable (fsync). On any failure
   * (too large, client abort, I/O error) the temporary object is removed and the error is rethrown. The upload route
   * calls it while holding NO database connection or transaction.
   */
  receive(key: string, body: EvidenceBody, maxBytes: number): Promise<StoredObject>;
  /** Step 2: makes a received object readable under its key (atomic rename of the temporary object). */
  finalise(key: string): Promise<void>;
  get(key: string): Promise<AsyncIterable<Uint8Array>>;
  head(key: string): Promise<{ size: number } | null>;
  /**
   * Removes an object that never became committed metadata (failed upload): the final object AND a temporary one
   * that was received but not finalised. Idempotent. Retention deletes are P6.
   */
  discardUncommitted(key: string): Promise<void>;
  /**
   * T-DG2-BE18A (F-DG2-460): removes temporary objects last written more than `olderThanMs` ago (see
   * STALE_TEMPORARY_AGE_MS), calling `onRemoved` for each. Never removes a final (committed or committable) object.
   */
  sweepStaleTemporaries(olderThanMs: number, onRemoved: (removed: RemovedTemporary) => void): Promise<SweepResult>;
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,199}$/;

export class FilesystemEvidenceStore implements EvidenceStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathOf(key: string): string {
    if (!KEY.test(key) || key.includes("..")) throw new Error("evidence store: invalid key");
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error("evidence store: key escapes the root");
    return p;
  }

  private tempOf(key: string): string {
    return `${this.pathOf(key)}.part`;
  }

  async put(key: string, body: EvidenceBody, maxBytes: number): Promise<StoredObject> {
    const stored = await this.receive(key, body, maxBytes);
    await this.finalise(key);
    return stored;
  }

  async receive(key: string, body: EvidenceBody, maxBytes: number): Promise<StoredObject> {
    const final = this.pathOf(key);
    const temp = this.tempOf(key);
    try {
      await mkdir(dirname(final), { recursive: true, mode: 0o700 });
    } catch (err) {
      throw new EvidenceStoreUnavailable(`evidence store directory is not writable: ${(err as Error).message}`);
    }
    const hash = createHash("sha256");
    let size = 0;
    const handle = await open(temp, "wx", 0o600);
    try {
      const chunks: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array> =
        body instanceof Uint8Array ? [body] : body;
      for await (const chunk of chunks) {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        size += bytes.byteLength;
        if (size > maxBytes) throw new EvidenceTooLarge(maxBytes);
        hash.update(bytes);
        await handle.write(bytes);
      }
      await handle.sync();
    } catch (err) {
      // T-DG2-BE18A: the temporary is removed even when closing the handle fails.
      try {
        await handle.close();
      } finally {
        await rm(temp, { force: true });
      }
      throw err;
    }
    await handle.close();
    return { key, sha256: hash.digest("hex"), size };
  }

  async finalise(key: string): Promise<void> {
    await rename(this.tempOf(key), this.pathOf(key));
  }

  async get(key: string): Promise<AsyncIterable<Uint8Array>> {
    const p = this.pathOf(key);
    await stat(p);
    return createReadStream(p);
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      return { size: (await stat(this.pathOf(key))).size };
    } catch {
      return null;
    }
  }

  async discardUncommitted(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
    await rm(this.tempOf(key), { force: true });
  }

  async sweepStaleTemporaries(
    olderThanMs: number,
    onRemoved: (removed: RemovedTemporary) => void,
  ): Promise<SweepResult> {
    let removed = 0;
    let keptFresh = 0;
    const visit = async (dir: string, depth: number): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") return; // no store yet, or removed concurrently
        throw err;
      }
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (depth < KEY_DEPTH) {
          // Real directories only: a symbolic link is never followed out of the store.
          if (entry.isDirectory()) await visit(path, depth + 1);
          continue;
        }
        if (!entry.isFile() || !TEMPORARY_NAME.test(entry.name)) continue; // final objects are never touched
        let info;
        try {
          info = await lstat(path);
        } catch {
          continue; // finalised or removed meanwhile
        }
        if (!info.isFile()) continue;
        const ageMs = Date.now() - info.mtimeMs;
        if (ageMs <= olderThanMs) {
          keptFresh += 1;
          continue;
        }
        await rm(path, { force: true });
        removed += 1;
        onRemoved({
          key: relative(this.root, path).split(sep).join("/"),
          sizeBytes: info.size,
          ageMs: Math.round(ageMs),
        });
      }
    };
    await visit(this.root, 0);
    return { removed, keptFresh };
  }
}

/** The configured store; the S3-compatible adapter is not part of P2 (ADR-0010 §3). */
export function evidenceStoreFor(config: { driver: "filesystem" | "s3"; path: string }): EvidenceStore {
  if (config.driver === "filesystem") return new FilesystemEvidenceStore(config.path);
  const unavailable = async (): Promise<never> => {
    throw new EvidenceStoreUnavailable("The S3-compatible evidence store is not available in this release (P6).");
  };
  return {
    put: unavailable,
    receive: unavailable,
    finalise: unavailable,
    get: unavailable,
    head: unavailable,
    discardUncommitted: async () => undefined,
    sweepStaleTemporaries: async () => ({ removed: 0, keptFresh: 0 }),
  };
}
