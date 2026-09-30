'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { CreateProjectBody, portfolioRoutes, type RouteBody, type RouteResponse } from '@hub/contracts';
import { CLASSIFICATIONS, clearanceAllows, type Classification } from '@hub/domain';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Main } from '@/components/Main';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { useToast } from '@/components/Toast';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { canInOrg, qk, useMe } from '@/lib/queries';
import { useLocalized } from '@/lib/i18n-data';

type Template = RouteResponse<typeof portfolioRoutes.listTemplates>['items'][number];
type NewcoStatus = 'incorporated' | 'incorporation_in_progress' | 'unconfirmed';
const NEWCO_STATUSES: NewcoStatus[] = ['unconfirmed', 'incorporation_in_progress', 'incorporated'];
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,30}$/;
const STEPS = ['template', 'details', 'people', 'review'] as const;
type Step = (typeof STEPS)[number];

interface FormState {
  templateVersionId: string;
  code: string;
  name: string;
  description: string;
  objective: string;
  classification: Classification;
  plannedStart: string;
  programId: string;
  pm: PickedUser | null;
  newcoMode: 'none' | 'new';
  newcoName: string;
  newcoStatus: NewcoStatus;
}

const INITIAL: FormState = {
  templateVersionId: '',
  code: '',
  name: '',
  description: '',
  objective: '',
  classification: 'confidential',
  plannedStart: '',
  programId: '',
  pm: null,
  newcoMode: 'none',
  newcoName: '',
  newcoStatus: 'unconfirmed',
};

function Summary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm text-ink sm:col-span-2">{children}</dd>
    </div>
  );
}

