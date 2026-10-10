// Transformations > Closure and transition decisions (T-DG4-FE-F; p4-work-split §F+G FG.8; ADR-0034 §1-§3, §7, §12;
// ADR-0026 amendment E1-E6). SYNTHETIC data only in tests and demos.
//  - REQ-S03-003: delivery, adoption, validated value and closure are four separate statuses, shown side by side and
//    never derived from one another here; the label is the server's ADR-0034 §2 label, translated at render time.
//  - REQ-PB-009 / REQ-S11-006: a delivered initiative whose value is still pending reads "Delivered — value validation
//    pending"; a transformation whose initiatives are all complete with value pending reads "Delivery complete - value
//    validation pending". No label ever says "successful", and pending value is never shown as validated.
//  - Closure actions (close an initiative, close the transformation) show the ADR-0034 §12 refusals translated; closure
//    never archives anything, and G6 approval alone closes nothing.
//  - REQ-S11-007: a transition decision documents residual ownership and monitoring for value still to be realized; the
//    benefit's forecast stays forecast. It is decided through the canonical business approval inside the product
//    (never DG0-DG7). Only the requester submits again (round 2 after a return) or withdraws while it is in approval;
//    anyone else gets the translated 403 `approval.not_requester`.
import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { SETTABLE_ADOPTION_STATUSES, SUSTAIN_FREQUENCIES } from "@mth/shared/schemas";
import { useApproval, useP4Refresh } from "../../api/p4.ts";
import { useInitiatives } from "../../api/portfolio.ts";
import type { Initiative } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { BusinessApprovalNote, P4FormDialog, textOf, type P4FieldSpec } from "../my-work/p4ui.tsx";
import { ConfirmActionDialog } from "../gates/GateP4.tsx";
import {
  closurePaths,
  useClosureBenefits,
  useClosureRecords,
  useInitiativeStatusModels,
  useTransformationStatusModel,
  useTransitionDecisions,
  type InitiativeStatusModel,
  type TransformationStatusModel,
  type TransitionDecision,
} from "./api.ts";

/** The page namespace (its `problem.*` texts are read before `problems.*`). */
export const CLOSURE_NS = ["closureP4"] as const;

/** The ADR-0034 §2 labels (exact English, from the server) -> their i18n keys (English values are identical). */
export const STATUS_LABEL_KEYS: Readonly<Record<string, string>> = {
  Closed: "closed",
  "Delivered — value validation pending": "deliveredValuePending",
  "Delivered — value validated": "deliveredValueValidated",
  "In delivery": "inDelivery",
  "Delivery complete - value validation pending": "deliveryCompleteValuePending",
  "Value validated - BAU acceptance pending": "valueValidatedBauPending",
  "Value validated - BAU accepted": "valueValidatedBauAccepted",
};

/** A server label translated; an unknown label is shown as Unknown (never guessed, never "successful"). */
export function statusLabelText(t: TFunction, label: string): string {
  const key = STATUS_LABEL_KEYS[label];
  return key ? t(`closureP4.label.${key}`) : t("common.value.unknown");
}

export function ClosurePage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="closure"
      title={t("closureP4.title")}
      subtitle={t("closureP4.intro")}
      writePermissions={[
        "initiative.complete_delivery",
        "adoption_status.set",
        "initiative.close",
        "transformation.close",
        "transition_decision.propose",
      ]}
    >
      <ClosureBody />
    </WorkspaceFrame>
  );
}

