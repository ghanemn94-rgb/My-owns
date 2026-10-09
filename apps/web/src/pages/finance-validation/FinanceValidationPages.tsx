// Benefits and Finance > Finance validation (T-DG4-FE-C; p4-work-split §B.5; ADR-0030 §3-§4, §7). SYNTHETIC data only.
// A Finance validation is a human Finance decision inside the product; it is never an engineering delivery gate
// (DG0-DG7) and no agent or demo record grants a real one.
//  - The queue (REQ-S12-014): one item per submitted value, oldest first; organization-wide (every transformation
//    the caller may read) and per transformation. Each item names its benefit, period and amount; pending is pending.
//  - The decision (REQ-S08-015, REQ-PB-013): the six items (baseline, attribution/counterfactual, calculation,
//    evidence, measurement period, assumptions) each accepted or rejected with a note; approve needs all six accepted
//    and, for a financial value, the approved amount; reject needs a note and at least one rejected item. Only FIN may
//    decide, and never the submitter (403 translated). A provisional basis is labelled (REQ-S08-008).
//  - Corrections (REQ-S08-017): an approved value is never edited; Finance records an amendment (the corrected
//    amount) or a reversal, linked to the original; every row stays visible.
//  - Portfolio totals: the organization's totals by class and state (ADR-0030 §7).
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { FINANCE_ITEMS, FINANCE_VALIDATION_STATUSES, type FinanceItem } from "@mth/shared/schemas";
import { useP4KeyRefresh, useP4Refresh, p4Keys } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { useMe } from "../../auth/session.tsx";
import { canOn } from "../../auth/permissions.ts";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { fieldErrorMessage } from "../../lib/problem.ts";
import { P4FormDialog, textOf } from "../my-work/p4ui.tsx";
import {
  benefitPaths,
  useBenefit,
  useBenefitMeasurement,
  useFinanceQueue,
  useFinanceValidation,
  usePortfolioBenefitTotals,
  useReadableTransformations,
  type FinanceValidation,
  type Transformation,
} from "../benefits/api.ts";
import { BENEFIT_WRITE_PERMISSIONS } from "../benefits/BenefitsPage.tsx";
import { SendDialog } from "../benefits/dialogs.tsx";
import { TotalsView } from "../benefits/Totals.tsx";
import {
  BenefitLink,
  BenefitSubNav,
  Code,
  FinanceValidationNote,
  MONEY_INPUT,
  Measure,
  Money,
  NS,
  Period,
  RecordChip,
  UnknownChip,
} from "../benefits/ui.tsx";
import { useQueries } from "@tanstack/react-query";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

// ------------------------------------------------------------------------------------------------ shared

function FvAmount({ fv }: { fv: FinanceValidation }) {
  const c = fv.content.calculation;
  if (c.amount !== null) return <Money value={c.amount} currency={c.currency} />;
  if (c.kpiValue !== null) return <Measure value={c.kpiValue} />;
  return <UnknownChip />;
}

function queueColumns(
  t: TFunction,
  tidOf: (fv: FinanceValidation) => string,
  trLabel?: (fv: FinanceValidation) => string,
): RegisterColumn<FinanceValidation>[] {
  return [
    {
      id: "item",
      header: t("benefitsP4.finance.item"),
      rowHeader: true,
      hideable: false,
      cell: (fv) => (
        <Link
          className="link"
          to={`/transformations/${tidOf(fv)}/finance-validations/${fv.id}`}
          data-finance-validation={fv.id}
        >
          {t(`benefitsP4.finance.kind.${fv.kind}`)} · {t("benefitsP4.finance.itemRef", { ref: fv.id.slice(-4) })}
        </Link>
      ),
      sortValue: (fv) => fv.createdAt,
    },
    ...(trLabel
      ? [
          {
            id: "transformation",
            header: t("benefitsP4.finance.transformation"),
            cell: (fv: FinanceValidation) => trLabel(fv),
            sortValue: (fv: FinanceValidation) => trLabel(fv),
          },
        ]
      : []),
    {
      id: "benefit",
      header: t("benefitsP4.col.benefit"),
      cell: (fv) => (
        <BenefitLink tid={tidOf(fv)} id={fv.benefitId}>
          {t("benefitsP4.benefitRef", { ref: fv.benefitId.slice(-4) })}
        </BenefitLink>
      ),
    },
    {
      id: "period",
      header: t("benefitsP4.measurements.period"),
      cell: (fv) => <Period start={fv.content.measurementPeriod.start} end={fv.content.measurementPeriod.end} />,
      sortValue: (fv) => fv.content.measurementPeriod.start,
    },
    { id: "amount", header: t("benefitsP4.finance.submittedValue"), cell: (fv) => <FvAmount fv={fv} /> },
    {
      id: "status",
      header: t("benefitsP4.finance.statusCol"),
      cell: (fv) => <RecordChip group="finance" status={fv.status} />,
      sortValue: (fv) => fv.status,
      filterText: (fv) => t(`benefitsP4.finance.status.${fv.status}`),
    },
  ];
}

