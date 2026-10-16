// Shared UI of the FE-D screens (T-DG5-FE-D; p5-plan §5.1 row FE-D): procedures, automation, jobs operations,
// approval routes, gate conditions, notification preferences and the meeting cut-off pack.
//  - Status chips always carry a text label and an icon (never colour alone; blue never means favourable). An unknown
//    or missing value is a neutral "Unknown"/"Never run"/"Disabled" chip, never green and never zero.
//  - Every action goes through one guarded runner: If-Match from the record the user saw, session-bound, one
//    form-level alert per form that shows the translated problem code (S-7). A 409 or 422 reloads the data.
//  - Nothing here decides a business approval: an automation, a job or a service identity never approves a gate, an
//    investment or a Finance attestation (ADR-0043 §3, ADR-0044 §1). The engineering delivery gates DG0–DG7 are not
//    product features and are never shown.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../api/client.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { FormAlert } from "../my-work/p4ui.tsx";

/** The i18n namespace of every FE-D text (en and ar; `workflowsP5.problem.*` overrides come before `problems.*`). */
export const FED_NS = ["workflowsP5"] as const;

export type ChipTone = "good" | "warn" | "bad" | "neutral" | "stale" | "draft" | "closed";

const TONE_CLASS: Record<ChipTone, string> = {
  good: "status-chip status-chip--on-track",
  warn: "status-chip status-chip--at-risk",
  bad: "status-chip status-chip--off-track",
  neutral: "status-chip status-chip--unknown",
  stale: "status-chip status-chip--stale",
  draft: "lifecycle-chip lifecycle-chip--draft",
  closed: "lifecycle-chip lifecycle-chip--closed",
};

/** A status chip: tone + icon + translated label (the label is always present). */
export function Chip({ tone, icon, label, data }: { tone: ChipTone; icon: IconName; label: string; data?: string }) {
  return (
    <span className={TONE_CLASS[tone]} data-status={data ?? ""}>
      <Icon name={icon} /> {label}
    </span>
  );
}

/** The chip of a status value from a fixed table (status → tone and icon); an unlisted value is neutral "Unknown". */
export function StatusChip({
  value,
  table,
  labelKey,
}: {
  value: string | null | undefined;
  table: Readonly<Record<string, readonly [ChipTone, IconName]>>;
  labelKey: string;
}) {
  const { t } = useTranslation();
  const entry = value ? table[value] : undefined;
  if (!value || !entry) return <Chip tone="neutral" icon="question" label={t("workflowsP5.unknown")} data="unknown" />;
  return <Chip tone={entry[0]} icon={entry[1]} label={t(`${labelKey}.${value}`)} data={value} />;
}

export interface Runner {
  readonly busy: boolean;
  readonly error: unknown;
  readonly clear: () => void;
  /** Sends one action; on success, or a 409/422 (the data changed), calls `refresh`. Returns the result or null. */
  run: <T>(
    url: string,
    options: {
      method?: "POST" | "PATCH" | "PUT";
      body?: unknown;
      ifMatch?: number;
      idempotencyKey?: string;
    },
  ) => Promise<T | null>;
  /** The form-level alert (one per form; S-7). */
  readonly alert: ReactNode;
}

/** A guarded runner for actions and small updates, with its one form-level alert. */
export function useRunner(refresh: () => Promise<unknown>): Runner {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async <T,>(
    url: string,
    options: { method?: "POST" | "PATCH" | "PUT"; body?: unknown; ifMatch?: number; idempotencyKey?: string },
  ): Promise<T | null> => {
    const action = beginSessionGuard();
    setBusy(true);
    setError(null);
    try {
      const result = await api.send<T>(url, {
        method: options.method ?? "POST",
        ...(options.body === undefined ? {} : { body: options.body }),
        ...(options.ifMatch === undefined ? {} : { ifMatch: options.ifMatch }),
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      });
      if (action.stale()) return null;
      await refresh();
      if (action.stale()) return null;
      return result;
    } catch (e) {
      if (action.stale(e)) return null;
      setError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await refresh();
      return null;
    } finally {
      if (action.current()) setBusy(false);
    }
  };
  return {
    busy,
    error,
    clear: () => setError(null),
    run,
    alert: <FormAlert error={error} namespaces={FED_NS} />,
  };
}

/** The `code` of an API error, or "". */
export const codeOf = (e: unknown): string => (e instanceof ApiError ? (e.code ?? "") : "");

/** True when a query failed with 403 (the screen then shows the no-permission state). */
export const isForbidden = (e: unknown): boolean => e instanceof ApiError && e.status === 403;

/** Text of the locale ("en" | "ar") from a bilingual pair; a missing text is null (shown as "—", never invented). */
export function pick(locale: string, en: string | null | undefined, ar: string | null | undefined): string | null {
  return (locale === "ar" ? ar : en) ?? null;
}

/** The note on automation screens: rules and jobs never decide a business approval. */
export function HumanDecisionNote() {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="human-decision-note">
      <Icon name="info" /> {t("workflowsP5.humanDecisionNote")}
    </p>
  );
}

/** A small labelled text form (reason, note) with one submit button; its value is checked for visible text. */
export function NoteForm({
  id,
  label,
  submitLabel,
  required,
  min = 1,
  max = 1000,
  busy,
  onSubmit,
  danger,
}: {
  id: string;
  label: string;
  submitLabel: string;
  required: boolean;
  min?: number;
  max?: number;
  busy: boolean;
  onSubmit: (value: string) => void;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="form form--inset"
      noValidate
      data-form={id}
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if ((required || v.length > 0) && (v.length < Math.max(min, 1) || v.length > max)) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        onSubmit(v);
      }}
    >
      <div className={`field${invalid ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor={`${id}-text`}>
          {label}
          {required ? <span className="field__required"> ({t("common.form.required")})</span> : null}
        </label>
        <textarea
          id={`${id}-text`}
          rows={2}
          maxLength={max}
          value={value}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(e) => setValue(e.target.value)}
        />
        {invalid ? (
          <span id={`${id}-error`} className="field__error">
            {t("workflowsP5.textLength", { min, max })}
          </span>
        ) : null}
      </div>
      <div className="form__actions">
        <button type="submit" className={`button ${danger ? "button--danger" : "button--primary"}`} disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
