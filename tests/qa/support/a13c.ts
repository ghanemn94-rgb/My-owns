// qa-verifier acceptance support for the A13 P6 kill-and-restart drills (T-DG6-QA-C). Setup and observation only; no
// assertion about an acceptance outcome lives here.
//
// Each drill runs on its OWN scratch database of the run's disposable cluster (scratchEnv of a13-durable.ts) and kills a
// REAL process: the API composition (a13c-child-api.ts) for a connector run and an import commit, the production worker
// (a13c-child-worker.ts) for a channel send and a search reindex.
// Fault injection (disclosed, the T-DG5-QA-F method): a BEFORE INSERT trigger that the drill installs in ITS scratch
// database, as the cluster superuser, on the one table the job writes in the middle of its work. While the trigger's
// switch is on, the insert waits on an advisory lock the test holds, so the process is provably "mid-job" (inside its
// transaction, nothing committed) when it is killed. No product file is touched. Turning the switch off is "fixing the
// cause"; the restarted process then runs the real code path again.
// Killing: SIGKILL of the OS process, then pg_terminate_backend of its sessions (the database server ends a dead
// client's sessions; in production by TCP keepalive or idle-in-transaction timeout), so its open transaction rolls back.
// All people and data are SYNTHETIC; nothing here approves anything real or touches the engineering gates DG0-DG7.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { createPool } from "./api.ts";
import { waitFor } from "./a13-durable.ts";

export { waitFor };

type Pool = ReturnType<typeof createPool>;

/** The advisory lock the blocking trigger waits on (shared mode), held exclusively by the test. */
export const BLOCK_LOCK = 7313016;

export interface Child {
  readonly child: ChildProcess;
  readonly appName: string;
  output(): string;
}

/** Spawns a child support script with `node --conditions=@mth/source` and waits for READY. */
export async function spawnChild(script: "a13c-child-api.ts" | "a13c-child-worker.ts", env: Record<string, string>) {
  const appName = env["QA_CHILD_APP_NAME"]!;
  const child = spawn(
    process.execPath,
    ["--conditions=@mth/source", fileURLToPath(new URL(`./${script}`, import.meta.url))],
    {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let out = "";
  child.stdout!.on("data", (b: Buffer) => (out += b.toString()));
  child.stderr!.on("data", (b: Buffer) => (out += b.toString()));
  await waitFor(
    async () => {
      if (child.exitCode !== null) throw new Error(`${script} exited (${child.exitCode}) before READY: ${out}`);
      return out.includes("READY");
    },
    `${script} READY`,
    90_000,
  );
  return { child, appName, output: () => out } satisfies Child;
}

/** Installs the switchable blocking trigger on `table` (BEFORE INSERT, FOR EACH ROW, only when `whenSql` holds). */
export async function installBlock(su: Pool, name: string, table: string, whenSql = "true"): Promise<void> {
  await su.query(`
    CREATE TABLE IF NOT EXISTS public.qa_a13c_switch (name text PRIMARY KEY, on_ boolean NOT NULL);
    GRANT SELECT ON public.qa_a13c_switch TO PUBLIC;
    CREATE OR REPLACE FUNCTION public.qa_a13c_block_fn() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF EXISTS (SELECT 1 FROM public.qa_a13c_switch s WHERE s.name = TG_ARGV[0] AND s.on_) THEN
        PERFORM pg_advisory_xact_lock_shared(${BLOCK_LOCK});
      END IF;
      RETURN NEW;
    END $f$;
    INSERT INTO public.qa_a13c_switch (name, on_) VALUES ('${name}', false) ON CONFLICT (name) DO NOTHING;
    DROP TRIGGER IF EXISTS qa_a13c_${name} ON public.${table};
    CREATE TRIGGER qa_a13c_${name} BEFORE INSERT ON public.${table} FOR EACH ROW WHEN (${whenSql})
      EXECUTE FUNCTION public.qa_a13c_block_fn('${name}');
  `);
}

export async function setBlock(su: Pool, name: string, on: boolean): Promise<void> {
  await su.query("UPDATE public.qa_a13c_switch SET on_ = $2 WHERE name = $1", [name, on]);
}

/** Holds BLOCK_LOCK exclusively on one dedicated connection until `release` is called. */
export async function holdBlockLock(su: Pool) {
  const holder = await su.connect();
  await holder.query("SELECT pg_advisory_lock($1)", [BLOCK_LOCK]);
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await holder.query("SELECT pg_advisory_unlock($1)", [BLOCK_LOCK]).catch(() => undefined);
      holder.release();
    },
  };
}

