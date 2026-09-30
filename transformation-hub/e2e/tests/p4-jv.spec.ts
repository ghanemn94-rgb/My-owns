import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { apiSessionAs, loginAs, watchConsole } from './helpers';

/**
 * P4 JV & Diligence (spec §10 screen 11; spec §8; AT-03, AT-11, AT-12, AT-13) against the real API and demo seed.
 * Fixtures that are not the behaviour under test (documents, governance decisions voted through the DEMO committee, a
 * confirmed signing, a closing ready for confirmation, a partner-B room with a released item) are prepared through the
 * APIs as the real demo personas; every behaviour under test is driven and observed through the UI:
 *  - AT-11: partner preparation and DD run while separation gate G3 is not approved; stages are never skipped (the UI
 *    offers only the next stage and the server refuses a skip when the UI is bypassed).
 *  - AT-12: a closing with an unmet CP shows "closing blocked" naming the CPs; the authorized confirmation is refused by
 *    the server (re-evaluated inside the transaction) even from a page loaded while the closing was still ready.
 *  - AT-13: a non-waivable CP offers no waiver in the UI; a bypassing request is refused and logged; the CP stays unmet.
 *  - AT-03: the partner-A external user sees only its own room's released items; partner B's room is not visible, not
 *    listed and not reachable (restricted state); an internal user without a room grant gets the restricted state too.
 * Re-runnable: every fixture is new (timestamped). Screenshots: e2e/screenshots/p4/jv-*.png (en, ar, 390 px).
 */
const SHOTS = join(__dirname, '..', 'screenshots', 'p4');
mkdirSync(SHOTS, { recursive: true });

const P = {
  pm: 'Demo Project Manager',
  sponsor: 'Demo Sponsor',
  legal: 'Demo Legal Member',
  chair: 'Demo Committee Chair',
  secretary: 'Demo Secretary / CPMO',
  contributor: 'Demo Contributor',
  partnerAlpha: 'Demo Partner Alpha User',
} as const;
const STAMP = Date.now().toString(36);
const MOBILE = { width: 390, height: 844 } as const;

