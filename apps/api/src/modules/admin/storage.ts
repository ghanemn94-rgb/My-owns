// P6 slice C (T-DG6-BE-H2; ADR-0054 §2, §4, §5; REQ-S16-006): Administration > Storage, the installation's evidence
// storage setting.
//   GET  /api/v1/admin/storage       getStorageSetting   (storage.configure or operations.read; ETag "0" = never saved)
//   PUT  /api/v1/admin/storage       putStorageSetting   (storage.configure; IfMatchOrZero; reason; a passing test)
//   POST /api/v1/admin/storage/test  testStorageSetting  (storage.configure; outside any transaction)
// The rules:
//  - Storage is installation-wide (one `storage_setting` row at most). Authorization (ADR-0054 §5): the permission held
//    at ORGANIZATION scope in at least one organization; `storage.configure` (ADM_TECH) reads, changes and tests,
//    `operations.read` (AUD, ADM_TECH, TO) reads only, so AUD gets 403 on PUT and test. A write re-checks the grant at
//    commit time, inside the transaction, after the lock (§2 rule 4).
//  - No row = the environment default (EVIDENCE_STORAGE_DRIVER; filesystem in every shipped profile): DG5 behaviour.
//    A saved driver affects NEW uploads only; every content row names the store that holds its bytes.
//  - Credentials are SecretRefs ({provider, name}), never values; a string or any other shape is 422
//    `storage.secret_ref_invalid`, and so is a provider this process has not registered.
//  - Saving `s3` needs a passing `testStorageSetting` of the same values within the last 15 minutes in this API process
//    (422 `storage.test_required`). `filesystem` (the environment's own store) needs none, unless the body changes the
//    s3 values kept with it (they read the earlier s3 files): then those values need a passing test as well.
//  - The test runs OUTSIDE any transaction, under the `storageSetting` advisory lock class (a session lock on one connection, so a PUT's
//    transaction lock and a test never interleave): write a probe object, read it back, compare its checksum, check
//    (s3) that an unauthenticated GET is refused, delete it. Its audit event `storage_setting.tested` holds the outcome
//    and the check names only. The response never contains a URL, a key, an endpoint or a credential.
//  - Every PUT writes one audit event `storage_setting.changed` with the prior and new version and the reason, in the
//    same transaction; the history row is written by the 0102 trigger. If-Match is required (428), stale is 409, `"0"`
//    creates the row (a concurrent create is 409 through ON CONFLICT DO NOTHING).
//  - Evidence is never served from a public URL in either mode (`publicUrls` is always false): bytes are proxied by the
//    API route that authorizes the parent record. Nothing here is a business approval or touches DG0-DG7. The IT
//    object store is a configuration slot Mobily IT fills; this adapter is proven only against the in-process fake S3.
import { createHash, randomBytes } from "node:crypto";
import { reason as reasonRule } from "@mth/shared/schemas";
import { sql, type Db, type DbOrTx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { record as audit } from "../audit/index.ts";
import {
  auditContextOf,
  authorize,
  commitTimeDenial,
  organizationsWith,
  principalOf,
  refreshPrincipal,
  type Principal,
} from "../access/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  etag,
  HttpProblem,
  iso,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  type ModuleDeps,
  type SecretProviderRegistry,
} from "../platform/index.ts";

// ------------------------------------------------------------------------------------------------ the storage port
// admin may not import evidence (ADR-0002; modules.ts): server.ts injects the setting read and the test target of
// evidence/store.ts through StorageAdminRouteOptions. The shapes below are the structural subset this file needs.

type StorageDriver = "filesystem" | "s3";
interface StorageSecretRef {
  readonly provider: string;
  readonly name: string;
}
interface S3Settings {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly keyPrefix: string | null;
  readonly forcePathStyle: boolean;
  readonly accessKeyRef: StorageSecretRef;
  readonly secretKeyRef: StorageSecretRef;
}
interface EffectiveStorageLike {
  readonly driver: StorageDriver;
  readonly source: "environment" | "setting";
  readonly s3: S3Settings | null;
  readonly reason: string | null;
  readonly version: number;
  readonly updatedAt: Date | null;
  readonly id: string | null;
}
interface ProbeStore {
  put(key: string, body: Uint8Array, maxBytes: number): Promise<{ sha256: string; size: number }>;
  get(key: string): Promise<AsyncIterable<Uint8Array>>;
  head(key: string): Promise<{ size: number } | null>;
  discardUncommitted(key: string): Promise<void>;
  anonymousReadRefused?(key: string): Promise<boolean>;
  destroy?(): void;
}

