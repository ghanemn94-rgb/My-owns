// release module suite (P7; T-DG7-BE-A created the module, p7-plan §2, §5.1; T-DG7-BE-H filled it, p7-work-split §I.1,
// §I.4). Unit tests without a database:
//  - the module registers its three routes through its hook and reports "active";
//  - T-I8: `.dockerignore` lets exactly docs/delivery/requirements.csv into the image build context, and the API's
//    `build` runs the generator into dist/release/register-snapshot.json (ADR-0071 §2.4, §2.5);
//  - T-I9 (G7): during a full request cycle of the three operations, the only file path the process opens or reads
//    through node:fs or node:fs/promises is the snapshot path. The access module is replaced by an allow-all stub here
//    ONLY so that no database is needed; authorization (G1, G2) is proven on a real PostgreSQL in
//    test/integration/release/register.test.ts (T-I5);
//  - the snapshot loader's validation, the cursor and About's derivations.
// All register rows below are SYNTHETIC. Nothing here is a DG0-DG7 gate decision or a G1-G6 business approval.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ModuleDeps } from "../platform/index.ts";
import { buildAbout, LATER_CLAUSE_MARKER } from "./about.ts";
import { decodeRequirementCursor, encodeRequirementCursor, requirementFiltersHash } from "./cursor.ts";
import { registerReleaseModule } from "./index.ts";
import {
  defaultSnapshotPath,
  fileRegisterSnapshotSource,
  REGISTER_COLUMNS,
  snapshotFromJson,
  SnapshotUnavailable,
  type Snapshot,
} from "./snapshot.ts";

// T-I9: every node:fs and node:fs/promises function records its path argument while `fsTrace.on` is set.
const fsTrace = vi.hoisted(() => ({ on: false, paths: [] as string[] }));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const wrap = (fn: unknown) =>
    typeof fn === "function"
      ? (...args: unknown[]) => {
          if (fsTrace.on && (typeof args[0] === "string" || args[0] instanceof URL))
            fsTrace.paths.push(String(args[0]));
          return (fn as (...a: unknown[]) => unknown)(...args);
        }
      : fn;
  const wrapped = Object.fromEntries(Object.entries(real).map(([k, v]) => [k, k === "promises" ? v : wrap(v)]));
  return { ...wrapped, default: wrapped };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const wrap = (fn: unknown) =>
    typeof fn === "function"
      ? (...args: unknown[]) => {
          if (fsTrace.on && (typeof args[0] === "string" || args[0] instanceof URL))
            fsTrace.paths.push(String(args[0]));
          return (fn as (...a: unknown[]) => unknown)(...args);
        }
      : fn;
  const wrapped = Object.fromEntries(Object.entries(real).map(([k, v]) => [k, wrap(v)]));
  return { ...wrapped, default: wrapped };
});
// The allow-all access stub (T-I9 needs no database; see the header).
vi.mock("../access/index.ts", () => ({
  principalOf: () => ({ userId: "00000000-0000-7000-8000-000000000001" }),
  organizationsWith: () => ["00000000-0000-7000-8000-000000000002"],
  authorize: async () => ({ allowed: true }),
}));

const REPO = new URL("../../../../../", import.meta.url);
const work = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "release-unit-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A synthetic snapshot document. */
function doc(rows: string[][], extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: "mth-register-snapshot/1",
    sourcePath: "docs/delivery/requirements.csv",
    sourceSha256: "a".repeat(64),
    rowCount: rows.length,
    generatedAt: "2026-11-13T00:00:00Z",
    columns: [...REGISTER_COLUMNS],
    rows,
    externalDependencies: null,
    ...extra,
  };
}
function row(id: string, over: Partial<Record<(typeof REGISTER_COLUMNS)[number], string>> = {}): string[] {
  const fixed = { req_id: id, class: "USER", final_gate: "DG7", status: "IMPLEMENTED", increments: "P7", ...over };
  const v = new Map<string, string>(REGISTER_COLUMNS.map((c) => [c, `${c} of ${id}`]));
  for (const [k, value] of Object.entries(fixed)) v.set(k, value);
  return REGISTER_COLUMNS.map((c) => v.get(c)!);
}

