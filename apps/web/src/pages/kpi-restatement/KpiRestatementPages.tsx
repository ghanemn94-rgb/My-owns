// KPI restatement (T-DG5-FE-F; REQ-S07-016; ADR-0047 §1-§3, §6-§9; Strategy and KPIs > KPI > Restatement).
//  - Prospective by default: an approved KPI change applies from the next open period; a closed period changes only
//    through a restatement (ADR-0047 §1). The screen says so before anything else.
//  - A restatement names an approved version of the KPI, explicitly selected CLOSED reporting periods (at most 24) and a
//    reason. Its reconciliation (before and after per period, scope and basis) is a preview while the restatement is a
//    draft and is retained, unchanged, from submission on. A side that is Unknown, Stale or Not computable carries no
//    number, and is never shown as 0 or green.
//  - The decision is a business approval inside the product: only a holder of kpi_restatement.approve who is not the
//    requester decides (403 kpi_restatement.no_authority / .self_decision); a rejection needs a note.
//  - Issued reports never change: after approval, each affected issued report is offered for reissue as a new version.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useSessionNavigate } from "../../auth/sessionBound.ts";
import type { KpiRestatementReconciliation } from "@mth/shared/schemas";
import { useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canOn } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import type { IconName } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime, formatDecimal, formatMoney, formatPercent } from "../../lib/format.ts";
import { BusinessApprovalNote, ReadOnlyNote, useUserNames } from "../my-work/p4ui.tsx";
import { useTransformationTarget } from "../transformations/common.tsx";
import { Chip, NoteForm, StatusChip, type ChipTone } from "../automation/ui.tsx";
import { useKpiDictionaryEntry, useKpiVersions, useReportingPeriods } from "../kpi/api.ts";
import { Notice, useFefRunner } from "../launch-plan/ui.tsx";
import {
  restatementPaths,
  useKpiRestatement,
  useKpiRestatementOffers,
  useKpiRestatementReconciliation,
  useKpiRestatements,
  useRestatementRefresh,
  type KpiRestatement,
} from "./api.ts";

const STATUS: Record<string, readonly [ChipTone, IconName]> = {
  draft: ["draft", "pencil"],
  submitted: ["warn", "clock"],
  approved: ["good", "check"],
  rejected: ["bad", "cross"],
  withdrawn: ["closed", "stop"],
  applied: ["good", "check"],
};

const RAG: Record<string, readonly [ChipTone, IconName]> = {
  green: ["good", "check"],
  amber: ["warn", "alert"],
  red: ["bad", "cross"],
  unknown: ["neutral", "question"],
  stale: ["stale", "clock"],
  not_computable: ["neutral", "question"],
  none: ["neutral", "dot"],
};

function ProspectiveNote() {
  const { t } = useTranslation();
  return <Notice state="prospective">{t("launchHealthP5.restatement.prospective")}</Notice>;
}

function useTarget(tid: string) {
  const transformation = useTransformation(tid);
  return { transformation, target: useTransformationTarget(transformation.data) };
}

