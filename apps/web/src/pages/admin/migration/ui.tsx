// Shared UI of the P7 transfer screens (T-DG7-FE-B; p7-work-split §C.8, §D.2): Data export, Migration status, Identity
// rebind and Configuration transfer.
//  - Every status chip carries a text label and an icon (never colour alone; blue never means favourable). A `null`
//    count, checksum or date is shown as "Unknown" (or "Not yet" for a date that has not happened), never as 0, an
//    empty list or a success colour (p7-work-split §I.7 rule, carried by api/p7.ts).
//  - Counts are 64-bit decimal strings in the contract (`TransferInteger`): they are formatted through BigInt, never a
//    binary floating-point number.
//  - Identifiers, checksums and table names are shown left to right inside either direction (<bdi dir="ltr">).
//  - Nothing here grants a business, Finance or IT approval; the engineering delivery gates are never shown.
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@mth/shared";
import { intlLocale } from "../../../lib/format.ts";
import { Chip, type ChipTone } from "../../automation/ui.tsx";
import type { IconName } from "../../../components/Icon.tsx";

export type ChipTable = Readonly<Record<string, readonly [ChipTone, IconName]>>;

/** `MigrationExport.status` (and nothing else): a queued or running export is neutral, never "good". */
export const JOB_STATUS_CHIPS: ChipTable = {
  queued: ["neutral", "clock"],
  running: ["neutral", "refresh"],
  succeeded: ["good", "check"],
  failed: ["bad", "cross"],
};
/** `TransferSourceEnvironment`: a demo source stays labelled synthetic wherever it goes (§C.11). */
export const ENVIRONMENT_CHIPS: ChipTable = {
  demo: ["warn", "info"],
  production: ["neutral", "dot"],
  unmarked: ["neutral", "question"],
};
export const RECONCILIATION_CHIPS: ChipTable = { matched: ["good", "check"], mismatched: ["bad", "alert"] };
export const REBIND_STATE_CHIPS: ChipTable = {
  unbound: ["bad", "lock"],
  rebound: ["good", "check"],
  retained: ["good", "check"],
};
export const ATTACHMENT_PROBLEM_CHIPS: ChipTable = {
  missing: ["bad", "cross"],
  size_mismatch: ["bad", "alert"],
  sha256_mismatch: ["bad", "alert"],
};
/** `ConfigBundleImport.status`: "validated" is a technical check, never an approval, so it is a draft-style chip. */
export const BUNDLE_STATUS_CHIPS: ChipTable = {
  uploaded: ["draft", "pencil"],
  validated: ["draft", "check"],
  invalid: ["bad", "cross"],
  committed: ["closed", "check"],
};
/** `ConfigBundleImportItem.action`: a commit only ever writes drafts (or applies a non-draft kind as a change). */
export const BUNDLE_ACTION_CHIPS: ChipTable = {
  create_draft: ["draft", "plus"],
  new_draft: ["draft", "pencil"],
  identical: ["neutral", "dot"],
  conflict: ["warn", "alert"],
  refused: ["bad", "cross"],
};

/** The "Unknown" chip: a missing value is never 0 and never green. */
export function UnknownChip() {
  const { t } = useTranslation();
  return <Chip tone="neutral" icon="question" label={t("transfer.common.unknown")} data="unknown" />;
}

/** A chip from a fixed table; a missing or unlisted value is the Unknown chip. */
export function TransferChip({
  value,
  table,
  labelKey,
}: {
  value: string | null | undefined;
  table: ChipTable;
  labelKey: string;
}) {
  const { t } = useTranslation();
  const entry = value ? table[value] : undefined;
  if (!value || !entry) return <UnknownChip />;
  return <Chip tone={entry[0]} icon={entry[1]} label={t(`${labelKey}.${value}`)} data={value} wrap />;
}

/** A 64-bit count (decimal string or integer) in the locale's digits; null/invalid is null (the caller shows Unknown). */
export function formatCount(value: string | number | null | undefined, locale: Locale): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) return null;
  return BigInt(text).toLocaleString(intlLocale(locale));
}

/** A count, or the Unknown chip when the value is not known. */
export function Count({ value, locale }: { value: string | number | null | undefined; locale: Locale }) {
  const text = formatCount(value, locale);
  return text === null ? <UnknownChip /> : <span data-count={String(value)}>{text}</span>;
}

/** An identifier, checksum or table name, left to right and breakable; null is the Unknown chip. */
export function Mono({ children }: { children: string | null | undefined }) {
  if (children === null || children === undefined || children === "") return <UnknownChip />;
  return (
    <bdi dir="ltr" className="code code--wrap" style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
      {children}
    </bdi>
  );
}

/** A date that may not have happened yet ("Not yet"), or an unknown one. */
export function When({ value, format }: { value: string | null | undefined; format: (v: string) => string | null }) {
  const { t } = useTranslation();
  const text = value ? format(value) : null;
  return <>{text ?? t("transfer.common.notYet")}</>;
}

/** A definition-list row whose value is always rendered (a component decides Unknown/Not yet itself). */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** The note that a transfer never grants an approval of any kind. */
export function NotApprovalNote() {
  const { t } = useTranslation();
  return (
    <p className="small muted" data-state="not-approval">
      {t("transfer.common.notApproval")}
    </p>
  );
}

/**
 * Refreshes the given query keys every `ms` while `active` (an export queued or running): the list shows the job's real
 * progress without a manual reload, and stops polling once nothing is in progress.
 */
export function usePollWhile(active: boolean, keys: readonly (readonly unknown[])[], ms = 5000) {
  const queryClient = useQueryClient();
  const signature = JSON.stringify(keys);
  useEffect(() => {
    if (!active) return undefined;
    const handle = setInterval(() => {
      for (const key of JSON.parse(signature) as unknown[][]) void queryClient.invalidateQueries({ queryKey: key });
    }, ms);
    return () => clearInterval(handle);
  }, [active, signature, ms, queryClient]);
}

/** A file name for the X-File-Name header: printable ASCII only (a header cannot carry other bytes), 1-255 chars. */
export function headerSafeFileName(name: string): string {
  const safe = Array.from(name)
    .map((c) => (c >= " " && c <= "~" ? c : "_"))
    .join("")
    .trim()
    .slice(0, 255);
  return safe === "" ? "bundle.json" : safe;
}
