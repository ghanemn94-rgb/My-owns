// My Work > Approvals (T-DG4-FE-A; ADR-0026 §3-§6; REQ-S10-008, S10-010, S10-014, S10-016, S10-017, S10-018,
// S10-019 display side). SYNTHETIC data only in tests and demos.
//  - A P4 approval is a BUSINESS APPROVAL inside the product (never an engineering delivery gate). The software never
//    decides: a timer only escalates (REQ-S10-019) and the escalation is shown with its level and target.
//  - Four distinct outcomes: approve, reject, request changes (stays open for a resubmission), defer (asks for a new
//    date after today). A rationale is always required (blank text is refused here and by the server).
//  - The decision carries the record version the approver saw (`subjectVersion`). When the record moved on, the server
//    answers 409 approval.stale_version: the dialog says the record changed, nothing was recorded, and links to the
//    record and its decision history.
//  - "On behalf of": offered only when the caller is an active delegate of someone (GET /delegations?role=delegate);
//    the server re-checks the delegation and the delegator's own right at decision time. History shows "B on behalf of A".
//  - Due dates that are null are Unknown with their reason, never a guessed date.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { ApiError, api } from "../../api/client.ts";
import {
  p4Paths,
  useApproval,
  useDelegations,
  useGovernanceMatrices,
  useMyApprovals,
  useP4Refresh,
  type Approval,
} from "../../api/p4.ts";
import { shouldRetry } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { NoPermissionState, QueryState } from "../../components/States.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { isNoPermission } from "../../lib/problem.ts";
import { BusinessApprovalNote, DueDate, P4FormDialog, textOf, useUserNames, type P4Values } from "../my-work/p4ui.tsx";

const NS = ["approvals"] as const;
export const OPEN_STATUSES: ReadonlySet<string> = new Set(["pending", "deferred"]);

/** A status chip with an icon and a text label (never colour alone). */
export function ApprovalStatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  const icon =
    status === "approved"
      ? "check"
      : status === "rejected"
        ? "cross"
        : status === "withdrawn"
          ? "stop"
          : status === "deferred"
            ? "pause"
            : status === "changes_requested"
              ? "pencil"
              : "clock";
  return (
    <span
      className={`lifecycle-chip${OPEN_STATUSES.has(status) || status === "changes_requested" ? " lifecycle-chip--draft" : ""}`}
      data-approval-status={status}
    >
      <Icon name={icon} /> {t(`approvals.status.${status}`, { defaultValue: status })}
    </span>
  );
}

