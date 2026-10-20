// Administration > Form builder > one form (T-DG5-FE-C; ADR-0041 §2-§3; REQ-S05-002, REQ-S05-006): the fields of one
// native form in a chosen `form_schema` version (`getFormSchemaAdmin`). Source columns are protected: the methodology
// administrator may relabel them, add help and mark them required, but a delete is refused by the server (422
// form_schema.source_column_protected, shown in en/ar) and a type change is not offered. Extension fields (the eleven
// field types) are added, edited and removed only in an open draft (`putConfigElement` / `removeConfigElement`,
// If-Match on the draft) and reach transformations only when the draft is published through the Studio pipeline.
// AUD and every reader without methodology.configure see a read-only view. Configuration only: never a G1-G6 business
// approval and never DG0-DG7.
import { FIELD_TYPES } from "@mth/shared/calc";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { p5Paths, useConfigVersions, useStudioRefresh, type ConfigVersion } from "../../api/p5.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { ExtensionBadge } from "../../components/form-framework/ExtensionBadge.tsx";
import {
  FORMS_NS,
  helpOf,
  labelOf,
  titleOf,
  useAdminSchema,
  type FormField,
  type FormSchema,
} from "../../components/form-framework/api.ts";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { QueryState } from "../../components/States.tsx";
import { TableScrollRegion } from "../../components/TableScrollRegion.tsx";
import { ReadOnlyNote, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import { isEditableDraft, versionState } from "../studio/api.ts";
import { StudioFormDialog } from "../studio/StudioFormDialog.tsx";
import { ConfigurationNote, useActionRunner, VersionStateChip } from "../studio/ui.tsx";

export function FormSchemaPage() {
  const { t } = useTranslation();
  const { recordType = "" } = useParams();
  const versions = useConfigVersions({ kind: "form_schema" });
  const [chosen, setChosen] = useState<string | null>(null);
  usePageTitle(t("nav.p5.formSchema.title"));
  return (
    <div className="page" data-p5-screen="form-schema" data-record-type={recordType}>
      <PageHeader
        title={t("nav.p5.formSchema.title")}
        subtitle={t("nav.p5.formSchema.summary")}
        crumbs={[
          { label: t("nav.areas.admin.label"), to: "/admin" },
          { label: t("forms.builder.title"), to: "/admin/forms" },
          { label: recordType },
        ]}
      />
      <ConfigurationNote />
      <QueryState query={versions}>
        {(list) => {
          const sorted = [...list].sort((a, b) => b.versionNo - a.versionNo);
          const fallback =
            sorted.find((v) => isEditableDraft(v)) ?? sorted.find((v) => v.isNewestPublished) ?? sorted[0] ?? null;
          const version = sorted.find((v) => v.id === chosen) ?? fallback;
          return (
            <>
              <VersionPicker versions={sorted} version={version} onChoose={setChosen} />
              <SchemaBody recordType={recordType} version={version} />
            </>
          );
        }}
      </QueryState>
    </div>
  );
}

function VersionPicker({
  versions,
  version,
  onChoose,
}: {
  versions: readonly ConfigVersion[];
  version: ConfigVersion | null;
  onChoose: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="card section">
      <Field label={t("forms.schema.version")} hint={t("forms.schema.versionHint")}>
        {(control) => (
          <select {...control} value={version?.id ?? ""} onChange={(e) => onChoose(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {t("forms.schema.versionOption", { no: v.versionNo, state: t(`studio.state.${versionState(v)}`) })}
              </option>
            ))}
          </select>
        )}
      </Field>
      {version ? (
        <p>
          <VersionStateChip state={versionState(version)} />{" "}
          <Link className="link" to={`/admin/studio/versions/${version.id}`}>
            {t("forms.schema.openStudio")}
          </Link>
        </p>
      ) : null}
      {version && !isEditableDraft(version) ? (
        <p className="muted small" data-state="read-only-version">
          <Icon name="lock" /> {t("forms.schema.readOnlyVersion")} {t("forms.schema.draftNeeded")}
        </p>
      ) : null}
    </div>
  );
}

type Dialog = { kind: "add" } | { kind: "edit"; field: FormField } | { kind: "remove"; field: FormField } | null;

