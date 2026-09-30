'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Download } from 'lucide-react';
import { useState } from 'react';
import { buildPath, jvRoutes } from '@hub/contracts';
import { DD_DOMAINS } from '@hub/domain';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { DataTable } from '@/components/DataTable';
import { SelectField, TextAreaField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { Main } from '@/components/Main';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { formatBytes } from '@/lib/documents';
import { counterpartyProjects, partnerAccessHref, xk } from '@/lib/jv';
import { useMe } from '@/lib/queries';

function AskQuestion({ projectId, roomId }: { projectId: string; roomId: string }) {
  const { t, tStatus } = useI18n();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [question, setQuestion] = useState('');
  const [domain, setDomain] = useState<(typeof DD_DOMAINS)[number]>('technical');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <form
      className={cx(card, 'space-y-3 p-4')}
      data-testid="external-ask"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!question.trim()) return;
        setBusy(true);
        setError(null);
        try {
          const r = await api(jvRoutes.createExternalDdRequest, { params: { projectId, roomId }, body: { question: question.trim(), domain } });
          setQuestion('');
          await queryClient.invalidateQueries({ queryKey: xk.ddRequests(projectId, roomId) });
          toast.show('success', t('jv.external.asked', { number: r.number }));
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold text-ink">{t('jv.external.askTitle')}</h2>
      <p className="text-sm text-muted">{t('jv.external.askHint')}</p>
      <TextAreaField label={t('jv.dd.fields.question')} required value={question} maxLength={4000} onChange={(e) => setQuestion(e.target.value)} data-testid="external-question" />
      <SelectField label={t('jv.dd.fields.domain')} required value={domain} onChange={(e) => setDomain(e.target.value as (typeof DD_DOMAINS)[number])}>
        {DD_DOMAINS.map((d) => (
          <option key={d} value={d}>
            {tStatus('ddDomains', d)}
          </option>
        ))}
      </SelectField>
      <ApiErrorNotice error={error} />
      <button type="submit" className={btn.primary} disabled={busy || !question.trim()} aria-busy={busy} data-testid="external-ask-submit">
        {busy ? t('common.actions.working') : t('jv.external.askSubmit')}
      </button>
    </form>
  );
}

/**
 * Counterparty room view: the room's name, the items RELEASED into it (disclosed version only; downloads are audited
 * and refused after revocation or a lock) and the account's DD questions with their RELEASED answers only.
 */
