import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ROUTES, type RouteDef } from './index';

/**
 * REQ-DAT-013 — status changes are domain commands; a generic update (PATCH, and PUT) can never carry a status.
 * Registry-wide: every PATCH / PUT route of every module, now and in the future, is checked.
 *  1. No declared body field is status-like (status, state, stage, disposition, outcome, *Status, *State, …, approval /
 *     verification markers).
 *  2. The body schema is strict: an unknown field — a status field in particular — is REFUSED (400 validation_failed at
 *     the API), never silently stripped.
 */

/** Field names that carry a lifecycle status or an approval / verification decision. */
const STATUS_LIKE = /^(status|state|stage|disposition|outcome|decision|verdict)$|(Status|State|Stage|Disposition|Outcome)$|^(approved|verified|confirmed|accepted|rejected|waived|signed)(By|At|Amount)?$|(ApprovedBy|ApprovedAt|VerifiedBy|VerifiedAt|ReviewedBy|ReviewedAt|ConfirmedBy|ConfirmedAt)$/;

/** Probes sent in a body (each must be refused by every generic update). */
const PROBES = ['status', 'state', 'stage', 'disposition', 'outcome', 'screeningStatus', 'verificationStatus', 'transferStatus', 'approvalState', 'approvedBy', 'verifiedAt'];

const generic = (): RouteDef[] => Object.values(ROUTES).filter((r) => r.method === 'PATCH' || r.method === 'PUT');

/** The object schema behind a body (bodies are plain objects, possibly with refinements attached). */
function shapeKeys(schema: z.ZodTypeAny): string[] {
  const def = (schema as unknown as { _zod: { def: { type: string; shape?: Record<string, unknown> } } })._zod.def;
  expect(def.type).toBe('object');
  return Object.keys(def.shape ?? {});
}

describe('REQ-DAT-013 — no generic update (PATCH / PUT) can carry a status, on every resource', () => {
  it('the registry has the generic update routes of every module (sanity: the check below is not vacuous)', () => {
    const routes = generic();
    expect(routes.length).toBeGreaterThanOrEqual(35);
    const modules = new Set(routes.map((r) => r.id.split('.')[0]));
    for (const m of ['portfolio', 'documents', 'governance', 'planning', 'gates', 'carveout', 'newco', 'readiness', 'finance', 'jv']) expect(modules.has(m), m).toBe(true);
  });

  it('the status-like pattern recognises the status fields of the commands (the pattern is not too narrow)', () => {
    for (const k of ['status', 'screeningStatus', 'verificationStatus', 'transferStatus', 'disposition', 'stage', 'outcome', 'approvalState', 'approvedBy', 'approvedAmount', 'verifiedAt', 'decision']) expect(STATUS_LIKE.test(k), k).toBe(true);
    for (const k of ['title', 'description', 'ragReported', 'requiresApproval', 'requiredApproval', 'verificationSource', 'testResult', 'expectedVersion', 'dueDate']) expect(STATUS_LIKE.test(k), k).toBe(false);
  });

  it('no PATCH / PUT body declares a status-like field', () => {
    const offenders: string[] = [];
    for (const r of generic()) for (const k of shapeKeys(r.body)) if (STATUS_LIKE.test(k)) offenders.push(`${r.id}.${k}`);
    expect(offenders).toEqual([]);
  });

  it('every PATCH / PUT body refuses a status field (strict schema: unrecognized key), never strips it', () => {
    const accepted: string[] = [];
    for (const r of generic()) {
      for (const probe of PROBES) {
        const res = r.body.safeParse({ expectedVersion: 1, [probe]: 'approved' });
        const refused = !res.success && res.error.issues.some((i) => i.code === 'unrecognized_keys' && (i as { keys?: string[] }).keys?.includes(probe));
        if (!refused) accepted.push(`${r.id} ← ${probe}`);
      }
    }
    expect(accepted).toEqual([]);
  });

  it('generic updates are never declared as commands, and status changes of assumptions are a command now', () => {
    for (const r of generic()) expect(r.command, r.id).not.toBe(true);
    const cmd = ROUTES['planning.setAssumptionVerification']!;
    expect(cmd).toMatchObject({ method: 'POST', command: true, access: 'planning.raid.manage' });
    expect(cmd.body.safeParse({ expectedVersion: 1, verificationStatus: 'confirmed' }).success).toBe(false); // reason required
    expect(cmd.body.safeParse({ expectedVersion: 1, verificationStatus: 'confirmed', reason: 'Validated with the owner (synthetic)' }).success).toBe(true);
  });
});
