'use client';

import { useEffect, useState } from 'react';
import { financeRoutes } from '@hub/contracts';
import { FINANCE_DEFAULT_CLASSIFICATION, KPI_DIRECTIONS, type Classification } from '@hub/domain';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { hint } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { DATA_QUALITY_VALUES, defaultClassification, useBenefits, useFinanceRefresh, useWritableClassifications, type BenefitDetail, type KpiDetail } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { ClassificationSelect, FinCommandDialog, FinFormDialog, MoneyFields, WorkstreamSelect, decimalValid, emptyMoney, moneyFormOf, moneyOf, moneyValid, PeriodHint } from './fin';
import { periodValid } from './snapshot-forms';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Benefits register entry (REQ-FIN-009): measurement definition, baseline, target, owner, realization date, verification source. */
export function BenefitFormDialog({ open, onClose, benefit, onCreated }: { open: boolean; onClose: () => void; benefit?: BenefitDetail; onCreated?: (id: string) => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const writable = useWritableClassifications();
  const proposed = FINANCE_DEFAULT_CLASSIFICATION.benefit as Classification;
  const init = () => ({
    title: benefit?.title ?? '',
    measurementDefinition: benefit?.measurementDefinition ?? '',
    baselineValue: benefit?.baselineValue ?? '',
    targetValue: benefit?.targetValue ?? '',
    unit: benefit?.unit ?? '',
    value: benefit?.value ? moneyFormOf(benefit.value) : emptyMoney(),
    owner: (benefit?.ownerUserId ? { id: benefit.ownerUserId, displayName: benefit.people[benefit.ownerUserId] ?? benefit.ownerUserId.slice(-6), email: '' } : null) as PickedUser | null,
    workstreamId: benefit?.workstreamId ?? '',
    realizationDate: benefit?.realizationDate ?? '',
    verificationSource: benefit?.verificationSource ?? '',
    classification: (benefit?.classification as Classification | undefined) ?? defaultClassification(proposed, writable),
  });
  const [f, setF] = useState(init);
  useEffect(() => {
    if (open) setF(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, benefit?.version]);
  const valid = f.title.trim() && f.measurementDefinition.trim() && moneyValid(f.value, false);
  const raiseOnly = benefit ? writable.filter((c) => writable.indexOf(c) >= writable.indexOf(benefit.classification as Classification)) : writable;
  return (
    <FinFormDialog
      open={open}
      onClose={onClose}
      size="lg"
      testId="benefit-form"
      title={benefit ? t('finance.benefits.edit.title', { code: benefit.code }) : t('finance.benefits.create.title')}
      submitLabel={benefit ? t('common.actions.save') : t('finance.benefits.create.confirm')}
      disabled={!valid}
      onReload={() => void refresh()}
      onSubmit={async () => {
        const common = {
          measurementDefinition: f.measurementDefinition.trim(),
          baselineValue: f.baselineValue.trim() || null,
          targetValue: f.targetValue.trim() || null,
          unit: f.unit.trim() || null,
          value: moneyOf(f.value),
          ownerUserId: f.owner?.id ?? null,
          workstreamId: f.workstreamId || null,
          realizationDate: f.realizationDate || null,
          verificationSource: f.verificationSource.trim() || null,
          classification: f.classification,
        };
        if (benefit) {
          const r = await api(financeRoutes.updateBenefit, { params: { projectId, benefitId: benefit.id }, body: { expectedVersion: benefit.version, title: f.title.trim(), ...common } });
          await refresh();
          toast.show('success', r.version === benefit.version ? t('finance.common.noChanges') : t('finance.common.saved'));
          onClose();
        } else {
          const r = await api(financeRoutes.createBenefit, { params: { projectId }, body: { title: f.title.trim(), ...common } });
          await refresh();
          toast.show('success', t('finance.benefits.create.done', { code: r.code }));
          onClose();
          onCreated?.(r.id);
        }
      }}
    >
      <p className={hint}>{t('finance.benefits.create.hint')}</p>
      <TextField label={t('finance.benefits.titleField')} required maxLength={300} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="benefit-title" />
      <TextAreaField label={t('finance.benefits.definition')} required rows={3} maxLength={4000} value={f.measurementDefinition} onChange={(e) => setF({ ...f, measurementDefinition: e.target.value })} data-testid="benefit-definition" />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={t('finance.benefits.baseline')} maxLength={500} value={f.baselineValue} onChange={(e) => setF({ ...f, baselineValue: e.target.value })} />
        <TextField label={t('finance.benefits.target')} maxLength={500} value={f.targetValue} onChange={(e) => setF({ ...f, targetValue: e.target.value })} />
        <TextField label={t('finance.benefits.unit')} maxLength={32} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
      </div>
      <MoneyFields legend={t('finance.benefits.value')} value={f.value} onChange={(value) => setF({ ...f, value })} hint={t('finance.benefits.valueHint')} />
      <UserPicker label={t('finance.benefits.owner')} value={f.owner} onChange={(owner) => setF({ ...f, owner })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('finance.benefits.realizationDate')} type="date" dir="ltr" value={f.realizationDate} onChange={(e) => setF({ ...f, realizationDate: e.target.value })} />
        <WorkstreamSelect value={f.workstreamId} onChange={(workstreamId) => setF({ ...f, workstreamId })} />
      </div>
      <TextAreaField label={t('finance.benefits.verificationSource')} rows={2} maxLength={2000} value={f.verificationSource} onChange={(e) => setF({ ...f, verificationSource: e.target.value })} hint={t('finance.benefits.verificationSourceHint')} />
      {benefit ? (
        <SelectField label={t('finance.common.classification')} required value={f.classification} onChange={(e) => setF({ ...f, classification: e.target.value as Classification })} hint={t('finance.common.raiseOnly')}>
          {raiseOnly.map((c) => (
            <option key={c} value={c}>
              {tStatus('classifications', c)}
            </option>
          ))}
        </SelectField>
      ) : (
        <ClassificationSelect value={f.classification} proposed={proposed} onChange={(classification) => setF({ ...f, classification })} />
      )}
    </FinFormDialog>
  );
}

export type BenefitCommand = 'approve' | 'start_tracking' | 'record_realization' | 'verify' | 'reject_realization' | 'cancel' | 'revise_definition';

export function BenefitCommandDialog({ b, cmd, onClose }: { b: BenefitDetail; cmd: BenefitCommand | null; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const [actualValue, setActualValue] = useState('');
  const [realizedOn, setRealizedOn] = useState('');
  const [realized, setRealized] = useState(() => (b.value ? emptyMoney(b.value.currency, String(b.value.unitScale)) : emptyMoney()));
  const [verificationSource, setVerificationSource] = useState(b.verificationSource ?? '');
  if (!cmd) return null;
  const params = { projectId, benefitId: b.id };
  const v = b.version;
  const common = { open: true, onClose, expectedVersion: v, onReload: () => void refresh() };
  const done = async (status: string) => {
    await refresh();
    toast.show('success', t('finance.benefits.commandDone', { status: tStatus('benefitStatuses', status) }));
    onClose();
  };
  switch (cmd) {
    case 'approve':
      return (
        <FinCommandDialog
          {...common}
          title={t('finance.benefits.approve.title', { code: b.code })}
          confirmLabel={t('finance.benefits.commands.approve')}
          consequences={[t('finance.benefits.approve.effect'), t('finance.benefits.approve.sod'), t('common.command.audited')]}
          onConfirm={async ({ note }) => done((await api(financeRoutes.approveBenefit, { params, body: { expectedVersion: v, ...(note ? { note } : {}) } })).status)}
        />
      );
    case 'start_tracking':
      return (
        <FinCommandDialog
          {...common}
          title={t('finance.benefits.startTracking.title', { code: b.code })}
          confirmLabel={t('finance.benefits.commands.start_tracking')}
          consequences={[t('finance.benefits.startTracking.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => done((await api(financeRoutes.startBenefitTracking, { params, body: { expectedVersion: v, ...(note ? { note } : {}) } })).status)}
        />
      );
    case 'record_realization':
      return (
        <FinCommandDialog
          {...common}
          title={t('finance.benefits.realization.title', { code: b.code })}
          confirmLabel={t('finance.benefits.commands.record_realization')}
          confirmDisabled={!actualValue.trim() || !realizedOn || !verificationSource.trim() || !moneyValid(realized, false)}
          consequences={[t('finance.benefits.realization.effect'), t('finance.benefits.realization.unverified'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            const money = moneyOf(realized);
            const r = await api(financeRoutes.recordBenefitRealization, {
              params,
              body: { expectedVersion: v, actualValue: actualValue.trim(), realizedOn, ...(money ? { realized: money } : {}), verificationSource: verificationSource.trim(), ...(note ? { note } : {}) },
            });
            await done(r.status);
          }}
        >
          <TextField label={t('finance.benefits.actual')} required maxLength={500} value={actualValue} onChange={(e) => setActualValue(e.target.value)} data-testid="realization-actual" />
          <TextField label={t('finance.benefits.realizedOn')} required type="date" dir="ltr" max={todayIso()} value={realizedOn} onChange={(e) => setRealizedOn(e.target.value)} data-testid="realization-date" />
          <MoneyFields legend={t('finance.benefits.realized')} lockUnit={!!b.value} value={realized} onChange={setRealized} hint={b.value ? t('finance.benefits.realizedSameUnit') : undefined} />
          <TextAreaField label={t('finance.benefits.verificationSource')} required rows={2} maxLength={2000} value={verificationSource} onChange={(e) => setVerificationSource(e.target.value)} data-testid="realization-source" />
        </FinCommandDialog>
      );
    case 'verify':
      return (
        <FinCommandDialog
          {...common}
          title={t('finance.benefits.verify.title', { code: b.code })}
          confirmLabel={t('finance.benefits.commands.verify')}
          noteMode="required"
          noteLabel={t('finance.benefits.verify.note')}
          consequences={[t('finance.benefits.verify.effect', { source: b.verificationSource ?? '' }), t('finance.benefits.verify.sod'), t('common.command.audited')]}
          onConfirm={async ({ note }) => done((await api(financeRoutes.verifyBenefit, { params, body: { expectedVersion: v, note } })).status)}
        />
      );
    case 'reject_realization':
      return (
        <FinCommandDialog
          {...common}
          danger
          title={t('finance.benefits.rejectRealization.title', { code: b.code })}
          confirmLabel={t('finance.benefits.commands.reject_realization')}
          noteMode="required"
          noteLabel={t('finance.common.reason')}
          consequences={[t('finance.benefits.rejectRealization.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => done((await api(financeRoutes.rejectBenefitRealization, { params, body: { expectedVersion: v, note } })).status)}
        />
      );
    case 'revise_definition':
      return (
        <FinCommandDialog
          {...common}
          title={t('finance.benefits.reviseDefinition.title', { code: b.code })}
          confirmLabel={t('finance.benefits.commands.revise_definition')}
          noteMode="required"
          noteLabel={t('finance.common.reason')}
          consequences={[t('finance.benefits.reviseDefinition.effect'), t('finance.benefits.reviseDefinition.reaccept'), t('common.command.audited')]}
          onConfirm={async ({ note }) => done((await api(financeRoutes.reviseBenefitDefinition, { params, body: { expectedVersion: v, note } })).status)}
        />
      );
    case 'cancel':
      return (
        <FinCommandDialog
          {...common}
          danger
          title={t('finance.benefits.cancel.title', { code: b.code })}
          confirmLabel={t('finance.benefits.commands.cancel')}
          noteMode="required"
          noteLabel={t('finance.common.reason')}
          consequences={[t('finance.benefits.cancel.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => done((await api(financeRoutes.cancelBenefit, { params, body: { expectedVersion: v, note } })).status)}
        />
      );
    default:
      return null;
  }
}

const KPI_KEY = /^[a-z0-9._-]{1,64}$/;

/** KPI definition (spec §11): definition, formula, unit, period, owner, source, target, thresholds, direction, frequency. */
export function CreateKpiDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const writable = useWritableClassifications();
  const benefits = useBenefits({ page: 1, pageSize: 100 });
  const proposed = FINANCE_DEFAULT_CLASSIFICATION.kpi as Classification;
  const blank = () => ({
    key: '',
    name: '',
    nameAr: '',
    definition: '',
    formula: '',
    unit: '',
    period: '',
    owner: null as PickedUser | null,
    benefitId: '',
    source: '',
    target: '',
    green: '',
    amber: '',
    red: '',
    direction: 'higher_is_better' as (typeof KPI_DIRECTIONS)[number],
    frequency: '',
    classification: defaultClassification(proposed, writable),
  });
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const req = [f.name, f.definition, f.formula, f.unit, f.period, f.source, f.green, f.amber, f.red, f.frequency];
  const valid = KPI_KEY.test(f.key.trim()) && req.every((x) => x.trim());
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <FinFormDialog
      open={open}
      onClose={onClose}
      size="lg"
      testId="kpi-form"
      title={t('finance.kpis.create.title')}
      submitLabel={t('finance.kpis.create.confirm')}
      disabled={!valid}
      onSubmit={async () => {
        const r = await api(financeRoutes.createKpi, {
          params: { projectId },
          body: {
            key: f.key.trim(),
            name: f.name.trim(),
            nameAr: f.nameAr.trim() || null,
            definition: f.definition.trim(),
            formula: f.formula.trim(),
            unit: f.unit.trim(),
            period: f.period.trim(),
            ownerUserId: f.owner?.id ?? null,
            benefitId: f.benefitId || null,
            source: f.source.trim(),
            target: f.target.trim() || null,
            thresholds: { green: f.green.trim(), amber: f.amber.trim(), red: f.red.trim() },
            direction: f.direction,
            frequency: f.frequency.trim(),
            classification: f.classification,
          },
        });
        await refresh();
        toast.show('success', t('finance.kpis.create.done'));
        onClose();
        onCreated(r.id);
      }}
    >
      <p className={hint}>{t('finance.kpis.create.hint')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={t('finance.kpis.key')} required dir="ltr" maxLength={64} value={f.key} onChange={set('key')} hint={t('finance.kpis.keyHint')} />
        <TextField label={t('finance.kpis.name')} required maxLength={300} value={f.name} onChange={set('name')} />
        <TextField label={t('finance.kpis.nameAr')} dir="rtl" maxLength={300} value={f.nameAr} onChange={set('nameAr')} />
      </div>
      <TextAreaField label={t('finance.kpis.definition')} required rows={2} maxLength={4000} value={f.definition} onChange={set('definition')} />
      <TextAreaField label={t('finance.kpis.formula')} required rows={2} maxLength={2000} value={f.formula} onChange={set('formula')} />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={t('finance.kpis.unit')} required maxLength={32} value={f.unit} onChange={set('unit')} />
        <TextField label={t('finance.kpis.period')} required maxLength={32} value={f.period} onChange={set('period')} />
        <TextField label={t('finance.kpis.frequency')} required maxLength={32} value={f.frequency} onChange={set('frequency')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('finance.kpis.direction')} required value={f.direction} onChange={set('direction')}>
          {KPI_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {tStatus('kpiDirections', d)}
            </option>
          ))}
        </SelectField>
        <TextField label={t('finance.kpis.target')} maxLength={200} value={f.target} onChange={set('target')} />
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-medium text-ink">{t('finance.kpis.thresholds')}</legend>
        <TextField label={t('finance.kpis.green')} required maxLength={100} value={f.green} onChange={set('green')} />
        <TextField label={t('finance.kpis.amber')} required maxLength={100} value={f.amber} onChange={set('amber')} />
        <TextField label={t('finance.kpis.red')} required maxLength={100} value={f.red} onChange={set('red')} />
      </fieldset>
      <TextAreaField label={t('finance.kpis.source')} required rows={2} maxLength={2000} value={f.source} onChange={set('source')} />
      <UserPicker label={t('finance.kpis.owner')} value={f.owner} onChange={(owner) => setF({ ...f, owner })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('finance.kpis.benefit')} value={f.benefitId} onChange={set('benefitId')}>
          <option value="">{t('finance.kpis.noBenefit')}</option>
          {(benefits.data?.items ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} — {b.title}
            </option>
          ))}
        </SelectField>
        <ClassificationSelect value={f.classification} proposed={proposed} onChange={(classification) => setF({ ...f, classification })} />
      </div>
    </FinFormDialog>
  );
}

/** Append-only KPI observation with its source (a correction is a new observation). */
export function RecordObservationDialog({ kpi, open, onClose }: { kpi: KpiDetail; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const blank = () => ({ period: '', mode: 'value' as 'value' | 'ratio', value: '', numerator: '', denominator: '', dataQuality: 'ok' as (typeof DATA_QUALITY_VALUES)[number], sourceRef: '' });
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(blank());
  }, [open]);
  const numbersOk = f.mode === 'value' ? decimalValid(f.value) : decimalValid(f.numerator) && decimalValid(f.denominator) && Number(f.denominator) !== 0;
  const valid = periodValid(f.period) && numbersOk && f.sourceRef.trim().length > 0;
  return (
    <FinCommandDialog
      open={open}
      onClose={onClose}
      title={t('finance.kpis.observe.title', { key: kpi.key })}
      confirmLabel={t('finance.kpis.observe.confirm')}
      confirmDisabled={!valid}
      consequences={[t('finance.kpis.observe.effect'), t('finance.kpis.observe.appendOnly'), t('common.command.audited')]}
      onConfirm={async ({ note }) => {
        await api(financeRoutes.recordKpiObservation, {
          params: { projectId, kpiId: kpi.id },
          body: {
            period: f.period.trim(),
            ...(f.mode === 'value' ? { value: f.value.trim() } : { numerator: f.numerator.trim(), denominator: f.denominator.trim() }),
            dataQuality: f.dataQuality,
            sourceRef: f.sourceRef.trim(),
            ...(note ? { note } : {}),
          },
        });
        await refresh();
        toast.show('success', t('finance.kpis.observe.done'));
        onClose();
      }}
    >
      <TextField
        label={t('finance.snapshots.period')}
        required
        dir="ltr"
        maxLength={16}
        value={f.period}
        onChange={(e) => setF({ ...f, period: e.target.value })}
        hint={<PeriodHint />}
        error={f.period.trim() && !periodValid(f.period) ? t('finance.snapshots.periodInvalid') : null}
      />
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">{t('finance.kpis.observe.mode')}</legend>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="obs-mode" checked={f.mode === 'value'} onChange={() => setF({ ...f, mode: 'value' })} />
          {t('finance.kpis.observe.byValue')}
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="obs-mode" checked={f.mode === 'ratio'} onChange={() => setF({ ...f, mode: 'ratio' })} />
          {t('finance.kpis.observe.byRatio')}
        </label>
      </fieldset>
      {f.mode === 'value' ? (
        <TextField label={t('finance.kpis.observe.value', { unit: kpi.unit })} required dir="ltr" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t('finance.kpis.observe.numerator')} required dir="ltr" inputMode="decimal" value={f.numerator} onChange={(e) => setF({ ...f, numerator: e.target.value })} />
          <TextField label={t('finance.kpis.observe.denominator')} required dir="ltr" inputMode="decimal" value={f.denominator} onChange={(e) => setF({ ...f, denominator: e.target.value })} />
        </div>
      )}
      <SelectField label={t('finance.kpis.observe.dataQuality')} required value={f.dataQuality} onChange={(e) => setF({ ...f, dataQuality: e.target.value as (typeof DATA_QUALITY_VALUES)[number] })}>
        {DATA_QUALITY_VALUES.map((q) => (
          <option key={q} value={q}>
            {t(`finance.kpis.quality.${q}`)}
          </option>
        ))}
      </SelectField>
      <TextAreaField label={t('finance.kpis.observe.source')} required rows={2} maxLength={2000} value={f.sourceRef} onChange={(e) => setF({ ...f, sourceRef: e.target.value })} />
    </FinCommandDialog>
  );
}
