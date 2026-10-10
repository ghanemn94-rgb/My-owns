// Shared UI of the slice G screens (T-DG4-FE-E; p4-work-split §F+G FG.8; ADR-0034): BAU and performance areas,
// handovers, controls, checks, reviews, the CI backlog and lessons.
//  - Statuses are labelled text plus an icon, never colour alone; blue never means favourable.
//  - An area without a BAU owner shows the owner as Unknown; a missing next review date reads "not scheduled", never a
//    guessed date (ADR-0034 §11). A review's `unknown` performance signal is shown as Unknown, never on track.
//  - Acceptance of a BAU handover is a business approval inside the product, never an engineering gate (DG0-DG7).
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { DueDate } from "../my-work/p4ui.tsx";

/** The page namespace (its `problem.*` texts are read before `problems.*`). */
export const NS = ["sustainP4"] as const;

export const SUSTAIN_WRITE_PERMISSIONS = [
  "performance_area.manage",
  "performance_area.reopen",
  "bau_handover.prepare",
  "bau_handover.accept",
  "control.manage",
  "control_check.record",
  "sustainment_review.complete",
] as const;

export function Code({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className="code">
      {children}
    </bdi>
  );
}

export function vocabOptions(t: TFunction, group: string, values: readonly string[]) {
  return values.map((v) => ({ value: v, label: t(`sustainP4.${group}.${v}`) }));
}

const STATUS_ICON: Record<string, IconName> = {
  establishing: "pencil",
  bau: "check",
  reopened: "refresh",
  retired: "archive",
  draft: "pencil",
  submitted: "clock",
  accepted: "lock",
  returned: "refresh",
  active: "dot",
  due: "clock",
  passed: "check",
  failed: "alert",
  cancelled: "cross",
  done: "check",
  open: "dot",
  in_progress: "refresh",
  rejected: "cross",
  published: "lock",
  archived: "archive",
  removed: "cross",
};

/** A record status (label + icon) from `sustainP4.status.<value>`. A failed check reads "Failed" with an alert icon. */
export function StatusText({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className="chip-row" data-status={status}>
      <Icon name={STATUS_ICON[status] ?? "dot"} /> {t(`sustainP4.status.${status}`, { defaultValue: status })}
    </span>
  );
}

/** A review's performance signal: on track / deteriorating / Unknown (never green by default). */
export function SignalText({ signal }: { signal: string | null }) {
  const { t } = useTranslation();
  if (!signal) return <span className="muted">{t("sustainP4.none")}</span>;
  const css = signal === "on_track" ? "on-track" : signal === "deteriorating" ? "off-track" : "unknown";
  const icon: IconName = signal === "on_track" ? "check" : signal === "deteriorating" ? "alert" : "question";
  return (
    <span className={`status-chip status-chip--${css}`} data-signal={signal}>
      <Icon name={icon} /> {t(`sustainP4.signal.${signal}`)}
    </span>
  );
}

/** A next review / check date, or "not scheduled" (never a guessed date). */
export function ScheduledDate({ date }: { date: string | null }) {
  const { t } = useTranslation();
  if (!date)
    return (
      <span className="status-chip status-chip--unknown" data-scheduled="none">
        <Icon name="question" /> {t("sustainP4.notScheduled")}
      </span>
    );
  return <DueDate date={date} />;
}

/** "Every 2 months" from a frequency and an interval. */
export function frequencyText(t: TFunction, frequency: string, interval: number): string {
  return interval === 1
    ? t(`sustainP4.frequency.${frequency}`)
    : t("sustainP4.frequencyEvery", { n: interval, unit: t(`sustainP4.frequency.${frequency}`) });
}

/** The slice G screens' own sub-navigation (one transformation). */
export function SustainSubNav({ tid }: { tid: string }) {
  const { t } = useTranslation();
  const base = `/transformations/${tid}`;
  const links: { to: string; label: string; icon: IconName }[] = [
    { to: `${base}/bau`, label: t("sustainP4.nav.areas"), icon: "columns" },
    { to: `${base}/bau-handovers`, label: t("sustainP4.nav.handovers"), icon: "lock" },
    { to: `${base}/bau-controls`, label: t("sustainP4.nav.controls"), icon: "check" },
    { to: `${base}/bau-reviews`, label: t("sustainP4.nav.reviews"), icon: "clock" },
    { to: `${base}/improvement`, label: t("sustainP4.nav.improvement"), icon: "refresh" },
    { to: `${base}/lessons`, label: t("sustainP4.nav.lessons"), icon: "info" },
  ];
  return (
    <nav className="p4-subnav" aria-label={t("sustainP4.nav.label")}>
      {links.map((l) => (
        <NavLink key={l.to} end className="button button--secondary button--small" to={l.to}>
          <Icon name={l.icon} /> {l.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** "Business approval" note (S-7): the receiving owner's acceptance, never DG0-DG7. */
export function AcceptanceNote() {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="business-approval">
      <Icon name="lock" /> <strong>{t("myWork.ui.businessApproval")}</strong>: {t("sustainP4.handover.acceptanceNote")}
    </p>
  );
}
