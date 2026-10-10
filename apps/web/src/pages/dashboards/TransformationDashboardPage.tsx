// The Template 10 dashboard of one transformation and the workstream dashboard (T-DG4-FE-G; ADR-0037 §2–§5;
// REQ-PB-062, REQ-PB-063, REQ-PB-064, REQ-S13-001, REQ-S13-002, REQ-S13-003). Both are workspace tabs, so the user
// never re-enters the transformation id. Filters: owner and period (the contract's two for these operations), with the
// window and as-of date the server applied. Each headline opens the drill-down panel. On the workstream dashboard,
// Decisions and People & adoption are transformation-level and shown Not applicable, with the rule saying why.
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { usePeople } from "../../components/People.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { WorkspaceFrame, useWorkspace } from "../../components/Workspace.tsx";
import { useTransformationDashboard, useWorkstreamDashboard, useWorkstreamList } from "./api.ts";
import { AreaGrid, DrilldownPanel, FilterBar, GeneratedNote, useDrill, useFilterState } from "./ui.tsx";

export function TransformationDashboardPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="dashboard"
      title={t("dashboards.kind.transformation.title")}
      subtitle={t("dashboards.transformation.intro")}
      writePermissions={["transformation.read"]}
    >
      <TransformationDashboardBody />
    </WorkspaceFrame>
  );
}

function TransformationDashboardBody() {
  const { tid } = useWorkspace();
  const people = usePeople(tid);
  const [state, set, clear] = useFilterState();
  const query = useTransformationDashboard(tid, { ownerUserId: state.owner, periodId: state.period });
  const [drill, openDrill, closeDrill] = useDrill();
  return (
    <>
      <FilterBar
        state={state}
        set={set}
        clear={clear}
        applied={query.data?.appliedFilters ?? null}
        orgWide={false}
        ownerOptions={people.people}
      />
      <QueryState query={query}>
        {(d) => (
          <>
            <GeneratedNote at={d.generatedAt} timezone={d.timezone} onRefresh={() => void query.refetch()} />
            <AreaGrid areas={d.areas} onDrill={openDrill} contextTid={tid} />
          </>
        )}
      </QueryState>
      <WorkstreamLinks tid={tid} />
      {drill ? <DrilldownPanel target={drill} onClose={closeDrill} contextTid={tid} /> : null}
    </>
  );
}

/** The transformation's workstreams, each opening its workstream dashboard (archived ones are not offered). */
function WorkstreamLinks({ tid }: { tid: string }) {
  const { t } = useTranslation();
  const list = useWorkstreamList(tid);
  return (
    <Section id="workstreams" title={t("dashboards.kind.workstream.title")} intro={t("dashboards.workstream.pick")}>
      <QueryState query={list}>
        {(rows) => {
          const active = rows.filter((w) => w.archivedAt === null);
          return active.length === 0 ? (
            <p className="muted" data-workstreams-empty>
              {t("dashboards.workstream.none")}
            </p>
          ) : (
            <ul className="plain-list" data-workstreams={active.length}>
              {active.map((w) => (
                <li key={w.id}>
                  <Link
                    className="link"
                    to={`/transformations/${tid}/workstreams/${w.id}/dashboard`}
                    data-workstream={w.id}
                  >
                    <bdi dir="ltr" className="code">
                      {w.code}
                    </bdi>{" "}
                    {w.name}
                  </Link>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>
    </Section>
  );
}

export function WorkstreamDashboardPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="dashboard"
      title={t("dashboards.kind.workstream.title")}
      subtitle={t("dashboards.workstream.intro")}
      writePermissions={["transformation.read"]}
    >
      <WorkstreamDashboardBody />
    </WorkspaceFrame>
  );
}

function WorkstreamDashboardBody() {
  const { t } = useTranslation();
  const { tid } = useWorkspace();
  const { workstreamId = "" } = useParams();
  const people = usePeople(tid);
  const [state, set, clear] = useFilterState();
  const query = useWorkstreamDashboard(tid, workstreamId, { ownerUserId: state.owner, periodId: state.period });
  const [drill, openDrill, closeDrill] = useDrill();
  return (
    <>
      <p>
        <Link className="link" to={`/transformations/${tid}/dashboard`}>
          {t("dashboards.workstream.back")}
        </Link>
      </p>
      <FilterBar
        state={state}
        set={set}
        clear={clear}
        applied={query.data?.appliedFilters ?? null}
        orgWide={false}
        ownerOptions={people.people}
      />
      <QueryState query={query}>
        {(d) => (
          <>
            <h2 data-workstream-code={d.code}>
              <bdi dir="ltr" className="code">
                {d.code}
              </bdi>{" "}
              {d.name}
            </h2>
            <GeneratedNote at={d.generatedAt} onRefresh={() => void query.refetch()} />
            <AreaGrid areas={d.areas} onDrill={openDrill} contextTid={tid} />
          </>
        )}
      </QueryState>
      {drill ? <DrilldownPanel target={drill} onClose={closeDrill} contextTid={tid} /> : null}
    </>
  );
}
