// Self-test of deploy/scripts/check-dockerfile-context.mjs and of build-image.sh's argument handling (T-DG7-DO-E3).
// OFFLINE, no Docker daemon needed. Each defect the orchestrator's host build hit (host-run.log step 03) is
// re-introduced into an in-memory copy of the committed Dockerfile / .dockerignore, and the check must report it:
//   (a) `corepack enable --install-directory /pnpm` before /pnpm exists (ENOENT);
//   (b) packages/reporting/package.json not COPYed before `pnpm install`;
//   (c) `**/*secret*` in .dockerignore dropping tracked sources (apps/worker/src/secrets.ts, ...).
//
//   node --test deploy/scripts/tests/dockerfile-context.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkCorepack,
  checkManifests,
  checkSources,
  excludedBy,
  parseDockerignore,
  requiredManifests,
  workspaceGlobs,
} from "../check-dockerfile-context.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "dockerfile-context-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const read = (p) => readFileSync(join(root, p), "utf8");
const DOCKERFILE = read("deploy/docker/Dockerfile");
const DOCKERIGNORE = read(".dockerignore");
const git = spawnSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
assert.equal(git.status, 0, "git ls-files must run");
const TRACKED = git.stdout.split("\0").filter(Boolean);
const REQUIRED = requiredManifests(workspaceGlobs(read("pnpm-workspace.yaml")), TRACKED);
const SCRIPT = join(root, "deploy/scripts/check-dockerfile-context.mjs");
const BUILD = join(root, "deploy/scripts/build-image.sh");

