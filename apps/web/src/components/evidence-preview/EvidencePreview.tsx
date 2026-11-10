// Safe evidence preview (T-DG6-FE-B; ADR-0052 §2; REQ-S13-011; D-195 Q4). Only raster images (PNG, JPEG, GIF) are ever
// shown, and only as an <img> whose source is the preview route (previewEvidenceContent), which the server serves inline
// for those three detected types alone, with `Content-Security-Policy: default-src 'none'`, `nosniff` and a sandbox.
// Every other type (SVG included, whatever its content) shows a file-type icon and "Download"; the download route always
// answers `application/octet-stream` as an attachment. There is never an <iframe>, <object> or <embed>, and the bytes are
// never inserted into the page as markup. If the preview request fails (422 evidence.preview_unavailable for a file
// whose detected type is not raster, or an earlier file never classified), the image is replaced by the same download
// offer.
//
// The file-name extension only decides whether to try the preview; the server decides by the detected content type.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { p6Paths } from "../../api/p6.ts";
import { Icon } from "../Icon.tsx";
import { Dialog } from "../Form.tsx";
import { SensitivityPanel } from "../sensitivity/SensitivityPanel.tsx";

const RASTER_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif"]);

export function isRasterFileName(fileName: string | null | undefined): boolean {
  const ext = (fileName ?? "").split(".").pop()?.toLowerCase() ?? "";
  return Boolean(fileName && fileName.includes(".") && RASTER_EXTENSIONS.has(ext));
}

export interface PreviewableEvidence {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly fileName: string | null;
  readonly currentContentId: string | null;
}

export function EvidencePreview({ tid, evidence }: { tid: string; evidence: PreviewableEvidence }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const downloadUrl = `/api/v1/transformations/${encodeURIComponent(tid)}/evidence/${encodeURIComponent(evidence.id)}/content`;
  if (evidence.kind !== "file" || !evidence.currentContentId) {
    return <p className="muted">{t("adminP6.preview.noContent")}</p>;
  }
  const tryPreview = isRasterFileName(evidence.fileName) && !failed;
  return (
    <div className="evidence-preview" data-evidence-preview={tryPreview ? "image" : "download"}>
      {tryPreview ? (
        <img
          key={evidence.currentContentId}
          src={p6Paths.evidencePreview(tid, evidence.id)}
          alt={t("adminP6.preview.alt", { name: evidence.title })}
          style={{ maxWidth: "100%", maxHeight: "60vh", height: "auto" }}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <p className="muted" data-state={failed ? "preview-failed" : "no-preview"}>
          <Icon name="info" /> {failed ? t("adminP6.preview.failed") : t("adminP6.preview.noPreview")}
        </p>
      )}
      <p>
        <a className="button button--secondary button--small" href={downloadUrl} download data-action="download">
          <Icon name="chevronDown" /> {t("adminP6.preview.download")}
          <span className="visually-hidden">: {evidence.title}</span>
          {evidence.fileName ? (
            <span className="small muted">
              {" "}
              (<bdi dir="ltr">{evidence.fileName}</bdi>)
            </span>
          ) : null}
        </a>
      </p>
    </div>
  );
}

/**
 * The evidence row action "Preview and access" (one named line in the evidence register's actions cell): a dialog with
 * the safe preview and the record's access-restriction panel. The evidence register has no detail page; this dialog is
 * its detail view for slice E and F.
 */
export function EvidencePreviewAction({ tid, evidence }: { tid: string; evidence: PreviewableEvidence }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="button button--link button--small"
        data-action="evidence-preview"
        onClick={() => setOpen(true)}
      >
        <Icon name="info" /> {t("adminP6.preview.open")}
        <span className="visually-hidden">: {evidence.title}</span>
      </button>
      {open ? (
        <Dialog
          title={t("adminP6.preview.dialogTitle", { name: evidence.title })}
          onClose={() => setOpen(false)}
          footer={
            <button type="button" className="button button--secondary" onClick={() => setOpen(false)}>
              {t("adminP6.preview.close")}
            </button>
          }
        >
          <h3 className="card__subtitle">{t("adminP6.preview.title")}</h3>
          <EvidencePreview tid={tid} evidence={evidence} />
          <SensitivityPanel tid={tid} recordType="evidence" recordId={evidence.id} />
        </Dialog>
      ) : null}
    </>
  );
}