describe("release module (P7)", () => {
  it("registers its three routes through its hook and reports active", async () => {
    const app = Fastify({ logger: false });
    try {
      const registration = registerReleaseModule(app, {} as ModuleDeps, {
        load: () => Promise.reject(new SnapshotUnavailable("test")),
      });
      expect(registration.module).toBe("release");
      expect(registration.deliversIn).toBe("P7");
      expect(registration.status).toBe("active");
      expect([...registration.routes]).toEqual([
        "GET /api/v1/admin/requirements",
        "GET /api/v1/admin/requirements/:reqId",
        "GET /api/v1/admin/about",
      ]);
    } finally {
      await app.close();
    }
  });

  it("has its route file in place (created by T-DG7-BE-A, p7-plan §5.1)", () => {
    expect(readdirSync(new URL(".", import.meta.url))).toContain("routes.ts");
  });
});

describe("T-I8: the image build context and the build step", () => {
  it(".dockerignore: docs/delivery directly followed by !docs/delivery/requirements.csv, and no other !docs/delivery line", () => {
    const lines = readFileSync(new URL(".dockerignore", REPO), "utf8").split("\n");
    const at = lines.indexOf("docs/delivery");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines.slice(at + 1, at + 2)).toEqual(["!docs/delivery/requirements.csv"]);
    expect(lines.filter((l) => l.trim().startsWith("!docs/delivery"))).toEqual(["!docs/delivery/requirements.csv"]);
    // A later line must not exclude the file again (a .dockerignore's last matching line wins).
    const reExcludes = /^(\*\*?|docs\/?|docs\/delivery(\/.*)?|.*requirements\.csv|.*\*\.csv)$/;
    expect(lines.slice(at + 2).filter((l) => reExcludes.test(l.trim()))).toEqual([]);
  });

  it("apps/api/package.json build runs the generator into dist/release/register-snapshot.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("apps/api/package.json", REPO), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build"]).toBe(
      "tsc -p tsconfig.build.json && node scripts/register-snapshot.mjs --csv ../../docs/delivery/requirements.csv --deps ../../docs/handover/external-dependencies.json --out dist/release/register-snapshot.json",
    );
  });

  it("the default path resolves next to the compiled module tree (dist/release/), and in source mode to the package dist", () => {
    const compiled = new URL("apps/api/dist/modules/release/snapshot.js", REPO).href;
    expect(defaultSnapshotPath(compiled)).toBe(new URL("apps/api/dist/release/register-snapshot.json", REPO).pathname);
    expect(defaultSnapshotPath()).toBe(new URL("apps/api/dist/release/register-snapshot.json", REPO).pathname);
  });
});

describe("T-I9 (G7): the only file read during a request cycle is the snapshot", () => {
  it("list, get and About read the snapshot path and no other path (no docs/, no package.json)", async () => {
    const path = join(work, "register-snapshot.json");
    writeFileSync(path, JSON.stringify(doc([row("REQ-S02-003"), row("REQ-DLV-010", { status: "SPECIFIED" })])));
    const app = Fastify({ logger: false });
    try {
      registerReleaseModule(app, {} as ModuleDeps, fileRegisterSnapshotSource(path));
      await app.ready();
      fsTrace.paths.length = 0;
      fsTrace.on = true;
      const list = await app.inject({ method: "GET", url: "/api/v1/admin/requirements" });
      const get = await app.inject({ method: "GET", url: "/api/v1/admin/requirements/REQ-S02-003" });
      const about = await app.inject({ method: "GET", url: "/api/v1/admin/about" });
      fsTrace.on = false;
      expect([list.statusCode, get.statusCode, about.statusCode]).toEqual([200, 200, 200]);
      expect(fsTrace.paths.length).toBeGreaterThan(0); // the trace is live: the first load read the file
      expect([...new Set(fsTrace.paths)]).toEqual([path]);
      expect(fsTrace.paths.some((p) => p.includes("docs/"))).toBe(false);
    } finally {
      fsTrace.on = false;
      await app.close();
    }
  });
});

