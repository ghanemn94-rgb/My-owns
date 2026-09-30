'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { financeRoutes } from '@hub/contracts';
import { FINANCE_DEFAULT_CLASSIFICATION, MODEL_CASES, MODEL_KINDS, VALUE_BASES, type Classification } from '@hub/domain';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { btn, hint } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { OUTPUT_MEASURE_VALUES, defaultClassification, useFinanceRefresh, useModelVersion, useWritableClassifications, type FinancialModelDetail, type ModelOutput } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { ClassificationSelect, DocumentSelect, FinFormDialog, currencyValid, decimalValid, useUnitLabel } from './fin';
import { cellValid } from './snapshot-forms';

type ModelKind = (typeof MODEL_KINDS)[number];
type ModelCase = (typeof MODEL_CASES)[number];
type Basis = (typeof VALUE_BASES)[number];
type Measure = (typeof OUTPUT_MEASURE_VALUES)[number];

const proposedFor = (kind: ModelKind): Classification => (kind === 'valuation' ? FINANCE_DEFAULT_CLASSIFICATION.valuation : FINANCE_DEFAULT_CLASSIFICATION.business_plan) as Classification;

export function CreateModelDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const writable = useWritableClassifications();
  const blank = () => ({ kind: 'business_plan' as ModelKind, name: '', description: '', classification: defaultClassification(proposedFor('business_plan'), writable) });
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <FinFormDialog
      open={open}
      onClose={onClose}
      testId="model-form"
      title={t('finance.models.create.title')}
      submitLabel={t('finance.models.create.confirm')}
      disabled={!f.name.trim()}
      onSubmit={async () => {
        const r = await api(financeRoutes.createModel, { params: { projectId }, body: { kind: f.kind, name: f.name.trim(), ...(f.description.trim() ? { description: f.description.trim() } : {}), classification: f.classification } });
        await refresh();
        toast.show('success', t('finance.models.create.done', { code: r.code }));
        onClose();
        onCreated(r.id);
      }}
    >
      <p className={hint}>{t('finance.models.create.hint')}</p>
      <SelectField
        label={t('finance.models.kind')}
        required
        value={f.kind}
        onChange={(e) => {
          const kind = e.target.value as ModelKind;
          setF({ ...f, kind, classification: defaultClassification(proposedFor(kind), writable) });
        }}
      >
        {MODEL_KINDS.map((k) => (
          <option key={k} value={k}>
            {tStatus('modelKinds', k)}
          </option>
        ))}
      </SelectField>
      <TextField label={t('finance.models.name')} required maxLength={300} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <TextAreaField label={t('finance.models.description')} rows={3} maxLength={4000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <ClassificationSelect value={f.classification} proposed={proposedFor(f.kind)} onChange={(classification) => setF({ ...f, classification })} />
    </FinFormDialog>
  );
}

