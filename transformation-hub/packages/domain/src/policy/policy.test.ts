import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POLICY_MATRIX, permissionsOf, evaluateConditions, clearanceAllows, NO_HUMAN_REQUESTER, isProjectLevelRead, PROJECT_LEVEL_READ_PERMISSIONS } from './index';
import { ROLE_KEYS } from '../enums';

const accessMatrixDoc = () => readFileSync(join(__dirname, '../../../../docs/security/access-matrix.md'), 'utf8');

describe('access-matrix §2.2.1 — project-level read exception for workstream-scoped grants (P2 security review §3, option B)', () => {
  it('only the four reviewed read permissions carry the flag (any change is a policy decision)', () => {
    expect(PROJECT_LEVEL_READ_PERMISSIONS).toEqual(['documents.document.download', 'documents.document.read', 'gates.gate.read', 'portfolio.project.read']);
  });

  it('only read / download permissions carry it, and none of finance, governance, JV or AI', () => {
    for (const [key, p] of Object.entries(POLICY_MATRIX.permissions)) {
      if (!('projectLevelRead' in p)) continue;
      expect(p.projectLevelRead, `${key}: the flag is present only when true`).toBe(true);
      expect(key, `${key} is not a read`).toMatch(/\.(read|download)$/);
      expect(key, `${key} is in an excluded module`).not.toMatch(/^(finance|governance|jv|ai)\./);
      // A read never carries a subject / ownership condition: nothing but the visibility conditions may apply.
      expect(p.conditions.filter((c) => !['classification', 'room', 'clean_team'].includes(c)), key).toEqual([]);
    }
  });

  it('isProjectLevelRead fails closed for unknown and unflagged permissions', () => {
    expect(isProjectLevelRead('gates.gate.read')).toBe(true);
    expect(isProjectLevelRead('finance.record.read')).toBe(false);
    expect(isProjectLevelRead('governance.decision.read')).toBe(false);
    expect(isProjectLevelRead('planning.plan.read')).toBe(false);
    expect(isProjectLevelRead('documents.document.upload')).toBe(false);
    expect(isProjectLevelRead('no.such.permission')).toBe(false);
  });

  it('the machine-readable list in access-matrix §2.2.1 equals the flagged permissions', () => {
    const doc = accessMatrixDoc();
    const blocks = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]!) as Record<string, unknown>);
    const list = blocks.find((b) => Array.isArray(b['projectLevelRead']));
    expect(list, 'access-matrix §2.2.1 JSON block').toBeDefined();
    expect([...(list!['projectLevelRead'] as string[])].sort()).toEqual([...PROJECT_LEVEL_READ_PERMISSIONS]);
    expect(list!['status']).toBe('pending confirmation by Mobily data governance');
  });
});

describe('policy matrix', () => {
  it('matches the JSON block in docs/security/access-matrix.md (no drift)', () => {
    const doc = accessMatrixDoc();
    const blocks = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]!));
    const fromDoc = blocks.find((b) => b.permissions && b.roles);
    expect(fromDoc).toEqual(POLICY_MATRIX);
  });

  it('defines every role and only known permissions', () => {
    expect(Object.keys(POLICY_MATRIX.roles).sort()).toEqual([...ROLE_KEYS].sort());
    for (const r of Object.values(POLICY_MATRIX.roles)) for (const p of r.permissions) expect(POLICY_MATRIX.permissions[p]).toBeDefined();
  });

  it('platform_admin has no transaction-content permissions (spec §15)', () => {
    const perms = [...permissionsOf(POLICY_MATRIX, ['platform_admin'])];
    const content = perms.filter((p) => /^(documents|governance|jv|finance|carveout|newco|gates|planning|readiness)\./.test(p));
    expect(content).toEqual([]);
  });

  it('auditor is read-only', () => {
    const perms = [...permissionsOf(POLICY_MATRIX, ['auditor'])];
    const writes = perms.filter((p) => !/\.(read|read_external|view|export|verify|download)$|\.event\.|chain\.verify|bi_view|dashboard\.read|plan\.read|inbox\.read|preferences\.manage_own|disclosure_log\.read|operations\.read|run\.read|register\.read|gate\.read|deal\.read|record\.read|snapshot\.read|proposal\.read/.test(p));
    expect(writes).toEqual([]);
  });

  it('external partner cannot read internal registers', () => {
    const perms = permissionsOf(POLICY_MATRIX, ['external_partner_limited']);
    for (const p of ['planning.plan.read', 'governance.decision.read', 'finance.record.read', 'documents.document.read']) expect(perms.has(p)).toBe(false);
  });

  it('ABAC: classification, rooms, clean team, not_self, own_workstream fail closed', () => {
    expect(clearanceAllows('confidential', 'restricted')).toBe(false);
    expect(evaluateConditions(['classification'], { clearance: 'internal', classification: 'confidential' }).allowed).toBe(false);
    expect(evaluateConditions(['room'], { clearance: 'restricted', roomId: 'r1', userRoomIds: new Set() }).allowed).toBe(false);
    expect(evaluateConditions(['room'], { clearance: 'restricted', roomId: 'r1', userRoomIds: new Set(['r1']) }).allowed).toBe(true);
    expect(evaluateConditions(['clean_team'], { clearance: 'restricted', roomId: 'r1', roomIsCleanTeam: true, userCleanTeamRoomIds: new Set() }).allowed).toBe(false);
    expect(evaluateConditions(['not_self'], { clearance: 'internal', actorUserId: 'u', subjectRequesterId: 'u' }).allowed).toBe(false);
    expect(evaluateConditions(['own_workstream'], { clearance: 'internal', workstreamId: 'w2', userWorkstreamIds: new Set(['w1']) }).allowed).toBe(false);
  });
});

