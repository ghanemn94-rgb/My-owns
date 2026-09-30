import { z } from 'zod';
import {
  APPROVAL_REQUEST_STATUSES,
  APPROVAL_STATES,
  BENEFIT_STATUSES,
  FINANCIAL_CATEGORIES,
  FINANCIAL_KINDS,
  KPI_DIRECTIONS,
  MODEL_CASES,
  MODEL_KINDS,
  OUTPUT_MEASURES,
  RECONCILIATION_FLAGS,
  RECONCILIATION_STATUSES,
  SEPARATION_COST_CATEGORIES,
  SOURCE_TYPES,
  VALUE_BASES,
} from '@hub/domain';
import { defineRoute, registerRoutes } from './route';
import {
  ClassificationSchema,
  Currency,
  DecimalString,
  ExpectedVersion,
  IsoDate,
  MoneySchema,
  PageQuery,
  ProjectParams,
  RequiredText,
  ServerMessageSchema,
  SortParam,
  Text,
  UnitScale,
  Uuid,
  paged,
} from './common';

/**
 * Finance & value (spec §7.5; REQ-FIN-001..010, REQ-DAT-004, AT-29): baseline / forecast / actual figures with currency,
 * unit, period and source; budget lines (approved vs committed vs spent); separation cost view (TSA charge counted once);
 * intercompany reconciliation; versioned business plans / valuation cases with proposed vs approved values; value-basis
 * checks; benefits register; KPIs. Money is always a decimal string + ISO currency + unit scale. Status changes are
 * explicit commands; PATCH routes change descriptive fields only. The platform is not a valuation engine.
 */

const Kind = z.enum(FINANCIAL_KINDS);
const Category = z.enum(FINANCIAL_CATEGORIES);
const AState = z.enum(APPROVAL_STATES);
const Measure = z.enum(OUTPUT_MEASURES);
const Basis = z.enum(VALUE_BASES);
const BStatus = z.enum(BENEFIT_STATUSES);
const RStatus = z.enum(RECONCILIATION_STATUSES);
const Messages = z.array(ServerMessageSchema);
const Evidence = z.object({ active: z.number().int(), conflicting: z.number().int() });
const PeopleDto = z.record(z.string(), z.string());
const VersionResult = z.object({ id: Uuid, version: z.number().int() });
const Period = z.string().trim().min(4).max(16);
const LineRef = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:/-]+$/, 'Letters, digits and . _ : / - only');
const CellRef = z.string().trim().min(1).max(64);
const SheetRef = z.string().trim().min(1).max(128);
const RATE = /^\d{1,10}(\.\d{1,10})?$/;

/** An explicit conversion basis supplied by a person: 1 `from` = `rate` `to`, with its source and rate date (AT-29). */
export const ConversionBasisSchema = z
  .object({ from: Currency, to: Currency, rate: z.string().regex(RATE, 'Positive decimal rate'), source: RequiredText(300), asOf: IsoDate })
  .strict();

// ---------------------------------------------------------------------------------------------------------------
// Shared DTOs

/** Human financial validation → approval (REQ-FIN-010): who prepared, validated and approved, and whether it still holds. */
export const FigureApprovalDto = z.object({
  state: AState,
  preparedBy: Uuid.nullable(),
  validatedBy: Uuid.nullable(),
  validatedAt: z.string().nullable(),
  validationNote: z.string().nullable(),
  /** The recorded validation covers the current content (false after a change → validate again). */
  validationCurrent: z.boolean(),
  approvalRequestId: Uuid.nullable(),
  approvalRequestStatus: z.enum(APPROVAL_REQUEST_STATUSES).nullable(),
  approvalDecisionId: Uuid.nullable(),
  approvedBy: Uuid.nullable(),
  approvedAt: z.string().nullable(),
  /** Business date of the approval in the project timezone. */
  approvalDate: z.string().nullable(),
});

const FigureCommandResult = z.object({ id: Uuid, approvalState: AState, version: z.number().int() });

// ---------------------------------------------------------------------------------------------------------------
// Snapshots

export const FinancialSnapshotDto = z.object({
  id: Uuid,
  kind: Kind,
  category: Category,
  lineRef: z.string(),
  label: z.string(),
  period: z.string(),
  amount: MoneySchema,
  sourceType: z.enum(SOURCE_TYPES),
  sourceRef: z.string().nullable(),
  sourceDocumentId: Uuid.nullable(),
  sourceDocumentVersionId: Uuid.nullable(),
  sourceSheet: z.string().nullable(),
  sourceCell: z.string().nullable(),
  importBatchId: Uuid.nullable(),
  tsaServiceId: Uuid.nullable(),
  workstreamId: Uuid.nullable(),
  approvalState: AState,
  validatedBy: Uuid.nullable(),
  approvedBy: Uuid.nullable(),
  approvedAt: z.string().nullable(),
  approvalDate: z.string().nullable(),
  classification: ClassificationSchema,
  isDemo: z.boolean(),
  createdAt: z.string(),
  createdBy: Uuid.nullable(),
  updatedAt: z.string(),
  version: z.number().int(),
});

export const IntercompanyReconciliationDto = z.object({
  id: Uuid,
  code: z.string(),
  financialSnapshotId: Uuid.nullable(),
  counterpartyLabel: z.string(),
  period: z.string(),
  ourBalance: MoneySchema,
  theirBalance: MoneySchema.nullable(),
  difference: MoneySchema.nullable(),
  status: RStatus,
  flag: z.enum(RECONCILIATION_FLAGS),
  /** Status other than reconciled: flagged (REQ-FIN-004). */
  unreconciled: z.boolean(),
  notes: z.array(z.string()),
  notesI18n: Messages,
  explanation: z.string().nullable(),
  sourceRef: z.string().nullable(),
  preparedBy: Uuid.nullable(),
  reviewerUserId: Uuid.nullable(),
  reviewedAt: z.string().nullable(),
  classification: ClassificationSchema,
  isDemo: z.boolean(),
  createdAt: z.string(),
  version: z.number().int(),
});

export const FinancialSnapshotDetailDto = FinancialSnapshotDto.extend({
  approval: FigureApprovalDto,
  reconciliations: z.array(IntercompanyReconciliationDto),
  evidence: Evidence,
  allowedCommands: z.array(z.string()),
  people: PeopleDto,
});

const snapshotSource = {
  sourceRef: Text(2000).nullable().optional(),
  sourceDocumentId: Uuid.nullable().optional(),
  sourceDocumentVersionId: Uuid.nullable().optional(),
};

