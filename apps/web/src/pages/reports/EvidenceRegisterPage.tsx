// The evidence register of a transformation (T-DG5-FE-E; REQ-S13-010; ADR-0045 §8; M0255): one row per evidence item
// with its record links, evidence type, source, owner, observation period, upload date, version, checksum and review
// status. A file shows its current content revision and SHA-256, and its versions (every upload, newest first, with
// checksum, size, uploader and time). A note or link has no checksum ("No checksum") and shows its record version. A
// missing source or observation date is "Not stated", never blank. Uploading stays on the evidence screen (DG2); the
// register reads with the parent record's authorization (transformation.read).
import { EVIDENCE_TYPES } from "@mth/shared/schemas";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { useUserNames } from "../my-work/p4ui.tsx";
import { useEvidenceRegister, useEvidenceVersions, type EvidenceRegisterItem } from "./api.ts";
import { Chip, NotStated, TransformationEntry } from "./ui.tsx";

const REVIEW: Record<string, readonly ["good" | "bad" | "neutral", "check" | "cross" | "question"]> = {
  verified: ["good", "check"],
  rejected: ["bad", "cross"],
  unverified: ["neutral", "question"],
};

/** Evidence and Reports > Evidence register: choose the transformation. */
export function EvidenceRegisterEntryPage() {
  const { t } = useTranslation();
  return (
    <TransformationEntry
      screen="evidence-register"
      title={t("reportsP5.evidence.title")}
      summary={t("reportsP5.evidence.entryIntro")}
      area={{ label: t("nav.areas.evidence.label"), to: "/evidence-reports" }}
      to={(tid) => `/transformations/${tid}/evidence-register`}
    />
  );
}

