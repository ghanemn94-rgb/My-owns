// Transformations > Change requests > one request (T-DG4-FE-F2; ADR-0036 §1-§5, §10; ADR-0026 amendment E1-E6, BE-R2).
// SYNTHETIC data only in tests and demos.
//  - The proposed change field by field (current value "Unknown" when the record holds none, never 0), the reason, the
//    materiality and its basis, and the T11 route (party and decision right) the request is sent to on submit.
//  - Draft and returned requests: edit, the live impact preview, submit (round 2 after "changes requested" resubmits
//    the same approval) and withdraw. Only the requester submits again or withdraws a request in approval; anyone else
//    is told so, and a try is refused 403 `approval.not_requester`, translated.
//  - Submitted requests are decided by a person in the business approval (`/my-work/approvals/{id}`); the frozen impact
//    assessment of every submitted version is shown with its SHA-256. The original gate approvals and snapshots that a
//    change touches are listed as preserved, with a link to the gate page where they remain viewable unchanged.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { ChangeRequest } from "@mth/shared/schemas";
import { useApproval, useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { ConfirmActionDialog } from "../gates/GateP4.tsx";
import { BusinessApprovalNote, P4FormDialog, textOf, type P4FieldSpec } from "../my-work/p4ui.tsx";
import {
  changePaths,
  KIND_T11_ROW,
  proposedRowsOf,
  useChangeRequest,
  useImpactAssessments,
  useSavedImpactPreview,
} from "./api.ts";
import { ChangeStatusText } from "./ChangeStatus.tsx";
import { CR_NS } from "./CreateChangeRequest.tsx";
import { ImpactItemsTable, MaterialityText } from "./Impact.tsx";
import { editableFields } from "./subjects.ts";

export function ChangeRequestPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="change-requests"
      title={t("changeRequestsP4.detail.title")}
      writePermissions={["change_request.raise"]}
    >
      <DetailBody />
    </WorkspaceFrame>
  );
}

/** Where the subject record is shown (its own screen), or null when it has none. */
export function subjectPath(tid: string, cr: Pick<ChangeRequest, "subjectType" | "subjectId">): string | null {
  const base = `/transformations/${tid}`;
  switch (cr.subjectType) {
    case "charter":
      return `${base}/charter`;
    case "kpi_definition":
      return `${base}/kpis/${cr.subjectId}`;
    case "outcome_kpi":
      return `${base}/define`;
    case "tom_canvas_cell":
      return `${base}/design`;
    case "initiative":
      return `${base}/initiatives/${cr.subjectId}`;
    case "benefit_formula":
      return `${base}/benefit-formulas/${cr.subjectId}`;
    case "milestone":
      return `${base}/roadmap`;
    case "budget_line":
      return null;
  }
}

function DetailBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { changeRequestId = "" } = useParams();
  const query = useChangeRequest(ws.tid, changeRequestId);
  return (
    <>
      <p>
        <Link className="link" to={`/transformations/${ws.tid}/change-requests`}>
          ← {t("changeRequestsP4.detail.back")}
        </Link>
      </p>
      <QueryState query={query}>{(cr) => <RequestView cr={cr} />}</QueryState>
    </>
  );
}

type DialogState = null | "edit" | "submit" | "withdraw";

