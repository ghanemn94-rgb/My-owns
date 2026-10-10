// My Work: the signed-in user's work items and in-app inbox (T-DG4-FE-A; ADR-0025 §3-§4; REQ-S12-005 display side).
//  - Work items and reminders store `messageKey` + `messageParams`, never sentences (S-6): the text is translated here at
//    render time, so switching the language re-renders every message. A message key this release does not know shows
//    a neutral "task" text with its kind, never the raw key.
//  - A due date that is null is Unknown, never a guessed date and never "on time".
//  - "Complete" is offered only to the assignee on open items whose kind is not system-managed (approval tasks close
//    with their approval: the server refuses with 422 work_item.system_managed, translated). Reminders are marked read
//    one by one. Both actions are bodiless POSTs with If-Match.
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ApiError, api } from "../../api/client.ts";
import {
  p4Paths,
  useMyInbox,
  useMyWorkItems,
  useP4Refresh,
  type InboxNotification,
  type WorkItem,
} from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import type { Locale } from "@mth/shared";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { DueDate, FormAlert } from "./p4ui.tsx";

/**
 * The pending state of the My Work sections: a plain busy note, not the shared role="status" LoadingState. My Work is
 * the landing page, and signing out clears every query: a polite live region announcing "Loading…" there would race
 * with the sign-in page's own "You have signed out" status (auth/session-end.test.tsx).
 */
function Pending() {
  const { t } = useTranslation();
  return (
    <p className="muted" aria-busy="true" data-state="loading">
      {t("common.state.loading")}
    </p>
  );
}

/** Work-item kinds that close with their subject (apps/api tasks/routes.ts SYSTEM_MANAGED_KINDS). */
export const SYSTEM_MANAGED_KINDS: ReadonlySet<string> = new Set(["approval_decision", "approval_escalated"]);

/** Message parameters whose values are codes: translated before interpolation. */
const CODE_PARAMS: Record<string, string> = {
  outcome: "myWork.param.outcome",
  approvalType: "myWork.param.approvalType",
  recipientRole: "myWork.param.recipientRole",
  routingError: "myWork.param.routingError",
};
/**
 * Message parameters that are business dates (null = Unknown), formatted in the reader's locale. T-DG4-FE-R1 adds the
 * dates the ARCH-R1/R2 code-table keys carry (finance validation period, SLA date, exception expiry, meeting date).
 */
const DATE_PARAMS = new Set([
  "dueDate",
  "overdueAsOf",
  "periodStart",
  "periodEnd",
  "slaDueDate",
  "expiresOn",
  "meetingDate",
]);

/** The translated text of a work item or reminder (S-6: rendered from messageKey + messageParams at render time). */
export function renderMessage(
  t: TFunction,
  locale: Locale,
  messageKey: string,
  params: Readonly<Record<string, string | number | boolean | null>>,
  kind?: string,
): string {
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (DATE_PARAMS.has(k))
      values[k] = formatBusinessDate(typeof v === "string" ? v : null, locale) ?? t("common.value.unknown");
    else if (CODE_PARAMS[k] && typeof v === "string")
      values[k] = t(`${CODE_PARAMS[k]}.${v}`, { defaultValue: v.replace(/_/g, " ") });
    else if (v === null) values[k] = t("common.value.unknown");
    else values[k] = String(v);
  }
  const key = `myWork.message.${messageKey.replace(/\./g, "__")}`;
  // A key sent with no parameters may have a "_bare" text (e.g. raid.task.action_due without a source code, ADR-0031).
  const bare = Object.keys(params).length === 0 ? t(`${key}_bare`, { defaultValue: "" }) : "";
  const text = bare || t(key, { ...values, defaultValue: "" });
  if (text) return text;
  return t("myWork.message.fallback", { kind: t(`myWork.kind.${kind ?? "other"}`, { defaultValue: kind ?? "" }) });
}

