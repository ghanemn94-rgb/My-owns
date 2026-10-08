// Explicit data states (ADR-0009 §8, REQ-S15-011): loading, empty, error, stale, conflict and no-permission. Every
// state has a text label and an icon, a live-region role, and never renders a missing value as 0 or green.
import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, isSessionChangedError } from "../api/client.ts";
import { errorMessage, isNoPermission } from "../lib/problem.ts";
import { useLocale } from "../app/locale.ts";
import { formatDateTime } from "../lib/format.ts";
import { Icon } from "./Icon.tsx";

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="state state--loading" role="status" aria-live="polite" data-state="loading">
      <span className="spinner" aria-hidden="true" />
      <span>{label ?? t("common.state.loading")}</span>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="state state--empty" data-state="empty">
      <Icon name="info" />
      <div>
        <p className="state__title">{title}</p>
        {body ? <p className="state__body">{body}</p> : null}
        {action ? <div className="state__action">{action}</div> : null}
      </div>
    </div>
  );
}

/**
 * An honest "being built in this stage" state for a screen whose route exists but whose content is not delivered yet
 * (P3 seam stubs). It shows no data and offers no action, so nothing can be mistaken for a working screen.
 */
export function BeingBuiltState({ title, body }: { title: string; body: string }) {
  return (
    <div className="state state--empty" role="note" data-state="being-built">
      <Icon name="clock" />
      <div>
        <p className="state__title">{title}</p>
        <p className="state__body">{body}</p>
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  // F-DG2-530: an answer that belonged to a previous session is not an error of this one: nothing is shown.
  if (isSessionChangedError(error)) return null;
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <div className="state state--error banner banner--error" role="alert" data-state="error">
      <Icon name="alert" />
      <div>
        <p className="state__title">{t("common.state.errorTitle")}</p>
        <p className="state__body">{errorMessage(t, error)}</p>
        {requestId ? (
          <p className="state__meta">
            {t("common.state.reference")} <bdi dir="ltr">{requestId}</bdi>
          </p>
        ) : null}
        {onRetry ? (
          <button type="button" className="button button--secondary" onClick={onRetry}>
            <Icon name="refresh" /> {t("common.action.retry")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Shown ABOVE data that is still displayed but could not be refreshed. The data is labelled Stale, never current. */
export function StaleBanner({ updatedAt, onRetry }: { updatedAt: number; onRetry?: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const when = updatedAt > 0 ? formatDateTime(new Date(updatedAt).toISOString(), locale) : null;
  return (
    <div className="banner banner--warning" role="status" data-state="stale">
      <span className="status-chip status-chip--stale">
        <Icon name="clock" /> {t("common.status.stale")}
      </span>
      <span>{when ? t("common.state.staleSince", { when }) : t("common.state.staleUnknown")}</span>
      {onRetry ? (
        <button type="button" className="button button--secondary button--small" onClick={onRetry}>
          <Icon name="refresh" /> {t("common.action.retry")}
        </button>
      ) : null}
    </div>
  );
}

/** 403 (may see but not do) and 404 (may not see, or does not exist): existence is never disclosed. */
export function NoPermissionState({ error }: { error?: unknown }) {
  const { t } = useTranslation();
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div className="state state--no-permission" role="alert" data-state="no-permission">
      <Icon name="lock" />
      <div>
        <p className="state__title">
          {notFound ? t("common.state.notFoundTitle") : t("common.state.noPermissionTitle")}
        </p>
        <p className="state__body">{notFound ? t("common.state.notFoundBody") : t("common.state.noPermissionBody")}</p>
      </div>
    </div>
  );
}

export interface ConflictRow {
  readonly field: string;
  readonly label: string;
  readonly mine: string;
  readonly current: string;
}

/**
 * 409 version conflict (A14): nothing was saved. Shows the user's unsaved values next to the latest saved values and
 * offers to re-apply the change on top of the latest version or to discard it.
 */
export function ConflictPanel({
  yourVersion,
  currentVersion,
  rows,
  onReapply,
  onDiscard,
  busy,
}: {
  yourVersion: number;
  currentVersion: number | null;
  rows: readonly ConflictRow[];
  onReapply?: () => void;
  onDiscard: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="banner banner--warning conflict"
      role="alert"
      aria-labelledby="conflict-title"
      data-state="conflict"
    >
      <h2 id="conflict-title" className="conflict__title">
        <Icon name="alert" /> {t("common.conflict.title")}
      </h2>
      <p>
        {t("common.conflict.body", {
          yours: yourVersion,
          current: currentVersion ?? t("common.value.unknown"),
        })}
      </p>
      {rows.length > 0 ? (
        <table className="table table--compact">
          <caption>{t("common.conflict.compareCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("common.conflict.field")}</th>
              <th scope="col">{t("common.conflict.mine")}</th>
              <th scope="col">{t("common.conflict.current")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.field}>
                <th scope="row">{r.label}</th>
                <td>{r.mine}</td>
                <td>{r.current}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="form__actions">
        {onReapply ? (
          <button type="button" className="button button--primary" onClick={onReapply} disabled={busy}>
            {t("common.conflict.reapply")}
          </button>
        ) : null}
        <button type="button" className="button button--secondary" onClick={onDiscard} disabled={busy}>
          {t("common.conflict.discard")}
        </button>
      </div>
    </section>
  );
}

/**
 * Renders a query's state explicitly: loading, no-permission (403/404), error (no data), stale (data shown, refresh
 * failed), empty, or the content.
 */
export function QueryState<T>({
  query,
  isEmpty,
  empty,
  children,
}: {
  query: UseQueryResult<T, unknown>;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  // F-DG2-530: the query's answer belonged to a previous session. It is not an error of this one: it is loaded again
  // under the current session (once per such failure, so bounded), and shown as loading meanwhile.
  const sessionChanged = query.isError && isSessionChangedError(query.error);
  const { refetch, errorUpdatedAt } = query;
  useEffect(() => {
    if (sessionChanged) void refetch();
  }, [sessionChanged, errorUpdatedAt, refetch]);
  if (query.isPending) return <LoadingState />;
  if (sessionChanged && query.data === undefined) return <LoadingState />;
  if (query.isError && query.data === undefined) {
    if (isNoPermission(query.error)) return <NoPermissionState error={query.error} />;
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  const data = query.data as T;
  return (
    <>
      {query.isRefetchError && !sessionChanged ? (
        <StaleBanner updatedAt={query.dataUpdatedAt} onRetry={() => void query.refetch()} />
      ) : null}
      {isEmpty?.(data) && empty ? empty : children(data)}
    </>
  );
}
