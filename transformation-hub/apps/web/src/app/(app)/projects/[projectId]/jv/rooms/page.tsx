'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Lock, Plus } from 'lucide-react';
import { jvRoutes } from '@hub/contracts';
import { ROOM_TYPES, type Classification, type RoomType } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { assignableClassifications } from '@/lib/documents';
import { jvHref, useJvRefresh, usePartnerNames, useRooms, type Room } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { Callout, FilterBar, FilterSelect, JvCommandDialog, NdaNoAccessNotice, useUrlState } from '../_components/jv';

const PAGE_SIZE = 25;
const FILTERS = ['q', 'type'] as const;

function CreateRoomDialog({ onClose }: { onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId, me } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const partners = usePartnerNames();
  const options = assignableClassifications(me.user.clearance as Classification);
  const [name, setName] = useState('');
  const [type, setType] = useState<RoomType>('partner');
  const [partnerId, setPartnerId] = useState('');
  const [description, setDescription] = useState('');
  const [classification, setClassification] = useState<Classification>(options.includes('confidential') ? 'confidential' : options[options.length - 1]!);
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.rooms.create.title')}
      confirmLabel={t('jv.rooms.create.confirm')}
      noteMode="none"
      confirmDisabled={!name.trim() || (type === 'partner' && !partnerId)}
      consequences={[t(`jv.rooms.create.effect.${type}`), t('jv.rooms.grantsOnly'), t('common.command.audited')]}
      onConfirm={async () => {
        const r = await api(jvRoutes.createRoom, {
          params: { projectId },
          body: { name: name.trim(), type, classification, ...(type === 'partner' && partnerId ? { partnerId } : {}), ...(description.trim() ? { description: description.trim() } : {}) },
        });
        await refresh();
        toast.show('success', t('jv.rooms.create.done'));
        onClose();
        return r;
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField className="sm:col-span-2" label={t('jv.rooms.fields.name')} required value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="room-name" />
        <SelectField label={t('jv.rooms.fields.type')} required value={type} onChange={(e) => setType(e.target.value as RoomType)} data-testid="room-type">
          {ROOM_TYPES.map((x) => (
            <option key={x} value={x}>
              {tStatus('roomTypes', x)}
            </option>
          ))}
        </SelectField>
        {type === 'partner' ? (
          <SelectField label={t('jv.common.partner')} required value={partnerId} onChange={(e) => setPartnerId(e.target.value)} data-testid="room-partner">
            <option value="">{t('jv.common.select')}</option>
            {partners.items
              .filter((p) => p.stage !== 'withdrawn')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
          </SelectField>
        ) : null}
        <SelectField label={t('jv.common.classification')} required value={classification} onChange={(e) => setClassification(e.target.value as Classification)}>
          {options.map((c) => (
            <option key={c} value={c}>
              {tStatus('classifications', c)}
            </option>
          ))}
        </SelectField>
        <TextAreaField className="sm:col-span-2" label={t('jv.rooms.fields.description')} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </JvCommandDialog>
  );
}

/**
 * Partner / internal / clean-team rooms (REQ-JV-001/009, REQ-ENT-012). A room opens only with an explicit grant; room
 * administrators see the metadata of rooms they are not granted, never their content.
 */
export default function RoomsPage() {
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const partners = usePartnerNames();
  const [createOpen, setCreateOpen] = useState(false);
  const base = jvHref(projectId);
  const list = useRooms({ page, pageSize: PAGE_SIZE, q: values.q || undefined, type: (values.type || undefined) as RoomType | undefined });
  const columns: Column<Room>[] = [
    {
      key: 'name',
      header: t('jv.rooms.fields.name'),
      isRowHeader: true,
      sortValue: (r) => r.name,
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1" data-room-name={r.name}>
          <Link className={btn.link} href={`${base}/rooms/${r.id}`} data-testid="room-link" data-can-open={r.canOpen ? 'true' : 'false'}>
            <span dir="auto">{r.name}</span>
          </Link>
          {r.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'type', header: t('jv.rooms.fields.type'), sortValue: (r) => r.type, cell: (r) => <StatusBadge enumName="roomTypes" value={r.type} tone={r.type === 'clean_team' ? 'warning' : 'neutral'} /> },
    { key: 'partner', header: t('jv.common.partner'), cell: (r) => (r.partnerId ? <span dir="auto">{partners.label(r.partnerId)}</span> : <span className="text-muted">{t('jv.common.none')}</span>) },
    { key: 'classification', header: t('jv.common.classification'), cell: (r) => <span className="text-xs">{tStatus('classifications', r.classification)}</span> },
    {
      key: 'access',
      header: t('jv.rooms.fields.myAccess'),
      cell: (r) =>
        r.canOpen ? (
          <StatusBadge enumName="roomAccessLevels" value={r.myAccessLevel} tone="success" />
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted" data-testid="room-metadata-only">
            <Lock aria-hidden="true" className="size-3.5" />
            {t('jv.rooms.metadataOnly')}
          </span>
        ),
    },
    { key: 'locked', header: t('jv.rooms.fields.state'), cell: (r) => (r.locked ? <StatusBadge enumName="roomAccessEventKinds" value="room_locked" tone="danger" label={t('jv.rooms.locked')} /> : <span className="text-xs text-muted">{t('jv.rooms.open')}</span>) },
    { key: 'created', header: t('jv.common.createdAt'), sortValue: (r) => r.createdAt, cell: (r) => <span className="tabular">{formatDateTime(r.createdAt)}</span> },
  ];
  return (
    <>
      <PageHeader
        title={t('jv.rooms.title')}
        description={t('jv.rooms.subtitle')}
        actions={
          can('jv.room.manage') ? (
            <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-room">
              <Plus aria-hidden="true" className="size-4" />
              {t('jv.rooms.create.action')}
            </button>
          ) : null
        }
      />
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Callout testId="grants-only">{t('jv.rooms.grantsOnly')}</Callout>
          <NdaNoAccessNotice />
          <Callout tone="warning" testId="no-copy-prevention">
            {t('jv.rooms.noCopyPrevention')}
          </Callout>
          <Callout testId="clean-team-note">{t('jv.rooms.cleanTeamNote')}</Callout>
        </div>
        <FilterBar onClear={clear} active={active}>
          <SearchInput className="w-full sm:w-64" label={t('jv.rooms.search')} value={values.q} onChange={(v) => set({ q: v })} />
          <FilterSelect label={t('jv.rooms.fields.type')} value={values.type} onChange={(v) => set({ type: v })} options={ROOM_TYPES.map((x) => ({ value: x, label: tStatus('roomTypes', x) }))} testId="filter-room-type" />
        </FilterBar>
        <DataTable
          caption={t('jv.rooms.title')}
          columns={columns}
          rows={list.data?.items}
          rowKey={(r) => r.id}
          isLoading={list.isLoading}
          error={list.error}
          onRetry={() => list.refetch()}
          emptyTitle={active ? t('jv.common.emptySearch') : t('jv.rooms.empty')}
          emptyHint={active ? undefined : t('jv.rooms.emptyHint')}
          pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
          testId="rooms-table"
        />
      </div>
      {createOpen ? <CreateRoomDialog onClose={() => setCreateOpen(false)} /> : null}
    </>
  );
}
