// P6 (ADR-0054 §2, REQ-S16-006; T-DG6-BE-H): the S3-compatible EvidenceStore adapter, over `@aws-sdk/client-s3`
// (Option A, D-197; pinned 3.1156.0). It implements the unchanged EvidenceStore port with the semantics ADR-0054 §2
// fixes, and passes the same contract suite as the filesystem adapter (stores/contract.ts):
//  - `receive` streams to the TEMPORARY key `<key>.part`: one PutObject up to the part size (8 MiB), multipart upload
//    above it, computing the SHA-256 and enforcing `maxBytes` WHILE streaming. At most one part is buffered in memory.
//    On any failure the multipart upload is aborted and the temporary object deleted, then the error is rethrown.
//  - `finalise` copies the temporary object to the final key, then deletes the temporary object (S3 has no rename; a
//    crash between the two leaves a temporary for the sweep).
//  - `get` streams the object; `head` is its size or null (404); `discardUncommitted` deletes both keys (idempotent).
//  - `sweepStaleTemporaries` lists the `<uuid>.part` keys under the prefix, three levels below it, and deletes those last
//    modified more than `olderThanMs` ago. A final object is never touched.
//  - Keys are the same opaque organization/transformation/evidence/uuid keys as filesystem mode, under the optional key
//    prefix. Path-style addressing is the default.
// NEVER PUBLIC, NEVER PRE-SIGNED (ADR-0010 §2, D-195 Q2): the adapter never creates a pre-signed URL, never sets an ACL
// and returns no URL from any method; error messages name the operation and the store's error code only, never the
// endpoint, bucket or key. The access keys are SecretRefs resolved through the SecretProvider registry (ADR-0052 §5) at
// request time; a value never appears in a message.
// Not live (§2 rule 14): this adapter is proven against the in-process SigV4-verifying fake (test/support/fake-s3.ts).
// An IT object store is a configuration slot Mobily IT fills; no task claims IT approved or connected one.
import { createHash } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import type { SecretRef, SecretValue } from "../../platform/index.ts";
import {
  EvidenceStoreUnavailable,
  EvidenceTooLarge,
  type EvidenceBody,
  type EvidenceStore,
  type RemovedTemporary,
  type StoredObject,
  type SweepResult,
} from "../store.ts";

/** ADR-0054 §2: a single PUT up to this size, multipart upload above it. Also the multipart part size. */
export const S3_MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;

/** The same key rule as the filesystem adapter: opaque identifiers, no "..". */
const KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,199}$/;
/** An optional key prefix: path segments of the same characters, no "..", no leading or trailing slash. */
const KEY_PREFIX = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,99}$/;
/** The only names the sweep ever removes: an upload's temporary object (a UUID key + `.part`). */
const TEMPORARY_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.part$/;
/** Keys are organization/transformation/evidence/uuid: temporaries sit exactly 3 segments below the prefix. */
const KEY_DEPTH = 3;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/** What resolves a SecretRef (the SecretProviderRegistry of ADR-0052 §5, or a test double). */
export interface SecretResolver {
  resolve(ref: SecretRef): Promise<SecretValue | undefined>;
}

export interface S3EvidenceStoreOptions {
  /** `https://…` for an IT store; the in-process fake is `http://127.0.0.1:<port>`. Never returned or logged. */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  /** Optional prefix under which every key lives (`storage_setting.s3_key_prefix`). */
  readonly keyPrefix?: string | null;
  /** Path-style addressing (default true: S3-compatible stores). */
  readonly forcePathStyle?: boolean;
  readonly accessKeyRef: SecretRef;
  readonly secretKeyRef: SecretRef;
  readonly secrets: SecretResolver;
  /** The SDK's attempts per request (default 3, its standard retry with backoff). */
  readonly maxAttempts?: number;
  /** Per-request socket timeout (default 30 s) and connection timeout (default 5 s). */
  readonly requestTimeoutMs?: number;
  readonly connectionTimeoutMs?: number;
}

interface SdkError {
  readonly name?: string;
  readonly Code?: string;
  readonly $metadata?: { readonly httpStatusCode?: number };
}

function statusOf(err: unknown): number | undefined {
  return (err as SdkError | null)?.$metadata?.httpStatusCode;
}

function isNotFound(err: unknown): boolean {
  const e = err as SdkError | null;
  return statusOf(err) === 404 || e?.name === "NoSuchKey" || e?.name === "NotFound";
}

/** The object is absent: the route maps this to 404, exactly as the filesystem adapter's ENOENT. */
export class EvidenceObjectNotFound extends Error {
  constructor() {
    super("evidence store: the object does not exist");
    this.name = "EvidenceObjectNotFound";
  }
}

/** A store failure, named by operation and the store's error code, never by URL, bucket, key or credential. */
function unavailable(operation: string, err: unknown): EvidenceStoreUnavailable {
  if (err instanceof EvidenceStoreUnavailable) return err;
  const e = err as SdkError | null;
  const code = typeof e?.name === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(e.name) ? e.name : "Error";
  const status = statusOf(err);
  return new EvidenceStoreUnavailable(
    `The object store refused or failed ${operation} (${code}${status === undefined ? "" : ` ${status}`}).`,
  );
}

