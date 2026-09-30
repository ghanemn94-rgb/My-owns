import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAS, apiSessionAs, loginAs } from './helpers';

/**
 * REQ-ARC-008 — automated accessibility checks (axe-core via @axe-core/playwright) on every delivered screen, in
 * English (LTR) and Arabic (RTL), plus a 390 px mobile pass, a few open-widget states (dialog, combobox) and keyboard
 * operability checks (skip link, visible focus, tabs, dialog focus/Escape, scrollable Gantt, evidence pickers).
 *
 * Gate: a scan FAILS on any violation of impact `serious` or `critical` from the WCAG 2.0/2.1 A and AA rule sets
 * (tags wcag2a, wcag2aa, wcag21a, wcag21aa). `best-practice` rules are run in the same pass and reported (advisory),
 * never used to pass or fail. `moderate` / `minor` WCAG findings are reported and listed in the summary.
 * No rule is disabled: EXCLUDED_RULES below is the only place an exclusion may be added, each with a written reason
 * that is repeated in docs/test-evidence/a11y-report.md.
 *
 * Automated checks find only a subset of WCAG failures; passing them is NOT a claim of WCAG 2.1 AA conformance.
 * Manual review with assistive technology is still required.
 *
 * Deterministic: read-only (no command is submitted; the locale is switched with the `hub_locale` cookie, not by
 * saving a persona preference), fixture ids are looked up by their seeded codes, and every scan waits for the page's
 * loading states to settle. Runs against the demo seed like the rest of the suite.
 */

type Locale = 'en' | 'ar';
type PersonaKey = 'pm' | 'pmB' | 'portfolioAdmin' | 'partnerAlpha' | 'finance' | 'contributor' | 'sponsor' | 'cleanTeam';
const LOCALES: readonly Locale[] = ['en', 'ar'];
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;
const FAILING_IMPACTS = new Set(['serious', 'critical']);
const MOBILE = { width: 390, height: 844 } as const;

/** Rules excluded from the gate, each with the reason. Keep empty unless a finding cannot be fixed in this code base. */
const EXCLUDED_RULES: readonly { id: string; reason: string }[] = [];

interface Ids {
  dc: string;
  /** DEMO-TRANSFORM (Demo PM — Project B): no decisions or agenda requests in the demo seed → cockpit empty states. */
  transform: string;
  committee: string;
  meeting: string;
  decision: string;
  task: string;
  milestone: string;
  deliverable: string;
  baseline: string;
  update: string;
  workstream: string;
  risk: string;
  changeRequest: string;
  gate: string;
  document: string;
  source: string;
  jvPartner: string;
  jvRoom: string;
  jvCleanRoom: string;
  jvScenario: string;
  jvDdRequest: string;
  jvFinding: string;
  jvClosing: string;
  jvSigning: string;
  jvCp: string;
  budgetLine: string;
  financeModel: string;
  benefit: string;
  kpi: string;
  aiProposal: string;
  aiRun: string;
}

interface Screen {
  /** Stable id used in the test title and the report. */
  id: string;
  persona: PersonaKey | null;
  path: (ids: Ids) => string;
  /** Optional readiness check beyond the generic one (loading states gone, <h1> visible). */
  ready?: (page: Page) => Promise<void>;
  /** Optional interaction that puts the screen into the state to scan (e.g. a wizard step, an open dialog). */
  prepare?: (page: Page) => Promise<void>;
  viewport?: { width: number; height: number };
}

const visible = (selector: string) => async (page: Page) => {
  await expect(page.locator(selector).first()).toBeVisible();
};
/** Cockpit: the given tile state is shown and the other tiles have settled (their lists are fetched separately). */
const cockpitReady = (selector: string) => async (page: Page) => {
  await expect(page.locator('[data-testid="overall-health-tile"]')).toBeVisible();
  await expect(page.locator('[data-testid="top-decisions-tile"]')).toBeVisible();
  await expect(page.locator(selector).first()).toBeVisible();
};

async function wizardTo(page: Page, step: 'details' | 'people' | 'review' | 'people-open') {
  // By template key, not display name: the Arabic UI shows the template's Arabic name (QA-P1-14).
  await page.getByTestId('template-general-transformation').check();
  await page.getByTestId('wizard-next').click();
  if (step === 'details') return;
  await page.getByTestId('wizard-code').fill('A11Y-SCAN');
  await page.getByTestId('wizard-name').fill('A11y scan — مسح إمكانية الوصول');
  await page.getByTestId('wizard-next').click();
  const combo = page.getByRole('combobox');
  await expect(combo).toBeVisible();
  if (step === 'people') return;
  await combo.fill('Demo Project');
  await expect(page.getByRole('option', { name: /Demo Project Manager/ }).first()).toBeVisible();
  if (step === 'people-open') return;
  await page.getByRole('option', { name: /Demo Project Manager/ }).first().click();
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('create-submit')).toBeVisible();
}

