// qa-verifier support for the root A13/A22 e2e specs (T-DG5-QA-F). Runs inside a stack started by
// apps/web/e2e/support/with-stack.sh (disposable PostgreSQL, migrate, seed-dev, the built API serving the built SPA),
// which exports DATABASE_URL (mth_app) and DATABASE_OWNER_URL (mth_owner) of that disposable database.
//  - `apiSession`: a dev-login session of a seeded synthetic dev user against the real API;
//  - `psql`: the PostgreSQL client against the disposable database, as its OWNER (fixture reads, the disclosed fault
//    injection of the A13 spec, and the bounded retry limit of the queue under test); a missing psql is BLOCKED;
//  - `startProductionWorker`: the BUILT worker (`node apps/worker/dist/main.js`, the production entry point) as its own
//    OS process against the same database, stopped with SIGTERM at the end.
// All data is SYNTHETIC; nothing here approves anything real or touches the engineering gates DG0-DG7.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { expect, type APIRequestContext, type PlaywrightWorkerArgs } from "@playwright/test";

type Playwright = PlaywrightWorkerArgs["playwright"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;

export interface Api {
  readonly ctx: APIRequestContext;
  readonly csrf: string;
  readonly userId: string;
  readonly organizationId: string;
}

export async function apiSession(playwright: Playwright, baseURL: string, username: string): Promise<Api> {
  const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: new URL(baseURL).origin } });
  const login = await ctx.post("/api/v1/auth/dev-login", { data: { username } });
  expect(login.status(), `dev login ${username} (is the stack seeded with seed-dev?)`).toBe(204);
  const me = (await (await ctx.get("/api/v1/me")).json()) as Body;
  return { ctx, csrf: me.csrfToken, userId: me.user.id, organizationId: me.organization.id };
}

export async function send(
  api: Api,
  method: string,
  url: string,
  data?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Body; etag: string | undefined }> {
  const res = await api.ctx.fetch(url, {
    method,
    headers: { "x-csrf-token": api.csrf, ...headers },
    ...(data !== undefined ? { data } : {}),
  });
  const text = await res.text();
  return { status: res.status(), body: text ? JSON.parse(text) : null, etag: res.headers()["etag"] };
}

export function ownerUrl(): string {
  const url = process.env["DATABASE_OWNER_URL"];
  if (!url)
    throw new Error("BLOCKED: DATABASE_OWNER_URL is not set (run the spec through apps/web/e2e/support/with-stack.sh)");
  return url;
}

/** Runs SQL as the database owner; returns the rows as tab-separated lines. */
export function psql(sql: string): string[] {
  try {
    // psql does not decode "+" in a URI's options parameter: pass the role through PGOPTIONS instead.
    const u = new URL(ownerUrl());
    const options = u.searchParams.get("options");
    u.search = "";
    return execFileSync("psql", [u.toString(), "-X", "-qAt", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql], {
      encoding: "utf8",
      env: { ...process.env, ...(options ? { PGOPTIONS: options } : {}) },
    })
      .split("\n")
      .filter((l) => l.length > 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new Error("BLOCKED: psql is not installed");
    throw e;
  }
}

export interface ProductionWorker {
  readonly child: ChildProcess;
  output(): string;
  stop(): Promise<void>;
}

export async function startProductionWorker(): Promise<ProductionWorker> {
  const child = spawn(process.execPath, ["apps/worker/dist/main.js"], {
    env: { ...process.env, LOG_LEVEL: "warn" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout!.on("data", (b: Buffer) => (out += b.toString()));
  child.stderr!.on("data", (b: Buffer) => (out += b.toString()));
  const until = Date.now() + 60_000;
  while (!out.includes("mth-worker started")) {
    if (child.exitCode !== null) throw new Error(`the worker exited (${child.exitCode}) before it started: ${out}`);
    if (Date.now() > until) throw new Error(`the worker did not start within 60 s: ${out}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    child,
    output: () => out,
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((r) => setTimeout(r, 25_000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

export async function poll<T>(
  probe: () => Promise<T | null | undefined | false>,
  what: string,
  ms = 60_000,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}
