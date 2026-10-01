import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiToolByName } from '@hub/domain';
import { closeApp, closePools, owner } from '../helpers';
import { AiSettingsService } from '../../src/modules/ai/ai-settings.service';
import { aiPath, demoUserId, drain, ensureFixtures, fixtureUser, loginUserId, serviceHandles, setAi, type Fixtures } from '../ai/ai-fixtures';

/**
 * Independent QA RE-CHECK of P5 (docs/reviews/P5-qa-recheck.md) — do the earlier assertions CHANGED by the P5 QA fixes still
 * test the criterion they were written for? Two measurements:
 *
 *  1. AT-19 REV-EN-03 (a) "lowered within the project's classification: the briefing runs without the higher content" lowers
 *     a contributor from strictly_confidential to confidential and asserts that no evidence item is restricted or above.
 *     Measured here: does a contributor's briefing contain ANY item above confidential when the contributor is NOT lowered?
 *     If not, part (a) cannot fail whatever clearance the worker uses (it does not discriminate).
 *  2. SEC-P5-01 in p5-sec-ai.spec.ts: its recipient is an internal-cleared member of a confidential project. Measured here:
 *     is such a recipient refused even when the run had NO content at all? If so, that probe now passes on the project-level
 *     refusal (QA-P5-03) and no longer isolates the content check (which p5-sec-fixes.spec.ts was re-addressed to cover).
 *
 * OBSERVED tests record the measurement; they are evidence for the report, not defects of the product.
 */

let f: Fixtures;

beforeAll(async () => {
  f = await ensureFixtures();
}, 300_000);

afterAll(async () => {
  if (f) await setAi(f.dcId, {});
  await closeApp();
  await closePools();
});

const RANK: Record<string, number> = { public: 0, internal: 1, confidential: 2, restricted: 3, strictly_confidential: 4 };

describe('Changed assertion AT-19 REV-EN-03 (a) — discriminating power', () => {
  let items: { type: string; classification: string }[] = [];
  let sponsorItems: { type: string; classification: string }[] = [];

  beforeAll(async () => {
    await setAi(f.dcId, {});
    // The same kind of subscriber as REV-EN-03 (a contributor cleared strictly_confidential), NOT lowered, scheduled briefing.
    const u = await fixtureUser('p5qar-rev03-ctl', 'strictly_confidential', [{ role: 'contributor' }]);
    await owner().query(`update app_user set clearance = 'strictly_confidential' where id = $1`, [u]);
    const c = await loginUserId(u);
    const s = await c.post(`${aiPath(f.dcId)}/briefings`, { kind: 'daily' });
    expect(s.status).toBe(201);
    await owner().query(`update scheduled_job set next_run_at = now() - interval '1 minute' where id = $1`, [s.body.id]);
    await drain();
    const r = (await owner().query(`select status, evidence_snapshot from ai_run where trigger_ref like $1`, [`schedule:${s.body.id}:%`])).rows[0];
    expect(r.status).toBe('succeeded');
    items = r.evidence_snapshot.items;
    // For comparison: the sponsor's briefing (strictly_confidential, every read permission).
    const sponsor = await demoUserId('sponsor');
    const { contexts, db, runtime } = await serviceHandles();
    const ctx = (await contexts.forUser(sponsor, f.dcId))!;
    const b = await db.run(ctx, () => runtime.runBriefingNow(ctx, f.dcId));
    sponsorItems = (await owner().query(`select evidence_snapshot from ai_run where id = $1`, [b.id])).rows[0].evidence_snapshot.items;
    const hist = (xs: { type: string; classification: string }[]) => xs.reduce<Record<string, number>>((m, i) => ((m[`${i.type}/${i.classification}`] = (m[`${i.type}/${i.classification}`] ?? 0) + 1), m), {});
    console.log(`P5-QAR REV-EN-03 (a) measurement: contributor items ${JSON.stringify(hist(items))}; sponsor items ${JSON.stringify(hist(sponsorItems))}`);
  }, 300_000);

  it('OBSERVED: a strictly_confidential contributor\'s briefing (not lowered) contains no evidence item above confidential — REV-EN-03 (a) cannot fail whatever clearance the worker applies; only part (b) (below the project → skipped) discriminates', () => {
    expect(items.length).toBeGreaterThan(0);
    expect(items.filter((i) => RANK[i.classification]! > RANK.confidential!)).toEqual([]);
  });
});

describe('Changed CONTROL p5-sec-ai SEC-P5-01 — does the internal-cleared recipient still isolate the CONTENT check?', () => {
  const r = {} as Record<string, unknown>;

  beforeAll(async () => {
    await setAi(f.dcId, { mode: 'assisted' });
    const low = await fixtureUser('p5qar-sec01-low', 'internal', [{ role: 'contributor' }]);
    const conf = await fixtureUser('p5qar-sec01-conf', 'confidential', [{ role: 'contributor' }]);
    await owner().query(`update app_user set clearance = 'internal' where id = $1`, [low]);
    await owner().query(`update app_user set clearance = 'confidential' where id = $1`, [conf]);
    const pmId = await demoUserId('pm');
    const pm = await loginUserId(pmId);
    const run = await pm.post(`${aiPath(f.dcId)}/ask`, { question: 'P5QARNOCONTENT', locale: 'en' });
    const { contexts, db, proposals, app } = await serviceHandles();
    const ctx = (await contexts.forUser(pmId, f.dcId))!;
    const s = await db.run(ctx, () => app.get(AiSettingsService).load(f.dcId));
    // An EMPTY input set (run.inputs = []): the message carries no record content at all.
    const send = async (to: string, tag: string) =>
      (await db.run(ctx, () => proposals.createFromTool(ctx, f.dcId, { id: run.body.id, requestedBy: pmId, inputs: [] }, aiToolByName('propose_internal_notification')!, { recipientUserId: to, title: `No-content note ${tag} (P5QAR, synthetic)`, body: 'Please check the plan (synthetic).' }, s))) as { proposal?: unknown; reason?: string };
    const a = await send(low, 'low');
    const b = await send(conf, 'conf');
    r.lowRecipient = a.proposal ? 'created' : a.reason;
    r.confRecipient = b.proposal ? 'created' : b.reason;
    console.log(`P5-QAR SEC-P5-01 isolation: ${JSON.stringify(r)}`);
  }, 120_000);

  it('CONTROL: a message with no content to a member cleared at the project\'s classification is created', () => {
    expect(r.confRecipient).toBe('created');
  });

  it('OBSERVED: the same no-content message to the internal-cleared member is refused (recipient_not_cleared_for_content) — so the p5-sec-ai SEC-P5-01 probe (internal recipient, confidential project) now passes on the project-level rule, not on the content check', () => {
    expect(String(r.lowRecipient)).toContain('recipient_not_cleared_for_content');
  });
});