export default function ExternalRoomPage() {
  const { projectId, roomId } = useParams<{ projectId: string; roomId: string }>();
  const { t, tStatus, formatDate, formatDateTime, locale } = useI18n();
  const me = useMe();
  const allowed = counterpartyProjects(me.data).find((p) => p.projectId === projectId);
  const rooms = useQuery({ queryKey: xk.rooms(projectId), queryFn: ({ signal }) => api(jvRoutes.listExternalRooms, { params: { projectId }, signal }), enabled: !!allowed });
  const room = rooms.data?.items.find((r) => r.id === roomId);
  const disclosures = useQuery({
    queryKey: xk.disclosures(projectId, roomId),
    queryFn: ({ signal }) => api(jvRoutes.listExternalDisclosures, { params: { projectId, roomId }, signal }),
    enabled: !!room,
  });
  const canReadDd = !!allowed?.permissions.includes('jv.dd_request.read_external');
  const dd = useQuery({
    queryKey: xk.ddRequests(projectId, roomId),
    queryFn: ({ signal }) => api(jvRoutes.listExternalDdRequests, { params: { projectId, roomId }, signal }),
    enabled: !!room && canReadDd,
  });

  if (me.isLoading || (allowed && rooms.isLoading)) {
    return (
      <Main>
        <LoadingState />
      </Main>
    );
  }
  // Not a counterparty of this project, or not granted this room: the same neutral restricted state (nothing is leaked).
  const hidden = isApiError(disclosures.error) && (disclosures.error.status === 404 || disclosures.error.status === 403);
  if (!allowed || !room || hidden) {
    return (
      <Main>
        <RestrictedState />
      </Main>
    );
  }
  const canDownload = allowed.permissions.includes('jv.disclosure.download');
  return (
    <Main>
      <PageHeader
        eyebrow={
          <Link href={partnerAccessHref()} className="inline-flex items-center gap-1 hover:underline">
            <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {t('jv.external.title')}
          </Link>
        }
        title={<span dir="auto">{room.name}</span>}
        documentTitle={room.name}
        description={t('jv.external.roomSubtitle')}
      />
      <div className="space-y-6" data-testid="external-room" data-room-id={room.id}>
        <p role="note" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-ink">
          {t('jv.external.downloadNotice')}
        </p>
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-ink">{t('jv.external.disclosedTitle')}</h2>
          <DataTable
            caption={t('jv.external.disclosedTitle')}
            columns={[
              { key: 'title', header: t('jv.room.index.document'), isRowHeader: true, cell: (d) => <span dir="auto">{d.title}</span> },
              { key: 'file', header: t('jv.external.file'), cell: (d) => <span dir="auto" className="text-xs">{t('jv.room.index.versionValue', { no: d.versionNo, file: d.filename })}</span> },
              { key: 'size', header: t('jv.external.size'), cell: (d) => <span className="tabular text-xs">{formatBytes(d.sizeBytes, locale)}</span> },
              { key: 'released', header: t('jv.external.releasedAt'), cell: (d) => <span className="tabular text-xs">{formatDateTime(d.releasedAt)}</span> },
              {
                key: 'download',
                header: t('jv.external.download'),
                cell: (d) =>
                  canDownload ? (
                    <a className={btn.link} href={buildPath(jvRoutes.downloadExternalDisclosure.path, { projectId, roomId, disclosureId: d.id })} download data-testid="external-download">
                      <Download aria-hidden="true" className="me-1 inline size-4" />
                      {t('jv.external.downloadAction', { title: d.title })}
                    </a>
                  ) : (
                    <span className="text-muted">{EM_DASH}</span>
                  ),
              },
            ]}
            rows={disclosures.data?.items}
            rowKey={(d) => d.id}
            isLoading={disclosures.isLoading}
            error={disclosures.error}
            onRetry={() => disclosures.refetch()}
            emptyTitle={t('jv.external.noDisclosures')}
            testId="external-disclosures"
          />
        </section>
        {canReadDd ? (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-ink">{t('jv.external.questionsTitle')}</h2>
            <DataTable
              caption={t('jv.external.questionsTitle')}
              columns={[
                { key: 'number', header: t('jv.dd.columns.number'), isRowHeader: true, cell: (q) => <span className="tabular">{t('jv.dd.numberValue', { number: q.number })}</span> },
                { key: 'question', header: t('jv.dd.fields.question'), cell: (q) => <span dir="auto" className="whitespace-pre-wrap">{q.question}</span> },
                { key: 'domain', header: t('jv.dd.fields.domain'), cell: (q) => <span className="text-xs">{tStatus('ddDomains', q.domain)}</span> },
                { key: 'due', header: t('jv.dd.fields.dueDate'), cell: (q) => <span className="tabular text-xs">{formatDate(q.dueDate)}</span> },
                { key: 'status', header: t('jv.common.status'), cell: (q) => <StatusBadge enumName="ddExternalStatuses" value={q.status} /> },
                {
                  key: 'answer',
                  header: t('jv.external.answer'),
                  cell: (q) =>
                    q.answer ? (
                      <span className="flex flex-col gap-0.5">
                        <span dir="auto" className="whitespace-pre-wrap">
                          {q.answer}
                        </span>
                        <span className="tabular text-xs text-muted">{formatDateTime(q.answeredAt)}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted">{t('jv.external.noAnswer')}</span>
                    ),
                },
              ]}
              rows={dd.data?.items}
              rowKey={(q) => q.id}
              isLoading={dd.isLoading}
              error={dd.error}
              onRetry={() => dd.refetch()}
              emptyTitle={t('jv.external.noQuestions')}
              testId="external-dd"
            />
          </section>
        ) : null}
        {allowed.permissions.includes('jv.dd_request.create') ? <AskQuestion projectId={projectId} roomId={roomId} /> : null}
        <p className="text-xs text-muted">{t('jv.external.recorded')}</p>
      </div>
    </Main>
  );
}