const SCREENS: readonly Screen[] = [
  { id: 'login', persona: null, path: () => '/login', ready: visible('[data-testid="demo-login"]') },
  { id: 'portfolio-home', persona: 'pm', path: () => '/', ready: visible('[data-testid="project-card"]') },
  { id: 'portfolio-home-390', persona: 'pm', path: () => '/', ready: visible('[data-testid="project-card"]'), viewport: MOBILE },
  { id: 'inbox', persona: 'pm', path: () => '/inbox' },
  // Project wizard (Portfolio Admin): each step; nothing is submitted.
  { id: 'wizard-1-template', persona: 'portfolioAdmin', path: () => '/projects/new', ready: visible('input[type="radio"]') },
  { id: 'wizard-2-details', persona: 'portfolioAdmin', path: () => '/projects/new', ready: visible('input[type="radio"]'), prepare: (p) => wizardTo(p, 'details') },
  { id: 'wizard-3-people', persona: 'portfolioAdmin', path: () => '/projects/new', ready: visible('input[type="radio"]'), prepare: (p) => wizardTo(p, 'people') },
  { id: 'wizard-3-people-combobox-open', persona: 'portfolioAdmin', path: () => '/projects/new', ready: visible('input[type="radio"]'), prepare: (p) => wizardTo(p, 'people-open') },
  { id: 'wizard-4-review', persona: 'portfolioAdmin', path: () => '/projects/new', ready: visible('input[type="radio"]'), prepare: (p) => wizardTo(p, 'review') },
  // Project workspace.
  { id: 'project-cockpit', persona: 'pm', path: (i) => `/projects/${i.dc}`, ready: cockpitReady('[data-testid="top-decisions"]') },
  // Cockpit states (REQ-UX-005): 390 px; no governance read (decisions restricted, committee asks hidden); partial
  // governance read (agenda requests restricted); empty registers; a failing decision register (injected 500).
  { id: 'project-cockpit-390', persona: 'pm', path: (i) => `/projects/${i.dc}`, ready: cockpitReady('[data-testid="top-decisions"]'), viewport: MOBILE },
  { id: 'project-cockpit-restricted', persona: 'portfolioAdmin', path: (i) => `/projects/${i.dc}`, ready: cockpitReady('[data-testid="top-decisions-tile"] [data-testid="tile-restricted"]') },
  { id: 'project-cockpit-partial', persona: 'contributor', path: (i) => `/projects/${i.dc}`, ready: cockpitReady('[data-testid="committee-asks-tile"] [data-testid="tile-restricted"]') },
  { id: 'project-cockpit-empty', persona: 'pmB', path: (i) => `/projects/${i.transform}`, ready: cockpitReady('[data-testid="top-decisions-empty"]') },
  {
    id: 'project-cockpit-error',
    persona: 'pm',
    path: (i) => `/projects/${i.dc}`,
    ready: cockpitReady('[data-testid="top-decisions"]'),
    prepare: async (page) => {
      await page.route(/\/api\/v1\/projects\/[^/]+\/decisions\?/, (route) =>
        route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500, code: 'internal' }) }),
      );
      await page.reload();
      await expect(page.locator('[data-testid="top-decisions-tile"] [data-testid="tile-error"]')).toBeVisible({ timeout: 20_000 });
    },
  },
  { id: 'project-dimension', persona: 'pm', path: (i) => `/projects/${i.dc}/dimensions/perimeter_transfer` },
  { id: 'project-charter', persona: 'pm', path: (i) => `/projects/${i.dc}/charter` },
  { id: 'project-members', persona: 'pm', path: (i) => `/projects/${i.dc}/members` },
  // Committee Hub.
  { id: 'committee-hub', persona: 'pm', path: (i) => `/projects/${i.dc}/committee` },
  { id: 'committee-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/committee/committees/${i.committee}` },
  { id: 'committee-meetings', persona: 'pm', path: (i) => `/projects/${i.dc}/committee/meetings` },
  { id: 'committee-meeting-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/committee/meetings/${i.meeting}` },
  { id: 'committee-decisions', persona: 'pm', path: (i) => `/projects/${i.dc}/committee/decisions` },
  { id: 'committee-decision-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/committee/decisions/${i.decision}`, ready: visible('[data-testid="evidence-panel"][data-target-type="decision"]') },
  { id: 'committee-actions', persona: 'pm', path: (i) => `/projects/${i.dc}/committee/actions` },
  { id: 'committee-escalations', persona: 'pm', path: (i) => `/projects/${i.dc}/committee/escalations` },
  // Plan.
  ...(['wbs', 'timeline', 'milestones', 'deliverables', 'dependencies', 'crossproject', 'baselines', 'lookahead', 'whatif', 'health'] as const).map(
    (tab): Screen => ({ id: `plan-${tab}`, persona: 'pm', path: (i) => `/projects/${i.dc}/plan?tab=${tab}`, ready: visible(`[role="tab"][data-tab="${tab}"][aria-selected="true"]`) }),
  ),
  {
    // Cross-project dependency form (DOM-P2-17): other project / item pickers; nothing is submitted.
    id: 'plan-crossproject-dialog-open',
    persona: 'pm',
    path: (i) => `/projects/${i.dc}/plan?tab=crossproject`,
    ready: visible('[role="tab"][data-tab="crossproject"][aria-selected="true"]'),
    prepare: async (page) => {
      await page.getByTestId('xproj-create').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByTestId('xproj-other-project')).toBeVisible();
    },
  },
  { id: 'plan-task-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/plan/tasks/${i.task}`, ready: visible('[data-testid="prerequisites"]') },
  {
    // Prerequisite form (DOM-P2-18) on a task; nothing is submitted.
    id: 'plan-task-prerequisite-dialog-open',
    persona: 'pm',
    path: (i) => `/projects/${i.dc}/plan/tasks/${i.task}`,
    ready: visible('[data-testid="prerequisites"]'),
    prepare: async (page) => {
      await page.getByTestId('prerequisite-add').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByTestId('prerequisite-record')).toBeVisible();
    },
  },
  { id: 'plan-milestone-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/plan/milestones/${i.milestone}` },
  { id: 'plan-deliverable-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/plan/deliverables/${i.deliverable}` },
  { id: 'plan-baseline-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/plan/baselines/${i.baseline}` },
  { id: 'plan-update-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/plan/updates/${i.update}` },
  { id: 'workstreams', persona: 'pm', path: (i) => `/projects/${i.dc}/workstreams` },
  { id: 'workstream-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/workstreams/${i.workstream}`, ready: visible('[data-testid="ws-tabs"]') },
  { id: 'workstream-detail-tasks', persona: 'pm', path: (i) => `/projects/${i.dc}/workstreams/${i.workstream}?tab=tasks`, ready: visible('[data-testid="ws-tasks-table"]') },
  // RAID and change requests.
  ...(['risks', 'issues', 'assumptions', 'dependencies', 'changes'] as const).map(
    (tab): Screen => ({ id: `raid-${tab}`, persona: 'pm', path: (i) => `/projects/${i.dc}/raid?tab=${tab}`, ready: visible(`[role="tab"][data-tab="${tab}"][aria-selected="true"]`) }),
  ),
  { id: 'raid-risk-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/raid/risks/${i.risk}` },
  { id: 'change-request-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/raid/changes/${i.changeRequest}`, ready: visible('[data-testid="cr-cost-impact-fact"]') },
  {
    // New change request form with the structured cost impact (DOM-P2-03); nothing is submitted.
    id: 'change-request-form-dialog-open',
    persona: 'pm',
    path: (i) => `/projects/${i.dc}/raid?tab=changes`,
    ready: visible('[role="tab"][data-tab="changes"][aria-selected="true"]'),
    prepare: async (page) => {
      await page.getByTestId('cr-create').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByTestId('cr-form-cost-impact')).toBeVisible();
    },
  },
  // Gates.
  { id: 'gates', persona: 'pm', path: (i) => `/projects/${i.dc}/gates` },
  { id: 'gate-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/gates/${i.gate}`, ready: visible('[data-testid="criterion-row"]') },
  {
    id: 'gate-detail-criterion-open',
    persona: 'pm',
    path: (i) => `/projects/${i.dc}/gates/${i.gate}`,
    ready: visible('[data-testid="criterion-row"]'),
    prepare: async (page) => {
      await page.getByTestId('criterion-toggle').first().click();
      await expect(page.getByTestId('criterion-toggle').first()).toHaveAttribute('aria-expanded', 'true');
    },
  },
  { id: 'gate-detail-390', persona: 'pm', path: (i) => `/projects/${i.dc}/gates/${i.gate}`, ready: visible('[data-testid="criterion-row"]'), viewport: MOBILE },
  // Documents & Evidence Center.
  { id: 'documents', persona: 'pm', path: (i) => `/projects/${i.dc}/documents`, ready: visible('[data-testid="documents-table"]') },
  { id: 'documents-evidence', persona: 'pm', path: (i) => `/projects/${i.dc}/documents?tab=evidence` },
  {
    // Evidence panel of a record + the "link evidence" dialog with its document picker (nothing is submitted).
    id: 'evidence-link-dialog-open',
    persona: 'pm',
    path: (i) => `/projects/${i.dc}/documents?tab=evidence`,
    ready: visible('[data-testid="evidence-target-option"]'),
    prepare: async (page) => {
      await page.getByTestId('evidence-target-option').first().click();
      await expect(page.getByTestId('evidence-panel')).toBeVisible();
      await page.getByTestId('evidence-add').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByTestId('evidence-document-picker').locator('button[aria-pressed]').first()).toBeVisible();
    },
  },
  { id: 'documents-sources', persona: 'pm', path: (i) => `/projects/${i.dc}/documents?tab=sources` },
  { id: 'document-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/documents/${i.document}`, ready: visible('[data-testid="versions-table"]') },
  { id: 'source-detail-claims', persona: 'pm', path: (i) => `/projects/${i.dc}/documents/sources/${i.source}` },
  // JV & Diligence (screen 11): every tab, the detail views, a restricted room, a command dialog and 390 px.
  { id: 'jv-overview', persona: 'pm', path: (i) => `/projects/${i.dc}/jv`, ready: visible('[data-testid="jv-metrics"]') },
  { id: 'jv-overview-390', persona: 'pm', path: (i) => `/projects/${i.dc}/jv`, ready: visible('[data-testid="jv-metrics"]'), viewport: MOBILE },
  { id: 'jv-partners', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/partners`, ready: visible('[data-testid="partners-table"] table') },
  { id: 'jv-partner-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/partners/${i.jvPartner}`, ready: visible('[data-testid="partner-detail"]') },
  {
    // A command dialog with a person picker (nothing is submitted).
    id: 'jv-partner-conflict-dialog-open',
    persona: 'pm',
    path: (i) => `/projects/${i.dc}/jv/partners/${i.jvPartner}`,
    ready: visible('[data-testid="partner-detail"]'),
    prepare: async (page) => {
      await page.getByTestId('cmd-conflict').click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  { id: 'jv-proposals', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/proposals?partnerId=${i.jvPartner}`, ready: visible('[data-testid="assessments-table"] table') },
  { id: 'jv-scenarios', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/scenarios`, ready: visible('[data-testid="scenarios-table"] table') },
  { id: 'jv-scenario-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/scenarios/${i.jvScenario}`, ready: visible('[data-testid="scenario-detail"]') },
  { id: 'jv-negotiation', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/negotiation`, ready: visible('[data-testid="issues-table"]') },
  { id: 'jv-rooms', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/rooms`, ready: visible('[data-testid="rooms-table"] table') },
  { id: 'jv-room-index', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/rooms/${i.jvRoom}`, ready: visible('[data-testid="room-index-table"] table') },
  { id: 'jv-room-disclosures', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/rooms/${i.jvRoom}?tab=disclosures`, ready: visible('[data-testid="disclosures-table"] table') },
  { id: 'jv-room-grants', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/rooms/${i.jvRoom}?tab=grants`, ready: visible('[data-testid="grants-table"] table') },
  { id: 'jv-room-history', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/rooms/${i.jvRoom}?tab=history`, ready: visible('[data-testid="history-table"] table') },
  { id: 'jv-room-no-grant', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/rooms/${i.jvCleanRoom}`, ready: visible('[data-testid="room-content-restricted"]') },
  { id: 'jv-diligence', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/diligence`, ready: visible('[data-testid="dd-table"] table') },
  { id: 'jv-diligence-findings', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/diligence?tab=findings`, ready: visible('[data-testid="findings-table"] table') },
  { id: 'jv-dd-request-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/diligence/requests/${i.jvDdRequest}`, ready: visible('[data-testid="dd-detail"]') },
  { id: 'jv-finding-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/diligence/findings/${i.jvFinding}`, ready: visible('[data-testid="finding-detail"]') },
  { id: 'jv-closing', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/closing`, ready: visible('[data-testid="closings-table"] table') },
  { id: 'jv-cp-register', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/closing?tab=conditions`, ready: visible('[data-testid="conditions-table"] table') },
  { id: 'jv-closing-blocked', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/closing/closings/${i.jvClosing}`, ready: visible('[data-testid="closing-blocked"]') },
  { id: 'jv-closing-blocked-390', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/closing/closings/${i.jvClosing}`, ready: visible('[data-testid="closing-blocked"]'), viewport: MOBILE },
  { id: 'jv-signing-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/closing/signings/${i.jvSigning}`, ready: visible('[data-testid="event-detail"]') },
  { id: 'jv-cp-non-waivable', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/closing/conditions/${i.jvCp}`, ready: visible('[data-testid="cp-not-waivable"]') },
  { id: 'jv-funds-flow', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/funds-flow`, ready: visible('[data-testid="flows-table"] table') },
  { id: 'jv-obligations', persona: 'pm', path: (i) => `/projects/${i.dc}/jv/obligations`, ready: visible('[data-testid="obligations-table"] table') },
  // Counterparty (external partner) view.
  { id: 'jv-partner-access', persona: 'partnerAlpha', path: () => '/partner-access', ready: visible('[data-testid="external-room-link"]') },
  { id: 'jv-partner-access-room', persona: 'partnerAlpha', path: (i) => `/partner-access/${i.dc}/${i.jvRoom}`, ready: visible('[data-testid="external-disclosures"] table') },
  { id: 'jv-partner-access-room-390', persona: 'partnerAlpha', path: (i) => `/partner-access/${i.dc}/${i.jvRoom}`, ready: visible('[data-testid="external-disclosures"] table'), viewport: MOBILE },
  // Finance & Value (screen 10): Finance persona (finance-domain clearance), plus the restricted state for a non-finance user.
  { id: 'finance-summary', persona: 'finance', path: (i) => `/projects/${i.dc}/finance`, ready: visible('[data-testid="finance-summary"]') },
  { id: 'finance-summary-390', persona: 'finance', path: (i) => `/projects/${i.dc}/finance`, ready: visible('[data-testid="finance-summary"]'), viewport: MOBILE },
  { id: 'finance-figures', persona: 'finance', path: (i) => `/projects/${i.dc}/finance/snapshots`, ready: visible('[data-testid="snapshots-table"]') },
  {
    id: 'finance-figure-form-open',
    persona: 'finance',
    path: (i) => `/projects/${i.dc}/finance/snapshots`,
    ready: visible('[data-testid="create-snapshot"]'),
    prepare: async (page) => {
      await page.getByTestId('create-snapshot').click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  { id: 'finance-budget', persona: 'finance', path: (i) => `/projects/${i.dc}/finance/budget`, ready: visible('[data-testid="separation-costs"]') },
  { id: 'finance-budget-line', persona: 'finance', path: (i) => `/projects/${i.dc}/finance/budget/${i.budgetLine}`, ready: visible('[data-testid="budget-detail"]') },
  { id: 'finance-reconciliations', persona: 'finance', path: (i) => `/projects/${i.dc}/finance/reconciliations`, ready: visible('[data-testid="recons-table"]') },
  { id: 'finance-models', persona: 'finance', path: (i) => `/projects/${i.dc}/finance/models`, ready: visible('[data-testid="models-table"]') },
  { id: 'finance-model-detail', persona: 'finance', path: (i) => `/projects/${i.dc}/finance/models/${i.financeModel}`, ready: visible('[data-testid="model-detail"]') },
  { id: 'finance-benefits-kpis', persona: 'finance', path: (i) => `/projects/${i.dc}/finance/benefits`, ready: visible('[data-testid="kpis-table"]') },
  { id: 'finance-benefit-detail', persona: 'finance', path: (i) => `/projects/${i.dc}/finance/benefits/${i.benefit}`, ready: visible('[data-testid="benefit-detail"]') },
  { id: 'finance-kpi-detail', persona: 'finance', path: (i) => `/projects/${i.dc}/finance/kpis/${i.kpi}`, ready: visible('[data-testid="kpi-detail"]') },
  { id: 'finance-restricted', persona: 'contributor', path: (i) => `/projects/${i.dc}/finance`, ready: visible('[data-testid="restricted-state"]') },
  // AI PM Center (screen 14): every tab, the proposal and run details, an open command dialog, 390 px and the restricted
  // state for a user without AI permissions. Read-only: nothing is asked, approved or activated.
  { id: 'ai-overview', persona: 'pm', path: (i) => `/projects/${i.dc}/ai`, ready: visible('[data-testid="ai-status"]') },
  { id: 'ai-overview-390', persona: 'pm', path: (i) => `/projects/${i.dc}/ai`, ready: visible('[data-testid="ai-status"]'), viewport: MOBILE },
  { id: 'ai-ask', persona: 'pm', path: (i) => `/projects/${i.dc}/ai/ask`, ready: visible('[data-testid="ask-form-panel"]') },
  { id: 'ai-proposals', persona: 'pm', path: (i) => `/projects/${i.dc}/ai/proposals`, ready: visible('[data-testid="proposals-table"] table') },
  { id: 'ai-proposal-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/ai/proposals/${i.aiProposal}`, ready: visible('[data-testid="proposal-binding"]') },
  { id: 'ai-runs', persona: 'pm', path: (i) => `/projects/${i.dc}/ai/runs`, ready: visible('[data-testid="runs-table"] table') },
  { id: 'ai-run-detail', persona: 'pm', path: (i) => `/projects/${i.dc}/ai/runs/${i.aiRun}`, ready: visible('[data-testid="run-output"]') },
  { id: 'ai-briefings-detections', persona: 'pm', path: (i) => `/projects/${i.dc}/ai/briefings`, ready: visible('[data-testid="detections-table"] table') },
  { id: 'ai-settings', persona: 'sponsor', path: (i) => `/projects/${i.dc}/ai/settings`, ready: visible('[data-testid="settings-form"]') },
  {
    // The emergency-stop confirmation (reason field, consequences); nothing is submitted.
    id: 'ai-kill-switch-dialog-open',
    persona: 'sponsor',
    path: (i) => `/projects/${i.dc}/ai/settings`,
    ready: visible('[data-testid="kill-switch-activate"]'),
    prepare: async (page) => {
      await page.getByTestId('kill-switch-activate').click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  { id: 'ai-restricted', persona: 'cleanTeam', path: (i) => `/projects/${i.dc}/ai`, ready: visible('[data-testid="restricted-state"]') },
  // Administration.
  { id: 'admin', persona: 'portfolioAdmin', path: () => '/admin' },
  // An open modal dialog (native <dialog>): the RAID "new risk" form.
  {
    id: 'dialog-open',
    persona: 'pm',
    path: (i) => `/projects/${i.dc}/raid?tab=risks`,
    ready: visible('[role="tab"][data-tab="risks"][aria-selected="true"]'),
    prepare: async (page) => {
      await page.locator('[data-testid="raid-create-risks"]').first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
];

// ---------------------------------------------------------------------------------------------------------------------
// Result collection (one entry per scan) → JSON attachment per test, summary JSON + Markdown report after the run.

interface Finding {
  rule: string;
  impact: string;
  gating: boolean;
  bestPracticeOnly: boolean;
  help: string;
  helpUrl: string;
  nodes: number;
  example: string;
}
interface ScanRecord {
  screen: string;
  locale: Locale;
  url: string;
  axe: string;
  findings: Finding[];
  /** axe "incomplete" results: rules that could not decide automatically and need a manual check (rule → nodes). */
  incomplete: Record<string, number>;
}
const expectedScans = SCREENS.length * LOCALES.length;
const REPO = join(__dirname, '..', '..');
const REPORT = join(REPO, 'docs', 'test-evidence', 'a11y-report.md');
// Inside Playwright's outputDir, which it empties at the start of every run. One file per scan: Playwright starts a
// fresh worker (fresh module state) after every failed test, so results cannot be collected in memory.
const OUT = join(__dirname, '..', 'test-results', 'a11y');
const SCANS = join(OUT, 'scans');
const scanOrder = (r: ScanRecord) => LOCALES.indexOf(r.locale) * 1000 + SCREENS.findIndex((s) => s.id === r.screen);

function saveRecord(r: ScanRecord, full: unknown) {
  mkdirSync(SCANS, { recursive: true });
  writeFileSync(join(SCANS, `${r.locale}--${r.screen}.json`), JSON.stringify(r, null, 2));
  // Full axe output next to the summary (also attached to the test) so CI artifacts keep it with any reporter.
  mkdirSync(join(OUT, 'axe'), { recursive: true });
  writeFileSync(join(OUT, 'axe', `${r.locale}--${r.screen}.json`), JSON.stringify(full, null, 2));
}
function loadRecords(): ScanRecord[] {
  if (!existsSync(SCANS)) return [];
  return readdirSync(SCANS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(SCANS, f), 'utf8')) as ScanRecord)
    .sort((a, b) => scanOrder(a) - scanOrder(b));
}

let ids: Ids;
const sessions: Partial<Record<PersonaKey, Awaited<ReturnType<BrowserContext['storageState']>>>> = {};

async function listItems(api: APIRequestContext, path: string): Promise<Record<string, unknown>[]> {
  const res = await api.get(path);
  expect(res.ok(), `GET ${path} → HTTP ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { items: Record<string, unknown>[] }).items;
}
async function findId(api: APIRequestContext, path: string, field: string, value: string | RegExp): Promise<string> {
  const items = await listItems(api, path);
  const hit = items.find((x) => (typeof value === 'string' ? x[field] === value : value.test(String(x[field] ?? ''))));
  expect(hit, `${path}: no item with ${field} = ${String(value)}`).toBeTruthy();
  return String(hit!.id);
}

async function lookupIds(baseURL: string): Promise<Ids> {
  const api = await apiSessionAs(baseURL, PERSONAS.pm);
  const fin = await apiSessionAs(baseURL, PERSONAS.finance);
  const pmB = await apiSessionAs(baseURL, PERSONAS.pmB);
  try {
    const dc = await findId(api, '/api/v1/projects', 'code', 'DEMO-DC');
    const p = `/api/v1/projects/${dc}`;
    return {
      dc,
      transform: await findId(pmB, '/api/v1/projects', 'code', 'DEMO-TRANSFORM'),
      committee: await findId(api, `${p}/committees`, 'name', 'DC Carve-out & JV Steering Committee (Demo)'),
      meeting: await findId(api, `${p}/meetings?pageSize=100`, 'title', 'Demo — Steering Committee meeting #1'),
      decision: await findId(api, `${p}/decisions?pageSize=100`, 'code', 'DEC-004'),
      task: await findId(api, `${p}/tasks?q=WS01-A01&pageSize=100`, 'wbsCode', 'WS01-A01'),
      milestone: await findId(api, `${p}/milestones?pageSize=100`, 'code', 'WS01-A04'),
      deliverable: await findId(api, `${p}/deliverables?q=D-WS01-A01&pageSize=100`, 'code', 'D-WS01-A01'),
      baseline: (await listItems(api, `${p}/baselines`)).map((b) => b as { id: string; versionNo: number }).sort((a, b) => a.versionNo - b.versionNo)[0]!.id,
      update: await findId(api, `${p}/status-updates?pageSize=100`, 'summary', /^Demo update: inventory preparation/),
      workstream: await findId(api, `${p}/workstreams`, 'code', 'WS01'),
      risk: await findId(api, `${p}/raid/risks?pageSize=100`, 'code', 'RSK-001'),
      changeRequest: await findId(api, `${p}/change-requests?pageSize=100`, 'code', 'CR-005'),
      gate: await findId(api, `${p}/gates`, 'key', 'G1'),
      document: await findId(api, `${p}/documents?pageSize=100`, 'title', 'Demo — charter excerpt'),
      source: await findId(api, `${p}/sources?pageSize=100`, 'code', 'SRC-001'),
      jvPartner: await findId(api, `${p}/partners?pageSize=100`, 'code', 'DEMO-PA'),
      jvRoom: await findId(api, `${p}/partner-rooms?pageSize=100`, 'name', 'Demo — Partner Alpha data room (fictional)'),
      jvCleanRoom: await findId(api, `${p}/partner-rooms?pageSize=100`, 'type', 'clean_team'),
      jvScenario: await findId(api, `${p}/deal-scenarios?pageSize=100`, 'name', 'DEMO — Illustrative JV structure (percentages TBD)'),
      jvDdRequest: await findId(api, `${p}/diligence-requests?pageSize=100`, 'question', /^DEMO — Please share the synthetic list/),
      jvFinding: await findId(api, `${p}/diligence-findings?pageSize=100`, 'title', /^DEMO — Synthetic finding/),
      jvClosing: await findId(api, `${p}/closings?pageSize=100`, 'code', 'CLO-001'),
      jvSigning: await findId(api, `${p}/signings?pageSize=100`, 'code', 'SIG-001'),
      jvCp: await findId(api, `${p}/closing-conditions?pageSize=100`, 'reference', 'DEMO-CP-01'),
      budgetLine: await findId(api, `${p}/budget-lines?pageSize=100`, 'code', 'BL-001'),
      // The seeded valuation model is strictly confidential: only a Finance Restricted member can read it.
      financeModel: await findId(fin, `${p}/financial-models?pageSize=100`, 'code', 'FM-001'),
      benefit: await findId(api, `${p}/benefits?pageSize=100`, 'code', 'BEN-001'),
      kpi: await findId(api, `${p}/kpis?pageSize=100`, 'key', 'action_closure_time'),
      // The seeded AI proposal (DEMO-DC) and the PM's seeded briefing run (runs are per user).
      aiProposal: String((await listItems(api, `${p}/ai/proposals?pageSize=100&sort=createdAt`))[0]!.id),
      aiRun: await findId(api, `${p}/ai/runs?pageSize=100&sort=createdAt`, 'kind', 'briefing'),
    };
  } finally {
    await api.dispose();
    await fin.dispose();
    await pmB.dispose();
  }
}

async function openContext(browser: Browser, baseURL: string, persona: PersonaKey | null, locale: Locale, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext({
    storageState: persona ? sessions[persona] : undefined,
    ...(viewport ? { viewport, isMobile: false, hasTouch: false } : {}),
  });
  // Rendering language comes from the `hub_locale` cookie (server-rendered <html lang dir>); setting it here leaves the
  // persona's saved preference untouched, so the scan does not change state other tests depend on.
  await ctx.addCookies([{ name: 'hub_locale', value: locale, url: baseURL }]);
  return ctx;
}

/**
 * Wait until the rendered page stops changing: no loading indicator and the same DOM size over two consecutive
 * samples 400 ms apart. (`networkidle` is not usable: Next.js keeps prefetching linked routes in the viewport.)
 */
async function waitForStableDom(page: Page) {
  await expect(page.getByTestId('loading-state')).toHaveCount(0);
  const sample = () => page.evaluate(() => `${document.body.innerHTML.length}:${document.querySelectorAll('[data-testid="loading-state"]').length}`);
  await expect
    .poll(
      async () => {
        const a = await sample();
        await page.waitForTimeout(400);
        return a === (await sample()) && a.endsWith(':0');
      },
      { timeout: 20_000, intervals: [0] },
    )
    .toBe(true);
}

/** Generic readiness: right language and direction, a visible <h1> (or the restricted-access state), then a settled DOM. */
async function settle(page: Page, locale: Locale) {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  await expect(page.locator('h1, [data-testid="restricted-state"]').first()).toBeVisible();
  await waitForStableDom(page);
}

function summarise(results: Awaited<ReturnType<AxeBuilder['analyze']>>): Finding[] {
  const excluded = new Set(EXCLUDED_RULES.map((r) => r.id));
  return results.violations
    .filter((v) => !excluded.has(v.id))
    .map((v) => {
      const wcag = v.tags.some((t) => (WCAG_TAGS as readonly string[]).includes(t));
      return {
        rule: v.id,
        impact: v.impact ?? 'unknown',
        gating: wcag && FAILING_IMPACTS.has(v.impact ?? ''),
        bestPracticeOnly: !wcag,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.length,
        example: v.nodes[0]?.target.map(String).join(' >> ') ?? '',
      };
    });
}

test.describe('REQ-ARC-008 accessibility (axe-core, WCAG 2.1 A/AA)', () => {
  test.beforeAll(async ({ browser, baseURL }) => {
    ids = await lookupIds(baseURL!);
    for (const persona of ['pm', 'pmB', 'portfolioAdmin', 'partnerAlpha', 'finance', 'contributor', 'sponsor', 'cleanTeam'] as const) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await loginAs(page, PERSONAS[persona]);
      sessions[persona] = await ctx.storageState();
      await ctx.close();
    }
  });

  test.afterAll(() => {
    // Runs when each worker ends (Playwright replaces the worker after a failure); the last one sees every scan file.
    const records = loadRecords();
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'axe-summary.json'), JSON.stringify({ excludedRules: EXCLUDED_RULES, records }, null, 2));
    // The Markdown summary is only rewritten after a complete run (a filtered run would under-report).
    if (records.length === expectedScans) writeReport(records);
  });

  for (const locale of LOCALES) {
    for (const screen of SCREENS) {
      test(`[${locale}] ${screen.id}`, async ({ browser, baseURL }, testInfo) => {
        const ctx = await openContext(browser, baseURL!, screen.persona, locale, screen.viewport);
        try {
          const page = await ctx.newPage();
          await page.goto(screen.path(ids));
          await settle(page, locale);
          if (screen.ready) await screen.ready(page);
          if (screen.prepare) {
            await screen.prepare(page);
            await waitForStableDom(page);
          }
          const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS, 'best-practice']).analyze();
          await testInfo.attach(`axe-${locale}-${screen.id}.json`, { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
          const findings = summarise(results);
          const url = new URL(page.url());
          saveRecord({ screen: screen.id, locale, url: url.pathname + url.search, axe: results.testEngine.version, findings, incomplete: Object.fromEntries(results.incomplete.map((r) => [r.id, r.nodes.length])) }, results);
          const gating = findings.filter((f) => f.gating);
          expect(
            gating,
            `serious/critical WCAG violations on ${screen.id} [${locale}]:\n` +
              gating.map((f) => `  ${f.impact.padEnd(8)} ${f.rule} ×${f.nodes}  e.g. ${f.example}  (${f.help})`).join('\n'),
          ).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Keyboard operability (WCAG 2.1.1, 2.1.2, 2.4.1, 2.4.3, 2.4.7): not covered by axe, checked here directly.

/** True when the element that has focus shows a visible focus indicator (outline or box-shadow ring). */
async function focusIndicator(page: Page): Promise<{ tag: string; text: string; visible: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { tag: 'body', text: '', visible: false };
    const cs = getComputedStyle(el);
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1;
    const ring = cs.boxShadow !== 'none' && cs.boxShadow !== '';
    return { tag: el.tagName.toLowerCase(), text: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40), visible: outline || ring };
  });
}

test.describe('REQ-ARC-008 keyboard operability', () => {
  test.beforeAll(async ({ browser, baseURL }) => {
    if (!ids) ids = await lookupIds(baseURL!);
    if (!sessions.pm) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await loginAs(page, PERSONAS.pm);
      sessions.pm = await ctx.storageState();
      await ctx.close();
    }
  });

  for (const locale of LOCALES) {
    test(`[${locale}] skip link, visible focus on the first 25 tab stops, tabs with arrow keys, dialog focus and Escape`, async ({ browser, baseURL }) => {
      const ctx = await openContext(browser, baseURL!, 'pm', locale);
      try {
        const page = await ctx.newPage();

        // 1. Skip link is the first tab stop and moves focus to <main>.
        await page.goto(`/projects/${ids.dc}/plan?tab=wbs`);
        await settle(page, locale);
        await page.keyboard.press('Tab');
        const skip = page.locator('a[href="#main-content"]');
        await expect(skip).toBeFocused();
        expect((await focusIndicator(page)).visible, 'skip link has a visible focus indicator').toBe(true);
        await page.keyboard.press('Enter');
        await expect(page.locator('main#main-content')).toBeFocused();

        // 2. Every one of the next 25 tab stops shows a visible focus indicator; focus never gets stuck.
        const seen: string[] = [];
        for (let i = 0; i < 25; i++) {
          await page.keyboard.press('Tab');
          const f = await focusIndicator(page);
          expect(f.tag, `tab stop ${i + 1} left the document`).not.toBe('body');
          expect(f.visible, `tab stop ${i + 1} (${f.tag} "${f.text}") has no visible focus indicator`).toBe(true);
          seen.push(`${f.tag}:${f.text}`);
        }
        expect(new Set(seen).size, 'focus moves between different elements (no keyboard trap)').toBeGreaterThan(10);

        // 3. Tabs: arrow keys move selection in reading direction (mirrored in RTL), Home/End jump.
        const selected = page.locator('[role="tab"][aria-selected="true"]').first();
        await selected.focus();
        await expect(selected).toHaveAttribute('data-tab', 'wbs');
        await page.keyboard.press(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight');
        await expect(page.locator('[role="tab"][data-tab="timeline"]')).toBeFocused();
        await expect(page.locator('[role="tab"][data-tab="timeline"]')).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('End');
        await expect(page.locator('[role="tab"][data-tab="health"]')).toBeFocused();
        await page.keyboard.press('Home');
        await expect(page.locator('[role="tab"][data-tab="wbs"]')).toBeFocused();

        // 4. Dialog opened from the keyboard: focus moves inside, Escape closes it and focus returns to the opener.
        await page.goto(`/projects/${ids.dc}/raid?tab=risks`);
        await settle(page, locale);
        const opener = page.locator('[data-testid="raid-create-risks"]').first();
        await opener.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        expect(await dialog.evaluate((d) => d.contains(document.activeElement)), 'focus is inside the dialog').toBe(true);
        for (let i = 0; i < 15; i++) {
          await page.keyboard.press('Tab');
          const inside = await dialog.evaluate((d) => d.contains(document.activeElement) || document.activeElement === document.body);
          expect(inside, `Tab ${i + 1} keeps focus inside the modal dialog`).toBe(true);
        }
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
      } finally {
        await ctx.close();
      }
    });

    test(`[${locale}] scrollable Gantt and evidence pickers work with the keyboard`, async ({ browser, baseURL }) => {
      const ctx = await openContext(browser, baseURL!, 'pm', locale);
      try {
        const page = await ctx.newPage();

        // 1. The overflowing Gantt chart is a named, focusable group that the arrow keys scroll (in reading direction).
        await page.goto(`/projects/${ids.dc}/plan?tab=timeline`);
        await settle(page, locale);
        const scroller = page.getByTestId('gantt-scroll');
        await expect(scroller).toHaveAttribute('tabindex', '0');
        await expect(scroller).toHaveAttribute('role', 'group');
        await expect(scroller).toHaveAttribute('aria-label', /\S/);
        await scroller.evaluate((el) => el.scrollTo({ left: 0 }));
        await scroller.focus();
        expect((await focusIndicator(page)).visible, 'Gantt scroll area shows a focus indicator').toBe(true);
        for (let i = 0; i < 5; i++) await page.keyboard.press(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight');
        await expect.poll(() => scroller.evaluate((el) => Math.abs(el.scrollLeft)), { message: 'arrow keys scroll the chart' }).toBeGreaterThan(0);

        // 2. Evidence target picker: toggle buttons (aria-pressed), chosen with Enter.
        await page.goto(`/projects/${ids.dc}/documents?tab=evidence`);
        await settle(page, locale);
        const option = page.getByTestId('evidence-target-option').first();
        await expect(option).toHaveAttribute('aria-pressed', 'false');
        await option.focus();
        expect((await focusIndicator(page)).visible, 'picker option shows a focus indicator').toBe(true);
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('evidence-target-label')).toBeVisible();

        // 3. "Link evidence" dialog from the keyboard: document picker chosen with Space; Escape closes and returns focus.
        const add = page.getByTestId('evidence-add');
        await add.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const doc = dialog.getByTestId('evidence-document-picker').locator('button[aria-pressed]').first();
        await doc.focus();
        await page.keyboard.press(' ');
        await expect(doc).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(add).toBeFocused();
      } finally {
        await ctx.close();
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Markdown summary (auto-generated block inside docs/test-evidence/a11y-report.md; the hand-written parts are kept).

const START = '<!-- a11y:auto:start -->';
const END = '<!-- a11y:auto:end -->';

function writeReport(records: ScanRecord[]) {
  const axeVersion = [...new Set(records.map((r) => r.axe))].join(', ');
  const all = records.flatMap((r) => r.findings.map((f) => ({ ...f, screen: r.screen, locale: r.locale })));
  const byRule = new Map<string, { impact: string; kind: string; nodes: number; scans: Set<string>; example: string; help: string }>();
  for (const f of all) {
    const k = byRule.get(f.rule) ?? { impact: f.impact, kind: f.bestPracticeOnly ? 'best-practice (advisory)' : f.gating ? 'WCAG — gating' : 'WCAG — reported', nodes: 0, scans: new Set(), example: `${f.example} (${f.screen} [${f.locale}])`, help: f.help };
    k.nodes += f.nodes;
    k.scans.add(`${f.screen} [${f.locale}]`);
    byRule.set(f.rule, k);
  }
  const gating = all.filter((f) => f.gating);
  const lines: string[] = [];
  lines.push(START);
  lines.push('');
  lines.push(`_Generated by \`e2e/tests/a11y.spec.ts\` (axe-core ${axeVersion}, tags ${WCAG_TAGS.join(', ')} + best-practice). Do not edit this block by hand._`);
  lines.push('');
  lines.push(`- Scans: **${records.length}** (${SCREENS.length} screen states × ${LOCALES.length} locales: en/LTR, ar/RTL)`);
  lines.push(`- Gating result (serious/critical WCAG violations): **${gating.length === 0 ? 'PASS — 0' : `FAIL — ${gating.length}`}**`);
  lines.push(`- Excluded rules: ${EXCLUDED_RULES.length === 0 ? 'none' : EXCLUDED_RULES.map((r) => `\`${r.id}\` (${r.reason})`).join('; ')}`);
  const incomplete = new Map<string, { nodes: number; scans: number }>();
  for (const r of records) {
    for (const [rule, n] of Object.entries(r.incomplete)) {
      const k = incomplete.get(rule) ?? { nodes: 0, scans: 0 };
      incomplete.set(rule, { nodes: k.nodes + n, scans: k.scans + 1 });
    }
  }
  lines.push(
    `- axe "incomplete" (could not be decided automatically — manual review): ${
      incomplete.size === 0 ? 'none' : [...incomplete.entries()].sort().map(([rule, k]) => `\`${rule}\` ${k.nodes} nodes in ${k.scans} scans`).join('; ')
    }`,
  );
  lines.push('');
  lines.push('| Rule | Impact | Kind | Nodes | Scans | Example selector (screen) |');
  lines.push('|---|---|---|---|---|---|');
  if (byRule.size === 0) lines.push('| — | — | — | 0 | 0 | no violations |');
  for (const [rule, k] of [...byRule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`| \`${rule}\` | ${k.impact} | ${k.kind} | ${k.nodes} | ${k.scans.size} | \`${k.example.replace(/\|/g, '\\|')}\` |`);
  }
  lines.push('');
  lines.push('<details><summary>Per-scan results</summary>');
  lines.push('');
  lines.push('| Screen | Locale | Violations (rule ×nodes) |');
  lines.push('|---|---|---|');
  for (const r of records) {
    lines.push(`| ${r.screen} | ${r.locale} | ${r.findings.length === 0 ? '0' : r.findings.map((f) => `${f.rule} ×${f.nodes}`).join(', ')} |`);
  }
  lines.push('');
  lines.push('</details>');
  lines.push('');
  lines.push(END);
  const block = lines.join('\n');
  const current = existsSync(REPORT) ? readFileSync(REPORT, 'utf8') : `# Accessibility (axe) report\n\n${START}\n${END}\n`;
  const next = current.includes(START) && current.includes(END) ? current.replace(new RegExp(`${START}[\\s\\S]*?${END}`), () => block) : `${current.trimEnd()}\n\n${block}\n`;
  mkdirSync(join(REPO, 'docs', 'test-evidence'), { recursive: true });
  writeFileSync(REPORT, next);
}