/** "Name" for a party: the person or group, or the governance role code when it is not resolved. */
function PartyCell({ party, nameOf }: { party: Approval["assignee"] | null; nameOf: (id: string) => string }) {
  const { t } = useTranslation();
  if (!party) return <span className="muted">{t("common.value.none")}</span>;
  return (
    <span className="block">
      <bdi dir="ltr" className="code">
        {party.partyCode}
      </bdi>{" "}
      {party.userId
        ? nameOf(party.userId)
        : party.groupId
          ? t("approvals.party.group")
          : t("approvals.party.unresolved")}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------ list

export function ApprovalsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  usePageTitle(t("approvals.title"));
  const [role, setRole] = useState<"assignee" | "requester">("assignee");
  const [status, setStatus] = useState("");
  const list = useMyApprovals({ role, ...(status ? { status } : {}) });
  const nameOf = useUserNames((list.data ?? []).flatMap((a) => [a.requestedBy, a.assignee.userId]));

  const columns: RegisterColumn<Approval>[] = [
    {
      id: "title",
      header: t("approvals.field.title"),
      rowHeader: true,
      hideable: false,
      cell: (a) => (
        <Link className="link" to={`/my-work/approvals/${a.id}`} data-approval={a.id}>
          {a.title}
        </Link>
      ),
      sortValue: (a) => a.title,
    },
    {
      id: "type",
      header: t("approvals.field.type"),
      cell: (a) => t(`approvals.type.${a.approvalType}`, { defaultValue: a.approvalType }),
      sortValue: (a) => a.approvalType,
    },
    {
      id: "status",
      header: t("approvals.field.status"),
      cell: (a) => <ApprovalStatusChip status={a.status} />,
      sortValue: (a) => a.status,
    },
    {
      id: "assignee",
      header: t("approvals.field.assignee"),
      cell: (a) => <PartyCell party={a.escalatedTo ?? a.assignee} nameOf={nameOf} />,
    },
    {
      id: "due",
      header: t("approvals.field.due"),
      cell: (a) => <DueDate date={a.dueDate} reason={a.dueUnknownReason} />,
      sortValue: (a) => a.dueDate,
    },
    {
      id: "escalation",
      header: t("approvals.field.escalation"),
      cell: (a) =>
        a.escalationLevel > 0 ? (
          <span className="status-chip status-chip--at-risk" data-escalation-level={a.escalationLevel}>
            <Icon name="alert" /> {t("approvals.escalation.level", { level: a.escalationLevel })}
          </span>
        ) : (
          <span className="muted">{t("approvals.escalation.none")}</span>
        ),
      sortValue: (a) => a.escalationLevel,
    },
    {
      id: "requested",
      header: t("approvals.field.requested"),
      cell: (a) => (
        <span className="block">
          {nameOf(a.requestedBy)}
          <span className="block small muted">{formatDateTime(a.requestedAt, locale)}</span>
        </span>
      ),
      sortValue: (a) => a.requestedAt,
    },
    {
      id: "round",
      header: t("approvals.field.round"),
      cell: (a) => a.roundNo,
      sortValue: (a) => a.roundNo,
    },
  ];

  return (
    <div className="page" data-page="approvals">
      <PageHeader
        crumbs={[{ label: t("nav.areas.myWork.label"), to: "/my-work" }, { label: t("approvals.title") }]}
        title={t("approvals.title")}
        subtitle={t("approvals.intro")}
      />
      <BusinessApprovalNote body={t("approvals.businessApprovalBody")} />
      <Section
        id="approvals"
        title={t(`approvals.list.${role}`)}
        actions={
          <span className="p4-chips">
            <label className="p4-inline-field">
              <span>{t("approvals.list.role")}</span>
              <select
                value={role}
                data-filter="role"
                onChange={(e) => setRole(e.target.value as "assignee" | "requester")}
              >
                <option value="assignee">{t("approvals.list.assignee")}</option>
                <option value="requester">{t("approvals.list.requester")}</option>
              </select>
            </label>
            <label className="p4-inline-field">
              <span>{t("approvals.field.status")}</span>
              <select value={status} data-filter="status" onChange={(e) => setStatus(e.target.value)}>
                <option value="">{t("approvals.list.anyStatus")}</option>
                {["pending", "changes_requested", "deferred", "approved", "rejected", "withdrawn"].map((s) => (
                  <option key={s} value={s}>
                    {t(`approvals.status.${s}`)}
                  </option>
                ))}
              </select>
            </label>
          </span>
        }
      >
        <QueryState query={list}>
          {(rows) => (
            <RegisterTable
              id="p4-approvals"
              caption={t(`approvals.list.${role}`)}
              rows={rows}
              columns={columns}
              getRowId={(a) => a.id}
              emptyTitle={t("approvals.list.empty")}
              emptyBody={t("approvals.list.emptyBody")}
              defaultSort={{ id: "due", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ detail

/** The record an approval is about, and where its history is (the subject page; the audit trail otherwise). */
function useSubjectLink(a: Approval | undefined): { to: string; version: number | null } | null {
  const tid = a?.transformationId ?? "";
  const matrices = useGovernanceMatrices(a?.subjectType === "governance_matrix" ? tid : "");
  const decision = useQuery({
    queryKey: ["p4", "approval-subject", "decision", a?.subjectId ?? ""],
    queryFn: () => api.get<{ id: string; version: number }>(`/api/v1/decisions/${a?.subjectId}`),
    enabled: a?.subjectType === "decision",
    retry: shouldRetry,
  });
  if (!a) return null;
  if (a.subjectType === "governance_matrix") {
    const m = (matrices.data ?? []).find((x) => x.id === a.subjectId);
    const page = m?.kind === "raci" ? "raci" : "decision-rights";
    return { to: `/transformations/${tid}/${page}`, version: m?.version ?? null };
  }
  if (a.subjectType === "decision")
    return { to: `/transformations/${tid}/decisions`, version: decision.data?.version ?? null };
  if (a.subjectType === "kpi_version") return { to: `/transformations/${tid}/kpis`, version: null };
  return { to: `/transformations/${tid}`, version: null };
}

export function ApprovalDetailPage() {
  const { t } = useTranslation();
  const { approvalId = "" } = useParams();
  const query = useApproval(approvalId);
  usePageTitle(query.data ? `${t("approvals.detailTitle")} · ${query.data.title}` : t("approvals.detailTitle"));
  if (query.isError && isNoPermission(query.error))
    return (
      <div className="page">
        <NoPermissionState error={query.error} />
      </div>
    );
  return (
    <div className="page" data-page="approval-detail">
      <QueryState query={query}>{(a) => <ApprovalDetail approval={a} />}</QueryState>
    </div>
  );
}

function ApprovalDetail({ approval: a }: { approval: Approval }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useP4Refresh(a.transformationId);
  const subject = useSubjectLink(a);
  const nameOf = useUserNames([
    a.requestedBy,
    a.assignee.userId,
    a.escalatedTo?.userId,
    a.decidedBy,
    a.decidedOnBehalfOf,
    ...a.decisions.flatMap((d) => [d.decidedBy, d.onBehalfOfUserId]),
    ...a.escalations.map((e) => e.toUserId),
  ]);
  const [dialog, setDialog] = useState<"decide" | "resubmit" | "withdraw" | null>(null);
  const isRequester = a.requestedBy === me.user.id;
  const open = OPEN_STATUSES.has(a.status);
  const canDecide = open && canAnywhere(me, "approval.decide") && !isRequester;
  const history = `/transformations/${a.transformationId}/approval-decisions`;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: t("nav.areas.myWork.label"), to: "/my-work" },
          { label: t("approvals.title"), to: "/my-work/approvals" },
          { label: a.title },
        ]}
        title={a.title}
        subtitle={t(`approvals.type.${a.approvalType}`, { defaultValue: a.approvalType })}
      />
      <BusinessApprovalNote body={t("approvals.businessApprovalBody")} />
      <section className="card" aria-labelledby="approval-summary">
        <h2 id="approval-summary" className="card__title">
          {t("approvals.summary")} <ApprovalStatusChip status={a.status} />
        </h2>
        <dl className="details">
          <div>
            <dt>{t("approvals.field.assignee")}</dt>
            <dd>
              <PartyCell party={a.assignee} nameOf={nameOf} />
            </dd>
          </div>
          <div>
            <dt>{t("approvals.field.due")}</dt>
            <dd>
              <DueDate date={a.dueDate} reason={a.dueUnknownReason} />
            </dd>
          </div>
          <div>
            <dt>{t("approvals.field.sla")}</dt>
            <dd>{a.slaType ? t(`approvals.sla.${a.slaType}`) : t("common.value.none")}</dd>
          </div>
          {a.urgentReason ? (
            <div>
              <dt>{t("approvals.field.urgentReason")}</dt>
              <dd>
                <TextCell value={a.urgentReason} />
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{t("approvals.field.requested")}</dt>
            <dd>
              {nameOf(a.requestedBy)} · {formatDateTime(a.requestedAt, locale)}
            </dd>
          </div>
          <div>
            <dt>{t("approvals.field.subjectVersion")}</dt>
            <dd data-subject-version={a.subjectVersion}>
              {t("approvals.versionValue", { version: a.subjectVersion })}
              {subject ? (
                <>
                  {" · "}
                  <Link className="link" to={subject.to}>
                    {t("approvals.openRecord")}
                  </Link>
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>{t("approvals.field.round")}</dt>
            <dd>{a.roundNo}</dd>
          </div>
          {a.requestNote ? (
            <div>
              <dt>{t("approvals.field.requestNote")}</dt>
              <dd>
                <TextCell value={a.requestNote} />
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{t("approvals.field.escalation")}</dt>
            <dd>
              {a.escalationLevel > 0 ? (
                <span className="status-chip status-chip--at-risk" data-escalation-level={a.escalationLevel}>
                  <Icon name="alert" /> {t("approvals.escalation.level", { level: a.escalationLevel })}
                </span>
              ) : (
                <span className="muted">{t("approvals.escalation.none")}</span>
              )}
              {a.escalatedTo ? (
                <span className="block small">
                  {t("approvals.escalation.to")}: <PartyCell party={a.escalatedTo} nameOf={nameOf} />
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
        <div className="form__actions">
          {canDecide ? (
            <button
              type="button"
              className="button button--primary"
              data-action="decide"
              onClick={() => setDialog("decide")}
            >
              <Icon name="check" /> {t("approvals.decide.action")}
            </button>
          ) : null}
          {open && isRequester ? <p className="small muted">{t("approvals.decide.requesterCannot")}</p> : null}
          {isRequester && a.status === "changes_requested" ? (
            <button
              type="button"
              className="button button--primary"
              data-action="resubmit"
              onClick={() => setDialog("resubmit")}
            >
              <Icon name="refresh" /> {t("approvals.resubmit.action")}
            </button>
          ) : null}
          {isRequester && (open || a.status === "changes_requested") ? (
            <button
              type="button"
              className="button button--secondary"
              data-action="withdraw"
              onClick={() => setDialog("withdraw")}
            >
              <Icon name="stop" /> {t("approvals.withdraw.action")}
            </button>
          ) : null}
        </div>
      </section>

      <Section id="history" title={t("approvals.history.title")} intro={t("approvals.history.intro")}>
        {a.decisions.length === 0 ? (
          <p className="muted">{t("approvals.history.empty")}</p>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("approvals.history.title")}>
            <table className="table" data-table="approval-history">
              <caption className="visually-hidden">{t("approvals.history.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("approvals.field.round")}</th>
                  <th scope="col">{t("approvals.history.outcome")}</th>
                  <th scope="col">{t("approvals.history.by")}</th>
                  <th scope="col">{t("approvals.history.rationale")}</th>
                  <th scope="col">{t("approvals.field.subjectVersion")}</th>
                  <th scope="col">{t("approvals.history.when")}</th>
                </tr>
              </thead>
              <tbody>
                {a.decisions.map((d) => (
                  <tr key={d.id} data-decision={d.id}>
                    <td>{d.roundNo}</td>
                    <th scope="row">
                      {t(`approvals.outcome.${d.outcome}`)}
                      {d.deferUntil ? (
                        <span className="block small">
                          {t("approvals.decide.deferUntil")}: {formatBusinessDate(d.deferUntil, locale)}
                        </span>
                      ) : null}
                    </th>
                    <td data-on-behalf={d.onBehalfOfUserId ? "true" : "false"}>
                      {d.onBehalfOfUserId
                        ? t("approvals.onBehalf", { actor: nameOf(d.decidedBy), principal: nameOf(d.onBehalfOfUserId) })
                        : nameOf(d.decidedBy)}
                    </td>
                    <td>
                      <TextCell value={d.rationale} />
                      {d.comments ? (
                        <span className="block small muted">
                          <TextCell value={d.comments} />
                        </span>
                      ) : null}
                    </td>
                    <td>{t("approvals.versionValue", { version: d.subjectVersion })}</td>
                    <td>{formatDateTime(d.decidedAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          <Link className="link" to={history}>
            {t("approvals.records.open")}
          </Link>
        </p>
      </Section>

      <Section id="escalations" title={t("approvals.escalation.title")} intro={t("approvals.escalation.intro")}>
        {a.escalations.length === 0 ? (
          <p className="muted">{t("approvals.escalation.empty")}</p>
        ) : (
          <ul className="plain-list">
            {a.escalations.map((e) => (
              <li key={e.id} data-escalation={e.level}>
                {t("approvals.escalation.entry", {
                  level: e.level,
                  due: formatBusinessDate(e.dueDate, locale) ?? t("common.value.unknown"),
                  from: e.fromPartyCode,
                  when: formatDateTime(e.escalatedAt, locale),
                })}{" "}
                {e.routingError ? (
                  <span
                    className="status-chip status-chip--off-track status-chip--wrap"
                    data-routing-error={e.routingError}
                  >
                    <Icon name="alert" /> <span>{t(`approvals.routingError.${e.routingError}`)}</span>
                  </span>
                ) : (
                  <span>
                    → <bdi dir="ltr">{e.toPartyCode}</bdi> {e.toUserId ? nameOf(e.toUserId) : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {dialog === "decide" ? (
        <DecideDialog
          approval={a}
          historyTo={history}
          subjectTo={subject?.to ?? null}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "resubmit" ? (
        <P4FormDialog
          title={t("approvals.resubmit.title")}
          description={<p>{t("approvals.resubmit.description")}</p>}
          fields={[
            {
              name: "subjectVersion",
              label: t("approvals.field.subjectVersion"),
              kind: "number",
              required: true,
              min: 1,
              hint: t("approvals.resubmit.versionHint"),
            },
            { name: "requestNote", label: t("approvals.field.requestNote"), kind: "textarea", max: 4000 },
          ]}
          initial={{ subjectVersion: subject?.version ? String(subject.version) : "" }}
          submitLabel={t("approvals.resubmit.action")}
          url={p4Paths.resubmitApproval(a.id)}
          version={a.version}
          toBody={(v: P4Values) => {
            const n = Number(v["subjectVersion"]);
            if (!Number.isInteger(n) || n < 1) return { fieldErrors: { subjectVersion: "validation.invalid" } };
            const note = textOf(v["requestNote"]);
            return { subjectVersion: n, ...(note ? { requestNote: note } : {}) };
          }}
          namespaces={NS}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "withdraw" ? (
        <P4FormDialog
          title={t("approvals.withdraw.title")}
          description={<p>{t("approvals.withdraw.description")}</p>}
          fields={[
            {
              name: "reason",
              label: t("approvals.withdraw.reason"),
              kind: "textarea",
              required: true,
              min: 3,
              max: 2000,
            },
          ]}
          submitLabel={t("approvals.withdraw.action")}
          danger
          url={p4Paths.withdrawApproval(a.id)}
          version={a.version}
          toBody={(v) => ({ reason: textOf(v["reason"]) })}
          namespaces={NS}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ decide

export const OUTCOMES = ["approve", "reject", "request_changes", "defer"] as const;

function DecideDialog({
  approval: a,
  historyTo,
  subjectTo,
  onDone,
  onClose,
}: {
  approval: Approval;
  historyTo: string;
  subjectTo: string | null;
  onDone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const delegations = useDelegations({ role: "delegate", status: "active" });
  const principals = [
    ...new Set((delegations.data ?? []).filter((d) => d.delegateUserId === me.user.id).map((d) => d.delegatorUserId)),
  ];
  const nameOf = useUserNames(principals);
  return (
    <P4FormDialog
      title={t("approvals.decide.title", { title: a.title })}
      note={<BusinessApprovalNote body={t("approvals.decide.note")} />}
      description={<p>{t("approvals.decide.description", { version: a.subjectVersion })}</p>}
      fields={[
        {
          name: "outcome",
          label: t("approvals.decide.outcome"),
          kind: "select",
          required: true,
          options: OUTCOMES.map((o) => ({ value: o, label: t(`approvals.outcome.${o}`) })),
          hint: t("approvals.decide.outcomeHint"),
        },
        {
          name: "deferUntil",
          label: t("approvals.decide.deferUntil"),
          kind: "date",
          required: true,
          hint: t("approvals.decide.deferHint"),
          when: (v) => v["outcome"] === "defer",
        },
        {
          name: "rationale",
          label: t("approvals.decide.rationale"),
          kind: "textarea",
          required: true,
          max: 8000,
          hint: t("approvals.decide.rationaleHint"),
        },
        { name: "comments", label: t("approvals.decide.comments"), kind: "textarea", max: 8000 },
        ...(principals.length > 0
          ? [
              {
                name: "onBehalfOfUserId",
                label: t("approvals.decide.onBehalfOf"),
                kind: "select" as const,
                hint: t("approvals.decide.onBehalfOfHint"),
                options: principals.map((id) => ({ value: id, label: nameOf(id) })),
              },
            ]
          : []),
      ]}
      submitLabel={t("approvals.decide.confirm")}
      url={p4Paths.decideApproval(a.id)}
      version={a.version}
      toBody={(v) => {
        const rationale = textOf(v["rationale"]);
        if (!rationale) return { fieldErrors: { rationale: "validation.required" } };
        const outcome = String(v["outcome"]);
        const comments = textOf(v["comments"]);
        const onBehalf = typeof v["onBehalfOfUserId"] === "string" ? v["onBehalfOfUserId"] : "";
        return {
          outcome,
          rationale,
          subjectVersion: a.subjectVersion,
          ...(comments ? { comments } : {}),
          ...(outcome === "defer" ? { deferUntil: v["deferUntil"] } : {}),
          ...(onBehalf ? { onBehalfOfUserId: onBehalf } : {}),
        };
      }}
      namespaces={NS}
      alertExtra={(e) =>
        e instanceof ApiError && e.code === "approval.stale_version" ? (
          <p data-state="record-changed">
            {t("approvals.stale.review")}:{" "}
            {subjectTo ? (
              <Link className="link" to={subjectTo}>
                {t("approvals.openRecord")}
              </Link>
            ) : null}
            {subjectTo ? " · " : null}
            <Link className="link" to={historyTo} data-link="history">
              {t("approvals.stale.history")}
            </Link>
          </p>
        ) : null
      }
      onDone={onDone}
      onClose={onClose}
    />
  );
}
