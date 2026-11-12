// T-G9 (ADR-0063 §4.3 HR-02; REQ-S16-031 "integrate TLS and database/storage encryption with the hosting
// environment"). No product code sets database TLS: DATABASE_URL is handed to node-postgres as given, so the
// integration point is the URL's TLS parameters (`sslmode=verify-full`, `sslrootcert=<CA file>`), or a corporate CA
// through MTH_EXTRA_CA_CERTS_FILE, which Compose passes as NODE_EXTRA_CA_CERTS (deploy/compose/compose.yaml).
//
// This test proves that integration point against a TLS-only scratch PostgreSQL cluster of its own:
//   - a throwaway CA and server certificate (SAN localhost, 127.0.0.1) are generated with openssl under $TMPDIR;
//   - the cluster (the host's PostgreSQL binaries; PGBIN or the newest /usr/lib/postgresql/*/bin) listens on 127.0.0.1
//     only, on a port picked from the shared harness pool (tests/qa/support/pg-port.sh `mth_port_pick`, 25000-31999),
//     with ssl=on and a pg_hba.conf that accepts TLS connections only;
//   - the product's own pool factory (`createPool`, packages/db/src/pool.ts) connects with sslmode=verify-full and the
//     generated CA (succeeds, and the session is encrypted per pg_stat_ssl), and without the CA (refused: the server
//     certificate does not verify); a plaintext connection is refused by the cluster; and a child process with
//     NODE_EXTRA_CA_CERTS=<CA> verifies the server with no sslrootcert in the URL.
// Missing openssl or PostgreSQL binaries, or a cluster that does not start: every test FAILS with "BLOCKED: <reason>"
// (never a silent skip, never a pass). The CA, keys and cluster are synthetic and are deleted after the run.
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../../src/pool.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..", "..");
const REPO = join(PKG, "..", "..");
const PORT_POLICY = join(REPO, "tests", "qa", "support", "pg-port.sh");

interface Cluster {
  work: string;
  port: number;
  ca: string;
  proc: ChildProcess;
}

let cluster: Cluster | undefined;
let blocked: string | undefined;

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
/** PostgreSQL refuses to run as root: as uid 0 it runs as uid 1000 in a user namespace (the with-pg.sh precedent). */
const asPg = (cmd: string, args: string[]): [string, string[]] =>
  isRoot ? ["unshare", ["--user", "--map-user=1000", "--map-group=1000", cmd, ...args]] : [cmd, args];

function pgBin(): string | undefined {
  if (process.env["PGBIN"]) return process.env["PGBIN"];
  const base = "/usr/lib/postgresql";
  if (!existsSync(base)) return undefined;
  const versions = readdirSync(base)
    .filter((v) => existsSync(join(base, v, "bin", "postgres")))
    .sort((a, b) => Number(a) - Number(b));
  return versions.length ? join(base, versions[versions.length - 1]!, "bin") : undefined;
}

function have(cmd: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }).status === 0;
}

function openssl(args: string[], cwd: string): void {
  execFileSync("openssl", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
}

/** A throwaway CA and a server certificate for localhost / 127.0.0.1, signed by it. */
function makeCertificates(work: string): void {
  openssl(
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=MTH synthetic test CA (T-G9)",
      "-keyout",
      "ca.key",
      "-out",
      "ca.crt",
    ],
    work,
  );
  openssl(
    ["req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-keyout", "server.key", "-out", "server.csr"],
    work,
  );
  writeFileSync(join(work, "san.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\n");
  openssl(
    [
      "x509",
      "-req",
      "-in",
      "server.csr",
      "-CA",
      "ca.crt",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-days",
      "2",
      "-extfile",
      "san.ext",
      "-out",
      "server.crt",
    ],
    work,
  );
  chmodSync(join(work, "server.key"), 0o600);
}

function pickPort(tried: number[]): number {
  const out = execFileSync("bash", ["-c", `. "${PORT_POLICY}"; mth_port_pick ${tried.join(" ")}`])
    .toString()
    .trim();
  const port = Number(out);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`mth_port_pick returned ${JSON.stringify(out)}`);
  return port;
}

async function waitReady(log: string, proc: ChildProcess, timeoutMs: number): Promise<"ready" | "in-use" | "failed"> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const text = existsSync(log) ? readFileSync(log, "utf8") : "";
    if (text.includes("ready to accept connections")) return "ready";
    if (/Address already in use|could not bind/.test(text)) return "in-use";
    if (proc.exitCode !== null) return "failed";
    await new Promise((r) => setTimeout(r, 200));
  }
  return "failed";
}