function SchemaBody({ recordType, version }: { recordType: string; version: ConfigVersion | null }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const schema = useAdminSchema(recordType, version?.id ?? null);
  const refresh = useStudioRefresh();
  const runner = useActionRunner(refresh);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canConfigure = canAnywhere(me, "methodology.configure");
  const editable = canConfigure && version !== null && isEditableDraft(version);
  return (
    <QueryState query={schema}>
      {(s) => {
        const rt = s.recordType;
        const formTitle = titleOf(locale, rt);
        return (
          <section className="card section" aria-labelledby="form-schema-title" data-editable={editable}>
            <div className="card__header section__header">
              <h2 id="form-schema-title" className="card__title">
                {formTitle} {rt.extensionBadge ? <ExtensionBadge recordType={rt.code} /> : null}
              </h2>
              {editable && rt.customFieldsAllowed && rt.featureStatus === "working" ? (
                <div className="section__actions">
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => {
                      setNotice(null);
                      setDialog({ kind: "add" });
                    }}
                  >
                    <Icon name="plus" /> {t("forms.schema.addField")}
                  </button>
                </div>
              ) : null}
            </div>
            {helpOf(locale, s) ? <p className="section__intro muted">{helpOf(locale, s)}</p> : null}
            {rt.featureStatus === "planned" ? (
              <p className="banner banner--info" role="note">
                <Icon name="clock" /> {t("forms.schema.planned")}
              </p>
            ) : null}
            {!rt.customFieldsAllowed ? <p className="muted small">{t("forms.schema.noExtensionsAllowed")}</p> : null}
            {editable ? (
              <p className="banner banner--info" role="note" data-state="editable-draft">
                <Icon name="pencil" /> {t("forms.schema.editableDraft")}
              </p>
            ) : canConfigure ? null : (
              <ReadOnlyNote />
            )}
            {runner.alert}
            {notice ? (
              <p className="banner banner--info" role="status" data-state="notice">
                <Icon name="check" /> {notice}
              </p>
            ) : null}
            <FieldsTable
              schema={s}
              editable={editable}
              onEdit={(field) => {
                setNotice(null);
                runner.clear();
                setDialog({ kind: "edit", field });
              }}
              onRemove={(field) => {
                setNotice(null);
                runner.clear();
                setDialog({ kind: "remove", field });
              }}
            />
            {dialog && version && (dialog.kind === "add" || dialog.kind === "edit") ? (
              <FieldDialog
                schema={s}
                version={version}
                field={dialog.kind === "edit" ? dialog.field : null}
                refresh={async () => {
                  const ok = await refresh();
                  if (ok) setNotice(t("forms.schema.saved"));
                  return ok;
                }}
                onClose={() => setDialog(null)}
              />
            ) : null}
            {dialog && version && dialog.kind === "remove" ? (
              <RemoveDialog
                field={dialog.field}
                busy={runner.busy}
                onConfirm={async () => {
                  const done = await runner.run(
                    p5Paths.removeConfigElement(version.id, "form_field", `${rt.code}.${dialog.field.key}`),
                    { ifMatch: version.version },
                  );
                  setDialog(null);
                  if (done) setNotice(t("forms.schema.removed"));
                }}
                onClose={() => setDialog(null)}
              />
            ) : null}
          </section>
        );
      }}
    </QueryState>
  );
}