describe("the snapshot loader (G4)", () => {
  it("refuses a wrong schemaVersion, rowCount != rows, a bad row and wrong columns", () => {
    const good = doc([row("REQ-S02-003")]);
    expect(snapshotFromJson(good).rows).toHaveLength(1);
    const reasons = [
      { ...good, schemaVersion: "mth-register-snapshot/2" },
      { ...good, rowCount: 2 },
      doc([row("REQ-S02-003", { status: "DONE" })]),
      doc([row("REQ-S22-003")]),
      doc([row("REQ-S02-003"), row("REQ-S02-003")]),
      { ...good, columns: [...REGISTER_COLUMNS].reverse() },
      { ...good, externalDependencies: [{ key: "x" }] },
      [],
    ].map((d) => {
      try {
        snapshotFromJson(d);
        return "accepted";
      } catch (e) {
        return e instanceof SnapshotUnavailable ? "refused" : "threw";
      }
    });
    expect(reasons).toEqual(Array(8).fill("refused"));
  });

  it("caches on success only: a missing file is retried, then a written file is served; the warn line is logged once", async () => {
    const path = join(work, "later.json");
    const source = fileRegisterSnapshotSource(path);
    const warned: string[] = [];
    const log = { warn: (line: string) => warned.push(line) };
    await expect(source.load(log)).rejects.toBeInstanceOf(SnapshotUnavailable);
    await expect(source.load(log)).rejects.toBeInstanceOf(SnapshotUnavailable);
    expect(warned).toEqual([
      "release: the register snapshot is unavailable (file not found); the register and About show it as unavailable",
    ]);
    writeFileSync(path, JSON.stringify(doc([row("REQ-S02-003")])));
    const first = await source.load(log);
    expect(first.info.rowCount).toBe(1);
    writeFileSync(path, "corrupt");
    expect(await source.load(log)).toBe(first); // cached after success
    expect(Object.isFrozen(first.rows)).toBe(true);
    expect(Object.isFrozen(first.rows[0])).toBe(true);
  });
});

describe("the cursor", () => {
  it("round-trips for the same filters; another filter set or garbage -> 400 validation.cursor", () => {
    const hash = requirementFiltersHash({ status: "SPECIFIED" });
    const cursor = encodeRequirementCursor("REQ-S02-003", hash);
    expect(decodeRequirementCursor(cursor, hash)).toBe("REQ-S02-003");
    expect(decodeRequirementCursor(undefined, hash)).toBeNull();
    for (const [c, h] of [
      [cursor, requirementFiltersHash({ status: "BLOCKED" })],
      [cursor, requirementFiltersHash({})],
      ["not base64 !", hash],
      [Buffer.from("[1]").toString("base64url"), hash],
    ] as const) {
      expect(() => decodeRequirementCursor(c, h)).toThrow(
        expect.objectContaining({ status: 400, errors: [expect.objectContaining({ code: "validation.cursor" })] }),
      );
    }
  });
});

describe("buildAbout (ADR-0071 §4)", () => {
  it("counts, open items, later clauses; null snapshot -> null fields; external dependencies null stays null", () => {
    const snapshot: Snapshot = snapshotFromJson(
      doc([
        row("REQ-S02-005", { status: "SPECIFIED", notes: "needs X" }),
        row("REQ-DLV-021", { notes: `${LATER_CLAUSE_MARKER} the DG7 gate record` }),
        row("REQ-S02-003"),
      ]),
    );
    const about = buildAbout(snapshot, { appVersion: "0.1.0", contractVersion: "1.6.0-p7" });
    expect(about.statusCounts).toEqual({ PLANNED: 0, SPECIFIED: 1, IMPLEMENTED: 2, BLOCKED: 0 });
    expect(about.openItems!.map((i) => [i.reqId, i.notes])).toEqual([["REQ-S02-005", "needs X"]]);
    expect(about.laterClauses!.map((i) => i.reqId)).toEqual(["REQ-DLV-021"]);
    expect(about.externalDependencies).toBeNull();
    const none = buildAbout(null, { appVersion: "0.1.0", contractVersion: "1.6.0-p7" });
    expect([none.register, none.statusCounts, none.openItems, none.laterClauses, none.externalDependencies]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
