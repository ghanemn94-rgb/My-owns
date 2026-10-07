// T-DG2-BE18A (F-DG2-460): an upload cut by a graceful shutdown leaves nothing behind in the evidence store, and the
// store's start-up sweep removes stale temporaries. Everything here runs the REAL API process (src/main.ts, the same
// entry point as `node dist/main.js`) on a REAL filesystem evidence store and the run's disposable PostgreSQL, over
// real sockets. All data is SYNTHETIC. G1-G6 are PRODUCT gates (business approvals), unrelated to DG0-DG7.
//   Before: main.ts ran `app.close(); db.destroy(); process.exit(0)`. The shutdown grace destroyed the connection of an
//   upload still receiving its body; the upload's cleanup (close the file handle, then remove `<uuid>.part`) is
//   asynchronous, and nothing waited for it (since BE17 the handler holds no pooled connection, so db.destroy() did not
//   either): the process exited first and the `.part` file with the partial bytes stayed, for good.
//   Now: shutdown waits for every in-flight handler to settle (platform/in-flight.ts) before db.destroy() and exit;
//   and the store removes `.part` objects older than STALE_TEMPORARY_AGE_MS when an instance starts.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { APP_ORIGIN, call, seedWorld, startApi, type TestApi, type World } from "../support/harness.ts";
import { setupP2World, type P2World } from "../support/p2-fixtures.ts";

const MiB = 1024 * 1024;
/** main.ts: DEFAULT_SHUTDOWN_GRACE_MS (5 s) + 5 s = the backstop that bounds the whole shutdown. */
const GRACE_MS = 5_000;
const BACKSTOP_MS = GRACE_MS + 5_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

let base: TestApi;
let w: World;
let p: P2World;
let T: string;
beforeAll(async () => {
  base = await startApi();
  w = await seedWorld(base.db);
  p = await setupP2World(base, w);
  T = `/api/v1/transformations/${p.transformationId}`;
}, 60_000);
afterAll(async () => {
  await base.close();
}, 60_000);

// ------------------------------------------------------------------------------------------------ helpers

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 >= ms) return false;
    await sleep(25);
  }
  return true;
}

interface ApiProcess {
  readonly proc: ChildProcess;
  readonly port: number;
  output(): string;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number }>;
}

/** Starts src/main.ts on a free port below the ephemeral range with its own evidence store directory. */
async function startProcess(storePath: string): Promise<ApiProcess> {
  const { appUrl } = inject("mthDb");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = 26000 + Math.floor(Math.random() * 6000);
    const proc = spawn(process.execPath, ["--conditions=@mth/source", "apps/api/src/main.ts"], {
      cwd: repoRoot,
      env: {
        PATH: process.env["PATH"] ?? "",
        NODE_ENV: "test",
        APP_BASE_URL: APP_ORIGIN,
        DATABASE_URL: appUrl,
        AUTH_MODE: "dev",
        PORT: String(port),
        LOG_LEVEL: "info",
        RATE_LIMIT_PER_MINUTE: "100000",
        AUTH_RATE_LIMIT_PER_MINUTE: "100000",
        EVIDENCE_STORAGE_DRIVER: "filesystem",
        EVIDENCE_STORAGE_PATH: storePath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    proc.stdout!.on("data", (d: Buffer) => (out += d.toString()));
    proc.stderr!.on("data", (d: Buffer) => (out += d.toString()));
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number }>((r) =>
      proc.once("exit", (code, signal) => r({ code, signal, at: Date.now() })),
    );
    const ready = await Promise.race([
      waitFor(() => out.includes("mth-api listening"), 20_000),
      exited.then(() => false),
    ]);
    if (ready) return { proc, port, output: () => out, exited };
    proc.kill("SIGKILL");
    if (!out.includes("EADDRINUSE")) throw new Error(`API process failed to start:\n${out}`);
  }
  throw new Error("no free port for the API process");
}

/** SIGTERM; resolves with the exit and how long it took (or null after 20 s, then SIGKILL). */
async function terminate(api: ApiProcess) {
  const t0 = Date.now();
  api.proc.kill("SIGTERM");
  const r = await Promise.race([api.exited, sleep(20_000).then(() => null)]);
  if (!r) api.proc.kill("SIGKILL");
  return { exit: r, ms: r ? r.at - t0 : -1 };
}

/** Every log line of the process, parsed (pino JSON). */
function logOf(api: ApiProcess): Array<{ level: number; msg: string; [k: string]: unknown }> {
  return api
    .output()
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as { level: number; msg: string });
}

