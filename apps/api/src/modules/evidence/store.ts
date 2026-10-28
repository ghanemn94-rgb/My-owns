// EvidenceStore (ADR-0010): the bytes of file evidence live outside the database, in a private store that is never
// web-served. P2 ships the filesystem adapter (EVIDENCE_STORAGE_DRIVER=filesystem): an atomic write (temporary file,
// fsync, rename) with the SHA-256 and size computed WHILE streaming, and reads only through the API route that applies
// the parent record's authorization. Keys are opaque (organization/transformation/evidence/UUIDv7), never user
// filenames. The optional S3-compatible adapter is a P6 increment (IT approval, licence review); configuring it here
// makes every content operation 503 (never a silent fallback).
import { FilesystemEvidenceStore } from "./stores/filesystem.ts";

// T-DG6-BE-H: the adapters live in ./stores/ (filesystem.ts; s3.ts, the S3-compatible adapter of ADR-0054 §2, with the
// one contract suite both pass in stores/contract.ts). Re-exported so every importer of this file is unchanged.
export { FilesystemEvidenceStore };

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

/**
 * The port both adapters implement (ADR-0010, ADR-0054 §2: unchanged in P6): `stores/filesystem.ts` and `stores/s3.ts`,
 * each proven by the one contract suite `stores/contract.ts`. No method returns, and no adapter creates, a URL: never a
 * public or pre-signed URL and never an ACL; every byte goes through the API route that authorizes the parent record.
 */
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
