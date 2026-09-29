import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, PoolClient } from 'pg';
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
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;
  private readonly als = new AsyncLocalStorage<TxStore>();

  private readonly timeouts: { statementMs: number; lockMs: number; idleMs: number };

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: config.databasePoolMax, application_name: 'hub-api' });
    this.timeouts = config.dbTimeouts;
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
    const store: TxStore = { tx: drizzle(client, { schema }), client, ctx, afterCommit: [], closed: false };
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
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      store.closed = true;
      client.release();
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
    try {
      await client.query('BEGIN');
      await this.applyContext(client, ctx);
      const r = await fn(drizzle(client, { schema }));
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  private async applyContext(client: PoolClient, ctx: RequestContext) {
    withDbScope(ctx);
    await client.query(
      `select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true),
              set_config('app.project_ids', $3, true), set_config('app.correlation_id', $4, true),
              set_config('app.full_project_ids', $5, true), set_config('app.room_ids', $6, true),
              set_config('statement_timeout', $7, true), set_config('lock_timeout', $8, true),
              set_config('idle_in_transaction_session_timeout', $9, true)`,
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
      ],
    );
  }
}
