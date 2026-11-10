// Administration > Security (T-DG6-FE-B; ADR-0052 §4; REQ-S16-030): the rate-limit classes of the server, read-only
// (getSecurityRateLimits, security.read), with the link to the upload policy. The values come from configuration; no
// counter, address or user id is shown (the contract carries none).
import type { RateLimitMatrix } from "@mth/shared/schemas";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useSecurityRateLimits } from "../../../api/p6.ts";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../../components/RegisterTable.tsx";
import { Section } from "../../../components/Section.tsx";
import { QueryState } from "../../../components/States.tsx";
import { adminCrumbs, Code, useHomeOrganizationId } from "./shared.tsx";

type RateLimitClass = RateLimitMatrix["classes"][number];

export function SecurityPage() {
  const { t } = useTranslation();
  const title = t("nav.p6.security.title");
  usePageTitle(title);
  const organizationId = useHomeOrganizationId();
  const matrix = useSecurityRateLimits<RateLimitMatrix>(organizationId);
  const columns: RegisterColumn<RateLimitClass>[] = [
    {
      id: "class",
      header: t("adminP6.security.class"),
      rowHeader: true,
      hideable: false,
      cell: (c) => t(`adminP6.security.className.${c.name}`),
      sortValue: (c) => c.name,
    },
    {
      id: "perMinute",
      header: t("adminP6.security.perMinute"),
      cell: (c) => <bdi dir="ltr">{c.perMinute}</bdi>,
      sortValue: (c) => c.perMinute,
    },
    {
      id: "keyedBy",
      header: t("adminP6.security.keyedBy"),
      cell: (c) => t(`adminP6.security.keyedByValue.${c.keyedBy}`),
    },
    { id: "variable", header: t("adminP6.security.variable"), cell: (c) => <Code>{c.variable}</Code> },
    {
      id: "operations",
      header: t("adminP6.security.operations"),
      cell: (c) =>
        c.operationIds.length === 0 ? (
          t("adminP6.security.operationCount", { count: 0 })
        ) : (
          <details>
            <summary>{t("adminP6.security.operationCount", { count: c.operationIds.length })}</summary>
            <ul className="plain-list small">
              {c.operationIds.map((id) => (
                <li key={id}>
                  <Code>{id}</Code>
                </li>
              ))}
            </ul>
          </details>
        ),
      sortValue: (c) => c.operationIds.length,
      filterText: (c) => c.operationIds.join(" "),
    },
  ];
  return (
    <div className="page" data-p6-screen="security">
      <PageHeader title={title} subtitle={t("nav.p6.security.summary")} crumbs={adminCrumbs(t, { label: title })} />
      <section className="card" aria-labelledby="security-upload-policy">
        <h2 id="security-upload-policy" className="card__title">
          <Link className="link" to="/admin/upload-policy">
            {t("adminP6.security.uploadPolicyLink")}
          </Link>
        </h2>
        <p className="muted">{t("adminP6.security.uploadPolicyIntro")}</p>
      </section>
      <Section id="rate-limits" title={t("adminP6.security.rateTitle")} intro={t("adminP6.security.rateIntro")}>
        <QueryState query={matrix}>
          {(m) => (
            <RegisterTable
              id="p6-rate-limits"
              caption={t("adminP6.security.rateTitle")}
              rows={m.classes}
              columns={columns}
              getRowId={(c) => c.name}
              emptyTitle={t("adminP6.common.none")}
            />
          )}
        </QueryState>
      </Section>
    </div>
  );
}
