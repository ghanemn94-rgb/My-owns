// Administration > Methodology coverage (T-DG5-FE-D; REQ-S01-003; ADR-0042 §7): every seeded methodology element
// with the form or procedure it is linked to. An element whose link targets a screen that is not delivered yet is
// "Planned" (neutral, never green); an element with no link is "Not covered". The view reads the server's report and
// invents nothing: the totals are the server's.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../app/locale.ts";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { ConfigurationNote } from "../studio/ui.tsx";
import { StatusChip, pick } from "../automation/ui.tsx";
import { useCoverage, type MethodologyCoverageElement } from "../procedures/api.ts";

const COVERAGE_CHIP = {
  covered: ["good", "check"],
  planned: ["neutral", "clock"],
  not_covered: ["bad", "cross"],
} as const;

export function CoveragePage() {
  const { t } = useTranslation();
  const locale = useLocale();
  usePageTitle(t("nav.p5.methodologyCoverage.title"));
  const coverage = useCoverage();
  const [status, setStatus] = useState("");
  const columns: RegisterColumn<MethodologyCoverageElement>[] = [
    {
      id: "element",
      header: t("workflowsP5.coverage.element"),
      rowHeader: true,
      hideable: false,
      cell: (e) => (
        <span className="block">
          {pick(locale, e.sourceLabelEn, e.labelAr)}
          <span className="block small muted">
            <bdi dir="ltr">
              {e.setCode} · {e.stableKey}
            </bdi>
          </span>
        </span>
      ),
      sortValue: (e) => `${e.setCode}/${e.stableKey}`,
      filterText: (e) => `${e.setCode} ${e.stableKey} ${e.sourceLabelEn} ${e.labelAr} ${e.sourceRef}`,
    },
    {
      id: "source",
      header: t("workflowsP5.coverage.source"),
      cell: (e) => <bdi dir="ltr">{e.sourceRef}</bdi>,
      sortValue: (e) => e.sourceRef,
    },
    {
      id: "status",
      header: t("workflowsP5.field.status"),
      cell: (e) => <StatusChip value={e.status} table={COVERAGE_CHIP} labelKey="workflowsP5.coverage.status" />,
      sortValue: (e) => e.status,
    },
    {
      id: "links",
      header: t("workflowsP5.coverage.links"),
      cell: (e) =>
        e.links.length === 0 ? (
          <span className="muted">{t("workflowsP5.none")}</span>
        ) : (
          <ul className="plain-list">
            {e.links.map((l) => (
              <li key={`${l.targetKind}:${l.targetCode}`} data-feature-status={l.featureStatus}>
                {t(`workflowsP5.coverage.kind.${l.targetKind}`)} <bdi dir="ltr">{l.targetCode}</bdi>
                {l.featureStatus === "planned" ? ` · ${t("nav.planned")}` : ""}
                {!l.resolved ? ` · ${t("workflowsP5.coverage.unresolved")}` : ""}
              </li>
            ))}
          </ul>
        ),
    },
  ];
  return (
    <div className="page" data-p5-screen="methodology-coverage">
      <PageHeader
        title={t("nav.p5.methodologyCoverage.title")}
        subtitle={t("nav.p5.methodologyCoverage.summary")}
        crumbs={[
          { label: t("nav.p5.procedureBuilder.title"), to: "/admin/procedures" },
          { label: t("nav.p5.methodologyCoverage.title") },
        ]}
      />
      <ConfigurationNote />
      <QueryState query={coverage}>
        {(c) => (
          <>
            <section className="card" aria-labelledby="coverage-totals">
              <h2 id="coverage-totals" className="card__title">
                {t("workflowsP5.coverage.totals")}
              </h2>
              <dl className="workspace-header__grid" data-totals={`${c.totals.covered}/${c.totals.total}`}>
                <dt>{t("workflowsP5.coverage.status.covered")}</dt>
                <dd>{c.totals.covered}</dd>
                <dt>{t("workflowsP5.coverage.status.planned")}</dt>
                <dd>{c.totals.planned}</dd>
                <dt>{t("workflowsP5.coverage.status.not_covered")}</dt>
                <dd>{c.totals.notCovered}</dd>
                <dt>{t("workflowsP5.coverage.total")}</dt>
                <dd>{c.totals.total}</dd>
              </dl>
            </section>
            <Section
              id="coverage-elements"
              title={t("workflowsP5.coverage.elements")}
              actions={
                <label className="filters__select">
                  <span>{t("workflowsP5.field.status")}</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">{t("workflowsP5.all")}</option>
                    {(["covered", "planned", "not_covered"] as const).map((s) => (
                      <option key={s} value={s}>
                        {t(`workflowsP5.coverage.status.${s}`)}
                      </option>
                    ))}
                  </select>
                </label>
              }
            >
              <RegisterTable
                id="p5-coverage"
                caption={t("workflowsP5.coverage.elements")}
                rows={status ? c.elements.filter((e) => e.status === status) : [...c.elements]}
                columns={columns}
                getRowId={(e) => `${e.setCode}:${e.stableKey}`}
                emptyTitle={t("workflowsP5.coverage.empty")}
                defaultSort={{ id: "element", dir: "asc" }}
              />
            </Section>
          </>
        )}
      </QueryState>
    </div>
  );
}
