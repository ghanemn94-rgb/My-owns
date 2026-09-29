import { z } from 'zod';
import { APPLICABILITY_STATUSES, APPROVAL_REGISTER_CATEGORIES, ENTITY_KINDS, INCORPORATION_STATUSES, REQUIREMENT_STATUSES } from '@hub/domain';
import { defineRoute, registerRoutes } from './route';
import { ClassificationSchema, ExpectedVersion, IsoDate, PageQuery, ProjectParams, RequiredText, Text, Uuid, VerificationStatusSchema, idParams, paged } from './common';

/**
 * NewCo: legal entities, incorporation status with verification (kept separate from transfers and operations — AT-06),
 * regulatory / external-party / internal approvals (spec §3 G2, §7.2, §21 step 2; REQ-LCY-007, REQ-SET-010,
 * REQ-AGR-004/005/007). The platform records specialist assessments with evidence; it never determines them.
 */

const T = ['newco'];
const p = (s: string) => `/api/v1/projects/:projectId${s}`;

export const EntityKindSchema = z.enum(ENTITY_KINDS);
export const IncorporationStatusSchema = z.enum(INCORPORATION_STATUSES);
export const ApplicabilitySchema = z.enum(APPLICABILITY_STATUSES);
export const RequirementStatusSchema = z.enum(REQUIREMENT_STATUSES);
export const ApprovalCategorySchema = z.enum(APPROVAL_REGISTER_CATEGORIES);
export const REQUIREMENT_PROGRESS_COMMANDS = ['start_preparation', 'submit', 'withdraw', 'mark_expired', 'reopen'] as const;
export const REQUIREMENT_OUTCOME_COMMANDS = ['record_grant', 'record_grant_with_conditions', 'record_refusal'] as const;
export const REQUIREMENT_ORIGINS = ['manual', 'source_extraction', 'import'] as const;

const Person = z.object({ userId: Uuid, name: z.string().nullable() }).nullable();
const EvidenceCounts = z.object({ active: z.number().int(), conflicting: z.number().int() });

export const StatusDimensionsSummary = z.object({
  items: z.array(z.object({ key: z.string(), state: z.string(), explanation: z.string().nullable() })),
  /** Computed by the gates module (StatusDimensionsService) — incorporation alone never completes the carve-out. */
  carveOutComplete: z.boolean(),
});

export const IncorporationDto = z.object({
  status: IncorporationStatusSchema,
  verification: VerificationStatusSchema,
  evidenceNote: z.string().nullable(),
  recordedBy: Person,
  recordedAt: z.string().nullable(),
  verifiedBy: Person,
  verifiedAt: z.string().nullable(),
  verificationNote: z.string().nullable(),
});

export const LegalEntityDto = z.object({
  id: Uuid,
  name: z.string(),
  kind: EntityKindSchema,
  /** Role of the entity in THIS project (one entity may take part in several projects). */
  role: EntityKindSchema,
  registrationRef: z.string().nullable(),
  jurisdiction: z.string().nullable(),
  incorporation: IncorporationDto,
  evidence: EvidenceCounts,
  isDemo: z.boolean(),
  version: z.number().int(),
});

export const LegalEntityDetailDto = LegalEntityDto.extend({
  requirements: z.array(z.object({ id: Uuid, code: z.string(), title: z.string(), status: RequirementStatusSchema, applicability: ApplicabilitySchema })),
  history: z.array(z.object({ versionNo: z.number().int(), reason: z.string().nullable(), changedByName: z.string().nullable(), changedAt: z.string() })),
});

export const CreateLegalEntityBody = z
  .object({ name: RequiredText(300), kind: EntityKindSchema, role: EntityKindSchema.optional(), registrationRef: Text(200).optional(), jurisdiction: Text(200).optional() })
  .strict();
