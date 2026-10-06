// /readyz encoding check (ADR-0003 "Database encoding", T-DG2-BE9), without a database: a fake pool counts the
// queries. The real-PostgreSQL behaviour (SQL_ASCII vs UTF8 scratch databases) is in test/integration/platform.test.ts.
//  - a UTF8 answer is cached: one `SHOW server_encoding` per process, however many probes;
//  - a non-UTF8 answer is NOT cached and reports database: fail; once the database answers UTF8 it becomes ready.
import Fastify from "fastify";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { registerHealthRoutes } from "./health.ts";

function fakePool(encoding: () => string) {
  const seen: string[] = [];
  const client = {
    query: async (text: string) => {
      seen.push(text);
      if (text === "SHOW server_encoding") return { rows: [{ server_encoding: encoding() }] };
      if (text.includes("to_regclass")) return { rows: [{ exists: false }] };
      return { rows: [{ "?column?": 1 }] };
    },
    release: () => undefined,
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;
  return { pool, shows: () => seen.filter((q) => q === "SHOW server_encoding").length };
}

async function probe(app: ReturnType<typeof Fastify>) {
  const res = await app.inject({ method: "GET", url: "/readyz" });
  return [res.statusCode, res.json()];
}

const READY = [200, { status: "ready", checks: { database: "ok", migrations: "ok" } }];
const NOT_UTF8 = [503, { status: "not_ready", checks: { database: "fail", migrations: "fail" } }];

describe("/readyz database encoding", () => {
  it("is ready on UTF8 and asks for the encoding only once per process", async () => {
    const { pool, shows } = fakePool(() => "UTF8");
    const app = Fastify();
    registerHealthRoutes(app, pool, []);
    for (let i = 0; i < 3; i++) expect(await probe(app)).toEqual(READY);
    expect(shows()).toBe(1);
    await app.close();
  });

  it("reports database: fail on SQL_ASCII, re-checks every probe, and recovers once the database is UTF8", async () => {
    let encoding = "SQL_ASCII";
    const { pool, shows } = fakePool(() => encoding);
    const app = Fastify();
    registerHealthRoutes(app, pool, []);
    expect(await probe(app)).toEqual(NOT_UTF8);
    expect(await probe(app)).toEqual(NOT_UTF8);
    expect(shows()).toBe(2);
    encoding = "UTF8";
    expect(await probe(app)).toEqual(READY);
    expect(await probe(app)).toEqual(READY);
    expect(shows()).toBe(3);
    await app.close();
  });
});
