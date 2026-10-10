// The impact panel, allocation sets and trace links of the Traceability screen (T-DG4-FE-G2; ADR-0038 §2, §3, §6).
// SYNTHETIC data only in tests and demos.
//  - Impact (REQ-S03-006): the records reached downstream of a record or a KPI definition, the benefits whose value is
//    affected, the T10 areas and dashboards that read them, and the count of affected records the caller cannot read
//    (counted, never listed). Computed when asked; nothing is stored.
//  - Allocation sets: the shares into an outcome KPI or a benefit, the decimal total and the unallocated share
//    (1 − total; a set with no share is "unallocated 100 %", never 0 %). A write that would take the set above 100 % is
//    refused by the server (422 trace_link.allocation_exceeds_total); the dialog shows the total it would reach.
//  - Trace links: the four chain steps without a DG2/DG3 record (issue → gap, deliverable → capability,
//    capability → KPI, KPI → benefit), each with its contribution statement; a removed link stays listed (never
//    deleted) and is never re-activated.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  SHARE_LINK_KINDS,
  TRACE_LINK_ENDS,
  TRACE_LINK_KINDS,
  traceAllocationTotals,
  type TraceLinkKind,
} from "@mth/shared/schemas";
import { api, ApiError } from "../../api/client.ts";
import { useP4Refresh } from "../../api/p4.ts";
import { Icon } from "../../components/Icon.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { LoadingState, QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { P4FormDialog, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import {
  tracePaths,
  useAllocationSet,
  useImpact,
  useKpiDefinitionsForImpact,
  useTraceLinks,
  type AllocationSet,
  type AllocationTargetType,
  type ImpactRecordType,
  type RecordImpact,
  type TraceabilityGraph,
  type TraceLink,
} from "./api.ts";
import { useTraceSelection } from "./TraceabilityPage.tsx";
import { CHAIN_ORDER, nodeTypeText, NS, Pct, ReasonAction, recordWebPath, RecordName, StatusTag } from "./ui.tsx";

const SHARE_RE = /^[0-9](\.[0-9]{1,6})?$/;

/** Client check of a share (the server re-validates): a decimal fraction with ≤ 6 places, more than 0, at most 1. */
export function shareError(value: string): string | null {
  if (value === "") return null;
  if (!SHARE_RE.test(value)) return "validation.share_range";
  const [i = "0", f = ""] = value.split(".");
  const zero = /^0*$/.test(i) && /^0*$/.test(f);
  const overOne = Number(i) > 1 || (i === "1" && !/^0*$/.test(f));
  return zero || overOne ? "validation.share_range" : null;
}

/** The total a set would reach when one member's share is replaced by `next` (decimal, exact). */
export function wouldTotal(set: AllocationSet | null, linkId: string | null, next: string): string | null {
  if (!set || shareError(next) !== null) return null;
  const others = set.members.filter((m) => m.linkId !== linkId).map((m) => m.allocationShare);
  return traceAllocationTotals(next === "" ? others : [...others, next]).total;
}

function nodeName(graph: TraceabilityGraph | null, id: string | null): { code: string | null; label: string | null } {
  const n = id ? graph?.nodes.find((x) => x.recordId === id) : undefined;
  return { code: n?.code ?? null, label: n?.label ?? null };
}

// ------------------------------------------------------------------------------------------------ impact

const DASHBOARD_PATH = (d: RecordImpact["dashboards"][number], tid: string): string => {
  switch (d.dashboard) {
    case "executive":
      return "/executive-overview";
    case "transformation":
      return `/transformations/${d.transformationId ?? tid}/dashboard`;
    case "workstream":
      return d.workstreamId
        ? `/transformations/${d.transformationId ?? tid}/workstreams/${d.workstreamId}/dashboard`
        : `/transformations/${d.transformationId ?? tid}/dashboard`;
    case "personal":
      return "/my-work";
    default:
      return `/dashboards/${d.dashboard}`;
  }
};

