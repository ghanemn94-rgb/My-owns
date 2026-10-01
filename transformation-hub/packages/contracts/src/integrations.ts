import { z } from 'zod';
import { INTEGRATION_ADAPTER_KEYS, INTEGRATION_STATUSES } from '@hub/domain';
import { defineRoute, registerRoutes } from './route';
import { ExpectedVersion, NoSort, PageQuery, ProjectParams, RequiredText, Text, paged } from './common';

/**
 * Integrations (spec §17; REQ-INT-006..010, REQ-INT-013/014, REQ-SEC-014, REQ-UX-020 integrations part).
 *
 * Every connector of the adapter registry is listed with an HONEST status: Not configured / Configured — not verified /
 * Verified (only after a real connectivity check) / Failed / Disabled. Microsoft 365 adapters declare their OAuth scopes
 * and keep an execution log; read-only connectors are separate from write/send connectors; future ERP / HR / ITSM / DCIM /
 * VDR integrations are documented only. Configuration and checks are organisation-level (platform administration);
 * project roles read the same honest list with its manual alternatives. Inbound webhooks are signed (HMAC-SHA256 over
 * `<timestamp>.<delivery id>.<raw body>`), time-boxed (±5 min) and replay-protected by the delivery id.
 */

export const IntegrationStatusSchema = z.enum(INTEGRATION_STATUSES);
const AdapterKey = z.enum(INTEGRATION_ADAPTER_KEYS as [string, ...string[]]);
const AdapterParams = z.object({ adapterKey: AdapterKey });
const T = ['Integrations'];

export const IntegrationAdapterDto = z.object({
  key: z.string(),
  kind: z.string(),
  direction: z.enum(['read', 'write', 'send']),
  availability: z.enum(['configurable', 'documented_only']),
  provider: z.string(),
  scopes: z.array(z.string()),
  check: z.enum(['outbound_endpoint', 'inbound_ping', 'none']),
  manualAlternative: z.string(),
  prerequisites: z.array(z.string()),
  status: IntegrationStatusSchema,
  enabled: z.boolean(),
  sendingAuthorized: z.boolean(),
  /** Host of the configured endpoint (no path, no secret); null when not configured. */
  endpointHost: z.string().nullable(),
  /** Whether a secret reference is set (its name and value are never returned). */
  secretConfigured: z.boolean(),
  lastCheckedAt: z.string().nullable(),
  lastCheckCode: z.string().nullable(),
  /** Failed deliveries / checks in the last 24 hours (failure monitoring). */
  failures24h: z.number().int(),
  version: z.number().int(),
});
export type IntegrationAdapterDtoT = z.infer<typeof IntegrationAdapterDto>;

export const IntegrationLogDto = z.object({
  id: z.string(),
  operation: z.string(),
  outcome: z.enum(['success', 'refused', 'failed']),
  code: z.string().nullable(),
  detail: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
});

export const WebhookDeliveryDto = z.object({
  id: z.string(),
  deliveryId: z.string(),
  eventType: z.string(),
  status: z.enum(['received', 'processed', 'ignored', 'failed']),
  attempts: z.number().int(),
  duplicateCount: z.number().int(),
  lastError: z.string().nullable(),
  receivedAt: z.string(),
  processedAt: z.string().nullable(),
});

