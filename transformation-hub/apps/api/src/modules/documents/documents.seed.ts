import { and, asc, eq, ilike, inArray } from 'drizzle-orm';
import { schema } from '@hub/db';
import type { ModuleSeed } from '../../cli/seed-modules';
import { DbService } from '../../platform/db.service';
import { DocumentsService } from './documents.service';
import { EvidenceService } from './evidence.service';
import { SourcesService } from './sources.service';

/**
 * DEMO sandbox scenario for documents & sources (idempotent; everything goes through the services so authorization,
 * audit and outbox apply). All content is SYNTHETIC and labelled "Demo"; no real Mobily data, people, dates or figures.
 *
 *  - Source register entry for the reference tracker image — image NOT available, extraction NOT performed — with
 *    claims mirroring CLM-001..CLM-010 of docs/source-register.md (second-hand, from the master prompt §2).
 *    CLM-009 (historical "Completed" / "On Track") stays historical_unverified and is NOT applied (AT-01).
 *  - Demo documents with small synthetic text versions, one restricted, one under a demo legal hold.
 *  - Evidence links for later gate / task use.
 */

const IMAGE_FILENAME = 'IMG_B65D893D-6B73-4D57-85DF-6B72BA10C15D.jpeg';
/** Qualitative confidence of the build-time register mapped to the 0–1 scale: Medium = 0.5, Low = 0.25. */
const MEDIUM = '0.500';
const LOW = '0.250';

const CLAIMS: { location: string; subject: string; extractedValue: string; sourceReportedValue: string; confidence: string; status: 'historical_unverified' | 'unknown' }[] = [
  { location: 'Master prompt §2, title line (describing the image)', subject: 'CLM-001 — Initiative title', extractedValue: 'N4 — Unlock delayering potential (e.g., DCs)', sourceReportedValue: 'as stated', confidence: MEDIUM, status: 'historical_unverified' },
  { location: 'Master prompt §2, bullet 1', subject: 'CLM-002 — Heading', extractedValue: 'DC strategy definition, separation approvals, diligence activities', sourceReportedValue: 'as stated', confidence: MEDIUM, status: 'historical_unverified' },
  { location: 'Master prompt §2, bullet 2', subject: 'CLM-003 — Heading', extractedValue: 'Go-to-Market and Target Operating Model', sourceReportedValue: 'as stated', confidence: MEDIUM, status: 'historical_unverified' },
  { location: 'Master prompt §2, bullet 3', subject: 'CLM-004 — Heading', extractedValue: 'Phased financial carve-out / standalone financial statements', sourceReportedValue: 'as stated', confidence: MEDIUM, status: 'historical_unverified' },
  {
    location: 'Master prompt §2, bullet 4',
    subject: 'CLM-005 — Heading',
    extractedValue: 'Legal & regulatory requirements and DCCo establishment; references to CST, ATA, TSA, MSA',
    sourceReportedValue: 'Abbreviations as stated; expansions not assumed',
    confidence: MEDIUM,
    status: 'historical_unverified',
  },
  { location: 'Master prompt §2, bullet 5', subject: 'CLM-006 — Heading', extractedValue: 'Separation of additional data centers and completion of associated requirements', sourceReportedValue: 'as stated', confidence: MEDIUM, status: 'historical_unverified' },
  { location: 'Master prompt §2, bullet 6', subject: 'CLM-007 — Heading', extractedValue: 'Business plan and valuation', sourceReportedValue: 'as stated', confidence: MEDIUM, status: 'historical_unverified' },
  { location: 'Master prompt §2, bullet 7', subject: 'CLM-008 — Heading', extractedValue: 'Partner engagement, JV structuring, diligence, agreements, closing', sourceReportedValue: 'as stated', confidence: MEDIUM, status: 'historical_unverified' },
  {
    location: 'Master prompt §2, paragraph 2',
    subject: 'CLM-009 — Historical statuses shown in the image',
    extractedValue: 'Completed; On Track',
    sourceReportedValue: '"Completed", "On Track" (not assigned to items) — must not be applied as current status',
    confidence: LOW,
    status: 'historical_unverified',
  },
  {
    location: 'Master prompt §2, paragraph 2',
    subject: 'CLM-010 — Unclear site/person/partner names, detailed dates, small figures and percentages',
    extractedValue: 'Not extracted (unclear in the source; image not available)',
    sourceReportedValue: 'not extracted',
    confidence: LOW,
    status: 'unknown',
  },
];