export const CreateSnapshotBody = z
  .object({
    kind: Kind,
    category: Category,
    lineRef: LineRef,
    label: RequiredText(300),
    period: Period,
    amount: MoneySchema,
    ...snapshotSource,
    tsaServiceId: Uuid.nullable().optional(),
    workstreamId: Uuid.nullable().optional(),
    classification: ClassificationSchema.optional(),
  })
  .strict();

/** Content edits (never the approval state); an edit after validation invalidates it; approved figures must be reopened. */
export const UpdateSnapshotBody = z
  .object({
    expectedVersion: ExpectedVersion,
    label: RequiredText(300).optional(),
    amount: MoneySchema.optional(),
    ...snapshotSource,
    workstreamId: Uuid.nullable().optional(),
    classification: ClassificationSchema.optional(),
  })
  .strict();

/** REQ-FIN-008: outputs of an original model, each keeping its source document, sheet and cell. */
export const ImportSnapshotsBody = z
  .object({
    sourceType: z.enum(['excel', 'csv']).default('excel'),
    sourceDocumentId: Uuid,
    sourceDocumentVersionId: Uuid.optional(),
    importBatchId: Uuid.optional(),
    sourceRef: Text(2000).optional(),
    classification: ClassificationSchema.optional(),
    rows: z
      .array(
        z
          .object({
            kind: Kind,
            category: Category,
            lineRef: LineRef,
            label: RequiredText(300),
            period: Period,
            amount: MoneySchema,
            sheet: SheetRef.optional(),
            cell: CellRef,
            tsaServiceId: Uuid.optional(),
            workstreamId: Uuid.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

const ValidateBody = z.object({ expectedVersion: ExpectedVersion, note: RequiredText(4000) }).strict();
const ReasonBody = z.object({ expectedVersion: ExpectedVersion, note: RequiredText(4000) }).strict();

// ---------------------------------------------------------------------------------------------------------------
// Aggregation (REQ-DAT-004 / AT-29)

export const AggregateBody = z
  .object({
    /** Explicit figures to add up (visible to the caller, same project) … */
    snapshotIds: z.array(Uuid).min(1).max(200).optional(),
    /** … or a filter (a kind is mandatory: baseline, forecast and actual are never added together). */
    kind: Kind.optional(),
    category: Category.optional(),
    period: Period.optional(),
    approvalState: AState.optional(),
    workstreamId: Uuid.optional(),
    targetCurrency: Currency.optional(),
    targetUnitScale: UnitScale.optional(),
    /** Explicit opt-in to normalize unit scales (disclosed in the basis). */
    normalizeUnits: z.boolean().optional(),
    conversions: z.array(ConversionBasisSchema).max(10).optional(),
  })
  .strict();

export const AggregateResultDto = z.object({
  total: MoneySchema,
  count: z.number().int(),
  kind: Kind.nullable(),
  /** The basis of the total (conversions with their source, unit normalization, or "same basis"). */
  basis: z.string(),
  basisI18n: Messages,
  conversions: z.array(ConversionBasisSchema),
  normalizedUnitScales: z.array(z.number().int()),
  items: z.array(z.object({ id: Uuid, lineRef: z.string(), label: z.string(), period: z.string(), kind: Kind, amount: MoneySchema })),
});

// ---------------------------------------------------------------------------------------------------------------
// Budget lines (REQ-FIN-002, REQ-FIN-003)

export const BudgetLineDto = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  category: Category,
  workstreamId: Uuid.nullable(),
  tsaServiceId: Uuid.nullable(),
  currency: z.string(),
  unitScale: z.number().int(),
  proposed: MoneySchema.nullable(),
  /** Empty until a final governance decision is recorded (change control). */
  approved: MoneySchema.nullable(),
  committed: MoneySchema,
  spent: MoneySchema,
  /** committed − spent (commitments not yet spent). */
  openCommitment: MoneySchema,
  /** approved − committed (null without an approved budget). */
  uncommitted: MoneySchema.nullable(),
  flags: z.array(z.string()),
  flagsI18n: Messages,
  actualsAsOf: z.string().nullable(),
  actualsSourceRef: z.string().nullable(),
  approvalState: AState,
  approvalDecisionId: Uuid.nullable(),
  approvedBy: Uuid.nullable(),
  approvedAt: z.string().nullable(),
  sourceRef: z.string().nullable(),
  classification: ClassificationSchema,
  isDemo: z.boolean(),
  createdAt: z.string(),
  version: z.number().int(),
});

export const BudgetLineDetailDto = BudgetLineDto.extend({
  tsa: z.object({ id: Uuid, code: z.string(), name: z.string(), charge: MoneySchema.nullable() }).nullable(),
  people: PeopleDto,
});

export const CreateBudgetLineBody = z
  .object({
    name: RequiredText(300),
    category: Category,
    currency: Currency,
    unitScale: UnitScale,
    proposedAmount: DecimalString.optional(),
    committedAmount: DecimalString.optional(),
    spentAmount: DecimalString.optional(),
    actualsAsOf: IsoDate.optional(),
    actualsSourceRef: Text(2000).optional(),
    tsaServiceId: Uuid.nullable().optional(),
    workstreamId: Uuid.nullable().optional(),
    sourceRef: Text(2000).optional(),
    classification: ClassificationSchema.optional(),
  })
  .strict();

export const UpdateBudgetLineBody = z
  .object({
    expectedVersion: ExpectedVersion,
    name: RequiredText(300).optional(),
    proposedAmount: MoneySchema.nullable().optional(),
    workstreamId: Uuid.nullable().optional(),
    sourceRef: Text(2000).nullable().optional(),
    classification: ClassificationSchema.optional(),
  })
  .strict();

/** Commitments / spend as of a business date, with their source; amounts in the line's currency AND unit scale. */
export const RecordActualsBody = z
  .object({
    expectedVersion: ExpectedVersion,
    committed: MoneySchema.optional(),
    spent: MoneySchema.optional(),
    asOf: IsoDate,
    sourceRef: RequiredText(2000),
    note: Text(4000).optional(),
  })
  .strict();

export const RecordBudgetApprovalBody = z.object({ expectedVersion: ExpectedVersion, decisionId: Uuid, approvedAmount: MoneySchema, note: Text(4000).optional() }).strict();

export const SeparationCostsDto = z.object({
  categories: z.array(z.enum(SEPARATION_COST_CATEGORIES)),
  /** Totals per category AND currency / unit scale (never mixed). */
  groups: z.array(
    z.object({
      category: z.enum(SEPARATION_COST_CATEGORIES),
      currency: z.string(),
      unitScale: z.number().int(),
      lineCount: z.number().int(),
      linesWithoutApprovedBudget: z.number().int(),
      approved: MoneySchema,
      committed: MoneySchema,
      spent: MoneySchema,
    }),
  ),
  /** Every TSA service visible to the caller: counted once (in its budget line) or listed as excluded. */
  tsa: z.array(
    z.object({
      tsaServiceId: Uuid,
      tsaCode: z.string(),
      tsaName: z.string(),
      registerCharge: MoneySchema.nullable(),
      budgetLineId: Uuid.nullable(),
      budgetLineCode: z.string().nullable(),
      countedIn: z.enum(['budget_line', 'none']),
      notes: z.array(z.string()),
      notesI18n: Messages,
    }),
  ),
  findings: z.array(z.string()),
  findingsI18n: Messages,
});

// ---------------------------------------------------------------------------------------------------------------
// Intercompany reconciliation (REQ-FIN-004)

const reconDescriptive = {
  counterpartyLabel: RequiredText(300),
  theirBalance: MoneySchema.nullable().optional(),
  explanation: Text(4000).nullable().optional(),
  sourceRef: RequiredText(2000),
};
export const CreateSnapshotReconciliationBody = z.object(reconDescriptive).strict();
export const CreateReconciliationBody = z.object({ ...reconDescriptive, period: Period, ourBalance: MoneySchema, classification: ClassificationSchema.optional() }).strict();
export const UpdateReconciliationBody = z
  .object({
    expectedVersion: ExpectedVersion,
    counterpartyLabel: RequiredText(300).optional(),
    theirBalance: MoneySchema.nullable().optional(),
    explanation: Text(4000).nullable().optional(),
    sourceRef: RequiredText(2000).optional(),
    classification: ClassificationSchema.optional(),
  })
  .strict();
const ReconCommandResult = z.object({ id: Uuid, status: RStatus, flag: z.enum(RECONCILIATION_FLAGS), version: z.number().int() });

// ---------------------------------------------------------------------------------------------------------------
// Business plans / valuation (REQ-FIN-005..008)

export const ModelOutputDto = z.object({
  key: z.string(),
  label: z.string(),
  measure: Measure,
  amount: z.string(),
  currency: z.string().nullable(),
  unitScale: z.number().int().nullable(),
  basis: Basis,
  sheet: z.string().nullable(),
  cell: z.string().nullable(),
});

const OutputInput = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._:-]+$/),
    label: RequiredText(300),
    measure: Measure.default('money'),
    amount: DecimalString,
    currency: Currency.nullable().optional(),
    unitScale: UnitScale.nullable().optional(),
    /** Explicit basis — the platform never guesses whether a figure is EV or equity value. */
    basis: Basis,
    sheet: SheetRef.nullable().optional(),
    cell: CellRef.nullable().optional(),
  })
  .strict();

