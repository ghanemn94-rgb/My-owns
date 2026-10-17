// Extension fields on every native form (T-DG5-FE-C2; D-163; F-DG5-QA-A-2; ADR-0041 §1, §4, §5; REQ-S06-004, A06):
// the pinned form version's extension fields in a record's CREATE form and on its record VIEW, through the framework's
// own field component (`ExtensionInput`). Editing an existing record's extension values is the framework's edit tab
// (`FormToolsButton` / `FormFramework`), which carries If-Match, drafts, history and the recoverable conflict.
//  - Create: the register's own create runs first (its DG2-DG4 route, unchanged); the extension values of the new
//    record are then stored with `putFormRecordCustomFields` and `If-Match: "0"` (a create of the custom-value row).
//    The values are checked before the record is created with the API's own validators, so a refusal stops the create.
//    A refusal the web cannot foresee (a reference, attachment or lookup checked in the server's transaction) leaves the
//    record created without those values and says so, with the problem code's text; nothing is retried silently.
//  - View: each extension value in the language of the screen; a missing value is Unknown and a calculated field with
//    a missing input is Not computable, never 0 or green.
// No G1-G6 business approval is granted or recorded here.
import { useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import type { Permission } from "@mth/shared";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.ts";
import { p5Paths, useP5Refresh } from "../../api/p5.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { FormAlert } from "../../pages/my-work/p4ui.tsx";
import { Unknown } from "../Badges.tsx";
import { issueCode } from "../Form.tsx";
import { Icon } from "../Icon.tsx";
import {
  checkExtensionValue,
  currencyCodeOf,
  enterableExtensionFields,
  labelOf,
  parseBody,
  useCustomValues,
  usePinnedSchema,
  valueFromText,
  valueToText,
  type FormField,
} from "./api.ts";
import { FD } from "@mth/shared/calc";
import { extensionFieldError, ExtensionInput } from "./FormFramework.tsx";
import { FormToolsButton } from "./FormToolsButton.tsx";
import type { RegisterColumn } from "../RegisterTable.tsx";
import { useWorkspace } from "../Workspace.tsx";

export interface ExtensionEntry {
  /** The extension inputs of a create form (render inside the dialog); null while the form has none. */
  readonly node: ReactNode;
  /** Checks the entered values with the shared validators; false (and the messages shown) when one is refused. */
  readonly check: () => boolean;
  /** After the register created the record: stores its extension values (If-Match "0"). Nothing entered: no write. */
  readonly afterCreate: (created: unknown) => Promise<boolean>;
  /** The outcome of a create whose extension values were refused by the server (render in the register section). */
  readonly outcome: ReactNode;
  /** True when the pinned form version has extension fields (the record view shows them to every reader). */
  readonly hasFields: boolean;
  /**
   * The create schema of a `RecordDialog` with the extension check added: the register's own issues are kept, and a
   * refused extension value stops the create (its message is shown on its field; the form says "not valid").
   */
  readonly guard: (schema?: z.ZodType) => z.ZodType;
}

/** The id of a created record from the register's create response (`{ id }`). */
const createdId = (created: unknown): string | null =>
  created && typeof created === "object" && "id" in created && typeof (created as { id: unknown }).id === "string"
    ? (created as { id: string }).id
    : null;

/**
 * The extension fields of a create form of `recordType` in transformation `tid` (one hook per register; the dialog
 * renders `node`, its body builder calls `check()`, its done handler `afterCreate(result)`; the register renders
 * `outcome`). The entered values reset each time the inputs are shown anew (a new create dialog).
 */
export function useExtensionEntry(
  tid: string,
  recordType: string,
  currency: string,
  /** The user's permissions in scope: without the record type's write permission no input is offered (403). */
  can?: (permission: Permission) => boolean,
): ExtensionEntry {
  const { t } = useTranslation();
  const schema = usePinnedSchema(tid, recordType);
  const refreshP5 = useP5Refresh(tid);
  const parsed = schema.data === undefined ? null : parseBody("schema", schema.data);
  const writePermission = parsed?.ok ? parsed.value.recordType.writePermission : null;
  const allowed = !can || !writePermission || can(writePermission as Permission);
  const shown = parsed?.ok ? parsed.value.fields.filter((f) => f.extension) : [];
  const fields = parsed?.ok && allowed ? enterableExtensionFields(parsed.value) : [];
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [currencies, setCurrencies] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const codeOf = (f: FormField) => currencies[f.key] ?? currencyCodeOf(f, null, currency);
  const reset = () => {
    setTexts({});
    setCurrencies({});
    setErrors({});
  };

  const check = (): boolean => {
    const next: Record<string, string> = {};
    for (const f of fields) {
      const r = checkExtensionValue(f, texts[f.key] ?? "", codeOf(f));
      if (!r.ok) next[f.key] = r.code;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const afterCreate = async (created: unknown): Promise<boolean> => {
    const id = createdId(created);
    if (!id || fields.length === 0) return true;
    const values = Object.fromEntries(fields.map((f) => [f.key, valueFromText(f, texts[f.key] ?? "", codeOf(f))]));
    if (Object.values(values).every((v) => v === null)) {
      reset();
      return true;
    }
    const action = beginSessionGuard();
    try {
      await api.send(p5Paths.formCustomFields(tid, recordType, id), { method: "PUT", body: { values }, ifMatch: 0 });
      if (action.stale()) return false;
      setFailure(null);
      reset();
      await refreshP5();
      return true;
    } catch (e) {
      if (action.stale(e)) return false;
      setFailure(e);
      return false;
    }
  };

  const node =
    fields.length === 0 ? null : (
      <CreateFields
        recordType={recordType}
        fields={fields}
        texts={texts}
        errors={errors}
        codeOf={codeOf}
        onText={(k, v) => setTexts((p) => ({ ...p, [k]: v }))}
        onCurrency={(k, v) => setCurrencies((p) => ({ ...p, [k]: v }))}
        onShown={() => {
          reset();
          setFailure(null);
        }}
      />
    );

  const outcome =
    failure === null ? null : (
      <div className="form-framework__outcome" data-state="extension-save-failed">
        <p className="banner banner--info" role="status">
          <Icon name="alert" /> {t("forms.extensions.createdWithoutValues")}
        </p>
        <FormAlert error={failure} namespaces={["forms"]} />
      </div>
    );

  const guard = (schema?: z.ZodType): z.ZodType =>
    z.unknown().superRefine((value, ctx) => {
      const base = schema?.safeParse(value);
      if (base && !base.success)
        for (const issue of base.error.issues)
          ctx.addIssue({ code: "custom", message: issueCode(issue), path: issue.path });
      if (!check()) ctx.addIssue({ code: "custom", message: "validation.invalid", path: ["extensionFields"] });
    });

  return { node, check, afterCreate, outcome, hasFields: shown.length > 0, guard };
}

function CreateFields(props: {
  recordType: string;
  fields: readonly FormField[];
  texts: Record<string, string>;
  errors: Record<string, string>;
  codeOf: (f: FormField) => string;
  onText: (key: string, v: string) => void;
  onCurrency: (key: string, v: string) => void;
  onShown: () => void;
}) {
  const { t } = useTranslation();
  const { onShown } = props;
  // A new create dialog starts empty (the values of an earlier, cancelled dialog are not carried over).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onShown(), []);
  return (
    <fieldset
      className="ff-fieldset"
      data-extension-create={props.recordType}
      data-extension-fields={props.fields.length}
    >
      <legend>{t("forms.edit.extensionTitle")}</legend>
      <p className="muted small">{t("forms.extensions.createIntro")}</p>
      {props.fields.map((f) => (
        <ExtensionInput
          key={f.key}
          field={f}
          text={props.texts[f.key] ?? ""}
          currencyCode={props.codeOf(f)}
          error={extensionFieldError(t, props.errors[f.key], f, props.texts[f.key] ?? "", props.codeOf(f))}
          onText={(v) => props.onText(f.key, v)}
          onCurrency={(v) => props.onCurrency(f.key, v)}
        />
      ))}
    </fieldset>
  );
}

// ------------------------------------------------------------------------------------------------ record view

/** One stored extension value as text in the screen's language (choice labels; percentages as percents). */
export function extensionValueText(field: FormField, value: unknown, locale: "en" | "ar"): string | null {
  if (value === null || value === undefined) return null;
  if (field.fieldType === "currency" && typeof value === "object" && !Array.isArray(value)) {
    const v = value as { amount?: unknown; currencyCode?: unknown };
    return `${String(v.amount ?? "")} ${String(v.currencyCode ?? "")}`.trim();
  }
  if (field.fieldType === "percentage" && typeof value === "string") {
    try {
      return `${new FD(value).times(100).toFixed()}%`;
    } catch {
      return value;
    }
  }
  if (field.fieldType === "choice") {
    const options = Array.isArray(field.settings["options"])
      ? (field.settings["options"] as { value: string; labelEn: string; labelAr: string }[])
      : [];
    const one = (x: unknown) => {
      const o = options.find((p) => p.value === x);
      return o ? labelOf(locale, o) : String(x);
    };
    return Array.isArray(value) ? value.map(one).join(", ") : one(value);
  }
  return valueToText(field, value);
}

/**
 * The extension values of one record, read-only (the record view): nothing at all while the pinned form version has
 * no extension field (no per-record read is made then), else every extension field with its value, Unknown or Not
 * computable.
 */
export function ExtensionValues({ tid, recordType, recordId }: { tid: string; recordType: string; recordId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const schema = usePinnedSchema(tid, recordType);
  const parsed = schema.data === undefined ? null : parseBody("schema", schema.data);
  const fields = parsed?.ok ? parsed.value.fields.filter((f) => f.extension) : [];
  const custom = useCustomValues(tid, recordType, fields.length > 0 ? recordId : "");
  if (fields.length === 0) return null;
  const c = custom.data === undefined ? null : parseBody("custom", custom.data);
  return (
    <dl className="extension-values small" data-extension-values={recordType} data-record-id={recordId}>
      {fields.map((f) => {
        const calc = c?.ok ? c.value.calculated[f.key] : undefined;
        const text =
          f.fieldType === "calculated"
            ? calc && calc.status === "computed"
              ? calc.value
              : null
            : c?.ok
              ? extensionValueText(f, c.value.values[f.key], locale)
              : null;
        return (
          <div key={f.key} data-extension-value={f.key}>
            <dt>{labelOf(locale, f)}</dt>
            <dd>
              {custom.isError || (c && !c.ok) ? (
                <span className="muted">{t("forms.extensions.valuesUnavailable")}</span>
              ) : custom.isLoading ? (
                <span className="muted">{t("common.state.loading")}</span>
              ) : text === null || text === "" ? (
                <Unknown
                  {...(f.fieldType === "calculated"
                    ? { hint: t("forms.edit.notComputable", { fields: (calc?.missingFields ?? []).join(", ") }) }
                    : {})}
                />
              ) : (
                <bdi dir={["text", "rich_text", "choice"].includes(f.fieldType) ? "auto" : "ltr"}>{text}</bdi>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

// ------------------------------------------------------------------------------------------------ workspace hosts

/** `useExtensionEntry` of the current transformation workspace (its id and currency). */
export function useExtensionCreate(recordType: string): ExtensionEntry {
  const ws = useWorkspace();
  return useExtensionEntry(ws.tid, recordType, ws.tr.currency, ws.can);
}

/**
 * The extension part of one record in a register (T-DG5-FE-C2): its extension values (the record view; nothing while
 * the form has none) and the Form tools entry that edits them in the framework (If-Match, drafts, history, comments,
 * attachments, the recoverable conflict). The record's own fields stay in the register's own edit dialog.
 */
export function RecordExtensionTools({
  recordType,
  record,
  recordLabel,
  canWrite,
  refresh,
  view = true,
}: {
  recordType: string;
  record: { readonly id: string; readonly version: number };
  recordLabel: string;
  canWrite: boolean;
  refresh: () => Promise<unknown>;
  view?: boolean;
}) {
  const ws = useWorkspace();
  // Form tools is offered to users who can write or comment; every reader sees the values in the record view.
  const canComment = ws.can("form_record.comment");
  return (
    <span className="record-extensions" data-record-extensions={recordType}>
      {view ? <ExtensionValues tid={ws.tid} recordType={recordType} recordId={record.id} /> : null}
      {canWrite || canComment ? (
        <FormToolsButton
          tid={ws.tid}
          recordType={recordType}
          recordId={record.id}
          recordLabel={recordLabel}
          record={record as { readonly version: number } & Readonly<Record<string, unknown>>}
          sourceFields={[]}
          updateUrl=""
          canWrite={canWrite}
          canComment={canComment}
          refreshRecord={async () => (await refresh()) !== false}
          currency={ws.tr.currency}
        />
      ) : null}
    </span>
  );
}

/**
 * The register column of a record's extension part (`RecordExtensionTools`): its extension values and its Form tools
 * entry. Not hideable (it carries the record's form actions).
 */
export function extensionToolsColumn<R extends { readonly id: string; readonly version: number }>(
  header: string,
  recordType: string,
  opts: { label: (r: R) => string; canWrite: (r: R) => boolean; refresh: () => Promise<unknown> },
): RegisterColumn<R> {
  return {
    id: "formTools",
    header,
    hideable: false,
    cell: (r) => (
      <RecordExtensionTools
        recordType={recordType}
        record={r}
        recordLabel={opts.label(r)}
        canWrite={opts.canWrite(r)}
        refresh={opts.refresh}
      />
    ),
  };
}
