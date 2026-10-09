// Business approval decision records of a transformation (T-DG4-FE-A; ADR-0026 §3/§4; REQ-S10-010 "an approval by B
// shows 'B on behalf of A' in audit"; Q10 read-only union of P4 approvals, gate decisions and funding decisions).
// Read-only for everyone who can read the transformation (AUD included). Nothing here decides anything.
import { useTranslation } from "react-i18next";
import { useApprovalDecisionRecords, type ApprovalDecisionRecord } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { BusinessApprovalNote, useUserNames } from "../my-work/p4ui.tsx";

export function ApprovalRecordsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="approval-decisions"
      title={t("approvals.records.title")}
      subtitle={t("approvals.records.intro")}
      writePermissions={[]}
    >
      <BusinessApprovalNote body={t("approvals.records.businessApprovalBody")} />
      <Records />
    </WorkspaceFrame>
  );
}

/** "B on behalf of A" when the decision was made under a delegation; otherwise the decider's name. */
export function DeciderText({
  decidedBy,
  onBehalfOf,
  nameOf,
}: {
  decidedBy: string;
  onBehalfOf: string | null;
  nameOf: (id: string) => string;
}) {
  const { t } = useTranslation();
  return (
    <span data-on-behalf={onBehalfOf ? "true" : "false"}>
      {onBehalfOf
        ? t("approvals.onBehalf", { actor: nameOf(decidedBy), principal: nameOf(onBehalfOf) })
        : nameOf(decidedBy)}
    </span>
  );
}

function Records() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const list = useApprovalDecisionRecords(ws.tid);
  const nameOf = useUserNames((list.data ?? []).flatMap((r) => [r.decidedBy, r.onBehalfOfUserId]));
  const columns: RegisterColumn<ApprovalDecisionRecord>[] = [
    {
      id: "kind",
      header: t("approvals.records.kind"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <span className="block">
          {t(`approvals.records.source.${r.source}`)}
          <span className="block small muted">
            {t(`approvals.type.${r.approvalKind}`, { defaultValue: r.approvalKind.replace(/_/g, " ") })}
          </span>
        </span>
      ),
      sortValue: (r) => r.source,
    },
    {
      id: "outcome",
      header: t("approvals.history.outcome"),
      cell: (r) => (
        <span className="lifecycle-chip" data-outcome={r.outcome}>
          {t(`approvals.records.outcome.${r.outcome}`)}
        </span>
      ),
      sortValue: (r) => r.outcome,
    },
    {
      id: "by",
      header: t("approvals.history.by"),
      cell: (r) => <DeciderText decidedBy={r.decidedBy} onBehalfOf={r.onBehalfOfUserId} nameOf={nameOf} />,
      filterText: (r) => nameOf(r.decidedBy),
    },
    {
      id: "rationale",
      header: t("approvals.history.rationale"),
      cell: (r) => <TextCell value={r.rationale} />,
      filterText: (r) => r.rationale,
    },
    {
      id: "version",
      header: t("approvals.field.subjectVersion"),
      cell: (r) =>
        r.subjectVersion === null ? (
          <span className="muted">{t("common.value.none")}</span>
        ) : (
          t("approvals.versionValue", { version: r.subjectVersion })
        ),
      sortValue: (r) => r.subjectVersion,
    },
    {
      id: "when",
      header: t("approvals.history.when"),
      cell: (r) => formatDateTime(r.decidedAt, locale, ws.tr.timezone),
      sortValue: (r) => r.decidedAt,
    },
  ];
  return (
    <Section id="approval-records" title={t("approvals.records.listTitle")}>
      <QueryState query={list}>
        {(rows) => (
          <RegisterTable
            id="p4-approval-records"
            caption={t("approvals.records.listTitle")}
            rows={rows}
            columns={columns}
            getRowId={(r) => `${r.source}:${r.recordId}`}
            emptyTitle={t("approvals.records.empty")}
            defaultSort={{ id: "when", dir: "desc" }}
          />
        )}
      </QueryState>
    </Section>
  );
}
