'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserMinus, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { portfolioRoutes, type RouteResponse } from '@hub/contracts';
import { ROLE_KEYS, type RoleKey } from '@hub/domain';
import { ActivityHistory } from '@/components/ActivityHistory';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { SelectField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { SectionGuard } from '@/components/SectionGuard';
import { useToast } from '@/components/Toast';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { qk, useWorkstreams } from '@/lib/queries';
import { workstreamName, workstreamNameLang } from '@/lib/workstreams';

type Membership = RouteResponse<typeof portfolioRoutes.listMembers>['items'][number];

/** Roles that are granted at organization level only — not offered in the project dialog. */
const ORG_ONLY: readonly RoleKey[] = ['platform_admin', 'portfolio_admin'];
/** Roles that are granted to partner rooms, not projects/workstreams. */
const ROOM_ONLY: readonly RoleKey[] = ['clean_team', 'external_partner_limited'];

function GrantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, tStatus, locale } = useI18n();
  const { projectId, can } = useProjectContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const workstreams = useWorkstreams(projectId, open && can('planning.plan.read'));
  const [user, setUser] = useState<PickedUser | null>(null);
  const [role, setRole] = useState<RoleKey | ''>('');
  const [workstreamId, setWorkstreamId] = useState('');
  const [validTo, setValidTo] = useState('');

  const reset = () => {
    setUser(null);
    setRole('');
    setWorkstreamId('');
    setValidTo('');
  };
  const roles = ROLE_KEYS.filter((r) => !ORG_ONLY.includes(r) && !ROOM_ONLY.includes(r));
  const ws = workstreams.data?.items.find((w) => w.id === workstreamId);

  return (
    <ConfirmCommandDialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('members.grant.title')}
      confirmLabel={t('members.grant.confirm')}
      noteMode="required"
      noteLabel={t('members.reason')}
      confirmDisabled={!user || !role}
      consequences={[
        user && role
          ? t(ws ? 'members.grant.effectWorkstream' : 'members.grant.effectProject', {
              user: user.displayName,
              role: tStatus('roleKeys', role),
              workstream: ws ? `${ws.code} — ${workstreamName(ws, locale)}` : '',
            })
          : t('members.grant.pick'),
        t('members.grant.effectImmediate'),
        t('common.command.audited'),
      ]}
      onConfirm={async ({ note }) => {
        if (!user || !role) return;
        await api(portfolioRoutes.grantMembership, {
          params: { projectId },
          body: { userId: user.id, role, reason: note, ...(workstreamId ? { workstreamId } : {}), ...(validTo ? { validTo } : {}) },
        });
        await queryClient.invalidateQueries({ queryKey: qk.members(projectId) });
        toast.show('success', t('members.grant.done', { user: user.displayName }));
        reset();
        onClose();
      }}
    >
      <div className="space-y-4">
        <UserPicker label={t('members.columns.user')} value={user} onChange={setUser} required />
        <SelectField label={t('members.columns.role')} required value={role} onChange={(e) => setRole(e.target.value as RoleKey | '')}>
          <option value="">{t('members.grant.chooseRole')}</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {tStatus('roleKeys', r)}
            </option>
          ))}
        </SelectField>
        {can('planning.plan.read') ? (
          <SelectField
            label={t('members.columns.workstream')}
            value={workstreamId}
            onChange={(e) => setWorkstreamId(e.target.value)}
            hint={t('members.grant.workstreamHint')}
          >
            <option value="">{t('members.grant.wholeProject')}</option>
            {(workstreams.data?.items ?? []).map((w) => (
              <option key={w.id} value={w.id} lang={workstreamNameLang(w, locale).lang}>
                {w.code} — {workstreamName(w, locale)}
              </option>
            ))}
          </SelectField>
        ) : null}
        <TextField label={t('members.columns.validTo')} type="date" dir="ltr" value={validTo} onChange={(e) => setValidTo(e.target.value)} hint={t('members.grant.validToHint')} />
        <p className="text-xs text-muted">{t('members.grant.serverDecides')}</p>
      </div>
    </ConfirmCommandDialog>
  );
}

