// Shared UI of the two slice I screens (T-DG7-FE-C; p7-work-split §I.2, §I.3; ADR-0071 §3, §4): Administration >
// Requirement register and Administration > About this release.
//  - A register status is an engineering delivery state, never a business approval: every chip carries its text label
//    and an icon, and none uses the success colour ("Implemented" is the neutral "closed" chip; blue never means
//    favourable).
//  - Register text (titles, notes, every column of a row) is English, as in the repository. It is rendered as plain
//    text (React escapes it; no HTML is interpreted) inside a `dir="ltr" lang="en"` element, so it stays left to right
//    on the Arabic screen, with line breaks kept (white-space: pre-wrap). It is never trimmed or re-encoded (§I.7).
//  - The register snapshot unavailable (503 `release.register_snapshot_unavailable`, G4) is its own state with the
//    `register.unavailable` text: never the empty-table text, never 0.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { UseQueryResult } from "@tanstack/react-query";
import { ApiError } from "../../../api/client.ts";
import { REQUIREMENT_STATUSES, type RequirementStatus } from "../../../api/p7.ts";
import { useLocale } from "../../../app/locale.ts";
import { Icon } from "../../../components/Icon.tsx";
import { QueryState } from "../../../components/States.tsx";
import { Chip } from "../../automation/ui.tsx";
import { formatCount, type ChipTable } from "../migration/ui.tsx";

// ------------------------------------------------------------------------------------------------ contract shapes

/** `RegisterSnapshotInfo` (ADR-0071 §2). */
export interface RegisterSnapshotInfo {
  readonly schemaVersion: string;
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly rowCount: number;
  readonly generatedAt: string;
}
/** `RequirementSummary`. */
export interface RequirementSummary {
  readonly reqId: string;
  readonly class: string;
  readonly area: string;
  readonly title: string;
  readonly sourceRef: string;
  readonly finalGate: string;
  readonly status: string;
  readonly increments: string;
  readonly hasNotes: boolean;
}
/** `RequirementPage`. */
export interface RequirementPage {
  readonly items: RequirementSummary[];
  readonly nextCursor: string | null;
  readonly snapshot: RegisterSnapshotInfo;
}
/** `Requirement`: every register column verbatim. */
export interface Requirement extends Omit<RequirementSummary, "hasNotes"> {
  readonly sourceHeading: string;
  readonly templateId: string;
  readonly inputFields: string;
  readonly procedure: string;
  readonly output: string;
  readonly ownerRoles: string;
  readonly permissions: string;
  readonly automation: string;
  readonly screenApi: string;
  readonly acceptance: string;
  readonly evidence: string;
  readonly notes: string;
  readonly snapshot: RegisterSnapshotInfo;
}
/** `ReleaseOpenItem`. */
export interface ReleaseOpenItem {
  readonly reqId: string;
  readonly title: string;
  readonly status: string;
  readonly finalGate: string;
  readonly notes: string;
}
/** `ExternalDependency`. */
export interface ExternalDependency {
  readonly key: string;
  readonly title: string;
  readonly owner: string;
  readonly status: string;
}
/** `ReleaseAbout` (ADR-0071 §4): every `null` means "this build did not have it", never empty and never 0. */
export interface ReleaseAbout {
  readonly appVersion: string;
  readonly contractVersion: string;
  readonly register: RegisterSnapshotInfo | null;
  readonly statusCounts: Readonly<Record<RequirementStatus, number>> | null;
  readonly openItems: ReleaseOpenItem[] | null;
  readonly laterClauses: ReleaseOpenItem[] | null;
  readonly externalDependencies: ExternalDependency[] | null;
  readonly checkedAt: string;
}

// ------------------------------------------------------------------------------------------------ chips

/** `RequirementStatus`: engineering delivery states. No status is shown in the success colour. */
export const REQUIREMENT_STATUS_CHIPS: ChipTable = {
  PLANNED: ["neutral", "clock"],
  SPECIFIED: ["draft", "pencil"],
  IMPLEMENTED: ["closed", "check"],
  BLOCKED: ["bad", "lock"],
};
/** `ExternalDependency.status`: every value is something still missing. */
export const DEPENDENCY_STATUS_CHIPS: ChipTable = {
  not_configured: ["warn", "alert"],
  not_verified: ["warn", "question"],
  blocked: ["bad", "lock"],
};