export class S3EvidenceStore implements EvidenceStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly endpoint: string;
  private readonly forcePathStyle: boolean;
  private readonly requestTimeoutMs: number;

  constructor(options: S3EvidenceStoreOptions) {
    if (!BUCKET.test(options.bucket)) throw new Error("evidence store: invalid bucket name");
    const keyPrefix = options.keyPrefix ?? "";
    if (keyPrefix !== "" && (!KEY_PREFIX.test(keyPrefix) || keyPrefix.includes("..") || keyPrefix.endsWith("/")))
      throw new Error("evidence store: invalid key prefix");
    this.bucket = options.bucket;
    this.prefix = keyPrefix === "" ? "" : `${keyPrefix}/`;
    this.endpoint = options.endpoint;
    this.forcePathStyle = options.forcePathStyle ?? true;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    const { secrets, accessKeyRef, secretKeyRef } = options;
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: this.forcePathStyle,
      maxAttempts: options.maxAttempts ?? 3,
      // S3-compatible stores: send and validate the flexible checksums only where an operation requires them, so the
      // payload is a plain signed single chunk (no aws-chunked trailer) that every compatible store accepts.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      requestHandler: {
        requestTimeout: this.requestTimeoutMs,
        connectionTimeout: options.connectionTimeoutMs ?? 5_000,
      },
      // Resolved through the SecretProvider at request time; the SDK caches the identity in memory only.
      credentials: async () => {
        const [accessKeyId, secretAccessKey] = await Promise.all([
          secrets.resolve(accessKeyRef),
          secrets.resolve(secretKeyRef),
        ]);
        if (accessKeyId === undefined || secretAccessKey === undefined)
          throw new EvidenceStoreUnavailable(
            "The object store credential references do not resolve to a secret in their provider.",
          );
        return { accessKeyId: accessKeyId.reveal(), secretAccessKey: secretAccessKey.reveal() };
      },
    });
  }

  private objectKey(key: string): string {
    if (!KEY.test(key) || key.includes("..")) throw new Error("evidence store: invalid key");
    return `${this.prefix}${key}`;
  }

  private tempKey(key: string): string {
    return `${this.objectKey(key)}.part`;
  }

  private async send<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw unavailable(operation, err);
    }
  }

  async put(key: string, body: EvidenceBody, maxBytes: number): Promise<StoredObject> {
    const stored = await this.receive(key, body, maxBytes);
    await this.finalise(key);
    return stored;
  }

  async receive(key: string, body: EvidenceBody, maxBytes: number): Promise<StoredObject> {
    const temp = this.tempKey(key);
    const hash = createHash("sha256");
    let size = 0;
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    let uploadId: string | undefined;
    const parts: CompletedPart[] = [];
    const flushPart = async (): Promise<void> => {
      if (uploadId === undefined) {
        const created = await this.send("CreateMultipartUpload", () =>
          this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: temp })),
        );
        if (created.UploadId === undefined)
          throw new EvidenceStoreUnavailable("The object store returned no multipart upload id.");
        uploadId = created.UploadId;
      }
      const partNumber = parts.length + 1;
      const partBody = Buffer.concat(pending, pendingBytes);
      pending = [];
      pendingBytes = 0;
      const id = uploadId;
      const uploaded = await this.send("UploadPart", () =>
        this.client.send(
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: temp,
            UploadId: id,
            PartNumber: partNumber,
            Body: partBody,
            ContentLength: partBody.byteLength,
          }),
        ),
      );
      parts.push({ PartNumber: partNumber, ETag: uploaded.ETag });
    };
    try {
      const chunks: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array> =
        body instanceof Uint8Array ? [body] : body;
      for await (const chunk of chunks) {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        size += bytes.byteLength;
        if (size > maxBytes) throw new EvidenceTooLarge(maxBytes);
        hash.update(bytes);
        pending.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        pendingBytes += bytes.byteLength;
        if (pendingBytes >= S3_MULTIPART_THRESHOLD_BYTES) await flushPart();
      }
      if (uploadId === undefined) {
        const whole = Buffer.concat(pending, pendingBytes);
        pending = [];
        await this.send("PutObject", () =>
          this.client.send(
            new PutObjectCommand({
              Bucket: this.bucket,
              Key: temp,
              Body: whole,
              ContentLength: whole.byteLength,
              ContentType: "application/octet-stream",
            }),
          ),
        );
      } else {
        if (pendingBytes > 0) await flushPart();
        const id = uploadId;
        await this.send("CompleteMultipartUpload", () =>
          this.client.send(
            new CompleteMultipartUploadCommand({
              Bucket: this.bucket,
              Key: temp,
              UploadId: id,
              MultipartUpload: { Parts: parts },
            }),
          ),
        );
        uploadId = undefined;
      }
    } catch (err) {
      // Nothing is left behind: an open multipart upload is aborted and a temporary object deleted (best effort; a
      // temporary the delete could not reach is removed by the sweep).
      const id = uploadId;
      if (id !== undefined)
        await this.client
          .send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: temp, UploadId: id }))
          .catch(() => undefined);
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: temp })).catch(() => undefined);
      throw err;
    }
    return { key, sha256: hash.digest("hex"), size };
  }

  async finalise(key: string): Promise<void> {
    const temp = this.tempKey(key);
    const final = this.objectKey(key);
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: final,
          // Keys are limited to [A-Za-z0-9/_.-], so the copy source needs no further encoding.
          CopySource: `${this.bucket}/${temp}`,
          MetadataDirective: "COPY",
        }),
      );
    } catch (err) {
      if (isNotFound(err)) throw new EvidenceObjectNotFound();
      throw unavailable("CopyObject", err);
    }
    await this.send("DeleteObject", () =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: temp })),
    );
  }

  async get(key: string): Promise<AsyncIterable<Uint8Array>> {
    const objectKey = this.objectKey(key);
    let body: unknown;
    try {
      body = (await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }))).Body;
    } catch (err) {
      if (isNotFound(err)) throw new EvidenceObjectNotFound();
      throw unavailable("GetObject", err);
    }
    if (body === undefined || body === null || typeof body !== "object" || !(Symbol.asyncIterator in body))
      throw new EvidenceStoreUnavailable("The object store returned no readable body.");
    return body as AsyncIterable<Uint8Array>;
  }

  async head(key: string): Promise<{ size: number } | null> {
    const objectKey = this.objectKey(key);
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return { size: out.ContentLength ?? 0 };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw unavailable("HeadObject", err);
    }
  }

  async discardUncommitted(key: string): Promise<void> {
    const final = this.objectKey(key);
    const temp = this.tempKey(key);
    await this.send("DeleteObject", () =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: final })),
    );
    await this.send("DeleteObject", () =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: temp })),
    );
  }

  async sweepStaleTemporaries(
    olderThanMs: number,
    onRemoved: (removed: RemovedTemporary) => void,
  ): Promise<SweepResult> {
    let removed = 0;
    let keptFresh = 0;
    let continuationToken: string | undefined;
    do {
      const token = continuationToken;
      const page = await this.send("ListObjectsV2", () =>
        this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            ...(this.prefix === "" ? {} : { Prefix: this.prefix }),
            ...(token === undefined ? {} : { ContinuationToken: token }),
          }),
        ),
      );
      for (const object of page.Contents ?? []) {
        const fullKey = object.Key;
        if (fullKey === undefined || !fullKey.startsWith(this.prefix)) continue;
        const relativeKey = fullKey.slice(this.prefix.length);
        const segments = relativeKey.split("/");
        // Only a temporary exactly KEY_DEPTH segments below the prefix; final objects are never touched.
        if (segments.length !== KEY_DEPTH + 1 || segments.some((s) => s === "" || s === "." || s === "..")) continue;
        if (!TEMPORARY_NAME.test(segments.at(KEY_DEPTH) ?? "")) continue;
        const modified = object.LastModified?.getTime();
        if (modified === undefined) continue;
        const ageMs = Date.now() - modified;
        if (ageMs <= olderThanMs) {
          keptFresh += 1;
          continue;
        }
        await this.send("DeleteObject", () =>
          this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: fullKey })),
        );
        removed += 1;
        onRemoved({ key: relativeKey, sizeBytes: object.Size ?? 0, ageMs: Math.round(ageMs) });
      }
      continuationToken = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);
    return { removed, keptFresh };
  }

  /**
   * ADR-0054 §2 (the storage test of BE-H2's testStorageSetting): makes one UNAUTHENTICATED GET of `key` (no
   * Authorization header, no query, redirects not followed) and answers whether the store refused it (401 or 403).
   * Any other answer, 404 included, counts as not refused, so the check fails closed. The URL is built and used here
   * only; it is never returned, logged or put in an error message.
   */
  async anonymousReadRefused(key: string): Promise<boolean> {
    const objectKey = this.objectKey(key);
    let url: URL;
    try {
      url = new URL(this.endpoint);
    } catch {
      throw new EvidenceStoreUnavailable("The object store endpoint is not a valid address.");
    }
    const base = url.pathname.replace(/\/+$/, "");
    if (this.forcePathStyle) url.pathname = `${base}/${this.bucket}/${objectKey}`;
    else {
      url.hostname = `${this.bucket}.${url.hostname}`;
      url.pathname = `${base}/${objectKey}`;
    }
    url.search = "";
    let status: number;
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(this.requestTimeoutMs) });
      status = res.status;
      await res.body?.cancel().catch(() => undefined);
    } catch {
      throw new EvidenceStoreUnavailable("The object store could not be reached for the anonymous read check.");
    }
    return status === 401 || status === 403;
  }

  /** Closes the SDK's connection pool (tests and shutdown). */
  destroy(): void {
    this.client.destroy();
  }
}
