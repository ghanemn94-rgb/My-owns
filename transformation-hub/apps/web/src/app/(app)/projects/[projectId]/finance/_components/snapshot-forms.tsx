'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { financeRoutes } from '@hub/contracts';
import { FINANCE_DEFAULT_CLASSIFICATION, FINANCIAL_CATEGORIES, FINANCIAL_KINDS, type Classification, type FinancialCategory } from '@hub/domain';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { btn, hint } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { defaultClassification, useFinanceRefresh, useWritableClassifications, type SnapshotDetail } from '@/lib/finance';
import { useProjectContext } from '@/lib/project-context';
import { ClassificationSelect, DocumentSelect, FinFormDialog, MoneyFields, TsaSelect, WorkstreamSelect, emptyMoney, moneyFormOf, moneyOf, moneyValid, type MoneyForm, PeriodHint } from './fin';

type Kind = (typeof FINANCIAL_KINDS)[number];
const LINE_REF = /^[A-Za-z0-9._:/-]{1,64}$/;
const PERIOD_HINT_RE = /^(\d{4}|\d{4}-H[12]|\d{4}-Q[1-4]|\d{4}-(0[1-9]|1[0-2])|FY\d{4})$/;
const CELL = /^(\$?[A-Z]{1,3}\$?\d{1,7}(:\$?[A-Z]{1,3}\$?\d{1,7})?|[A-Za-z_][A-Za-z0-9_.]{0,63})$/;

export const lineRefValid = (s: string) => LINE_REF.test(s.trim());
export const periodValid = (s: string) => PERIOD_HINT_RE.test(s.trim());
export const cellValid = (s: string) => CELL.test(s.trim());

function PeriodField({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId?: string }) {
  const { t } = useI18n();
  return (
    <TextField
      label={t('finance.snapshots.period')}
      required
      dir="ltr"
      maxLength={16}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      hint={<PeriodHint />}
      error={value.trim() && !periodValid(value) ? t('finance.snapshots.periodInvalid') : null}
      data-testid={testId}
    />
  );
}

/** Manual entry of a figure: currency, unit, period and source are mandatory; it starts "proposed" (REQ-FIN-001). */
export function CreateSnapshotDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const writable = useWritableClassifications();
  const proposed = FINANCE_DEFAULT_CLASSIFICATION.financial_snapshot as Classification;
  const blank = () => ({
    kind: 'actual' as Kind,
    category: 'one_off_separation' as FinancialCategory,
    lineRef: '',
    label: '',
    period: '',
    money: emptyMoney(),
    sourceRef: '',
    doc: { documentId: '', versionId: '' },
    tsaServiceId: '',
    workstreamId: '',
    classification: defaultClassification(proposed, writable),
  });
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const valid =
    lineRefValid(f.lineRef) &&
    f.label.trim().length > 0 &&
    periodValid(f.period) &&
    moneyValid(f.money, true) &&
    (f.sourceRef.trim().length > 0 || !!f.doc.documentId) &&
    (f.category !== 'tsa_charge' || !!f.tsaServiceId);
  return (
    <FinFormDialog
      open={open}
      onClose={onClose}
      size="lg"
      testId="snapshot-form"
      title={t('finance.snapshots.create.title')}
      submitLabel={t('finance.snapshots.create.confirm')}
      disabled={!valid}
      onSubmit={async () => {
        const r = await api(financeRoutes.createSnapshot, {
          params: { projectId },
          body: {
            kind: f.kind,
            category: f.category,
            lineRef: f.lineRef.trim(),
            label: f.label.trim(),
            period: f.period.trim(),
            amount: moneyOf(f.money)!,
            ...(f.sourceRef.trim() ? { sourceRef: f.sourceRef.trim() } : {}),
            ...(f.doc.documentId ? { sourceDocumentId: f.doc.documentId, ...(f.doc.versionId ? { sourceDocumentVersionId: f.doc.versionId } : {}) } : {}),
            ...(f.category === 'tsa_charge' && f.tsaServiceId ? { tsaServiceId: f.tsaServiceId } : {}),
            ...(f.workstreamId ? { workstreamId: f.workstreamId } : {}),
            classification: f.classification,
          },
        });
        await refresh();
        toast.show('success', t('finance.snapshots.create.done'));
        onClose();
        onCreated?.(r.id);
      }}
    >
      <p className={hint}>{t('finance.snapshots.create.hint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('finance.snapshots.kind')} required value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Kind })} data-testid="snapshot-kind">
          {FINANCIAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {tStatus('financialKinds', k)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('finance.snapshots.category')} required value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as FinancialCategory })} data-testid="snapshot-category">
          {FINANCIAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {tStatus('financialCategories', c)}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t('finance.snapshots.lineRef')}
          required
          dir="ltr"
          maxLength={64}
          value={f.lineRef}
          onChange={(e) => setF({ ...f, lineRef: e.target.value })}
          hint={t('finance.snapshots.lineRefHint')}
          error={f.lineRef.trim() && !lineRefValid(f.lineRef) ? t('finance.snapshots.lineRefInvalid') : null}
          data-testid="snapshot-lineref"
        />
        <PeriodField value={f.period} onChange={(period) => setF({ ...f, period })} testId="snapshot-period" />
      </div>
      <TextField label={t('finance.snapshots.label')} required maxLength={300} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} data-testid="snapshot-label" />
      <MoneyFields legend={t('finance.snapshots.amount')} required value={f.money} onChange={(money) => setF({ ...f, money })} testId="snapshot-money" hint={t('finance.money.hint')} />
      <TextAreaField label={t('finance.snapshots.sourceRef')} required={!f.doc.documentId} rows={2} maxLength={2000} value={f.sourceRef} onChange={(e) => setF({ ...f, sourceRef: e.target.value })} hint={t('finance.snapshots.sourceHint')} data-testid="snapshot-source" />
      <details>
        <summary className="cursor-pointer text-sm font-medium text-primary">{t('finance.snapshots.sourceDocumentOptional')}</summary>
        <div className="mt-2">
          <DocumentSelect value={f.doc} onChange={(doc) => setF({ ...f, doc })} />
        </div>
      </details>
      {f.category === 'tsa_charge' ? (
        <div>
          <TsaSelect required value={f.tsaServiceId} onChange={(tsaServiceId) => setF({ ...f, tsaServiceId })} />
          <p className={hint}>{t('finance.snapshots.tsaHint')}</p>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <WorkstreamSelect value={f.workstreamId} onChange={(workstreamId) => setF({ ...f, workstreamId })} />
        <ClassificationSelect value={f.classification} proposed={proposed} onChange={(classification) => setF({ ...f, classification })} />
      </div>
    </FinFormDialog>
  );
}

