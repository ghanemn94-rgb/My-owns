// Governance > Decision rights (T11) of a transformation (T-DG4-FE-A; ADR-0026 §5, §7; REQ-PB-065, REQ-PB-066,
// REQ-S10-007 display side). SYNTHETIC data only in tests and demos.
//  - The four rows of B0099 are seeded per transformation from the template (labels verbatim; Arabic beside them);
//    edits change only this transformation, never the template or another transformation.
//  - SLA types: a number of working days (the business calendar skips weekends and holidays); the next Executive
//    SteerCo or an urgent route (a configured number of working days, with a reason); or the linked milestone's
//    approved date. A date that cannot be known is Unknown with its reason, never guessed.
//  - Edits by decision_right.configure holders (TL, TO); the matrix goes to a BUSINESS APPROVAL (submit) and is frozen
//    while it waits (422 governance_matrix.in_approval, translated).
//  - "Request a business approval" routes a decision through a T11 row to the role's mapped person or group; an
//    unmapped role is a visible routing error (422 routing.role_unmapped), never a silent fallback.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { partyCode as partyCodeSchema } from "@mth/shared/schemas";
import {
  p4Paths,
  useDecisionRightDueDate,
  useDecisionRights,
  useGovernanceMatrices,
  useGovernanceParties,
  useP4Refresh,
  type DecisionRight,
  type GovernanceMatrix,
  type GovernanceParty,
} from "../../api/p4.ts";
import { useDecisions } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { BusinessApprovalNote, DueDate, P4FormDialog, textOf, type P4Values } from "../my-work/p4ui.tsx";

const NS = ["decisionRights"] as const;
export const SLA_TYPES = ["working_days", "next_steerco_or_urgent", "release_plan"] as const;

export function DecisionRightsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="decision-rights"
      title={t("decisionRights.title")}
      subtitle={t("decisionRights.intro")}
      writePermissions={["decision_right.configure", "approval.request"]}
    >
      <DecisionRightsBody />
    </WorkspaceFrame>
  );
}

