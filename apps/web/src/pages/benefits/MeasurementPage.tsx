// Benefits and Finance > one measurement with its calculation lineage (T-DG4-FE-C; ADR-0030 §2, §5; REQ-S08-006,
// REQ-S08-008, REQ-S08-017). SYNTHETIC data only.
//  - Lineage: formula version, calculation record, the input KPI actual value versions with the values used, the
//    rates and other variables, the assumptions, the attribution and the period.
//  - A provisional basis (baseline or formula version not Finance-validated) is labelled: the value is excluded from
//    validated totals and cannot be validated yet (REQ-S08-008).
//  - A validated value is never edited here: corrections are Finance amendments or reversals, linked to the original
//    and all visible (REQ-S08-017).
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { usePeople } from "../../components/People.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { useBenefit, useBenefitMeasurement, type BenefitMeasurement } from "./api.ts";
import { MeasurementValue } from "./BenefitPage.tsx";
import { BENEFIT_WRITE_PERMISSIONS } from "./BenefitsPage.tsx";
import { BenefitLink, BenefitSubNav, Code, Measure, MeasurementStatusChip, Period } from "./ui.tsx";

export function MeasurementPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="business-cases"
      title={t("benefitsP4.lineage.title")}
      subtitle={t("benefitsP4.lineage.intro")}
      writePermissions={BENEFIT_WRITE_PERMISSIONS}
    >
      <MeasurementBody />
    </WorkspaceFrame>
  );
}

function MeasurementBody() {
  const ws = useWorkspace();
  const { measurementId = "" } = useParams();
  const m = useBenefitMeasurement(ws.tid, measurementId);
  return (
    <>
      <BenefitSubNav tid={ws.tid} />
      <QueryState query={m}>{(x) => <Lineage m={x} />}</QueryState>
    </>
  );
}