function ClosureBody() {
  return (
    <>
      <TransformationStatusSection />
      <InitiativeStatusSection />
      <TransitionDecisionsSection />
      <ClosureRecordsSection />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ status texts

const VALUE_ICON: Record<string, IconName> = {
  no_benefit: "question",
  validation_pending: "clock",
  validated: "check",
  validated_with_transition: "refresh",
};

/** A labelled status with an icon; pending or unknown states use the neutral "unknown" chip, never a green one. */
function StatusValue({ group, value, icon }: { group: string; value: string; icon: IconName }) {
  const { t } = useTranslation();
  const pending = value === "validation_pending" || value === "no_benefit" || value === "not_assessed";
  return (
    <span
      className={pending ? "status-chip status-chip--unknown status-chip--wrap" : "chip-row"}
      data-status-group={group}
      data-status-value={value}
    >
      <Icon name={icon} /> <span>{t(`closureP4.${group}.${value}`, { defaultValue: value })}</span>
    </span>
  );
}

function LabelText({ label }: { label: string }) {
  const { t } = useTranslation();
  const pending = label.includes("pending");
  return (
    <strong className={pending ? "status-chip status-chip--unknown status-chip--wrap" : ""} data-status-label={label}>
      <Icon name={label === "Closed" ? "lock" : pending ? "clock" : "dot"} /> {statusLabelText(t, label)}
    </strong>
  );
}

function ProvisionalArabic() {
  const { t } = useTranslation();
  const locale = useLocale();
  if (locale !== "ar") return null;
  return (
    <p className="small muted" data-provisional-ar="true">
      <Icon name="info" /> {t("closureP4.arProvisional")}
    </p>
  );
}

// ------------------------------------------------------------------------------------------------ transformation

function TransformationStatusSection() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const model = useTransformationStatusModel(ws.tid);
  const [closing, setClosing] = useState(false);
  const refreshAll = useRefreshAll();
  const canClose = ws.can("transformation.close");
  return (
    <Section
      id="transformation-status"
      title={t("closureP4.transformation.title")}
      intro={t("closureP4.transformation.intro")}
      actions={
        canClose ? (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setClosing(true)}
            data-action="close-transformation"
          >
            <Icon name="lock" /> {t("closureP4.transformation.close")}
          </button>
        ) : null
      }
    >
      <QueryState query={model}>{(m) => <TransformationStatusCards m={m} />}</QueryState>
      <ProvisionalArabic />
      {closing ? (
        <P4FormDialog
          title={t("closureP4.transformation.closeTitle", { code: ws.tr.code })}
          description={t("closureP4.transformation.closeDescription")}
          fields={[{ name: "note", label: t("closureP4.closeNote"), kind: "textarea", min: 3, max: 2000 }]}
          submitLabel={t("closureP4.transformation.close")}
          url={closurePaths.closeTransformation(ws.tid)}
          namespaces={CLOSURE_NS}
          toBody={(v) => {
            const note = textOf(v["note"]);
            return note ? { note } : {};
          }}
          onDone={refreshAll}
          onClose={() => setClosing(false)}
        />
      ) : null}
    </Section>
  );
}

function TransformationStatusCards({ m }: { m: TransformationStatusModel }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="banner banner--info" role="status" data-transformation-label={m.label}>
        <span>{t("closureP4.labelPrefix")}</span> <LabelText label={m.label} />
      </p>
      <dl className="details status-grid" data-status-model="transformation">
        <div data-status-card="delivery">
          <dt>{t("closureP4.col.delivery")}</dt>
          <dd>
            <StatusValue
              group="deliveryState"
              value={m.deliveryState}
              icon={m.deliveryState === "delivery_complete" ? "check" : "refresh"}
            />
            <span className="block small muted">
              {t("closureP4.transformation.initiativesComplete", {
                completed: m.initiatives.completed,
                total: m.initiatives.total,
              })}
            </span>
          </dd>
        </div>
        <div data-status-card="value">
          <dt>{t("closureP4.col.value")}</dt>
          <dd>
            <StatusValue group="value" value={m.valueState} icon={VALUE_ICON[m.valueState] ?? "dot"} />
          </dd>
        </div>
        <div data-status-card="bau">
          <dt>{t("closureP4.col.bau")}</dt>
          <dd>
            <StatusValue group="bauState" value={m.bauState} icon={m.bauState === "bau_accepted" ? "lock" : "clock"} />
            <span className="block small muted">
              {t("closureP4.transformation.areasInBau", {
                bau: m.performanceAreas.bau,
                total: m.performanceAreas.total,
              })}
            </span>
          </dd>
        </div>
        <div data-status-card="closure">
          <dt>{t("closureP4.col.closure")}</dt>
          <dd>
            <StatusValue group="closure" value={m.closureState} icon={m.closureState === "closed" ? "lock" : "dot"} />
          </dd>
        </div>
      </dl>
    </>
  );
}

function useRefreshAll() {
  const ws = useWorkspace();
  return useP4Refresh(ws.tid);
}

// ------------------------------------------------------------------------------------------------ initiatives