const DOCS = {
  charter: {
    title: 'Demo — charter excerpt',
    kind: 'charter' as const,
    classification: 'confidential' as const,
    filename: 'demo-charter-excerpt.md',
    persona: 'pm',
    text: [
      '# Demo charter excerpt',
      'DEMO — SYNTHETIC CONTENT. Not a real Mobily document; no real people, dates or figures.',
      '## Purpose',
      'Illustrative excerpt used to demonstrate document upload, evidence linking and retrieval in the demo sandbox.',
      '## Scope (illustrative)',
      '- Carve-out of the data center business into a standalone entity (Demo NewCo).\n- Partner engagement and JV structuring are covered by separate documents.',
      '## Governance',
      'Decision rights follow the committee charter. Approver: Role — To be confirmed.',
    ].join('\n\n'),
  },
  tsa: {
    title: 'Demo — TSA schedule notes',
    kind: 'runbook' as const,
    classification: 'confidential' as const,
    filename: 'demo-tsa-schedule-notes.md',
    persona: 'pm',
    text: [
      '# Demo — TSA schedule notes',
      'DEMO — SYNTHETIC CONTENT. No real services, durations, dates or charges.',
      '## Services under consideration (illustrative)',
      '- Service A: network operations support — duration TBD.\n- Service B: billing support — duration TBD.',
      '## Open points',
      'Exit criteria and acceptance evidence to be confirmed by the workstream lead.',
    ].join('\n\n'),
  },
  finance: {
    title: 'Demo — restricted finance note',
    kind: 'financial_model' as const,
    classification: 'restricted' as const,
    filename: 'demo-restricted-finance-note.txt',
    persona: 'secretary',
    text: 'DEMO — SYNTHETIC CONTENT. Restricted finance note used to demonstrate classification filtering in lists, search and counts.\n\nNo real figures: every value is TBD.',
  },
  held: {
    title: 'Demo — minutes extract (legal hold)',
    kind: 'minutes' as const,
    classification: 'confidential' as const,
    filename: 'demo-minutes-extract.txt',
    persona: 'pm',
    text: 'DEMO — SYNTHETIC CONTENT. Minutes extract placed under a demo legal hold to demonstrate retention and legal-hold controls (AT-27).',
  },
};

