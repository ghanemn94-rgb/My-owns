// Shared UI of the slice E screens (T-DG4-FE-D; p4-work-split §E.5; ADR-0031): RAID, actions, corrective actions.
//  - Probability is n/a for an Assumption, an Issue and a Dependency (REQ-PB-080): the cell reads "n/a" with a
//    screen-reader explanation, never blank and never a level.
//  - Status, overdue and owner states are labelled text plus an icon, never colour alone. Blue never means favourable.
//  - A missing follow-up date is Unknown with its reason, never a guessed date; an unresolved owner is "Unassigned".
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { Icon, type IconName } from "../../components/Icon.tsx";

/** The page namespace (its `problem.*` texts are read before `problems.*`). */
export const NS = ["raidP4"] as const;

export const RAID_WRITE_PERMISSIONS = ["raid.edit"] as const;
export const CORRECTIVE_WRITE_PERMISSIONS = ["corrective_action.manage", "corrective_rule.configure"] as const;
export const ACTION_WRITE_PERMISSIONS = ["action.edit", "action.update_own"] as const;

/** A small "code" chip (LTR inside an RTL page). */
export function Code({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className="code">
      {children}
    </bdi>
  );
}

/** Options of a vocabulary for a select: `raidP4.<group>.<value>`. */
export function vocabOptions(t: TFunction, group: string, values: readonly string[]) {
  return values.map((v) => ({ value: v, label: t(`raidP4.${group}.${v}`) }));
}

/** A level (High / Medium / Low), or "n/a" with its explanation when the field does not apply. */
export function LevelCell({ level, notApplicable }: { level: string | null; notApplicable?: boolean }) {
  const { t } = useTranslation();
  if (notApplicable)
    return (
      <span className="muted" data-level="n/a">
        {t("raidP4.na")}
        <span className="visually-hidden"> ({t("raidP4.probabilityNa")})</span>
      </span>
    );
  if (!level)
    return (
      <span className="status-chip status-chip--unknown" data-level="unknown">
        <Icon name="question" /> {t("common.value.unknown")}
      </span>
    );
  return <span data-level={level}>{t(`raidP4.level.${level}`)}</span>;
}

const STATUS_ICON: Record<string, IconName> = {
  open: "dot",
  in_progress: "refresh",
  closed: "check",
  done: "check",
  cancelled: "cross",
};

/** A record status (open, in progress, closed, done, cancelled): label + icon; not a RAG, never coloured green. */
export function StatusText({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className="chip-row" data-status={status}>
      <Icon name={STATUS_ICON[status] ?? "dot"} /> {t(`raidP4.status.${status}`, { defaultValue: status })}
    </span>
  );
}

/** "Overdue" flag (label + icon). Shown only when the server says so. */
export function OverdueFlag({ overdue }: { overdue: boolean }) {
  const { t } = useTranslation();
  if (!overdue) return null;
  return (
    <span className="status-chip status-chip--off-track" data-overdue="true">
      <Icon name="alert" /> {t("raidP4.overdue")}
    </span>
  );
}

/** A RAID entry type label with its T15 letter. */
export function TypeLabel({ type }: { type: string }) {
  const { t } = useTranslation();
  return <span data-type={type}>{t(`raidP4.type.${type}`)}</span>;
}

/** The slice E screens' own sub-navigation (one transformation). */
export function RaidSubNav({ tid }: { tid: string }) {
  const { t } = useTranslation();
  const base = `/transformations/${tid}`;
  const links: { to: string; label: string; icon: IconName }[] = [
    { to: `${base}/raid`, label: t("raidP4.nav.register"), icon: "columns" },
    { to: `${base}/raid-decision-log`, label: t("raidP4.nav.decisionLog"), icon: "menu" },
    { to: `${base}/actions`, label: t("raidP4.nav.actions"), icon: "check" },
    { to: `${base}/corrective-actions`, label: t("raidP4.nav.corrective"), icon: "alert" },
    { to: `${base}/corrective-action-rules`, label: t("raidP4.nav.rules"), icon: "info" },
  ];
  return (
    <nav className="p4-subnav" aria-label={t("raidP4.nav.label")}>
      {links.map((l) => (
        <NavLink key={l.to} end className="button button--secondary button--small" to={l.to}>
          <Icon name={l.icon} /> {l.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** The value of a date input, or null when empty. */
export const dateOrNull = (v: string | boolean | undefined): string | null =>
  typeof v === "string" && v !== "" ? v : null;
