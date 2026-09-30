import { z } from 'zod';
import {
  AGREEMENT_STAGES,
  CONSENT_STATUSES,
  CONTRACT_TRANSFER_CLASSES,
  IMPACT_AREAS,
  PERIMETER_DISPOSITIONS,
  PERIMETER_ITEM_TYPES,
  TRANSFER_ASPECTS,
  TRANSFER_STATUSES,
} from '@hub/domain';
import { defineRoute, registerRoutes } from './route';
import {
  ClassificationSchema,
  ExpectedVersion,
  IsoDate,
  MoneySchema,
  PageQuery,
  ProjectParams,
  RequiredText,
  SortParam,
  Text,
  Uuid,
  VerificationStatusSchema,
  idParams,
  paged,
} from './common';

/**
 * Carve-out: transaction perimeter register, sites, transfers (legal/economic), reconciliation, perimeter versions,
 * agreements and consents (spec §7.1–7.2, §21 step 4; AT-07, AT-08; REQ-PER-*, REQ-AGR-001/002/003/006/008, REQ-SET-012).
 * Status/stage/disposition changes are explicit commands; every PATCH body is strict and descriptive only.
 */

const T = ['carveout'];
const p = (s: string) => `/api/v1/projects/:projectId${s}`;

export const PerimeterItemTypeSchema = z.enum(PERIMETER_ITEM_TYPES);
export const PerimeterDispositionSchema = z.enum(PERIMETER_DISPOSITIONS);
export const TransferStatusSchema = z.enum(TRANSFER_STATUSES);
export const TransferAspectSchema = z.enum(TRANSFER_ASPECTS);
export const ContractTransferClassSchema = z.enum(CONTRACT_TRANSFER_CLASSES);
export const ConsentStatusSchema = z.enum(CONSENT_STATUSES);
export const AgreementStageSchema = z.enum(AGREEMENT_STAGES);
export const ImpactAreaSchema = z.enum(IMPACT_AREAS);
export const SITE_KINDS = ['data_center', 'technical_room', 'office', 'warehouse', 'land', 'other'] as const;
export const CONSENT_KINDS = ['consent', 'novation', 'assignment', 'notification', 'other'] as const;
export const TRANSFER_RECORD_COMMANDS = ['plan', 'start', 'report_transferred', 'block', 'unblock', 'mark_not_applicable'] as const;
export const AGREEMENT_COMMANDS = ['start_drafting', 'start_negotiation', 'agree_in_principle', 'reopen_negotiation', 'record_signing', 'record_effective', 'terminate', 'record_expiry'] as const;
export const GateKeySchema = z.string().trim().regex(/^G[0-9]{1,2}$/, 'Gate key such as G1');

const VersionResult = z.object({ id: Uuid, version: z.number().int() });
const Person = z.object({ userId: Uuid, name: z.string().nullable() }).nullable();
const EvidenceCounts = z.object({ active: z.number().int(), conflicting: z.number().int() });
const HistoryEntry = z.object({ versionNo: z.number().int(), reason: z.string().nullable(), changedByName: z.string().nullable(), changedAt: z.string() });

// ---------------------------------------------------------------------------------------------------------
// Sites

export const SiteDto = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  kind: z.string(),
  notes: z.string().nullable(),
  isDemo: z.boolean(),
  version: z.number().int(),
});
export const CreateSiteBody = z.object({ name: RequiredText(300), city: Text(200).optional(), kind: z.enum(SITE_KINDS).default('data_center'), notes: Text(2000).optional() }).strict();
export const UpdateSiteBody = z
  .object({ expectedVersion: ExpectedVersion, name: RequiredText(300).optional(), city: Text(200).nullable().optional(), kind: z.enum(SITE_KINDS).optional(), notes: Text(2000).nullable().optional() })
  .strict();

// ---------------------------------------------------------------------------------------------------------
// Perimeter items

export const TransferViewDto = z.object({ legal: TransferStatusSchema, economic: TransferStatusSchema, combined: TransferStatusSchema });
export const PendingChangeDto = z.object({ id: Uuid, code: z.string(), status: z.string() }).nullable();

export const PerimeterItemSummaryDto = z.object({
  id: Uuid,
  code: z.string(),
  type: PerimeterItemTypeSchema,
  name: z.string(),
  siteId: Uuid.nullable(),
  siteCode: z.string().nullable(),
  workstreamId: Uuid.nullable(),
  workstreamCode: z.string().nullable(),
  owner: Person,
  disposition: PerimeterDispositionSchema,
  transfer: TransferViewDto,
  transferClass: ContractTransferClassSchema,
  consentRequired: z.boolean(),
  pendingChange: PendingChangeDto,
  /** Frozen into the approved planning baseline or the approved perimeter version. */
  inApprovedBaseline: z.boolean(),
  classification: ClassificationSchema,
  isDemo: z.boolean(),
  version: z.number().int(),
  updatedAt: z.string(),
});

