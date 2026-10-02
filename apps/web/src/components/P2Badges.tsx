// P2 status presentation (ADR-0009 §8, REQ-S15-011). Every chip has a text label and an icon; colour is never the
// only cue and blue never means favourable. Missing values are Unknown, never green or zero. A record's lifecycle
// (draft, active, …) is neutral; verification/validation/test results use the semantic status tokens.
import { useTranslation } from "react-i18next";
import { validationState } from "@mth/shared/schemas";
import { Unknown } from "./Badges.tsx";
import { Icon, type IconName } from "./Icon.tsx";

/** T01/value-pool confidence H/M/L (B0031); missing is Unknown. */
export function ConfidenceChip({ value }: { value: string | null | undefined }) {
  const { t } = useTranslation();
  if (value !== "H" && value !== "M" && value !== "L") return <Unknown hint={t("diagnose.confidence.notRated")} />;
  return (
    <span className="lifecycle-chip" data-confidence={value}>
      <Icon name={value === "H" ? "chevronUp" : value === "L" ? "chevronDown" : "dot"} />{" "}
      {t(`diagnose.confidence.${value}`)}
    </span>
  );
}

const LIFECYCLE_ICON: Record<string, IconName> = {
  draft: "pencil",
  active: "dot",
  open: "dot",
  confirmed: "check",
  rejected: "cross",
  resolved: "check",
  archived: "archive",
  current: "dot",
  superseded: "archive",
  ready: "check",
  planned: "clock",
  in_progress: "dot",
  closed: "stop",
  decided: "check",
  deferred: "pause",
  cancelled: "stop",
  recorded: "check",
  converted: "check",
  done: "check",
  at_risk: "alert",
  withdrawn: "stop",
  removed: "stop",
};

/**
 * A record's lifecycle status, neutral styling. `draft` reads "Draft – not submitted" so a saved draft is never
 * mistaken for submitted or approved data (REQ-S15-011).
 */
export function RecordStatus({ status }: { status: string }) {
  const { t } = useTranslation();
  const css =
    status === "draft"
      ? "draft"
      : status === "archived" || status === "closed" || status === "cancelled"
        ? "closed"
        : "";
  return (
    <span className={`lifecycle-chip${css ? ` lifecycle-chip--${css}` : ""}`} data-status={status}>
      <Icon name={LIFECYCLE_ICON[status] ?? "dot"} /> {t(`common.recordStatus.${status}`, { defaultValue: status })}
    </span>
  );
}

/** Finance validation of a baseline or value pool, read as ADR-0019 §3 (a later edit makes it Stale). */
export function ValidationChip({
  record,
}: {
  record: { validationStatus: string; validatedRecordVersion: number | null; version: number };
}) {
  const { t } = useTranslation();
  const state = validationState(record);
  const map = {
    validated: { css: "on-track", icon: "check" },
    rejected: { css: "off-track", icon: "cross" },
    stale: { css: "stale", icon: "clock" },
    unvalidated: { css: "unknown", icon: "question" },
  } as const;
  const m = map[state];
  return (
    <span className={`status-chip status-chip--${m.css}`} data-validation={state}>
      <Icon name={m.icon} /> {t(`kpi.validation.${state}`)}
    </span>
  );
}

/** Evidence verification: only `verified` counts toward a gate criterion; anything else is shown as unverified. */
export function EvidenceStateChip({ reviewStatus }: { reviewStatus: string }) {
  const { t } = useTranslation();
  const m =
    reviewStatus === "verified"
      ? { css: "on-track", icon: "check" as const }
      : reviewStatus === "rejected"
        ? { css: "off-track", icon: "cross" as const }
        : { css: "unknown", icon: "question" as const };
  return (
    <span className={`status-chip status-chip--${m.css}`} data-evidence-state={reviewStatus}>
      <Icon name={m.icon} />{" "}
      {t(
        `evidence.review.state.${reviewStatus === "verified" || reviewStatus === "rejected" ? reviewStatus : "unverified"}`,
      )}
    </span>
  );
}

/** A computed test result (good outcome test criterion, scope-check pre-check). */
export function ResultChip({
  result,
  label,
}: {
  result: "pass" | "fail" | "unknown" | "attention" | "not_applicable";
  label?: string;
}) {
  const { t } = useTranslation();
  const m = {
    pass: { css: "on-track", icon: "check" },
    fail: { css: "off-track", icon: "cross" },
    attention: { css: "at-risk", icon: "alert" },
    unknown: { css: "unknown", icon: "question" },
    not_applicable: { css: "unknown", icon: "dot" },
  } as const;
  return (
    <span className={`status-chip status-chip--${m[result].css}`} data-result={result}>
      <Icon name={m[result].icon} /> {label ?? t(`common.result.${result}`)}
    </span>
  );
}

/** Gate criterion completeness (live or frozen). */
export function CompletenessChip({ completeness }: { completeness: "complete" | "incomplete" }) {
  const { t } = useTranslation();
  return completeness === "complete" ? (
    <span className="status-chip status-chip--on-track" data-completeness="complete">
      <Icon name="check" /> {t("gates.completeness.complete")}
    </span>
  ) : (
    <span className="status-chip status-chip--off-track" data-completeness="incomplete">
      <Icon name="cross" /> {t("gates.completeness.incomplete")}
    </span>
  );
}

const GATE_ICON: Record<string, IconName> = {
  draft: "pencil",
  submitted: "clock",
  under_review: "clock",
  changes_requested: "alert",
  approved: "check",
  rejected: "cross",
  deferred: "pause",
};

/** Product gate status (business approval): neutral chip with icon and text. */
export function GateStatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className={`lifecycle-chip${status === "draft" ? " lifecycle-chip--draft" : ""}`} data-gate-status={status}>
      <Icon name={GATE_ICON[status] ?? "dot"} /> {t(`gates.status.${status}`, { defaultValue: status })}
    </span>
  );
}