interface ImportRow {
  kind: Kind;
  category: FinancialCategory;
  lineRef: string;
  label: string;
  period: string;
  money: MoneyForm;
  sheet: string;
  cell: string;
}
const blankRow = (): ImportRow => ({ kind: 'forecast', category: 'one_off_separation', lineRef: '', label: '', period: '', money: emptyMoney(), sheet: '', cell: '' });

/**
 * REQ-FIN-008: outputs of an original model imported as figures; each keeps the source document (version), sheet and
 * cell. All-or-nothing on the server; an existing figure is never overwritten.
 */
export function ImportSnapshotsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const writable = useWritableClassifications();
  const proposed = FINANCE_DEFAULT_CLASSIFICATION.financial_snapshot as Classification;
  const [doc, setDoc] = useState({ documentId: '', versionId: '' });
  const [sourceType, setSourceType] = useState<'excel' | 'csv'>('excel');
  const [sourceRef, setSourceRef] = useState('');
  const [classification, setClassification] = useState<Classification>(defaultClassification(proposed, writable));
  const [rows, setRows] = useState<ImportRow[]>([blankRow()]);
  useEffect(() => {
    if (!open) return;
    setDoc({ documentId: '', versionId: '' });
    setSourceType('excel');
    setSourceRef('');
    setClassification(defaultClassification(proposed, writable));
    setRows([blankRow()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const setRow = (i: number, patch: Partial<ImportRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const rowValid = (r: ImportRow) => lineRefValid(r.lineRef) && r.label.trim() && periodValid(r.period) && moneyValid(r.money, true) && cellValid(r.cell) && (sourceType === 'csv' || r.sheet.trim());
  const valid = !!doc.documentId && rows.length > 0 && rows.every(rowValid);
  return (
    <FinFormDialog
      open={open}
      onClose={onClose}
      size="lg"
      testId="import-form"
      title={t('finance.snapshots.import.title')}
      submitLabel={t('finance.snapshots.import.confirm')}
      disabled={!valid}
      onSubmit={async () => {
        const r = await api(financeRoutes.importSnapshots, {
          params: { projectId },
          body: {
            sourceType,
            sourceDocumentId: doc.documentId,
            ...(doc.versionId ? { sourceDocumentVersionId: doc.versionId } : {}),
            ...(sourceRef.trim() ? { sourceRef: sourceRef.trim() } : {}),
            classification,
            rows: rows.map((x) => ({
              kind: x.kind,
              category: x.category,
              lineRef: x.lineRef.trim(),
              label: x.label.trim(),
              period: x.period.trim(),
              amount: moneyOf(x.money)!,
              ...(x.sheet.trim() ? { sheet: x.sheet.trim() } : {}),
              cell: x.cell.trim(),
            })),
          },
        });
        await refresh();
        toast.show('success', t('finance.snapshots.import.done', { count: r.items.length }));
        onClose();
      }}
    >
      <p className={hint}>{t('finance.snapshots.import.hint')}</p>
      <DocumentSelect required value={doc} onChange={setDoc} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('finance.snapshots.import.sourceType')} required value={sourceType} onChange={(e) => setSourceType(e.target.value as 'excel' | 'csv')}>
          <option value="excel">{tStatus('sourceTypes', 'excel')}</option>
          <option value="csv">{tStatus('sourceTypes', 'csv')}</option>
        </SelectField>
        <ClassificationSelect value={classification} proposed={proposed} onChange={setClassification} />
      </div>
      <TextField label={t('finance.snapshots.sourceRef')} maxLength={2000} value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} />
      <div className="space-y-3">
        {rows.map((r, i) => (
          <fieldset key={i} className="space-y-2 rounded-md border border-line p-3" data-testid="import-row">
            <legend className="px-1 text-sm font-semibold text-ink">{t('finance.snapshots.import.row', { n: i + 1 })}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <SelectField label={t('finance.snapshots.kind')} required value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as Kind })} data-testid="import-kind">
                {FINANCIAL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {tStatus('financialKinds', k)}
                  </option>
                ))}
              </SelectField>
              <SelectField label={t('finance.snapshots.category')} required value={r.category} onChange={(e) => setRow(i, { category: e.target.value as FinancialCategory })}>
                {FINANCIAL_CATEGORIES.filter((c) => c !== 'tsa_charge').map((c) => (
                  <option key={c} value={c}>
                    {tStatus('financialCategories', c)}
                  </option>
                ))}
              </SelectField>
              <PeriodField value={r.period} onChange={(period) => setRow(i, { period })} testId="import-period" />
              <TextField label={t('finance.snapshots.lineRef')} required dir="ltr" maxLength={64} value={r.lineRef} onChange={(e) => setRow(i, { lineRef: e.target.value })} data-testid="import-lineref" />
              <TextField className="sm:col-span-2" label={t('finance.snapshots.label')} required maxLength={300} value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} data-testid="import-label" />
            </div>
            <MoneyFields legend={t('finance.snapshots.amount')} required value={r.money} onChange={(money) => setRow(i, { money })} testId="import-money" />
            <div className="grid gap-2 sm:grid-cols-2">
              <TextField label={t('finance.common.sheet')} required={sourceType === 'excel'} dir="ltr" maxLength={128} value={r.sheet} onChange={(e) => setRow(i, { sheet: e.target.value })} data-testid="import-sheet" />
              <TextField
                label={t('finance.common.cell')}
                required
                dir="ltr"
                maxLength={64}
                value={r.cell}
                onChange={(e) => setRow(i, { cell: e.target.value })}
                data-testid="import-cell"
                hint={t('finance.common.cellHint')}
                error={r.cell.trim() && !cellValid(r.cell) ? t('finance.common.cellInvalid') : null}
              />
            </div>
            {rows.length > 1 ? (
              <button type="button" className={btn.ghost} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden="true" className="size-4" />
                {t('finance.snapshots.import.removeRow')}
              </button>
            ) : null}
          </fieldset>
        ))}
        <button type="button" className={btn.secondary} onClick={() => setRows((rs) => [...rs, blankRow()])} disabled={rows.length >= 500}>
          <Plus aria-hidden="true" className="size-4" />
          {t('finance.snapshots.import.addRow')}
        </button>
        <p className={hint}>{t('finance.snapshots.import.tsaNote')}</p>
      </div>
    </FinFormDialog>
  );
}

