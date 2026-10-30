// EvidenceStore (ADR-0010, ADR-0054 §2): the bytes of file evidence live outside the database, in a private store that
// is never web-served. Two adapters implement the one port below and pass the one contract suite (stores/contract.ts):
// the filesystem adapter (an atomic write: temporary file, fsync, rename) and, from P6, the S3-compatible adapter
// (stores/s3.ts). Both compute the SHA-256 and size WHILE streaming, and every read goes through the API route that
// applies the parent record's authorization: never a public or pre-signed URL, never an ACL, never a redirect. Keys are
// opaque (organization/transformation/evidence/UUIDv7), never user filenames.
// P6 (T-DG6-BE-H2): the driver is selected per upload from the saved `storage_setting` row, else the environment default
// (EVIDENCE_STORAGE_DRIVER; filesystem in every shipped profile, so with no row the behaviour equals DG5). Each content
// row records the driver that wrote its bytes (`evidence_content.storage_driver`) and every read opens that store, so a
// driver change affects new uploads only and never strands an earlier file. `s3` chosen through the environment alone
// (no saved setting with an endpoint, bucket and credential references) makes every s3 content operation 503 (never a
// silent fallback to another store).
import type { Db, DbOrTx, StorageSettingTable } from "@mth/db";
import type { Selectable } from "kysely";
import type { SecretRef } from "../platform/index.ts";
import { FilesystemEvidenceStore } from "./stores/filesystem.ts";
import { S3EvidenceStore, type SecretResolver } from "./stores/s3.ts";

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

// ------------------------------------------------------------------------------------------------ driver selection
// P6 (T-DG6-BE-H2; ADR-0054 §2; REQ-S16-006).

export type StorageDriver = "filesystem" | "s3";

/** The S3-compatible settings of `storage_setting` (credential REFERENCES only, never values; ADR-0052 §5). */
export interface S3StorageSettings {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly keyPrefix: string | null;
  readonly forcePathStyle: boolean;
  readonly accessKeyRef: SecretRef;
  readonly secretKeyRef: SecretRef;
}

/** The environment default of ADR-0010/ADR-0011 (`config.evidenceStorage`). */
export interface EnvironmentStorage {
  readonly driver: StorageDriver;
  readonly path: string;
}

/** The effective setting: the saved row, else the environment default (version 0). */
export interface EffectiveStorage {
  readonly driver: StorageDriver;
  readonly source: "environment" | "setting";
  readonly s3: S3StorageSettings | null;
  readonly reason: string | null;
  readonly version: number;
  readonly updatedAt: Date | null;
  readonly id: string | null;
}

function asSecretRef(value: unknown): SecretRef | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return typeof v["provider"] === "string" && typeof v["name"] === "string"
    ? { provider: v["provider"], name: v["name"] }
    : null;
}

/** The s3 settings a `storage_setting` row holds, or null when it holds none (they are kept with driver filesystem). */
export function s3SettingsOf(row: Selectable<StorageSettingTable>): S3StorageSettings | null {
  const accessKeyRef = asSecretRef(row.s3_access_key_ref);
  const secretKeyRef = asSecretRef(row.s3_secret_key_ref);
  if (row.s3_endpoint === null || row.s3_region === null || row.s3_bucket === null) return null;
  if (accessKeyRef === null || secretKeyRef === null) return null;
  return {
    endpoint: row.s3_endpoint,
    region: row.s3_region,
    bucket: row.s3_bucket,
    keyPrefix: row.s3_key_prefix,
    forcePathStyle: row.s3_force_path_style,
    accessKeyRef,
    secretKeyRef,
  };
}

/** Reads the effective storage setting (one row at most; the 0102 singleton). */
export async function loadEffectiveStorage(db: DbOrTx, environment: EnvironmentStorage): Promise<EffectiveStorage> {
  const row = await db.selectFrom("storage_setting").selectAll().executeTakeFirst();
  if (!row)
    return {
      driver: environment.driver,
      source: "environment",
      s3: null,
      reason: null,
      version: 0,
      updatedAt: null,
      id: null,
    };
  return {
    driver: row.driver === "s3" ? "s3" : "filesystem",
    source: "setting",
    s3: s3SettingsOf(row),
    reason: row.reason,
    version: row.version,
    updatedAt: row.updated_at,
    id: row.id,
  };
}

