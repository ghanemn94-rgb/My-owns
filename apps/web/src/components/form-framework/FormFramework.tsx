// The common form framework on one record (T-DG5-FE-C; ADR-0041 §5; REQ-S05-001): inline help, validation, draft
// saving, version history, comments, attachments and the recoverable conflict, over BE-D/BE-E/BE-E2's operations.
// Adopted on T01 (diagnostic item) and T14 (benefit). Rules (p5-work-split §2):
//  - one form-level alert per form; every write is session-bound (S-7) and carries If-Match from what the user saw;
//  - a saved draft is labelled "Draft saved — not submitted" and never looks like saved record data;
//  - a 409 shows the user's values next to the current ones and re-applies them on the current version;
//  - a missing value is Unknown and a calculated field with a missing input is Not computable, never 0;
//  - AUD and every user without the record type's write permission see read-only views (the server answers 403).
// A draft, a comment or an attachment approves nothing: no G1-G6 business approval is granted or recorded here.
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../api/client.ts";
import { p5Paths, useP5Refresh } from "../../api/p5.ts";
import { useRegister } from "../../api/queries.ts";
import type { Evidence } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { formatDateTime } from "../../lib/format.ts";
import { fieldErrorMessage } from "../../lib/problem.ts";
import { FormAlert } from "../../pages/my-work/p4ui.tsx";
import { Unknown } from "../Badges.tsx";
import { Field } from "../Form.tsx";
import { Icon } from "../Icon.tsx";
import { ConflictPanel, ErrorState, QueryState, type ConflictRow } from "../States.tsx";
import {
  changedFieldLabels,
  currencyCodeOf,
  draftOfRecord,
  enterableExtensionFields,
  helpOf,
  isVersionConflict,
  labelOf,
  parseBody,
  readDraftPayload,
  sameValue,
  threadsOf,
  useAttachments,
  useComments,
  useCustomValues,
  useOpenDrafts,
  usePinnedSchema,
  useVersions,
  valueFromText,
  valueToText,
  type FormCustomValues,
  type FormDraft,
  type FormField,
  type FormRecordAttachment,
  type FormSchema,
} from "./api.ts";
import { ExtensionBadge } from "./ExtensionBadge.tsx";

/** One source field of the record's own update request that the framework editor offers (the adopter's register). */
export interface SourceFieldSpec {
  /** The request body name of the register's PATCH (e.g. `rootCause`). */
  readonly name: string;
  readonly label: string;
  readonly kind: "text" | "textarea" | "select";
  readonly options?: readonly { value: string; label: string }[];
  /** The form schema key of the source column (e.g. `root_cause`), for its inline help. */
  readonly schemaKey?: string;
}

export interface FormFrameworkProps {
  readonly tid: string;
  /** The `form_record_type` code, e.g. T01 or T14. */
  readonly recordType: string;
  readonly recordId: string;
  /** The record's name for headings and screen readers. */
  readonly recordLabel: string;
  /** The current saved representation of the record (its `version` is the If-Match of the register update). */
  readonly record: { readonly version: number } & Readonly<Record<string, unknown>>;
  readonly sourceFields: readonly SourceFieldSpec[];
  /** The register's own update URL (PATCH; its DG2-DG4 route and validation, unchanged). */
  readonly updateUrl: string;
  /** The record type's write permission in scope (drafts, extension values, attachments). */
  readonly canWrite: boolean;
  /** `form_record.comment` in scope. */
  readonly canComment: boolean;
  /** Re-reads the record after a write or a conflict; false when the session changed meanwhile. */
  readonly refreshRecord: () => Promise<boolean>;
  /** The transformation currency (default of a currency field). */
  readonly currency: string;
}

type TabId = "edit" | "history" | "comments" | "attachments";
const TABS: readonly TabId[] = ["edit", "history", "comments", "attachments"];

/** A session-bound writer with the form's one alert. */
function useWriter() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const send = async <T,>(
    url: string,
    options: { method: "POST" | "PUT" | "PATCH"; body?: unknown; ifMatch?: number },
  ): Promise<{ ok: true; data: T } | { ok: false; error: unknown } | null> => {
    const action = beginSessionGuard();
    setBusy(true);
    setError(null);
    try {
      const data = await api.send<T>(url, options);
      if (action.stale()) return null;
      return { ok: true, data };
    } catch (e) {
      if (action.stale(e)) return null;
      setError(e);
      return { ok: false, error: e };
    } finally {
      if (action.current()) setBusy(false);
    }
  };
  return { busy, error, setError, send };
}

