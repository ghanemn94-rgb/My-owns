import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, projectIdByCode, Client, DC } from '../helpers';
import { P, createSnapshot, sar, setupFinance, sourceDocument, Personas } from '../finance/finance-kit';
import { createWithVersion, login } from '../documents/doc-helpers';

/**
 * P1 SECURITY REVIEW — finance visibility in evidence and history (docs/reviews/P1-security-allowlist-and-finance-visibility.md).
 *
 * Probes for 45cf17f (record-visibility finance rules + activity allowlist): for every finance record type and every
 * persona, the EVIDENCE LIST and the ACTIVITY HISTORY of a record must give exactly the answer of the finance module's own
 * GET — finance-domain clearance of project-wide roles only, the workstream reach of finance.record.read (tables without a
 * workstream need a project-wide grant), 404 for other projects and room-only principals, and the auditor bound by
 * clearance. A per-type feed (activity?entityType=T) never lists a record the finance lists hide, and a document's evidence
 * counters never count links to finance records the caller cannot read. These probes PASS at the reviewed revision.
 *
 * The `DEFECT SEC-P1S-04` test asserts the behaviour REQUIRED by SEC-P1R-05 (display counters count only evidence the
 * caller can read). At the reviewed revision it FAILS: the failure is the reproduction of the finding. It must not be
 * weakened to pass; it passes once the defect is fixed. All data is synthetic (the project is created by the test).
 */
let projectId: string;
let p: Personas;
let auditor: Client;
let pmB: Client;
const act = (type: string, id?: string) => `${P(projectId)}/activity?pageSize=100&entityType=${type}${id ? `&entityId=${id}` : ''}`;

interface Rec {
  label: string;
  type: string;
  id: string;
  /** Finance module GET path (relative to the project). */
  get: string;
  /** Evidence target type (benefit / financial_snapshot) — the evidence list is probed too. */
  evidence: boolean;
}
const recs: Rec[] = [];
let benSC: string;
let snapConfNoWs: string;
let documentId: string;
const noteLinks: { rec: Rec; linkId: string }[] = [];

async function created(r: { status: number; body: { id: string } }) {
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id;
}

