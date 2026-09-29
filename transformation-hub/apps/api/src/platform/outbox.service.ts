import { Injectable } from '@nestjs/common';
import { schema } from '@hub/db';
import type { OutboxEventType } from '@hub/domain';
import { DbService } from './db.service';
import { newId } from './ids';

/** Transactional outbox: events are written in the same transaction as the business change (ADR-0004). */
@Injectable()
export class OutboxService {
  constructor(private readonly db: DbService) {}

  async emit(event: {
    type: OutboxEventType;
    projectId: string | null;
    aggregateType?: string;
    aggregateId?: string;
    payload?: Record<string, unknown>;
    dedupeKey?: string;
  }): Promise<void> {
    const ctx = this.db.ctx();
    await this.db
      .tx()
      .insert(schema.outboxEvent)
      .values({
        id: newId(),
        orgId: ctx.principal.orgId,
        projectId: event.projectId,
        type: event.type,
        aggregateType: event.aggregateType ?? null,
        aggregateId: event.aggregateId ?? null,
        payload: event.payload ?? {},
        dedupeKey: event.dedupeKey ?? null,
      })
      .onConflictDoNothing();
  }
}
