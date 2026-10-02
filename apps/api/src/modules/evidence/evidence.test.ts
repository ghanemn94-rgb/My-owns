// evidence module suite (p2-work-split §2; ADR-0010, ADR-0018). Unit level: mapping and boundary, the routes it
// registers (each declaring access), and the filesystem EvidenceStore (atomic write, SHA-256 while streaming, size
// limit, key confinement). Behaviour against PostgreSQL: test/integration/evidence.test.ts.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { fileViolations, moduleFiles, moduleViolations, MODULES_DIR } from "../../architecture.testkit.ts";
import { API_MODULES, P2_MODULES } from "../../modules.ts";
import type { ModuleDeps } from "../platform/index.ts";
import * as mod from "./index.ts";
import { EvidenceTooLarge, FilesystemEvidenceStore, evidenceStoreFor } from "./store.ts";

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

  it("its declared boundary holds", () => {
    expect(moduleViolations("evidence")).toEqual([]);
    expect(
      fileViolations(
        "evidence",
        join(MODULES_DIR, "evidence", "planted.ts"),
        `import { x } from "../workflows/index.ts";`,
      ).join("\n"),
    ).toContain("module evidence may not import module workflows");
  });
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

  it("the S3-compatible driver is not part of P2 and fails closed", async () => {
    await expect(evidenceStoreFor({ driver: "s3", path: root }).put("k", chunks("x"), 10)).rejects.toThrow(/P6/);
  });
});
