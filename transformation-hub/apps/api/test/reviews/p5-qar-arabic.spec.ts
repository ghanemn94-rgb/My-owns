import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AI_STATUS_AR } from '@hub/domain';
import { closeApp, closePools, owner } from '../helpers';
import { aiPath, CANARY, ensureFixtures, fixtureUser, loginUserId, proposalRow, serviceHandles, setAi, type Fixtures } from '../ai/ai-fixtures';

/**
 * Independent QA RE-CHECK of P5 (docs/reviews/P5-qa-recheck.md) — QA-P5-04 over the WHOLE Arabic AI output, not only the
 * claims: an Arabic project manager asks the eight reference questions in Arabic plus the conflicting-evidence question of
 * CON-AR-01, and runs two briefings. Every text the Arabic run page shows — headline, claims, missing information,
 * conflicts, warnings, refused tool calls, prepared requests — is scanned for English template titles (records that carry
 * an Arabic title) and for raw enum / entity-type values inside Arabic sentences.
 *
 * Probe convention: DEFECT = it.fails asserting the required behaviour; OBSERVED = current behaviour; CONTROL = precondition.
 */

let f: Fixtures;
const RAW_ENUMS = [...new Set(Object.values(AI_STATUS_AR).flatMap((v) => Object.keys(v)))].filter((k) => k.includes('_') || ['draft', 'blocked', 'open', 'planned', 'active', 'approved', 'failed', 'missed', 'proposed', 'submitted'].includes(k));
const ENTITY_TYPES = ['task', 'milestone', 'document', 'decision', 'action_item', 'closing_condition', 'readiness_check', 'tsa_service', 'gate_definition', 'workstream', 'partner'];
// A raw value standing as a word (not part of a record code such as "backup_recovery-restore_verified").
const tokenIn = (s: string, words: string[]) => words.filter((e) => new RegExp(`(^|[^A-Za-z0-9_-])${e}([^A-Za-z0-9_-]|$)`).test(s));

type Out = {
  headline: string;
  claims: { text: string; citations: { type: string; id: string; label?: string | null; labelAr?: string | null }[] }[];
  missing: { description: string }[];
  conflicts: { description: string }[];
  warnings: string[];
  refusedToolCalls: { name: string; reason: string }[];
  preparedRequests: { text: string }[];
  proposals: { id: string }[];
};

const runs: { label: string; out: Out }[] = [];
let titled: string[] = [];
let ar: string;

beforeAll(async () => {
  f = await ensureFixtures();
  await setAi(f.dcId, { mode: 'assisted', action_cooldown_hours: 24 });
  await owner().query(`update ai_proposal set dedupe_key = null where project_id = $1`, [f.dcId]);
  ar = await fixtureUser('p5qar-ar-pm', 'confidential', [{ role: 'project_manager' }]);
  await owner().query(`update app_user set locale = 'ar', clearance = 'confidential' where id = $1`, [ar]);
  titled = (
    await owner().query<{ t: string }>(
      `select title as t from task where project_id = $1 and title_ar is not null and title_ar <> title
       union select title from milestone where project_id = $1 and title_ar is not null and title_ar <> title
       union select title from readiness_check where project_id = $1 and title_ar is not null and title_ar <> title
       union select name from workstream where project_id = $1 and name_ar is not null and name_ar <> name
       union select name from gate_definition where project_id = $1 and name_ar is not null and name_ar <> name`,
      [f.dcId],
    )
  ).rows.map((r) => r.t);
  const c = await loginUserId(ar);
  const questions = [
    'ما المهام المتأخرة ومن يملكها؟',
    'ما القرارات التي تنتظر إجراءً؟',
    'ما عوائق البوابات؟',
    'ما شروط الإتمام المفتوحة؟',
    'ما خدمات الاتفاقية الانتقالية التي تقترب من نهايتها؟',
    'ما فحوصات الجاهزية التي تمنع التشغيل؟',
    'هل نحن جاهزون للإتمام؟',
    'ما نتيجة تقييم cooling capacity للقاعة hall B؟', // CON-AR-01 (conflicting + stale evidence)
    `ماذا تقول مذكرة ${CANARY.restricted}؟`,
  ];
  for (const q of questions) {
    const r = await c.post(`${aiPath(f.dcId)}/ask`, { question: q });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.locale).toBe('ar');
    runs.push({ label: q, out: (await c.get(`${aiPath(f.dcId)}/runs/${r.body.id}`)).body.output as Out });
  }
  // Two briefings of the same morning (the second meets the first one's pending reminder: deduplication).
  const { contexts, db, runtime } = await serviceHandles();
  const ctx = (await contexts.forUser(ar, f.dcId))!;
  for (const label of ['briefing 1', 'briefing 2']) {
    const b = await db.run(ctx, () => runtime.runBriefingNow(ctx, f.dcId, 'daily', 'scheduled'));
    runs.push({ label, out: (await c.get(`${aiPath(f.dcId)}/runs/${b.id}`)).body.output as Out });
  }
  console.log(
    `P5-QAR Arabic output: ${JSON.stringify(
      runs.map((r) => ({
        q: r.label.slice(0, 30),
        claims: r.out.claims.length,
        conflicts: r.out.conflicts.map((x) => x.description),
        refused: r.out.refusedToolCalls.map((x) => x.reason),
        missing: r.out.missing.map((x) => x.description).slice(0, 3),
        warnings: r.out.warnings.slice(0, 3),
      })),
    )}`,
  );
}, 600_000);

