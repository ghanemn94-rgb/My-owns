'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, CircleCheck, CircleDashed, History, ShieldAlert, UserX } from 'lucide-react';
import { useEffect, useId, useState, type ComponentProps, type ReactNode } from 'react';
import { portfolioRoutes, type ServerMessageDto } from '@hub/contracts';
import { clearanceAllows, type Classification, type EvidenceTargetType } from '@hub/domain';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { EvidencePanel } from '@/components/EvidencePanel';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { SelectField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { Pagination } from '@/components/Pagination';
import { StatusBadge } from '@/components/StatusBadge';
import { FormDialog } from '@/components/planning/dialogs';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import {
  errorKey,
  finHref,
  groupDecimal,
  useDecisionsOfTypes,
  useDocumentDetail,
  useDocumentOptions,
  useFinanceClearance,
  useFinanceMessages,
  useTsaOptions,
  useWritableClassifications,
  type CommandRight,
  type FigureApproval,
  type FigureCommand,
  type MoneyValue,
  type People,
  type UnitScaleOption,
} from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { useWorkstreams } from '@/lib/queries';
import { workstreamName } from '@/lib/workstreams';

// Generic list / layout helpers shared with the Committee Hub and the Day-1 & TSA Center (same URL state and filter bar).
export { FilterBar, FilterSelect, Facts, UText, ButtonRow, useUrlState } from '../../committee/_components/gov';
export { Panel, Callout, CmdButton } from '../../readiness/_components/rd';

// ---------------------------------------------------------------------------------------------------------------
// Sub-navigation

const TABS = [
  { key: 'summary', segment: '', also: [] as string[] },
  { key: 'snapshots', segment: '/snapshots', also: [] as string[] },
  { key: 'budget', segment: '/budget', also: [] as string[] },
  { key: 'reconciliations', segment: '/reconciliations', also: [] as string[] },
  { key: 'models', segment: '/models', also: [] as string[] },
  { key: 'benefits', segment: '/benefits', also: ['/kpis'] },
] as const;

export function FinanceTabs() {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const pathname = usePathname() ?? '';
  const base = finHref(projectId);
  const under = (segment: string) => pathname === `${base}${segment}` || pathname.startsWith(`${base}${segment}/`);
  const active = (tab: (typeof TABS)[number]) => (tab.segment === '' ? pathname === base : under(tab.segment) || tab.also.some(under));
  return (
    <nav aria-label={t('finance.tabs.label')} className="mb-5 overflow-x-auto border-b border-line" data-testid="finance-tabs">
      <ul className="flex min-w-max gap-1">
        {TABS.map((tab) => {
          const on = active(tab);
          return (
            <li key={tab.key}>
              <Link
                href={`${base}${tab.segment}`}
                aria-current={on ? 'page' : undefined}
                data-tab={tab.key}
                className={cx('inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-medium', on ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink')}
              >
                {t(`finance.tabs.${tab.key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** "Records above your finance clearance are not listed or counted" — honest scope note (UI hint; the API filters in SQL). */
export function ClearanceNote() {
  const { t, tStatus } = useI18n();
  const clearance = useFinanceClearance();
  if (clearance === 'strictly_confidential') return null;
  return (
    <p className="mb-4 flex items-start gap-2 rounded-md border border-line bg-surface-muted p-3 text-sm text-ink" role="note" data-testid="clearance-note">
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
      <span>{t('finance.common.clearanceNote', { clearance: tStatus('classifications', clearance) })}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Values

/** Accepted period formats — technical tokens, always rendered left-to-right (also in the Arabic UI). */
const PERIOD_FORMATS = '2026 · 2026-H1 · 2026-Q3 · 2026-09 · FY2026';
export function PeriodHint() {
  const { t } = useI18n();
  return (
    <>
      {t('finance.snapshots.periodHint')}{' '}
      <span dir="ltr" className="whitespace-nowrap">
        {PERIOD_FORMATS}
      </span>
    </>
  );
}

/** Unit scale in words (units / thousands / millions). */
export function useUnitLabel() {
  const { t } = useI18n();
  return (n: number | null | undefined) => (n === 1 || n === 1000 || n === 1_000_000 ? t(`finance.units.${n as UnitScaleOption}`) : n === null || n === undefined ? EM_DASH : String(n));
}

/**
 * Money as recorded: grouped decimal + ISO currency, and the unit scale whenever it is not "units" — never converted,
 * never added to anything on the client.
 */
export function Amount({ value, showUnits = false, className, testId }: { value: MoneyValue | null | undefined; showUnits?: boolean; className?: string; testId?: string }) {
  const unit = useUnitLabel();
  if (!value) return <span className="text-muted">{EM_DASH}</span>;
  return (
    <span className={cx('whitespace-nowrap', className)} data-testid={testId} data-currency={value.currency} data-unit-scale={value.unitScale} data-amount={value.amount}>
      <span dir="ltr" className="tabular">
        {groupDecimal(value.amount)} {value.currency}
      </span>
      {showUnits || value.unitScale !== 1 ? <span className="ms-1 text-xs text-muted">({unit(value.unitScale)})</span> : null}
    </span>
  );
}

/** A person referenced by a record: "You", the display name the server resolved, or a short id — never a guess. */
export function Person({ id, people }: { id: string | null | undefined; people: People | undefined }) {
  const { t } = useI18n();
  const { me } = useProjectContext();
  if (!id) return <span className="text-muted">{EM_DASH}</span>;
  if (id === me.user.id) return <span className="font-medium">{t('finance.common.you')}</span>;
  const name = people?.[id];
  return name ? <span dir="auto">{name}</span> : <span dir="ltr">{t('finance.common.unknownUser', { id: id.slice(-6) })}</span>;
}

/** Server-computed explanations (codes + parameters), one per line, in the active language. */
export function MessageList({ messages, fallback, tone = 'neutral', testId, empty }: { messages: readonly ServerMessageDto[]; fallback: readonly string[]; tone?: 'neutral' | 'warning' | 'danger'; testId?: string; empty?: string }) {
  const fin = useFinanceMessages();
  if (messages.length === 0 && fallback.length === 0) return empty ? <p className="text-sm text-muted">{empty}</p> : null;
  const items = messages.length ? messages.map((m, i) => ({ code: m.code, text: fin([m], fallback[i]) })) : fallback.map((f) => ({ code: '', text: f }));
  return (
    <ul className={cx('space-y-1 text-sm', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-ink')} data-testid={testId}>
      {items.map((m, i) => (
        <li key={`${m.code}-${i}`} data-code={m.code} className="flex items-start gap-1.5">
          {tone !== 'neutral' ? <ShieldAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> : null}
          <span dir="auto">{m.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Where a figure comes from: source type, reference, document (link), sheet and cell. */
export function SourceText({
  sourceType,
  sourceRef,
  sourceDocumentId,
  sheet,
  cell,
  compact = false,
}: {
  sourceType: string;
  sourceRef: string | null;
  sourceDocumentId: string | null;
  sheet?: string | null;
  cell?: string | null;
  compact?: boolean;
}) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const ref = sheet || cell ? [sheet, cell].filter(Boolean).join('!') : null;
  return (
    <span className={cx('flex flex-col gap-0.5', compact && 'text-xs')} data-testid="source-text">
      <span className="text-muted">{tStatus('sourceTypes', sourceType)}</span>
      {sourceRef ? (
        <span dir="auto" className={compact ? 'line-clamp-2' : 'whitespace-pre-wrap'}>
          {sourceRef}
        </span>
      ) : null}
      {sourceDocumentId ? (
        <Link className={btn.link} href={`/projects/${projectId}/documents/${sourceDocumentId}`}>
          {t('finance.common.sourceDocument')}
        </Link>
      ) : null}
      {ref ? (
        <span>
          <span className="text-muted">{t('finance.common.cellRef')}: </span>
          <code dir="ltr">{ref}</code>
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Dialogs: the shared confirm / form dialogs + a translated explanation of known finance refusals (separation of
// duties, missing validation, unit / currency confusion). The server's own detail is still shown by the shared notice.

export function ErrorReason({ error }: { error: unknown }) {
  const { t } = useI18n();
  const key = isApiError(error) ? errorKey(error.code) : null;
  if (!key) return null;
  return (
    <p role="note" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-ink" data-testid="finance-reason" data-code={isApiError(error) ? error.code : ''}>
      <span className="font-semibold">{t('finance.common.why')}: </span>
      {t(key)}
    </p>
  );
}

export function FinCommandDialog(props: ComponentProps<typeof ConfirmCommandDialog>) {
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (props.open) setErr(null);
  }, [props.open]);
  return (
    <ConfirmCommandDialog
      {...props}
      onConfirm={async (i) => {
        setErr(null);
        try {
          return await props.onConfirm(i);
        } catch (e) {
          setErr(e);
          throw e;
        }
      }}
    >
      {props.children}
      <ErrorReason error={err} />
    </ConfirmCommandDialog>
  );
}

export function FinFormDialog(props: ComponentProps<typeof FormDialog>) {
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (props.open) setErr(null);
  }, [props.open]);
  return (
    <FormDialog
      {...props}
      onSubmit={async () => {
        setErr(null);
        try {
          return await props.onSubmit();
        } catch (e) {
          setErr(e);
          throw e;
        }
      }}
    >
      {props.children}
      <ErrorReason error={err} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Form fields

export interface MoneyForm {
  amount: string;
  currency: string;
  unitScale: string;
}
const DECIMAL = /^-?\d{1,16}(\.\d{1,4})?$/;
const CURRENCY = /^[A-Z]{3}$/;
export const emptyMoney = (currency = '', unitScale = '1'): MoneyForm => ({ amount: '', currency, unitScale });
export const moneyFormOf = (m: MoneyValue | null | undefined): MoneyForm => (m ? { amount: m.amount.replace(/\.?0+$/, '') || '0', currency: m.currency, unitScale: String(m.unitScale) } : emptyMoney());
export function moneyValid(f: MoneyForm, required = true): boolean {
  if (!f.amount.trim()) return !required;
  return DECIMAL.test(f.amount.trim()) && CURRENCY.test(f.currency.trim()) && ['1', '1000', '1000000'].includes(f.unitScale);
}
export function moneyOf(f: MoneyForm): { amount: string; currency: string; unitScale: UnitScaleOption } | null {
  if (!f.amount.trim()) return null;
  return { amount: f.amount.trim(), currency: f.currency.trim().toUpperCase(), unitScale: Number(f.unitScale) as UnitScaleOption };
}
export const decimalValid = (s: string) => DECIMAL.test(s.trim());
export const currencyValid = (s: string) => CURRENCY.test(s.trim());

/** Amount + ISO currency + unit scale, always entered together (money is never a bare number). */
export function MoneyFields({
  legend,
  value,
  onChange,
  required = false,
  lockUnit = false,
  testId,
  hint,
}: {
  legend: string;
  value: MoneyForm;
  onChange: (v: MoneyForm) => void;
  required?: boolean;
  lockUnit?: boolean;
  testId?: string;
  hint?: string;
}) {
  const { t } = useI18n();
  const unit = useUnitLabel();
  const amountBad = value.amount.trim() !== '' && !decimalValid(value.amount);
  const currencyBad = value.amount.trim() !== '' && !currencyValid(value.currency);
  return (
    <fieldset className="space-y-2" data-testid={testId}>
      <legend className="text-sm font-medium text-ink">
        {legend}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            {' '}
            *
          </span>
        ) : (
          <span className="font-normal text-muted"> ({t('common.optional')})</span>
        )}
      </legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label={t('finance.money.amount')}
          required={required}
          inputMode="decimal"
          dir="ltr"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          error={amountBad ? t('finance.money.amountInvalid') : null}
          data-testid={testId ? `${testId}-amount` : undefined}
        />
        <TextField
          label={t('finance.money.currency')}
          required={required}
          dir="ltr"
          maxLength={3}
          value={value.currency}
          disabled={lockUnit}
          onChange={(e) => onChange({ ...value, currency: e.target.value.toUpperCase() })}
          error={currencyBad ? t('finance.money.currencyInvalid') : null}
          data-testid={testId ? `${testId}-currency` : undefined}
        />
        <SelectField
          label={t('finance.money.unitScale')}
          required={required}
          value={value.unitScale}
          disabled={lockUnit}
          onChange={(e) => onChange({ ...value, unitScale: e.target.value })}
          data-testid={testId ? `${testId}-unit` : undefined}
        >
          {([1, 1000, 1_000_000] as const).map((n) => (
            <option key={n} value={String(n)}>
              {unit(n)}
            </option>
          ))}
        </SelectField>
      </div>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </fieldset>
  );
}

export function ClassificationSelect({ value, onChange, proposed }: { value: Classification; onChange: (c: Classification) => void; proposed: Classification }) {
  const { t, tStatus } = useI18n();
  const writable = useWritableClassifications();
  return (
    <SelectField
      label={t('finance.common.classification')}
      required
      value={value}
      onChange={(e) => onChange(e.target.value as Classification)}
      hint={t('finance.common.classificationHint', { proposed: tStatus('classifications', proposed) })}
      data-testid="classification-select"
    >
      {writable.map((c) => (
        <option key={c} value={c}>
          {tStatus('classifications', c)}
        </option>
      ))}
    </SelectField>
  );
}

export function WorkstreamSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t, locale } = useI18n();
  const { projectId } = useProjectContext();
  const ws = useWorkstreams(projectId);
  return (
    <SelectField label={t('finance.common.workstream')} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('finance.common.projectLevel')}</option>
      {(ws.data?.items ?? []).map((w) => (
        <option key={w.id} value={w.id}>
          {w.code} — {workstreamName(w, locale)}
        </option>
      ))}
    </SelectField>
  );
}

/** Workstream label of a record's scope ("project level" when none; a short id when the workstream is not visible). */
export function useWorkstreamLabel() {
  const { t, locale } = useI18n();
  const { projectId } = useProjectContext();
  const ws = useWorkstreams(projectId);
  return (id: string | null | undefined) => {
    if (!id) return t('finance.common.projectLevel');
    const w = ws.data?.items.find((x) => x.id === id);
    return w ? `${w.code} — ${workstreamName(w, locale)}` : `#${id.slice(-6)}`;
  };
}

/** TSA service of the readiness register (read-only here; one TSA is charged under one line). */
export function TsaSelect({ value, onChange, required }: { value: string; onChange: (id: string) => void; required?: boolean }) {
  const { t } = useI18n();
  const { can } = useProjectContext();
  const q = useTsaOptions(true);
  if (!can('readiness.register.read')) return <p className="text-sm text-muted">{t('finance.common.tsaNotVisible')}</p>;
  return (
    <SelectField label={t('finance.common.tsa')} required={required} value={value} onChange={(e) => onChange(e.target.value)} data-testid="tsa-select">
      <option value="">{t('finance.common.select')}</option>
      {(q.data?.items ?? []).map((x) => (
        <option key={x.id} value={x.id}>
          {x.code} — {x.name}
        </option>
      ))}
    </SelectField>
  );
}

/** A visible document (and one of its versions) as the source of imported figures / model outputs. */
export function DocumentSelect({
  value,
  onChange,
  required,
}: {
  value: { documentId: string; versionId: string };
  onChange: (v: { documentId: string; versionId: string }) => void;
  required?: boolean;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const docs = useDocumentOptions(q, true);
  const detail = useDocumentDetail(value.documentId || null);
  const versions = detail.data?.versions ?? [];
  return (
    <div className="space-y-2" data-testid="document-select">
      <TextField label={t('finance.common.searchDocuments')} value={q} onChange={(e) => setQ(e.target.value)} />
      <SelectField label={t('finance.common.sourceDocument')} required={required} value={value.documentId} onChange={(e) => onChange({ documentId: e.target.value, versionId: '' })} data-testid="document-select-doc">
        <option value="">{t('finance.common.select')}</option>
        {(docs.data?.items ?? []).map((d) => (
          <option key={d.id} value={d.id}>
            {d.title}
          </option>
        ))}
      </SelectField>
      {value.documentId ? (
        <SelectField label={t('finance.common.sourceVersion')} value={value.versionId} onChange={(e) => onChange({ ...value, versionId: e.target.value })} data-testid="document-select-version">
          <option value="">{t('finance.common.currentVersion')}</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {t('finance.common.versionNo', { version: v.versionNo })}
            </option>
          ))}
        </SelectField>
      ) : null}
    </div>
  );
}

/** Governance decisions of the accepted types (governance owns them; the server re-validates type, finality and project). */
export function DecisionSelect({ typeKeys, value, onChange, required = true }: { typeKeys: readonly string[]; value: string; onChange: (id: string) => void; required?: boolean }) {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const decisions = useDecisionsOfTypes(typeKeys, true);
  if (!can('governance.decision.read')) return <p className="text-sm text-muted">{t('finance.decision.notVisible')}</p>;
  return (
    <div className="space-y-2">
      <SelectField label={t('finance.decision.picker')} required={required} value={value} onChange={(e) => onChange(e.target.value)} hint={t('finance.decision.types', { types: typeKeys.join(', ') })} data-testid="decision-select">
        <option value="">{required ? t('finance.common.select') : t('finance.decision.none')}</option>
        {decisions.items.map((d) => (
          <option key={d.id} value={d.id}>
            {d.code} — {d.title} ({tStatus('decisionStatuses', d.status)})
          </option>
        ))}
      </SelectField>
      {decisions.data && decisions.items.length === 0 ? (
        <p className="text-sm text-muted" data-testid="decision-none">
          {t('finance.decision.noneAvailable')}{' '}
          <Link className={btn.link} href={`/projects/${projectId}/committee/decisions`}>
            {t('finance.decision.openCommittee')}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Human financial validation → approval (REQ-FIN-010): the trail, who may act, and the commands offered to THIS user.

export function ApprovalPanel({
  approval,
  createdBy,
  people,
  rights,
  onCommand,
  approveRule,
  notices,
  decisionHref,
  testId = 'approval-panel',
}: {
  approval: FigureApproval;
  createdBy: string | null;
  people: People;
  rights: Record<FigureCommand, CommandRight>;
  onCommand: (c: FigureCommand) => void;
  /** Extra rule for the approval step (e.g. "an opening balance needs a final governance decision"). */
  approveRule?: ReactNode;
  notices?: ReactNode;
  decisionHref?: string | null;
  testId?: string;
}) {
  const { t, tStatus, formatDateTime, formatDate } = useI18n();
  const { me } = useProjectContext();
  const headingId = useId();
  const reasons = (Object.entries(rights) as [FigureCommand, CommandRight][]).filter(([, r]) => r.reason);
  const offered = (Object.entries(rights) as [FigureCommand, CommandRight][]).filter(([, r]) => r.offered);
  const step = (done: boolean, title: string, body: ReactNode, key: string) => (
    <li key={key} className="flex items-start gap-2" data-step={key} data-done={done ? 'true' : 'false'}>
      {done ? <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />}
      <div className="min-w-0 text-sm">
        <p className="font-medium text-ink">
          {title}
          <span className="sr-only"> — {done ? t('finance.approval.stepDone') : t('finance.approval.stepPending')}</span>
        </p>
        <div className="text-muted">{body}</div>
      </div>
    </li>
  );
  return (
    <section aria-labelledby={headingId} className={cx(card, 'space-y-4 p-4')} data-testid={testId} data-state={approval.state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold text-ink">
          {t('finance.approval.title')}
        </h2>
        <StatusBadge enumName="approvalStates" value={approval.state} size="md" />
      </div>
      {notices}
      <ol className="space-y-3">
        {step(
          !!approval.preparedBy || !!createdBy,
          t('finance.approval.prepared'),
          <span data-testid="prepared-by">
            <Person id={approval.preparedBy ?? createdBy} people={people} />
            {createdBy && approval.preparedBy && createdBy !== approval.preparedBy ? (
              <>
                {' '}
                · {t('finance.approval.createdBy')} <Person id={createdBy} people={people} />
              </>
            ) : null}
          </span>,
          'prepared',
        )}
        {step(
          !!approval.validatedBy,
          t('finance.approval.validated'),
          approval.validatedBy ? (
            <span className="flex flex-col gap-0.5" data-testid="validated-by">
              <span>
                <Person id={approval.validatedBy} people={people} /> · <span className="tabular">{formatDateTime(approval.validatedAt)}</span>
              </span>
              {approval.validationNote ? <span dir="auto" className="text-ink">{approval.validationNote}</span> : null}
              <span className={approval.validationCurrent ? 'text-success' : 'text-danger'}>{approval.validationCurrent ? t('finance.approval.validationCurrent') : t('finance.approval.validationStale')}</span>
            </span>
          ) : (
            t('finance.approval.notValidated')
          ),
          'validated',
        )}
        {step(
          !!approval.approvedBy,
          t('finance.approval.approved'),
          approval.approvedBy ? (
            <span className="flex flex-wrap items-center gap-1" data-testid="approved-by">
              <Person id={approval.approvedBy} people={people} /> · <span className="tabular">{formatDate(approval.approvalDate)}</span>
              {approval.approvalDecisionId && decisionHref ? (
                <>
                  {' '}
                  ·{' '}
                  <Link className={btn.link} href={decisionHref}>
                    {t('finance.approval.decision')}
                  </Link>
                </>
              ) : null}
            </span>
          ) : (
            <span>
              {t('finance.approval.notApproved')}
              {approval.approvalRequestStatus ? (
                <>
                  {' '}
                  · {t('finance.approval.request')}: {tStatus('approvalRequestStatuses', approval.approvalRequestStatus)}
                </>
              ) : null}
            </span>
          ),
          'approved',
        )}
      </ol>
      <div>
        <h3 className="text-sm font-semibold text-ink">{t('finance.approval.whoMayAct')}</h3>
        <ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-ink" data-testid="who-may-act">
          <li>{t('finance.approval.ruleValidate')}</li>
          <li>{t('finance.approval.ruleApprove')}</li>
          {approveRule ? <li>{approveRule}</li> : null}
          <li>{t('finance.approval.ruleHuman')}</li>
        </ul>
      </div>
      {reasons.length ? (
        <ul className="space-y-1" data-testid="sod-reasons">
          {reasons.map(([cmd, r]) => (
            <li key={cmd} className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-2 text-sm text-ink" data-testid="sod-reason" data-command={cmd}>
              <UserX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="font-semibold">{t(`finance.commands.${cmd}`)}: </span>
                {t(r.reason as MessageKey)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {offered.length ? (
        <div className="flex flex-wrap gap-2" data-testid="approval-commands">
          {offered.map(([cmd]) => (
            <button
              key={cmd}
              type="button"
              className={cmd === 'approve' || cmd === 'validate' ? btn.primary : cmd === 'reject' ? btn.danger : btn.secondary}
              onClick={() => onCommand(cmd)}
              data-testid={`cmd-${cmd}`}
            >
              {t(`finance.commands.${cmd}`)}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted" data-testid="no-approval-commands">
          {t('finance.approval.noCommands')}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Record history (activity feed of one record, finance actions translated)

const HISTORY_PAGE = 10;

export function FinanceHistory({ entityType, entityId, className }: { entityType: string; entityId: string; className?: string }) {
  const { t, formatDateTime, tStatus } = useI18n();
  const { projectId, me } = useProjectContext();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const query = { page, pageSize: HISTORY_PAGE, entityType, entityId };
  const q = useQuery({
    queryKey: ['project', projectId, 'activity', { ...query, finance: true }],
    queryFn: ({ signal }) => api(portfolioRoutes.auditTrail, { params: { projectId }, query, signal }),
    enabled: open,
    placeholderData: (prev) => prev,
  });
  const label = (action: string) => {
    const key = action.startsWith('finance.') ? (`finance.audit.${action.slice('finance.'.length).replace(/\./g, '_')}` as MessageKey) : null;
    const text = key ? t(key) : null;
    return text && text !== key ? text : <code dir="ltr">{action}</code>;
  };
  return (
    <details className={cx(card, 'group', className)} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="finance-history">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-semibold text-ink">
        <History aria-hidden="true" className="size-4 text-muted" />
        {t('common.activity.title')}
        <span className="ms-auto text-xs font-normal text-muted group-open:hidden">{t('common.activity.show')}</span>
        <span className="ms-auto hidden text-xs font-normal text-muted group-open:inline">{t('common.activity.hide')}</span>
      </summary>
      <div className="border-t border-line">
        {q.isLoading ? (
          <LoadingState compact />
        ) : isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? (
          // The record itself is readable (this page loaded it); the project activity feed applies the general clearance and
          // its own record-type allow-list, so its answer is explained rather than shown as "not found".
          <p className="px-4 py-3 text-sm text-ink" data-testid="history-unavailable">
            {t('finance.common.historyUnavailable', { clearance: tStatus('classifications', me.user.clearance) })}
          </p>
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data || q.data.items.length === 0 ? (
          <EmptyState title={t('common.activity.empty')} />
        ) : (
          <>
            <ol className="divide-y divide-line">
              {q.data.items.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-start sm:gap-4" data-action={e.action}>
                  <time dateTime={e.at} className="tabular shrink-0 text-muted sm:w-44">
                    {formatDateTime(e.at)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <p className="text-ink">
                      <span className="font-medium" dir="auto">
                        {e.actor ?? tStatus('actorKinds', e.actorKind)}
                      </span>{' '}
                      — {label(e.action)}
                    </p>
                    {e.reason ? (
                      <p className="mt-0.5 text-muted">
                        {t('common.activity.reason')}: <span dir="auto">{e.reason}</span>
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge enumName="auditOutcomes" value={e.outcome} />
                </li>
              ))}
            </ol>
            <div className="border-t border-line px-4 py-2">
              <Pagination page={page} pageSize={HISTORY_PAGE} total={q.data.total} onPageChange={setPage} />
            </div>
          </>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Evidence

/**
 * Evidence of a finance record. The Document & Evidence Center applies the user's GENERAL clearance to the record (not the
 * finance-domain clearance of access-matrix §2.3), so a Finance Restricted user may read a record whose evidence list the
 * server refuses (404). Say so plainly instead of showing a "not found" block inside a page the user can read.
 */
export function FinanceEvidence({ targetType, targetId, classification, className }: { targetType: EvidenceTargetType; targetId: string; classification: Classification; className?: string }) {
  const { t, tStatus } = useI18n();
  const { me } = useProjectContext();
  if (clearanceAllows(me.user.clearance, classification)) return <EvidencePanel className={className} targetType={targetType} targetId={targetId} title={t('finance.common.evidenceTitle')} />;
  return (
    <section className={cx(card, 'p-4', className)} data-testid="evidence-clearance-note">
      <h2 className="mb-2 text-lg font-semibold text-ink">{t('finance.common.evidenceTitle')}</h2>
      <p className="text-sm text-ink">{t('finance.common.evidenceAboveClearance', { clearance: tStatus('classifications', me.user.clearance), classification: tStatus('classifications', classification) })}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Detail page chrome

export function BackToList({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 hover:underline">
      <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
      {label}
    </Link>
  );
}

/** Counts per enum value, each linking to the pre-filtered list of the records that make it up. */
export function StatusCounts({
  enumName,
  counts,
  href,
  testId,
  label,
}: {
  enumName: ComponentProps<typeof StatusBadge>['enumName'];
  counts: Record<string, number>;
  href: (value: string) => string;
  testId: string;
  label?: (value: string) => string;
}) {
  const { t, formatNumber } = useI18n();
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return <p className="text-sm text-muted">{t('finance.summary.none')}</p>;
  return (
    <ul className="flex flex-wrap gap-2" data-testid={testId}>
      {entries.map(([value, n]) => (
        <li key={value}>
          <Link href={href(value)} className="inline-flex items-center gap-1 rounded-md hover:underline" data-value={value}>
            <StatusBadge enumName={enumName} value={value} label={label?.(value)} />
            <span className="tabular text-sm font-medium text-ink">{formatNumber(n)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
