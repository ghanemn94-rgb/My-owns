// The status of a change request as text with an icon (never colour alone). A draft reads "Saved draft — not submitted"
// so it is never mistaken for a submitted or approved request (T-DG4-FE-F2; ADR-0036 §1).
import { useTranslation } from "react-i18next";
import type { ChangeRequestStatus } from "@mth/shared/schemas";
import { Icon, type IconName } from "../../components/Icon.tsx";

const STATUS_ICON: Record<ChangeRequestStatus, IconName> = {
  draft: "pencil",
  submitted: "clock",
  changes_requested: "refresh",
  approved: "lock",
  rejected: "cross",
  withdrawn: "archive",
};

export function ChangeStatusText({ status }: { status: ChangeRequestStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={status === "draft" ? "status-chip status-chip--unknown status-chip--wrap" : "chip-row"}
      data-cr-status={status}
    >
      <Icon name={STATUS_ICON[status]} /> {t(`changeRequestsP4.status.${status}`)}
    </span>
  );
}