export default function NewProjectPage() {
  const { t, tStatus, formatNumber, formatDate } = useI18n();
  const loc = useLocalized();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const allowed = canInOrg(me.data, 'portfolio.project.create');
  const canPrograms = canInOrg(me.data, 'portfolio.portfolio.read');

  const templates = useQuery({
    queryKey: qk.templates,
    queryFn: ({ signal }) => api(portfolioRoutes.listTemplates, { signal }),
    enabled: allowed,
  });
  const programs = useQuery({
    queryKey: qk.programs,
    queryFn: ({ signal }) => api(portfolioRoutes.listPrograms, { signal }),
    enabled: allowed && canPrograms,
  });

  const [step, setStep] = useState<Step>('template');
  const [form, setForm] = useState<FormState>(INITIAL);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  // Only classifications within the creator's clearance are offered (the API refuses higher ones — QA-P1-05); the
  // default is "confidential" when the creator may use it, otherwise the creator's own clearance.
  const myClearance = me.data?.user.clearance as Classification | undefined;
  const allowedClassifications = myClearance ? CLASSIFICATIONS.filter((c) => clearanceAllows(myClearance, c)) : CLASSIFICATIONS;
  useEffect(() => {
    if (myClearance && !clearanceAllows(myClearance, form.classification)) setForm((f) => ({ ...f, classification: myClearance }));
  }, [myClearance, form.classification]);

  if (me.isLoading) return <Main><LoadingState /></Main>;
  if (!allowed) return <Main><RestrictedState /></Main>;

  const template = templates.data?.items.find((x) => x.id === form.templateVersionId);
  // Mirrors the API: a self-declared status is never "confirmed" at setup.
  const newcoVerification = form.newcoStatus === 'unconfirmed' ? 'unknown' : 'proposed';
  const errors: Partial<Record<'template' | 'code' | 'name' | 'pm' | 'newcoName', string>> = {};
  if (!form.templateVersionId) errors.template = t('portfolio.wizard.errors.template');
  if (!CODE_RE.test(form.code.trim())) errors.code = t('portfolio.wizard.errors.code');
  if (!form.name.trim()) errors.name = t('common.validation.required');
  if (!form.pm) errors.pm = t('portfolio.wizard.errors.pm');
  if (form.newcoMode === 'new' && !form.newcoName.trim()) errors.newcoName = t('common.validation.required');

  const stepErrors: Record<Step, (keyof typeof errors)[]> = {
    template: ['template'],
    details: ['code', 'name'],
    people: ['pm', 'newcoName'],
    review: ['template', 'code', 'name', 'pm', 'newcoName'],
  };
  const stepValid = (s: Step) => stepErrors[s].every((k) => !errors[k]);
  const idx = STEPS.indexOf(step);
  const err = (k: keyof typeof errors) => (showErrors ? (errors[k] ?? null) : null);

  const next = () => {
    if (!stepValid(step)) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep(STEPS[idx + 1] ?? 'review');
  };
  const back = () => {
    setShowErrors(false);
    setStep(STEPS[idx - 1] ?? 'template');
  };

  const buildBody = (): RouteBody<typeof portfolioRoutes.createProject> => ({
    templateVersionId: form.templateVersionId,
    code: form.code.trim(),
    name: form.name.trim(),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(form.objective.trim() ? { objective: form.objective.trim() } : {}),
    classification: form.classification,
    ...(form.plannedStart ? { plannedStart: form.plannedStart } : {}),
    ...(form.programId ? { programId: form.programId } : {}),
    projectManagerUserId: form.pm?.id ?? '',
    newco:
      form.newcoMode === 'new'
        ? { mode: 'new', name: form.newcoName.trim(), incorporationStatus: form.newcoStatus }
        : { mode: 'none', incorporationStatus: 'unconfirmed' },
  });

  const submit = async () => {
    if (!stepValid('review')) {
      setShowErrors(true);
      return;
    }
    const body = buildBody();
    // Same schema the API validates with — catches drift before the round trip.
    const parsed = CreateProjectBody.safeParse(body);
    if (!parsed.success) {
      setShowErrors(true);
      setError(new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api(portfolioRoutes.createProject, { body });
      await Promise.all([queryClient.invalidateQueries({ queryKey: qk.me }), queryClient.invalidateQueries({ queryKey: ['projects'] })]);
      toast.show('success', t('portfolio.wizard.created', { code: res.code }));
      router.push(`/projects/${res.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const stepLabel = (s: Step) => t(`portfolio.wizard.steps.${s}`);

  return (
    <Main narrow>
      <PageHeader title={t('portfolio.wizard.title')} description={t('portfolio.wizard.subtitle')} />

      <ol className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t('portfolio.wizard.progress')}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? 'step' : undefined}
            className={cx(
              'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
              s === step ? 'border-primary bg-primary-soft font-semibold text-primary' : i < idx ? 'border-line text-ink' : 'border-line text-muted',
            )}
          >
            <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-current text-xs">
              {i < idx ? <Check aria-hidden="true" className="size-3.5" /> : i + 1}
            </span>
            {stepLabel(s)}
          </li>
        ))}
      </ol>

      <section aria-labelledby="step-title" className={cx(card, 'space-y-5 p-5')}>
        <h2 id="step-title" className="text-lg font-semibold">
          {stepLabel(step)}
        </h2>

        {step === 'template' ? (
          templates.isLoading ? (
            <LoadingState compact />
          ) : templates.error ? (
            <ErrorState error={templates.error} onRetry={() => templates.refetch()} />
          ) : (
            <fieldset>
              <legend className="mb-2 text-sm text-muted">{t('portfolio.wizard.templateHint')}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(templates.data?.items ?? []).map((tpl: Template) => (
                  <label
                    key={tpl.id}
                    className={cx(
                      'flex cursor-pointer gap-3 rounded-md border p-3',
                      form.templateVersionId === tpl.id ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-muted',
                    )}
                  >
                    <input
                      type="radio"
                      name="template"
                      data-testid={`template-${tpl.templateKey}`}
                      className="mt-1 size-4 accent-[var(--hub-primary)]"
                      checked={form.templateVersionId === tpl.id}
                      onChange={() => set('templateVersionId', tpl.id)}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium" dir="auto">
                        {loc(tpl.name, tpl.nameAr)}
                      </span>
                      <span className="block text-xs text-muted">
                        {tStatus('templateKinds', tpl.kind)} · {t('portfolio.templateVersion', { version: tpl.versionNo })}
                      </span>
                      <span className="mt-1 block text-xs text-ink">
                        {t('portfolio.wizard.templateCounts', {
                          gates: formatNumber(tpl.counts.gates),
                          workstreams: formatNumber(tpl.counts.workstreams),
                          activities: formatNumber(tpl.counts.activities),
                          kpis: formatNumber(tpl.counts.kpis),
                        })}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {err('template') ? <p className="mt-2 text-sm font-medium text-danger">{err('template')}</p> : null}
            </fieldset>
          )
        ) : null}

        {step === 'details' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('project.fields.code')}
              required
              dir="ltr"
              value={form.code}
              maxLength={31}
              data-testid="wizard-code"
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              hint={t('portfolio.wizard.codeHint')}
              error={err('code')}
            />
            <TextField
              label={t('project.fields.name')}
              required
              value={form.name}
              maxLength={200}
              onChange={(e) => set('name', e.target.value)}
              error={err('name')}
              data-testid="wizard-name"
            />
            <TextAreaField
              className="sm:col-span-2"
              label={t('project.fields.description')}
              value={form.description}
              maxLength={4000}
              onChange={(e) => set('description', e.target.value)}
            />
            <TextAreaField
              className="sm:col-span-2"
              label={t('project.fields.objective')}
              value={form.objective}
              maxLength={4000}
              onChange={(e) => set('objective', e.target.value)}
            />
            <SelectField
              label={t('project.fields.classification')}
              required
              value={form.classification}
              onChange={(e) => set('classification', e.target.value as Classification)}
              hint={t('portfolio.wizard.classificationHint')}
            >
              {allowedClassifications.map((c) => (
                <option key={c} value={c}>
                  {tStatus('classifications', c)}
                </option>
              ))}
            </SelectField>
            <TextField
              label={t('project.fields.plannedStart')}
              type="date"
              dir="ltr"
              value={form.plannedStart}
              onChange={(e) => set('plannedStart', e.target.value)}
              hint={t('portfolio.wizard.plannedStartHint')}
            />
            {canPrograms ? (
              <SelectField
                className="sm:col-span-2"
                label={t('project.fields.program')}
                value={form.programId}
                onChange={(e) => set('programId', e.target.value)}
                disabled={programs.isLoading}
              >
                <option value="">{t('portfolio.wizard.noProgram')}</option>
                {(programs.data?.items ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                    {p.isDemo ? ` (${t('common.demo.badge')})` : ''}
                  </option>
                ))}
              </SelectField>
            ) : null}
          </div>
        ) : null}

        {step === 'people' ? (
          <div className="space-y-6">
            <div>
              <UserPicker
                label={t('portfolio.wizard.projectManager')}
                value={form.pm}
                onChange={(u) => set('pm', u)}
                required
                invalid={Boolean(err('pm'))}
              />
              {err('pm') ? <p className="mt-1 text-xs font-medium text-danger">{err('pm')}</p> : null}
            </div>
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-ink">{t('portfolio.wizard.newco.title')}</legend>
              <div className="flex flex-wrap gap-4">
                {(['none', 'new'] as const).map((m) => (
                  <label key={m} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="newcoMode"
                      className="size-4 accent-[var(--hub-primary)]"
                      checked={form.newcoMode === m}
                      onChange={() => set('newcoMode', m)}
                    />
                    {t(`portfolio.wizard.newco.mode_${m}`)}
                  </label>
                ))}
              </div>
              {form.newcoMode === 'new' ? (
                <div className="space-y-4 rounded-md border border-line p-3">
                  <TextField
                    label={t('portfolio.wizard.newco.name')}
                    required
                    value={form.newcoName}
                    maxLength={200}
                    onChange={(e) => set('newcoName', e.target.value)}
                    error={err('newcoName')}
                  />
                  <fieldset>
                    <legend className="text-sm font-medium text-ink">{t('portfolio.wizard.newco.status')}</legend>
                    <div className="mt-2 flex flex-col gap-2">
                      {NEWCO_STATUSES.map((s) => (
                        <label key={s} className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name="newcoStatus"
                            className="size-4 accent-[var(--hub-primary)]"
                            checked={form.newcoStatus === s}
                            onChange={() => set('newcoStatus', s)}
                          />
                          {tStatus('incorporationStatuses', s)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <p className="rounded-md bg-warning-soft p-2 text-xs text-warning" role="note">
                    {t('portfolio.wizard.newco.unverifiedNote')}
                  </p>
                </div>
              ) : null}
            </fieldset>
          </div>
        ) : null}

        {step === 'review' ? (
          <div className="space-y-5">
            <dl className="space-y-2">
              <Summary label={t('portfolio.wizard.steps.template')}>
                {template ? `${loc(template.name, template.nameAr)} · ${t('portfolio.templateVersion', { version: template.versionNo })}` : EM_DASH}
              </Summary>
              <Summary label={t('project.fields.code')}>
                <span dir="ltr">{form.code || EM_DASH}</span>
              </Summary>
              <Summary label={t('project.fields.name')}>
                <span dir="auto">{form.name || EM_DASH}</span>
              </Summary>
              <Summary label={t('project.fields.classification')}>{tStatus('classifications', form.classification)}</Summary>
              <Summary label={t('project.fields.plannedStart')}>{formatDate(form.plannedStart || null)}</Summary>
              <Summary label={t('project.fields.program')}>
                {programs.data?.items.find((p) => p.id === form.programId)?.name ?? EM_DASH}
              </Summary>
              <Summary label={t('portfolio.wizard.projectManager')}>
                <span dir="auto">{form.pm?.displayName ?? EM_DASH}</span>
              </Summary>
              <Summary label={t('portfolio.wizard.newco.title')}>
                {form.newcoMode === 'new' ? (
                  <>
                    <span dir="auto">{form.newcoName}</span> — {tStatus('incorporationStatuses', form.newcoStatus)} (
                    {tStatus('verificationStatuses', newcoVerification)})
                  </>
                ) : (
                  t('portfolio.wizard.newco.mode_none')
                )}
              </Summary>
            </dl>
            <div className="rounded-md border border-line bg-surface-muted p-3">
              <h3 className="text-sm font-semibold">{t('common.command.whatWillHappen')}</h3>
              <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
                {template ? (
                  <li>
                    {t('portfolio.wizard.effects.create', {
                      code: form.code,
                      template: loc(template.name, template.nameAr),
                      gates: formatNumber(template.counts.gates),
                      workstreams: formatNumber(template.counts.workstreams),
                      activities: formatNumber(template.counts.activities),
                    })}
                  </li>
                ) : null}
                <li>{t('portfolio.wizard.effects.draft')}</li>
                {form.pm ? <li>{t('portfolio.wizard.effects.pm', { user: form.pm.displayName })}</li> : null}
                {form.newcoMode === 'new' ? (
                  <li>{t('portfolio.wizard.effects.newco', { verification: tStatus('verificationStatuses', newcoVerification) })}</li>
                ) : null}
                <li>{t('common.command.audited')}</li>
              </ul>
            </div>
            {showErrors && !stepValid('review') ? <p className="text-sm font-medium text-danger">{t('portfolio.wizard.errors.incomplete')}</p> : null}
            <ApiErrorNotice error={error} />
          </div>
        ) : null}

        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          <button type="button" className={btn.secondary} onClick={idx === 0 ? () => router.push('/') : back} disabled={busy}>
            <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {idx === 0 ? t('common.actions.cancel') : t('common.actions.back')}
          </button>
          {step === 'review' ? (
            <button type="button" className={btn.primary} onClick={submit} disabled={busy} aria-busy={busy} data-testid="create-submit">
              {busy ? t('common.actions.working') : t('portfolio.wizard.submit')}
            </button>
          ) : (
            <button type="button" className={btn.primary} onClick={next} data-testid="wizard-next">
              {t('common.actions.next')}
              <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
            </button>
          )}
        </div>
      </section>
    </Main>
  );
}
