// P7 (T-DG7-BE-B; ADR-0069 §2; p7-work-split §B.1; REQ-S19-010): the evidence-storage readiness probe.
//
// The probe answers whether the EFFECTIVE evidence store (ADR-0054 §2: the saved `storage_setting` row, else the
// environment default) can serve evidence now:
//   - filesystem: the root exists, is a directory, and is readable and writable by this process
//     (`fs.stat` + `fs.access(R_OK | W_OK)`);
//   - s3: an adapter built from the effective setting answers `head("mth-readiness-probe")` within 2 000 ms. An object
//     or "no such key" (null) is `ok`; an exception, a timeout or an incomplete setting (no adapter can be built) is
//     `fail`.
// The result carries the status, the driver and the source, plus a short error CODE for the platform's one log line
// per state change. It never carries an endpoint, bucket, path, SecretRef name or error text, so nothing the probe
// returns can leak through the public /readyz.
// The result is cached for 5 s per process (and concurrent callers share one probe), so a poller causes at most one
// storage call per 5 s per API instance. The setting is read through the Kysely `db` (a pooled query that releases its
// client when it returns), so NO pool client is held while the S3 call runs (D-141).
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { registerRedactedStorageEndpoint } from "@mth/config";
import type { DbOrTx } from "@mth/db";
import {
  EvidenceStoreUnavailable,
  loadEffectiveStorage,
  s3SettingsKey,
  type EnvironmentStorage,
  type S3StorageSettings,
  type StorageDriver,
} from "./store.ts";
import { S3EvidenceStore, type SecretResolver } from "./stores/s3.ts";

/** The key the S3 probe heads (it need not exist: "not found" is a valid answer). */
export const READINESS_PROBE_KEY = "mth-readiness-probe";
/** ADR-0069 §2: the S3 probe must answer within this. */
export const STORAGE_PROBE_TIMEOUT_MS = 2_000;
/** ADR-0069 §2: one storage call per this long per process at most. */
export const STORAGE_PROBE_CACHE_MS = 5_000;

export interface StorageProbeResult {
  readonly status: "ok" | "fail";
  readonly driver: StorageDriver;
  readonly source: "environment" | "setting";
  /**
   * On `fail`, a short error code for the operator log line (`ENOENT`, `EACCES`, `ENOTDIR`, `EROFS`, `Timeout`,
   * `NotConfigured`, `SettingUnreadable`, or the store's own error name); null on `ok`. A code, never error text.
   */
  readonly errorCode: string | null;
}

export interface EvidenceStorageProbeOptions {
  readonly environment: EnvironmentStorage;
  /** The process's SecretProvider registry (read at probe time; server.ts creates it after the route lines). */
  readonly secrets: () => SecretResolver;
  readonly timeoutMs?: number;
  readonly cacheMs?: number;
  /** Monotonic milliseconds (tests). */
  readonly now?: () => number;
}

export type EvidenceStorageProbe = (db: DbOrTx) => Promise<StorageProbeResult>;

const CODE = /^[A-Za-z0-9_.-]{1,64}$/;

/** A filesystem error's code (ENOENT, EACCES, ...), else "Error". Never the message, which names the path. */
function fsCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && CODE.test(code) ? code : "Error";
}

/**
 * The S3 failure's code. The adapter's EvidenceStoreUnavailable message has the form
 * "The object store refused or failed HeadObject (<Code>[ <status>])." and names no URL, bucket, key or credential;
 * only the code part is kept. Anything else is "Error".
 */
function s3Code(err: unknown): string {
  if (err instanceof EvidenceStoreUnavailable) {
    const m = /\(([A-Za-z0-9_.-]{1,64})(?: [0-9]{3})?\)\.$/.exec(err.message);
    if (m) return m[1]!;
    if (/credential references do not resolve/.test(err.message)) return "CredentialUnresolved";
    return "StoreUnavailable";
  }
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === "string" && CODE.test(name) && name !== "Error" ? name : "Error";
}