/** What server.ts injects from evidence/store.ts (loadEffectiveStorage, s3SettingsKey, storageTestTarget). */
export interface StoragePort {
  load(db: DbOrTx): Promise<EffectiveStorageLike>;
  settingsKey(s3: S3Settings): string;
  testTarget(driver: StorageDriver, s3: S3Settings | null): ProbeStore;
}

export interface StorageAdminRouteOptions {
  /** The process's SecretProvider registry (server.ts creates it after the route lines; read at request time). */
  readonly secrets: () => SecretProviderRegistry;
  readonly storage: StoragePort;
  /** Clock of the 15-minute test window (tests). */
  readonly now?: () => number;
}

const CONFIGURE: Permission = "storage.configure";
const READ: Permission = "operations.read";
const JSON_BODY = ["application/json"] as const;
const ITEM = "/api/v1/admin/storage";
const TEST = "/api/v1/admin/storage/test";
/** ADR-0054 §2: a passing test admits a save of the same values for 15 minutes, in this API process. */
export const STORAGE_TEST_VALID_MS = 15 * 60 * 1000;
const PROBE_BYTES = 64;

// ------------------------------------------------------------------------------------------------ schemas (the mirrors)

export const storageSecretRef = z.strictObject({
  provider: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_./-]{0,127}$/),
});
/** The 0102 column rules (checked here so a malformed value is a 400, never a database error). */
const ENDPOINT = /^https?:\/\/[^/?#@\s]+(:[0-9]{1,5})?\/?$/;
const REGION = /^[a-z0-9][a-z0-9-]{0,62}$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const KEY_PREFIX = /^[a-z0-9][a-z0-9_/-]{0,99}$/;
/** Mirror of `StorageS3Input` (docs/api/openapi.yaml). */
export const storageS3View = z.strictObject({
  endpoint: z
    .string()
    .max(300)
    .regex(/^https?:\/\//),
  region: z.string().regex(REGION),
  bucket: z.string().regex(BUCKET),
  keyPrefix: z.string().regex(KEY_PREFIX).nullable(),
  forcePathStyle: z.boolean(),
  accessKeyRef: storageSecretRef,
  secretKeyRef: storageSecretRef,
});
/** Response mirror of `StorageSetting`. */
export const storageSettingView = z.strictObject({
  driver: z.enum(["filesystem", "s3"]),
  source: z.enum(["environment", "setting"]),
  s3: storageS3View.nullable(),
  publicUrls: z.literal(false),
  reason: z.string().nullable(),
  version: z.number().int().min(0),
  updatedAt: z.string().nullable(),
});
export const STORAGE_TEST_CHECKS = ["write", "read_back", "checksum", "delete", "anonymous_read_refused"] as const;
export type StorageTestCheck = (typeof STORAGE_TEST_CHECKS)[number];
/** Response mirror of `StorageTestResult`. */
export const storageTestResult = z.strictObject({
  outcome: z.enum(["passed", "failed"]),
  driver: z.enum(["filesystem", "s3"]),
  checks: z.array(
    z.strictObject({ name: z.enum(STORAGE_TEST_CHECKS), outcome: z.enum(["passed", "failed", "skipped"]) }),
  ),
  errorCode: z.string().nullable(),
  durationMs: z.number().int().min(0),
  testedAt: z.string(),
});
export type StorageSettingView = z.infer<typeof storageSettingView>;
export type StorageTestResult = z.infer<typeof storageTestResult>;

const s3Input = z.strictObject({
  endpoint: z.string().max(300).regex(ENDPOINT, "validation.url"),
  region: z.string().regex(REGION),
  bucket: z.string().regex(BUCKET),
  keyPrefix: z.string().regex(KEY_PREFIX).nullable(),
  forcePathStyle: z.boolean(),
  // The reference shape is checked after parsing, so a secret value given in its place is the ADR-0054 §4 refusal.
  accessKeyRef: z.unknown(),
  secretKeyRef: z.unknown(),
});
export const storageSettingUpdate = z.strictObject({
  driver: z.enum(["filesystem", "s3"]),
  s3: s3Input.nullable(),
  // The contract's string (400 otherwise); the reason rule is the 422 admin.reason_required below.
  reason: z.string(),
});
const testRequest = z.strictObject({ candidate: s3Input.nullable() });
const noQuery = z.strictObject({});

// ------------------------------------------------------------------------------------------------ refusals (ADR-0054 §4)

const rule = (code: string, detail: string, pointer?: string) =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    ...(pointer === undefined ? {} : { errors: [{ pointer, code, message: detail }] }),
  });

