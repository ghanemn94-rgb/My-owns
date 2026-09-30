'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { documentsRoutes, financeRoutes, governanceRoutes, readinessRoutes, type RouteBody, type RouteQuery, type RouteResponse, type ServerMessageDto } from '@hub/contracts';
import { CLASSIFICATIONS, clearanceAllows, financeDomainClearance, type Classification } from '@hub/domain';
import { useI18n, type MessageKey, type StatusEnum } from '@/i18n/provider';
import { api } from './api';
import { useProjectContext } from './project-context';
import { projectAccess } from './queries';

/**
 * Finance & Value (spec §10 screen 10; REQ-FIN-001..010, REQ-DAT-004, REQ-UX-013, AT-29) — types, query keys, hooks and
 * pure helpers. The API authorizes every call, filters rows by the caller's finance clearance and workstream reach, and
 * computes every total: this client never adds amounts (in particular never across currencies or unit scales).
 */

type R = typeof financeRoutes;
export type FinanceSummary = RouteResponse<R['getFinanceSummary']>;
export type SeparationCosts = RouteResponse<R['getSeparationCosts']>;
export type AggregateResult = RouteResponse<R['aggregateFigures']>;
export type AggregateBody = RouteBody<R['aggregateFigures']>;
export type Snapshot = RouteResponse<R['listSnapshots']>['items'][number];
export type SnapshotDetail = RouteResponse<R['getSnapshot']>;
export type FigureApproval = SnapshotDetail['approval'];
export type BudgetLine = RouteResponse<R['listBudgetLines']>['items'][number];
export type BudgetLineDetail = RouteResponse<R['getBudgetLine']>;
export type Reconciliation = RouteResponse<R['listReconciliations']>['items'][number];
export type ReconciliationDetail = RouteResponse<R['getReconciliation']>;
export type FinancialModel = RouteResponse<R['listModels']>['items'][number];
export type FinancialModelDetail = RouteResponse<R['getModel']>;
export type ModelVersionSummary = FinancialModelDetail['versions'][number];
export type ModelVersionDetail = RouteResponse<R['getModelVersion']>;
export type ModelOutput = ModelVersionDetail['outputs'][number];
export type ModelCheck = RouteResponse<R['checkModelVersion']>;
export type Benefit = RouteResponse<R['listBenefits']>['items'][number];
export type BenefitDetail = RouteResponse<R['getBenefit']>;
export type Kpi = RouteResponse<R['listKpis']>['items'][number];
export type KpiDetail = RouteResponse<R['getKpi']>;
export type People = Record<string, string>;
export type MoneyValue = { amount: string; currency: string; unitScale: number };
export type ConversionBasis = { from: string; to: string; rate: string; source: string; asOf: string };

export const UNIT_SCALE_OPTIONS = [1, 1000, 1_000_000] as const;
export type UnitScaleOption = (typeof UNIT_SCALE_OPTIONS)[number];
/** Figure categories reconciled against a counterparty balance (REQ-FIN-004). */
export const RECONCILABLE_CATEGORIES = ['intercompany', 'opening_balance', 'working_capital'] as const;
export const RECONCILIATION_STATUS_VALUES = ['open', 'reconciled', 'disputed'] as const;
export const RECONCILIATION_FLAG_VALUES = ['counterparty_missing', 'unreconciled_difference', 'disputed', 'matched_pending_review', 'explained_difference', 'reconciled'] as const;
export const OUTPUT_MEASURE_VALUES = ['money', 'percent'] as const;
export const DATA_QUALITY_VALUES = ['ok', 'incomplete', 'stale', 'unknown'] as const;

