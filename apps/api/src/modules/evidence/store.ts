// EvidenceStore (ADR-0010): the bytes of file evidence live outside the database, in a private store that is never
// web-served. P2 ships the filesystem adapter (EVIDENCE_STORAGE_DRIVER=filesystem): an atomic write (temporary file,
// fsync, rename) with the SHA-256 and size computed WHILE streaming, and reads only through the API route that applies
// the parent record's authorization. Keys are opaque (organization/transformation/evidence/UUIDv7), never user
// filenames. The optional S3-compatible adapter is a P6 increment (IT approval, licence review); configuring it here
// makes every content operation 503 (never a silent fallback).
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** Hard ceiling of the evidence_content.size_bytes CHECK is 1 GiB; the API accepts at most this much per upload. */
export const EVIDENCE_MAX_BYTES = 25 * 1024 * 1024;

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
      await handle.close();
      await rm(temp, { force: true });
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
  };
}
