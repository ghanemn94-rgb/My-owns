// Change and Adoption > Stakeholder & Adoption Plan (T13) (T-DG4-FE-E; p4-work-split §F+G FG.8; ADR-0033 §4, §7).
// SYNTHETIC data only in tests and demos.
//  - REQ-PB-070: the seven T13 columns (B0107): Stakeholder, Impact, Current stance, Required behavior, Intervention,
//    Owner, Adoption KPI. The value lists are closed (H/M/L; Support/Neutral/Resist; Comms/Training/Involvement/
//    Incentive): the form offers only them, and a server 400 (e.g. stance 'Hostile') lands on its field, translated.
//  - REQ-S11-001: influence is recorded and shown separately from impact.
//  - Champions and impacted-team involvement (REQ-PB-073) are managed per group; the champion constraints themselves
//    are shown on the T04 decision page (ChampionConstraints.tsx).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  STAKEHOLDER_INTERVENTION_TYPES,
  STAKEHOLDER_LEVELS,
  STAKEHOLDER_STANCES,
  type AdoptionPlanRow,
} from "@mth/shared/schemas";
import { useDecisions } from "../../api/queries.ts";
import { useKpiDictionary } from "../kpi/api.ts";
import { useP4Refresh } from "../../api/p4.ts";
import { Dialog } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { P4FormDialog, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import { useActionRunner } from "./actions.tsx";
import {
  adoptionPaths,
  useAdoptionPlan,
  useChampions,
  useInvolvements,
  useStakeholderGroups,
  type StakeholderGroup,
} from "./api.ts";
import {
  ADOPTION_WRITE_PERMISSIONS,
  AdoptionSubNav,
  Code,
  LevelText,
  NS,
  ProvisionalAr,
  StanceText,
  StatusText,
  vocabOptions,
} from "./ui.tsx";

export function AdoptionPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="adoption"
      title={t("adoptionP4.plan.title")}
      subtitle={t("adoptionP4.plan.intro")}
      writePermissions={ADOPTION_WRITE_PERMISSIONS}
    >
      <AdoptionBody />
    </WorkspaceFrame>
  );
}

function AdoptionBody() {
  const ws = useWorkspace();
  return (
    <>
      <AdoptionSubNav tid={ws.tid} />
      <PlanTable />
      <GroupsRegister />
    </>
  );
}

/** Interventions as T13 words ("Comms, Training"). */
function InterventionList({ types }: { types: readonly string[] }) {
  const { t } = useTranslation();
  return (
    <span data-interventions={types.join(",")}>{types.map((x) => t(`adoptionP4.intervention.${x}`)).join(", ")}</span>
  );
}

