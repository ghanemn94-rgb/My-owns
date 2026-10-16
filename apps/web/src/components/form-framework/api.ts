// The common form framework's typed reads and pure helpers (T-DG5-FE-C; ADR-0041 §5-§7; REQ-S05-001, REQ-S05-006).
// The request paths and the generic hooks are FE-A's (api/p5.ts); this file fixes their body types with the zod mirrors
// of BE-D, BE-E and BE-E2 (@mth/shared/schemas forms*.ts) and holds the pure helpers the screens and tests share.
// Decimals stay strings on every path (never parsed to a float); a missing value is Unknown, never 0.
// A draft, a comment or an attachment approves nothing: no G1-G6 business approval is granted or recorded here.
import {
  formCustomValues,
  formDraft,
  formRecordAttachment,
  formRecordComment,
  formRecordVersion,
  formSchema,
} from "@mth/shared/schemas";
import type {
  FormCustomValues,
  FormDraft,
  FormField,
  FormRecordAttachment,
  FormRecordComment,
  FormRecordExport,
  FormRecordType,
  FormRecordVersion,
  FormSchema,
} from "@mth/shared/schemas";
import { api, ApiError } from "../../api/client.ts";
import {
  p5Paths,
  useFormCustomFields,
  useFormDrafts,
  useFormRecordAttachments,
  useFormRecordComments,
  useFormRecordTypes,
  useFormRecordVersions,
  useFormSchemaAdmin,
  useTransformationFormSchema,
} from "../../api/p5.ts";
import type { Locale } from "@mth/shared";

export type {
  FormCustomValues,
  FormDraft,
  FormField,
  FormRecordAttachment,
  FormRecordComment,
  FormRecordExport,
  FormRecordType,
  FormRecordVersion,
  FormSchema,
};

/** The i18n namespace prefix of the form builder and the framework (problem texts fall back to `problems`). */
export const FORMS_NS = ["forms"] as const;

export const useRecordTypes = (enabled = true) => useFormRecordTypes<FormRecordType>({}, enabled);
export const useAdminSchema = (recordType: string | undefined, versionId: string | null) =>
  useFormSchemaAdmin<FormSchema>(recordType, versionId);
export const usePinnedSchema = (tid: string, recordType: string) =>
  useTransformationFormSchema<FormSchema>(tid, recordType);
export const useCustomValues = (tid: string, recordType: string, recordId: string) =>
  useFormCustomFields<FormCustomValues>(tid, recordType, recordId);
export const useVersions = (tid: string, recordType: string, recordId: string) =>
  useFormRecordVersions<FormRecordVersion>(tid, recordType, recordId);
export const useComments = (tid: string, recordType: string, recordId: string) =>
  useFormRecordComments<FormRecordComment>(tid, recordType, recordId);
export const useAttachments = (tid: string, recordType: string, recordId: string, includeRemoved: boolean) =>
  useFormRecordAttachments<FormRecordAttachment>(tid, recordType, recordId, includeRemoved);
export const useOpenDrafts = (tid: string, recordType: string) =>
  useFormDrafts<FormDraft>(tid, { recordType, status: "open" });

/**
 * The contract's mirrors of each body the framework renders. A body that does not parse is shown as an error state
 * ("unexpected response"), never rendered half-way or as zeros.
 */
export const BODY_SCHEMAS = {
  schema: formSchema,
  custom: formCustomValues,
  drafts: formDraft.array(),
  versions: formRecordVersion.array(),
  comments: formRecordComment.array(),
  attachments: formRecordAttachment.array(),
} as const;

/** Parses a body with its mirror: the value, or an Error to show in the error state. */
export function parseBody<K extends keyof typeof BODY_SCHEMAS>(
  kind: K,
  body: unknown,
): { ok: true; value: ReturnType<(typeof BODY_SCHEMAS)[K]["parse"]> } | { ok: false; error: Error } {
  const r = BODY_SCHEMAS[kind].safeParse(body);
  return r.success
    ? { ok: true, value: r.data as ReturnType<(typeof BODY_SCHEMAS)[K]["parse"]> }
    : { ok: false, error: new Error(`unexpected ${kind} response`) };
}

/** The JSON export of one form (the CSV one is a plain download of the same path). */
export const fetchExport = (tid: string, recordType: string, lang: Locale): Promise<FormRecordExport> =>
  api.get<FormRecordExport>(p5Paths.exportFormRecords(tid, recordType), { format: "json", lang });

/** The CSV download URL (same-origin GET; the browser sends the session cookie; RFC 4180 UTF-8 with BOM). */
export const csvExportUrl = (tid: string, recordType: string, lang: Locale): string =>
  `${p5Paths.exportFormRecords(tid, recordType)}?format=csv&lang=${lang}`;