/** The framework panel: four tabs (edit and drafts, version history, comments, attachments) of one record. */
export function FormFramework(props: FormFrameworkProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>("edit");
  const baseId = useId();
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    edit: null,
    history: null,
    comments: null,
    attachments: null,
  });
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.indexOf(tab);
    const rtl = document.documentElement.dir === "rtl";
    const next =
      e.key === (rtl ? "ArrowLeft" : "ArrowRight")
        ? TABS[(i + 1) % TABS.length]
        : e.key === (rtl ? "ArrowRight" : "ArrowLeft")
          ? TABS[(i + TABS.length - 1) % TABS.length]
          : e.key === "Home"
            ? TABS[0]
            : e.key === "End"
              ? TABS[TABS.length - 1]
              : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  return (
    <div className="form-framework" data-form-framework={props.recordType} data-record-id={props.recordId}>
      <p className="muted small">{t("forms.framework.intro")}</p>
      <div role="tablist" aria-label={t("forms.framework.tabs.label")} className="ff-tabs" onKeyDown={onKey}>
        {TABS.map((id) => (
          <button
            key={id}
            ref={(el) => {
              tabRefs.current[id] = el;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${id}`}
            aria-controls={`${baseId}-panel-${id}`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            className={"ff-tabs__tab"}
            onClick={() => setTab(id)}
          >
            {t(`forms.framework.tabs.${id}`)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${tab}`}
        aria-labelledby={`${baseId}-tab-${tab}`}
        className="form-framework__panel"
        data-panel={tab}
      >
        {tab === "edit" ? <EditTab {...props} /> : null}
        {tab === "history" ? <HistoryTab {...props} /> : null}
        {tab === "comments" ? <CommentsTab {...props} /> : null}
        {tab === "attachments" ? <AttachmentsTab {...props} /> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ edit and drafts

function EditTab(props: FormFrameworkProps) {
  // The notice lives here: saving or discarding a draft re-keys the form (a new or no draft), and the message stays.
  const [notice, setNotice] = useState<string | null>(null);
  const schema = usePinnedSchema(props.tid, props.recordType);
  const custom = useCustomValues(props.tid, props.recordType, props.recordId);
  const drafts = useOpenDrafts(props.tid, props.recordType);
  return (
    <QueryState query={schema}>
      {(rawSchema) => (
        <QueryState query={custom}>
          {(rawCustom) => (
            <QueryState query={drafts}>
              {(rawDrafts) => {
                const s = parseBody("schema", rawSchema);
                const c = parseBody("custom", rawCustom);
                const d = parseBody("drafts", rawDrafts);
                if (!s.ok) return <ErrorState error={s.error} />;
                if (!c.ok) return <ErrorState error={c.error} />;
                if (!d.ok) return <ErrorState error={d.error} />;
                const draft = draftOfRecord(d.value, props.recordId);
                return (
                  <EditForm
                    key={draft?.id ?? "no-draft"}
                    {...props}
                    schema={s.value}
                    custom={c.value}
                    draft={draft}
                    notice={notice}
                    setNotice={setNotice}
                  />
                );
              }}
            </QueryState>
          )}
        </QueryState>
      )}
    </QueryState>
  );
}

interface Values {
  readonly source: Record<string, string>;
  readonly custom: Record<string, string>;
  readonly currency: Record<string, string>;
}

const sourceText = (record: FormFrameworkProps["record"], name: string): string => {
  const v = record[name];
  return v === null || v === undefined ? "" : String(v);
};

function savedValues(props: FormFrameworkProps, fields: readonly FormField[], custom: FormCustomValues): Values {
  return {
    source: Object.fromEntries(props.sourceFields.map((f) => [f.name, sourceText(props.record, f.name)])),
    custom: Object.fromEntries(fields.map((f) => [f.key, valueToText(f, custom.values[f.key])])),
    currency: Object.fromEntries(
      fields
        .filter((f) => f.fieldType === "currency")
        .map((f) => [f.key, currencyCodeOf(f, custom.values[f.key], props.currency)]),
    ),
  };
}

function EditForm(
  props: FormFrameworkProps & {
    schema: FormSchema;
    custom: FormCustomValues;
    draft: FormDraft | null;
    notice: string | null;
    setNotice: (notice: string | null) => void;
  },
) {
  const { t } = useTranslation();
  const locale = useLocale();
  const refreshP5 = useP5Refresh(props.tid);
  const writer = useWriter();
  const fields = enterableExtensionFields(props.schema);
  const calculated = props.schema.fields.filter((f) => f.extension && f.fieldType === "calculated");
  const saved = savedValues(props, fields, props.custom);
  const fromDraft = props.draft ? readDraftPayload(props.draft.payload) : null;
  // `edits` holds what the user typed (or the reopened draft); `base` the saved values the user started from. A field
  // is the user's change when its edit differs from its base; every other field shows the current saved value, so a
  // re-read after a 409 never sends another user's change back with the user's stale copy (re-apply on current).
  const [base, setBase] = useState<Values>(saved);
  const [edits, setEdits] = useState<Values>(() =>
    fromDraft
      ? {
          source: { ...saved.source, ...fromDraft.sourceFields },
          custom: { ...saved.custom, ...fromDraft.customFieldValues },
          currency: { ...saved.currency, ...fromDraft.currencyCodes },
        }
      : saved,
  );
  const mineSource = (name: string) => (edits.source[name] ?? "") !== (base.source[name] ?? "");
  const mineCustom = (key: string) =>
    (edits.custom[key] ?? "") !== (base.custom[key] ?? "") ||
    (edits.currency[key] ?? "") !== (base.currency[key] ?? "");
  const values: Values = {
    source: Object.fromEntries(
      props.sourceFields.map((f) => [
        f.name,
        mineSource(f.name) ? (edits.source[f.name] ?? "") : (saved.source[f.name] ?? ""),
      ]),
    ),
    custom: Object.fromEntries(
      fields.map((f) => [f.key, mineCustom(f.key) ? (edits.custom[f.key] ?? "") : (saved.custom[f.key] ?? "")]),
    ),
    currency: Object.fromEntries(
      fields
        .filter((f) => f.fieldType === "currency")
        .map((f) => [
          f.key,
          mineCustom(f.key) ? (edits.currency[f.key] ?? props.currency) : (saved.currency[f.key] ?? props.currency),
        ]),
    ),
  };
  const editSource = (name: string, value: string) =>
    setEdits((prev) => ({ ...prev, source: { ...prev.source, [name]: value } }));
  const editCustom = (key: string, value: string) =>
    setEdits((prev) => ({ ...prev, custom: { ...prev.custom, [key]: value } }));
  const editCurrency = (key: string, value: string) =>
    setEdits((prev) => ({ ...prev, currency: { ...prev.currency, [key]: value } }));
  const resetTo = (v: Values) => {
    setBase(v);
    setEdits(v);
  };
  const { notice, setNotice } = props;
  const [conflict, setConflict] = useState<{ yourVersion: number; currentVersion: number | null } | null>(null);
  const readOnly = !props.canWrite;
  const helpByKey = new Map(props.schema.fields.map((f) => [f.key, f]));

  const refreshAll = async () => (await refreshP5()) && (await props.refreshRecord());

  const sourceChanges = (): Record<string, string | null> =>
    Object.fromEntries(
      props.sourceFields
        .filter((f) => mineSource(f.name) && values.source[f.name] !== saved.source[f.name])
        .map((f) => [f.name, values.source[f.name]?.trim() === "" ? null : (values.source[f.name] ?? null)]),
    );
  const customRequest = (v: Values): Record<string, unknown> =>
    Object.fromEntries(
      fields.map((f) => [f.key, valueFromText(f, v.custom[f.key] ?? "", v.currency[f.key] ?? props.currency)]),
    );
  const customChanged = (): boolean => {
    const mine = customRequest(values);
    return fields.some((f) => mineCustom(f.key) && !sameValue(mine[f.key], props.custom.values[f.key] ?? null));
  };
  const draftPayload = () => ({
    sourceFields: Object.fromEntries(
      props.sourceFields.filter((f) => mineSource(f.name)).map((f) => [f.name, values.source[f.name]]),
    ),
    customFieldValues: Object.fromEntries(
      fields.filter((f) => mineCustom(f.key)).map((f) => [f.key, values.custom[f.key]]),
    ),
    currencyCodes: Object.fromEntries(Object.entries(values.currency).filter(([k]) => mineCustom(k))),
  });

  const saveDraft = async () => {
    setNotice(null);
    const payload = draftPayload();
    const r = props.draft
      ? await writer.send(p5Paths.formDraft(props.tid, props.draft.id), {
          method: "PUT",
          body: { payload },
          ifMatch: props.draft.version,
        })
      : await writer.send(p5Paths.formDrafts(props.tid), {
          method: "POST",
          body: {
            recordType: props.recordType,
            recordId: props.recordId,
            baseRecordVersion: props.record.version,
            payload,
          },
        });
    if (!r) return;
    if (r.ok) {
      setNotice(t("forms.edit.draftSaved"));
      await refreshP5();
    } else if (r.error instanceof ApiError && r.error.status === 409) await refreshP5();
  };

  const discardDraft = async () => {
    if (!props.draft) return;
    setNotice(null);
    const r = await writer.send(p5Paths.closeFormDraft(props.tid, props.draft.id), {
      method: "POST",
      body: { reason: "discarded" },
      ifMatch: props.draft.version,
    });
    if (r?.ok) {
      resetTo(saved);
      setConflict(null);
      setNotice(t("forms.edit.draftDiscarded"));
      await refreshP5();
    }
  };

  const save = async () => {
    setNotice(null);
    const changes = sourceChanges();
    const customDirty = customChanged();
    if (Object.keys(changes).length === 0 && !customDirty) {
      setNotice(t("forms.edit.nothingChanged"));
      return;
    }
    if (Object.keys(changes).length > 0) {
      const r = await writer.send(props.updateUrl, { method: "PATCH", body: changes, ifMatch: props.record.version });
      if (!r) return;
      if (!r.ok) {
        if (isVersionConflict(r.error)) {
          setConflict({ yourVersion: props.record.version, currentVersion: r.error.currentVersion });
          await refreshAll();
        }
        return;
      }
    }
    if (customDirty) {
      const r = await writer.send(p5Paths.formCustomFields(props.tid, props.recordType, props.recordId), {
        method: "PUT",
        body: { values: customRequest(values) },
        ifMatch: props.custom.version,
      });
      if (!r) return;
      if (!r.ok) {
        if (isVersionConflict(r.error)) {
          setConflict({ yourVersion: props.custom.version, currentVersion: r.error.currentVersion });
          await refreshAll();
        }
        return;
      }
    }
    if (props.draft) {
      // The record write succeeded: the draft closes as saved (ADR-0041 §5). Its own failure leaves the record saved.
      await writer.send(p5Paths.closeFormDraft(props.tid, props.draft.id), {
        method: "POST",
        body: { reason: "saved" },
        ifMatch: props.draft.version,
      });
    }
    setConflict(null);
    // What was sent is now saved: the user has no pending change, and every field follows the saved record.
    resetTo(values);
    setNotice(t("forms.edit.saved"));
    await refreshAll();
  };

  // The comparison of a 409 or of a draft whose base moved: the user's values next to the current saved ones.
  const unknownText = t("common.value.unknown");
  const conflictRows: ConflictRow[] = [
    ...props.sourceFields
      .filter((f) => mineSource(f.name) && values.source[f.name] !== saved.source[f.name])
      .map((f) => ({
        field: f.name,
        label: f.label,
        mine: values.source[f.name] || unknownText,
        current: saved.source[f.name] || unknownText,
      })),
    ...fields
      .filter((f) => mineCustom(f.key) && values.custom[f.key] !== saved.custom[f.key])
      .map((f) => ({
        field: f.key,
        label: labelOf(locale, f),
        mine: values.custom[f.key] || unknownText,
        current: saved.custom[f.key] || unknownText,
      })),
  ];
  const baseChanged = props.draft?.baseChanged === true;

  return (
    <form
      className="form"
      noValidate
      data-draft-state={props.draft ? (baseChanged ? "open-base-changed" : "open") : "none"}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="muted small">{t("forms.edit.intro")}</p>
      {readOnly ? (
        <p className="banner banner--info" role="note">
          <Icon name="lock" /> {t("forms.framework.readOnly")}
        </p>
      ) : null}
      {props.draft ? (
        <p className="banner banner--info" role="status" data-state="draft-open">
          <Icon name="pencil" />{" "}
          {t("forms.edit.draftOpen", { at: formatDateTime(props.draft.updatedAt, locale) ?? props.draft.updatedAt })}
        </p>
      ) : null}
      {conflict || baseChanged ? (
        <ConflictPanel
          yourVersion={conflict?.yourVersion ?? props.draft?.baseRecordVersion ?? props.record.version}
          currentVersion={conflict?.currentVersion ?? props.record.version}
          rows={conflictRows}
          busy={writer.busy}
          {...(readOnly ? {} : { onReapply: () => void save() })}
          onDiscard={() => {
            if (props.draft) void discardDraft();
            else {
              resetTo(saved);
              setConflict(null);
            }
          }}
        />
      ) : null}
      {baseChanged && !conflict ? (
        <p className="small" data-state="base-changed">
          <Icon name="alert" /> {t("forms.edit.baseChanged", { base: props.draft?.baseRecordVersion ?? "" })}
        </p>
      ) : null}
      {/* One form-level alert (S-7): while the conflict view is shown, it is the alert of this form. */}
      <FormAlert error={conflict ? null : writer.error} namespaces={["forms"]} />
      {notice ? (
        <p className="banner banner--info" role="status" data-state="notice">
          <Icon name="info" /> {notice}
        </p>
      ) : null}

      <fieldset className="ff-fieldset" disabled={readOnly}>
        <legend>{t("forms.edit.sourceTitle")}</legend>
        {props.sourceFields.map((f) => {
          const sf = f.schemaKey ? helpByKey.get(f.schemaKey) : undefined;
          const help = sf ? helpOf(locale, sf) : null;
          const error = fieldErrorFor(t, writer.error, `/${f.name}`);
          return (
            <Field key={f.name} label={f.label} hint={help ?? undefined} error={error}>
              {(control) =>
                f.kind === "select" ? (
                  <select
                    {...control}
                    value={values.source[f.name] ?? ""}
                    onChange={(e) => editSource(f.name, e.target.value)}
                  >
                    <option value="">{unknownText}</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.kind === "textarea" ? (
                  <textarea
                    {...control}
                    rows={3}
                    value={values.source[f.name] ?? ""}
                    onChange={(e) => editSource(f.name, e.target.value)}
                  />
                ) : (
                  <input
                    {...control}
                    type="text"
                    value={values.source[f.name] ?? ""}
                    onChange={(e) => editSource(f.name, e.target.value)}
                  />
                )
              }
            </Field>
          );
        })}
      </fieldset>

      <fieldset className="ff-fieldset" disabled={readOnly} data-extension-fields={fields.length}>
        <legend>{t("forms.edit.extensionTitle")}</legend>
        {fields.length === 0 && calculated.length === 0 ? (
          <p className="muted small" data-state="no-extensions">
            {t("forms.edit.noExtensions")}
          </p>
        ) : null}
        {fields.map((f) => (
          <ExtensionInput
            key={f.key}
            field={f}
            text={values.custom[f.key] ?? ""}
            currencyCode={values.currency[f.key] ?? props.currency}
            error={fieldErrorFor(t, writer.error, `/values/${f.key}`)}
            onText={(v) => editCustom(f.key, v)}
            onCurrency={(v) => editCurrency(f.key, v)}
          />
        ))}
        {calculated.map((f) => {
          const c = props.custom.calculated[f.key];
          return (
            <p key={f.key} className="small" data-calculated={f.key}>
              <strong>{labelOf(locale, f)}</strong> <ExtensionBadge recordType={props.recordType} describe={false} />
              {": "}
              {c && c.status === "computed" && c.value !== null ? (
                <span dir="ltr">{c.value}</span>
              ) : (
                <Unknown hint={t("forms.edit.notComputable", { fields: (c?.missingFields ?? []).join(", ") })} />
              )}
            </p>
          );
        })}
      </fieldset>

      {readOnly ? null : (
        <div className="form__actions">
          <button type="submit" className="button button--primary" disabled={writer.busy}>
            {t("forms.edit.save")}
          </button>
          <button
            type="button"
            className="button button--secondary"
            disabled={writer.busy}
            onClick={() => void saveDraft()}
          >
            {props.draft ? t("forms.edit.updateDraft") : t("forms.edit.saveDraft")}
          </button>
          {props.draft ? (
            <button
              type="button"
              className="button button--secondary"
              disabled={writer.busy}
              onClick={() => void discardDraft()}
            >
              {t("forms.edit.discardDraft")}
            </button>
          ) : null}
        </div>
      )}
    </form>
  );
}

/** The translated message of the server's field error at `pointer` (400 field codes of ADR-0041 §10), if any. */
function fieldErrorFor(t: TFunction, error: unknown, pointer: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const fe = error.fieldErrors.find((e) => e.pointer === pointer);
  return fe ? fieldErrorMessage(t, fe.code) : undefined;
}

function ExtensionInput({
  field,
  text,
  currencyCode,
  error,
  onText,
  onCurrency,
}: {
  field: FormField;
  text: string;
  currencyCode: string;
  error: string | undefined;
  onText: (v: string) => void;
  onCurrency: (v: string) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const help = helpOf(locale, field);
  const hint = [help, t(`forms.edit.typeHint.${field.fieldType}`)].filter(Boolean).join(" ");
  const options = Array.isArray(field.settings["options"])
    ? (field.settings["options"] as { value: string; labelEn: string; labelAr: string }[])
    : [];
  const label = labelOf(locale, field);
  return (
    <div data-extension-field={field.key}>
      <Field label={label} hint={hint} error={error} required={field.required}>
        {(control) =>
          field.fieldType === "choice" && field.settings["multiple"] !== true ? (
            <select {...control} value={text} onChange={(e) => onText(e.target.value)}>
              <option value="">{t("common.value.unknown")}</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {labelOf(locale, o)}
                </option>
              ))}
            </select>
          ) : field.fieldType === "rich_text" ? (
            <textarea {...control} rows={3} value={text} onChange={(e) => onText(e.target.value)} />
          ) : (
            <input
              {...control}
              type={field.fieldType === "date" ? "date" : "text"}
              inputMode={["number", "currency", "percentage"].includes(field.fieldType) ? "decimal" : undefined}
              dir={
                ["number", "currency", "percentage", "date", "reference", "attachment"].includes(field.fieldType)
                  ? "ltr"
                  : undefined
              }
              value={text}
              onChange={(e) => onText(e.target.value)}
            />
          )
        }
      </Field>
      {field.fieldType === "currency" ? (
        <Field label={`${label}: ${t("forms.edit.currencyCode")}`}>
          {(control) => (
            <input
              {...control}
              type="text"
              dir="ltr"
              maxLength={3}
              value={currencyCode}
              onChange={(e) => onCurrency(e.target.value.toUpperCase())}
            />
          )}
        </Field>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ history

function HistoryTab(props: FormFrameworkProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const versions = useVersions(props.tid, props.recordType, props.recordId);
  const schema = usePinnedSchema(props.tid, props.recordType);
  const parsedSchema = parseBody("schema", schema.data);
  const labelSchema = parsedSchema.ok ? parsedSchema.value : undefined;
  return (
    <QueryState
      query={versions}
      isEmpty={(v) => v.length === 0}
      empty={<p className="muted">{t("forms.history.empty")}</p>}
    >
      {(raw) => {
        const parsed = parseBody("versions", raw);
        if (!parsed.ok) return <ErrorState error={parsed.error} />;
        const list = parsed.value;
        return (
          <table className="table table--compact" data-history-rows={list.length}>
            <caption>{t("forms.history.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("forms.history.version")}</th>
                <th scope="col">{t("forms.history.action")}</th>
                <th scope="col">{t("forms.history.actor")}</th>
                <th scope="col">{t("forms.history.when")}</th>
                <th scope="col">{t("forms.history.fields")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v, i) => (
                <tr key={`${v.occurredAt}-${i}`} data-version={v.version ?? ""}>
                  <th scope="row">{v.version ?? <Unknown />}</th>
                  <td>
                    <code dir="ltr">{v.action}</code>
                  </td>
                  <td>{v.actorDisplayName ?? t("forms.history.unknownActor")}</td>
                  <td>{formatDateTime(v.occurredAt, locale) ?? v.occurredAt}</td>
                  <td>
                    {v.changedFields.length === 0
                      ? t("forms.history.noFields")
                      : changedFieldLabels(v.changedFields, labelSchema, locale).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      }}
    </QueryState>
  );
}

// ------------------------------------------------------------------------------------------------ comments

function CommentsTab(props: FormFrameworkProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const comments = useComments(props.tid, props.recordType, props.recordId);
  const refresh = useP5Refresh(props.tid);
  const writer = useWriter();
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const post = async (text: string, parentCommentId: string | null) => {
    setNotice(null);
    const r = await writer.send(p5Paths.formRecordComments(props.tid, props.recordType, props.recordId), {
      method: "POST",
      body: parentCommentId ? { body: text, parentCommentId } : { body: text },
    });
    if (r?.ok) {
      if (parentCommentId) {
        setReplyTo(null);
        setReplyBody("");
      } else setBody("");
      setNotice(t("forms.comments.posted"));
      await refresh();
    }
  };
  const meta = (c: { createdByDisplayName: string | null; createdAt: string }) =>
    t("forms.comments.by", {
      name: c.createdByDisplayName ?? t("forms.history.unknownActor"),
      at: formatDateTime(c.createdAt, locale) ?? c.createdAt,
    });
  return (
    <div>
      <FormAlert error={writer.error} namespaces={["forms"]} />
      {notice ? (
        <p className="banner banner--info" role="status">
          <Icon name="check" /> {notice}
        </p>
      ) : null}
      <QueryState
        query={comments}
        isEmpty={(c) => c.length === 0}
        empty={<p className="muted">{t("forms.comments.empty")}</p>}
      >
        {(raw) => {
          const parsed = parseBody("comments", raw);
          if (!parsed.ok) return <ErrorState error={parsed.error} />;
          const list = parsed.value;
          return (
            <ol className="ff-comments" data-comment-count={list.length}>
              {threadsOf(list).map(({ comment, replies }) => (
                <li key={comment.id} data-comment-id={comment.id}>
                  <p className="small muted">{meta(comment)}</p>
                  <p className="ff-pre">{comment.body}</p>
                  {replies.length > 0 ? (
                    <ol className="ff-comments ff-comments--replies" aria-label={t("forms.comments.replies")}>
                      {replies.map((r) => (
                        <li key={r.id} data-comment-id={r.id} data-reply-to={comment.id}>
                          <p className="small muted">{meta(r)}</p>
                          <p className="ff-pre">{r.body}</p>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {props.canComment ? (
                    replyTo === comment.id ? (
                      <form
                        className="form"
                        noValidate
                        onSubmit={(e) => {
                          e.preventDefault();
                          void post(replyBody, comment.id);
                        }}
                      >
                        <Field label={t("forms.comments.replyLabel")} hint={t("forms.comments.hint")}>
                          {(control) => (
                            <textarea
                              {...control}
                              rows={2}
                              maxLength={4000}
                              value={replyBody}
                              onChange={(e) => setReplyBody(e.target.value)}
                            />
                          )}
                        </Field>
                        <div className="form__actions">
                          <button type="submit" className="button button--primary" disabled={writer.busy}>
                            {t("forms.comments.postReply")}
                          </button>
                          <button type="button" className="button button--secondary" onClick={() => setReplyTo(null)}>
                            {t("forms.comments.cancelReply")}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="button button--link button--small"
                        onClick={() => {
                          setReplyTo(comment.id);
                          setReplyBody("");
                        }}
                      >
                        {t("forms.comments.reply")}
                      </button>
                    )
                  ) : null}
                </li>
              ))}
            </ol>
          );
        }}
      </QueryState>
      {props.canComment ? (
        <form
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void post(body, null);
          }}
        >
          <Field label={t("forms.comments.label")} hint={t("forms.comments.hint")}>
            {(control) => (
              <textarea {...control} rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
            )}
          </Field>
          <div className="form__actions">
            <button type="submit" className="button button--primary" disabled={writer.busy}>
              {t("forms.comments.post")}
            </button>
          </div>
        </form>
      ) : (
        <p className="muted small" role="note">
          <Icon name="lock" /> {t("forms.comments.noPermission")}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ attachments

function AttachmentsTab(props: FormFrameworkProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const attachments = useAttachments(props.tid, props.recordType, props.recordId, includeRemoved);
  const evidence = useRegister<Evidence>(props.tid, "evidence", {}, props.canWrite);
  const refresh = useP5Refresh(props.tid);
  const writer = useWriter();
  const [chosen, setChosen] = useState("");
  const [removing, setRemoving] = useState<FormRecordAttachment | null>(null);
  const [reason, setReason] = useState("");
  const showRemovedId = useId();
  const titleOf = (a: FormRecordAttachment) =>
    a.evidenceTitle ?? t("forms.attachments.untitled", { ref: a.evidenceId.slice(-4) });

  const attach = async () => {
    if (!chosen) return;
    const r = await writer.send(p5Paths.formRecordAttachments(props.tid, props.recordType, props.recordId), {
      method: "POST",
      body: { evidenceId: chosen },
    });
    if (r?.ok) {
      setChosen("");
      await refresh();
    }
  };
  const remove = async () => {
    if (!removing) return;
    const r = await writer.send(
      p5Paths.removeFormRecordAttachment(props.tid, props.recordType, props.recordId, removing.id),
      { method: "POST", body: { reason }, ifMatch: removing.version },
    );
    if (r?.ok) {
      setRemoving(null);
      setReason("");
      await refresh();
    } else if (r && r.error instanceof ApiError && (r.error.status === 409 || r.error.status === 422)) await refresh();
  };

  return (
    <div>
      <FormAlert error={writer.error} namespaces={["forms"]} />
      <p>
        <input
          id={showRemovedId}
          type="checkbox"
          checked={includeRemoved}
          onChange={(e) => setIncludeRemoved(e.target.checked)}
        />{" "}
        <label htmlFor={showRemovedId}>{t("forms.attachments.showRemoved")}</label>
      </p>
      <QueryState
        query={attachments}
        isEmpty={(a) => a.length === 0}
        empty={<p className="muted">{t("forms.attachments.empty")}</p>}
      >
        {(raw) => {
          const parsed = parseBody("attachments", raw);
          if (!parsed.ok) return <ErrorState error={parsed.error} />;
          const list = parsed.value;
          return (
            <table className="table table--compact" data-attachment-count={list.length}>
              <caption>{t("forms.attachments.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("forms.attachments.evidence")}</th>
                  <th scope="col">{t("forms.attachments.status")}</th>
                  <th scope="col">{t("forms.attachments.attached")}</th>
                  <th scope="col">{t("forms.attachments.store")}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t("common.field.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} data-attachment-id={a.id} data-status={a.status}>
                    <th scope="row">{titleOf(a)}</th>
                    <td>
                      {a.status === "active" ? (
                        <span className="lifecycle-chip lifecycle-chip--active">
                          <Icon name="check" /> {t("forms.attachments.active")}
                        </span>
                      ) : (
                        <span className="lifecycle-chip lifecycle-chip--archived">
                          <Icon name="archive" />{" "}
                          {t("forms.attachments.removedReason", { reason: a.removeReason ?? "" })}
                        </span>
                      )}
                    </td>
                    <td>{formatDateTime(a.createdAt, locale) ?? a.createdAt}</td>
                    <td>
                      {a.store === "evidence_link"
                        ? t("forms.attachments.storeEvidenceLink")
                        : t("forms.attachments.storeFormRecord")}
                    </td>
                    <td>
                      {props.canWrite && a.status === "active" ? (
                        <button
                          type="button"
                          className="button button--link button--small"
                          onClick={() => {
                            setRemoving(a);
                            setReason("");
                            writer.setError(null);
                          }}
                        >
                          {t("forms.attachments.remove")}
                          <span className="visually-hidden">: {titleOf(a)}</span>
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }}
      </QueryState>
      {removing ? (
        <form
          className="form card"
          noValidate
          aria-label={t("forms.attachments.removeTitle", { title: titleOf(removing) })}
          onSubmit={(e) => {
            e.preventDefault();
            void remove();
          }}
        >
          <h3>{t("forms.attachments.removeTitle", { title: titleOf(removing) })}</h3>
          <Field
            label={t("forms.attachments.reason")}
            hint={t("forms.attachments.reasonHint")}
            required
            error={fieldErrorFor(t, writer.error, "/reason")}
          >
            {(control) => (
              <textarea
                {...control}
                rows={2}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
          <div className="form__actions">
            <button type="submit" className="button button--danger" disabled={writer.busy}>
              {t("forms.attachments.confirmRemove")}
            </button>
            <button type="button" className="button button--secondary" onClick={() => setRemoving(null)}>
              {t("common.action.cancel")}
            </button>
          </div>
        </form>
      ) : null}
      {props.canWrite ? (
        <AttachForm
          evidence={evidence.data ?? []}
          chosen={chosen}
          busy={writer.busy}
          onChoose={setChosen}
          onAttach={() => void attach()}
        />
      ) : (
        <p className="muted small" role="note">
          <Icon name="lock" /> {t("forms.framework.readOnly")}
        </p>
      )}
    </div>
  );
}

function AttachForm({
  evidence,
  chosen,
  busy,
  onChoose,
  onAttach,
}: {
  evidence: readonly Evidence[];
  chosen: string;
  busy: boolean;
  onChoose: (id: string) => void;
  onAttach: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const active = evidence.filter((e) => (e as { status?: string }).status !== "archived");
  if (active.length === 0) return <p className="muted small">{t("forms.attachments.noEvidence")}</p>;
  return (
    <form
      className="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onAttach();
      }}
    >
      <Field label={t("forms.attachments.choose")} hint={t("forms.attachments.chooseHint")}>
        {(control) => (
          <select {...control} value={chosen} onChange={(e) => onChoose(e.target.value)}>
            <option value="">{t("forms.attachments.none")}</option>
            {active.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={busy || !chosen}>
          {t("forms.attachments.attach")}
        </button>
      </div>
    </form>
  );
}
