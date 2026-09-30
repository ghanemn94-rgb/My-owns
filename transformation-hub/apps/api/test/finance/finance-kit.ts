import { expect } from 'vitest';
import { Client, getApp, owner } from '../helpers';
import { setupGovernance, setupProject, Gov, Personas } from '../gates/gate-test-kit';
import { decisionVersion, plusDays, tabledDecision, today, vote, Actors } from '../governance/gov-fixtures';
import { login, docsPath } from '../documents/doc-helpers';
import { JobContextFactory } from '../../src/platform/jobs/job-context';
import { DbService } from '../../src/platform/db.service';
import type { RequestContext } from '../../src/platform/context';

/**
 * Test kit for the finance module. Each spec creates its OWN DC project through the portfolio API (gate-test-kit) and,
 * for separation of duties, grants `finance_restricted` to two more personas in that project:
 *   finance  — finance_restricted + functional_approver (the usual demo persona): prepares figures;
 *   approver — functional_approver + finance_restricted: validates;
 *   legal    — legal_restricted + functional_approver + finance_restricted: approves (a third person).
 * Governance decisions go through the governance API (DEMO matrix); documents through the documents API; the TSA through
 * the readiness API. The owner pool is used only for assertions and for bypass attempts the API refuses.
 */
export { setupGovernance, plusDays, today };
export type { Personas, Gov };

export const P = (pid: string) => `/api/v1/projects/${pid}`;
export type Money = { amount: string; currency: string; unitScale: 1 | 1000 | 1000000 };
export const sar = (amount: string, unitScale: 1 | 1000 | 1000000 = 1): Money => ({ amount, currency: 'SAR', unitScale });
export const usd = (amount: string, unitScale: 1 | 1000 | 1000000 = 1): Money => ({ amount, currency: 'USD', unitScale });
export const RATE = { from: 'USD', to: 'SAR', rate: '3.75', source: 'Test rate table (synthetic, not a real rate)', asOf: '2026-09-01' };

export async function setupFinance(code: string, extra: [string, string][] = []) {
  return setupProject(code, [['approver', 'finance_restricted'], ['legal', 'finance_restricted'], ...extra]);
}

export async function orgOf(projectId: string): Promise<string> {
  return (await owner().query<{ org_id: string }>('select org_id from project where id = $1', [projectId])).rows[0]!.org_id;
}

export async function workstreamId(c: Client, projectId: string, code: string): Promise<string> {
  const items = (await c.get(`${P(projectId)}/workstreams`).expect(200)).body.items as { id: string; code: string }[];
  const w = items.find((x) => x.code === code);
  if (!w) throw new Error(`workstream ${code} not found`);
  return w.id;
}

let seq = 0;
export const lineRef = (prefix = 'L') => `${prefix}-${Date.now().toString(36)}-${++seq}`;

/** Manual-entry figure through the API; returns id + version. */
export async function createSnapshot(c: Client, projectId: string, body: Record<string, unknown>) {
  const r = await c.post(`${P(projectId)}/financial-snapshots`, {
    kind: 'actual',
    category: 'one_off_separation',
    lineRef: lineRef(),
    label: 'Test figure (synthetic)',
    period: '2026-Q3',
    amount: sar('1000'),
    sourceRef: 'Synthetic test source reference',
    ...body,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.id as string, version: r.body.version as number };
}

export async function snapshot(c: Client, projectId: string, id: string) {
  return (await c.get(`${P(projectId)}/financial-snapshots/${id}`).expect(200)).body;
}

/** A TSA service (readiness API) with an optional synthetic charge. */
export async function createTsa(pm: Client, projectId: string, name: string, charge: Money | null) {
  const r = await pm.post(`${P(projectId)}/tsa-services`, { name, ...(charge ? { charge, chargeBasis: 'Synthetic fixed fee (test)' } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

/** A source document (the "original model") with one uploaded version, through the documents API. */
export async function sourceDocument(persona: string, projectId: string, title = 'Synthetic business plan workbook (test)') {
  const c = await login(persona);
  const created = await c.post(docsPath(projectId), { kind: 'financial_model', title, classification: 'confidential' });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const up = await c.upload(`${docsPath(projectId)}/${created.body.id}/versions`, Buffer.from('line,amount\nL1,1000\n', 'utf8'), 'model-outputs.csv');
  expect(up.status, JSON.stringify(up.body)).toBe(201);
  return { documentId: created.body.id as string, versionId: up.body.versionId as string };
}

/**
 * Governance decision of a DEMO-matrix type through the real governance API: tabled → votes → outcome. Within the
 * committee mandate it ends `approved`; for a reserved matter it ends `recommended` unless `externalApproval`, in which
 * case a second secretariat member records the (synthetic) approval of the authorized body.
 */
export async function decisionOfType(
  projectId: string,
  p: Personas,
  gov: Gov,
  decisionTypeKey: string,
  opts: { vote?: boolean; externalApproval?: boolean; amount?: Money | null } = {},
): Promise<{ id: string; code: string; status: string }> {
  const a = p as unknown as Actors;
  const over: Record<string, unknown> = { decisionTypeKey, requiredAuthority: 'Per the DEMO authority matrix (synthetic)' };
  if (opts.amount !== undefined) over['amount'] = opts.amount;
  const d = await tabledDecision(projectId, a, p.pm, gov.committeeId, gov.meetingId, over);
  if (opts.vote === false) return { id: d.id, code: d.code, status: 'under_review' };
  const v = await decisionVersion(p.chair, projectId, d.id);
  for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) {
    const r = await vote(projectId, p[k], d.id, 'approve', v);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
  const out = await p.secretary.post(`${P(projectId)}/decisions/${d.id}/record-outcome`, { expectedVersion: v });
  expect(out.status, JSON.stringify(out.body)).toBe(201);
  let status = out.body.status as string;
  if (opts.externalApproval && status === 'recommended') {
    const ev = await decisionVersion(p.chair, projectId, d.id);
    const ext = await gov.secretary2.post(`${P(projectId)}/decisions/${d.id}/record-external-approval`, {
      expectedVersion: ev,
      outcome: 'approved',
      externalReference: 'DEMO-BOARD-RESOLUTION (synthetic)',
      note: 'Synthetic external decision (test)',
    });
    expect(ext.status, JSON.stringify(ext.body)).toBe(201);
    status = ext.body.status;
  }
  return { id: d.id, code: d.code, status };
}

/** Audit rows written for a (rejected / denied) request by the problem filter or the service. */
export async function auditRows(projectId: string, action: string, outcome: 'success' | 'rejected' | 'denied', actorUserId?: string) {
  const r = await owner().query<{ reason: string | null }>(
    `select reason from audit_event where project_id = $1 and action = $2 and outcome = $3 ${actorUserId ? 'and actor_user_id = $4' : ''} order by created_at`,
    actorUserId ? [projectId, action, outcome, actorUserId] : [projectId, action, outcome],
  );
  return r.rows;
}

/** Runs `fn` as a SERVICE principal (worker / AI runtime identity) holding exactly `permissions` — for negative tests. */
export async function asService<T>(projectId: string, permissions: string[], fn: (ctx: RequestContext) => Promise<T>): Promise<T> {
  const app = await getApp();
  const ctx = app.get(JobContextFactory).forService({ id: 'test-job', org_id: await orgOf(projectId), project_id: projectId }, 'svc-ai-pm', permissions);
  return app.get(DbService).run(ctx, () => fn(ctx));
}