export function EvidenceRegisterPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  usePageTitle(t("reportsP5.evidence.title"));
  const transformation = useTransformation(id);
  const [reviewStatus, setReviewStatus] = useState("");
  const [evidenceType, setEvidenceType] = useState("");
  const query = { ...(reviewStatus ? { reviewStatus } : {}), ...(evidenceType ? { evidenceType } : {}) };
  const register = useEvidenceRegister(id, query);
  return (
    <div className="page" data-p5-screen="evidence-register">
      <PageHeader
        title={t("reportsP5.evidence.title")}
        subtitle={t("reportsP5.evidence.intro")}
        crumbs={[
          { label: t("nav.areas.evidence.label"), to: "/evidence-reports/evidence-register" },
          { label: transformation.data?.code ?? t("reportsP5.transformation"), to: `/transformations/${id}` },
          { label: t("reportsP5.evidence.title") },
        ]}
      />
      <p className="small">
        {t("reportsP5.evidence.uploadHint")}{" "}
        <Link className="link" to={`/transformations/${id}/evidence`}>
          {t("reportsP5.evidence.openEvidence")}
        </Link>
      </p>
      <div className="filters" role="group" aria-label={t("reportsP5.evidence.filters")}>
        <div className="field">
          <label className="field__label" htmlFor="evidence-filter-review">
            {t("reportsP5.evidence.reviewStatus")}
          </label>
          <select id="evidence-filter-review" value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
            <option value="">{t("reportsP5.generate.all")}</option>
            {Object.keys(REVIEW).map((s) => (
              <option key={s} value={s}>
                {t(`reportsP5.reviewStatus.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="evidence-filter-type">
            {t("reportsP5.evidence.type")}
          </label>
          <select id="evidence-filter-type" value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)}>
            <option value="">{t("reportsP5.generate.all")}</option>
            {EVIDENCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(`evidence.types.${s}`, { defaultValue: s })}
              </option>
            ))}
          </select>
        </div>
      </div>
      <QueryState
        query={register}
        isEmpty={(items) => items.length === 0}
        empty={<EmptyState title={t("reportsP5.evidence.none")} body={t("reportsP5.evidence.noneBody")} />}
      >
        {(items) => <RegisterTable tid={id} items={items} />}
      </QueryState>
    </div>
  );
}

function RegisterTable({ tid, items }: { tid: string; items: EvidenceRegisterItem[] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const names = useUserNames(items.map((i) => i.ownerUserId));
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={t("reportsP5.evidence.title")}>
      <table className="table" data-table="evidence-register">
        <caption className="visually-hidden">{t("reportsP5.evidence.title")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("reportsP5.evidence.item")}</th>
            <th scope="col">{t("reportsP5.evidence.links")}</th>
            <th scope="col">{t("reportsP5.evidence.type")}</th>
            <th scope="col">{t("reportsP5.evidence.source")}</th>
            <th scope="col">{t("reportsP5.evidence.owner")}</th>
            <th scope="col">{t("reportsP5.evidence.observation")}</th>
            <th scope="col">{t("reportsP5.evidence.uploaded")}</th>
            <th scope="col">{t("reportsP5.evidence.version")}</th>
            <th scope="col">{t("reportsP5.evidence.checksum")}</th>
            <th scope="col">{t("reportsP5.evidence.reviewStatus")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => {
            const review = REVIEW[e.reviewStatus] ?? (["neutral", "question"] as const);
            return (
              <Fragment key={e.evidenceId}>
                <tr data-evidence-row={e.evidenceId} data-evidence-kind={e.kind}>
                  <th scope="row">
                    <span className="report-text">{e.title}</span>
                    <span className="block small muted">{t(`reportsP5.evidenceKind.${e.kind}`)}</span>
                    {e.status === "archived" ? (
                      <span className="block small muted">{t("reportsP5.evidence.archived")}</span>
                    ) : null}
                  </th>
                  <td>
                    {e.links.length === 0 ? (
                      <span className="muted">{t("reportsP5.evidence.noLinks")}</span>
                    ) : (
                      <ul className="plain-list small">
                        {e.links.map((l) => (
                          <li key={`${l.recordType}-${l.recordId}-${l.via}`}>
                            {t(`evidence.recordTypes.${l.recordType}`, { defaultValue: l.recordType })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{t(`evidence.types.${e.evidenceType}`, { defaultValue: e.evidenceType })}</td>
                  <td>{e.source ? <span className="report-text">{e.source}</span> : <NotStated />}</td>
                  <td>{names(e.ownerUserId)}</td>
                  <td>
                    {e.observationStart ? formatBusinessDate(e.observationStart, locale) : <NotStated />} –{" "}
                    {e.observationEnd ? formatBusinessDate(e.observationEnd, locale) : <NotStated />}
                  </td>
                  <td>{formatDateTime(e.uploadedAt, locale)}</td>
                  <td data-evidence-version={e.currentRevision ?? `record-${e.recordVersion}`}>
                    {e.currentRevision !== null ? (
                      <>
                        <bdi dir="ltr">v{e.currentRevision}</bdi>{" "}
                        <button
                          type="button"
                          className="button button--small"
                          aria-expanded={open === e.evidenceId}
                          onClick={() => setOpen((o) => (o === e.evidenceId ? null : e.evidenceId))}
                        >
                          {t("reportsP5.evidence.versions")}
                          <span className="visually-hidden"> ({e.title})</span>
                        </button>
                      </>
                    ) : (
                      <span>{t("reportsP5.evidence.recordVersion", { n: e.recordVersion })}</span>
                    )}
                  </td>
                  <td>
                    {e.sha256 ? (
                      <bdi dir="ltr" className="code small" data-sha256={e.sha256}>
                        {e.sha256}
                      </bdi>
                    ) : (
                      <span className="muted">{t("reportsP5.evidence.noChecksum")}</span>
                    )}
                  </td>
                  <td>
                    <Chip
                      tone={review[0]}
                      icon={review[1]}
                      label={t(`reportsP5.reviewStatus.${e.reviewStatus}`)}
                      data={e.reviewStatus}
                    />
                  </td>
                </tr>
                {open === e.evidenceId ? (
                  <tr data-evidence-versions-row={e.evidenceId}>
                    <td colSpan={10}>
                      <Versions tid={tid} evidenceId={e.evidenceId} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Versions({ tid, evidenceId }: { tid: string; evidenceId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const versions = useEvidenceVersions(tid, evidenceId, true);
  const names = useUserNames((versions.data ?? []).map((v) => v.uploadedBy));
  return (
    <QueryState query={versions}>
      {(items) => (
        <table className="table" data-table="evidence-versions">
          <caption>{t("reportsP5.evidence.versionsTitle")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("reportsP5.evidence.version")}</th>
              <th scope="col">{t("reportsP5.evidence.fileName")}</th>
              <th scope="col">{t("reportsP5.evidence.checksum")}</th>
              <th scope="col">{t("reportsP5.evidence.size")}</th>
              <th scope="col">{t("reportsP5.evidence.uploaded")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((v) => (
              <tr key={v.contentId} data-evidence-revision={v.revision}>
                <th scope="row">
                  <bdi dir="ltr">v{v.revision}</bdi>
                </th>
                <td>
                  <bdi dir="ltr">{v.fileName}</bdi>
                </td>
                <td>
                  <bdi dir="ltr" className="code small">
                    {v.sha256}
                  </bdi>
                </td>
                <td>
                  <bdi dir="ltr">{v.sizeBytes} B</bdi>
                </td>
                <td>
                  {names(v.uploadedBy)} · {formatDateTime(v.uploadedAt, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </QueryState>
  );
}
