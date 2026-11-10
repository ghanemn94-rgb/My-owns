// P6 (ADR-0054 §2, REQ-S16-006 "contract tests pass for both adapters"; T-DG6-BE-H): the ONE contract suite every
// EvidenceStore adapter passes. `apps/api/test/integration/evidence/store-contract.test.ts` runs it for the filesystem
// adapter on a temporary directory and for the S3 adapter against the in-process SigV4-verifying fake.
// The cases are those ADR-0054 §2 lists: round-trip bytes and SHA-256; `maxBytes` enforced while streaming
// (EvidenceTooLarge, nothing left behind); a temporary object is never readable through `get`; `finalise` makes it
// readable; `discardUncommitted` is idempotent; the sweep removes only old temporaries; `head` of a missing key is
// null; concurrent `receive` of two keys does not mix bytes; an anonymous read is refused (where the store has a
// network surface: s3); the adapter returns no URL anywhere.
// Framework-free on purpose (the runner's `describe`/`it` are passed in, and the four assertions below are local, over
// node:util's isDeepStrictEqual): this file is part of the API source tree, so it imports no test framework into the
// build and only the built-ins the ADR-0002 module boundary allows.
import { createHash, randomUUID } from "node:crypto";
import { inspect, isDeepStrictEqual } from "node:util";
import {
  EvidenceStoreUnavailable,
  EvidenceTooLarge,
  STALE_TEMPORARY_AGE_MS,
  type EvidenceStore,
  type RemovedTemporary,
} from "../store.ts";

/** One adapter instance under test, isolated from every other case (its own directory or key prefix). */
export interface EvidenceStoreFixture {
  readonly store: EvidenceStore;
  /** Every object name the backing store holds for this fixture, relative to its root or prefix (temporaries too). */
  listRaw(): Promise<string[]>;
  /** Moves an object's last-modified time `byMs` into the past (relative name as `listRaw` returns it). */
  age(name: string, byMs: number): Promise<void>;
  /**
   * An unauthenticated read of a final object over the store's own network surface, returning the HTTP status.
   * Required when the suite is registered with `networkSurface: true`; absent for the filesystem store.
   */
  readonly anonymousRead?: (key: string) => Promise<number>;
  /** Strings that must never appear in anything the adapter returns (its endpoint, host, bucket, root path). */
  readonly forbiddenInOutput: readonly string[];
  dispose(): Promise<void>;
}

/** The two functions of a test runner the suite needs (Vitest's, node:test's, …). */
export interface ContractRunner {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => Promise<void>, timeoutMs?: number): void;
}

class ContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractViolation";
  }
}

