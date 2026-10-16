// A transformation's gate conditions (T-DG5-FE-D; REQ-S04-011; ADR-0044 §3): each condition of a conditional business
// approval with its owner, deadline and status (Open, Overdue, Closed), tracked to closure. Only the condition's owner
// closes it (note, optional evidence; 403 gate_condition.not_owner for anyone else); an overdue condition is escalated
// once to the approver by the daily scan. The conditional decision itself is taken on the DG4 gate decision screen;
// a condition never authorizes scaling beyond the approval's permitted scope.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { Evidence } from "../../api/types.ts";
import { useRegister } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { useMe } from "../../auth/session.tsx";
import { Field } from "../../components/Form.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { BusinessApprovalNote, DueDate, useUserNames } from "../my-work/p4ui.tsx";
import { fedPaths, useFedRefresh, useGateConditions, type TrackedGateCondition } from "../automation/api.ts";
import { StatusChip, useRunner } from "../automation/ui.tsx";

export const CONDITION_STATUS_CHIP = {
  open: ["warn", "dot"],
  overdue: ["bad", "alert"],
  closed: ["good", "check"],
} as const;

export function GateConditionsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const { id = "" } = useParams();
  usePageTitle(t("workflowsP5.conditions.title"));
  const [status, setStatus] = useState("");
  const conditions = useGateConditions(id, status ? { status } : {});
  const names = useUserNames((conditions.data ?? []).flatMap((c) => [c.ownerUserId, c.closedBy, c.escalatedToUserId]));
  const [closing, setClosing] = useState<TrackedGateCondition | null>(null);
  const columns: RegisterColumn<TrackedGateCondition>[] = [
    {
      id: "condition",
      header: t("workflowsP5.conditions.condition"),
      rowHeader: true,
      hideable: false,
      cell: (c) => (
        <span className="block">
          {c.conditionText}
          <span className="block small muted">
            <bdi dir="ltr">
              {c.gateCode} · {c.ordinal}
            </bdi>
          </span>
        </span>
      ),
      sortValue: (c) => `${c.gateCode}-${String(c.ordinal).padStart(3, "0")}`,
      filterText: (c) => `${c.conditionText} ${c.gateCode}`,
    },
    { id: "owner", header: t("workflowsP5.conditions.owner"), cell: (c) => names(c.ownerUserId) },
    {
      id: "due",
      header: t("workflowsP5.conditions.deadline"),
      cell: (c) => <DueDate date={c.dueDate} />,
      sortValue: (c) => c.dueDate,
    },
    {
      id: "status",
      header: t("workflowsP5.field.status"),
      cell: (c) => <StatusChip value={c.status} table={CONDITION_STATUS_CHIP} labelKey="workflowsP5.conditionStatus" />,
      sortValue: (c) => c.status,
    },
    {
      id: "escalated",
      header: t("workflowsP5.conditions.escalated"),
      cell: (c) =>
        c.escalatedAt
          ? `${formatDateTime(c.escalatedAt, locale)} · ${names(c.escalatedToUserId)}`
          : t("workflowsP5.conditions.notEscalated"),
    },
    {
      id: "closure",
      header: t("workflowsP5.conditions.closure"),
      cell: (c) =>
        c.closedAt ? (
          <span className="block">
            {formatDateTime(c.closedAt, locale)} · {names(c.closedBy)}
            {c.closureNote ? <span className="block small">{c.closureNote}</span> : null}
          </span>
        ) : c.ownerUserId === me.user.id ? (
          <button
            type="button"
            className="button button--secondary button--small"
            data-action="close-condition"
            onClick={() => setClosing(c)}
          >
            {t("workflowsP5.conditions.close")}
            <span className="visually-hidden">: {c.conditionText}</span>
          </button>
        ) : (
          "—"
        ),
    },
  ];
  return (
    <div className="page" data-p5-screen="gate-conditions">
      <PageHeader
        title={t("workflowsP5.conditions.title")}
        subtitle={t("workflowsP5.conditions.intro")}
        crumbs={[
          { label: t("workflowsP5.field.transformation"), to: `/transformations/${id}` },
          { label: t("workflowsP5.conditions.gates"), to: `/transformations/${id}/gates` },
          { label: t("workflowsP5.conditions.title") },
        ]}
      />
      <BusinessApprovalNote body={t("workflowsP5.conditions.note")} />
      <p className="small">
        <Link className="link" to={`/transformations/${id}/gates/G5`}>
          {t("workflowsP5.conditions.openGate")}
        </Link>
      </p>
      {closing ? <CloseCondition tid={id} condition={closing} onClose={() => setClosing(null)} /> : null}
      <Section
        id="conditions"
        title={t("workflowsP5.conditions.listTitle")}
        actions={
          <label className="filters__select">
            <span>{t("workflowsP5.field.status")}</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("workflowsP5.all")}</option>
              {(["open", "overdue", "closed"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`workflowsP5.conditionStatus.${s}`)}
                </option>
              ))}
            </select>
          </label>
        }
      >
        <QueryState query={conditions}>
          {(rows) => (
            <RegisterTable
              id="p5-gate-conditions"
              caption={t("workflowsP5.conditions.listTitle")}
              rows={rows}
              columns={columns}
              getRowId={(c) => c.id}
              emptyTitle={t("workflowsP5.conditions.empty")}
              defaultSort={{ id: "due", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
    </div>
  );
}

function CloseCondition({
  tid,
  condition: c,
  onClose,
}: {
  tid: string;
  condition: TrackedGateCondition;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const refresh = useFedRefresh();
  const runner = useRunner(refresh);
  const evidence = useRegister<Evidence>(tid, "evidence");
  const [note, setNote] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <Section id="close-condition" title={t("workflowsP5.conditions.closeTitle")} intro={c.conditionText}>
      <form
        className="form form--inset"
        noValidate
        data-form="close-condition"
        onSubmit={(e) => {
          e.preventDefault();
          const n = note.trim();
          if (n.length < 3 || n.length > 2000) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          // A close is a create (201): no If-Match (OpenAPI closeGateCondition).
          void runner
            .run(fedPaths.closeGateCondition(tid, c.id), { body: { note: n, ...(evidenceId ? { evidenceId } : {}) } })
            .then((r) => r && onClose());
        }}
      >
        {runner.alert}
        <Field
          label={t("workflowsP5.field.note")}
          required
          error={invalid ? t("workflowsP5.textLength", { min: 3, max: 2000 }) : undefined}
        >
          {(p) => <textarea {...p} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <Field label={t("workflowsP5.procedures.evidence")}>
          {(p) => (
            <select {...p} value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)}>
              <option value="">{t("workflowsP5.none")}</option>
              {(evidence.data ?? []).map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="form__actions">
          <button type="submit" className="button button--primary" disabled={runner.busy}>
            {t("workflowsP5.conditions.close")}
          </button>
          <button type="button" className="button button--link" onClick={onClose}>
            {t("workflowsP5.close")}
          </button>
        </div>
      </form>
    </Section>
  );
}
