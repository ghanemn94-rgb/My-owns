// Benefits and Finance > one benefit (T-DG4-FE-C; p4-work-split §B.5; ADR-0029 §1-§8, ADR-0030 §1-§6). SYNTHETIC data.
//  - Profile (ADR-0029 §1): the T14 fields, the baseline and its Finance validation state, counting in totals.
//  - Lifecycle (REQ-PB-074, B0121): the six steps with their question and output (English, and the provisional Arabic
//    marked as such), what each step still misses, the history, and "advance" to an allowed next step only.
//  - Enablers (REQ-S08-002): a delivered enabler is labelled "delivered: not realized value".
//  - Allocations (REQ-S08-013): shares in percent, the unallocated share; above 100 % is refused (422 translated).
//  - Values (REQ-S08-001): the seven states kept apart; forecast is never validated; plan values add/edit.
//  - Measurements (REQ-S08-016/-017): draft, submitted (pending Finance validation), validated, rejected, superseded;
//    a provisional basis is labelled; a validated row is never editable (corrections are Finance amendments/reversals).
//  - Finance validation of the baseline (FIN only, "Finance validation", never DG0-DG7).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import {
  BENEFIT_LIFECYCLE_STEPS,
  LIFECYCLE_MOVES,
  allocationTotals,
  type BenefitLifecycleStep,
} from "@mth/shared/schemas";
import { useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { useMe } from "../../auth/session.tsx";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { usePeople } from "../../components/People.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { fieldErrorMessage } from "../../lib/problem.ts";
import { P4FormDialog, textOf, type P4FieldSpec } from "../my-work/p4ui.tsx";
import {
  benefitPaths,
  useBenefit,
  useBenefitAllocations,
  useBenefitEnablers,
  useBenefitEvidenceOptions,
  useBenefitLifecycle,
  useBenefitMeasurements,
  useBenefitOverlaps,
  useBenefitPlanValue,
  useBenefitValues,
  useInitiativeOptions,
  type Benefit,
  type BenefitAllocations,
  type BenefitLifecycle,
  type BenefitMeasurement,
  type BenefitPlanValue,
  type BenefitValues,
} from "./api.ts";
import { BENEFIT_WRITE_PERMISSIONS, useProfileOptions } from "./BenefitsPage.tsx";
import { SendDialog } from "./dialogs.tsx";
import { profileBody, profileFields, profileInitial } from "./form.tsx";
import {
  Amount,
  BDate,
  BenefitRagChip,
  BenefitSubNav,
  Code,
  FinanceValidationNote,
  MEASURE_INPUT,
  MONEY_INPUT,
  Measure,
  MeasurementStatusChip,
  Money,
  NS,
  Period,
  RealizationChip,
  RecordChip,
  StepChip,
  UnknownChip,
  percentToFraction,
  sharePercent,
} from "./ui.tsx";

export function BenefitPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="business-cases"
      title={t("benefitsP4.benefit.title")}
      subtitle={t("benefitsP4.benefit.intro")}
      writePermissions={BENEFIT_WRITE_PERMISSIONS}
    >
      <BenefitBody />
    </WorkspaceFrame>
  );
}

