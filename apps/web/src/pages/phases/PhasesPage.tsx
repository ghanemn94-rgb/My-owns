// Transformations > Phases (T-DG4-FE-F2; p4-work-split §H H.6; ADR-0035 §1, §7 item 3, §8, §11; REQ-PB-014,
// REQ-S04-001, REQ-S04-002 first clause). SYNTHETIC data only in tests and demos.
//  - The phase catalogue: exactly the six playbook phases in order, with name, purpose and key outputs from B0021 and
//    each phase's objective. English is the source text; Arabic is a provisional translation and says so.
//  - The phase workspace: per phase, its guided steps with the procedure, required evidence, owner ("Unknown" when
//    nobody is assigned), reviewer role, completion rule and status, and the review queue.
//  - A step with no record yet is read at version 0; assigning its owner or starting it sends `If-Match: "0"` and
//    creates it (D-109). The completion rule is evaluated by the server when review is requested and again when the step
//    is accepted (422 `phase_step.completion_rule_unmet`, translated). The owner never reviews their own step.
//  - Steps never move a product gate: completing every step leaves the gate as it is (G1-G6 are business approvals
//    decided by people; nothing here touches DG0-DG7).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { PhaseStep, PhaseWorkspacePhase } from "@mth/shared/schemas";
import { useP4Refresh } from "../../api/p4.ts";
import { useRegister } from "../../api/queries.ts";
import type { Evidence } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { Dialog } from "../../components/Form.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { pick } from "../../lib/methodology.ts";
import { ConfirmActionDialog } from "../gates/GateP4.tsx";
import { P4FormDialog, ReadOnlyNote } from "../my-work/p4ui.tsx";
import {
  completionMetOf,
  phasePaths,
  usePhaseCatalogue,
  usePhaseWorkspace,
  useReviewQueue,
  useStepEvidence,
} from "./api.ts";

export const PHASE_NS = ["phasesP4"] as const;

const STATUS_ICON: Record<PhaseStep["status"], IconName> = {
  not_started: "dot",
  in_progress: "pencil",
  in_review: "clock",
  complete: "check",
  returned: "refresh",
};

export function PhasesPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="phases"
      title={t("phasesP4.title")}
      subtitle={t("phasesP4.intro")}
      writePermissions={["phase_step.manage", "phase_step.progress", "phase_step.review"]}
    >
      <PhasesBody />
    </WorkspaceFrame>
  );
}

function PhasesBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const workspace = usePhaseWorkspace(ws.tid);
  const readOnly = !ws.canAny("phase_step.manage", "phase_step.progress", "phase_step.review");
  return (
    <>
      <p className="banner banner--info" role="note" data-state="steps-never-move-gates">
        <Icon name="info" /> {t("phasesP4.gatesUnaffected")}
      </p>
      {readOnly ? <ReadOnlyNote body={t("phasesP4.readOnly")} /> : null}
      <CatalogueSection />
      <QueryState query={workspace}>
        {(w) => <WorkspaceSections phases={w.phases} current={w.currentPhase} />}
      </QueryState>
      <ReviewQueueSection />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ catalogue

function ProvisionalNote() {
  const { t } = useTranslation();
  const locale = useLocale();
  return locale === "ar" ? (
    <p className="small muted" data-ar-provisional="true">
      {t("phasesP4.arProvisional")}
    </p>
  ) : null;
}

function CatalogueSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const catalogue = usePhaseCatalogue();
  return (
    <Section id="phase-catalogue" title={t("phasesP4.catalogue.title")} intro={t("phasesP4.catalogue.intro")}>
      <ProvisionalNote />
      <QueryState query={catalogue}>
        {(c) => (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("phasesP4.tableRegion.catalogue")}>
            <table className="table table--compact" data-phase-catalogue={c.items.length}>
              <caption className="visually-hidden">{t("phasesP4.catalogue.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">{t("phasesP4.catalogue.name")}</th>
                  <th scope="col">{t("phasesP4.catalogue.gate")}</th>
                  <th scope="col">{t("phasesP4.catalogue.purpose")}</th>
                  <th scope="col">{t("phasesP4.catalogue.keyOutputs")}</th>
                </tr>
              </thead>
              <tbody>
                {[...c.items]
                  .sort((a, b) => a.ordinal - b.ordinal)
                  .map((p) => (
                    <tr key={p.code} data-phase={p.code}>
                      <td>{p.ordinal}</td>
                      <th scope="row">{pick(locale, p.sourceNameEn, p.nameAr)}</th>
                      <td>
                        <bdi dir="ltr">{p.gateCode}</bdi>
                      </td>
                      <td>{pick(locale, p.sourcePurposeEn, p.purposeAr)}</td>
                      <td>{pick(locale, p.sourceKeyOutputsEn, p.keyOutputsAr)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ workspace

type StepDialog =
  | null
  | { kind: "owner" | "start" | "request" | "evidence"; step: PhaseStep }
  | { kind: "review"; step: PhaseStep };

function WorkspaceSections({ phases, current }: { phases: readonly PhaseWorkspacePhase[]; current: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ordered = [...phases].sort((a, b) => a.phase.ordinal - b.phase.ordinal);
  const [selected, setSelected] = useState(current);
  const shown = ordered.find((p) => p.phase.code === selected) ?? ordered[0];
  return (
    <Section id="phase-workspace" title={t("phasesP4.workspace.title")} intro={t("phasesP4.workspace.intro")}>
      <div className="segmented" role="group" aria-label={t("phasesP4.workspace.choose")}>
        {ordered.map((p) => (
          <button
            key={p.phase.code}
            type="button"
            className={`button button--small ${p.phase.code === shown?.phase.code ? "button--primary" : "button--secondary"}`}
            aria-pressed={p.phase.code === shown?.phase.code}
            onClick={() => setSelected(p.phase.code)}
            data-phase-tab={p.phase.code}
          >
            {p.phase.ordinal}. {pick(locale, p.phase.sourceNameEn, p.phase.nameAr)}
            {p.isCurrent ? ` · ${t("phasesP4.workspace.current")}` : ""}
            {p.reviewQueueCount > 0 ? ` (${t("phasesP4.workspace.inReview", { n: p.reviewQueueCount })})` : ""}
          </button>
        ))}
      </div>
      {shown ? <PhasePanel p={shown} /> : null}
    </Section>
  );
}

function PhasePanel({ p }: { p: PhaseWorkspacePhase }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const [dialog, setDialog] = useState<StepDialog>(null);
  const refresh = useP4Refresh(ws.tid);
  const def = p.phase;
  const complete = p.steps.filter((s) => s.status === "complete").length;
  return (
    <div data-phase-panel={def.code} data-current={p.isCurrent ? "true" : "false"}>
      <h3>{pick(locale, def.sourceTitleEn, def.titleAr)}</h3>
      <ProvisionalNote />
      <dl className="facts">
        <dt>{t("phasesP4.catalogue.purpose")}</dt>
        <dd>{pick(locale, def.sourcePurposeEn, def.purposeAr)}</dd>
        <dt>{t("phasesP4.workspace.objective")}</dt>
        <dd data-phase-objective={def.code}>{pick(locale, def.sourceObjectiveEn, def.objectiveAr)}</dd>
        <dt>{t("phasesP4.catalogue.keyOutputs")}</dt>
        <dd>{pick(locale, def.sourceKeyOutputsEn, def.keyOutputsAr)}</dd>
        <dt>{t("phasesP4.workspace.gate", { gate: def.gateCode })}</dt>
        <dd data-gate-status={p.gateStatus}>
          {t(`phasesP4.gateStatus.${p.gateStatus}`)}{" "}
          <Link className="link small" to={`/transformations/${ws.tid}/gates/${def.gateCode}`}>
            {t("phasesP4.workspace.openGate", { gate: def.gateCode })}
          </Link>
        </dd>
        <dt>{t("phasesP4.workspace.progress")}</dt>
        <dd data-steps-complete={complete}>
          {t("phasesP4.workspace.stepsComplete", { done: complete, total: p.steps.length })}
        </dd>
      </dl>
      <StepsTable steps={p.steps} onAction={setDialog} caption={pick(locale, def.sourceNameEn, def.nameAr)} />
      <StepDialogs dialog={dialog} onClose={() => setDialog(null)} refresh={refresh} />
    </div>
  );
}

function StepStatus({ step }: { step: PhaseStep }) {
  const { t } = useTranslation();
  const met = completionMetOf(step.completionCheck);
  return (
    <>
      <span
        className={step.status === "not_started" ? "status-chip status-chip--unknown" : "chip-row"}
        data-step-status={step.status}
      >
        <Icon name={STATUS_ICON[step.status]} /> {t(`phasesP4.stepStatus.${step.status}`)}
      </span>
      {met !== null ? (
        <span className="block small muted" data-rule-met={met ? "true" : "false"}>
          {met ? t("phasesP4.step.ruleMet") : t("phasesP4.step.ruleNotMet")}
        </span>
      ) : null}
      {step.reviewNote ? <span className="block small">{step.reviewNote}</span> : null}
    </>
  );
}

function StepsTable({
  steps,
  onAction,
  caption,
}: {
  steps: readonly PhaseStep[];
  onAction: (d: StepDialog) => void;
  caption: string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const { byId } = usePeople(ws.tid);
  if (steps.length === 0) return <EmptyState title={t("phasesP4.step.none")} />;
  return (
    <div
      className="table-wrap"
      tabIndex={0}
      role="region"
      aria-label={t("phasesP4.tableRegion.steps", { phase: caption })}
    >
      <table className="table table--compact" data-phase-steps={steps.length}>
        <caption className="visually-hidden">{t("phasesP4.tableRegion.steps", { phase: caption })}</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">{t("phasesP4.step.procedure")}</th>
            <th scope="col">{t("phasesP4.step.requiredEvidence")}</th>
            <th scope="col">{t("phasesP4.step.owner")}</th>
            <th scope="col">{t("phasesP4.step.reviewer")}</th>
            <th scope="col">{t("phasesP4.step.rule")}</th>
            <th scope="col">{t("common.field.status")}</th>
            <th scope="col">{t("common.field.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {[...steps]
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((s) => (
              <tr key={s.stepKey} data-step={s.stepKey} data-version={s.version}>
                <td>{s.ordinal}</td>
                <th scope="row">{pick(locale, s.sourceProcedureEn, s.procedureAr)}</th>
                <td>{pick(locale, s.requiredEvidenceEn, s.requiredEvidenceAr)}</td>
                <td data-owner={s.ownerUserId ?? "unknown"}>
                  {s.ownerUserId ? (
                    <PersonName id={s.ownerUserId} people={byId} />
                  ) : (
                    <span className="status-chip status-chip--unknown">
                      <Icon name="question" /> {t("common.value.unknown")}
                    </span>
                  )}
                  <span className="block small muted">
                    {t("phasesP4.step.defaultRole", {
                      role: t(`transformations.audit.role.${s.defaultOwnerRoleCode}`, {
                        defaultValue: s.defaultOwnerRoleCode,
                      }),
                    })}
                  </span>
                </td>
                <td>{t(`transformations.audit.role.${s.reviewerRoleCode}`, { defaultValue: s.reviewerRoleCode })}</td>
                <td>{t(`phasesP4.rule.${s.completionRule}`)}</td>
                <td>
                  <StepStatus step={s} />
                  {s.completedAt ? (
                    <span className="block small muted">{formatDateTime(s.completedAt, locale, ws.tr.timezone)}</span>
                  ) : null}
                </td>
                <td>
                  <StepActions step={s} onAction={onAction} />
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function StepActions({ step, onAction }: { step: PhaseStep; onAction: (d: StepDialog) => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const isOwner = step.ownerUserId === ws.meId;
  const canManage = ws.can("phase_step.manage");
  const canProgress = ws.can("phase_step.progress");
  const canReview = ws.can("phase_step.review");
  const btn = (kind: "owner" | "start" | "request" | "evidence" | "review", label: string, icon: IconName) => (
    <button
      type="button"
      className="button button--link button--small"
      onClick={() => onAction({ kind, step })}
      data-action={`step-${kind}`}
    >
      <Icon name={icon} /> {label}
      <span className="visually-hidden"> {step.stepKey}</span>
    </button>
  );
  const open = step.status !== "complete";
  return (
    <span className="section__actions">
      {canManage && open && step.status !== "in_review" ? btn("owner", t("phasesP4.step.assign"), "pencil") : null}
      {canManage && step.status === "not_started" ? btn("start", t("phasesP4.step.start"), "check") : null}
      {btn("evidence", t("phasesP4.step.evidence"), "columns")}
      {canProgress && isOwner && (step.status === "in_progress" || step.status === "returned")
        ? btn("request", t("phasesP4.step.requestReview"), "clock")
        : null}
      {canReview && step.status === "in_review" && !isOwner && step.reviewRequestedBy !== ws.meId
        ? btn("review", t("phasesP4.step.review"), "check")
        : null}
      {canReview && step.status === "in_review" && isOwner ? (
        <span className="small muted" data-own-step="true">
          {t("phasesP4.step.ownerCannotReview")}
        </span>
      ) : null}
    </span>
  );
}

function StepDialogs({
  dialog,
  onClose,
  refresh,
}: {
  dialog: StepDialog;
  onClose: () => void;
  refresh: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { people } = usePeople(ws.tid);
  if (!dialog) return null;
  const s = dialog.step;
  switch (dialog.kind) {
    case "owner":
      return (
        <P4FormDialog
          title={t("phasesP4.step.assignTitle")}
          description={t("phasesP4.step.versionNote", { n: s.version })}
          fields={[
            {
              name: "ownerUserId",
              label: t("phasesP4.step.owner"),
              kind: "select",
              required: true,
              options: people.map((p) => ({ value: p.id, label: p.label })),
            },
          ]}
          initial={s.ownerUserId ? { ownerUserId: s.ownerUserId } : {}}
          submitLabel={t("phasesP4.save")}
          method="PATCH"
          url={phasePaths.step(ws.tid, s.stepKey)}
          version={s.version}
          namespaces={PHASE_NS}
          toBody={(v) => ({ ownerUserId: v["ownerUserId"] })}
          onDone={refresh}
          onClose={onClose}
        />
      );
    case "start":
      return (
        <P4FormDialog
          title={t("phasesP4.step.startTitle")}
          description={t("phasesP4.step.versionNote", { n: s.version })}
          fields={[]}
          submitLabel={t("phasesP4.step.start")}
          method="PATCH"
          url={phasePaths.step(ws.tid, s.stepKey)}
          version={s.version}
          namespaces={PHASE_NS}
          toBody={() => ({ start: true })}
          onDone={refresh}
          onClose={onClose}
        />
      );
    case "request":
      return (
        <ConfirmActionDialog
          title={t("phasesP4.step.requestTitle")}
          body={t("phasesP4.step.requestBody")}
          confirmLabel={t("phasesP4.step.requestReview")}
          url={phasePaths.requestReview(ws.tid, s.stepKey)}
          version={s.version}
          namespaces={PHASE_NS}
          onDone={refresh}
          onClose={onClose}
        />
      );
    case "review":
      return (
        <P4FormDialog
          title={t("phasesP4.step.reviewTitle")}
          description={t("phasesP4.step.reviewBody")}
          fields={[
            {
              name: "outcome",
              label: t("phasesP4.step.outcome"),
              kind: "select",
              required: true,
              options: [
                { value: "accepted", label: t("phasesP4.reviewOutcome.accepted") },
                { value: "returned", label: t("phasesP4.reviewOutcome.returned") },
              ],
            },
            {
              name: "note",
              label: t("phasesP4.step.note"),
              hint: t("phasesP4.step.noteHint"),
              kind: "textarea",
              max: 2000,
            },
          ]}
          submitLabel={t("phasesP4.step.recordReview")}
          url={phasePaths.review(ws.tid, s.stepKey)}
          version={s.version}
          namespaces={PHASE_NS}
          toBody={(v) => {
            const note = typeof v["note"] === "string" ? v["note"].trim() : "";
            if (v["outcome"] === "returned" && note === "")
              return { fieldErrors: { note: "phase_step.return_note_required" } };
            return { outcome: v["outcome"], ...(note ? { note } : {}) };
          }}
          onDone={refresh}
          onClose={onClose}
        />
      );
    case "evidence":
      return <EvidenceDialog step={s} onClose={onClose} refresh={refresh} />;
  }
}

function EvidenceDialog({
  step,
  onClose,
  refresh,
}: {
  step: PhaseStep;
  onClose: () => void;
  refresh: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const links = useStepEvidence(ws.tid, step.stepKey, step.id !== null);
  const register = useRegister<Evidence>(ws.tid, "evidence");
  const [linking, setLinking] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; version: number } | null>(null);
  const isOwner = step.ownerUserId === ws.meId;
  const canEdit = ws.can("phase_step.progress") && isOwner && step.status !== "complete";
  const byId = new Map((register.data ?? []).map((e) => [e.id, e]));
  const active = (links.data ?? []).filter((l) => l.status === "active");
  return (
    <Dialog
      title={t("phasesP4.evidence.title")}
      onClose={onClose}
      footer={
        <button type="button" className="button button--secondary" onClick={onClose}>
          {t("common.action.close", { defaultValue: t("common.action.cancel") })}
        </button>
      }
    >
      <p className="dialog__description">{t("phasesP4.evidence.intro")}</p>
      {step.id === null ? (
        <p className="small muted" data-evidence="no-row">
          {t("phasesP4.evidence.noRow")}
        </p>
      ) : (
        <QueryState
          query={links}
          isEmpty={() => active.length === 0}
          empty={<p className="small muted">{t("phasesP4.evidence.empty")}</p>}
        >
          {() => (
            <ul className="plain-list" data-step-evidence={active.length}>
              {active.map((l) => {
                const e = byId.get(l.evidenceId);
                return (
                  <li key={l.id} data-evidence-link={l.evidenceId}>
                    <Icon name={e?.reviewStatus === "verified" ? "check" : "question"} />{" "}
                    <bdi>{e ? e.title : t("phasesP4.evidence.notVisible")}</bdi>{" "}
                    <span className="small muted">
                      {e ? t(`phasesP4.evidence.review.${e.reviewStatus}`) : t("common.value.unknown")}
                    </span>
                    {canEdit ? (
                      <button
                        type="button"
                        className="button button--link button--small"
                        onClick={() => setRemoving({ id: l.id, version: l.version })}
                        data-action="remove-step-evidence"
                      >
                        <Icon name="cross" /> {t("phasesP4.evidence.remove")}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
      )}
      {canEdit ? (
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => setLinking(true)}
          data-action="link-step-evidence"
        >
          <Icon name="plus" /> {t("phasesP4.evidence.link")}
        </button>
      ) : !isOwner ? (
        <p className="small muted">{t("phasesP4.evidence.ownerOnly")}</p>
      ) : null}
      {linking ? (
        <P4FormDialog
          title={t("phasesP4.evidence.link")}
          description={t("phasesP4.evidence.linkIntro")}
          fields={[
            {
              name: "evidenceId",
              label: t("phasesP4.evidence.item"),
              kind: "select",
              required: true,
              options: (register.data ?? []).map((e) => ({
                value: e.id,
                label: `${e.title} (${t(`phasesP4.evidence.review.${e.reviewStatus}`)})`,
              })),
            },
          ]}
          submitLabel={t("phasesP4.evidence.link")}
          url={phasePaths.evidence(ws.tid, step.stepKey)}
          namespaces={PHASE_NS}
          toBody={(v) => ({ evidenceId: v["evidenceId"] })}
          onDone={refresh}
          onClose={() => setLinking(false)}
        />
      ) : null}
      {removing ? (
        <ConfirmActionDialog
          title={t("phasesP4.evidence.remove")}
          body={t("phasesP4.evidence.removeBody")}
          confirmLabel={t("phasesP4.evidence.remove")}
          url={phasePaths.removeEvidence(ws.tid, step.stepKey, removing.id)}
          version={removing.version}
          danger
          namespaces={PHASE_NS}
          onDone={refresh}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ review queue

function ReviewQueueSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const queue = useReviewQueue(ws.tid);
  const refresh = useP4Refresh(ws.tid);
  const [dialog, setDialog] = useState<StepDialog>(null);
  return (
    <Section id="review-queue" title={t("phasesP4.queue.title")} intro={t("phasesP4.queue.intro")}>
      <QueryState
        query={queue}
        isEmpty={(l) => l.length === 0}
        empty={<EmptyState title={t("phasesP4.queue.empty")} />}
      >
        {(rows) => (
          <ul className="plain-list" data-review-queue={rows.length}>
            {rows.map((s) => (
              <li key={s.stepKey} data-queue-step={s.stepKey}>
                <Icon name="clock" /> <strong>{pick(locale, s.sourceProcedureEn, s.procedureAr)}</strong>{" "}
                <span className="small muted">
                  {t(`transformations.phase.${s.phase}`)} ·{" "}
                  {s.reviewRequestedAt
                    ? formatDateTime(s.reviewRequestedAt, locale, ws.tr.timezone)
                    : t("common.value.unknown")}
                </span>{" "}
                <StepActions step={s} onAction={setDialog} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <StepDialogs dialog={dialog} onClose={() => setDialog(null)} refresh={refresh} />
    </Section>
  );
}
