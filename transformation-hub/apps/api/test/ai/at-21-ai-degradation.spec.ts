import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { aiPath, auditCount, drain, ensureFixtures, evalBody, Fixtures, fixtureUser, login, loginUserId, serviceHandles, setAi } from './ai-fixtures';
import type { ModelProvider } from '../../src/modules/ai/providers/model-provider';

let f: Fixtures;
const FILE = __filename;

beforeAll(async () => {
  f = await ensureFixtures();
});
afterAll(async () => {
  await setAi(f.dcId, {});
  await closeApp();
  await closePools();
});

/** Core project / committee / deterministic features that must keep working whatever the AI state (AT-21). */
async function coreStillWorks() {
  const pm = await login('pm');
  await pm.get(`/api/v1/projects/${f.dcId}`).expect(200);
  await pm.get(`/api/v1/projects/${f.dcId}/decisions`).expect(200);
  await pm.get(`/api/v1/projects/${f.dcId}/documents`).expect(200);
  const d = await pm.get(`${aiPath(f.dcId)}/detections`).expect(200);
  expect(d.body.items.length).toBeGreaterThan(0);
}

describe('AT-21 — AI off, over budget or provider down: project management keeps working [REQ-AI-019, REQ-AI-034, REQ-AI-033]', () => {
  it(
    'AI Off: ask refused with a pointer to deterministic features; no provider call; core features work',
    evalBody(FILE, { id: 'DEG-01', category: 'degradation', lang: 'en', provider: 'none' }, async () => {
      await setAi(f.dcId, { mode: 'off', provider: 'off' });
      const pm = await login('pm');
      const r = await pm.post(`${aiPath(f.dcId)}/ask`, { question: 'What is overdue?' });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('ai.disabled');
      const st = await pm.get(`${aiPath(f.dcId)}/status`).expect(200);
      expect(st.body.health).toBe('off');
      await coreStillWorks();
    }),
  );

  for (const lang of ['en', 'ar'] as const) {
    it(
      `${lang.toUpperCase()}: over budget → run recorded as budget_exceeded, no provider call, audited; core features work`,
      evalBody(FILE, { id: `DEG-${lang.toUpperCase()}-02`, category: 'degradation', lang, provider: 'mock-benign', ait: ['AIT-20'] }, async () => {
        await setAi(f.dcId, { monthly_token_budget: 10 });
        const since = new Date(Date.now() - 1000).toISOString();
        const pm = await login('pm');
        const r = await pm.post(`${aiPath(f.dcId)}/ask`, { question: lang === 'en' ? 'Summarise every document fifty times in maximum detail.' : 'لخّص كل وثيقة خمسين مرة وبأقصى قدر من التفصيل.', locale: lang }).expect(201);
        expect(r.body.status).toBe('budget_exceeded');
        expect(r.body.inputTokens + r.body.outputTokens).toBe(0);
        expect(r.body.output.headline).toMatch(lang === 'en' ? /budget/ : /ميزانية/);
        expect(await auditCount(f.dcId, 'AI_BUDGET_EXHAUSTED', since)).toBeGreaterThanOrEqual(1);
        expect((await pm.get(`${aiPath(f.dcId)}/status`).expect(200)).body.health).toBe('budget_exhausted');
        await coreStillWorks();
      }),
    );

    it(
      `${lang.toUpperCase()}: provider down → failures open the circuit; further runs make no provider call; briefings still carry rules-only detections`,
      evalBody(FILE, { id: `DEG-${lang.toUpperCase()}-03`, category: 'degradation', lang, provider: 'mock-down' }, async () => {
        await setAi(f.dcId, { model: 'mock-down' });
        const { registry, contexts, db, runtime } = await serviceHandles();
        const real = registry.get('mock');
        let calls = 0;
        const counting: ModelProvider = { ...real, id: 'mock', simulated: true, destination: () => null, status: (m) => real.status(m), label: () => real.label(), estimateCost: () => '0.0000', generate: (req, sig) => (calls++, real.generate(req, sig)) };
        registry.override('mock', counting);
        try {
          const pm = await login('pm');
          const q = lang === 'en' ? 'What is overdue?' : 'ما المهام المتأخرة؟';
          for (let i = 0; i < 3; i++) {
            const r = await pm.post(`${aiPath(f.dcId)}/ask`, { question: q, locale: lang }).expect(201);
            expect(r.body.status).toBe('failed');
            expect(r.body.error).toMatch(/provider_unavailable/);
          }
          expect(calls).toBe(3);
          const open = await pm.post(`${aiPath(f.dcId)}/ask`, { question: q, locale: lang }).expect(201);
          expect(open.body).toMatchObject({ status: 'failed', error: 'circuit_open' });
          expect(calls).toBe(3); // no provider call while the circuit is open
          const st = await pm.get(`${aiPath(f.dcId)}/status`).expect(200);
          expect(st.body.health).toBe('circuit_open');
          expect(st.body.circuitOpenUntil).not.toBeNull();
          // a briefing still delivers the deterministic detections
          await setAi(f.dcId, { model: 'mock-down' }); // close the circuit again for the briefing attempt
          const u = await fixtureUser(`deg-${lang}`, 'confidential', [{ role: 'contributor' }]);
          const ctx = (await contexts.forUser(u, f.dcId))!;
          ctx.locale = lang;
          const b = await db.run(ctx, () => runtime.runBriefingNow(ctx, f.dcId));
          expect(b.status).toBe('failed');
          expect(b.output!.detections.length).toBeGreaterThan(0);
          expect(b.output!.claims).toEqual([]);
          await coreStillWorks();
        } finally {
          registry.override('mock', real);
          await setAi(f.dcId, {});
        }
      }),
    );
  }

  it(
    'kill switch active → the scheduled briefing is recorded as cancelled, nothing sent; core features work',
    evalBody(FILE, { id: 'DEG-04', category: 'degradation', lang: 'en', provider: 'none', ait: ['AIT-28'] }, async () => {
      await setAi(f.dcId, {});
      const u = await fixtureUser('deg-ks', 'confidential', [{ role: 'contributor' }]);
      const c = await loginUserId(u);
      const s = await c.post(`${aiPath(f.dcId)}/briefings`, { kind: 'daily' }).expect(201);
      await setAi(f.dcId, { kill_switch: true });
      await owner().query(`update scheduled_job set next_run_at = now() - interval '1 minute' where id = $1`, [s.body.id]);
      await drain();
      const run = (await owner().query(`select status, error from ai_run where trigger_ref like $1`, [`schedule:${s.body.id}:%`])).rows[0];
      expect(run).toMatchObject({ status: 'cancelled', error: 'kill_switch' });
      expect((await owner().query(`select count(*)::int as n from notification where user_id = $1`, [u])).rows[0].n).toBe(0);
      await coreStillWorks();
      await setAi(f.dcId, {});
    }),
  );
});