const AssumptionInput = z
  .object({ key: z.string().trim().min(1).max(64), value: RequiredText(500), unit: Text(32).nullable().optional(), source: Text(500).nullable().optional() })
  .strict();

export const FinancialModelDto = z.object({
  id: Uuid,
  code: z.string(),
  kind: z.enum(MODEL_KINDS),
  name: z.string(),
  description: z.string().nullable(),
  classification: ClassificationSchema,
  isDemo: z.boolean(),
  createdAt: z.string(),
  createdBy: Uuid.nullable(),
  version: z.number().int(),
  /** Latest version per case (base / downside / upside). */
  latest: z.array(z.object({ modelCase: z.enum(MODEL_CASES), versionId: Uuid, versionNo: z.number().int(), versionLabel: z.string(), approvalState: AState })),
});

export const ModelVersionSummaryDto = z.object({
  id: Uuid,
  modelId: Uuid,
  versionNo: z.number().int(),
  versionLabel: z.string(),
  modelCase: z.enum(MODEL_CASES),
  approvalState: AState,
  basedOnVersionId: Uuid.nullable(),
  supersededById: Uuid.nullable(),
  sourceType: z.enum(SOURCE_TYPES),
  /** Approved values exist only once an approval was recorded from a final governance decision. */
  hasApprovedValues: z.boolean(),
  isDemo: z.boolean(),
  createdAt: z.string(),
  createdBy: Uuid.nullable(),
});

export const FinancialModelDetailDto = FinancialModelDto.extend({ versions: z.array(ModelVersionSummaryDto), people: PeopleDto });

export const ModelVersionDetailDto = ModelVersionSummaryDto.extend({
  kind: z.enum(MODEL_KINDS),
  /** Content is frozen at creation: a change is a new version (prior assumptions preserved). */
  frozen: z.literal(true),
  assumptions: z.array(z.object({ key: z.string(), value: z.string(), unit: z.string().nullable(), source: z.string().nullable() })),
  /** Proposed values (the model outputs as recorded / imported). */
  outputs: z.array(ModelOutputDto),
  headlineBasis: Basis.nullable(),
  sourceDocumentId: Uuid.nullable(),
  sourceDocumentVersionId: Uuid.nullable(),
  sourceRef: z.string().nullable(),
  importBatchId: Uuid.nullable(),
  changeNote: z.string().nullable(),
  diffFromBasedOn: z.object({ added: z.array(z.string()), changed: z.array(z.string()), removed: z.array(z.string()) }).nullable(),
  approval: FigureApprovalDto,
  /** EMPTY (null) until an approval is recorded (REQ-FIN-006). */
  approvedValues: z.array(ModelOutputDto).nullable(),
  /** EV / equity / currency / unit consistency findings (not a professional valuation). */
  findings: z.array(z.string()),
  findingsI18n: Messages,
  classification: ClassificationSchema,
  version: z.number().int(),
  people: PeopleDto,
});

export const CreateModelBody = z.object({ kind: z.enum(MODEL_KINDS), name: RequiredText(300), description: Text(4000).optional(), classification: ClassificationSchema.optional() }).strict();
export const UpdateModelBody = z
  .object({ expectedVersion: ExpectedVersion, name: RequiredText(300).optional(), description: Text(4000).nullable().optional(), classification: ClassificationSchema.optional() })
  .strict();