export const ImpactRefDto = z.object({ type: z.string(), id: Uuid, code: z.string() });
export const ImpactEntryDto = z.object({
  area: ImpactAreaSchema,
  status: z.enum(['identified', 'assessment_pending', 'none_identified', 'not_visible']),
  summary: z.string(),
  references: z.array(ImpactRefDto),
});
/** Optional specialist narrative per impact area (kept beside the derived entries). */
export const ImpactNarrative = z
  .object({
    financial_statements: Text(2000).optional(),
    valuation: Text(2000).optional(),
    agreements: Text(2000).optional(),
    tsa: Text(2000).optional(),
    readiness: Text(2000).optional(),
    schedule: Text(2000).optional(),
    budget: Text(2000).optional(),
    transaction: Text(2000).optional(),
  })
  .strict();

export const ConsentSummaryDto = z.object({ id: Uuid, code: z.string(), kind: z.string(), counterparty: z.string(), status: ConsentStatusSchema, dueDate: z.string().nullable() });

export const Day1PositionDto = z.object({
  applicable: z.boolean(),
  consentGranted: z.boolean(),
  ok: z.boolean(),
  missing: z.array(z.string()),
  interimArrangement: z.string().nullable(),
  serviceAccountable: Person,
  billingAccountable: Person,
  slaAccountable: Person,
  remediationPlan: z.string().nullable(),
});

export const TransferRecordDto = z.object({
  id: Uuid,
  perimeterItemId: Uuid,
  itemCode: z.string(),
  aspect: TransferAspectSchema,
  command: z.string(),
  fromStatus: TransferStatusSchema,
  toStatus: TransferStatusSchema,
  mechanism: z.string().nullable(),
  effectiveDate: z.string().nullable(),
  note: z.string().nullable(),
  evidenceCount: z.number().int(),
  reviewsRecordId: Uuid.nullable(),
  recordedBy: Uuid,
  recordedByName: z.string().nullable(),
  recordedAt: z.string(),
});

export const PerimeterItemDetailDto = PerimeterItemSummaryDto.extend({
  description: z.string().nullable(),
  currentEntity: z.object({ id: Uuid, name: z.string() }).nullable(),
  targetEntity: z.object({ id: Uuid, name: z.string() }).nullable(),
  resolutionPath: z.string().nullable(),
  targetGateKey: z.string().nullable(),
  legalOwner: z.string().nullable(),
  operator: z.string().nullable(),
  economicBeneficiary: z.string().nullable(),
  legalDates: z.object({ planned: z.string().nullable(), actual: z.string().nullable() }),
  economicDates: z.object({ planned: z.string().nullable(), actual: z.string().nullable() }),
  transferMechanism: z.string().nullable(),
  agreement: z.object({ id: Uuid, code: z.string() }).nullable(),
  /** Reference values are shown only to holders of finance.record.read (REQ-PER-001 security rule). */
  referenceValue: MoneySchema.nullable(),
  referenceValueRestricted: z.boolean(),
  referenceValueSource: z.string().nullable(),
  dependencies: z.string().nullable(),
  risks: z.string().nullable(),
  acceptanceEvidenceNote: z.string().nullable(),
  transferClassAssessment: z.object({ assessedBy: Person, assessedAt: z.string().nullable(), basis: z.string().nullable() }),
  day1: Day1PositionDto,
  consents: z.array(ConsentSummaryDto),
  transfers: z.array(TransferRecordDto),
  evidence: z.object({ item: EvidenceCounts, transfer: EvidenceCounts }),
  history: z.array(HistoryEntry),
  allowedTransferCommands: z.object({ legal: z.array(z.string()), economic: z.array(z.string()) }),
  verificationStatus: VerificationStatusSchema,
  createdAt: z.string(),
});

export const PerimeterListQuery = PageQuery.extend({
  type: PerimeterItemTypeSchema.optional(),
  disposition: PerimeterDispositionSchema.optional(),
  siteId: Uuid.optional(),
  workstreamId: Uuid.optional(),
  /** Default order: code. */
  sort: SortParam(['code', 'name', 'type', 'disposition', 'updatedAt']),
});

export const CreatePerimeterItemBody = z
  .object({
    type: PerimeterItemTypeSchema,
    name: RequiredText(300),
    description: Text(4000).optional(),
    siteId: Uuid.optional(),
    workstreamId: Uuid.optional(),
    ownerUserId: Uuid.optional(),
    currentEntityId: Uuid.optional(),
    targetEntityId: Uuid.optional(),
    disposition: PerimeterDispositionSchema.default('pending'),
    resolutionPath: Text(2000).optional(),
    targetGateKey: GateKeySchema.optional(),
    legalOwner: Text(300).optional(),
    operator: Text(300).optional(),
    economicBeneficiary: Text(300).optional(),
    plannedEffectiveDate: IsoDate.optional(),
    economicPlannedEffectiveDate: IsoDate.optional(),
    transferMechanism: Text(1000).optional(),
    agreementId: Uuid.optional(),
    referenceValue: MoneySchema.optional(),
    referenceValueSource: Text(500).optional(),
    consentRequired: z.boolean().default(false),
    dependencies: Text(2000).optional(),
    risks: Text(2000).optional(),
    classification: ClassificationSchema.optional(),
    /** Why the item is added — required when the addition goes through change control (after baseline approval). */
    justification: Text(2000).optional(),
    impactNarrative: ImpactNarrative.optional(),
  })
  .strict();

