// evidence module suite (p2-work-split §2; ADR-0010, ADR-0018). Unit level: mapping and boundary, the routes it
// registers (each declaring access), and the filesystem EvidenceStore (atomic write, SHA-256 while streaming, size
// limit, key confinement). Behaviour against PostgreSQL: test/integration/evidence.test.ts.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import {
  AST_TEST_TIMEOUT_MS,
  fileViolations,
  moduleFiles,
  moduleViolations,
  MODULES_DIR,
} from "../../architecture.testkit.ts";
import { API_MODULES, P2_MODULES } from "../../modules.ts";
import type { ModuleDeps } from "../platform/index.ts";
import * as mod from "./index.ts";
import {
  EvidenceTooLarge,
  FilesystemEvidenceStore,
  STALE_TEMPORARY_AGE_MS,
  evidenceStoreFor,
  type RemovedTemporary,
} from "./store.ts";

const root = mkdtempSync(join(tmpdir(), "mth-evidence-unit-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("evidence module (P2)", () => {
  it("is a P2 module that depends on platform, audit, access and transformations (register kit)", () => {
    expect(P2_MODULES).toContain("evidence");
    expect([...API_MODULES.evidence.dependsOn].sort()).toEqual(["access", "audit", "platform", "transformations"]);
  });

  it("has a public index.ts exposing its wiring hook and the gate-evaluator facts", () => {
    expect(moduleFiles("evidence")).toContain("index.ts");
    expect(Object.keys(mod).sort()).toEqual([
      "EVIDENCE_MODULE",
      "loadVerifiedEvidenceFacts",
      "registerEvidenceModule",
      "toEvidence",
    ]);
  });

  it("registers the eleven contract routes, each declaring its access", async () => {
    const app = Fastify({ logger: false });
    const routes: { key: string; access: unknown }[] = [];
    app.addHook("onRoute", (r) => {
      if (r.method !== "HEAD") routes.push({ key: `${String(r.method)} ${r.url}`, access: r.config?.access });
    });
    const deps = { db: {}, config: { evidenceStorage: { driver: "filesystem", path: root } } } as unknown as ModuleDeps;
    const registration = mod.registerEvidenceModule(app, deps);
    await app.ready();
    expect(routes.map((r) => r.key).sort()).toEqual([...registration.routes].sort());
    expect(registration.routes).toHaveLength(11);
    for (const r of routes) expect(r.access, r.key).toBeTruthy();
    expect(routes.find((r) => r.key.endsWith("/review"))?.access).toEqual({ permission: "evidence.review" });
    await app.close();
  });

  it(
    "its declared boundary holds",
    () => {
      expect(moduleViolations("evidence")).toEqual([]);
      expect(
        fileViolations(
          "evidence",
          join(MODULES_DIR, "evidence", "planted.ts"),
          `import { x } from "../workflows/index.ts";`,
        ).join("\n"),
      ).toContain("module evidence may not import module workflows");
    },
    AST_TEST_TIMEOUT_MS,
  ); // F-DG2-143: AST walk of the module sources gets explicit headroom.
});

