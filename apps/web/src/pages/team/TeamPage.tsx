// Transformation > Team (REQ-PB-012, REQ-S10-008): who holds each role on this transformation, with the role's
// accountability text next to the assignment (B0018 verbatim for the six minimum governance roles; platform text,
// M0187, for the implementation roles). Reads GET /transformations/{id}/scoped-assignments (assignments here and
// inherited from above) and GET /role-accountabilities; assigns through POST /transformations/{id}/scoped-assignments.
//
// Who may assign is decided by the server (team.assign: TL/TO, only the non-approver roles WL/KDS/TD/CM/SEC, never to
// oneself). The UI only OFFERS the control where the session's permissions suggest it would succeed: a read-only
// auditor (AUD) and anyone without team.assign see no assign control, and a 403 is still shown in words.
// Assigning a team role is an access change, never a business approval (G1-G6) and never an engineering gate.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TEAM_ASSIGNABLE_ROLES, teamAssignmentCreate } from "@mth/shared/schemas";
import { useAllUsers, useP2Refresh, useRoleAccountabilities, useTeam } from "../../api/queries.ts";
import type { RoleAccountability, TeamAssignment } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { Unknown } from "../../components/Badges.tsx";
import { Icon } from "../../components/Icon.tsx";
import { usePeople, type Person } from "../../components/People.tsx";
import { RecordDialog, type FieldSpec } from "../../components/RecordForm.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";

/** The six minimum governance roles, in the playbook's order (B0018). */
export const GOVERNANCE_ROLES = ["SP", "TL", "BO", "WL", "FIN", "TO"] as const;
const ASSIGNABLE: readonly string[] = TEAM_ASSIGNABLE_ROLES;

export function TeamPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame tab="team" title={t("team.title")} subtitle={t("team.intro")} writePermissions={["team.assign"]}>
      <TeamBody />
    </WorkspaceFrame>
  );
}

function TeamBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const team = useTeam(ws.tid);
  const accountabilities = useRoleAccountabilities();
  const [assigning, setAssigning] = useState<{ roleCode: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const canAssign = ws.can("team.assign");

  return (
    <QueryState query={accountabilities}>
      {(texts) => (
        <QueryState query={team}>
          {(members) => {
            const byRole = new Map(texts.map((a) => [a.roleCode as string, a]));
            // Every role not among the six governance roles (WL is both a governance role and team-assignable: it is
            // listed once, under the governance roles).
            const implementationRoles = [
              ...new Set([...ASSIGNABLE, ...members.map((m) => m.assignment.roleCode as string)]),
            ].filter((r) => !(GOVERNANCE_ROLES as readonly string[]).includes(r));
            const open = (roleCode: string) => {
              setDone(null);
              setAssigning({ roleCode });
            };
            return (
              <>
                {done ? (
                  <p className="banner banner--success" role="status" data-state="assigned">
                    <Icon name="check" /> {done}
                  </p>
                ) : null}
                <Section id="team-governance" title={t("team.governance.title")} intro={t("team.governance.intro")}>
                  <RoleList
                    roles={GOVERNANCE_ROLES}
                    texts={byRole}
                    members={members}
                    canAssign={canAssign}
                    onAssign={open}
                  />
                </Section>
                <Section
                  id="team-implementation"
                  title={t("team.implementation.title")}
                  intro={t("team.implementation.intro")}
                >
                  <RoleList
                    roles={implementationRoles}
                    texts={byRole}
                    members={members}
                    canAssign={canAssign}
                    onAssign={open}
                  />
                </Section>
                <Section id="team-members" title={t("team.members.title")}>
                  <MembersTable members={members} canAssign={canAssign} onAssign={() => open("")} />
                </Section>
                {assigning ? (
                  <AssignDialog
                    roleCode={assigning.roleCode}
                    texts={byRole}
                    onClose={() => setAssigning(null)}
                    onDone={(roleCode) => {
                      setAssigning(null);
                      setDone(t("team.assign.done", { role: roleName(t, roleCode) }));
                    }}
                  />
                ) : null}
              </>
            );
          }}
        </QueryState>
      )}
    </QueryState>
  );
}

type T = ReturnType<typeof useTranslation>["t"];
const roleName = (t: T, code: string) => t(`transformations.audit.role.${code}`, { defaultValue: code });