const versionCommon = {
  modelCase: z.enum(MODEL_CASES),
  versionLabel: RequiredText(32),
  /** Prior version of the same case to start from (default: the latest one). */
  basedOnVersionId: Uuid.optional(),
  assumptionChanges: z.object({ set: z.array(AssumptionInput).max(200).optional(), remove: z.array(z.string().trim().min(1).max(64)).max(200).optional() }).strict().optional(),
  outputs: z.array(OutputInput).max(200),
  headlineBasis: Basis.optional(),
  changeNote: Text(4000).optional(),
};

export const CreateModelVersionBody = z
  .object({ ...versionCommon, sourceRef: Text(2000).optional(), sourceDocumentId: Uuid.optional(), sourceDocumentVersionId: Uuid.optional() })
  .strict();

/** REQ-FIN-008: imported outputs keep the source document and each output's sheet + cell. */
export const ImportModelVersionBody = z
  .object({ ...versionCommon, sourceDocumentId: Uuid, sourceDocumentVersionId: Uuid.optional(), importBatchId: Uuid.optional(), sourceRef: Text(2000).optional() })
  .strict();

export const CheckModelVersionBody = z.object({ compareToVersionId: Uuid.optional(), conversions: z.array(ConversionBasisSchema).max(10).optional() }).strict();
export const ModelCheckDto = z.object({
  findings: z.array(z.string()),
  findingsI18n: Messages,
  comparison: z
    .object({
      compareToVersionId: Uuid,
      rows: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          status: z.enum(['compared', 'basis_mismatch', 'currency_without_basis', 'unit_mismatch', 'measure_mismatch', 'missing']),
          a: ModelOutputDto.nullable(),
          b: ModelOutputDto.nullable(),
          difference: z.string().nullable(),
          notes: z.array(z.string()),
          notesI18n: Messages,
        }),
      ),
    })
    .nullable(),
});

export const ApproveValuesBody = z.object({ expectedVersion: ExpectedVersion, decisionId: Uuid, note: Text(4000).optional() }).strict();

// ---------------------------------------------------------------------------------------------------------------
// Benefits (REQ-FIN-009) and KPIs

export const BenefitDto = z.object({
  id: Uuid,
  code: z.string(),
  title: z.string(),
  measurementDefinition: z.string(),
  baselineValue: z.string().nullable(),
  targetValue: z.string().nullable(),
  actualValue: z.string().nullable(),
  unit: z.string().nullable(),
  value: MoneySchema.nullable(),
  realized: MoneySchema.nullable(),
  ownerUserId: Uuid.nullable(),
  workstreamId: Uuid.nullable(),
  realizationDate: z.string().nullable(),
  realizedOn: z.string().nullable(),
  verificationSource: z.string().nullable(),
  status: BStatus,
  approvedBy: Uuid.nullable(),
  approvedAt: z.string().nullable(),
  realizationRecordedBy: Uuid.nullable(),
  realizationRecordedAt: z.string().nullable(),
  verifiedBy: Uuid.nullable(),
  verifiedAt: z.string().nullable(),
  verificationNote: z.string().nullable(),
  statusNote: z.string().nullable(),
  classification: ClassificationSchema,
  isDemo: z.boolean(),
  createdAt: z.string(),
  createdBy: Uuid.nullable(),
  version: z.number().int(),
});

export const BenefitDetailDto = BenefitDto.extend({
  evidence: Evidence,
  allowedCommands: z.array(z.string()),
  kpis: z.array(z.object({ id: Uuid, key: z.string(), name: z.string() })),
  people: PeopleDto,
});

const benefitDescriptive = {
  measurementDefinition: RequiredText(4000),
  baselineValue: Text(500).nullable().optional(),
  targetValue: Text(500).nullable().optional(),
  unit: Text(32).nullable().optional(),
  value: MoneySchema.nullable().optional(),
  ownerUserId: Uuid.nullable().optional(),
  workstreamId: Uuid.nullable().optional(),
  realizationDate: IsoDate.nullable().optional(),
  verificationSource: Text(2000).nullable().optional(),
  classification: ClassificationSchema.optional(),
};
export const CreateBenefitBody = z.object({ title: RequiredText(300), ...benefitDescriptive }).strict();
export const UpdateBenefitBody = z
  .object({ expectedVersion: ExpectedVersion, title: RequiredText(300).optional(), ...benefitDescriptive, measurementDefinition: RequiredText(4000).optional() })
  .strict();
export const RecordRealizationBody = z
  .object({
    expectedVersion: ExpectedVersion,
    actualValue: RequiredText(500),
    realized: MoneySchema.optional(),
    realizedOn: IsoDate,
    verificationSource: Text(2000).optional(),
    note: Text(4000).optional(),
  })
  .strict();
const BenefitCommandResult = z.object({ id: Uuid, status: BStatus, version: z.number().int() });
const OptionalNoteBody = z.object({ expectedVersion: ExpectedVersion, note: Text(4000).optional() }).strict();

export const KpiObservationDto = z.object({
  id: Uuid,
  period: z.string(),
  value: z.string().nullable(),
  numerator: z.string().nullable(),
  denominator: z.string().nullable(),
  dataQuality: z.enum(['ok', 'incomplete', 'stale', 'unknown']),
  sourceRef: z.string().nullable(),
  note: z.string().nullable(),
  computedAt: z.string(),
  computedBy: z.string(),
  recordedBy: Uuid.nullable(),
});

export const KpiDto = z.object({
  id: Uuid,
  key: z.string(),
  name: z.string(),
  nameAr: z.string().nullable(),
  definition: z.string(),
  formula: z.string(),
  unit: z.string(),
  period: z.string(),
  ownerRole: z.string().nullable(),
  ownerUserId: Uuid.nullable(),
  benefitId: Uuid.nullable(),
  source: z.string(),
  target: z.string().nullable(),
  thresholds: z.object({ green: z.string(), amber: z.string(), red: z.string() }),
  direction: z.enum(KPI_DIRECTIONS),
  frequency: z.string(),
  computation: z.string().nullable(),
  verificationStatus: z.string(),
  classification: ClassificationSchema,
  isDemo: z.boolean(),
  createdAt: z.string(),
  version: z.number().int(),
  latestObservation: KpiObservationDto.nullable(),
});

export const KpiDetailDto = KpiDto.extend({ observations: z.array(KpiObservationDto), people: PeopleDto });