export const integrationsRoutes = registerRoutes({
  listIntegrations: defineRoute({
    id: 'integrations.list',
    method: 'GET',
    path: '/api/v1/integrations',
    summary: 'Adapter registry with honest status, scopes, direction and manual alternatives (organisation administration)',
    tags: T,
    access: { org: 'integrations.connection.read' },
    response: z.object({ items: z.array(IntegrationAdapterDto), egressAllowlist: z.array(z.string()) }),
  }),
  listProjectIntegrations: defineRoute({
    id: 'integrations.listForProject',
    method: 'GET',
    path: '/api/v1/projects/:projectId/integrations',
    summary: 'The same honest connector list for project roles (Reports & Administration); no configuration details',
    tags: T,
    access: 'integrations.connection.read',
    params: ProjectParams,
    response: z.object({ items: z.array(IntegrationAdapterDto) }),
  }),
  configureIntegration: defineRoute({
    id: 'integrations.configure',
    method: 'POST',
    path: '/api/v1/integrations/:adapterKey/configuration',
    summary:
      'Save a connector configuration (https endpoint on the egress allowlist — never an internal address; secret REFERENCE only; scopes ⊆ declared). Status becomes Configured — not verified; never Verified.',
    tags: T,
    access: { org: 'integrations.connection.manage' },
    command: true,
    params: AdapterParams,
    body: z.object({
      expectedVersion: ExpectedVersion.optional(),
      endpointUrl: Text(500).optional(),
      secretRef: Text(100).optional(),
      scopes: z.array(Text(100)).max(10).default([]),
    }),
    response: IntegrationAdapterDto,
  }),
  testIntegration: defineRoute({
    id: 'integrations.test',
    method: 'POST',
    path: '/api/v1/integrations/:adapterKey/test',
    summary: 'Run the connectivity check now (resolved addresses re-checked, no redirects, 5 s timeout). Verified only when it succeeds.',
    tags: T,
    access: { org: 'integrations.connection.manage' },
    command: true,
    params: AdapterParams,
    body: z.object({ expectedVersion: ExpectedVersion }),
    response: IntegrationAdapterDto,
  }),
  enableIntegration: defineRoute({
    id: 'integrations.enable',
    method: 'POST',
    path: '/api/v1/integrations/:adapterKey/enable',
    summary: 'Enable a VERIFIED connector (refused otherwise)',
    tags: T,
    access: { org: 'integrations.connection.manage' },
    command: true,
    params: AdapterParams,
    body: z.object({ expectedVersion: ExpectedVersion }),
    response: IntegrationAdapterDto,
  }),
  disableIntegration: defineRoute({
    id: 'integrations.disable',
    method: 'POST',
    path: '/api/v1/integrations/:adapterKey/disable',
    summary: 'Disable a connector immediately (containment)',
    tags: T,
    access: { org: 'integrations.connection.disable' },
    command: true,
    params: AdapterParams,
    body: z.object({ expectedVersion: ExpectedVersion, reason: RequiredText(1000) }),
    response: IntegrationAdapterDto,
  }),
  integrationLogs: defineRoute({
    id: 'integrations.logs',
    method: 'GET',
    path: '/api/v1/integrations/:adapterKey/logs',
    summary: 'Execution log of a connector (newest first; fixed order)',
    tags: T,
    access: { org: 'integrations.connection.read' },
    params: AdapterParams,
    query: PageQuery.extend({ sort: NoSort }),
    response: paged(IntegrationLogDto),
  }),
  integrationDeliveries: defineRoute({
    id: 'integrations.deliveries',
    method: 'GET',
    path: '/api/v1/integrations/:adapterKey/deliveries',
    summary: 'Inbound webhook deliveries and their processing state (newest first; fixed order)',
    tags: T,
    access: { org: 'integrations.connection.read' },
    params: AdapterParams,
    query: PageQuery.extend({ sort: NoSort, status: z.enum(['received', 'processed', 'ignored', 'failed']).optional() }),
    response: paged(WebhookDeliveryDto),
  }),
  retryDelivery: defineRoute({
    id: 'integrations.retryDelivery',
    method: 'POST',
    path: '/api/v1/integrations/:adapterKey/deliveries/:deliveryRowId/retry',
    summary: 'Reconcile a FAILED delivery: queue its processing again (idempotent — processed deliveries are never re-run)',
    tags: T,
    access: { org: 'integrations.connection.manage' },
    command: true,
    params: AdapterParams.extend({ deliveryRowId: z.string().uuid() }),
    response: WebhookDeliveryDto,
  }),
  receiveWebhook: defineRoute({
    id: 'integrations.receiveWebhook',
    method: 'POST',
    path: '/api/v1/webhooks/:adapterKey',
    summary:
      'Signed inbound webhook: raw application/octet-stream JSON body {"type": "...", "data": {...}}, headers x-hub-timestamp (unix seconds), x-hub-delivery-id (8–128 [A-Za-z0-9._:-]) and x-hub-signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<delivery id>.<raw body>">. 401 for a bad / stale signature; a repeated delivery id is acknowledged and never processed twice.',
    tags: T,
    access: 'public',
    command: true,
    upload: true,
    params: AdapterParams,
    response: z.object({ status: z.enum(['accepted', 'duplicate']), deliveryId: z.string() }),
  }),
});