test("the committed Dockerfile and .dockerignore pass all three checks (CLI exit 0)", () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

test("the required install inputs are every tracked workspace package.json plus the root install files", () => {
  for (const f of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc"])
    assert.ok(REQUIRED.includes(f), f);
  const workspaces = TRACKED.filter((f) => /^(apps|packages)\/[^/]+\/package\.json$/.test(f));
  assert.ok(workspaces.length >= 8, `found ${workspaces.length} workspace manifests`);
  for (const f of workspaces) assert.ok(REQUIRED.includes(f), f);
  assert.ok(REQUIRED.includes("packages/reporting/package.json"));
  // fixture trees elsewhere in the repository are not workspace members
  assert.ok(!REQUIRED.some((f) => f.startsWith("tools/") || f.startsWith("licenses/")));
});

test("defect (b): a workspace package.json missing from the dependency layer is reported", () => {
  const broken = DOCKERFILE.replace(/^COPY packages\/reporting\/package\.json .*\n/m, "");
  assert.notEqual(broken, DOCKERFILE, "fixture must remove the COPY line");
  const problems = checkManifests({ dockerfile: broken, dockerignore: DOCKERIGNORE, required: REQUIRED });
  assert.deepEqual(problems, ["packages/reporting/package.json: not COPYed before `pnpm install` in stage build"]);
});

test("a manifest COPYed only AFTER `pnpm install` is reported", () => {
  const moved = DOCKERFILE.replace(/^COPY packages\/shared\/package\.json .*\n/m, "").replace(
    /^COPY \. \.$/m,
    "COPY packages/shared/package.json packages/shared/package.json\nCOPY . .",
  );
  const problems = checkManifests({ dockerfile: moved, dockerignore: DOCKERIGNORE, required: REQUIRED });
  assert.deepEqual(problems, ["packages/shared/package.json: not COPYed before `pnpm install` in stage build"]);
});

test("a manifest excluded from the build context by .dockerignore is reported", () => {
  const problems = checkManifests({
    dockerfile: DOCKERFILE,
    dockerignore: `${DOCKERIGNORE}\n.npmrc\n`,
    required: REQUIRED,
  });
  assert.deepEqual(problems, [".npmrc: excluded from the build context by .dockerignore rule `.npmrc`"]);
});

test("defect (c): `**/*secret*` without the source exceptions drops tracked sources, and is reported", () => {
  const broken = DOCKERIGNORE.split("\n")
    .filter((l) => !/^!(apps|packages)\/\*\/src\/\*\*\/\*secret\*/.test(l))
    .join("\n");
  assert.notEqual(broken, DOCKERIGNORE, "fixture must remove the exceptions");
  const problems = checkSources({ dockerignore: broken, trackedFiles: TRACKED });
  const files = problems.map((p) => p.split(":")[0]);
  for (const f of [
    "apps/worker/src/secrets.ts",
    "apps/api/src/modules/platform/secrets.ts",
    "apps/api/src/modules/platform/secret-namespace.ts",
    "apps/api/src/modules/integrations/secret-refs.ts",
    "apps/api/src/modules/access/secret-refusals.ts",
  ])
    assert.ok(files.includes(f), `${f} must be reported; got ${files.join(", ")}`);
  // packages/config/src keeps its own older exception
  assert.ok(!files.includes("packages/config/src/secret-bindings.ts"));
  assert.ok(problems.every((p) => p.endsWith("rule `**/*secret*`")));
});

test("the committed .dockerignore still keeps local secrets, keys and .env files out of the context", () => {
  const rules = parseDockerignore(DOCKERIGNORE);
  for (const f of [
    "deploy/compose/secrets/db_password",
    "deploy/compose/.env",
    ".env",
    ".env.local",
    "apps/api/.env",
    "deploy/keycloak/tls/server.key",
    "deploy/compose/certs/ca.pem",
    "apps/api/src/fixtures/server.pem",
    "apps/api/src/modules/platform/secret-values.json",
    "apps/api/node_modules/x/index.js",
    "apps/web/dist/index.html",
    ".git/config",
    "docs/delivery/findings.json",
    "trading_agent/main.py",
  ])
    assert.ok(excludedBy(rules, f), `${f} must stay excluded`);
  for (const f of [
    ".env.example",
    "docs/delivery/requirements.csv",
    "apps/worker/src/secrets.ts",
    "apps/api/src/modules/platform/secret-namespace.ts",
    "packages/config/src/secret-bindings.ts",
    "deploy/scripts/assemble-runtime.sh",
  ])
    assert.equal(excludedBy(rules, f), null, `${f} must be in the context`);
});

test(".dockerignore matcher follows Docker's semantics (`*` stays in a segment, `**` spans, parent match, last wins)", () => {
  const rules = parseDockerignore(
    ["# comment", "/build", "*.log", "docs/**/*.tmp", "keep/**", "!keep/this/**", "a?c", "x/**/y"].join("\n"),
  );
  assert.ok(excludedBy(rules, "build/out/file.js"), "a directory pattern excludes its contents (parent match)");
  assert.ok(excludedBy(rules, "app.log"));
  assert.equal(excludedBy(rules, "sub/app.log"), null, "`*` does not cross `/`");
  assert.ok(excludedBy(rules, "docs/a/b/c.tmp"));
  assert.ok(excludedBy(rules, "docs/c.tmp"), "`**/` matches zero directories");
  assert.ok(excludedBy(rules, "keep/other/f"));
  assert.equal(excludedBy(rules, "keep/this/f"), null, "a later `!` re-includes");
  assert.ok(excludedBy(rules, "abc"));
  assert.equal(excludedBy(rules, "abbc"), null);
  assert.ok(excludedBy(rules, "x/y"));
  assert.ok(excludedBy(rules, "x/1/2/y/z"));
  assert.equal(excludedBy(rules, "# comment"), null);
});

test("defect (a): corepack enable --install-directory before the directory exists is reported", () => {
  const broken = DOCKERFILE.replace(/^\s*mkdir -p "\$PNPM_HOME"; \\\n/m, "");
  assert.notEqual(broken, DOCKERFILE, "fixture must remove the mkdir");
  const problems = checkCorepack({ dockerfile: broken });
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /corepack enable --install-directory \/pnpm runs before \/pnpm is created/);
  // the literal pre-fix form is reported too, and creating it in an earlier WORKDIR or RUN is accepted
  const literal = "FROM n AS build\nRUN corepack enable --install-directory /pnpm; pnpm install\n";
  assert.equal(checkCorepack({ dockerfile: literal }).length, 1);
  assert.deepEqual(
    checkCorepack({ dockerfile: "FROM n AS b\nWORKDIR /pnpm\nRUN corepack enable --install-directory /pnpm\n" }),
    [],
  );
  assert.deepEqual(
    checkCorepack({ dockerfile: "FROM n AS b\nRUN mkdir -p /pnpm && corepack enable --install-directory /pnpm\n" }),
    [],
  );
  assert.deepEqual(checkCorepack({ dockerfile: DOCKERFILE }), []);
});

test("CLI: missing input is BLOCKED (exit 2), a usage error is exit 2", () => {
  const empty = join(scratch, "empty");
  mkdirSync(empty);
  let r = spawnSync(process.execPath, [SCRIPT, "--root", empty], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^BLOCKED: missing deploy\/docker\/Dockerfile/m);
  r = spawnSync(process.execPath, [SCRIPT, "--bogus"], { encoding: "utf8" });
  assert.equal(r.status, 2);
});

// ---- build-image.sh: argument handling only (--dry-run). A stub `docker` first on PATH proves Docker is never called.
function stubDocker() {
  const bin = join(scratch, "bin");
  if (!existsSync(bin)) {
    mkdirSync(bin);
    writeFileSync(join(bin, "docker"), `#!/bin/sh\necho called >> "${join(scratch, "docker-called")}"\nexit 99\n`);
    chmodSync(join(bin, "docker"), 0o755);
  }
  return bin;
}
function build(args, env = {}) {
  const base = { ...process.env };
  for (const v of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "all_proxy",
    "MTH_BUILD_NETWORK",
    "MTH_BUILD_PROXY_FROM_ENV",
    "MTH_BUILD_CA_FILE",
  ])
    delete base[v];
  return spawnSync("bash", [BUILD, "--node-image", "node:test", "--dry-run", ...args], {
    encoding: "utf8",
    env: { ...base, PATH: `${stubDocker()}:${process.env.PATH}`, ...env },
  });
}