function PlanTable() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const plan = useAdoptionPlan(ws.tid);
  const { byId } = usePeople(ws.tid);
  const columns: RegisterColumn<AdoptionPlanRow>[] = [
    {
      id: "stakeholder",
      header: t("adoptionP4.col.stakeholder"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <span className="block">
          <Code>{r.code}</Code> {r.stakeholder}
        </span>
      ),
      sortValue: (r) => r.code,
    },
    {
      id: "impact",
      header: t("adoptionP4.col.impact"),
      cell: (r) => <LevelText level={r.impact} />,
      sortValue: (r) => STAKEHOLDER_LEVELS.indexOf(r.impact),
    },
    {
      id: "currentStance",
      header: t("adoptionP4.col.currentStance"),
      cell: (r) => <StanceText stance={r.currentStance} />,
      sortValue: (r) => STAKEHOLDER_STANCES.indexOf(r.currentStance),
      filterText: (r) => t(`adoptionP4.stance.${r.currentStance}`),
    },
    {
      id: "requiredBehavior",
      header: t("adoptionP4.col.requiredBehavior"),
      cell: (r) => <TextCell value={r.requiredBehavior} />,
      sortValue: (r) => r.requiredBehavior,
    },
    {
      id: "intervention",
      header: t("adoptionP4.col.intervention"),
      cell: (r) => <InterventionList types={r.intervention} />,
      filterText: (r) => r.intervention.map((x) => t(`adoptionP4.intervention.${x}`)).join(" "),
    },
    {
      id: "owner",
      header: t("adoptionP4.col.owner"),
      cell: (r) => <PersonName id={r.ownerUserId} people={byId} />,
      sortValue: (r) => byId.get(r.ownerUserId)?.label ?? r.ownerUserId,
    },
    {
      id: "adoptionKpi",
      header: t("adoptionP4.col.adoptionKpi"),
      cell: (r) =>
        r.adoptionKpiDefinitionId ? (
          <Link className="link" to={`/transformations/${ws.tid}/kpis/${r.adoptionKpiDefinitionId}`}>
            {r.adoptionKpiName ?? t("adoptionP4.plan.kpiLink")}
          </Link>
        ) : (
          <span className="muted" data-kpi="none">
            {t("adoptionP4.plan.noKpi")}
          </span>
        ),
      sortValue: (r) => r.adoptionKpiName,
    },
    {
      id: "influence",
      header: t("adoptionP4.col.influence"),
      cell: (r) => <LevelText level={r.influence} />,
      sortValue: (r) => (r.influence ? STAKEHOLDER_LEVELS.indexOf(r.influence) : null),
    },
    {
      id: "counts",
      header: t("adoptionP4.col.counts"),
      cell: (r) => (
        <span className="block small">
          <span className="block">{t("adoptionP4.plan.champions", { count: r.championCount })}</span>
          <span className="block">{t("adoptionP4.plan.openInterventions", { count: r.openInterventionCount })}</span>
          <span className="block">
            {t("adoptionP4.plan.openConstraints", { count: r.openChampionConstraintCount })}
          </span>
        </span>
      ),
    },
  ];
  return (
    <Section
      id="t13"
      title={t("adoptionP4.plan.tableTitle")}
      intro={
        <>
          {t("adoptionP4.plan.tableIntro")} <ProvisionalAr />
        </>
      }
    >
      <QueryState query={plan}>
        {(p) => (
          <RegisterTable
            id="adoption-t13"
            caption={t("adoptionP4.plan.tableTitle")}
            rows={p.rows}
            columns={columns}
            getRowId={(r) => r.stakeholderGroupId}
            emptyTitle={t("adoptionP4.plan.empty")}
            emptyBody={t("adoptionP4.plan.emptyBody")}
            defaultSort={{ id: "stakeholder", dir: "asc" }}
          />
        )}
      </QueryState>
    </Section>
  );
}

type GroupDialog =
  | { kind: "create" }
  | { kind: "edit"; group: StakeholderGroup }
  | { kind: "archive"; group: StakeholderGroup }
  | { kind: "people"; group: StakeholderGroup };

