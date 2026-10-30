// Shared presentation of Strategy and KPIs > Imports (T-DG6-FE-C; ADR-0056 §2, §5).
//  - Row reasons are codes with params, rendered here in English or Arabic at render time (`imports.reason.*`); a field
//    is named by its template column label in the reader's language; DG4's English "expected" phrase and the existing
//    actual's status are mapped to localized texts. A placeholder the data does not fill is never shown raw.
//  - Every status chip has a text label and an icon.
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { Locale } from "@mth/shared";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { Chip, type ChipTone } from "../reports/ui.tsx";
import { codeKey, fillText } from "../integrations/ui.tsx";
import type {
  ImportBatchStatus,
  ImportRow,
  ImportRowReason,
  ImportRowValidationStatus,
  ImportTemplateColumn,
} from "./api.ts";
import "../integrations/integrations.css";

const BATCH: Record<ImportBatchStatus, readonly [ChipTone, IconName]> = {
  staging: ["neutral", "clock"],
  staged: ["draft", "pencil"],
  committed: ["good", "check"],
  cancelled: ["neutral", "stop"],
  failed: ["bad", "cross"],
};

/** "Staged – not committed" is a draft state: it is never shown like committed data (REQ-S15-011 pattern). */
export function BatchStatusChip({ status }: { status: ImportBatchStatus }) {
  const { t } = useTranslation();
  const [tone, icon] = BATCH[status];
  return <Chip tone={tone} icon={icon} label={t(`imports.status.${status}`)} data={status} />;
}

const ROW: Record<ImportRowValidationStatus, readonly [ChipTone, IconName]> = {
  valid: ["good", "check"],
  invalid: ["bad", "cross"],
  duplicate_in_batch: ["warn", "alert"],
  duplicate_committed: ["warn", "alert"],
};

export function RowStatusChip({ status }: { status: ImportRowValidationStatus }) {
  const { t } = useTranslation();
  const [tone, icon] = ROW[status];
  return <Chip tone={tone} icon={icon} label={t(`imports.rowStatus.${status}`)} data={status} />;
}

export function CommitStatusText({ status }: { status: ImportRow["commitStatus"] }) {
  const { t } = useTranslation();
  const icon: IconName = status === "committed" ? "check" : status === "pending" ? "clock" : "dot";
  return (
    <span data-commit-status={status}>
      <Icon name={icon} /> {t(`imports.commitStatus.${status}`)}
    </span>
  );
}

const EXPECTED: Readonly<Record<string, string>> = {
  "a value": "imports.expected.value",
  "a numerator and a denominator": "imports.expected.numeratorDenominator",
  "whether the milestone was achieved": "imports.expected.milestone",
};

/** The column label of a field key in the reader's language, or the key itself when the template does not name it. */
export function columnLabel(key: string, columns: readonly ImportTemplateColumn[] | undefined, locale: Locale): string {
  const col = columns?.find((c) => c.key === key);
  return col ? (locale === "ar" ? col.labelAr : col.labelEn) : key;
}

/** One row reason as text in the reader's language (ADR-0056 §5). */
export function reasonText(
  t: TFunction,
  reason: ImportRowReason,
  columns: readonly ImportTemplateColumn[] | undefined,
  locale: Locale,
): string {
  const params: Record<string, string | number> = { ...reason.params };
  const field = reason.field ?? (typeof params["field"] === "string" ? (params["field"] as string) : null);
  if (field) params["field"] = columnLabel(field, columns, locale);
  const expected = params["expected"];
  if (typeof expected === "string" && EXPECTED[expected]) params["expected"] = t(EXPECTED[expected]!);
  const status = params["status"];
  if (typeof status === "string") params["status"] = t(`imports.actualStatus.${status}`, { defaultValue: status });
  const text = fillText(t, `imports.reason.${codeKey(reason.code)}`, params);
  return text || t("imports.reason.unknown", { code: reason.code });
}
