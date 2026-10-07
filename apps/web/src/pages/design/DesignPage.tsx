// Design (Phase 3) screen: the TOM canvas with its ten source boxes (REQ-PB-041) and a per-dimension view with current
// and target design, gaps, owner, evidence, dependencies and design decisions (REQ-S05-003); the T03 TOM gap matrix
// linked to the T04 Design Decision Log (REQ-PB-039); the capability heatmap with build / buy / partner (REQ-PB-024);
// journeys and processes with steps and pain points (REQ-PB-025); and workshop mode (REQ-PB-042).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  capabilityHeatmapEntryCreate,
  capabilityHeatmapEntryUpdate,
  SOURCING_NEEDS,
  tomCanvasCellUpdate,
  tomGapCreate,
  tomGapUpdate,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { useDecisions, useP2Refresh, useRegister, useTomCanvas } from "../../api/queries.ts";
import type { CapabilityHeatmapEntry, Decision, TomCanvasCellView, TomGap } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { EvidenceStateChip, RecordStatus } from "../../components/P2Badges.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RecordDialog, type FieldSpec } from "../../components/RecordForm.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { ArchiveAction } from "../../components/RowActions.tsx";
import { Section, SectionNav, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { pick, tomDimensionLabel, tomDimensionOptions } from "../../lib/methodology.ts";
import { JourneysSection } from "./JourneysSection.tsx";
import { WorkshopsSection } from "./WorkshopsSection.tsx";

export function DesignPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="design"
      title={t("design.title")}
      subtitle={t("design.intro")}
      writePermissions={["tom.edit", "tom.contribute", "workshop.facilitate"]}
    >
      <SectionNav
        sections={[
          { id: "canvas", title: t("design.canvas.title") },
          { id: "t03", title: t("design.gaps.title") },
          { id: "heatmap", title: t("design.heatmap.title") },
          { id: "journeys", title: t("design.journeys.title") },
          { id: "workshops", title: t("design.workshops.title") },
        ]}
      />
      <CanvasSection />
      <GapMatrixSection />
      <HeatmapSection />
      <JourneysSection />
      <WorkshopsSection />
    </WorkspaceFrame>
  );
}

// ------------------------------------------------------------------------------------------------ canvas

function CanvasSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const canvas = useTomCanvas(ws.tid);
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<TomCanvasCellView | null>(null);

  const fields: FieldSpec[] = [
    { name: "currentDesign", kind: "textarea", label: t("design.canvas.current"), rows: 4 },
    { name: "targetDesign", kind: "textarea", label: t("design.canvas.target"), rows: 4 },
    { name: "ownerUserId", kind: "person", label: t("common.field.owner") },
    {
      name: "status",
      kind: "select",
      label: t("common.field.status"),
      hint: t("design.canvas.readyHint"),
      options: (["draft", "ready"] as const).map((s) => ({ value: s, label: t(`common.recordStatus.${s}`) })),
    },
  ];

  return (
    <Section id="canvas" title={t("design.canvas.title")} intro={t("design.canvas.intro")}>
      <QueryState query={canvas}>
        {(data) => {
          const cells = [...data.cells].sort((a, b) => a.dimension.ordinal - b.dimension.ordinal);
          const current = cells.find((c) => c.cell.dimensionCode === selected) ?? null;
          return (
            <>
              <ol className="tom-canvas" aria-label={t("design.canvas.gridLabel")}>
                {cells.map((c) => {
                  const box = pick(locale, c.dimension.sourceCanvasBoxEn, c.dimension.canvasBoxAr);
                  return (
                    <li
                      key={c.cell.id}
                      className={`tom-box${selected === c.cell.dimensionCode ? " tom-box--selected" : ""}`}
                      data-dimension={c.cell.dimensionCode}
                    >
                      <h3 className="tom-box__title">
                        <span className="tom-box__num" aria-hidden="true">
                          {c.dimension.ordinal}
                        </span>{" "}
                        {box}
                      </h3>
                      <p className="tom-box__prompt muted small">
                        {pick(locale, c.dimension.sourceCanvasPromptEn, c.dimension.canvasPromptAr)}
                      </p>
                      <dl className="tom-box__facts">
                        <div>
                          <dt>{t("design.canvas.target")}</dt>
                          <dd>
                            {c.cell.targetDesign ? (
                              <span className="text-cell clamp">{c.cell.targetDesign}</span>
                            ) : (
                              <Unknown hint={t("design.canvas.noTarget")} />
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("common.field.owner")}</dt>
                          <dd>
                            <PersonName id={c.cell.ownerUserId} people={byId} />
                          </dd>
                        </div>
                      </dl>
                      <p className="chip-row">
                        <RecordStatus status={c.cell.status} />
                        <span className="small">
                          {t("design.canvas.counts", {
                            gaps: c.gaps.length,
                            decisions: c.decisions.length,
                            dependencies: c.dependencies.length,
                            evidence: c.evidence.length,
                          })}
                        </span>
                      </p>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button--link button--small"
                          aria-expanded={selected === c.cell.dimensionCode}
                          aria-controls="tom-dimension-view"
                          onClick={() => setSelected(selected === c.cell.dimensionCode ? null : c.cell.dimensionCode)}
                        >
                          <Icon name="info" /> {t("design.canvas.open")}
                          <span className="visually-hidden">: {box}</span>
                        </button>
                        {ws.canWriteRow("tom.edit", "tom.contribute", c.cell) ? (
                          <button
                            type="button"
                            className="button button--link button--small"
                            onClick={() => setEditing(c)}
                          >
                            <Icon name="pencil" /> {t("common.action.edit")}
                            <span className="visually-hidden">: {box}</span>
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
              <div id="tom-dimension-view" aria-live="polite">
                {current ? <DimensionView view={current} onClose={() => setSelected(null)} /> : null}
              </div>
            </>
          );
        }}
      </QueryState>
      {editing ? (
        <RecordDialog<TomCanvasCellView["cell"]>
          title={t("design.canvas.editTitle", {
            box: pick(locale, editing.dimension.sourceCanvasBoxEn, editing.dimension.canvasBoxAr),
          })}
          description={pick(locale, editing.dimension.sourceDesignQuestionEn, editing.dimension.designQuestionAr)}
          fields={fields}
          record={editing.cell}
          updateSchema={tomCanvasCellUpdate}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/tom-canvas/${r.dimensionCode}`}
          loadLatest={async (r) =>
            (await api.get<TomCanvasCellView>(`/api/v1/transformations/${ws.tid}/tom-canvas/${r.dimensionCode}`)).cell
          }
          people={people}
          submitLabel={t("common.action.save")}
          onSaved={async () => {
            if (!(await refresh())) return;
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </Section>
  );
}

/** Per-dimension view (REQ-S05-003): current, target, gaps, owner, evidence, dependencies and decisions together. */
function DimensionView({ view, onClose }: { view: TomCanvasCellView; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const { byId } = usePeople(ws.tid);
  const label = pick(locale, view.dimension.labelEn, view.dimension.labelAr);
  return (
    <section
      className="dimension-view"
      aria-labelledby="dimension-view-title"
      data-dimension-view={view.cell.dimensionCode}
    >
      <div className="card__header">
        <h3 id="dimension-view-title" className="card__subtitle">
          {t("design.canvas.dimensionView", { dimension: label })}
        </h3>
        <button type="button" className="button button--secondary button--small" onClick={onClose}>
          {t("common.action.close")}
        </button>
      </div>
      <p className="muted">{pick(locale, view.dimension.sourceDesignQuestionEn, view.dimension.designQuestionAr)}</p>
      <dl className="details">
        <div>
          <dt>{t("design.canvas.current")}</dt>
          <dd>
            <TextCell value={view.cell.currentDesign} />
          </dd>
        </div>
        <div>
          <dt>{t("design.canvas.target")}</dt>
          <dd>
            {view.cell.targetDesign ? (
              <TextCell value={view.cell.targetDesign} />
            ) : (
              <Unknown hint={t("design.canvas.noTarget")} />
            )}
          </dd>
        </div>
        <div>
          <dt>{t("common.field.owner")}</dt>
          <dd>
            <PersonName id={view.cell.ownerUserId} people={byId} />
          </dd>
        </div>
        <div>
          <dt>{t("common.field.status")}</dt>
          <dd>
            <RecordStatus status={view.cell.status} />
          </dd>
        </div>
      </dl>
      <div className="grid grid--2">
        <div>
          <h4 className="small-heading">{t("design.gaps.title")}</h4>
          {view.gaps.length === 0 ? (
            <p className="muted">{t("design.gaps.none")}</p>
          ) : (
            <ul className="plain-list">
              {view.gaps.map((g) => (
                <li key={g.id}>
                  <TextCell value={g.gap} /> <RecordStatus status={g.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="small-heading">{t("decisions.title")}</h4>
          {view.decisions.length === 0 ? (
            <p className="muted">{t("decisions.noneLinked")}</p>
          ) : (
            <ul className="plain-list">
              {view.decisions.map((d) => (
                <li key={d.id}>
                  <Link className="link" to={`/transformations/${ws.tid}/decisions#${d.code}`}>
                    <bdi dir="ltr">{d.code}</bdi> {d.title}
                  </Link>{" "}
                  <RecordStatus status={d.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="small-heading">{t("design.dependencies.title")}</h4>
          {view.dependencies.length === 0 ? (
            <p className="muted">{t("design.dependencies.none")}</p>
          ) : (
            <ul className="plain-list">
              {view.dependencies.map((d) => (
                <li key={d.id}>
                  <bdi dir="ltr">{d.code}</bdi> {d.description} <RecordStatus status={d.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="small-heading">{t("evidence.title")}</h4>
          {view.evidence.length === 0 ? (
            <p className="muted">{t("evidence.noneLinked")}</p>
          ) : (
            <ul className="plain-list">
              {view.evidence.map((e) => (
                <li key={e.id}>
                  {e.title} <EvidenceStateChip reviewStatus={e.reviewStatus} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ T03

function GapMatrixSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const gaps = useRegister<TomGap>(ws.tid, "tom-gaps");
  const decisions = useDecisions(ws.tid, "design");
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [dialog, setDialog] = useState<{ record: TomGap | null } | null>(null);
  const canCreate = ws.canAny("tom.edit", "tom.contribute");
  const decisionOf = (id: string | null): Decision | undefined =>
    id ? decisions.data?.find((d) => d.id === id) : undefined;

  const fields: FieldSpec[] = [
    {
      name: "dimensionCode",
      kind: "select",
      label: t("design.dimension"),
      required: true,
      options: tomDimensionOptions(ws.methodology, locale),
    },
    { name: "currentState", kind: "textarea", label: t("design.gaps.current") },
    { name: "targetState", kind: "textarea", label: t("design.gaps.target") },
    { name: "gap", kind: "textarea", label: t("design.gaps.gap") },
    {
      name: "designDecisionId",
      kind: "select",
      label: t("design.gaps.decision"),
      hint: t("design.gaps.decisionHint"),
      options: (decisions.data ?? []).map((d) => ({ value: d.id, label: `${d.code} ${d.title}` })),
    },
    { name: "ownerUserId", kind: "person", label: t("common.field.owner") },
    {
      name: "status",
      kind: "select",
      label: t("common.field.status"),
      options: (["open", "resolved"] as const).map((s) => ({ value: s, label: t(`common.recordStatus.${s}`) })),
      editOnly: true,
    },
  ];
  const columns: RegisterColumn<TomGap>[] = [
    {
      id: "dimension",
      header: t("design.dimension"),
      cell: (g) => tomDimensionLabel(ws.methodology, g.dimensionCode, locale) ?? g.dimensionCode,
      sortValue: (g) => ws.methodology.tomDimensions.find((d) => d.code === g.dimensionCode)?.ordinal ?? 99,
      filterText: (g) => tomDimensionLabel(ws.methodology, g.dimensionCode, locale),
      hideable: false,
      rowHeader: true,
    },
    {
      id: "current",
      header: t("design.gaps.current"),
      cell: (g) => <TextCell value={g.currentState} />,
      filterText: (g) => g.currentState,
    },
    {
      id: "target",
      header: t("design.gaps.target"),
      cell: (g) => <TextCell value={g.targetState} />,
      filterText: (g) => g.targetState,
    },
    { id: "gap", header: t("design.gaps.gap"), cell: (g) => <TextCell value={g.gap} />, filterText: (g) => g.gap },
    {
      id: "decision",
      header: t("design.gaps.decision"),
      cell: (g) => {
        const d = decisionOf(g.designDecisionId);
        if (!g.designDecisionId) return <span className="muted">{t("common.value.none")}</span>;
        return d ? (
          <Link className="link" to={`/transformations/${ws.tid}/decisions#${d.code}`}>
            <bdi dir="ltr">{d.code}</bdi> {d.title}
          </Link>
        ) : (
          <Unknown />
        );
      },
      sortValue: (g) => decisionOf(g.designDecisionId)?.code,
    },
    { id: "owner", header: t("common.field.owner"), cell: (g) => <PersonName id={g.ownerUserId} people={byId} /> },
    {
      id: "status",
      header: t("common.field.status"),
      cell: (g) => <RecordStatus status={g.status} />,
      sortValue: (g) => g.status,
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (g) =>
        ws.canWriteRow("tom.edit", "tom.contribute", g) ? (
          <span className="row-actions">
            <button
              type="button"
              className="button button--link button--small"
              onClick={() => setDialog({ record: g })}
            >
              <Icon name="pencil" /> {t("common.action.edit")}
            </button>
            <ArchiveAction
              url={`/api/v1/transformations/${ws.tid}/tom-gaps/${g.id}`}
              version={g.version}
              name={tomDimensionLabel(ws.methodology, g.dimensionCode, locale) ?? g.dimensionCode}
              onDone={refresh}
            />
          </span>
        ) : (
          <span className="muted small">{t("common.readOnly")}</span>
        ),
    },
  ];
  return (
    <Section
      id="t03"
      title={t("design.gaps.title")}
      intro={t("design.gaps.intro")}
      actions={
        canCreate ? (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setDialog({ record: null })}
          >
            <Icon name="plus" /> {t("design.gaps.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={gaps}>
        {(list) => (
          <RegisterTable
            id="t03"
            caption={t("design.gaps.title")}
            rows={list.filter((g) => g.status !== "archived")}
            columns={columns}
            getRowId={(g) => g.id}
            emptyTitle={t("design.gaps.empty")}
            defaultSort={{ id: "dimension", dir: "asc" }}
          />
        )}
      </QueryState>
      {dialog ? (
        <RecordDialog<TomGap>
          title={dialog.record ? t("design.gaps.editTitle") : t("design.gaps.add")}
          fields={fields}
          record={dialog.record}
          defaults={{ ownerUserId: ws.meId }}
          createSchema={tomGapCreate}
          updateSchema={tomGapUpdate}
          createUrl={`/api/v1/transformations/${ws.tid}/tom-gaps`}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/tom-gaps/${r.id}`}
          people={people}
          submitLabel={dialog.record ? t("common.action.save") : t("common.action.create")}
          onSaved={async () => {
            if (!(await refresh())) return;
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ heatmap

/** Heat of a capability gap (target - current level). Unknown when a level is missing: never "no gap". */
function heatOf(c: CapabilityHeatmapEntry): {
  key: "none" | "small" | "large" | "unknown";
  css: string;
  icon: IconName;
  gap: number | null;
} {
  if (c.currentLevel === null || c.targetLevel === null)
    return { key: "unknown", css: "unknown", icon: "question", gap: null };
  const gap = c.targetLevel - c.currentLevel;
  if (gap <= 0) return { key: "none", css: "on-track", icon: "check", gap };
  if (gap <= 1) return { key: "small", css: "at-risk", icon: "alert", gap };
  return { key: "large", css: "off-track", icon: "cross", gap };
}

function HeatmapSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const caps = useRegister<CapabilityHeatmapEntry>(ws.tid, "capability-heatmap");
  const gaps = useRegister<TomGap>(ws.tid, "tom-gaps");
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [dialog, setDialog] = useState<{ record: CapabilityHeatmapEntry | null } | null>(null);
  const canCreate = ws.canAny("tom.edit", "tom.contribute");
  const fields: FieldSpec[] = [
    { name: "name", kind: "text", label: t("design.heatmap.capability"), required: true, maxLength: 300 },
    { name: "description", kind: "textarea", label: t("common.field.description") },
    {
      name: "dimensionCode",
      kind: "select",
      label: t("design.dimension"),
      options: tomDimensionOptions(ws.methodology, locale),
    },
    {
      name: "currentLevel",
      kind: "integer",
      label: t("design.heatmap.currentLevel"),
      min: 1,
      max: 5,
      hint: t("design.heatmap.levelHint"),
    },
    {
      name: "targetLevel",
      kind: "integer",
      label: t("design.heatmap.targetLevel"),
      min: 1,
      max: 5,
      hint: t("design.heatmap.levelHint"),
    },
    {
      name: "sourcingNeed",
      kind: "select",
      label: t("design.heatmap.sourcing"),
      options: SOURCING_NEEDS.map((s) => ({ value: s, label: t(`design.heatmap.sourcingNeeds.${s}`) })),
    },
    {
      name: "tomGapId",
      kind: "select",
      label: t("design.heatmap.linkedGap"),
      options: (gaps.data ?? [])
        .filter((g) => g.status !== "archived")
        .map((g) => ({
          value: g.id,
          label: `${tomDimensionLabel(ws.methodology, g.dimensionCode, locale) ?? g.dimensionCode}: ${g.gap ?? ""}`,
        })),
    },
    { name: "ownerUserId", kind: "person", label: t("common.field.owner") },
  ];
  const columns: RegisterColumn<CapabilityHeatmapEntry>[] = [
    {
      id: "name",
      header: t("design.heatmap.capability"),
      cell: (c) => c.name,
      sortValue: (c) => c.name,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "dimension",
      header: t("design.dimension"),
      cell: (c) =>
        tomDimensionLabel(ws.methodology, c.dimensionCode, locale) ?? (
          <span className="muted">{t("common.value.none")}</span>
        ),
      sortValue: (c) => tomDimensionLabel(ws.methodology, c.dimensionCode, locale),
    },
    {
      id: "current",
      header: t("design.heatmap.currentLevel"),
      cell: (c) => (c.currentLevel === null ? <Unknown /> : <bdi dir="ltr">{c.currentLevel}</bdi>),
      sortValue: (c) => c.currentLevel,
    },
    {
      id: "target",
      header: t("design.heatmap.targetLevel"),
      cell: (c) => (c.targetLevel === null ? <Unknown /> : <bdi dir="ltr">{c.targetLevel}</bdi>),
      sortValue: (c) => c.targetLevel,
    },
    {
      id: "heat",
      header: t("design.heatmap.heat"),
      cell: (c) => {
        const h = heatOf(c);
        return (
          <span className={`status-chip status-chip--${h.css}`} data-heat={h.key}>
            <Icon name={h.icon} /> {t(`design.heatmap.heatLevels.${h.key}`, { gap: h.gap ?? "" })}
          </span>
        );
      },
      sortValue: (c) => heatOf(c).gap,
    },
    {
      id: "sourcing",
      header: t("design.heatmap.sourcing"),
      cell: (c) => (c.sourcingNeed ? t(`design.heatmap.sourcingNeeds.${c.sourcingNeed}`) : <Unknown />),
      sortValue: (c) => c.sourcingNeed,
    },
    { id: "owner", header: t("common.field.owner"), cell: (c) => <PersonName id={c.ownerUserId} people={byId} /> },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (c) =>
        ws.canWriteRow("tom.edit", "tom.contribute", c) ? (
          <span className="row-actions">
            <button
              type="button"
              className="button button--link button--small"
              onClick={() => setDialog({ record: c })}
            >
              <Icon name="pencil" /> {t("common.action.edit")}
              <span className="visually-hidden">: {c.name}</span>
            </button>
            <ArchiveAction
              url={`/api/v1/transformations/${ws.tid}/capability-heatmap/${c.id}`}
              version={c.version}
              name={c.name}
              onDone={refresh}
            />
          </span>
        ) : (
          <span className="muted small">{t("common.readOnly")}</span>
        ),
    },
  ];
  return (
    <Section
      id="heatmap"
      title={t("design.heatmap.title")}
      intro={t("design.heatmap.intro")}
      actions={
        canCreate ? (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setDialog({ record: null })}
          >
            <Icon name="plus" /> {t("design.heatmap.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={caps}>
        {(list) => {
          const active = list.filter((c) => c.status !== "archived");
          return (
            <>
              <SourcingSummary caps={active} />
              <RegisterTable
                id="heatmap"
                caption={t("design.heatmap.title")}
                rows={active}
                columns={columns}
                getRowId={(c) => c.id}
                emptyTitle={t("design.heatmap.empty")}
                defaultSort={{ id: "heat", dir: "desc" }}
              />
            </>
          );
        }}
      </QueryState>
      {dialog ? (
        <RecordDialog<CapabilityHeatmapEntry>
          title={dialog.record ? t("design.heatmap.editTitle") : t("design.heatmap.add")}
          fields={fields}
          record={dialog.record}
          defaults={{ ownerUserId: ws.meId }}
          createSchema={capabilityHeatmapEntryCreate}
          updateSchema={capabilityHeatmapEntryUpdate}
          createUrl={`/api/v1/transformations/${ws.tid}/capability-heatmap`}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/capability-heatmap/${r.id}`}
          people={people}
          submitLabel={dialog.record ? t("common.action.save") : t("common.action.create")}
          onSaved={async () => {
            if (!(await refresh())) return;
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      ) : null}
    </Section>
  );
}

/** Build / buy / partner / undecided counts; capabilities without a sourcing decision are counted as Unknown. */
function SourcingSummary({ caps }: { caps: readonly CapabilityHeatmapEntry[] }) {
  const { t } = useTranslation();
  if (caps.length === 0) return null;
  const count = (s: string | null) => caps.filter((c) => c.sourcingNeed === s).length;
  return (
    <dl className="sourcing-summary" aria-label={t("design.heatmap.sourcingSummary")}>
      {SOURCING_NEEDS.map((s) => (
        <div key={s} data-sourcing={s}>
          <dt>{t(`design.heatmap.sourcingNeeds.${s}`)}</dt>
          <dd>
            <bdi dir="ltr">{count(s)}</bdi>
          </dd>
        </div>
      ))}
      <div data-sourcing="unknown">
        <dt>{t("common.value.unknown")}</dt>
        <dd>
          <bdi dir="ltr">{count(null)}</bdi>
        </dd>
      </div>
    </dl>
  );
}
