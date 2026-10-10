// Traceability (T-DG4-FE-G2; p4-work-split §J+K JK.7; ADR-0038 §1-§6). SYNTHETIC data only in tests and demos.
//  - The chain graph (finding → gap → initiative → deliverable → capability → outcome → outcome KPI → benefit) is shown
//    as one column per node type in chain order; every node is a link that opens its record's screen (REQ-PB-044), and
//    lists the records it links to and from. A link whose other end is not in the answer is counted, never listed.
//  - The orphan report lists records with a missing upstream or downstream step and the expected step.
//  - The impact panel, the allocation sets and the trace links are in TracePanels.tsx.
// Nothing here is stored: each read is computed by the server on request (ADR-0038 §4–§6).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { TRACE_DIRECTIONS, TRACE_NODE_TYPES } from "@mth/shared/schemas";
import { Icon } from "../../components/Icon.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import {
  useOrphans,
  useTraceGraph,
  type OrphanItem,
  type TraceabilityGraph,
  type TraceDirection,
  type TraceNodeType,
} from "./api.ts";
import { AllocationPanel, ImpactPanel, TraceLinksPanel } from "./TracePanels.tsx";
import {
  CHAIN_ORDER,
  expectedText,
  nodeTypeText,
  Pct,
  recordWebPath,
  RecordName,
  StatusTag,
  TraceSubNav,
} from "./ui.tsx";

export function TraceabilityPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="traceability"
      title={t("traceability.title")}
      subtitle={t("traceability.intro")}
      writePermissions={["traceability.link"]}
    >
      <TraceabilityBody />
    </WorkspaceFrame>
  );
}