export function MyWorkPage() {
  const { t } = useTranslation();
  const me = useMe();
  usePageTitle(t("nav.areas.myWork.label"));
  const canReadTransformations = canAnywhere(me, "transformation.read");
  return (
    <div className="page" data-page="my-work">
      <PageHeader
        title={t("common.myWork.greeting", { name: me.user.displayName })}
        subtitle={t("nav.areas.myWork.summary")}
      />
      <nav className="p4-subnav" aria-label={t("myWork.subnav")}>
        <Link className="button button--secondary button--small" to="/my-work/approvals">
          <Icon name="check" /> {t("nav.sub.approvals")}
        </Link>
        <Link className="button button--secondary button--small" to="/my-work/delegations">
          <Icon name="dot" /> {t("nav.sub.delegations")}
        </Link>
        {canReadTransformations ? (
          <Link className="button button--secondary button--small" to="/transformations">
            {t("common.myWork.openTransformations")}
          </Link>
        ) : null}
      </nav>
      {!canReadTransformations ? <p className="muted">{t("common.myWork.noBusinessAccess")}</p> : null}
      <WorkItemsSection />
      <InboxSection />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ work items

function WorkItemsSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [status, setStatus] = useState<"open" | "done" | "cancelled">("open");
  const list = useMyWorkItems({ status });
  const refresh = useP4Refresh();
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const complete = async (w: WorkItem) => {
    setError(null);
    const action = beginSessionGuard();
    setBusyId(w.id);
    try {
      await api.send(p4Paths.completeWorkItem(w.id), { method: "POST", ifMatch: w.version });
      if (action.stale()) return;
      await refresh();
    } catch (e) {
      if (action.stale(e)) return;
      setError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const columns: RegisterColumn<WorkItem>[] = [
    {
      id: "task",
      header: t("myWork.items.task"),
      rowHeader: true,
      hideable: false,
      cell: (w) => (
        <Link className="link" to={w.linkPath} data-work-item={w.id}>
          {renderMessage(t, locale, w.messageKey, w.messageParams, w.kind)}
        </Link>
      ),
      sortValue: (w) => renderMessage(t, locale, w.messageKey, w.messageParams, w.kind),
    },
    {
      id: "kind",
      header: t("myWork.items.kind"),
      cell: (w) => t(`myWork.kind.${w.kind}`, { defaultValue: t("myWork.kind.other") }),
      sortValue: (w) => w.kind,
    },
    {
      id: "due",
      header: t("myWork.items.due"),
      cell: (w) => <DueDate date={w.dueDate} />,
      sortValue: (w) => w.dueDate,
    },
    {
      id: "period",
      header: t("myWork.items.period"),
      cell: (w) =>
        w.periodLabel ? <bdi dir="ltr">{w.periodLabel}</bdi> : <span className="muted">{t("common.value.none")}</span>,
      sortValue: (w) => w.periodLabel,
    },
    {
      id: "status",
      header: t("myWork.items.status"),
      cell: (w) => (
        <span className={`lifecycle-chip${w.status === "open" ? " lifecycle-chip--draft" : ""}`} data-status={w.status}>
          {t(`myWork.items.statusValue.${w.status}`)}
        </span>
      ),
      sortValue: (w) => w.status,
    },
    {
      id: "created",
      header: t("myWork.items.created"),
      cell: (w) => formatDateTime(w.createdAt, locale),
      sortValue: (w) => w.createdAt,
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (w) => {
        if (w.status !== "open") return <span className="muted small">{t("myWork.items.closed")}</span>;
        if (SYSTEM_MANAGED_KINDS.has(w.kind))
          return <span className="small muted">{t("myWork.items.systemManaged")}</span>;
        return (
          <button
            type="button"
            className="button button--link button--small"
            data-action="complete"
            disabled={busyId === w.id}
            onClick={() => void complete(w)}
          >
            <Icon name="check" /> {t("myWork.items.complete")}
            <span className="visually-hidden">: {renderMessage(t, locale, w.messageKey, w.messageParams, w.kind)}</span>
          </button>
        );
      },
    },
  ];

  return (
    <Section
      id="work-items"
      title={t("myWork.items.title")}
      intro={t("myWork.items.intro")}
      actions={
        <label className="p4-inline-field">
          <span>{t("myWork.items.filter")}</span>{" "}
          <select
            value={status}
            data-filter="status"
            onChange={(e) => setStatus(e.target.value as "open" | "done" | "cancelled")}
          >
            {(["open", "done", "cancelled"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`myWork.items.statusValue.${s}`)}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <FormAlert error={error} />
      {list.isPending ? (
        <Pending />
      ) : (
        <QueryState query={list}>
          {(rows) => (
            <RegisterTable
              id="p4-work-items"
              caption={t("myWork.items.title")}
              rows={rows}
              columns={columns}
              getRowId={(w) => w.id}
              emptyTitle={t(`myWork.items.empty.${status}`)}
              emptyBody={t("myWork.items.emptyBody")}
              defaultSort={{ id: "due", dir: "asc" }}
            />
          )}
        </QueryState>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ inbox

function InboxSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const inbox = useMyInbox(unreadOnly ? { unreadOnly: "true" } : {});
  const refresh = useP4Refresh();
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const markRead = async (n: InboxNotification) => {
    setError(null);
    const action = beginSessionGuard();
    setBusyId(n.id);
    try {
      await api.send(p4Paths.markRead(n.id), { method: "POST", ifMatch: n.version });
      if (action.stale()) return;
      await refresh();
    } catch (e) {
      if (action.stale(e)) return;
      setError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Section
      id="inbox"
      title={t("myWork.inbox.title")}
      intro={t("myWork.inbox.intro")}
      actions={
        <label className="checkbox">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          {t("myWork.inbox.unreadOnly")}
        </label>
      }
    >
      <FormAlert error={error} />
      {inbox.isPending ? (
        <Pending />
      ) : (
        <QueryState query={inbox}>
          {(page) => (
            <>
              <p data-unread-count={page.unreadCount} role="status">
                <strong>{t("myWork.inbox.unreadCount", { count: page.unreadCount })}</strong>
              </p>
              {page.items.length === 0 ? (
                <p className="muted">{t(unreadOnly ? "myWork.inbox.emptyUnread" : "myWork.inbox.empty")}</p>
              ) : (
                <ul className="p4-message-list" aria-label={t("myWork.inbox.title")}>
                  {page.items.map((n) => {
                    const text = renderMessage(t, locale, n.messageKey, n.messageParams);
                    return (
                      <li
                        key={n.id}
                        className={`p4-message${n.readAt ? "" : " p4-message--unread"}`}
                        data-notification={n.id}
                        data-read={n.readAt ? "true" : "false"}
                      >
                        <div className="p4-message__body">
                          <span className={`lifecycle-chip${n.readAt ? "" : " lifecycle-chip--draft"}`}>
                            <Icon name={n.readAt ? "check" : "dot"} />{" "}
                            {n.readAt ? t("myWork.inbox.read") : t("myWork.inbox.unread")}
                          </span>{" "}
                          <Link className="link" to={n.linkPath}>
                            {text}
                          </Link>
                          <span className="block small muted">{formatDateTime(n.createdAt, locale)}</span>
                        </div>
                        {n.readAt ? null : (
                          <button
                            type="button"
                            className="button button--secondary button--small"
                            data-action="mark-read"
                            disabled={busyId === n.id}
                            onClick={() => void markRead(n)}
                          >
                            {t("myWork.inbox.markRead")}
                            <span className="visually-hidden">: {text}</span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </QueryState>
      )}
    </Section>
  );
}
