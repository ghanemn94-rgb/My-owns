// Database encoding guard (ADR-0003 "Database encoding", T-DG2-BE9). The product requires a UTF8 database.
//
// On a SQL_ASCII database PostgreSQL stores bytes without validating them as UTF-8, and `char_length` counts BYTES, so
// every `char_length(...) BETWEEN 1 AND n` limit in the schema silently becomes a byte limit: a 120-character Arabic
// name (~240 bytes) would be refused, and invalid UTF-8 would be stored. So the database tools (`mth-db migrate`,
// `status`, `bootstrap`, `seed-dev`) refuse to touch a non-UTF8 database, and the API's /readyz reports
// `database: fail` on one. Fail closed: nothing is created or written before this check passes.
//
// `SHOW server_encoding` reports the encoding of the CURRENT database (it is fixed at CREATE DATABASE and cannot be
// altered later), so one query on the connection that will do the work is enough.
import type pg from "pg";

/** The only database encoding the product accepts (as PostgreSQL names it in `server_encoding`). */
export const REQUIRED_SERVER_ENCODING = "UTF8";

export class DatabaseEncodingError extends Error {
  readonly found: string;
  constructor(found: string) {
    super(
      `the database must use ${REQUIRED_SERVER_ENCODING} encoding (found ${found}); ` +
        `create it with ENCODING '${REQUIRED_SERVER_ENCODING}' TEMPLATE template0`,
    );
    this.name = "DatabaseEncodingError";
    this.found = found;
  }
}

/** Anything with a node-postgres style `query` (pg.Client, pg.PoolClient, pg.Pool). */
interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

/** The current database's encoding, e.g. "UTF8" or "SQL_ASCII". */
export async function readServerEncoding(q: Queryable): Promise<string> {
  const { rows } = await q.query<{ server_encoding: string }>("SHOW server_encoding");
  return rows[0]?.server_encoding ?? "unknown";
}

/** Throws DatabaseEncodingError unless the current database is UTF8. */
export async function assertUtf8Database(q: Queryable): Promise<void> {
  const found = await readServerEncoding(q);
  if (found !== REQUIRED_SERVER_ENCODING) throw new DatabaseEncodingError(found);
}