type InitiativeDialog = {
  kind: "complete" | "adoption" | "close";
  ini: Initiative;
  model: InitiativeStatusModel;
} | null;

function InitiativeStatusSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const initiatives = useInitiatives(ws.tid);
  const list = (initiatives.data ?? []).filter((i) => i.status !== "cancelled");
  const models = useInitiativeStatusModels(
    ws.tid,
    list.map((i) => i.id),
  );
  const [dialog, setDialog] = useState<InitiativeDialog>(null);
  const refresh = useRefreshAll();
  return (
    <Section id="initiative-status" title={t("closureP4.initiatives.title")} intro={t("closureP4.initiatives.intro")}>
      <QueryState
        query={initiatives}
        isEmpty={() => list.length === 0}
        empty={<EmptyState title={t("closureP4.initiatives.empty")} />}
      >
        {() => (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("closureP4.tableRegion.initiatives")}>
            <table className="table table--compact" data-initiative-statuses={list.length}>
              <caption className="visually-hidden">{t("closureP4.initiatives.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("closureP4.col.initiative")}</th>
                  <th scope="col">{t("closureP4.col.delivery")}</th>
                  <th scope="col">{t("closureP4.col.adoption")}</th>
                  <th scope="col">{t("closureP4.col.value")}</th>
                  <th scope="col">{t("closureP4.col.closure")}</th>
                  <th scope="col">{t("closureP4.col.label")}</th>
                  <th scope="col">{t("common.field.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((ini, n) => {
                  const q = models[n];
                  const m = q?.data;
                  const unknown = (
                    <span className="status-chip status-chip--unknown" data-status-value="unknown">
                      <Icon name="question" /> {q?.isLoading ? t("common.state.loading") : t("common.value.unknown")}
                    </span>
                  );
                  return (
                    <tr key={ini.id} data-initiative-status={ini.code} data-label={m?.label ?? "unknown"}>
                      <th scope="row">
                        <Link className="link" to={`/transformations/${ws.tid}/initiatives/${ini.id}`}>
                          <bdi dir="ltr" className="code">
                            {ini.code}
                          </bdi>{" "}
                          {ini.name}
                        </Link>
                      </th>
                      <td>
                        {m ? (
                          <span className="block">
                            <StatusValue
                              group="delivery"
                              value={m.delivery}
                              icon={m.delivery === "completed" ? "check" : "refresh"}
                            />
                            {m.deliveryCompletedAt ? (
                              <span className="block small muted">
                                {formatDateTime(m.deliveryCompletedAt, locale, ws.tr.timezone)}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          unknown
                        )}
                      </td>
                      <td>
                        {m ? (
                          <span className="block">
                            <StatusValue
                              group="adoption"
                              value={m.adoption}
                              icon={m.adoption === "at_risk" ? "alert" : m.adoption === "adopted" ? "check" : "dot"}
                            />
                            <span className="block small muted" data-adoption-source={m.adoptionSource}>
                              {t(`closureP4.adoptionSource.${m.adoptionSource}`)}
                            </span>
                          </span>
                        ) : (
                          unknown
                        )}
                      </td>
                      <td>
                        {m ? (
                          <StatusValue group="value" value={m.value} icon={VALUE_ICON[m.value] ?? "dot"} />
                        ) : (
                          unknown
                        )}
                      </td>
                      <td>
                        {m ? (
                          <StatusValue
                            group="closure"
                            value={m.closure}
                            icon={m.closure === "closed" ? "lock" : "dot"}
                          />
                        ) : (
                          unknown
                        )}
                      </td>
                      <td>{m ? <LabelText label={m.label} /> : unknown}</td>
                      <td>
                        {m ? (
                          <span className="section__actions">
                            {ws.can("initiative.complete_delivery") && m.delivery === "launched" ? (
                              <button
                                type="button"
                                className="button button--link button--small"
                                data-action="complete-delivery"
                                onClick={() => setDialog({ kind: "complete", ini, model: m })}
                              >
                                <Icon name="check" /> {t("closureP4.initiatives.completeDelivery")}
                                <span className="visually-hidden"> {ini.code}</span>
                              </button>
                            ) : null}
                            {ws.can("adoption_status.set") && m.closure === "open" ? (
                              <button
                                type="button"
                                className="button button--link button--small"
                                data-action="set-adoption"
                                onClick={() => setDialog({ kind: "adoption", ini, model: m })}
                              >
                                <Icon name="pencil" /> {t("closureP4.initiatives.setAdoption")}
                                <span className="visually-hidden"> {ini.code}</span>
                              </button>
                            ) : null}
                            {ws.can("initiative.close") && m.closure === "open" ? (
                              <button
                                type="button"
                                className="button button--link button--small"
                                data-action="close-initiative"
                                onClick={() => setDialog({ kind: "close", ini, model: m })}
                              >
                                <Icon name="lock" /> {t("closureP4.initiatives.close")}
                                <span className="visually-hidden"> {ini.code}</span>
                              </button>
                            ) : null}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
      {dialog?.kind === "complete" ? (
        <P4FormDialog
          title={t("closureP4.initiatives.completeTitle", { code: dialog.ini.code })}
          description={t("closureP4.initiatives.completeDescription")}
          fields={[{ name: "note", label: t("closureP4.note"), kind: "textarea", max: 2000 }]}
          submitLabel={t("closureP4.initiatives.completeDelivery")}
          url={closurePaths.completeDelivery(dialog.ini.id)}
          version={dialog.model.version}
          namespaces={CLOSURE_NS}
          toBody={(v) => {
            const note = textOf(v["note"]);
            return note ? { note } : {};
          }}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "adoption" ? (
        <P4FormDialog
          title={t("closureP4.initiatives.adoptionTitle", { code: dialog.ini.code })}
          description={t("closureP4.initiatives.adoptionDescription")}
          fields={[
            {
              name: "adoptionStatus",
              label: t("closureP4.col.adoption"),
              kind: "select",
              required: true,
              options: SETTABLE_ADOPTION_STATUSES.map((s) => ({ value: s, label: t(`closureP4.adoption.${s}`) })),
            },
            { name: "note", label: t("closureP4.note"), kind: "textarea", max: 2000 },
          ]}
          submitLabel={t("closureP4.save")}
          url={closurePaths.adoptionStatus(dialog.ini.id)}
          version={dialog.model.version}
          namespaces={CLOSURE_NS}
          toBody={(v) => {
            const note = textOf(v["note"]);
            return { adoptionStatus: v["adoptionStatus"], ...(note ? { note } : {}) };
          }}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "close" ? (
        <P4FormDialog
          title={t("closureP4.initiatives.closeTitle", { code: dialog.ini.code })}
          description={t("closureP4.initiatives.closeDescription")}
          fields={[{ name: "note", label: t("closureP4.closeNote"), kind: "textarea", min: 3, max: 2000 }]}
          submitLabel={t("closureP4.initiatives.close")}
          url={closurePaths.closeInitiative(dialog.ini.id)}
          namespaces={CLOSURE_NS}
          toBody={(v) => {
            const note = textOf(v["note"]);
            return note ? { note } : {};
          }}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ transition decisions

type DecisionDialog = { kind: "create" } | { kind: "edit" | "submit" | "withdraw"; d: TransitionDecision } | null;

function TransitionDecisionsSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const list = useTransitionDecisions(ws.tid);
  const benefits = useClosureBenefits(ws.tid);
  const { byId } = usePeople(ws.tid);
  const [dialog, setDialog] = useState<DecisionDialog>(null);
  const refresh = useRefreshAll();
  const canPropose = ws.can("transition_decision.propose");
  const benefitName = (id: string) => {
    const b = (benefits.data ?? []).find((x) => x.id === id);
    return b ? `${b.code} ${b.title}` : t("closureP4.decisions.benefitNotVisible");
  };
  return (
    <Section
      id="transition-decisions"
      title={t("closureP4.decisions.title")}
      intro={t("closureP4.decisions.intro")}
      actions={
        canPropose ? (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setDialog({ kind: "create" })}
            data-action="create-transition-decision"
          >
            <Icon name="plus" /> {t("closureP4.decisions.create")}
          </button>
        ) : null
      }
    >
      <BusinessApprovalNote body={t("closureP4.decisions.businessApproval")} />
      <p className="banner banner--info" role="note" data-state="forecast-stays-forecast">
        <Icon name="info" /> {t("closureP4.decisions.forecastStays")}
      </p>
      <QueryState
        query={list}
        isEmpty={(l) => l.length === 0}
        empty={<EmptyState title={t("closureP4.decisions.empty")} />}
      >
        {(rows) => (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("closureP4.tableRegion.decisions")}>
            <table className="table table--compact" data-transition-decisions={rows.length}>
              <caption className="visually-hidden">{t("closureP4.decisions.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("closureP4.decisions.code")}</th>
                  <th scope="col">{t("closureP4.decisions.benefit")}</th>
                  <th scope="col">{t("closureP4.decisions.residualOwner")}</th>
                  <th scope="col">{t("closureP4.decisions.rationale")}</th>
                  <th scope="col">{t("closureP4.decisions.monitoring")}</th>
                  <th scope="col">{t("common.field.status")}</th>
                  <th scope="col">{t("common.field.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {[...rows]
                  .sort((a, b) => a.code.localeCompare(b.code))
                  .map((d) => (
                    <DecisionRow
                      key={d.id}
                      d={d}
                      benefit={benefitName(d.benefitId)}
                      byId={byId}
                      locale={locale}
                      canPropose={canPropose}
                      onAction={(kind) => setDialog({ kind, d })}
                    />
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
      {dialog?.kind === "create" || dialog?.kind === "edit" ? (
        <DecisionFormDialog d={dialog.kind === "edit" ? dialog.d : undefined} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "submit" ? (
        <ConfirmActionDialog
          title={t("closureP4.decisions.submitTitle", { code: dialog.d.code })}
          body={dialog.d.approvalId ? t("closureP4.decisions.resubmitBody") : t("closureP4.decisions.submitBody")}
          confirmLabel={dialog.d.approvalId ? t("closureP4.decisions.resubmit") : t("closureP4.decisions.submit")}
          url={closurePaths.submitDecision(ws.tid, dialog.d.id)}
          version={dialog.d.version}
          namespaces={CLOSURE_NS}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "withdraw" ? (
        <P4FormDialog
          title={t("closureP4.decisions.withdrawTitle", { code: dialog.d.code })}
          description={t("closureP4.decisions.withdrawBody")}
          fields={[]}
          danger
          method="PATCH"
          submitLabel={t("closureP4.decisions.withdraw")}
          url={closurePaths.decision(ws.tid, dialog.d.id)}
          version={dialog.d.version}
          namespaces={CLOSURE_NS}
          toBody={() => ({ status: "withdrawn" })}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Section>
  );
}

function DecisionRow({
  d,
  benefit,
  byId,
  locale,
  canPropose,
  onAction,
}: {
  d: TransitionDecision;
  benefit: string;
  byId: ReturnType<typeof usePeople>["byId"];
  locale: "ar" | "en";
  canPropose: boolean;
  onAction: (kind: "edit" | "submit" | "withdraw") => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const approval = useApproval(d.approvalId ?? undefined);
  const a = approval.data;
  const returned = d.status === "draft" && a?.status === "changes_requested";
  const inApproval = d.status === "submitted";
  const requester = a ? a.requestedBy === ws.meId : d.createdBy === ws.meId;
  const frequency =
    d.monitoringInterval === 1
      ? t(`closureP4.frequency.${d.monitoringFrequency}`)
      : t("closureP4.frequencyEvery", {
          n: d.monitoringInterval,
          unit: t(`closureP4.frequency.${d.monitoringFrequency}`),
        });
  return (
    <tr data-transition-decision={d.code} data-status={d.status} data-round={a?.roundNo ?? 0}>
      <th scope="row">
        <bdi dir="ltr" className="code">
          {d.code}
        </bdi>
      </th>
      <td>
        <bdi>{benefit}</bdi>
        <span className="block small muted">
          {t("closureP4.decisions.expectedEnd")}: {formatBusinessDate(d.expectedRealizationEnd, locale)}
        </span>
      </td>
      <td>
        <PersonName id={d.residualOwnerUserId} people={byId} />
      </td>
      <td>
        <TextCell value={d.rationale} />
      </td>
      <td>
        {frequency}
        <span className="block small muted">
          {t("closureP4.decisions.firstMonitoring")}: {formatBusinessDate(d.firstMonitoringDate, locale)}
        </span>
        <span className="block small muted">
          {t("closureP4.decisions.nextMonitoring")}:{" "}
          {d.nextMonitoringDate
            ? formatBusinessDate(d.nextMonitoringDate, locale)
            : t("closureP4.decisions.notScheduled")}
        </span>
      </td>
      <td>
        <span className="chip-row" data-decision-status={d.status}>
          <Icon
            name={
              d.status === "approved"
                ? "lock"
                : d.status === "submitted"
                  ? "clock"
                  : d.status === "draft"
                    ? "pencil"
                    : "cross"
            }
          />{" "}
          {returned ? t("closureP4.decisions.returned") : t(`closureP4.decisions.status.${d.status}`)}
        </span>
        {a ? (
          <span className="block small muted" data-approval-status={a.status}>
            {t("closureP4.decisions.round", { n: a.roundNo })} ·{" "}
            {t(`closureP4.decisions.approvalStatus.${a.status}`, { defaultValue: a.status })}
          </span>
        ) : null}
        {d.decidedAt ? (
          <span className="block small muted">
            {formatDateTime(d.decidedAt, locale, ws.tr.timezone)}
            {d.decidedBy ? (
              <>
                {" · "}
                <PersonName id={d.decidedBy} people={byId} />
              </>
            ) : null}
          </span>
        ) : null}
        {d.approvalId ? (
          <Link className="link small block" to={`/my-work/approvals/${d.approvalId}`}>
            {t("closureP4.decisions.openApproval")}
          </Link>
        ) : null}
      </td>
      <td>
        {canPropose ? (
          <span className="section__actions">
            {d.status === "draft" ? (
              <button
                type="button"
                className="button button--link button--small"
                data-action="edit-decision"
                onClick={() => onAction("edit")}
              >
                <Icon name="pencil" /> {t("closureP4.decisions.edit")}
                <span className="visually-hidden"> {d.code}</span>
              </button>
            ) : null}
            {d.status === "draft" ? (
              <button
                type="button"
                className="button button--link button--small"
                data-action={returned ? "resubmit-decision" : "submit-decision"}
                onClick={() => onAction("submit")}
              >
                <Icon name="check" />{" "}
                {returned
                  ? t("closureP4.decisions.resubmitRound", { n: (a?.roundNo ?? 1) + 1 })
                  : t("closureP4.decisions.submit")}
                <span className="visually-hidden"> {d.code}</span>
              </button>
            ) : null}
            {d.status === "draft" || inApproval ? (
              <button
                type="button"
                className="button button--link button--small"
                data-action="withdraw-decision"
                onClick={() => onAction("withdraw")}
              >
                <Icon name="cross" /> {t("closureP4.decisions.withdraw")}
                <span className="visually-hidden"> {d.code}</span>
              </button>
            ) : null}
            {(returned || inApproval) && !requester ? (
              <span className="small muted" data-requester-only="true">
                {t("closureP4.decisions.requesterOnly")}
              </span>
            ) : null}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function DecisionFormDialog({ d, onClose }: { d?: TransitionDecision | undefined; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useRefreshAll();
  const benefits = useClosureBenefits(ws.tid);
  const { people } = usePeople(ws.tid);
  const fields: P4FieldSpec[] = [
    ...(d
      ? []
      : [
          {
            name: "benefitId",
            label: t("closureP4.decisions.benefit"),
            kind: "select",
            required: true,
            options: (benefits.data ?? []).map((b) => ({ value: b.id, label: `${b.code} ${b.title}` })),
          } satisfies P4FieldSpec,
        ]),
    {
      name: "residualOwnerUserId",
      label: t("closureP4.decisions.residualOwner"),
      kind: "select",
      required: true,
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    {
      name: "rationale",
      label: t("closureP4.decisions.rationale"),
      kind: "textarea",
      required: true,
      min: 3,
      max: 4000,
    },
    { name: "expectedRealizationEnd", label: t("closureP4.decisions.expectedEnd"), kind: "date", required: true },
    {
      name: "monitoringFrequency",
      label: t("closureP4.decisions.frequency"),
      kind: "select",
      required: true,
      options: SUSTAIN_FREQUENCIES.map((f) => ({ value: f, label: t(`closureP4.frequency.${f}`) })),
    },
    { name: "monitoringInterval", label: t("closureP4.decisions.interval"), kind: "number", min: 1, max: 12 },
    {
      name: "firstMonitoringDate",
      label: t("closureP4.decisions.firstMonitoring"),
      hint: t("closureP4.decisions.firstMonitoringHint"),
      kind: "date",
      required: true,
    },
  ];
  const initial = d
    ? {
        residualOwnerUserId: d.residualOwnerUserId,
        rationale: d.rationale,
        expectedRealizationEnd: d.expectedRealizationEnd,
        monitoringFrequency: d.monitoringFrequency,
        monitoringInterval: String(d.monitoringInterval),
        firstMonitoringDate: d.firstMonitoringDate,
      }
    : { monitoringFrequency: "monthly", monitoringInterval: "1" };
  return (
    <P4FormDialog
      title={d ? t("closureP4.decisions.editTitle", { code: d.code }) : t("closureP4.decisions.create")}
      description={t("closureP4.decisions.formDescription")}
      fields={fields}
      initial={initial}
      submitLabel={d ? t("closureP4.save") : t("closureP4.decisions.createSubmit")}
      method={d ? "PATCH" : "POST"}
      url={d ? closurePaths.decision(ws.tid, d.id) : closurePaths.decisions(ws.tid)}
      {...(d ? { version: d.version } : {})}
      namespaces={CLOSURE_NS}
      toBody={(v) => {
        const interval =
          typeof v["monitoringInterval"] === "string" && v["monitoringInterval"] !== ""
            ? Number(v["monitoringInterval"])
            : undefined;
        if (interval !== undefined && (!Number.isInteger(interval) || interval < 1 || interval > 12))
          return { fieldErrors: { monitoringInterval: "validation.too_small" } };
        const body: Record<string, unknown> = {
          residualOwnerUserId: v["residualOwnerUserId"],
          rationale: v["rationale"],
          expectedRealizationEnd: v["expectedRealizationEnd"],
          monitoringFrequency: v["monitoringFrequency"],
          firstMonitoringDate: v["firstMonitoringDate"],
          ...(interval !== undefined ? { monitoringInterval: interval } : {}),
        };
        if (!d) return { benefitId: v["benefitId"], ...body };
        const before: Record<string, unknown> = {
          residualOwnerUserId: d.residualOwnerUserId,
          rationale: d.rationale,
          expectedRealizationEnd: d.expectedRealizationEnd,
          monitoringFrequency: d.monitoringFrequency,
          firstMonitoringDate: d.firstMonitoringDate,
          monitoringInterval: d.monitoringInterval,
        };
        const patch = Object.fromEntries(Object.entries(body).filter(([k, x]) => x !== before[k]));
        return Object.keys(patch).length === 0 ? { fieldErrors: { rationale: "validation.empty_patch" } } : patch;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

// ------------------------------------------------------------------------------------------------ closure records

function ClosureRecordsSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const records = useClosureRecords(ws.tid);
  const initiatives = useInitiatives(ws.tid);
  const { byId } = usePeople(ws.tid);
  return (
    <Section id="closure-records" title={t("closureP4.records.title")} intro={t("closureP4.records.intro")}>
      <QueryState
        query={records}
        isEmpty={(l) => l.length === 0}
        empty={<EmptyState title={t("closureP4.records.empty")} />}
      >
        {(rows) => (
          <ul className="plain-list" data-closure-records={rows.length}>
            {rows.map((r) => {
              const ini = r.initiativeId ? (initiatives.data ?? []).find((i) => i.id === r.initiativeId) : undefined;
              return (
                <li key={r.id} data-closure-record={r.subjectKind}>
                  <Icon name="lock" />{" "}
                  <strong>
                    {r.subjectKind === "transformation"
                      ? t("closureP4.records.transformation")
                      : ini
                        ? `${ini.code} ${ini.name}`
                        : t("closureP4.records.initiative")}
                  </strong>{" "}
                  · {t(`closureP4.basis.${r.basis}`)}
                  <span className="block small muted">
                    {formatDateTime(r.closedAt, locale, ws.tr.timezone)} · <PersonName id={r.closedBy} people={byId} />
                  </span>
                  {r.closureNote ? <span className="block small">{r.closureNote}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </Section>
  );
}