/** Parses "SP, BO FIN" into ["SP","BO","FIN"]; returns null when a code is not a party code. */
export function parsePartyList(text: string): string[] | null {
  const codes = text
    .split(/[\s,،;]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  if (codes.some((c) => !partyCodeSchema.safeParse(c).success)) return null;
  return [...new Set(codes)];
}

/** "Sponsor (SP), Business Owner (BO)" for a list of party codes. */
export function PartyList({
  codes,
  parties,
}: {
  codes: readonly string[];
  parties: ReadonlyMap<string, GovernanceParty>;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (codes.length === 0) return <span className="muted">{t("common.value.none")}</span>;
  return (
    <span className="p4-chips">
      {codes.map((c) => {
        const p = parties.get(c);
        return (
          <span key={c} className="lifecycle-chip" data-party={c}>
            {p ? (locale === "ar" ? p.labelAr : p.labelEn) : c}{" "}
            <bdi dir="ltr" className="small">
              {c}
            </bdi>
          </span>
        );
      })}
    </span>
  );
}

/** The matrix status card: draft / in approval / approved, with the submit action (S-7: "business approval"). */
export function MatrixStatus({
  matrix,
  canSubmit,
  onSubmit,
}: {
  matrix: GovernanceMatrix | undefined;
  canSubmit: boolean;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (!matrix) return null;
  return (
    <section
      className="card"
      aria-labelledby={`matrix-${matrix.kind}`}
      data-matrix={matrix.kind}
      data-matrix-status={matrix.status}
    >
      <h2 id={`matrix-${matrix.kind}`} className="card__title">
        {t("decisionRights.matrix.title")}{" "}
        <span className={`lifecycle-chip${matrix.status === "approved" ? "" : " lifecycle-chip--draft"}`}>
          <Icon name={matrix.status === "approved" ? "check" : matrix.status === "in_approval" ? "clock" : "pencil"} />{" "}
          {t(`decisionRights.matrix.status.${matrix.status}`)}
        </span>
      </h2>
      <p className="small">
        {matrix.approvedVersion !== null
          ? t("decisionRights.matrix.approvedVersion", {
              version: matrix.approvedVersion,
              when: matrix.approvedAt ? formatDateTime(matrix.approvedAt, locale) : t("common.value.unknown"),
            })
          : t("decisionRights.matrix.neverApproved")}
      </p>
      {matrix.status === "in_approval" ? (
        <p className="small">
          {t("decisionRights.matrix.frozen")}{" "}
          {matrix.openApprovalId ? (
            <Link className="link" to={`/my-work/approvals/${matrix.openApprovalId}`}>
              {t("decisionRights.matrix.openApproval")}
            </Link>
          ) : null}
        </p>
      ) : null}
      {canSubmit && matrix.status === "draft" ? (
        <div className="form__actions">
          <button type="button" className="button button--primary" data-action="submit-matrix" onClick={onSubmit}>
            <Icon name="lock" /> {t("decisionRights.matrix.submit")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function DecisionRightsBody() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const rows = useDecisionRights(ws.tid);
  const matrices = useGovernanceMatrices(ws.tid);
  const parties = useGovernanceParties();
  const refresh = useP4Refresh(ws.tid);
  const partyMap = new Map((parties.data ?? []).map((p) => [p.code, p]));
  const matrix = (matrices.data ?? []).find((m) => m.kind === "decision_rights");
  const canConfigure = ws.can("decision_right.configure");
  const frozen = matrix?.status === "in_approval";
  const [dialog, setDialog] = useState<"add" | "submit" | "request" | DecisionRight | null>(null);
  const [preview, setPreview] = useState<DecisionRight | null>(null);

  const columns: RegisterColumn<DecisionRight>[] = [
    {
      id: "decision",
      header: t("decisionRights.field.decision"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <span className="block" data-decision-right={r.templateKey ?? r.id}>
          {locale === "ar" ? r.decisionAr : r.decisionEn}
          {r.templateKey ? <span className="block small muted">{t("decisionRights.fromTemplate")}</span> : null}
        </span>
      ),
      sortValue: (r) => r.ordinal,
      filterText: (r) => `${r.decisionEn} ${r.decisionAr}`,
    },
    {
      id: "recommend",
      header: t("decisionRights.field.recommend"),
      cell: (r) => (
        <span className="block">
          <TextCell value={r.recommendLabel} />
          <PartyList codes={r.recommendParties} parties={partyMap} />
        </span>
      ),
    },
    {
      id: "approve",
      header: t("decisionRights.field.approve"),
      cell: (r) => (
        <span className="block">
          <TextCell value={r.approveLabel} />
          <PartyList codes={[r.approvePartyCode]} parties={partyMap} />
        </span>
      ),
    },
    {
      id: "consult",
      header: t("decisionRights.field.consult"),
      cell: (r) => (
        <span className="block">
          <TextCell value={r.consultLabel} />
          <PartyList codes={r.consultParties} parties={partyMap} />
        </span>
      ),
    },
    {
      id: "inform",
      header: t("decisionRights.field.inform"),
      cell: (r) => (
        <span className="block">
          <TextCell value={r.informLabel} />
          <PartyList codes={r.informParties} parties={partyMap} />
        </span>
      ),
    },
    {
      id: "sla",
      header: t("decisionRights.field.sla"),
      cell: (r) => (
        <span className="block" data-sla-type={r.slaType}>
          <TextCell value={r.slaLabel} />
          <span className="block small">
            {t(`decisionRights.slaType.${r.slaType}`)}
            {r.slaWorkingDays !== null ? ` · ${t("decisionRights.workingDays", { count: r.slaWorkingDays })}` : ""}
            {r.urgentWorkingDays !== null ? ` · ${t("decisionRights.urgentDays", { count: r.urgentWorkingDays })}` : ""}
          </span>
        </span>
      ),
    },
    {
      id: "escalation",
      header: t("decisionRights.field.escalation"),
      cell: (r) => <PartyList codes={r.escalationChain} parties={partyMap} />,
    },
    {
      id: "status",
      header: t("decisionRights.field.status"),
      cell: (r) => t(`decisionRights.status.${r.status}`),
      sortValue: (r) => r.status,
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (r) => (
        <span className="p4-chips">
          <button
            type="button"
            className="button button--link button--small"
            data-action="preview-due"
            onClick={() => setPreview(r)}
          >
            <Icon name="clock" /> {t("decisionRights.preview.action")}
            <span className="visually-hidden">: {locale === "ar" ? r.decisionAr : r.decisionEn}</span>
          </button>
          {canConfigure && !frozen ? (
            <button
              type="button"
              className="button button--link button--small"
              data-action="edit-row"
              onClick={() => setDialog(r)}
            >
              <Icon name="pencil" /> {t("common.action.edit")}
              <span className="visually-hidden">: {locale === "ar" ? r.decisionAr : r.decisionEn}</span>
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <MatrixStatus matrix={matrix} canSubmit={canConfigure} onSubmit={() => setDialog("submit")} />
      <Section
        id="decision-rights"
        title={t("decisionRights.listTitle")}
        intro={t("decisionRights.listIntro")}
        actions={
          <span className="p4-chips">
            {ws.can("approval.request") ? (
              <button
                type="button"
                className="button button--secondary button--small"
                data-action="request-approval"
                onClick={() => setDialog("request")}
              >
                <Icon name="lock" /> {t("decisionRights.request.action")}
              </button>
            ) : null}
            {canConfigure && !frozen ? (
              <button type="button" className="button button--primary button--small" onClick={() => setDialog("add")}>
                <Icon name="plus" /> {t("decisionRights.add.action")}
              </button>
            ) : null}
          </span>
        }
      >
        <QueryState query={rows}>
          {(list) => (
            <RegisterTable
              id="p4-decision-rights"
              caption={t("decisionRights.listTitle")}
              rows={list}
              columns={columns}
              getRowId={(r) => r.id}
              emptyTitle={t("decisionRights.empty")}
              defaultSort={{ id: "decision", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
      {preview ? <DueDatePreview row={preview} onClose={() => setPreview(null)} /> : null}
      {dialog === "add" || (dialog && typeof dialog === "object") ? (
        <RowDialog
          row={dialog === "add" ? null : (dialog as DecisionRight)}
          parties={parties.data ?? []}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "submit" && matrix ? (
        <SubmitMatrixDialog matrix={matrix} onDone={refresh} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "request" ? (
        <RequestApprovalDialog
          rows={(rows.data ?? []).filter((r) => r.status === "active")}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ dialogs

export function SubmitMatrixDialog({
  matrix,
  onDone,
  onClose,
}: {
  matrix: GovernanceMatrix;
  onDone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  return (
    <P4FormDialog
      title={t(`decisionRights.matrix.submitTitle.${matrix.kind}`)}
      note={<BusinessApprovalNote body={t("decisionRights.matrix.submitNote")} />}
      fields={[
        { name: "title", label: t("decisionRights.request.title"), kind: "text", required: true, max: 300 },
        { name: "requestNote", label: t("decisionRights.request.note"), kind: "textarea", max: 4000 },
      ]}
      initial={{ title: t(`decisionRights.matrix.defaultTitle.${matrix.kind}`, { code: ws.tr.code }) }}
      submitLabel={t("decisionRights.matrix.submit")}
      url={p4Paths.submitMatrix(ws.tid, matrix.kind)}
      version={matrix.version}
      toBody={(v) => {
        const note = textOf(v["requestNote"]);
        return { title: textOf(v["title"]), ...(note ? { requestNote: note } : {}) };
      }}
      namespaces={NS}
      onDone={onDone}
      onClose={onClose}
    />
  );
}

function RowDialog({
  row,
  parties,
  onDone,
  onClose,
}: {
  row: DecisionRight | null;
  parties: readonly GovernanceParty[];
  onDone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const partyOptions = parties.map((p) => ({
    value: p.code,
    label: `${locale === "ar" ? p.labelAr : p.labelEn} (${p.code})`,
  }));
  const listHint = t("decisionRights.edit.partyListHint");
  const initial: P4Values = row
    ? {
        decisionEn: row.decisionEn,
        decisionAr: row.decisionAr,
        recommendLabel: row.recommendLabel,
        approveLabel: row.approveLabel,
        consultLabel: row.consultLabel,
        informLabel: row.informLabel,
        slaLabel: row.slaLabel,
        recommendParties: row.recommendParties.join(", "),
        approvePartyCode: row.approvePartyCode,
        consultParties: row.consultParties.join(", "),
        informParties: row.informParties.join(", "),
        slaType: row.slaType,
        slaWorkingDays: row.slaWorkingDays === null ? "" : String(row.slaWorkingDays),
        urgentWorkingDays: row.urgentWorkingDays === null ? "" : String(row.urgentWorkingDays),
        escalationChain: row.escalationChain.join(", "),
        status: row.status,
      }
    : { slaType: "working_days", escalationChain: "SP" };
  return (
    <P4FormDialog
      title={row ? t("decisionRights.edit.title") : t("decisionRights.add.title")}
      description={<p>{t("decisionRights.edit.description")}</p>}
      fields={[
        { name: "decisionEn", label: t("decisionRights.field.decisionEn"), kind: "text", required: true, max: 300 },
        { name: "decisionAr", label: t("decisionRights.field.decisionAr"), kind: "text", required: true, max: 300 },
        { name: "recommendLabel", label: t("decisionRights.field.recommend"), kind: "text", required: true, max: 300 },
        {
          name: "recommendParties",
          label: t("decisionRights.edit.recommendParties"),
          kind: "text",
          ltr: true,
          hint: listHint,
          max: 200,
        },
        { name: "approveLabel", label: t("decisionRights.field.approve"), kind: "text", required: true, max: 300 },
        {
          name: "approvePartyCode",
          label: t("decisionRights.edit.approveParty"),
          kind: "select",
          required: true,
          options: partyOptions,
          hint: t("decisionRights.edit.approvePartyHint"),
        },
        { name: "consultLabel", label: t("decisionRights.field.consult"), kind: "text", required: true, max: 300 },
        {
          name: "consultParties",
          label: t("decisionRights.edit.consultParties"),
          kind: "text",
          ltr: true,
          hint: listHint,
          max: 200,
        },
        { name: "informLabel", label: t("decisionRights.field.inform"), kind: "text", required: true, max: 300 },
        {
          name: "informParties",
          label: t("decisionRights.edit.informParties"),
          kind: "text",
          ltr: true,
          hint: listHint,
          max: 200,
        },
        { name: "slaLabel", label: t("decisionRights.field.sla"), kind: "text", required: true, max: 300 },
        {
          name: "slaType",
          label: t("decisionRights.edit.slaType"),
          kind: "select",
          required: true,
          options: SLA_TYPES.map((s) => ({ value: s, label: t(`decisionRights.slaType.${s}`) })),
        },
        {
          name: "slaWorkingDays",
          label: t("decisionRights.edit.slaWorkingDays"),
          kind: "number",
          required: true,
          min: 1,
          max: 250,
          when: (v) => v["slaType"] === "working_days",
        },
        {
          name: "urgentWorkingDays",
          label: t("decisionRights.edit.urgentWorkingDays"),
          kind: "number",
          min: 1,
          max: 250,
          hint: t("decisionRights.edit.urgentHint"),
          when: (v) => v["slaType"] === "next_steerco_or_urgent",
        },
        {
          name: "escalationChain",
          label: t("decisionRights.field.escalation"),
          kind: "text",
          required: true,
          ltr: true,
          hint: t("decisionRights.edit.escalationHint"),
          max: 200,
        },
        ...(row
          ? [
              {
                name: "status",
                label: t("decisionRights.field.status"),
                kind: "select" as const,
                required: true,
                options: ["active", "retired"].map((s) => ({ value: s, label: t(`decisionRights.status.${s}`) })),
              },
            ]
          : []),
      ]}
      initial={initial}
      submitLabel={t("common.action.save")}
      method={row ? "PATCH" : "POST"}
      url={row ? p4Paths.decisionRight(ws.tid, row.id) : p4Paths.decisionRights(ws.tid)}
      {...(row ? { version: row.version } : {})}
      toBody={(v) => {
        const errors: Record<string, string> = {};
        const lists: Record<string, string[]> = {};
        for (const name of ["recommendParties", "consultParties", "informParties", "escalationChain"]) {
          const parsed = parsePartyList(String(v[name] ?? ""));
          if (parsed === null) errors[name] = "validation.party_code";
          else lists[name] = parsed;
        }
        if (lists["escalationChain"]?.length === 0) errors["escalationChain"] = "validation.required";
        const intOf = (name: string): number | undefined => {
          const s = String(v[name] ?? "");
          if (s === "") return undefined;
          const n = Number(s);
          if (!Number.isInteger(n) || n < 1 || n > 250) errors[name] = "decision_right.sla_invalid";
          return n;
        };
        const slaType = String(v["slaType"]);
        const slaWorkingDays = slaType === "working_days" ? intOf("slaWorkingDays") : undefined;
        const urgentWorkingDays = slaType === "next_steerco_or_urgent" ? intOf("urgentWorkingDays") : undefined;
        if (Object.keys(errors).length > 0) return { fieldErrors: errors };
        const body: Record<string, unknown> = {
          decisionEn: textOf(v["decisionEn"]),
          decisionAr: textOf(v["decisionAr"]),
          recommendLabel: textOf(v["recommendLabel"]),
          approveLabel: textOf(v["approveLabel"]),
          consultLabel: textOf(v["consultLabel"]),
          informLabel: textOf(v["informLabel"]),
          slaLabel: textOf(v["slaLabel"]),
          recommendParties: lists["recommendParties"],
          approvePartyCode: v["approvePartyCode"],
          consultParties: lists["consultParties"],
          informParties: lists["informParties"],
          slaType,
          escalationChain: lists["escalationChain"],
        };
        if (row) {
          body["slaWorkingDays"] = slaWorkingDays ?? null;
          body["urgentWorkingDays"] = urgentWorkingDays ?? null;
          if (v["status"] !== row.status) body["status"] = v["status"];
        } else {
          if (slaWorkingDays !== undefined) body["slaWorkingDays"] = slaWorkingDays;
          if (urgentWorkingDays !== undefined) body["urgentWorkingDays"] = urgentWorkingDays;
        }
        return body;
      }}
      namespaces={NS}
      onDone={onDone}
      onClose={onClose}
    />
  );
}

function DueDatePreview({ row, onClose }: { row: DecisionRight; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const [raisedOn, setRaisedOn] = useState("");
  const [urgent, setUrgent] = useState(false);
  const result = useDecisionRightDueDate(ws.tid, row.id, raisedOn, urgent);
  return (
    <section className="card" aria-labelledby="due-preview" data-state="due-preview">
      <h2 id="due-preview" className="card__title">
        {t("decisionRights.preview.title", { decision: locale === "ar" ? row.decisionAr : row.decisionEn })}
      </h2>
      <p className="small">{t("decisionRights.preview.intro")}</p>
      <div className="grid grid--2">
        <Field label={t("decisionRights.preview.raisedOn")}>
          {(control) => (
            <input {...control} type="date" value={raisedOn} onChange={(e) => setRaisedOn(e.target.value)} />
          )}
        </Field>
        {row.slaType === "next_steerco_or_urgent" ? (
          <label className="checkbox">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
            {t("decisionRights.preview.urgent")}
          </label>
        ) : null}
      </div>
      {raisedOn ? (
        <QueryState query={result}>
          {(r) => (
            <p role="status" data-due={r.dueDate ?? "unknown"}>
              <strong>{t("decisionRights.preview.due")}:</strong> <DueDate date={r.dueDate} reason={r.unknownReason} />
            </p>
          )}
        </QueryState>
      ) : null}
      <div className="form__actions">
        <button type="button" className="button button--secondary" onClick={onClose}>
          {t("common.action.close")}
        </button>
      </div>
    </section>
  );
}

function RequestApprovalDialog({
  rows,
  onDone,
  onClose,
}: {
  rows: readonly DecisionRight[];
  onDone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const design = useDecisions(ws.tid, "design");
  const decisions = design.data ?? [];
  return (
    <P4FormDialog
      title={t("decisionRights.request.dialogTitle")}
      note={<BusinessApprovalNote body={t("decisionRights.request.note2")} />}
      description={<p>{t("decisionRights.request.description")}</p>}
      fields={[
        {
          name: "decisionRightId",
          label: t("decisionRights.field.decision"),
          kind: "select",
          required: true,
          options: rows.map((r) => ({ value: r.id, label: locale === "ar" ? r.decisionAr : r.decisionEn })),
        },
        {
          name: "subjectId",
          label: t("decisionRights.request.subject"),
          kind: "select",
          required: true,
          hint: t("decisionRights.request.subjectHint"),
          options: decisions.map((d) => ({ value: d.id, label: `${d.code} ${d.title}` })),
        },
        { name: "title", label: t("decisionRights.request.title"), kind: "text", required: true, max: 300 },
        { name: "requestNote", label: t("decisionRights.request.note"), kind: "textarea", max: 4000 },
        { name: "urgent", label: t("decisionRights.request.urgent"), kind: "checkbox" },
        {
          name: "urgentReason",
          label: t("decisionRights.request.urgentReason"),
          kind: "textarea",
          required: true,
          max: 2000,
          when: (v) => v["urgent"] === true,
        },
      ]}
      submitLabel={t("decisionRights.request.submit")}
      url={p4Paths.requestApproval(ws.tid)}
      toBody={(v) => {
        const subject = decisions.find((d) => d.id === v["subjectId"]);
        if (!subject) return { fieldErrors: { subjectId: "validation.required" } };
        const note = textOf(v["requestNote"]);
        const urgent = v["urgent"] === true;
        const reason = urgent ? textOf(v["urgentReason"]) : undefined;
        return {
          approvalType: "decision_request",
          subjectId: subject.id,
          subjectVersion: subject.version,
          decisionRightId: v["decisionRightId"],
          title: textOf(v["title"]),
          ...(note ? { requestNote: note } : {}),
          urgent,
          ...(reason ? { urgentReason: reason } : {}),
        };
      }}
      namespaces={NS}
      onDone={onDone}
      onClose={onClose}
    />
  );
}
