'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Upload } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { documentsRoutes, jvRoutes } from '@hub/contracts';
import { DISCLOSURE_STATUSES, DOCUMENT_KINDS, ROOM_ACCESS_EVENT_KINDS, ROOM_ACCESS_LEVELS, type Classification, type DisclosureStatus, type RoomAccessEventKind, type RoomAccessLevel } from '@hub/domain';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { MetricCard } from '@/components/MetricCard';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, hint, input, label as labelCls } from '@/components/ui';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { Tabs, useTabParam } from '@/components/planning/Tabs';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { assignableClassifications, uploadVersion } from '@/lib/documents';
import { EXTERNAL_GRANT_MAX_DAYS, jk, jvHref, useJvRefresh, usePartnerNames, useRoom, useRoomNames, type Disclosure, type People, type Room, type RoomDetail, type RoomGrant, type RoomIndexItem } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { ButtonRow, Callout, CmdButton, FilterBar, FilterSelect, JvCommandDialog, Panel, Person, UText } from '../../_components/jv';

const TAB_KEYS = ['index', 'disclosures', 'grants', 'history'] as const;
type TabKey = (typeof TAB_KEYS)[number];
const PAGE_SIZE = 25;

type RoomMeta = Pick<Room, 'id' | 'name' | 'type' | 'partnerId' | 'classification' | 'locked' | 'canOpen' | 'myAccessLevel' | 'isDemo' | 'version'>;

/** Display names for the ids of a room's history / disclosures (from the access log and the grants the caller may read). */
function useRoomPeople(roomId: string, enabled: boolean): People {
  const { projectId, can } = useProjectContext();
  const log = useQuery({
    queryKey: jk.accessLog(projectId, roomId, { page: 1, pageSize: 100, people: true }),
    queryFn: ({ signal }) => api(jvRoutes.listRoomAccessLog, { params: { projectId, roomId }, query: { page: 1, pageSize: 100 }, signal }),
    enabled: enabled && can('jv.disclosure_log.read'),
  });
  const grants = useQuery({
    queryKey: jk.roomGrants(projectId, roomId),
    queryFn: ({ signal }) => api(jvRoutes.listRoomGrants, { params: { projectId, roomId }, signal }),
    enabled: enabled && can('jv.room.revoke_access'),
  });
  return useMemo(() => {
    const out: People = { ...(log.data?.people ?? {}) };
    for (const g of grants.data?.items ?? []) if (g.displayName) out[g.userId] = g.displayName;
    return out;
  }, [log.data, grants.data]);
}