export const ScopeChangeResult = z.object({
  id: Uuid,
  code: z.string(),
  version: z.number().int(),
  disposition: PerimeterDispositionSchema,
  /** false when the change was routed to a change request (AT-07) instead of being applied. */
  applied: z.boolean(),
  changeRequest: z.object({ id: Uuid, code: z.string(), status: z.string(), rebaseline: z.boolean() }).nullable(),
  impactAssessmentId: Uuid.nullable(),
});

export const UpdatePerimeterItemBody = z
  .object({
    expectedVersion: ExpectedVersion,
    name: RequiredText(300).optional(),
    description: Text(4000).nullable().optional(),
    workstreamId: Uuid.nullable().optional(),
    ownerUserId: Uuid.nullable().optional(),
    resolutionPath: Text(2000).nullable().optional(),
    targetGateKey: GateKeySchema.nullable().optional(),
    legalOwner: Text(300).nullable().optional(),
    operator: Text(300).nullable().optional(),
    economicBeneficiary: Text(300).nullable().optional(),
    plannedEffectiveDate: IsoDate.nullable().optional(),
    economicPlannedEffectiveDate: IsoDate.nullable().optional(),
    transferMechanism: Text(1000).nullable().optional(),
    agreementId: Uuid.nullable().optional(),
    referenceValue: MoneySchema.nullable().optional(),
    referenceValueSource: Text(500).nullable().optional(),
    consentRequired: z.boolean().optional(),
    dependencies: Text(2000).nullable().optional(),
    risks: Text(2000).nullable().optional(),
    acceptanceEvidenceNote: Text(2000).nullable().optional(),
    classification: ClassificationSchema.optional(),
  })
  .strict();

export const ClassifyPerimeterItemBody = z
  .object({
    expectedVersion: ExpectedVersion,
    disposition: PerimeterDispositionSchema,
    siteId: Uuid.nullable().optional(),
    currentEntityId: Uuid.nullable().optional(),
    targetEntityId: Uuid.nullable().optional(),
    justification: RequiredText(2000),
    impactNarrative: ImpactNarrative.optional(),
  })
  .strict();

export const ApplyPerimeterChangeBody = z.object({ expectedVersion: ExpectedVersion, changeRequestId: Uuid, note: Text(2000).optional() }).strict();
export const ApplyPerimeterChangeResult = z.object({
  id: Uuid,
  version: z.number().int(),
  disposition: PerimeterDispositionSchema,
  outcome: z.enum(['applied', 'closed_without_change']),
});

export const ImpactAssessmentBody = z.object({ narrative: ImpactNarrative.optional() }).strict();
export const ImpactAssessmentDto = z.object({
  id: Uuid,
  perimeterItemId: Uuid,
  changeRequestId: Uuid.nullable(),
  trigger: z.enum(['manual', 'change_request']),
  entries: z.array(ImpactEntryDto),
  narrative: z.record(z.string(), z.string()),
  assessedBy: Uuid,
  assessedByName: z.string().nullable(),
  createdAt: z.string(),
});

export const TransferabilityBody = z.object({ expectedVersion: ExpectedVersion, transferClass: ContractTransferClassSchema, basis: RequiredText(2000) }).strict();
export const TransferabilityResult = z.object({ id: Uuid, version: z.number().int(), transferClass: ContractTransferClassSchema, day1: Day1PositionDto });

export const InterimArrangementBody = z
  .object({
    expectedVersion: ExpectedVersion,
    interimArrangement: Text(4000).nullable().optional(),
    serviceAccountableUserId: Uuid.nullable().optional(),
    billingAccountableUserId: Uuid.nullable().optional(),
    slaAccountableUserId: Uuid.nullable().optional(),
    remediationPlan: Text(4000).nullable().optional(),
  })
  .strict();
export const InterimArrangementResult = z.object({ id: Uuid, version: z.number().int(), day1: Day1PositionDto });

// ---------------------------------------------------------------------------------------------------------
// Transfers

export const TransferListQuery = PageQuery.extend({
  perimeterItemId: Uuid.optional(),
  aspect: TransferAspectSchema.optional(),
  /** Default order: most recently recorded first. `itemCode` is the perimeter item code. */
  sort: SortParam(['recordedAt', 'effectiveDate', 'itemCode']),
});
export const RecordTransferBody = z
  .object({
    perimeterItemId: Uuid,
    aspect: TransferAspectSchema,
    command: z.enum(TRANSFER_RECORD_COMMANDS),
    /** Version of the perimeter item (the transfer status lives on the item). */
    expectedVersion: ExpectedVersion,
    mechanism: Text(1000).optional(),
    effectiveDate: IsoDate.optional(),
    note: Text(2000).optional(),
  })
  .strict();