export const LinkLegalEntityBody = z.object({ legalEntityId: Uuid, role: EntityKindSchema }).strict();
export const UpdateLegalEntityBody = z
  .object({ expectedVersion: ExpectedVersion, name: RequiredText(300).optional(), registrationRef: Text(200).nullable().optional(), jurisdiction: Text(200).nullable().optional() })
  .strict();
export const RecordIncorporationBody = z
  .object({ expectedVersion: ExpectedVersion, status: IncorporationStatusSchema, evidenceNote: Text(2000).optional(), note: Text(2000).optional() })
  .strict();
export const VerifyIncorporationBody = z.object({ expectedVersion: ExpectedVersion, outcome: z.enum(['confirm', 'reject']), note: Text(2000).optional() }).strict();
export const IncorporationResult = z.object({
  id: Uuid,
  version: z.number().int(),
  status: IncorporationStatusSchema,
  verification: VerificationStatusSchema,
  statusDimensions: StatusDimensionsSummary,
});

export const SetupNewcoStatusBody = z
  .object({
    mode: z.enum(['existing', 'new']),
    legalEntityId: Uuid.optional(),
    name: Text(300).optional(),
    status: z.enum(['incorporated', 'incorporation_in_progress', 'unconfirmed']),
    registrationRef: Text(200).optional(),
    /** Evidence linked through the documents module (a document version or a note). */
    evidence: z.object({ documentId: Uuid.optional(), documentVersionId: Uuid.optional(), note: Text(2000).optional() }).strict().optional(),
    note: Text(2000).optional(),
  })
  .strict()
  .refine((b) => (b.mode === 'existing' ? !!b.legalEntityId : !!b.name?.trim()), { message: 'existing → legalEntityId; new → name' });

// ---------------------------------------------------------------------------------------------------------
// Regulatory / external-party / internal approvals

