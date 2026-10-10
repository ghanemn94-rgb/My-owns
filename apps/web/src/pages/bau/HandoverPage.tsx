// BAU and Improvement > BAU handovers (T-DG4-FE-E; p4-work-split §F+G FG.8; ADR-0034 §5). SYNTHETIC data only.
//  - REQ-S11-005: the handover checklist shows every M0217 item (KPI owner, operating procedures, controls, evidence,
//    capability readiness, unresolved accepted risks, benefit monitoring cadence, data access, improvement backlog)
//    and marks the ones still missing (`missingItems`). A submission missing any is refused (422
//    bau_handover.incomplete); the alert names every missing item in the shown language.
//  - Only the receiving owner accepts or returns (403 bau_handover.not_receiving_owner for anyone else). The screen
//    offers the actions to the receiving owner only, and labels the acceptance a business approval (never DG0-DG7).
//  - REQ-PB-083: acceptance transfers ownership and creates the first recurring review (the API's transaction).
//  - `/transformations/:id/bau-handovers/:handoverId` is the `bau_handover_to_accept` work-item link.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { BAU_HANDOVER_ITEMS, BAU_HANDOVER_STATUSES, SUSTAIN_FREQUENCIES } from "@mth/shared/schemas";
import { ApiError, api } from "../../api/client.ts";
import { useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { useEvidenceOptions } from "../kpi/api.ts";
import { FormAlert, P4FormDialog, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import {
  sustainPaths,
  useHandover,
  useHandovers,
  useImprovementItems,
  usePerformanceAreas,
  type BauHandover,
  type PerformanceArea,
} from "./api.ts";
import { AcceptanceNote, Code, NS, StatusText, SUSTAIN_WRITE_PERMISSIONS, SustainSubNav, vocabOptions } from "./ui.tsx";

export function HandoversPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="bau"
      title={t("sustainP4.handover.title")}
      subtitle={t("sustainP4.handover.intro")}
      writePermissions={SUSTAIN_WRITE_PERMISSIONS}
    >
      <HandoversBody />
    </WorkspaceFrame>
  );
}

export function HandoverPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame tab="bau" title={t("sustainP4.handover.detailTitle")} writePermissions={SUSTAIN_WRITE_PERMISSIONS}>
      <HandoverDetail />
    </WorkspaceFrame>
  );
}

function HandoversBody() {
  const ws = useWorkspace();
  const { t } = useTranslation();
  return (
    <>
      <SustainSubNav tid={ws.tid} />
      <Section id="bau-handovers" title={t("sustainP4.handover.tableTitle")}>
        <HandoversTable />
      </Section>
    </>
  );
}