export const fk = {
  root: (pid: string) => ['finance', pid] as const,
  summary: (pid: string) => ['finance', pid, 'summary'] as const,
  costs: (pid: string) => ['finance', pid, 'costs'] as const,
  snapshots: (pid: string, q: object) => ['finance', pid, 'snapshots', q] as const,
  snapshot: (pid: string, id: string) => ['finance', pid, 'snapshot', id] as const,
  budget: (pid: string, q: object) => ['finance', pid, 'budget', q] as const,
  line: (pid: string, id: string) => ['finance', pid, 'line', id] as const,
  recons: (pid: string, q: object) => ['finance', pid, 'recons', q] as const,
  recon: (pid: string, id: string) => ['finance', pid, 'recon', id] as const,
  models: (pid: string, q: object) => ['finance', pid, 'models', q] as const,
  model: (pid: string, id: string) => ['finance', pid, 'model', id] as const,
  version: (pid: string, modelId: string, versionId: string) => ['finance', pid, 'model', modelId, 'version', versionId] as const,
  benefits: (pid: string, q: object) => ['finance', pid, 'benefits', q] as const,
  benefit: (pid: string, id: string) => ['finance', pid, 'benefit', id] as const,
  kpis: (pid: string, q: object) => ['finance', pid, 'kpis', q] as const,
  kpi: (pid: string, id: string) => ['finance', pid, 'kpi', id] as const,
  decisions: (pid: string) => ['finance', pid, 'decisions'] as const,
  tsas: (pid: string) => ['finance', pid, 'tsas'] as const,
  documents: (pid: string, q: string) => ['finance', pid, 'documents', q] as const,
  document: (pid: string, id: string) => ['finance', pid, 'document', id] as const,
};

export function finHref(projectId: string, segment = '') {
  return `/projects/${projectId}/finance${segment}`;
}

/** After any finance command: refresh every finance query of the project, its activity feed and dimensions. */
export function useFinanceRefresh() {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  return useCallback(async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: fk.root(projectId) }), queryClient.invalidateQueries({ queryKey: ['project', projectId] })]);
  }, [queryClient, projectId]);
}

// ---------------------------------------------------------------------------------------------------------------
// Reads

export function useFinanceSummary() {
  const { projectId } = useProjectContext();
  return useQuery({ queryKey: fk.summary(projectId), queryFn: ({ signal }) => api(financeRoutes.getFinanceSummary, { params: { projectId }, signal }) });
}

export function useSeparationCosts() {
  const { projectId } = useProjectContext();
  return useQuery({ queryKey: fk.costs(projectId), queryFn: ({ signal }) => api(financeRoutes.getSeparationCosts, { params: { projectId }, signal }) });
}

export function useSnapshots(query: RouteQuery<R['listSnapshots']>) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: fk.snapshots(projectId, query),
    queryFn: ({ signal }) => api(financeRoutes.listSnapshots, { params: { projectId }, query, signal }),
    placeholderData: (prev) => prev,
  });
}

export function useSnapshot(snapshotId: string) {
  const { projectId } = useProjectContext();
  return useQuery({ queryKey: fk.snapshot(projectId, snapshotId), queryFn: ({ signal }) => api(financeRoutes.getSnapshot, { params: { projectId, snapshotId }, signal }) });
}

export function useBudgetLines(query: RouteQuery<R['listBudgetLines']>) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: fk.budget(projectId, query),
    queryFn: ({ signal }) => api(financeRoutes.listBudgetLines, { params: { projectId }, query, signal }),
    placeholderData: (prev) => prev,
  });
}

export function useBudgetLine(budgetLineId: string) {
  const { projectId } = useProjectContext();
  return useQuery({ queryKey: fk.line(projectId, budgetLineId), queryFn: ({ signal }) => api(financeRoutes.getBudgetLine, { params: { projectId, budgetLineId }, signal }) });
}

export function useReconciliations(query: RouteQuery<R['listReconciliations']>) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: fk.recons(projectId, query),
    queryFn: ({ signal }) => api(financeRoutes.listReconciliations, { params: { projectId }, query, signal }),
    placeholderData: (prev) => prev,
  });
}

export function useReconciliation(reconciliationId: string) {
  const { projectId } = useProjectContext();
  return useQuery({ queryKey: fk.recon(projectId, reconciliationId), queryFn: ({ signal }) => api(financeRoutes.getReconciliation, { params: { projectId, reconciliationId }, signal }) });
}

