// The transformation workspace header (T-DG4-FE-G; REQ-S03-011; ADR-0037 §9; M0114): the eight elements of
// `getWorkspaceHeader` (phase, gate readiness, North Star, owners, outcome health, benefits, key decisions, next
// required actions), each with an explicit Unknown where the server says the data is missing: never 0, never green.
// Below them, the contextual navigation: every link is built from the route's transformation, so the user never
// re-enters its id, and one click opens the transformation's RAID register filtered to it.
//  - Gate readiness is the live evaluation (through the server's WorkflowsReadPort). An inherited approval (Modular
//    entry) is evidence recorded before the platform, shown beside the gate's own status; it never approves the gate.
//  - Product gates G1–G6 are business approvals inside the product; nothing here is an engineering delivery gate.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { WorkspaceHeader as Header } from "@mth/shared/schemas";
import { InheritedApprovalBadge } from "../pages/gates/GatesPage.tsx";
import { useDecisions } from "../api/queries.ts";
import { useWorkspaceHeader } from "../pages/dashboards/api.ts";
import { RagStatusChip, RecordLink, ValueView, keyText } from "../pages/dashboards/ui.tsx";
import { useItemText } from "../pages/dashboards/MyWorkSections.tsx";
import { DueDate } from "../pages/my-work/p4ui.tsx";
import { PhaseStepper } from "../pages/transformations/common.tsx";
import { Unknown } from "./Badges.tsx";
import { Icon } from "./Icon.tsx";
import { GateStatusChip } from "./P2Badges.tsx";

/** The contextual links of the workspace (ADR-0037 §9), in the order a reader scans them. */
export const HEADER_LINKS = [
  { id: "raid", path: "/raid", labelKey: "dashboards.header.link.raid" },
  { id: "dashboard", path: "/dashboard", labelKey: "dashboards.header.link.dashboard" },
  { id: "kpis", path: "/kpis", labelKey: "dashboards.header.link.kpis" },
  { id: "benefits", path: "/benefits", labelKey: "dashboards.header.link.benefits" },
  { id: "decisions", path: "/executive-decisions", labelKey: "dashboards.header.link.decisions" },
  { id: "gates", path: "/gates", labelKey: "dashboards.header.link.gates" },
] as const;

/**
 * The header card. `fallback` renders the phase from the transformation record while the header loads or fails, so
 * the phase stepper (never Unknown: NOT NULL columns) is always there.
 */
export function WorkspaceHeader({
  tid,
  currentPhase,
  entryPhase,
}: {
  tid: string;
  currentPhase: Header["phase"]["currentPhase"];
  entryPhase: Header["phase"]["entryPhase"];
}) {
  const { t } = useTranslation();
  const query = useWorkspaceHeader(tid);
  const h = query.data;
  return (
    <section className="workspace-header card" aria-labelledby="ws-title" data-workspace-header>
      <h2 id="ws-title" className="visually-hidden">
        {t("transformations.workspace.title")}
      </h2>
      <div className="workspace-header__phase">
        <h3 className="workspace-header__label">{t("transformations.workspace.phase")}</h3>
        <PhaseStepper current={h?.phase.currentPhase ?? currentPhase} entry={h?.phase.entryPhase ?? entryPhase} />
        {h ? (
          <span className="small muted" data-mode={h.phase.mode}>
            {t(`transformations.mode.${h.phase.mode}`)}
          </span>
        ) : null}
      </div>
      <nav className="chip-row" aria-label={t("dashboards.header.linksLabel")} data-header-links>
        {HEADER_LINKS.map((l) => (
          <Link
            key={l.id}
            className="button button--secondary button--small"
            to={`/transformations/${tid}${l.path}`}
            data-header-link={l.id}
          >
            {t(l.labelKey)}
          </Link>
        ))}
      </nav>
      {query.isPending ? (
        <p className="muted" aria-busy="true" data-state="loading">
          {t("common.state.loading")}
        </p>
      ) : query.isError && !h ? (
        <UnavailableGrid tid={tid} onRetry={() => void query.refetch()} />
      ) : h ? (
        <HeaderGrid h={h} tid={tid} />
      ) : null}
      <p className="muted small">{t("dashboards.header.unknownNote")}</p>
    </section>
  );
}

