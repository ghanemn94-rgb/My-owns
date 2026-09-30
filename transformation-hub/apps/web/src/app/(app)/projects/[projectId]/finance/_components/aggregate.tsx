'use client';

import Link from 'next/link';
import { Calculator, Plus, Scale, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { financeRoutes } from '@hub/contracts';
import { APPROVAL_STATES, FINANCIAL_CATEGORIES, FINANCIAL_KINDS } from '@hub/domain';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { SelectField, TextField } from '@/components/Field';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { finHref, type AggregateBody, type AggregateResult, type ConversionBasis, type UnitScaleOption } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { Amount, MessageList, currencyValid, decimalValid, useUnitLabel } from './fin';

const blankConversion = (from = '', to = ''): ConversionBasis => ({ from, to, rate: '', source: '', asOf: '' });
const conversionComplete = (c: ConversionBasis) => currencyValid(c.from) && currencyValid(c.to) && c.from !== c.to && decimalValid(c.rate) && !c.rate.trim().startsWith('-') && c.source.trim().length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(c.asOf);

/**
 * Totals through the API's aggregation only (REQ-DAT-004, AT-29). The client never adds amounts: it sends the selection
 * (a kind with filters, or explicit figures) and, when needed, an explicit conversion basis supplied by the user (rate,
 * source, rate date) or an explicit unit normalization. Mixed currencies without a basis are REFUSED by the server (422)
 * and shown as such; a total always shows the basis the server returns.
 */
export function AggregatePanel({ snapshotIds, testId = 'aggregate-panel', framed = true }: { snapshotIds?: string[]; testId?: string; framed?: boolean }) {
  const { t, tStatus, formatDate, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const unit = useUnitLabel();
  const headingId = useId();
  const byIds = !!snapshotIds;
  const [kind, setKind] = useState<string>(byIds ? '' : 'actual');
  const [category, setCategory] = useState('');
  const [period, setPeriod] = useState('');
  const [approvalState, setApprovalState] = useState('');
  const [targetCurrency, setTargetCurrency] = useState('');
  const [targetUnitScale, setTargetUnitScale] = useState('');
  const [normalizeUnits, setNormalizeUnits] = useState(false);
  const [conversions, setConversions] = useState<ConversionBasis[]>([]);
  const [result, setResult] = useState<AggregateResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const ready = (byIds ? (snapshotIds?.length ?? 0) > 0 : !!kind) && (!targetCurrency || currencyValid(targetCurrency)) && conversions.every(conversionComplete);
  const setConv = (i: number, patch: Partial<ConversionBasis>) => setConversions((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const body: AggregateBody = {
      ...(byIds ? { snapshotIds } : { kind: kind as (typeof FINANCIAL_KINDS)[number] }),
      ...(!byIds && category ? { category: category as (typeof FINANCIAL_CATEGORIES)[number] } : {}),
      ...(!byIds && period.trim() ? { period: period.trim() } : {}),
      ...(!byIds && approvalState ? { approvalState: approvalState as (typeof APPROVAL_STATES)[number] } : {}),
      ...(targetCurrency ? { targetCurrency: targetCurrency.trim().toUpperCase() } : {}),
      ...(targetUnitScale ? { targetUnitScale: Number(targetUnitScale) as UnitScaleOption } : {}),
      ...(normalizeUnits ? { normalizeUnits: true } : {}),
      ...(conversions.length ? { conversions: conversions.map((c) => ({ from: c.from.trim().toUpperCase(), to: c.to.trim().toUpperCase(), rate: c.rate.trim(), source: c.source.trim(), asOf: c.asOf })) } : {}),
    };
    try {
      setResult(await api(financeRoutes.aggregateFigures, { params: { projectId }, body }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const e = isApiError(error) ? error : null;
  const mixedCurrency = e?.code === 'money.mixed_currency' ? { from: String(e.details?.['from'] ?? ''), to: String(e.details?.['to'] ?? '') } : null;
  const mixedUnits = e?.code === 'money.mixed_unit_scale' ? (Array.isArray(e.details?.['scales']) ? (e.details?.['scales'] as number[]) : []) : null;
  const nothing = e?.code === 'money.currency_required';
  const mixedKinds = e?.code === 'finance.aggregate.mixed_kinds';
  const otherError = error && !mixedCurrency && !mixedUnits && !nothing && !mixedKinds ? error : null;

  return (
    <section aria-labelledby={headingId} className={cx(framed && card, framed && 'p-4', 'space-y-4')} data-testid={testId}>
      <div>
        <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold text-ink">
          <Calculator aria-hidden="true" className="size-5 text-muted" />
          {byIds ? t('finance.aggregate.selectedTitle', { count: snapshotIds?.length ?? 0 }) : t('finance.aggregate.title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('finance.aggregate.explain')}</p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (ready && !busy) void run();
        }}
      >
        {!byIds ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField label={t('finance.snapshots.kind')} required value={kind} onChange={(ev) => setKind(ev.target.value)} data-testid="aggregate-kind" hint={t('finance.aggregate.kindHint')}>
              {FINANCIAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {tStatus('financialKinds', k)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t('finance.snapshots.category')} value={category} onChange={(ev) => setCategory(ev.target.value)}>
              <option value="">{t('finance.common.all')}</option>
              {FINANCIAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tStatus('financialCategories', c)}
                </option>
              ))}
            </SelectField>
            <TextField label={t('finance.snapshots.period')} dir="ltr" value={period} maxLength={16} onChange={(ev) => setPeriod(ev.target.value)} hint={t('finance.snapshots.periodHint')} data-testid="aggregate-period" />
            <SelectField label={t('finance.snapshots.approvalState')} value={approvalState} onChange={(ev) => setApprovalState(ev.target.value)}>
              <option value="">{t('finance.common.all')}</option>
              {APPROVAL_STATES.map((s) => (
                <option key={s} value={s}>
                  {tStatus('approvalStates', s)}
                </option>
              ))}
            </SelectField>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label={t('finance.aggregate.targetCurrency')}
            dir="ltr"
            maxLength={3}
            value={targetCurrency}
            onChange={(ev) => setTargetCurrency(ev.target.value.toUpperCase())}
            hint={t('finance.aggregate.targetCurrencyHint')}
            data-testid="aggregate-target-currency"
          />
          <SelectField label={t('finance.aggregate.targetUnitScale')} value={targetUnitScale} onChange={(ev) => setTargetUnitScale(ev.target.value)} data-testid="aggregate-target-unit">
            <option value="">{t('finance.aggregate.firstFigureUnit')}</option>
            {([1, 1000, 1_000_000] as const).map((n) => (
              <option key={n} value={String(n)}>
                {unit(n)}
              </option>
            ))}
          </SelectField>
          <label className="flex items-start gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={normalizeUnits} onChange={(ev) => setNormalizeUnits(ev.target.checked)} data-testid="aggregate-normalize" />
            <span>
              {t('finance.aggregate.normalize')}
              <span className="block text-xs text-muted">{t('finance.aggregate.normalizeHint')}</span>
            </span>
          </label>
        </div>

        <fieldset className="space-y-3" data-testid="aggregate-conversions-form">
          <legend className="text-sm font-semibold text-ink">{t('finance.aggregate.conversions')}</legend>
          <p className="text-xs text-muted">{t('finance.aggregate.conversionsHint')}</p>
          {conversions.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-6" data-testid="conversion-row">
              <TextField label={t('finance.aggregate.from')} required dir="ltr" maxLength={3} value={c.from} onChange={(ev) => setConv(i, { from: ev.target.value.toUpperCase() })} data-testid="conversion-from" />
              <TextField label={t('finance.aggregate.to')} required dir="ltr" maxLength={3} value={c.to} onChange={(ev) => setConv(i, { to: ev.target.value.toUpperCase() })} data-testid="conversion-to" />
              <TextField
                label={t('finance.aggregate.rate')}
                required
                dir="ltr"
                inputMode="decimal"
                value={c.rate}
                onChange={(ev) => setConv(i, { rate: ev.target.value })}
                hint={c.from && c.to ? t('finance.aggregate.rateHint', { from: c.from, to: c.to }) : undefined}
                data-testid="conversion-rate"
              />
              <TextField className="sm:col-span-2" label={t('finance.aggregate.source')} required value={c.source} maxLength={300} onChange={(ev) => setConv(i, { source: ev.target.value })} data-testid="conversion-source" />
              <TextField label={t('finance.aggregate.asOf')} required type="date" dir="ltr" value={c.asOf} onChange={(ev) => setConv(i, { asOf: ev.target.value })} data-testid="conversion-asof" />
              <div className="sm:col-span-6">
                <button type="button" className={btn.ghost} onClick={() => setConversions((cs) => cs.filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden="true" className="size-4" />
                  {t('finance.aggregate.removeConversion')}
                </button>
              </div>
            </div>
          ))}
          <button type="button" className={btn.secondary} onClick={() => setConversions((cs) => [...cs, blankConversion()])} data-testid="conversion-add" disabled={conversions.length >= 10}>
            <Plus aria-hidden="true" className="size-4" />
            {t('finance.aggregate.addConversion')}
          </button>
        </fieldset>

        <button type="submit" className={btn.primary} disabled={!ready || busy} aria-busy={busy} data-testid="aggregate-run">
          <Calculator aria-hidden="true" className="size-4" />
          {busy ? t('common.actions.working') : t('finance.aggregate.run')}
        </button>
      </form>

      <div aria-live="polite">
        {mixedCurrency ? (
          <div className="space-y-2 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-ink" data-testid="aggregate-no-basis" data-from={mixedCurrency.from} data-to={mixedCurrency.to}>
            <p className="font-semibold text-danger">{t('finance.aggregate.noBasisTitle')}</p>
            <p>{t('finance.aggregate.noBasisBody', { from: mixedCurrency.from, to: mixedCurrency.to })}</p>
            <button
              type="button"
              className={btn.secondary}
              onClick={() => {
                setConversions((cs) => (cs.some((c) => c.from === mixedCurrency.from && c.to === mixedCurrency.to) ? cs : [...cs, blankConversion(mixedCurrency.from, mixedCurrency.to)]));
                if (!targetCurrency) setTargetCurrency(mixedCurrency.to);
              }}
              data-testid="aggregate-add-basis"
            >
              <Plus aria-hidden="true" className="size-4" />
              {t('finance.aggregate.addBasisFor', { from: mixedCurrency.from, to: mixedCurrency.to })}
            </button>
            {e?.correlationId ? (
              <p className="text-xs text-muted">
                {t('states.error.correlation')} <code dir="ltr">{e.correlationId}</code>
              </p>
            ) : null}
          </div>
        ) : null}
        {mixedUnits ? (
          <div className="space-y-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-ink" data-testid="aggregate-units-differ">
            <p className="font-semibold">{t('finance.aggregate.unitsTitle')}</p>
            <p>{t('finance.aggregate.unitsBody', { scales: mixedUnits.map((s) => unit(s)).join(' / ') })}</p>
            <button type="button" className={btn.secondary} onClick={() => setNormalizeUnits(true)}>
              <Scale aria-hidden="true" className="size-4" />
              {t('finance.aggregate.normalize')}
            </button>
          </div>
        ) : null}
        {nothing ? (
          <p className="rounded-md border border-line bg-surface-muted p-3 text-sm text-ink" data-testid="aggregate-empty">
            {t('finance.aggregate.nothing')}
          </p>
        ) : null}
        {mixedKinds ? (
          <p className="rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-ink" data-testid="aggregate-mixed-kinds">
            {t('finance.aggregate.mixedKinds')}
          </p>
        ) : null}
        <ApiErrorNotice error={otherError} />
        {result ? (
          <div className="space-y-3 rounded-md border border-success/40 p-3" data-testid="aggregate-result">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-sm text-muted">{t('finance.aggregate.total')}</span>
              <span className="text-2xl font-semibold text-ink">
                <Amount value={result.total} showUnits testId="aggregate-total" />
              </span>
              <span className="text-sm text-muted">
                {t('finance.aggregate.count', { count: result.count })}
                {result.kind ? <> · {tStatus('financialKinds', result.kind)}</> : null}
              </span>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">{t('finance.aggregate.basis')}</h3>
              <MessageList messages={result.basisI18n} fallback={[result.basis]} testId="aggregate-basis" />
            </div>
            {result.conversions.length ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm" data-testid="aggregate-conversions">
                  <caption className="sr-only">{t('finance.aggregate.conversionsUsed')}</caption>
                  <thead className="bg-surface-muted">
                    <tr>
                      <th scope="col" className="px-2 py-1 text-start font-semibold">{t('finance.aggregate.pair')}</th>
                      <th scope="col" className="px-2 py-1 text-start font-semibold">{t('finance.aggregate.rate')}</th>
                      <th scope="col" className="px-2 py-1 text-start font-semibold">{t('finance.aggregate.source')}</th>
                      <th scope="col" className="px-2 py-1 text-start font-semibold">{t('finance.aggregate.asOf')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.conversions.map((c) => (
                      <tr key={`${c.from}-${c.to}`} className="border-t border-line">
                        <th scope="row" className="px-2 py-1 text-start font-medium" dir="ltr">
                          {c.from} → {c.to}
                        </th>
                        <td className="px-2 py-1 tabular" dir="ltr" data-testid="conversion-used-rate">
                          {c.rate}
                        </td>
                        <td className="px-2 py-1" dir="auto" data-testid="conversion-used-source">
                          {c.source}
                        </td>
                        <td className="px-2 py-1 tabular" data-testid="conversion-used-asof" data-value={c.asOf}>
                          {formatDate(c.asOf)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {result.normalizedUnitScales.length ? <p className="text-sm text-ink">{t('finance.aggregate.normalized', { scales: result.normalizedUnitScales.map((s) => unit(s)).join(' / ') })}</p> : null}
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-primary">{t('finance.aggregate.contributing', { count: result.items.length })}</summary>
              {result.count > result.items.length ? <p className="mt-1 text-xs text-muted">{t('finance.aggregate.itemsCapped', { shown: formatNumber(result.items.length), count: formatNumber(result.count) })}</p> : null}
              <ul className="mt-2 space-y-1" data-testid="aggregate-items">
                {result.items.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2">
                    <Link className={btn.link} href={finHref(projectId, `/snapshots/${x.id}`)} dir="ltr">
                      {x.lineRef}
                    </Link>
                    <span dir="auto">{x.label}</span>
                    <span className="text-muted" dir="ltr">
                      {x.period}
                    </span>
                    <StatusBadge enumName="financialKinds" value={x.kind} tone="neutral" />
                    <Amount value={x.amount} />
                  </li>
                ))}
                {result.items.length === 0 ? <li className="text-muted">{EM_DASH}</li> : null}
              </ul>
            </details>
          </div>
        ) : null}
      </div>
    </section>
  );
}
