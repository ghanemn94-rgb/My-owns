// Help > Guided walkthrough (T-DG5-FE-G; REQ-S18-004; ADR-0050 §7; M0349). The twelve steps — create transformation,
// diagnose and agree baseline, define outcomes/KPIs, design TOM, prioritize initiatives and approve mobilization, update
// delivery/adoption, submit KPI actual, validate benefit, resolve executive decision, generate report, accept BAU
// handover, continue performance monitoring — each with its navigation area, a link to the native screen where it is
// performed, and whether it is done, which the server evaluates from the transformation's persisted records on every
// read. The guide explains and links; it writes nothing and never marks a step done itself.
// Only in a demo database: elsewhere the server answers 409 environment.not_demo, shown by its code. Every approval in
// the walkthrough is a synthetic demonstration decision that approves nothing real (M0412).
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import { useAllTransformations } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { SyntheticApprovalLabel } from "../../components/demo-label/DemoLabels.tsx";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { ErrorState, LoadingState, NoPermissionState, QueryState } from "../../components/States.tsx";
import { problemText } from "../../lib/problem.ts";
import { Chip } from "../automation/ui.tsx";
import { AREA_WEB_ID, useDemoWalkthrough } from "./api.ts";

export function WalkthroughPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  usePageTitle(t("playbookP5.walkthrough.title"));
  const [params, setParams] = useSearchParams();
  const tid = params.get("transformationId");
  const walkthrough = useDemoWalkthrough(tid);
  const notDemo =
    walkthrough.error instanceof ApiError &&
    walkthrough.error.status === 409 &&
    walkthrough.error.code === "environment.not_demo";
  // D-181: every transformation the user may see (all pages): the one named in the URL is always among the choices.
  const transformations = useAllTransformations({ sort: "updatedAt:desc" });
  return (
    <div className="page" data-p5-screen="walkthrough">
      <PageHeader
        title={t("playbookP5.walkthrough.title")}
        subtitle={t("playbookP5.walkthrough.intro")}
        crumbs={[{ label: t("playbookP5.walkthrough.help") }, { label: t("playbookP5.walkthrough.title") }]}
      />
      {walkthrough.isPending ? (
        <LoadingState />
      ) : notDemo ? (
        <div className="state state--empty" role="note" data-state="not-demo">
          <Icon name="lock" />
          <div>
            <p className="state__title">{problemText(t, "environment.not_demo")}</p>
            <p className="state__body">{t("playbookP5.walkthrough.notDemoBody")}</p>
          </div>
        </div>
      ) : walkthrough.isError ? (
        walkthrough.error instanceof ApiError &&
        (walkthrough.error.status === 404 || walkthrough.error.status === 403) ? (
          <NoPermissionState error={walkthrough.error} />
        ) : (
          <ErrorState error={walkthrough.error} onRetry={() => void walkthrough.refetch()} />
        )
      ) : (
        <>
          <SyntheticApprovalLabel />
          <Section
            id="transformation"
            title={t("playbookP5.walkthrough.transformation")}
            intro={t("playbookP5.walkthrough.transformationIntro")}
          >
            <QueryState query={transformations}>
              {(items) => (
                <Field label={t("playbookP5.walkthrough.transformation")}>
                  {(p) => (
                    <select
                      {...p}
                      value={tid ?? ""}
                      onChange={(e) => setParams(e.target.value ? { transformationId: e.target.value } : {})}
                      data-filter="walkthrough-transformation"
                    >
                      <option value="">{t("playbookP5.walkthrough.noTransformation")}</option>
                      {items.map((tr) => (
                        <option key={tr.id} value={tr.id}>
                          {tr.code} · {tr.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
            </QueryState>
          </Section>
          <Section id="steps" title={t("playbookP5.walkthrough.steps")}>
            <p role="status" data-progress={walkthrough.data.completedCount}>
              {t("playbookP5.walkthrough.progress", {
                done: walkthrough.data.completedCount,
                total: walkthrough.data.total,
              })}
            </p>
            <ol className="plain-list walkthrough-steps" data-list="walkthrough-steps">
              {[...walkthrough.data.steps]
                .sort((a, b) => a.ordinal - b.ordinal)
                .map((s) => (
                  <li key={s.code} data-step={s.code} data-completed={s.completed ? "yes" : "no"} className="card">
                    <p className="card__title">
                      <span className="code">{s.ordinal}.</span> {locale === "ar" ? s.titleAr : s.titleEn}
                    </p>
                    <p>
                      {s.completed ? (
                        <Chip tone="good" icon="check" label={t("playbookP5.walkthrough.done")} data="done" />
                      ) : (
                        <Chip tone="neutral" icon="clock" label={t("playbookP5.walkthrough.notDone")} data="not-done" />
                      )}{" "}
                      <span className="muted">
                        {t("playbookP5.walkthrough.area")}: {t(`nav.areas.${AREA_WEB_ID[s.areaCode]}.label`)}
                      </span>
                    </p>
                    <p>
                      <Link className="link" to={s.route} data-step-link={s.code}>
                        {t("playbookP5.walkthrough.open")}
                      </Link>
                    </p>
                  </li>
                ))}
            </ol>
          </Section>
        </>
      )}
    </div>
  );
}