function AddDocumentDialog({ room, onClose }: { room: RoomMeta; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId, me } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const fileId = useId();
  const options = assignableClassifications(me.user.clearance as Classification).filter((c) => options0(c, room.classification));
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<(typeof DOCUMENT_KINDS)[number]>('dd_material');
  const [classification, setClassification] = useState<Classification>(room.classification as Classification);
  const [file, setFile] = useState<File | null>(null);
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.room.addDocument.title')}
      confirmLabel={t('jv.room.addDocument.confirm')}
      noteMode="none"
      confirmDisabled={!title.trim() || !file}
      consequences={[t('jv.room.addDocument.effect'), t('jv.room.addDocument.notDisclosed'), t('common.command.audited')]}
      onConfirm={async () => {
        if (!file) return;
        const d = await api(documentsRoutes.createDocument, { params: { projectId }, body: { title: title.trim(), kind, classification, roomId: room.id } });
        await uploadVersion(projectId, d.id, file);
        await refresh();
        toast.show('success', t('jv.room.addDocument.done'));
        onClose();
      }}
    >
      <TextField label={t('jv.room.addDocument.docTitle')} required value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} data-testid="room-doc-title" />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={t('jv.room.addDocument.kind')} required value={kind} onChange={(e) => setKind(e.target.value as (typeof DOCUMENT_KINDS)[number])}>
          {DOCUMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {tStatus('documentKinds', k)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('jv.common.classification')} required value={classification} onChange={(e) => setClassification(e.target.value as Classification)}>
          {(options.length ? options : [room.classification as Classification]).map((c) => (
            <option key={c} value={c}>
              {tStatus('classifications', c)}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <label htmlFor={fileId} className={labelCls}>
          {t('jv.room.addDocument.file')} <span className="text-danger">*</span>
        </label>
        <input id={fileId} type="file" className={input} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="room-doc-file" />
        <p className={hint}>{t('jv.room.addDocument.fileHint')}</p>
      </div>
    </JvCommandDialog>
  );
}

/** Classifications at or below the room's (a document filed in a room never exceeds the caller's clearance anyway). */
function options0(c: Classification, roomClassification: string): boolean {
  const order = ['public', 'internal', 'confidential', 'restricted', 'strictly_confidential'];
  return order.indexOf(c) >= 0 && order.indexOf(c) <= Math.max(order.indexOf(roomClassification), order.indexOf('internal'));
}

function IndexTab({ room }: { room: RoomMeta }) {
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [requesting, setRequesting] = useState<RoomIndexItem | null>(null);
  const query = { page, pageSize: PAGE_SIZE, q: q || undefined };
  const list = useQuery({
    queryKey: jk.roomIndex(projectId, room.id, query),
    queryFn: ({ signal }) => api(jvRoutes.getRoomIndex, { params: { projectId, roomId: room.id }, query, signal }),
    placeholderData: (prev) => prev,
  });
  const canRequest = room.type === 'partner' && can('jv.room.manage') && room.myAccessLevel === 'manage' && !room.locked;
  return (
    <div className="space-y-3" data-testid="room-index">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SearchInput className="w-full sm:w-64" label={t('jv.room.index.search')} value={q} onChange={(v) => { setQ(v); setPage(1); }} />
        {can('documents.document.upload') && room.myAccessLevel && room.myAccessLevel !== 'read' && !room.locked ? (
          <button type="button" className={btn.secondary} onClick={() => setAddOpen(true)} data-testid="room-add-document">
            <Upload aria-hidden="true" className="size-4" />
            {t('jv.room.addDocument.action')}
          </button>
        ) : null}
      </div>
      <p className="text-sm text-muted">{room.type === 'partner' ? t('jv.room.index.hintPartner') : room.type === 'clean_team' ? t('jv.room.index.hintCleanTeam') : t('jv.room.index.hintInternal')}</p>
      <DataTable
        caption={t('jv.room.tabs.index')}
        columns={[
          {
            key: 'title',
            header: t('jv.room.index.document'),
            isRowHeader: true,
            cell: (d) => (
              <Link className={btn.link} href={`/projects/${projectId}/documents/${d.documentId}`}>
                <span dir="auto">{d.title}</span>
              </Link>
            ),
          },
          { key: 'kind', header: t('jv.room.addDocument.kind'), cell: (d) => <span className="text-xs">{tStatus('documentKinds', d.kind)}</span> },
          { key: 'classification', header: t('jv.common.classification'), cell: (d) => <span className="text-xs">{tStatus('classifications', d.classification)}</span> },
          {
            key: 'version',
            header: t('jv.room.index.version'),
            cell: (d) =>
              d.currentVersion ? (
                <span className="flex flex-col text-xs">
                  <span dir="auto">{t('jv.room.index.versionValue', { no: d.currentVersion.versionNo, file: d.currentVersion.filename })}</span>
                  <StatusBadge enumName="scanStatuses" value={d.currentVersion.scanStatus} />
                </span>
              ) : (
                <span className="text-xs text-muted">{t('jv.room.index.noVersion')}</span>
              ),
          },
          {
            key: 'disclosure',
            header: t('jv.room.index.disclosure'),
            cell: (d) =>
              d.disclosure ? (
                <span className="flex flex-col gap-0.5 text-xs">
                  <StatusBadge enumName="disclosureStatuses" value={d.disclosure.status} />
                  {d.disclosure.releasedAt ? <span className="tabular text-muted">{formatDateTime(d.disclosure.releasedAt)}</span> : null}
                </span>
              ) : (
                <span className="text-xs text-muted">{t('jv.room.index.notDisclosed')}</span>
              ),
          },
          {
            key: 'cmd',
            header: t('jv.common.commands'),
            cell: (d) =>
              canRequest && d.currentVersion && (!d.disclosure || d.disclosure.status === 'rejected' || d.disclosure.status === 'revoked') ? (
                <CmdButton label={t('jv.room.disclosures.request')} onClick={() => setRequesting(d)} testId="cmd-request-disclosure" />
              ) : (
                <span className="text-muted">{EM_DASH}</span>
              ),
          },
        ]}
        rows={list.data?.items}
        rowKey={(d) => d.documentId}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={q ? t('jv.common.emptySearch') : t('jv.room.index.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: setPage } : undefined}
        testId="room-index-table"
      />
      {addOpen ? <AddDocumentDialog room={room} onClose={() => setAddOpen(false)} /> : null}
      {requesting ? (
        <JvCommandDialog
          open
          onClose={() => setRequesting(null)}
          title={t('jv.room.disclosures.requestTitle')}
          confirmLabel={t('jv.room.disclosures.request')}
          consequences={[t('jv.room.disclosures.requestEffect', { title: requesting.title }), t('jv.room.disclosures.releaseSeparate'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.requestDisclosure, { params: { projectId, roomId: room.id }, body: { documentId: requesting.documentId, ...(requesting.currentVersion ? { documentVersionId: requesting.currentVersion.id } : {}), ...(note ? { note } : {}) } });
            await refresh();
            toast.show('success', t('jv.room.disclosures.requested'));
            setRequesting(null);
          }}
        />
      ) : null}
    </div>
  );
}

function DisclosuresTab({ room, people }: { room: RoomMeta; people: People }) {
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{ d: Disclosure; kind: 'release' | 'revoke' } | null>(null);
  const [outcome, setOutcome] = useState<'release' | 'reject'>('release');
  const query = { page, pageSize: PAGE_SIZE, status: (status || undefined) as DisclosureStatus | undefined };
  const list = useQuery({
    queryKey: jk.disclosures(projectId, room.id, query),
    queryFn: ({ signal }) => api(jvRoutes.listDisclosures, { params: { projectId, roomId: room.id }, query, signal }),
    enabled: can('jv.disclosure_log.read'),
    placeholderData: (prev) => prev,
  });
  if (!can('jv.disclosure_log.read')) return <p className="text-sm text-muted">{t('jv.room.disclosures.noPermission')}</p>;
  return (
    <div className="space-y-3" data-testid="room-disclosures">
      <FilterBar onClear={() => setStatus('')} active={!!status}>
        <FilterSelect label={t('jv.common.status')} value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={DISCLOSURE_STATUSES.map((s) => ({ value: s, label: tStatus('disclosureStatuses', s) }))} />
      </FilterBar>
      <p className="text-sm text-muted">{t('jv.room.disclosures.hint')}</p>
      <DataTable
        caption={t('jv.room.tabs.disclosures')}
        columns={[
          {
            key: 'doc',
            header: t('jv.room.index.document'),
            isRowHeader: true,
            cell: (d) => (
              <span className="flex flex-col">
                <span dir="auto">{d.documentTitle}</span>
                <span className="text-xs text-muted" dir="auto">
                  {t('jv.room.index.versionValue', { no: d.versionNo, file: d.filename })}
                </span>
              </span>
            ),
          },
          { key: 'status', header: t('jv.common.status'), cell: (d) => <StatusBadge enumName="disclosureStatuses" value={d.status} /> },
          {
            key: 'requested',
            header: t('jv.room.disclosures.requested'),
            cell: (d) => (
              <span className="flex flex-col text-xs">
                <Person id={d.requestedBy} people={people} />
                <span className="tabular text-muted">{formatDateTime(d.requestedAt)}</span>
                {d.requestNote ? <UText value={d.requestNote} /> : null}
              </span>
            ),
          },
          {
            key: 'decided',
            header: t('jv.room.disclosures.decided'),
            cell: (d) =>
              d.releasedBy || d.revokedBy ? (
                <span className="flex flex-col text-xs">
                  {d.releasedBy ? (
                    <span>
                      {t('jv.room.disclosures.releasedBy')} <Person id={d.releasedBy} people={people} /> · <span className="tabular">{formatDateTime(d.releasedAt)}</span>
                    </span>
                  ) : null}
                  {d.revokedBy ? (
                    <span>
                      {t('jv.room.disclosures.revokedBy')} <Person id={d.revokedBy} people={people} /> · <span className="tabular">{formatDateTime(d.revokedAt)}</span>
                    </span>
                  ) : null}
                  {d.statusReason ? <UText value={d.statusReason} /> : null}
                </span>
              ) : (
                <span className="text-muted">{EM_DASH}</span>
              ),
          },
          {
            key: 'cmd',
            header: t('jv.common.commands'),
            cell: (d) => (
              <ButtonRow>
                {d.status === 'requested' && can('jv.disclosure.release') && d.requestedBy !== me.user.id ? <CmdButton label={t('jv.room.disclosures.decide')} onClick={() => { setOutcome('release'); setPending({ d, kind: 'release' }); }} testId="cmd-release-disclosure" /> : null}
                {d.status === 'requested' && d.requestedBy === me.user.id ? <span className="text-xs text-muted">{t('jv.room.disclosures.ownRequest')}</span> : null}
                {d.status === 'released' && can('jv.disclosure.revoke') ? <CmdButton label={t('jv.room.disclosures.revoke')} onClick={() => setPending({ d, kind: 'revoke' })} testId="cmd-revoke-disclosure" /> : null}
              </ButtonRow>
            ),
          },
        ]}
        rows={list.data?.items}
        rowKey={(d) => d.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('jv.room.disclosures.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: setPage } : undefined}
        testId="disclosures-table"
      />
      {pending?.kind === 'release' ? (
        <JvCommandDialog
          open
          onClose={() => setPending(null)}
          title={t('jv.room.disclosures.decideTitle')}
          confirmLabel={outcome === 'release' ? t('jv.room.disclosures.release') : t('jv.room.disclosures.reject')}
          danger={outcome === 'reject'}
          expectedVersion={pending.d.version}
          consequences={[outcome === 'release' ? t('jv.room.disclosures.releaseEffect') : t('jv.room.disclosures.rejectEffect'), t('jv.room.disclosures.sod'), t('jv.rooms.noCopyPrevention'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.releaseDisclosure, { params: { projectId, roomId: room.id, disclosureId: pending.d.id }, body: { expectedVersion: pending.d.version, outcome, ...(note ? { note } : {}) } });
            await refresh();
            toast.show('success', t('jv.common.saved'));
            setPending(null);
          }}
        >
          <SelectField label={t('jv.common.outcome')} required value={outcome} onChange={(e) => setOutcome(e.target.value as 'release' | 'reject')}>
            <option value="release">{t('jv.room.disclosures.release')}</option>
            <option value="reject">{t('jv.room.disclosures.reject')}</option>
          </SelectField>
        </JvCommandDialog>
      ) : null}
      {pending?.kind === 'revoke' ? (
        <JvCommandDialog
          open
          onClose={() => setPending(null)}
          title={t('jv.room.disclosures.revokeTitle')}
          confirmLabel={t('jv.room.disclosures.revoke')}
          danger
          noteMode="required"
          noteLabel={t('jv.common.reason')}
          expectedVersion={pending.d.version}
          consequences={[t('jv.room.disclosures.revokeEffect'), t('jv.rooms.noCopyPrevention'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.revokeDisclosure, { params: { projectId, roomId: room.id, disclosureId: pending.d.id }, body: { expectedVersion: pending.d.version, reason: note } });
            await refresh();
            toast.show('success', t('jv.common.saved'));
            setPending(null);
          }}
        />
      ) : null}
    </div>
  );
}

function endOfDayRiyadh(date: string): string {
  return new Date(`${date}T23:59:59+03:00`).toISOString();
}

function GrantDialog({ room, onClose }: { room: RoomMeta; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const [user, setUser] = useState<PickedUser | null>(null);
  const [level, setLevel] = useState<RoomAccessLevel>('read');
  const [role, setRole] = useState<'' | 'clean_team' | 'external_partner_limited'>(room.type === 'clean_team' ? 'clean_team' : '');
  const [expires, setExpires] = useState('');
  const [reason, setReason] = useState('');
  const [attestation, setAttestation] = useState('');
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.room.grants.grantTitle')}
      confirmLabel={t('jv.room.grants.grant')}
      noteMode="none"
      confirmDisabled={!user || !reason.trim()}
      consequences={[
        t('jv.room.grants.grantEffect'),
        room.type === 'partner' ? t('jv.room.grants.externalRule', { days: EXTERNAL_GRANT_MAX_DAYS }) : room.type === 'clean_team' ? t('jv.room.grants.cleanTeamRule') : t('jv.room.grants.internalRule'),
        t('jv.room.grants.sod'),
        t('common.command.audited'),
      ]}
      onConfirm={async () => {
        if (!user) return;
        await api(jvRoutes.grantRoomAccess, {
          params: { projectId, roomId: room.id },
          body: { userId: user.id, accessLevel: level, role: role || null, reason: reason.trim(), ...(expires ? { expiresAt: endOfDayRiyadh(expires) } : {}), ...(attestation.trim() ? { attestationRef: attestation.trim() } : {}) },
        });
        await refresh();
        toast.show('success', t('jv.room.grants.granted'));
        onClose();
      }}
    >
      <UserPicker label={t('jv.room.grants.user')} required value={user} onChange={setUser} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={t('jv.room.grants.level')} required value={level} onChange={(e) => setLevel(e.target.value as RoomAccessLevel)}>
          {ROOM_ACCESS_LEVELS.map((l) => (
            <option key={l} value={l}>
              {tStatus('roomAccessLevels', l)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('jv.room.grants.role')} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          <option value="">{t('jv.room.grants.noRole')}</option>
          <option value="clean_team">{tStatus('roleKeys', 'clean_team')}</option>
          <option value="external_partner_limited">{tStatus('roleKeys', 'external_partner_limited')}</option>
        </SelectField>
        <TextField label={t('jv.room.grants.expires')} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} hint={t('jv.room.grants.expiresHint', { days: EXTERNAL_GRANT_MAX_DAYS })} />
        <TextField label={t('jv.room.grants.attestation')} value={attestation} maxLength={500} onChange={(e) => setAttestation(e.target.value)} hint={t('jv.room.grants.attestationHint')} />
      </div>
      <TextAreaField label={t('jv.common.reason')} required value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
    </JvCommandDialog>
  );
}

function GrantsTab({ room }: { room: RoomMeta }) {
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const [grantOpen, setGrantOpen] = useState(false);
  const [revoking, setRevoking] = useState<RoomGrant | null>(null);
  const list = useQuery({
    queryKey: jk.roomGrants(projectId, room.id),
    queryFn: ({ signal }) => api(jvRoutes.listRoomGrants, { params: { projectId, roomId: room.id }, signal }),
    enabled: can('jv.room.revoke_access'),
  });
  if (!can('jv.room.revoke_access')) return <p className="text-sm text-muted">{t('jv.room.grants.noPermission')}</p>;
  const people: People = Object.fromEntries((list.data?.items ?? []).filter((g) => g.displayName).map((g) => [g.userId, g.displayName!]));
  return (
    <div className="space-y-3" data-testid="room-grants">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{t('jv.room.grants.hint')}</p>
        {can('jv.room.grant_access') && !room.locked ? <CmdButton label={t('jv.room.grants.grant')} onClick={() => setGrantOpen(true)} testId="cmd-grant" variant="primary" /> : null}
      </div>
      <DataTable
        caption={t('jv.room.tabs.grants')}
        columns={[
          {
            key: 'user',
            header: t('jv.room.grants.user'),
            isRowHeader: true,
            cell: (g) => (
              <span className="flex flex-col">
                <span dir="auto">{g.displayName ?? t('jv.common.unknownUser', { id: g.userId.slice(-6) })}</span>
                {g.accountType ? <span className="text-xs text-muted">{t(`jv.room.grants.account.${g.accountType}`)}</span> : null}
              </span>
            ),
          },
          { key: 'level', header: t('jv.room.grants.level'), cell: (g) => <StatusBadge enumName="roomAccessLevels" value={g.accessLevel} tone="neutral" /> },
          { key: 'role', header: t('jv.room.grants.role'), cell: (g) => (g.role ? <span className="text-xs">{tStatus('roleKeys', g.role)}</span> : <span className="text-muted">{EM_DASH}</span>) },
          {
            key: 'reason',
            header: t('jv.common.reason'),
            cell: (g) => (
              <span className="flex flex-col text-xs">
                <UText value={g.reason} />
                {g.attestationRef ? <span className="text-muted" dir="auto">{t('jv.room.grants.attestationValue', { ref: g.attestationRef })}</span> : null}
              </span>
            ),
          },
          {
            key: 'granted',
            header: t('jv.room.grants.granted'),
            cell: (g) => (
              <span className="flex flex-col text-xs">
                <Person id={g.grantedBy} people={people} />
                <span className="tabular text-muted">{formatDateTime(g.grantedAt)}</span>
              </span>
            ),
          },
          { key: 'expires', header: t('jv.room.grants.expires'), cell: (g) => <span className="tabular text-xs">{g.expiresAt ? formatDateTime(g.expiresAt) : t('jv.room.grants.noExpiry')}</span> },
          {
            key: 'state',
            header: t('jv.common.status'),
            cell: (g) =>
              g.active ? (
                <StatusBadge enumName="roomAccessEventKinds" value="grant" tone="success" label={t('jv.room.grants.active')} />
              ) : (
                <span className="flex flex-col text-xs">
                  <StatusBadge enumName="roomAccessEventKinds" value="grant_revoked" tone="neutral" label={g.revokedAt ? t('jv.room.grants.revoked') : t('jv.room.grants.expired')} />
                  {g.revokeReason ? <UText value={g.revokeReason} /> : null}
                </span>
              ),
          },
          { key: 'cmd', header: t('jv.common.commands'), cell: (g) => (g.active && !g.revokedAt ? <CmdButton label={t('jv.room.grants.revoke')} onClick={() => setRevoking(g)} testId="cmd-revoke-grant" /> : <span className="text-muted">{EM_DASH}</span>) },
        ]}
        rows={list.data?.items}
        rowKey={(g) => g.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('jv.room.grants.empty')}
        testId="grants-table"
      />
      {grantOpen ? <GrantDialog room={room} onClose={() => setGrantOpen(false)} /> : null}
      {revoking ? (
        <JvCommandDialog
          open
          onClose={() => setRevoking(null)}
          title={t('jv.room.grants.revokeTitle')}
          confirmLabel={t('jv.room.grants.revoke')}
          danger
          noteMode="required"
          noteLabel={t('jv.common.reason')}
          consequences={[t('jv.room.grants.revokeEffect'), t('jv.rooms.noCopyPrevention'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.revokeRoomAccess, { params: { projectId, roomId: room.id, grantId: revoking.id }, body: { reason: note } });
            await refresh();
            toast.show('success', t('jv.room.grants.revokedDone'));
            setRevoking(null);
          }}
        />
      ) : null}
    </div>
  );
}

function HistoryTab({ room }: { room: RoomMeta }) {
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const query = { page, pageSize: PAGE_SIZE, kind: (kind || undefined) as RoomAccessEventKind | undefined };
  const list = useQuery({
    queryKey: jk.accessLog(projectId, room.id, query),
    queryFn: ({ signal }) => api(jvRoutes.listRoomAccessLog, { params: { projectId, roomId: room.id }, query, signal }),
    enabled: can('jv.disclosure_log.read'),
    placeholderData: (prev) => prev,
  });
  if (!can('jv.disclosure_log.read')) return <p className="text-sm text-muted">{t('jv.room.disclosures.noPermission')}</p>;
  const people = list.data?.people;
  return (
    <div className="space-y-3" data-testid="room-history">
      <FilterBar onClear={() => setKind('')} active={!!kind}>
        <FilterSelect label={t('jv.room.history.kind')} value={kind} onChange={(v) => { setKind(v); setPage(1); }} options={ROOM_ACCESS_EVENT_KINDS.map((k) => ({ value: k, label: tStatus('roomAccessEventKinds', k) }))} />
      </FilterBar>
      <p className="text-sm text-muted">{t('jv.room.history.hint')}</p>
      <DataTable
        caption={t('jv.room.tabs.history')}
        columns={[
          { key: 'at', header: t('jv.room.history.at'), isRowHeader: true, cell: (e) => <span className="tabular">{formatDateTime(e.createdAt)}</span> },
          { key: 'kind', header: t('jv.room.history.kind'), cell: (e) => <StatusBadge enumName="roomAccessEventKinds" value={e.kind} tone={e.kind === 'download' ? 'info' : e.kind.includes('revoked') || e.kind === 'room_locked' ? 'danger' : 'neutral'} /> },
          { key: 'actor', header: t('jv.room.history.actor'), cell: (e) => <Person id={e.actorUserId} people={people} /> },
          { key: 'subject', header: t('jv.room.history.subject'), cell: (e) => <Person id={e.subjectUserId} people={people} /> },
          { key: 'note', header: t('jv.common.note'), cell: (e) => <UText value={e.note} /> },
        ]}
        rows={list.data?.items}
        rowKey={(e) => e.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('jv.room.history.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: setPage } : undefined}
        testId="history-table"
      />
    </div>
  );
}

function RoomCommands({ room, detail }: { room: RoomMeta; detail: RoomDetail | null }) {
  const { t } = useI18n();
  const { projectId, can } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const [cmd, setCmd] = useState<'lock' | 'edit' | null>(null);
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(detail?.description ?? '');
  const canLock = can('jv.room.lock');
  const canEdit = can('jv.room.manage');
  if (!canLock && !canEdit) return null;
  return (
    <>
      <ButtonRow>
        {canLock ? <CmdButton label={room.locked ? t('jv.room.unlock') : t('jv.room.lock')} onClick={() => setCmd('lock')} testId="cmd-lock" variant={room.locked ? 'secondary' : 'danger'} /> : null}
        {canEdit ? <CmdButton label={t('jv.common.edit')} onClick={() => setCmd('edit')} testId="cmd-edit-room" /> : null}
      </ButtonRow>
      {cmd === 'lock' ? (
        <JvCommandDialog
          open
          onClose={() => setCmd(null)}
          title={room.locked ? t('jv.room.unlockTitle') : t('jv.room.lockTitle')}
          confirmLabel={room.locked ? t('jv.room.unlock') : t('jv.room.lock')}
          danger={!room.locked}
          noteMode="required"
          noteLabel={t('jv.common.reason')}
          expectedVersion={room.version}
          consequences={[room.locked ? t('jv.room.unlockEffect') : t('jv.room.lockEffect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            const route = room.locked ? jvRoutes.unlockRoom : jvRoutes.lockRoom;
            await api(route, { params: { projectId, roomId: room.id }, body: { expectedVersion: room.version, reason: note } });
            await refresh();
            toast.show('success', t('jv.common.saved'));
            setCmd(null);
          }}
        />
      ) : null}
      {cmd === 'edit' ? (
        <JvCommandDialog
          open
          onClose={() => setCmd(null)}
          title={t('jv.room.editTitle')}
          confirmLabel={t('jv.common.save')}
          noteMode="none"
          expectedVersion={room.version}
          confirmDisabled={!name.trim()}
          consequences={[t('jv.room.editEffect'), t('common.command.audited')]}
          onConfirm={async () => {
            await api(jvRoutes.updateRoom, { params: { projectId, roomId: room.id }, body: { expectedVersion: room.version, name: name.trim(), ...(detail ? { description: description.trim() || null } : {}) } });
            await refresh();
            toast.show('success', t('jv.common.saved'));
            setCmd(null);
          }}
        >
          <TextField label={t('jv.rooms.fields.name')} required value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          {detail ? <TextAreaField label={t('jv.rooms.fields.description')} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} /> : null}
        </JvCommandDialog>
      ) : null}
    </>
  );
}

/**
 * One room: VDR index, disclosures, grants and the append-only access history. Content needs a room grant (404 →
 * restricted state); a room administrator without a grant sees the metadata and the administration only.
 */
export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const partners = usePartnerNames();
  const rooms = useRoomNames();
  const q = useRoom(roomId);
  const hidden = isApiError(q.error) && (q.error.status === 404 || q.error.status === 403);
  const meta: RoomMeta | undefined = q.data ?? rooms.get(roomId);
  const adminOnly = hidden && !!meta;
  const tabKeys = (adminOnly ? (['grants', 'history'] as const) : TAB_KEYS).filter((k) => k !== 'history' || !adminOnly || can('jv.disclosure_log.read'));
  const [tab, setTab] = useTabParam<TabKey>(tabKeys as readonly TabKey[], tabKeys[0] as TabKey);
  const people = useRoomPeople(roomId, !!q.data);
  const base = jvHref(projectId);

  if (q.isLoading || (hidden && rooms.isLoading)) return <LoadingState />;
  if (q.error && !hidden) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  // Metadata of a room the caller administers (but is not granted) comes from the room list; otherwise it is not visible.
  if (!meta) return <RestrictedState />;
  const d = q.data ?? null;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`${base}/rooms`} className="inline-flex items-center gap-1 hover:underline">
            <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {t('jv.rooms.title')}
          </Link>
        }
        title={<span dir="auto">{meta.name}</span>}
        documentTitle={meta.name}
        badges={
          <>
            <StatusBadge enumName="roomTypes" value={meta.type} size="md" tone={meta.type === 'clean_team' ? 'warning' : 'neutral'} />
            {meta.locked ? <StatusBadge enumName="roomAccessEventKinds" value="room_locked" tone="danger" label={t('jv.rooms.locked')} /> : null}
            {meta.myAccessLevel ? <StatusBadge enumName="roomAccessLevels" value={meta.myAccessLevel} tone="success" label={t('jv.room.myLevel', { level: tStatus('roomAccessLevels', meta.myAccessLevel) })} /> : null}
            <span className="text-xs text-muted">{tStatus('classifications', meta.classification)}</span>
            {meta.partnerId ? <span className="text-xs text-muted" dir="auto">{partners.label(meta.partnerId)}</span> : null}
            {meta.isDemo ? <DemoBadge /> : null}
          </>
        }
        description={d?.description ? <UText value={d.description} multiline /> : undefined}
        actions={<RoomCommands key={meta.version} room={meta} detail={d} />}
      />
      <div className="space-y-6" data-testid="room-detail" data-room-type={meta.type} data-can-open={d ? 'true' : 'false'}>
        {d?.locked ? (
          <Callout tone="danger" testId="room-locked">
            {t('jv.room.lockedNotice', { at: formatDateTime(d.lockedAt), reason: d.lockReason ?? EM_DASH })}
          </Callout>
        ) : null}
        {meta.type === 'clean_team' ? <Callout testId="clean-team-room">{t('jv.rooms.cleanTeamNote')}</Callout> : null}
        {adminOnly ? (
          <Panel title={t('jv.room.contentTitle')} testId="room-content-restricted">
            <Callout tone="warning">{t('jv.room.noGrant')}</Callout>
            <RestrictedState showHomeLink={false} className="py-6" />
          </Panel>
        ) : null}
        {d ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="room-counts">
            <MetricCard label={t('jv.room.counts.documents')} value={d.counts.documents} href={`${base}/rooms/${d.id}?tab=index`} />
            <MetricCard label={t('jv.room.counts.disclosures')} value={d.counts.disclosuresReleased} href={`${base}/rooms/${d.id}?tab=disclosures`} />
            <MetricCard label={t('jv.room.counts.ddRequests')} value={d.counts.ddRequests} href={`${base}/diligence?roomId=${d.id}`} />
            <MetricCard label={t('jv.room.counts.findings')} value={d.counts.findings} href={`${base}/diligence?tab=findings&roomId=${d.id}`} />
          </div>
        ) : null}
        <Tabs tabs={tabKeys.map((k) => ({ key: k as TabKey, label: t(`jv.room.tabs.${k}`) }))} value={tab} onChange={setTab} label={t('jv.room.tabs.label')} testId="room-tabs">
          {tab === 'index' && d ? <IndexTab room={meta} /> : null}
          {tab === 'disclosures' && d ? <DisclosuresTab room={meta} people={people} /> : null}
          {tab === 'grants' ? <GrantsTab room={meta} /> : null}
          {tab === 'history' ? <HistoryTab room={meta} /> : null}
        </Tabs>
        {d ? <ActivityHistory projectId={projectId} entityType="partner_room" entityId={d.id} /> : null}
      </div>
    </>
  );
}