/** A canonical text of s3 settings (cache key of an adapter; the test-pass record of admin/storage.ts). */
export function s3SettingsKey(s3: S3StorageSettings): string {
  return JSON.stringify([
    s3.endpoint,
    s3.region,
    s3.bucket,
    s3.keyPrefix,
    s3.forcePathStyle,
    s3.accessKeyRef.provider,
    s3.accessKeyRef.name,
    s3.secretKeyRef.provider,
    s3.secretKeyRef.name,
  ]);
}

/** An S3 adapter for these settings, the credentials resolved through the SecretProvider at request time. */
export function s3EvidenceStoreFor(s3: S3StorageSettings, secrets: SecretResolver): S3EvidenceStore {
  return new S3EvidenceStore({
    endpoint: s3.endpoint,
    region: s3.region,
    bucket: s3.bucket,
    keyPrefix: s3.keyPrefix,
    forcePathStyle: s3.forcePathStyle,
    accessKeyRef: s3.accessKeyRef,
    secretKeyRef: s3.secretKeyRef,
    secrets,
  });
}

const unavailableS3 = (): EvidenceStoreUnavailable =>
  new EvidenceStoreUnavailable(
    "The S3-compatible evidence store (P6, ADR-0054 §2) is selected, but no saved storage setting gives its endpoint, bucket and credential references.",
  );

/** A store whose content operations are all unavailable (503), never a silent fallback to another store. */
function unavailableStore(error: () => Error): EvidenceStore {
  const fail = async (): Promise<never> => {
    throw error();
  };
  return {
    put: fail,
    receive: fail,
    finalise: fail,
    get: fail,
    head: fail,
    discardUncommitted: async () => undefined,
    sweepStaleTemporaries: async () => ({ removed: 0, keptFresh: 0 }),
  };
}

/**
 * The store of the environment default alone (no database): filesystem, or (s3 named through the environment only)
 * a store whose every content operation is 503. Kept for tools and tests; the API process uses
 * SelectingEvidenceStore.
 */
export function evidenceStoreFor(config: EnvironmentStorage): EvidenceStore {
  if (config.driver === "filesystem") return new FilesystemEvidenceStore(config.path);
  return unavailableStore(unavailableS3);
}

export interface SelectingEvidenceStoreOptions {
  readonly db: Db;
  readonly environment: EnvironmentStorage;
  /** The process's SecretProvider registry (read at request time; server.ts creates it after the route lines). */
  readonly secrets: () => SecretResolver;
}

/**
 * The API's EvidenceStore (ADR-0054 §2, "which store holds a file"):
 *  - a WRITE (`receive`, `put`) uses the driver of the effective setting read at that moment, and remembers it for the
 *    key, so `finalise`, `discardUncommitted` and the upload's `storage_driver` column use the same store even if the
 *    setting changes while the body streams;
 *  - a READ (`get`, `head`) opens the store that the key's `evidence_content.storage_driver` names, so files written
 *    before a driver change stay readable. A key with no content row reads from the filesystem store (the DG5
 *    behaviour: every row stored before P6 is filesystem).
 * The s3 adapter is built from the saved setting's s3 values (kept when the driver is switched back to filesystem, so
 * earlier s3 files stay readable); without them an s3 operation is 503. Copying files between stores is not in P6.
 */
export class SelectingEvidenceStore implements EvidenceStore {
  private readonly db: Db;
  private readonly environment: EnvironmentStorage;
  private readonly secrets: () => SecretResolver;
  private readonly filesystem: FilesystemEvidenceStore;
  /** Received, not yet settled uploads: key -> the driver that holds its bytes. */
  private readonly pending = new Map<string, StorageDriver>();
  private s3Cache: { key: string; store: S3EvidenceStore } | null = null;

  constructor(options: SelectingEvidenceStoreOptions) {
    this.db = options.db;
    this.environment = options.environment;
    this.secrets = options.secrets;
    this.filesystem = new FilesystemEvidenceStore(options.environment.path);
  }

  /** The store for a driver, under the current setting's s3 values. */
  async storeFor(driver: StorageDriver, effective?: EffectiveStorage): Promise<EvidenceStore> {
    if (driver === "filesystem") return this.filesystem;
    const current = effective ?? (await loadEffectiveStorage(this.db, this.environment));
    if (current.s3 === null) return unavailableStore(unavailableS3);
    const cacheKey = s3SettingsKey(current.s3);
    if (this.s3Cache?.key !== cacheKey)
      this.s3Cache = { key: cacheKey, store: s3EvidenceStoreFor(current.s3, this.secrets()) };
    return this.s3Cache.store;
  }

