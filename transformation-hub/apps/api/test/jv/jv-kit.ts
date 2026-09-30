import { expect } from 'vitest';
import { demoEmail } from '../../src/cli/seed-demo';
import { owner } from '../helpers';
import { createWithVersion, getBinary, login, DocClient } from '../documents/doc-helpers';
import { setupGovernance, setupProject, gateDecision, Gov, Personas } from '../gates/gate-test-kit';
import { localDate, addCalendarDays } from '@hub/domain';

/**
 * Test kit for the JV module. Each spec creates its OWN DC project through the portfolio API (gate-test-kit), with the
 * usual persona roles and a real governance set-up (active committee, approved DEMO authority matrix). All JV data is
 * created through the JV API. The owner pool is used only to create synthetic EXTERNAL / clean-team accounts (there is
 * no user-provisioning API for them yet — identity module) and for assertions.
 */
export { getBinary, gateDecision };
export type { DocClient, Gov };

export const P = (pid: string) => `/api/v1/projects/${pid}`;
export const today = () => localDate(new Date(), 'Asia/Riyadh');
export const plusDays = (n: number) => addCalendarDays(today(), n);

export interface JvPersonas {
  pm: DocClient;
  sponsor: DocClient;
  legal: DocClient;
  finance: DocClient;
  approver: DocClient;
  contributor: DocClient;
  chair: DocClient;
  secretary: DocClient;
}

export interface JvProject {
  projectId: string;
  orgId: string;
  /** Personas able to upload (documents API) — same users as `gp`. */
  p: JvPersonas;
  /** The gate-test-kit personas (for governance helpers). */
  gp: Personas;
  gov: Gov;
}

export async function setupJvProject(code: string): Promise<JvProject> {
  const { projectId, orgId, p: gp } = await setupProject(code);
  const gov = await setupGovernance(projectId, gp);
  const p = {} as JvPersonas;
  for (const k of ['pm', 'sponsor', 'legal', 'finance', 'approver', 'contributor', 'chair', 'secretary'] as const) p[k] = await login(k);
  return { projectId, orgId, p, gp, gov };
}

/**
 * A synthetic demo account created with the owner pool (no provisioning API exists for external / clean-team users).
 * External accounts are cleared to `confidential` here (the external_partner_limited role default).
 */
export async function syntheticUser(orgId: string, key: string, accountType: 'internal' | 'external', clearance = 'confidential'): Promise<DocClient> {
  await owner().query(
    `insert into app_user (id, org_id, email, display_name, title, clearance, is_demo, locale, account_type)
     values (gen_random_uuid(), $1, $2, $3, 'Synthetic test persona', $4, true, 'en', $5)
     on conflict (org_id, email) do nothing`,
    [orgId, demoEmail(key), `Test ${key} (synthetic)`, clearance, accountType],
  );
  return login(key);
}

export async function ok(r: { status: number; body: unknown }, status = 201) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body as Record<string, any>;
}

export async function partner(c: DocClient, pid: string, id: string) {
  return (await c.get(`${P(pid)}/partners/${id}`).expect(200)).body;
}

/** Upload a small synthetic text document (optionally into a room) through the documents API. */
export async function doc(c: DocClient, pid: string, title: string, opts: { roomId?: string; classification?: string; kind?: string; text?: string } = {}) {
  const r = await createWithVersion(
    c,
    pid,
    { title, kind: opts.kind ?? 'dd_material', classification: opts.classification ?? 'confidential', roomId: opts.roomId },
    { bytes: Buffer.from(opts.text ?? `Synthetic test content: ${title}`), name: `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt` },
  );
  expect(r.upload.status, JSON.stringify(r.upload.body)).toBe(201);
  return { id: r.id, versionId: r.upload.body.versionId as string };
}

/** Create a partner and take it through outreach approval → NDA recorded → (optionally) materials access. */
export async function partnerAt(j: JvProject, name: string, stage: 'identified' | 'approved_for_contact' | 'nda' | 'materials_access' = 'materials_access') {
  const { p, projectId: pid } = j;
  const created = await ok(await p.pm.post(`${P(pid)}/partners`, { name, classification: 'confidential' }));
  const id = created.id as string;
  if (stage === 'identified') return id;
  let v = (await partner(p.pm, pid, id)).version;
  v = (await ok(await p.pm.post(`${P(pid)}/partners/${id}/outreach-request`, { expectedVersion: v, note: 'Test outreach request (synthetic)' }))).version;
  v = (await ok(await p.sponsor.post(`${P(pid)}/partners/${id}/outreach-approval`, { expectedVersion: v, outcome: 'approve' }))).version;
  if (stage === 'approved_for_contact') return id;
  const nda = await doc(p.pm, pid, `NDA executed copy ${name}`, { kind: 'agreement' });
  v = (await ok(await p.pm.post(`${P(pid)}/partners/${id}/nda`, { expectedVersion: v, documentId: nda.id, executedOn: today() }))).version;
  v = (await ok(await p.legal.post(`${P(pid)}/partners/${id}/nda/record`, { expectedVersion: v, outcome: 'record' }))).version;
  if (stage === 'nda') return id;
  await ok(await p.pm.post(`${P(pid)}/partners/${id}/advance`, { expectedVersion: v, toStage: 'materials_access' }));
  return id;
}

export async function room(c: DocClient, pid: string, body: Record<string, unknown>) {
  return ok(await c.post(`${P(pid)}/partner-rooms`, { classification: 'confidential', ...body }));
}

export async function grant(c: DocClient, pid: string, roomId: string, body: Record<string, unknown>) {
  return c.post(`${P(pid)}/partner-rooms/${roomId}/access-grants`, { reason: 'Test grant (synthetic)', ...body });
}

export const in30 = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

/** A FINAL approved governance decision of the given type (reserved matters get the external approval recorded). */
export async function finalDecision(j: JvProject, decisionTypeKey: string) {
  const d = await gateDecision(j.projectId, j.gp, j.gov, 'G6', { decisionTypeKey, externalApproval: true });
  expect(d.status).toBe('approved');
  return d.id;
}

export async function auditRows(projectId: string, action: string, entityId: string) {
  return (await owner().query<{ outcome: string; reason: string | null; actor_user_id: string | null }>(`select outcome, reason, actor_user_id from audit_event where project_id = $1 and action = $2 and entity_id = $3 order by seq`, [projectId, action, entityId])).rows;
}