/** Every file under `dir`, relative, sorted, with its size. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, e.name);
      if (e.isDirectory()) walk(path);
      else out.push(`${relative(dir, path)} (${statSync(path).size} B)`);
    }
  };
  walk(dir);
  return out.sort();
}

function openClient(port: number): Promise<{ socket: Socket; closed: () => boolean; text: () => string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    let closed = false;
    socket.on("data", (d: Buffer) => chunks.push(d));
    for (const e of ["end", "close", "error"] as const) socket.on(e, () => (closed = true));
    socket.once("connect", () =>
      resolve({ socket, closed: () => closed, text: () => Buffer.concat(chunks).toString("latin1") }),
    );
    socket.once("error", reject);
  });
}

async function newFile(title: string) {
  const c = await call(base.app, "POST", `${T}/evidence`, {
    session: p.lead.session,
    body: { ownerUserId: p.lead.id, kind: "file", title },
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  return { id: c.body.id as string, version: c.body.version as number, org: c.body.organizationId as string };
}

function uploadHead(evidenceId: string, version: number, length: number): Buffer {
  const lines = [
    `POST ${T}/evidence/${evidenceId}/content HTTP/1.1`,
    "Host: 127.0.0.1",
    `Cookie: ${p.lead.session.cookie}`,
    `Origin: ${APP_ORIGIN}`,
    `X-CSRF-Token: ${p.lead.session.csrf}`,
    `If-Match: "${version}"`,
    "X-File-Name: synthetic-shutdown.bin",
    "Content-Type: application/octet-stream",
    `Content-Length: ${length}`,
  ];
  return Buffer.from(`${lines.join("\r\n")}\r\n\r\n`, "latin1");
}

async function contentRowsOf(evidenceId: string): Promise<number> {
  return Number(
    (
      await sql<{ n: string }>`select count(*) n from evidence_content where evidence_id = ${evidenceId}`.execute(
        base.db,
      )
    ).rows[0]!.n,
  );
}

const freshStore = () => mkdtempSync(join(tmpdir(), "mth-evidence-shutdown-"));

// ------------------------------------------------------------------------------------------------ shutdown

describe("F-DG2-460: SIGTERM with an upload in flight leaves no temporary and no final object", () => {
  it("R12-07: 2 MiB of a declared 10 MiB upload, then the client stalls; SIGTERM -> exit 0 within grace + backstop; the store is empty", async () => {
    const store = freshStore();
    const api = await startProcess(store);
    try {
      const f = await newFile("Synthetic stalled upload at SIGTERM");
      const client = await openClient(api.port);
      client.socket.write(uploadHead(f.id, f.version, 10 * MiB));
      client.socket.write(randomBytes(2 * MiB));
      // The upload is in flight: its temporary object holds the 2 MiB received so far.
      const received = await waitFor(() => filesUnder(store).some((x) => x.endsWith(`.part (${2 * MiB} B)`)), 10_000);
      const during = filesUnder(store);
      const { exit, ms } = await terminate(api);
      const after = filesUnder(store);
      const log = logOf(api);
      console.log(
        `BE18A R12-07 ${JSON.stringify({ during, exitCode: exit?.code, signal: exit?.signal, ms, after, rows: await contentRowsOf(f.id), serverClosed: client.closed(), response: client.text().slice(0, 12) })}`,
      );
      expect(received).toBe(true);
      expect(exit?.code).toBe(0);
      expect(ms).toBeLessThanOrEqual(BACKSTOP_MS + 1_000);
      expect(log.some((l) => l.msg === "shut down")).toBe(true);
      expect(log.filter((l) => l.level >= 50)).toEqual([]);
      expect(after).toEqual([]);
      expect(await contentRowsOf(f.id)).toBe(0);
      client.socket.destroy();
    } finally {
      if (api.proc.exitCode === null && api.proc.signalCode === null) api.proc.kill("SIGKILL");
    }
  }, 60_000);

  it("an upload that is ACTIVELY streaming through the whole grace period: SIGTERM -> exit 0 within grace + backstop; the store is empty", async () => {
    const store = freshStore();
    const api = await startProcess(store);
    let streaming = true;
    try {
      const f = await newFile("Synthetic streaming upload at SIGTERM");
      const client = await openClient(api.port);
      client.socket.write(uploadHead(f.id, f.version, 25 * MiB));
      // ~1.25 MiB/s: the 25 MiB body cannot finish within the 5 s grace, so the server must cut it.
      let sent = 0;
      const pump = (async () => {
        const piece = randomBytes(64 * 1024);
        while (streaming && !client.closed() && sent + piece.length <= 25 * MiB) {
          client.socket.write(piece);
          sent += piece.length;
          await sleep(50);
        }
      })();
      expect(await waitFor(() => filesUnder(store).some((x) => x.includes(".part")), 10_000)).toBe(true);
      await sleep(500);
      const sentAtSignal = sent;
      const { exit, ms } = await terminate(api);
      streaming = false;
      await pump;
      const after = filesUnder(store);
      const log = logOf(api);
      console.log(
        `BE18A streaming ${JSON.stringify({ sentAtSignal, sentTotal: sent, exitCode: exit?.code, ms, after, rows: await contentRowsOf(f.id), serverClosed: client.closed() })}`,
      );
      expect(sent).toBeLessThan(25 * MiB);
      expect(exit?.code).toBe(0);
      expect(ms).toBeLessThanOrEqual(BACKSTOP_MS + 1_000);
      expect(ms).toBeGreaterThanOrEqual(GRACE_MS - 250); // the upload was given the grace period
      expect(log.some((l) => l.msg === "shut down")).toBe(true);
      expect(log.filter((l) => l.level >= 50)).toEqual([]);
      expect(after).toEqual([]);
      expect(await contentRowsOf(f.id)).toBe(0);
      client.socket.destroy();
    } finally {
      streaming = false;
      if (api.proc.exitCode === null && api.proc.signalCode === null) api.proc.kill("SIGKILL");
    }
  }, 60_000);

  it("positive control: an upload that completes before SIGTERM is kept (one final object, its content row), then shutdown is prompt", async () => {
    const store = freshStore();
    const api = await startProcess(store);
    try {
      const f = await newFile("Synthetic completed upload before SIGTERM");
      const client = await openClient(api.port);
      const bytes = randomBytes(MiB);
      client.socket.write(uploadHead(f.id, f.version, bytes.length));
      client.socket.write(bytes);
      expect(await waitFor(() => client.text().startsWith("HTTP/1.1 "), 10_000)).toBe(true);
      expect(client.text().slice(0, 12)).toBe("HTTP/1.1 200");
      client.socket.destroy();
      const { exit, ms } = await terminate(api);
      const after = filesUnder(store);
      expect(exit?.code).toBe(0);
      expect(ms).toBeLessThan(3_000);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatch(new RegExp(`^${f.org}/${p.transformationId}/${f.id}/[0-9a-f-]{36} \\(${MiB} B\\)$`));
      expect(await contentRowsOf(f.id)).toBe(1);
    } finally {
      if (api.proc.exitCode === null && api.proc.signalCode === null) api.proc.kill("SIGKILL");
    }
  }, 60_000);
});

// ------------------------------------------------------------------------------------------------ start-up sweep

describe("F-DG2-460 defence in depth: the start-up sweep of stale temporaries", () => {
  it("removes a .part last written over an hour ago, logs it at info (no content), and keeps a fresh .part and every final object", async () => {
    const store = freshStore();
    const dir = join(store, uuidv7(), uuidv7(), uuidv7());
    mkdirSync(dir, { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
    const secret = "SYNTHETIC-PARTIAL-CONTENT-must-never-be-logged";
    const put = (name: string, at: Date | null, content = secret) => {
      writeFileSync(join(dir, name), content);
      if (at) utimesSync(join(dir, name), at, at);
      return `${relative(store, join(dir, name))} (${content.length} B)`;
    };
    const stale = put(`${uuidv7()}.part`, twoHoursAgo);
    const fresh = put(`${uuidv7()}.part`, tenMinutesAgo); // younger than the threshold: may belong to a live upload
    const finalOld = put(uuidv7(), twoHoursAgo); // a committed object, however old, is never touched
    const finalNew = put(uuidv7(), null);
    const notAKey = put("notes.part", twoHoursAgo); // not an upload temporary's name
    // A stale-looking .part at the wrong depth (not where keys put temporaries) is left alone too.
    const shallowDir = join(store, uuidv7());
    mkdirSync(shallowDir, { recursive: true });
    writeFileSync(join(shallowDir, `${uuidv7()}.part`), secret);
    utimesSync(join(shallowDir, readdirSync(shallowDir)[0]!), twoHoursAgo, twoHoursAgo);
    const shallow = filesUnder(store).find((x) => x.startsWith(relative(store, shallowDir)))!;

    const api = await startProcess(store);
    try {
      expect(
        await waitFor(() => api.output().includes("start-up sweep of stale temporary objects finished"), 10_000),
      ).toBe(true);
      const after = filesUnder(store);
      const log = logOf(api);
      const removals = log.filter((l) => l.msg === "evidence store: stale temporary object removed");
      const summary = log.find((l) => l.msg === "evidence store: start-up sweep of stale temporary objects finished");
      console.log(`BE18A sweep ${JSON.stringify({ after, removals, summary })}`);
      expect(after).toEqual([fresh, finalOld, finalNew, notAKey, shallow].sort());
      expect(after).not.toContain(stale);
      expect(removals).toHaveLength(1);
      expect(removals[0]).toMatchObject({ level: 30, key: stale.replace(/ \(\d+ B\)$/, ""), sizeBytes: secret.length });
      expect(Number(removals[0]!["ageMs"])).toBeGreaterThan(3600_000);
      expect(summary).toMatchObject({ level: 30, removed: 1, keptFresh: 1, olderThanMs: 3600_000 });
      expect(api.output()).not.toContain(secret);
    } finally {
      const { exit } = await terminate(api);
      expect(exit?.code).toBe(0);
    }
  }, 60_000);
});