export const RegulatoryRequirementDto = z.object({
  id: Uuid,
  code: z.string(),
  category: ApprovalCategorySchema,
  /** Authority as named in the source (never expanded without confirmation). */
  authority: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  origin: z.enum(REQUIREMENT_ORIGINS),
  sourceReference: z.string().nullable(),
  applicability: ApplicabilitySchema,
  /** "Assessment pending — specialist" until a specialist determines applicability (REQ-AGR-007). */
  applicabilityLabel: z.string(),
  applicabilityAssessment: z.object({ assessedBy: Person, assessedAt: z.string().nullable(), basis: z.string().nullable() }),
  status: RequirementStatusSchema,
  owner: Person,
  submittedOn: z.string().nullable(),
  decisionOn: z.string().nullable(),
  conditions: z.string().nullable(),
  conditionsState: z.enum(['none', 'open', 'satisfied']),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  validityState: z.enum(['not_granted', 'no_expiry_recorded', 'not_yet_valid', 'valid', 'expiring', 'expired']),
  outcomeRecordedBy: Person,
  legalEntity: z.object({ id: Uuid, name: z.string() }).nullable(),
  gateKey: z.string().nullable(),
  verificationStatus: VerificationStatusSchema,
  evidence: EvidenceCounts,
  allowedCommands: z.array(z.string()),
  classification: ClassificationSchema,
  isDemo: z.boolean(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export const RegulatoryListQuery = PageQuery.extend({
  category: ApprovalCategorySchema.optional(),
  applicability: ApplicabilitySchema.optional(),
  status: RequirementStatusSchema.optional(),
  validity: z.enum(['expired', 'expiring']).optional(),
});
export const CreateRegulatoryBody = z
  .object({
    category: ApprovalCategorySchema,
    authority: RequiredText(200),
    title: RequiredText(300),
    description: Text(4000).optional(),
    origin: z.enum(REQUIREMENT_ORIGINS).default('manual'),
    sourceReference: Text(1000).optional(),
    ownerUserId: Uuid.optional(),
    legalEntityId: Uuid.optional(),
    gateKey: z.string().trim().regex(/^G[0-9]{1,2}$/).optional(),
    classification: ClassificationSchema.optional(),
  })
  .strict();
export const UpdateRegulatoryBody = z
  .object({
    expectedVersion: ExpectedVersion,
    title: RequiredText(300).optional(),
    authority: RequiredText(200).optional(),
    description: Text(4000).nullable().optional(),
    sourceReference: Text(1000).nullable().optional(),
    ownerUserId: Uuid.nullable().optional(),
    legalEntityId: Uuid.nullable().optional(),
    gateKey: z.string().trim().regex(/^G[0-9]{1,2}$/).nullable().optional(),
    classification: ClassificationSchema.optional(),
  })
  .strict();
export const AssessApplicabilityBody = z.object({ expectedVersion: ExpectedVersion, applicability: ApplicabilitySchema, basis: RequiredText(2000) }).strict();
export const RequirementProgressBody = z
  .object({ expectedVersion: ExpectedVersion, command: z.enum(REQUIREMENT_PROGRESS_COMMANDS), date: IsoDate.optional(), note: Text(2000).optional() })
  .strict();
export const RequirementOutcomeBody = z
  .object({
    expectedVersion: ExpectedVersion,
    command: z.enum(REQUIREMENT_OUTCOME_COMMANDS),
    date: IsoDate,
    conditions: Text(4000).optional(),
    validFrom: IsoDate.optional(),
    validTo: IsoDate.optional(),
    note: Text(2000).optional(),
  })
  .strict();
export const ConditionsSatisfiedBody = z.object({ expectedVersion: ExpectedVersion, note: RequiredText(2000) }).strict();
export const RequirementResult = z.object({
  id: Uuid,
  status: RequirementStatusSchema,
  applicability: ApplicabilitySchema,
  applicabilityLabel: z.string(),
  validityState: RegulatoryRequirementDto.shape.validityState,
  conditionsState: RegulatoryRequirementDto.shape.conditionsState,
  version: z.number().int(),
});

// ---------------------------------------------------------------------------------------------------------
// Routes

const EntityP = idParams('entityId');
const ReqP = idParams('requirementId');
const VersionResult = z.object({ id: Uuid, version: z.number().int() });

export const newcoRoutes = registerRoutes({
  listLegalEntities: defineRoute({ id: 'newco.listLegalEntities', method: 'GET', path: p('/legal-entities'), summary: 'Legal entities taking part in the project, with incorporation status and verification', tags: T, access: 'newco.register.read', params: ProjectParams, response: z.object({ items: z.array(LegalEntityDto) }) }),
  getLegalEntity: defineRoute({ id: 'newco.getLegalEntity', method: 'GET', path: p('/legal-entities/:entityId'), summary: 'Legal entity with incorporation history and linked requirements', tags: T, access: 'newco.register.read', params: EntityP, response: LegalEntityDetailDto }),
  createLegalEntity: defineRoute({ id: 'newco.createLegalEntity', method: 'POST', path: p('/legal-entities'), summary: 'Create a legal entity and link it to the project (status starts unconfirmed)', tags: T, access: 'newco.legal_entity.manage', params: ProjectParams, body: CreateLegalEntityBody, response: VersionResult }),
  linkLegalEntity: defineRoute({ id: 'newco.linkLegalEntity', method: 'POST', path: p('/legal-entities/link'), summary: 'Link an existing entity (visible to you in another project, or unlinked) to this project', tags: T, access: 'newco.legal_entity.manage', params: ProjectParams, body: LinkLegalEntityBody, response: VersionResult }),
  updateLegalEntity: defineRoute({ id: 'newco.updateLegalEntity', method: 'PATCH', path: p('/legal-entities/:entityId'), summary: 'Edit descriptive fields (never the incorporation status)', tags: T, access: 'newco.legal_entity.manage', params: EntityP, body: UpdateLegalEntityBody, response: VersionResult }),
  recordIncorporation: defineRoute({ id: 'newco.recordIncorporation', method: 'POST', path: p('/legal-entities/:entityId/incorporation'), summary: 'Record the incorporation status with evidence (proposed until verified)', tags: T, access: 'newco.incorporation.manage', command: true, params: EntityP, body: RecordIncorporationBody, response: IncorporationResult }),
  verifyIncorporation: defineRoute({ id: 'newco.verifyIncorporation', method: 'POST', path: p('/legal-entities/:entityId/incorporation/verify'), summary: 'Verify (or reject) the recorded status against evidence — not the recorder; transfers and operations are unaffected (AT-06)', tags: T, access: 'newco.incorporation.verify', command: true, params: EntityP, body: VerifyIncorporationBody, response: IncorporationResult }),
  setupNewcoStatus: defineRoute({ id: 'newco.setupNewcoStatus', method: 'POST', path: p('/setup/steps/newco-status'), summary: 'Setup wizard step 2: NewCo status (incorporated / in progress / unconfirmed) with evidence', tags: T, access: 'newco.incorporation.manage', command: true, params: ProjectParams, body: SetupNewcoStatusBody, response: IncorporationResult }),

  listRequirements: defineRoute({ id: 'newco.listRequirements', method: 'GET', path: p('/regulatory-requirements'), summary: 'Regulatory, external-party and internal approval register with applicability, conditions and validity', tags: T, access: 'newco.register.read', params: ProjectParams, query: RegulatoryListQuery, response: paged(RegulatoryRequirementDto) }),
  getRequirement: defineRoute({ id: 'newco.getRequirement', method: 'GET', path: p('/regulatory-requirements/:requirementId'), summary: 'Register entry', tags: T, access: 'newco.register.read', params: ReqP, response: RegulatoryRequirementDto }),
  createRequirement: defineRoute({ id: 'newco.createRequirement', method: 'POST', path: p('/regulatory-requirements'), summary: 'Register a requirement / approval (applicability: Assessment pending — specialist)', tags: T, access: 'newco.regulatory.manage', params: ProjectParams, body: CreateRegulatoryBody, response: z.object({ id: Uuid, code: z.string(), version: z.number().int() }) }),
  updateRequirement: defineRoute({ id: 'newco.updateRequirement', method: 'PATCH', path: p('/regulatory-requirements/:requirementId'), summary: 'Edit descriptive fields (never applicability, status or validity)', tags: T, access: 'newco.regulatory.manage', params: ReqP, body: UpdateRegulatoryBody, response: VersionResult }),
  assessApplicability: defineRoute({ id: 'newco.assessApplicability', method: 'POST', path: p('/regulatory-requirements/:requirementId/assess-applicability'), summary: 'Specialist applicability assessment with basis (not the registrant)', tags: T, access: 'newco.regulatory.verify', command: true, params: ReqP, body: AssessApplicabilityBody, response: RequirementResult }),
  requirementProgress: defineRoute({ id: 'newco.requirementProgress', method: 'POST', path: p('/regulatory-requirements/:requirementId/status'), summary: 'Progress command: start preparation, submit, withdraw, mark expired, reopen', tags: T, access: 'newco.regulatory.manage', command: true, params: ReqP, body: RequirementProgressBody, response: RequirementResult }),
  recordRequirementOutcome: defineRoute({ id: 'newco.recordRequirementOutcome', method: 'POST', path: p('/regulatory-requirements/:requirementId/record-outcome'), summary: "Record the authority's grant / conditional grant / refusal with evidence and validity (not the registrant)", tags: T, access: 'newco.regulatory.verify', command: true, params: ReqP, body: RequirementOutcomeBody, response: RequirementResult }),
  conditionsSatisfied: defineRoute({ id: 'newco.conditionsSatisfied', method: 'POST', path: p('/regulatory-requirements/:requirementId/conditions-satisfied'), summary: 'Confirm with evidence that the conditions of a conditional approval are satisfied', tags: T, access: 'newco.regulatory.verify', command: true, params: ReqP, body: ConditionsSatisfiedBody, response: RequirementResult }),
});