export const VerifyTransferBody = z.object({ expectedVersion: ExpectedVersion, note: Text(2000).optional() }).strict();
/** DOM-P3-05: specialist determination that one aspect of an Included / Shared item does not transfer (basis required). */
export const TransferNotApplicableBody = z.object({ expectedVersion: ExpectedVersion, aspect: TransferAspectSchema, basis: RequiredText(2000) }).strict();
export const RejectTransferEvidenceBody = z.object({ expectedVersion: ExpectedVersion, reason: RequiredText(2000) }).strict();
export const TransferResult = z.object({
  /** The transfer record written — null when the command raised a change request instead (DOM-P3-05, AT-07). */
  id: Uuid.nullable(),
  perimeterItemId: Uuid,
  aspect: TransferAspectSchema,
  status: TransferStatusSchema,
  transfer: TransferViewDto,
  itemVersion: z.number().int(),
  /**
   * DOM-P3-05: "not applicable" on an aspect of an Included / Shared item that is in the approved baseline is raised as a
   * change request (the aspect is unchanged until the approved request is applied); null otherwise.
   */
  changeRequest: z.object({ id: Uuid, code: z.string(), status: z.string() }).nullable(),
});

// ---------------------------------------------------------------------------------------------------------
// Reconciliation, categories, Day-1 positions

export const ReconciliationDto = z.object({
  findings: z.array(z.object({ itemId: Uuid, code: z.string(), issue: z.string(), message: z.string() })),
  categories: z.array(
    z.object({
      category: PerimeterItemTypeSchema,
      items: z.number().int(),
      reviewed: z.boolean(),
      status: z.enum(['items_registered', 'reviewed_none_in_perimeter', 'unassessed']),
      conclusion: z.string().nullable(),
      /** Version of the category review (pass it as expectedVersion to update the review); null when not reviewed. */
      reviewVersion: z.number().int().nullable(),
    }),
  ),
  summary: z.object({
    items: z.number().int(),
    inScope: z.number().int(),
    excluded: z.number().int(),
    pending: z.number().int(),
    legalVerified: z.number().int(),
    economicVerified: z.number().int(),
    fullyVerified: z.number().int(),
    categoriesUnassessed: z.number().int(),
  }),
});
export const CategoryReviewBody = z.object({ conclusion: RequiredText(2000), expectedVersion: ExpectedVersion.optional() }).strict();

export const Day1PositionsDto = z.object({
  items: z.array(
    z.object({
      id: Uuid,
      code: z.string(),
      name: z.string(),
      type: PerimeterItemTypeSchema,
      disposition: PerimeterDispositionSchema,
      transferClass: ContractTransferClassSchema,
      classAssessed: z.boolean(),
      consents: z.array(ConsentSummaryDto),
      position: Day1PositionDto,
    }),
  ),
  summary: z.object({ total: z.number().int(), ok: z.number().int(), incomplete: z.number().int() }),
});

// ---------------------------------------------------------------------------------------------------------
// Perimeter versions (setup wizard step 4)

const Finding = z.object({ code: z.string(), issue: z.string() });
export const PerimeterVersionDto = z.object({
  id: Uuid,
  versionNo: z.number().int(),
  status: z.enum(['proposed', 'approved', 'rejected', 'superseded']),
  itemCount: z.number().int(),
  snapshotHash: z.string(),
  note: z.string().nullable(),
  proposedBy: Uuid,
  proposedByName: z.string().nullable(),
  createdAt: z.string(),
  decidedBy: Uuid.nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionId: Uuid.nullable(),
  decisionNote: z.string().nullable(),
  warnings: z.array(Finding),
  version: z.number().int(),
});
export const SetupPerimeterBody = z.object({ note: Text(2000).optional() }).strict();
export const ApprovePerimeterVersionBody = z.object({ expectedVersion: ExpectedVersion, decisionId: Uuid, note: Text(2000).optional() }).strict();
export const RejectPerimeterVersionBody = z.object({ expectedVersion: ExpectedVersion, reason: RequiredText(2000) }).strict();
export const PerimeterVersionResult = z.object({ id: Uuid, versionNo: z.number().int(), status: z.string(), version: z.number().int() });

// ---------------------------------------------------------------------------------------------------------
// Agreements

