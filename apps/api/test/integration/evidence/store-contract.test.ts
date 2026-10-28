// P6 (ADR-0054 §2, REQ-S16-006 "A18;A12: contract tests pass for both adapters; evidence is never served from a public
// URL"; p6-work-split §J/C.8; T-DG6-BE-H): the one EvidenceStore contract suite (src/modules/evidence/stores/contract.ts)
// run for BOTH adapters:
//  - the filesystem adapter on a fresh temporary directory per case;
//  - the S3-compatible adapter (@aws-sdk/client-s3, Option A, D-197) against the in-process S3-protocol fake
//    (test/support/fake-s3.ts), which verifies AWS Signature Version 4 on every request, under a fresh key prefix per case.
// Then the S3-only cases: multipart above 8 MiB and a single PUT below; wrong, unknown or unresolvable credentials and an
// unreachable store are EvidenceStoreUnavailable (the route's 503) with no URL in the message; no request ever carries an
// ACL header or a pre-signed query; the sweep follows list continuation tokens; another prefix is never touched.
// The fake is not an object store and nothing here is live (§2 rule 14). No PostgreSQL is used by this file: the store
// port has no database; it runs in the integration project because it starts an HTTP server on a harness-pool port.
// All bytes are SYNTHETIC.
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSecretProviderRegistry, secretValue, type SecretProvider } from "../../../src/modules/platform/index.ts";
import {
  describeEvidenceStoreContract,
  type EvidenceStoreFixture,
} from "../../../src/modules/evidence/stores/contract.ts";
import { FilesystemEvidenceStore } from "../../../src/modules/evidence/stores/filesystem.ts";
import { S3EvidenceStore, S3_MULTIPART_THRESHOLD_BYTES } from "../../../src/modules/evidence/stores/s3.ts";
import { EvidenceStoreUnavailable, STALE_TEMPORARY_AGE_MS } from "../../../src/modules/evidence/store.ts";
import { FakeS3, sigV4Signature } from "../../support/fake-s3.ts";

const BUCKET = "mth-evidence";
const runner = { describe, it };

// ---------------------------------------------------------------------------------------------------------------------
// The filesystem adapter
// ---------------------------------------------------------------------------------------------------------------------
async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else out.push(relative(root, path).split(sep).join("/"));
    }
  };
  await visit(root);
  return out.sort();
}

let fsBase = "";
beforeAll(async () => {
  fsBase = await mkdtemp(join(process.env["TMPDIR"] ?? tmpdir(), "mth-store-contract-"));
});
afterAll(async () => {
  if (fsBase !== "") await rm(fsBase, { recursive: true, force: true });
});

describeEvidenceStoreContract(
  "filesystem",
  async (): Promise<EvidenceStoreFixture> => {
    const root = join(fsBase, randomUUID());
    await mkdir(root, { recursive: true });
    return {
      store: new FilesystemEvidenceStore(root),
      listRaw: () => walk(root),
      async age(name, byMs) {
        const path = join(root, name);
        const at = (Date.now() - byMs) / 1000;
        await stat(path);
        await utimes(path, at, at);
      },
      // The filesystem adapter has no network address; "no URL" is checked on every output as for s3.
      forbiddenInOutput: [],
      dispose: () => rm(root, { recursive: true, force: true }),
    };
  },
  runner,
  { networkSurface: false },
);

// ---------------------------------------------------------------------------------------------------------------------
// The S3-compatible adapter against the SigV4-verifying fake
// ---------------------------------------------------------------------------------------------------------------------
const fake = new FakeS3({ buckets: [BUCKET] });
const access = fake.credentials[0]!;

/** A synthetic provider holding the fake's keys, plus one name that resolves to nothing. */
function testSecrets(values: Record<string, string>): ReturnType<typeof createSecretProviderRegistry> {
  const provider: SecretProvider = {
    id: "test",
    get: (name) => Promise.resolve(name in values ? secretValue(values[name]!) : undefined),
  };
  const registry = createSecretProviderRegistry();
  registry.register(provider);
  return registry;
}

const goodSecrets = testSecrets({ S3_ACCESS: access.accessKeyId, S3_SECRET: access.secretAccessKey });

function s3Store(
  prefix: string | null,
  overrides: Partial<ConstructorParameters<typeof S3EvidenceStore>[0]> = {},
): S3EvidenceStore {
  return new S3EvidenceStore({
    endpoint: fake.endpoint,
    region: fake.region,
    bucket: BUCKET,
    keyPrefix: prefix,
    accessKeyRef: { provider: "test", name: "S3_ACCESS" },
    secretKeyRef: { provider: "test", name: "S3_SECRET" },
    secrets: goodSecrets,
    maxAttempts: 1,
    ...overrides,
  });
}