/** The exact refusals of ADR-0054 §4 used by this file (codes are i18n keys under `problems.`). */
export const storageRefusals = {
  s3Incomplete: () =>
    rule(
      "storage.s3_incomplete",
      "The object store needs an endpoint, a region, a bucket and both credential references.",
      "/s3",
    ),
  secretRefInvalid: (pointer: string) =>
    rule(
      "storage.secret_ref_invalid",
      "A credential must be a reference to a secret (provider and name), never the secret itself.",
      pointer,
    ),
  testRequired: () =>
    rule("storage.test_required", "Run a successful storage test with these settings before saving them."),
  reasonRequired: () => rule("admin.reason_required", "Enter a reason of 3 to 1,000 characters.", "/reason"),
} as const;

// ------------------------------------------------------------------------------------------------ helpers

/** The s3 values of a body: each credential a SecretRef of a registered provider (422 otherwise). */
export function checkedS3(input: z.infer<typeof s3Input>, providers: readonly string[], pointer: string): S3Settings {
  const refOf = (value: unknown, field: "accessKeyRef" | "secretKeyRef"): StorageSecretRef => {
    const ref = storageSecretRef.safeParse(value);
    if (!ref.success || !providers.includes(ref.data.provider))
      throw storageRefusals.secretRefInvalid(`${pointer}/${field}`);
    return ref.data;
  };
  const accessKeyRef = refOf(input.accessKeyRef, "accessKeyRef");
  const secretKeyRef = refOf(input.secretKeyRef, "secretKeyRef");
  return {
    endpoint: input.endpoint,
    region: input.region,
    bucket: input.bucket,
    keyPrefix: input.keyPrefix,
    forcePathStyle: input.forcePathStyle,
    accessKeyRef,
    secretKeyRef,
  };
}

/** The validated values of a PUT body (the ADR-0054 §4 business rules except the test window). */
export function checkedStorageUpdate(
  body: z.infer<typeof storageSettingUpdate>,
  providers: readonly string[],
): { driver: StorageDriver; s3: S3Settings | null; reason: string } {
  const reason = reasonRule.safeParse(body.reason);
  if (!reason.success) throw storageRefusals.reasonRequired();
  if (body.driver === "s3" && body.s3 === null) throw storageRefusals.s3Incomplete();
  // With driver filesystem, s3 values may be kept (so earlier s3 files stay readable after switching back).
  const s3 = body.s3 === null ? null : checkedS3(body.s3, providers, "/s3");
  return { driver: body.driver, s3, reason: reason.data };
}

export function toStorageView(effective: EffectiveStorageLike): StorageSettingView {
  return {
    driver: effective.driver,
    source: effective.source,
    s3: effective.s3
      ? {
          endpoint: effective.s3.endpoint,
          region: effective.s3.region,
          bucket: effective.s3.bucket,
          keyPrefix: effective.s3.keyPrefix,
          forcePathStyle: effective.s3.forcePathStyle,
          accessKeyRef: { provider: effective.s3.accessKeyRef.provider, name: effective.s3.accessKeyRef.name },
          secretKeyRef: { provider: effective.s3.secretKeyRef.provider, name: effective.s3.secretKeyRef.name },
        }
      : null,
    publicUrls: false,
    reason: effective.reason,
    version: effective.version,
    updatedAt: effective.updatedAt ? iso(effective.updatedAt) : null,
  };
}

