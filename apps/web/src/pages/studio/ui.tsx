// Shared UI of the Studio, methodology-migration and source-coverage screens (T-DG5-FE-B): status chips that always
// carry a text label and an icon (never colour alone; blue never means favourable), and the guarded action runner every
// bodiless action uses (If-Match from the record the user saw, one form-level alert, session-bound; S-7).
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../api/client.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { FormAlert } from "../my-work/p4ui.tsx";
import { STUDIO_NS, type CheckStatus, type VersionState } from "./api.ts";

const STATE_ICON: Record<VersionState, IconName> = {
  editing: "pencil",
  preview: "pencil",
  review: "clock",
  approved: "check",
  discarded: "archive",
  published: "lock",
  newest_published: "lock",
  retired: "archive",
};

/** The version's state: "Draft — editing" … "Published (current)"; a draft never looks published. */
export function VersionStateChip({ state }: { state: VersionState }) {
  const { t } = useTranslation();
  const draft = !["published", "newest_published", "retired"].includes(state);
  return (
    <span
      className={`lifecycle-chip lifecycle-chip--${draft ? "draft" : state === "retired" ? "archived" : "active"}`}
      data-version-state={state}
    >
      <Icon name={STATE_ICON[state]} /> {t(`studio.state.${state}`)}
    </span>
  );
}

const CHECK_CHIP: Record<CheckStatus, { css: string; icon: IconName }> = {
  pass: { css: "on-track", icon: "check" },
  warn: { css: "at-risk", icon: "alert" },
  fail: { css: "off-track", icon: "cross" },
  not_run: { css: "unknown", icon: "question" },
  stale: { css: "stale", icon: "clock" },
};

/** A check result for the current content: Pass / Warning / Fail, or Not run / Stale (never green by default). */
export function CheckChip({ status }: { status: CheckStatus }) {
  const { t } = useTranslation();
  const c = CHECK_CHIP[status];
  return (
    <span className={`status-chip status-chip--${c.css}`} data-check={status}>
      <Icon name={c.icon} /> {t(`studio.check.status.${status}`)}
    </span>
  );
}

/** The configuration-only note: a Studio change is never a business approval or an engineering delivery gate. */
export function ConfigurationNote() {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="configuration-note">
      <Icon name="info" /> {t("studio.configurationNote")}
    </p>
  );
}

export interface ActionRunner {
  readonly busy: boolean;
  readonly error: unknown;
  readonly clear: () => void;
  /** Sends one action; on success or a 409/422 (the data changed) calls `refresh`. Returns the result or null. */
  run: <T>(
    url: string,
    options: { method?: "POST" | "PATCH" | "PUT"; body?: unknown; ifMatch?: number },
  ) => Promise<T | null>;
  /** The form-level alert of the actions (one per form; S-7). */
  readonly alert: ReactNode;
}

/** A guarded runner for bodiless actions and small updates, with the page's one form-level alert. */
export function useActionRunner(refresh: () => Promise<boolean>): ActionRunner {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async <T,>(
    url: string,
    options: { method?: "POST" | "PATCH" | "PUT"; body?: unknown; ifMatch?: number },
  ): Promise<T | null> => {
    const action = beginSessionGuard();
    setBusy(true);
    setError(null);
    try {
      const result = await api.send<T>(url, {
        method: options.method ?? "POST",
        ...(options.body === undefined ? {} : { body: options.body }),
        ...(options.ifMatch === undefined ? {} : { ifMatch: options.ifMatch }),
      });
      if (action.stale()) return null;
      if (!(await refresh())) return null;
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
    alert: <FormAlert error={error} namespaces={STUDIO_NS} />,
  };
}

/** The `code` of an API error (for tests and data attributes), or "". */
export const problemCodeOf = (e: unknown): string => (e instanceof ApiError ? (e.code ?? "") : "");