function StatusFilter({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const { t } = useTranslation();
  return (
    <div className="filters" role="group" aria-label={t("benefitsP4.register.filters")}>
      <div className="filters__select">
        <label htmlFor={id}>{t("benefitsP4.finance.statusCol")}</label>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("benefitsP4.overlaps.all")}</option>
          {FINANCE_VALIDATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`benefitsP4.finance.status.${s}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ organization queue

/** /finance-validation: the queue of every transformation the caller may read, and the portfolio totals. */
export function FinanceValidationPage() {
  const { t } = useTranslation();
  const me = useMe();
  usePageTitle(t("benefitsP4.finance.orgTitle"));
  const [status, setStatus] = useState("queued");
  const transformations = useReadableTransformations();
  const trs = (transformations.data ?? []).filter((x) => x.archivedAt === null);
  const queues = useQueries({
    queries: trs.map((tr) => ({
      queryKey: [...p4Keys.financeQueue(me.organization.id), tr.id, status],
      queryFn: () => fetchAllPages<FinanceValidation>(benefitPaths.financeQueue(tr.id), status ? { status } : {}),
      retry: shouldRetry,
    })),
  });
  const tidByFv = new Map<string, Transformation>();
  const items: FinanceValidation[] = [];
  queues.forEach((q, i) => {
    for (const fv of q.data ?? []) {
      tidByFv.set(fv.id, trs[i]!);
      items.push(fv);
    }
  });
  const pending = transformations.isPending || queues.some((q) => q.isPending);
  const unreadable = queues.filter((q) => q.isError).length;
  const columns = queueColumns(
    t,
    (fv) => tidByFv.get(fv.id)!.id,
    (fv) => {
      const tr = tidByFv.get(fv.id)!;
      return `${tr.code} · ${tr.name}`;
    },
  );
  const canReadOrg = canOn(me, "organization.read", { level: "organization", organizationId: me.organization.id });
  return (
    <div className="page">
      <PageHeader title={t("benefitsP4.finance.orgTitle")} subtitle={t("benefitsP4.finance.orgIntro")} />
      <FinanceValidationNote body={t("benefitsP4.finance.labelNote")} />
      <Section id="finance-queue" title={t("benefitsP4.finance.queueTitle")} intro={t("benefitsP4.finance.queueIntro")}>
        <StatusFilter id="org-finance-status" value={status} onChange={setStatus} />
        <QueryState query={transformations}>
          {() =>
            pending ? (
              <p className="muted" role="status">
                {t("common.state.loading")}
              </p>
            ) : (
              <>
                {unreadable > 0 ? (
                  <p className="banner banner--warning" role="note" data-state="queues-unreadable">
                    <Icon name="alert" /> {t("benefitsP4.finance.someUnreadable", { count: unreadable })}
                  </p>
                ) : null}
                <RegisterTable
                  id="finance-queue-org"
                  caption={t("benefitsP4.finance.queueTitle")}
                  rows={items}
                  columns={columns}
                  getRowId={(fv) => fv.id}
                  emptyTitle={t("benefitsP4.finance.empty")}
                  emptyBody={t("benefitsP4.finance.emptyBody")}
                  defaultSort={{ id: "item", dir: "asc" }}
                />
              </>
            )
          }
        </QueryState>
      </Section>
      {canReadOrg ? <PortfolioTotals orgId={me.organization.id} /> : null}
    </div>
  );
}

function PortfolioTotals({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const totals = usePortfolioBenefitTotals(orgId);
  return (
    <Section
      id="portfolio-totals"
      title={t("benefitsP4.totals.portfolioTitle")}
      intro={t("benefitsP4.totals.portfolioIntro")}
    >
      <QueryState query={totals}>{(data) => <TotalsView totals={data} />}</QueryState>
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ transformation queue

export function TransformationFinanceQueuePage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="business-cases"
      title={t("benefitsP4.finance.queueTitle")}
      subtitle={t("benefitsP4.finance.queueIntro")}
      writePermissions={["finance.validate"]}
    >
      <TransformationQueue />
    </WorkspaceFrame>
  );
}

function TransformationQueue() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [status, setStatus] = useState("queued");
  const queue = useFinanceQueue(ws.tid, status ? { status } : {});
  return (
    <>
      <BenefitSubNav tid={ws.tid} />
      <FinanceValidationNote body={t("benefitsP4.finance.labelNote")} />
      <Section id="finance-queue" title={t("benefitsP4.finance.queueTitle")}>
        <StatusFilter id="finance-status" value={status} onChange={setStatus} />
        <QueryState query={queue}>
          {(rows) => (
            <RegisterTable
              id="finance-queue"
              caption={t("benefitsP4.finance.queueTitle")}
              rows={rows}
              columns={queueColumns(t, () => ws.tid)}
              getRowId={(fv) => fv.id}
              emptyTitle={t("benefitsP4.finance.empty")}
              emptyBody={t("benefitsP4.finance.emptyBody")}
              defaultSort={{ id: "item", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ one validation

export function FinanceValidationDetailPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="business-cases"
      title={t("benefitsP4.finance.detailTitle")}
      subtitle={t("benefitsP4.finance.detailIntro")}
      writePermissions={["finance.validate"]}
    >
      <Detail />
    </WorkspaceFrame>
  );
}

function Detail() {
  const ws = useWorkspace();
  const { financeValidationId = "" } = useParams();
  const fv = useFinanceValidation(ws.tid, financeValidationId);
  return (
    <>
      <BenefitSubNav tid={ws.tid} />
      <QueryState query={fv}>{(x) => <DetailBody fv={x} />}</QueryState>
    </>
  );
}

function DetailBody({ fv }: { fv: FinanceValidation }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const me = useMe();
  const locale = useLocale();
  const refresh = useP4Refresh(ws.tid);
  const keyRefresh = useP4KeyRefresh();
  const benefit = useBenefit(ws.tid, fv.benefitId);
  const measurement = useBenefitMeasurement(ws.tid, fv.benefitMeasurementId);
  const { byId } = usePeople(ws.tid);
  const [dialog, setDialog] = useState<"decide" | "amend" | "reverse" | null>(null);
  const canDecide = ws.can("finance.validate");
  const submitter = measurement.data?.submittedBy ?? null;
  const isSubmitter = submitter !== null && submitter === me.user.id;
  const provisional = measurement.data?.basis === "provisional";
  const financial = fv.content.calculation.amount !== null;
  const person = (id: string | null) =>
    id ? (byId.get(id)?.label ?? t("benefitsP4.person", { ref: id.slice(-4) })) : t("benefitsP4.finance.finParty");
  const done = async () => {
    const ok = await refresh();
    if (ok) await keyRefresh(p4Keys.financeQueue(me.organization.id));
    return ok;
  };
  const c = fv.content;
  return (
    <>
      <Section
        id="finance-validation"
        title={`${t(`benefitsP4.finance.kind.${fv.kind}`)} · ${t("benefitsP4.finance.itemRef", { ref: fv.id.slice(-4) })}`}
        intro={
          benefit.data ? (
            <BenefitLink tid={ws.tid} id={fv.benefitId}>
              <Code>{benefit.data.code}</Code> {benefit.data.title}
            </BenefitLink>
          ) : null
        }
        actions={
          <>
            {canDecide && fv.status === "queued" && !isSubmitter ? (
              <button type="button" className="button button--primary" onClick={() => setDialog("decide")}>
                <Icon name="lock" /> {t("benefitsP4.finance.decide")}
              </button>
            ) : null}
            {canDecide && fv.status === "approved" && fv.kind === "validation" && financial ? (
              <button type="button" className="button button--secondary" onClick={() => setDialog("amend")}>
                {t("benefitsP4.finance.amend")}
              </button>
            ) : null}
            {canDecide && fv.status === "approved" && fv.kind === "validation" ? (
              <button type="button" className="button button--secondary" onClick={() => setDialog("reverse")}>
                {t("benefitsP4.finance.reverse")}
              </button>
            ) : null}
          </>
        }
      >
        <FinanceValidationNote body={t("benefitsP4.finance.labelNote")} />
        {canDecide && fv.status === "queued" && isSubmitter ? (
          <p className="banner banner--info" role="note" data-state="submitter-cannot-decide">
            <Icon name="lock" /> {t("benefitsP4.finance.submitterCannotDecide")}
          </p>
        ) : null}
        {provisional && fv.status === "queued" ? (
          <p className="banner banner--warning" role="note" data-state="basis-provisional">
            <Icon name="alert" /> {t("benefitsP4.finance.provisional")}
          </p>
        ) : null}
        <div className="chip-row">
          <RecordChip group="finance" status={fv.status} />
        </div>
        <dl className="details">
          <div>
            <dt>{t("benefitsP4.finance.submittedValue")}</dt>
            <dd data-submitted-value>
              <FvAmount fv={fv} />
            </dd>
          </div>
          <div>
            <dt>{t("benefitsP4.finance.approvedAmount")}</dt>
            <dd data-approved-amount={fv.approvedAmount ?? ""}>
              {fv.approvedAmount !== null ? (
                <Money value={fv.approvedAmount} currency={c.calculation.currency} />
              ) : fv.status === "queued" ? (
                <span className="muted">{t("benefitsP4.finance.notDecided")}</span>
              ) : (
                <span className="muted">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("benefitsP4.finance.assignee")}</dt>
            <dd>{person(fv.assigneeUserId)}</dd>
          </div>
          <div>
            <dt>{t("benefitsP4.finance.queuedAt")}</dt>
            <dd>{formatDateTime(fv.createdAt, locale) ?? ""}</dd>
          </div>
          {fv.decidedAt ? (
            <div>
              <dt>{t("benefitsP4.finance.decidedBy")}</dt>
              <dd data-decided-by={fv.decidedBy ?? ""}>
                {person(fv.decidedBy)} · {formatDateTime(fv.decidedAt, locale) ?? ""}
                {fv.decisionNote ? <span className="block small">{fv.decisionNote}</span> : null}
              </dd>
            </div>
          ) : null}
          {fv.reason ? (
            <div>
              <dt>{t("benefitsP4.finance.reason")}</dt>
              <dd>{fv.reason}</dd>
            </div>
          ) : null}
          {fv.correctsValidationId ? (
            <div>
              <dt>{t("benefitsP4.finance.corrects")}</dt>
              <dd>
                <Link className="link" to={`/transformations/${ws.tid}/finance-validations/${fv.correctsValidationId}`}>
                  {t("benefitsP4.finance.itemRef", { ref: fv.correctsValidationId.slice(-4) })}
                </Link>
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{t("benefitsP4.lineage.title")}</dt>
            <dd>
              <Link className="link" to={`/transformations/${ws.tid}/benefit-measurements/${fv.benefitMeasurementId}`}>
                {t("benefitsP4.measurements.open")}
              </Link>
            </dd>
          </div>
        </dl>
      </Section>
      <Section id="finance-items" title={t("benefitsP4.finance.itemsTitle")} intro={t("benefitsP4.finance.itemsIntro")}>
        <ol className="p4-message-list" data-items={FINANCE_ITEMS.length}>
          {FINANCE_ITEMS.map((item) => {
            const d = fv.items[item];
            return (
              <li
                key={item}
                className="p4-message"
                data-finance-item={item}
                data-item-decision={d?.decision ?? "undecided"}
              >
                <div className="p4-message__body">
                  <p>
                    <strong>{t(`benefitsP4.finance.items.${item}`)}</strong>{" "}
                    {d ? (
                      <span
                        className={`status-chip status-chip--${d.decision === "accepted" ? "on-track" : "off-track"}`}
                      >
                        <Icon name={d.decision === "accepted" ? "check" : "cross"} />{" "}
                        {t(`benefitsP4.finance.itemDecision.${d.decision}`)}
                      </span>
                    ) : (
                      <span className="status-chip status-chip--unknown">
                        <Icon name="clock" /> {t("benefitsP4.finance.itemDecision.undecided")}
                      </span>
                    )}
                  </p>
                  <ItemContent item={item} fv={fv} />
                  {d?.note ? <p className="small">{d.note}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Section>
      {dialog === "decide" ? (
        <DecideDialog fv={fv} financial={financial} onDone={done} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "amend" ? (
        <P4FormDialog
          title={t("benefitsP4.finance.amend")}
          note={<FinanceValidationNote body={t("benefitsP4.finance.amendNote")} />}
          fields={[
            {
              name: "correctedAmount",
              label: t("benefitsP4.finance.correctedAmount", { currency: c.calculation.currency }),
              kind: "text",
              required: true,
              ltr: true,
              hint: t("benefitsP4.form.moneyHint"),
            },
            {
              name: "reason",
              label: t("benefitsP4.field.reason"),
              kind: "textarea",
              required: true,
              min: 3,
              max: 1000,
            },
          ]}
          submitLabel={t("benefitsP4.finance.amend")}
          url={benefitPaths.amendments(ws.tid, fv.id)}
          version={fv.version}
          namespaces={NS}
          toBody={(v) => {
            const a = ((v["correctedAmount"] as string) ?? "").trim();
            if (!MONEY_INPUT.test(a)) return { fieldErrors: { correctedAmount: "validation.decimal" } };
            return { correctedAmount: a, reason: textOf(v["reason"]) };
          }}
          onDone={done}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "reverse" ? (
        <P4FormDialog
          title={t("benefitsP4.finance.reverse")}
          note={<FinanceValidationNote body={t("benefitsP4.finance.reverseNote")} />}
          fields={[
            {
              name: "reason",
              label: t("benefitsP4.field.reason"),
              kind: "textarea",
              required: true,
              min: 3,
              max: 1000,
            },
          ]}
          submitLabel={t("benefitsP4.finance.reverse")}
          danger
          url={benefitPaths.reversals(ws.tid, fv.id)}
          version={fv.version}
          namespaces={NS}
          toBody={(v) => ({ reason: textOf(v["reason"]) })}
          onDone={done}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

/** What the validator sees for one of the six items (the immutable snapshot). */
function ItemContent({ item, fv }: { item: FinanceItem; fv: FinanceValidation }) {
  const { t } = useTranslation();
  const c = fv.content;
  switch (item) {
    case "baseline":
      return (
        <p className="small">
          <Measure value={c.baseline.value} unit={c.baseline.unit} /> ·{" "}
          <span data-baseline-status={c.baseline.validationStatus}>
            {t(`benefitsP4.baselineStatus.${c.baseline.validationStatus}`)}
          </span>
          {c.baseline.counterfactual ? (
            <span className="block">
              {t("benefitsP4.field.counterfactual")}: {c.baseline.counterfactual}
            </span>
          ) : null}
        </p>
      );
    case "attribution":
      return (
        <p className="small" dir="auto">
          {c.attribution ?? <UnknownChip reason={t("benefitsP4.finance.notStated")} />}
        </p>
      );
    case "calculation":
      return (
        <p className="small">
          {c.calculation.amount !== null ? (
            <Money value={c.calculation.amount} currency={c.calculation.currency} />
          ) : null}
          {c.calculation.kpiValue !== null ? <Measure value={c.calculation.kpiValue} /> : null}
          {c.calculation.formulaVersionId ? (
            <span className="block">
              {t("benefitsP4.lineage.formulaVersion")}: <Code>{c.calculation.formulaVersionId.slice(-8)}</Code>
            </span>
          ) : (
            <span className="block muted">{t("benefitsP4.lineage.noFormula")}</span>
          )}
          {c.calculation.inputs.length > 0 ? (
            <span className="block">{t("benefitsP4.finance.inputs", { count: c.calculation.inputs.length })}</span>
          ) : null}
        </p>
      );
    case "evidence":
      return (
        <p className="small" data-evidence-count={c.evidence.length}>
          {c.evidence.length === 0
            ? t("benefitsP4.lineage.noEvidence")
            : t("benefitsP4.evidenceCount", { count: c.evidence.length })}
        </p>
      );
    case "measurementPeriod":
      return (
        <p className="small">
          <Period start={c.measurementPeriod.start} end={c.measurementPeriod.end} />
        </p>
      );
    case "assumptions":
      return (
        <p className="small" dir="auto">
          {c.assumptions ?? <UnknownChip reason={t("benefitsP4.finance.notStated")} />}
        </p>
      );
  }
}

interface ItemState {
  decision: "" | "accepted" | "rejected";
  note: string;
}

function DecideDialog({
  fv,
  financial,
  onDone,
  onClose,
}: {
  fv: FinanceValidation;
  financial: boolean;
  onDone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [items, setItems] = useState<Record<FinanceItem, ItemState>>(
    Object.fromEntries(FINANCE_ITEMS.map((i) => [i, { decision: "", note: "" }])) as unknown as Record<
      FinanceItem,
      ItemState
    >,
  );
  const [decision, setDecision] = useState<"" | "approved" | "rejected">("");
  const [amount, setAmount] = useState(fv.content.calculation.amount ?? "");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const err = (k: string) => (errors[k] ? fieldErrorMessage(t, errors[k]!) : undefined);
  const build = () => {
    const next: Record<string, string> = {};
    if (!decision) next["decision"] = "validation.required";
    if (decision === "approved" && financial && !MONEY_INPUT.test(amount.trim())) next["amount"] = "validation.decimal";
    for (const i of FINANCE_ITEMS)
      if (items[i].note !== "" && !textOf(items[i].note)) next[`note_${i}`] = "validation.blank";
    if (note !== "" && !textOf(note)) next["note"] = "validation.blank";
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    // An undecided item is left out: the server names it (422 finance_validation.content_incomplete).
    const body: Record<string, unknown> = {
      decision,
      items: Object.fromEntries(
        FINANCE_ITEMS.filter((i) => items[i].decision !== "").map((i) => [
          i,
          { decision: items[i].decision, ...(textOf(items[i].note) ? { note: textOf(items[i].note) } : {}) },
        ]),
      ),
    };
    if (decision === "approved" && financial) body["approvedAmount"] = amount.trim();
    if (textOf(note)) body["note"] = textOf(note);
    return body;
  };
  return (
    <SendDialog
      title={t("benefitsP4.finance.decide")}
      description={<FinanceValidationNote body={t("benefitsP4.finance.decideNote")} />}
      submitLabel={t("benefitsP4.finance.recordDecision")}
      url={benefitPaths.financeDecision(ws.tid, fv.id)}
      version={fv.version}
      build={build}
      onDone={onDone}
      onClose={onClose}
    >
      {FINANCE_ITEMS.map((i) => (
        <fieldset key={i} className="filters" data-item={i}>
          <legend>{t(`benefitsP4.finance.items.${i}`)}</legend>
          <Field label={t("benefitsP4.finance.itemDecisionLabel")}>
            {(c) => (
              <select
                {...c}
                data-field={`item_${i}`}
                value={items[i].decision}
                onChange={(e) =>
                  setItems({ ...items, [i]: { ...items[i], decision: e.target.value as ItemState["decision"] } })
                }
              >
                <option value="">{t("benefitsP4.finance.itemDecision.undecided")}</option>
                <option value="accepted">{t("benefitsP4.finance.itemDecision.accepted")}</option>
                <option value="rejected">{t("benefitsP4.finance.itemDecision.rejected")}</option>
              </select>
            )}
          </Field>
          <Field label={t("benefitsP4.field.note")} error={err(`note_${i}`)}>
            {(c) => (
              <input
                {...c}
                type="text"
                maxLength={2000}
                value={items[i].note}
                onChange={(e) => setItems({ ...items, [i]: { ...items[i], note: e.target.value } })}
              />
            )}
          </Field>
        </fieldset>
      ))}
      <Field label={t("benefitsP4.finance.overall")} required error={err("decision")}>
        {(c) => (
          <select
            {...c}
            data-field="decision"
            value={decision}
            onChange={(e) => setDecision(e.target.value as typeof decision)}
          >
            <option value="">{t("common.form.choose")}</option>
            <option value="approved">{t("benefitsP4.finance.approve")}</option>
            <option value="rejected">{t("benefitsP4.finance.reject")}</option>
          </select>
        )}
      </Field>
      {decision === "approved" && financial ? (
        <Field
          label={t("benefitsP4.finance.approvedAmountIn", { currency: fv.content.calculation.currency })}
          required
          hint={t("benefitsP4.finance.approvedAmountHint")}
          error={err("amount")}
        >
          {(c) => (
            <input
              {...c}
              type="text"
              inputMode="decimal"
              dir="ltr"
              data-field="approvedAmount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
      ) : null}
      <Field
        label={t("benefitsP4.finance.decisionNote")}
        hint={t("benefitsP4.finance.decisionNoteHint")}
        error={err("note")}
      >
        {(c) => (
          <textarea
            {...c}
            rows={2}
            maxLength={2000}
            data-field="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
    </SendDialog>
  );
}

/** Re-exported so the router can list every FE-C page from one place. */
export const FINANCE_WRITE_PERMISSIONS = ["finance.validate", ...BENEFIT_WRITE_PERMISSIONS] as const;