/** Waits until a session of `appName` waits on BLOCK_LOCK, i.e. the process is inside its transaction. */
export async function waitBlocked(su: Pool, c: Child, what: string, ms = 90_000): Promise<void> {
  await waitFor(
    async () =>
      (
        await su.query(
          `SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
            WHERE l.locktype = 'advisory' AND NOT l.granted AND a.application_name = $1`,
          [c.appName],
        )
      ).rowCount! > 0,
    what,
    ms,
  ).catch((e) => {
    throw new Error(`${String(e)}\nchild output:\n${c.output()}`);
  });
}

/** SIGKILL, then end the dead client's sessions so its open transactions roll back; waits until they are gone. */
export async function killHard(su: Pool, c: Child): Promise<void> {
  const exited = new Promise<NodeJS.Signals | null>((r) => c.child.once("exit", (_code, signal) => r(signal)));
  c.child.kill("SIGKILL");
  expect(await exited, "the child was killed by SIGKILL").toBe("SIGKILL");
  await su.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1", [c.appName]);
  await waitFor(
    async () =>
      (await su.query("SELECT 1 FROM pg_stat_activity WHERE application_name = $1", [c.appName])).rowCount === 0,
    "the killed process's sessions are gone",
  );
}

export async function stopChild(c: Child | null): Promise<void> {
  if (c === null || c.child.exitCode !== null || c.child.signalCode !== null) return;
  const exited = new Promise((r) => c.child.once("exit", r));
  c.child.kill("SIGKILL");
  await exited;
}

// ------------------------------------------------------------------ a local SMTP double that can hang before accepting

export interface HangingSmtp {
  readonly port: number;
  /** Messages the server ACCEPTED (it answered 250 to the end of DATA). */
  readonly accepted: { rcptTo: string[]; data: string }[];
  /** How many times a client finished sending DATA (accepted or not). */
  dataCompleted(): number;
  /** While true, the end of DATA gets no reply at all (the client waits: the send is in flight, not accepted). */
  hang(on: boolean): void;
  close(): Promise<void>;
}

function poolPort(): number {
  const m = /^(\d+)-(\d+)$/.exec(process.env["MTH_PORT_POOL"] ?? "");
  if (!m) return 0;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  // Deterministic within the pool: the highest port, then downwards on EADDRINUSE (see startHangingSmtp).
  return hi >= lo ? hi : 0;
}

/**
 * A minimal plain-text SMTP server on 127.0.0.1 (EHLO/HELO, MAIL, RCPT, DATA, RSET, NOOP, QUIT; no AUTH, no TLS). It
 * never relays. With `hang(true)` it receives a whole message and then never answers, so a sending client is stuck
 * in the middle of the send: the message is NOT accepted (SMTP accepts a message only with the 250 after DATA).
 */
export async function startHangingSmtp(): Promise<HangingSmtp> {
  const accepted: { rcptTo: string[]; data: string }[] = [];
  let completed = 0;
  let hanging = false;
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.setEncoding("utf8");
    let buf = "";
    let inData = false;
    let data = "";
    let rcpt: string[] = [];
    socket.write("220 qa-a13c.invalid ESMTP synthetic double\r\n");
    socket.on("data", (chunk: string) => {
      buf += chunk;
      for (;;) {
        const i = buf.indexOf("\r\n");
        if (i < 0) break;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            completed += 1;
            if (hanging) continue;
            accepted.push({ rcptTo: rcpt, data });
            socket.write("250 2.0.0 accepted\r\n");
          } else data += (line.startsWith("..") ? line.slice(1) : line) + "\n";
          continue;
        }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO") socket.write("250-qa-a13c.invalid\r\n250 8BITMIME\r\n");
        else if (verb === "HELO") socket.write("250 qa-a13c.invalid\r\n");
        else if (verb === "MAIL") {
          rcpt = [];
          data = "";
          socket.write("250 2.1.0 ok\r\n");
        } else if (verb === "RCPT") {
          rcpt.push(line.replace(/^RCPT TO:\s*/i, ""));
          socket.write("250 2.1.5 ok\r\n");
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 end with <CRLF>.<CRLF>\r\n");
        } else if (verb === "RSET" || verb === "NOOP") socket.write("250 ok\r\n");
        else if (verb === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else socket.write("502 5.5.2 not implemented\r\n");
      }
    });
  });
  let port = poolPort();
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      break;
    } catch (e) {
      if (port === 0 || attempt > 20) throw e;
      port -= 1;
    }
  }
  const addr = server.address();
  return {
    port: typeof addr === "object" && addr ? addr.port : port,
    accepted,
    dataCompleted: () => completed,
    hang(on: boolean) {
      hanging = on;
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