async function csrfOf(ctx: APIRequestContext): Promise<string> {
  return (await ctx.storageState()).cookies.find((c) => c.name === 'hub_csrf')?.value ?? '';
}
async function post(ctx: APIRequestContext, path: string, data: unknown) {
  const res = await ctx.post(path, { data, headers: { 'x-csrf-token': await csrfOf(ctx) } });
  expect(res.ok(), `POST ${path} → HTTP ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}
async function get(ctx: APIRequestContext, path: string) {
  const res = await ctx.get(path);
  expect(res.ok(), `GET ${path} → HTTP ${res.status()}`).toBeTruthy();
  return res.json();
}
function isoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** A synthetic text document (optionally filed in a room) with one stored version; returns its id. */
async function uploadDoc(ctx: APIRequestContext, pid: string, title: string, opts: { roomId?: string; kind?: string } = {}): Promise<string> {
  const base = `/api/v1/projects/${pid}`;
  const d = await post(ctx, `${base}/documents`, { title, kind: opts.kind ?? 'agreement', classification: 'internal', ...(opts.roomId ? { roomId: opts.roomId } : {}) });
  const res = await ctx.post(`${base}/documents/${d.id}/versions`, {
    data: Buffer.from(`${title}\n\nSynthetic e2e content — not a real document.\n`, 'utf8'),
    headers: { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent('e2e-synthetic.txt'), 'x-file-type': 'text/plain', 'x-csrf-token': await csrfOf(ctx) },
  });
  expect(res.ok(), `upload ${title} → HTTP ${res.status()} ${await res.text()}`).toBeTruthy();
  return d.id;
}

/**
 * A FINAL approved governance decision of a JV type. JV signing / closing confirmations are outside the DEMO committee's
 * delegation: the committee votes a recommendation (recorded by the secretariat) and the authorized body's approval is
 * recorded by another person (the chair) with a synthetic reference — the path the server accepts as a final approval.
 */
async function finalJvDecision(baseURL: string, pid: string, decisionTypeKey: string): Promise<string> {
  const base = `/api/v1/projects/${pid}`;
  const pm = await apiSessionAs(baseURL, P.pm);
  const sec = await apiSessionAs(baseURL, P.secretary);
  const chair = await apiSessionAs(baseURL, P.chair);
  try {
    const committees = (await get(sec, `${base}/committees?pageSize=100`)).items as { id: string; kind: string; status: string }[];
    const committee = committees.find((c) => c.kind === 'program_steering' && c.status === 'active');
    if (!committee) throw new Error('No active DEMO steering committee in the demo seed');
    const d = await post(pm, `${base}/decisions`, {
      committeeId: committee.id,
      title: `E2E ${decisionTypeKey} ${STAMP} (synthetic)`,
      decisionTypeKey,
      issue: 'Synthetic e2e issue',
      whyNow: 'Needed for the synthetic e2e scenario',
      alternatives: [{ title: 'Proceed' }, { title: 'Do not proceed' }],
      recommendation: 'Proceed',
      impacts: { financial: 'Synthetic', operational: 'Synthetic', schedule: 'Synthetic' },
      risks: 'None identified (synthetic)',
      dependencies: 'None identified (synthetic)',
      latestSafeDate: isoDate(30),
      requiredAuthority: 'Per the DEMO authority matrix (synthetic)',
    });
    const detail = await get(sec, `${base}/committees/${committee.id}`);
    const members = (detail.memberships as { id: string; userId: string | null; voting: boolean; activeToday: boolean }[]).filter((m) => m.userId && m.activeToday);
    const m = await post(sec, `${base}/committees/${committee.id}/meetings`, { title: `E2E JV meeting ${decisionTypeKey} ${STAMP} (synthetic)`, scheduledAt: new Date().toISOString() });
    const req = await post(pm, `${base}/agenda-requests`, { committeeId: committee.id, title: 'JV status (information)', kind: 'information', meetingId: m.id });
    await post(sec, `${base}/agenda-requests/${req.id}/screen`, { expectedVersion: req.version, outcome: 'accept', meetingId: m.id });
    let mv = (await post(sec, `${base}/meetings/${m.id}/publish-agenda`, { expectedVersion: m.version })).version;
    mv = (await post(sec, `${base}/meetings/${m.id}/start`, { expectedVersion: mv })).version;
    void mv;
    await post(sec, `${base}/meetings/${m.id}/attendance`, { entries: members.map((x) => ({ membershipId: x.id, status: 'present' })) });
    const s = await post(pm, `${base}/decisions/${d.id}/submit`, { expectedVersion: d.version });
    await post(sec, `${base}/decisions/${d.id}/start-review`, { expectedVersion: s.version, meetingId: m.id });
    const users = (await get(sec, '/api/v1/auth/demo-users')).items as { id: string; displayName: string }[];
    for (const member of members.filter((x) => x.voting)) {
      const persona = users.find((u) => u.id === member.userId)?.displayName;
      if (!persona) continue;
      const voter = await apiSessionAs(baseURL, persona);
      const v = (await get(voter, `${base}/decisions/${d.id}`)).version;
      await post(voter, `${base}/decisions/${d.id}/votes`, { expectedVersion: v, choice: 'approve' });
      await voter.dispose();
    }
    const out = await post(sec, `${base}/decisions/${d.id}/record-outcome`, { expectedVersion: (await get(sec, `${base}/decisions/${d.id}`)).version });
    expect(out.status, `${decisionTypeKey} is outside the committee delegation → recommendation`).toBe('recommended');
    // DOM-P2-12: the external decision rests on an evidence link on the decision that another person verified (PM links,
    // Legal verifies; the chair records the approval).
    const link = await post(pm, `${base}/evidence`, { targetType: 'decision', targetId: d.id, note: `Synthetic record of the authorized body's decision ${STAMP} (e2e)`, purpose: 'External authority decision (e2e)' });
    const legal = await apiSessionAs(baseURL, P.legal);
    try {
      await post(legal, `${base}/evidence/${link.id}/verify`, { expectedVersion: 1, decision: 'accept', note: 'Checked against the synthetic reference (e2e)' });
    } finally {
      await legal.dispose();
    }
    const ext = await post(chair, `${base}/decisions/${d.id}/record-external-approval`, {
      expectedVersion: (await get(chair, `${base}/decisions/${d.id}`)).version,
      outcome: 'approved',
      externalReference: `E2E-AUTHORIZED-BODY-${STAMP} (synthetic reference)`,
      evidenceLinkId: link.id,
      note: 'Synthetic external approval (e2e)',
    });
    expect(ext.status).toBe('approved');
    return d.id;
  } finally {
    await pm.dispose();
    await sec.dispose();
    await chair.dispose();
  }
}

async function asPersona(browser: Browser, persona: string, viewport?: { width: number; height: number }) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  const problems = watchConsole(page);
  await loginAs(page, persona);
  return { page, problems, close: () => context.close() };
}

function dialog(page: Page) {
  return page.getByRole('dialog');
}

