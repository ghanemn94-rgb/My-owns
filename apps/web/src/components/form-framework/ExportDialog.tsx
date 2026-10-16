// Export of one native form (T-DG5-FE-C; ADR-0041 §5 "Export"; REQ-S05-001 "export returns the rows"): a preview of
// the JSON export in the chosen header language, with its row count, then a CSV (RFC 4180, UTF-8 with BOM, en or ar
// headers) or JSON download. Unknown and Not computable cells are marked, never shown as 0. Reads only
// (`transformation.read`); AUD may export. 422 form_export.too_large is shown by its code in en/ar.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Locale } from "@mth/shared";
import { p5Keys } from "../../api/p5.ts";
import { useLocale } from "../../app/locale.ts";
import { FormAlert } from "../../pages/my-work/p4ui.tsx";
import { Dialog, Field } from "../Form.tsx";
import { Icon } from "../Icon.tsx";
import { LoadingState } from "../States.tsx";
import { csvExportUrl, fetchExport, FORMS_NS, type FormRecordExport } from "./api.ts";

const PREVIEW_ROWS = 10;

/** A button that opens the export dialog of `recordType` in this transformation. */
export function ExportButton({ tid, recordType, formTitle }: { tid: string; recordType: string; formTitle: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="button button--secondary button--small"
        data-export={recordType}
        onClick={() => setOpen(true)}
      >
        <Icon name="columns" /> {t("forms.export.open")}
        <span className="visually-hidden">: {formTitle}</span>
      </button>
      {open ? (
        <ExportDialog tid={tid} recordType={recordType} formTitle={formTitle} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

export function ExportDialog({
  tid,
  recordType,
  formTitle,
  onClose,
}: {
  tid: string;
  recordType: string;
  formTitle: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [lang, setLang] = useState<Locale>(locale);
  const preview = useQuery({
    queryKey: p5Keys.area("form-records", tid, recordType, "export", lang),
    queryFn: () => fetchExport(tid, recordType, lang),
    retry: false,
  });
  const downloadJson = (data: FormRecordExport) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${recordType}-${lang}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Dialog
      title={t("forms.export.title", { form: formTitle })}
      onClose={onClose}
      footer={
        <div className="form__actions">
          <a
            className="button button--primary"
            href={csvExportUrl(tid, recordType, lang)}
            download={`${recordType}-${lang}.csv`}
            data-download="csv"
          >
            {t("forms.export.downloadCsv")}
          </a>
          <button
            type="button"
            className="button button--secondary"
            disabled={!preview.data}
            data-download="json"
            onClick={() => preview.data && downloadJson(preview.data)}
          >
            {t("forms.export.downloadJson")}
          </button>
          <button type="button" className="button button--secondary" onClick={onClose}>
            {t("forms.export.close")}
          </button>
        </div>
      }
    >
      <p className="muted small">{t("forms.export.intro")}</p>
      <Field label={t("forms.export.language")}>
        {(control) => (
          <select {...control} value={lang} onChange={(e) => setLang(e.target.value as Locale)}>
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
        )}
      </Field>
      {preview.isPending ? <LoadingState /> : null}
      <FormAlert error={preview.error} namespaces={FORMS_NS} />
      {preview.data ? <ExportPreview data={preview.data} /> : null}
    </Dialog>
  );
}

function ExportPreview({ data }: { data: FormRecordExport }) {
  const { t } = useTranslation();
  const rows = data.rows.slice(0, PREVIEW_ROWS);
  return (
    <div data-export-rows={data.rows.length} data-export-language={data.language}>
      <p role="status">
        <strong>{t("forms.export.rowCount", { count: data.rows.length })}</strong>
      </p>
      {data.rows.length === 0 ? (
        <p className="muted">{t("forms.export.empty")}</p>
      ) : (
        <div className="table-scroll">
          <table className="table table--compact" dir={data.language === "ar" ? "rtl" : "ltr"} lang={data.language}>
            <caption>{t("forms.export.caption", { count: rows.length })}</caption>
            <thead>
              <tr>
                {data.columns.map((c) => (
                  <th key={c.key} scope="col">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.recordId}>
                  {data.columns.map((c) => {
                    const v = r.values[c.key];
                    const status = r.statuses[c.key];
                    return (
                      <td key={c.key} data-status={status ?? (v === null || v === undefined ? "unknown" : "value")}>
                        {v !== null && v !== undefined ? (
                          v
                        ) : (
                          <span className="status-chip status-chip--unknown">
                            <Icon name="question" />{" "}
                            {status === "not_computable" ? t("forms.export.notComputable") : t("forms.export.unknown")}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