export function KpiRestatementsPage() {
  const { t } = useTranslation();
  const { id = "", kpiId = "" } = useParams();
  usePageTitle(t("launchHealthP5.restatement.title"));
  const me = useMe();
  const locale = useLocale();
  const { transformation, target } = useTarget(id);
  const entry = useKpiDictionaryEntry(id, kpiId);
  const list = useKpiRestatements(id, kpiId);
  const names = useUserNames((list.data ?? []).map((r) => r.requestedBy));
  const mayRequest = target ? canOn(me, "kpi_restatement.request", target) : false;
  const kpiName = entry.data?.definition.name ?? t("launchHealthP5.restatement.kpi");
  return (
    <div className="page" data-p5-screen="kpi-restatements">
      <PageHeader
        title={t("launchHealthP5.restatement.title")}
        subtitle={kpiName}
        crumbs={[
          { label: transformation.data?.name ?? t("launchHealthP5.transformation"), to: `/transformations/${id}` },
          { label: kpiName, to: `/transformations/${id}/kpis/${kpiId}` },
          { label: t("launchHealthP5.restatement.title") },
        ]}
      />
      <ProspectiveNote />
      <QueryState query={list}>
        {(items) => (
          <Section id="restatements" title={t("launchHealthP5.restatement.list")}>
            {items.length === 0 ? (
              <EmptyState
                title={t("launchHealthP5.restatement.none")}
                body={t("launchHealthP5.restatement.noneBody")}
              />
            ) : (
              <div className="table-wrap" tabIndex={0} role="region" aria-label={t("launchHealthP5.restatement.list")}>
                <table className="table" data-table="kpi-restatements">
                  <caption className="visually-hidden">{t("launchHealthP5.restatement.list")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("launchHealthP5.restatement.periods")}</th>
                      <th scope="col">{t("launchHealthP5.field.status")}</th>
                      <th scope="col">{t("launchHealthP5.restatement.requestedBy")}</th>
                      <th scope="col">{t("launchHealthP5.restatement.created")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...items]
                      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                      .map((r) => (
                        <tr key={r.id} data-restatement-status={r.status}>
                          <th scope="row">
                            <Link className="link" to={`/transformations/${id}/kpi-restatements/${r.id}`}>
                              {r.periods.map((p) => p.periodLabel).join(", ") ||
                                t("launchHealthP5.restatement.noPeriods")}
                            </Link>
                          </th>
                          <td>
                            <StatusChip value={r.status} table={STATUS} labelKey="launchHealthP5.restatement.status" />
                          </td>
                          <td>{names(r.requestedBy)}</td>
                          <td>{formatDateTime(r.createdAt, locale)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        )}
      </QueryState>
      {mayRequest ? (
        <CreateRestatement
          tid={id}
          kpiId={kpiId}
          orgId={transformation.data?.organizationId}
          frequency={entry.data?.definition.frequency}
        />
      ) : (
        <ReadOnlyNote />
      )}
    </div>
  );
}

function CreateRestatement({
  tid,
  kpiId,
  orgId,
  frequency,
}: {
  tid: string;
  kpiId: string;
  orgId: string | undefined;
  frequency: string | undefined;
}) {
  const { t } = useTranslation();
  const navigate = useSessionNavigate();
  const versions = useKpiVersions(tid, kpiId);
  const periods = useReportingPeriods(tid, orgId);
  const refresh = useRestatementRefresh(tid);
  const runner = useFefRunner(refresh);
  const [versionId, setVersionId] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const approved = (versions.data ?? []).filter((v) => v.status === "active" || v.status === "superseded");
  const closed = (periods.data ?? [])
    .filter((p) => p.status === "closed" && (!frequency || p.frequency === frequency))
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  return (
    <Section
      id="new-restatement"
      title={t("launchHealthP5.restatement.create")}
      intro={t("launchHealthP5.restatement.createIntro")}
    >
      <form
        className="form form--inset"
        noValidate
        data-form="create-restatement"
        onSubmit={(e) => {
          e.preventDefault();
          void runner
            .run<KpiRestatement>(restatementPaths.list(tid, kpiId), {
              body: { kpiVersionId: versionId, reportingPeriodIds: chosen, reason: reason.trim() },
            })
            .then((r) => {
              if (r) navigate(`/transformations/${tid}/kpi-restatements/${r.id}`);
            });
        }}
      >
        {runner.alert}
        <div className="field">
          <label className="field__label" htmlFor="restate-version">
            {t("launchHealthP5.restatement.version")}
          </label>
          <select id="restate-version" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
            <option value="">{t("launchHealthP5.choose")}</option>
            {approved.map((v) => (
              <option key={v.id} value={v.id}>
                {t("launchHealthP5.restatement.versionOption", {
                  n: v.versionNo,
                  status: t(`launchHealthP5.restatement.versionStatus.${v.status}`),
                })}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="field">
          <legend className="field__label">{t("launchHealthP5.restatement.choosePeriods")}</legend>
          {closed.length === 0 ? (
            <p className="muted">{t("launchHealthP5.restatement.noClosedPeriods")}</p>
          ) : (
            <div
              className="checkbox-list"
              role="group"
              tabIndex={0}
              aria-label={t("launchHealthP5.restatement.choosePeriods")}
              style={{ maxHeight: "14rem", overflowY: "auto" }}
            >
              {closed.map((p) => (
                <label key={p.id} className="checkbox">
                  <input
                    type="checkbox"
                    checked={chosen.includes(p.id)}
                    onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))}
                  />{" "}
                  {p.periodLabel}
                </label>
              ))}
            </div>
          )}
          <span className="field__hint">{t("launchHealthP5.restatement.periodsHint")}</span>
        </fieldset>
        <div className="field">
          <label className="field__label" htmlFor="restate-reason">
            {t("launchHealthP5.restatement.reason")}
          </label>
          <textarea
            id="restate-reason"
            rows={3}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="form__actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={runner.busy || !versionId || reason.trim().length < 3}
          >
            {t("launchHealthP5.restatement.createSubmit")}
          </button>
        </div>
      </form>
    </Section>
  );
}

export function KpiRestatementPage() {
  const { t } = useTranslation();
  const { id = "", restatementId = "" } = useParams();
  usePageTitle(t("launchHealthP5.restatement.title"));
  const { transformation } = useTarget(id);
  const r = useKpiRestatement(id, restatementId);
  return (
    <div className="page" data-p5-screen="kpi-restatement">
      <PageHeader
        title={t("launchHealthP5.restatement.title")}
        crumbs={[
          { label: transformation.data?.name ?? t("launchHealthP5.transformation"), to: `/transformations/${id}` },
          ...(r.data
            ? [
                {
                  label: t("launchHealthP5.restatement.list"),
                  to: `/transformations/${id}/kpis/${r.data.kpiDefinitionId}/restatements`,
                },
              ]
            : []),
          { label: t("launchHealthP5.restatement.one") },
        ]}
      />
      <ProspectiveNote />
      <QueryState query={r}>{(d) => <RestatementView tid={id} r={d} />}</QueryState>
    </div>
  );
}

function RestatementView({ tid, r }: { tid: string; r: KpiRestatement }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const { target } = useTarget(tid);
  const entry = useKpiDictionaryEntry(tid, r.kpiDefinitionId);
  const names = useUserNames([r.requestedBy, r.decidedBy, r.withdrawnBy]);
  const reconciliation = useKpiRestatementReconciliation(tid, r.id, r.version);
  const decided = r.status === "approved" || r.status === "applied";
  const offers = useKpiRestatementOffers(tid, r.id, decided);
  const refresh = useRestatementRefresh(tid);
  const submit = useFefRunner(refresh);
  const withdraw = useFefRunner(refresh);
  const decide = useFefRunner(refresh);
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const isRequester = r.requestedBy === me.user.id;
  const mayRequest = target ? canOn(me, "kpi_restatement.request", target) : false;
  const mayApprove = target ? canOn(me, "kpi_restatement.approve", target) : false;
  return (
    <>
      <section className="card" aria-labelledby="restatement-facts" data-restatement-status={r.status}>
        <h2 id="restatement-facts" className="card__title">
          {entry.data?.definition.name ?? t("launchHealthP5.restatement.kpi")}{" "}
          <StatusChip value={r.status} table={STATUS} labelKey="launchHealthP5.restatement.status" />
        </h2>
        <dl className="workspace-header__grid">
          <dt>{t("launchHealthP5.restatement.periods")}</dt>
          <dd data-periods={r.periods.length}>{r.periods.map((p) => p.periodLabel).join(", ")}</dd>
          <dt>{t("launchHealthP5.restatement.reason")}</dt>
          <dd>{r.reason}</dd>
          <dt>{t("launchHealthP5.restatement.requestedBy")}</dt>
          <dd>{names(r.requestedBy)}</dd>
          <dt>{t("launchHealthP5.restatement.authority")}</dt>
          <dd>{t("launchHealthP5.restatement.authorityValue")}</dd>
          {r.decidedAt ? (
            <>
              <dt>{t("launchHealthP5.restatement.decidedBy")}</dt>
              <dd>
                {names(r.decidedBy)} · {formatDateTime(r.decidedAt, locale)}
                {r.decisionNote ? <span className="block small">{r.decisionNote}</span> : null}
              </dd>
            </>
          ) : null}
          {r.appliedAt ? (
            <>
              <dt>{t("launchHealthP5.restatement.applied")}</dt>
              <dd>{formatDateTime(r.appliedAt, locale)}</dd>
            </>
          ) : null}
        </dl>
      </section>
      <Section
        id="reconciliation"
        title={t("launchHealthP5.restatement.reconciliation")}
        intro={
          reconciliation.data?.retained
            ? t("launchHealthP5.restatement.retained")
            : t("launchHealthP5.restatement.previewOnly")
        }
      >
        <QueryState query={reconciliation}>{(rec) => <ReconciliationTable rec={rec} />}</QueryState>
      </Section>
      {r.status === "draft" && isRequester && mayRequest ? (
        <Section
          id="submit-restatement"
          title={t("launchHealthP5.restatement.submitTitle")}
          intro={t("launchHealthP5.restatement.submitIntro")}
        >
          {submit.alert}
          <button
            type="button"
            className="button button--primary"
            disabled={submit.busy}
            onClick={() => void submit.run(restatementPaths.submit(tid, r.id), { ifMatch: r.version })}
          >
            {t("launchHealthP5.restatement.submit")}
          </button>
        </Section>
      ) : null}
      {r.status === "submitted" && mayApprove && !isRequester ? (
        <Section id="decide-restatement" title={t("launchHealthP5.restatement.decideTitle")}>
          <BusinessApprovalNote body={t("launchHealthP5.restatement.decideNote")} />
          {decide.alert}
          <fieldset className="field">
            <legend className="field__label">{t("launchHealthP5.restatement.decision")}</legend>
            {(["approve", "reject"] as const).map((d) => (
              <label key={d} className="radio">
                <input
                  type="radio"
                  name="restatement-decision"
                  checked={decision === d}
                  onChange={() => setDecision(d)}
                />{" "}
                {t(`launchHealthP5.restatement.decisionKind.${d}`)}
              </label>
            ))}
          </fieldset>
          <NoteForm
            id="decide-restatement"
            label={t("launchHealthP5.restatement.decisionNote")}
            submitLabel={t("launchHealthP5.restatement.recordDecision")}
            required={false}
            max={2000}
            busy={decide.busy}
            danger={decision === "reject"}
            onSubmit={(note) =>
              void decide.run(restatementPaths.decision(tid, r.id), {
                body: { decision, ...(note ? { note } : {}) },
                ifMatch: r.version,
              })
            }
          />
        </Section>
      ) : null}
      {r.status === "submitted" && isRequester ? (
        <Notice state="awaiting-decision">{t("launchHealthP5.restatement.awaiting")}</Notice>
      ) : null}
      {(r.status === "draft" || r.status === "submitted") && isRequester ? (
        <Section id="withdraw-restatement" title={t("launchHealthP5.restatement.withdrawTitle")}>
          {withdraw.alert}
          <button
            type="button"
            className="button button--danger"
            disabled={withdraw.busy}
            onClick={() => void withdraw.run(restatementPaths.withdraw(tid, r.id), { ifMatch: r.version })}
          >
            {t("launchHealthP5.restatement.withdraw")}
          </button>
        </Section>
      ) : null}
      {decided ? (
        <Section
          id="reissue-offers"
          title={t("launchHealthP5.restatement.offers")}
          intro={t("launchHealthP5.restatement.offersIntro")}
        >
          <QueryState query={offers}>
            {(items) =>
              items.length === 0 ? (
                <p className="muted">{t("launchHealthP5.restatement.noOffers")}</p>
              ) : (
                <ul className="plain-list" data-offers={items.length}>
                  {items.map((o) => (
                    <li key={o.snapshotId}>
                      <Link className="link" to={`/transformations/${tid}/reports/${o.snapshotId}`}>
                        {t("launchHealthP5.restatement.offer", {
                          code: o.definitionCode,
                          n: o.issueVersion,
                          period: o.periodLabel ?? t("common.value.unknown"),
                        })}
                      </Link>{" "}
                      <Chip
                        tone={o.snapshotStatus === "issued" ? "closed" : "neutral"}
                        icon="lock"
                        label={t(`launchHealthP5.restatement.snapshot.${o.snapshotStatus}`)}
                        data={o.snapshotStatus}
                      />
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryState>
        </Section>
      ) : null}
    </>
  );
}

type Row = KpiRestatementReconciliation["rows"][number];

function ValueCell({ value, status, rag, row }: { value: string | null; status: string; rag: string; row: Row }) {
  const locale = useLocale();
  if (value === null || status !== "ok")
    return (
      <span data-value-status={status}>
        <StatusChip
          value={status === "ok" ? "unknown" : status}
          table={RAG}
          labelKey="launchHealthP5.restatement.valueStatus"
        />
      </span>
    );
  const shown =
    row.unitKind === "currency"
      ? formatMoney(value, row.currency ?? "SAR", locale)
      : row.unitKind === "percentage"
        ? formatPercent(value, locale)
        : formatDecimal(value, locale, { maxFractionDigits: 6 });
  return (
    <span data-value={value}>
      {shown} <StatusChip value={rag} table={RAG} labelKey="launchHealthP5.restatement.rag" />
    </span>
  );
}

function ReconciliationTable({ rec }: { rec: KpiRestatementReconciliation }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (rec.rows.length === 0) return <p className="muted">{t("launchHealthP5.restatement.noRows")}</p>;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={t("launchHealthP5.restatement.reconciliation")}>
      <table className="table" data-table="reconciliation" data-retained={String(rec.retained)}>
        <caption className="visually-hidden">{t("launchHealthP5.restatement.reconciliation")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("launchHealthP5.restatement.period")}</th>
            <th scope="col">{t("launchHealthP5.restatement.scope")}</th>
            <th scope="col">{t("launchHealthP5.restatement.basis")}</th>
            <th scope="col">{t("launchHealthP5.restatement.before")}</th>
            <th scope="col">{t("launchHealthP5.restatement.after")}</th>
            <th scope="col">{t("launchHealthP5.restatement.difference")}</th>
          </tr>
        </thead>
        <tbody>
          {rec.rows.map((row) => (
            <tr
              key={`${row.reportingPeriodId}:${row.scopeKind}:${row.scopeId}:${row.valueBasis}`}
              data-period={row.periodLabel}
            >
              <th scope="row">{row.periodLabel}</th>
              <td>{t(`launchHealthP5.restatement.scopeKind.${row.scopeKind}`)}</td>
              <td>{t(`launchHealthP5.restatement.basisKind.${row.valueBasis}`)}</td>
              <td>
                <ValueCell value={row.before.value} status={row.before.valueStatus} rag={row.before.rag} row={row} />
              </td>
              <td>
                <ValueCell value={row.after.value} status={row.after.valueStatus} rag={row.after.rag} row={row} />
              </td>
              <td data-difference={row.difference ?? ""}>
                {row.difference === null ? (
                  <span className="muted">{t("launchHealthP5.restatement.noDifference")}</span>
                ) : (
                  formatDecimal(row.difference, locale, { maxFractionDigits: 6 })
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
