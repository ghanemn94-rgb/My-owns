// Methodology and formula revision proposals (T-DG5-FE-B; REQ-S12-018; ADR-0039 §8): the starter automation records
// one proposal per proposed revision with its validation result, its impact (e.g. the affected benefits of a formula
// change) and the review tasks it created for the configured reviewer role. Read-only here; the review itself is the
// `config_review` work item. A proposal routes configuration; it is never a business approval.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { REVISION_SUBJECT_TYPES } from "@mth/shared/schemas";
import { useLocale } from "../../app/locale.ts";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { useProposals, type RevisionProposal } from "./api.ts";
import { CheckChip, ConfigurationNote } from "./ui.tsx";

/** The affected items an impact lists (`affectedBenefits`, `affectedRecords`, …), as short text lines. */
export function impactLines(impact: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(impact)) {
    if (Array.isArray(value))
      for (const item of value) {
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          const label = [o["code"], o["name"], o["recordType"], o["stableKey"], o["id"]].find(
            (x) => typeof x === "string",
          );
          lines.push(`${key}: ${String(label ?? JSON.stringify(item))}`);
        } else lines.push(`${key}: ${String(item)}`);
      }
    else if (typeof value === "number" || typeof value === "string") lines.push(`${key}: ${value}`);
  }
  return lines;
}

export function RevisionProposalsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  usePageTitle(t("studio.proposals.title"));
  const [subjectType, setSubjectType] = useState("");
  const proposals = useProposals(subjectType ? { subjectType } : {});
  return (
    <div className="page" data-p5-screen="revision-proposals">
      <PageHeader
        title={t("studio.proposals.title")}
        subtitle={t("studio.proposals.summary")}
        crumbs={[{ label: t("nav.p5.studio.title"), to: "/admin/studio" }, { label: t("studio.proposals.title") }]}
      />
      <ConfigurationNote />
      <div className="toolbar">
        <label>
          {t("studio.proposals.subjectType")}{" "}
          <select value={subjectType} onChange={(e) => setSubjectType(e.target.value)}>
            <option value="">{t("studio.filter.all")}</option>
            {REVISION_SUBJECT_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(`studio.proposals.subject.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <QueryState
        query={proposals}
        isEmpty={(rows) => rows.length === 0}
        empty={<EmptyState title={t("studio.proposals.empty")} />}
      >
        {(rows) => (
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label={t("common.table.scrollRegion", { caption: t("studio.proposals.title") })}
          >
            <table className="table" data-table="proposals">
              <caption className="visually-hidden">{t("studio.proposals.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("studio.proposals.createdAt")}</th>
                  <th scope="col">{t("studio.proposals.subjectType")}</th>
                  <th scope="col">{t("studio.proposals.validation")}</th>
                  <th scope="col">{t("studio.proposals.impact")}</th>
                  <th scope="col">{t("studio.reviews.reviewerRole")}</th>
                  <th scope="col">{t("studio.proposals.tasks")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p: RevisionProposal) => {
                  const lines = impactLines(p.impact);
                  return (
                    <tr key={p.id} data-proposal={p.subjectType}>
                      <th scope="row">{formatDateTime(p.createdAt, locale)}</th>
                      <td>
                        {p.subjectType === "methodology_version" ? (
                          <Link className="link" to={`/admin/studio/versions/${p.subjectId}`}>
                            {t(`studio.proposals.subject.${p.subjectType}`)}
                          </Link>
                        ) : p.transformationId ? (
                          <Link
                            className="link"
                            to={`/transformations/${p.transformationId}/benefit-formulas/${p.subjectId}`}
                          >
                            {t(`studio.proposals.subject.${p.subjectType}`)}
                          </Link>
                        ) : (
                          t(`studio.proposals.subject.${p.subjectType}`)
                        )}
                      </td>
                      <td>
                        <CheckChip status={p.validationResult} />
                      </td>
                      <td>
                        {lines.length === 0 ? (
                          <span className="muted">{t("common.value.none")}</span>
                        ) : (
                          <ul className="plain-list small">
                            {lines.slice(0, 8).map((l, i) => (
                              <li key={i}>
                                <bdi dir="ltr">{l}</bdi>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td>
                        <bdi dir="ltr">{p.reviewerRoleCode}</bdi>
                      </td>
                      <td>{p.reviewTaskCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </div>
  );
}