beforeAll(async () => {
  await fake.start();
});
afterAll(async () => {
  await fake.stop();
});

describeEvidenceStoreContract(
  "s3 (in-process SigV4-verifying fake)",
  async (): Promise<EvidenceStoreFixture> => {
    const prefix = `contract/${randomUUID()}`;
    const store = s3Store(prefix);
    const strip = (k: string): string => k.slice(prefix.length + 1);
    return {
      store,
      listRaw: () =>
        Promise.resolve(
          fake
            .keys(BUCKET)
            .filter((k) => k.startsWith(`${prefix}/`))
            .map(strip),
        ),
      age: (name, byMs) => {
        fake.backdate(BUCKET, `${prefix}/${name}`, byMs);
        return Promise.resolve();
      },
      anonymousRead: async (key) => (await fetch(`${fake.endpoint}/${BUCKET}/${prefix}/${key}`)).status,
      forbiddenInOutput: [fake.endpoint, fake.endpoint.replace(/^http:\/\//, ""), BUCKET, access.accessKeyId],
      dispose: () => {
        store.destroy();
        return Promise.resolve();
      },
    };
  },
  runner,
  { networkSurface: true },
);

describe("S3 evidence store: adapter-specific behaviour (ADR-0054 §2)", () => {
  const key = (): string => `org-${randomUUID().slice(0, 8)}/tr-x/ev-y/${randomUUID()}`;
  const opsSince = (from: number): string[] => fake.requests.slice(from).map((r) => r.operation);

  it("writes a body up to 8 MiB with one PutObject to <key>.part, then CopyObject + DeleteObject on finalise", async () => {
    const store = s3Store("ops-small");
    try {
      const k = key();
      const from = fake.requests.length;
      await store.receive(k, Buffer.alloc(S3_MULTIPART_THRESHOLD_BYTES - 1, 1), S3_MULTIPART_THRESHOLD_BYTES);
      expect(opsSince(from)).toEqual(["PutObject"]);
      expect(fake.requests.at(-1)!.path).toBe(`/${BUCKET}/ops-small/${k}.part`);
      await store.finalise(k);
      expect(opsSince(from)).toEqual(["PutObject", "CopyObject", "DeleteObject"]);
      expect(fake.keys(BUCKET).filter((n) => n.startsWith(`ops-small/${k}`))).toEqual([`ops-small/${k}`]);
    } finally {
      store.destroy();
    }
  });

  it("uses multipart upload above 8 MiB, buffering one part at a time", async () => {
    const store = s3Store("ops-large");
    try {
      const k = key();
      const from = fake.requests.length;
      const MiB = 1024 * 1024;
      async function* body(): AsyncIterable<Uint8Array> {
        for (let i = 0; i < 20; i += 1) yield Buffer.alloc(MiB, i);
      }
      const stored = await store.receive(k, body(), 25 * MiB);
      expect(stored.size).toBe(20 * MiB);
      expect(opsSince(from)).toEqual([
        "CreateMultipartUpload",
        "UploadPart",
        "UploadPart",
        "UploadPart",
        "CompleteMultipartUpload",
      ]);
      expect(fake.openUploads()).toBe(0);
      expect(fake.object(BUCKET, `ops-large/${k}.part`)?.byteLength).toBe(20 * MiB);
    } finally {
      store.destroy();
    }
  }, 60_000);

  it("aborts the multipart upload when the body fails after a part was stored", async () => {
    const store = s3Store("ops-abort");
    try {
      const k = key();
      const from = fake.requests.length;
      async function* body(): AsyncIterable<Uint8Array> {
        yield Buffer.alloc(S3_MULTIPART_THRESHOLD_BYTES, 2);
        throw new Error("synthetic client abort");
      }
      await expect(store.receive(k, body(), 25 * 1024 * 1024)).rejects.toThrow("synthetic client abort");
      expect(opsSince(from)).toEqual(["CreateMultipartUpload", "UploadPart", "AbortMultipartUpload", "DeleteObject"]);
      expect(fake.openUploads()).toBe(0);
      expect(fake.keys(BUCKET).filter((n) => n.startsWith("ops-abort/"))).toEqual([]);
    } finally {
      store.destroy();
    }
  });

  it("signs every request with SigV4 (the fake verified each), never sends an ACL and never uses a pre-signed query", async () => {
    const store = s3Store("ops-signed");
    try {
      const k = key();
      const from = fake.requests.length;
      await store.put(k, Buffer.from("signed"), 100);
      for await (const _ of await store.get(k)) void _;
      await store.head(k);
      await store.discardUncommitted(k);
      await store.sweepStaleTemporaries(STALE_TEMPORARY_AGE_MS, () => undefined);
      const seen = fake.requests.slice(from);
      expect(seen.length).toBeGreaterThanOrEqual(7);
      for (const request of seen) {
        expect(request.status).toBeLessThan(300);
        expect(request.headers["authorization"]).toMatch(/^AWS4-HMAC-SHA256 Credential=/);
        expect(Object.keys(request.headers).filter((h) => h === "x-amz-acl" || h.startsWith("x-amz-grant-"))).toEqual(
          [],
        );
        expect(Object.keys(request.query).filter((q) => q.toLowerCase().startsWith("x-amz-"))).toEqual([]);
      }
    } finally {
      store.destroy();
    }
  });

  it("the fake's SigV4 verifier reproduces AWS's published S3 example signature (GET Object, single chunk)", () => {
    // AWS S3 API reference, "Signature Calculations for the Authorization Header: Transferring Payload in a Single
    // Chunk", example "GET Object" (AWS's documented example credentials, not a secret).
    const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(
      sigV4Signature({
        method: "GET",
        rawPath: "/test.txt",
        queryPairs: [],
        headers: {
          host: "examplebucket.s3.amazonaws.com",
          range: "bytes=0-9",
          "x-amz-content-sha256": emptyHash,
          "x-amz-date": "20130524T000000Z",
        },
        signedHeaders: ["host", "range", "x-amz-content-sha256", "x-amz-date"],
        payloadHash: emptyHash,
        amzDate: "20130524T000000Z",
        scopeDate: "20130524",
        region: "us-east-1",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      }),
    ).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });

  it("the fake refuses an anonymous GET, a pre-signed query and a tampered signature (403)", async () => {
    const store = s3Store("ops-anon");
    try {
      const k = key();
      await store.put(k, Buffer.from("private"), 100);
      const url = `${fake.endpoint}/${BUCKET}/ops-anon/${k}`;
      expect((await fetch(url)).status).toBe(403);
      expect((await fetch(`${url}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=${"0".repeat(64)}`)).status).toBe(
        403,
      );
      // A GET signed with the right secret is served; the same request with one signature character changed is 403.
      const now = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
      const host = fake.endpoint.replace(/^http:\/\//, "");
      const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      const signedHeaders = ["host", "x-amz-content-sha256", "x-amz-date"];
      const headers = { host, "x-amz-content-sha256": emptyHash, "x-amz-date": now };
      const signature = sigV4Signature({
        method: "GET",
        rawPath: `/${BUCKET}/ops-anon/${k}`,
        queryPairs: [],
        headers,
        signedHeaders,
        payloadHash: emptyHash,
        amzDate: now,
        scopeDate: now.slice(0, 8),
        region: fake.region,
        secretAccessKey: access.secretAccessKey,
      });
      const authorization = (sig: string): string =>
        `AWS4-HMAC-SHA256 Credential=${access.accessKeyId}/${now.slice(0, 8)}/${fake.region}/s3/aws4_request, SignedHeaders=${signedHeaders.join(";")}, Signature=${sig}`;
      const send = (sig: string): Promise<Response> =>
        fetch(url, {
          headers: {
            authorization: authorization(sig),
            "x-amz-content-sha256": emptyHash,
            "x-amz-date": now,
          },
        });
      const good = await send(signature);
      expect(good.status).toBe(200);
      expect(await good.text()).toBe("private");
      const flipped = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
      const res = await send(flipped);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain("SignatureDoesNotMatch");
    } finally {
      store.destroy();
    }
  });

  it("a wrong secret key, an unknown access key or an unresolvable reference is EvidenceStoreUnavailable, naming no secret", async () => {
    const cases = [
      testSecrets({ S3_ACCESS: access.accessKeyId, S3_SECRET: "synthetic-wrong-secret" }),
      testSecrets({ S3_ACCESS: "SYNTHETICUNKNOWNKEY0", S3_SECRET: access.secretAccessKey }),
      testSecrets({ S3_ACCESS: access.accessKeyId }),
    ];
    for (const secrets of cases) {
      const store = s3Store("ops-creds", { secrets });
      try {
        const err = await store.put(key(), Buffer.from("x"), 10).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(EvidenceStoreUnavailable);
        const message = (err as Error).message;
        expect(message).not.toContain(access.secretAccessKey);
        expect(message).not.toContain("synthetic-wrong-secret");
        expect(message).not.toMatch(/:\/\//);
        expect(message).not.toContain(fake.endpoint.replace(/^http:\/\//, ""));
        await expect(store.get(key())).rejects.toBeInstanceOf(EvidenceStoreUnavailable);
        await expect(store.head(key())).rejects.toBeInstanceOf(EvidenceStoreUnavailable);
      } finally {
        store.destroy();
      }
    }
    expect(fake.keys(BUCKET).filter((n) => n.startsWith("ops-creds/"))).toEqual([]);
  });

  it("an unreachable store is EvidenceStoreUnavailable (the route's 503), with no URL in the message", async () => {
    // A port in the harness pool that nothing listens on: the fake's own port after it is closed would race, so a
    // second fake is started and stopped to obtain one.
    const gone = new FakeS3({ buckets: [BUCKET] });
    await gone.start();
    const endpoint = gone.endpoint;
    await gone.stop();
    const store = s3Store("ops-down", { endpoint, connectionTimeoutMs: 2_000 });
    try {
      // One operation at a time (each is started only when awaited, so no rejection is ever left unhandled).
      const attempts: (() => Promise<unknown>)[] = [
        () => store.put(key(), Buffer.from("x"), 10),
        () => store.get(key()),
        () => store.head(key()),
        () => store.sweepStaleTemporaries(1, () => undefined),
      ];
      for (const attempt of attempts) {
        const err = await attempt().then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(EvidenceStoreUnavailable);
        expect((err as Error).message).not.toMatch(/:\/\/|127\.0\.0\.1/);
      }
    } finally {
      store.destroy();
    }
  });

  it("the sweep follows list continuation tokens and never touches another prefix", async () => {
    const paged = new FakeS3({ buckets: [BUCKET], listPageSize: 2, credentials: fake.credentials });
    await paged.start();
    const store = s3Store("sweep-a", { endpoint: paged.endpoint, region: paged.region });
    try {
      const temps = Array.from({ length: 5 }, () => key());
      for (const t of temps) await store.receive(t, Buffer.from("t"), 10);
      for (const t of temps) paged.backdate(BUCKET, `sweep-a/${t}.part`, 2 * STALE_TEMPORARY_AGE_MS);
      const foreign = `sweep-b/${key()}.part`;
      paged.seed(BUCKET, foreign, Buffer.from("other prefix"), new Date(Date.now() - 2 * STALE_TEMPORARY_AGE_MS));
      const removed: string[] = [];
      const result = await store.sweepStaleTemporaries(STALE_TEMPORARY_AGE_MS, (r) => removed.push(r.key));
      expect(result).toEqual({ removed: 5, keptFresh: 0 });
      expect(removed.sort()).toEqual(temps.map((t) => `${t}.part`).sort());
      expect(paged.requests.filter((r) => r.operation === "ListObjectsV2").length).toBeGreaterThanOrEqual(3);
      expect(paged.keys(BUCKET)).toEqual([foreign]);
    } finally {
      store.destroy();
      await paged.stop();
    }
  });

  it("anonymousReadRefused: true against the fake, false (fails closed) against a public bucket or a missing key", async () => {
    const store = s3Store("ops-probe");
    const open = new FakeS3({ buckets: [BUCKET], credentials: fake.credentials, publicRead: true });
    await open.start();
    const leaky = s3Store("ops-probe", { endpoint: open.endpoint, region: open.region });
    try {
      const k = key();
      await store.put(k, Buffer.from("probe"), 10);
      const from = fake.requests.length;
      expect(await store.anonymousReadRefused(k)).toBe(true);
      expect(fake.requests.slice(from).map((r) => [r.operation, r.status, r.headers["authorization"]])).toEqual([
        ["Refused", 403, undefined],
      ]);
      await leaky.put(k, Buffer.from("probe"), 10);
      expect(await leaky.anonymousReadRefused(k)).toBe(false);
      expect(await leaky.anonymousReadRefused(key())).toBe(false); // 404 is not a refusal
    } finally {
      store.destroy();
      leaky.destroy();
      await open.stop();
    }
  });

  it("with no key prefix, keys sit at the bucket root unchanged", async () => {
    const store = s3Store(null);
    try {
      const k = key();
      await store.put(k, Buffer.from("root"), 10);
      expect(fake.object(BUCKET, k)?.toString()).toBe("root");
      await store.discardUncommitted(k);
      expect(fake.object(BUCKET, k)).toBeUndefined();
    } finally {
      store.destroy();
    }
  });

  it("refuses an invalid bucket name or key prefix at construction", () => {
    expect(() => s3Store("ok", { bucket: "Not_A_Bucket" })).toThrow(/invalid bucket/);
    for (const prefix of ["../up", "a/../b", "/abs", "trailing/", "bad prefix"])
      expect(() => s3Store(prefix)).toThrow(/invalid key prefix/);
  });
});