export const documentsSeed: ModuleSeed = {
  name: 'documents',
  run: async ({ app, dcProjectId, asUser, log }) => {
    const docs = app.get(DocumentsService);
    const sources = app.get(SourcesService);
    const evidence = app.get(EvidenceService);
    const db = app.get(DbService);

    // 1. Source register: the reference tracker image (not available → extraction not performed).
    const existingSource = await asUser('pm', async () =>
      db.tx().select({ id: schema.sourceRecord.id }).from(schema.sourceRecord).where(and(eq(schema.sourceRecord.projectId, dcProjectId), eq(schema.sourceRecord.filename, IMAGE_FILENAME))),
    );
    if (existingSource.length === 0) {
      const src = await asUser('pm', (ctx) =>
        sources.create(ctx, dcProjectId, {
          sourceType: 'image',
          filename: IMAGE_FILENAME,
          ownerLabel: 'User (corporate transformation / PMO) — Role — To be confirmed',
          extractionStatus: 'not_performed',
          extractionNote:
            'Image not available in the build environment; extraction NOT performed. Claims are second-hand, taken from the master prompt §2 description (build-time register SRC-001 describing SRC-002). Report date, as-of date and version are unknown.',
          classification: 'confidential',
        }),
      );
      for (const c of CLAIMS) {
        await asUser('pm', (ctx) =>
          sources.createClaim(ctx, dcProjectId, src.id, {
            location: c.location,
            subject: c.subject,
            extractedValue: c.extractedValue,
            sourceReportedValue: c.sourceReportedValue,
            confidence: c.confidence,
            verificationStatus: c.status,
          }),
        );
      }
      log(`documents: source ${src.code} with ${CLAIMS.length} claims (extraction not performed)`);
    }

    // 2. Demo documents (synthetic text versions).
    const titles = Object.values(DOCS).map((d) => d.title);
    const existing = await asUser('secretary', async () =>
      db.tx().select({ id: schema.document.id, title: schema.document.title }).from(schema.document).where(and(eq(schema.document.projectId, dcProjectId), inArray(schema.document.title, titles))),
    );
    const ids = new Map(existing.map((d) => [d.title, d.id]));
    for (const d of Object.values(DOCS)) {
      if (ids.has(d.title)) continue;
      const created = await asUser(d.persona, (ctx) => docs.create(ctx, dcProjectId, { title: d.title, kind: d.kind, classification: d.classification }));
      await asUser(d.persona, (ctx) => docs.uploadVersion(ctx, dcProjectId, created.id, { bytes: Buffer.from(d.text, 'utf8'), filename: d.filename, declaredType: 'text/plain', note: 'Demo synthetic content' }));
      ids.set(d.title, created.id);
      log(`documents: created "${d.title}"`);
    }

    // 3. Legal hold on the minutes extract (placed by Legal).
    const heldId = ids.get(DOCS.held.title)!;
    const held = await asUser('legal', (ctx) => docs.get(ctx, dcProjectId, heldId));
    if (!held.legalHold) {
      await asUser('legal', (ctx) => docs.setLegalHold(ctx, dcProjectId, heldId, { expectedVersion: held.version, hold: true, reason: 'Demo: legal hold example (synthetic)' }));
    }

    // 4. Evidence links for later gate / task use (unverified until reviewed by someone else).
    const charterId = ids.get(DOCS.charter.title)!;
    const tsaId = ids.get(DOCS.tsa.title)!;
    const targets = await asUser('pm', async () => {
      const tx = db.tx();
      const [criterion] = await tx
        .select({ id: schema.gateCriterion.id })
        .from(schema.gateCriterion)
        .innerJoin(schema.gateDefinition, eq(schema.gateDefinition.id, schema.gateCriterion.gateId))
        .where(eq(schema.gateCriterion.projectId, dcProjectId))
        .orderBy(asc(schema.gateDefinition.sortOrder), asc(schema.gateCriterion.sortOrder))
        .limit(1);
      const [tsaTask] = await tx
        .select({ id: schema.task.id })
        .from(schema.task)
        .where(and(eq(schema.task.projectId, dcProjectId), ilike(schema.task.title, '%TSA%')))
        .orderBy(asc(schema.task.wbsCode))
        .limit(1);
      const links = await tx
        .select({ documentId: schema.evidenceLink.documentId, targetId: schema.evidenceLink.targetId })
        .from(schema.evidenceLink)
        .where(and(eq(schema.evidenceLink.projectId, dcProjectId), inArray(schema.evidenceLink.documentId, [charterId, tsaId])));
      return { criterion: criterion?.id ?? null, tsaTask: tsaTask?.id ?? null, links };
    });
    const linked = (docId: string, targetId: string) => targets.links.some((l) => l.documentId === docId && l.targetId === targetId);
    if (targets.criterion && !linked(charterId, targets.criterion)) {
      await asUser('pm', (ctx) => evidence.link(ctx, dcProjectId, { targetType: 'gate_criterion', targetId: targets.criterion!, documentId: charterId, purpose: 'Demo: charter excerpt offered as evidence (unverified)' }));
      log('documents: evidence link charter → first gate criterion');
    }
    if (targets.tsaTask && !linked(tsaId, targets.tsaTask)) {
      await asUser('pm', (ctx) => evidence.link(ctx, dcProjectId, { targetType: 'task', targetId: targets.tsaTask!, documentId: tsaId, purpose: 'Demo: TSA notes offered as working evidence (unverified)' }));
      log('documents: evidence link TSA notes → TSA task');
    }
  },
};
