// Shared UI pieces of the FE-B screens (prioritization, roadmap, dependencies, capacity; T-DG3-FE-B). Kept inside
// FE-B's own folders: problem texts translated from their `code` in FE-B's namespaces (the English server `detail` is
// never shown), decimal formatting through the SHARED `formatDecimal` (never Number()/parseFloat), the
// "business approval" tag, translated schedule/capacity flags and the conflict notice.
import { formatDecimal } from "@mth/shared/schemas";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api/client.ts";
import { useLocale } from "../../app/locale.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Icon } from "../../components/Icon.tsx";
import { errorMessage, fieldErrorMessage, problemText } from "../../lib/problem.ts";

/** "prioritization.weights_total" -> "prioritization__weights_total" (the key form used in FE-B's `problem` maps). */
export const codeKey = (code: string) => code.replace(/\./g, "__");

/** The FE-B namespaces that carry a `problem` map, searched in order. */
const NAMESPACES = ["prioritization", "roadmap", "dependencies", "capacity"] as const;

/**
 * Translated text of one problem or field-error code: FE-B's own `<ns>.problem.<code>` first, then the shared
 * `problems.*` catalogue. Null when neither knows it.
 */
export function codeText(t: TFunction, code: string, vars: Record<string, unknown> = {}): string | null {
  for (const ns of NAMESPACES) {
    const v = t(`${ns}.problem.${codeKey(code)}`, { defaultValue: "", ...vars });
    if (v) return v;
  }
  const shared = problemText(t, code);
  return shared || null;
}

/**
 * The user-facing message of a failed request: the problem `code` (or its first field error's code) translated in
 * FE-B's namespaces, else the shared `errorMessage`. The server's English `detail` is never shown.
 */
export function p3ErrorMessage(t: TFunction, error: unknown, vars: Record<string, unknown> = {}): string {
  if (error instanceof ApiError) {
    const code = error.code;
    if (code && code !== "validation") {
      const own = codeText(t, code, vars);
      if (own) return own;
    }
    for (const fe of error.fieldErrors) {
      const own = codeText(t, fe.code, vars);
      if (own) return own;
    }
  }
  return errorMessage(t, error);
}

/** Field-error message of a pointer in a failed request, or undefined. */
export function pointerError(t: TFunction, error: unknown, pointer: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const fe = error.fieldErrors.find((f) => f.pointer === pointer);
  if (!fe) return undefined;
  return codeText(t, fe.code) ?? fieldErrorMessage(t, fe.code);
}

/** The one form-level alert of a form or dialog (one live region). */
export function FormAlert({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p className="banner banner--error" role="alert" data-state="form-error">
      <Icon name="alert" /> {message}
    </p>
  );
}

/** Formats an exact decimal string for the current locale; null/invalid input gives null (render Unknown). */
export function useDecimal(): (
  value: string | null | undefined,
  minFraction?: number,
  maxFraction?: number,
) => string | null {
  const locale = useLocale();
  return (value, minFraction = 0, maxFraction = 2) =>
    formatDecimal(value ?? null, { locale, minFractionDigits: minFraction, maxFractionDigits: maxFraction });
}

/** A decimal value, or the explicit Unknown chip (never 0). */
export function DecimalOrUnknown({
  value,
  min = 0,
  max = 2,
}: {
  value: string | null | undefined;
  min?: number;
  max?: number;
}) {
  const fmt = useDecimal();
  const text = fmt(value, min, max);
  return text === null ? <Unknown /> : <bdi>{text}</bdi>;
}

/** The "business approval" tag on every weight-set and override decision (never a delivery gate). */
export function BusinessApprovalTag() {
  const { t } = useTranslation();
  return (
    <span className="badge" data-kind="business-approval">
      <Icon name="lock" /> {t("prioritization.shared.businessApproval")}
    </span>
  );
}

/** A schedule or capacity flag, translated from its code; schedule.unknown is shown as Unknown, never as "no conflict". */
export function FlagChip({ code }: { code: string }) {
  const { t } = useTranslation();
  const label = t(`roadmap.flag.${codeKey(code)}`, { defaultValue: "" }) || t("roadmap.flag.other", { code });
  const unknown = code.endsWith(".unknown");
  return (
    <span
      className={`status-chip ${unknown ? "status-chip--unknown" : "status-chip--at-risk"}`}
      data-flag={code}
      style={{ whiteSpace: "normal", maxWidth: "100%", borderRadius: "var(--mth-radius)" }}
    >
      <Icon name={unknown ? "question" : "alert"} /> {label}
    </span>
  );
}

export function FlagList({ flags }: { flags: readonly { code: string }[] }) {
  const { t } = useTranslation();
  if (flags.length === 0) return <span className="muted">{t("roadmap.flag.none")}</span>;
  const codes = [...new Set(flags.map((f) => f.code))];
  return (
    <span className="chip-row" style={{ flexWrap: "wrap", maxWidth: "100%" }}>
      {codes.map((c) => (
        <FlagChip key={c} code={c} />
      ))}
    </span>
  );
}

/** A 409 on an action: nothing was saved; the data has been reloaded. */
export function ConflictNotice({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="banner banner--warning conflict" role="alert" data-state="conflict">
      <p>
        <Icon name="alert" /> <strong>{t("common.conflict.title")}</strong>
      </p>
      <p>{t("prioritization.shared.conflictReloaded")}</p>
      <div className="form__actions">
        <button type="button" className="button button--secondary button--small" onClick={onDismiss}>
          {t("common.action.close")}
        </button>
      </div>
    </section>
  );
}

/** Whether an error is the standard optimistic-concurrency conflict. */
export const isVersionConflict = (e: unknown) => e instanceof ApiError && e.isConflict;

/** A scrollable table region that keyboard users can focus (axe scrollable-region-focusable). */
export function TableRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