/** A chip from a fixed table with the `release` texts; an unlisted value is shown verbatim (LTR), never guessed. */
export function ReleaseChip({ value, table, labelKey }: { value: string; table: ChipTable; labelKey: string }) {
  const { t } = useTranslation();
  const entry = table[value];
  if (!entry) return <RegisterText inline>{value}</RegisterText>;
  return <Chip tone={entry[0]} icon={entry[1]} label={t(`${labelKey}.${value}`)} data={value} wrap />;
}

export function StatusChip({ status }: { status: string }) {
  return <ReleaseChip value={status} table={REQUIREMENT_STATUS_CHIPS} labelKey="release.status" />;
}

/** True for a `RequirementStatus` value. */
export const isRequirementStatus = (v: string): v is RequirementStatus =>
  (REQUIREMENT_STATUSES as readonly string[]).includes(v);

// ------------------------------------------------------------------------------------------------ register text

/**
 * Register text, verbatim, as plain text: left to right and English on either screen (§I.2), line breaks kept. An empty
 * field says so ("Empty in the register") instead of rendering nothing.
 */
export function RegisterText({
  children,
  inline = false,
  showEmpty = false,
}: {
  children: string;
  inline?: boolean;
  showEmpty?: boolean;
}) {
  const { t } = useTranslation();
  if (showEmpty && children === "")
    return <span className="muted small">{t("release.register.detail.emptyField")}</span>;
  const Tag = inline ? "bdi" : "div";
  return (
    <Tag
      dir="ltr"
      lang="en"
      data-register-text=""
      style={{ whiteSpace: inline ? "normal" : "pre-wrap", overflowWrap: "anywhere", textAlign: "start" }}
    >
      {children}
    </Tag>
  );
}

/** A requirement id, left to right. */
export function ReqId({ children }: { children: string }) {
  return (
    <bdi dir="ltr" className="code">
      {children}
    </bdi>
  );
}

// ------------------------------------------------------------------------------------------------ notes and states

/** "These are engineering delivery states, not business approvals." (ADR-0071 §4: shown on both screens.) */
export function NotEngineeringApprovalNote() {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="not-approval">
      <Icon name="info" /> {t("release.register.notEngineeringApproval")}
    </p>
  );
}

/** "Register texts are kept in English, as in the repository." Shown on the Arabic screen (§I.2). */
export function EnglishOnlyNote() {
  const { t, i18n } = useTranslation();
  if (i18n.language !== "ar") return null;
  return (
    <p className="small muted" data-state="english-only">
      {t("release.register.englishOnly")}
    </p>
  );
}

/** "Register snapshot: <rowCount> rows, SHA-256 <first 12 hex>…"; a missing snapshot is "Unavailable". */
export function SnapshotLine({ snapshot }: { snapshot: RegisterSnapshotInfo | null }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (!snapshot) return <UnavailableChip />;
  const rowCount = formatCount(snapshot.rowCount, locale);
  if (rowCount === null) return <UnavailableChip />;
  return (
    <p className="small" data-state="snapshot" data-sha256={snapshot.sourceSha256}>
      {t("release.register.snapshot", { rowCount, sha: snapshot.sourceSha256.slice(0, 12) })}
    </p>
  );
}

/** The "Unavailable" chip: a neutral question mark, never 0 and never green. */
export function UnavailableChip() {
  const { t } = useTranslation();
  return <Chip tone="neutral" icon="question" label={t("release.about.unavailable")} data="unavailable" />;
}

/** The register snapshot of this build is missing or invalid (G4): its own state, never the empty text. */
export function RegisterUnavailableState() {
  const { t } = useTranslation();
  return (
    <div className="state state--error" role="alert" data-state="register-unavailable">
      <Icon name="question" />
      <div>
        <p className="state__title">{t("release.register.unavailable")}</p>
        <p className="state__body">{t("problems.release__register_snapshot_unavailable")}</p>
      </div>
    </div>
  );
}

/** True for the 503 `release.register_snapshot_unavailable` answer of listRequirements and getRequirement. */
export function isRegisterUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503 && error.code === "release.register_snapshot_unavailable";
}

/** `QueryState` that shows the register-unavailable state for G4's 503 (and every other state as usual). */
export function RegisterQueryState<T>({
  query,
  children,
}: {
  query: UseQueryResult<T, unknown>;
  children: (data: T) => ReactNode;
}) {
  if (query.isError && query.data === undefined && isRegisterUnavailable(query.error))
    return <RegisterUnavailableState />;
  return <QueryState query={query}>{children}</QueryState>;
}