describe('I-R3: separation of duties and authority fail CLOSED when their inputs are missing', () => {
  const base = { clearance: 'strictly_confidential' as const, actorUserId: 'actor' };

  it('not_self: missing (undefined / null / empty) requester -> denied and reported as missing', () => {
    for (const subjectRequesterId of [undefined, null, '']) {
      const r = evaluateConditions(['not_self'], { ...base, subjectRequesterId });
      expect(r.allowed, String(subjectRequesterId)).toBe(false);
      expect(r.missing).toEqual(['not_self']);
    }
  });
  it('not_self: missing actor -> denied (a principal without a user id never passes separation of duties)', () => {
    const r = evaluateConditions(['not_self'], { clearance: 'internal', actorUserId: null, subjectRequesterId: 'requester' });
    expect(r).toEqual({ allowed: false, failed: ['not_self'], missing: ['not_self'] });
  });
  it('not_self: the requester themself -> denied (not "missing"); someone else -> allowed', () => {
    expect(evaluateConditions(['not_self'], { ...base, subjectRequesterId: 'actor' })).toEqual({ allowed: false, failed: ['not_self'], missing: [] });
    expect(evaluateConditions(['not_self'], { ...base, subjectRequesterId: 'requester' })).toEqual({ allowed: true, failed: [], missing: [] });
  });
  it('not_self: an explicit NO_HUMAN_REQUESTER (system-raised subject / no evidence owner) passes; it is never inferred from null -> allowed', () => {
    expect(evaluateConditions(['not_self'], { ...base, subjectRequesterId: NO_HUMAN_REQUESTER }).allowed).toBe(true);
  });
  it('authority: undefined -> denied and reported as missing; false -> denied; true -> allowed', () => {
    expect(evaluateConditions(['authority'], { ...base })).toEqual({ allowed: false, failed: ['authority'], missing: ['authority'] });
    expect(evaluateConditions(['authority'], { ...base, withinAuthority: false })).toEqual({ allowed: false, failed: ['authority'], missing: [] });
    expect(evaluateConditions(['authority'], { ...base, withinAuthority: true })).toEqual({ allowed: true, failed: [], missing: [] });
  });
  it('own_workstream: no ownership input -> denied (unchanged fail-closed rule)', () => {
    expect(evaluateConditions(['own_workstream'], { ...base }).allowed).toBe(false);
    expect(evaluateConditions(['own_workstream'], { ...base, ownWorkstreamSatisfied: true }).allowed).toBe(true);
  });
  it('classification / room / clean_team restrict only a resource that HAS a classification / room', () => {
    expect(evaluateConditions(['classification', 'room', 'clean_team'], { clearance: 'public' }).allowed).toBe(true);
    expect(evaluateConditions(['classification'], { clearance: 'public', classification: 'internal' }).allowed).toBe(false);
    expect(evaluateConditions(['room'], { clearance: 'public', roomId: 'r1' }).allowed).toBe(false); // no userRoomIds -> denied
    expect(evaluateConditions(['clean_team'], { clearance: 'public', roomId: 'r1', roomIsCleanTeam: true }).allowed).toBe(false);
  });
  it('every permission of the matrix with not_self or authority is denied when those inputs are omitted', () => {
    const guarded = Object.entries(POLICY_MATRIX.permissions).filter(([, p]) => p.conditions.includes('not_self') || p.conditions.includes('authority'));
    expect(guarded.length).toBeGreaterThanOrEqual(50);
    for (const [key, p] of guarded) {
      const r = evaluateConditions(p.conditions, { ...base, ownWorkstreamSatisfied: true });
      expect(r.allowed, key).toBe(false);
      expect(r.missing.length, key).toBeGreaterThan(0);
      // ...and allowed once every input is supplied (someone else's request, within authority)
      const ok = evaluateConditions(p.conditions, { ...base, ownWorkstreamSatisfied: true, subjectRequesterId: 'requester', withinAuthority: true });
      expect(ok.allowed, key).toBe(true);
    }
  });
});