export function useModels(query: RouteQuery<R['listModels']>) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: fk.models(projectId, query),
    queryFn: ({ signal }) => api(financeRoutes.listModels, { params: { projectId }, query, signal }),
    placeholderData: (prev) => prev,
  });
}

export function useModel(modelId: string) {
  const { projectId } = useProjectContext();
  return useQuery({ queryKey: fk.model(projectId, modelId), queryFn: ({ signal }) => api(financeRoutes.getModel, { params: { projectId, modelId }, signal }) });
}

export function useModelVersion(modelId: string, versionId: string) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: fk.version(projectId, modelId, versionId),
    queryFn: ({ signal }) => api(financeRoutes.getModelVersion, { params: { projectId, modelId, versionId }, signal }),
    enabled: !!modelId && !!versionId,
  });
}

export function useBenefits(query: RouteQuery<R['listBenefits']>) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: fk.benefits(projectId, query),
    queryFn: ({ signal }) => api(financeRoutes.listBenefits, { params: { projectId }, query, signal }),
    placeholderData: (prev) => prev,
  });
}

export function useBenefit(benefitId: string) {
  const { projectId } = useProjectContext();
  return useQuery({ queryKey: fk.benefit(projectId, benefitId), queryFn: ({ signal }) => api(financeRoutes.getBenefit, { params: { projectId, benefitId }, signal }) });
}

export function useKpis(query: RouteQuery<R['listKpis']>) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: fk.kpis(projectId, query),
    queryFn: ({ signal }) => api(financeRoutes.listKpis, { params: { projectId }, query, signal }),
    placeholderData: (prev) => prev,
  });
}

export function useKpi(kpiId: string) {
  const { projectId } = useProjectContext();
  return useQuery({ queryKey: fk.kpi(projectId, kpiId), queryFn: ({ signal }) => api(financeRoutes.getKpi, { params: { projectId, kpiId }, signal }) });
}

/** Governance decisions of the given types (governance owns them; finance only links them; the server re-validates). */
export function useDecisionsOfTypes(typeKeys: readonly string[], enabled: boolean) {
  const { projectId, can } = useProjectContext();
  const q = useQuery({
    queryKey: fk.decisions(projectId),
    queryFn: ({ signal }) => api(governanceRoutes.listDecisions, { params: { projectId }, query: { page: 1, pageSize: 100 }, signal }),
    enabled: enabled && can('governance.decision.read'),
  });
  const items = (q.data?.items ?? []).filter((d) => d.decisionTypeKey && typeKeys.includes(d.decisionTypeKey) && d.status !== 'rejected' && d.status !== 'superseded');
  return { ...q, items };
}

/** TSA services of the readiness register (a TSA-charge line or figure links exactly one). */
export function useTsaOptions(enabled: boolean) {
  const { projectId, can } = useProjectContext();
  return useQuery({
    queryKey: fk.tsas(projectId),
    queryFn: ({ signal }) => api(readinessRoutes.listTsaServices, { params: { projectId }, query: { page: 1, pageSize: 100 }, signal }),
    enabled: enabled && can('readiness.register.read'),
    staleTime: 60_000,
  });
}

/** Documents the caller can see (source document of an imported figure / model version). */
export function useDocumentOptions(q: string, enabled: boolean) {
  const { projectId, can } = useProjectContext();
  return useQuery({
    queryKey: fk.documents(projectId, q),
    queryFn: ({ signal }) => api(documentsRoutes.listDocuments, { params: { projectId }, query: { q: q || undefined, page: 1, pageSize: 50 }, signal }),
    enabled: enabled && can('documents.document.read'),
    placeholderData: (prev) => prev,
  });
}