/**
 * The organization in which the principal holds `permission` at organization scope (installation-wide settings,
 * ADR-0054 §5), or null. A grant at business-unit or transformation scope never admits it.
 */
async function organizationScopeHolding(db: DbOrTx, principal: Principal, permission: Permission) {
  for (const organizationId of organizationsWith(principal, permission))
    if ((await authorize(db, principal, permission, { type: "organization", id: organizationId })).allowed)
      return organizationId;
  return null;
}

async function requireRead(db: DbOrTx, principal: Principal): Promise<void> {
  if ((await organizationScopeHolding(db, principal, CONFIGURE)) !== null) return;
  if ((await organizationScopeHolding(db, principal, READ)) !== null) return;
  throw problems.forbidden();
}

/** 403 unless `storage.configure` is held at organization scope somewhere; returns that organization (audit). */
async function requireConfigure(db: DbOrTx, principal: Principal): Promise<string> {
  const organizationId = await organizationScopeHolding(db, principal, CONFIGURE);
  if (organizationId === null) throw problems.forbidden();
  return organizationId;
}

/** If-Match of a defaulted record: `"0"` names "never saved" (IfMatchOrZero). */
function ifMatchOrZero(request: FastifyRequest): number {
  return request.headers["if-match"] === '"0"' ? 0 : requireIfMatch(request);
}

function sendSetting(reply: FastifyReply, view: StorageSettingView) {
  reply.header("ETag", view.version >= 1 ? etag(view.version) : '"0"');
  return reply.code(200).send(view);
}

function versionConflict(currentVersion: number | null): HttpProblem {
  if (currentVersion !== null) return problems.versionConflict(currentVersion);
  return new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.versionConflict,
    code: "version_conflict",
    title: "Version conflict",
    detail: "The record was changed by someone else. Review the current version and re-apply your change.",
  });
}

const refText = (r: StorageSecretRef | null | undefined) => (r ? `${r.provider}:${r.name}` : null);