export function ImpactPanel({ graph }: { graph: TraceabilityGraph | null }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const sel = useTraceSelection();
  const kpis = useKpiDefinitionsForImpact(ws.tid);
  const [cursor, setCursor] = useState<string | null>(null);
  const root = sel.impact as { type: ImpactRecordType; id: string } | null;
  const impact = useImpact(ws.tid, root, cursor);
  const value = root ? `${root.type}:${root.id}` : "";
  return (
    <Section id="trace-impact" title={t("traceability.impact.title")} intro={t("traceability.impact.intro")}>
      <div className="filters">
        <div className="filters__select">
          <label htmlFor="impact-root">{t("traceability.impact.record")}</label>
          <select
            id="impact-root"
            value={value}
            onChange={(e) => {
              setCursor(null);
              const [type, id] = e.target.value.split(":", 2);
              sel.set("impact", type && id ? { type, id } : null);
            }}
          >
            <option value="">{t("common.form.choose")}</option>
            <optgroup label={t("traceability.nodeType.kpi_definition")}>
              {(kpis.data ?? []).map((k) => (
                <option key={k.id} value={`kpi_definition:${k.id}`}>
                  {k.name}
                </option>
              ))}
            </optgroup>
            {CHAIN_ORDER.map((type) => {
              const nodes = (graph?.nodes ?? []).filter((n) => n.recordType === type);
              return nodes.length === 0 ? null : (
                <optgroup key={type} label={nodeTypeText(t, type)}>
                  {nodes.map((n) => (
                    <option key={n.recordId} value={`${type}:${n.recordId}`}>
                      {[n.code, n.label].filter(Boolean).join(" ") || t("traceability.noLabel")}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>
      </div>
      {!root ? (
        <p className="muted">{t("traceability.impact.choose")}</p>
      ) : (
        <QueryState query={impact}>
          {(r) => (
            <div data-impact-root={`${r.recordType}:${r.recordId}`}>
              <p className="small" data-hidden-count={r.hiddenCount}>
                <Icon name="lock" /> {t("traceability.impact.hidden", { n: r.hiddenCount })}
              </p>
              <h3 className="card__subtitle">{t("traceability.impact.records")}</h3>
              {r.records.length === 0 ? (
                <p className="muted" data-impact-empty>
                  {t("traceability.impact.noRecords")}
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="table table--compact" data-impact-records={r.records.length}>
                    <caption className="visually-hidden">{t("traceability.impact.records")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("traceability.orphans.record")}</th>
                        <th scope="col">{t("traceability.orphans.recordType")}</th>
                        <th scope="col">{t("traceability.impact.distance")}</th>
                        <th scope="col">{t("traceability.impact.path")}</th>
                        <th scope="col">{t("traceability.impact.value")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.records.map((x) => (
                        <tr key={`${x.recordType}-${x.recordId}`} data-impact-record={x.recordType}>
                          <th scope="row">
                            <Link className="link" to={recordWebPath(x.recordType, x.recordId, ws.tid, graph)}>
                              <RecordName code={x.code} label={x.label} />
                            </Link>
                          </th>
                          <td>{nodeTypeText(t, x.recordType)}</td>
                          <td>
                            <bdi dir="ltr">{x.distance}</bdi>
                          </td>
                          <td className="small">
                            {x.edgeKinds.map((k) => t(`traceability.edgeKind.${k}`, { defaultValue: k })).join(" → ")}
                          </td>
                          <td>
                            {x.valueAffected ? (
                              <StatusTag tone="warn">{t("traceability.impact.valueAffected")}</StatusTag>
                            ) : (
                              <span className="muted">{t("traceability.impact.noValue")}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <h3 className="card__subtitle">{t("traceability.impact.dashboards")}</h3>
              {r.dashboards.length === 0 ? (
                <p className="muted">{t("traceability.impact.noDashboards")}</p>
              ) : (
                <ul data-impact-dashboards={r.dashboards.length}>
                  {r.dashboards.map((d) => (
                    <li
                      key={`${d.dashboard}-${d.areaCode ?? ""}-${d.workstreamId ?? ""}-${d.transformationId ?? ""}`}
                      data-impact-dashboard={d.dashboard}
                      data-impact-area={d.areaCode ?? ""}
                    >
                      <Link className="link" to={DASHBOARD_PATH(d, ws.tid)}>
                        {t(`dashboards.kind.${d.dashboard}.title`)}
                      </Link>
                      {d.areaCode ? (
                        <span>
                          {" "}
                          · {t("traceability.impact.area")}: {t(`traceability.area.${d.areaCode}`)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {r.nextCursor || cursor ? (
                <nav className="pager" aria-label={t("traceability.impact.pages")}>
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    disabled={!cursor}
                    onClick={() => setCursor(null)}
                  >
                    {t("traceability.first")}
                  </button>
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    disabled={!r.nextCursor}
                    onClick={() => setCursor(r.nextCursor)}
                  >
                    {t("traceability.next")}
                  </button>
                </nav>
              ) : null}
            </div>
          )}
        </QueryState>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ allocation sets

interface ShareTarget {
  readonly linkTable: "trace_link" | "initiative_outcome_contribution";
  readonly linkId: string;
  readonly fromId: string;
  readonly share: string | null;
  readonly basis: string | null;
  /** Known for allocation-set members; else read when the dialog opens. */
  readonly version?: number;
}

export function AllocationPanel({ graph }: { graph: TraceabilityGraph | null }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const sel = useTraceSelection();
  const target =
    sel.alloc && (sel.alloc.type === "outcome_kpi" || sel.alloc.type === "benefit")
      ? { type: sel.alloc.type as AllocationTargetType, id: sel.alloc.id }
      : null;
  const set = useAllocationSet(ws.tid, target);
  const [editing, setEditing] = useState<ShareTarget | null>(null);
  const [creating, setCreating] = useState(false);
  const canLink = ws.can("traceability.link");
  const targets = (graph?.nodes ?? []).filter((n) => n.recordType === "outcome_kpi" || n.recordType === "benefit");
  // Links into the target that carry no share yet (from the graph), so a share can be set on them too.
  const withoutShare = target
    ? (graph?.edges ?? []).filter(
        (e) =>
          e.toId === target.id &&
          e.allocationShare === null &&
          (e.edgeKind === "capability_kpi" || e.edgeKind === "initiative_kpi" || e.edgeKind === "kpi_benefit"),
      )
    : [];
  return (
    <Section
      id="trace-allocation"
      title={t("traceability.allocation.title")}
      intro={t("traceability.allocation.intro")}
      actions={
        canLink && target ? (
          <button
            type="button"
            className="button button--primary"
            data-action="add-share"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" /> {t("traceability.allocation.add")}
          </button>
        ) : null
      }
    >
      <div className="filters">
        <div className="filters__select">
          <label htmlFor="alloc-target">{t("traceability.allocation.target")}</label>
          <select
            id="alloc-target"
            value={target ? `${target.type}:${target.id}` : ""}
            onChange={(e) => {
              const [type, id] = e.target.value.split(":", 2);
              sel.set("alloc", type && id ? { type, id } : null);
            }}
          >
            <option value="">{t("common.form.choose")}</option>
            {targets.map((n) => (
              <option key={n.recordId} value={`${n.recordType}:${n.recordId}`}>
                {nodeTypeText(t, n.recordType)}:{" "}
                {[n.code, n.label].filter(Boolean).join(" ") || t("traceability.noLabel")}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!target ? (
        <p className="muted">{t("traceability.allocation.choose")}</p>
      ) : (
        <QueryState query={set}>
          {(s) => (
            <div data-allocation-set={`${s.targetType}:${s.targetId}`}>
              <dl className="chip-row" data-total={s.total} data-unallocated={s.unallocatedShare}>
                <div>
                  <dt className="small muted">{t("traceability.allocation.total")}</dt>
                  <dd>
                    <strong>
                      <Pct share={s.total} />
                    </strong>
                  </dd>
                </div>
                <div>
                  <dt className="small muted">{t("traceability.allocation.unallocated")}</dt>
                  <dd>
                    <strong>
                      <Pct share={s.unallocatedShare} />
                    </strong>
                  </dd>
                </div>
              </dl>
              {s.members.length === 0 ? (
                <p className="muted" data-allocation-empty>
                  {t("traceability.allocation.none")}
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="table table--compact">
                    <caption className="visually-hidden">{t("traceability.allocation.members")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("traceability.allocation.from")}</th>
                        <th scope="col">{t("traceability.allocation.via")}</th>
                        <th scope="col">{t("traceability.allocation.share")}</th>
                        <th scope="col">{t("traceability.allocation.basis")}</th>
                        <th scope="col">{t("traceability.col.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.members.map((m) => (
                        <tr key={m.linkId} data-member={m.linkId}>
                          <th scope="row">
                            {nodeTypeText(t, m.fromType)}: <RecordName {...nodeName(graph, m.fromId)} />
                          </th>
                          <td>{t(`traceability.linkTable.${m.linkTable}`)}</td>
                          <td>
                            <Pct share={m.allocationShare} />
                          </td>
                          <td>
                            <TextCell value={m.allocationBasis} />
                          </td>
                          <td>
                            {canLink ? (
                              <button
                                type="button"
                                className="button button--secondary button--small"
                                data-action="edit-share"
                                onClick={() =>
                                  setEditing({
                                    linkTable: m.linkTable,
                                    linkId: m.linkId,
                                    fromId: m.fromId,
                                    share: m.allocationShare,
                                    basis: m.allocationBasis,
                                    version: m.version,
                                  })
                                }
                              >
                                <Icon name="pencil" /> {t("traceability.allocation.change")}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {withoutShare.length > 0 ? (
                <>
                  <h3 className="card__subtitle">{t("traceability.allocation.withoutShare")}</h3>
                  <ul>
                    {withoutShare.map((e) => (
                      <li key={e.linkId} data-unshared={e.linkId}>
                        {nodeTypeText(t, e.fromType)}: <RecordName {...nodeName(graph, e.fromId)} />{" "}
                        <span className="muted">({t("traceability.allocation.noShare")})</span>{" "}
                        {canLink ? (
                          <button
                            type="button"
                            className="button button--link button--small"
                            data-action="set-share"
                            onClick={() =>
                              setEditing({
                                linkTable:
                                  e.linkTable === "initiative_outcome_contribution"
                                    ? "initiative_outcome_contribution"
                                    : "trace_link",
                                linkId: e.linkId,
                                fromId: e.fromId,
                                share: null,
                                basis: null,
                              })
                            }
                          >
                            {t("traceability.allocation.setShare")}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          )}
        </QueryState>
      )}
      {editing ? <ShareDialog target={editing} set={set.data ?? null} onClose={() => setEditing(null)} /> : null}
      {creating && target ? (
        <TraceLinkDialog
          graph={graph}
          preset={{ kind: target.type === "benefit" ? "kpi_benefit" : "capability_kpi", toId: target.id }}
          set={set.data ?? null}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </Section>
  );
}

/** The version of a link without a share, read when its share dialog opens (If-Match needs it). */
function useLinkVersion(tid: string, target: ShareTarget) {
  return useQuery({
    queryKey: ["p4", "traceability", tid, "link-version", target.linkTable, target.linkId],
    queryFn: async () => {
      if (target.linkTable === "trace_link")
        return (await api.get<TraceLink>(tracePaths.link(tid, target.linkId))).version;
      const list = await api.get<{ items: { id: string; version: number }[] }>(
        `/api/v1/initiatives/${target.fromId}/outcome-contributions`,
      );
      const row = list.items.find((x) => x.id === target.linkId);
      if (!row) throw new Error("contribution not found");
      return row.version;
    },
    enabled: target.version === undefined,
    retry: false,
  });
}

function ShareDialog({
  target,
  set,
  onClose,
}: {
  target: ShareTarget;
  set: AllocationSet | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const version = useLinkVersion(ws.tid, target);
  const [preview, setPreview] = useState<string | null>(null);
  const v = target.version ?? version.data;
  if (v === undefined) {
    return version.isError ? (
      <p className="banner banner--error" role="alert">
        <Icon name="alert" /> {t("traceability.allocation.versionUnavailable")}
      </p>
    ) : (
      <LoadingState />
    );
  }
  const fields: P4FieldSpec[] = [
    {
      name: "allocationShare",
      label: t("traceability.allocation.shareField"),
      hint: t("traceability.allocation.shareHint"),
      kind: "text",
      ltr: true,
    },
    { name: "allocationBasis", label: t("traceability.allocation.basis"), kind: "textarea", max: 1000 },
  ];
  const initial: P4Values = { allocationShare: target.share ?? "", allocationBasis: target.basis ?? "" };
  const isContribution = target.linkTable === "initiative_outcome_contribution";
  return (
    <P4FormDialog
      title={t("traceability.allocation.changeTitle")}
      fields={fields}
      initial={initial}
      submitLabel={t("traceability.save")}
      method={isContribution ? "POST" : "PATCH"}
      url={
        isContribution
          ? tracePaths.contributionAllocation(target.fromId, target.linkId)
          : tracePaths.link(ws.tid, target.linkId)
      }
      version={v}
      namespaces={NS}
      onValuesChange={(vals) => setPreview(wouldTotal(set, target.linkId, String(vals["allocationShare"] ?? "")))}
      note={
        preview ? (
          <p className="small" role="status" data-would-total={preview}>
            {t("traceability.allocation.preview")} <Pct share={preview} />
          </p>
        ) : null
      }
      alertExtra={(e) =>
        e instanceof ApiError && e.code === "trace_link.allocation_exceeds_total" && preview ? (
          <p className="small" data-refused-total={preview}>
            {t("traceability.allocation.wouldTotal")} <Pct share={preview} />
          </p>
        ) : null
      }
      toBody={(vals) => {
        const share = String(vals["allocationShare"] ?? "").trim();
        const err = shareError(share);
        if (err) return { fieldErrors: { allocationShare: err } };
        const basis = textOf(vals["allocationBasis"]) ?? null;
        return { allocationShare: share === "" ? null : share, allocationBasis: basis };
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

// ------------------------------------------------------------------------------------------------ trace links

export function TraceLinksPanel({ graph }: { graph: TraceabilityGraph | null }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const list = useTraceLinks(ws.tid, includeRemoved);
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "edit"; row: TraceLink } | null>(null);
  const [removing, setRemoving] = useState<TraceLink | null>(null);
  const canLink = ws.can("traceability.link");
  const ends = (l: TraceLink) => {
    const ids: Record<string, string | null> = {
      diagnostic_finding: l.diagnosticFindingId,
      tom_gap: l.tomGapId,
      deliverable: l.deliverableId,
      capability: l.capabilityId,
      outcome_kpi: l.outcomeKpiId,
      benefit: l.benefitId,
    };
    const e = TRACE_LINK_ENDS[l.linkKind];
    return { from: { type: e.from, id: ids[e.from] ?? null }, to: { type: e.to, id: ids[e.to] ?? null } };
  };
  const end = (x: { type: string; id: string | null }) => (
    <span>
      <span className="small muted">{nodeTypeText(t, x.type)}: </span>
      {x.id ? (
        <Link className="link" to={recordWebPath(x.type, x.id, ws.tid, graph)}>
          <RecordName {...nodeName(graph, x.id)} />
        </Link>
      ) : (
        <span className="muted">{t("traceability.noLabel")}</span>
      )}
    </span>
  );
  const columns: RegisterColumn<TraceLink>[] = [
    {
      id: "kind",
      header: t("traceability.links.kind"),
      rowHeader: true,
      hideable: false,
      cell: (l) => t(`traceability.linkKind.${l.linkKind}`),
      sortValue: (l) => TRACE_LINK_KINDS.indexOf(l.linkKind),
      filterText: (l) => t(`traceability.linkKind.${l.linkKind}`),
    },
    { id: "from", header: t("traceability.allocation.from"), cell: (l) => end(ends(l).from) },
    { id: "to", header: t("traceability.links.to"), cell: (l) => end(ends(l).to) },
    {
      id: "statement",
      header: t("traceability.links.statement"),
      cell: (l) => <TextCell value={l.contributionStatement} />,
      sortValue: (l) => l.contributionStatement,
    },
    {
      id: "share",
      header: t("traceability.allocation.share"),
      cell: (l) =>
        l.allocationShare ? (
          <Pct share={l.allocationShare} />
        ) : (
          <span className="muted">{t("traceability.allocation.noShare")}</span>
        ),
      sortValue: (l) => l.allocationShare,
    },
    {
      id: "status",
      header: t("traceability.col.status"),
      cell: (l) =>
        l.status === "removed" ? (
          <span className="block">
            <StatusTag tone="info">{t("traceability.links.removed")}</StatusTag>
            {l.removeReason ? <span className="block small">{l.removeReason}</span> : null}
          </span>
        ) : (
          <StatusTag tone="ok">{t("traceability.links.active")}</StatusTag>
        ),
      sortValue: (l) => l.status,
      filterText: (l) => t(`traceability.links.${l.status}`),
    },
    {
      id: "rowActions",
      header: t("traceability.col.actions"),
      hideable: false,
      cell: (l) =>
        canLink && l.status === "active" ? (
          <span className="chip-row">
            <button
              type="button"
              className="button button--secondary button--small"
              data-action="edit-link"
              onClick={() => setDialog({ kind: "edit", row: l })}
            >
              <Icon name="pencil" /> {t("traceability.edit")}
            </button>
            <button
              type="button"
              className="button button--secondary button--small"
              data-action="remove-link"
              onClick={() => setRemoving(l)}
            >
              <Icon name="archive" /> {t("traceability.links.remove")}
            </button>
          </span>
        ) : null,
    },
  ];
  return (
    <Section
      id="trace-links"
      title={t("traceability.links.title")}
      intro={t("traceability.links.intro")}
      actions={
        canLink ? (
          <button
            type="button"
            className="button button--primary"
            data-action="create-link"
            onClick={() => setDialog({ kind: "create" })}
          >
            <Icon name="plus" /> {t("traceability.links.create")}
          </button>
        ) : null
      }
    >
      <label className="checkbox">
        <input type="checkbox" checked={includeRemoved} onChange={(e) => setIncludeRemoved(e.target.checked)} />{" "}
        {t("traceability.links.includeRemoved")}
      </label>
      <QueryState query={list}>
        {(rows) => (
          <RegisterTable
            id="trace-links"
            caption={t("traceability.links.title")}
            rows={rows}
            columns={columns}
            getRowId={(l) => l.id}
            emptyTitle={t("traceability.links.empty")}
            defaultSort={{ id: "kind", dir: "asc" }}
          />
        )}
      </QueryState>
      {dialog?.kind === "create" ? <TraceLinkDialog graph={graph} set={null} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "edit" ? (
        <TraceLinkDialog graph={graph} link={dialog.row} set={null} onClose={() => setDialog(null)} />
      ) : null}
      {removing ? (
        <ReasonAction
          title={t("traceability.links.removeTitle")}
          description={t("traceability.links.removeBody")}
          submitLabel={t("traceability.links.remove")}
          url={tracePaths.removeLink(ws.tid, removing.id)}
          version={removing.version}
          onDone={refresh}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </Section>
  );
}

/** Create a trace link (kind, the two records, statement, optional share) or edit one (statement, share, basis). */
export function TraceLinkDialog({
  graph,
  link,
  preset,
  set,
  onClose,
}: {
  graph: TraceabilityGraph | null;
  link?: TraceLink;
  preset?: { kind: TraceLinkKind; toId: string };
  set: AllocationSet | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const [kind, setKind] = useState<TraceLinkKind | "">(link?.linkKind ?? preset?.kind ?? "");
  const [preview, setPreview] = useState<string | null>(null);
  const options = (type: string) =>
    (graph?.nodes ?? [])
      .filter((n) => n.recordType === type)
      .map((n) => ({
        value: n.recordId,
        label: [n.code, n.label].filter(Boolean).join(" ") || t("traceability.noLabel"),
      }));
  const shareKind = kind !== "" && SHARE_LINK_KINDS.has(kind);
  const fields: P4FieldSpec[] = link
    ? [
        {
          name: "contributionStatement",
          label: t("traceability.links.statement"),
          kind: "textarea",
          required: true,
          max: 2000,
        },
        ...(SHARE_LINK_KINDS.has(link.linkKind)
          ? ([
              {
                name: "allocationShare",
                label: t("traceability.allocation.shareField"),
                hint: t("traceability.allocation.shareHint"),
                kind: "text",
                ltr: true,
              },
              { name: "allocationBasis", label: t("traceability.allocation.basis"), kind: "textarea", max: 1000 },
            ] satisfies P4FieldSpec[])
          : []),
      ]
    : [
        {
          name: "linkKind",
          label: t("traceability.links.kind"),
          kind: "select",
          required: true,
          options: TRACE_LINK_KINDS.map((k) => ({ value: k, label: t(`traceability.linkKind.${k}`) })),
        },
        ...(kind
          ? ([
              {
                name: "fromId",
                label: t("traceability.links.fromField", { type: nodeTypeText(t, TRACE_LINK_ENDS[kind].from) }),
                kind: "select",
                required: true,
                options: options(TRACE_LINK_ENDS[kind].from),
              },
              {
                name: "toId",
                label: t("traceability.links.toField", { type: nodeTypeText(t, TRACE_LINK_ENDS[kind].to) }),
                kind: "select",
                required: true,
                options: options(TRACE_LINK_ENDS[kind].to),
              },
            ] satisfies P4FieldSpec[])
          : []),
        {
          name: "contributionStatement",
          label: t("traceability.links.statement"),
          hint: t("traceability.links.statementHint"),
          kind: "textarea",
          required: true,
          max: 2000,
        },
        ...(shareKind
          ? ([
              {
                name: "allocationShare",
                label: t("traceability.allocation.shareField"),
                hint: t("traceability.allocation.shareHint"),
                kind: "text",
                ltr: true,
              },
              { name: "allocationBasis", label: t("traceability.allocation.basis"), kind: "textarea", max: 1000 },
            ] satisfies P4FieldSpec[])
          : []),
      ];
  const initial: P4Values = link
    ? {
        contributionStatement: link.contributionStatement,
        allocationShare: link.allocationShare ?? "",
        allocationBasis: link.allocationBasis ?? "",
      }
    : { linkKind: preset?.kind ?? "", toId: preset?.toId ?? "" };
  return (
    <P4FormDialog
      title={link ? t("traceability.links.editTitle") : t("traceability.links.create")}
      fields={fields}
      initial={initial}
      submitLabel={link ? t("traceability.save") : t("traceability.links.createSubmit")}
      method={link ? "PATCH" : "POST"}
      url={link ? tracePaths.link(ws.tid, link.id) : tracePaths.links(ws.tid)}
      {...(link ? { version: link.version } : {})}
      namespaces={NS}
      onValuesChange={(v) => {
        if (!link) setKind((v["linkKind"] as TraceLinkKind | "") ?? "");
        setPreview(wouldTotal(set, link?.id ?? null, String(v["allocationShare"] ?? "")));
      }}
      note={
        preview && set ? (
          <p className="small" role="status" data-would-total={preview}>
            {t("traceability.allocation.preview")} <Pct share={preview} />
          </p>
        ) : null
      }
      alertExtra={(e) =>
        e instanceof ApiError && e.code === "trace_link.allocation_exceeds_total" && preview ? (
          <p className="small" data-refused-total={preview}>
            {t("traceability.allocation.wouldTotal")} <Pct share={preview} />
          </p>
        ) : null
      }
      toBody={(v) => {
        const share = String(v["allocationShare"] ?? "").trim();
        const err = shareError(share);
        if (err) return { fieldErrors: { allocationShare: err } };
        const basis = textOf(v["allocationBasis"]) ?? null;
        if (basis && share === "") return { fieldErrors: { allocationBasis: "validation.basis_needs_share" } };
        if (link) {
          const patch: Record<string, unknown> = {};
          if (v["contributionStatement"] !== link.contributionStatement)
            patch["contributionStatement"] = v["contributionStatement"];
          if (SHARE_LINK_KINDS.has(link.linkKind)) {
            if ((share || null) !== link.allocationShare) patch["allocationShare"] = share || null;
            if (basis !== link.allocationBasis) patch["allocationBasis"] = basis;
          }
          return Object.keys(patch).length === 0
            ? { fieldErrors: { contributionStatement: "validation.empty_patch" } }
            : patch;
        }
        return {
          linkKind: v["linkKind"],
          fromId: v["fromId"],
          toId: v["toId"],
          contributionStatement: v["contributionStatement"],
          ...(shareKind && share ? { allocationShare: share } : {}),
          ...(shareKind && basis ? { allocationBasis: basis } : {}),
        };
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}
