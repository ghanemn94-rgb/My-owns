// A KPI actual (one slot: KPI × scope × period) and the review queue (T-DG4-FE-B; REQ-S07-003, REQ-S07-012,
// REQ-S07-013; ADR-0027 §6, §8). SYNTHETIC data only.
//  - The slot shows every value version (entered value, "not available" with its reason, evidence) and every review.
//    A saved draft is labelled "Draft – not submitted"; a submitted value is "Submitted – review pending" and is NOT
//    used until it is accepted (REQ-S07-012); the accepted value number is shown separately.
//  - The configured reviewer accepts (comment optional) or rejects (reason required). The submitter never decides
//    their own value (403 kpi_actual.sod_submitter; the UI does not offer it). One accept = one calculation run.
//  - This is the backend's work-item link (`/transformations/:id/kpis/:kpiId/actuals/:actualId`, KBE-C).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { P4FormDialog, textOf, useUserNames } from "../my-work/p4ui.tsx";
import {
  kpiPaths,
  useEvidenceOptions,
  useKpiActual,
  useKpiDictionary,
  useKpiReviewQueue,
  type KpiActual,
} from "./api.ts";
import { ReasonForm } from "./KpiPage.tsx";
import { ActualStatusChip, BusinessDate, formatKpiValue, KpiLink, KpiSubNav, NS, ValueState } from "./ui.tsx";

export function KpiActualPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="define"
      title={t("kpiP4.actual.title")}
      subtitle={t("kpiP4.actual.intro")}
      writePermissions={["kpi_actual.submit", "kpi_actual.accept"]}
    >
      <ActualBody />
    </WorkspaceFrame>
  );
}