beforeAll(async () => {
  // The sponsor (strictly_confidential clearance) also holds finance_restricted here, so it can link a strictly
  // confidential document as evidence to a confidential figure (the DEFECT SEC-P1S-04 fixture).
  ({ projectId, p } = await setupFinance('FIN-SECREV', [['sponsor', 'finance_restricted']]));
  auditor = await loginAs('auditor');
  pmB = await loginAs('pm.b');
  // techLead holds workstream_lead on the FIRST workstream of this list only (gate-test-kit).
  const wss = (await p.pm.get(`${P(projectId)}/workstreams`).expect(200)).body.items as { id: string }[];
  const [ws0, ws1] = [wss[0]!.id, wss[1]!.id];
  const f = p.finance;
  const add = (label: string, type: string, id: string, get: string, evidence = false) => recs.push({ label, type, id, get, evidence });

  // financial_snapshot (workstream column)
  for (const [label, extra] of [
    ['snapshot confidential, no workstream', { classification: 'confidential' }],
    ['snapshot confidential, ws0', { classification: 'confidential', workstreamId: ws0 }],
    ['snapshot confidential, ws1', { classification: 'confidential', workstreamId: ws1 }],
    ['snapshot restricted, no workstream', {}],
    ['snapshot strictly_confidential, ws0', { classification: 'strictly_confidential', workstreamId: ws0 }],
  ] as const) {
    const id = (await createSnapshot(f, projectId, { label: `${label} (synthetic)`, amount: sar('10'), ...extra })).id;
    add(label, 'financial_snapshot', id, `/financial-snapshots/${id}`, true);
    if (label === 'snapshot confidential, no workstream') snapConfNoWs = id;
  }
  // budget_line (workstream column)
  for (const [label, extra] of [
    ['budget line confidential, no workstream', {}],
    ['budget line confidential, ws0', { workstreamId: ws0 }],
    ['budget line confidential, ws1', { workstreamId: ws1 }],
    ['budget line strictly_confidential, ws0', { workstreamId: ws0, classification: 'strictly_confidential' }],
  ] as const) {
    const id = await created(await f.post(`${P(projectId)}/budget-lines`, { name: `${label} (synthetic)`, category: 'opex', currency: 'SAR', unitScale: 1, ...extra }));
    add(label, 'budget_line', id, `/budget-lines/${id}`);
  }
  // benefit (workstream column; evidence target; was an UNRULED evidence target before 45cf17f)
  for (const [label, extra] of [
    ['benefit confidential, ws0', { classification: 'confidential', workstreamId: ws0 }],
    ['benefit confidential, ws1', { classification: 'confidential', workstreamId: ws1 }],
    ['benefit confidential, no workstream', { classification: 'confidential' }],
    ['benefit strictly_confidential, ws0', { classification: 'strictly_confidential', workstreamId: ws0 }],
  ] as const) {
    const id = await created(await f.post(`${P(projectId)}/benefits`, { title: `${label} (synthetic)`, measurementDefinition: 'Synthetic measurement (review probe)', ...extra }));
    add(label, 'benefit', id, `/benefits/${id}`, true);
    if (label === 'benefit strictly_confidential, ws0') benSC = id;
  }
  // kpi (no workstream column; no rule before 45cf17f)
  for (const cls of ['confidential', 'strictly_confidential'] as const) {
    const id = await created(
      await f.post(`${P(projectId)}/kpis`, {
        key: `review.probe.${cls}.${Date.now().toString(36)}`,
        name: `KPI ${cls} (synthetic)`,
        definition: 'Synthetic KPI (review probe)',
        formula: 'a / b',
        unit: 'ratio',
        period: 'quarter',
        source: 'Synthetic source',
        thresholds: { green: '>= 0.8', amber: '>= 0.5', red: '< 0.5' },
        direction: 'higher_is_better',
        frequency: 'quarterly',
        classification: cls,
      }),
    );
    add(`kpi ${cls}`, 'kpi', id, `/kpis/${id}`);
  }
  // financial_model + financial_model_version (no workstream column; the model had no rule before 45cf17f)
  for (const [kind, cls] of [
    ['business_plan', 'confidential'],
    ['valuation', 'strictly_confidential'],
  ] as const) {
    const mid = await created(await f.post(`${P(projectId)}/financial-models`, { kind, name: `Model ${cls} (synthetic)`, classification: cls }));
    add(`model ${cls}`, 'financial_model', mid, `/financial-models/${mid}`);
    const vid = await created(
      await f.post(`${P(projectId)}/financial-models/${mid}/versions`, {
        modelCase: 'base',
        versionLabel: 'v1',
        headlineBasis: 'enterprise_value',
        sourceRef: 'Synthetic model run (review probe)',
        outputs: [{ key: 'headline', label: 'Headline value', amount: '500', basis: 'enterprise_value', measure: 'money', currency: 'SAR', unitScale: 1000000 }],
      }),
    );
    add(`model version ${cls}`, 'financial_model_version', vid, `/financial-models/${mid}/versions/${vid}`);
  }
  // intercompany_reconciliation (no workstream column)
  for (const cls of ['confidential', 'restricted'] as const) {
    const id = await created(await f.post(`${P(projectId)}/intercompany-reconciliations`, { counterpartyLabel: `Parent treasury ${cls} (synthetic)`, period: '2026-08', ourBalance: sar('10', 1000), sourceRef: 'Synthetic ledger extract', classification: cls }));
    add(`reconciliation ${cls}`, 'intercompany_reconciliation', id, `/intercompany-reconciliations/${id}`);
  }
  // Evidence: a note on every evidence target, and one confidential document linked to two targets.
  for (const r of recs.filter((x) => x.evidence)) noteLinks.push({ rec: r, linkId: await created(await f.post(`${P(projectId)}/evidence`, { targetType: r.type, targetId: r.id, note: `Review probe note on ${r.label} (synthetic)` })) });
  const doc = await sourceDocument('pm', projectId, 'Review probe source document (synthetic)');
  documentId = doc.documentId;
  await created(await f.post(`${P(projectId)}/evidence`, { targetType: 'benefit', targetId: benSC, documentId, documentVersionId: doc.versionId }));
  await created(await f.post(`${P(projectId)}/evidence`, { targetType: 'financial_snapshot', targetId: snapConfNoWs, documentId, documentVersionId: doc.versionId }));
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

async function views(c: Client, r: Rec) {
  const module = (await c.get(`${P(projectId)}${r.get}`)).status;
  const h = await c.get(act(r.type, r.id));
  const history = h.status === 200 ? (h.body.total as number) : -h.status;
  const evidence = r.evidence ? (await c.get(`${P(projectId)}/evidence?targetType=${r.type}&targetId=${r.id}`)).status : null;
  return { module, history, evidence };
}

describe('Security review probes — finance records in evidence and history [45cf17f]', () => {
  it('for every persona and finance record: evidence list and history visible exactly when the finance module GET is 200', async () => {
    const personas: [string, Client][] = [
      ['finance', p.finance],
      ['pm', p.pm],
      ['chair', p.chair],
      ['sponsor', p.sponsor],
      ['auditor', auditor],
      ['techLead (ws0 only)', p.techLead],
      ['contributor', p.contributor],
      ['pm.b (other project)', pmB],
    ];
    const mismatches: string[] = [];
    const visible: Record<string, string[]> = {};
    for (const [name, c] of personas) {
      visible[name] = [];
      for (const r of recs) {
        const v = await views(c, r);
        const ok = v.module === 200;
        if (ok) visible[name]!.push(r.label);
        if ((v.history > 0) !== ok) mismatches.push(`${name} / ${r.label}: module ${v.module}, history ${v.history}`);
        if (v.evidence !== null && (v.evidence === 200) !== ok) mismatches.push(`${name} / ${r.label}: module ${v.module}, evidence ${v.evidence}`);
        if (!ok && v.evidence !== null && v.evidence !== 404) mismatches.push(`${name} / ${r.label}: hidden record answered ${v.evidence} on the evidence list (expected 404)`);
      }
    }
    expect(mismatches).toEqual([]);
    // The module's own answers (so the equivalence above is not vacuous).
    const all = recs.map((r) => r.label);
    const sc = (l: string) => l.includes('strictly_confidential');
    const restricted = (l: string) => l.includes('restricted,') || l.endsWith('restricted');
    expect(visible['finance']).toEqual(all);
    expect(visible['sponsor']).toEqual(all);
    expect(visible['pm']).toEqual(all.filter((l) => !sc(l) && !restricted(l)));
    expect(visible['auditor']).toEqual(visible['pm']);
    expect(visible['chair']).toEqual(all.filter((l) => !sc(l)));
    expect(visible['techLead (ws0 only)']).toEqual(['snapshot confidential, ws0', 'budget line confidential, ws0', 'benefit confidential, ws0']);
    expect(visible['contributor']).toEqual([]);
    expect(visible['pm.b (other project)']).toEqual([]);
  }, 600_000);

  it('a per-type history feed never lists a finance record that the finance lists hide from the caller', async () => {
    const lists: Record<string, string> = {
      financial_snapshot: '/financial-snapshots?pageSize=100',
      budget_line: '/budget-lines?pageSize=100',
      benefit: '/benefits?pageSize=100',
      kpi: '/kpis?pageSize=100',
      financial_model: '/financial-models?pageSize=100',
      intercompany_reconciliation: '/intercompany-reconciliations?pageSize=100',
    };
    const leaks: string[] = [];
    for (const [name, c] of [['pm', p.pm], ['chair', p.chair], ['auditor', auditor], ['techLead', p.techLead], ['finance', p.finance]] as [string, Client][]) {
      const listed = new Map<string, Set<string>>();
      for (const [type, path] of Object.entries(lists)) {
        const b = (await c.get(`${P(projectId)}${path}`).expect(200)).body as { items: { id: string }[]; total: number };
        expect(b.total, `${name} ${type}`).toBeLessThanOrEqual(100);
        listed.set(type, new Set(b.items.map((x) => x.id)));
      }
      // versions: those of the models the caller can open
      const versions = new Set<string>();
      for (const mid of listed.get('financial_model')!) for (const v of (await c.get(`${P(projectId)}/financial-models/${mid}`).expect(200)).body.versions as { id: string }[]) versions.add(v.id);
      listed.set('financial_model_version', versions);
      for (const [type, ids] of listed) {
        const feed = await c.get(act(type));
        expect(feed.status, `${name} ${type}`).toBe(200);
        expect(feed.body.total, `${name} ${type}`).toBeLessThanOrEqual(100);
        for (const e of feed.body.items as { entityId: string }[]) if (!ids.has(e.entityId)) leaks.push(`${name}: ${type} ${e.entityId}`);
      }
    }
    expect(leaks).toEqual([]);
    // No finance type is listed at all for a member without finance.record.read, nor for another project's user.
    for (const type of [...Object.keys(lists), 'financial_model_version']) {
      expect((await p.contributor.get(act(type))).status, type).toBe(404);
      expect((await pmB.get(act(type))).status, type).toBe(404);
    }
  }, 600_000);

  it('the auditor (clearance-bound, no reach) sees evidence-link events only for finance records it can read', async () => {
    const feed = await auditor.get(`${P(projectId)}/activity?pageSize=100&entityType=evidence_link`);
    expect(feed.status).toBe(200);
    const listed = new Set((feed.body.items as { entityId: string }[]).map((e) => e.entityId));
    const wrong: string[] = [];
    for (const { rec, linkId } of noteLinks) {
      const readable = (await auditor.get(`${P(projectId)}${rec.get}`)).status === 200;
      if (listed.has(linkId) !== readable) wrong.push(`${rec.label}: listed ${listed.has(linkId)}, record readable ${readable}`);
    }
    expect(wrong).toEqual([]);
    expect(noteLinks.some(({ linkId }) => listed.has(linkId))).toBe(true);
  });

  it("a document's evidence counters count only links to finance records the caller can read", async () => {
    const count = async (c: Client) => ((await c.get(`${P(projectId)}/documents/${documentId}`).expect(200)).body.evidence as { active: number }).active;
    expect(await count(p.finance)).toBe(2); // strictly_confidential benefit + confidential snapshot
    expect(await count(p.pm)).toBe(1); // the snapshot only
    expect(await count(p.chair)).toBe(1);
    expect(await count(auditor)).toBe(1);
  });

  it('room-only principals (clean team / partner) of the demo project see no finance evidence or history', async () => {
    const dc = await projectIdByCode(DC);
    const [ben] = (await owner().query<{ id: string }>(`select id from benefit where project_id = $1 order by created_at limit 1`, [dc])).rows;
    const [line] = (await owner().query<{ id: string }>(`select id from budget_line where project_id = $1 order by created_at limit 1`, [dc])).rows;
    expect(ben, 'demo benefit').toBeTruthy();
    expect(line, 'demo budget line').toBeTruthy();
    for (const persona of ['cleanteam', 'partner.alpha']) {
      const c = await loginAs(persona);
      // really a room-only principal of the demo project (not an outsider)
      const g = await owner().query(`select 1 from room_grant where project_id = $1 and user_id = $2 and revoked_at is null`, [dc, c.userId]);
      expect(g.rowCount, persona).toBeGreaterThan(0);
      // Refused, with the same answer as for an id that does not exist (no existence oracle). The route guard answers 403
      // (missing finance.record.read) before any record is loaded; the evidence list answers 404.
      const unknown = '0192f5a0-0000-7000-8000-00000000abcd';
      const own = (await c.get(`${P(dc)}/benefits/${ben!.id}`)).status;
      expect(own, persona).not.toBe(200);
      expect(own, persona).toBe((await c.get(`${P(dc)}/benefits/${unknown}`)).status);
      const ev = (await c.get(`${P(dc)}/evidence?targetType=benefit&targetId=${ben!.id}`)).status;
      expect(ev, persona).not.toBe(200);
      expect(ev, persona).toBe((await c.get(`${P(dc)}/evidence?targetType=benefit&targetId=${unknown}`)).status);
      for (const [type, id] of [['benefit', ben!.id], ['budget_line', line!.id]] as const) {
        for (const q of [`&entityId=${id}`, '']) {
          const r = await c.get(`${P(dc)}/activity?pageSize=100&entityType=${type}${q}`);
          expect(r.status === 200 ? r.body.total : 0, `${persona} ${type}${q}`).toBe(0);
        }
      }
    }
  });

  it('SEC-P1S-04 (fixed, regression): the evidence counter of a figure / benefit detail counts only evidence the caller can read (SEC-P1R-05)', async () => {
    const sponsorDocs = await login('sponsor');
    const hidden = await createWithVersion(sponsorDocs, projectId, { title: 'Strictly confidential working paper (synthetic)', classification: 'strictly_confidential' }, { bytes: Buffer.from('synthetic,1\n', 'utf8'), name: 'working-paper.csv' });
    expect(hidden.upload.status, JSON.stringify(hidden.upload.body)).toBe(201);
    const benConfWs0 = recs.find((r) => r.label === 'benefit confidential, ws0')!.id;
    await created(await p.sponsor.post(`${P(projectId)}/evidence`, { targetType: 'financial_snapshot', targetId: snapConfNoWs, documentId: hidden.id }));
    await created(await p.sponsor.post(`${P(projectId)}/evidence`, { targetType: 'benefit', targetId: benConfWs0, documentId: hidden.id }));
    const seen: Record<string, unknown> = {};
    for (const [label, path, target, id] of [
      ['snapshot', `/financial-snapshots/${snapConfNoWs}`, 'financial_snapshot', snapConfNoWs],
      ['benefit', `/benefits/${benConfWs0}`, 'benefit', benConfWs0],
    ] as const) {
      const detail = (await p.pm.get(`${P(projectId)}${path}`).expect(200)).body.evidence as { active: number };
      const list = (await p.pm.get(`${P(projectId)}/evidence?targetType=${target}&targetId=${id}`).expect(200)).body as { items: { status: string }[]; total: number };
      seen[label] = { detailCounterActive: detail.active, evidenceListActive: list.items.filter((x) => x.status === 'active').length };
    }
    // Required: the PM (confidential) does not learn that strictly confidential evidence exists on these records.
    expect(seen).toEqual({ snapshot: { detailCounterActive: 2, evidenceListActive: 2 }, benefit: { detailCounterActive: 1, evidenceListActive: 1 } });
  });
});
