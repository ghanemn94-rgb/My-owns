// Prioritization Scorecard (T06) screen (T-DG3-FE-B; REQ-PB-047/048/049, REQ-S09-001/003/004/005; ADR-0022).
// Replaces FE-A0's seam stub (same route, export and namespace). Sections: weight sets, the ranked table with the
// value/feasibility comparison and the 0-100 view, the scorecard of one initiative, ranking snapshots and history,
// and rank overrides. Everything reads the API (no browser-side store); every mutation refreshes the P3 keys through
// useP3Refresh, so the views follow. A portfolio above 500 eligible initiatives is the API's 422 and is shown as that
// state, never as an empty table. AUD and anyone without the permissions see read-only views.
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api/client.ts";
import { SectionNav } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { WorkspaceFrame, useWorkspace } from "../../components/Workspace.tsx";
import { Icon } from "../../components/Icon.tsx";
import { NO_FILTERS, useOverrides, usePrioritizationView, type PrioritizationFilters } from "./api.ts";
import { OverridesSection } from "./Overrides.tsx";
import { RankedSection } from "./RankedTable.tsx";
import { RankingsSection } from "./Rankings.tsx";
import { ScorecardSection } from "./Scorecard.tsx";
import { WeightSetsSection } from "./WeightSets.tsx";
import { p3ErrorMessage } from "./p3ui.tsx";

export function PrioritizationPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="prioritization"
      title={t("prioritization.title")}
      subtitle={t("prioritization.subtitle")}
      writePermissions={["prioritization.score", "prioritization.edit", "prioritization.approve"]}
    >
      <PrioritizationBody />
    </WorkspaceFrame>
  );
}

function PrioritizationBody() {
  const { t } = useTranslation();
  const { tid } = useWorkspace();
  const [filters, setFilters] = useState<PrioritizationFilters>(NO_FILTERS);
  const [view100, setView100] = useState(false);
  const [scoring, setScoring] = useState<string | null>(null);
  const view = usePrioritizationView(tid, filters);
  const all = usePrioritizationView(tid, NO_FILTERS);
  const overrides = useOverrides(tid);
  const onScore = useCallback((id: string) => {
    setScoring(id);
    globalThis.document?.getElementById("scorecard")?.scrollIntoView?.({ block: "start" });
  }, []);

  const tooLarge =
    view.error instanceof ApiError && view.error.code === "prioritization.portfolio_too_large" ? view.error : null;

  return (
    <>
      <SectionNav
        sections={[
          { id: "weights", title: t("prioritization.weights.title") },
          { id: "ranked", title: t("prioritization.ranked.title") },
          { id: "scorecard", title: t("prioritization.scorecard.title") },
          { id: "rankings", title: t("prioritization.rankings.title") },
          { id: "overrides", title: t("prioritization.overrides.title") },
        ]}
      />
      <p className="banner banner--info" role="note">
        <Icon name="info" /> {t("prioritization.separation")}
      </p>
      <WeightSetsSection />
      {tooLarge ? (
        <div className="state state--error banner banner--error" role="alert" data-state="too-large">
          <Icon name="alert" />
          <div>
            <p className="state__title">{t("prioritization.tooLargeTitle")}</p>
            <p className="state__body">{p3ErrorMessage(t, tooLarge)}</p>
          </div>
        </div>
      ) : (
        <QueryState query={view}>
          {(v) => (
            <RankedSection
              items={v.items}
              filters={filters}
              onFilters={setFilters}
              view100={view100}
              onView100={setView100}
              onScore={onScore}
            />
          )}
        </QueryState>
      )}
      {all.data ? (
        <ScorecardSection
          items={all.data.items}
          weightSet={all.data.weightSet}
          initiativeId={scoring}
          onSelect={setScoring}
        />
      ) : null}
      {all.data ? (
        <RankingsSection
          names={
            new Map(all.data.items.map((i) => [i.initiative.id, { code: i.initiative.code, name: i.initiative.name }]))
          }
          overrides={overrides.data ?? []}
        />
      ) : null}
      {all.data ? <OverridesSection items={all.data.items} /> : null}
    </>
  );
}
