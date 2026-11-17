// The container layout of the Compose `backup` profile (docs/handover/backup-restore.md §3.2; ADR-0066 §5, A1.4;
// T-DG7-DO-D13; F-DG7-1031/1051). Runs in `pnpm test` (Vitest project unit-node, through the
// deploy/scripts/tests/**/*.vitest.mjs include). No database, no network, no Docker.
//
// The orchestrator's host drill (compose-backup-rg3, step C3) failed with
//   backup: set rg3 failed: the Compose file //deploy/compose/compose.yaml does not exist
// because backup.sh derives the repository root as `dirname(script)/../..`, and the service mounted the script at
// /mth/scripts/backup.sh: the root became `/`, while the Compose file and images.lock.json were mounted under /mth.
// These tests rebuild the service's bind mounts from compose.yaml in a temporary directory (the container's `/`), with
// the same targets, and run the script there, so the path resolution is checked without a Docker daemon.
//
// They also pin the evidence copy-out command of §3.2 step 2 against the app image's layout (deploy/docker/Dockerfile):
// the store is owned by uid 10001 with mode 0700 and the service drops every capability, so the copy-out that runs as
// root (to write into the root-owned set) needs CAP_DAC_READ_SEARCH to read the store; and the command must use the
// same command in the guide and in the drill.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const COMPOSE_DIR = join(REPO, "deploy", "compose");
const YAML = createRequire(join(REPO, "apps", "api", "package.json"))("yaml");
const compose = YAML.parse(readFileSync(join(COMPOSE_DIR, "compose.yaml"), "utf8"), { merge: true });
const backup = compose.services.backup;
const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "mth-backup-layout-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The repository-relative bind mounts of a service, as { source (absolute host path), target, readOnly }. */
function bindMounts(service) {
  const out = [];
  for (const v of service.volumes) {
    if (typeof v !== "string") continue; // long syntax: only the /backups bind of MTH_BACKUP_ROOT
    const parts = v.split(":");
    if (!parts[0].startsWith(".")) continue; // named volumes (evidence)
    out.push({ source: resolve(COMPOSE_DIR, parts[0]), target: parts[1], readOnly: parts[2] === "ro" });
  }
  return out;
}

/** A directory that holds the service's repository bind mounts at their targets: the container's `/`. */
function containerRoot(name, mounts) {
  const root = join(work, name);
  for (const m of mounts) {
    const dest = join(root, m.target);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(m.source, dest, { recursive: true });
  }
  return root;
}

/** The script path of the service's entrypoint (["bash", <script>, ...]). */
function entrypointScript(service) {
  expect(service.entrypoint[0]).toBe("bash");
  return service.entrypoint[1];
}

