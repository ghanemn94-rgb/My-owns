// Champion constraints on the T04 design decision page (T-DG4-FE-E; p4-work-split §F+G FG.8; ADR-0033 §7).
// SYNTHETIC data only in tests and demos.
//  - REQ-PB-073: a champion's constraint links to a T04 design decision and is visible on that decision. The section
//    lists the constraints of the chosen decision through `listChampionConstraints?decisionId=` (the new P4
//    operation; the DG2 Decision schema and operations are unchanged).
//  - Raising is in person by an active champion of the group (403 champion_constraint.not_champion otherwise, shown
//    translated); addressing needs a decision editor, withdrawing the raising champion (the API decides).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CHAMPION_CONSTRAINT_STATUSES } from "@mth/shared/schemas";
import { useDecisions } from "../../api/queries.ts";
import { useP4Refresh } from "../../api/p4.ts";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { P4FormDialog, type P4FieldSpec } from "../my-work/p4ui.tsx";
import {
  adoptionPaths,
  useChampionConstraints,
  useChampions,
  useStakeholderGroups,
  type ChampionConstraint,
} from "./api.ts";
import { Code, NS, StatusText } from "./ui.tsx";

/** The section shown on the T04 Design Decision Log page (pages/decisions/DecisionsPage.tsx). */
export function ChampionConstraintsSection() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const decisions = useDecisions(ws.tid, "design");
  const [decisionId, setDecisionId] = useState("");
  const [status, setStatus] = useState("");
  const list = useChampionConstraints(ws.tid, {
    ...(decisionId ? { decisionId } : {}),
    ...(status ? { status } : {}),
  });
  const groups = useStakeholderGroups(ws.tid);
  const { byId } = usePeople(ws.tid);
  const [dialog, setDialog] = useState<{ kind: "raise" } | { kind: "resolve"; row: ChampionConstraint } | null>(null);
  const groupCode = (id: string) => (groups.data ?? []).find((g) => g.id === id)?.code ?? "—";
  const columns: RegisterColumn<ChampionConstraint>[] = [
    {
      id: "decision",
      header: t("adoptionP4.constraints.decision"),
      rowHeader: true,
      hideable: false,
      cell: (c) => <Code>{c.decisionCode}</Code>,
      sortValue: (c) => c.decisionCode,
    },
    { id: "text", header: t("adoptionP4.constraints.text"), cell: (c) => <TextCell value={c.constraintText} /> },
    {
      id: "group",
      header: t("adoptionP4.col.stakeholder"),
      cell: (c) => <Code>{groupCode(c.stakeholderGroupId)}</Code>,
    },
    {
      id: "champion",
      header: t("adoptionP4.constraints.champion"),
      cell: (c) => <PersonName id={c.createdBy} people={byId} />,
    },
    {
      id: "status",
      header: t("adoptionP4.col.status"),
      cell: (c) => (
        <span className="block">
          <StatusText status={c.status} />
          {c.responseText ? <span className="block small">{c.responseText}</span> : null}
        </span>
      ),
      filterText: (c) => t(`adoptionP4.status.${c.status}`),
    },
    {
      id: "rowActions",
      header: t("adoptionP4.col.actions"),
      hideable: false,
      cell: (c) =>
        c.status === "open" && (ws.can("decision.edit") || c.createdBy === ws.meId) ? (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => setDialog({ kind: "resolve", row: c })}
            data-resolve={c.id}
          >
            {t("adoptionP4.constraints.resolve")}
            <span className="visually-hidden"> {c.decisionCode}</span>
          </button>
        ) : null,
    },
  ];
  return (
    <Section
      id="champion-constraints"
      title={t("adoptionP4.constraints.title")}
      intro={t("adoptionP4.constraints.intro")}
      actions={
        ws.can("champion_constraint.raise") ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setDialog({ kind: "raise" })}
            data-raise-constraint
          >
            <Icon name="plus" /> {t("adoptionP4.constraints.raise")}
          </button>
        ) : null
      }
    >
      <div className="filters" role="group" aria-label={t("adoptionP4.filters")}>
        <div className="filters__select">
          <label htmlFor="constraint-decision">{t("adoptionP4.constraints.decision")}</label>
          <select id="constraint-decision" value={decisionId} onChange={(e) => setDecisionId(e.target.value)}>
            <option value="">{t("adoptionP4.all")}</option>
            {(decisions.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} · {d.title}
              </option>
            ))}
          </select>
        </div>
        <div className="filters__select">
          <label htmlFor="constraint-status">{t("adoptionP4.col.status")}</label>
          <select id="constraint-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("adoptionP4.all")}</option>
            {CHAMPION_CONSTRAINT_STATUSES.map((v) => (
              <option key={v} value={v}>
                {t(`adoptionP4.status.${v}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <QueryState query={list}>
        {(rows) => (
          <RegisterTable
            id="champion-constraints"
            caption={t("adoptionP4.constraints.title")}
            rows={rows}
            columns={columns}
            getRowId={(c) => c.id}
            emptyTitle={t("adoptionP4.constraints.empty")}
            defaultSort={{ id: "decision", dir: "asc" }}
          />
        )}
      </QueryState>
      {dialog?.kind === "raise" ? <RaiseDialog decisionId={decisionId} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "resolve" ? <ResolveDialog row={dialog.row} onClose={() => setDialog(null)} /> : null}
    </Section>
  );
}

/** Raise as one of my own active championships (a champion raises in person). */
function RaiseDialog({ decisionId, onClose }: { decisionId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const decisions = useDecisions(ws.tid, "design");
  const groups = useStakeholderGroups(ws.tid, { status: "active" });
  const [groupId, setGroupId] = useState("");
  const champions = useChampions(ws.tid, groupId, Boolean(groupId));
  const mine = (champions.data ?? []).find((c) => c.userId === ws.meId && c.status === "active");
  const fields: P4FieldSpec[] = [
    {
      name: "groupId",
      label: t("adoptionP4.constraints.asChampionOf"),
      kind: "select",
      required: true,
      options: (groups.data ?? []).map((g) => ({ value: g.id, label: `${g.code} · ${g.name}` })),
    },
    {
      name: "decisionId",
      label: t("adoptionP4.constraints.decision"),
      kind: "select",
      required: true,
      options: (decisions.data ?? []).map((d) => ({ value: d.id, label: `${d.code} · ${d.title}` })),
    },
    {
      name: "constraintText",
      label: t("adoptionP4.constraints.text"),
      kind: "textarea",
      required: true,
      min: 3,
      max: 4000,
    },
  ];
  return (
    <P4FormDialog
      title={t("adoptionP4.constraints.raise")}
      description={t("adoptionP4.constraints.raiseIntro")}
      fields={fields}
      initial={{ decisionId }}
      onValuesChange={(v) => setGroupId(typeof v["groupId"] === "string" ? v["groupId"] : "")}
      submitLabel={t("adoptionP4.constraints.raiseSubmit")}
      url={adoptionPaths.constraints(ws.tid)}
      namespaces={NS}
      toBody={(v) =>
        // The caller is not an active champion of the chosen group: nothing is sent, and the form says so in the
        // API's own words (champion_constraint.not_champion), on the group field.
        mine
          ? { championId: mine.id, decisionId: v["decisionId"], constraintText: v["constraintText"] }
          : { fieldErrors: { groupId: "champion_constraint.not_champion" } }
      }
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function ResolveDialog({ row, onClose }: { row: ChampionConstraint; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const outcomes = [
    ...(ws.can("decision.edit") ? ["addressed"] : []),
    ...(row.createdBy === ws.meId ? ["withdrawn"] : []),
  ];
  return (
    <P4FormDialog
      title={t("adoptionP4.constraints.resolveTitle", { code: row.decisionCode })}
      fields={[
        {
          name: "outcome",
          label: t("adoptionP4.constraints.outcome"),
          kind: "select",
          required: true,
          options: outcomes.map((o) => ({ value: o, label: t(`adoptionP4.status.${o}`) })),
        },
        {
          name: "responseText",
          label: t("adoptionP4.constraints.response"),
          kind: "textarea",
          required: true,
          min: 3,
          max: 4000,
          when: (v) => v["outcome"] === "addressed",
        },
      ]}
      initial={{ outcome: outcomes.length === 1 ? outcomes[0]! : "" }}
      submitLabel={t("adoptionP4.save")}
      url={adoptionPaths.constraintResolve(ws.tid, row.id)}
      version={row.version}
      namespaces={NS}
      toBody={(v) => ({
        outcome: v["outcome"],
        ...(v["outcome"] === "addressed" ? { responseText: v["responseText"] } : {}),
      })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}