/** The filesystem rule: a readable and writable directory. */
async function probeFilesystem(path: string): Promise<string | null> {
  try {
    const s = await stat(path);
    if (!s.isDirectory()) return "ENOTDIR";
    await access(path, constants.R_OK | constants.W_OK);
    return null;
  } catch (err) {
    return fsCode(err);
  }
}

class ProbeTimeout extends Error {
  constructor() {
    super("timeout");
    this.name = "Timeout";
  }
}

/** Creates the process's probe (one cache per API process). */
export function createEvidenceStorageProbe(options: EvidenceStorageProbeOptions): EvidenceStorageProbe {
  const timeoutMs = options.timeoutMs ?? STORAGE_PROBE_TIMEOUT_MS;
  const cacheMs = options.cacheMs ?? STORAGE_PROBE_CACHE_MS;
  const now = options.now ?? (() => performance.now());
  let cached: { at: number; result: StorageProbeResult } | null = null;
  let inFlight: Promise<StorageProbeResult> | null = null;
  // The probe's own adapter: one attempt, connection and request bounded by the probe timeout, so a dead store is not
  // retried by the SDK inside the 2 000 ms window. Rebuilt when the saved setting changes.
  let adapter: { key: string; store: S3EvidenceStore } | null = null;

  const s3Adapter = (s3: S3StorageSettings): S3EvidenceStore => {
    const key = s3SettingsKey(s3);
    if (adapter?.key !== key) {
      // Any URL on the store's host is logged as "[storage-url]" from now on (as s3EvidenceStoreFor does).
      registerRedactedStorageEndpoint(s3.endpoint);
      adapter = {
        key,
        store: new S3EvidenceStore({
          endpoint: s3.endpoint,
          region: s3.region,
          bucket: s3.bucket,
          keyPrefix: s3.keyPrefix,
          forcePathStyle: s3.forcePathStyle,
          accessKeyRef: s3.accessKeyRef,
          secretKeyRef: s3.secretKeyRef,
          secrets: options.secrets(),
          maxAttempts: 1,
          requestTimeoutMs: timeoutMs,
          connectionTimeoutMs: timeoutMs,
        }),
      };
    }
    return adapter.store;
  };

  const probeS3 = async (s3: S3StorageSettings | null): Promise<string | null> => {
    if (s3 === null) return "NotConfigured";
    let store: S3EvidenceStore;
    try {
      store = s3Adapter(s3);
    } catch {
      return "NotConfigured";
    }
    let timer: NodeJS.Timeout | undefined;
    const head = store.head(READINESS_PROBE_KEY);
    head.catch(() => undefined); // a late failure after the timeout is not an unhandled rejection
    try {
      await Promise.race([
        head,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ProbeTimeout()), timeoutMs);
          timer.unref();
        }),
      ]);
      return null; // an object or null ("no such key") both prove the store answers
    } catch (err) {
      return err instanceof ProbeTimeout ? "Timeout" : s3Code(err);
    } finally {
      clearTimeout(timer);
    }
  };

  const run = async (db: DbOrTx): Promise<StorageProbeResult> => {
    let effective;
    try {
      // A pooled query: its client is released before any remote call below (D-141).
      effective = await loadEffectiveStorage(db, options.environment);
    } catch {
      return {
        status: "fail",
        driver: options.environment.driver,
        source: "environment",
        errorCode: "SettingUnreadable",
      };
    }
    const errorCode =
      effective.driver === "filesystem" ? await probeFilesystem(options.environment.path) : await probeS3(effective.s3);
    return {
      status: errorCode === null ? "ok" : "fail",
      driver: effective.driver,
      source: effective.source,
      errorCode,
    };
  };

  return async (db) => {
    if (cached !== null && now() - cached.at < cacheMs) return cached.result;
    if (inFlight === null)
      inFlight = run(db)
        .then((result) => {
          cached = { at: now(), result };
          return result;
        })
        .finally(() => {
          inFlight = null;
        });
    return inFlight;
  };
}