/** MTH_REPO as backup.sh computes it when it is sourced from <root><script> (restore.sh sources it the same way). */
function resolvedRepo(root, script) {
  const r = spawnSync("bash", ["-c", '. "$1"; printf %s "$MTH_REPO"', "resolve", join(root, script)], {
    encoding: "utf8",
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
}

/** The step 2 command block of backup-restore.md §3.2, without its continuation backslashes. */
function guideStep2() {
  const doc = readFileSync(join(REPO, "docs", "handover", "backup-restore.md"), "utf8");
  const s = doc.slice(doc.indexOf("### 3.2 Compose"), doc.indexOf("### 3.3"));
  const block = s.slice(s.indexOf("# 2. evidence copy-out"), s.indexOf("# 3. retention sets"));
  return block.replace(/\\\n\s*/g, " ");
}

/** The body of the drill's c4_copyout function (deploy/scripts/drill/compose-backup-drill.sh). */
function drillC4() {
  const text = readFileSync(join(REPO, "deploy", "scripts", "drill", "compose-backup-drill.sh"), "utf8");
  const start = text.indexOf("c4_copyout() {");
  return text.slice(start, text.indexOf("\n}\n", start)).replace(/\\\n\s*/g, " ");
}

describe("Compose backup service: the repository root inside the container (C3: --phase database)", () => {
  const mounts = bindMounts(backup);
  const script = entrypointScript(backup);
  const root = containerRoot("service", mounts);

  it("the entrypoint script is mounted read-only from deploy/scripts/backup.sh", () => {
    const m = mounts.find((x) => x.target === script);
    expect(m, JSON.stringify(mounts)).toBeDefined();
    expect(m.source).toBe(join(REPO, "deploy", "scripts", "backup.sh"));
    expect(m.readOnly).toBe(true);
  });

  it("backup.sh resolves the repository root to /mth, where the Compose file and images.lock.json it reads are mounted", () => {
    const repo = resolvedRepo(root, script);
    // Inside the container this is the path below the container's `/` (here: below `root`).
    expect(repo.slice(root.length)).toBe("/mth");
    expect(existsSync(join(repo, "deploy", "compose", "compose.yaml"))).toBe(true);
    expect(existsSync(join(repo, "deploy", "images.lock.json"))).toBe(true);
  });

  it("every repository file the service mounts is read-only, and the Compose directory is where backup.sh looks for .env", () => {
    for (const m of mounts) expect(m.readOnly, m.target).toBe(true);
    const repo = resolvedRepo(root, script).slice(root.length);
    const dir = mounts.find((m) => m.target === `${repo}/deploy/compose`);
    expect(dir, JSON.stringify(mounts)).toBeDefined();
    expect(dir.source).toBe(COMPOSE_DIR);
    expect(statSync(dir.source).isDirectory()).toBe(true);
  });

  it("the default command and the guide's commands use only --label and --phase (no path the container cannot see)", () => {
    expect(backup.entrypoint.slice(2)).toEqual(["--out", "/backups"]);
    expect(backup.command).toEqual(["--phase", "database"]);
    const doc = readFileSync(join(REPO, "docs", "handover", "backup-restore.md"), "utf8");
    const runs = doc.match(/--profile backup run --rm backup [^\n]*/g) ?? [];
    expect(runs.length).toBeGreaterThanOrEqual(2);
    for (const r of runs) expect(r).not.toMatch(/--compose-file|--env-file|--out/);
  });
});

describe("backup.sh preflight: a missing configuration file is refused before anything is written", () => {
  // The layout of the failed run (script at /mth/scripts/backup.sh): the derived root is `/`, where nothing is mounted.
  const broken = containerRoot("broken", [
    { source: join(REPO, "deploy", "scripts", "backup.sh"), target: "/mth/scripts/backup.sh", readOnly: true },
    { source: join(COMPOSE_DIR, "compose.yaml"), target: "/mth/deploy/compose/compose.yaml", readOnly: true },
  ]);

  function run(args) {
    const out = join(work, `out-${Math.random().toString(16).slice(2)}`);
    mkdirSync(out, { mode: 0o700 });
    const store = join(work, "store");
    mkdirSync(store, { recursive: true, mode: 0o700 });
    const nopg = join(work, "no-pg-tools");
    mkdirSync(nopg, { recursive: true });
    const r = spawnSync("bash", [join(broken, "mth/scripts/backup.sh"), "--out", out, ...args], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        // Never reached: the preflight refuses first. An unroutable URL, so nothing is contacted if it were.
        DATABASE_URL: "postgres://nobody@127.0.0.1:1/none",
        EVIDENCE_STORAGE_DRIVER: "filesystem",
        EVIDENCE_STORAGE_PATH: store,
        PGBIN: nopg,
        MTH_TRANSFER_ATTACHMENTS: "none",
      },
    });
    return { status: r.status, err: r.stderr, out, entries: readdirSync(out) };
  }

  it("--phase database with the Compose file missing: exit 2, BLOCKED naming the file and the resolved root; no set is created", () => {
    const r = run(["--label", "layout", "--phase", "database"]);
    expect(r.err).toMatch(/^BLOCKED: the Compose file \S*\/deploy\/compose\/compose\.yaml does not exist/m);
    expect(r.err).toMatch(/repository root resolved to /);
    expect(r.status).toBe(2);
    expect(r.entries).toEqual([]);
  });

  it("an explicit --env-file that does not exist is refused the same way", () => {
    const r = run([
      "--label",
      "layout",
      "--phase",
      "database",
      "--compose-file",
      join(COMPOSE_DIR, "compose.yaml"),
      "--env-file",
      join(work, "missing.env"),
    ]);
    expect(r.err).toMatch(/^BLOCKED: the environment file \S*missing\.env does not exist/m);
    expect(r.status).toBe(2);
    expect(r.entries).toEqual([]);
  });
});

describe("§3.2 step 2 (C4): the evidence copy-out in the app image", () => {
  const dockerfile = readFileSync(join(REPO, "deploy", "docker", "Dockerfile"), "utf8");

  it("the app image's evidence root belongs to uid 10001 with mode 0700, and the api service drops every capability", () => {
    expect(dockerfile).toMatch(/chown mth:mth \/var\/lib\/mth\/evidence/);
    expect(dockerfile).toMatch(/chmod 0700 \/var\/lib\/mth\/evidence/);
    expect(compose.services.api.cap_drop).toEqual(["ALL"]);
  });

  for (const [name, text] of [
    ["the guide (backup-restore.md §3.2)", guideStep2()],
    ["the drill (compose-backup-drill.sh C4)", drillC4()],
  ]) {
    it(`${name}: root writes into the root-owned set and reads the 10001-owned store through CAP_DAC_READ_SEARCH only`, () => {
      expect(text).toMatch(/--user 0:0/);
      expect(text).toMatch(/--cap-add DAC_READ_SEARCH/);
      expect(text).not.toMatch(/--cap-add (ALL|DAC_OVERRIDE|SYS_ADMIN)/);
      expect(text).toMatch(/-v "\$MTH_BACKUP_ROOT:\/backups"/);
      expect(text).toMatch(/\/app\/apps\/api\/dist\/cli\/transfer-attachments\.js copy-out/);
    });

    it(`${name}: the database URL reaches the CLI as DATABASE_URL_FILE, a variable transfer-attachments reads`, () => {
      expect(text).toMatch(/-e DATABASE_URL_FILE=\/run\/secrets\/database_url/);
      expect(compose.services.api.secrets).toContain("database_url");
      const cli = readFileSync(join(REPO, "apps", "api", "src", "cli", "transfer-attachments.ts"), "utf8");
      expect(cli).toMatch(/readSecretVariable\("DATABASE_URL"/);
    });
  }

  it("the guide and the drill pass the same flags to `run` and to the CLI", () => {
    const flags = (t) => (t.match(/ --?[a-z][a-z0-9-]*/g) ?? []).map((f) => f.trim());
    const g = flags(guideStep2().slice(guideStep2().indexOf(" run ")));
    const d = flags(drillC4().slice(drillC4().indexOf(" run ")));
    expect(d).toEqual(g);
  });
});
