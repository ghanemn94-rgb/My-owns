// "Includes restricted records" (T-DG6-FE-B; ADR-0051 §2; REQ-S10-002; D-195 Q3; T-DG6-BE-Z13, D-226): the label of
// something whose response carries `includesRestrictedRecords: true`. The label is a neutral note with a lock icon and
// text (never a colour alone, never a favourable or unfavourable status). Absent or false renders nothing.
// Its description is contextual (F-DG6-561):
//   - scope "total" (the default): a total or a dashboard aggregate, identical for every user; only the individual
//     records and values stay hidden;
//   - scope "item": a row, link, count of links or condition that refers to a record the reader is not admitted to.
import { useTranslation } from "react-i18next";
import { Icon } from "../Icon.tsx";

export type RestrictedLabelScope = "total" | "item";

export function RestrictedRecordsLabel({
  value,
  scope = "total",
}: {
  value: boolean | null | undefined;
  scope?: RestrictedLabelScope;
}) {
  const { t } = useTranslation();
  if (value !== true) return null;
  const hint = scope === "item" ? t("adminP6.restricted.hintItem") : t("adminP6.restricted.hint");
  return (
    <span
      className="status-chip status-chip--unknown status-chip--wrap"
      data-restricted-records="true"
      data-restricted-scope={scope}
      title={hint}
    >
      <Icon name="lock" /> {t("access.includesRestrictedRecords")}
      <span className="visually-hidden">. {hint}</span>
    </span>
  );
}
