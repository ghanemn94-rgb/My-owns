import { pgTable, uuid, text, integer, jsonb, varchar, boolean, bigserial, bigint, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  pk,
  orgIdCol,
  createdAt,
  updatedAt,
  createdBy,
  versionCol,
  ts,
  notificationChannel,
  deliveryStatus,
  integrationKind,
  integrationDirection,
  integrationStatus,
  jobStatus,
  actorKind,
  projectFk,
  type FkTarget,
} from './_common';
import { organization } from './identity';
import { aiProposal } from './ai';

/** In-app notification (and delivery record for other channels). Channels other than in_app default disabled. */
export const notification = pgTable(
  'notification',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: uuid('project_id'),
    userId: uuid('user_id').notNull(),
    kind: varchar('kind', { length: 48 }).notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    channel: notificationChannel('channel').notNull().default('in_app'),
    deliveryStatus: deliveryStatus('delivery_status').notNull().default('queued'),
    dedupeKey: varchar('dedupe_key', { length: 200 }),
    sourceType: varchar('source_type', { length: 32 }),
    sourceId: uuid('source_id'),
    aiProposalId: uuid('ai_proposal_id'),
    /**
     * P6 notifications module (REQ-PLT-008, C-33): message code + parameters (record codes, enum values, numbers — never
     * titles or content). The web translates `notifications.messages.<code>`; `title` keeps the English rendering.
     */
    messageCode: varchar('message_code', { length: 96 }),
    messageParams: jsonb('message_params').$type<Record<string, string | number>>(),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notification_user_idx').on(t.userId, t.readAt),
    projectFk('notification_ai_proposal_fk', t.projectId, t.aiProposalId, (): FkTarget => aiProposal),
    uniqueIndex('notification_dedupe_uq').on(t.userId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
  ],
);

/**
 * Integration connection. Secrets are never stored here — only the *name* of a secret in the secret store.
 * Status is `verified` only after a real connectivity check (spec §17).
 */
export const integrationConnection = pgTable(
  'integration_connection',
  {
  id: pk(),
  orgId: orgIdCol().references(() => organization.id),
  /** Adapter of the registry (packages/domain/src/integrations.ts INTEGRATION_ADAPTERS) — one connection per adapter. */
  adapterKey: varchar('adapter_key', { length: 64 }).notNull(),
  kind: integrationKind('kind').notNull(),
  name: text('name').notNull(),
  direction: integrationDirection('direction').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  secretRef: text('secret_ref'),
  status: integrationStatus('status').notNull().default('not_configured'),
  enabled: boolean('enabled').notNull().default(false),
  sendingAuthorized: boolean('sending_authorized').notNull().default(false),
  approvedDestinations: jsonb('approved_destinations').$type<string[]>().notNull().default([]),
  lastCheckedAt: ts('last_checked_at'),
  lastCheckResult: text('last_check_result'),
  lastCheckCode: varchar('last_check_code', { length: 64 }),
  createdAt: createdAt(),
  createdBy: createdBy(),
  updatedAt: updatedAt(),
  version: versionCol(),
  },
  (t) => [uniqueIndex('integration_connection_adapter_uq').on(t.orgId, t.adapterKey)],
);

/**
 * Execution log of a connector (REQ-INT-006): every configuration, connectivity check, refusal, delivery and
 * reconciliation — operation, outcome and a code; never secrets or payload content. Append-only by convention.
 */