const Party = z.object({ name: RequiredText(300), role: Text(200).optional(), legalEntityId: Uuid.optional() }).strict();
export const AgreementSummaryDto = z.object({
  id: Uuid,
  code: z.string(),
  kindLabel: z.string(),
  /** The expansion is shown only once confirmed by an authorized owner; otherwise "Unconfirmed" (REQ-AGR-002). */
  kindExpansionDisplay: z.string(),
  kindExpansionConfirmed: z.boolean(),
  title: z.string(),
  stage: AgreementStageSchema,
  owner: Person,
  legalReviewer: Person,
  currentDraftVersion: z.string().nullable(),
  signingDate: z.string().nullable(),
  effectiveDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
  classification: ClassificationSchema,
  isDemo: z.boolean(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export const AgreementDetailDto = AgreementSummaryDto.extend({
  kindExpansionProposed: z.string().nullable(),
  kindExpansionConfirmation: z.object({ confirmedBy: Person, confirmedAt: z.string().nullable(), basis: z.string().nullable() }),
  parties: z.array(z.object({ name: z.string(), role: z.string().nullable(), legalEntityId: Uuid.nullable() })),
  scope: z.string().nullable(),
  outstandingIssues: z.string().nullable(),
  renewalDate: z.string().nullable(),
  obligations: z.string().nullable(),
  executedDocumentId: Uuid.nullable(),
  versions: z.array(
    z.object({ id: Uuid, versionLabel: z.string(), documentId: Uuid.nullable(), documentVersionId: Uuid.nullable(), note: z.string().nullable(), recordedByName: z.string().nullable(), createdAt: z.string() }),
  ),
  evidence: EvidenceCounts,
  perimeterItems: z.array(z.object({ id: Uuid, code: z.string() })),
  consents: z.array(ConsentSummaryDto),
  allowedCommands: z.array(z.string()),
  createdAt: z.string(),
});
export const AgreementListQuery = PageQuery.extend({
  stage: AgreementStageSchema.optional(),
  /** Default order: code. */
  sort: SortParam(['code', 'title', 'stage', 'signingDate', 'effectiveDate', 'expiryDate', 'updatedAt']),
});
export const CreateAgreementBody = z
  .object({
    kindLabel: RequiredText(64),
    kindExpansionProposed: Text(300).optional(),
    title: RequiredText(300),
    parties: z.array(Party).max(20).default([]),
    scope: Text(4000).optional(),
    ownerUserId: Uuid.optional(),
    legalReviewerUserId: Uuid.optional(),
    outstandingIssues: Text(4000).optional(),
    renewalDate: IsoDate.optional(),
    expiryDate: IsoDate.optional(),
    obligations: Text(4000).optional(),
    classification: ClassificationSchema.optional(),
  })
  .strict();
export const UpdateAgreementBody = z
  .object({
    expectedVersion: ExpectedVersion,
    title: RequiredText(300).optional(),
    kindExpansionProposed: Text(300).nullable().optional(),
    parties: z.array(Party).max(20).optional(),
    scope: Text(4000).nullable().optional(),
    ownerUserId: Uuid.nullable().optional(),
    legalReviewerUserId: Uuid.nullable().optional(),
    outstandingIssues: Text(4000).nullable().optional(),
    renewalDate: IsoDate.nullable().optional(),
    expiryDate: IsoDate.nullable().optional(),
    obligations: Text(4000).nullable().optional(),
    classification: ClassificationSchema.optional(),
  })
  .strict();
export const AgreementStageBody = z
  .object({
    expectedVersion: ExpectedVersion,
    command: z.enum(AGREEMENT_COMMANDS),
    signingDate: IsoDate.optional(),
    effectiveDate: IsoDate.optional(),
    expiryDate: IsoDate.optional(),
    executedDocumentId: Uuid.optional(),
    reason: Text(2000).optional(),
  })
  .strict();
export const AgreementStageResult = z.object({ id: Uuid, stage: AgreementStageSchema, version: z.number().int() });
export const AddAgreementVersionBody = z
  .object({ expectedVersion: ExpectedVersion, versionLabel: RequiredText(32), documentId: Uuid.optional(), documentVersionId: Uuid.optional(), note: Text(2000).optional() })
  .strict();
export const AddAgreementVersionResult = z.object({ id: Uuid, agreementId: Uuid, versionLabel: z.string(), version: z.number().int() });
export const ConfirmExpansionBody = z.object({ expectedVersion: ExpectedVersion, expansion: RequiredText(300), basis: RequiredText(2000) }).strict();
export const ConfirmExpansionResult = z.object({ id: Uuid, version: z.number().int(), kindExpansionDisplay: z.string() });

// ---------------------------------------------------------------------------------------------------------
// Consents

export const ConsentDto = z.object({
  id: Uuid,
  code: z.string(),
  perimeterItem: z.object({ id: Uuid, code: z.string() }).nullable(),
  agreement: z.object({ id: Uuid, code: z.string() }).nullable(),
  kind: z.string(),
  counterparty: z.string(),
  contractRef: z.string().nullable(),
  owner: Person,
  status: ConsentStatusSchema,
  requestedOn: z.string().nullable(),
  respondedOn: z.string().nullable(),
  dueDate: z.string().nullable(),
  overdue: z.boolean(),
  validTo: z.string().nullable(),
  conditions: z.string().nullable(),
  responseEvidenceNote: z.string().nullable(),
  responseDocumentId: Uuid.nullable(),
  responseRecordedBy: Person,
  responseRecordedAt: z.string().nullable(),
  classification: ClassificationSchema,
  isDemo: z.boolean(),
  version: z.number().int(),
});
export const ConsentListQuery = PageQuery.extend({
  perimeterItemId: Uuid.optional(),
  status: ConsentStatusSchema.optional(),
  /** Default order: code. */
  sort: SortParam(['code', 'counterparty', 'status', 'dueDate', 'updatedAt']),
});
export const CreateConsentBody = z
  .object({
    perimeterItemId: Uuid.optional(),
    agreementId: Uuid.optional(),
    kind: z.enum(CONSENT_KINDS).default('consent'),
    counterparty: RequiredText(300),
    contractRef: Text(300).optional(),
    ownerUserId: Uuid.optional(),
    dueDate: IsoDate.optional(),
    classification: ClassificationSchema.optional(),
  })
  .strict()
  .refine((b) => !!b.perimeterItemId || !!b.agreementId, { message: 'A consent relates to a perimeter item or an agreement' });
export const UpdateConsentBody = z
  .object({
    expectedVersion: ExpectedVersion,
    counterparty: RequiredText(300).optional(),
    contractRef: Text(300).nullable().optional(),
    ownerUserId: Uuid.nullable().optional(),
    dueDate: IsoDate.nullable().optional(),
    validTo: IsoDate.nullable().optional(),
    classification: ClassificationSchema.optional(),
  })
  .strict();
export const RecordConsentResponseBody = z
  .object({
    expectedVersion: ExpectedVersion,
    status: z.enum(['requested', 'granted', 'conditional', 'refused', 'not_required']),
    date: IsoDate,
    conditions: Text(4000).optional(),
    evidenceNote: Text(2000).optional(),
    documentId: Uuid.optional(),
    note: Text(2000).optional(),
  })
  .strict();
export const ConsentResult = z.object({ id: Uuid, status: ConsentStatusSchema, version: z.number().int() });

// ---------------------------------------------------------------------------------------------------------
// Routes

const ItemP = idParams('itemId');
const SiteP = idParams('siteId');
const TransferP = idParams('transferId');
const AgreementP = idParams('agreementId');
const ConsentP = idParams('consentId');
const VersionP = idParams('versionId');
const CategoryP = ProjectParams.extend({ category: PerimeterItemTypeSchema });
const Created = z.object({ id: Uuid, code: z.string(), version: z.number().int() });

export const carveoutRoutes = registerRoutes({
  // Sites ------------------------------------------------------------------------------------------------
  listSites: defineRoute({ id: 'carveout.listSites', method: 'GET', path: p('/sites'), summary: 'Sites of the project', tags: T, access: 'carveout.register.read', params: ProjectParams, response: z.object({ items: z.array(SiteDto) }) }),
  createSite: defineRoute({ id: 'carveout.createSite', method: 'POST', path: p('/sites'), summary: 'Register a site (reference record; perimeter membership is a perimeter item)', tags: T, access: 'carveout.perimeter.manage', params: ProjectParams, body: CreateSiteBody, response: Created }),
  updateSite: defineRoute({ id: 'carveout.updateSite', method: 'PATCH', path: p('/sites/:siteId'), summary: 'Edit descriptive site fields', tags: T, access: 'carveout.perimeter.manage', params: SiteP, body: UpdateSiteBody, response: VersionResult }),

  // Perimeter items --------------------------------------------------------------------------------------
  listPerimeterItems: defineRoute({ id: 'carveout.listPerimeterItems', method: 'GET', path: p('/perimeter-items'), summary: 'Transaction perimeter register (scope- and classification-filtered)', tags: T, access: 'carveout.register.read', params: ProjectParams, query: PerimeterListQuery, response: paged(PerimeterItemSummaryDto) }),
  getPerimeterItem: defineRoute({ id: 'carveout.getPerimeterItem', method: 'GET', path: p('/perimeter-items/:itemId'), summary: 'Perimeter item with legal/economic transfer, Day-1 position, consents and history', tags: T, access: 'carveout.register.read', params: ItemP, response: PerimeterItemDetailDto }),
  createPerimeterItem: defineRoute({
    id: 'carveout.createPerimeterItem',
    method: 'POST',
    path: p('/perimeter-items'),
    summary: 'Add a perimeter item. After baseline approval the item is held Pending and a change request with cross-module impacts is raised (AT-07)',
    tags: T,
    access: 'carveout.perimeter.manage',
    command: true,
    params: ProjectParams,
    body: CreatePerimeterItemBody,
    response: ScopeChangeResult,
  }),
  updatePerimeterItem: defineRoute({ id: 'carveout.updatePerimeterItem', method: 'PATCH', path: p('/perimeter-items/:itemId'), summary: 'Edit descriptive fields (never disposition, scope or transfer status)', tags: T, access: 'carveout.perimeter.manage', params: ItemP, body: UpdatePerimeterItemBody, response: VersionResult }),
  classifyPerimeterItem: defineRoute({
    id: 'carveout.classifyPerimeterItem',
    method: 'POST',
    path: p('/perimeter-items/:itemId/classify'),
    summary: 'Change disposition / site / entities (justified, versioned). After baseline approval a change request is raised instead (REQ-PER-002/005)',
    tags: T,
    access: 'carveout.perimeter.manage',
    command: true,
    params: ItemP,
    body: ClassifyPerimeterItemBody,
    response: ScopeChangeResult,
  }),
  applyPerimeterChange: defineRoute({ id: 'carveout.applyPerimeterChange', method: 'POST', path: p('/perimeter-items/:itemId/apply-change'), summary: 'Apply an APPROVED change request (or close a rejected/withdrawn one without change)', tags: T, access: 'carveout.perimeter.manage', command: true, params: ItemP, body: ApplyPerimeterChangeBody, response: ApplyPerimeterChangeResult }),
  assessPerimeterImpact: defineRoute({ id: 'carveout.assessPerimeterImpact', method: 'POST', path: p('/perimeter-items/:itemId/impact-assessment'), summary: 'Record the cross-module impact assessment of the item (financials, valuation, agreements, TSA, readiness, schedule, budget)', tags: T, access: 'carveout.perimeter.manage', params: ItemP, body: ImpactAssessmentBody, response: ImpactAssessmentDto }),
  listPerimeterImpacts: defineRoute({ id: 'carveout.listPerimeterImpacts', method: 'GET', path: p('/perimeter-items/:itemId/impact-assessments'), summary: 'Impact assessment history of the item', tags: T, access: 'carveout.register.read', params: ItemP, response: z.object({ items: z.array(ImpactAssessmentDto) }) }),
  setTransferability: defineRoute({ id: 'carveout.setTransferability', method: 'POST', path: p('/perimeter-items/:itemId/transferability'), summary: 'Specialist transferability classification (REQ-AGR-006)', tags: T, access: 'carveout.contract.classify', command: true, params: ItemP, body: TransferabilityBody, response: TransferabilityResult }),
  setInterimArrangement: defineRoute({ id: 'carveout.setInterimArrangement', method: 'POST', path: p('/perimeter-items/:itemId/interim-arrangement'), summary: 'Day-1 fallback of a contract that cannot transfer: interim arrangement, service/billing/SLA owners, remediation (AT-08)', tags: T, access: 'carveout.consent.manage', params: ItemP, body: InterimArrangementBody, response: InterimArrangementResult }),

  // Transfers --------------------------------------------------------------------------------------------
  listTransfers: defineRoute({ id: 'carveout.listTransfers', method: 'GET', path: p('/transfers'), summary: 'Transfer history (legal and economic aspects)', tags: T, access: 'carveout.register.read', params: ProjectParams, query: TransferListQuery, response: paged(TransferRecordDto) }),
  recordTransfer: defineRoute({
    id: 'carveout.recordTransfer',
    method: 'POST',
    path: p('/transfers'),
    summary:
      'Record a transfer command on the legal or economic aspect of an item. "not applicable" on an Included / Shared item raises a change request once the item is in the approved baseline; before, it is a specialist determination (DOM-P3-05)',
    tags: T,
    access: 'carveout.transfer.manage',
    command: true,
    params: ProjectParams,
    body: RecordTransferBody,
    response: TransferResult,
  }),
  determineTransferNotApplicable: defineRoute({
    id: 'carveout.determineTransferNotApplicable',
    method: 'POST',
    path: p('/perimeter-items/:itemId/transfer-not-applicable'),
    summary: 'Specialist determination (basis required; not the item owner or creator) that one aspect of an Included / Shared item not yet in an approved baseline does not transfer — never both aspects (DOM-P3-05)',
    tags: T,
    access: 'carveout.transfer.verify',
    command: true,
    params: ItemP,
    body: TransferNotApplicableBody,
    response: TransferResult,
  }),
  verifyTransfer: defineRoute({ id: 'carveout.verifyTransfer', method: 'POST', path: p('/transfers/:transferId/verify'), summary: 'verifyTransfer: accept a reported transfer with active evidence (not the reporter)', tags: T, access: 'carveout.transfer.verify', command: true, params: TransferP, body: VerifyTransferBody, response: TransferResult }),
  rejectTransferEvidence: defineRoute({ id: 'carveout.rejectTransferEvidence', method: 'POST', path: p('/transfers/:transferId/reject-evidence'), summary: 'Reject the evidence of a reported transfer (reason required; not the reporter)', tags: T, access: 'carveout.transfer.verify', command: true, params: TransferP, body: RejectTransferEvidenceBody, response: TransferResult }),

  // Reconciliation / categories / Day-1 --------------------------------------------------------------------
  reconciliation: defineRoute({ id: 'carveout.reconciliation', method: 'GET', path: p('/perimeter/reconciliation'), summary: 'Items without transfer plan/evidence/consent, category coverage and summary (within caller scope)', tags: T, access: 'carveout.register.read', params: ProjectParams, response: ReconciliationDto }),
  reviewCategory: defineRoute({ id: 'carveout.reviewCategory', method: 'POST', path: p('/perimeter/categories/:category/review'), summary: 'Record that a perimeter category was assessed with no item in the perimeter', tags: T, access: 'carveout.perimeter.manage', params: CategoryP, body: CategoryReviewBody, response: z.object({ category: PerimeterItemTypeSchema, version: z.number().int() }) }),
  day1Positions: defineRoute({ id: 'carveout.day1Positions', method: 'GET', path: p('/perimeter/day1-contract-positions'), summary: 'Day-1 position of in-scope contracts: consent or interim arrangement, accountable owners, remediation (AT-08)', tags: T, access: 'carveout.register.read', params: ProjectParams, response: Day1PositionsDto }),

  // Perimeter versions -----------------------------------------------------------------------------------
  listPerimeterVersions: defineRoute({ id: 'carveout.listPerimeterVersions', method: 'GET', path: p('/perimeter/versions'), summary: 'Perimeter versions (proposed / approved / superseded)', tags: T, access: 'carveout.register.read', params: ProjectParams, response: z.object({ items: z.array(PerimeterVersionDto) }) }),
  setupPerimeterStep: defineRoute({ id: 'carveout.setupPerimeterStep', method: 'POST', path: p('/setup/steps/perimeter'), summary: 'Setup wizard step 4: freeze the perimeter, workstreams and owners as a proposed perimeter version', tags: T, access: 'carveout.perimeter.manage', command: true, params: ProjectParams, body: SetupPerimeterBody, response: PerimeterVersionDto }),
  approvePerimeterVersion: defineRoute({ id: 'carveout.approvePerimeterVersion', method: 'POST', path: p('/perimeter/versions/:versionId/approve'), summary: 'Approve a perimeter version (not the proposer; backed by a final governance decision)', tags: T, access: 'carveout.perimeter.approve', command: true, params: VersionP, body: ApprovePerimeterVersionBody, response: PerimeterVersionResult }),
  rejectPerimeterVersion: defineRoute({ id: 'carveout.rejectPerimeterVersion', method: 'POST', path: p('/perimeter/versions/:versionId/reject'), summary: 'Reject a proposed perimeter version (reason required)', tags: T, access: 'carveout.perimeter.approve', command: true, params: VersionP, body: RejectPerimeterVersionBody, response: PerimeterVersionResult }),

  // Agreements -------------------------------------------------------------------------------------------
  listAgreements: defineRoute({ id: 'carveout.listAgreements', method: 'GET', path: p('/agreements'), summary: 'Agreement register (ATA/TSA/MSA/SHA… as source labels)', tags: T, access: 'carveout.register.read', params: ProjectParams, query: AgreementListQuery, response: paged(AgreementSummaryDto) }),
  getAgreement: defineRoute({ id: 'carveout.getAgreement', method: 'GET', path: p('/agreements/:agreementId'), summary: 'Agreement with versions, parties, obligations and linked items', tags: T, access: 'carveout.register.read', params: AgreementP, response: AgreementDetailDto }),
  createAgreement: defineRoute({ id: 'carveout.createAgreement', method: 'POST', path: p('/agreements'), summary: 'Register an agreement (expansion of the label stays Unconfirmed)', tags: T, access: 'carveout.agreement.manage', params: ProjectParams, body: CreateAgreementBody, response: Created }),
  updateAgreement: defineRoute({ id: 'carveout.updateAgreement', method: 'PATCH', path: p('/agreements/:agreementId'), summary: 'Edit descriptive fields (never the stage)', tags: T, access: 'carveout.agreement.manage', params: AgreementP, body: UpdateAgreementBody, response: VersionResult }),
  agreementStage: defineRoute({ id: 'carveout.agreementStage', method: 'POST', path: p('/agreements/:agreementId/stage'), summary: 'Negotiation stage command (signing needs a legal reviewer and the executed copy)', tags: T, access: 'carveout.agreement.manage', command: true, params: AgreementP, body: AgreementStageBody, response: AgreementStageResult }),
  addAgreementVersion: defineRoute({ id: 'carveout.addAgreementVersion', method: 'POST', path: p('/agreements/:agreementId/versions'), summary: 'Record a negotiated draft version', tags: T, access: 'carveout.agreement.manage', params: AgreementP, body: AddAgreementVersionBody, response: AddAgreementVersionResult }),
  confirmAgreementExpansion: defineRoute({ id: 'carveout.confirmAgreementExpansion', method: 'POST', path: p('/agreements/:agreementId/confirm-expansion'), summary: "Owner / legal reviewer confirms what the label stands for (REQ-AGR-002)", tags: T, access: 'carveout.agreement.manage', command: true, params: AgreementP, body: ConfirmExpansionBody, response: ConfirmExpansionResult }),

  // Consents ---------------------------------------------------------------------------------------------
  listConsents: defineRoute({ id: 'carveout.listConsents', method: 'GET', path: p('/consents'), summary: 'Consent / novation / assignment requests', tags: T, access: 'carveout.register.read', params: ProjectParams, query: ConsentListQuery, response: paged(ConsentDto) }),
  createConsent: defineRoute({ id: 'carveout.createConsent', method: 'POST', path: p('/consents'), summary: 'Track a consent request to a counterparty', tags: T, access: 'carveout.consent.manage', params: ProjectParams, body: CreateConsentBody, response: Created }),
  updateConsent: defineRoute({ id: 'carveout.updateConsent', method: 'PATCH', path: p('/consents/:consentId'), summary: 'Edit descriptive fields (never the status)', tags: T, access: 'carveout.consent.manage', params: ConsentP, body: UpdateConsentBody, response: VersionResult }),
  recordConsentResponse: defineRoute({ id: 'carveout.recordConsentResponse', method: 'POST', path: p('/consents/:consentId/record-response'), summary: 'Record request / response with evidence (not-required needs a specialist)', tags: T, access: 'carveout.consent.manage', command: true, params: ConsentP, body: RecordConsentResponseBody, response: ConsentResult }),
});