/** Rendering language from the `hub_locale` cookie (the persona's saved preference is left untouched). */
async function useLocale(page: Page, baseURL: string, locale: 'en' | 'ar') {
  await page.context().addCookies([{ name: 'hub_locale', value: locale, url: baseURL }]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
}

/** Full-page screenshot without transient toasts covering the content. */
async function shot(page: Page, file: string) {
  const toastButtons = page.getByRole('status').getByRole('button');
  while ((await toastButtons.count()) > 0) await toastButtons.first().click();
  await expect(page.getByTestId('loading-state')).toHaveCount(0);
  await page.screenshot({ path: join(SHOTS, file), fullPage: true });
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('P4 JV & Diligence', () => {
  let pid: string;
  let userIds: Record<string, string>;
  let alphaRoomId: string;
  let cleanTeamRoomId: string;

  test.beforeAll(async ({ baseURL }) => {
    const pm = await apiSessionAs(baseURL!, P.pm);
    const list = await get(pm, '/api/v1/projects');
    pid = (list.items as { id: string; code: string }[]).find((p) => p.code === 'DEMO-DC')!.id;
    const users = (await get(pm, '/api/v1/auth/demo-users')).items as { id: string; displayName: string }[];
    userIds = Object.fromEntries(users.map((u) => [u.displayName, u.id]));
    const rooms = (await get(pm, `/api/v1/projects/${pid}/partner-rooms?pageSize=100`)).items as { id: string; name: string; type: string }[];
    alphaRoomId = rooms.find((r) => r.name === 'Demo — Partner Alpha data room (fictional)')!.id;
    cleanTeamRoomId = rooms.find((r) => r.type === 'clean_team')!.id;
    await pm.dispose();
  });

  test('AT-11: partner preparation and DD proceed before G3; stages are never skipped', async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const base = `/api/v1/projects/${pid}`;
    const api = await apiSessionAs(baseURL!, P.pm);
    const ndaTitle = `E2E NDA executed copy ${STAMP} (synthetic)`;
    await uploadDoc(api, pid, ndaTitle);
    const g3 = ((await get(api, `${base}/gates`)).items as { key: string; assessment: { status: string } }[]).find((g) => g.key === 'G3')!;
    expect(['approved', 'approved_with_exceptions'], 'separation gate G3 is not approved during this scenario').not.toContain(g3.assessment.status);

    const pm = await asPersona(browser, P.pm);
    const sponsor = await asPersona(browser, P.sponsor);
    const legal = await asPersona(browser, P.legal);
    const name = `E2E Partner ${STAMP} (fictional)`;
    const code = `E2E-${STAMP}`.toUpperCase();
    try {
      const { page } = pm;
      await page.goto(`/projects/${pid}`);
      await page.getByTestId('project-nav').getByRole('link', { name: 'JV & Diligence' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'JV & Diligence' })).toBeVisible();
      await expect(page.getByTestId('parallel-preparation')).toContainText('G3 / G4 are not prerequisites');
      await expect(page.getByTestId('nda-no-access')).toContainText('does not grant access to any document');
      await expect(page.getByTestId('record-only')).toContainText('never executes');
      await shot(page, 'jv-en-overview.png');

      // Longlist: add a partner (no default names — the name is entered by the user).
      await page.getByTestId('jv-tabs').getByRole('link', { name: 'Partners' }).click();
      await page.getByTestId('create-partner').click();
      await dialog(page).getByTestId('partner-name').fill(name);
      await dialog(page).getByTestId('partner-code').fill(code);
      await dialog(page).getByRole('button', { name: 'Add partner', exact: true }).click();
      await expect(dialog(page)).toBeHidden();
      await page.getByLabel('Search code or name').fill(code);
      await expect(page.getByTestId('partners-table').getByRole('row')).toHaveCount(2);
      await page.getByTestId('partners-table').getByRole('link', { name: code, exact: true }).click();
      const detail = page.getByTestId('partner-detail');
      await expect(detail).toHaveAttribute('data-stage', 'identified');
      // Contact approval is its own command: no generic "advance" is offered at Identified.
      await expect(page.getByTestId('cmd-advance')).toHaveCount(0);
      const partnerUrl = page.url();
      const partnerId = partnerUrl.split('/').pop()!;

      // Outreach approval: requested by the PM, decided by the sponsor (another, authorized person).
      await page.getByTestId('cmd-outreach').click();
      await dialog(page).getByLabel('Why contact this partner').fill('Synthetic e2e outreach request');
      await dialog(page).getByRole('button', { name: 'Request approval', exact: true }).click();
      await expect(dialog(page)).toBeHidden();
      await expect(page.getByTestId('own-request-note')).toBeVisible();
      await expect(page.getByTestId('cmd-decideOutreach')).toHaveCount(0);
      const sp = sponsor.page;
      await sp.goto(partnerUrl);
      await sp.getByTestId('cmd-decideOutreach').click();
      await dialog(sp).getByRole('button', { name: 'Approve outreach', exact: true }).click();
      await expect(sp.getByTestId('partner-detail')).toHaveAttribute('data-stage', 'approved_for_contact');

      // NDA: the PM submits the executed copy; Legal records it. The NDA grants no document access.
      await page.reload();
      await expect(detail).toHaveAttribute('data-stage', 'approved_for_contact');
      await page.getByTestId('cmd-submitNda').click();
      await dialog(page).getByLabel('Search documents by title').fill(ndaTitle);
      await dialog(page).locator(`[data-document-title="${ndaTitle}"]`).click();
      await dialog(page).getByTestId('nda-executed-on').fill(isoDate(0));
      await dialog(page).getByRole('button', { name: 'Submit NDA', exact: true }).click();
      await expect(dialog(page)).toBeHidden();
      const lp = legal.page;
      await lp.goto(partnerUrl);
      await lp.getByTestId('cmd-recordNda').click();
      await dialog(lp).getByRole('button', { name: 'Record as executed', exact: true }).click();
      await expect(lp.getByTestId('partner-detail')).toHaveAttribute('data-stage', 'nda');
      await expect(lp.getByTestId('nda-panel-no-access')).toContainText('does not grant access to any document');

      // Materials access, then due diligence — only the next stage can be chosen; skipped stages are not selectable.
      await page.reload();
      await page.getByTestId('cmd-advance').click();
      await expect(dialog(page).getByTestId('advance-to')).toHaveValue('materials_access');
      await expect(dialog(page).locator('option[value="dd"]')).toBeDisabled();
      await dialog(page).getByRole('button', { name: 'Advance', exact: true }).click();
      await expect(detail).toHaveAttribute('data-stage', 'materials_access');
      await page.getByTestId('cmd-advance').click();
      await expect(dialog(page).getByTestId('advance-to')).toHaveValue('dd');
      for (const skipped of ['proposal', 'negotiation', 'signing', 'closing']) await expect(dialog(page).locator(`option[value="${skipped}"]`)).toBeDisabled();
      await expect(dialog(page).locator('option[value="proposal"]')).toContainText('cannot be skipped');
      await dialog(page).getByRole('button', { name: 'Advance', exact: true }).click();
      await expect(detail).toHaveAttribute('data-stage', 'dd');
      await expect(page.getByTestId('stage-path').locator('[data-state="current"]')).toHaveAttribute('data-step', 'dd');

      // A skip that bypasses the UI is refused by the server; the partner stays at Due diligence.
      const v = (await get(api, `${base}/partners/${partnerId}`)).version;
      const skip = await api.post(`${base}/partners/${partnerId}/advance`, { data: { expectedVersion: v, toStage: 'negotiation' }, headers: { 'x-csrf-token': await csrfOf(api) } });
      expect(skip.status()).toBe(422);
      expect((await skip.json()).code).toBe('jv.partner.stage_skipped');
      await page.reload();
      await expect(detail).toHaveAttribute('data-stage', 'dd');
      await shot(page, 'jv-en-partner-at11.png');

      // DD in parallel with separation: a partner room and a DD request while G3 is not approved.
      const roomName = `E2E room ${STAMP} (fictional)`;
      await page.getByTestId('jv-tabs').getByRole('link', { name: 'Rooms & VDR' }).click();
      await page.getByTestId('create-room').click();
      await dialog(page).getByTestId('room-name').fill(roomName);
      await dialog(page).getByTestId('room-type').selectOption('partner');
      await dialog(page).getByTestId('room-partner').selectOption(partnerId);
      await dialog(page).getByRole('button', { name: 'Create room', exact: true }).click();
      await expect(dialog(page)).toBeHidden();
      await page.getByLabel('Search room name').fill(roomName);
      await expect(page.getByTestId('rooms-table').getByRole('row')).toHaveCount(2);
      await page.getByTestId('rooms-table').getByRole('link', { name: roomName }).click();
      await expect(page.getByTestId('room-detail')).toHaveAttribute('data-can-open', 'true');
      const roomId = page.url().split('/').pop()!.split('?')[0]!;
      await page.getByTestId('jv-tabs').getByRole('link', { name: 'Due diligence' }).click();
      await page.getByTestId('create-dd-request').click();
      const question = `E2E DD question ${STAMP}: list of in-scope assets (synthetic)`;
      await dialog(page).getByTestId('dd-room').selectOption(roomId);
      await dialog(page).getByTestId('dd-question').fill(question);
      await dialog(page).getByTestId('dd-domain').selectOption('technical');
      await dialog(page).getByRole('button', { name: 'Raise request', exact: true }).click();
      await expect(dialog(page)).toBeHidden();
      await page.getByLabel('Search question').fill(STAMP);
      await expect(page.getByTestId('dd-table')).toContainText(question);
      const g3After = ((await get(api, `${base}/gates`)).items as { key: string; assessment: { status: string } }[]).find((g) => g.key === 'G3')!;
      expect(['approved', 'approved_with_exceptions']).not.toContain(g3After.assessment.status);

      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
      expect(sponsor.problems(), sponsor.problems().join('\n')).toEqual([]);
      expect(legal.problems(), legal.problems().join('\n')).toEqual([]);
    } finally {
      await api.dispose();
      await pm.close();
      await sponsor.close();
      await legal.close();
    }
  });

  test('AT-12: closing blocked — the message names the unmet CPs and the confirmation is refused', async ({ browser, baseURL }) => {
    test.setTimeout(360_000);
    const base = `/api/v1/projects/${pid}`;
    // (a) The demo closing is blocked by an unverified non-waivable CP: the sponsor sees why and is offered no confirmation.
    const sponsor = await asPersona(browser, P.sponsor);
    try {
      const sp = sponsor.page;
      await sp.goto(`/projects/${pid}/jv/closing`);
      await sp.getByTestId('closings-table').getByRole('link', { name: 'CLO-001', exact: true }).click();
      const blocked = sp.getByTestId('closing-blocked');
      await expect(blocked).toContainText('Closing blocked');
      await expect(sp.getByTestId('blocked-cps')).toContainText('DEMO-CP-01');
      await expect(blocked).toContainText('Blocking condition DEMO-CP-01 is Open');
      await expect(sp.getByTestId('cmd-confirm')).toHaveCount(0);
      await expect(sp.getByTestId('confirm-not-available')).toBeVisible();
      await expect(sp.getByTestId('event-detail')).toHaveAttribute('data-status', 'in_preparation');
      await shot(sp, 'jv-en-closing-blocked.png');
      await useLocale(sp, baseURL!, 'ar');
      await expect(sp.getByTestId('closing-blocked')).toContainText('الإتمام محظور');
      await expect(sp.getByTestId('blocked-cps')).toContainText('DEMO-CP-01');
      await shot(sp, 'jv-ar-closing-blocked.png');
      await sp.setViewportSize(MOBILE);
      await sp.reload();
      await expect(sp.getByTestId('closing-blocked')).toBeVisible();
      await shot(sp, 'jv-ar-390-closing-blocked.png');
      await noHorizontalOverflow(sp);
      await useLocale(sp, baseURL!, 'en');
      expect(sponsor.problems(), sponsor.problems().join('\n')).toEqual([]);
    } finally {
      await sponsor.close();
    }

    // (b) Fixture: a confirmed signing and a closing READY for confirmation (CP verified with evidence, confirmation
    //     requested with a final approved decision) — prepared through the APIs as the real personas.
    const signingDecision = await finalJvDecision(baseURL!, pid, 'jv_signing_authorization');
    const closingDecision = await finalJvDecision(baseURL!, pid, 'jv_closing_confirmation');
    const pmApi = await apiSessionAs(baseURL!, P.pm);
    const legalApi = await apiSessionAs(baseURL!, P.legal);
    const sponsorApi = await apiSessionAs(baseURL!, P.sponsor);
    let closingId = '';
    let cpId = '';
    let cpRef = '';
    try {
      const executed = await uploadDoc(pmApi, pid, `E2E executed agreement ${STAMP} (synthetic)`);
      const signing = await post(pmApi, `${base}/signings`, { name: `E2E signing ${STAMP} (synthetic)` });
      const item = await post(pmApi, `${base}/checklist-items`, { eventId: signing.id, title: `E2E executed agreement delivered ${STAMP}` });
      const delivered = await post(pmApi, `${base}/checklist-items/${item.id}/deliver`, { expectedVersion: item.version, documentId: executed });
      await post(legalApi, `${base}/checklist-items/${item.id}/accept`, { expectedVersion: delivered.version });
      let sv = (await post(pmApi, `${base}/transaction-events/${signing.id}/transition`, { expectedVersion: 1, command: 'start_preparation' })).version;
      sv = (await post(pmApi, `${base}/transaction-events/${signing.id}/transition`, { expectedVersion: sv, command: 'mark_ready' })).version;
      sv = (await post(pmApi, `${base}/transaction-events/${signing.id}/request-confirmation`, { expectedVersion: sv, decisionId: signingDecision, executedDocumentId: executed })).version;
      const rec = await post(sponsorApi, `${base}/signings/${signing.id}/record`, { expectedVersion: sv });
      expect(rec.status).toBe('confirmed');
      const closing = await post(pmApi, `${base}/closings`, { signingId: signing.id, name: `E2E closing ${STAMP} (synthetic)` });
      closingId = closing.id;
      const cp = await post(legalApi, `${base}/closing-conditions`, { closingId, title: `E2E blocking CP ${STAMP} (synthetic)`, ownerUserId: userIds[P.pm], blocking: true });
      cpId = cp.id;
      cpRef = cp.code;
      await post(pmApi, `${base}/evidence`, { targetType: 'closing_condition', targetId: cpId, note: 'Synthetic e2e evidence note' });
      await post(pmApi, `${base}/closing-conditions/${cpId}/submit-evidence`, { expectedVersion: 1 });
      await post(legalApi, `${base}/closing-conditions/${cpId}/verify`, { expectedVersion: 2, outcome: 'verify' });
      let cv = (await post(pmApi, `${base}/transaction-events/${closingId}/transition`, { expectedVersion: 1, command: 'start_preparation' })).version;
      cv = (await post(pmApi, `${base}/transaction-events/${closingId}/transition`, { expectedVersion: cv, command: 'mark_ready' })).version;
      await post(pmApi, `${base}/transaction-events/${closingId}/request-confirmation`, { expectedVersion: cv, decisionId: closingDecision });
    } finally {
      await legalApi.dispose();
      await sponsorApi.dispose();
    }

    const sponsor2 = await asPersona(browser, P.sponsor);
    try {
      const sp = sponsor2.page;
      await sp.goto(`/projects/${pid}/jv/closing/closings/${closingId}`);
      await expect(sp.getByTestId('event-detail')).toHaveAttribute('data-status', 'ready_for_confirmation');
      await expect(sp.getByTestId('event-ready-state')).toHaveAttribute('data-ready', 'true');
      await expect(sp.getByTestId('confirmation-decision')).toHaveAttribute('data-authorizes', 'true');
      const confirm = sp.getByTestId('cmd-confirm');
      await expect(confirm).toBeEnabled();

      // Meanwhile the CP is reopened (defective evidence) — this page still shows the closing as ready.
      const cpNow = await get(pmApi, `${base}/closing-conditions/${cpId}`);
      await post(pmApi, `${base}/closing-conditions/${cpId}/reopen`, { expectedVersion: cpNow.version, reason: 'Evidence found defective (synthetic e2e)' });

      // The confirmation re-evaluates every blocking CP inside its transaction: refused, with the unmet CP named.
      await confirm.click();
      await dialog(sp).getByRole('button', { name: 'Confirm closing', exact: true }).click();
      await expect(dialog(sp).getByRole('alert')).toContainText('The request breaks a business rule');
      await expect(dialog(sp).getByTestId('refusal-blockers')).toContainText(`Blocking condition ${cpRef} is Open`);
      await shot(sp, 'jv-en-confirm-refused.png');
      await dialog(sp).getByRole('button', { name: 'Cancel' }).click();
      await sp.reload();
      await expect(sp.getByTestId('event-detail')).toHaveAttribute('data-status', 'ready_for_confirmation');
      await expect(sp.getByTestId('blocked-cps')).toContainText(cpRef);
      await expect(sp.getByTestId('cmd-confirm')).toBeDisabled();
      await expect(sp.getByTestId('confirm-disabled-reason')).toContainText('open blockers');
      await sp.getByTestId('event-readiness').scrollIntoViewIfNeeded();
      await shot(sp, 'jv-en-closing-refused-blocked.png');
      // (The refusal itself is written to the audit log inside the command — asserted by the API AT-12 spec.)
      const status = (await get(pmApi, `${base}/closings/${closingId}`)).status;
      expect(status, 'the closing was not confirmed').toBe('ready_for_confirmation');
      expect(sponsor2.problems(), sponsor2.problems().join('\n')).toEqual([]);
    } finally {
      await pmApi.dispose();
      await sponsor2.close();
    }
  });

  test('AT-13: a non-waivable CP offers no waiver in the UI; a bypassing request is refused and logged', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const base = `/api/v1/projects/${pid}`;
    const api = await apiSessionAs(baseURL!, P.pm);
    const cps = (await get(api, `${base}/closing-conditions?pageSize=100`)).items as { id: string; reference: string }[];
    const nonWaivable = cps.find((c) => c.reference === 'DEMO-CP-01')!;
    const waivable = cps.find((c) => c.reference === 'DEMO-CP-03')!;
    const pm = await asPersona(browser, P.pm);
    const sponsor = await asPersona(browser, P.sponsor);
    try {
      const { page } = pm;
      // Contrast: the waivable CP offers the waiver request (to its CP manager).
      await page.goto(`/projects/${pid}/jv/closing/conditions/${waivable.id}`);
      await expect(page.getByTestId('cp-detail')).toHaveAttribute('data-waivable', 'true');
      await expect(page.getByTestId('cmd-waiver')).toBeVisible();

      await page.goto(`/projects/${pid}/jv/closing?tab=conditions`);
      await page.getByTestId('conditions-table').getByRole('link', { name: 'DEMO-CP-01', exact: true }).click();
      const detail = page.getByTestId('cp-detail');
      await expect(detail).toHaveAttribute('data-waivable', 'false');
      await expect(page.getByTestId('cp-not-waivable')).toContainText('NOT waivable');
      await expect(page.getByTestId('cmd-waiver')).toHaveCount(0);
      await expect(page.getByTestId('waivers-table')).toContainText('this condition is not waivable');

      // Bypassing the UI: the request is refused and logged; the condition stays unmet.
      const res = await api.post(`${base}/closing-conditions/${nonWaivable.id}/waivers`, {
        data: { basis: 'Attempted e2e waiver of a non-waivable CP (synthetic)', impact: 'None (synthetic)' },
        headers: { 'x-csrf-token': await csrfOf(api) },
      });
      expect(res.status()).toBe(422);
      expect((await res.json()).code).toBe('gates.waiver.non_waivable');
      await page.reload();
      await expect(detail).toHaveAttribute('data-status', 'open');
      await expect(page.getByTestId('waivers-table')).toContainText('this condition is not waivable');
      await shot(page, 'jv-en-cp-non-waivable.png');
      // (The refused request is written to the audit log — asserted by the API AT-13 spec.)

      // The waiver authority (sponsor) has nothing to approve either.
      const sp = sponsor.page;
      await sp.goto(`/projects/${pid}/jv/closing/conditions/${nonWaivable.id}`);
      await expect(sp.getByTestId('cp-not-waivable')).toBeVisible();
      await expect(sp.getByTestId('cmd-approve-waiver')).toHaveCount(0);
      await expect(sp.getByTestId('cmd-waiver')).toHaveCount(0);
      await useLocale(sp, baseURL!, 'ar');
      await expect(sp.getByTestId('cp-not-waivable')).toContainText('غير قابل للتنازل');
      await shot(sp, 'jv-ar-cp-non-waivable.png');
      await useLocale(sp, baseURL!, 'en');
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
      expect(sponsor.problems(), sponsor.problems().join('\n')).toEqual([]);
    } finally {
      await api.dispose();
      await pm.close();
      await sponsor.close();
    }
  });

  test('AT-03: the partner-A user sees only its own room; partner B’s room and internal views stay restricted', async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const base = `/api/v1/projects/${pid}`;
    // Fixture: a room for partner B with a document released into it.
    const pmApi = await apiSessionAs(baseURL!, P.pm);
    const sponsorApi = await apiSessionAs(baseURL!, P.sponsor);
    const legalApi = await apiSessionAs(baseURL!, P.legal);
    const betaRoomName = `E2E Partner Beta room ${STAMP} (fictional)`;
    const betaDocTitle = `E2E Beta-only memo ${STAMP} (synthetic)`;
    let betaRoomId = '';
    try {
      const partners = (await get(pmApi, `${base}/partners?pageSize=100`)).items as { id: string; code: string }[];
      const beta = partners.find((p) => p.code === 'DEMO-PB')!;
      betaRoomId = (await post(pmApi, `${base}/partner-rooms`, { name: betaRoomName, type: 'partner', partnerId: beta.id, classification: 'internal' })).id;
      await post(sponsorApi, `${base}/partner-rooms/${betaRoomId}/access-grants`, { userId: userIds[P.legal], accessLevel: 'manage', role: null, reason: 'E2E: disclosure release (synthetic)' });
      const docId = await uploadDoc(pmApi, pid, betaDocTitle, { roomId: betaRoomId, kind: 'dd_material' });
      const disc = await post(pmApi, `${base}/partner-rooms/${betaRoomId}/disclosures`, { documentId: docId, note: 'E2E release to partner B (synthetic)' });
      await post(legalApi, `${base}/partner-rooms/${betaRoomId}/disclosures/${disc.id}/release`, { expectedVersion: disc.version, outcome: 'release' });
    } finally {
      await pmApi.dispose();
      await sponsorApi.dispose();
      await legalApi.dispose();
    }

    const partner = await asPersona(browser, P.partnerAlpha);
    try {
      const { page } = partner;
      // The counterparty reaches only the partner-access projection of its own room.
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Partner rooms' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Partner rooms' })).toBeVisible();
      const links = page.getByTestId('external-room-link');
      await expect(links).toHaveCount(1);
      await expect(links).toContainText('Demo — Partner Alpha data room (fictional)');
      await expect(page.locator('body')).not.toContainText(betaRoomName);
      await links.click();
      await expect(page.getByTestId('external-room')).toHaveAttribute('data-room-id', alphaRoomId);
      await expect(page.getByTestId('external-disclosures')).toContainText('Demo — Data room welcome note (synthetic)');
      await expect(page.getByTestId('external-dd')).toContainText('The synthetic list is summarised in the welcome note');
      await expect(page.locator('body')).not.toContainText(betaDocTitle);
      await shot(page, 'jv-en-partner-access.png');

      // Partner B's room: not listed, not reachable (neutral restricted state), and the API answers 404 without leaking.
      await page.goto(`/partner-access/${pid}/${betaRoomId}`);
      await expect(page.getByTestId('restricted-state')).toBeVisible();
      await expect(page.locator('body')).not.toContainText(betaRoomName);
      await expect(page.locator('body')).not.toContainText(betaDocTitle);
      await shot(page, 'jv-en-partner-access-restricted.png');
      // The answer for partner B's room is the same as for a room that does not exist: nothing about it leaks.
      const unknownRoom = '01a0f1c3-0000-7000-8000-000000000000';
      for (const suffix of ['partner-access/rooms/{room}/disclosures', 'partner-access/rooms/{room}/dd-requests', 'partner-rooms/{room}']) {
        const r = await page.request.get(`${base}/${suffix.replace('{room}', betaRoomId)}`);
        const other = await page.request.get(`${base}/${suffix.replace('{room}', unknownRoom)}`);
        expect([403, 404], suffix).toContain(r.status());
        expect(r.status(), `${suffix}: same answer as for an unknown room`).toBe(other.status());
        const text = await r.text();
        expect(text).not.toContain(betaDocTitle);
        expect(text).not.toContain(betaRoomName);
        expect(text).not.toContain(betaRoomId);
      }
      const rooms = await (await page.request.get(`${base}/partner-access/rooms`)).json();
      expect((rooms.items as { id: string }[]).map((r) => r.id)).toEqual([alphaRoomId]);
      // Internal projections are not reachable for the counterparty.
      await page.goto(`/projects/${pid}/jv`);
      await expect(page.getByTestId('restricted-state')).toBeVisible();

      // Arabic (RTL) and 390 px.
      await page.goto(`/partner-access/${pid}/${alphaRoomId}`);
      await useLocale(page, baseURL!, 'ar');
      await expect(page.getByTestId('external-room')).toContainText('البنود المفرج عنها');
      await shot(page, 'jv-ar-partner-access.png');
      await page.setViewportSize(MOBILE);
      await page.reload();
      await expect(page.getByTestId('external-disclosures')).toBeVisible();
      await shot(page, 'jv-ar-390-partner-access.png');
      await noHorizontalOverflow(page);
      await useLocale(page, baseURL!, 'en');
      await shot(page, 'jv-en-390-partner-access.png');
      await noHorizontalOverflow(page);
      expect(partner.problems(), partner.problems().join('\n')).toEqual([]);
    } finally {
      await partner.close();
    }

    // Internal users without a room grant: a room administrator sees the metadata only; a member sees nothing.
    const pm = await asPersona(browser, P.pm);
    const contributor = await asPersona(browser, P.contributor);
    try {
      await pm.page.goto(`/projects/${pid}/jv/rooms/${cleanTeamRoomId}`);
      await expect(pm.page.getByTestId('room-detail')).toHaveAttribute('data-can-open', 'false');
      await expect(pm.page.getByTestId('room-content-restricted').getByTestId('restricted-state')).toBeVisible();
      await expect(pm.page.getByTestId('room-index')).toHaveCount(0);
      await shot(pm.page, 'jv-en-room-no-grant.png');
      await contributor.page.goto(`/projects/${pid}/jv/rooms/${alphaRoomId}`);
      await expect(contributor.page.getByTestId('restricted-state')).toBeVisible();
      await expect(contributor.page.getByTestId('room-detail')).toHaveCount(0);
      await contributor.page.goto(`/projects/${pid}/jv/rooms/${betaRoomId}`);
      await expect(contributor.page.getByTestId('restricted-state')).toBeVisible();
      await expect(contributor.page.locator('body')).not.toContainText(betaRoomName);
      // Overview in Arabic and at 390 px (the PM).
      await pm.page.goto(`/projects/${pid}/jv`);
      await useLocale(pm.page, baseURL!, 'ar');
      await expect(pm.page.getByRole('heading', { level: 1, name: 'المشروع المشترك والفحص النافي للجهالة' })).toBeVisible();
      await shot(pm.page, 'jv-ar-overview.png');
      await pm.page.setViewportSize(MOBILE);
      await pm.page.reload();
      await expect(pm.page.getByTestId('jv-metrics')).toBeVisible();
      await shot(pm.page, 'jv-ar-390-overview.png');
      await noHorizontalOverflow(pm.page);
      await useLocale(pm.page, baseURL!, 'en');
      expect(pm.problems(), pm.problems().join('\n')).toEqual([]);
      expect(contributor.problems(), contributor.problems().join('\n')).toEqual([]);
    } finally {
      await pm.close();
      await contributor.close();
    }
  });
});
