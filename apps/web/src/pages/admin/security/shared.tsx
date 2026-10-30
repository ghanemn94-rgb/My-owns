// Shared UI of the P6 Administration screens of slices E, F, J and C (T-DG6-FE-B; p6-work-split §E/F.12, §J/C.13):
// Audit, Security and the upload policy, Sensitive grants, Operations and service identities, Identity, Storage and
// Notifications. Every screen reads the real API through the P6 client (api/p6.ts) and writes with If-Match through one
// session-bound runner (pages/automation/ui.tsx), with one form-level alert per form (p6-work-split §2 rule 7).
//  - The server decides every permission; the UI only hints. A 403 on a read shows the no-permission state, and a user
//    without the configuration permission (the auditor included) sees the page read-only, with no write control.
//  - Configuration here is technical. It never grants a business approval (product gates G1-G6 are business approvals;
//    the engineering delivery gates DG0-DG7 are not product features and are never shown).
//  - Credentials are SecretRefs (a provider and a name), never values (ADR-0052 §5, ADR-0054 §2-§3).
import { reasonRequest } from "@mth/shared/schemas";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Permission } from "@mth/shared";
import { canAnywhere } from "../../../auth/permissions.ts";
import { useMe } from "../../../auth/session.tsx";
import { isBlankText } from "../../../components/Form.tsx";
import { Icon } from "../../../components/Icon.tsx";

/** The caller's home organization: the organization every P6 administration read and write is scoped to. */
export function useHomeOrganizationId(): string {
  return useMe().user.organizationId;
}

/** True when the caller holds `permission` at some scope (a UI hint; the server re-checks every request). */
export function useCan(permission: Permission): boolean {
  return canAnywhere(useMe(), permission);
}

/** The read-only notice of a page whose writes the caller may not make (the auditor sees every page this way). */
export function ReadOnlyNote() {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="read-only">
      <Icon name="info" /> {t("adminP6.common.readOnly")}
    </p>
  );
}

/** Technical configuration never approves anything (no business, Finance or IT approval). */
export function NotApprovalNote({ text }: { text?: string }) {
  const { t } = useTranslation();
  return (
    <p className="small muted" data-state="not-approval">
      <Icon name="info" /> {text ?? t("adminP6.common.notApproval")}
    </p>
  );
}

/** A reason that passes the shared `reason` rule (3-1000 characters, visible text, no invalid character). */
export function isValidReason(value: string): boolean {
  return !isBlankText(value) && reasonRequest.safeParse({ reason: value }).success;
}