test("build-image.sh --dry-run: no proxy and no network flag unless asked; Docker never called", () => {
  const r = build([], { HTTPS_PROXY: ["http://u:", "p4ss", "@proxy.example:3128"].join("") });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /--build-arg HTTPS_PROXY|--network/);
  assert.match(r.stdout, /DRY-RUN: no build performed/);
  assert.equal(existsSync(join(scratch, "docker-called")), false);
});

test("build-image.sh --proxy-from-env passes only the SET proxy names, never their values", () => {
  const value = ["http://u:", "p4ss", "@proxy.example:3128"].join("");
  const r = build(["--proxy-from-env", "--network", "host"], { HTTPS_PROXY: value, no_proxy: "localhost,127.0.0.1" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, / --network host /);
  assert.match(r.stdout, / --build-arg HTTPS_PROXY /);
  assert.match(r.stdout, / --build-arg no_proxy /);
  assert.doesNotMatch(r.stdout, /--build-arg HTTP_PROXY |--build-arg ALL_PROXY /);
  assert.ok(!r.stdout.includes("p4ss") && !r.stderr.includes("p4ss"), "a proxy value must never be printed");
  assert.ok(!r.stdout.includes("localhost,127.0.0.1"));
  // the env-variable forms behave the same
  const e = build([], { MTH_BUILD_PROXY_FROM_ENV: "1", MTH_BUILD_NETWORK: "host", http_proxy: value });
  assert.equal(e.status, 0, e.stderr);
  assert.match(e.stdout, / --network host .*--build-arg http_proxy /);
  assert.equal(existsSync(join(scratch, "docker-called")), false);
});

test("build-image.sh refuses a bad --network, a missing value and a missing CA file (exit 64)", () => {
  assert.equal(build(["--network", "bridge;rm"]).status, 64);
  assert.equal(build(["--network"]).status, 64);
  assert.equal(build(["--build-ca", join(scratch, "nope.pem")]).status, 64);
  assert.equal(build(["--unknown"]).status, 64);
});

test("the Dockerfile declares no proxy ARG or ENV (proxy values are never baked into the image)", () => {
  assert.doesNotMatch(DOCKERFILE, /^\s*(ARG|ENV)\s+[^\n]*\b(HTTPS?|NO|ALL)_PROXY\b/im);
  assert.match(read("deploy/scripts/build-image.sh"), /FAIL: a proxy variable is baked into the image Env/);
});
