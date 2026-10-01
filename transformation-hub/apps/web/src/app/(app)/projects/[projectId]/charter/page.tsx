'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { portfolioRoutes, type RouteBody } from '@hub/contracts';
import { ActivityHistory } from '@/components/ActivityHistory';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { ProjectBadges } from '@/components/ProjectBadges';
import { SectionGuard } from '@/components/SectionGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { VerificationBadge } from '@/components/VerificationBadge';
import { btn, card, cx } from '@/components/ui';
import { INTL_LOCALE } from '@/i18n/config';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext, type ProjectDetail } from '@/lib/project-context';
import { qk } from '@/lib/queries';
import { useLocalized } from '@/lib/i18n-data';
import { ApprovedBaseline, CommitteeCharters } from './_components/GovernanceBaseline';

type Entity = ProjectDetail['entities'][number];
type Phase = ProjectDetail['phases'][number];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm text-ink sm:col-span-2">{children}</dd>
    </div>
  );
}

function EditCharterForm({ project, onDone }: { project: ProjectDetail; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const initial = useMemo(
    () => ({
      name: project.name,
      description: project.description ?? '',
      objective: project.objective ?? '',
      plannedStart: project.plannedStart ?? '',
    }),
    [project],
  );
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(initial), [initial]);

  const nameError = form.name.trim().length === 0 ? t('common.validation.required') : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (nameError) return;
    const body: RouteBody<typeof portfolioRoutes.updateProject> = { expectedVersion: project.version };
    if (form.name.trim() !== initial.name) body.name = form.name.trim();
    if (form.description !== initial.description) body.description = form.description;
    if (form.objective !== initial.objective) body.objective = form.objective;
    if (form.plannedStart !== initial.plannedStart) body.plannedStart = form.plannedStart || null;
    if (Object.keys(body).length === 1) {
      onDone();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(portfolioRoutes.updateProject, { params: { projectId: project.id }, body });
      await queryClient.invalidateQueries({ queryKey: qk.project(project.id) });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.show('success', t('project.charter.saved'));
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    setError(null);
    await queryClient.invalidateQueries({ queryKey: qk.project(project.id) });
  };

  return (
    <form onSubmit={submit} className={cx(card, 'space-y-4 p-4')} noValidate aria-labelledby="edit-charter-title">
      <h2 id="edit-charter-title" className="text-lg font-semibold">
        {t('project.charter.editTitle')}
      </h2>
      <TextField label={t('project.fields.name')} required value={form.name} maxLength={200} error={nameError} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <TextAreaField label={t('project.fields.description')} value={form.description} maxLength={4000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <TextAreaField label={t('project.fields.objective')} value={form.objective} maxLength={4000} onChange={(e) => setForm({ ...form, objective: e.target.value })} />
      <TextField
        label={t('project.fields.plannedStart')}
        type="date"
        dir="ltr"
        value={form.plannedStart}
        hint={t('project.charter.plannedStartHint')}
        onChange={(e) => setForm({ ...form, plannedStart: e.target.value })}
      />
      <p className="text-xs text-muted">{t('project.charter.statusNotEditable')}</p>
      <ApiErrorNotice error={error} onReload={reload} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={btn.secondary} onClick={onDone} disabled={busy}>
          {t('common.actions.cancel')}
        </button>
        <button type="submit" className={btn.primary} disabled={busy || Boolean(nameError)} aria-busy={busy}>
          {busy ? t('common.actions.working') : t('common.actions.save')}
        </button>
      </div>
    </form>
  );
}

export default function CharterPage() {
  const { t, tStatus, formatDate, locale, formatList } = useI18n();
  const loc = useLocalized();
  const { project, projectId, can } = useProjectContext();
  const [editing, setEditing] = useState(false);
  const canEdit = can('portfolio.project.update');

  const weekday = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: 'long', timeZone: 'UTC' });
    // 2023-01-01 was a Sunday (day 0).
    return (d: number) => fmt.format(new Date(Date.UTC(2023, 0, 1 + d)));
  }, [locale]);

  return (
    <SectionGuard section="charter">
      <PageHeader
        eyebrow={t('project.charter.eyebrow')}
        title={<span dir="auto">{project.name}</span>}
        documentTitle={`${project.code} — ${t('project.charter.eyebrow')}`}
        badges={<ProjectBadges project={project} />}
        actions={
          canEdit && !editing ? (
            <button type="button" className={btn.secondary} onClick={() => setEditing(true)} data-testid="edit-charter">
              <Pencil aria-hidden="true" className="size-4" />
              {t('common.actions.edit')}
            </button>
          ) : null
        }
      />

      <div className="space-y-6">
        {editing ? (
          <EditCharterForm project={project} onDone={() => setEditing(false)} />
        ) : (
          <section aria-labelledby="charter-fields" className={cx(card, 'p-4')}>
            <h2 id="charter-fields" className="mb-3 text-lg font-semibold">
              {t('project.charter.fieldsTitle')}
            </h2>
            <dl className="space-y-3">
              <Field label={t('project.fields.code')}>
                <span dir="ltr">{project.code}</span>
              </Field>
              <Field label={t('project.fields.name')}>
                <span dir="auto">{project.name}</span>
              </Field>
              <Field label={t('project.fields.description')}>
                <p dir="auto" className="whitespace-pre-line">
                  {project.description || EM_DASH}
                </p>
              </Field>
              <Field label={t('project.fields.objective')}>
                <p dir="auto" className="whitespace-pre-line">
                  {project.objective || EM_DASH}
                </p>
              </Field>
              <Field label={t('project.fields.status')}>
                <StatusBadge enumName="projectStatuses" value={project.status} />
              </Field>
              <Field label={t('project.fields.classification')}>{tStatus('classifications', project.classification)}</Field>
              <Field label={t('project.fields.plannedStart')}>
                {formatDate(project.plannedStart)} {project.isDemo && project.plannedStart ? <DemoBadge className="ms-2" /> : null}
              </Field>
              <Field label={t('project.fields.program')}>
                <span dir="auto">{project.programName ?? EM_DASH}</span>
              </Field>
              <Field label={t('project.fields.template')}>
                {tStatus('templateKinds', project.templateKind)} · {t('portfolio.templateVersion', { version: project.templateVersionNo })}{' '}
                <span className="text-muted" dir="ltr">
                  ({project.templateKey})
                </span>
              </Field>
              <Field label={t('project.fields.timezone')}>
                <span dir="ltr">{project.timezone}</span>
              </Field>
              <Field label={t('project.fields.workingDays')}>{formatList(project.workingDays.map(weekday))}</Field>
              <Field label={t('project.fields.version')}>
                <span className="tabular">{project.version}</span>
              </Field>
            </dl>
          </section>
        )}

        {/* REQ-UX-006: the committee charter version (with its approval state) and the approved baseline. */}
        <section aria-labelledby="charter-governance">
          <h2 id="charter-governance" className="mb-1 text-lg font-semibold">
            {t('project.overview.governanceTitle')}
          </h2>
          <p className="mb-3 text-sm text-muted">{t('project.overview.governanceHint')}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <CommitteeCharters />
            <ApprovedBaseline />
          </div>
        </section>

        <section aria-labelledby="charter-phases">
          <h2 id="charter-phases" className="mb-3 text-lg font-semibold">
            {t('project.phases.title')}
          </h2>
          <DataTable<Phase>
            caption={t('project.phases.title')}
            rows={project.phases}
            rowKey={(p) => p.key}
            emptyTitle={t('project.phases.empty')}
            columns={[
              { key: 'order', header: '#', cell: (p) => <span className="tabular">{project.phases.indexOf(p) + 1}</span> },
              // Template-seeded phase names are bilingual (QA-P1-14): shown in the active language.
              { key: 'name', header: t('project.phases.name'), isRowHeader: true, cell: (p) => <span dir="auto">{loc(p.name, p.nameAr)}</span> },
              { key: 'gates', header: t('project.phases.gates'), cell: (p) => <span dir="ltr">{p.gateKeys.join(', ') || EM_DASH}</span> },
            ]}
          />
        </section>

        <section aria-labelledby="charter-entities">
          <h2 id="charter-entities" className="mb-1 text-lg font-semibold">
            {t('project.entities.title')}
          </h2>
          <p className="mb-3 text-sm text-muted">{t('project.entities.hint')}</p>
          <DataTable<Entity>
            caption={t('project.entities.title')}
            rows={project.entities}
            rowKey={(e) => e.id}
            emptyTitle={t('project.entities.empty')}
            columns={[
              {
                key: 'name',
                header: t('project.entities.name'),
                isRowHeader: true,
                sortValue: (e) => e.name,
                cell: (e) => (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span dir="auto">{e.name}</span>
                    {e.isDemo ? <DemoBadge /> : null}
                  </span>
                ),
              },
              { key: 'role', header: t('project.entities.role'), sortValue: (e) => e.role, cell: (e) => tStatus('entityKinds', e.role) },
              {
                key: 'inc',
                header: t('project.entities.incorporation'),
                cell: (e) => <StatusBadge enumName="incorporationStatuses" value={e.incorporationStatus} />,
              },
              { key: 'ver', header: t('project.entities.verification'), cell: (e) => <VerificationBadge value={e.verification} /> },
            ]}
          />
        </section>

        <ActivityHistory projectId={projectId} entityType="project" entityId={projectId} />
      </div>
    </SectionGuard>
  );
}