/** The labelled reason field of a configuration form; `invalid` shows the inline error. */
export function ReasonField({
  id,
  value,
  onChange,
  invalid,
  label,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={`field${invalid ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={id}>
        {label ?? t("adminP6.common.reason")}
        <span className="field__required"> ({t("common.form.required")})</span>
      </label>
      <p id={`${id}-hint`} className="field__hint">
        {t("adminP6.common.reasonHint")}
      </p>
      <textarea
        id={id}
        rows={2}
        maxLength={1000}
        value={value}
        aria-required
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-hint ${id}-error` : `${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
      />
      {invalid ? (
        <p id={`${id}-error`} className="field__error">
          <Icon name="alert" /> {t("adminP6.common.reasonInvalid")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Cursor paging of a one-page list (audit events, exceptions, grants, deliveries): "Next page" follows `nextCursor`,
 * "Back to first page" restarts. Never a silent "all pages" (ADR-0007 §4a).
 */
export function useCursorPager() {
  const [stack, setStack] = useState<string[]>([]);
  const cursor = stack.length ? stack[stack.length - 1]! : null;
  return {
    cursor,
    page: stack.length + 1,
    next: (nextCursor: string) => setStack((s) => [...s, nextCursor]),
    reset: () => setStack([]),
  };
}

export function CursorPagerControls({
  pager,
  nextCursor,
  busy,
}: {
  pager: ReturnType<typeof useCursorPager>;
  nextCursor: string | null | undefined;
  busy: boolean;
}) {
  const { t } = useTranslation();
  if (pager.page === 1 && !nextCursor) return null;
  return (
    <nav className="form__actions" aria-label={t("adminP6.common.pageNumber", { page: pager.page })}>
      <span className="small muted" aria-live="polite">
        {t("adminP6.common.pageNumber", { page: pager.page })}
      </span>
      {pager.page > 1 ? (
        <button type="button" className="button button--secondary button--small" onClick={pager.reset}>
          {t("adminP6.common.firstPage")}
        </button>
      ) : null}
      {nextCursor ? (
        <button
          type="button"
          className="button button--secondary button--small"
          disabled={busy}
          data-action="next-page"
          onClick={() => pager.next(nextCursor)}
        >
          {t("adminP6.common.nextPage")}
        </button>
      ) : null}
    </nav>
  );
}

/** A definition list row: a label and its value (a missing value is "—", never invented). */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <dt>{label}</dt>
      <dd>{children ?? t("adminP6.common.none")}</dd>
    </>
  );
}

/** A code or identifier shown left-to-right inside either direction. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className="code">
      {children}
    </bdi>
  );
}

/** A SecretRef (provider + name) form value; both empty means "no reference". */
export interface SecretRefValue {
  provider: string;
  name: string;
}
export const EMPTY_SECRET_REF: SecretRefValue = { provider: "", name: "" };
export const SECRET_PROVIDER_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
export const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_./-]{0,127}$/;

export function secretRefOrNull(v: SecretRefValue): { provider: string; name: string } | null {
  const provider = v.provider.trim();
  const name = v.name.trim();
  return provider || name ? { provider, name } : null;
}
export function isValidSecretRef(v: SecretRefValue, required: boolean): boolean {
  const ref = secretRefOrNull(v);
  if (!ref) return !required;
  return SECRET_PROVIDER_PATTERN.test(ref.provider) && SECRET_NAME_PATTERN.test(ref.name);
}

/** Two inputs for a SecretRef: a provider and a secret name. There is no field for a secret value. */
export function SecretRefFields({
  id,
  legend,
  value,
  onChange,
  invalid,
  disabled,
}: {
  id: string;
  legend: string;
  value: SecretRefValue;
  onChange: (v: SecretRefValue) => void;
  invalid: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className={`field${invalid ? " field--invalid" : ""}`} data-secret-ref={id} disabled={disabled}>
      <legend className="field__label">{legend}</legend>
      <label className="field__label" htmlFor={`${id}-provider`}>
        {t("adminP6.common.provider")}
      </label>
      <input
        id={`${id}-provider`}
        dir="ltr"
        autoComplete="off"
        value={value.provider}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange({ ...value, provider: e.target.value })}
      />
      <label className="field__label" htmlFor={`${id}-name`}>
        {t("adminP6.common.secretName")}
      </label>
      <input
        id={`${id}-name`}
        dir="ltr"
        autoComplete="off"
        value={value.name}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      {invalid ? (
        <p className="field__error">
          <Icon name="alert" /> {t("adminP6.storage.fieldInvalid")}
        </p>
      ) : null}
    </fieldset>
  );
}

/** The secret-reference explanation shown once per credential form. */
export function SecretRefNote() {
  const { t } = useTranslation();
  return (
    <p className="small muted" data-state="secret-ref-note">
      <Icon name="info" /> {t("adminP6.common.secretRefNote")}
    </p>
  );
}

/** The breadcrumbs of an Administration page. */
export function adminCrumbs(t: (k: string) => string, ...rest: { label: string; to?: string }[]) {
  return [{ label: t("nav.areas.admin.label"), to: "/admin" }, ...rest];
}

/**
 * The "Saved" confirmation of a configuration form. It lives in the page, not in the form: a save refreshes the record,
 * and the form is remounted on the new version (`key={version}`), which would otherwise drop the confirmation.
 */
export interface SavedNotice {
  readonly saved: boolean;
  readonly setSaved: (saved: boolean) => void;
}
export function useSavedNotice(): SavedNotice {
  const [saved, setSaved] = useState(false);
  return { saved, setSaved };
}