function GroupsRegister() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [status, setStatus] = useState("active");
  const groups = useStakeholderGroups(ws.tid, status ? { status } : {});
  const { byId } = usePeople(ws.tid);
  const [dialog, setDialog] = useState<GroupDialog | null>(null);
  const canEdit = ws.can("adoption.edit");
  const columns: RegisterColumn<StakeholderGroup>[] = [
    {
      id: "code",
      header: t("adoptionP4.col.code"),
      rowHeader: true,
      hideable: false,
      cell: (g) => <Code>{g.code}</Code>,
      sortValue: (g) => g.code,
    },
    { id: "name", header: t("adoptionP4.col.stakeholder"), cell: (g) => g.name, sortValue: (g) => g.name },
    {
      id: "influence",
      header: t("adoptionP4.col.influence"),
      cell: (g) => <LevelText level={g.influence} />,
      sortValue: (g) => (g.influence ? STAKEHOLDER_LEVELS.indexOf(g.influence) : null),
    },
    {
      id: "impact",
      header: t("adoptionP4.col.impact"),
      cell: (g) => <LevelText level={g.impact} />,
      sortValue: (g) => STAKEHOLDER_LEVELS.indexOf(g.impact),
    },
    {
      id: "headcount",
      header: t("adoptionP4.col.headcount"),
      cell: (g) =>
        g.headcount === null ? <span className="muted">{t("common.value.unknown")}</span> : String(g.headcount),
      sortValue: (g) => g.headcount,
    },
    {
      id: "owner",
      header: t("adoptionP4.col.owner"),
      cell: (g) => <PersonName id={g.ownerUserId} people={byId} />,
    },
    { id: "status", header: t("adoptionP4.col.status"), cell: (g) => <StatusText status={g.status} /> },
    {
      id: "rowActions",
      header: t("adoptionP4.col.actions"),
      hideable: false,
      cell: (g) => (
        <span className="chip-row">
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => setDialog({ kind: "people", group: g })}
            data-group-people={g.code}
          >
            {t("adoptionP4.groups.people")}
            <span className="visually-hidden"> {g.code}</span>
          </button>
          {canEdit && g.status === "active" ? (
            <>
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={() => setDialog({ kind: "edit", group: g })}
                data-edit={g.code}
              >
                <Icon name="pencil" /> {t("adoptionP4.edit")}
                <span className="visually-hidden"> {g.code}</span>
              </button>
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={() => setDialog({ kind: "archive", group: g })}
                data-archive={g.code}
              >
                <Icon name="archive" /> {t("adoptionP4.groups.archive")}
                <span className="visually-hidden"> {g.code}</span>
              </button>
            </>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <Section
      id="stakeholder-groups"
      title={t("adoptionP4.groups.title")}
      intro={t("adoptionP4.groups.intro")}
      actions={
        canEdit ? (
          <button type="button" className="button button--primary" onClick={() => setDialog({ kind: "create" })}>
            <Icon name="plus" /> {t("adoptionP4.groups.create")}
          </button>
        ) : null
      }
    >
      <div className="filters" role="group" aria-label={t("adoptionP4.filters")}>
        <div className="filters__select">
          <label htmlFor="group-filter-status">{t("adoptionP4.col.status")}</label>
          <select id="group-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("adoptionP4.all")}</option>
            {["active", "archived"].map((v) => (
              <option key={v} value={v}>
                {t(`adoptionP4.status.${v}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <QueryState query={groups}>
        {(rows) => (
          <RegisterTable
            id="adoption-groups"
            caption={t("adoptionP4.groups.title")}
            rows={rows}
            columns={columns}
            getRowId={(g) => g.id}
            emptyTitle={t("adoptionP4.groups.empty")}
            defaultSort={{ id: "code", dir: "asc" }}
          />
        )}
      </QueryState>
      {dialog?.kind === "create" ? <GroupDialogForm onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "edit" ? <GroupDialogForm group={dialog.group} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "archive" ? <ArchiveGroupDialog group={dialog.group} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "people" ? <GroupPeopleDialog group={dialog.group} onClose={() => setDialog(null)} /> : null}
    </Section>
  );
}

function GroupDialogForm({ group, onClose }: { group?: StakeholderGroup; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const kpis = useKpiDictionary(ws.tid);
  const levels = vocabOptions(t, "level", STAKEHOLDER_LEVELS);
  const fields: P4FieldSpec[] = [
    { name: "name", label: t("adoptionP4.col.stakeholder"), kind: "text", required: true, max: 200 },
    { name: "description", label: t("adoptionP4.field.description"), kind: "textarea", max: 4000 },
    { name: "impact", label: t("adoptionP4.col.impact"), kind: "select", required: true, options: levels },
    {
      name: "influence",
      label: t("adoptionP4.col.influence"),
      kind: "select",
      hint: t("adoptionP4.field.influenceHint"),
      options: levels,
    },
    {
      name: "currentStance",
      label: t("adoptionP4.col.currentStance"),
      kind: "select",
      required: true,
      options: vocabOptions(t, "stance", STAKEHOLDER_STANCES),
    },
    {
      name: "requiredBehavior",
      label: t("adoptionP4.col.requiredBehavior"),
      kind: "textarea",
      required: true,
      max: 2000,
    },
    ...STAKEHOLDER_INTERVENTION_TYPES.map(
      (x): P4FieldSpec => ({
        name: `iv_${x}`,
        label: `${t("adoptionP4.col.intervention")}: ${t(`adoptionP4.intervention.${x}`)}`,
        kind: "checkbox",
      }),
    ),
    { name: "interventionPlan", label: t("adoptionP4.field.interventionPlan"), kind: "textarea", max: 8000 },
    {
      name: "ownerUserId",
      label: t("adoptionP4.col.owner"),
      kind: "select",
      required: true,
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    {
      name: "adoptionKpiDefinitionId",
      label: t("adoptionP4.col.adoptionKpi"),
      kind: "select",
      hint: t("adoptionP4.field.adoptionKpiHint"),
      options: (kpis.data ?? []).map((k) => ({ value: k.definition.id, label: k.definition.name })),
    },
    { name: "headcount", label: t("adoptionP4.col.headcount"), kind: "number", min: 1, max: 10_000_000 },
  ];
  const initial: P4Values = group
    ? {
        name: group.name,
        description: group.description ?? "",
        impact: group.impact,
        influence: group.influence ?? "",
        currentStance: group.currentStance,
        requiredBehavior: group.requiredBehavior,
        interventionPlan: group.interventionPlan ?? "",
        ownerUserId: group.ownerUserId,
        headcount: group.headcount === null ? "" : String(group.headcount),
        adoptionKpiDefinitionId: group.adoptionKpiDefinitionId ?? "",
        ...Object.fromEntries(
          STAKEHOLDER_INTERVENTION_TYPES.map((x) => [`iv_${x}`, group.interventionTypes.includes(x)]),
        ),
      }
    : { ownerUserId: ws.meId };
  const build = (v: P4Values): Record<string, unknown> => ({
    name: v["name"],
    description: textOf(v["description"]) ?? null,
    impact: v["impact"],
    influence: v["influence"] ? v["influence"] : null,
    currentStance: v["currentStance"],
    requiredBehavior: v["requiredBehavior"],
    interventionTypes: STAKEHOLDER_INTERVENTION_TYPES.filter((x) => v[`iv_${x}`] === true),
    interventionPlan: textOf(v["interventionPlan"]) ?? null,
    ownerUserId: v["ownerUserId"],
    headcount: v["headcount"] ? Number(v["headcount"]) : null,
    adoptionKpiDefinitionId: v["adoptionKpiDefinitionId"] ? v["adoptionKpiDefinitionId"] : null,
  });
  return (
    <P4FormDialog
      title={group ? t("adoptionP4.groups.editTitle", { code: group.code }) : t("adoptionP4.groups.create")}
      description={t("adoptionP4.groups.formIntro")}
      note={<ProvisionalAr />}
      fields={fields}
      initial={initial}
      submitLabel={group ? t("adoptionP4.save") : t("adoptionP4.groups.createSubmit")}
      method={group ? "PATCH" : "POST"}
      url={group ? adoptionPaths.group(ws.tid, group.id) : adoptionPaths.groups(ws.tid)}
      {...(group ? { version: group.version } : {})}
      namespaces={NS}
      toBody={(v) => {
        const body = build(v);
        if ((body["interventionTypes"] as string[]).length === 0)
          return { fieldErrors: { [`iv_${STAKEHOLDER_INTERVENTION_TYPES[0]}`]: "validation.required" } };
        if (!group) {
          const out = { ...body };
          for (const k of ["description", "influence", "interventionPlan", "headcount", "adoptionKpiDefinitionId"])
            if (out[k] === null) delete out[k];
          return out;
        }
        const before = build(initial);
        const patch: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(body))
          if (JSON.stringify(val) !== JSON.stringify(before[k])) patch[k] = val;
        return Object.keys(patch).length === 0 ? { fieldErrors: { name: "validation.empty_patch" } } : patch;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function ArchiveGroupDialog({ group, onClose }: { group: StakeholderGroup; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  return (
    <P4FormDialog
      title={t("adoptionP4.groups.archiveTitle", { code: group.code })}
      description={t("adoptionP4.groups.archiveIntro")}
      fields={[
        { name: "reason", label: t("adoptionP4.field.reason"), kind: "textarea", required: true, min: 3, max: 1000 },
      ]}
      submitLabel={t("adoptionP4.groups.archive")}
      danger
      url={adoptionPaths.groupArchive(ws.tid, group.id)}
      version={group.version}
      namespaces={NS}
      toBody={(v) => ({ reason: v["reason"] })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

/** Champions and impacted-team involvement of one group (REQ-PB-073, REQ-S11-001). */
function GroupPeopleDialog({ group, onClose }: { group: StakeholderGroup; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const champions = useChampions(ws.tid, group.id);
  const involvements = useInvolvements(ws.tid, { stakeholderGroupId: group.id });
  const decisions = useDecisions(ws.tid, "design");
  const { people, byId } = usePeople(ws.tid);
  const runner = useActionRunner(ws.tid);
  const [adding, setAdding] = useState<"champion" | "involvement" | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const canEdit = ws.can("adoption.edit") && group.status === "active";
  const decisionCode = (id: string | null) => (decisions.data ?? []).find((d) => d.id === id)?.code ?? null;
  if (adding === "champion")
    return (
      <P4FormDialog
        title={t("adoptionP4.champions.addTitle", { code: group.code })}
        fields={[
          {
            name: "userId",
            label: t("adoptionP4.champions.person"),
            kind: "select",
            required: true,
            options: people.map((p) => ({ value: p.id, label: p.label })),
          },
          { name: "note", label: t("adoptionP4.field.note"), kind: "textarea", max: 1000 },
        ]}
        submitLabel={t("adoptionP4.champions.add")}
        url={adoptionPaths.champions(ws.tid, group.id)}
        namespaces={NS}
        toBody={(v) => ({ userId: v["userId"], ...(textOf(v["note"]) ? { note: v["note"] } : {}) })}
        onDone={refresh}
        onClose={() => setAdding(null)}
      />
    );
  if (withdrawing)
    return (
      <P4FormDialog
        title={t("adoptionP4.involvement.withdrawTitle", { code: group.code })}
        fields={[
          { name: "reason", label: t("adoptionP4.field.reason"), kind: "textarea", required: true, min: 3, max: 1000 },
        ]}
        submitLabel={t("adoptionP4.involvement.withdraw")}
        url={adoptionPaths.involvementWithdraw(ws.tid, withdrawing)}
        namespaces={NS}
        toBody={(v) => ({ reason: v["reason"] })}
        onDone={refresh}
        onClose={() => setWithdrawing(null)}
      />
    );
  if (adding === "involvement")
    return (
      <P4FormDialog
        title={t("adoptionP4.involvement.addTitle", { code: group.code })}
        description={t("adoptionP4.involvement.intro")}
        fields={[
          {
            name: "decisionId",
            label: t("adoptionP4.involvement.decision"),
            kind: "select",
            required: true,
            options: (decisions.data ?? []).map((d) => ({ value: d.id, label: `${d.code} · ${d.title}` })),
          },
          { name: "note", label: t("adoptionP4.field.note"), kind: "textarea", max: 2000 },
        ]}
        submitLabel={t("adoptionP4.involvement.add")}
        url={adoptionPaths.involvements(ws.tid)}
        namespaces={NS}
        toBody={(v) => ({
          stakeholderGroupId: group.id,
          decisionId: v["decisionId"],
          ...(textOf(v["note"]) ? { note: v["note"] } : {}),
        })}
        onDone={refresh}
        onClose={() => setAdding(null)}
      />
    );
  return (
    <Dialog
      title={t("adoptionP4.groups.peopleTitle", { code: group.code })}
      onClose={onClose}
      footer={
        <button type="button" className="button button--secondary" onClick={onClose}>
          {t("adoptionP4.closeDialog")}
        </button>
      }
    >
      {runner.alert}
      <h3>{t("adoptionP4.champions.title")}</h3>
      {canEdit ? (
        <button type="button" className="button button--secondary button--small" onClick={() => setAdding("champion")}>
          <Icon name="plus" /> {t("adoptionP4.champions.add")}
        </button>
      ) : null}
      <QueryState query={champions}>
        {(rows) =>
          rows.filter((c) => c.status === "active").length === 0 ? (
            <p className="muted">{t("adoptionP4.champions.empty")}</p>
          ) : (
            <ul className="plain-list" data-champions>
              {rows
                .filter((c) => c.status === "active")
                .map((c) => (
                  <li key={c.id} className="chip-row">
                    <PersonName id={c.userId} people={byId} />
                    {c.note ? <span className="muted small">{c.note}</span> : null}
                    {canEdit ? (
                      <button
                        type="button"
                        className="button button--link button--small"
                        disabled={runner.busy !== null}
                        onClick={() =>
                          void runner.run(c.id, adoptionPaths.championRemove(ws.tid, group.id, c.id), c.version)
                        }
                      >
                        {t("adoptionP4.champions.remove")}
                      </button>
                    ) : null}
                  </li>
                ))}
            </ul>
          )
        }
      </QueryState>
      <h3>{t("adoptionP4.involvement.title")}</h3>
      {canEdit ? (
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => setAdding("involvement")}
        >
          <Icon name="plus" /> {t("adoptionP4.involvement.add")}
        </button>
      ) : null}
      <QueryState query={involvements}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="muted">{t("adoptionP4.involvement.empty")}</p>
          ) : (
            <ul className="plain-list" data-involvements>
              {rows.map((r) => (
                <li key={r.id} className="chip-row" data-withdrawn={String(r.withdrawn)}>
                  <span>
                    {r.withdrawsInvolvementId
                      ? t("adoptionP4.involvement.withdrawal")
                      : r.involvementKind === "decision"
                        ? t("adoptionP4.involvement.onDecision", { code: decisionCode(r.decisionId) ?? "—" })
                        : t("adoptionP4.involvement.onWorkshop")}
                  </span>
                  {r.note ? <span className="muted small">{r.note}</span> : null}
                  {r.withdrawn ? <StatusText status="withdrawn" /> : null}
                  {canEdit && !r.withdrawn && !r.withdrawsInvolvementId ? (
                    <button
                      type="button"
                      className="button button--link button--small"
                      onClick={() => setWithdrawing(r.id)}
                    >
                      {t("adoptionP4.involvement.withdraw")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Dialog>
  );
}
