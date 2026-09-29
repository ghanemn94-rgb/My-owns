import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { schema } from '@hub/db';
import { APP_CONFIG, AppConfig } from './config';
import { RequestContext, withDbScope } from './context';

export type Tx = NodePgDatabase<typeof schema>;

interface TxStore {
  tx: Tx;
  client: PoolClient;
  ctx: RequestContext;
  afterCommit: (() => void | Promise<void>)[];
  /** Set once the transaction has committed/rolled back — any later use is a bug (ARCH-07). */
  closed: boolean;
}

function scopeKey(ctx: RequestContext): string {
  return `${ctx.principal.orgId}|${ctx.principal.userId ?? ctx.principal.serviceIdentity ?? ''}|${[...ctx.projectIds].sort().join(',')}|${[...(ctx.fullProjectIds ?? [])].sort().join(',')}|${[...(ctx.roomIds ?? [])].sort().join(',')}`;
}

/**
 * Every business operation runs inside ONE transaction that first sets the RLS context:
 *   app.org_id, app.user_id, app.project_ids, app.correlation_id  (set_config(..., true) = transaction-local)
 * The transaction is stored in AsyncLocalStorage so services call `db.tx()` without threading it through.
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;
  private readonly als = new AsyncLocalStorage<TxStore>();

  private readonly timeouts: { statementMs: number; lockMs: number; idleMs: number };
  private readonly log = new Logger('db');

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: config.databasePoolMax, application_name: 'hub-api', connectionTimeoutMillis: 10_000 });
    this.timeouts = config.dbTimeouts;
  }

  /**
   * Start-up self-check (ARCH-04): the runtime role must not be superuser, BYPASSRLS, or the owner of the tables —
   * otherwise row-level security would silently not apply. Fatal in production, a loud warning elsewhere.
   */
  async onModuleInit() {
    let problem: string | null = null;
    try {
      const { rows } = await this.pool.query<{ rolsuper: boolean; rolbypassrls: boolean; owned: number }>(
        `select r.rolsuper, r.rolbypassrls,
                (select count(*)::int from pg_tables t where t.schemaname = 'public' and t.tableowner = current_user) as owned
           from pg_roles r where r.rolname = current_user`,
      );
      const r = rows[0];
      if (r && (r.rolsuper || r.rolbypassrls || r.owned > 0)) {
        problem = `runtime database role ${r.rolsuper ? 'is superuser' : r.rolbypassrls ? 'has BYPASSRLS' : `owns ${r.owned} table(s)`} — row-level security would not isolate projects`;
      }
    } catch (e) {
      this.log.warn(`database self-check skipped: ${(e as Error).message}`);
      return;
    }
    if (!problem) return;
    if (this.config.nodeEnv === 'production') throw new Error(`Refusing to start: ${problem}. Use the non-owner runtime role (hub_app).`);
    this.log.warn(`SECURITY WARNING: ${problem} (allowed outside production only)`);
  }

  /** Raw SQL on the current transaction's connection when inside run(); otherwise on the pool (autocommit). */
  async query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<R>> {
    const s = this.als.getStore();
    if (s && s.closed) throw new Error('Transaction already finished — a continuation outlived its request (ARCH-07 / SEC-P1-09)');
    if (s) return s.client.query<R>(text, params);
    return this.pool.query<R>(text, params);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  /** Current transaction (throws when called outside `run`). */
  tx(): Tx {
    const s = this.als.getStore();
    if (!s) throw new Error('No active transaction — service called outside DbService.run()');
    if (s.closed) throw new Error('Transaction already finished — a continuation outlived its request (ARCH-07)');
    return s.tx;
  }

  ctx(): RequestContext {
    const s = this.als.getStore();
    if (!s) throw new Error('No active request context');
    return s.ctx;
  }

  inTx(): boolean {
    return !!this.als.getStore();
  }

  /** Register work to run only after the surrounding transaction commits (e.g. wake the worker). */
  afterCommit(fn: () => void | Promise<void>) {
    const s = this.als.getStore();
    if (!s) throw new Error('afterCommit outside transaction');
    s.afterCommit.push(fn);
  }

  /** Run `fn` inside a new transaction scoped to `ctx`. Nested calls reuse the outer transaction. */
  async run<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
    const existing = this.als.getStore();
    if (existing && !existing.closed) {
      // Nested call: only allowed with the SAME principal and scope; otherwise the caller must use runDetached().
      if (existing.ctx !== ctx && scopeKey(existing.ctx) !== scopeKey(ctx)) {
        throw new Error('Nested DbService.run() with a different principal/scope is not allowed (ARCH-07)');
      }
      return fn();
    }
    const client = await this.pool.connect();
    const store: TxStore = { tx: undefined as unknown as Tx, client, ctx, afterCommit: [], closed: false };
    // A captured `tx` that outlives its request fails loudly instead of running on a released connection (ARCH-07).
    store.tx = new Proxy(drizzle(client, { schema }), {
      get(target, prop, receiver) {
        if (prop === 'then') return undefined; // not a thenable (returning the handle from an async fn must not trip the guard)
        if (store.closed) throw new Error('Transaction already finished — a continuation outlived its request (ARCH-07)');
        return Reflect.get(target, prop, receiver);
      },
    });
    let broken: Error | undefined;
    try {
      await client.query('BEGIN');
      await this.applyContext(client, ctx);
      const result = await this.als.run(store, fn);
      await client.query('COMMIT');
      store.closed = true;
      for (const f of store.afterCommit) {
        try {
          await f();
        } catch {
          /* after-commit hooks are best-effort */
        }
      }
      return result;
    } catch (e) {
      store.closed = true;
      try {
        await client.query('ROLLBACK');
      } catch (rb) {
        broken = rb as Error; // connection state unknown → destroy it instead of returning it to the pool
      }
      throw e;
    } finally {
      store.closed = true;
      client.release(broken);
    }
  }

  /** Re-apply context mid-transaction (e.g. after creating a project, to include the new id in scope). */
  async refreshContext(ctx: RequestContext) {
    const s = this.als.getStore();
    if (!s) throw new Error('refreshContext outside transaction');
    s.ctx = ctx;
    await this.applyContext(s.client, ctx);
  }

  /** Autonomous transaction (separate connection) — used to persist audit of DENIED actions whose main tx rolls back. */
  async runDetached<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken: Error | undefined;
    try {
      await client.query('BEGIN');
      await this.applyContext(client, ctx);
      const r = await fn(drizzle(client, { schema }));
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK').catch((rb: Error) => {
        broken = rb;
      });
      throw e;
    } finally {
      client.release(broken);
    }
  }

  private async applyContext(client: PoolClient, ctx: RequestContext) {
    withDbScope(ctx);
    await client.query(
      `select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true),
              set_config('app.project_ids', $3, true), set_config('app.correlation_id', $4, true),
              set_config('app.full_project_ids', $5, true), set_config('app.room_ids', $6, true),
              set_config('statement_timeout', $7, true), set_config('lock_timeout', $8, true),
              set_config('idle_in_transaction_session_timeout', $9, true), set_config('app.room_only', $10, true)`,
      [
        ctx.principal.orgId,
        ctx.principal.userId ?? '',
        ctx.projectIds.join(','),
        ctx.correlationId,
        (ctx.fullProjectIds ?? []).join(','),
        (ctx.roomIds ?? []).join(','),
        String(this.timeouts.statementMs),
        String(this.timeouts.lockMs),
        String(this.timeouts.idleMs),
        isRoomOnlyPrincipal(ctx) ? 'true' : 'false',
      ],
    );
  }
}

/**
 * A room-only principal (clean team / external partner) holds only room grants: no organization role and no project or
 * workstream role anywhere. The database then hides organization-level data from it (SEC-P1-12).
 */
export function isRoomOnlyPrincipal(ctx: RequestContext): boolean {
  const p = ctx.principal;
  if (p.kind !== 'user' || p.orgRoles.size > 0 || p.projects.size === 0) return false;
  for (const s of p.projects.values()) if (s.roles.size > 0 || s.workstreamRoles.length > 0) return false;
  return true;
}
