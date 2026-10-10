// Shared UI of the slice D screens (T-DG4-FE-D; p4-work-split §D.5; ADR-0032): forums, meetings, the T16 log.
//  - Statuses are labelled text plus an icon; "quorum not configured" is never shown as "met" (D.8 item 10).
//  - Bodiless actions (publish the agenda, start, close, approve or publish minutes, end a series, remove a participant)
//    send If-Match with the version the user saw, inside a session guard; the section shows one alert (S-7).
//  - The label for recording an Outcome is "business decision", never an engineering delivery gate.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { ApiError, api } from "../../api/client.ts";
import { useP4Refresh } from "../../api/p4.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { FormAlert } from "../my-work/p4ui.tsx";

/** The page namespace (its `problem.*` texts are read before `problems.*`). */
export const NS = ["governanceP4"] as const;

export const MEETING_WRITE_PERMISSIONS = ["meeting.prepare", "meeting.chair"] as const;
export const FORUM_WRITE_PERMISSIONS = ["forum.configure"] as const;
export const DECISION_WRITE_PERMISSIONS = [
  "executive_decision.create",
  "executive_decision.decide",
  "escalation_rule.configure",
] as const;

/** A small "code" chip (LTR inside an RTL page). */
export function Code({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className="code">
      {children}
    </bdi>
  );
}

const MEETING_ICON: Record<string, IconName> = {
  scheduled: "clock",
  agenda_published: "menu",
  in_session: "refresh",
  held: "check",
  minutes_published: "lock",
  cancelled: "cross",
};

export function MeetingStatusText({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className="chip-row" data-meeting-status={status}>
      <Icon name={MEETING_ICON[status] ?? "dot"} /> {t(`governanceP4.meetingStatus.${status}`)}
    </span>
  );
}

/** Quorum: met / not met (with present of required) / not configured — never "met" when not configured. */
export function QuorumState({
  state,
  present,
  required,
}: {
  state: "not_configured" | "met" | "not_met";
  present: number;
  required: number | null;
}) {
  const { t } = useTranslation();
  if (state === "not_configured")
    return (
      <span className="status-chip status-chip--unknown" data-quorum="not_configured">
        <Icon name="info" /> {t("governanceP4.quorum.not_configured", { present })}
      </span>
    );
  return (
    <span
      className={`status-chip ${state === "met" ? "status-chip--on-track" : "status-chip--off-track"}`}
      data-quorum={state}
    >
      <Icon name={state === "met" ? "check" : "alert"} />{" "}
      {t(`governanceP4.quorum.${state}`, { present, required: required ?? 0 })}
    </span>
  );
}

export function MinutesStatusText({ status }: { status: string }) {
  const { t } = useTranslation();
  const icon: IconName = status === "published" ? "lock" : status === "approved" ? "check" : "pencil";
  return (
    <span className="chip-row" data-minutes-status={status}>
      <Icon name={icon} /> {t(`governanceP4.minutes.status.${status}`)}
    </span>
  );
}

/** "Overdue" flag (label + icon). */
export function OverdueFlag({ overdue }: { overdue: boolean }) {
  const { t } = useTranslation();
  if (!overdue) return null;
  return (
    <span className="status-chip status-chip--off-track" data-overdue="true">
      <Icon name="alert" /> {t("governanceP4.overdue")}
    </span>
  );
}

/**
 * Bodiless versioned actions of one section: `run(url, version)` sends POST with If-Match in a session guard; the
 * section renders `alert` once. A 409/422 reloads the data.
 */
export function useActionRunner(tid: string) {
  const refresh = useP4Refresh(tid);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, url: string, version?: number) => {
    setError(null);
    const action = beginSessionGuard();
    setBusy(key);
    try {
      await api.send(url, { method: "POST", ...(version === undefined ? {} : { ifMatch: version }) });
      if (action.stale()) return;
      await refresh();
    } catch (e) {
      if (action.stale(e)) return;
      setError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await refresh();
    } finally {
      setBusy(null);
    }
  };
  return { run, busy, alert: <FormAlert error={error} namespaces={NS} /> };
}

/** The governance screens' own sub-navigation (one transformation). */
export function GovSubNav({ tid }: { tid: string }) {
  const { t } = useTranslation();
  const base = `/transformations/${tid}`;
  const links: { to: string; label: string; icon: IconName }[] = [
    { to: `${base}/forums`, label: t("governanceP4.nav.forums"), icon: "columns" },
    { to: `${base}/meetings`, label: t("governanceP4.nav.meetings"), icon: "clock" },
    { to: `${base}/executive-decisions`, label: t("governanceP4.nav.decisions"), icon: "lock" },
    { to: `${base}/escalations`, label: t("governanceP4.nav.escalations"), icon: "alert" },
  ];
  return (
    <nav className="p4-subnav" aria-label={t("governanceP4.nav.label")}>
      {links.map((l) => (
        <NavLink key={l.to} end className="button button--secondary button--small" to={l.to}>
          <Icon name={l.icon} /> {l.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** The "business decision" note (S-7): an in-product business decision, never an engineering delivery gate. */
export function BusinessDecisionNote() {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="business-decision">
      <Icon name="lock" /> <strong>{t("governanceP4.businessDecision")}</strong>:{" "}
      {t("governanceP4.businessDecisionBody")}
    </p>
  );
}
