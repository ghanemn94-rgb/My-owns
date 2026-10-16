// The "extension" badge of the twelve M0149 record types (REQ-S05-006; ADR-0041 §1): shown on each of their forms and
// in the form builder, in en and ar, with a text label and an icon (never colour alone; neutral, never a status colour).
// The flag comes from the server's registry (`extensionBadge`); `EXTENSION_RECORD_TYPES` mirrors the twelve codes of
// `form_record_type` (0068 CHECK form_record_type_badge_is_extension) for screens that render before any read.
import { useTranslation } from "react-i18next";
import { Icon } from "../Icon.tsx";

/** The twelve M0149 extension record types, in the M0149 order (ADR-0041 §1). */
export const EXTENSION_RECORD_TYPES = [
  "evidence",
  "baseline",
  "value_pool",
  "resource_plan",
  "funding_approval",
  "procedure_definition",
  "change_request",
  "meeting_record",
  "corrective_plan",
  "lesson",
  "bau_handover",
  "control",
] as const;
export type ExtensionRecordType = (typeof EXTENSION_RECORD_TYPES)[number];

/** The badge itself: "Extension" / "امتداد", with a hint that the playbook supplies no template for this record. */
export function ExtensionBadge({ recordType, describe = true }: { recordType: string; describe?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className="lifecycle-chip lifecycle-chip--draft extension-badge"
      data-extension-badge={recordType}
      title={t("forms.badge.extensionHint")}
    >
      <Icon name="info" /> {t("forms.badge.extension")}
      {describe ? <span className="visually-hidden"> — {t("forms.badge.extensionHint")}</span> : null}
    </span>
  );
}

/** The badge as a paragraph under a section or page title, for a form of one of the twelve extension types. */
export function ExtensionNote({ recordType }: { recordType: ExtensionRecordType }) {
  const { t } = useTranslation();
  return (
    <p className="small muted" data-extension-note={recordType}>
      <ExtensionBadge recordType={recordType} describe={false} /> {t("forms.badge.extensionHint")}
    </p>
  );
}