/** Handovers (of one area, or of the transformation), with "prepare a handover" for an establishing/reopened area. */
export function HandoversTable({ areaId, area }: { areaId?: string; area?: PerformanceArea }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [status, setStatus] = useState("");
  const list = useHandovers(ws.tid, {
    ...(areaId ? { performanceAreaId: areaId } : {}),
    ...(status ? { status } : {}),
  });
  const areas = usePerformanceAreas(ws.tid);
  const { byId } = usePeople(ws.tid);
  const [creating, setCreating] = useState(false);
  const areaCode = (id: string) => (areas.data ?? []).find((a) => a.id === id)?.code ?? "—";
  const canPrepare =
    ws.can("bau_handover.prepare") && (!area || area.status === "establishing" || area.status === "reopened");
  const columns: RegisterColumn<BauHandover>[] = [
    {
      id: "code",
      header: t("sustainP4.col.code"),
      rowHeader: true,
      hideable: false,
      cell: (h) => (
        <Link className="link" to={`/transformations/${ws.tid}/bau-handovers/${h.id}`} data-handover-link={h.code}>
          <Code>{h.code}</Code>
        </Link>
      ),
      sortValue: (h) => h.code,
    },
    { id: "area", header: t("sustainP4.handover.area"), cell: (h) => <Code>{areaCode(h.performanceAreaId)}</Code> },
    { id: "cycle", header: t("sustainP4.areas.cycle"), cell: (h) => String(h.cycleNo), sortValue: (h) => h.cycleNo },
    {
      id: "receiving",
      header: t("sustainP4.handover.receivingOwner"),
      cell: (h) => <PersonName id={h.receivingOwnerUserId} people={byId} />,
    },
    {
      id: "missing",
      header: t("sustainP4.handover.missingCount"),
      cell: (h) =>
        h.status === "accepted" ? (
          <span className="muted">{t("sustainP4.none")}</span>
        ) : h.missingItems.length === 0 ? (
          <span className="chip-row" data-missing="0">
            <Icon name="check" /> {t("sustainP4.handover.complete")}
          </span>
        ) : (
          <span className="chip-row" data-missing={h.missingItems.length}>
            <Icon name="alert" /> {t("sustainP4.handover.missingN", { n: h.missingItems.length })}
          </span>
        ),
    },
    {
      id: "status",
      header: t("sustainP4.col.status"),
      cell: (h) => <StatusText status={h.status} />,
      sortValue: (h) => BAU_HANDOVER_STATUSES.indexOf(h.status),
      filterText: (h) => t(`sustainP4.status.${h.status}`),
    },
  ];
  return (
    <>
      <div className="filters" role="group" aria-label={t("sustainP4.filters")}>
        <div className="filters__select">
          <label htmlFor={`ho-filter-${areaId ?? "all"}`}>{t("sustainP4.col.status")}</label>
          <select id={`ho-filter-${areaId ?? "all"}`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("sustainP4.all")}</option>
            {BAU_HANDOVER_STATUSES.map((v) => (
              <option key={v} value={v}>
                {t(`sustainP4.status.${v}`)}
              </option>
            ))}
          </select>
        </div>
        {canPrepare ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => setCreating(true)}
            data-prepare-handover
          >
            <Icon name="plus" /> {t("sustainP4.handover.create")}
          </button>
        ) : null}
      </div>
      <QueryState query={list}>
        {(rows) => (
          <RegisterTable
            id={`bau-handovers${areaId ? "-area" : ""}`}
            caption={t("sustainP4.handover.tableTitle")}
            rows={rows}
            columns={columns}
            getRowId={(h) => h.id}
            emptyTitle={t("sustainP4.handover.empty")}
            defaultSort={{ id: "code", dir: "asc" }}
          />
        )}
      </QueryState>
      {creating ? <HandoverDialog areaId={areaId} onClose={() => setCreating(false)} /> : null}
    </>
  );
}

const CONTENT_FIELDS = [
  "operatingProcedures",
  "capabilityReadiness",
  "unresolvedAcceptedRisks",
  "dataAccess",
  "improvementBacklogSummary",
] as const;