async function startCluster(): Promise<Cluster> {
  const bin = pgBin();
  if (!bin || !existsSync(join(bin, "initdb")) || !existsSync(join(bin, "postgres")))
    throw new Error("BLOCKED: PostgreSQL server binaries not found (set PGBIN)");
  if (!have("openssl")) throw new Error("BLOCKED: openssl not found");
  if (isRoot && !have("unshare")) throw new Error("BLOCKED: running as root and unshare is not available");
  const work = mkdtempSync(join(process.env["TMPDIR"] || tmpdir(), "mth-db-tls-"));
  chmodSync(work, 0o777);
  makeCertificates(work);
  const data = join(work, "pg");
  const [initCmd, initArgs] = asPg(join(bin, "initdb"), [
    "-D",
    data,
    "-U",
    "postgres",
    "--auth=trust",
    "--encoding=UTF8",
    "--locale=C",
  ]);
  const init = spawnSync(initCmd, initArgs, { stdio: ["ignore", "pipe", "pipe"] });
  if (init.status !== 0) throw new Error(`BLOCKED: initdb failed: ${String(init.stderr).slice(0, 400)}`);
  // TLS only: a TCP connection without TLS is rejected; there is no unix socket.
  writeFileSync(join(data, "pg_hba.conf"), "hostssl all all 127.0.0.1/32 trust\nhostnossl all all 0.0.0.0/0 reject\n");
  const tried: number[] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const port = pickPort(tried);
    tried.push(port);
    const log = join(work, `pg-${port}.log`);
    const [cmd, args] = asPg(join(bin, "postgres"), [
      "-D",
      data,
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-c",
      "unix_socket_directories=",
      "-c",
      "fsync=off",
      "-c",
      "ssl=on",
      "-c",
      `ssl_cert_file=${join(work, "server.crt")}`,
      "-c",
      `ssl_key_file=${join(work, "server.key")}`,
      "-c",
      "logging_collector=off",
    ]);
    const proc = spawn("sh", ["-c", `exec "$0" "$@" >>"${log}" 2>&1`, cmd, ...args], { stdio: "ignore" });
    const state = await waitReady(log, proc, 30_000);
    if (state === "ready") return { work, port, ca: join(work, "ca.crt"), proc };
    proc.kill("SIGKILL");
    if (state !== "in-use") {
      const tail = existsSync(log) ? readFileSync(log, "utf8").slice(-600) : "(no log)";
      rmSync(work, { recursive: true, force: true });
      throw new Error(`BLOCKED: the TLS scratch cluster did not start: ${tail}`);
    }
  }
  rmSync(work, { recursive: true, force: true });
  throw new Error("BLOCKED: no free port in the harness pool after 6 attempts");
}

const url = (c: Cluster, params: string) => `postgresql://postgres@localhost:${c.port}/postgres?${params}`;
function need(): Cluster {
  if (!cluster) throw new Error(blocked ?? "BLOCKED: the TLS scratch cluster was not started");
  return cluster;
}

async function sslOf(connectionString: string): Promise<{ ssl: boolean; version: string }> {
  const pool = createPool(connectionString, { max: 1, connectionTimeoutMs: 10_000 });
  try {
    const r = await pool.query<{ ssl: boolean; version: string }>(
      "SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
    );
    return r.rows[0]!;
  } finally {
    await pool.end();
  }
}

beforeAll(async () => {
  try {
    cluster = await startCluster();
  } catch (e) {
    blocked = e instanceof Error ? e.message : String(e);
    if (!blocked.startsWith("BLOCKED:")) blocked = `BLOCKED: ${blocked}`;
  }
}, 120_000);

afterAll(async () => {
  if (!cluster) return;
  cluster.proc.kill("SIGINT");
  for (let i = 0; i < 50 && cluster.proc.exitCode === null; i++) await new Promise((r) => setTimeout(r, 100));
  if (cluster.proc.exitCode === null) cluster.proc.kill("SIGKILL");
  rmSync(cluster.work, { recursive: true, force: true });
});

describe("HR-02 database TLS through DATABASE_URL (T-G9, ADR-0063 §4.3)", () => {
  it("sslmode=verify-full with the generated CA connects, and the session is encrypted", async () => {
    const c = need();
    const s = await sslOf(url(c, `sslmode=verify-full&sslrootcert=${encodeURIComponent(c.ca)}`));
    expect(s.ssl).toBe(true);
    expect(s.version).toMatch(/^TLSv1\.[23]$/);
  });

  it("sslmode=verify-full without the CA is refused (the server certificate does not verify)", async () => {
    const c = need();
    await expect(sslOf(url(c, "sslmode=verify-full"))).rejects.toThrow(
      /self[- ]signed|unable to (get|verify)|certificate/i,
    );
  });

  it("a plaintext connection is refused by the TLS-only cluster", async () => {
    const c = need();
    await expect(sslOf(url(c, "sslmode=disable"))).rejects.toThrow(/no encryption|pg_hba\.conf|rejects connection/i);
  });

  it("NODE_EXTRA_CA_CERTS (MTH_EXTRA_CA_CERTS_FILE in Compose) verifies the server with no sslrootcert", () => {
    const c = need();
    const script =
      'import pg from "pg"; const c = new pg.Client({ connectionString: process.env.U }); await c.connect();' +
      ' const r = await c.query("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()");' +
      " console.log(JSON.stringify(r.rows[0])); await c.end();";
    const run = (extraCa: string | undefined) => {
      const env: NodeJS.ProcessEnv = { ...process.env, U: url(c, "sslmode=verify-full") };
      delete env["NODE_EXTRA_CA_CERTS"];
      if (extraCa) env["NODE_EXTRA_CA_CERTS"] = extraCa;
      return spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: PKG, env, encoding: "utf8" });
    };
    const ok = run(c.ca);
    expect(ok.status, ok.stderr).toBe(0);
    expect(JSON.parse(ok.stdout.trim())).toEqual({ ssl: true });
    const refused = run(undefined);
    expect(refused.status).not.toBe(0);
  });
});