/**
 * The P2 design decisions of the transformation (open of total), linked to its Decisions tab: kept from the P2 header
 * beside the T16 asks of getWorkspaceHeader, so the existing contextual link is not lost.
 */
function DesignDecisionsLink({ tid }: { tid: string }) {
  const { t } = useTranslation();
  const decisions = useDecisions(tid, "design");
  if (decisions.isPending) return <span className="muted block small">{t("common.state.loading")}</span>;
  if (decisions.isError) return null;
  const open = decisions.data.filter((d) => d.status === "open").length;
  return (
    <Link className="link block small" to={`/transformations/${tid}/decisions`} data-design-decisions={open}>
      {t("transformations.workspace.openDecisions", { n: open, total: decisions.data.length })}
    </Link>
  );
}

/** The header could not be read (no permission, network): every element is Unknown, never a guessed value. */
function UnavailableGrid({ tid, onRetry }: { tid: string; onRetry: () => void }) {
  const { t } = useTranslation();
  const labels = [
    ["gateReadiness", "transformations.workspace.gateReadiness"],
    ["northStar", "transformations.workspace.northStar"],
    ["owners", "transformations.workspace.owners"],
    ["outcomeHealth", "transformations.workspace.outcomeHealth"],
    ["benefits", "transformations.workspace.benefits"],
    ["keyDecisions", "transformations.workspace.keyDecisions"],
    ["nextActions", "transformations.workspace.nextAction"],
  ] as const;
  return (
    <>
      <p className="small" data-state="header-unavailable">
        <Icon name="info" /> {t("dashboards.header.unavailable")}{" "}
        <button type="button" className="button button--link button--small" onClick={onRetry}>
          <Icon name="refresh" /> {t("common.action.retry")}
        </button>
      </p>
      <dl className="workspace-header__grid">
        {labels.map(([id, key]) => (
          <Element key={id} id={id} label={t(key)}>
            <Unknown hint={t("dashboards.header.unavailable")} />
            {id === "keyDecisions" ? <DesignDecisionsLink tid={tid} /> : null}
          </Element>
        ))}
      </dl>
    </>
  );
}