/** Content edits (never the approval state). A validated figure returns to "proposed"; approved figures are reopened first. */
export function EditSnapshotDialog({ snapshot, open, onClose }: { snapshot: SnapshotDetail; open: boolean; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const writable = useWritableClassifications();
  const imported = snapshot.sourceType !== 'manual_entry';
  const init = () => ({
    label: snapshot.label,
    money: moneyFormOf(snapshot.amount),
    sourceRef: snapshot.sourceRef ?? '',
    workstreamId: snapshot.workstreamId ?? '',
    classification: snapshot.classification as Classification,
  });
  const [f, setF] = useState(init);
  useEffect(() => {
    if (open) setF(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, snapshot.version]);
  const valid = f.label.trim().length > 0 && moneyValid(f.money, true) && (f.sourceRef.trim().length > 0 || !!snapshot.sourceDocumentId);
  const raiseOnly = writable.filter((c) => writable.indexOf(c) >= writable.indexOf(snapshot.classification as Classification));
  return (
    <FinFormDialog
      open={open}
      onClose={onClose}
      testId="snapshot-edit-form"
      title={t('finance.snapshots.edit.title', { line: snapshot.lineRef })}
      submitLabel={t('common.actions.save')}
      disabled={!valid}
      onReload={() => void refresh()}
      onSubmit={async () => {
        const r = await api(financeRoutes.updateSnapshot, {
          params: { projectId, snapshotId: snapshot.id },
          body: {
            expectedVersion: snapshot.version,
            ...(imported ? {} : { label: f.label.trim(), amount: moneyOf(f.money)!, sourceRef: f.sourceRef.trim() || null }),
            workstreamId: f.workstreamId || null,
            classification: f.classification,
          },
        });
        await refresh();
        toast.show('success', r.version === snapshot.version ? t('finance.common.noChanges') : r.approvalState !== snapshot.approvalState ? t('finance.snapshots.edit.invalidated', { state: tStatus('approvalStates', r.approvalState) }) : t('finance.common.saved'));
        onClose();
      }}
    >
      <p className={hint}>{imported ? t('finance.snapshots.edit.importedHint') : t('finance.snapshots.edit.hint')}</p>
      <TextField label={t('finance.snapshots.label')} required disabled={imported} maxLength={300} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
      <MoneyFields legend={t('finance.snapshots.amount')} required lockUnit={imported} value={f.money} onChange={(money) => setF({ ...f, money: imported ? f.money : money })} />
      <TextAreaField label={t('finance.snapshots.sourceRef')} required={!imported && !snapshot.sourceDocumentId} rows={2} disabled={imported} maxLength={2000} value={f.sourceRef} onChange={(e) => setF({ ...f, sourceRef: e.target.value })} />
      <WorkstreamSelect value={f.workstreamId} onChange={(workstreamId) => setF({ ...f, workstreamId })} />
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

/** REQ-FIN-004: reconcile an intercompany / opening balance / working capital figure against the counterparty balance. */
export function SnapshotReconciliationDialog({ snapshot, open, onClose }: { snapshot: SnapshotDetail; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useFinanceRefresh();
  const toast = useToast();
  const unitOf = () => ({ ...emptyMoney(snapshot.amount.currency, String(snapshot.amount.unitScale)) });
  const [f, setF] = useState({ counterpartyLabel: '', their: unitOf(), explanation: '', sourceRef: '' });
  useEffect(() => {
    if (open) setF({ counterpartyLabel: '', their: unitOf(), explanation: '', sourceRef: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const valid = f.counterpartyLabel.trim().length > 0 && f.sourceRef.trim().length > 0 && moneyValid(f.their, false);
  return (
    <FinFormDialog
      open={open}
      onClose={onClose}
      testId="snapshot-recon-form"
      title={t('finance.recon.createForFigure', { line: snapshot.lineRef })}
      submitLabel={t('finance.recon.create.confirm')}
      disabled={!valid}
      onSubmit={async () => {
        const their = moneyOf(f.their);
        const r = await api(financeRoutes.createSnapshotReconciliation, {
          params: { projectId, snapshotId: snapshot.id },
          body: { counterpartyLabel: f.counterpartyLabel.trim(), sourceRef: f.sourceRef.trim(), ...(their ? { theirBalance: their } : {}), ...(f.explanation.trim() ? { explanation: f.explanation.trim() } : {}) },
        });
        await refresh();
        toast.show('success', t('finance.recon.create.done', { code: r.code }));
        onClose();
      }}
    >
      <p className={hint}>{t('finance.recon.figureHint')}</p>
      <TextField label={t('finance.recon.counterparty')} required maxLength={300} value={f.counterpartyLabel} onChange={(e) => setF({ ...f, counterpartyLabel: e.target.value })} />
      <MoneyFields legend={t('finance.recon.theirBalance')} lockUnit value={f.their} onChange={(their) => setF({ ...f, their })} hint={t('finance.recon.sameUnitHint')} />
      <TextAreaField label={t('finance.recon.explanation')} rows={2} maxLength={4000} value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} />
      <TextAreaField label={t('finance.recon.sourceRef')} required rows={2} maxLength={2000} value={f.sourceRef} onChange={(e) => setF({ ...f, sourceRef: e.target.value })} />
    </FinFormDialog>
  );
}