export const integrationExecutionLog = pgTable(
  'integration_execution_log',
  {
    id: pk(),
    orgId: orgIdCol().references(() => organization.id),
    adapterKey: varchar('adapter_key', { length: 64 }).notNull(),
    /** configure | test | enable | disable | send | receive | process | retry | reconcile | alert */
    operation: varchar('operation', { length: 24 }).notNull(),
    /** success | refused | failed */
    outcome: varchar('outcome', { length: 16 }).notNull(),
    code: varchar('code', { length: 64 }),
    detail: text('detail'),
    actorUserId: uuid('actor_user_id'),
    correlationId: varchar('correlation_id', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index('integration_execution_log_idx').on(t.orgId, t.adapterKey, t.createdAt)],
);

/**
 * Inbound webhook deliveries (REQ-INT-009/010, C-39). The sender's delivery id is the replay nonce and the idempotency
 * key: a second receipt of the same id is acknowledged and never processed again. Processing runs in the worker with
 * retries and back-off; deliveries whose processing died are marked failed by reconciliation and raise an alert.
 */
export const webhookDelivery = pgTable(
  'webhook_delivery',
  {
    id: pk(),
    orgId: orgIdCol().references(() => organization.id),
    adapterKey: varchar('adapter_key', { length: 64 }).notNull(),
    deliveryId: varchar('delivery_id', { length: 128 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    senderTimestamp: ts('sender_timestamp').notNull(),
    /** received → processed | ignored | failed */
    status: varchar('status', { length: 16 }).notNull().default('received'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    receivedAt: createdAt(),
    processedAt: ts('processed_at'),
  },
  (t) => [
    uniqueIndex('webhook_delivery_nonce_uq').on(t.orgId, t.adapterKey, t.deliveryId),
    index('webhook_delivery_status_idx').on(t.orgId, t.adapterKey, t.status, t.receivedAt),
  ],
);

/** Transactional outbox: written in the same transaction as the business change. */
export const outboxEvent = pgTable(
  'outbox_event',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: uuid('project_id'),
    type: varchar('type', { length: 64 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 32 }),
    aggregateId: uuid('aggregate_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: varchar('dedupe_key', { length: 200 }),
    createdAt: createdAt(),
    dispatchedAt: ts('dispatched_at'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    index('outbox_pending_idx').on(t.createdAt).where(sql`${t.dispatchedAt} is null`),
    uniqueIndex('outbox_dedupe_uq').on(t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
  ],
);

/** Durable job queue (FOR UPDATE SKIP LOCKED). Payloads carry ids only. */
export const job = pgTable(
  'job',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: uuid('project_id'),
    kind: varchar('kind', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    status: jobStatus('status').notNull().default('queued'),
    runAt: ts('run_at').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedBy: varchar('locked_by', { length: 64 }),
    lockedUntil: ts('locked_until'),
    lastError: text('last_error'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    requestedBy: uuid('requested_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    uniqueIndex('job_idempotency_uq').on(t.idempotencyKey),
    index('job_ready_idx').on(t.status, t.runAt),
  ],
);

/** Durable schedule definitions (cron in a timezone), e.g. daily AI briefing at 07:30 Asia/Riyadh. */
export const scheduledJob = pgTable(
  'scheduled_job',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: uuid('project_id'),
    kind: varchar('kind', { length: 64 }).notNull(),
    name: text('name').notNull(),
    cron: varchar('cron', { length: 64 }).notNull(),
    timezone: text('timezone').notNull().default('Asia/Riyadh'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    nextRunAt: ts('next_run_at'),
    lastRunAt: ts('last_run_at'),
    lastStatus: varchar('last_status', { length: 32 }),
    lastError: text('last_error'),
    ownerUserId: uuid('owner_user_id'),
    createdAt: createdAt(),
    createdBy: createdBy(),
    updatedAt: updatedAt(),
    version: versionCol(),
  },
  (t) => [index('scheduled_job_due_idx').on(t.enabled, t.nextRunAt)],
);

/**
 * Side-effect ledger for exactly-once *intent* (AT-20). A row is inserted (status 'sending') BEFORE an external
 * side effect; on crash-recovery a 'sending' row becomes 'uncertain' and is reconciled, never blindly resent.
 */
export const deliveryRecord = pgTable(
  'delivery_record',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: uuid('project_id'),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    channel: notificationChannel('channel').notNull(),
    recipientUserId: uuid('recipient_user_id'),
    recipientAddressHash: varchar('recipient_address_hash', { length: 64 }),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    status: deliveryStatus('status').notNull(),
    providerMessageId: text('provider_message_id'),
    detail: text('detail'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('delivery_record_idem_uq').on(t.idempotencyKey)],
);

/**
 * Append-only audit log (trigger rejects UPDATE/DELETE; runtime role has INSERT/SELECT only). Hash-chained per
 * organization: tamper-EVIDENT, not tamper-proof — a DB superuser can still alter history. Export to an
 * independent log store for stronger guarantees (ADR-0014).
 */
export const auditEvent = pgTable(
  'audit_event',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    id: uuid('id').notNull().default(sql`gen_random_uuid()`),
    orgId: orgIdCol(),
    projectId: uuid('project_id'),
    actorUserId: uuid('actor_user_id'),
    actorKind: actorKind('actor_kind').notNull(),
    action: varchar('action', { length: 96 }).notNull(),
    entityType: varchar('entity_type', { length: 48 }),
    entityId: uuid('entity_id'),
    outcome: varchar('outcome', { length: 16 }).notNull().default('success'), // success | denied | error
    reason: text('reason'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    correlationId: varchar('correlation_id', { length: 64 }),
    ip: varchar('ip', { length: 64 }),
    chainPos: bigint('chain_pos', { mode: 'number' }),
    prevHash: varchar('prev_hash', { length: 64 }),
    hash: varchar('hash', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('audit_event_id_uq').on(t.id),
    index('audit_event_project_idx').on(t.projectId, t.createdAt),
    index('audit_event_entity_idx').on(t.entityType, t.entityId),
    uniqueIndex('audit_event_chain_uq').on(t.orgId, t.chainPos),
  ],
);

/** Immutable version history for versioned records (perimeter items, charters, agreements, etc.). */
export const recordVersion = pgTable(
  'record_version',
  {
    id: pk(),
    orgId: orgIdCol(),
    projectId: uuid('project_id'),
    entityType: varchar('entity_type', { length: 48 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    versionNo: integer('version_no').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    reason: text('reason'),
    changedBy: uuid('changed_by'),
    changedAt: createdAt(),
  },
  (t) => [uniqueIndex('record_version_uq').on(t.entityType, t.entityId, t.versionNo)],
);

/**
 * Periodic checkpoints of the audit chain head. Exported to an external log store in production so that truncation of
 * the chain tail becomes detectable (ADR-0014 limits). Append-only.
 */
export const auditCheckpoint = pgTable(
  'audit_checkpoint',
  {
    id: pk(),
    orgId: orgIdCol(),
    chainPos: bigint('chain_pos', { mode: 'number' }).notNull(),
    hash: varchar('hash', { length: 64 }).notNull(),
    rowCount: bigint('row_count', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_checkpoint_org_idx').on(t.orgId, t.chainPos)],
);
