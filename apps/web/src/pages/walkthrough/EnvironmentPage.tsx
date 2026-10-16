// Administration > Environment (T-DG5-FE-G; REQ-S18-001, REQ-S18-002; ADR-0050 §1, §4-§6, §8-§9). The deployment's
// environment (production or demo), the latest demo dataset run with its record counts, checksum and seed coverage,
// and the in-app reset of a demo database to its seeded state (requestDemoReset; If-Match = the latest run number,
// "0" when none). The reset is refused outside a demo database (409 environment.not_demo), while one runs
// (demo_reset.in_progress) and where it is not configured (demo_reset.not_configured), each shown by its code.
// A reset discards everything demo users added, by design; it never touches a production database. Needs demo.reset
// (ADM_TECH); everyone else gets the 403 state. The reset is a configuration action, never a business approval.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api/client.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { ErrorState, LoadingState, NoPermissionState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { Chip, useRunner } from "../automation/ui.tsx";
import {
  demoKeys,
  demoPaths,
  useDemoEnvironmentStatus,
  type DemoEnvironmentStatus,
  type DemoResetRequest,
} from "./api.ts";

export function EnvironmentPage() {
  const { t } = useTranslation();
  usePageTitle(t("playbookP5.environment.title"));
  const status = useDemoEnvironmentStatus();
  return (
    <div className="page" data-p5-screen="environment">
      <PageHeader
        title={t("playbookP5.environment.title")}
        subtitle={t("playbookP5.environment.intro")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("playbookP5.environment.title") }]}
      />
      {status.isPending ? (
        <LoadingState />
      ) : status.isError ? (
        status.error instanceof ApiError && (status.error.status === 403 || status.error.status === 404) ? (
          <NoPermissionState error={status.error} />
        ) : (
          <ErrorState error={status.error} onRetry={() => void status.refetch()} />
        )
      ) : (
        <EnvironmentBody s={status.data} />
      )}
    </div>
  );
}

function EnvironmentBody({ s }: { s: DemoEnvironmentStatus }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const qc = useQueryClient();
  const runner = useRunner(() => qc.invalidateQueries({ queryKey: demoKeys.all }));
  const [queued, setQueued] = useState<DemoResetRequest | null>(null);
  const [confirming, setConfirming] = useState(false);
  const run = s.latestRun;
  return (
    <>
      <Section id="kind" title={t("playbookP5.environment.kind")}>
        <p data-environment-kind={s.kind}>
          {s.kind === "demo" ? (
            <span className="badge badge--provisional">{t("playbookP5.environment.kindDemo")}</span>
          ) : (
            <span className="lifecycle-chip">
              <Icon name="lock" /> {t("playbookP5.environment.kindProduction")}
            </span>
          )}
        </p>
        <p className="muted">
          {s.kind === "demo" ? t("playbookP5.environment.demoBody") : t("playbookP5.environment.productionBody")}
        </p>
      </Section>
      <Section id="run" title={t("playbookP5.environment.latestRun")}>
        {run === null ? (
          <p data-state="no-run">{t("playbookP5.environment.noRun")}</p>
        ) : (
          <>
            <dl className="workspace-header__grid" data-run={run.runNo}>
              <dt>{t("playbookP5.environment.run")}</dt>
              <dd>
                {t("playbookP5.environment.runN", { n: run.runNo })} ·{" "}
                {t(`playbookP5.environment.runKind.${run.runKind}`)} ·{" "}
                {t(`playbookP5.environment.via.${run.requestedVia}`)}
              </dd>
              <dt>{t("playbookP5.environment.dataset")}</dt>
              <dd>
                <bdi dir="ltr">
                  {run.datasetCode} {run.datasetVersion}
                </bdi>
              </dd>
              <dt>{t("playbookP5.environment.clock")}</dt>
              <dd>{formatDateTime(run.syntheticClockAt, locale)}</dd>
              <dt>{t("playbookP5.environment.completed")}</dt>
              <dd>{formatDateTime(run.completedAt, locale)}</dd>
              <dt>{t("playbookP5.environment.checksum")}</dt>
              <dd>
                <code dir="ltr" data-checksum="">
                  {run.checksumSha256}
                </code>
              </dd>
              <dt>{t("playbookP5.environment.coverage")}</dt>
              <dd>
                {run.coverageComplete ? (
                  <Chip tone="good" icon="check" label={t("playbookP5.environment.coverageComplete")} data="complete" />
                ) : (
                  <Chip
                    tone="warn"
                    icon="alert"
                    label={t("playbookP5.environment.coverageIncomplete")}
                    data="incomplete"
                  />
                )}
              </dd>
            </dl>
            <CountTable
              id="coverage"
              caption={t("playbookP5.environment.coverage")}
              keyLabel={t("playbookP5.environment.condition")}
              rows={run.coverage}
            />
            <CountTable
              id="counts"
              caption={t("playbookP5.environment.counts")}
              keyLabel={t("playbookP5.environment.table")}
              rows={run.recordCounts}
            />
          </>
        )}
      </Section>
      <Section id="reset" title={t("playbookP5.environment.reset")} intro={t("playbookP5.environment.resetIntro")}>
        {runner.alert}
        {queued ? (
          <p className="banner banner--success" role="status" data-state="reset-queued">
            <Icon name="check" />{" "}
            {t("playbookP5.environment.queued", { when: formatDateTime(queued.requestedAt, locale) })}
          </p>
        ) : null}
        {!s.resetConfigured && s.kind === "demo" ? (
          <p className="banner banner--warning" role="note">
            <Icon name="alert" /> {t("problems.demo_reset__not_configured")}
          </p>
        ) : null}
        {confirming ? (
          <div className="banner banner--warning" role="alertdialog" aria-labelledby="reset-confirm-title">
            <p id="reset-confirm-title" className="state__title">
              {t("playbookP5.environment.confirmTitle")}
            </p>
            <p>{t("playbookP5.environment.confirmBody")}</p>
            <div className="form__actions">
              <button
                type="button"
                className="button button--primary"
                disabled={runner.busy}
                data-action="confirm-demo-reset"
                onClick={() => {
                  void runner
                    .run<DemoResetRequest>(demoPaths.resets, { method: "POST", ifMatch: s.version })
                    .then((r) => {
                      setConfirming(false);
                      if (r) setQueued(r);
                    });
                }}
              >
                {t("playbookP5.environment.confirm")}
              </button>
              <button type="button" className="button button--secondary" onClick={() => setConfirming(false)}>
                {t("common.action.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="button button--secondary"
            data-action="request-demo-reset"
            onClick={() => {
              runner.clear();
              setConfirming(true);
            }}
          >
            {t("playbookP5.environment.requestReset")}
          </button>
        )}
      </Section>
    </>
  );
}

function CountTable({
  id,
  caption,
  keyLabel,
  rows,
}: {
  id: string;
  caption: string;
  keyLabel: string;
  rows: Readonly<Record<string, number>>;
}) {
  const { t } = useTranslation();
  const entries = Object.entries(rows).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="table table--compact" data-table={id}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{keyLabel}</th>
            <th scope="col">{t("playbookP5.environment.count")}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">
                <code dir="ltr">{k}</code>
              </th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
