// My Work > Delegations (T-DG4-FE-A; ADR-0026 §3; REQ-S10-010). SYNTHETIC data only in tests and demos.
//  - A delegation lets the delegate act on the delegator's behalf for P4 business approvals, within effective dates.
//    Capability is evaluated by the server at use time (now within [from, to)); the status shown here is the displayed
//    one, which the expiry sweep updates. The audit shows "B on behalf of A".
//  - Loops (A -> B while B -> A, directly or through others) are refused by the server (422 delegation.loop,
//    translated); so are self-delegation and windows over 366 days.
//  - Anyone with delegation.create_own records their own delegation; an access administrator (delegation.manage)
//    records one for another person only on that person's request, with the request as the reason.
//  - Dates are entered as wall-clock times in the user's time zone (default Asia/Riyadh) and sent as UTC instants.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULTS } from "@mth/shared";
import { p4Paths, useDelegations, useP4Refresh, type Delegation } from "../../api/p4.ts";
import { useAllUsers, useTransformations } from "../../api/queries.ts";
import { useForwardArrow, useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { formatDateTime, zonedLocalToUtcIso } from "../../lib/format.ts";
import { P4FormDialog, ReadOnlyNote, textOf, useUserNames, type P4Values } from "../my-work/p4ui.tsx";

const NS = ["delegations"] as const;

export function DelegationsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const arrow = useForwardArrow();
  const me = useMe();
  usePageTitle(t("delegations.title"));
  const [role, setRole] = useState<"any" | "delegator" | "delegate">("any");
  const [status, setStatus] = useState("");
  const list = useDelegations({ role, ...(status ? { status } : {}) });
  const refresh = useP4Refresh();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Delegation | null>(null);
  const canCreateOwn = canAnywhere(me, "delegation.create_own");
  const canManage = canAnywhere(me, "delegation.manage");
  const tz = me.user.timezone ?? me.organization.defaultTimezone ?? DEFAULTS.timezone;
  const nameOf = useUserNames((list.data ?? []).flatMap((d) => [d.delegatorUserId, d.delegateUserId]));

  const columns: RegisterColumn<Delegation>[] = [
    {
      id: "delegator",
      header: t("delegations.field.delegator"),
      rowHeader: true,
      hideable: false,
      cell: (d) => nameOf(d.delegatorUserId),
      sortValue: (d) => nameOf(d.delegatorUserId),
    },
    {
      id: "delegate",
      header: t("delegations.field.delegate"),
      cell: (d) => nameOf(d.delegateUserId),
      sortValue: (d) => nameOf(d.delegateUserId),
    },
    {
      id: "window",
      header: t("delegations.field.window"),
      cell: (d) => (
        <span className="block">
          {formatDateTime(d.effectiveFrom, locale, tz)}
          <span className="block small">
            {arrow} {formatDateTime(d.effectiveTo, locale, tz)}
          </span>
        </span>
      ),
      sortValue: (d) => d.effectiveFrom,
    },
    {
      id: "scope",
      header: t("delegations.field.scope"),
      cell: (d) =>
        d.scopeType ? t(`delegations.scope.${d.scopeType}`, { defaultValue: d.scopeType }) : t("delegations.scope.all"),
    },
    {
      id: "reason",
      header: t("delegations.field.reason"),
      cell: (d) => (
        <span className="block">
          {t(`delegations.reasonCode.${d.reasonCode}`)}
          {d.reasonText ? (
            <span className="block small">
              <TextCell value={d.reasonText} />
            </span>
          ) : null}
          {d.absenceNote ? (
            <span className="block small muted">
              {t("delegations.field.absenceNote")}: <TextCell value={d.absenceNote} />
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "status",
      header: t("delegations.field.status"),
      cell: (d) => (
        <span className="block">
          <span
            className={`lifecycle-chip${d.status === "active" ? "" : " lifecycle-chip--draft"}`}
            data-status={d.status}
          >
            <Icon name={d.status === "active" ? "check" : d.status === "revoked" ? "stop" : "clock"} />{" "}
            {t(`delegations.status.${d.status}`)}
          </span>
          {d.revokeReason ? (
            <span className="block small muted">
              {t("delegations.field.revokeReason")}: <TextCell value={d.revokeReason} />
            </span>
          ) : null}
        </span>
      ),
      sortValue: (d) => d.status,
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (d) =>
        d.status === "active" && (d.delegatorUserId === me.user.id || canManage) ? (
          <button
            type="button"
            className="button button--link button--small"
            data-action="revoke"
            onClick={() => setRevoking(d)}
          >
            <Icon name="stop" /> {t("delegations.revoke.action")}
            <span className="visually-hidden">: {nameOf(d.delegateUserId)}</span>
          </button>
        ) : (
          <span className="muted small">{t("common.readOnly")}</span>
        ),
    },
  ];

  return (
    <div className="page" data-page="delegations">
      <PageHeader
        crumbs={[{ label: t("nav.areas.myWork.label"), to: "/my-work" }, { label: t("delegations.title") }]}
        title={t("delegations.title")}
        subtitle={t("delegations.intro")}
      />
      <p className="banner banner--info" role="note">
        <Icon name="info" /> {t("delegations.howItWorks", { tz })}
      </p>
      {!canCreateOwn && !canManage ? <ReadOnlyNote body={t("delegations.readOnly")} /> : null}
      <Section
        id="delegations"
        title={t("delegations.list.title")}
        actions={
          <span className="p4-chips">
            <label className="p4-inline-field">
              <span>{t("delegations.list.role")}</span>
              <select value={role} data-filter="role" onChange={(e) => setRole(e.target.value as typeof role)}>
                {(["any", "delegator", "delegate"] as const).map((r) => (
                  <option key={r} value={r}>
                    {t(`delegations.list.roleValue.${r}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="p4-inline-field">
              <span>{t("delegations.field.status")}</span>
              <select value={status} data-filter="status" onChange={(e) => setStatus(e.target.value)}>
                <option value="">{t("delegations.list.anyStatus")}</option>
                {["active", "revoked", "expired"].map((s) => (
                  <option key={s} value={s}>
                    {t(`delegations.status.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            {canCreateOwn || canManage ? (
              <button type="button" className="button button--primary button--small" onClick={() => setCreating(true)}>
                <Icon name="plus" /> {t("delegations.create.action")}
              </button>
            ) : null}
          </span>
        }
      >
        <QueryState query={list}>
          {(rows) => (
            <RegisterTable
              id="p4-delegations"
              caption={t("delegations.list.title")}
              rows={rows}
              columns={columns}
              getRowId={(d) => d.id}
              emptyTitle={t("delegations.list.empty")}
              emptyBody={t("delegations.list.emptyBody")}
              defaultSort={{ id: "window", dir: "desc" }}
            />
          )}
        </QueryState>
      </Section>
      {creating ? (
        <CreateDelegationDialog tz={tz} canManage={canManage} onDone={refresh} onClose={() => setCreating(false)} />
      ) : null}
      {revoking ? (
        <P4FormDialog
          title={t("delegations.revoke.title")}
          description={<p>{t("delegations.revoke.description", { delegate: nameOf(revoking.delegateUserId) })}</p>}
          fields={[
            {
              name: "reason",
              label: t("delegations.revoke.reason"),
              kind: "textarea",
              required: true,
              min: 3,
              max: 1000,
            },
          ]}
          submitLabel={t("delegations.revoke.action")}
          danger
          url={p4Paths.revokeDelegation(revoking.id)}
          version={revoking.version}
          toBody={(v) => ({ reason: textOf(v["reason"]) })}
          namespaces={NS}
          onDone={refresh}
          onClose={() => setRevoking(null)}
        />
      ) : null}
    </div>
  );
}

function CreateDelegationDialog({
  tz,
  canManage,
  onDone,
  onClose,
}: {
  tz: string;
  canManage: boolean;
  onDone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const [tid, setTid] = useState("");
  const canReadUsers = canAnywhere(me, "user.read");
  const allUsers = useAllUsers(me.user.organizationId, canReadUsers);
  const transformations = useTransformations({ sort: "updatedAt:desc", limit: 50 });
  const team = usePeople(tid);
  const people = canReadUsers
    ? (allUsers.data ?? []).filter((u) => u.status === "active").map((u) => ({ id: u.id, label: u.displayName }))
    : tid
      ? team.people
      : [];
  const candidates = people.filter((p) => p.id !== me.user.id);
  return (
    <P4FormDialog
      title={t("delegations.create.title")}
      description={<p>{t("delegations.create.description", { tz })}</p>}
      onValuesChange={(v) => setTid(typeof v["transformationId"] === "string" ? v["transformationId"] : "")}
      fields={[
        ...(canManage && canReadUsers
          ? [
              {
                name: "delegatorUserId",
                label: t("delegations.field.delegatorOnRequest"),
                kind: "select" as const,
                hint: t("delegations.create.delegatorHint"),
                options: people.map((p) => ({ value: p.id, label: p.label })),
              },
            ]
          : []),
        {
          name: "transformationId",
          label: t("delegations.field.transformation"),
          kind: "select",
          required: !canReadUsers,
          hint: t(canReadUsers ? "delegations.create.scopeHint" : "delegations.create.teamHint"),
          options: (transformations.data?.items ?? []).map((tr) => ({ value: tr.id, label: `${tr.code} ${tr.name}` })),
        },
        {
          name: "limitToTransformation",
          label: t("delegations.create.limitToTransformation"),
          kind: "checkbox",
          when: (v) => typeof v["transformationId"] === "string" && v["transformationId"] !== "",
        },
        {
          name: "delegateUserId",
          label: t("delegations.field.delegate"),
          kind: "select",
          required: true,
          options: candidates.map((p) => ({ value: p.id, label: p.label })),
        },
        { name: "effectiveFrom", label: t("delegations.field.from"), kind: "datetime", required: true },
        { name: "effectiveTo", label: t("delegations.field.to"), kind: "datetime", required: true },
        {
          name: "reasonCode",
          label: t("delegations.field.reason"),
          kind: "select",
          required: true,
          options: ["absence", "other"].map((r) => ({ value: r, label: t(`delegations.reasonCode.${r}`) })),
        },
        {
          name: "reasonText",
          label: t("delegations.field.reasonText"),
          kind: "textarea",
          max: 1000,
          hint: t("delegations.create.reasonTextHint"),
        },
        {
          name: "absenceNote",
          label: t("delegations.field.absenceNote"),
          kind: "textarea",
          max: 1000,
          when: (v) => v["reasonCode"] === "absence",
        },
      ]}
      initial={{ reasonCode: "absence" }}
      submitLabel={t("delegations.create.submit")}
      url={p4Paths.delegations}
      toBody={(v: P4Values) => {
        const from = zonedLocalToUtcIso(String(v["effectiveFrom"] ?? ""), tz);
        const to = zonedLocalToUtcIso(String(v["effectiveTo"] ?? ""), tz);
        const errors: Record<string, string> = {};
        if (!from) errors["effectiveFrom"] = "validation.date";
        if (!to) errors["effectiveTo"] = "validation.date";
        const delegator = typeof v["delegatorUserId"] === "string" ? v["delegatorUserId"] : "";
        const reasonText = textOf(v["reasonText"]);
        if (delegator && delegator !== me.user.id && !reasonText) errors["reasonText"] = "validation.required";
        if (Object.keys(errors).length > 0) return { fieldErrors: errors };
        const absenceNote = v["reasonCode"] === "absence" ? textOf(v["absenceNote"]) : undefined;
        const scoped =
          v["limitToTransformation"] === true && typeof v["transformationId"] === "string" && v["transformationId"];
        return {
          ...(delegator && delegator !== me.user.id ? { delegatorUserId: delegator } : {}),
          delegateUserId: v["delegateUserId"],
          ...(scoped ? { scopeType: "transformation", scopeId: v["transformationId"] } : {}),
          reasonCode: v["reasonCode"],
          ...(reasonText ? { reasonText } : {}),
          ...(absenceNote ? { absenceNote } : {}),
          effectiveFrom: from,
          effectiveTo: to,
        };
      }}
      namespaces={NS}
      onDone={onDone}
      onClose={onClose}
    />
  );
}
