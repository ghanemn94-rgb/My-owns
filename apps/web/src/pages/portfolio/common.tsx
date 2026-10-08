// Shared pieces of the FE-A portfolio screens (T-DG3-FE-A; ADR-0021 §2-§3, REQ-S09-003, REQ-PB-045).
//  - Initiative status, selection and funding are three SEPARATE presentations (REQ-S09-003). The funding column says
//    Funded, 'Selected - unfunded' or None; a status chip is neutral (lifecycle), never green.
//  - Warnings (deliverable count outside 3-7, no gap link, no owner) are hints, never blocks (ADR-0021 §3).
//  - `ActionDialog` is the one dialog of every transition, removal and business decision on these screens: a labelled
//    text field (reason, rationale or note), the blank-text rule, If-Match, and the server's 409/422 translated from the
//    code as the dialog's ONE alert (the English `detail` is never shown). Business approvals are labelled as such.
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { hasText } from "@mth/shared/schemas";
import { api, ApiError } from "../../api/client.ts";
import type { Initiative, RoadmapWave } from "../../api/types.ts";
import type { Locale } from "@mth/shared";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { BLANK_CODE, Dialog, Field, isBlankText, REQUIRED_CODE, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { errorMessage, fieldErrorMessage, problemKey } from "../../lib/problem.ts";

/** i18n key part of a problem or warning code inside an FE-A namespace: dots become "__" (as `problemKey`). */
export const codeKey = (code: string) => code.replace(/\./g, "__");

/**
 * Translated message of a problem on the FE-A screens. The screen's own namespace first (`<ns>.problem.<code>`), then
 * the shared catalogue (`problems.*`, statuses, network). The server's English `detail` is never returned.
 */
export function p3ProblemMessage(t: TFunction, error: unknown, namespaces: readonly string[] = ["portfolio"]): string {
  if (error instanceof ApiError && error.code) {
    const codes = [error.code, ...error.fieldErrors.map((fe) => fe.code)];
    for (const code of codes)
      for (const ns of namespaces) {
        const own = t(`${ns}.problem.${codeKey(code)}`, { defaultValue: "" });
        if (own) return own;
      }
    if (t(problemKey(error.code), { defaultValue: "" })) return t(problemKey(error.code));
  }
  return errorMessage(t, error);
}

/** Portfolio problem codes (initiative.read_only, initiative.planned_range, …) are translated specifically in forms. */
export const PORTFOLIO_NS: readonly string[] = ["portfolio"];

/** Proposed rank / selection / funding: the three columns of REQ-S09-003. */
export const SELECTED_STATUSES: ReadonlySet<string> = new Set(["selected", "funded", "launched", "completed"]);

/** The status label: 'Selected - unfunded' whenever `selected` has no approved current funding (ADR-0021 §3). */
export function statusLabel(t: TFunction, i: Pick<Initiative, "status" | "fundingState">): string {
  if (i.status === "selected" && i.fundingState !== "funded") return t("portfolio.status.selected_unfunded");
  return t(`portfolio.status.${i.status}`);
}

const STATUS_ICON: Record<string, "pencil" | "clock" | "dot" | "check" | "stop" | "cross"> = {
  draft: "pencil",
  submitted: "clock",
  ranked: "dot",
  selected: "dot",
  funded: "dot",
  launched: "dot",
  completed: "stop",
  cancelled: "cross",
};

/** Neutral lifecycle chip (icon + text). A draft is visibly a draft, not a submitted record. */
export function InitiativeStatusChip({ initiative }: { initiative: Pick<Initiative, "status" | "fundingState"> }) {
  const { t } = useTranslation();
  return (
    <span
      className={`lifecycle-chip${initiative.status === "draft" ? " lifecycle-chip--draft" : ""}`}
      data-initiative-status={initiative.status}
    >
      <Icon name={STATUS_ICON[initiative.status] ?? "dot"} /> {statusLabel(t, initiative)}
    </span>
  );
}

export function SelectionCell({ initiative }: { initiative: Pick<Initiative, "status"> }) {
  const { t } = useTranslation();
  return SELECTED_STATUSES.has(initiative.status) ? (
    <span data-selection="selected">
      <Icon name="check" /> {t("portfolio.selection.selected")}
    </span>
  ) : (
    <span className="muted" data-selection="not_selected">
      {t("portfolio.selection.notSelected")}
    </span>
  );
}

/** Funded, 'Selected - unfunded' (also after a revoked funding) or None: never inferred from selection alone. */
export function FundingCell({ initiative }: { initiative: Pick<Initiative, "status" | "fundingState"> }) {
  const { t } = useTranslation();
  if (initiative.fundingState === "funded")
    return (
      <span data-funding="funded">
        <Icon name="check" /> {t("portfolio.funding.funded")}
      </span>
    );
  if (initiative.fundingState === "unfunded" || initiative.fundingState === "revoked")
    return (
      <span data-funding={initiative.fundingState}>
        <Icon name="alert" /> {t("portfolio.funding.selectedUnfunded")}
        {initiative.fundingState === "revoked" ? (
          <span className="block small muted">{t("portfolio.funding.revoked")}</span>
        ) : null}
      </span>
    );
  return (
    <span className="muted" data-funding="none" aria-label={t("portfolio.funding.noneLabel")}>
      —
    </span>
  );
}

/** Warnings of an initiative (ADR-0021 §3): translated from their codes; hints, never a block. */
export function WarningList({
  warnings,
  compact = false,
}: {
  warnings: readonly { code: string }[];
  compact?: boolean;
}) {
  const { t } = useTranslation();
  if (warnings.length === 0) return compact ? <span className="muted">{t("portfolio.warning.none")}</span> : null;
  return (
    <ul className={`plain-list warning-list${compact ? " small" : ""}`}>
      {warnings.map((w) => (
        <li key={w.code} data-warning={w.code}>
          <Icon name="alert" />{" "}
          {t(`portfolio.warning.${codeKey(w.code)}`, { defaultValue: t("portfolio.warning.generic") })}
        </li>
      ))}
    </ul>
  );
}

export function waveName(w: RoadmapWave | undefined, locale: Locale): string | null {
  if (!w) return null;
  return locale === "ar" ? w.nameAr : w.nameEn;
}

/** A labelled "business approval" chip: selection, funding, dispensation and G4 decisions (never DG0-DG7). */
export function BusinessApprovalTag() {
  const { t } = useTranslation();
  return (
    <span className="lifecycle-chip" data-business-approval="true">
      <Icon name="lock" /> {t("portfolio.businessApproval")}
    </span>
  );
}

export interface ActionDialogProps {
  title: string;
  description?: ReactNode;
  /** Shown as "Business approval" with its explanation when the action is a business approval. */
  businessApproval?: boolean;
  /** The text field: its label, request property and whether it is required (min 3 for reasons and rationales). */
  text: { label: string; name: string; required: boolean; min?: number; max: number; hint?: string };
  /** Extra controls rendered before the text field (e.g. accept/reject). Their own errors are passed in `extraError`. */
  extra?: ReactNode;
  /** Validates the extra controls; returns an error code to stop the request. */
  validateExtra?: () => string | null;
  confirmLabel: string;
  danger?: boolean;
  url: string;
  /** POST (transitions, decisions; the default) or PATCH (e.g. archiving a deliverable with its `archiveReason`). */
  method?: "POST" | "PATCH";
  version: number;
  /** Builds the body from the text (an empty optional text is omitted). */
  toBody?: (text: string | undefined) => Record<string, unknown>;
  namespaces?: readonly string[];
  /** Called after success and after a 409/422 (the data changed or must be re-read). Returns false if stale. */
  onDone: () => Promise<boolean>;
  onClose: () => void;
}

/** One transition / decision dialog: one text field, one form-level alert, the 409 conflict reload. */
export function ActionDialog(props: ActionDialogProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [fieldCode, setFieldCode] = useState<string | undefined>();
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);
  const { text: spec } = props;

  const submit = async () => {
    setServerError(null);
    const extraCode = props.validateExtra?.() ?? null;
    let code: string | undefined;
    if (isBlankText(text)) code = BLANK_CODE;
    else if (spec.required && text === "") code = REQUIRED_CODE;
    else if (text !== "" && spec.min !== undefined && [...text.trim()].length < spec.min) code = "validation.too_small";
    setFieldCode(code);
    if (code || extraCode) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      const value = text === "" || !hasText(text) ? undefined : text;
      const body = props.toBody ? props.toBody(value) : value === undefined ? {} : { [spec.name]: value };
      await api.send(props.url, { method: props.method ?? "POST", body, ifMatch: props.version });
      if (action.stale()) return;
      if (!(await props.onDone())) return;
      props.onClose();
    } catch (e) {
      if (action.stale(e)) return;
      const onField = e instanceof ApiError ? e.fieldErrors.find((fe) => fe.pointer === `/${spec.name}`) : undefined;
      if (onField && !t(`portfolio.problem.${codeKey(onField.code)}`, { defaultValue: "" })) {
        setFieldCode(onField.code);
        focusInvalid();
      } else setServerError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await props.onDone();
    } finally {
      setBusy(false);
    }
  };

  const conflict = serverError instanceof ApiError && serverError.status === 409;
  return (
    <Dialog
      title={props.title}
      onClose={props.onClose}
      dialogRef={dialogRef}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={props.onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button
            type="button"
            className={`button ${props.danger ? "button--danger" : "button--primary"}`}
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? t("common.state.saving") : props.confirmLabel}
          </button>
        </>
      }
    >
      {props.businessApproval ? (
        <p className="banner banner--info" role="note" data-state="business-approval">
          <Icon name="lock" /> <strong>{t("portfolio.businessApproval")}</strong>
          {": "}
          {t("portfolio.businessApprovalBody")}
        </p>
      ) : null}
      {props.description ? <div className="dialog__description">{props.description}</div> : null}
      {serverError ? (
        <div
          className="banner banner--error"
          role="alert"
          data-state={conflict ? "conflict" : "error"}
          data-problem={serverError instanceof ApiError ? (serverError.code ?? "") : ""}
        >
          <p>
            <Icon name="alert" /> {p3ProblemMessage(t, serverError, props.namespaces)}
          </p>
          {conflict ? <p className="small">{t("portfolio.conflictReloaded")}</p> : null}
        </div>
      ) : null}
      {props.extra}
      <Field
        label={spec.label}
        hint={spec.hint}
        error={fieldCode === undefined ? undefined : fieldErrorMessage(t, fieldCode)}
        required={spec.required}
      >
        {(control) => (
          <textarea {...control} rows={4} maxLength={spec.max} value={text} onChange={(e) => setText(e.target.value)} />
        )}
      </Field>
    </Dialog>
  );
}