function BenefitBody() {
  const ws = useWorkspace();
  const { benefitId = "" } = useParams();
  const benefit = useBenefit(ws.tid, benefitId);
  return (
    <>
      <BenefitSubNav tid={ws.tid} />
      <QueryState query={benefit}>
        {(b) => (
          <>
            <Profile b={b} />
            <Lifecycle b={b} />
            <Enablers b={b} />
            <Allocations b={b} />
            <Values b={b} />
            <Measurements b={b} />
            <BenefitOverlapsList b={b} />
          </>
        )}
      </QueryState>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ profile

function Profile({ b }: { b: Benefit }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const me = useMe();
  const { byId } = usePeople(ws.tid);
  const refresh = useP4Refresh(ws.tid);
  const [dialog, setDialog] = useState<"edit" | "archive" | "baseline" | null>(null);
  const archived = b.status === "archived";
  const canEdit = ws.can("benefit.edit") && !archived;
  const canValidate = ws.can("finance.validate") && !archived;
  const person = (id: string | null) =>
    id ? (byId.get(id)?.label ?? t("benefitsP4.person", { ref: id.slice(-4) })) : t("common.value.notAssigned");
  const financial = b.valueClass !== "non_financial";
  return (
    <Section
      id="benefit-profile"
      title={`${b.code} · ${b.title}`}
      intro={b.description}
      actions={
        <>
          {canEdit ? (
            <button type="button" className="button button--secondary" onClick={() => setDialog("edit")}>
              <Icon name="pencil" /> {t("benefitsP4.benefit.edit")}
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" className="button button--secondary" onClick={() => setDialog("archive")}>
              <Icon name="archive" /> {t("benefitsP4.benefit.archive")}
            </button>
          ) : null}
          {canValidate && b.ownerUserId !== me.user.id ? (
            <button type="button" className="button button--secondary" onClick={() => setDialog("baseline")}>
              <Icon name="lock" /> {t("benefitsP4.baseline.decide")}
            </button>
          ) : null}
        </>
      }
    >
      {archived ? (
        <p className="banner banner--info" role="note" data-state="archived">
          <Icon name="archive" /> {t("benefitsP4.benefit.archivedNote", { reason: b.archiveReason ?? "" })}
        </p>
      ) : null}
      <div className="chip-row">
        <StepChip step={b.lifecycleStep} />
        <RealizationChip state={b.realizationState} />
        <BenefitRagChip rag={b.statusRag} />
      </div>
      <dl className="details" data-benefit-profile={b.code}>
        <Row label={t("benefitsP4.field.benefitType")}>{t(`benefitsP4.type.${b.benefitType}`)}</Row>
        <Row label={t("benefitsP4.field.valueClass")}>{t(`benefitsP4.valueClass.${b.valueClass}`)}</Row>
        <Row label={t("benefitsP4.field.owner")}>{person(b.ownerUserId)}</Row>
        <Row label={t("benefitsP4.field.currency")}>
          <Code>{b.currency}</Code>
        </Row>
        {financial ? (
          <Row label={t("benefitsP4.field.financialStatementLine")}>{b.financialStatementLine ?? <UnknownChip />}</Row>
        ) : null}
        <Row label={t("benefitsP4.field.plannedValue")}>
          {financial || b.valuationMethodId ? (
            <Money value={b.plannedValue} currency={b.currency} reason="benefit.planned_value_missing" />
          ) : (
            <Amount amount={{ status: "not_applicable", amount: null, currency: null, reason: null }} />
          )}
        </Row>
        <Row label={t("benefitsP4.field.baselineValue")}>
          <Measure value={b.baselineValue} unit={b.baselineUnit} />{" "}
          <span className="small muted">
            (<BDate date={b.baselineDate} />)
          </span>
        </Row>
        <Row label={t("benefitsP4.field.baselineValidation")}>
          <span data-baseline-status={b.baselineValidationStatus}>
            {t(`benefitsP4.baselineStatus.${b.baselineValidationStatus}`)}
          </span>
          {b.baselineValidationNote ? <span className="block small">{b.baselineValidationNote}</span> : null}
        </Row>
        <Row label={t("benefitsP4.field.counterfactual")}>{b.counterfactual ?? <span className="muted">—</span>}</Row>
        <Row label={t("benefitsP4.field.targetValue")}>
          <Measure value={b.targetValue} unit={b.baselineUnit} />{" "}
          <span className="small muted">
            (<BDate date={b.targetDate} />)
          </span>
        </Row>
        <Row label={t("benefitsP4.field.formula")}>
          {b.benefitFormulaId ? (
            <Link className="link" to={`/transformations/${ws.tid}/benefit-formulas/${b.benefitFormulaId}`}>
              {t("benefitsP4.benefit.openFormula")}
            </Link>
          ) : (
            <span className="muted">
              {financial ? t("benefitsP4.benefit.noFormula") : t("benefitsP4.benefit.kpiMeasured")}
            </span>
          )}
        </Row>
        <Row label={t("benefitsP4.field.realizationWindow")}>
          <Period start={b.realizationStart} end={b.realizationEnd} />
        </Row>
        <Row label={t("benefitsP4.field.driverKey")}>
          {b.driverKey ? <Code>{b.driverKey}</Code> : <span className="muted">—</span>}
          {b.populationKey ? (
            <span className="block small">
              {t("benefitsP4.field.populationKey")}: <Code>{b.populationKey}</Code>
            </span>
          ) : null}
        </Row>
        <Row label={t("benefitsP4.field.financeValidator")}>
          {b.financeValidatorUserId ? person(b.financeValidatorUserId) : t("benefitsP4.benefit.finParty")}
        </Row>
        <Row label={t("benefitsP4.field.confidence")}>
          {b.confidence ? t(`benefitsP4.confidence.${b.confidence}`) : <span className="muted">—</span>}
        </Row>
        <Row label={t("benefitsP4.field.assumptions")}>{b.assumptions ?? <span className="muted">—</span>}</Row>
        <Row label={t("benefitsP4.field.recoveryPlan")}>{b.recoveryPlan ?? <span className="muted">—</span>}</Row>
        <Row label={t("benefitsP4.field.bauOwner")}>
          {b.bauOwnerUserId ? person(b.bauOwnerUserId) : <span className="muted">—</span>}
        </Row>
        <Row label={t("benefitsP4.field.controlCadence")}>
          {b.controlCadence ? t(`benefitsP4.cadence.${b.controlCadence}`) : <span className="muted">—</span>}
        </Row>
        <Row label={t("benefitsP4.col.counted")}>
          {b.counting.counted && !b.counting.overlapOpen ? (
            t("benefitsP4.counting.counted")
          ) : (
            <span data-counted="false">
              {b.counting.overlapOpen ? t("benefitsP4.counting.overlapOpen") : null}{" "}
              {b.counting.exclusionReason ? t(`benefitsP4.exclusion.${b.counting.exclusionReason}`) : null}
            </span>
          )}
        </Row>
      </dl>
      {dialog === "edit" ? <EditBenefitDialog b={b} onClose={() => setDialog(null)} /> : null}
      {dialog === "archive" ? (
        <P4FormDialog
          title={t("benefitsP4.benefit.archive")}
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
          submitLabel={t("benefitsP4.benefit.archive")}
          danger
          url={benefitPaths.archive(ws.tid, b.id)}
          version={b.version}
          namespaces={NS}
          toBody={(v) => ({ reason: textOf(v["reason"]) })}
          onDone={() => refresh()}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "baseline" ? (
        <P4FormDialog
          title={t("benefitsP4.baseline.decide")}
          note={<FinanceValidationNote body={t("benefitsP4.baseline.note")} />}
          fields={[
            {
              name: "decision",
              label: t("benefitsP4.baseline.decision"),
              kind: "select",
              required: true,
              options: [
                { value: "validated", label: t("benefitsP4.baselineStatus.validated") },
                { value: "rejected", label: t("benefitsP4.baselineStatus.rejected") },
              ],
            },
            {
              name: "note",
              label: t("benefitsP4.field.note"),
              kind: "textarea",
              max: 2000,
              hint: t("benefitsP4.baseline.noteHint"),
            },
          ]}
          submitLabel={t("benefitsP4.baseline.submit")}
          url={benefitPaths.baselineValidation(ws.tid, b.id)}
          version={b.version}
          namespaces={NS}
          toBody={(v) => ({ decision: v["decision"], ...(textOf(v["note"]) ? { note: textOf(v["note"]) } : {}) })}
          onDone={() => refresh()}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function EditBenefitDialog({ b, onClose }: { b: Benefit; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const options = useProfileOptions(ws.tid);
  const initial = profileInitial(b);
  const [values, setValues] = useState(initial);
  const fields = profileFields(t, values, options, "edit");
  return (
    <P4FormDialog
      title={t("benefitsP4.benefit.edit")}
      fields={fields}
      initial={initial}
      submitLabel={t("common.action.save")}
      method="PATCH"
      url={benefitPaths.benefit(ws.tid, b.id)}
      version={b.version}
      namespaces={NS}
      onValuesChange={setValues}
      toBody={(v) =>
        profileBody(
          v,
          fields.filter((f) => !f.when || f.when(v)).map((f) => f.name),
          initial,
        )
      }
      onDone={() => refresh()}
      onClose={onClose}
    />
  );
}

// ------------------------------------------------------------------------------------------------ lifecycle

function Lifecycle({ b }: { b: Benefit }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const lifecycle = useBenefitLifecycle(ws.tid, b.id);
  return (
    <Section id="benefit-lifecycle" title={t("benefitsP4.lifecycle.title")} intro={t("benefitsP4.lifecycle.intro")}>
      <QueryState query={lifecycle}>{(l) => <LifecycleBody b={b} l={l} />}</QueryState>
    </Section>
  );
}

function LifecycleBody({ b, l }: { b: Benefit; l: BenefitLifecycle }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const locale = useLocale();
  const refresh = useP4Refresh(ws.tid);
  const [advanceTo, setAdvanceTo] = useState<BenefitLifecycleStep | null>(null);
  const { byId } = usePeople(ws.tid);
  const next = LIFECYCLE_MOVES[l.currentStep];
  const canAdvance = ws.can("benefit.advance") && b.status === "active";
  const ar = locale === "ar";
  return (
    <>
      <ol className="p4-message-list" data-lifecycle={l.currentStep}>
        {[...l.steps]
          .sort((x, y) => x.ordinal - y.ordinal)
          .map((s) => {
            const current = s.code === l.currentStep;
            return (
              <li
                key={s.code}
                className="p4-message"
                data-step={s.code}
                data-current={current ? "true" : "false"}
                aria-current={current ? "step" : undefined}
              >
                <div className="p4-message__body">
                  <p>
                    <strong>
                      {s.ordinal}. {ar ? s.stepAr : s.stepEn}
                    </strong>{" "}
                    {current ? (
                      <span className="status-chip status-chip--unknown" data-state="current-step">
                        <Icon name="dot" /> {t("benefitsP4.lifecycle.current")}
                      </span>
                    ) : null}
                  </p>
                  <p className="small">
                    <span className="muted">{t("benefitsP4.lifecycle.question")}:</span>{" "}
                    <span data-part="question">{ar ? s.questionAr : s.questionEn}</span>
                  </p>
                  <p className="small">
                    <span className="muted">{t("benefitsP4.lifecycle.output")}:</span>{" "}
                    <span data-part="output">{ar ? s.outputAr : s.outputEn}</span>
                  </p>
                  {ar && s.arIsProvisional ? (
                    <p className="small muted" data-state="ar-provisional">
                      <Icon name="info" /> {t("benefitsP4.lifecycle.arProvisional")}
                    </p>
                  ) : null}
                  {s.missing.length > 0 ? (
                    <p className="small" data-missing={s.missing.join(",")}>
                      <Icon name="alert" /> {t("benefitsP4.lifecycle.missing")}:{" "}
                      {s.missing.map((m) => t(`benefitsP4.missing.${m}`)).join(t("benefitsP4.listSeparator"))}
                    </p>
                  ) : s.code !== "identify" ? (
                    <p className="small" data-missing="">
                      <Icon name="check" /> {t("benefitsP4.lifecycle.preconditionsMet")}
                    </p>
                  ) : null}
                </div>
                {canAdvance && next.includes(s.code) ? (
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    onClick={() => setAdvanceTo(s.code)}
                    data-advance={s.code}
                  >
                    {t("benefitsP4.lifecycle.advanceTo", { step: t(`benefitsP4.step.${s.code}`) })}
                  </button>
                ) : null}
              </li>
            );
          })}
      </ol>
      <h3 className="card__subtitle">{t("benefitsP4.lifecycle.history")}</h3>
      {l.history.length === 0 ? (
        <p className="muted">{t("benefitsP4.lifecycle.noHistory")}</p>
      ) : (
        <ul className="plain-list" data-history={l.history.length}>
          {l.history.map((h) => (
            <li key={`${h.benefitVersion}-${h.toStep}`}>
              {h.fromStep ? t(`benefitsP4.step.${h.fromStep}`) : t("benefitsP4.lifecycle.created")} →{" "}
              {t(`benefitsP4.step.${h.toStep}`)} · {formatDateTime(h.occurredAt, locale) ?? ""} ·{" "}
              {byId.get(h.actorUserId)?.label ?? t("benefitsP4.person", { ref: h.actorUserId.slice(-4) })}
            </li>
          ))}
        </ul>
      )}
      {advanceTo ? (
        <P4FormDialog
          title={t("benefitsP4.lifecycle.advanceTo", { step: t(`benefitsP4.step.${advanceTo}`) })}
          description={t("benefitsP4.lifecycle.advanceIntro")}
          fields={[{ name: "note", label: t("benefitsP4.field.note"), kind: "textarea", max: 2000 }]}
          submitLabel={t("benefitsP4.lifecycle.advance")}
          url={benefitPaths.lifecycle(ws.tid, b.id)}
          version={b.version}
          namespaces={NS}
          toBody={(v) => ({ toStep: advanceTo, ...(textOf(v["note"]) ? { note: textOf(v["note"]) } : {}) })}
          onDone={() => refresh()}
          onClose={() => setAdvanceTo(null)}
        />
      ) : null}
      <p className="small muted">
        {t("benefitsP4.lifecycle.order", {
          steps: BENEFIT_LIFECYCLE_STEPS.map((s) => t(`benefitsP4.step.${s}`)).join(" → "),
        })}
      </p>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ enablers

function Enablers({ b }: { b: Benefit }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const enablers = useBenefitEnablers(ws.tid, b.id);
  const canEdit = ws.can("benefit.edit") && b.status === "active";
  const initiatives = useInitiativeOptions(ws.tid, canEdit);
  const names = new Map((initiatives.data ?? []).map((i) => [i.id, `${i.code} · ${i.name}`]));
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; version: number } | null>(null);
  return (
    <Section
      id="benefit-enablers"
      title={t("benefitsP4.enablers.title")}
      intro={t("benefitsP4.enablers.intro")}
      actions={
        canEdit ? (
          <button type="button" className="button button--secondary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t("benefitsP4.enablers.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={enablers}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="muted" data-state="no-enablers">
              {t("benefitsP4.enablers.empty")}
            </p>
          ) : (
            <ul className="p4-message-list">
              {rows.map((e) => (
                <li
                  key={e.id}
                  className="p4-message"
                  data-enabler={e.id}
                  data-delivered={e.delivered ? "true" : "false"}
                >
                  <div className="p4-message__body">
                    <p>
                      {names.get(e.initiativeId) ??
                        t("benefitsP4.enablers.initiative", { ref: e.initiativeId.slice(-4) })}{" "}
                      <RecordChip group="enablers" status={e.status} />
                    </p>
                    <p className="small">
                      {e.delivered ? (
                        <>
                          <Icon name="info" /> {t("benefitsP4.enablers.deliveredNotRealized")}
                        </>
                      ) : (
                        t("benefitsP4.enablers.notDelivered")
                      )}
                    </p>
                    {e.note ? <p className="small muted">{e.note}</p> : null}
                    {e.removeReason ? <p className="small muted">{e.removeReason}</p> : null}
                  </div>
                  {canEdit && e.status === "active" ? (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => setRemoving({ id: e.id, version: e.version })}
                    >
                      {t("benefitsP4.enablers.remove")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
      {adding ? (
        <P4FormDialog
          title={t("benefitsP4.enablers.add")}
          fields={[
            {
              name: "initiativeId",
              label: t("benefitsP4.field.initiative"),
              kind: "select",
              required: true,
              options: (initiatives.data ?? []).map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` })),
            },
            { name: "note", label: t("benefitsP4.field.note"), kind: "textarea", max: 2000 },
          ]}
          submitLabel={t("benefitsP4.enablers.add")}
          url={benefitPaths.enablers(ws.tid, b.id)}
          namespaces={NS}
          toBody={(v) => ({
            initiativeId: v["initiativeId"],
            ...(textOf(v["note"]) ? { note: textOf(v["note"]) } : {}),
          })}
          onDone={() => refresh()}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {removing ? (
        <P4FormDialog
          title={t("benefitsP4.enablers.remove")}
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
          submitLabel={t("benefitsP4.enablers.remove")}
          danger
          url={benefitPaths.removeEnabler(ws.tid, removing.id)}
          version={removing.version}
          namespaces={NS}
          toBody={(v) => ({ reason: textOf(v["reason"]) })}
          onDone={() => refresh()}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ allocations

function Allocations({ b }: { b: Benefit }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const locale = useLocale();
  const allocations = useBenefitAllocations(ws.tid, b.id);
  const canEdit = ws.can("benefit.allocate") && b.status === "active";
  const initiatives = useInitiativeOptions(ws.tid);
  const names = new Map((initiatives.data ?? []).map((i) => [i.id, `${i.code} · ${i.name}`]));
  const [editing, setEditing] = useState(false);
  return (
    <Section
      id="benefit-allocations"
      title={t("benefitsP4.allocations.title")}
      intro={t("benefitsP4.allocations.intro")}
      actions={
        canEdit ? (
          <button type="button" className="button button--secondary" onClick={() => setEditing(true)}>
            <Icon name="pencil" /> {t("benefitsP4.allocations.edit")}
          </button>
        ) : null
      }
    >
      <QueryState query={allocations}>
        {(a) => (
          <>
            {a.allocations.length === 0 ? (
              <p className="muted">{t("benefitsP4.allocations.empty")}</p>
            ) : (
              <div className="table-wrap" role="region" tabIndex={0} aria-label={t("benefitsP4.allocations.title")}>
                <table className="table" data-allocations={a.setNo}>
                  <caption className="visually-hidden">{t("benefitsP4.allocations.title")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("benefitsP4.field.initiative")}</th>
                      <th scope="col">{t("benefitsP4.allocations.share")}</th>
                      <th scope="col">{t("benefitsP4.allocations.basis")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.allocations.map((x) => (
                      <tr key={x.initiativeId}>
                        <th scope="row">
                          {names.get(x.initiativeId) ??
                            t("benefitsP4.enablers.initiative", { ref: x.initiativeId.slice(-4) })}
                        </th>
                        <td>
                          <bdi dir="ltr">{sharePercent(x.share, locale)}</bdi>
                        </td>
                        <td>{x.basis ?? <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <dl className="details details--compact">
              <Row label={t("benefitsP4.allocations.allocated")}>
                <bdi dir="ltr" data-share="allocated">
                  {sharePercent(a.allocatedShare, locale)}
                </bdi>
              </Row>
              <Row label={t("benefitsP4.allocations.unallocated")}>
                <bdi dir="ltr" data-share="unallocated">
                  {sharePercent(a.unallocatedShare, locale)}
                </bdi>
              </Row>
            </dl>
            <p className="small muted">{t("benefitsP4.allocations.countedOnce")}</p>
            {editing ? (
              <AllocationDialog b={b} a={a} options={initiatives.data ?? []} onClose={() => setEditing(false)} />
            ) : null}
          </>
        )}
      </QueryState>
    </Section>
  );
}

interface AllocRow {
  initiativeId: string;
  percent: string;
  basis: string;
}

function AllocationDialog({
  b,
  a,
  options,
  onClose,
}: {
  b: Benefit;
  a: BenefitAllocations;
  options: readonly { id: string; code: string; name: string }[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const locale = useLocale();
  const refresh = useP4Refresh(ws.tid);
  const [rows, setRows] = useState<AllocRow[]>(
    a.allocations.map((x) => ({
      initiativeId: x.initiativeId,
      percent: sharePercent(x.share, "en")?.replace(/[ %,]/g, "") ?? "",
      basis: x.basis ?? "",
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fractions = rows.map((r) => percentToFraction(r.percent)).filter((x): x is string => x !== null);
  const totals = allocationTotals(fractions);
  const set = (i: number, patch: Partial<AllocRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <SendDialog
      title={t("benefitsP4.allocations.edit")}
      description={t("benefitsP4.allocations.editIntro")}
      submitLabel={t("common.action.save")}
      method="PUT"
      url={benefitPaths.allocations(ws.tid, b.id)}
      version={b.version}
      build={() => {
        const next: Record<string, string> = {};
        rows.forEach((r, i) => {
          if (!r.initiativeId) next[`i${i}`] = "validation.required";
          if (percentToFraction(r.percent) === null) next[`p${i}`] = "validation.share";
        });
        setErrors(next);
        if (Object.keys(next).length > 0) return null;
        return {
          allocations: rows.map((r) => ({
            initiativeId: r.initiativeId,
            share: percentToFraction(r.percent),
            ...(textOf(r.basis) ? { basis: textOf(r.basis) } : {}),
          })),
        };
      }}
      onDone={() => refresh()}
      onClose={onClose}
    >
      {rows.map((r, i) => (
        <fieldset key={i} className="filters" data-allocation-row={i}>
          <legend className="visually-hidden">{t("benefitsP4.allocations.row", { n: i + 1 })}</legend>
          <Field
            label={t("benefitsP4.field.initiative")}
            required
            error={errors[`i${i}`] ? fieldErrorMessage(t, errors[`i${i}`]!) : undefined}
          >
            {(c) => (
              <select {...c} value={r.initiativeId} onChange={(e) => set(i, { initiativeId: e.target.value })}>
                <option value="">{t("common.form.choose")}</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code} · {o.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label={t("benefitsP4.allocations.sharePercent")}
            required
            hint={t("benefitsP4.allocations.shareHint")}
            error={errors[`p${i}`] ? fieldErrorMessage(t, errors[`p${i}`]!) : undefined}
          >
            {(c) => (
              <input
                {...c}
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={r.percent}
                onChange={(e) => set(i, { percent: e.target.value })}
              />
            )}
          </Field>
          <Field label={t("benefitsP4.allocations.basis")}>
            {(c) => (
              <input
                {...c}
                type="text"
                maxLength={1000}
                value={r.basis}
                onChange={(e) => set(i, { basis: e.target.value })}
              />
            )}
          </Field>
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
          >
            {t("benefitsP4.allocations.removeRow")}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="button button--secondary"
        onClick={() => setRows([...rows, { initiativeId: "", percent: "", basis: "" }])}
      >
        <Icon name="plus" /> {t("benefitsP4.allocations.addRow")}
      </button>
      <p data-state={totals.overHundred ? "over-100" : "within-100"} aria-live="polite">
        {totals.overHundred ? <Icon name="alert" /> : <Icon name="info" />}{" "}
        {t("benefitsP4.allocations.preview", {
          allocated: sharePercent(totals.allocatedShare, locale) ?? "",
          unallocated: sharePercent(totals.unallocatedShare, locale) ?? "",
        })}
        {totals.overHundred ? ` ${t("benefitsP4.allocations.overHundred")}` : ""}
      </p>
    </SendDialog>
  );
}

// ------------------------------------------------------------------------------------------------ values

const SERIES_ORDER = ["planned", "forecast", "submitted", "validated", "sustained", "rejected", "measured"] as const;

function Values({ b }: { b: Benefit }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const values = useBenefitValues(ws.tid, b.id);
  const canEdit = ws.can("benefit.edit") && b.status === "active";
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Section
      id="benefit-values"
      title={t("benefitsP4.values.title")}
      intro={t("benefitsP4.values.intro")}
      actions={
        canEdit ? (
          <button type="button" className="button button--secondary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t("benefitsP4.values.addPlan")}
          </button>
        ) : null
      }
    >
      <QueryState query={values}>
        {(v) => <ValuesTable v={v} b={b} {...(canEdit ? { onEdit: setEditing } : {})} />}
      </QueryState>
      {adding ? <PlanValueDialog b={b} onClose={() => setAdding(false)} /> : null}
      {editing ? <EditPlanValue planValueId={editing} onClose={() => setEditing(null)} /> : null}
    </Section>
  );
}

/** Planned and forecast lines are plan-value records, editable by a benefit editor (the other states are not). */
const EDITABLE_SERIES: ReadonlySet<string> = new Set(["planned", "forecast"]);

function ValuesTable({ v, b, onEdit }: { v: BenefitValues; b: Benefit; onEdit?: (planValueId: string) => void }) {
  const { t } = useTranslation();
  const series = SERIES_ORDER.map((s) => v.series.find((x) => x.state === s)).filter((x) => x !== undefined);
  return (
    <div className="table-wrap" role="region" tabIndex={0} aria-label={t("benefitsP4.values.title")}>
      <table className="table" data-values={b.code}>
        <caption className="visually-hidden">{t("benefitsP4.values.title")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("benefitsP4.values.state")}</th>
            <th scope="col">{t("benefitsP4.values.total")}</th>
            <th scope="col">{t("benefitsP4.values.lines")}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.state} data-series={s.state}>
              <th scope="row">
                {t(`benefitsP4.state.${s.state}`)}
                <span className="block small muted">{t(`benefitsP4.stateNote.${s.state}`)}</span>
              </th>
              <td>
                <Amount amount={s.total} />
                <span className="block small muted">{t("benefitsP4.totals.count", { count: s.count })}</span>
              </td>
              <td>
                {s.lines.length === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  <ul className="plain-list">
                    {s.lines.map((l) => (
                      <li key={`${l.recordId}`} data-line={l.recordType}>
                        <Period start={l.periodStart} end={l.periodEnd} />:{" "}
                        {l.amount !== null ? <Money value={l.amount} currency={v.currency} /> : null}
                        {l.kpiValue !== null ? (
                          <span>
                            {" "}
                            {t("benefitsP4.values.kpiValue")}: <Measure value={l.kpiValue} />
                          </span>
                        ) : null}
                        {l.amount === null && l.kpiValue === null ? <UnknownChip /> : null}
                        {l.basis === "provisional" ? (
                          <span className="status-chip status-chip--unknown" data-basis="provisional">
                            {t("benefitsP4.measurements.provisional")}
                          </span>
                        ) : null}
                        {onEdit && EDITABLE_SERIES.has(s.state) && l.recordType === "benefit_plan_value" ? (
                          <>
                            {" "}
                            <button
                              type="button"
                              className="button button--secondary button--small"
                              data-action="edit-plan-value"
                              onClick={() => onEdit(l.recordId)}
                            >
                              {t("benefitsP4.values.editPlan")}
                              <span className="visually-hidden">
                                {" "}
                                {t(`benefitsP4.state.${s.state}`)}{" "}
                                {t("benefitsP4.values.editPlanPeriod", {
                                  start: l.periodStart ?? "",
                                  end: l.periodEnd ?? "",
                                })}
                              </span>
                            </button>
                          </>
                        ) : null}
                        {l.recordType === "benefit_measurement" ? (
                          <>
                            {" "}
                            <Link
                              className="link"
                              to={`/transformations/${b.transformationId}/benefit-measurements/${l.recordId}`}
                            >
                              {t("benefitsP4.measurements.open")}
                            </Link>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function planFields(t: (k: string) => string, create: boolean): P4FieldSpec[] {
  return [
    ...(create
      ? [
          {
            name: "valueKind",
            label: t("benefitsP4.values.kind"),
            kind: "select" as const,
            required: true,
            options: [
              { value: "planned", label: t("benefitsP4.state.planned") },
              { value: "forecast", label: t("benefitsP4.state.forecast") },
            ],
          },
        ]
      : []),
    { name: "periodStart", label: t("benefitsP4.field.periodStart"), kind: "date", required: create },
    { name: "periodEnd", label: t("benefitsP4.field.periodEnd"), kind: "date", required: create },
    {
      name: "amount",
      label: t("benefitsP4.field.amount"),
      kind: "text",
      ltr: true,
      hint: t("benefitsP4.form.moneyHint"),
    },
    {
      name: "kpiValue",
      label: t("benefitsP4.field.kpiValue"),
      kind: "text",
      ltr: true,
      hint: t("benefitsP4.form.decimalHint"),
    },
    { name: "note", label: t("benefitsP4.field.note"), kind: "textarea", max: 2000 },
  ];
}

function planBody(v: Record<string, string | boolean>, create: boolean) {
  const errors: Record<string, string> = {};
  const amount = ((v["amount"] as string) ?? "").trim();
  const kpiValue = ((v["kpiValue"] as string) ?? "").trim();
  if (amount !== "" && !MONEY_INPUT.test(amount)) errors["amount"] = "validation.decimal";
  if (kpiValue !== "" && !MEASURE_INPUT.test(kpiValue)) errors["kpiValue"] = "validation.decimal";
  if (create && amount === "" && kpiValue === "") errors["amount"] = "benefit_value.value_required";
  const start = v["periodStart"] as string;
  const end = v["periodEnd"] as string;
  if (start && end && end < start) errors["periodEnd"] = "benefit_value.period_range";
  if (Object.keys(errors).length > 0) return { fieldErrors: errors };
  const body: Record<string, unknown> = {};
  if (create) body["valueKind"] = v["valueKind"];
  if (start) body["periodStart"] = start;
  if (end) body["periodEnd"] = end;
  if (amount !== "" || !create) body["amount"] = amount === "" ? null : amount;
  if (kpiValue !== "" || !create) body["kpiValue"] = kpiValue === "" ? null : kpiValue;
  const note = textOf(v["note"]);
  if (note) body["note"] = note;
  return body;
}

function PlanValueDialog({ b, onClose }: { b: Benefit; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  return (
    <P4FormDialog
      title={t("benefitsP4.values.addPlan")}
      description={t("benefitsP4.values.planIntro", { currency: b.currency })}
      fields={planFields(t, true)}
      submitLabel={t("benefitsP4.values.addPlan")}
      url={benefitPaths.planValues(ws.tid, b.id)}
      namespaces={NS}
      toBody={(v) => planBody(v, true)}
      onDone={() => refresh()}
      onClose={onClose}
    />
  );
}

/**
 * Edit one planned or forecast value (T-DG4-FE-R1; FE-C decision 1). The value lines carry no version, so the record
 * is read first (getBenefitPlanValue) and the version of THAT read is sent as If-Match: a change by someone else after
 * the read answers 409 (shown as a conflict; the values are re-read and the dialog must be reopened to see them), never
 * a silent overwrite. Only changed fields are sent; an unchanged form is refused here (`validation.empty_patch`).
 */
function EditPlanValue({ planValueId, onClose }: { planValueId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const read = useBenefitPlanValue(ws.tid, planValueId);
  if (read.data !== undefined) return <EditPlanValueForm read={read.data} onClose={onClose} />;
  // Loading and a failed read are shown in the section (one dialog only, opened from the Edit button, so focus
  // returns to it): never an editable form with guessed values or without the version to send as If-Match.
  return (
    <div className="plan-value-read" data-plan-value-read={read.isError ? "error" : "loading"}>
      <QueryState query={read}>{() => null}</QueryState>
      {read.isError ? (
        <button type="button" className="button button--secondary button--small" onClick={onClose}>
          {t("common.action.cancel")}
        </button>
      ) : null}
    </div>
  );
}

function EditPlanValueForm({ read, onClose }: { read: BenefitPlanValue; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  // The version and values the user saw, pinned: a refetch after a 409 must not move If-Match under typed values.
  const [seen] = useState(read);
  return (
    <P4FormDialog
      title={t("benefitsP4.values.editPlanTitle")}
      description={
        <>
          <p>{t("benefitsP4.values.planIntro", { currency: seen.currency })}</p>
          <p className="small muted" data-plan-kind={seen.valueKind}>
            {t("benefitsP4.values.kind")}: {t(`benefitsP4.state.${seen.valueKind}`)} ·{" "}
            {t("benefitsP4.values.editVersion", { version: seen.version })}
          </p>
        </>
      }
      fields={planFields(t, false)}
      initial={{
        periodStart: seen.periodStart,
        periodEnd: seen.periodEnd,
        amount: seen.amount ?? "",
        kpiValue: seen.kpiValue ?? "",
        note: seen.note ?? "",
      }}
      submitLabel={t("common.action.save")}
      method="PATCH"
      url={benefitPaths.planValue(ws.tid, seen.id)}
      version={seen.version}
      namespaces={NS}
      toBody={(v) => planPatch(v, seen)}
      onDone={() => refresh()}
      onClose={onClose}
    />
  );
}

/** The PATCH body of a plan value: only what differs from the record read; at least one member (minProperties 1). */
export function planPatch(
  v: Record<string, string | boolean>,
  pv: Pick<BenefitPlanValue, "periodStart" | "periodEnd" | "amount" | "kpiValue" | "note">,
): Record<string, unknown> | { fieldErrors: Record<string, string> } {
  const built = planBody(v, false);
  if ("fieldErrors" in built) return built as { fieldErrors: Record<string, string> };
  const body: Record<string, unknown> = {};
  const start = (v["periodStart"] as string) ?? "";
  const end = (v["periodEnd"] as string) ?? "";
  if (start === "") return { fieldErrors: { periodStart: "validation.required" } };
  if (end === "") return { fieldErrors: { periodEnd: "validation.required" } };
  if (start !== pv.periodStart) body["periodStart"] = start;
  if (end !== pv.periodEnd) body["periodEnd"] = end;
  if (built["amount"] !== pv.amount) body["amount"] = built["amount"];
  if (built["kpiValue"] !== pv.kpiValue) body["kpiValue"] = built["kpiValue"];
  if (built["amount"] === null && built["kpiValue"] === null)
    return { fieldErrors: { amount: "benefit_value.value_required" } };
  const note = textOf(v["note"]) ?? null;
  if (note !== pv.note) body["note"] = note;
  if (Object.keys(body).length === 0) return { fieldErrors: { periodStart: "validation.empty_patch" } };
  return body;
}

// ------------------------------------------------------------------------------------------------ measurements

function Measurements({ b }: { b: Benefit }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const locale = useLocale();
  const refresh = useP4Refresh(ws.tid);
  const measurements = useBenefitMeasurements(ws.tid, b.id);
  const canMeasure = ws.can("benefit.measure") && b.status === "active";
  const atMeasure = b.lifecycleStep === "measure" || b.lifecycleStep === "correct" || b.lifecycleStep === "sustain";
  const [dialog, setDialog] = useState<
    { kind: "create" } | { kind: "edit"; m: BenefitMeasurement } | { kind: "submit"; m: BenefitMeasurement } | null
  >(null);
  return (
    <Section
      id="benefit-measurements"
      title={t("benefitsP4.measurements.title")}
      intro={t("benefitsP4.measurements.intro")}
      actions={
        canMeasure ? (
          <button type="button" className="button button--primary" onClick={() => setDialog({ kind: "create" })}>
            <Icon name="plus" /> {t("benefitsP4.measurements.create")}
          </button>
        ) : null
      }
    >
      {canMeasure && !atMeasure ? (
        <p className="banner banner--info" role="note" data-state="not-at-measure">
          <Icon name="info" />{" "}
          {t("benefitsP4.measurements.notAtMeasure", { step: t(`benefitsP4.step.${b.lifecycleStep}`) })}
        </p>
      ) : null}
      <QueryState query={measurements}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="muted" data-state="no-measurements">
              {t("benefitsP4.measurements.empty")}
            </p>
          ) : (
            <div className="table-wrap" role="region" tabIndex={0} aria-label={t("benefitsP4.measurements.title")}>
              <table className="table" data-measurements={rows.length}>
                <caption className="visually-hidden">{t("benefitsP4.measurements.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("benefitsP4.measurements.no")}</th>
                    <th scope="col">{t("benefitsP4.measurements.period")}</th>
                    <th scope="col">{t("benefitsP4.measurements.value")}</th>
                    <th scope="col">{t("benefitsP4.measurements.status")}</th>
                    <th scope="col">{t("benefitsP4.measurements.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} data-measurement={m.measurementNo} data-status={m.status}>
                      <th scope="row">
                        <Link className="link" to={`/transformations/${ws.tid}/benefit-measurements/${m.id}`}>
                          #{m.measurementNo}
                        </Link>
                        <span className="block small muted">
                          {t(`benefitsP4.measurementKind.${m.kind}`)} · {t(`benefitsP4.measurementSource.${m.source}`)}
                        </span>
                      </th>
                      <td>
                        <Period start={m.periodStart} end={m.periodEnd} />
                      </td>
                      <td>
                        <MeasurementValue m={m} />
                      </td>
                      <td>
                        <span className="chip-row">
                          <MeasurementStatusChip status={m.status} />
                          {m.basis === "provisional" && m.status !== "validated" ? (
                            <span
                              className="status-chip status-chip--unknown status-chip--wrap"
                              data-basis="provisional"
                            >
                              <Icon name="info" /> <span>{t("benefitsP4.measurements.provisional")}</span>
                            </span>
                          ) : null}
                        </span>
                        {m.submittedAt ? (
                          <span className="block small muted">
                            {t("benefitsP4.measurements.submittedAt", {
                              at: formatDateTime(m.submittedAt, locale) ?? "",
                            })}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {canMeasure && m.status === "draft" ? (
                          <span className="chip-row">
                            <button
                              type="button"
                              className="button button--secondary button--small"
                              onClick={() => setDialog({ kind: "edit", m })}
                            >
                              {t("benefitsP4.measurements.edit")}
                            </button>
                            <button
                              type="button"
                              className="button button--primary button--small"
                              onClick={() => setDialog({ kind: "submit", m })}
                            >
                              {t("benefitsP4.measurements.submit")}
                            </button>
                          </span>
                        ) : m.status === "validated" ? (
                          <span className="small muted">{t("benefitsP4.measurements.validatedImmutable")}</span>
                        ) : m.financeValidationId ? (
                          <Link
                            className="link"
                            to={`/transformations/${ws.tid}/finance-validations/${m.financeValidationId}`}
                          >
                            {t("benefitsP4.finance.open")}
                          </Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryState>
      {dialog?.kind === "create" ? <MeasurementDialog b={b} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "edit" ? <MeasurementDialog b={b} m={dialog.m} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "submit" ? (
        <SendDialog
          title={t("benefitsP4.measurements.submit")}
          description={t("benefitsP4.measurements.submitIntro")}
          submitLabel={t("benefitsP4.measurements.submit")}
          url={benefitPaths.submitMeasurement(ws.tid, dialog.m.id)}
          version={dialog.m.version}
          build={() => undefined}
          onDone={() => refresh()}
          onClose={() => setDialog(null)}
        >
          <FinanceValidationNote body={t("benefitsP4.measurements.pendingNote")} />
        </SendDialog>
      ) : null}
    </Section>
  );
}

/** A measurement's value: amount, KPI value, or Unknown with the stated reason (never 0). */
export function MeasurementValue({ m }: { m: BenefitMeasurement }) {
  const { t } = useTranslation();
  return (
    <span className="block" data-measurement-value={m.amount ?? m.kpiValue ?? "unknown"}>
      {m.amount !== null ? <Money value={m.amount} currency={m.currency} /> : null}
      {m.kpiValue !== null ? (
        <span className="block">
          {t("benefitsP4.values.kpiValue")}: <Measure value={m.kpiValue} />
        </span>
      ) : null}
      {m.amount === null && m.kpiValue === null ? <UnknownChip reason={m.missingReason} /> : null}
      {m.validatedAmount !== null && m.validatedAmount !== m.amount ? (
        <span className="block small">
          {t("benefitsP4.measurements.validatedAmount")}: <Money value={m.validatedAmount} currency={m.currency} />
        </span>
      ) : null}
    </span>
  );
}

function MeasurementDialog({ b, m, onClose }: { b: Benefit; m?: BenefitMeasurement; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const evidence = useBenefitEvidenceOptions(ws.tid);
  const [v, setV] = useState({
    periodStart: m?.periodStart ?? "",
    periodEnd: m?.periodEnd ?? "",
    amount: m?.amount ?? "",
    kpiValue: m?.kpiValue ?? "",
    missingReason: m?.missingReason ?? "",
    attribution: m?.attribution ?? "",
    assumptions: m?.assumptions ?? "",
  });
  const [evidenceIds, setEvidenceIds] = useState<string[]>(m?.evidenceIds ?? []);
  const [submitNow, setSubmitNow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const financial = b.valueClass !== "non_financial" || b.valuationMethodId !== null;
  const err = (k: string) => (errors[k] ? fieldErrorMessage(t, errors[k]!) : undefined);
  const set = (k: keyof typeof v, value: string) => setV({ ...v, [k]: value });
  const build = () => {
    const next: Record<string, string> = {};
    if (v.amount.trim() !== "" && !MONEY_INPUT.test(v.amount.trim())) next["amount"] = "validation.decimal";
    if (v.kpiValue.trim() !== "" && !MEASURE_INPUT.test(v.kpiValue.trim())) next["kpiValue"] = "validation.decimal";
    if (v.periodStart && v.periodEnd && v.periodEnd < v.periodStart) next["periodEnd"] = "benefit_value.period_range";
    for (const k of ["missingReason", "attribution", "assumptions"] as const)
      if (v[k] !== "" && !textOf(v[k])) next[k] = "validation.blank";
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    const body: Record<string, unknown> = {};
    const put = (k: string, s: string, edit: string | null | undefined) => {
      if (m) {
        if ((edit ?? "") !== s) body[k] = s === "" ? null : s;
      } else if (s !== "") body[k] = s;
    };
    put("periodStart", v.periodStart, m?.periodStart);
    put("periodEnd", v.periodEnd, m?.periodEnd);
    put("amount", v.amount.trim(), m?.amount);
    put("kpiValue", v.kpiValue.trim(), m?.kpiValue);
    put("missingReason", textOf(v.missingReason) ?? "", m?.missingReason);
    put("attribution", textOf(v.attribution) ?? "", m?.attribution);
    put("assumptions", textOf(v.assumptions) ?? "", m?.assumptions);
    if (!m || evidenceIds.join(",") !== (m.evidenceIds ?? []).join(",")) body["evidenceIds"] = evidenceIds;
    if (!m && submitNow) body["submit"] = true;
    if (m && Object.keys(body).length === 0) {
      setErrors({ periodStart: "validation.empty_patch" });
      return null;
    }
    return body;
  };
  return (
    <SendDialog
      title={m ? t("benefitsP4.measurements.edit") : t("benefitsP4.measurements.create")}
      description={t("benefitsP4.measurements.formIntro", { currency: b.currency })}
      submitLabel={
        m
          ? t("common.action.save")
          : submitNow
            ? t("benefitsP4.measurements.createSubmit")
            : t("benefitsP4.measurements.saveDraft")
      }
      method={m ? "PATCH" : "POST"}
      url={m ? benefitPaths.measurement(ws.tid, m.id) : benefitPaths.measurements(ws.tid, b.id)}
      {...(m ? { version: m.version } : {})}
      build={build}
      onDone={() => refresh()}
      onClose={onClose}
    >
      <Field
        label={t("benefitsP4.field.periodStart")}
        hint={t("benefitsP4.measurements.periodHint")}
        error={err("periodStart")}
      >
        {(c) => (
          <input
            {...c}
            type="date"
            data-field="periodStart"
            value={v.periodStart}
            onChange={(e) => set("periodStart", e.target.value)}
          />
        )}
      </Field>
      <Field label={t("benefitsP4.field.periodEnd")} error={err("periodEnd")}>
        {(c) => (
          <input
            {...c}
            type="date"
            data-field="periodEnd"
            value={v.periodEnd}
            onChange={(e) => set("periodEnd", e.target.value)}
          />
        )}
      </Field>
      {financial ? (
        <Field
          label={t("benefitsP4.field.amountIn", { currency: b.currency })}
          hint={t("benefitsP4.form.moneyHint")}
          error={err("amount")}
        >
          {(c) => (
            <input
              {...c}
              type="text"
              inputMode="decimal"
              dir="ltr"
              data-field="amount"
              value={v.amount}
              onChange={(e) => set("amount", e.target.value)}
            />
          )}
        </Field>
      ) : null}
      <Field
        label={t("benefitsP4.field.kpiValue")}
        hint={t("benefitsP4.measurements.kpiValueHint")}
        error={err("kpiValue")}
      >
        {(c) => (
          <input
            {...c}
            type="text"
            inputMode="decimal"
            dir="ltr"
            data-field="kpiValue"
            value={v.kpiValue}
            onChange={(e) => set("kpiValue", e.target.value)}
          />
        )}
      </Field>
      <Field
        label={t("benefitsP4.field.missingReason")}
        hint={t("benefitsP4.measurements.missingHint")}
        error={err("missingReason")}
      >
        {(c) => (
          <textarea
            {...c}
            rows={2}
            maxLength={1000}
            data-field="missingReason"
            value={v.missingReason}
            onChange={(e) => set("missingReason", e.target.value)}
          />
        )}
      </Field>
      <Field label={t("benefitsP4.field.attribution")} error={err("attribution")}>
        {(c) => (
          <textarea
            {...c}
            rows={2}
            maxLength={4000}
            data-field="attribution"
            value={v.attribution}
            onChange={(e) => set("attribution", e.target.value)}
          />
        )}
      </Field>
      <Field label={t("benefitsP4.field.assumptions")} error={err("assumptions")}>
        {(c) => (
          <textarea
            {...c}
            rows={2}
            maxLength={8000}
            data-field="assumptions"
            value={v.assumptions}
            onChange={(e) => set("assumptions", e.target.value)}
          />
        )}
      </Field>
      <fieldset className="filters__group" data-field="evidenceIds">
        <legend>{t("benefitsP4.field.evidence")}</legend>
        {(evidence.data ?? []).length === 0 ? (
          <p className="small muted">{t("benefitsP4.measurements.noEvidence")}</p>
        ) : (
          (evidence.data ?? []).map((e) => (
            <label key={e.id} className="checkbox">
              <input
                type="checkbox"
                checked={evidenceIds.includes(e.id)}
                onChange={(ev) =>
                  setEvidenceIds(ev.target.checked ? [...evidenceIds, e.id] : evidenceIds.filter((x) => x !== e.id))
                }
              />
              {e.title}
            </label>
          ))
        )}
      </fieldset>
      {!m ? (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={submitNow}
            onChange={(e) => setSubmitNow(e.target.checked)}
            data-field="submit"
          />
          {t("benefitsP4.measurements.submitNow")}
        </label>
      ) : null}
      <p className="small muted">{t("benefitsP4.measurements.draftNote")}</p>
    </SendDialog>
  );
}

// ------------------------------------------------------------------------------------------------ overlaps of this benefit

function BenefitOverlapsList({ b }: { b: Benefit }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const overlaps = useBenefitOverlaps(ws.tid);
  const mine = (overlaps.data ?? []).filter((o) => o.benefitAId === b.id || o.benefitBId === b.id);
  if (mine.length === 0) return null;
  return (
    <Section id="benefit-overlaps-of" title={t("benefitsP4.overlaps.ofBenefit")}>
      <ul className="plain-list">
        {mine.map((o) => (
          <li key={o.id} data-overlap={o.id}>
            <Link className="link" to={`/transformations/${ws.tid}/benefit-overlaps/${o.id}`}>
              {o.dimensions.map((d) => t(`benefitsP4.dimension.${d}`)).join(t("benefitsP4.listSeparator"))}
            </Link>{" "}
            <RecordChip group="overlaps" status={o.status} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