describe("FilesystemEvidenceStore (ADR-0010)", () => {
  const store = new FilesystemEvidenceStore(root);
  async function* chunks(...parts: string[]) {
    for (const p of parts) yield Buffer.from(p);
  }

  it("stores atomically and computes SHA-256 and size while streaming", async () => {
    const put = await store.put("org/t/e/one", chunks("synthetic ", "evidence"), 1024);
    expect(put).toEqual({
      key: "org/t/e/one",
      sha256: createHash("sha256").update("synthetic evidence").digest("hex"),
      size: 18,
    });
    expect(readdirSync(join(root, "org/t/e"))).toEqual(["one"]);
    const back: Buffer[] = [];
    for await (const c of await store.get("org/t/e/one")) back.push(Buffer.from(c));
    expect(Buffer.concat(back).toString()).toBe("synthetic evidence");
    expect(await store.head("org/t/e/one")).toEqual({ size: 18 });
  });

  it("refuses content over the limit and leaves no partial file", async () => {
    await expect(store.put("org/t/e/big", chunks("x".repeat(10), "y".repeat(10)), 15)).rejects.toBeInstanceOf(
      EvidenceTooLarge,
    );
    expect(existsSync(join(root, "org/t/e/big"))).toBe(false);
    expect(existsSync(join(root, "org/t/e/big.part"))).toBe(false);
  });

  it("confines keys to the store root", async () => {
    await expect(store.put("../escape", chunks("x"), 10)).rejects.toThrow(/invalid key/);
    await expect(store.put("a/../../escape", chunks("x"), 10)).rejects.toThrow(/invalid key/);
    await expect(store.put("/abs", chunks("x"), 10)).rejects.toThrow();
  });

  it("T-DG2-BE17: receive holds the bytes in a temporary object that get() cannot read until finalise", async () => {
    const got = await store.receive("org/t/e/two", chunks("staged ", "bytes"), 1024);
    expect(got).toEqual({
      key: "org/t/e/two",
      sha256: createHash("sha256").update("staged bytes").digest("hex"),
      size: 12,
    });
    expect(readdirSync(join(root, "org/t/e")).filter((f) => f.startsWith("two"))).toEqual(["two.part"]);
    await expect(store.get("org/t/e/two")).rejects.toThrow();
    expect(await store.head("org/t/e/two")).toBeNull();
    await store.finalise("org/t/e/two");
    expect(readdirSync(join(root, "org/t/e")).filter((f) => f.startsWith("two"))).toEqual(["two"]);
    expect(await store.head("org/t/e/two")).toEqual({ size: 12 });
  });

  it("T-DG2-BE17: discardUncommitted removes a received-but-not-finalised object and a finalised one", async () => {
    await store.receive("org/t/e/three", chunks("x"), 10);
    await store.discardUncommitted("org/t/e/three");
    expect(readdirSync(join(root, "org/t/e")).filter((f) => f.startsWith("three"))).toEqual([]);
    await store.put("org/t/e/four", chunks("y"), 10);
    await store.discardUncommitted("org/t/e/four");
    await store.discardUncommitted("org/t/e/four"); // idempotent
    expect(readdirSync(join(root, "org/t/e")).filter((f) => f.startsWith("four"))).toEqual([]);
  });

  it("T-DG2-BE18A: the stale-temporary sweep removes only old <uuid>.part files at key depth; never a final object, never through a symlink", async () => {
    const sweepRoot = mkdtempSync(join(tmpdir(), "mth-evidence-sweep-"));
    try {
      const u = (n: number) => `0000000${n}-0000-7000-8000-000000000000`;
      const keyDir = join(sweepRoot, "org", "t", "e");
      mkdirSync(keyDir, { recursive: true });
      const old = new Date(Date.now() - STALE_TEMPORARY_AGE_MS - 60_000);
      const make = (dir: string, name: string, at: Date | null) => {
        writeFileSync(join(dir, name), "synthetic");
        if (at) utimesSync(join(dir, name), at, at);
      };
      make(keyDir, `${u(1)}.part`, old); // stale temporary: removed
      make(keyDir, `${u(2)}.part`, null); // fresh temporary: kept
      make(keyDir, u(3), old); // final object, old: kept
      make(keyDir, "readme.part", old); // not a temporary's name: kept
      make(join(sweepRoot, "org"), `${u(4)}.part`, old); // wrong depth: kept
      // A symlinked directory pointing OUTSIDE the store is never followed.
      const outside = mkdtempSync(join(tmpdir(), "mth-evidence-outside-"));
      mkdirSync(join(outside, "t", "e"), { recursive: true });
      make(join(outside, "t", "e"), `${u(5)}.part`, old);
      symlinkSync(outside, join(sweepRoot, "linked"));
      const removed: RemovedTemporary[] = [];
      const result = await new FilesystemEvidenceStore(sweepRoot).sweepStaleTemporaries(STALE_TEMPORARY_AGE_MS, (r) =>
        removed.push(r),
      );
      expect(result).toEqual({ removed: 1, keptFresh: 1 });
      expect(removed.map((r) => r.key)).toEqual([`org/t/e/${u(1)}.part`]);
      expect(removed[0]!.sizeBytes).toBe("synthetic".length);
      expect(readdirSync(keyDir).sort()).toEqual([`${u(2)}.part`, u(3), "readme.part"].sort());
      expect(readdirSync(join(sweepRoot, "org"))).toContain(`${u(4)}.part`);
      expect(readdirSync(join(outside, "t", "e"))).toEqual([`${u(5)}.part`]);
      rmSync(outside, { recursive: true, force: true });
      // A missing store root is not an error (nothing uploaded yet).
      expect(
        await new FilesystemEvidenceStore(join(sweepRoot, "missing")).sweepStaleTemporaries(1, () => undefined),
      ).toEqual({ removed: 0, keptFresh: 0 });
    } finally {
      rmSync(sweepRoot, { recursive: true, force: true });
    }
  });

  it("T-DG2-BE18A: STALE_TEMPORARY_AGE_MS is far above the longest time a live upload can own its temporary", () => {
    // requestTimeout 300 s + pool checkout 10 s + statement/idle-in-transaction 30 s + shutdown backstop 10 s, x6.
    expect(STALE_TEMPORARY_AGE_MS).toBeGreaterThanOrEqual(6 * (300_000 + 10_000 + 30_000 + 10_000));
  });

  it("T-DG2-BE17: a body stream that fails mid-way leaves no temporary object", async () => {
    async function* failing() {
      yield Buffer.from("partial");
      throw Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    }
    await expect(store.receive("org/t/e/five", failing(), 1024)).rejects.toThrow("aborted");
    expect(readdirSync(join(root, "org/t/e")).filter((f) => f.startsWith("five"))).toEqual([]);
  });

  it("the S3-compatible driver is not part of P2 and fails closed", async () => {
    const s3 = evidenceStoreFor({ driver: "s3", path: root });
    await expect(s3.put("k", chunks("x"), 10)).rejects.toThrow(/P6/);
    await expect(s3.receive("k", chunks("x"), 10)).rejects.toThrow(/P6/);
    await expect(s3.finalise("k")).rejects.toThrow(/P6/);
  });
});