export function useDocumentDetail(documentId: string | null) {
  const { projectId, can } = useProjectContext();
  return useQuery({
    queryKey: fk.document(projectId, documentId ?? ''),
    queryFn: ({ signal }) => api(documentsRoutes.getDocument, { params: { projectId, documentId: documentId! }, signal }),
    enabled: !!documentId && can('documents.document.read'),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Clearance (UI hint only — the server applies the same rule and answers 403 for a classification above it)

/**
 * The caller's effective clearance for finance records (access-matrix §2.3): the user's clearance raised by the finance
 * domain clearance of their project-wide roles (e.g. Finance Restricted → strictly confidential). Same function as the API.
 */
export function useFinanceClearance(): Classification {
  const { me, projectId } = useProjectContext();
  const access = projectAccess(me, projectId);
  return financeDomainClearance(me.user.clearance, access?.roles ?? []);
}

/** Classifications the caller may record finance data under (never above the finance clearance). */
export function useWritableClassifications(): Classification[] {
  const clearance = useFinanceClearance();
  return CLASSIFICATIONS.filter((c) => clearanceAllows(clearance, c));
}

/** The record type's proposed default classification, lowered to the caller's clearance when it is above it. */
export function defaultClassification(proposed: Classification, writable: readonly Classification[]): Classification {
  if (writable.includes(proposed)) return proposed;
  return writable[writable.length - 1] ?? proposed;
}

// ---------------------------------------------------------------------------------------------------------------
// Separation of duties (REQ-FIN-010) — who may act on a figure / model version. Mirrors the server's rules (domain
// assertFigureValidatable / assertFigureApprovable + policy not_self) so the UI never OFFERS a command the server
// would refuse; the server still decides.

export type FigureCommand = 'validate' | 'approve' | 'reject' | 'reopen';
export interface CommandRight {
  offered: boolean;
  /** Why the command is not offered to this user (translated key), when the state allows it. */
  reason: MessageKey | null;
}

export function figureRights(
  f: { state: string; createdBy: string | null; approval: Pick<FigureApproval, 'preparedBy' | 'validatedBy' | 'validationCurrent'> },
  me: string,
  canApprove: boolean,
  opts: { superseded?: boolean } = {},
): Record<FigureCommand, CommandRight> {
  const prepared = me === f.approval.preparedBy || me === f.createdBy;
  const validated = me === f.approval.validatedBy;
  const no: CommandRight = { offered: false, reason: null };
  const right = (stateOk: boolean, blockers: [boolean, MessageKey][]): CommandRight => {
    if (!stateOk || !canApprove || opts.superseded) return no;
    const hit = blockers.find(([b]) => b);
    return hit ? { offered: false, reason: hit[1] } : { offered: true, reason: null };
  };
  return {
    validate: right(f.state === 'proposed' || f.state === 'rejected', [[prepared, 'finance.sod.youPrepared']]),
    approve: right(f.state === 'under_review', [
      [prepared, 'finance.sod.youPrepared'],
      [validated, 'finance.sod.youValidated'],
      [!f.approval.validationCurrent, 'finance.sod.validationStale'],
    ]),
    // The server checks the rejecter against the preparer of the content (policy not_self).
    reject: right(f.state === 'under_review', [[me === f.approval.preparedBy, 'finance.sod.youPrepared']]),
    reopen: right(f.state === 'approved', []),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Formatting

/** Groups a numeric(20,4) decimal string for display ("250000.0000" → "250,000") without going through a float. */
export function groupDecimal(amount: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) return amount;
  const fraction = (m[3] ?? '').replace(/0+$/, '');
  const whole = (m[2] ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${m[1] ?? ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function isNegativeDecimal(amount: string | null | undefined): boolean {
  return !!amount && /^-/.test(amount.trim()) && !/^-0*(\.0*)?$/.test(amount.trim());
}

export function isZeroDecimal(amount: string | null | undefined): boolean {
  return !!amount && /^-?0*(\.0*)?$/.test(amount.trim());
}

/** Message parameters that carry an enum value (translated before interpolation). */
const ENUM_PARAMS: Readonly<Record<string, Readonly<Record<string, StatusEnum>>>> = {
  'finance.compare.basis_mismatch': { basisA: 'valueBases', basisB: 'valueBases' },
};
const UNIT_SCALE_PARAMS = new Set(['unitScale', 'registerUnitScale', 'lineUnitScale', 'scaleA', 'scaleB', 'target']);
const AMOUNT_PARAMS = new Set(['difference', 'spent', 'committed', 'approved']);

/**
 * Renders finance server messages (`<field>I18n`: codes + parameters, module guide §2) in the active locale:
 * `finance.messages.<code>`. Enum values, unit scales, categories and measures are translated; amounts are grouped.
 * Falls back to the English sentence when the server sent no codes.
 */
export function useFinanceMessages() {
  const { t, tStatus, formatNumber, formatList, formatDate } = useI18n();
  const unit = useCallback((v: unknown) => {
    const n = Number(v);
    return n === 1 || n === 1000 || n === 1_000_000 ? t(`finance.units.${n as UnitScaleOption}`) : String(v ?? '');
  }, [t]);
  return useCallback(
    (messages: readonly ServerMessageDto[] | null | undefined, fallback?: string | null): string | null => {
      if (!messages || messages.length === 0) return fallback ?? null;
      return messages
        .map((m) => {
          const values = Object.fromEntries(
            Object.entries(m.params).map(([k, v]) => {
              const e = ENUM_PARAMS[m.code]?.[k];
              if (e) return [k, tStatus(e, String(v))];
              if (k === 'measureA' || k === 'measureB') return [k, (OUTPUT_MEASURE_VALUES as readonly string[]).includes(String(v)) ? t(`finance.measures.${v as 'money' | 'percent'}`) : String(v)];
              if (k === 'categories') return [k, formatList(String(v).split(', ').map((c) => tStatus('financialCategories', c)))];
              if (k === 'scales') return [k, formatList(String(v).split(', ').map(unit))];
              if (UNIT_SCALE_PARAMS.has(k)) return [k, unit(v)];
              if (AMOUNT_PARAMS.has(k) && typeof v === 'string') return [k, groupDecimal(v)];
              if (k === 'asOf' && typeof v === 'string') return [k, formatDate(v)];
              return [k, typeof v === 'number' ? formatNumber(v) : v];
            }),
          );
          return t(`finance.messages.${m.code}` as MessageKey, values);
        })
        .join(' ');
    },
    [t, tStatus, formatNumber, formatList, formatDate, unit],
  );
}

/** Finance error codes with a translated explanation (`finance.errors.<code with dots as _>`), shown next to the server's detail. */
export const TRANSLATED_ERROR_CODES = [
  'finance.validation.self',
  'finance.approval.self',
  'finance.approval.validator',
  'finance.approval.not_validated',
  'finance.approval.validation_stale',
  'finance.approval.decision_required',
  'finance.approval.decision_not_final',
  'finance.approval.not_requested',
  'finance.human_required',
  'finance.recon.self',
  'finance.recon.unexplained_difference',
  'finance.recon.counterparty_missing',
  'finance.recon.locked',
  'finance.benefit.verify_self',
  'finance.benefit.approve_self',
  'finance.benefit.verification_source_required',
  'finance.benefit.accepted_definition_locked',
  'finance.benefit.realization_pending',
  'finance.model.approval_not_configured',
  'finance.model.superseded',
  'finance.model.decision_not_final',
  'finance.model.headline_basis_required',
  'finance.budget.decision_not_final',
  'finance.budget.tsa_already_counted',
  'finance.snapshot.locked',
  'finance.snapshot.imported_locked',
  'finance.snapshot.duplicate_line',
  'finance.double_count.category_conflict',
  'finance.double_count.tsa_line_conflict',
  'finance.double_count.line_conflict',
  'finance.tsa_charge.link_required',
  'money.mixed_currency',
  'money.mixed_unit_scale',
  'policy.classification_exceeds_clearance',
  'policy.sod_subject_unknown',
] as const;
export type TranslatedErrorCode = (typeof TRANSLATED_ERROR_CODES)[number];

export function errorKey(code: string | undefined): MessageKey | null {
  if (!code || !(TRANSLATED_ERROR_CODES as readonly string[]).includes(code)) return null;
  return `finance.errors.${code.replace(/\./g, '_')}` as MessageKey;
}
