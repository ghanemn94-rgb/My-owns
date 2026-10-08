// Funding decisions on the Initiative Card (T-DG3-FE-E; ADR-0021 §3 and §6, ADR-0023 §7; REQ-S09-003, REQ-S04-006).
// SYNTHETIC data only in tests and demos.
//  - "Record funding decision" is a BUSINESS APPROVAL (labelled so), offered only to holders of `funding.approve` (FIN
//    and SP by default) on a selected or funded initiative that is not closed. The decision is the approver's own, in
//    person: there is no "on behalf of" control (ADR-0021 §6).
//  - Outcome (approved, rejected, deferred, revoked), amount (a decimal string; empty = Unknown, never 0), currency
//    (the transformation's, default SAR), funding source, conditions, a REQUIRED rationale and an optional business case.
//  - The server's 422s (`funding.not_selected`, `funding.not_revocable`, `funding.amount_invalid` inline at /amount,
//    `funding.on_behalf_not_supported`) are translated as the dialog's one alert (`portfolio.problem.*`).
//  - The funding history comes from GET /funding-decisions?transformationId&initiativeId. After an approved decision
//    the card shows Funded (server `fundingState`); the deselect rule (T-DG3-BE-E §7.1) is shown: a decision recorded
//    before the latest selection no longer counts, so a re-selected initiative is 'Selected - unfunded' again.
import { fundingDecisionCreate, FUNDING_OUTCOMES } from "@mth/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { fetchAllPages, p3Keys, shouldRetry, useP3Refresh } from "../../api/queries.ts";
import type { FundingDecision, Initiative } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RecordDialog, type FieldSpec } from "../../components/RecordForm.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { formatDateTime, formatDecimal } from "../../lib/format.ts";
import { useBusinessCases } from "../business-cases/api.ts";
import { BusinessApprovalTag, PORTFOLIO_NS } from "./common.tsx";

/** Statuses on which a funding decision can be recorded (approve/reject/defer on selected; revoke on funded). */
export const FUNDABLE_STATUSES: ReadonlySet<string> = new Set(["selected", "funded"]);

export function useFundingDecisions(tid: string, initiativeId: string) {
  return useQuery({
    queryKey: p3Keys.initiativePart(tid, initiativeId, "funding-decisions"),
    queryFn: () => fetchAllPages<FundingDecision>("/api/v1/funding-decisions", { transformationId: tid, initiativeId }),
    enabled: Boolean(tid) && Boolean(initiativeId),
    retry: shouldRetry,
  });
}

const OUTCOME_ICON: Record<FundingDecision["outcome"], "check" | "cross" | "clock" | "stop"> = {
  approved: "check",
  rejected: "cross",
  deferred: "clock",
  revoked: "stop",
};