function HandoverDialog({
  areaId,
  handover,
  onClose,
}: {
  areaId?: string | undefined;
  handover?: BauHandover;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const areas = usePerformanceAreas(ws.tid);
  const personOptions = people.map((p) => ({ value: p.id, label: p.label }));
  const fields: P4FieldSpec[] = [
    ...(handover || areaId
      ? []
      : [
          {
            name: "performanceAreaId",
            label: t("sustainP4.handover.area"),
            kind: "select",
            required: true,
            options: (areas.data ?? [])
              .filter((a) => a.status === "establishing" || a.status === "reopened")
              .map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
          } satisfies P4FieldSpec,
        ]),
    {
      name: "receivingOwnerUserId",
      label: t("sustainP4.handover.receivingOwner"),
      kind: "select",
      required: true,
      hint: t("sustainP4.handover.receivingOwnerHint"),
      options: personOptions,
    },
    { name: "kpiOwnerUserId", label: t("sustainP4.handover.item.kpi_owner"), kind: "select", options: personOptions },
    {
      name: "operatingProcedures",
      label: t("sustainP4.handover.item.operating_procedures"),
      kind: "textarea",
      max: 8000,
    },
    {
      name: "capabilityReadiness",
      label: t("sustainP4.handover.item.capability_readiness"),
      kind: "textarea",
      max: 8000,
    },
    {
      name: "unresolvedAcceptedRisks",
      label: t("sustainP4.handover.item.unresolved_accepted_risks"),
      kind: "textarea",
      max: 8000,
    },
    {
      name: "benefitMonitoringCadence",
      label: t("sustainP4.handover.item.benefit_monitoring_cadence"),
      kind: "select",
      options: vocabOptions(t, "frequency", SUSTAIN_FREQUENCIES),
    },
    { name: "dataAccess", label: t("sustainP4.handover.item.data_access"), kind: "textarea", max: 8000 },
    {
      name: "improvementBacklogSummary",
      label: t("sustainP4.handover.item.improvement_backlog"),
      kind: "textarea",
      max: 8000,
    },
  ];
  const initial: P4Values = handover
    ? {
        receivingOwnerUserId: handover.receivingOwnerUserId,
        kpiOwnerUserId: handover.kpiOwnerUserId ?? "",
        benefitMonitoringCadence: handover.benefitMonitoringCadence ?? "",
        ...Object.fromEntries(CONTENT_FIELDS.map((k) => [k, handover[k] ?? ""])),
      }
    : {};
  const build = (v: P4Values): Record<string, unknown> => ({
    receivingOwnerUserId: v["receivingOwnerUserId"],
    kpiOwnerUserId: v["kpiOwnerUserId"] ? v["kpiOwnerUserId"] : null,
    benefitMonitoringCadence: v["benefitMonitoringCadence"] ? v["benefitMonitoringCadence"] : null,
    ...Object.fromEntries(CONTENT_FIELDS.map((k) => [k, textOf(v[k]) ?? null])),
  });
  return (
    <P4FormDialog
      title={handover ? t("sustainP4.handover.editTitle", { code: handover.code }) : t("sustainP4.handover.create")}
      description={t("sustainP4.handover.formIntro")}
      fields={fields}
      initial={initial}
      submitLabel={handover ? t("sustainP4.handover.saveDraft") : t("sustainP4.handover.createSubmit")}
      method={handover ? "PATCH" : "POST"}
      url={handover ? sustainPaths.handover(ws.tid, handover.id) : sustainPaths.handovers(ws.tid)}
      {...(handover ? { version: handover.version } : {})}
      namespaces={NS}
      toBody={(v) => {
        const body = build(v);
        if (!handover) {
          const out = Object.fromEntries(Object.entries(body).filter(([, x]) => x !== null));
          return { ...out, performanceAreaId: areaId ?? v["performanceAreaId"] };
        }
        const before = build(initial);
        const patch = Object.fromEntries(
          Object.entries(body).filter(([k, x]) => JSON.stringify(x) !== JSON.stringify(before[k])),
        );
        return Object.keys(patch).length === 0
          ? { fieldErrors: { receivingOwnerUserId: "validation.empty_patch" } }
          : patch;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

/** The items a 422 bau_handover.incomplete names, from its errors[] pointers, in checklist order. */
export function missingFromError(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== "bau_handover.incomplete") return [];
  const pointers = new Set(error.fieldErrors.map((f) => f.pointer));
  return BAU_HANDOVER_ITEMS.filter((i) => pointers.has(i.pointer)).map((i) => i.item);
}

function HandoverDetail() {
  const ws = useWorkspace();
  const { handoverId = "" } = useParams();
  const query = useHandover(ws.tid, handoverId);
  return (
    <>
      <SustainSubNav tid={ws.tid} />
      <QueryState query={query}>{(h) => <HandoverBody handover={h} />}</QueryState>
    </>
  );
}

function HandoverBody({ handover: h }: { handover: BauHandover }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { byId } = usePeople(ws.tid);
  const areas = usePerformanceAreas(ws.tid);
  const backlog = useImprovementItems(ws.tid, { performanceAreaId: h.performanceAreaId });
  const [dialog, setDialog] = useState<"edit" | "evidence" | "accept" | "return" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const area = (areas.data ?? []).find((a) => a.id === h.performanceAreaId);
  const editable = (h.status === "draft" || h.status === "returned") && ws.can("bau_handover.prepare");
  const isReceiver = h.receivingOwnerUserId === ws.meId;
  const mayDecide = h.status === "submitted" && isReceiver && ws.can("bau_handover.accept");
  const missing = new Set(h.missingItems);
  const missingNow = missingFromError(error);

  const submit = async () => {
    setError(null);
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(sustainPaths.handoverSubmit(ws.tid, h.id), { method: "POST", ifMatch: h.version });
      if (action.stale()) return;
      await refresh();
    } catch (e) {
      if (action.stale(e)) return;
      setError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await refresh();
    } finally {
      setBusy(false);
    }
  };

  const present = (item: string): string | null => {
    switch (item) {
      case "kpi_owner":
        return h.kpiOwnerUserId;
      case "operating_procedures":
        return h.operatingProcedures;
      case "controls":
        return h.controlIds.length > 0 ? t("sustainP4.handover.countControls", { n: h.controlIds.length }) : null;
      case "evidence":
        return h.evidenceIds.length > 0 ? t("sustainP4.handover.countEvidence", { n: h.evidenceIds.length }) : null;
      case "capability_readiness":
        return h.capabilityReadiness;
      case "unresolved_accepted_risks":
        return h.unresolvedAcceptedRisks;
      case "benefit_monitoring_cadence":
        return h.benefitMonitoringCadence ? t(`sustainP4.frequency.${h.benefitMonitoringCadence}`) : null;
      case "data_access":
        return h.dataAccess;
      case "improvement_backlog":
        return h.improvementBacklogSummary;
      default:
        return null;
    }
  };

  return (
    <>
      <Section
        id="bau-handover"
        title={`${h.code}${area ? ` · ${area.code} ${area.name}` : ""}`}
        actions={
          <span className="chip-row">
            {editable ? (
              <>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setDialog("edit")}
                  data-edit-handover
                >
                  <Icon name="pencil" /> {t("sustainP4.handover.edit")}
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setDialog("evidence")}
                  data-add-evidence
                >
                  <Icon name="plus" /> {t("sustainP4.handover.addEvidence")}
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => void submit()}
                  data-submit-handover
                >
                  <Icon name="check" /> {busy ? t("common.state.saving") : t("sustainP4.handover.submit")}
                </button>
              </>
            ) : null}
            {mayDecide ? (
              <>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => setDialog("accept")}
                  data-accept-handover
                >
                  <Icon name="lock" /> {t("sustainP4.handover.accept")}
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setDialog("return")}
                  data-return-handover
                >
                  <Icon name="refresh" /> {t("sustainP4.handover.return")}
                </button>
              </>
            ) : null}
          </span>
        }
      >
        <FormAlert
          error={error}
          namespaces={NS}
          extra={
            missingNow.length > 0 ? (
              <ul data-missing-items>
                {missingNow.map((i) => (
                  <li key={i}>{t(`sustainP4.handover.item.${i}`)}</li>
                ))}
              </ul>
            ) : null
          }
        />
        <dl className="details">
          <dt>{t("sustainP4.col.status")}</dt>
          <dd>
            <StatusText status={h.status} />
          </dd>
          <dt>{t("sustainP4.handover.receivingOwner")}</dt>
          <dd>
            <PersonName id={h.receivingOwnerUserId} people={byId} />
          </dd>
          <dt>{t("sustainP4.areas.cycle")}</dt>
          <dd>{h.cycleNo}</dd>
          {h.acceptedAt ? (
            <>
              <dt>{t("sustainP4.handover.acceptedAt")}</dt>
              <dd data-accepted-at={h.acceptedAt}>{formatDateTime(h.acceptedAt, locale)}</dd>
            </>
          ) : null}
          {h.returnReason ? (
            <>
              <dt>{t("sustainP4.handover.returnReason")}</dt>
              <dd>
                <TextCell value={h.returnReason} />
              </dd>
            </>
          ) : null}
        </dl>
        {h.status === "submitted" && !isReceiver ? (
          <p className="banner banner--info" role="note" data-state="receiving-owner-only">
            <Icon name="lock" /> {t("sustainP4.handover.receiverOnly")}
          </p>
        ) : null}
        {h.status === "submitted" && isReceiver && !ws.can("bau_handover.accept") ? (
          <p className="banner banner--info" role="note">
            <Icon name="lock" /> {t("sustainP4.handover.needsAcceptRight")}
          </p>
        ) : null}
        {h.status === "accepted" ? (
          <p className="banner banner--info" role="note" data-state="accepted-final">
            <Icon name="lock" /> {t("sustainP4.handover.acceptedFinal")}
          </p>
        ) : null}
        <h3>{t("sustainP4.handover.checklist")}</h3>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("sustainP4.handover.checklist")}>
          <table className="table" data-checklist>
            <caption className="visually-hidden">{t("sustainP4.handover.checklist")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("sustainP4.handover.itemCol")}</th>
                <th scope="col">{t("sustainP4.handover.stateCol")}</th>
                <th scope="col">{t("sustainP4.handover.valueCol")}</th>
              </tr>
            </thead>
            <tbody>
              {BAU_HANDOVER_ITEMS.map(({ item }) => {
                const isMissing = missing.has(item) && h.status !== "accepted";
                const value = present(item);
                return (
                  <tr key={item} data-item={item} data-item-state={isMissing ? "missing" : "present"}>
                    <th scope="row">{t(`sustainP4.handover.item.${item}`)}</th>
                    <td>
                      {isMissing ? (
                        <span className="status-chip status-chip--off-track">
                          <Icon name="alert" /> {t("sustainP4.handover.missing")}
                        </span>
                      ) : (
                        <span className="chip-row">
                          <Icon name="check" /> {t("sustainP4.handover.provided")}
                        </span>
                      )}
                    </td>
                    <td>
                      {item === "kpi_owner" && value ? (
                        <PersonName id={value} people={byId} />
                      ) : value ? (
                        <TextCell value={value} />
                      ) : (
                        <span className="muted">{t("sustainP4.none")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          <Icon name="info" /> {t("sustainP4.handover.controlsNote")}
        </p>
        <h3>{t("sustainP4.handover.openBacklog")}</h3>
        <QueryState query={backlog}>
          {(items) =>
            items.filter((i) => i.status === "open" || i.status === "in_progress").length === 0 ? (
              <p className="muted">{t("sustainP4.handover.noOpenBacklog")}</p>
            ) : (
              <ul className="plain-list">
                {items
                  .filter((i) => i.status === "open" || i.status === "in_progress")
                  .map((i) => (
                    <li key={i.id}>
                      <Code>{i.code}</Code> {i.title}
                    </li>
                  ))}
              </ul>
            )
          }
        </QueryState>
      </Section>
      {dialog === "edit" ? <HandoverDialog handover={h} onClose={() => setDialog(null)} /> : null}
      {dialog === "evidence" ? <EvidenceDialog handover={h} onClose={() => setDialog(null)} /> : null}
      {dialog === "accept" ? (
        <P4FormDialog
          title={t("sustainP4.handover.acceptTitle", { code: h.code })}
          note={<AcceptanceNote />}
          description={t("sustainP4.handover.acceptIntro")}
          fields={[{ name: "note", label: t("sustainP4.handover.acceptanceNoteField"), kind: "textarea", max: 2000 }]}
          submitLabel={t("sustainP4.handover.acceptSubmit")}
          url={sustainPaths.handoverAccept(ws.tid, h.id)}
          version={h.version}
          namespaces={NS}
          toBody={(v) => (textOf(v["note"]) ? { note: v["note"] } : {})}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "return" ? (
        <P4FormDialog
          title={t("sustainP4.handover.returnTitle", { code: h.code })}
          fields={[
            { name: "reason", label: t("sustainP4.field.reason"), kind: "textarea", required: true, min: 3, max: 1000 },
          ]}
          submitLabel={t("sustainP4.handover.return")}
          url={sustainPaths.handoverReturn(ws.tid, h.id)}
          version={h.version}
          namespaces={NS}
          toBody={(v) => ({ reason: v["reason"] })}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

function EvidenceDialog({ handover, onClose }: { handover: BauHandover; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const evidence = useEvidenceOptions(ws.tid);
  return (
    <P4FormDialog
      title={t("sustainP4.handover.addEvidence")}
      description={t("sustainP4.handover.evidenceIntro")}
      fields={[
        {
          name: "evidenceId",
          label: t("sustainP4.handover.item.evidence"),
          kind: "select",
          required: true,
          options: (evidence.data ?? [])
            .filter((e) => !handover.evidenceIds.includes(e.id))
            .map((e) => ({ value: e.id, label: e.title })),
        },
      ]}
      submitLabel={t("sustainP4.handover.addEvidenceSubmit")}
      url={sustainPaths.handoverEvidence(ws.tid, handover.id)}
      version={handover.version}
      namespaces={NS}
      toBody={(v) => ({ evidenceId: v["evidenceId"] })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}