export function EditModelDialog({ model, open, onClose }: { model: FinancialModelDetail; open: boolean; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const writable = useWritableClassifications();
  const init = () => ({ name: model.name, description: model.description ?? '', classification: model.classification as Classification });
  const [f, setF] = useState(init);
  useEffect(() => {
    if (open) setF(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, model.version]);
  const raiseOnly = writable.filter((c) => writable.indexOf(c) >= writable.indexOf(model.classification as Classification));
  return (
    <FinFormDialog
      open={open}
      onClose={onClose}
      testId="model-edit-form"
      title={t('finance.models.edit.title', { code: model.code })}
      submitLabel={t('common.actions.save')}
      disabled={!f.name.trim()}
      onReload={() => void refresh()}
      onSubmit={async () => {
        const r = await api(financeRoutes.updateModel, { params: { projectId, modelId: model.id }, body: { expectedVersion: model.version, name: f.name.trim(), description: f.description.trim() || null, classification: f.classification } });
        await refresh();
        toast.show('success', r.version === model.version ? t('finance.common.noChanges') : t('finance.common.saved'));
        onClose();
      }}
    >
      <p className={hint}>{t('finance.models.edit.hint')}</p>
      <TextField label={t('finance.models.name')} required maxLength={300} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <TextAreaField label={t('finance.models.description')} rows={3} maxLength={4000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <SelectField label={t('finance.common.classification')} required value={f.classification} onChange={(e) => setF({ ...f, classification: e.target.value as Classification })} hint={t('finance.common.raiseOnly')}>
        {raiseOnly.map((c) => (
          <option key={c} value={c}>
            {tStatus('classifications', c)}
          </option>
        ))}
      </SelectField>
    </FinFormDialog>
  );
}

interface OutputRow {
  key: string;
  label: string;
  measure: Measure;
  amount: string;
  currency: string;
  unitScale: string;
  basis: Basis;
  sheet: string;
  cell: string;
}
interface AssumptionRow {
  key: string;
  value: string;
  unit: string;
  source: string;
}
const blankOutput = (): OutputRow => ({ key: '', label: '', measure: 'money', amount: '', currency: '', unitScale: '1', basis: 'other', sheet: '', cell: '' });
const outputRowOf = (o: ModelOutput): OutputRow => ({
  key: o.key,
  label: o.label,
  measure: o.measure,
  amount: o.amount.replace(/\.?0+$/, '') || '0',
  currency: o.currency ?? '',
  unitScale: o.unitScale ? String(o.unitScale) : '1',
  basis: o.basis,
  sheet: o.sheet ?? '',
  cell: o.cell ?? '',
});
const OUTPUT_KEY = /^[A-Za-z0-9._:-]{1,64}$/;

function outputValid(o: OutputRow, imported: boolean): boolean {
  if (!OUTPUT_KEY.test(o.key.trim()) || !o.label.trim() || !decimalValid(o.amount)) return false;
  if (o.measure === 'money' && !currencyValid(o.currency)) return false;
  if (o.measure === 'percent' && (Number(o.amount) < 0 || Number(o.amount) > 100 || o.basis !== 'other')) return false;
  if (imported && (!o.sheet.trim() || !cellValid(o.cell))) return false;
  if (o.cell.trim() && !cellValid(o.cell)) return false;
  return true;
}

/**
 * A new version of one case (REQ-FIN-005): it starts from the prior version's assumptions plus explicit changes; the prior
 * version stays frozen. Imported versions keep the source document and every output's sheet + cell (REQ-FIN-008). The
 * platform never guesses whether a value is enterprise or equity value: every output states its basis.
 */
export function NewVersionDialog({ model, imported, open, onClose, onCreated }: { model: FinancialModelDetail; imported: boolean; open: boolean; onClose: () => void; onCreated: (versionId: string) => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const unit = useUnitLabel();
  const [modelCase, setModelCase] = useState<ModelCase>('base');
  const latest = model.latest.find((l) => l.modelCase === modelCase) ?? null;
  const prior = useModelVersion(model.id, latest?.versionId ?? '');
  const priorData = latest ? prior.data : undefined;
  const [versionLabel, setVersionLabel] = useState('');
  const [headlineBasis, setHeadlineBasis] = useState<Basis | ''>('');
  const [changeNote, setChangeNote] = useState('');
  const [sourceRef, setSourceRef] = useState('');
  const [doc, setDoc] = useState({ documentId: '', versionId: '' });
  const [outputs, setOutputs] = useState<OutputRow[]>([blankOutput()]);
  const [sets, setSets] = useState<AssumptionRow[]>([]);
  const [removes, setRemoves] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    setModelCase('base');
    setVersionLabel('');
    setHeadlineBasis('');
    setChangeNote('');
    setSourceRef('');
    setDoc({ documentId: '', versionId: '' });
    setSets([]);
    setRemoves([]);
  }, [open]);
  // Outputs start from the prior version of the chosen case (edited by the user), or one empty row.
  useEffect(() => {
    if (!open) return;
    setOutputs(priorData?.outputs.length ? priorData.outputs.map(outputRowOf) : [blankOutput()]);
    setRemoves([]);
    if (priorData?.headlineBasis) setHeadlineBasis(priorData.headlineBasis);
  }, [open, priorData]);
  const priorKeys = useMemo(() => new Set((priorData?.assumptions ?? []).map((a) => a.key)), [priorData]);
  const setOut = (i: number, patch: Partial<OutputRow>) => setOutputs((os) => os.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const setAs = (i: number, patch: Partial<AssumptionRow>) => setSets((as) => as.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const keys = outputs.map((o) => o.key.trim());
  const valid =
    versionLabel.trim().length > 0 &&
    outputs.every((o) => outputValid(o, imported)) &&
    new Set(keys).size === keys.length &&
    (model.kind !== 'valuation' || !!headlineBasis) &&
    (imported ? !!doc.documentId : !!doc.documentId || sourceRef.trim().length > 0) &&
    sets.every((a) => a.key.trim() && a.value.trim()) &&
    new Set(sets.map((a) => a.key.trim())).size === sets.length &&
    !sets.some((a) => removes.includes(a.key.trim())) &&
    (latest === null || !!priorData);
  return (
    <FinFormDialog
      open={open}
      onClose={onClose}
      size="lg"
      testId="version-form"
      title={imported ? t('finance.versions.import.title', { code: model.code }) : t('finance.versions.create.title', { code: model.code })}
      submitLabel={imported ? t('finance.versions.import.confirm') : t('finance.versions.create.confirm')}
      disabled={!valid}
      onReload={() => void refresh()}
      onSubmit={async () => {
        const body = {
          modelCase,
          versionLabel: versionLabel.trim(),
          ...(latest ? { basedOnVersionId: latest.versionId } : {}),
          ...(sets.length || removes.length
            ? {
                assumptionChanges: {
                  ...(sets.length ? { set: sets.map((a) => ({ key: a.key.trim(), value: a.value.trim(), unit: a.unit.trim() || null, source: a.source.trim() || null })) } : {}),
                  ...(removes.length ? { remove: removes } : {}),
                },
              }
            : {}),
          outputs: outputs.map((o) => ({
            key: o.key.trim(),
            label: o.label.trim(),
            measure: o.measure,
            amount: o.amount.trim(),
            currency: o.measure === 'money' ? o.currency.trim().toUpperCase() : null,
            unitScale: o.measure === 'money' ? (Number(o.unitScale) as 1 | 1000 | 1000000) : null,
            basis: o.basis,
            sheet: o.sheet.trim() || null,
            cell: o.cell.trim() || null,
          })),
          ...(headlineBasis ? { headlineBasis } : {}),
          ...(changeNote.trim() ? { changeNote: changeNote.trim() } : {}),
          ...(sourceRef.trim() ? { sourceRef: sourceRef.trim() } : {}),
        };
        const r = imported
          ? await api(financeRoutes.importModelVersion, { params: { projectId, modelId: model.id }, body: { ...body, sourceDocumentId: doc.documentId, ...(doc.versionId ? { sourceDocumentVersionId: doc.versionId } : {}) } })
          : await api(financeRoutes.createModelVersion, { params: { projectId, modelId: model.id }, body: { ...body, ...(doc.documentId ? { sourceDocumentId: doc.documentId, ...(doc.versionId ? { sourceDocumentVersionId: doc.versionId } : {}) } : {}) } });
        await refresh();
        toast.show('success', t('finance.versions.create.done', { version: r.versionNo, added: r.diff.added.length, changed: r.diff.changed.length, removed: r.diff.removed.length }));
        onClose();
        onCreated(r.id);
      }}
    >
      <p className={hint}>{imported ? t('finance.versions.import.hint') : t('finance.versions.create.hint')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label={t('finance.versions.case')} required value={modelCase} onChange={(e) => setModelCase(e.target.value as ModelCase)} data-testid="version-case">
          {MODEL_CASES.map((c) => (
            <option key={c} value={c}>
              {tStatus('modelCases', c)}
            </option>
          ))}
        </SelectField>
        <TextField label={t('finance.versions.label')} required maxLength={32} value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} data-testid="version-label" />
        <SelectField label={t('finance.versions.headlineBasis')} required={model.kind === 'valuation'} value={headlineBasis} onChange={(e) => setHeadlineBasis(e.target.value as Basis | '')} data-testid="version-headline-basis">
          <option value="">{t('finance.common.select')}</option>
          {VALUE_BASES.map((b) => (
            <option key={b} value={b}>
              {tStatus('valueBases', b)}
            </option>
          ))}
        </SelectField>
      </div>
      <p className={hint}>{latest ? t('finance.versions.basedOn', { version: latest.versionNo, label: latest.versionLabel }) : t('finance.versions.firstOfCase')}</p>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">{t('finance.versions.assumptions')}</legend>
        {priorData && priorData.assumptions.length ? (
          <ul className="space-y-1 text-sm">
            {priorData.assumptions.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" className="size-4" checked={removes.includes(a.key)} onChange={(e) => setRemoves((rs) => (e.target.checked ? [...rs, a.key] : rs.filter((k) => k !== a.key)))} />
                  <span>{t('finance.versions.removeAssumption', { key: a.key })}</span>
                </label>
                <span className="text-muted" dir="auto">
                  {a.value} {a.unit ?? ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('finance.versions.noPriorAssumptions')}</p>
        )}
        {sets.map((a, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-4">
            <TextField label={t('finance.versions.assumptionKey')} required dir="ltr" maxLength={64} value={a.key} onChange={(e) => setAs(i, { key: e.target.value })} hint={priorKeys.has(a.key.trim()) ? t('finance.versions.changesExisting') : undefined} />
            <TextField label={t('finance.versions.assumptionValue')} required maxLength={500} value={a.value} onChange={(e) => setAs(i, { value: e.target.value })} />
            <TextField label={t('finance.versions.assumptionUnit')} maxLength={32} value={a.unit} onChange={(e) => setAs(i, { unit: e.target.value })} />
            <TextField label={t('finance.versions.assumptionSource')} maxLength={500} value={a.source} onChange={(e) => setAs(i, { source: e.target.value })} />
            <div className="sm:col-span-4">
              <button type="button" className={btn.ghost} onClick={() => setSets((as) => as.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden="true" className="size-4" />
                {t('finance.versions.dropChange')}
              </button>
            </div>
          </div>
        ))}
        <button type="button" className={btn.secondary} onClick={() => setSets((as) => [...as, { key: '', value: '', unit: '', source: '' }])}>
          <Plus aria-hidden="true" className="size-4" />
          {t('finance.versions.addAssumption')}
        </button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">{t('finance.versions.outputs')}</legend>
        <p className={hint}>{t('finance.versions.outputsHint')}</p>
        {outputs.map((o, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-3" data-testid="output-row">
            <TextField label={t('finance.versions.outputKey')} required dir="ltr" maxLength={64} value={o.key} onChange={(e) => setOut(i, { key: e.target.value })} />
            <TextField className="sm:col-span-2" label={t('finance.versions.outputLabel')} required maxLength={300} value={o.label} onChange={(e) => setOut(i, { label: e.target.value })} />
            <SelectField label={t('finance.versions.measure')} required value={o.measure} onChange={(e) => setOut(i, { measure: e.target.value as Measure, ...(e.target.value === 'percent' ? { basis: 'other' as Basis } : {}) })}>
              {OUTPUT_MEASURE_VALUES.map((m) => (
                <option key={m} value={m}>
                  {t(`finance.measures.${m}`)}
                </option>
              ))}
            </SelectField>
            <TextField label={t('finance.money.amount')} required dir="ltr" inputMode="decimal" value={o.amount} onChange={(e) => setOut(i, { amount: e.target.value })} hint={o.measure === 'percent' ? t('finance.versions.percentHint') : undefined} />
            <SelectField label={t('finance.versions.basis')} required value={o.basis} disabled={o.measure === 'percent'} onChange={(e) => setOut(i, { basis: e.target.value as Basis })} data-testid="output-basis">
              {VALUE_BASES.map((b) => (
                <option key={b} value={b}>
                  {tStatus('valueBases', b)}
                </option>
              ))}
            </SelectField>
            {o.measure === 'money' ? (
              <>
                <TextField label={t('finance.money.currency')} required dir="ltr" maxLength={3} value={o.currency} onChange={(e) => setOut(i, { currency: e.target.value.toUpperCase() })} />
                <SelectField label={t('finance.money.unitScale')} required value={o.unitScale} onChange={(e) => setOut(i, { unitScale: e.target.value })}>
                  {([1, 1000, 1_000_000] as const).map((n) => (
                    <option key={n} value={String(n)}>
                      {unit(n)}
                    </option>
                  ))}
                </SelectField>
              </>
            ) : (
              <p className="self-end pb-2 text-sm text-muted sm:col-span-2">{t('finance.versions.percentNoCurrency')}</p>
            )}
            <TextField label={t('finance.common.sheet')} required={imported} dir="ltr" maxLength={128} value={o.sheet} onChange={(e) => setOut(i, { sheet: e.target.value })} />
            <TextField
              label={t('finance.common.cell')}
              required={imported}
              dir="ltr"
              maxLength={64}
              value={o.cell}
              onChange={(e) => setOut(i, { cell: e.target.value })}
              error={o.cell.trim() && !cellValid(o.cell) ? t('finance.common.cellInvalid') : null}
            />
            {outputs.length > 1 ? (
              <div className="self-end">
                <button type="button" className={btn.ghost} onClick={() => setOutputs((os) => os.filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden="true" className="size-4" />
                  {t('finance.versions.removeOutput')}
                </button>
              </div>
            ) : null}
          </div>
        ))}
        <button type="button" className={btn.secondary} onClick={() => setOutputs((os) => [...os, blankOutput()])} disabled={outputs.length >= 200}>
          <Plus aria-hidden="true" className="size-4" />
          {t('finance.versions.addOutput')}
        </button>
      </fieldset>

      {imported ? <DocumentSelect required value={doc} onChange={setDoc} /> : null}
      <TextAreaField label={t('finance.versions.sourceRef')} rows={2} maxLength={2000} value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} hint={imported ? undefined : t('finance.versions.sourceHint')} />
      {!imported ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-primary">{t('finance.snapshots.sourceDocumentOptional')}</summary>
          <div className="mt-2">
            <DocumentSelect value={doc} onChange={setDoc} />
          </div>
        </details>
      ) : null}
      <TextAreaField label={t('finance.versions.changeNote')} rows={2} maxLength={4000} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
      {latest && !priorData ? <p className="text-sm text-muted">{t('states.loading')}</p> : null}
      <p className="text-xs text-muted">{t('finance.versions.classificationInherited', { classification: tStatus('classifications', model.classification) })}</p>
    </FinFormDialog>
  );
}
