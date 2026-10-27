// Offline dependency audit (ADR-0052 §6, REQ-S16-030 "dependency checks"; T-DG6-DO-A). Runs in `pnpm test`
// (Vitest project unit-node), with no network. The fixtures under fixtures/dep-audit/ are SYNTHETIC: their advisories
// are invented for the test and name no real package.
//
// The last test checks the committed tree: the SBOM (licenses/sbom.cdx.json) against the newest committed snapshot
// (deploy/advisories/snapshot-<yyyy-mm-dd>.json). It fails while a High/Critical advisory in that snapshot matches a
// shipped component; that failure is the control working, not a flaky test.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AuditInputError,
  audit,
  compareVersions,
  newestSnapshot,
  satisfies,
  sbomPackages,
  validateSnapshot,
} from "../dep-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "dep-audit.mjs");
const fixture = (name) => join(here, "fixtures", "dep-audit", name);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** Runs the CLI offline, with no proxy variables, and returns { status, out }. */
function run(...args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/proxy/i.test(k)) delete env[k];
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env, timeout: 60_000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("version ranges (npm syntax subset)", () => {
  it("orders versions by SemVer precedence, pre-releases before their release", () => {
    expect(compareVersions("1.2.3", "1.2.10")).toBe(-1);
    expect(compareVersions("2.0.0-rc.1", "2.0.0")).toBe(-1);
    expect(compareVersions("2.0.0-rc.2", "2.0.0-rc.10")).toBe(-1);
    expect(compareVersions("2.0.0-alpha", "2.0.0-alpha.1")).toBe(-1);
    expect(compareVersions("2.0.0-1", "2.0.0-alpha")).toBe(-1);
    expect(compareVersions("1.0.0+build.5", "1.0.0")).toBe(0);
  });

  it.each([
    ["5.6.1", "<5.12.2", true],
    ["5.12.2", "<5.12.2", false],
    ["0.28.7", ">=0.26.0 <=0.28.11", true],
    ["0.25.0", ">=0.26.0 <=0.28.11", false],
    ["7.9.0", ">=7.7.0 <7.13.2", true],
    ["1.2.5", "<1.0.0 || >=1.2.0 <1.2.6", true],
    ["1.1.0", "<1.0.0 || >=1.2.0 <1.2.6", false],
    ["3.0.0", "*", true],
    ["3.0.0", "", true],
    ["1.5.0", "1.0.0 - 2.0.0", true],
    ["2.0.1", "1.0.0 - 2.0.0", false],
    ["1.2.3", "1.2.3", true],
    ["1.2.3", "= 1.2.3", true],
    ["1.2.3", ">= 1.2.0 < 1.3.0", true],
    ["2.0.0-rc.1", "<2.0.0", true],
  ])("%s in %j is %s", (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });

  it.each(["^1.0.0", "~1.2.0", "1.x", ">=1.2"])("refuses %j instead of guessing", (range) => {
    expect(() => satisfies("1.2.3", range)).toThrow(AuditInputError);
  });
});

describe("audit() on the synthetic fixtures", () => {
  const packages = sbomPackages(readJson(fixture("sbom.json")));

  it("reads npm library components with their mth:scope and skips containers", () => {
    expect(packages).toEqual([
      { name: "fixture-runtime", version: "1.2.0", scope: "runtime" },
      { name: "@fixture/bundled", version: "2.0.0-rc.1", scope: "bundled" },
      { name: "fixture-dev-tool", version: "0.1.0", scope: "development" },
    ]);
  });

  it("negative fixture: a High and a Critical advisory matching shipped entries fail the check", () => {
    const snapshot = validateSnapshot(readJson(fixture("snapshot-negative.json")));
    const r = audit({ packages, snapshot, now: new Date("2026-10-11T12:00:00Z") });
    expect(r.passed).toBe(false);
    expect(r.failing.map((f) => [f.name, f.severity, f.id])).toEqual([
      ["fixture-runtime", "high", 10],
      ["@fixture/bundled", "critical", 11],
    ]);
    expect(r.ageDays).toBe(10);
  });

  it("clean fixture: passes; a development-only Critical and a shipped Moderate are listed, not failing", () => {
    const snapshot = validateSnapshot(readJson(fixture("snapshot-clean.json")));
    const r = audit({ packages, snapshot, now: new Date("2026-10-01T00:00:00Z") });
    expect(r.passed).toBe(true);
    expect(r.failing).toEqual([]);
    expect(r.info.map((f) => [f.name, f.severity])).toEqual([
      ["fixture-runtime", "moderate"],
      ["fixture-dev-tool", "critical"],
    ]);
  });

  it("a shipped component the snapshot never queried is Unknown and fails (never a silent pass)", () => {
    const snapshot = validateSnapshot(readJson(fixture("snapshot-uncovered.json")));
    const r = audit({ packages, snapshot });
    expect(r.passed).toBe(false);
    expect(r.uncoveredShipped).toEqual([{ name: "@fixture/bundled", version: "2.0.0-rc.1", scope: "bundled" }]);
  });

  it("refuses a snapshot without its source or retrieval date", () => {
    const s = readJson(fixture("snapshot-clean.json"));
    expect(() => validateSnapshot({ ...s, retrieved_at: undefined })).toThrow(/retrieved_at/);
    expect(() => validateSnapshot({ ...s, source: { url: "x" } })).toThrow(/source/);
    expect(() => validateSnapshot({ ...s, schema: "other" })).toThrow(/schema/);
  });
});

describe("dep-audit.mjs command line (offline)", () => {
  const sbom = fixture("sbom.json");

  it("exits 1 on the negative fixture and names the matching advisory and the snapshot age", () => {
    const r = run("--sbom", sbom, "--snapshot", fixture("snapshot-negative.json"));
    expect(r.status).toBe(1);
    expect(r.out).toContain("HIGH     fixture-runtime@1.2.0 (runtime)");
    expect(r.out).toContain("CRITICAL @fixture/bundled@2.0.0-rc.1 (bundled)");
    expect(r.out).toMatch(/snapshot retrieved 2026-10-01T00:00:00.000Z; age \d+ day\(s\)/);
    expect(r.out).toContain("not the live registry audit");
  });

  it("exits 0 on the clean fixture", () => {
    const r = run("--sbom", sbom, "--snapshot", fixture("snapshot-clean.json"));
    expect(r.status).toBe(0);
    expect(r.out).toContain("PASS: no High/Critical advisory in the snapshot matches a shipped component");
  });

  it("exits 1 when --max-age-days is exceeded, and 2 on a range it cannot evaluate", () => {
    expect(run("--sbom", sbom, "--snapshot", fixture("snapshot-clean.json"), "--max-age-days", "0").status).toBe(1);
    const bad = run("--sbom", sbom, "--snapshot", fixture("snapshot-unsupported-range.json"));
    expect(bad.status).toBe(2);
    expect(bad.out).toContain('unsupported range syntax "^1.0.0"');
  });
});

describe("the committed tree", () => {
  it("a dated snapshot is committed with its source and retrieval date", () => {
    const path = newestSnapshot();
    expect(path).toMatch(/snapshot-\d{4}-\d{2}-\d{2}\.json$/);
    const s = validateSnapshot(readJson(path));
    expect(s.retrieved_at.slice(0, 10)).toBe(path.slice(-15, -5));
    expect(s.source.url).toMatch(/^https:\/\//);
  });

  it("no High/Critical advisory in the committed snapshot matches a shipped component of the committed SBOM", () => {
    const r = run();
    expect(r.out, r.out).toContain("PASS:");
    expect(r.status, r.out).toBe(0);
  });
});
