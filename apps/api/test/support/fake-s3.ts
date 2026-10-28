// P6 (ADR-0054 §2, D-195 Q6; T-DG6-BE-H): an in-process S3-protocol fake for the EvidenceStore contract suite. No
// dependency. It speaks path-style HTTP (`/<bucket>/<key>`) for the seven operations the S3 adapter uses: PutObject,
// GetObject, HeadObject, DeleteObject, CopyObject, ListObjectsV2 and multipart upload (create, upload part, complete,
// abort). Every request must carry a valid AWS Signature Version 4 `Authorization` header for a known access key
// (header signing only): a missing, wrong or expired signature, an unknown key, another region or a pre-signed query
// string is 403, so an anonymous GET of any key is refused. The signed payload hash is checked against the body.
// SYNTHETIC: the fake holds test bytes in memory only; it is not an object store and nothing here is "live".
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeS3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface FakeS3Options {
  readonly region?: string;
  readonly buckets?: readonly string[];
  readonly credentials?: readonly FakeS3Credentials[];
  /** ListObjectsV2 page size cap (to exercise continuation tokens). Default 1000, as S3. */
  readonly listPageSize?: number;
  /** The minimum size of every multipart part except the last (S3: 5 MiB). */
  readonly minPartBytes?: number;
  /**
   * NEGATIVE FIXTURE ONLY: serve an unauthenticated GET (a misconfigured public bucket), so a test can prove that the
   * adapter's anonymous-read check reports it. Default false: anonymous access is refused.
   */
  readonly publicRead?: boolean;
}

/** One request as the fake saw it (for assertions such as "no ACL header", "multipart was used"). */
export interface FakeS3Request {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  /** The S3 operation the fake resolved, or "Refused" when authentication failed. */
  readonly operation: string;
  readonly status: number;
}

interface StoredObject {
  readonly bytes: Buffer;
  readonly etag: string;
  lastModified: Date;
}

interface MultipartUpload {
  readonly bucket: string;
  readonly key: string;
  readonly parts: Map<number, { bytes: Buffer; etag: string }>;
}

const DEFAULT_REGION = "me-central-1";
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000;
const AMZ_DATE = /^(\d{8})T\d{6}Z$/;
const AUTHORIZATION = /^AWS4-HMAC-SHA256 Credential=([^,\s]+),\s*SignedHeaders=([^,\s]+),\s*Signature=([0-9a-f]{64})$/;

class S3Error extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** RFC 3986 encoding as SigV4 requires (everything but the unreserved characters). */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function xmlEscape(value: string): string {
  return value.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );
}

function parseQuery(raw: string): { pairs: [string, string][]; map: Record<string, string> } {
  const pairs: [string, string][] = [];
  const map: Record<string, string> = {};
  if (raw === "") return { pairs, map };
  for (const part of raw.split("&")) {
    if (part === "") continue;
    const eq = part.indexOf("=");
    const k = decodeURIComponent((eq < 0 ? part : part.slice(0, eq)).replace(/\+/g, "%20"));
    const v = eq < 0 ? "" : decodeURIComponent(part.slice(eq + 1).replace(/\+/g, "%20"));
    pairs.push([k, v]);
    map[k] = v;
  }
  return { pairs, map };
}

export class FakeS3 {
  readonly region: string;
  readonly credentials: readonly FakeS3Credentials[];
  /** Every request received, in order. */
  readonly requests: FakeS3Request[] = [];
  private readonly server: Server;
  private readonly buckets = new Map<string, Map<string, StoredObject>>();
  private readonly uploads = new Map<string, MultipartUpload>();
  private readonly listPageSize: number;
  private readonly minPartBytes: number;
  private readonly publicRead: boolean;
  private baseUrl = "";

  constructor(options: FakeS3Options = {}) {
    this.region = options.region ?? DEFAULT_REGION;
    this.credentials = options.credentials ?? [
      { accessKeyId: "SYNTHETICACCESSKEY01", secretAccessKey: `synthetic-secret-${randomUUID()}` },
    ];
    for (const bucket of options.buckets ?? ["mth-evidence"]) this.buckets.set(bucket, new Map());
    this.listPageSize = options.listPageSize ?? 1000;
    this.minPartBytes = options.minPartBytes ?? 5 * 1024 * 1024;
    this.publicRead = options.publicRead ?? false;
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
  }