function Element({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div data-element={id}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function HeaderGrid({ h, tid }: { h: Header; tid: string }) {
  const { t } = useTranslation();
  const itemText = useItemText();
  const g = h.gateReadiness;
  return (
    <dl className="workspace-header__grid">
      <Element id="gateReadiness" label={t("transformations.workspace.gateReadiness")}>
        {g.state === "unknown" || g.gateCode === null ? (
          <Unknown hint={t("dashboards.header.gateUnknown")} />
        ) : (
          <span className="block" data-gate={g.gateCode} data-ready={String(g.ready)}>
            <Link className="link" to={`/transformations/${tid}/gates/${g.gateCode}`}>
              {g.gateCode}
            </Link>{" "}
            {g.status ? <GateStatusChip status={g.status} /> : null}
            {g.inheritedApproval ? (
              <span className="block">
                <InheritedApprovalBadge annotation={g.inheritedApproval} />
              </span>
            ) : null}
            <span className="block small" data-missing-mandatory={g.missingMandatoryCount ?? ""}>
              {g.ready
                ? t("dashboards.header.gateReady")
                : t("dashboards.header.gateMissing", { count: g.missingMandatoryCount ?? 0 })}
            </span>
          </span>
        )}
      </Element>
      <Element id="northStar" label={t("transformations.workspace.northStar")}>
        {h.northStar.state === "known" && h.northStar.statement ? (
          <q>{h.northStar.statement}</q>
        ) : (
          <Unknown hint={t("define.northStar.notSet")} />
        )}
      </Element>
      <Element id="owners" label={t("transformations.workspace.owners")}>
        <span className="block" data-owner="sponsor">
          {t("transformations.field.sponsor")}:{" "}
          {h.owners.sponsor ? (
            <bdi>{h.owners.sponsor.displayName}</bdi>
          ) : (
            <Unknown hint={t("dashboards.header.noOwner")} />
          )}
        </span>
        <span className="block" data-owner="lead">
          {t("transformations.field.lead")}:{" "}
          {h.owners.lead ? <bdi>{h.owners.lead.displayName}</bdi> : <Unknown hint={t("dashboards.header.noOwner")} />}
        </span>
      </Element>
      <Element id="outcomeHealth" label={t("transformations.workspace.outcomeHealth")}>
        <RagStatusChip status={h.outcomeHealth.rag.status} />
        <span className="block small muted">{keyText(t, "rule", h.outcomeHealth.rag.ruleKey)}</span>
        {h.outcomeHealth.counts.filter((c) => c.count > 0).length > 0 ? (
          <span className="block small" data-outcome-counts>
            {h.outcomeHealth.counts
              .filter((c) => c.count > 0)
              .map((c) =>
                t("dashboards.header.outcomeCount", { count: c.count, status: t(`dashboards.rag.${c.status}`) }),
              )
              .join(" · ")}
          </span>
        ) : null}
      </Element>
      <Element id="benefits" label={t("transformations.workspace.benefits")}>
        {h.benefits.state === "unknown" ? (
          <Unknown hint={t("dashboards.header.noBenefit")} />
        ) : (
          <>
            {h.benefits.planned.map((p) => (
              <span key={`p-${p.currency}`} className="block" data-benefit-planned={p.currency}>
                {t("dashboards.header.planned")}: <ValueView value={p.value} />
              </span>
            ))}
            {h.benefits.validated.map((v) => (
              <span key={`v-${v.currency}`} className="block" data-benefit-validated={v.currency}>
                {t("dashboards.header.validated")}: <ValueView value={v.value} />
              </span>
            ))}
            <span className="block small" data-benefit-count={h.benefits.benefitCount}>
              {t("dashboards.header.benefitCount", { count: h.benefits.benefitCount })}
              {h.benefits.nonFinancialCount > 0
                ? ` · ${t("dashboards.header.nonFinancial", { count: h.benefits.nonFinancialCount })}`
                : ""}
            </span>
          </>
        )}
      </Element>
      <Element id="keyDecisions" label={t("transformations.workspace.keyDecisions")}>
        {h.keyDecisions.items.length === 0 ? (
          <span className="muted" data-decisions-empty>
            {t("dashboards.header.noOpenDecisions")}
          </span>
        ) : (
          <ul className="plain-list" data-key-decisions={h.keyDecisions.items.length}>
            {h.keyDecisions.items.map((d) => (
              <li key={d.recordId}>
                <RecordLink href={d.href} contextTid={tid}>
                  {d.code ? (
                    <bdi dir="ltr" className="code">
                      {d.code}
                    </bdi>
                  ) : null}{" "}
                  {d.label}
                </RecordLink>{" "}
                <DueDate date={d.dueDate} />
              </li>
            ))}
          </ul>
        )}
        {h.keyDecisions.overdueCount > 0 ? (
          <span className="status-chip status-chip--off-track" data-overdue-decisions={h.keyDecisions.overdueCount}>
            <Icon name="alert" /> {t("dashboards.header.overdueDecisions", { count: h.keyDecisions.overdueCount })}
          </span>
        ) : (
          <span className="small muted block" data-overdue-decisions="0">
            {t("dashboards.header.noOverdueDecisions")}
          </span>
        )}
        <DesignDecisionsLink tid={tid} />
      </Element>
      <Element id="nextActions" label={t("transformations.workspace.nextAction")}>
        {h.nextActions.items.length === 0 ? (
          <span className="muted" data-next-empty>
            {t("dashboards.header.noNextAction")}
          </span>
        ) : (
          <ul className="plain-list" data-next-actions={h.nextActions.items.length}>
            {h.nextActions.items.map((i) => (
              <li key={`${i.source}-${i.recordId}-${i.kind ?? ""}`}>
                <RecordLink href={i.href} contextTid={tid}>
                  {itemText(i)}
                </RecordLink>{" "}
                <DueDate date={i.dueDate} />
              </li>
            ))}
          </ul>
        )}
        {h.nextActions.missingMandatoryCount === null ? (
          <span className="block small">
            {t("dashboards.header.gateCriteria")}: <Unknown hint={t("dashboards.header.gateUnknown")} />
          </span>
        ) : h.nextActions.missingMandatoryCount > 0 ? (
          <span className="block small">
            {t("dashboards.header.gateMissing", { count: h.nextActions.missingMandatoryCount })}
          </span>
        ) : null}
      </Element>
    </dl>
  );
}