/** The panel selection kept in the URL (`?root=type:id&impact=type:id&alloc=type:id`), so a view can be shared. */
export function useTraceSelection() {
  const [params, setParams] = useSearchParams();
  const parse = (name: string) => {
    const v = params.get(name);
    if (!v) return null;
    const [type, id] = v.split(":", 2);
    return type && id ? { type, id } : null;
  };
  const set = (name: string, value: { type: string; id: string } | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(name, `${value.type}:${value.id}`);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
  return { root: parse("root"), impact: parse("impact"), alloc: parse("alloc"), set };
}

function TraceabilityBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const sel = useTraceSelection();
  const [direction, setDirection] = useState<TraceDirection>("both");
  const [depth, setDepth] = useState(8);
  const root = sel.root && (TRACE_NODE_TYPES as readonly string[]).includes(sel.root.type) ? sel.root : null;
  const graph = useTraceGraph(ws.tid, {
    rootType: root?.type as TraceNodeType | undefined,
    rootId: root?.id,
    direction,
    depth,
  });
  const whole = useTraceGraph(ws.tid);
  return (
    <>
      <TraceSubNav tid={ws.tid} />
      <Section id="trace-graph" title={t("traceability.graph.title")} intro={t("traceability.graph.intro")}>
        <div className="filters" role="group" aria-label={t("traceability.graph.controls")}>
          <div className="filters__select">
            <label htmlFor="trace-direction">{t("traceability.graph.direction")}</label>
            <select
              id="trace-direction"
              value={direction}
              disabled={!root}
              onChange={(e) => setDirection(e.target.value as TraceDirection)}
            >
              {TRACE_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {t(`traceability.direction.${d}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="filters__select">
            <label htmlFor="trace-depth">{t("traceability.graph.depth")}</label>
            <select id="trace-depth" value={depth} disabled={!root} onChange={(e) => setDepth(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          {root ? (
            <button
              type="button"
              className="button button--secondary button--small"
              data-action="clear-root"
              onClick={() => sel.set("root", null)}
            >
              <Icon name="cross" /> {t("traceability.graph.clearRoot")}
            </button>
          ) : null}
        </div>
        {root ? (
          <p className="small" role="note" data-root={`${root.type}:${root.id}`}>
            {t("traceability.graph.rooted", {
              type: nodeTypeText(t, root.type),
              name:
                whole.data?.nodes.find((n) => n.recordId === root.id)?.label ??
                whole.data?.nodes.find((n) => n.recordId === root.id)?.code ??
                "…",
            })}
          </p>
        ) : null}
        <QueryState query={graph}>{(g) => <TraceGraphView graph={g} />}</QueryState>
      </Section>
      <OrphanReport />
      <ImpactPanel graph={whole.data ?? null} />
      <AllocationPanel graph={whole.data ?? null} />
      <TraceLinksPanel graph={whole.data ?? null} />
    </>
  );
}

/** The graph as columns in chain order; each node opens its record, and lists what it links to and from. */
export function TraceGraphView({ graph }: { graph: TraceabilityGraph }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const sel = useTraceSelection();
  const byId = new Map(graph.nodes.map((n) => [n.recordId, n]));
  // Edges whose other end is not in the answer (outside the depth, or a record the caller cannot read) are counted.
  const unseen = graph.edges.filter((e) => !byId.has(e.fromId) || !byId.has(e.toId)).length;
  if (graph.nodes.length === 0)
    return <EmptyState title={t("traceability.graph.empty")} body={t("traceability.graph.emptyBody")} />;
  return (
    <>
      <p className="small" data-graph-counts={`${graph.nodes.length}:${graph.edges.length}`}>
        {t("traceability.graph.counts", { nodes: graph.nodes.length, edges: graph.edges.length })}
      </p>
      {graph.truncated ? (
        <p className="banner banner--info" role="note" data-truncated>
          <Icon name="info" /> {t("traceability.graph.truncated")}
        </p>
      ) : null}
      {unseen > 0 ? (
        <p className="banner banner--info" role="note" data-hidden-count={unseen}>
          <Icon name="lock" /> {t("traceability.graph.unseen", { n: unseen })}
        </p>
      ) : null}
      <div className="grid grid--3" data-trace-graph>
        {CHAIN_ORDER.map((type) => {
          const nodes = graph.nodes.filter((n) => n.recordType === type);
          if (nodes.length === 0) return null;
          return (
            <section key={type} className="card" data-node-type={type} aria-labelledby={`trace-col-${type}`}>
              <h3 id={`trace-col-${type}`} className="card__subtitle">
                {nodeTypeText(t, type)} <span className="muted">({nodes.length})</span>
              </h3>
              <ul className="plain-list">
                {nodes.map((n) => {
                  const out = graph.edges.filter((e) => e.fromId === n.recordId && byId.has(e.toId));
                  const into = graph.edges.filter((e) => e.toId === n.recordId && byId.has(e.fromId));
                  const valueBearing = n.recordType === "outcome_kpi" || n.recordType === "benefit";
                  return (
                    <li key={n.recordId} className="trace-node" data-node={n.recordId}>
                      <Link
                        className="link"
                        to={recordWebPath(n.recordType, n.recordId, ws.tid, graph)}
                        data-node-link={n.recordType}
                      >
                        <RecordName code={n.code} label={n.label} />
                      </Link>
                      {n.status ? (
                        <span className="small muted">
                          {" "}
                          · {t(`traceability.recordStatus.${n.status}`, { defaultValue: n.status })}
                        </span>
                      ) : null}
                      <div className="chip-row">
                        {n.orphan.upstream ? (
                          <StatusTag tone="warn">{t("traceability.orphan.upstream")}</StatusTag>
                        ) : null}
                        {n.orphan.downstream ? (
                          <StatusTag tone="warn">{t("traceability.orphan.downstream")}</StatusTag>
                        ) : null}
                        {n.allocation ? (
                          <span className="small" data-allocation-total={n.allocation.total}>
                            {t("traceability.allocation.short")} <Pct share={n.allocation.total} /> ·{" "}
                            {t("traceability.allocation.unallocated")} <Pct share={n.allocation.unallocatedShare} />
                          </span>
                        ) : null}
                      </div>
                      {into.length + out.length > 0 ? (
                        <details className="small">
                          <summary>{t("traceability.graph.links", { into: into.length, out: out.length })}</summary>
                          <ul>
                            {into.map((e) => (
                              <li key={`i-${e.linkId}-${e.edgeKind}`}>
                                {t("traceability.graph.from")} {nodeTypeText(t, e.fromType)}:{" "}
                                <RecordName code={byId.get(e.fromId)!.code} label={byId.get(e.fromId)!.label} />
                                {e.allocationShare ? (
                                  <>
                                    {" "}
                                    (<Pct share={e.allocationShare} />)
                                  </>
                                ) : null}
                              </li>
                            ))}
                            {out.map((e) => (
                              <li key={`o-${e.linkId}-${e.edgeKind}`}>
                                {t("traceability.graph.to")} {nodeTypeText(t, e.toType)}:{" "}
                                <RecordName code={byId.get(e.toId)!.code} label={byId.get(e.toId)!.label} />
                                {e.allocationShare ? (
                                  <>
                                    {" "}
                                    (<Pct share={e.allocationShare} />)
                                  </>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      <div className="chip-row">
                        <button
                          type="button"
                          className="button button--link button--small"
                          data-action="focus"
                          onClick={() => sel.set("root", { type: n.recordType, id: n.recordId })}
                        >
                          {t("traceability.graph.focus")}
                          <span className="visually-hidden"> {n.code ?? n.label ?? ""}</span>
                        </button>
                        <a
                          className="button button--link button--small"
                          href="#trace-impact"
                          data-action="impact"
                          onClick={() => sel.set("impact", { type: n.recordType, id: n.recordId })}
                        >
                          {t("traceability.graph.impact")}
                          <span className="visually-hidden"> {n.code ?? n.label ?? ""}</span>
                        </a>
                        {valueBearing ? (
                          <a
                            className="button button--link button--small"
                            href="#trace-allocation"
                            data-action="allocation"
                            onClick={() => sel.set("alloc", { type: n.recordType, id: n.recordId })}
                          >
                            {t("traceability.graph.allocation")}
                            <span className="visually-hidden"> {n.code ?? n.label ?? ""}</span>
                          </a>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ orphan report

function OrphanReport() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [filters, setFilters] = useState({ recordType: "", missing: "" });
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const page = useOrphans(ws.tid, filters, cursor);
  const setFilter = (k: "recordType" | "missing", v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setCursors([null]);
  };
  return (
    <Section id="trace-orphans" title={t("traceability.orphans.title")} intro={t("traceability.orphans.intro")}>
      <div className="filters" role="group" aria-label={t("traceability.orphans.filters")}>
        <div className="filters__select">
          <label htmlFor="orphan-type">{t("traceability.orphans.recordType")}</label>
          <select id="orphan-type" value={filters.recordType} onChange={(e) => setFilter("recordType", e.target.value)}>
            <option value="">{t("traceability.all")}</option>
            {CHAIN_ORDER.map((ty) => (
              <option key={ty} value={ty}>
                {nodeTypeText(t, ty)}
              </option>
            ))}
          </select>
        </div>
        <div className="filters__select">
          <label htmlFor="orphan-missing">{t("traceability.orphans.missing")}</label>
          <select id="orphan-missing" value={filters.missing} onChange={(e) => setFilter("missing", e.target.value)}>
            <option value="">{t("traceability.all")}</option>
            {TRACE_DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {t(`traceability.missing.${d}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <QueryState query={page}>
        {(p) =>
          p.items.length === 0 ? (
            <EmptyState title={t("traceability.orphans.empty")} body={t("traceability.orphans.emptyBody")} />
          ) : (
            <>
              <div className="table-wrap">
                <table className="table table--compact" data-orphan-report>
                  <caption className="visually-hidden">{t("traceability.orphans.title")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("traceability.orphans.record")}</th>
                      <th scope="col">{t("traceability.orphans.recordType")}</th>
                      <th scope="col">{t("traceability.orphans.missing")}</th>
                      <th scope="col">{t("traceability.orphans.expected")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.items.map((o: OrphanItem) => (
                      <tr key={`${o.recordType}-${o.recordId}`} data-orphan={o.recordType} data-orphan-id={o.recordId}>
                        <th scope="row">
                          <Link className="link" to={recordWebPath(o.recordType, o.recordId, ws.tid)}>
                            <RecordName code={o.code} label={o.label} />
                          </Link>
                        </th>
                        <td>{nodeTypeText(t, o.recordType)}</td>
                        <td>
                          <StatusTag tone="warn">{t(`traceability.missing.${o.missing}`)}</StatusTag>
                        </td>
                        <td data-expected={o.expected.join("|")}>
                          {o.expected.map((x) => (
                            <span key={x} className="block">
                              {expectedText(t, x)}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <nav className="pager" aria-label={t("traceability.orphans.pages")}>
                <button
                  type="button"
                  className="button button--secondary button--small"
                  disabled={cursors.length <= 1}
                  onClick={() => setCursors((c) => c.slice(0, -1))}
                >
                  {t("traceability.previous")}
                </button>
                <button
                  type="button"
                  className="button button--secondary button--small"
                  disabled={!p.nextCursor}
                  onClick={() => setCursors((c) => [...c, p.nextCursor])}
                >
                  {t("traceability.next")}
                </button>
              </nav>
            </>
          )
        }
      </QueryState>
    </Section>
  );
}
