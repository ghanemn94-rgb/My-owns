// "Includes restricted records" (T-DG6-FE-B; ADR-0051 §2; REQ-S10-002; D-195 Q3): the label of a total or a dashboard
// aggregate whose response carries `includesRestrictedRecords: true`. The total itself is identical for every user;
// only the individual records and values stay hidden. The label is a neutral note with a lock icon and text (never a
// colour alone, never a favourable or unfavourable status). Absent or false renders nothing.
import { useTranslation } from "react-i18next";
import { Icon } from "../Icon.tsx";

export function RestrictedRecordsLabel({ value }: { value: boolean | null | undefined }) {
  const { t } = useTranslation();
  if (value !== true) return null;
  return (
    <span
      className="status-chip status-chip--unknown status-chip--wrap"
      data-restricted-records="true"
      title={t("adminP6.restricted.hint")}
    >
      <Icon name="lock" /> {t("access.includesRestrictedRecords")}
      <span className="visually-hidden">. {t("adminP6.restricted.hint")}</span>
    </span>
  );
}
