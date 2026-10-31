// qa-verifier support (DG6, T-DG6-QA-G; QA-EB handback §7 Q-1): a FRESH INSTALL next to the shared e2e stack, so a
// spec whose binding text is about a fresh install (REQ-S17-009 "a fresh install shows AI disabled") establishes its
// own precondition instead of depending on what earlier specs did to the shared stack's installation-wide settings.
// It runs inside apps/web/e2e/support/with-stack.sh (which exports DATABASE_OWNER_URL, the evidence storage driver and
// MTH_PORT_POOL) and repeats that script's install steps on a NEW database in the same disposable cluster:
//   CREATE DATABASE (UTF8, C) -> `mth-db migrate` -> `mth-db seed-dev` (SYNTHETIC users) -> the BUILT API
//   (apps/api/dist/main.js, serving the built SPA) on a free port of MTH_PORT_POOL -> /readyz 200.
// `stop()` ends the API (SIGTERM) and drops the database. The child processes inherit the environment, so the
// connection log of e2e/support/a21-connection-log-run.sh (NODE_OPTIONS preload) also records the fresh API.
// Nothing here touches the shared stack's database; nothing approves anything real or names an engineering gate.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface FreshInstall {
  /** http://localhost:<port> of the fresh API. */
  readonly baseURL: string;
  readonly database: string;
  /** SQL as the fresh database's OWNER (fixture reads only). */
  psql(sql: string): string[];
  stop(): Promise<void>;
}

function sharedOwnerUrl(): URL {
  const url = process.env["DATABASE_OWNER_URL"];
  if (!url)
    throw new Error("BLOCKED: DATABASE_OWNER_URL is not set (run the spec through apps/web/e2e/support/with-stack.sh)");
  return new URL(url);
}

/** The cluster's superuser connection (the with-stack.sh ADMIN_URL): the owner URL without its role option. */
function adminUrl(database = "postgres"): string {
  const u = sharedOwnerUrl();
  u.search = "";
  u.pathname = `/${database}`;
  return u.toString();
}

/** As with-stack.sh's role_url: the database URL with `-c role=<role>`. */
function roleUrl(database: string, role: string): string {
  const u = sharedOwnerUrl();
  u.pathname = `/${database}`;
  u.search = "";
  u.searchParams.set("options", `-c role=${role}`);
  return u.toString();
}

function psqlAt(url: string, args: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  try {
    return execFileSync("psql", [url, "-X", "-qAt", "-F", "\t", "-v", "ON_ERROR_STOP=1", ...args], {
      encoding: "utf8",
      env,
    })
      .split("\n")
      .filter((l) => l.length > 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new Error("BLOCKED: psql is not installed");
    throw e;
  }
}

/** Candidate ports: MTH_PORT_POOL ("a-b"), from the top down (with-stack.sh takes its retries from the bottom). */
function candidatePorts(): number[] {
  const pool = process.env["MTH_PORT_POOL"];
  const m = pool ? /^(\d+)-(\d+)$/.exec(pool) : null;
  if (!m) throw new Error(`BLOCKED: MTH_PORT_POOL ("a-b") is not set; no harness port for the fresh-install API`);
  const out: number[] = [];
  for (let p = Number(m[2]); p >= Number(m[1]); p--) out.push(p);
  return out;
}

async function ready(baseURL: string): Promise<boolean> {
  try {
    return (await fetch(`${baseURL}/readyz`)).status === 200;
  } catch {
    return false;
  }
}

export async function startFreshInstall(tag: string): Promise<FreshInstall> {
  if (!/^[a-z0-9_]{1,40}$/.test(tag)) throw new Error(`fresh-install tag must be [a-z0-9_]: ${tag}`);
  const database = `mth_fresh_${tag}`;
  const admin = adminUrl();
  psqlAt(admin, ["-c", `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`]);
  psqlAt(admin, [
    "-c",
    `CREATE DATABASE ${database} OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`,
  ]);
  const evidenceDir = mkdtempSync(path.join(process.env["TMPDIR"] ?? tmpdir(), `${database}-evidence-`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_OWNER_URL: roleUrl(database, "mth_owner"),
    DATABASE_URL: roleUrl(database, "mth_app"),
    EVIDENCE_STORAGE_DRIVER: "filesystem",
    EVIDENCE_STORAGE_PATH: evidenceDir,
    LOG_LEVEL: "warn",
  };
  execFileSync(process.execPath, ["packages/db/dist/cli.js", "migrate"], { env, stdio: "pipe", timeout: 240_000 });
  execFileSync(process.execPath, ["packages/db/dist/cli.js", "seed-dev"], { env, stdio: "pipe", timeout: 120_000 });

  let child: ChildProcess | undefined;
  let baseURL = "";
  let out = "";
  for (const port of candidatePorts()) {
    baseURL = `http://localhost:${port}`;
    if (await ready(baseURL)) continue; // something else already serves on this port
    out = "";
    const c = spawn(process.execPath, ["apps/api/dist/main.js"], {
      env: { ...env, PORT: String(port), APP_BASE_URL: baseURL, E2E_BASE_URL: baseURL },
      stdio: ["ignore", "pipe", "pipe"],
    });
    c.stdout!.on("data", (b: Buffer) => (out += b.toString()));
    c.stderr!.on("data", (b: Buffer) => (out += b.toString()));
    const until = Date.now() + 60_000;
    let ok = false;
    while (Date.now() < until && c.exitCode === null) {
      if (await ready(baseURL)) {
        ok = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (ok) {
      child = c;
      break;
    }
    c.kill("SIGKILL");
    if (!/EADDRINUSE/.test(out)) throw new Error(`the fresh-install API did not become ready on ${baseURL}: ${out}`);
  }
  if (!child) throw new Error(`BLOCKED: no free port in MTH_PORT_POOL for the fresh-install API: ${out}`);
  const api = child;
  const ownerUrl = new URL(roleUrl(database, "mth_owner"));
  const options = ownerUrl.searchParams.get("options")!;
  ownerUrl.search = "";
  return {
    baseURL,
    database,
    psql: (sql) => psqlAt(ownerUrl.toString(), ["-c", sql], { ...process.env, PGOPTIONS: options }),
    async stop() {
      if (api.exitCode === null) {
        const exited = new Promise((r) => api.once("exit", r));
        api.kill("SIGTERM");
        await Promise.race([exited, new Promise((r) => setTimeout(r, 20_000))]);
        if (api.exitCode === null) api.kill("SIGKILL");
      }
      psqlAt(admin, ["-c", `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`]);
      rmSync(evidenceDir, { recursive: true, force: true });
    },
  };
}