export function FundingSection({ initiative: i, readOnly }: { initiative: Initiative; readOnly: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const list = useFundingDecisions(ws.tid, i.id);
  const { byId } = usePeople(ws.tid);
  const [recording, setRecording] = useState(false);
  const canRecord = !readOnly && FUNDABLE_STATUSES.has(i.status) && ws.can("funding.approve");
  return (
    <Section
      id="funding"
      title={t("portfolio.fundingDecision.title")}
      intro={t("portfolio.fundingDecision.intro")}
      actions={
        <>
          <BusinessApprovalTag />
          {canRecord ? (
            <button
              type="button"
              className="button button--primary button--small"
              data-action="record-funding"
              onClick={() => setRecording(true)}
            >
              {t("portfolio.fundingDecision.record")}
              <span className="small"> ({t("portfolio.businessApproval")})</span>
            </button>
          ) : null}
        </>
      }
    >
      <QueryState query={list}>
        {(items) => {
          const sorted = [...items].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
          // BE-E §7.1: re-selection voids earlier funding. The server's fundingState decides; this explains it.
          const voided = i.status === "selected" && i.fundingState !== "funded" && sorted[0]?.outcome === "approved";
          return (
            <>
              {voided ? (
                <p className="banner banner--warning" role="note" data-state="funding-voided">
                  <Icon name="alert" /> {t("portfolio.fundingDecision.voidedBySelection")}
                </p>
              ) : null}
              {sorted.length === 0 ? (
                <p className="muted" data-state="empty">
                  {t("portfolio.fundingDecision.empty")}
                </p>
              ) : (
                <ul className="plain-list" data-testid="funding-history">
                  {sorted.map((d) => (
                    <li key={d.id} data-funding-outcome={d.outcome}>
                      <strong>
                        <Icon name={OUTCOME_ICON[d.outcome]} /> {t(`portfolio.fundingDecision.outcome.${d.outcome}`)}
                      </strong>{" "}
                      <bdi dir="ltr" className="code">
                        {d.decisionCode}
                      </bdi>
                      {" · "}
                      {t("portfolio.fundingDecision.amount")}:{" "}
                      {d.amount === null ? (
                        <Unknown />
                      ) : (
                        <bdi data-amount={d.amount}>
                          {formatDecimal(d.amount, locale, { maxFractionDigits: 4 })}{" "}
                          <span dir="ltr">{d.currency}</span>
                        </bdi>
                      )}
                      <span className="block text-cell">
                        {t("portfolio.fundingDecision.rationale")}: {d.rationale}
                      </span>
                      {d.fundingSource ? (
                        <span className="block small">
                          {t("portfolio.fundingDecision.fundingSource")}:{" "}
                          <span className="text-cell">{d.fundingSource}</span>
                        </span>
                      ) : null}
                      {d.conditions ? (
                        <span className="block small">
                          {t("portfolio.fundingDecision.conditions")}: <span className="text-cell">{d.conditions}</span>
                        </span>
                      ) : null}
                      {d.businessCaseId ? (
                        <Link
                          className="link block small"
                          to={`/transformations/${ws.tid}/business-cases/${d.businessCaseId}`}
                        >
                          {t("portfolio.fundingDecision.openBusinessCase")}
                        </Link>
                      ) : null}
                      <span className="block small muted">
                        {formatDateTime(d.decidedAt, locale, ws.tr.timezone)} ·{" "}
                        <PersonName id={d.decidedBy} people={byId} /> (
                        {t(`transformations.audit.role.${d.approverRoleCode}`, { defaultValue: d.approverRoleCode })})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </QueryState>
      {recording ? <FundingDialog initiative={i} onClose={() => setRecording(false)} /> : null}
    </Section>
  );
}

function FundingDialog({ initiative: i, onClose }: { initiative: Initiative; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP3Refresh(ws.tid);
  const cases = useBusinessCases(ws.tid);
  const caseOptions = (cases.data ?? [])
    .filter((c) => c.initiativeId === null || c.initiativeId === i.id)
    .map((c) => ({ value: c.id, label: `${c.code} ${c.title}` }));
  const fields: FieldSpec[] = [
    {
      name: "outcome",
      kind: "select",
      label: t("portfolio.fundingDecision.outcomeLabel"),
      required: true,
      options: FUNDING_OUTCOMES.map((o) => ({ value: o, label: t(`portfolio.fundingDecision.outcome.${o}`) })),
      hint: t("portfolio.fundingDecision.outcomeHint"),
    },
    {
      name: "amount",
      kind: "decimal",
      label: t("portfolio.fundingDecision.amount"),
      hint: t("portfolio.fundingDecision.amountHint"),
    },
    {
      name: "currency",
      kind: "text",
      label: t("portfolio.fundingDecision.currency"),
      required: true,
      maxLength: 3,
      dir: "ltr",
    },
    { name: "fundingSource", kind: "text", label: t("portfolio.fundingDecision.fundingSource"), maxLength: 300 },
    { name: "conditions", kind: "textarea", label: t("portfolio.fundingDecision.conditions"), maxLength: 4000 },
    {
      name: "rationale",
      kind: "textarea",
      label: t("portfolio.fundingDecision.rationale"),
      required: true,
      maxLength: 8000,
      rows: 4,
    },
    {
      name: "businessCaseId",
      kind: "select",
      label: t("portfolio.fundingDecision.businessCase"),
      options: caseOptions,
    },
  ];
  return (
    <RecordDialog
      title={t("portfolio.fundingDecision.dialogTitle", { code: i.code })}
      description={`${t("portfolio.businessApproval")}: ${t("portfolio.fundingDecision.dialogBody")}`}
      fields={fields}
      record={null}
      defaults={{ outcome: i.status === "funded" ? "revoked" : "approved", currency: ws.tr.currency || "SAR" }}
      createSchema={fundingDecisionCreate}
      createUrl="/api/v1/funding-decisions"
      extra={{ initiativeId: i.id }}
      namespaces={PORTFOLIO_NS}
      submitLabel={t("portfolio.fundingDecision.confirm")}
      onSaved={async () => {
        if (!(await refresh())) return;
        onClose();
      }}
      onCancel={onClose}
    >
      <p className="small muted" data-state="in-person">
        <Icon name="lock" /> {t("portfolio.fundingDecision.inPerson")}
      </p>
    </RecordDialog>
  );
}