function RequestView({ cr }: { cr: ChangeRequest }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const { byId } = usePeople(ws.tid);
  const approval = useApproval(cr.approvalId ?? undefined);
  const a = approval.data;
  const refresh = useP4Refresh(ws.tid);
  const [dialog, setDialog] = useState<DialogState>(null);
  const editable = cr.status === "draft" || cr.status === "changes_requested";
  const inApproval = cr.status === "submitted";
  const canRaise = ws.can("change_request.raise");
  const requester = a ? a.requestedBy === ws.meId : cr.raisedBy === ws.meId;
  const requesterOnly = (cr.status === "changes_requested" || inApproval) && a !== undefined && !requester;
  const { rows, facts } = proposedRowsOf(cr.proposedChange);
  const unknown = t("common.value.unknown");
  const valueText = (v: unknown) => (v === null || v === undefined || v === "" ? unknown : String(v));
  const subjectLink = subjectPath(ws.tid, cr);
  const t11 = KIND_T11_ROW[cr.changeKind];
  return (
    <div data-change-request={cr.code} data-status={cr.status} data-round={a?.roundNo ?? 0}>
      <BusinessApprovalNote body={t("changeRequestsP4.businessApproval")} />
      <Section
        id="request"
        title={t("changeRequestsP4.detail.heading", { code: cr.code })}
        actions={
          canRaise ? (
            <span className="section__actions">
              {editable ? (
                <button
                  type="button"
                  className="button button--secondary button--small"
                  onClick={() => setDialog("edit")}
                  data-action="edit-change-request"
                >
                  <Icon name="pencil" /> {t("changeRequestsP4.detail.edit")}
                </button>
              ) : null}
              {editable ? (
                <button
                  type="button"
                  className="button button--primary button--small"
                  onClick={() => setDialog("submit")}
                  data-action={cr.status === "changes_requested" ? "resubmit-change-request" : "submit-change-request"}
                >
                  <Icon name="check" />{" "}
                  {cr.status === "changes_requested"
                    ? t("changeRequestsP4.detail.resubmitRound", { n: (a?.roundNo ?? 1) + 1 })
                    : t("changeRequestsP4.detail.submit")}
                </button>
              ) : null}
              {editable || inApproval ? (
                <button
                  type="button"
                  className="button button--danger button--small"
                  onClick={() => setDialog("withdraw")}
                  data-action="withdraw-change-request"
                >
                  <Icon name="cross" /> {t("changeRequestsP4.detail.withdraw")}
                </button>
              ) : null}
            </span>
          ) : null
        }
      >
        {cr.status === "draft" ? (
          <p className="banner banner--info" role="note" data-state="saved-draft">
            <Icon name="pencil" /> {t("changeRequestsP4.detail.draftNote")}
          </p>
        ) : null}
        {cr.status === "changes_requested" ? (
          <p className="banner banner--warning" role="note" data-state="returned">
            <Icon name="refresh" /> {t("changeRequestsP4.detail.returnedNote")}
          </p>
        ) : null}
        {requesterOnly && canRaise ? (
          <p className="small muted" data-requester-only="true">
            {t("changeRequestsP4.detail.requesterOnly")}
          </p>
        ) : null}
        <dl className="facts">
          <dt>{t("common.field.status")}</dt>
          <dd>
            <ChangeStatusText status={cr.status} />
            {a ? (
              <span className="block small muted" data-approval-status={a.status}>
                {t("changeRequestsP4.detail.round", { n: a.roundNo })} ·{" "}
                {t(`changeRequestsP4.approvalStatus.${a.status}`, { defaultValue: a.status })}
              </span>
            ) : null}
          </dd>
          <dt>{t("changeRequestsP4.field.kind")}</dt>
          <dd data-cr-kind={cr.changeKind}>{t(`changeRequestsP4.kind.${cr.changeKind}`)}</dd>
          <dt>{t("changeRequestsP4.field.subjectType")}</dt>
          <dd>
            {t(`changeRequestsP4.subjectType.${cr.subjectType}`)}{" "}
            <span className="small muted">{t("changeRequestsP4.detail.subjectVersion", { n: cr.subjectVersion })}</span>
            {subjectLink ? (
              <>
                {" "}
                <Link className="link small" to={subjectLink}>
                  {t("changeRequestsP4.detail.openSubject")}
                </Link>
              </>
            ) : null}
          </dd>
          <dt>{t("changeRequestsP4.field.origin")}</dt>
          <dd data-cr-origin={cr.origin}>{t(`changeRequestsP4.origin.${cr.origin}`)}</dd>
          <dt>{t("changeRequestsP4.field.raisedBy")}</dt>
          <dd>
            <PersonName id={cr.raisedBy} people={byId} /> · {formatDateTime(cr.createdAt, locale, ws.tr.timezone)}
          </dd>
          <dt>{t("changeRequestsP4.field.materiality")}</dt>
          <dd>
            <MaterialityText materiality={cr.materiality} basis={cr.materialityBasis} />
          </dd>
          <dt>{t("changeRequestsP4.detail.route")}</dt>
          <dd data-route-party={cr.routePartyCode ?? "none"}>
            {cr.routePartyCode ? (
              <>
                {t(`changeRequestsP4.party.${cr.routePartyCode}`, { defaultValue: cr.routePartyCode })}
                <span className="block small muted">
                  {cr.decisionRightId
                    ? t("changeRequestsP4.detail.routeT11", { row: t(`changeRequestsP4.t11.${t11 ?? "none"}`) })
                    : t11
                      ? t("changeRequestsP4.detail.routeFallback")
                      : t("changeRequestsP4.detail.routeDefault")}
                </span>
              </>
            ) : (
              t("changeRequestsP4.detail.routeOnSubmit", {
                row: t11 ? t(`changeRequestsP4.t11.${t11}`) : t("changeRequestsP4.t11.none"),
              })
            )}
            {a ? (
              <span className="block small">
                {t("changeRequestsP4.detail.assignee")}:{" "}
                {a.assignee.userId ? (
                  <PersonName id={a.assignee.userId} people={byId} />
                ) : (
                  t(`changeRequestsP4.party.${a.assignee.partyCode}`, { defaultValue: a.assignee.partyCode })
                )}
              </span>
            ) : null}
            {cr.approvalId ? (
              <Link className="link small block" to={`/my-work/approvals/${cr.approvalId}`} data-open-approval="true">
                {t("changeRequestsP4.detail.openApproval")}
              </Link>
            ) : null}
          </dd>
          {cr.decidedAt ? (
            <>
              <dt>{t("changeRequestsP4.detail.decidedAt")}</dt>
              <dd>{formatDateTime(cr.decidedAt, locale, ws.tr.timezone)}</dd>
            </>
          ) : null}
          {cr.appliedAt ? (
            <>
              <dt>{t("changeRequestsP4.detail.applied")}</dt>
              <dd data-applied="true">
                {formatDateTime(cr.appliedAt, locale, ws.tr.timezone)}
                {cr.appliedVersion !== null ? (
                  <span className="block small muted">
                    {t("changeRequestsP4.detail.appliedVersion", { n: cr.appliedVersion })}
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}
        </dl>
        <h3 className="small-heading">{t("changeRequestsP4.detail.proposed")}</h3>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("changeRequestsP4.tableRegion.proposed")}>
          <table className="table table--compact" data-proposed-rows={rows.length}>
            <caption className="visually-hidden">{t("changeRequestsP4.detail.proposed")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("changeRequestsP4.detail.fieldCol")}</th>
                <th scope="col">{t("changeRequestsP4.detail.fromCol")}</th>
                <th scope="col">{t("changeRequestsP4.detail.toCol")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.field} data-proposed-field={r.field}>
                  <th scope="row">{t(`changeRequestsP4.changeField.${r.field}`, { defaultValue: r.field })}</th>
                  <td data-from={valueText(r.from)}>
                    <TextCell value={valueText(r.from)} />
                  </td>
                  <td>
                    <TextCell value={valueText(r.to)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {facts.length > 0 || !("effectiveFrom" in cr.proposedChange) ? (
          <ul className="plain-list small">
            {facts
              .filter(([k]) => k !== "effectiveFrom")
              .map(([k, v]) => (
                <li key={k}>
                  {t(`changeRequestsP4.changeField.${k}`, { defaultValue: k })}: <bdi dir="ltr">{valueText(v)}</bdi>
                </li>
              ))}
            <li data-effective-from={String(cr.proposedChange["effectiveFrom"] ?? "now")}>
              {typeof cr.proposedChange["effectiveFrom"] === "string"
                ? t("changeRequestsP4.detail.effectiveFrom", {
                    date: formatBusinessDate(cr.proposedChange["effectiveFrom"], locale),
                  })
                : t("changeRequestsP4.detail.prospective")}
            </li>
          </ul>
        ) : null}
        <h3 className="small-heading">{t("changeRequestsP4.field.reason")}</h3>
        <p>
          <TextCell value={cr.reason} />
        </p>
      </Section>
      {editable ? <LivePreviewSection cr={cr} /> : null}
      <AssessmentsSection cr={cr} />
      {dialog === "edit" ? <EditDialog cr={cr} onClose={() => setDialog(null)} /> : null}
      {dialog === "submit" ? (
        <ConfirmActionDialog
          title={t("changeRequestsP4.detail.submitTitle", { code: cr.code })}
          body={
            cr.status === "changes_requested"
              ? t("changeRequestsP4.detail.resubmitBody")
              : t("changeRequestsP4.detail.submitBody")
          }
          confirmLabel={
            cr.status === "changes_requested"
              ? t("changeRequestsP4.detail.resubmitRound", { n: (a?.roundNo ?? 1) + 1 })
              : t("changeRequestsP4.detail.submit")
          }
          url={changePaths.submit(ws.tid, cr.id)}
          version={cr.version}
          namespaces={CR_NS}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "withdraw" ? (
        <ConfirmActionDialog
          title={t("changeRequestsP4.detail.withdrawTitle", { code: cr.code })}
          body={
            inApproval ? t("changeRequestsP4.detail.withdrawInApprovalBody") : t("changeRequestsP4.detail.withdrawBody")
          }
          confirmLabel={t("changeRequestsP4.detail.withdraw")}
          url={changePaths.withdraw(ws.tid, cr.id)}
          version={cr.version}
          danger
          namespaces={CR_NS}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function LivePreviewSection({ cr }: { cr: ChangeRequest }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const preview = useSavedImpactPreview(ws.tid, cr.id, true);
  return (
    <Section
      id="impact-preview"
      title={t("changeRequestsP4.preview.title")}
      intro={t("changeRequestsP4.preview.intro")}
    >
      <QueryState query={preview}>
        {(p) => (
          <div data-impact-preview="saved">
            <p>
              <MaterialityText materiality={p.materiality} basis={p.materialityBasis} />
            </p>
            <ImpactItemsTable items={p.items} hiddenItemCount={p.hiddenItemCount} live />
          </div>
        )}
      </QueryState>
    </Section>
  );
}

function AssessmentsSection({ cr }: { cr: ChangeRequest }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const list = useImpactAssessments(ws.tid, cr.id);
  const { byId } = usePeople(ws.tid);
  return (
    <Section
      id="impact-assessments"
      title={t("changeRequestsP4.assessments.title")}
      intro={t("changeRequestsP4.assessments.intro")}
    >
      <QueryState
        query={list}
        isEmpty={(l) => l.length === 0}
        empty={<EmptyState title={t("changeRequestsP4.assessments.empty")} />}
      >
        {(rows) => (
          <ol className="plain-list" data-assessments={rows.length}>
            {[...rows]
              .sort((x, y) => y.changeRequestVersion - x.changeRequestVersion)
              .map((ia) => (
                <li
                  key={ia.id}
                  data-assessment-version={ia.changeRequestVersion}
                  data-current={ia.id === cr.currentImpactAssessmentId ? "true" : "false"}
                >
                  <h3 className="small-heading">
                    <Icon name="lock" />{" "}
                    {t("changeRequestsP4.assessments.heading", { n: ia.changeRequestVersion, items: ia.itemCount })}
                    {ia.id === cr.currentImpactAssessmentId ? ` · ${t("changeRequestsP4.assessments.current")}` : ""}
                  </h3>
                  <p className="small muted">
                    {formatDateTime(ia.assessedAt, locale, ws.tr.timezone)} ·{" "}
                    <PersonName id={ia.assessedBy} people={byId} />
                  </p>
                  <p className="small text-cell">
                    {t("changeRequestsP4.assessments.sha")}:{" "}
                    <bdi dir="ltr" className="code" data-sha256={ia.contentSha256}>
                      {ia.contentSha256}
                    </bdi>
                  </p>
                  <ImpactItemsTable items={ia.items} />
                </li>
              ))}
          </ol>
        )}
      </QueryState>
    </Section>
  );
}

/** PATCH the reason and the proposed new values (draft or returned only; If-Match = the version shown). */
function EditDialog({ cr, onClose }: { cr: ChangeRequest; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const unknown = t("common.value.unknown");
  const fieldsOf = editableFields(cr.changeKind, cr.subjectType);
  const change = cr.proposedChange as Record<string, { from?: unknown; to?: unknown } | unknown>;
  const toOf = (f: string) => {
    const c = change[f];
    return typeof c === "object" && c !== null && "to" in c ? (c as { to: unknown }).to : null;
  };
  const fromOf = (f: string) => {
    const c = change[f];
    return typeof c === "object" && c !== null && "from" in c ? (c as { from: unknown }).from : null;
  };
  const specs: P4FieldSpec[] = [
    ...fieldsOf.map(
      (f): P4FieldSpec => ({
        name: `to_${f.field}`,
        label: t("changeRequestsP4.form.newValue", { field: t(`changeRequestsP4.changeField.${f.field}`) }),
        kind: f.type === "date" ? "date" : f.type === "text" ? "textarea" : "text",
        hint: t("changeRequestsP4.form.currentValue", {
          value: fromOf(f.field) === null || fromOf(f.field) === undefined ? unknown : String(fromOf(f.field)),
        }),
        ltr: f.type === "decimal",
      }),
    ),
    { name: "reason", label: t("changeRequestsP4.field.reason"), kind: "textarea", required: true, min: 3, max: 4000 },
  ];
  const initial: Record<string, string> = { reason: cr.reason };
  for (const f of fieldsOf) {
    const v = toOf(f.field);
    if (v !== null && v !== undefined) initial[`to_${f.field}`] = String(v);
  }
  return (
    <P4FormDialog
      title={t("changeRequestsP4.detail.editTitle", { code: cr.code })}
      description={t("changeRequestsP4.detail.editIntro")}
      fields={specs}
      initial={initial}
      submitLabel={t("changeRequestsP4.save")}
      method="PATCH"
      url={changePaths.one(ws.tid, cr.id)}
      version={cr.version}
      namespaces={CR_NS}
      toBody={(v) => {
        const body: Record<string, unknown> = {};
        const reason = textOf(v["reason"]);
        if (reason !== undefined && reason !== cr.reason) body["reason"] = reason;
        if (fieldsOf.length > 0) {
          const next: Record<string, unknown> = { ...cr.proposedChange };
          let changed = false;
          for (const f of fieldsOf) {
            const raw = v[`to_${f.field}`];
            const to = typeof raw === "string" ? raw.trim() : "";
            const before = toOf(f.field);
            if (to === "" && (before === null || before === undefined)) continue;
            if (to === "") {
              delete next[f.field];
              changed = true;
            } else if (String(before ?? "") !== to) {
              next[f.field] = { from: fromOf(f.field) ?? null, to };
              changed = true;
            }
          }
          if (changed) body["proposedChange"] = next;
        }
        return Object.keys(body).length === 0 ? { fieldErrors: { reason: "validation.empty_patch" } } : body;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}
