// Architecture test (ADR-0002). Parses every import (including type-only and re-exports) and fails when:
//  1. a module imports anything other than its own files, the index.ts of a module in its `dependsOn`, the shared
//     packages (@mth/shared, @mth/config, @mth/db), node: built-ins or a third-party dependency of @mth/api;
//  2. a module reaches into the composition root (server.ts, main.ts, index.ts, modules.ts);
//  3. a module directory is not in the module map, or a P1 module has no index.ts;
//  4. the declared module graph has a cycle, or audit/access depend on a business module;
//  5. the package dependency direction is broken (db -> config, shared; config -> shared; shared -> none;
//     apps/web never imports @mth/db or @mth/config).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { API_MODULES, P1_MODULES, type ApiModule } from "./modules.ts";

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(SRC, "../../..");
const MODULES_DIR = join(SRC, "modules");
const apiPkg = JSON.parse(readFileSync(join(SRC, "../package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

function importsOf(file: string): string[] {
  return ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles.map((f) => f.fileName);
}

const THIRD_PARTY = new Set(Object.keys(apiPkg.dependencies).filter((d) => !d.startsWith("@mth/")));
const SHARED_ALLOWED = new Set(["@mth/shared", "@mth/shared/schemas", "@mth/config", "@mth/db"]);

function bareAllowed(spec: string): boolean {
  if (spec.startsWith("node:")) return true;
  if (SHARED_ALLOWED.has(spec)) return true;
  const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
  return THIRD_PARTY.has(pkg);
}

describe("API module boundaries (ADR-0002)", () => {
  const moduleDirs = readdirSync(MODULES_DIR).filter((d) => statSync(join(MODULES_DIR, d)).isDirectory());

  it("has only mapped module directories, and every P1 module has a public index.ts", () => {
    expect(moduleDirs.filter((d) => !(d in API_MODULES))).toEqual([]);
    for (const m of P1_MODULES) expect(existsSync(join(MODULES_DIR, m, "index.ts")), m).toBe(true);
  });

  it("every import respects dependsOn, public surfaces and allowed packages", () => {
    const violations: string[] = [];
    for (const mod of moduleDirs as ApiModule[]) {
      const allowedDeps = new Set<string>(API_MODULES[mod].dependsOn);
      for (const file of walk(join(MODULES_DIR, mod))) {
        const where = relative(SRC, file);
        for (const spec of importsOf(file)) {
          if (spec.startsWith(".")) {
            const target = resolve(dirname(file), spec);
            const rel = relative(MODULES_DIR, target);
            if (rel.startsWith("..")) {
              violations.push(`${where}: imports ${spec} outside src/modules (composition root)`);
              continue;
            }
            const [targetMod, ...rest] = rel.split("/");
            if (targetMod === mod) continue;
            if (!allowedDeps.has(targetMod!))
              violations.push(`${where}: module ${mod} may not import module ${targetMod}`);
            else if (rest.join("/") !== "index.ts")
              violations.push(`${where}: imports ${spec}; only ${targetMod}/index.ts is public`);
          } else if (!bareAllowed(spec) && !(spec === "vitest" && file.endsWith(".test.ts"))) {
            violations.push(`${where}: imports package ${spec}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("the declared module graph is acyclic, and audit/access depend on no business module", () => {
    const state = new Map<string, "visiting" | "done">();
    const visit = (m: string, path: string[]): void => {
      if (state.get(m) === "done") return;
      if (state.get(m) === "visiting") throw new Error(`cycle: ${[...path, m].join(" -> ")}`);
      state.set(m, "visiting");
      for (const d of API_MODULES[m as ApiModule].dependsOn) visit(d, [...path, m]);
      state.set(m, "done");
    };
    for (const m of Object.keys(API_MODULES)) expect(() => visit(m, [])).not.toThrow();
    expect(API_MODULES.audit.dependsOn).toEqual(["platform"]);
    expect([...API_MODULES.access.dependsOn].sort()).toEqual(["audit", "platform"]);
    expect(API_MODULES.platform.dependsOn).toEqual([]);
  });

  it("detects a violation (self-check of the checker)", () => {
    // The checker must flag a deep import: prove the path logic on a synthetic case.
    const rel = relative(MODULES_DIR, resolve(join(MODULES_DIR, "transformations"), "../access/policy.ts"));
    expect(rel.split("/")).toEqual(["access", "policy.ts"]);
    expect(bareAllowed("@mth/web")).toBe(false);
    expect(bareAllowed("fastify")).toBe(true);
  });
});

describe("package dependency direction (ADR-0002 rule 5)", () => {
  const workspaceImports = (dir: string) =>
    walk(join(REPO, dir)).flatMap((f) =>
      importsOf(f)
        .filter((s) => s.startsWith("@mth/"))
        .map((s) => `${relative(REPO, f)} -> ${s}`),
    );

  it("packages/db imports only @mth/config and @mth/shared", () => {
    expect(workspaceImports("packages/db/src").filter((l) => !/-> @mth\/(config|shared)(\/schemas)?$/.test(l))).toEqual(
      [],
    );
  });
  it("packages/config imports only @mth/shared", () => {
    expect(workspaceImports("packages/config/src").filter((l) => !/-> @mth\/shared(\/schemas)?$/.test(l))).toEqual([]);
  });
  it("packages/shared imports no workspace package", () => {
    expect(workspaceImports("packages/shared/src")).toEqual([]);
  });
  it("apps/web never imports @mth/db or @mth/config (browser bundle, no secrets)", () => {
    expect(workspaceImports("apps/web/src").filter((l) => /-> @mth\/(db|config)/.test(l))).toEqual([]);
  });
  it("apps/worker imports no API code", () => {
    const deep = walk(join(REPO, "apps/worker/src")).flatMap((f) =>
      importsOf(f).filter((s) => s.includes("apps/api") || s.startsWith("@mth/api")),
    );
    expect(deep).toEqual([]);
  });
});
