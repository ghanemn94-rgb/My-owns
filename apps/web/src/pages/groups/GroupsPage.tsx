// Governance > Groups (T-DG4-FE-A; ADR-0026 §1; REQ-S16-011, REQ-S10-008 display side). SYNTHETIC data only.
//  - A group (e.g. a SteerCo) is a ROUTING target for approvals and tasks. Membership grants no permission: access
//    still comes only from role assignments, and a group can receive a business approval only when at least one current
//    member holds the approval right (otherwise 422 routing.assignee_not_approver at routing time).
//  - group.manage holders create, edit, archive and change members; anyone who can read the organization sees the
//    groups read-only. Member windows are wall-clock times in the user's time zone, sent as UTC instants.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { DEFAULTS } from "@mth/shared";
import {
  p4Keys,
  p4Paths,
  useGroup,
  useGroupMembers,
  useGroups,
  useP4KeyRefresh,
  type Group,
  type GroupMember,
} from "../../api/p4.ts";
import { useAllUsers } from "../../api/queries.ts";
import { localName, useForwardArrow, useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { NoPermissionState, QueryState } from "../../components/States.tsx";
import { formatDateTime, zonedLocalToUtcIso } from "../../lib/format.ts";
import { isNoPermission } from "../../lib/problem.ts";
import { P4FormDialog, ReadOnlyNote, textOf, useUserNames, type P4Values } from "../my-work/p4ui.tsx";

const NS = ["groups"] as const;

/** People of the organization for pickers: every active user where readable, otherwise only the signed-in user. */
function useOrgPeople(): { id: string; label: string }[] {
  const me = useMe();
  const canRead = canAnywhere(me, "user.read");
  const users = useAllUsers(me.user.organizationId, canRead);
  if (!canRead) return [{ id: me.user.id, label: me.user.displayName }];
  return (users.data ?? []).filter((u) => u.status === "active").map((u) => ({ id: u.id, label: u.displayName }));
}

export function GroupsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  usePageTitle(t("groups.title"));
  const groups = useGroups(me.user.organizationId);
  const canManage = canAnywhere(me, "group.manage");
  const refresh = useP4KeyRefresh();
  const [creating, setCreating] = useState(false);
  const people = useOrgPeople();
  const nameOf = useUserNames((groups.data ?? []).map((g) => g.ownerUserId));
  if (groups.isError && isNoPermission(groups.error))
    return (
      <div className="page">
        <NoPermissionState error={groups.error} />
      </div>
    );
  const columns: RegisterColumn<Group>[] = [
    {
      id: "name",
      header: t("groups.field.name"),
      rowHeader: true,
      hideable: false,
      cell: (g) => (
        <Link className="link" to={`/governance/groups/${g.id}`} data-group={g.code}>
          {localName(g, locale)}
        </Link>
      ),
      sortValue: (g) => localName(g, locale),
    },
    {
      id: "code",
      header: t("groups.field.code"),
      cell: (g) => (
        <bdi dir="ltr" className="code">
          {g.code}
        </bdi>
      ),
      sortValue: (g) => g.code,
    },
    { id: "owner", header: t("groups.field.owner"), cell: (g) => nameOf(g.ownerUserId) },
    { id: "members", header: t("groups.field.members"), cell: (g) => g.memberCount, sortValue: (g) => g.memberCount },
    {
      id: "status",
      header: t("groups.field.status"),
      cell: (g) => t(`groups.status.${g.status}`),
      sortValue: (g) => g.status,
    },
  ];
  return (
    <div className="page" data-page="groups">
      <PageHeader
        crumbs={[{ label: t("nav.areas.governance.label"), to: "/governance" }, { label: t("groups.title") }]}
        title={t("groups.title")}
        subtitle={t("groups.intro")}
      />
      <p className="banner banner--info" role="note">
        <Icon name="info" /> {t("groups.noPermissionNote")}
      </p>
      {canManage ? null : <ReadOnlyNote body={t("groups.readOnly")} />}
      <Section
        id="groups"
        title={t("groups.list.title")}
        actions={
          canManage ? (
            <button type="button" className="button button--primary button--small" onClick={() => setCreating(true)}>
              <Icon name="plus" /> {t("groups.create.action")}
            </button>
          ) : null
        }
      >
        <QueryState query={groups}>
          {(rows) => (
            <RegisterTable
              id="p4-groups"
              caption={t("groups.list.title")}
              rows={rows}
              columns={columns}
              getRowId={(g) => g.id}
              emptyTitle={t("groups.list.empty")}
              emptyBody={t("groups.list.emptyBody")}
              defaultSort={{ id: "name", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
      {creating ? (
        <P4FormDialog
          title={t("groups.create.title")}
          fields={[
            {
              name: "code",
              label: t("groups.field.code"),
              kind: "text",
              required: true,
              max: 32,
              ltr: true,
              hint: t("groups.create.codeHint"),
            },
            { name: "nameEn", label: t("groups.field.nameEn"), kind: "text", required: true, max: 200 },
            { name: "nameAr", label: t("groups.field.nameAr"), kind: "text", required: true, max: 200 },
            { name: "description", label: t("groups.field.description"), kind: "textarea", max: 2000 },
            {
              name: "ownerUserId",
              label: t("groups.field.owner"),
              kind: "select",
              required: true,
              options: people.map((p) => ({ value: p.id, label: p.label })),
            },
          ]}
          initial={{ ownerUserId: me.user.id }}
          submitLabel={t("groups.create.submit")}
          url={p4Paths.orgGroups(me.user.organizationId)}
          toBody={(v) => {
            const description = textOf(v["description"]);
            return {
              code: String(v["code"]).trim(),
              nameEn: textOf(v["nameEn"]),
              nameAr: textOf(v["nameAr"]),
              ...(description ? { description } : {}),
              ownerUserId: v["ownerUserId"],
            };
          }}
          namespaces={NS}
          onDone={() => refresh(p4Keys.groups(me.user.organizationId))}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ one group

export function GroupDetailPage() {
  const { t } = useTranslation();
  const { groupId = "" } = useParams();
  const group = useGroup(groupId);
  usePageTitle(t("groups.detailTitle"));
  if (group.isError && isNoPermission(group.error))
    return (
      <div className="page">
        <NoPermissionState error={group.error} />
      </div>
    );
  return (
    <div className="page" data-page="group-detail">
      <QueryState query={group}>{(g) => <GroupDetail group={g} />}</QueryState>
    </div>
  );
}

function GroupDetail({ group: g }: { group: Group }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const arrow = useForwardArrow();
  const me = useMe();
  const members = useGroupMembers(g.id);
  const canManage = canAnywhere(me, "group.manage") && g.status === "active";
  const refresh = useP4KeyRefresh();
  const refreshGroup = async () => {
    const a = await refresh(p4Keys.group(g.id));
    const b = await refresh(p4Keys.groups(me.user.organizationId));
    return a && b;
  };
  const people = useOrgPeople();
  const nameOf = useUserNames([g.ownerUserId, ...(members.data ?? []).map((m) => m.removedBy)]);
  const tz = me.user.timezone ?? me.organization.defaultTimezone ?? DEFAULTS.timezone;
  const [dialog, setDialog] = useState<"edit" | "add" | GroupMember | null>(null);
  const columns: RegisterColumn<GroupMember>[] = [
    {
      id: "member",
      header: t("groups.member.person"),
      rowHeader: true,
      hideable: false,
      cell: (m) => m.displayName,
      sortValue: (m) => m.displayName,
    },
    {
      id: "window",
      header: t("groups.member.window"),
      cell: (m) => (
        <span>
          {formatDateTime(m.effectiveFrom, locale, tz)} {arrow}{" "}
          {m.effectiveTo ? formatDateTime(m.effectiveTo, locale, tz) : t("groups.member.open")}
        </span>
      ),
      sortValue: (m) => m.effectiveFrom,
    },
    {
      id: "state",
      header: t("groups.field.status"),
      cell: (m) =>
        m.removedAt ? (
          <span className="block">
            <span className="lifecycle-chip lifecycle-chip--draft">
              <Icon name="stop" /> {t("groups.member.removed")}
            </span>
            <span className="block small muted">
              {nameOf(m.removedBy)} · <TextCell value={m.removeReason} />
            </span>
          </span>
        ) : (
          <span className="lifecycle-chip">
            <Icon name="check" /> {t("groups.member.current")}
          </span>
        ),
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (m) =>
        canManage && !m.removedAt ? (
          <button
            type="button"
            className="button button--link button--small"
            data-action="remove-member"
            onClick={() => setDialog(m)}
          >
            <Icon name="stop" /> {t("groups.member.remove")}
            <span className="visually-hidden">: {m.displayName}</span>
          </button>
        ) : (
          <span className="muted small">{t("common.readOnly")}</span>
        ),
    },
  ];
  return (
    <>
      <PageHeader
        crumbs={[
          { label: t("nav.areas.governance.label"), to: "/governance" },
          { label: t("groups.title"), to: "/governance/groups" },
          { label: localName(g, locale) ?? g.code },
        ]}
        title={localName(g, locale) ?? g.code}
        subtitle={t("groups.noPermissionNote")}
      />
      <section className="card" aria-labelledby="group-summary">
        <h2 id="group-summary" className="card__title">
          <bdi dir="ltr" className="code">
            {g.code}
          </bdi>{" "}
          <span className={`lifecycle-chip${g.status === "active" ? "" : " lifecycle-chip--draft"}`}>
            {t(`groups.status.${g.status}`)}
          </span>
        </h2>
        <dl className="details">
          <div>
            <dt>{t("groups.field.owner")}</dt>
            <dd>{nameOf(g.ownerUserId)}</dd>
          </div>
          <div>
            <dt>{t("groups.field.description")}</dt>
            <dd>
              <TextCell value={g.description} />
            </dd>
          </div>
          <div>
            <dt>{t("groups.field.members")}</dt>
            <dd>{g.memberCount}</dd>
          </div>
        </dl>
        {canAnywhere(me, "group.manage") ? (
          <div className="form__actions">
            <button
              type="button"
              className="button button--secondary"
              data-action="edit-group"
              onClick={() => setDialog("edit")}
            >
              <Icon name="pencil" /> {t("groups.edit.action")}
            </button>
          </div>
        ) : null}
      </section>
      <Section
        id="members"
        title={t("groups.member.title")}
        intro={t("groups.member.intro")}
        actions={
          canManage ? (
            <button type="button" className="button button--primary button--small" onClick={() => setDialog("add")}>
              <Icon name="plus" /> {t("groups.member.add")}
            </button>
          ) : null
        }
      >
        <QueryState query={members}>
          {(rows) => (
            <RegisterTable
              id="p4-group-members"
              caption={t("groups.member.title")}
              rows={rows}
              columns={columns}
              getRowId={(m) => m.id}
              emptyTitle={t("groups.member.empty")}
            />
          )}
        </QueryState>
      </Section>
      {dialog === "edit" ? (
        <P4FormDialog
          title={t("groups.edit.title")}
          fields={[
            { name: "nameEn", label: t("groups.field.nameEn"), kind: "text", required: true, max: 200 },
            { name: "nameAr", label: t("groups.field.nameAr"), kind: "text", required: true, max: 200 },
            { name: "description", label: t("groups.field.description"), kind: "textarea", max: 2000 },
            {
              name: "ownerUserId",
              label: t("groups.field.owner"),
              kind: "select",
              required: true,
              options: [
                ...people.map((p) => ({ value: p.id, label: p.label })),
                ...(people.some((p) => p.id === g.ownerUserId)
                  ? []
                  : [{ value: g.ownerUserId, label: nameOf(g.ownerUserId) }]),
              ],
            },
            {
              name: "status",
              label: t("groups.field.status"),
              kind: "select",
              required: true,
              options: ["active", "archived"].map((s) => ({ value: s, label: t(`groups.status.${s}`) })),
            },
          ]}
          initial={{
            nameEn: g.nameEn,
            nameAr: g.nameAr,
            description: g.description ?? "",
            ownerUserId: g.ownerUserId,
            status: g.status,
          }}
          submitLabel={t("common.action.save")}
          method="PATCH"
          url={p4Paths.group(g.id)}
          version={g.version}
          toBody={(v: P4Values) => {
            const body: Record<string, unknown> = {};
            if (v["nameEn"] !== g.nameEn) body["nameEn"] = textOf(v["nameEn"]);
            if (v["nameAr"] !== g.nameAr) body["nameAr"] = textOf(v["nameAr"]);
            const description = textOf(v["description"]) ?? null;
            if (description !== g.description) body["description"] = description;
            if (v["ownerUserId"] !== g.ownerUserId) body["ownerUserId"] = v["ownerUserId"];
            if (v["status"] !== g.status) body["status"] = v["status"];
            if (Object.keys(body).length === 0) return { fieldErrors: { nameEn: "validation.empty_update" } };
            return body;
          }}
          namespaces={NS}
          onDone={refreshGroup}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "add" ? (
        <P4FormDialog
          title={t("groups.member.add")}
          description={<p>{t("groups.member.addDescription", { tz })}</p>}
          fields={[
            {
              name: "userId",
              label: t("groups.member.person"),
              kind: "select",
              required: true,
              options: people.map((p) => ({ value: p.id, label: p.label })),
            },
            {
              name: "effectiveFrom",
              label: t("groups.member.from"),
              kind: "datetime",
              hint: t("groups.member.fromHint"),
            },
            { name: "effectiveTo", label: t("groups.member.to"), kind: "datetime", hint: t("groups.member.toHint") },
          ]}
          submitLabel={t("groups.member.add")}
          url={p4Paths.groupMembers(g.id)}
          toBody={(v) => {
            const from = v["effectiveFrom"] ? zonedLocalToUtcIso(String(v["effectiveFrom"]), tz) : undefined;
            const to = v["effectiveTo"] ? zonedLocalToUtcIso(String(v["effectiveTo"]), tz) : undefined;
            if (from === null) return { fieldErrors: { effectiveFrom: "validation.date" } };
            if (to === null) return { fieldErrors: { effectiveTo: "validation.date" } };
            return {
              userId: v["userId"],
              ...(from ? { effectiveFrom: from } : {}),
              ...(to ? { effectiveTo: to } : {}),
            };
          }}
          namespaces={NS}
          onDone={refreshGroup}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog && typeof dialog === "object" ? (
        <P4FormDialog
          title={t("groups.member.removeTitle", { name: dialog.displayName })}
          fields={[
            { name: "reason", label: t("groups.member.reason"), kind: "textarea", required: true, min: 3, max: 1000 },
          ]}
          submitLabel={t("groups.member.remove")}
          danger
          url={p4Paths.removeGroupMember(g.id, dialog.id)}
          version={dialog.version}
          toBody={(v) => ({ reason: textOf(v["reason"]) })}
          namespaces={NS}
          onDone={refreshGroup}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
