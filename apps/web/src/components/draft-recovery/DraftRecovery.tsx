// Draft recovery on a form record editor (T-DG6-FE-D2; ADR-0057 §6, §9; ADR-0041 §5; REQ-S15-010 "unsaved drafts are
// recoverable" / "a draft survives a browser reload"; REQ-S15-011 "a draft is labelled 'Draft - not submitted' and
// never counted in approved totals").
//  - `DraftBadge`: the exact text "Draft - not submitted" (en; ar provisional), a neutral dashed chip with an icon.
//  - `RecordDraftRecovery`: on the record page, the caller's open draft of the record (listFormDrafts) is offered with
//    "Restore draft" and "Discard draft"; a draft whose record was saved by someone since (`baseChanged`) shows the
//    conflict state. While the editor is open its values are autosaved to the server draft (useDraftAutosave: at most
//    every 10 s, and on blur), so a browser reload or cleared browser storage loses nothing. Saving the record closes
//    the draft as "saved"; cancelling keeps it for recovery.
// A draft approves nothing; no G1-G6 business approval is granted or recorded here.
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../app/locale.ts";
import { formatDateTime } from "../../lib/format.ts";
import { errorMessage } from "../../lib/problem.ts";
import { Icon } from "../Icon.tsx";
import { formValuesOf, type FieldSpec, type FormValues } from "../RecordForm.tsx";
import { ConflictState } from "../States.tsx";
import {
  closeDraft,
  draftSourceFields,
  sourceFieldsPayload,
  useDraftRefresh,
  useRecordDraft,
  type FormDraft,
} from "./api.ts";
import { useDraftAutosave, type DraftAutosave } from "./useDraftAutosave.ts";
import "../compare/compare.css";

/** "Draft - not submitted" (REQ-S15-011, exact text). Never a status colour: a dashed neutral chip with an icon. */
export function DraftBadge() {
  const { t } = useTranslation();
  return (
    <span className="draft-badge" data-badge="draft-not-submitted">
      <Icon name="pencil" /> {t("productivity.drafts.badge")}
    </span>
  );
}

/** The changed text fields of the editor against the record as loaded (the draft body). */
function changedText(fields: readonly FieldSpec[], base: FormValues, values: FormValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.readOnly || f.createOnly) continue;
    const v = values[f.name];
    if (typeof v === "string" && v !== base[f.name]) out[f.name] = v;
  }
  return out;
}

/** What the editor receives from the draft session (spread into a RecordDialog or InlineRecordForm). */
export interface DraftEditorBinding {
  /** Re-mounts the form when a draft is restored (its values become the form's initial values). */
  readonly key: string;
  readonly initialValues: Readonly<Partial<FormValues>>;
  readonly onValuesChange: (values: FormValues) => void;
  /** Call once the record write succeeded: the draft closes as "saved". */
  readonly saved: () => Promise<void>;
  /** Call when the user leaves the editor without saving: the pending body is written; the draft stays. */
  readonly left: () => Promise<void>;
  /** The draft status line (badge, autosave state, restore offer); render it inside the form. */
  readonly status: ReactNode;
}

type Choice = "pending" | "restored" | "fresh";