function FieldsTable({
  schema,
  editable,
  onEdit,
  onRemove,
}: {
  schema: FormSchema;
  editable: boolean;
  onEdit: (f: FormField) => void;
  onRemove: (f: FormField) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  // A wide field table scrolls in its own focusable, named region, never the page (F-DG5-146, D-176).
  return (
    <TableScrollRegion caption={t("forms.schema.caption")}>
      <table className="table" data-field-count={schema.fields.length}>
        <caption>{t("forms.schema.caption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("forms.schema.label")}</th>
            <th scope="col">{t("forms.schema.key")}</th>
            <th scope="col">{t("forms.schema.type")}</th>
            <th scope="col">{t("forms.schema.origin")}</th>
            <th scope="col">{t("forms.schema.required")}</th>
            <th scope="col">{t("forms.schema.help")}</th>
            {editable ? <th scope="col">{t("common.field.actions")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {schema.fields.map((f) => (
            <tr key={f.key} data-field={f.key} data-origin={f.origin}>
              <th scope="row">{labelOf(locale, f)}</th>
              <td>
                <code dir="ltr">{f.key}</code>
              </td>
              <td>{t(`forms.schema.fieldTypes.${f.fieldType}`)}</td>
              <td>
                {f.protected ? (
                  <span className="lifecycle-chip lifecycle-chip--active" data-protected="true">
                    <Icon name="lock" /> {t("forms.badge.protected")}
                  </span>
                ) : (
                  <span className="lifecycle-chip lifecycle-chip--draft" data-protected="false">
                    <Icon name="plus" /> {t("forms.badge.extensionField")}
                  </span>
                )}
              </td>
              <td>{f.required ? t("forms.schema.yes") : t("forms.schema.no")}</td>
              <td>{helpOf(locale, f) ?? <span className="muted">{t("forms.schema.noHelp")}</span>}</td>
              {editable ? (
                <td>
                  <button type="button" className="button button--link button--small" onClick={() => onEdit(f)}>
                    <Icon name="pencil" /> {t("forms.schema.editField")}
                    <span className="visually-hidden">: {labelOf(locale, f)}</span>
                  </button>{" "}
                  <button type="button" className="button button--link button--small" onClick={() => onRemove(f)}>
                    <Icon name="cross" /> {t("forms.schema.removeField")}
                    <span className="visually-hidden">: {labelOf(locale, f)}</span>
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScrollRegion>
  );
}

function RemoveDialog({
  field,
  busy,
  onConfirm,
  onClose,
}: {
  field: FormField;
  busy: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const label = labelOf(locale, field);
  return (
    <div className="card section" role="group" aria-label={t("forms.schema.removeTitle", { field: label })}>
      <h3>{t("forms.schema.removeTitle", { field: label })}</h3>
      <p>{field.protected ? t("forms.schema.removeSourceBody") : t("forms.schema.removeBody")}</p>
      <div className="form__actions">
        <button type="button" className="button button--danger" disabled={busy} onClick={() => void onConfirm()}>
          {t("forms.schema.confirmRemove")}
        </button>
        <button type="button" className="button button--secondary" onClick={onClose}>
          {t("common.action.cancel")}
        </button>
      </div>
    </div>
  );
}

const SETTING_FIELDS: Record<string, readonly string[]> = {
  text: ["maxLength"],
  rich_text: ["maxLength"],
  number: ["min", "max", "scale"],
  currency: ["currencyCode", "scale"],
  percentage: ["min", "max"],
  date: ["min", "max"],
  reference: ["targetRecordType"],
  attachment: ["maxCount"],
  lookup: ["lookupSet"],
  choice: ["options"],
  calculated: ["expression", "resultUnitKind"],
};
const SETTING_LABEL: Record<string, string> = {
  maxLength: "forms.schema.maxLength",
  min: "forms.schema.min",
  max: "forms.schema.max",
  scale: "forms.schema.scale",
  currencyCode: "forms.schema.currencyCodeSetting",
  targetRecordType: "forms.schema.targetRecordType",
  maxCount: "forms.schema.maxCount",
  lookupSet: "forms.schema.lookupSet",
  options: "forms.schema.options",
  expression: "forms.schema.expression",
  resultUnitKind: "forms.schema.resultUnitKind",
};
const INTEGER_SETTINGS = new Set(["maxLength", "scale", "maxCount"]);

/** The text of a setting for the dialog (options as value|labelEn|labelAr lines). */
function settingText(name: string, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (name === "options" && Array.isArray(value))
    return (value as { value: string; labelEn: string; labelAr: string }[])
      .map((o) => `${o.value}|${o.labelEn}|${o.labelAr}`)
      .join("\n");
  return String(value);
}

/** The attribute value of a setting from its text; undefined = not sent. Decimals stay strings. */
function settingValue(name: string, text: string): unknown {
  const s = text.trim();
  if (s === "") return undefined;
  if (INTEGER_SETTINGS.has(name)) return /^\d+$/.test(s) ? Number(s) : s;
  if (name === "options")
    return s
      .split("\n")
      .map((line) => line.split("|").map((p) => p.trim()))
      .filter((p) => p[0])
      .map(([value, labelEn, labelAr]) => ({ value, labelEn: labelEn || value, labelAr: labelAr || labelEn || value }));
  return s;
}

function FieldDialog({
  schema,
  version,
  field,
  refresh,
  onClose,
}: {
  schema: FormSchema;
  version: ConfigVersion;
  field: FormField | null;
  refresh: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const isSource = field?.origin === "source";
  const [type, setType] = useState<string>(field?.fieldType ?? "text");
  const [key, setKey] = useState<string>(field?.key ?? "");
  const settingNames = isSource ? [] : (SETTING_FIELDS[type] ?? []);
  const fields: P4FieldSpec[] = [
    ...(field
      ? []
      : [
          {
            name: "key",
            label: t("forms.schema.fieldKey"),
            kind: "text" as const,
            required: true,
            hint: t("forms.schema.fieldKeyHint"),
            ltr: true,
            max: 40,
          },
          {
            name: "fieldType",
            label: t("forms.schema.fieldType"),
            kind: "select" as const,
            required: true,
            options: FIELD_TYPES.map((ft) => ({ value: ft, label: t(`forms.schema.fieldTypes.${ft}`) })),
          },
        ]),
    { name: "labelEn", label: t("forms.schema.labelEn"), kind: "text", required: !field, max: 200, ltr: true },
    { name: "labelAr", label: t("forms.schema.labelAr"), kind: "text", required: !field, max: 200 },
    { name: "helpEn", label: t("forms.schema.helpEn"), kind: "textarea", max: 2000 },
    { name: "helpAr", label: t("forms.schema.helpAr"), kind: "textarea", max: 2000 },
    { name: "required", label: t("forms.schema.requiredBox"), kind: "checkbox" },
    ...settingNames.map((n) => ({
      name: `s_${n}`,
      label: t(SETTING_LABEL[n] ?? n),
      kind: (n === "options" || n === "expression" ? "textarea" : "text") as "textarea" | "text",
      ltr: n !== "options",
      ...(n === "options" ? { hint: t("forms.schema.optionsHint") } : {}),
      ...(n === "expression" ? { hint: t("forms.schema.expressionHint") } : {}),
    })),
  ];
  const initial: P4Values = field
    ? {
        labelEn: field.labelEn,
        labelAr: field.labelAr,
        helpEn: field.helpEn ?? "",
        helpAr: field.helpAr ?? "",
        required: field.required,
        ...Object.fromEntries(
          (SETTING_FIELDS[field.fieldType] ?? []).map((n) => [`s_${n}`, settingText(n, field.settings[n])]),
        ),
      }
    : { fieldType: "text", required: false };
  const fieldKey = field?.key ?? key;
  return (
    <StudioFormDialog
      title={
        field
          ? t("forms.schema.editTitle", { field: labelOf(locale, field) })
          : t("forms.schema.addTitle", { form: titleOf(locale, schema.recordType) })
      }
      fields={fields}
      initial={initial}
      submitLabel={t("studio.elements.save")}
      method="PUT"
      url={p5Paths.configElement(version.id, "form_field", `${schema.recordType.code}.${fieldKey || "_"}`)}
      version={version.version}
      namespaces={FORMS_NS}
      onValuesChange={(v) => {
        if (typeof v["fieldType"] === "string") setType(v["fieldType"]);
        if (typeof v["key"] === "string") setKey(v["key"]);
      }}
      toBody={(v) => {
        const attributes: Record<string, unknown> = {};
        for (const n of ["labelEn", "labelAr", "helpEn", "helpAr"] as const) {
          const s = typeof v[n] === "string" ? (v[n] as string).trim() : "";
          if (s) attributes[n] = s;
        }
        attributes["required"] = v["required"] === true;
        if (!isSource) {
          attributes["fieldType"] = field?.fieldType ?? String(v["fieldType"] ?? "text");
          for (const n of settingNames) {
            const value = settingValue(n, typeof v[`s_${n}`] === "string" ? (v[`s_${n}`] as string) : "");
            if (value !== undefined) attributes[n] = value;
          }
        }
        return { origin: isSource ? "source" : "admin", attributes };
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}