/** A role's accountability in the current language, with its provenance (source text or platform text). */
function Accountability({ text, roleCode }: { text: RoleAccountability | undefined | null; roleCode: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (!text) return <Unknown />;
  return (
    <span className="accountability" data-accountability={roleCode} data-source-text={text.isSourceText}>
      <span className="accountability__text">{locale === "ar" ? text.accountabilityAr : text.accountabilityEn}</span>{" "}
      <span className="accountability__source small muted">
        {text.isSourceText
          ? t("team.sourceText", { ref: text.sourceRef })
          : t("team.platformText", { ref: text.sourceRef })}
      </span>
    </span>
  );
}

/** Name of a team member: display name where readable, else their team role(s) and a short reference. */
function useMemberName(): (userId: string) => string {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { nameOf, byId } = usePeople(ws.tid);
  return (userId) => {
    const name = nameOf(userId) ?? byId.get(userId)?.label ?? t("common.value.unknown");
    return userId === ws.meId ? `${name} · ${t("common.people.me")}` : name;
  };
}

function ScopeLabel({ member }: { member: TeamAssignment }) {
  const { t } = useTranslation();
  return member.inherited ? (
    <span data-scope="inherited">
      {t("team.scope.inherited", { scope: t(`admin.scopeType.${member.assignment.scope.type}`) })}
    </span>
  ) : (
    <span data-scope="here">{t("team.scope.here")}</span>
  );
}

function RoleList({
  roles,
  texts,
  members,
  canAssign,
  onAssign,
}: {
  roles: readonly string[];
  texts: ReadonlyMap<string, RoleAccountability>;
  members: readonly TeamAssignment[];
  canAssign: boolean;
  onAssign: (roleCode: string) => void;
}) {
  const { t } = useTranslation();
  const nameOf = useMemberName();
  return (
    <ul className="role-list plain-list">
      {roles.map((code) => {
        const holders = members.filter((m) => m.assignment.roleCode === code);
        const name = roleName(t, code);
        return (
          <li key={code} className="role-card" data-role={code}>
            <div className="role-card__header">
              <h3 id={`role-${code}`} className="role-card__title">
                {name}
              </h3>
              {canAssign && ASSIGNABLE.includes(code) ? (
                <button type="button" className="button button--secondary button--small" onClick={() => onAssign(code)}>
                  <Icon name="plus" /> {t("team.assign.action")}
                  <span className="visually-hidden">: {name}</span>
                </button>
              ) : null}
            </div>
            <dl className="details role-card__facts">
              <div>
                <dt>{t("team.accountability")}</dt>
                <dd>
                  <Accountability text={texts.get(code)} roleCode={code} />
                </dd>
              </div>
              <div>
                <dt>{t("team.assigned")}</dt>
                <dd data-holders={code}>
                  {holders.length === 0 ? (
                    <span className="role-card__unassigned" data-state="unassigned">
                      <Icon name="alert" /> {t("team.unassigned")}
                    </span>
                  ) : (
                    <ul className="plain-list">
                      {holders.map((m) => (
                        <li key={m.assignment.id} data-assignment={m.assignment.id}>
                          {nameOf(m.assignment.userId)}{" "}
                          <span className="small muted">
                            (<ScopeLabel member={m} />)
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            </dl>
            {canAssign && !ASSIGNABLE.includes(code) ? (
              <p className="small muted role-card__note">{t("team.adminOnly")}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function MembersTable({
  members,
  canAssign,
  onAssign,
}: {
  members: readonly TeamAssignment[];
  canAssign: boolean;
  onAssign: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const nameOf = useMemberName();
  const zone = ws.tr.timezone;
  const columns: RegisterColumn<TeamAssignment>[] = [
    {
      id: "person",
      header: t("team.members.person"),
      cell: (m) => nameOf(m.assignment.userId),
      sortValue: (m) => nameOf(m.assignment.userId),
      hideable: false,
      rowHeader: true,
    },
    {
      id: "role",
      header: t("team.members.role"),
      cell: (m) => roleName(t, m.assignment.roleCode),
      sortValue: (m) => roleName(t, m.assignment.roleCode),
      hideable: false,
    },
    {
      id: "accountability",
      header: t("team.accountability"),
      cell: (m) => <Accountability text={m.accountability} roleCode={m.assignment.roleCode} />,
      filterText: (m) =>
        m.accountability
          ? locale === "ar"
            ? m.accountability.accountabilityAr
            : m.accountability.accountabilityEn
          : null,
    },
    {
      id: "scope",
      header: t("team.members.scope"),
      cell: (m) => <ScopeLabel member={m} />,
      sortValue: (m) => (m.inherited ? 1 : 0),
      filterText: (m) =>
        m.inherited
          ? t("team.scope.inherited", { scope: t(`admin.scopeType.${m.assignment.scope.type}`) })
          : t("team.scope.here"),
    },
    {
      id: "from",
      header: t("team.members.from"),
      cell: (m) => formatDateTime(m.assignment.effectiveFrom, locale, zone) ?? <Unknown />,
      sortValue: (m) => m.assignment.effectiveFrom,
    },
    {
      id: "to",
      header: t("team.members.to"),
      cell: (m) =>
        m.assignment.effectiveTo ? (
          formatDateTime(m.assignment.effectiveTo, locale, zone)
        ) : (
          <span className="muted">{t("team.members.noEnd")}</span>
        ),
      sortValue: (m) => m.assignment.effectiveTo,
    },
  ];
  return (
    <RegisterTable
      id="team-members"
      caption={t("team.members.caption")}
      rows={members}
      columns={columns}
      getRowId={(m) => m.assignment.id}
      emptyTitle={t("team.members.empty")}
      defaultSort={{ id: "role", dir: "asc" }}
      toolbar={
        canAssign ? (
          <button type="button" className="button button--primary" onClick={onAssign}>
            <Icon name="plus" /> {t("team.assign.action")}
          </button>
        ) : null
      }
    />
  );
}

/**
 * Assign a non-approver team role. Candidates: the organization's active users where the caller may read the user
 * directory, otherwise the people already on this team; never the caller (the server refuses a self-grant anyway).
 */
function AssignDialog({
  roleCode,
  texts,
  onClose,
  onDone,
}: {
  roleCode: string;
  texts: ReadonlyMap<string, RoleAccountability>;
  onClose: () => void;
  onDone: (roleCode: string) => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const me = useMe();
  const refresh = useP2Refresh(ws.tid);
  const readsDirectory = canAnywhere(me, "user.read");
  const users = useAllUsers(me.organization.id, readsDirectory);
  const team = usePeople(ws.tid);
  const [selectedRole, setSelectedRole] = useState(roleCode);

  const candidates: Person[] = [];
  const seen = new Set<string>([ws.meId]);
  for (const u of users.data ?? []) {
    if (u.status !== "active" || seen.has(u.id)) continue;
    seen.add(u.id);
    candidates.push({ id: u.id, label: u.displayName });
  }
  for (const p of team.people) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    candidates.push(p);
  }

  const fields: FieldSpec[] = [
    {
      name: "userId",
      kind: "person",
      label: t("team.assign.person"),
      hint: readsDirectory ? t("team.assign.personHintDirectory") : t("team.assign.personHintTeam"),
      required: true,
    },
    {
      name: "roleCode",
      kind: "select",
      label: t("team.assign.role"),
      hint: t("team.assign.roleHint"),
      required: true,
      options: ASSIGNABLE.map((r) => ({ value: r, label: roleName(t, r) })),
    },
    {
      name: "reason",
      kind: "textarea",
      label: t("team.assign.reason"),
      hint: t("team.assign.reasonHint"),
      required: true,
      maxLength: 1000,
    },
  ];

  return (
    <RecordDialog
      title={t("team.assign.title")}
      fields={fields}
      record={null}
      defaults={{ roleCode }}
      createSchema={teamAssignmentCreate}
      createUrl={`/api/v1/transformations/${ws.tid}/scoped-assignments`}
      people={candidates}
      submitLabel={t("team.assign.submit")}
      onValuesChange={(v) => setSelectedRole(typeof v["roleCode"] === "string" ? v["roleCode"] : "")}
      onCancel={onClose}
      onSaved={async (saved) => {
        await refresh();
        onDone((saved as { roleCode: string }).roleCode);
      }}
    >
      {selectedRole ? (
        <div className="banner banner--info" data-preview-role={selectedRole}>
          <p className="small">
            <strong>{t("team.assign.preview")}</strong>
          </p>
          <p>
            <Accountability text={texts.get(selectedRole)} roleCode={selectedRole} />
          </p>
        </div>
      ) : null}
    </RecordDialog>
  );
}
