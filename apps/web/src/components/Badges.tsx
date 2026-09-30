// Status presentation. Two different things, never mixed:
//  - HealthChip: business status tokens (on track / at risk / off track / unknown / stale), always label + icon;
//    blue never means favourable, and missing data is Unknown (never green or zero).
//  - LifecycleChip: record lifecycle (draft / active / on hold / closed / archived) in neutral styling. A draft is
//    labelled "Draft - not submitted" (REQ-S15-011).
import { useTranslation } from "react-i18next";
import type { TransformationStatus } from "@mth/shared";
import { Icon, type IconName } from "./Icon.tsx";

export type Health = "on_track" | "at_risk" | "off_track" | "unknown" | "stale";

const HEALTH: Record<Health, { icon: IconName; css: string }> = {
  on_track: { icon: "check", css: "on-track" },
  at_risk: { icon: "alert", css: "at-risk" },
  off_track: { icon: "cross", css: "off-track" },
  unknown: { icon: "question", css: "unknown" },
  stale: { icon: "clock", css: "stale" },
};

export function HealthChip({ health }: { health: Health }) {
  const { t } = useTranslation();
  const h = HEALTH[health];
  return (
    <span className={`status-chip status-chip--${h.css}`} data-health={health}>
      <Icon name={h.icon} /> {t(`common.status.${health}`)}
    </span>
  );
}

/** The value is missing: say so explicitly instead of showing 0, a blank or a green state. */
export function Unknown({ hint }: { hint?: string }) {
  const { t } = useTranslation();
  return (
    <span className="status-chip status-chip--unknown" data-health="unknown" title={hint}>
      <Icon name="question" /> {t("common.value.unknown")}
      {hint ? <span className="visually-hidden">: {hint}</span> : null}
    </span>
  );
}

const LIFECYCLE: Record<TransformationStatus | "archived", IconName> = {
  draft: "pencil",
  active: "dot",
  on_hold: "pause",
  closed: "stop",
  archived: "archive",
};

export function LifecycleChip({ status }: { status: TransformationStatus | "archived" }) {
  const { t } = useTranslation();
  return (
    <span className={`lifecycle-chip lifecycle-chip--${status}`} data-status={status}>
      <Icon name={LIFECYCLE[status]} /> {t(`transformations.status.${status}`)}
    </span>
  );
}

export function ActiveChip({ status }: { status: "active" | "inactive" | "disabled" }) {
  const { t } = useTranslation();
  return (
    <span className={`lifecycle-chip lifecycle-chip--${status === "active" ? "active" : "closed"}`}>
      <Icon name={status === "active" ? "dot" : "stop"} /> {t(`common.activeStatus.${status}`)}
    </span>
  );
}
