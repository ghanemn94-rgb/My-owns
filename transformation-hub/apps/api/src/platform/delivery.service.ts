import { Injectable, Logger } from '@nestjs/common';
import { DbService } from './db.service';
import { newId, sha256Hex } from './ids';

export type DeliveryOutcome = { status: 'sent'; providerMessageId?: string } | { status: 'failed' | 'disabled' | 'suppressed'; detail: string };

/**
 * Side-effect ledger for external deliveries (email/Teams/…) — AT-20. Protocol:
 *  1. begin(): INSERT a `sending` row keyed by an idempotency key and COMMIT it before the external call
 *     (a duplicate key means another attempt already started → do not send again);
 *  2. perform the side effect;
 *  3. finish(): mark `sent` / `failed`.
 * After a crash between 1 and 3 the row stays `sending`; reconcileStale() turns it into `uncertain` for a human (or a
 * provider lookup) to reconcile. Nothing is ever re-sent blindly.
 */
@Injectable()
export class DeliveryService {
  private readonly log = new Logger('delivery');
  constructor(private readonly db: DbService) {}

  async begin(input: { orgId: string; projectId: string | null; idempotencyKey: string; channel: 'in_app' | 'email' | 'teams' | 'sms'; recipientUserId?: string | null; recipientAddress?: string | null; payload: unknown }): Promise<{ proceed: boolean; id: string | null; existingStatus?: string }> {
    const id = newId();
    const r = await this.db.pool.query(
      `insert into delivery_record (id, org_id, project_id, idempotency_key, channel, recipient_user_id, recipient_address_hash, payload_hash, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'sending') on conflict (idempotency_key) do nothing`,
      [id, input.orgId, input.projectId, input.idempotencyKey, input.channel, input.recipientUserId ?? null, input.recipientAddress ? sha256Hex(input.recipientAddress) : null, sha256Hex(JSON.stringify(input.payload))],
    );
    if ((r.rowCount ?? 0) > 0) return { proceed: true, id };
    const existing = await this.db.pool.query<{ status: string }>(`select status from delivery_record where idempotency_key = $1`, [input.idempotencyKey]);
    return { proceed: false, id: null, existingStatus: existing.rows[0]?.status };
  }

  async finish(id: string, outcome: DeliveryOutcome) {
    await this.db.pool.query(`update delivery_record set status = $2, provider_message_id = $3, detail = $4, updated_at = now() where id = $1 and status = 'sending'`, [
      id,
      outcome.status,
      outcome.status === 'sent' ? outcome.providerMessageId ?? null : null,
      outcome.status === 'sent' ? null : outcome.detail,
    ]);
  }

  /** Mark deliveries stuck in `sending` (worker crashed mid-send) as `uncertain` — never auto-resend. */
  async reconcileStale(olderThanMinutes = 10): Promise<number> {
    const r = await this.db.pool.query(
      `update delivery_record set status = 'uncertain', detail = coalesce(detail, '') || 'worker did not confirm delivery; reconcile before any resend', updated_at = now()
        where status = 'sending' and updated_at < now() - ($1::int * interval '1 minute')`,
      [olderThanMinutes],
    );
    if ((r.rowCount ?? 0) > 0) this.log.warn(`${r.rowCount} delivery record(s) marked uncertain`);
    return r.rowCount ?? 0;
  }
}