/** Accept / reject buttons and their dialogs, for a submitted value the caller did not submit. */
export function ReviewActions({ actual, kpiName }: { actual: KpiActual; kpiName: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const [mode, setMode] = useState<"accept" | "reject" | null>(null);
  if (actual.status !== "submitted") return null;
  if (!ws.can("kpi_actual.accept")) return <span className="muted small">{t("common.readOnly")}</span>;
  if (actual.submittedBy === ws.meId)
    return (
      <span className="muted small" data-state="sod">
        {t("kpiP4.review.ownValue")}
      </span>
    );
  const label = `${kpiName} · ${actual.periodLabel}`;
  return (
    <span className="row-actions">
      <button
        type="button"
        className="button button--link button--small"
        data-action="accept-actual"
        onClick={() => setMode("accept")}
      >
        <Icon name="check" /> {t("kpiP4.review.accept")}
        <span className="visually-hidden">: {label}</span>
      </button>
      <button
        type="button"
        className="button button--link button--small"
        data-action="reject-actual"
        onClick={() => setMode("reject")}
      >
        <Icon name="cross" /> {t("kpiP4.review.reject")}
        <span className="visually-hidden">: {label}</span>
      </button>
      {mode === "accept" ? (
        <P4FormDialog
          title={t("kpiP4.review.acceptTitle", { label })}
          namespaces={NS}
          url={kpiPaths.acceptActual(ws.tid, actual.id)}
          version={actual.version}
          note={<p className="small muted">{t("kpiP4.review.acceptNote")}</p>}
          fields={[{ name: "comment", label: t("kpiP4.action.comment"), kind: "textarea", max: 2000 }]}
          submitLabel={t("kpiP4.review.accept")}
          toBody={(v) => ({ comment: textOf(v["comment"]) ?? null })}
          onDone={() => refresh()}
          onClose={() => setMode(null)}
        />
      ) : null}
      {mode === "reject" ? (
        <ReasonForm
          title={t("kpiP4.review.rejectTitle", { label })}
          url={kpiPaths.rejectActual(ws.tid, actual.id)}
          version={actual.version}
          submitLabel={t("kpiP4.review.reject")}
          onDone={() => refresh()}
          onClose={() => setMode(null)}
        />
      ) : null}
    </span>
  );
}

function ActualBody() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const { kpiId = "", actualId = "" } = useParams();
  const actual = useKpiActual(ws.tid, actualId);
  const dictionary = useKpiDictionary(ws.tid);
  const evidence = useEvidenceOptions(ws.tid);
  const entry = (dictionary.data ?? []).find((d) => d.definition.id === kpiId);
  const unitKind = entry?.activeVersion?.unitKind ?? entry?.definition.unitKind ?? "other";
  const currency = entry?.activeVersion?.currency ?? entry?.definition.currency ?? null;
  const names = useUserNames([
    ...(actual.data?.values.map((v) => v.enteredBy) ?? []),
    ...(actual.data?.reviews.map((r) => r.decidedBy) ?? []),
    ...(actual.data?.reviews.map((r) => r.onBehalfOfUserId) ?? []),
  ]);
  const evidenceTitle = (id: string) =>
    (evidence.data ?? []).find((e) => e.id === id)?.title ?? t("kpiP4.actual.evidenceRef", { ref: id.slice(-4) });
  return (
    <>
      <KpiSubNav tid={ws.tid} kpiId={kpiId} />
      <QueryState query={actual}>
        {(a) => (
          <>
            <Section
              id="kpi-actual"
              title={t("kpiP4.actual.slotTitle", { name: entry?.definition.name ?? "", period: a.periodLabel })}
              actions={<ReviewActions actual={a} kpiName={entry?.definition.name ?? ""} />}
            >
              <dl className="details">
                <div>
                  <dt>{t("kpiP4.field.kpi")}</dt>
                  <dd>
                    <KpiLink
                      tid={ws.tid}
                      kpiId={a.kpiDefinitionId}
                      name={entry?.definition.name ?? t("kpiP4.field.kpi")}
                    />
                  </dd>
                </div>
                <div>
                  <dt>{t("kpiP4.field.status")}</dt>
                  <dd>
                    <ActualStatusChip status={a.status} />
                  </dd>
                </div>
                <div>
                  <dt>{t("kpiP4.field.period")}</dt>
                  <dd>
                    <bdi dir="ltr" className="code">
                      {a.periodLabel}
                    </bdi>{" "}
                    (<BusinessDate date={a.periodStart} /> – <BusinessDate date={a.periodEnd} />)
                  </dd>
                </div>
                <div>
                  <dt>{t("kpiP4.field.scope")}</dt>
                  <dd>{t(`kpiP4.scopeKind.${a.scopeKind}`)}</dd>
                </div>
                <div>
                  <dt>{t("kpiP4.version.submissionRoute")}</dt>
                  <dd>{t(`kpiP4.version.routes.${a.route}`)}</dd>
                </div>
                <div>
                  <dt>{t("kpiP4.actual.acceptedValueNo")}</dt>
                  <dd>{a.acceptedValueNo === null ? t("kpiP4.actual.noneAccepted") : a.acceptedValueNo}</dd>
                </div>
              </dl>
              {a.status === "submitted" ? (
                <p className="banner banner--info" role="note" data-state="review-pending">
                  <Icon name="clock" /> {t("kpiP4.actual.notUsedUntilAccepted")}
                </p>
              ) : a.status === "draft" ? (
                <p className="banner banner--info" role="note" data-state="draft">
                  <Icon name="pencil" /> {t("kpiP4.actual.draftNotUsed")}
                </p>
              ) : a.status === "rejected" ? (
                <p className="banner banner--warning" role="note" data-state="rejected">
                  <Icon name="alert" /> {t("kpiP4.actual.rejectedNote", { reason: a.decisionReason ?? "" })}{" "}
                  <Link className="link" to={`/transformations/${ws.tid}/kpis/${kpiId}/actuals`}>
                    {t("kpiP4.actual.correct")}
                  </Link>
                </p>
              ) : null}
            </Section>
            <Section id="kpi-actual-values" title={t("kpiP4.actual.valuesTitle")} intro={t("kpiP4.actual.valuesIntro")}>
              <div className="table-wrap" tabIndex={0} role="region" aria-label={t("kpiP4.actual.valuesTitle")}>
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th scope="col">{t("kpiP4.actual.valueNo")}</th>
                      <th scope="col">{t("kpiP4.field.actual")}</th>
                      <th scope="col">{t("kpiP4.field.dataAsOf")}</th>
                      <th scope="col">{t("kpiP4.field.evidence")}</th>
                      <th scope="col">{t("kpiP4.actual.enteredBy")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...a.values]
                      .sort((x, y) => y.valueNo - x.valueNo)
                      .map((v) => (
                        <tr key={v.valueNo} data-value-no={v.valueNo}>
                          <th scope="row">
                            {v.valueNo}
                            {v.valueNo === a.acceptedValueNo ? (
                              <span className="block small">{t("kpiP4.actual.acceptedMark")}</span>
                            ) : null}
                          </th>
                          <td>
                            {v.missingReason ? (
                              <span className="block">
                                <ValueState status="unknown" reason="kpi.value_not_available" />
                                <span className="block small">{v.missingReason}</span>
                              </span>
                            ) : v.milestoneAchieved !== null ? (
                              v.milestoneAchieved ? (
                                <span>
                                  {t("kpiP4.update.achievedYes")} · <BusinessDate date={v.achievedOn} />
                                </span>
                              ) : (
                                t("kpiP4.update.achievedNo")
                              )
                            ) : v.value !== null ? (
                              <bdi dir="ltr">{formatKpiValue(v.value, unitKind, v.currency ?? currency, locale)}</bdi>
                            ) : v.numerator !== null ? (
                              <bdi dir="ltr">
                                {v.numerator} / {v.denominator}
                              </bdi>
                            ) : (
                              <ValueState status="unknown" />
                            )}
                            {v.comment ? <span className="block small muted">{v.comment}</span> : null}
                          </td>
                          <td>
                            <BusinessDate date={v.dataAsOf} />
                          </td>
                          <td>
                            {v.evidenceIds.length === 0 ? (
                              <span className="muted">{t("common.value.none")}</span>
                            ) : (
                              <ul className="plain-list">
                                {v.evidenceIds.map((id) => (
                                  <li key={id}>
                                    <Link className="link" to={`/transformations/${ws.tid}/evidence#ev-${id}`}>
                                      {evidenceTitle(id)}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td>
                            {names(v.enteredBy)}
                            <span className="block small muted">
                              {formatDateTime(v.enteredAt, locale, ws.tr.timezone)}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Section>
            <Section id="kpi-actual-reviews" title={t("kpiP4.actual.reviewsTitle")}>
              {a.reviews.length === 0 ? (
                <p className="muted">{t("kpiP4.actual.noReviews")}</p>
              ) : (
                <ul className="plain-list" data-reviews={a.reviews.length}>
                  {a.reviews.map((r, i) => (
                    <li key={`${r.valueNo}:${i}`} data-review-outcome={r.outcome}>
                      <strong>{t(`kpiP4.review.outcomes.${r.outcome}`)}</strong> · {t("kpiP4.actual.valueNo")}{" "}
                      {r.valueNo} ·{" "}
                      {r.onBehalfOfUserId
                        ? t("kpiP4.review.onBehalf", { by: names(r.decidedBy), of: names(r.onBehalfOfUserId) })
                        : names(r.decidedBy)}{" "}
                      · {formatDateTime(r.decidedAt, locale, ws.tr.timezone)}
                      {r.reason ? <span className="block small">{r.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </QueryState>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ review queue

export function KpiReviewPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="define"
      title={t("kpiP4.review.title")}
      subtitle={t("kpiP4.review.intro")}
      writePermissions={["kpi_actual.accept"]}
    >
      <ReviewQueue />
    </WorkspaceFrame>
  );
}

function ReviewQueue() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const queue = useKpiReviewQueue(ws.tid);
  const dictionary = useKpiDictionary(ws.tid);
  const names = useUserNames((queue.data ?? []).map((a) => a.submittedBy));
  const kpiOf = (id: string) => (dictionary.data ?? []).find((d) => d.definition.id === id);
  const columns: RegisterColumn<KpiActual>[] = [
    {
      id: "kpi",
      header: t("kpiP4.field.kpi"),
      rowHeader: true,
      hideable: false,
      cell: (a) => (
        <Link className="link" to={`/transformations/${ws.tid}/kpis/${a.kpiDefinitionId}/actuals/${a.id}`}>
          {kpiOf(a.kpiDefinitionId)?.definition.name ?? t("kpiP4.field.kpi")}
        </Link>
      ),
      sortValue: (a) => kpiOf(a.kpiDefinitionId)?.definition.name,
    },
    {
      id: "period",
      header: t("kpiP4.field.period"),
      cell: (a) => <bdi dir="ltr">{a.periodLabel}</bdi>,
      sortValue: (a) => a.periodStart,
    },
    {
      id: "value",
      header: t("kpiP4.actual.current"),
      cell: (a) => {
        const v = a.values.find((x) => x.valueNo === a.currentValueNo);
        const e = kpiOf(a.kpiDefinitionId);
        if (!v || v.missingReason)
          return <ValueState status="unknown" reason={v?.missingReason ? "kpi.value_not_available" : null} />;
        if (v.value === null)
          return v.numerator !== null ? (
            <bdi dir="ltr">
              {v.numerator} / {v.denominator}
            </bdi>
          ) : (
            <ValueState status="unknown" />
          );
        return (
          <bdi dir="ltr">
            {formatKpiValue(
              v.value,
              e?.activeVersion?.unitKind ?? e?.definition.unitKind ?? "other",
              v.currency,
              locale,
            )}
          </bdi>
        );
      },
    },
    { id: "status", header: t("kpiP4.field.status"), cell: (a) => <ActualStatusChip status={a.status} /> },
    {
      id: "submitted",
      header: t("kpiP4.review.submittedBy"),
      cell: (a) => (
        <span className="block">
          {names(a.submittedBy)}
          <span className="block small muted">{formatDateTime(a.submittedAt, locale, ws.tr.timezone)}</span>
        </span>
      ),
      sortValue: (a) => a.submittedAt,
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (a) => <ReviewActions actual={a} kpiName={kpiOf(a.kpiDefinitionId)?.definition.name ?? ""} />,
    },
  ];
  return (
    <>
      <KpiSubNav tid={ws.tid} />
      <Section id="kpi-review-queue" title={t("kpiP4.review.queueTitle")} intro={t("kpiP4.review.queueIntro")}>
        <QueryState query={queue}>
          {(rows) => (
            <RegisterTable
              id="kpi-review-queue"
              caption={t("kpiP4.review.queueTitle")}
              rows={rows}
              columns={columns}
              getRowId={(a) => a.id}
              emptyTitle={t("kpiP4.review.empty")}
              emptyBody={t("kpiP4.review.emptyBody")}
              defaultSort={{ id: "submitted", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
    </>
  );
}