  /** The endpoint the adapter is configured with (`http://127.0.0.1:<port>`). */
  get endpoint(): string {
    return this.baseUrl;
  }

  /**
   * Listens on 127.0.0.1. With MTH_PORT_POOL ("LOW-HIGH", the harness pool) set, a free port is picked at random from
   * it (retried on EADDRINUSE); otherwise from the default harness pool 25000-31999, below the ephemeral range (§2 rule
   * 8). Port 0 (an ephemeral port) is never used.
   */
  async start(): Promise<void> {
    const [lo, hi] = portPool(process.env["MTH_PORT_POOL"]);
    let lastError: unknown;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const port = lo + Math.floor(Math.random() * (hi - lo + 1));
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (err: Error): void => {
            this.server.off("listening", onListening);
            reject(err);
          };
          const onListening = (): void => {
            this.server.off("error", onError);
            resolve();
          };
          this.server.once("error", onError);
          this.server.once("listening", onListening);
          this.server.listen(port, "127.0.0.1");
        });
        const address = this.server.address() as AddressInfo;
        this.baseUrl = `http://127.0.0.1:${address.port}`;
        return;
      } catch (err) {
        lastError = err;
        if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" && (err as NodeJS.ErrnoException).code !== "EACCES")
          throw err;
      }
    }
    throw new Error(`fake S3: no free port in ${lo}-${hi}: ${String(lastError)}`);
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** The keys currently stored in `bucket` (test assertions; never through HTTP). */
  keys(bucket: string): string[] {
    return [...(this.buckets.get(bucket)?.keys() ?? [])].sort();
  }

  /** The number of multipart uploads that were created and neither completed nor aborted. */
  openUploads(): number {
    return this.uploads.size;
  }

  object(bucket: string, key: string): Buffer | undefined {
    return this.buckets.get(bucket)?.get(key)?.bytes;
  }

  /** Moves an object's Last-Modified into the past (the sweep's age test). */
  backdate(bucket: string, key: string, byMs: number): void {
    const object = this.buckets.get(bucket)?.get(key);
    if (object === undefined) throw new Error(`fake S3: no object ${bucket}/${key}`);
    object.lastModified = new Date(object.lastModified.getTime() - byMs);
  }

  /** Writes an object directly (fixtures such as a foreign key in the bucket), bypassing HTTP. */
  seed(bucket: string, key: string, bytes: Buffer, lastModified = new Date()): void {
    const objects = this.buckets.get(bucket);
    if (objects === undefined) throw new Error(`fake S3: no bucket ${bucket}`);
    objects.set(key, { bytes, etag: `"${createHash("md5").update(bytes).digest("hex")}"`, lastModified });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawUrl = req.url ?? "/";
    const qIndex = rawUrl.indexOf("?");
    const rawPath = qIndex < 0 ? rawUrl : rawUrl.slice(0, qIndex);
    const rawQuery = qIndex < 0 ? "" : rawUrl.slice(qIndex + 1);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers))
      if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(",") : value;
    let operation = "Unknown";
    let status = 500;
    let query: Record<string, string> = {};
    try {
      const parsed = parseQuery(rawQuery);
      query = parsed.map;
      const body = await readBody(req);
      operation = "Refused";
      const anonymousPublicGet =
        this.publicRead && req.method === "GET" && headers["authorization"] === undefined && rawQuery === "";
      if (!anonymousPublicGet) this.authenticate(req.method ?? "GET", rawPath, parsed.pairs, headers, body);
      const result = this.route(req.method ?? "GET", rawPath, query, headers, body);
      operation = result.operation;
      status = result.status;
      res.writeHead(result.status, result.headers);
      res.end(req.method === "HEAD" ? undefined : result.body);
    } catch (err) {
      const s3 = err instanceof S3Error ? err : new S3Error(500, "InternalError", "fake S3 internal error");
      status = s3.status;
      const xml = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${s3.code}</Code><Message>${xmlEscape(s3.message)}</Message></Error>`;
      res.writeHead(s3.status, { "Content-Type": "application/xml", "Content-Length": Buffer.byteLength(xml) });
      res.end(req.method === "HEAD" ? undefined : xml);
    } finally {
      this.requests.push({ method: req.method ?? "", path: rawPath, query, headers, operation, status });
    }
  }

  /** AWS Signature Version 4, header form (the only form the fake accepts). */
  private authenticate(
    method: string,
    rawPath: string,
    queryPairs: readonly [string, string][],
    headers: Readonly<Record<string, string>>,
    body: Buffer,
  ): void {
    if (queryPairs.some(([k]) => k.toLowerCase().startsWith("x-amz-")))
      throw new S3Error(403, "AccessDenied", "Pre-signed requests are refused.");
    const authorization = headers["authorization"];
    if (authorization === undefined) throw new S3Error(403, "AccessDenied", "Anonymous access is refused.");
    const match = AUTHORIZATION.exec(authorization);
    if (match === null) throw new S3Error(403, "AccessDenied", "Unsupported authorization.");
    const [, credential, signedHeaderList, signature] = match as unknown as [string, string, string, string];
    const [accessKeyId, scopeDate, scopeRegion, scopeService, terminator] = credential.split("/");
    const known = this.credentials.find((c) => c.accessKeyId === accessKeyId);
    if (known === undefined) throw new S3Error(403, "InvalidAccessKeyId", "The access key is not known.");
    if (scopeRegion !== this.region || scopeService !== "s3" || terminator !== "aws4_request")
      throw new S3Error(403, "SignatureDoesNotMatch", "The credential scope is wrong.");
    const amzDate = headers["x-amz-date"] ?? "";
    const dateMatch = AMZ_DATE.exec(amzDate);
    if (dateMatch === null || dateMatch[1] !== scopeDate)
      throw new S3Error(403, "AccessDenied", "The request date is missing or does not match the scope.");
    const at = Date.UTC(
      Number(amzDate.slice(0, 4)),
      Number(amzDate.slice(4, 6)) - 1,
      Number(amzDate.slice(6, 8)),
      Number(amzDate.slice(9, 11)),
      Number(amzDate.slice(11, 13)),
      Number(amzDate.slice(13, 15)),
    );
    if (Math.abs(Date.now() - at) > MAX_CLOCK_SKEW_MS)
      throw new S3Error(403, "RequestTimeTooSkewed", "The request time is too far from the server time.");
    const signedHeaders = signedHeaderList.split(";");
    if (!signedHeaders.includes("host") || !signedHeaders.includes("x-amz-date"))
      throw new S3Error(403, "AccessDenied", "host and x-amz-date must be signed.");
    const payloadHash = headers["x-amz-content-sha256"];
    if (payloadHash === undefined) throw new S3Error(400, "InvalidRequest", "x-amz-content-sha256 is required.");
    if (payloadHash !== "UNSIGNED-PAYLOAD") {
      if (!/^[0-9a-f]{64}$/.test(payloadHash))
        throw new S3Error(501, "NotImplemented", "Only signed or unsigned single-chunk payloads are supported.");
      if (payloadHash !== sha256Hex(body))
        throw new S3Error(400, "XAmzContentSHA256Mismatch", "The payload hash does not match the body.");
    }
    for (const name of signedHeaders)
      if (headers[name] === undefined) throw new S3Error(403, "AccessDenied", `Signed header ${name} is missing.`);
    const expected = Buffer.from(
      sigV4Signature({
        method,
        rawPath,
        queryPairs,
        headers,
        signedHeaders,
        payloadHash,
        amzDate,
        scopeDate: scopeDate!,
        region: scopeRegion!,
        secretAccessKey: known.secretAccessKey,
      }),
    );
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      throw new S3Error(403, "SignatureDoesNotMatch", "The request signature does not match.");
  }

  private route(
    method: string,
    rawPath: string,
    query: Readonly<Record<string, string>>,
    headers: Readonly<Record<string, string>>,
    body: Buffer,
  ): { operation: string; status: number; headers: Record<string, string | number>; body?: Buffer | string } {
    const segments = rawPath.split("/");
    const bucketName = decodeURIComponent(segments[1] ?? "");
    const key = segments.slice(2).map(decodeURIComponent).join("/");
    const bucket = this.buckets.get(bucketName);
    if (bucket === undefined) throw new S3Error(404, "NoSuchBucket", "The bucket does not exist.");
    if (key === "") {
      if (method === "GET" && query["list-type"] === "2") return this.list(bucketName, bucket, query);
      throw new S3Error(501, "NotImplemented", "Only ListObjectsV2 is supported on a bucket.");
    }
    if (method === "PUT" && "uploadId" in query && "partNumber" in query) {
      const upload = this.upload(query["uploadId"]!, bucketName, key);
      const partNumber = Number(query["partNumber"]);
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000)
        throw new S3Error(400, "InvalidArgument", "partNumber is out of range.");
      const etag = `"${createHash("md5").update(body).digest("hex")}"`;
      upload.parts.set(partNumber, { bytes: body, etag });
      return { operation: "UploadPart", status: 200, headers: { ETag: etag, "Content-Length": 0 } };
    }
    if (method === "PUT" && headers["x-amz-copy-source"] !== undefined) {
      const source = decodeURIComponent(headers["x-amz-copy-source"]).replace(/^\//, "");
      const slash = source.indexOf("/");
      const from = this.buckets.get(source.slice(0, slash))?.get(source.slice(slash + 1));
      if (slash < 0 || from === undefined) throw new S3Error(404, "NoSuchKey", "The copy source does not exist.");
      const copy: StoredObject = { bytes: from.bytes, etag: from.etag, lastModified: new Date() };
      bucket.set(key, copy);
      const xml = `<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><LastModified>${copy.lastModified.toISOString()}</LastModified><ETag>${xmlEscape(copy.etag)}</ETag></CopyObjectResult>`;
      return { operation: "CopyObject", status: 200, headers: xmlHeaders(xml), body: xml };
    }
    if (method === "PUT") {
      const etag = `"${createHash("md5").update(body).digest("hex")}"`;
      bucket.set(key, { bytes: body, etag, lastModified: new Date() });
      return { operation: "PutObject", status: 200, headers: { ETag: etag, "Content-Length": 0 } };
    }
    if (method === "POST" && "uploads" in query) {
      const uploadId = randomUUID();
      this.uploads.set(uploadId, { bucket: bucketName, key, parts: new Map() });
      const xml = `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult><Bucket>${xmlEscape(bucketName)}</Bucket><Key>${xmlEscape(key)}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`;
      return { operation: "CreateMultipartUpload", status: 200, headers: xmlHeaders(xml), body: xml };
    }
    if (method === "POST" && "uploadId" in query) {
      const upload = this.upload(query["uploadId"]!, bucketName, key);
      const listed = [...body.toString("utf8").matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map((m) => ({
        partNumber: Number(/<PartNumber>(\d+)<\/PartNumber>/.exec(m[1]!)?.[1]),
        etag: (/<ETag>([^<]*)<\/ETag>/.exec(m[1]!)?.[1] ?? "").replace(/&quot;/g, '"'),
      }));
      if (listed.length === 0) throw new S3Error(400, "MalformedXML", "No parts were listed.");
      const chunks: Buffer[] = [];
      listed.forEach((part, index) => {
        const stored = upload.parts.get(part.partNumber);
        if (stored === undefined || stored.etag !== part.etag)
          throw new S3Error(400, "InvalidPart", "A listed part was not uploaded.");
        if (index > 0 && listed[index - 1]!.partNumber >= part.partNumber)
          throw new S3Error(400, "InvalidPartOrder", "Parts must be listed in ascending order.");
        if (index < listed.length - 1 && stored.bytes.byteLength < this.minPartBytes)
          throw new S3Error(400, "EntityTooSmall", "A part other than the last is below the minimum size.");
        chunks.push(stored.bytes);
      });
      const bytes = Buffer.concat(chunks);
      const etag = `"${createHash("md5").update(bytes).digest("hex")}-${listed.length}"`;
      bucket.set(key, { bytes, etag, lastModified: new Date() });
      this.uploads.delete(query["uploadId"]!);
      const xml = `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult><Bucket>${xmlEscape(bucketName)}</Bucket><Key>${xmlEscape(key)}</Key><ETag>${xmlEscape(etag)}</ETag></CompleteMultipartUploadResult>`;
      return { operation: "CompleteMultipartUpload", status: 200, headers: xmlHeaders(xml), body: xml };
    }
    if (method === "DELETE" && "uploadId" in query) {
      this.upload(query["uploadId"]!, bucketName, key);
      this.uploads.delete(query["uploadId"]!);
      return { operation: "AbortMultipartUpload", status: 204, headers: {} };
    }
    if (method === "DELETE") {
      bucket.delete(key);
      return { operation: "DeleteObject", status: 204, headers: {} };
    }
    if (method === "GET" || method === "HEAD") {
      const object = bucket.get(key);
      if (object === undefined) throw new S3Error(404, "NoSuchKey", "The key does not exist.");
      return {
        operation: method === "GET" ? "GetObject" : "HeadObject",
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": object.bytes.byteLength,
          ETag: object.etag,
          "Last-Modified": object.lastModified.toUTCString(),
        },
        body: object.bytes,
      };
    }
    throw new S3Error(501, "NotImplemented", "The operation is not supported by the fake.");
  }

  private upload(uploadId: string, bucket: string, key: string): MultipartUpload {
    const upload = this.uploads.get(uploadId);
    if (upload === undefined || upload.bucket !== bucket || upload.key !== key)
      throw new S3Error(404, "NoSuchUpload", "The upload does not exist.");
    return upload;
  }

  private list(
    bucketName: string,
    bucket: Map<string, StoredObject>,
    query: Readonly<Record<string, string>>,
  ): { operation: string; status: number; headers: Record<string, string | number>; body: string } {
    const prefix = query["prefix"] ?? "";
    const after = query["continuation-token"] ?? query["start-after"] ?? "";
    const maxKeys = Math.min(Number(query["max-keys"] ?? 1000) || 1000, this.listPageSize);
    const urlEncoded = query["encoding-type"] === "url";
    const all = [...bucket.keys()].filter((k) => k.startsWith(prefix) && k > after).sort();
    const page = all.slice(0, maxKeys);
    const truncated = all.length > page.length;
    const contents = page
      .map((k) => {
        const object = bucket.get(k)!;
        const name = urlEncoded ? uriEncode(k).replace(/%2F/g, "/") : k;
        return `<Contents><Key>${xmlEscape(name)}</Key><LastModified>${object.lastModified.toISOString()}</LastModified><ETag>${xmlEscape(object.etag)}</ETag><Size>${object.bytes.byteLength}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
      })
      .join("");
    const next = truncated ? `<NextContinuationToken>${xmlEscape(page[page.length - 1]!)}</NextContinuationToken>` : "";
    const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${xmlEscape(bucketName)}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${maxKeys}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${urlEncoded ? "<EncodingType>url</EncodingType>" : ""}${contents}${next}</ListBucketResult>`;
    return { operation: "ListObjectsV2", status: 200, headers: xmlHeaders(xml), body: xml };
  }
}

export interface SigV4Input {
  readonly method: string;
  /** The path exactly as sent (S3 does not normalize or double-encode it). */
  readonly rawPath: string;
  /** The decoded query pairs. */
  readonly queryPairs: readonly (readonly [string, string])[];
  /** Lower-case header names. */
  readonly headers: Readonly<Record<string, string>>;
  readonly signedHeaders: readonly string[];
  readonly payloadHash: string;
  readonly amzDate: string;
  readonly scopeDate: string;
  readonly region: string;
  readonly secretAccessKey: string;
}

/**
 * The AWS Signature Version 4 signature (hex) of a request for service s3: canonical request, string to sign and the
 * HMAC key chain, as AWS documents them. Exported so the verifier itself is checked against AWS's published example.
 */
export function sigV4Signature(input: SigV4Input): string {
  const canonicalQuery = input.queryPairs
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalHeaders = input.signedHeaders
    .map((name) => `${name}:${(input.headers[name] ?? "").trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const canonicalRequest = [
    input.method,
    input.rawPath,
    canonicalQuery,
    canonicalHeaders,
    input.signedHeaders.join(";"),
    input.payloadHash,
  ].join("\n");
  const scope = `${input.scopeDate}/${input.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, input.scopeDate), input.region), "s3"),
    "aws4_request",
  );
  return createHmac("sha256", signingKey).update(stringToSign).digest("hex");
}

function xmlHeaders(xml: string): Record<string, string | number> {
  return { "Content-Type": "application/xml", "Content-Length": Buffer.byteLength(xml) };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) throw new S3Error(400, "EntityTooLarge", "The fake accepts at most 64 MiB per request.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The harness pool (MTH_PORT_POOL "LOW-HIGH"), default 25000-31999 like tests/qa/support/pg-port.sh. */
function portPool(value: string | undefined): [number, number] {
  const match = /^(\d+)-(\d+)$/.exec(value ?? "");
  if (match === null) return [25000, 31999];
  const lo = Number(match[1]);
  const hi = Number(match[2]);
  if (lo < 1024 || hi > 32767 || lo > hi) throw new Error(`fake S3: invalid MTH_PORT_POOL ${value}`);
  return [lo, hi];
}