export const CreateKpiBody = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9._-]+$/),
    name: RequiredText(300),
    nameAr: Text(300).nullable().optional(),
    definition: RequiredText(4000),
    formula: RequiredText(2000),
    unit: RequiredText(32),
    period: RequiredText(32),
    ownerUserId: Uuid.nullable().optional(),
    benefitId: Uuid.nullable().optional(),
    source: RequiredText(2000),
    target: Text(200).nullable().optional(),
    thresholds: z.object({ green: RequiredText(100), amber: RequiredText(100), red: RequiredText(100) }).strict(),
    direction: z.enum(KPI_DIRECTIONS),
    frequency: RequiredText(32),
    classification: ClassificationSchema.optional(),
  })
  .strict();

export const RecordKpiObservationBody = z
  .object({
    period: Period,
    value: DecimalString.optional(),
    numerator: DecimalString.optional(),
    denominator: DecimalString.optional(),
    dataQuality: z.enum(['ok', 'incomplete', 'stale', 'unknown']).default('ok'),
    sourceRef: RequiredText(2000),
    note: Text(4000).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------------------------------------------
// Summary

const CountByKey = z.record(z.string(), z.number().int());
export const FinanceSummaryDto = z.object({
  snapshots: z.object({ total: z.number().int(), byKind: CountByKey, byState: CountByKey }),
  budget: z.object({
    lines: z.number().int(),
    flaggedLines: z.number().int(),
    /** Per currency / unit scale — never summed across them. */
    groups: z.array(z.object({ currency: z.string(), unitScale: z.number().int(), lineCount: z.number().int(), approved: MoneySchema, committed: MoneySchema, spent: MoneySchema, openCommitment: MoneySchema })),
  }),
  intercompany: z.object({
    total: z.number().int(),
    unreconciled: z.number().int(),
    byFlag: CountByKey,
    /** Unreconciled differences per currency / unit scale. */
    differences: z.array(z.object({ currency: z.string(), unitScale: z.number().int(), amount: z.string(), count: z.number().int() })),
  }),
  models: z.object({ total: z.number().int(), versions: z.number().int(), approvedValueVersions: z.number().int() }),
  benefits: z.object({ total: z.number().int(), byStatus: CountByKey }),
  kpis: z.object({ total: z.number().int() }),
  findings: z.array(z.string()),
  findingsI18n: Messages,
});

// ---------------------------------------------------------------------------------------------------------------
// Routes

const P = '/api/v1/projects/:projectId';
const tags = ['finance'];
const SnapshotParams = ProjectParams.extend({ snapshotId: Uuid });
const BudgetParams = ProjectParams.extend({ budgetLineId: Uuid });
const ReconParams = ProjectParams.extend({ reconciliationId: Uuid });
const ModelParams = ProjectParams.extend({ modelId: Uuid });
const VersionParams = ModelParams.extend({ versionId: Uuid });
const BenefitParams = ProjectParams.extend({ benefitId: Uuid });
const KpiParams = ProjectParams.extend({ kpiId: Uuid });

export const financeRoutes = registerRoutes({
  // ---- Summary, cost view, aggregation ----------------------------------------------------------------------
  getFinanceSummary: defineRoute({
    id: 'finance.getSummary',
    method: 'GET',
    path: `${P}/finance/summary`,
    summary: 'Finance & value summary within the caller’s scope (classification and reach applied in SQL; no cross-currency totals)',
    tags,
    access: 'finance.record.read',
    params: ProjectParams,
    response: FinanceSummaryDto,
  }),
  getSeparationCosts: defineRoute({
    id: 'finance.getSeparationCosts',
    method: 'GET',
    path: `${P}/finance/separation-costs`,
    summary: 'Separation cost view (one-off, recurring standalone, stranded, TSA): each TSA charge counted once (REQ-FIN-002)',
    tags,
    access: 'finance.record.read',
    params: ProjectParams,
    response: SeparationCostsDto,
  }),
  aggregateFigures: defineRoute({
    id: 'finance.aggregate',
    method: 'POST',
    path: `${P}/finance/aggregate`,
    summary: 'Add up figures: mixed currencies need an explicit conversion basis, mixed units an explicit normalization; the basis is shown (REQ-DAT-004, AT-29)',
    tags,
    access: 'finance.record.read',
    params: ProjectParams,
    body: AggregateBody,
    response: AggregateResultDto,
  }),

  // ---- Financial snapshots ------------------------------------------------------------------------------------
  listSnapshots: defineRoute({
    id: 'finance.listSnapshots',
    method: 'GET',
    path: `${P}/financial-snapshots`,
    summary: 'Baseline / forecast / actual figures (classification and workstream reach applied in SQL)',
    tags,
    access: 'finance.record.read',
    params: ProjectParams,
    // Default order: line reference, period, kind.
    query: PageQuery.extend({
      kind: Kind.optional(),
      category: Category.optional(),
      period: Period.optional(),
      approvalState: AState.optional(),
      workstreamId: Uuid.optional(),
      lineRef: LineRef.optional(),
      sort: SortParam(['lineRef', 'period', 'kind', 'category', 'approvalState', 'updatedAt']),
    }),
    response: paged(FinancialSnapshotDto),
  }),
  getSnapshot: defineRoute({
    id: 'finance.getSnapshot',
    method: 'GET',
    path: `${P}/financial-snapshots/:snapshotId`,
    summary: 'Figure with its source, validation / approval trail and reconciliations',
    tags,
    access: 'finance.record.read',
    params: SnapshotParams,
    response: FinancialSnapshotDetailDto,
  }),
  createSnapshot: defineRoute({
    id: 'finance.createSnapshot',
    method: 'POST',
    path: `${P}/financial-snapshots`,
    summary: 'Manual entry of a figure (currency, unit, period and source mandatory; starts proposed)',
    tags,
    access: 'finance.budget.manage',
    params: ProjectParams,
    body: CreateSnapshotBody,
    response: VersionResult,
  }),
  importSnapshots: defineRoute({
    id: 'finance.importSnapshots',
    method: 'POST',
    path: `${P}/financial-snapshots/import`,
    summary: 'Import model outputs as figures, each keeping its source document, sheet and cell (REQ-FIN-008; all-or-nothing)',
    tags,
    access: 'finance.model.manage',
    params: ProjectParams,
    body: ImportSnapshotsBody,
    response: z.object({ items: z.array(z.object({ id: Uuid, lineRef: z.string(), kind: Kind, period: z.string(), sourceSheet: z.string().nullable(), sourceCell: z.string() })) }),
  }),
  updateSnapshot: defineRoute({
    id: 'finance.updateSnapshot',
    method: 'PATCH',
    path: `${P}/financial-snapshots/:snapshotId`,
    summary: 'Edit a figure’s content (never its approval state); a validated figure returns to proposed; approved figures must be reopened',
    tags,
    access: 'finance.budget.manage',
    params: SnapshotParams,
    body: UpdateSnapshotBody,
    response: FigureCommandResult,
  }),
  validateSnapshot: defineRoute({
    id: 'finance.validateSnapshot',
    method: 'POST',
    path: `${P}/financial-snapshots/:snapshotId/validate`,
    summary: 'Human financial validation (not by the preparer; never a service identity) — opens the approval request (REQ-FIN-010)',
    tags,
    access: 'finance.snapshot.approve',
    command: true,
    params: SnapshotParams,
    body: ValidateBody,
    response: FigureCommandResult.extend({ approvalRequestId: Uuid }),
  }),
  approveSnapshot: defineRoute({
    id: 'finance.approveSnapshot',
    method: 'POST',
    path: `${P}/financial-snapshots/:snapshotId/approve`,
    summary: 'Approve a VALIDATED figure (approver ≠ preparer ≠ validator; opening balances need a final opening_balance_sheet decision)',
    tags,
    access: 'finance.snapshot.approve',
    command: true,
    params: SnapshotParams,
    body: z.object({ expectedVersion: ExpectedVersion, decisionId: Uuid.optional(), note: Text(4000).optional() }).strict(),
    response: FigureCommandResult,
  }),
  rejectSnapshot: defineRoute({
    id: 'finance.rejectSnapshot',
    method: 'POST',
    path: `${P}/financial-snapshots/:snapshotId/reject`,
    summary: 'Reject a validated figure (reason required)',
    tags,
    access: 'finance.snapshot.approve',
    command: true,
    params: SnapshotParams,
    body: ReasonBody,
    response: FigureCommandResult,
  }),
  reopenSnapshot: defineRoute({
    id: 'finance.reopenSnapshot',
    method: 'POST',
    path: `${P}/financial-snapshots/:snapshotId/reopen`,
    summary: 'Reopen an approved figure for correction (reason required; the approval stays in history)',
    tags,
    access: 'finance.snapshot.approve',
    command: true,
    params: SnapshotParams,
    body: ReasonBody,
    response: FigureCommandResult,
  }),
  createSnapshotReconciliation: defineRoute({
    id: 'finance.createSnapshotReconciliation',
    method: 'POST',
    path: `${P}/financial-snapshots/:snapshotId/reconciliations`,
    summary: 'Reconcile an intercompany / opening balance figure against the counterparty balance (REQ-FIN-004)',
    tags,
    access: 'finance.budget.manage',
    params: SnapshotParams,
    body: CreateSnapshotReconciliationBody,
    response: VersionResult.extend({ code: z.string() }),
  }),

  // ---- Budget lines -------------------------------------------------------------------------------------------
  listBudgetLines: defineRoute({
    id: 'finance.listBudgetLines',
    method: 'GET',
    path: `${P}/budget-lines`,
    summary: 'Budget lines — approved, committed and spent kept separate (REQ-FIN-003)',
    tags,
    access: 'finance.record.read',
    params: ProjectParams,
    // Default order: code.
    query: PageQuery.extend({ category: Category.optional(), workstreamId: Uuid.optional(), approvalState: AState.optional(), sort: SortParam(['code', 'name', 'category', 'updatedAt']) }),
    response: paged(BudgetLineDto),
  }),
  getBudgetLine: defineRoute({
    id: 'finance.getBudgetLine',
    method: 'GET',
    path: `${P}/budget-lines/:budgetLineId`,
    summary: 'Budget line with its position and linked TSA',
    tags,
    access: 'finance.record.read',
    params: BudgetParams,
    response: BudgetLineDetailDto,
  }),
  createBudgetLine: defineRoute({
    id: 'finance.createBudgetLine',
    method: 'POST',
    path: `${P}/budget-lines`,
    summary: 'Create a budget line (a TSA charge line links its TSA service; one line per TSA)',
    tags,
    access: 'finance.budget.manage',
    params: ProjectParams,
    body: CreateBudgetLineBody,
    response: VersionResult.extend({ code: z.string() }),
  }),
  updateBudgetLine: defineRoute({
    id: 'finance.updateBudgetLine',
    method: 'PATCH',
    path: `${P}/budget-lines/:budgetLineId`,
    summary: 'Edit descriptive fields and the proposed amount (never the approved amount or state)',
    tags,
    access: 'finance.budget.manage',
    params: BudgetParams,
    body: UpdateBudgetLineBody,
    response: VersionResult,
  }),
  recordBudgetActuals: defineRoute({
    id: 'finance.recordBudgetActuals',
    method: 'POST',
    path: `${P}/budget-lines/:budgetLineId/actuals`,
    summary: 'Record commitments and spend (as of a date, with source) in the line’s currency and unit',
    tags,
    access: 'finance.budget.manage',
    command: true,
    params: BudgetParams,
    body: RecordActualsBody,
    response: VersionResult,
  }),
  recordBudgetApproval: defineRoute({
    id: 'finance.recordBudgetApproval',
    method: 'POST',
    path: `${P}/budget-lines/:budgetLineId/record-approval`,
    summary: 'Record the approved budget from a FINAL governance decision (baseline / budget change / spend commitment)',
    tags,
    access: 'finance.budget.manage',
    command: true,
    params: BudgetParams,
    body: RecordBudgetApprovalBody,
    response: VersionResult.extend({ approvalState: AState }),
  }),

  // ---- Intercompany reconciliation --------------------------------------------------------------------------
  listReconciliations: defineRoute({
    id: 'finance.listReconciliations',
    method: 'GET',
    path: `${P}/intercompany-reconciliations`,
    summary: 'Intercompany reconciliations with unreconciled differences flagged (REQ-FIN-004)',
    tags,
    access: 'finance.record.read',
    params: ProjectParams,
    // Default order: code.
    query: PageQuery.extend({ status: RStatus.optional(), unreconciled: z.enum(['true', 'false']).optional(), sort: SortParam(['code', 'period', 'status', 'updatedAt']) }),
    response: paged(IntercompanyReconciliationDto),
  }),
  getReconciliation: defineRoute({
    id: 'finance.getReconciliation',
    method: 'GET',
    path: `${P}/intercompany-reconciliations/:reconciliationId`,
    summary: 'Intercompany reconciliation',
    tags,
    access: 'finance.record.read',
    params: ReconParams,
    response: IntercompanyReconciliationDto.extend({ people: PeopleDto }),
  }),
  createReconciliation: defineRoute({
    id: 'finance.createReconciliation',
    method: 'POST',
    path: `${P}/intercompany-reconciliations`,
    summary: 'Record an intercompany balance to reconcile (source reference mandatory)',
    tags,
    access: 'finance.budget.manage',
    params: ProjectParams,
    body: CreateReconciliationBody,
    response: VersionResult.extend({ code: z.string() }),
  }),
  updateReconciliation: defineRoute({
    id: 'finance.updateReconciliation',
    method: 'PATCH',
    path: `${P}/intercompany-reconciliations/:reconciliationId`,
    summary: 'Record the counterparty balance / explanation (never the status; not once reconciled)',
    tags,
    access: 'finance.budget.manage',
    params: ReconParams,
    body: UpdateReconciliationBody,
    response: ReconCommandResult,
  }),
  reconcile: defineRoute({
    id: 'finance.reconcile',
    method: 'POST',
    path: `${P}/intercompany-reconciliations/:reconciliationId/reconcile`,
    summary: 'Mark reconciled: counterparty balance recorded, any difference explained, reviewer ≠ preparer (human)',
    tags,
    access: 'finance.snapshot.approve',
    command: true,
    params: ReconParams,
    body: z.object({ expectedVersion: ExpectedVersion, note: Text(4000).optional() }).strict(),
    response: ReconCommandResult,
  }),
  disputeReconciliation: defineRoute({
    id: 'finance.disputeReconciliation',
    method: 'POST',
    path: `${P}/intercompany-reconciliations/:reconciliationId/dispute`,
    summary: 'Mark the balance disputed with the counterparty (reason required)',
    tags,
    access: 'finance.budget.manage',
    command: true,
    params: ReconParams,
    body: ReasonBody,
    response: ReconCommandResult,
  }),
  reopenReconciliation: defineRoute({
    id: 'finance.reopenReconciliation',
    method: 'POST',
    path: `${P}/intercompany-reconciliations/:reconciliationId/reopen`,
    summary: 'Reopen a reconciled or disputed reconciliation (reason required)',
    tags,
    access: 'finance.snapshot.approve',
    command: true,
    params: ReconParams,
    body: ReasonBody,
    response: ReconCommandResult,
  }),

  // ---- Business plans / valuation ---------------------------------------------------------------------------
  listModels: defineRoute({
    id: 'finance.listModels',
    method: 'GET',
    path: `${P}/financial-models`,
    summary: 'Business plans and valuation models (references to the original models)',
    tags,
    access: 'finance.record.read',
    params: ProjectParams,
    // Default order: code.
    query: PageQuery.extend({ kind: z.enum(MODEL_KINDS).optional(), sort: SortParam(['code', 'name', 'kind', 'updatedAt']) }),
    response: paged(FinancialModelDto),
  }),
  getModel: defineRoute({
    id: 'finance.getModel',
    method: 'GET',
    path: `${P}/financial-models/:modelId`,
    summary: 'Model with every version of every case',
    tags,
    access: 'finance.record.read',
    params: ModelParams,
    response: FinancialModelDetailDto,
  }),
  createModel: defineRoute({
    id: 'finance.createModel',
    method: 'POST',
    path: `${P}/financial-models`,
    summary: 'Register a business plan or valuation model',
    tags,
    access: 'finance.model.manage',
    params: ProjectParams,
    body: CreateModelBody,
    response: VersionResult.extend({ code: z.string() }),
  }),
  updateModel: defineRoute({
    id: 'finance.updateModel',
    method: 'PATCH',
    path: `${P}/financial-models/:modelId`,
    summary: 'Edit the model’s name / description / raise its classification (versions are never edited)',
    tags,
    access: 'finance.model.manage',
    params: ModelParams,
    body: UpdateModelBody,
    response: VersionResult,
  }),
  createModelVersion: defineRoute({
    id: 'finance.createModelVersion',
    method: 'POST',
    path: `${P}/financial-models/:modelId/versions`,
    summary: 'New version of a case: starts from the prior version’s assumptions + explicit changes; the prior version stays frozen (REQ-FIN-005)',
    tags,
    access: 'finance.model.manage',
    params: ModelParams,
    body: CreateModelVersionBody,
    response: VersionResult.extend({ versionNo: z.number().int(), diff: z.object({ added: z.array(z.string()), changed: z.array(z.string()), removed: z.array(z.string()), unchanged: z.number().int() }) }),
  }),
  importModelVersion: defineRoute({
    id: 'finance.importModelVersion',
    method: 'POST',
    path: `${P}/financial-models/:modelId/versions/import`,
    summary: 'New version from an original model’s outputs — keeps the source document and each output’s sheet/cell (REQ-FIN-008)',
    tags,
    access: 'finance.model.manage',
    params: ModelParams,
    body: ImportModelVersionBody,
    response: VersionResult.extend({ versionNo: z.number().int(), diff: z.object({ added: z.array(z.string()), changed: z.array(z.string()), removed: z.array(z.string()), unchanged: z.number().int() }) }),
  }),
  getModelVersion: defineRoute({
    id: 'finance.getModelVersion',
    method: 'GET',
    path: `${P}/financial-models/:modelId/versions/:versionId`,
    summary: 'Version: assumptions, proposed values, approved values (empty until approved), findings',
    tags,
    access: 'finance.record.read',
    params: VersionParams,
    response: ModelVersionDetailDto,
  }),
  checkModelVersion: defineRoute({
    id: 'finance.checkModelVersion',
    method: 'POST',
    path: `${P}/financial-models/:modelId/versions/:versionId/check`,
    summary: 'EV vs equity / currency / unit consistency check, optionally against another version (REQ-FIN-007; not a valuation)',
    tags,
    access: 'finance.record.read',
    params: VersionParams,
    body: CheckModelVersionBody,
    response: ModelCheckDto,
  }),
  validateModelVersion: defineRoute({
    id: 'finance.validateModelVersion',
    method: 'POST',
    path: `${P}/financial-models/:modelId/versions/:versionId/validate`,
    summary: 'Human financial validation of a version (not by its preparer; never a service identity) (REQ-FIN-010)',
    tags,
    access: 'finance.snapshot.approve',
    command: true,
    params: VersionParams,
    body: ValidateBody,
    response: FigureCommandResult.extend({ approvalRequestId: Uuid }),
  }),
  approveModelValues: defineRoute({
    id: 'finance.approveModelValues',
    method: 'POST',
    path: `${P}/financial-models/:modelId/versions/:versionId/approve-values`,
    summary: 'Record approved valuation / ownership values from a FINAL valuation_and_ownership_terms decision (validated version; REQ-FIN-006)',
    tags,
    access: 'finance.snapshot.approve',
    command: true,
    params: VersionParams,
    body: ApproveValuesBody,
    response: FigureCommandResult,
  }),
  rejectModelVersion: defineRoute({
    id: 'finance.rejectModelVersion',
    method: 'POST',
    path: `${P}/financial-models/:modelId/versions/:versionId/reject`,
    summary: 'Reject a validated version (reason required)',
    tags,
    access: 'finance.snapshot.approve',
    command: true,
    params: VersionParams,
    body: ReasonBody,
    response: FigureCommandResult,
  }),

  // ---- Benefits -------------------------------------------------------------------------------------------
  listBenefits: defineRoute({
    id: 'finance.listBenefits',
    method: 'GET',
    path: `${P}/benefits`,
    summary: 'Benefits register (REQ-FIN-009)',
    tags,
    access: 'finance.record.read',
    params: ProjectParams,
    // Default order: code.
    query: PageQuery.extend({ status: BStatus.optional(), ownerUserId: Uuid.optional(), sort: SortParam(['code', 'title', 'status', 'realizationDate', 'updatedAt']) }),
    response: paged(BenefitDto),
  }),
  getBenefit: defineRoute({
    id: 'finance.getBenefit',
    method: 'GET',
    path: `${P}/benefits/:benefitId`,
    summary: 'Benefit with its verification trail, evidence and KPIs',
    tags,
    access: 'finance.record.read',
    params: BenefitParams,
    response: BenefitDetailDto,
  }),
  createBenefit: defineRoute({
    id: 'finance.createBenefit',
    method: 'POST',
    path: `${P}/benefits`,
    summary: 'Register a benefit (measurement definition, baseline, target, owner, realization date, verification source)',
    tags,
    access: 'finance.benefit.manage',
    params: ProjectParams,
    body: CreateBenefitBody,
    response: VersionResult.extend({ code: z.string() }),
  }),
  updateBenefit: defineRoute({
    id: 'finance.updateBenefit',
    method: 'PATCH',
    path: `${P}/benefits/:benefitId`,
    summary: 'Edit the benefit definition (never status, realization or verification)',
    tags,
    access: 'finance.benefit.manage',
    params: BenefitParams,
    body: UpdateBenefitBody,
    response: VersionResult,
  }),
  approveBenefit: defineRoute({
    id: 'finance.approveBenefit',
    method: 'POST',
    path: `${P}/benefits/:benefitId/approve`,
    summary: 'Accept the benefit definition into the register (independent of its creator and owner)',
    tags,
    access: 'finance.benefit.verify',
    command: true,
    params: BenefitParams,
    body: OptionalNoteBody,
    response: BenefitCommandResult,
  }),
  startBenefitTracking: defineRoute({
    id: 'finance.startBenefitTracking',
    method: 'POST',
    path: `${P}/benefits/:benefitId/start-tracking`,
    summary: 'Start measuring an approved benefit',
    tags,
    access: 'finance.benefit.manage',
    command: true,
    params: BenefitParams,
    body: OptionalNoteBody,
    response: BenefitCommandResult,
  }),
  recordBenefitRealization: defineRoute({
    id: 'finance.recordBenefitRealization',
    method: 'POST',
    path: `${P}/benefits/:benefitId/record-realization`,
    summary: 'Report a realization — needs the verification source; stays unverified until an independent verification',
    tags,
    access: 'finance.benefit.manage',
    command: true,
    params: BenefitParams,
    body: RecordRealizationBody,
    response: BenefitCommandResult,
  }),
  verifyBenefit: defineRoute({
    id: 'finance.verifyBenefit',
    method: 'POST',
    path: `${P}/benefits/:benefitId/verify`,
    summary: 'Verify a realization against its source (not the owner or reporter; never a service identity)',
    tags,
    access: 'finance.benefit.verify',
    command: true,
    params: BenefitParams,
    body: ReasonBody,
    response: BenefitCommandResult,
  }),
  rejectBenefitRealization: defineRoute({
    id: 'finance.rejectBenefitRealization',
    method: 'POST',
    path: `${P}/benefits/:benefitId/reject-realization`,
    summary: 'Reject a reported realization not supported by its source (reason required)',
    tags,
    access: 'finance.benefit.verify',
    command: true,
    params: BenefitParams,
    body: ReasonBody,
    response: BenefitCommandResult,
  }),
  cancelBenefit: defineRoute({
    id: 'finance.cancelBenefit',
    method: 'POST',
    path: `${P}/benefits/:benefitId/cancel`,
    summary: 'Withdraw a benefit (reason required)',
    tags,
    access: 'finance.benefit.manage',
    command: true,
    params: BenefitParams,
    body: ReasonBody,
    response: BenefitCommandResult,
  }),

  // ---- KPIs -------------------------------------------------------------------------------------------------
  listKpis: defineRoute({
    id: 'finance.listKpis',
    method: 'GET',
    path: `${P}/kpis`,
    summary: 'KPI definitions with their latest observation',
    tags,
    access: 'finance.record.read',
    params: ProjectParams,
    // Default order: key.
    query: PageQuery.extend({ benefitId: Uuid.optional(), sort: SortParam(['key', 'name', 'updatedAt']) }),
    response: paged(KpiDto),
  }),
  getKpi: defineRoute({
    id: 'finance.getKpi',
    method: 'GET',
    path: `${P}/kpis/:kpiId`,
    summary: 'KPI with its observations (newest first)',
    tags,
    access: 'finance.record.read',
    params: KpiParams,
    response: KpiDetailDto,
  }),
  createKpi: defineRoute({
    id: 'finance.createKpi',
    method: 'POST',
    path: `${P}/kpis`,
    summary: 'Define a KPI (definition, formula, unit, owner, source, thresholds, direction)',
    tags,
    access: 'finance.kpi.manage',
    params: ProjectParams,
    body: CreateKpiBody,
    response: VersionResult,
  }),
  recordKpiObservation: defineRoute({
    id: 'finance.recordKpiObservation',
    method: 'POST',
    path: `${P}/kpis/:kpiId/observations`,
    summary: 'Record a manual observation with its source (append-only; a correction is a new observation)',
    tags,
    access: 'finance.kpi.manage',
    params: KpiParams,
    body: RecordKpiObservationBody,
    response: z.object({ id: Uuid }),
  }),
});