/** The label of a field or form in the language of the screen (translated at render time). */
export const labelOf = (locale: Locale, x: { labelEn: string; labelAr: string }): string =>
  locale === "ar" ? x.labelAr : x.labelEn;
export const helpOf = (locale: Locale, x: { helpEn: string | null; helpAr: string | null }): string | null =>
  (locale === "ar" ? x.helpAr : x.helpEn) ?? null;
export const titleOf = (locale: Locale, x: { titleEn: string; titleAr: string }): string =>
  locale === "ar" ? x.titleAr : x.titleEn;

/** The extension fields a user can enter (calculated values are never entered; removed fields are not served). */
export const enterableExtensionFields = (schema: FormSchema): FormField[] =>
  schema.fields.filter((f) => f.extension && f.fieldType !== "calculated");

// ------------------------------------------------------------------------------------------------ value text

/** A stored extension value as editable text (the inverse of `valueFromText`). Unknown → "". */
export function valueToText(field: Pick<FormField, "fieldType">, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (field.fieldType === "currency" && typeof value === "object" && value !== null && "amount" in value)
    return String((value as { amount: unknown }).amount ?? "");
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

/** The currency code of a stored currency value, else the field's setting, else the transformation currency. */
export function currencyCodeOf(field: Pick<FormField, "settings">, value: unknown, fallback: string): string {
  if (typeof value === "object" && value !== null && "currencyCode" in value) {
    const code = (value as { currencyCode: unknown }).currencyCode;
    if (typeof code === "string" && code) return code;
  }
  const setting = field.settings["currencyCode"];
  return typeof setting === "string" && setting ? setting : fallback;
}

/**
 * The request value of one extension field from its text: "" → null (clears the value; Unknown, never 0). Decimals
 * stay the text the user typed; the server normalizes (12% → "0.12") and refuses with the field code (400), so the
 * web never re-implements a parse that could round. Attachments are a comma-separated list of evidence ids.
 */
export function valueFromText(
  field: Pick<FormField, "fieldType" | "settings">,
  text: string,
  currencyCode: string,
): unknown {
  const s = text.trim();
  if (s === "") return null;
  switch (field.fieldType) {
    case "currency":
      return { amount: s, currencyCode };
    case "attachment":
      return s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    case "choice":
      return field.settings["multiple"] === true
        ? s
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : s;
    default:
      return s;
  }
}

/** Two request values are the same (JSON equality; key order of currency objects normalized). */
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string =>
    v === undefined
      ? "null"
      : JSON.stringify(v, (_k, x: unknown) =>
          x && typeof x === "object" && !Array.isArray(x)
            ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([p], [q]) => p.localeCompare(q)))
            : x,
        );
  return norm(a) === norm(b);
}

// ------------------------------------------------------------------------------------------------ drafts

/** The payload of a framework draft: the partial request body of the record's own update and its extension values. */
export interface DraftPayload {
  readonly sourceFields: Record<string, string>;
  readonly customFieldValues: Record<string, string>;
  readonly currencyCodes: Record<string, string>;
}

/** Reads a stored draft payload defensively (a draft is the author's work in progress, ADR-0041 §5). */
export function readDraftPayload(payload: Record<string, unknown>): DraftPayload {
  const strings = (x: unknown): Record<string, string> =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"),
        )
      : {};
  return {
    sourceFields: strings(payload["sourceFields"]),
    customFieldValues: strings(payload["customFieldValues"]),
    currencyCodes: strings(payload["currencyCodes"]),
  };
}

/** The one open draft of this record of the current user (one per user and record; FD02), or null. */
export const draftOfRecord = (drafts: readonly FormDraft[] | undefined, recordId: string): FormDraft | null =>
  drafts?.find((d) => d.status === "open" && d.recordId === recordId) ?? null;

// ------------------------------------------------------------------------------------------------ conflicts

/** A 409 of a record write: the P5 `form_record.conflict`, a DG2-DG4 register's version conflict, or a stale draft. */
export const isVersionConflict = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === 409 && e.code !== "form_draft.open_exists";

/** The changed field names of a history entry, with the schema's labels where a field key matches. */
export function changedFieldLabels(
  changed: readonly string[],
  schema: FormSchema | undefined,
  locale: Locale,
): string[] {
  const byKey = new Map((schema?.fields ?? []).map((f) => [f.key, labelOf(locale, f)]));
  return changed.map((c) => byKey.get(c) ?? byKey.get(c.replace(/_id$/, "")) ?? c);
}

/** Groups comments into top-level threads, oldest first, each with its replies (one reply level; FC02). */
export function threadsOf(
  comments: readonly FormRecordComment[],
): { comment: FormRecordComment; replies: FormRecordComment[] }[] {
  const top = comments.filter((c) => c.parentCommentId === null);
  return top.map((comment) => ({
    comment,
    replies: comments.filter((r) => r.parentCommentId === comment.id),
  }));
}
