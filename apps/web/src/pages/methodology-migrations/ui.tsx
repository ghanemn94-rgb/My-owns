// Status presentation of a methodology migration (T-DG5-FE-B): always a text label with an icon, in neutral lifecycle
// styling (a status is never colour alone, and blue never means favourable).
import type { MethodologyMigrationStatus } from "@mth/shared/schemas";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "../../components/Icon.tsx";

const ICON: Record<MethodologyMigrationStatus, IconName> = {
  draft: "pencil",
  submitted: "clock",
  changes_requested: "alert",
  approved: "check",
  rejected: "cross",
  withdrawn: "archive",
  executed: "lock",
};

export function MigrationStatusChip({ status }: { status: MethodologyMigrationStatus }) {
  const { t } = useTranslation();
  const css =
    status === "draft" || status === "changes_requested" ? "draft" : status === "executed" ? "active" : "closed";
  return (
    <span className={`lifecycle-chip lifecycle-chip--${css}`} data-migration-status={status}>
      <Icon name={ICON[status]} /> {t(`studio.migration.statusName.${status}`)}
    </span>
  );
}
