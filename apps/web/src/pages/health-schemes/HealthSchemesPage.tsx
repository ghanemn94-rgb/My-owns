// Health-check scoring schemes (T-DG5-FE-F; REQ-S14-003; ADR-0048 §5-§6; Administration > Playbook Studio > Health
// check scoring). The published versions of the scheme kind `health_check_scheme`: allowed responses and their credit,
// the score basis, the bands, and whether the scoring is an implementation assumption (v1: Yes = 1, No = 0; M0262,
// D-010). A new scheme is a new version, drafted and published through the Playbook Studio: partial credit or N/A needs
// its own interpretation bands (422 health_scheme.own_bands_required) and a percentage score basis; the four source
// bands (B0152) are never silently reused. Existing assessments keep the scheme version they used (ADR-0040).
import Decimal from "decimal.js";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime, formatDecimal } from "../../lib/format.ts";
import { Chip } from "../automation/ui.tsx";
import { Notice, ProvisionalTranslationNote } from "../launch-plan/ui.tsx";
import { useHealthSchemes, type HealthCheckScheme } from "../health-check/api.ts";

export function HealthSchemesPage() {
  const { t } = useTranslation();
  const me = useMe();
  usePageTitle(t("launchHealthP5.schemes.title"));
  const schemes = useHealthSchemes();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="page" data-p5-screen="health-schemes">
      <PageHeader
        title={t("launchHealthP5.schemes.title")}
        subtitle={t("launchHealthP5.schemes.intro")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("launchHealthP5.schemes.title") }]}
      />
      <ProvisionalTranslationNote />
      <Notice state="scheme-rule">{t("launchHealthP5.schemes.rule")}</Notice>
      {canAnywhere(me, "methodology.read") ? (
        <p>
          <Link className="link" to="/admin/studio">
            {t("launchHealthP5.schemes.newVersion")}
          </Link>
        </p>
      ) : null}
      <QueryState
        query={schemes}
        isEmpty={(items) => items.length === 0}
        empty={<EmptyState title={t("launchHealthP5.schemes.none")} />}
      >
        {(items) => {
          const sorted = [...items].sort((a, b) => b.versionNo - a.versionNo);
          const current = sorted.find((s) => s.versionId === selected) ?? sorted[0]!;
          return (
            <>
              <Section id="scheme-versions" title={t("launchHealthP5.schemes.versions")}>
                <div
                  className="table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label={t("launchHealthP5.schemes.versions")}
                >
                  <table className="table" data-table="health-schemes">
                    <caption className="visually-hidden">{t("launchHealthP5.schemes.versions")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("launchHealthP5.schemes.version")}</th>
                        <th scope="col">{t("launchHealthP5.schemes.basis")}</th>
                        <th scope="col">{t("launchHealthP5.schemes.responses")}</th>
                        <th scope="col">{t("launchHealthP5.schemes.bands")}</th>
                        <th scope="col">{t("launchHealthP5.schemes.published")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((s) => (
                        <SchemeRow
                          key={s.versionId}
                          s={s}
                          current={s.versionId === current.versionId}
                          onSelect={setSelected}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
              <SchemeDetail s={current} />
            </>
          );
        }}
      </QueryState>
    </div>
  );
}

function SchemeRow({
  s,
  current,
  onSelect,
}: {
  s: HealthCheckScheme;
  current: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <tr data-scheme-version={s.versionNo} aria-current={current ? "true" : undefined}>
      <th scope="row">
        <button type="button" className="button button--link" onClick={() => onSelect(s.versionId)}>
          {locale === "ar" ? s.titleAr : s.titleEn} · {t("launchHealthP5.health.schemeVersion", { n: s.versionNo })}
        </button>
      </th>
      <td>{t(`launchHealthP5.schemes.basisKind.${s.scoreBasis}`)}</td>
      <td>{s.responses.map((r) => t(`launchHealthP5.health.response.${r.key}`)).join(", ")}</td>
      <td>{s.bands.length}</td>
      <td>{formatDateTime(s.publishedAt, locale)}</td>
    </tr>
  );
}

function SchemeDetail({ s }: { s: HealthCheckScheme }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const bands = [...s.bands].sort((a, b) => new Decimal(b.minScore).comparedTo(a.minScore));
  return (
    <Section
      id="scheme-detail"
      title={`${locale === "ar" ? s.titleAr : s.titleEn} · ${t("launchHealthP5.health.schemeVersion", { n: s.versionNo })}`}
    >
      {s.implementationAssumption ? (
        <Notice state="scoring-assumption">{t("launchHealthP5.health.scoringAssumption")}</Notice>
      ) : null}
      <dl className="workspace-header__grid">
        <dt>{t("launchHealthP5.schemes.basis")}</dt>
        <dd>{t(`launchHealthP5.schemes.basisKind.${s.scoreBasis}`)}</dd>
        <dt>{t("launchHealthP5.schemes.questionCount")}</dt>
        <dd>{s.questionCount}</dd>
      </dl>
      <div className="table-wrap" tabIndex={0} role="region" aria-label={t("launchHealthP5.schemes.responses")}>
        <table className="table" data-table="scheme-responses">
          <caption>{t("launchHealthP5.schemes.responses")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("launchHealthP5.schemes.response")}</th>
              <th scope="col">{t("launchHealthP5.schemes.credit")}</th>
            </tr>
          </thead>
          <tbody>
            {s.responses.map((r) => (
              <tr key={r.key} data-response={r.key}>
                <th scope="row">
                  {(locale === "ar" ? r.labelAr : r.labelEn) ?? t(`launchHealthP5.health.response.${r.key}`)}
                </th>
                <td>
                  {r.credit === null
                    ? t("launchHealthP5.schemes.noCredit")
                    : formatDecimal(r.credit, locale, { maxFractionDigits: 6 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap" tabIndex={0} role="region" aria-label={t("launchHealthP5.schemes.bands")}>
        <table className="table" data-table="scheme-bands">
          <caption>{t("launchHealthP5.schemes.bands")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("launchHealthP5.schemes.range")}</th>
              <th scope="col">{t("launchHealthP5.schemes.interpretation")}</th>
              <th scope="col">{t("launchHealthP5.schemes.origin")}</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b.key} data-band={b.rangeLabel}>
                <th scope="row">
                  <bdi dir="ltr">{b.rangeLabel}</bdi>
                </th>
                <td>{locale === "ar" ? b.textAr : b.textEn}</td>
                <td>
                  {b.origin === "source" ? (
                    <Chip tone="neutral" icon="info" label={t("launchHealthP5.schemes.originSource")} data="source" />
                  ) : (
                    <Chip tone="draft" icon="pencil" label={t("launchHealthP5.schemes.originAdmin")} data="admin" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