afterAll(async () => {
  if (f) await setAi(f.dcId, {});
  await closeApp();
  await closePools();
});

describe('QA-P5-04 re-check — the whole Arabic AI output: template titles, statuses, entity types and refusal texts [REQ-UX-001, REQ-UX-002, REQ-AI-004]', () => {
  const shown = (o: Out) => [o.headline, ...o.claims.map((x) => x.text), ...o.missing.map((x) => x.description), ...o.conflicts.map((x) => x.description), ...o.warnings, ...o.preparedRequests.map((x) => x.text)];

  it('CONTROL: the Arabic runs answered with cited claims, a conflict, warnings and a deduplicated reminder (the scan covers every block)', () => {
    expect(runs.reduce((n, r) => n + r.out.claims.length, 0)).toBeGreaterThan(20);
    expect(runs.some((r) => r.out.conflicts.length > 0)).toBe(true);
    expect(runs.some((r) => r.out.warnings.length > 0)).toBe(true);
    expect(runs.find((r) => r.label === 'briefing 1')!.out.proposals.length).toBe(1);
    expect(runs.find((r) => r.label === 'briefing 2')!.out.refusedToolCalls.length).toBe(1);
    expect(titled.length).toBeGreaterThan(50);
  });

  it('QA-P5-04: no English template title and no raw status value in the headline, claims, missing information, warnings or prepared requests of any Arabic run; template citations carry labelAr', () => {
    const englishTitles = runs.flatMap((r) => titled.filter((t) => shown(r.out).some((x) => x.includes(t))).map((t) => `${r.label}: ${t}`));
    const raw = runs.flatMap((r) => shown(r.out).flatMap((x) => tokenIn(x, RAW_ENUMS).map((e) => `${r.label}: ${e} in "${x.slice(0, 80)}"`)));
    expect(englishTitles).toEqual([]);
    expect(raw).toEqual([]);
    const missingAr = runs.flatMap((r) => r.out.claims.flatMap((x) => x.citations)).filter((ci) => ['task', 'milestone', 'readiness_check', 'gate_definition'].includes(ci.type) && ci.label && titled.some((t) => ci.label!.endsWith(t)) && !ci.labelAr);
    expect(missingAr).toEqual([]);
  });

  it('the reminder prepared by the Arabic briefing is titled in Arabic', async () => {
    const id = runs.find((r) => r.label === 'briefing 1')!.out.proposals[0]!.id;
    const p = await proposalRow(id);
    expect(p.payload.title).toMatch(/^طلب تحديث: /);
  });

  it.fails('DEFECT QA-P5R-01: the Arabic conflict note names the record type in Arabic, not the raw entity type ("… مسجّل كمتعارض بالنسبة إلى task")', () => {
    const conflicts = runs.flatMap((r) => r.out.conflicts.map((x) => x.description));
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.flatMap((x) => tokenIn(x, ENTITY_TYPES))).toEqual([]);
  });

  it.fails('DEFECT QA-P5R-02: in an Arabic run the deduplication refusal shown under "Safeguards" is Arabic (the routine second briefing of a morning shows an English sentence)', () => {
    const reasons = runs.find((r) => r.label === 'briefing 2')!.out.refusedToolCalls.map((x) => x.reason);
    expect(reasons.length).toBe(1);
    expect(reasons[0]).toMatch(/[؀-ۿ]/);
    expect(reasons[0]).not.toMatch(/the same action for the same target/);
  });

  it.fails('DEFECT QA-P5R-03: an Arabic question in the product\'s own Arabic vocabulary reaches the same records as its English counterpart ("ما عوائق البوابات؟" → gate blockers, "ما شروط الإتمام المفتوحة؟" → closing conditions)', () => {
    expect(parity.arGates).toBeGreaterThan(0);
    expect(parity.arConditions).toBeGreaterThan(0);
  });

  it('CONTROL (QA-P5R-03): the English questions cite gate blockers and closing conditions, and the singular Arabic form "البوابة" is routed to the gates', () => {
    expect(parity.enGates).toBeGreaterThan(0);
    expect(parity.enConditions).toBeGreaterThan(0);
    expect(parity.arGateSingular).toBeGreaterThan(0);
  });
});

const parity = { enGates: 0, arGates: 0, enConditions: 0, arConditions: 0, arGateSingular: 0 };
beforeAll(async () => {
  const c = await loginUserId(ar);
  const cites = async (question: string, locale: 'en' | 'ar', type: string) => {
    const r = await c.post(`${aiPath(f.dcId)}/ask`, { question, locale });
    expect(r.status).toBe(201);
    return (r.body.output.claims as { citations: { type: string }[] }[]).flatMap((x) => x.citations).filter((x) => x.type === type).length;
  };
  parity.enGates = await cites('What are the gate blockers?', 'en', 'gate_definition');
  parity.arGates = await cites('ما عوائق البوابات؟', 'ar', 'gate_definition');
  parity.enConditions = await cites('Which closing conditions are open?', 'en', 'closing_condition');
  parity.arConditions = await cites('ما شروط الإتمام المفتوحة؟', 'ar', 'closing_condition');
  parity.arGateSingular = await cites('ما عوائق البوابة؟', 'ar', 'gate_definition');
  console.log(`P5-QAR Arabic routing parity: ${JSON.stringify(parity)}`);
}, 300_000);