  /** The driver a new upload uses now: the saved setting, else the environment default. */
  async currentWriteDriver(): Promise<StorageDriver> {
    return (await loadEffectiveStorage(this.db, this.environment)).driver;
  }

  /** The driver holding a received upload's bytes (the value of its `evidence_content.storage_driver`). */
  driverOf(key: string): StorageDriver {
    return this.pending.get(key) ?? "filesystem";
  }

  /** Forgets a received upload once its content row is committed (the route's last step). */
  settle(key: string): void {
    this.pending.delete(key);
  }

  private async readStore(key: string): Promise<EvidenceStore> {
    const pending = this.pending.get(key);
    if (pending !== undefined) return this.storeFor(pending);
    const row = await this.db
      .selectFrom("evidence_content")
      .select("storage_driver")
      .where("storage_key", "=", key)
      .executeTakeFirst();
    return this.storeFor(row?.storage_driver === "s3" ? "s3" : "filesystem");
  }

  async put(key: string, body: EvidenceBody, maxBytes: number): Promise<StoredObject> {
    const stored = await this.receive(key, body, maxBytes);
    await this.finalise(key);
    return stored;
  }

  async receive(key: string, body: EvidenceBody, maxBytes: number): Promise<StoredObject> {
    const effective = await loadEffectiveStorage(this.db, this.environment);
    const store = await this.storeFor(effective.driver, effective);
    this.pending.set(key, effective.driver);
    try {
      return await store.receive(key, body, maxBytes);
    } catch (err) {
      this.pending.delete(key);
      throw err;
    }
  }

  async finalise(key: string): Promise<void> {
    await (await this.storeFor(this.driverOf(key))).finalise(key);
  }

  async get(key: string): Promise<AsyncIterable<Uint8Array>> {
    return (await this.readStore(key)).get(key);
  }

  async head(key: string): Promise<{ size: number } | null> {
    return (await this.readStore(key)).head(key);
  }

  async discardUncommitted(key: string): Promise<void> {
    const driver = this.driverOf(key);
    this.pending.delete(key);
    await (await this.storeFor(driver)).discardUncommitted(key);
  }

  /** Sweeps the filesystem store, and the s3 store when a saved setting gives its values. */
  async sweepStaleTemporaries(
    olderThanMs: number,
    onRemoved: (removed: RemovedTemporary) => void,
  ): Promise<SweepResult> {
    const fs = await this.filesystem.sweepStaleTemporaries(olderThanMs, onRemoved);
    const effective = await loadEffectiveStorage(this.db, this.environment);
    if (effective.s3 === null) return fs;
    const s3 = await (await this.storeFor("s3", effective)).sweepStaleTemporaries(olderThanMs, onRemoved);
    return { removed: fs.removed + s3.removed, keptFresh: fs.keptFresh + s3.keptFresh };
  }
}

/** The driver that holds a received upload's bytes, for any store (an injected test store is filesystem-like). */
export function storageDriverOf(store: EvidenceStore, key: string): StorageDriver {
  if (store instanceof SelectingEvidenceStore) return store.driverOf(key);
  if (store instanceof S3EvidenceStore) return "s3";
  return "filesystem";
}

/**
 * True when `finalise` is local I/O (the filesystem rename) and may stay the last step inside the upload's
 * transaction (T-DG2-BE17). An object-store finalise (copy + delete) is remote I/O and runs before the transaction
 * (§2 rule 4); a crash between it and the commit leaves an unreferenced object, never a row without its bytes.
 */
export function finalisesLocally(store: EvidenceStore, key: string): boolean {
  return storageDriverOf(store, key) === "filesystem";
}

/** Forgets a settled upload (no-op for a store that keeps no per-upload state). */
export function settleUpload(store: EvidenceStore, key: string): void {
  if (store instanceof SelectingEvidenceStore) store.settle(key);
}

/** The store a storage test probes (admin/storage.ts, through server.ts): a candidate's, never the selecting store. */
export function storageTestTarget(
  driver: StorageDriver,
  s3: S3StorageSettings | null,
  environment: EnvironmentStorage,
  secrets: SecretResolver,
): EvidenceStore & { anonymousReadRefused?(key: string): Promise<boolean>; destroy?(): void } {
  if (driver === "filesystem") return new FilesystemEvidenceStore(environment.path);
  if (s3 === null) return unavailableStore(unavailableS3);
  return s3EvidenceStoreFor(s3, secrets);
}