export default function MembersPage() {
  const { t, tStatus, formatDateTime, formatDate } = useI18n();
  const { projectId, project, can } = useProjectContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const canManage = can('admin.role_assignment.manage');
  const [q, setQ] = useState('');
  const [grantOpen, setGrantOpen] = useState(false);
  const [revoking, setRevoking] = useState<Membership | null>(null);

  const members = useQuery({
    queryKey: qk.members(projectId),
    queryFn: ({ signal }) => api(portfolioRoutes.listMembers, { params: { projectId }, signal }),
    enabled: can('admin.role_assignment.read'),
  });

  const rows = useMemo(() => {
    const items = members.data?.items;
    if (!items || !q) return items;
    const needle = q.toLocaleLowerCase();
    return items.filter((m) =>
      [m.displayName, m.email, m.role, tStatus('roleKeys', m.role), m.workstreamCode ?? ''].some((s) => s.toLocaleLowerCase().includes(needle)),
    );
  }, [members.data, q, tStatus]);

  const columns: Column<Membership>[] = [
    {
      key: 'user',
      header: t('members.columns.user'),
      isRowHeader: true,
      sortValue: (m) => m.displayName,
      cell: (m) => (
        <span className="flex flex-col">
          <span dir="auto">{m.displayName}</span>
          <span className="text-xs font-normal text-muted" dir="ltr">
            {m.email}
          </span>
        </span>
      ),
    },
    { key: 'role', header: t('members.columns.role'), sortValue: (m) => tStatus('roleKeys', m.role), cell: (m) => tStatus('roleKeys', m.role) },
    {
      key: 'scope',
      header: t('members.columns.workstream'),
      sortValue: (m) => m.workstreamCode ?? '',
      cell: (m) => (m.workstreamCode ? <span dir="ltr">{m.workstreamCode}</span> : <span className="text-muted">{t('members.wholeProject')}</span>),
    },
    { key: 'validTo', header: t('members.columns.validTo'), sortValue: (m) => m.validTo ?? '', cell: (m) => (m.validTo ? formatDate(m.validTo) : EM_DASH) },
    { key: 'granted', header: t('members.columns.grantedAt'), sortValue: (m) => m.grantedAt, cell: (m) => <span className="tabular">{formatDateTime(m.grantedAt)}</span> },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: t('members.columns.actions'),
            cell: (m: Membership) => (
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-medium text-danger hover:bg-danger-soft"
                onClick={() => setRevoking(m)}
                aria-label={t('members.revoke.labelFor', { user: m.displayName, role: tStatus('roleKeys', m.role) })}
              >
                <UserMinus aria-hidden="true" className="size-4" />
                {t('members.revoke.action')}
              </button>
            ),
          },
        ]
      : []),
  ];

  return (
    <SectionGuard section="members">
      <PageHeader
        eyebrow={<span dir="ltr">{project.code}</span>}
        title={t('members.title')}
        description={t('members.subtitle')}
        actions={
          canManage ? (
            <button type="button" className={btn.primary} onClick={() => setGrantOpen(true)} data-testid="grant-role">
              <UserPlus aria-hidden="true" className="size-4" />
              {t('members.grant.action')}
            </button>
          ) : null
        }
      />
      <div className="mb-4 sm:w-80">
        <SearchInput label={t('members.search')} value={q} onChange={setQ} />
      </div>
      <DataTable
        caption={t('members.title')}
        columns={columns}
        rows={rows}
        rowKey={(m) => m.id}
        isLoading={members.isLoading}
        error={members.error}
        onRetry={() => members.refetch()}
        emptyTitle={q ? t('members.emptySearch') : t('members.empty')}
        clientPageSize={25}
        initialSort={{ key: 'user', dir: 'asc' }}
        testId="members-table"
      />

      <ActivityHistory className="mt-6" projectId={projectId} entityType="project_membership" />

      {canManage ? <GrantDialog open={grantOpen} onClose={() => setGrantOpen(false)} /> : null}
      {canManage ? (
        <ConfirmCommandDialog
          open={revoking !== null}
          onClose={() => setRevoking(null)}
          title={t('members.revoke.title')}
          confirmLabel={t('members.revoke.confirm')}
          danger
          noteMode="required"
          noteLabel={t('members.reason')}
          consequences={
            revoking
              ? [
                  t('members.revoke.effect', { user: revoking.displayName, role: tStatus('roleKeys', revoking.role) }),
                  t('members.revoke.effectJobs'),
                  t('common.command.audited'),
                ]
              : []
          }
          onConfirm={async ({ note }) => {
            if (!revoking) return;
            await api(portfolioRoutes.revokeMembership, { params: { projectId, membershipId: revoking.id }, body: { reason: note } });
            await queryClient.invalidateQueries({ queryKey: qk.members(projectId) });
            toast.show('success', t('members.revoke.done', { user: revoking.displayName }));
            setRevoking(null);
          }}
        />
      ) : null}
    </SectionGuard>
  );
}
