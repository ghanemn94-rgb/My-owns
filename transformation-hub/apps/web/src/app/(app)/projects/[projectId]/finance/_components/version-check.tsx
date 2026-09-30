'use client';

import { ScanSearch, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { financeRoutes } from '@hub/contracts';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { SelectField, TextField } from '@/components/Field';
import { ScrollRegion } from '@/components/ScrollRegion';
import { StatusBadge, type Tone } from '@/components/StatusBadge';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { groupDecimal, type ConversionBasis, type FinancialModelDetail, type ModelCheck, type ModelOutput } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { MessageList, currencyValid, decimalValid } from './fin';

const STATUS_TONE: Record<string, Tone> = { compared: 'success', basis_mismatch: 'danger', currency_without_basis: 'danger', unit_mismatch: 'danger', measure_mismatch: 'danger', missing: 'warning' };

export function OutputValue({ o }: { o: ModelOutput | null }) {
  const { t, tStatus } = useI18n();
  if (!o) return <span className="text-muted">{EM_DASH}</span>;
  return (
    <span className="flex flex-col gap-0.5">
      <span dir="ltr" className="tabular">
        {groupDecimal(o.amount)}
        {o.measure === 'percent' ? ' %' : ` ${o.currency ?? ''}`}
      </span>
      <span className="text-xs text-muted">
        {tStatus('valueBases', o.basis)}
        {o.measure === 'money' && o.unitScale && o.unitScale !== 1 ? ` · ${t(`finance.units.${o.unitScale as 1000 | 1000000}`)}` : ''}
      </span>
    </span>
  );
}

/**
 * REQ-FIN-007: EV vs equity / currency / unit consistency of a version, optionally compared key by key with another
 * version. Mismatched bases, currencies without a basis, mixed units and money-vs-percent are NOT compared — the server
 * reports them. Not a professional valuation.
 */
export function VersionCheckPanel({ model, versionId }: { model: FinancialModelDetail; versionId: string }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const headingId = useId();
  const [compareTo, setCompareTo] = useState('');
  const [conversions, setConversions] = useState<ConversionBasis[]>([]);
  const [result, setResult] = useState<ModelCheck | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const others = model.versions.filter((v) => v.id !== versionId);
  const convOk = conversions.every((c) => currencyValid(c.from) && currencyValid(c.to) && c.from !== c.to && decimalValid(c.rate) && c.source.trim().length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(c.asOf));
  const setConv = (i: number, patch: Partial<ConversionBasis>) => setConversions((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api(financeRoutes.checkModelVersion, {
          params: { projectId, modelId: model.id, versionId },
          body: { ...(compareTo ? { compareToVersionId: compareTo } : {}), ...(compareTo && conversions.length ? { conversions: conversions.map((c) => ({ ...c, rate: c.rate.trim(), source: c.source.trim() })) } : {}) },
        }),
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby={headingId} className={cx(card, 'space-y-3 p-4')} data-testid="version-check">
      <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold text-ink">
        <ScanSearch aria-hidden="true" className="size-5 text-muted" />
        {t('finance.check.title')}
      </h2>
      <p className="text-sm text-muted">{t('finance.check.explain')}</p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (convOk && !busy) void run();
        }}
      >
        <SelectField label={t('finance.check.compareTo')} value={compareTo} onChange={(e) => setCompareTo(e.target.value)} data-testid="check-compare-to">
          <option value="">{t('finance.check.noComparison')}</option>
          {others.map((v) => (
            <option key={v.id} value={v.id}>
              {t('finance.models.caseVersion', { case: tStatus('modelCases', v.modelCase), version: v.versionNo })} — {v.versionLabel}
            </option>
          ))}
        </SelectField>
        {compareTo ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-ink">{t('finance.aggregate.conversions')}</legend>
            <p className="text-xs text-muted">{t('finance.check.conversionHint')}</p>
            {conversions.map((c, i) => (
              <div key={i} className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-5">
                <TextField label={t('finance.aggregate.from')} required dir="ltr" maxLength={3} value={c.from} onChange={(e) => setConv(i, { from: e.target.value.toUpperCase() })} />
                <TextField label={t('finance.aggregate.to')} required dir="ltr" maxLength={3} value={c.to} onChange={(e) => setConv(i, { to: e.target.value.toUpperCase() })} />
                <TextField label={t('finance.aggregate.rate')} required dir="ltr" inputMode="decimal" value={c.rate} onChange={(e) => setConv(i, { rate: e.target.value })} />
                <TextField label={t('finance.aggregate.source')} required maxLength={300} value={c.source} onChange={(e) => setConv(i, { source: e.target.value })} />
                <TextField label={t('finance.aggregate.asOf')} required type="date" dir="ltr" value={c.asOf} onChange={(e) => setConv(i, { asOf: e.target.value })} />
                <div className="sm:col-span-5">
                  <button type="button" className={btn.ghost} onClick={() => setConversions((cs) => cs.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden="true" className="size-4" />
                    {t('finance.aggregate.removeConversion')}
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className={btn.secondary} onClick={() => setConversions((cs) => [...cs, { from: '', to: '', rate: '', source: '', asOf: '' }])} disabled={conversions.length >= 10}>
              <Plus aria-hidden="true" className="size-4" />
              {t('finance.aggregate.addConversion')}
            </button>
          </fieldset>
        ) : null}
        <button type="submit" className={btn.secondary} disabled={!convOk || busy} data-testid="check-run">
          <ScanSearch aria-hidden="true" className="size-4" />
          {busy ? t('common.actions.working') : t('finance.check.run')}
        </button>
      </form>
      <ApiErrorNotice error={error} />
      {result ? (
        <div className="space-y-3" data-testid="check-result">
          <MessageList messages={result.findingsI18n} fallback={result.findings} tone="warning" empty={t('finance.check.noFindings')} testId="check-findings" />
          {result.comparison ? (
            <ScrollRegion label={t('finance.check.comparison')} className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" data-testid="check-comparison">
                <caption className="sr-only">{t('finance.check.comparison')}</caption>
                <thead className="bg-surface-muted">
                  <tr>
                    <th scope="col" className="px-2 py-1 text-start font-semibold">{t('finance.versions.outputLabel')}</th>
                    <th scope="col" className="px-2 py-1 text-start font-semibold">{t('finance.check.thisVersion')}</th>
                    <th scope="col" className="px-2 py-1 text-start font-semibold">{t('finance.check.otherVersion')}</th>
                    <th scope="col" className="px-2 py-1 text-start font-semibold">{t('finance.check.status')}</th>
                    <th scope="col" className="px-2 py-1 text-start font-semibold">{t('finance.check.difference')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.comparison.rows.map((r) => (
                    <tr key={r.key} className="border-t border-line align-top" data-status={r.status}>
                      <th scope="row" className="px-2 py-1 text-start font-medium">
                        <span className="flex flex-col gap-0.5">
                          <span dir="auto">{r.label}</span>
                          <code className="text-xs font-normal text-muted" dir="ltr">
                            {r.key}
                          </code>
                        </span>
                      </th>
                      <td className="px-2 py-1">
                        <OutputValue o={r.a} />
                      </td>
                      <td className="px-2 py-1">
                        <OutputValue o={r.b} />
                      </td>
                      <td className="px-2 py-1">
                        <StatusBadge enumName="approvalStates" value={r.status} tone={STATUS_TONE[r.status] ?? 'neutral'} label={t(`finance.check.statuses.${r.status}`)} />
                        <MessageList messages={r.notesI18n} fallback={r.notes} />
                      </td>
                      <td className="px-2 py-1 tabular" dir="ltr">
                        {r.difference !== null ? groupDecimal(r.difference) : EM_DASH}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
