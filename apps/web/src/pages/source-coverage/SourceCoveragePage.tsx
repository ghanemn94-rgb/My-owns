// Source coverage (T-DG5-FE-B; REQ-S02-001; ADR-0039 §6, §12): the completeness report of a methodology version — each
// source element set of M0083 with its expected and present count, the elements removed in that version and the
// features still planned — and the check run that must pass (or warn) before that version can be published (422
// config_version.source_incomplete). Viewing needs methodology.read (TO, ADM, AUD); running needs source_coverage.run
// (the methodology administrator). Counts are integers; a result is always shown with its label and icon.
import { SOURCE_SET_CODES } from "@mth/shared/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { p5Paths, useConfigVersions, useStudioRefresh } from "../../api/p5.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { QueryState } from "../../components/States.tsx";
import { ReadOnlyNote } from "../my-work/p4ui.tsx";
import {
  isOpenDraft,
  useCoverage,
  versionState,
  type ConfigCheckRun,
  type SourceCoverageReport,
} from "../studio/api.ts";
import { CheckChip, ConfigurationNote, useActionRunner } from "../studio/ui.tsx";

/** The report's sets in the M0083 order (unknown set codes, if any, last). */
export function orderedSets(report: SourceCoverageReport) {
  const rank = (code: string) => {
    const i = (SOURCE_SET_CODES as readonly string[]).indexOf(code);
    return i < 0 ? SOURCE_SET_CODES.length : i;
  };
  return [...report.sets].sort((a, b) => rank(a.setCode) - rank(b.setCode));
}

export function SourceCoveragePage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  usePageTitle(t("nav.p5.sourceCoverage.title"));
  const [versionId, setVersionId] = useState("");
  const versions = useConfigVersions({ kind: "methodology" });
  const report = useCoverage(versionId || null);
  const refresh = useStudioRefresh();
  const runner = useActionRunner(refresh);
  const canRun = canAnywhere(me, "source_coverage.run");
  const [lastRun, setLastRun] = useState<ConfigCheckRun | null>(null);
  // A check run is recorded against a draft's content (a published version is immutable: 409 not_editable).
  const runnable = (id: string) => (versions.data ?? []).some((v) => v.id === id && isOpenDraft(v));

  return (
    <div className="page" data-p5-screen="source-coverage">
      <PageHeader
        title={t("nav.p5.sourceCoverage.title")}
        subtitle={t("nav.p5.sourceCoverage.summary")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("nav.p5.sourceCoverage.title") }]}
      />
      <ConfigurationNote />
      {!canRun ? <ReadOnlyNote body={t("studio.coverage.readOnly")} /> : null}
      {runner.alert}
      <div className="toolbar">
        <label>
          {t("studio.coverage.version")}{" "}
          <select
            value={versionId}
            onChange={(e) => {
              setVersionId(e.target.value);
              setLastRun(null);
            }}
          >
            <option value="">{t("studio.coverage.newestPublished")}</option>
            {(versions.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNo} · {t(`studio.state.${versionState(v)}`)} · {locale === "ar" ? v.titleAr : v.titleEn}
              </option>
            ))}
          </select>
        </label>
      </div>
      <QueryState query={report}>
        {(r) => (
          <>
            <section className="card" aria-labelledby="coverage-result">
              <h2 id="coverage-result" className="card__title">
                {t("studio.coverage.result")} <CheckChip status={r.result} />
              </h2>
              <p className="small">
                <Link className="link" to={`/admin/studio/versions/${r.versionId}`}>
                  {t("studio.coverage.openVersion")}
                </Link>{" "}
                · {t("studio.field.contentHash")}{" "}
                <bdi dir="ltr" className="code">
                  {r.contentSha256.slice(0, 12)}
                </bdi>
              </p>
              <p className="muted">{t("studio.coverage.intro")}</p>
              {canRun && !runnable(r.versionId) ? (
                <p className="small muted">{t("studio.coverage.runDraftOnly")}</p>
              ) : null}
              {canRun && runnable(r.versionId) ? (
                <div className="form__actions">
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={runner.busy}
                    data-action="run-coverage"
                    onClick={async () => {
                      const run = await runner.run<ConfigCheckRun>(p5Paths.sourceCoverageRuns, {
                        body: { versionId: r.versionId },
                      });
                      if (run) setLastRun(run);
                    }}
                  >
                    {t("studio.check.run.source_coverage")}
                  </button>
                </div>
              ) : null}
              {lastRun ? (
                <p role="status" data-state="coverage-run">
                  {t("studio.coverage.ran")} <CheckChip status={lastRun.result} />
                </p>
              ) : null}
            </section>
            <section className="card" aria-labelledby="coverage-sets">
              <h2 id="coverage-sets" className="card__title">
                {t("studio.coverage.sets")}
              </h2>
              <div className="table-wrap">
                <table className="table" data-table="coverage">
                  <caption className="visually-hidden">{t("studio.coverage.sets")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("studio.coverage.set")}</th>
                      <th scope="col">{t("studio.coverage.expected")}</th>
                      <th scope="col">{t("studio.coverage.present")}</th>
                      <th scope="col">{t("studio.coverage.removed")}</th>
                      <th scope="col">{t("studio.coverage.planned")}</th>
                      <th scope="col">{t("studio.check.result")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedSets(r).map((s) => (
                      <tr key={s.setCode} data-set={s.setCode}>
                        <th scope="row">{t(`studio.coverage.setName.${s.setCode}`)}</th>
                        <td data-expected>{s.expected}</td>
                        <td data-present>{s.present}</td>
                        <td>
                          {s.removed.length === 0 ? (
                            <span className="muted">{t("common.value.none")}</span>
                          ) : (
                            <bdi dir="ltr">{s.removed.join(", ")}</bdi>
                          )}
                        </td>
                        <td>
                          {s.plannedFeatures.length === 0 ? (
                            <span className="muted">{t("common.value.none")}</span>
                          ) : (
                            <bdi dir="ltr">{s.plannedFeatures.join(", ")}</bdi>
                          )}
                        </td>
                        <td>
                          <CheckChip status={s.result} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </QueryState>
    </div>
  );
}