interface ContractAssert {
  ok(value: unknown, message?: string): asserts value;
  equal(actual: unknown, expected: unknown, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  rejects(promise: Promise<unknown>, check?: RegExp | ((err: unknown) => boolean)): Promise<void>;
}

/** The four assertions the suite needs (strict semantics, as node:assert/strict). */
const assert: ContractAssert = {
  ok(value: unknown, message = "expected a truthy value"): asserts value {
    if (!value) throw new ContractViolation(message);
  },
  equal(actual: unknown, expected: unknown, message?: string): void {
    if (!Object.is(actual, expected))
      throw new ContractViolation(message ?? `expected ${inspect(expected)}, got ${inspect(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown, message?: string): void {
    if (!isDeepStrictEqual(actual, expected))
      throw new ContractViolation(
        message ?? `expected ${inspect(expected, { depth: 4 })}, got ${inspect(actual, { depth: 4 })}`,
      );
  },
  /** Resolves when `promise` rejects and `check` (a RegExp on the message, or a predicate) accepts the error. */
  async rejects(promise: Promise<unknown>, check?: RegExp | ((err: unknown) => boolean)): Promise<void> {
    let rejected = false;
    let error: unknown;
    try {
      await promise;
    } catch (err) {
      rejected = true;
      error = err;
    }
    if (!rejected) throw new ContractViolation("expected the operation to be refused, but it succeeded");
    if (check instanceof RegExp) {
      const message = error instanceof Error ? error.message : String(error);
      if (!check.test(message)) throw new ContractViolation(`the refusal "${message}" does not match ${String(check)}`);
    } else if (check !== undefined && !check(error)) throw new ContractViolation("the refusal is not the expected one");
  },
};

const MiB = 1024 * 1024;

function newKey(): string {
  return `org-${randomUUID().slice(0, 8)}/tr-${randomUUID().slice(0, 8)}/ev-${randomUUID().slice(0, 8)}/${randomUUID()}`;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function* chunked(...parts: (string | Uint8Array)[]): AsyncIterable<Uint8Array | string> {
  for (const part of parts) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    yield part;
  }
}

async function readAll(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const out: Buffer[] = [];
  for await (const chunk of stream) out.push(Buffer.from(chunk));
  return Buffer.concat(out);
}

/** Deterministic synthetic bytes (no randomness: the same case always streams the same content). */
function synthetic(size: number, seed: number): Buffer {
  const bytes = Buffer.alloc(size);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < size; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    bytes.writeUInt8(x & 0xff, i);
  }
  return bytes;
}

/** Fails with a readable message if `value`, serialized, carries a URL or any forbidden fragment. */
function assertNoUrl(value: unknown, forbidden: readonly string[], what: string): void {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  assert.ok(!/[a-z][a-z0-9+.-]*:\/\//i.test(text), `${what} contains a URL: ${text}`);
  for (const fragment of forbidden)
    assert.ok(!text.includes(fragment), `${what} contains a forbidden fragment of the store's address`);
}

/**
 * Registers the contract for one adapter. `makeStore` is called once per case and must return an isolated fixture.
 */
export function describeEvidenceStoreContract(
  name: string,
  makeStore: () => Promise<EvidenceStoreFixture>,
  runner: ContractRunner,
  options: { readonly networkSurface: boolean },
): void {
  const { describe, it } = runner;
  const withFixture =
    (body: (f: EvidenceStoreFixture) => Promise<void>): (() => Promise<void>) =>
    async () => {
      const fixture = await makeStore();
      try {
        await body(fixture);
      } finally {
        await fixture.dispose();
      }
    };

  describe(`EvidenceStore contract: ${name} (ADR-0054 §2)`, () => {
    it(
      "round-trips the bytes and computes SHA-256 and size while streaming (strings and byte chunks)",
      withFixture(async ({ store }) => {
        const key = newKey();
        const bytes = Buffer.from("synthetic evidence, ملف تجريبي\n");
        const stored = await store.put(key, chunked(bytes.subarray(0, 5), bytes.subarray(5).toString("latin1")), 1024);
        const expected = Buffer.concat([bytes.subarray(0, 5), Buffer.from(bytes.subarray(5).toString("latin1"))]);
        assert.deepEqual(stored, { key, sha256: sha256(expected), size: expected.byteLength });
        assert.deepEqual(await readAll(await store.get(key)), expected);
        assert.deepEqual(await store.head(key), { size: expected.byteLength });
      }),
    );

    it(
      "round-trips an empty body and a single Uint8Array body",
      withFixture(async ({ store }) => {
        const empty = newKey();
        assert.deepEqual(await store.put(empty, new Uint8Array(0), 10), {
          key: empty,
          sha256: sha256(Buffer.alloc(0)),
          size: 0,
        });
        assert.equal((await readAll(await store.get(empty))).byteLength, 0);
        assert.deepEqual(await store.head(empty), { size: 0 });
        const single = newKey();
        const bytes = synthetic(4096, 7);
        assert.equal((await store.put(single, new Uint8Array(bytes), 4096)).sha256, sha256(bytes));
        assert.deepEqual(await readAll(await store.get(single)), bytes);
      }),
    );

    it(
      "round-trips a body above the 8 MiB multipart threshold byte for byte",
      withFixture(async ({ store }) => {
        const key = newKey();
        const bytes = synthetic(17 * MiB + 123, 11);
        const parts: Buffer[] = [];
        for (let offset = 0; offset < bytes.byteLength; offset += 1 * MiB)
          parts.push(bytes.subarray(offset, offset + 1 * MiB));
        const stored = await store.put(key, chunked(...parts), 25 * MiB);
        assert.equal(stored.size, bytes.byteLength);
        assert.equal(stored.sha256, sha256(bytes));
        const back = await readAll(await store.get(key));
        assert.equal(sha256(back), sha256(bytes));
        assert.deepEqual(await store.head(key), { size: bytes.byteLength });
      }),
      60_000,
    );

    it(
      "enforces maxBytes WHILE streaming: EvidenceTooLarge, the body is not drained, nothing is left behind",
      withFixture(async ({ store, listRaw }) => {
        const key = newKey();
        let pulled = 0;
        async function* body(): AsyncIterable<Uint8Array> {
          for (let i = 0; i < 100; i += 1) {
            pulled += 1;
            yield Buffer.alloc(10, 0x61);
          }
        }
        await assert.rejects(store.receive(key, body(), 25), (err: unknown) => {
          assert.ok(err instanceof EvidenceTooLarge);
          assert.equal(err.maxBytes, 25);
          return true;
        });
        assert.equal(pulled, 3, "the adapter stopped reading at the first chunk over the limit");
        assert.equal(await store.head(key), null);
        assert.deepEqual(await listRaw(), []);
      }),
    );

    it(
      "enforces maxBytes after a multipart part was already stored, and leaves nothing behind",
      withFixture(async ({ store, listRaw }) => {
        const key = newKey();
        const part = synthetic(4 * MiB, 3);
        await assert.rejects(
          store.receive(key, chunked(part, part, part, part, part), 18 * MiB),
          (err: unknown) => err instanceof EvidenceTooLarge,
        );
        assert.equal(await store.head(key), null);
        assert.deepEqual(await listRaw(), []);
      }),
      60_000,
    );

    it(
      "removes the temporary object when the body fails mid-stream (client abort) and rethrows the error",
      withFixture(async ({ store, listRaw }) => {
        const key = newKey();
        async function* failing(): AsyncIterable<Uint8Array> {
          yield Buffer.from("partial");
          throw new Error("synthetic client abort");
        }
        await assert.rejects(store.receive(key, failing(), 1024), /synthetic client abort/);
        assert.equal(await store.head(key), null);
        assert.deepEqual(await listRaw(), []);
      }),
    );

    it(
      "never makes a temporary object readable through get; finalise makes it readable and removes the temporary",
      withFixture(async ({ store, listRaw }) => {
        const key = newKey();
        const leaf = key.split("/").at(-1)!;
        const stored = await store.receive(key, chunked("staged ", "bytes"), 1024);
        assert.deepEqual(stored, { key, sha256: sha256(Buffer.from("staged bytes")), size: 12 });
        await assert.rejects(store.get(key));
        assert.equal(await store.head(key), null);
        assert.deepEqual(
          (await listRaw()).map((n) => n.split("/").at(-1)),
          [`${leaf}.part`],
          "only the temporary exists before finalise",
        );
        await store.finalise(key);
        assert.deepEqual(await readAll(await store.get(key)), Buffer.from("staged bytes"));
        assert.deepEqual(await store.head(key), { size: 12 });
        assert.deepEqual(
          (await listRaw()).map((n) => n.split("/").at(-1)),
          [leaf],
          "only the final object exists after finalise",
        );
      }),
    );

    it(
      "discardUncommitted removes the temporary and the final object, and is idempotent",
      withFixture(async ({ store, listRaw }) => {
        const received = newKey();
        await store.receive(received, chunked("x"), 10);
        await store.discardUncommitted(received);
        await store.discardUncommitted(received);
        const finalised = newKey();
        await store.put(finalised, chunked("y"), 10);
        await store.discardUncommitted(finalised);
        await store.discardUncommitted(finalised);
        await store.discardUncommitted(newKey()); // never written
        assert.equal(await store.head(received), null);
        assert.equal(await store.head(finalised), null);
        assert.deepEqual(await listRaw(), []);
      }),
    );

    it(
      "the sweep removes only temporaries older than the threshold, never a final object or a foreign name",
      withFixture(async ({ store, listRaw, age }) => {
        const oldTemp = newKey();
        const freshTemp = newKey();
        const oldFinal = newKey();
        const notUuid = `${newKey().split("/").slice(0, 3).join("/")}/not-a-uuid`;
        await store.receive(oldTemp, chunked("old temporary"), 100);
        await store.receive(freshTemp, chunked("fresh"), 100);
        await store.put(oldFinal, chunked("committed"), 100);
        await store.receive(notUuid, chunked("foreign"), 100);
        const twoHours = 2 * STALE_TEMPORARY_AGE_MS;
        await age(`${oldTemp}.part`, twoHours);
        await age(oldFinal, twoHours);
        await age(`${notUuid}.part`, twoHours);
        const removed: RemovedTemporary[] = [];
        const result = await store.sweepStaleTemporaries(STALE_TEMPORARY_AGE_MS, (r) => removed.push(r));
        assert.deepEqual(result, { removed: 1, keptFresh: 1 });
        assert.equal(removed.length, 1);
        assert.equal(removed[0]!.key, `${oldTemp}.part`);
        assert.equal(removed[0]!.sizeBytes, "old temporary".length);
        assert.ok(removed[0]!.ageMs > STALE_TEMPORARY_AGE_MS);
        const names = await listRaw();
        assert.ok(!names.includes(`${oldTemp}.part`));
        assert.ok(names.includes(`${freshTemp}.part`));
        assert.ok(names.includes(`${notUuid}.part`), "a name that is not an upload temporary is never removed");
        assert.deepEqual(await readAll(await store.get(oldFinal)), Buffer.from("committed"));
        await store.finalise(freshTemp); // the fresh upload can still complete
        assert.deepEqual(await readAll(await store.get(freshTemp)), Buffer.from("fresh"));
        assert.deepEqual(await store.sweepStaleTemporaries(STALE_TEMPORARY_AGE_MS, () => undefined), {
          removed: 0,
          keptFresh: 0,
        });
      }),
    );

    it(
      "head of a missing key is null, and get of a missing key is refused as not found (not as unavailable)",
      withFixture(async ({ store }) => {
        const key = newKey();
        assert.equal(await store.head(key), null);
        await assert.rejects(store.get(key), (err: unknown) => {
          assert.ok(!(err instanceof EvidenceStoreUnavailable), "a missing object is a 404, never a 503");
          return true;
        });
      }),
    );

    it(
      "concurrent receive of two keys does not mix bytes",
      withFixture(async ({ store }) => {
        const a = newKey();
        const b = newKey();
        const bytesA = synthetic(64 * 1024, 21);
        const bytesB = synthetic(64 * 1024, 42);
        const slices = (bytes: Buffer): Buffer[] =>
          Array.from({ length: 16 }, (_, i) => bytes.subarray(i * 4096, (i + 1) * 4096));
        const [storedA, storedB] = await Promise.all([
          store.receive(a, chunked(...slices(bytesA)), bytesA.byteLength),
          store.receive(b, chunked(...slices(bytesB)), bytesB.byteLength),
        ]);
        await Promise.all([store.finalise(a), store.finalise(b)]);
        assert.equal(storedA.sha256, sha256(bytesA));
        assert.equal(storedB.sha256, sha256(bytesB));
        assert.deepEqual(await readAll(await store.get(a)), bytesA);
        assert.deepEqual(await readAll(await store.get(b)), bytesB);
      }),
    );

    it(
      "refuses keys that are not opaque relative identifiers",
      withFixture(async ({ store }) => {
        await assert.rejects(store.put("../escape", chunked("x"), 10), /invalid key/);
        await assert.rejects(store.put("a/../../escape", chunked("x"), 10), /invalid key/);
        await assert.rejects(store.put("/abs", chunked("x"), 10));
        await assert.rejects(store.get("../escape"), /invalid key/);
      }),
    );

    // Registered only for a store with a network surface (s3). The filesystem store has none: its files are never
    // web-served (ADR-0010 §2), so there is no anonymous request to refuse and the case is not claimed for it.
    if (options.networkSurface)
      it(
        "an anonymous read of a stored object is refused",
        withFixture(async ({ store, anonymousRead }) => {
          assert.ok(anonymousRead !== undefined, "a store with a network surface provides anonymousRead");
          const key = newKey();
          await store.put(key, chunked("private"), 100);
          assert.equal(await anonymousRead(key), 403);
        }),
      );

    it(
      "returns no URL anywhere: no result, callback payload or error carries a URL or the store's address",
      withFixture(async ({ store, forbiddenInOutput, age }) => {
        const outputs: unknown[] = [];
        const key = newKey();
        outputs.push(await store.receive(key, chunked("a"), 10));
        await store.finalise(key);
        outputs.push(await store.put(newKey(), chunked("b"), 10));
        outputs.push(await store.head(key));
        const temp = newKey();
        await store.receive(temp, chunked("c"), 10);
        await age(`${temp}.part`, 2 * STALE_TEMPORARY_AGE_MS);
        outputs.push(await store.sweepStaleTemporaries(STALE_TEMPORARY_AGE_MS, (r) => outputs.push(r)));
        const errors: unknown[] = [];
        await store.get(newKey()).catch((err: unknown) => errors.push(err));
        await store.finalise(newKey()).catch((err: unknown) => errors.push(err));
        await store.receive(newKey(), chunked("too large"), 2).catch((err: unknown) => errors.push(err));
        assert.equal(errors.length, 3);
        assertNoUrl(outputs, forbiddenInOutput, "a store result");
        for (const err of errors) assertNoUrl(String((err as Error).message), forbiddenInOutput, "a store error");
      }),
    );
  });
}