function Lineage({ m }: { m: BenefitMeasurement }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const locale = useLocale();
  const benefit = useBenefit(ws.tid, m.benefitId);
  const { byId } = usePeople(ws.tid);
  const person = (id: string | null) =>
    id ? (byId.get(id)?.label ?? t("benefitsP4.person", { ref: id.slice(-4) })) : t("benefitsP4.lineage.system");
  return (
    <>
      <Section
        id="measurement-summary"
        title={t("benefitsP4.lineage.summary", { no: m.measurementNo })}
        intro={
          benefit.data ? (
            <BenefitLink tid={ws.tid} id={m.benefitId}>
              <Code>{benefit.data.code}</Code> {benefit.data.title}
            </BenefitLink>
          ) : null
        }
      >
        <div className="chip-row">
          <MeasurementStatusChip status={m.status} />
          {m.basis === "provisional" ? (
            <span className="status-chip status-chip--unknown status-chip--wrap" data-basis="provisional">
              <Icon name="info" /> <span>{t("benefitsP4.measurements.provisionalLong")}</span>
            </span>
          ) : (
            <span className="lifecycle-chip lifecycle-chip--closed" data-basis="validated">
              <Icon name="check" /> {t("benefitsP4.measurements.basisValidated")}
            </span>
          )}
        </div>
        {m.status === "submitted" ? (
          <p className="banner banner--info" role="note" data-state="pending">
            <Icon name="clock" /> {t("benefitsP4.measurements.pendingNote")}
          </p>
        ) : null}
        {m.status === "validated" ? (
          <p className="banner banner--info" role="note" data-state="validated-immutable">
            <Icon name="lock" /> {t("benefitsP4.measurements.validatedImmutableLong")}
          </p>
        ) : null}
        <dl className="details">
          <div>
            <dt>{t("benefitsP4.measurements.value")}</dt>
            <dd>
              <MeasurementValue m={m} />
            </dd>
          </div>
          <div>
            <dt>{t("benefitsP4.measurements.period")}</dt>
            <dd>
              <Period start={m.periodStart} end={m.periodEnd} />
            </dd>
          </div>
          <div>
            <dt>{t("benefitsP4.measurements.kindSource")}</dt>
            <dd>
              {t(`benefitsP4.measurementKind.${m.kind}`)} · {t(`benefitsP4.measurementSource.${m.source}`)}
              {m.correctsMeasurementId ? (
                <span className="block">
                  <Link
                    className="link"
                    to={`/transformations/${ws.tid}/benefit-measurements/${m.correctsMeasurementId}`}
                  >
                    {t("benefitsP4.lineage.corrects")}
                  </Link>
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>{t("benefitsP4.field.attribution")}</dt>
            <dd dir="auto">{m.attribution ?? <span className="muted">—</span>}</dd>
          </div>
          <div>
            <dt>{t("benefitsP4.field.assumptions")}</dt>
            <dd dir="auto">{m.assumptions ?? <span className="muted">—</span>}</dd>
          </div>
          <div>
            <dt>{t("benefitsP4.lineage.submitted")}</dt>
            <dd>
              {m.submittedAt
                ? `${person(m.submittedBy)} · ${formatDateTime(m.submittedAt, locale) ?? ""}`
                : t("benefitsP4.lineage.notSubmitted")}
            </dd>
          </div>
          <div>
            <dt>{t("benefitsP4.lineage.decided")}</dt>
            <dd>
              {m.decidedAt ? (
                `${person(m.decidedBy)} · ${formatDateTime(m.decidedAt, locale) ?? ""}`
              ) : (
                <span className="muted">—</span>
              )}
              {m.reason ? <span className="block small">{m.reason}</span> : null}
            </dd>
          </div>
          <div>
            <dt>{t("benefitsP4.finance.label")}</dt>
            <dd>
              {m.financeValidationId ? (
                <Link className="link" to={`/transformations/${ws.tid}/finance-validations/${m.financeValidationId}`}>
                  {t("benefitsP4.finance.open")}
                </Link>
              ) : (
                <span className="muted">{t("benefitsP4.lineage.noValidation")}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("benefitsP4.field.evidence")}</dt>
            <dd data-evidence-count={m.evidenceIds.length}>
              {m.evidenceIds.length === 0 ? (
                <span className="muted">{t("benefitsP4.lineage.noEvidence")}</span>
              ) : (
                <Link className="link" to={`/transformations/${ws.tid}/evidence`}>
                  {t("benefitsP4.evidenceCount", { count: m.evidenceIds.length })}
                </Link>
              )}
            </dd>
          </div>
        </dl>
      </Section>
      <Section
        id="measurement-lineage"
        title={t("benefitsP4.lineage.calcTitle")}
        intro={t("benefitsP4.lineage.calcIntro")}
      >
        <dl className="details">
          <div>
            <dt>{t("benefitsP4.lineage.formulaVersion")}</dt>
            <dd data-lineage="formula-version">
              {m.formulaVersionId ? (
                <Code>{m.formulaVersionId.slice(-8)}</Code>
              ) : (
                <span className="muted">{t("benefitsP4.lineage.noFormula")}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("benefitsP4.lineage.calculation")}</dt>
            <dd data-lineage="calculation">
              {m.benefitCalculationId ? (
                <Code>{m.benefitCalculationId.slice(-8)}</Code>
              ) : (
                <span className="muted">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("benefitsP4.lineage.calculationRun")}</dt>
            <dd>
              {m.calculationRunId ? <Code>{m.calculationRunId.slice(-8)}</Code> : <span className="muted">—</span>}
            </dd>
          </div>
        </dl>
        {m.inputs.length === 0 ? (
          <p className="muted" data-state="no-inputs">
            {t("benefitsP4.lineage.noInputs")}
          </p>
        ) : (
          <div className="table-wrap" role="region" tabIndex={0} aria-label={t("benefitsP4.lineage.inputs")}>
            <table className="table" data-lineage="inputs">
              <caption className="visually-hidden">{t("benefitsP4.lineage.inputs")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("benefitsP4.lineage.variable")}</th>
                  <th scope="col">{t("benefitsP4.lineage.source")}</th>
                  <th scope="col">{t("benefitsP4.lineage.valueUsed")}</th>
                  <th scope="col">{t("benefitsP4.measurements.period")}</th>
                </tr>
              </thead>
              <tbody>
                {m.inputs.map((i) => (
                  <tr key={i.variableName} data-input={i.variableName}>
                    <th scope="row">
                      <Code>{i.variableName}</Code>
                    </th>
                    <td>
                      {i.kpiActualId
                        ? t("benefitsP4.lineage.kpiActual", { ref: i.kpiActualId.slice(-4), no: i.kpiValueNo ?? "?" })
                        : t("benefitsP4.lineage.formulaVariable")}
                    </td>
                    <td>
                      <Measure value={i.value} />
                    </td>
                    <td>
                      <Period start={i.periodStart} end={i.periodEnd} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