export function RecordDraftRecovery<R extends { id: string; version: number }>(props: {
  tid: string;
  recordType: string;
  record: R;
  fields: readonly FieldSpec[];
  /** The record type's write permission in scope and the record is editable. Without it nothing is read or written. */
  enabled: boolean;
  editing: boolean;
  onEdit: (editing: boolean) => void;
  children: (binding: DraftEditorBinding) => ReactNode;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const refreshDrafts = useDraftRefresh();
  const query = useRecordDraft(props.tid, props.recordType, props.record.id, props.enabled);
  const open = query.data ?? null;
  const [startWith, setStartWith] = useState<Choice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const discard = async (draft: FormDraft) => {
    setBusy(true);
    setFailure(null);
    try {
      await closeDraft(props.tid, draft, "discarded");
      setNotice(t("productivity.drafts.discarded"));
      await refreshDrafts(props.tid);
    } catch (e) {
      setFailure(e);
      await refreshDrafts(props.tid);
    } finally {
      setBusy(false);
    }
  };

  const prompt =
    open && !props.editing ? (
      <DraftOffer
        draft={open}
        locale={locale}
        busy={busy}
        onRestore={() => {
          setNotice(null);
          setStartWith("restored");
          props.onEdit(true);
        }}
        onDiscard={() => void discard(open)}
      />
    ) : null;

  return (
    <>
      {prompt}
      {notice && !props.editing ? (
        <p className="banner banner--info" role="status" data-state="draft-notice">
          {notice}
        </p>
      ) : null}
      {failure && !props.editing ? (
        <p className="banner banner--error" role="alert">
          {errorMessage(t, failure)}
        </p>
      ) : null}
      {props.editing && props.enabled && !query.isPending ? (
        <DraftSession
          tid={props.tid}
          recordType={props.recordType}
          record={props.record}
          fields={props.fields}
          open={open}
          startWith={startWith ?? (open ? "pending" : "fresh")}
          onClosed={() => {
            setStartWith(null);
            void refreshDrafts(props.tid);
          }}
          onWritten={() => void refreshDrafts(props.tid)}
        >
          {props.children}
        </DraftSession>
      ) : props.editing && !props.enabled ? (
        props.children({
          key: "no-draft",
          initialValues: {},
          onValuesChange: () => undefined,
          saved: async () => undefined,
          left: async () => undefined,
          status: null,
        })
      ) : null}
    </>
  );
}

function DraftOffer({
  draft,
  locale,
  busy,
  onRestore,
  onDiscard,
  inline,
}: {
  draft: FormDraft;
  locale: "ar" | "en";
  busy: boolean;
  onRestore: () => void;
  onDiscard: () => void;
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const time = formatDateTime(draft.updatedAt, locale) ?? draft.updatedAt;
  return (
    <section
      className="banner banner--info draft-recovery"
      aria-label={t("productivity.drafts.recoveryTitle")}
      data-state="draft-open"
      data-draft={draft.id}
    >
      <p className="draft-status">
        <DraftBadge /> <strong>{t("productivity.drafts.recoveryTitle")}</strong>
      </p>
      <p>
        {draft.baseRecordVersion !== null
          ? t("productivity.drafts.recoveryBody", { time, version: draft.baseRecordVersion })
          : t("productivity.drafts.recoveryBodyNew", { time })}
      </p>
      {draft.baseChanged ? <ConflictState detail={t("productivity.drafts.baseChanged")} /> : null}
      <div className="form__actions">
        <button
          type="button"
          className={inline ? "button button--primary button--small" : "button button--primary"}
          onClick={onRestore}
          disabled={busy}
        >
          <Icon name="refresh" /> {t("productivity.drafts.restore")}
        </button>
        <button
          type="button"
          className={inline ? "button button--secondary button--small" : "button button--secondary"}
          onClick={onDiscard}
          disabled={busy}
        >
          {t("productivity.drafts.discard")}
        </button>
      </div>
    </section>
  );
}

function DraftSession<R extends { id: string; version: number }>(props: {
  tid: string;
  recordType: string;
  record: R;
  fields: readonly FieldSpec[];
  open: FormDraft | null;
  startWith: Choice;
  onClosed: () => void;
  onWritten: () => void;
  children: (binding: DraftEditorBinding) => ReactNode;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [choice, setChoice] = useState<Choice>(props.startWith);
  const [existing, setExisting] = useState<FormDraft | null>(props.open);
  const [generation, setGeneration] = useState(0);
  const base = useRef(formValuesOf(props.fields, props.record as unknown as Record<string, unknown>)).current;
  const autosave = useDraftAutosave({
    tid: props.tid,
    recordType: props.recordType,
    recordId: props.record.id,
    baseRecordVersion: props.record.version,
    existing,
    // Until the user chose (restore or discard), the open draft is not overwritten.
    enabled: choice !== "pending",
    onWritten: props.onWritten,
  });
  const restored: Partial<FormValues> =
    choice === "restored" && existing ? pickFields(props.fields, draftSourceFields(existing.payload)) : {};
  const [busy, setBusy] = useState(false);

  const status = (
    <div className="draft-session" data-draft-session={choice}>
      {choice === "pending" && existing ? (
        <DraftOffer
          draft={existing}
          locale={locale}
          busy={busy}
          inline
          onRestore={() => {
            setChoice("restored");
            setGeneration((g) => g + 1);
          }}
          onDiscard={() => {
            setBusy(true);
            void closeDraft(props.tid, existing, "discarded")
              .then(() => {
                setExisting(null);
                setChoice("fresh");
                props.onWritten();
              })
              .catch(() => props.onWritten())
              .finally(() => setBusy(false));
          }}
        />
      ) : (
        <AutosaveStatus autosave={autosave} restored={choice === "restored"} baseChanged={existing?.baseChanged} />
      )}
    </div>
  );

  return (
    <div
      className="draft-session-scope"
      // ADR-0057 §6: "and on blur". React's focus events bubble through the dialog portal to this wrapper.
      onBlur={() => void autosave.flush()}
    >
      {props.children({
        key: `draft-${generation}`,
        initialValues: restored,
        onValuesChange: (values) => {
          if (choice === "pending") return;
          autosave.schedule(sourceFieldsPayload(changedText(props.fields, base, values)));
        },
        saved: async () => {
          await autosave.close("saved");
          props.onClosed();
        },
        left: async () => {
          await autosave.flush();
          props.onClosed();
        },
        status: (
          <>
            {status}
            {choice === "restored" ? (
              <p className="small" role="status">
                {t("productivity.drafts.restored")}
              </p>
            ) : null}
          </>
        ),
      })}
    </div>
  );
}

function pickFields(fields: readonly FieldSpec[], values: Record<string, string>): Partial<FormValues> {
  const names = new Set(fields.filter((f) => !f.readOnly && !f.createOnly).map((f) => f.name));
  return Object.fromEntries(Object.entries(values).filter(([k]) => names.has(k)));
}

function AutosaveStatus({
  autosave,
  restored,
  baseChanged,
}: {
  autosave: DraftAutosave;
  restored: boolean;
  baseChanged: boolean | undefined;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const hasDraft = autosave.draft !== null;
  return (
    <>
      {restored && baseChanged ? <ConflictState detail={t("productivity.drafts.baseChanged")} /> : null}
      <p className="draft-status" role="status" aria-live="polite" data-autosave={autosave.state}>
        {hasDraft ? <DraftBadge /> : null}
        {autosave.state === "saving" ? (
          <span>{t("productivity.drafts.autosaveSaving")}</span>
        ) : autosave.state === "error" ? (
          <span>
            <Icon name="alert" /> {t("productivity.drafts.autosaveError")} {errorMessage(t, autosave.error)}
          </span>
        ) : hasDraft && autosave.savedAt ? (
          <span>
            {t("productivity.drafts.autosaveSaved", { time: formatDateTime(autosave.savedAt, locale) ?? "" })}
          </span>
        ) : (
          <span className="muted">{t("productivity.drafts.autosaveIdle")}</span>
        )}
      </p>
    </>
  );
}