/** The audit `changes` of a PUT (never a secret value; audit field names never name a secret). */
function changesOf(before: EffectiveStorageLike | null, after: { driver: StorageDriver; s3: S3Settings | null }) {
  const pick = (r: { driver: StorageDriver; s3: S3Settings | null } | null) => ({
    driver: r ? r.driver : null,
    s3_endpoint: r?.s3?.endpoint ?? null,
    s3_region: r?.s3?.region ?? null,
    s3_bucket: r?.s3?.bucket ?? null,
    s3_key_prefix: r?.s3?.keyPrefix ?? null,
    s3_force_path_style: r?.s3 ? r.s3.forcePathStyle : null,
    s3_credential_refs: r?.s3 ? `${refText(r.s3.accessKeyRef)} ${refText(r.s3.secretKeyRef)}` : null,
  });
  const from = new Map<string, unknown>(Object.entries(pick(before)));
  return Object.fromEntries(
    Object.entries(pick(after))
      .filter(([k, to]) => before === null || from.get(k) !== to)
      .map(([k, to]) => [k, { from: from.get(k) ?? null, to }]),
  );
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * The storage test (ADR-0054 §2): write, read back, checksum, anonymous read refused (s3 only; while the probe exists,
 * so a 404 would fail it closed), delete. Each step after a failed one is `skipped`; the probe is always removed.
 * Error codes name the failed check only (never a URL, key or credential).
 */
export async function runStorageProbe(
  store: ProbeStore,
  driver: StorageDriver,
): Promise<{
  checks: { name: StorageTestCheck; outcome: "passed" | "failed" | "skipped" }[];
  errorCode: string | null;
}> {
  const outcomes = new Map<StorageTestCheck, "passed" | "failed" | "skipped">(
    STORAGE_TEST_CHECKS.map((c) => [c, "skipped"]),
  );
  if (driver === "filesystem") outcomes.set("anonymous_read_refused", "skipped");
  const key = `storage-test/${uuidv7()}/${uuidv7()}/${uuidv7()}`;
  const bytes = randomBytes(PROBE_BYTES);
  const expected = createHash("sha256").update(bytes).digest("hex");
  let errorCode: string | null = null;
  const step = async (name: StorageTestCheck, run: () => Promise<boolean>): Promise<boolean> => {
    if (errorCode !== null) return false;
    let ok = false;
    try {
      ok = await run();
    } catch {
      ok = false;
    }
    outcomes.set(name, ok ? "passed" : "failed");
    if (!ok)
      errorCode = name === "anonymous_read_refused" ? "storage.anonymous_read_allowed" : `storage.${name}_failed`;
    return ok;
  };
  let read: Buffer | null = null;
  try {
    await step("write", async () => {
      const stored = await store.put(key, bytes, PROBE_BYTES);
      return stored.size === PROBE_BYTES && stored.sha256 === expected;
    });
    await step("read_back", async () => {
      read = await collect(await store.get(key));
      return read.byteLength === PROBE_BYTES;
    });
    await step("checksum", async () => read !== null && createHash("sha256").update(read).digest("hex") === expected);
    if (driver === "s3")
      await step("anonymous_read_refused", async () => (await store.anonymousReadRefused?.(key)) === true);
    await step("delete", async () => {
      await store.discardUncommitted(key);
      return (await store.head(key)) === null;
    });
  } finally {
    // The probe never stays behind, whatever failed.
    await store.discardUncommitted(key).catch(() => undefined);
    store.destroy?.();
  }
  return { checks: STORAGE_TEST_CHECKS.map((name) => ({ name, outcome: outcomes.get(name)! })), errorCode };
}

/** Runs `work` holding the `storageSetting` lock as a SESSION lock on one connection: no transaction is open meanwhile. */
async function underStorageLock<T>(db: Db, work: () => Promise<T>): Promise<T> {
  return db.connection().execute(async (conn) => {
    await sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_CLASSES.storageSetting}::int4, hashtext('storage'))`.execute(
      conn,
    );
    try {
      return await work();
    } finally {
      await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_CLASSES.storageSetting}::int4, hashtext('storage'))`.execute(
        conn,
      );
    }
  });
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerStorageAdminRoutes(
  app: FastifyInstance,
  { db }: ModuleDeps,
  options: StorageAdminRouteOptions,
): string[] {
  const now = options.now ?? (() => Date.now());
  const providers = () => options.secrets().ids();
  /** Passed tests of this process: settings key -> time of the pass. */
  const passed = new Map<string, number>();
  const recentlyPassed = (s3: S3Settings): boolean => {
    const at = passed.get(options.storage.settingsKey(s3));
    return at !== undefined && now() - at <= STORAGE_TEST_VALID_MS;
  };

  // getStorageSetting: the effective setting; ETag "0" when none was saved.
  app.get(ITEM, { config: { access: { permission: CONFIGURE } } }, async (request, reply) => {
    parseQuery(noQuery, request.query);
    await requireRead(db, principalOf(request));
    return sendSetting(reply, toStorageView(await options.storage.load(db)));
  });

  // putStorageSetting: save the driver (and s3 values) with a reason (IfMatchOrZero).
  app.put(ITEM, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    parseQuery(noQuery, request.query);
    const principal = principalOf(request);
    // Request-start gate (403), then validation, the test window and If-Match, then the commit-time re-check.
    await requireConfigure(db, principal);
    const body = parseBody(storageSettingUpdate, request.body);
    const update = checkedStorageUpdate(body, providers());
    if (update.driver === "s3" && !recentlyPassed(update.s3!)) throw storageRefusals.testRequired();
    const expected = ifMatchOrZero(request);
    const view = await db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.storageSetting}::int4, hashtext('storage'))`.execute(
        tx,
      );
      const row = await tx.selectFrom("storage_setting").selectAll().forUpdate().executeTakeFirst();
      const fresh = await refreshPrincipal(tx, request);
      let organizationId: string;
      try {
        organizationId = await requireConfigure(tx, fresh);
      } catch (err) {
        throw commitTimeDenial(err);
      }
      if ((row?.version ?? 0) !== expected) throw versionConflict(row?.version ?? null);
      const before = row ? await options.storage.load(tx) : null;
      // T-DG6-BE-H2B: s3 values kept with driver filesystem are the ones earlier s3 files are read with, so CHANGING
      // them needs a passing test too (unchanged values, or none, need none: the filesystem store is the environment's).
      if (
        update.driver === "filesystem" &&
        update.s3 !== null &&
        (before === null ||
          before.s3 === null ||
          options.storage.settingsKey(before.s3) !== options.storage.settingsKey(update.s3)) &&
        !recentlyPassed(update.s3)
      )
        throw storageRefusals.testRequired();
      const me = fresh.userId!;
      const values = {
        driver: update.driver,
        s3_endpoint: update.s3?.endpoint ?? null,
        s3_region: update.s3?.region ?? null,
        s3_bucket: update.s3?.bucket ?? null,
        s3_key_prefix: update.s3?.keyPrefix ?? null,
        s3_force_path_style: update.s3?.forcePathStyle ?? true,
        s3_access_key_ref: update.s3 ? JSON.stringify(update.s3.accessKeyRef) : null,
        s3_secret_key_ref: update.s3 ? JSON.stringify(update.s3.secretKeyRef) : null,
        reason: update.reason,
      };
      let saved: { id: string; version: number } | undefined;
      if (row) {
        saved = await tx
          .updateTable("storage_setting")
          .set({ ...values, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: me })
          .where("id", "=", row.id)
          .where("version", "=", row.version)
          .returning(["id", "version"])
          .executeTakeFirstOrThrow();
      } else {
        saved = await tx
          .insertInto("storage_setting")
          .values({ id: uuidv7(), ...values, created_by: me, updated_by: me })
          .onConflict((oc) => oc.constraint("storage_setting_singleton_key").doNothing())
          .returning(["id", "version"])
          .executeTakeFirst();
        // A concurrent create won: this request's "0" is stale.
        if (!saved) {
          const now = await tx.selectFrom("storage_setting").select("version").executeTakeFirst();
          throw versionConflict(now?.version ?? null);
        }
      }
      await audit(tx, auditContextOf(request), {
        action: "storage_setting.changed",
        recordType: "storage_setting",
        recordId: saved.id,
        organizationId,
        priorVersion: row?.version ?? null,
        newVersion: saved.version,
        reason: update.reason,
        changes: changesOf(before, update),
      });
      return toStorageView(await options.storage.load(tx));
    });
    reply.header("ETag", etag(view.version));
    return reply.code(200).send(view);
  });

  // testStorageSetting: probe a candidate (s3) or the saved (else environment) setting, outside any transaction.
  app.post(TEST, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request) => {
    parseQuery(noQuery, request.query);
    const principal = principalOf(request);
    const organizationId = await requireConfigure(db, principal);
    const body = parseBody(testRequest, request.body);
    const candidate = body.candidate === null ? null : checkedS3(body.candidate, providers(), "/candidate");
    const effective = await options.storage.load(db);
    const driver: StorageDriver = candidate !== null ? "s3" : effective.driver;
    const s3 = candidate ?? (driver === "s3" ? effective.s3 : null);
    const started = now();
    // Remote I/O: no transaction is open here (the lock is a session lock on its own connection).
    const result = await underStorageLock(db, () => runStorageProbe(options.storage.testTarget(driver, s3), driver));
    const outcome = result.errorCode === null ? ("passed" as const) : ("failed" as const);
    if (outcome === "passed" && driver === "s3" && s3 !== null) passed.set(options.storage.settingsKey(s3), now());
    const testedAt = new Date();
    await db.transaction().execute((tx) =>
      audit(tx, auditContextOf(request), {
        action: "storage_setting.tested",
        recordType: "storage_setting",
        recordId: effective.id ?? uuidv7(),
        organizationId,
        changes: {
          outcome: { from: null, to: outcome },
          driver: { from: null, to: driver },
          candidate: { from: null, to: candidate !== null },
          checks: { from: null, to: result.checks.map((c) => `${c.name}:${c.outcome}`).join(" ") },
          error_code: { from: null, to: result.errorCode },
        },
      }),
    );
    return {
      outcome,
      driver,
      checks: result.checks,
      errorCode: result.errorCode,
      durationMs: Math.max(0, Math.round(now() - started)),
      testedAt: testedAt.toISOString(),
    } satisfies StorageTestResult;
  });

  return [`GET ${ITEM}`, `PUT ${ITEM}`, `POST ${TEST}`];
}
