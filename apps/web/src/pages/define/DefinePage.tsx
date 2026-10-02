// Define (Phase 2) screen: North Star in one sentence (REQ-PB-033), the outcome tree with the 3-5 top outcomes
// (REQ-PB-032/035), the good outcome test per outcome with pass / fail / unknown and its reasons (REQ-PB-036), the T02
// Outcome & KPI Tree with a REQUIRED target date (REQ-PB-034), KPI definitions and strategic guardrails (REQ-PB-037).
// The good outcome test is computed by the server; the UI never upgrades an unknown or failing criterion to a pass.
import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  GUARDRAIL_CATEGORIES,
  KPI_FREQUENCIES,
  KPI_POLARITIES,
  KPI_UNIT_KINDS,
  kpiDefinitionCreate,
  kpiDefinitionUpdate,
  northStarWrite,
  outcomeCreate,
  outcomeKpiCreate,
  outcomeKpiUpdate,
  outcomeUpdate,
  strategicGuardrailCreate,
  strategicGuardrailUpdate,
} from "@mth/shared/schemas";
import { ApiError, api } from "../../api/client.ts";
import { useNorthStar, useNorthStarHistory, useP2Refresh, useRegister } from "../../api/queries.ts";
import type { Baseline, KpiDefinition, NorthStar, Outcome, OutcomeKpi, StrategicGuardrail } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Amount } from "../../components/Amount.tsx";
import { Dialog, Field, issueCode } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { RecordStatus, ResultChip } from "../../components/P2Badges.tsx";
import { PersonName, usePeople, type Person } from "../../components/People.tsx";
import { RecordDialog, type FieldSpec } from "../../components/RecordForm.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { ArchiveAction, NoteDecisionDialog } from "../../components/RowActions.tsx";
import { Section, SectionNav, TextCell } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { pick } from "../../lib/methodology.ts";
import { errorMessage, fieldErrorMessage } from "../../lib/problem.ts";

export function DefinePage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="define"
      title={t("define.title")}
      subtitle={t("define.intro")}
      writePermissions={[
        "north_star.edit",
        "outcome.edit",
        "kpi_definition.edit",
        "charter.edit",
        "kpi_target.approve",
      ]}
    >
      <SectionNav
        sections={[
          { id: "north-star", title: t("define.northStar.title") },
          { id: "outcomes", title: t("define.outcomes.title") },
          { id: "t02", title: t("kpi.t02.title") },
          { id: "kpi-definitions", title: t("kpi.definition.title") },
          { id: "guardrails", title: t("define.guardrails.title") },
        ]}
      />
      <NorthStarSection />
      <OutcomesSection />
      <T02Section />
      <KpiDefinitionsSection />
      <GuardrailsSection />
    </WorkspaceFrame>
  );
}

// ------------------------------------------------------------------------------------------------ North Star

function NorthStarSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const current = useNorthStar(ws.tid);
  const history = useNorthStarHistory(ws.tid);
  const [editing, setEditing] = useState(false);
  const canEdit = ws.can("north_star.edit");
  return (
    <Section
      id="north-star"
      title={t("define.northStar.title")}
      intro={t("define.northStar.intro")}
      actions={
        canEdit && !editing ? (
          <button type="button" className="button button--primary button--small" onClick={() => setEditing(true)}>
            <Icon name="pencil" /> {current.data ? t("define.northStar.refine") : t("define.northStar.set")}
          </button>
        ) : null
      }
    >
      <QueryState query={current}>
        {(ns) =>
          editing ? (
            <NorthStarForm current={ns} onDone={() => setEditing(false)} />
          ) : ns ? (
            <figure className="north-star-figure" data-north-star="current">
              <blockquote className="north-star">{ns.statement}</blockquote>
              <figcaption className="muted small">
                {t("define.northStar.since", {
                  when: formatDateTime(ns.createdAt, locale, ws.tr.timezone) ?? t("common.value.unknown"),
                })}
              </figcaption>
            </figure>
          ) : (
            <EmptyState title={t("define.northStar.notSet")} body={t("define.northStar.notSetBody")} />
          )
        }
      </QueryState>
      {history.data && history.data.filter((h) => h.status === "superseded").length > 0 ? (
        <details className="disclosure">
          <summary>{t("define.northStar.history")}</summary>
          <ol className="plain-list">
            {history.data
              .filter((h) => h.status === "superseded")
              .map((h) => (
                <li key={h.id}>
                  <q>{h.statement}</q>{" "}
                  <span className="muted small">
                    (
                    {t("define.northStar.supersededAt", {
                      when: formatDateTime(h.supersededAt, locale, ws.tr.timezone) ?? t("common.value.unknown"),
                    })}
                    )
                  </span>
                </li>
              ))}
          </ol>
        </details>
      ) : null}
    </Section>
  );
}

/** PUT /north-star: If-Match carries the current statement's version; the first one is set without it. */
function NorthStarForm({ current, onDone }: { current: NorthStar | null; onDone: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP2Refresh(ws.tid);
  const [statement, setStatement] = useState(current?.statement ?? "");
  const [error, setError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [base, setBase] = useState(current);
  const [conflict, setConflict] = useState<NorthStar | null>(null);

  const save = async (on: NorthStar | null) => {
    const parsed = northStarWrite.safeParse({ statement });
    if (!parsed.success) {
      setError(fieldErrorMessage(t, issueCode(parsed.error.issues[0]!)));
      return;
    }
    setError(undefined);
    setServerError(null);
    setBusy(true);
    try {
      await api.send(`/api/v1/transformations/${ws.tid}/north-star`, {
        method: "PUT",
        body: parsed.data,
        ...(on ? { ifMatch: on.version } : {}),
      });
      await refresh();
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        try {
          setConflict(await api.get<NorthStar>(`/api/v1/transformations/${ws.tid}/north-star`));
        } catch {
          setConflict(null);
        }
      }
      setServerError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(base);
      }}
    >
      {conflict ? (
        <section className="banner banner--warning conflict" role="alert" data-state="conflict">
          <h3 className="conflict__title">
            <Icon name="alert" /> {t("common.conflict.title")}
          </h3>
          <p>{t("define.northStar.conflict", { current: conflict.statement })}</p>
          <div className="form__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setBase(conflict);
                setConflict(null);
                setServerError(null);
                void save(conflict);
              }}
            >
              {t("common.conflict.reapply")}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => {
                setBase(conflict);
                setStatement(conflict.statement);
                setConflict(null);
                setServerError(null);
              }}
            >
              {t("common.conflict.discard")}
            </button>
          </div>
        </section>
      ) : serverError ? (
        <p className="banner banner--error" role="alert">
          <Icon name="alert" /> {errorMessage(t, serverError)}
        </p>
      ) : null}
      <Field label={t("define.northStar.statement")} hint={t("define.northStar.hint")} error={error} required>
        {(control) => (
          <input
            {...control}
            type="text"
            maxLength={300}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
          />
        )}
      </Field>
      <p className="muted small" aria-live="polite">
        {t("define.northStar.counter", { n: statement.length })}
      </p>
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={busy || conflict !== null}>
          {busy ? t("common.state.saving") : t("define.northStar.save")}
        </button>
        <button type="button" className="button button--secondary" onClick={onDone} disabled={busy}>
          {t("common.action.cancel")}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------------------------------------ outcomes

function OutcomesSection() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const outcomes = useRegister<Outcome>(ws.tid, "outcomes");
  const t02 = useRegister<OutcomeKpi>(ws.tid, "outcome-kpis");
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [dialog, setDialog] = useState<{ record: Outcome | null; parent: string | null } | null>(null);
  const canEdit = ws.can("outcome.edit");

  const list = (outcomes.data ?? []).filter((o) => o.status !== "archived");
  const fields: FieldSpec[] = [
    {
      name: "statement",
      kind: "textarea",
      label: t("define.outcomes.statement"),
      required: true,
      maxLength: 500,
      rows: 2,
      hint: t("define.outcomes.statementHint"),
    },
    { name: "description", kind: "textarea", label: t("common.field.description") },
    {
      name: "parentOutcomeId",
      kind: "select",
      label: t("define.outcomes.parent"),
      options: list.filter((o) => o.id !== dialog?.record?.id).map((o) => ({ value: o.id, label: o.statement })),
    },
    { name: "ownerUserId", kind: "person", label: t("define.outcomes.owner"), hint: t("define.outcomes.ownerHint") },
    { name: "isTopOutcome", kind: "checkbox", label: t("define.outcomes.isTop") },
    { name: "topRank", kind: "integer", label: t("define.outcomes.topRank"), min: 1, max: 99 },
    { name: "specificConfirmed", kind: "tristate", label: t("define.outcomes.specificConfirmed") },
    { name: "strategicallyRelevantConfirmed", kind: "tristate", label: t("define.outcomes.relevantConfirmed") },
    {
      name: "causalChain",
      kind: "textarea",
      label: t("define.outcomes.causalChain"),
      hint: t("define.outcomes.causalChainHint"),
    },
  ];

  const top = list.filter((o) => o.isTopOutcome);
  const roots = list.filter((o) => !o.parentOutcomeId || !list.some((p) => p.id === o.parentOutcomeId));
  return (
    <Section
      id="outcomes"
      title={t("define.outcomes.title")}
      intro={t("define.outcomes.intro")}
      actions={
        canEdit ? (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setDialog({ record: null, parent: null })}
          >
            <Icon name="plus" /> {t("define.outcomes.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={outcomes}>
        {() => (
          <>
            <p
              className={`banner ${top.length >= 3 && top.length <= 5 ? "banner--info" : "banner--warning"}`}
              role="status"
              data-top-outcomes={top.length}
            >
              {top.length >= 3 && top.length <= 5 ? <Icon name="info" /> : <Icon name="alert" />}{" "}
              {top.length >= 3 && top.length <= 5
                ? t("define.outcomes.topCountOk", { n: top.length })
                : t("define.charter.topOutcomesWarning", { n: top.length })}
            </p>
            {list.length === 0 ? (
              <EmptyState title={t("define.outcomes.empty")} body={t("define.outcomes.emptyBody")} />
            ) : (
              <ul className="outcome-tree" aria-label={t("define.outcomes.treeLabel")}>
                {roots.map((o) => (
                  <OutcomeNode
                    key={o.id}
                    outcome={o}
                    all={list}
                    t02={t02.data ?? []}
                    people={byId}
                    depth={1}
                    onEdit={(r) => setDialog({ record: r, parent: r.parentOutcomeId })}
                    onAddChild={(parent) => setDialog({ record: null, parent })}
                    onRefresh={refresh}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </QueryState>
      {dialog ? (
        <RecordDialog<Outcome>
          title={dialog.record ? t("define.outcomes.editTitle") : t("define.outcomes.add")}
          fields={fields}
          record={dialog.record}
          defaults={{ parentOutcomeId: dialog.parent, ownerUserId: null, isTopOutcome: dialog.parent === null }}
          createSchema={outcomeCreate}
          updateSchema={outcomeUpdate}
          createUrl={`/api/v1/transformations/${ws.tid}/outcomes`}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/outcomes/${r.id}`}
          people={people}
          submitLabel={dialog.record ? t("common.action.save") : t("common.action.create")}
          onSaved={async () => {
            await refresh();
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      ) : null}
    </Section>
  );
}

function OutcomeNode({
  outcome,
  all,
  t02,
  people,
  depth,
  onEdit,
  onAddChild,
  onRefresh,
}: {
  outcome: Outcome;
  all: readonly Outcome[];
  t02: readonly OutcomeKpi[];
  people: ReadonlyMap<string, Person>;
  depth: number;
  onEdit: (o: Outcome) => void;
  onAddChild: (parentId: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const children = all.filter((c) => c.parentOutcomeId === outcome.id);
  const kpiCount = t02.filter((k) => k.outcomeId === outcome.id && k.status !== "archived").length;
  const canEdit = ws.can("outcome.edit");
  return (
    <li
      className="outcome-node"
      data-outcome={outcome.id}
      data-good-outcome={outcome.goodOutcomePass ? "pass" : "not-pass"}
    >
      <article className="outcome-card" aria-labelledby={`outcome-${outcome.id}`}>
        <div className="outcome-card__head">
          <h3 id={`outcome-${outcome.id}`} className="outcome-card__title">
            {outcome.statement}
          </h3>
          <span className="chip-row">
            {outcome.isTopOutcome ? (
              <span className="lifecycle-chip" data-top-rank={outcome.topRank ?? ""}>
                <Icon name="chevronUp" />{" "}
                {outcome.topRank
                  ? t("define.outcomes.topWithRank", { rank: outcome.topRank })
                  : t("define.outcomes.top")}
              </span>
            ) : null}
            <RecordStatus status={outcome.status} />
          </span>
        </div>
        <dl className="details details--compact">
          <div>
            <dt>{t("define.outcomes.owner")}</dt>
            <dd>
              <PersonName id={outcome.ownerUserId} people={people} />
            </dd>
          </div>
          <div>
            <dt>{t("define.outcomes.linkedKpis")}</dt>
            <dd>
              {kpiCount === 0 ? (
                <span className="muted">{t("define.outcomes.noKpi")}</span>
              ) : (
                <bdi dir="ltr">{kpiCount}</bdi>
              )}
            </dd>
          </div>
        </dl>
        <GoodOutcomeTest outcome={outcome} />
        {canEdit ? (
          <div className="row-actions">
            <button type="button" className="button button--link button--small" onClick={() => onEdit(outcome)}>
              <Icon name="pencil" /> {t("common.action.edit")}
              <span className="visually-hidden">: {outcome.statement}</span>
            </button>
            <button type="button" className="button button--link button--small" onClick={() => onAddChild(outcome.id)}>
              <Icon name="plus" /> {t("define.outcomes.addChild")}
              <span className="visually-hidden">: {outcome.statement}</span>
            </button>
            <ArchiveAction
              url={`/api/v1/transformations/${ws.tid}/outcomes/${outcome.id}`}
              version={outcome.version}
              name={outcome.statement}
              onDone={onRefresh}
            />
          </div>
        ) : null}
      </article>
      {children.length > 0 ? (
        <ul className="outcome-tree outcome-tree--nested">
          {children.map((c) => (
            <OutcomeNode
              key={c.id}
              outcome={c}
              all={all}
              t02={t02}
              people={people}
              depth={depth + 1}
              onEdit={onEdit}
              onAddChild={onAddChild}
              onRefresh={onRefresh}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The good outcome test (B0051): each catalogue criterion with pass / fail / unknown and a localized reason derived
 * from the criterion and the recorded inputs. The outcome passes only when every criterion passes (server-computed).
 */
export function GoodOutcomeTest({ outcome }: { outcome: Outcome }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const criteria = ws.methodology.goodOutcomeCriteria;
  const results = [...outcome.goodOutcomeTest].sort((a, b) => a.ordinal - b.ordinal);
  const fails = results.filter((r) => r.result === "fail").length;
  const unknowns = results.filter((r) => r.result === "unknown").length;
  return (
    <div className="good-outcome" data-good-outcome-test={outcome.id}>
      <p className="good-outcome__summary">
        <strong>{t("define.goodOutcome.title")}:</strong>{" "}
        {results.length === 0 ? (
          <ResultChip result="unknown" label={t("define.goodOutcome.notEvaluated")} />
        ) : outcome.goodOutcomePass ? (
          <ResultChip result="pass" label={t("define.goodOutcome.passes")} />
        ) : (
          <ResultChip
            result={fails > 0 ? "fail" : "unknown"}
            label={t("define.goodOutcome.notPassing", { fails, unknowns })}
          />
        )}
      </p>
      <table className="table table--compact good-outcome__table">
        <caption className="visually-hidden">{t("define.goodOutcome.caption", { outcome: outcome.statement })}</caption>
        <thead>
          <tr>
            <th scope="col">{t("define.goodOutcome.criterion")}</th>
            <th scope="col">{t("define.goodOutcome.result")}</th>
            <th scope="col">{t("define.goodOutcome.reason")}</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const def = criteria.find((c) => c.code === r.criterionCode);
            return (
              <tr key={r.criterionCode} data-criterion={r.criterionCode} data-result={r.result}>
                <th scope="row">
                  {def ? pick(locale, def.sourceLabelEn, def.labelAr) : t("define.goodOutcome.unknownCriterion")}
                </th>
                <td>
                  <ResultChip result={r.result} />
                </td>
                <td>{goodOutcomeReason(t, outcome, r.criterionCode, r.result)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Localized reason for one criterion result; mirrors the server's evaluator inputs (good-outcome.ts). */
function goodOutcomeReason(t: TFunction, o: Outcome, code: string, result: "pass" | "fail" | "unknown"): string {
  const known = ["specific", "measurable", "strategically_relevant", "owned_by_business_leader", "causal_chain"];
  if (!known.includes(code)) return t("define.goodOutcome.reasons.noEvaluator");
  if (code === "specific" && result === "fail")
    return o.specificConfirmed === false
      ? t("define.goodOutcome.reasons.specific.notConfirmed")
      : t("define.goodOutcome.reasons.specific.activity");
  if (code === "owned_by_business_leader" && result === "fail")
    return o.ownerUserId === null
      ? t("define.goodOutcome.reasons.owned_by_business_leader.noOwner")
      : t("define.goodOutcome.reasons.owned_by_business_leader.inactive");
  return t(`define.goodOutcome.reasons.${code}.${result}`, {
    defaultValue: t("define.goodOutcome.reasons.noEvaluator"),
  });
}

// ------------------------------------------------------------------------------------------------ T02

function T02Section() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const rows = useRegister<OutcomeKpi>(ws.tid, "outcome-kpis");
  const outcomes = useRegister<Outcome>(ws.tid, "outcomes");
  const kpis = useRegister<KpiDefinition>(ws.tid, "kpi-definitions");
  const baselines = useRegister<Baseline>(ws.tid, "baselines");
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [dialog, setDialog] = useState<{ record: OutcomeKpi | null } | null>(null);
  const [approving, setApproving] = useState<OutcomeKpi | null>(null);
  const canEdit = ws.can("outcome.edit");
  const canApprove = ws.can("kpi_target.approve");
  const activeOutcomes = (outcomes.data ?? []).filter((o) => o.status !== "archived");
  const activeKpis = (kpis.data ?? []).filter((k) => k.status !== "archived");
  const kpiName = (id: string | null) => (id ? (kpis.data?.find((k) => k.id === id)?.name ?? null) : null);

  const fields: FieldSpec[] = [
    {
      name: "outcomeId",
      kind: "select",
      label: t("kpi.t02.outcome"),
      required: true,
      options: activeOutcomes.map((o) => ({ value: o.id, label: o.statement })),
    },
    {
      name: "kpiDefinitionId",
      kind: "select",
      label: t("kpi.definition.single"),
      required: true,
      options: activeKpis.map((k) => ({ value: k.id, label: k.name })),
    },
    {
      name: "targetDate",
      kind: "date",
      label: t("kpi.t02.targetDate"),
      required: true,
      hint: t("kpi.t02.targetDateHint"),
    },
    {
      name: "baselineId",
      kind: "select",
      label: t("kpi.baseline.single"),
      options: (baselines.data ?? [])
        .filter((b) => b.status !== "archived")
        .map((b) => ({ value: b.id, label: b.metric })),
    },
    { name: "baselineValue", kind: "decimal", label: t("kpi.t02.baselineValue"), hint: t("kpi.t02.baselineValueHint") },
    { name: "targetValue", kind: "decimal", label: t("kpi.t02.targetValue"), hint: t("kpi.decimalHint") },
    { name: "ownerUserId", kind: "person", label: t("common.field.owner") },
    { name: "leadingIndicatorText", kind: "textarea", label: t("kpi.t02.leadingIndicator") },
    {
      name: "leadingKpiDefinitionId",
      kind: "select",
      label: t("kpi.t02.leadingKpi"),
      options: activeKpis.filter((k) => k.isLeading).map((k) => ({ value: k.id, label: k.name })),
    },
    { name: "ordinal", kind: "integer", label: t("kpi.t02.ordinal"), min: 1 },
    {
      name: "trajectoryPoints",
      kind: "trajectory",
      label: t("kpi.t02.trajectory"),
      hint: t("kpi.t02.trajectoryHint"),
      rows: 4,
    },
  ];

  const columns: RegisterColumn<OutcomeKpi>[] = [
    {
      id: "outcome",
      header: t("kpi.t02.outcome"),
      cell: (r) => outcomes.data?.find((o) => o.id === r.outcomeId)?.statement ?? <Unknown />,
      sortValue: (r) => outcomes.data?.find((o) => o.id === r.outcomeId)?.statement,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "kpi",
      header: t("kpi.definition.single"),
      cell: (r) => kpiName(r.kpiDefinitionId) ?? <Unknown />,
      sortValue: (r) => kpiName(r.kpiDefinitionId),
    },
    {
      id: "baseline",
      header: t("kpi.t02.baselineValue"),
      cell: (r) => {
        const b = r.baselineId ? baselines.data?.find((x) => x.id === r.baselineId) : undefined;
        const value = r.baselineValue ?? b?.value ?? null;
        return <Amount value={value} maxFractionDigits={6} />;
      },
    },
    {
      id: "target",
      header: t("kpi.t02.targetValue"),
      cell: (r) => <Amount value={r.targetValue} maxFractionDigits={6} />,
    },
    {
      id: "targetDate",
      header: t("kpi.t02.targetDate"),
      cell: (r) => formatBusinessDate(r.targetDate, locale) ?? <Unknown />,
      sortValue: (r) => r.targetDate,
    },
    {
      id: "leading",
      header: t("kpi.t02.leadingIndicator"),
      cell: (r) =>
        r.leadingIndicatorText ? (
          <TextCell value={r.leadingIndicatorText} />
        ) : (
          (kpiName(r.leadingKpiDefinitionId) ?? <span className="muted">{t("common.value.none")}</span>)
        ),
    },
    {
      id: "trajectory",
      header: t("kpi.t02.trajectoryStatus"),
      cell: (r) => (
        <span>
          {r.trajectoryStatus === "approved" ? (
            <span className="status-chip status-chip--on-track" data-trajectory="approved">
              <Icon name="check" /> {t("kpi.t02.trajectoryApproved")}
            </span>
          ) : (
            <span className="lifecycle-chip lifecycle-chip--draft" data-trajectory="draft">
              <Icon name="pencil" /> {t("kpi.t02.trajectoryDraft")}
            </span>
          )}
          <span className="block small muted">{t("kpi.t02.points", { n: r.trajectoryPoints.length })}</span>
        </span>
      ),
      sortValue: (r) => r.trajectoryStatus,
    },
    { id: "owner", header: t("common.field.owner"), cell: (r) => <PersonName id={r.ownerUserId} people={byId} /> },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (r) =>
        canEdit || canApprove ? (
          <span className="row-actions">
            {canEdit ? (
              <button
                type="button"
                className="button button--link button--small"
                onClick={() => setDialog({ record: r })}
              >
                <Icon name="pencil" /> {t("common.action.edit")}
                <span className="visually-hidden">: {kpiName(r.kpiDefinitionId) ?? ""}</span>
              </button>
            ) : null}
            {canApprove && r.trajectoryStatus !== "approved" ? (
              <button type="button" className="button button--link button--small" onClick={() => setApproving(r)}>
                <Icon name="check" /> {t("kpi.t02.approve")}
                <span className="visually-hidden">: {kpiName(r.kpiDefinitionId) ?? ""}</span>
              </button>
            ) : null}
            {canEdit ? (
              <ArchiveAction
                url={`/api/v1/transformations/${ws.tid}/outcome-kpis/${r.id}`}
                version={r.version}
                name={kpiName(r.kpiDefinitionId) ?? t("kpi.t02.row")}
                onDone={refresh}
              />
            ) : null}
          </span>
        ) : (
          <span className="muted small">{t("common.readOnly")}</span>
        ),
    },
  ];

  return (
    <Section
      id="t02"
      title={t("kpi.t02.title")}
      intro={t("kpi.t02.intro")}
      actions={
        canEdit ? (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setDialog({ record: null })}
            disabled={activeOutcomes.length === 0 || activeKpis.length === 0}
          >
            <Icon name="plus" /> {t("kpi.t02.add")}
          </button>
        ) : null
      }
    >
      {canEdit && (activeOutcomes.length === 0 || activeKpis.length === 0) ? (
        <p className="muted small">{t("kpi.t02.prerequisites")}</p>
      ) : null}
      <QueryState query={rows}>
        {(list) => (
          <RegisterTable
            id="t02"
            caption={t("kpi.t02.title")}
            rows={list.filter((r) => r.status !== "archived")}
            columns={columns}
            getRowId={(r) => r.id}
            emptyTitle={t("kpi.t02.empty")}
            emptyBody={t("kpi.t02.emptyBody")}
          />
        )}
      </QueryState>
      {dialog ? (
        <RecordDialog<OutcomeKpi>
          title={dialog.record ? t("kpi.t02.editTitle") : t("kpi.t02.add")}
          fields={fields}
          record={dialog.record}
          defaults={{ trajectoryPoints: [] }}
          createSchema={outcomeKpiCreate}
          updateSchema={outcomeKpiUpdate}
          createUrl={`/api/v1/transformations/${ws.tid}/outcome-kpis`}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/outcome-kpis/${r.id}`}
          people={people}
          submitLabel={dialog.record ? t("common.action.save") : t("common.action.create")}
          onSaved={async () => {
            await refresh();
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      ) : null}
      {approving ? (
        <NoteDecisionDialog
          title={t("kpi.t02.approveTitle", { kpi: kpiName(approving.kpiDefinitionId) ?? t("kpi.t02.row") })}
          description={t("kpi.t02.approveDescription")}
          noteLabel={t("kpi.t02.approveNote")}
          noteRequired={false}
          confirmLabel={t("kpi.t02.approve")}
          url={`/api/v1/transformations/${ws.tid}/outcome-kpis/${approving.id}/trajectory-approval`}
          version={approving.version}
          toBody={({ note }) => (note ? { note } : {})}
          onDone={refresh}
          onClose={() => setApproving(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ KPI definitions

function KpiDefinitionsSection() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const kpis = useRegister<KpiDefinition>(ws.tid, "kpi-definitions");
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [dialog, setDialog] = useState<{ record: KpiDefinition | null } | null>(null);
  const [activating, setActivating] = useState<KpiDefinition | null>(null);
  const canEdit = ws.can("kpi_definition.edit");

  const fields: FieldSpec[] = [
    { name: "name", kind: "text", label: t("common.field.name"), required: true, maxLength: 200 },
    { name: "description", kind: "textarea", label: t("common.field.description") },
    { name: "businessPurpose", kind: "textarea", label: t("kpi.definition.businessPurpose") },
    {
      name: "unitKind",
      kind: "select",
      label: t("kpi.definition.unitKind"),
      required: true,
      options: KPI_UNIT_KINDS.map((u) => ({ value: u, label: t(`kpi.definition.unitKinds.${u}`) })),
    },
    { name: "unitLabel", kind: "text", label: t("kpi.definition.unitLabel"), maxLength: 50 },
    {
      name: "currency",
      kind: "select",
      label: t("common.field.currency"),
      hint: t("kpi.definition.currencyHint"),
      options: [...new Set([ws.tr.currency, "SAR"])].map((c) => ({ value: c, label: c })),
    },
    {
      name: "polarity",
      kind: "select",
      label: t("kpi.definition.polarity"),
      required: true,
      options: KPI_POLARITIES.map((p) => ({ value: p, label: t(`kpi.definition.polarities.${p}`) })),
    },
    {
      name: "frequency",
      kind: "select",
      label: t("kpi.definition.frequency"),
      options: KPI_FREQUENCIES.map((f) => ({ value: f, label: t(`kpi.definition.frequencies.${f}`) })),
    },
    { name: "isLeading", kind: "checkbox", label: t("kpi.definition.isLeading") },
    { name: "dataSource", kind: "text", label: t("kpi.definition.dataSource"), maxLength: 500 },
    { name: "ownerUserId", kind: "person", label: t("common.field.owner") },
    { name: "stewardUserId", kind: "person", label: t("kpi.definition.steward") },
  ];
  const columns: RegisterColumn<KpiDefinition>[] = [
    {
      id: "name",
      header: t("common.field.name"),
      cell: (k) => k.name,
      sortValue: (k) => k.name,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "unit",
      header: t("kpi.definition.unitKind"),
      cell: (k) =>
        `${t(`kpi.definition.unitKinds.${k.unitKind}`)}${k.unitLabel ? ` (${k.unitLabel})` : ""}${k.currency ? ` · ${k.currency}` : ""}`,
      sortValue: (k) => k.unitKind,
    },
    {
      id: "polarity",
      header: t("kpi.definition.polarity"),
      cell: (k) => t(`kpi.definition.polarities.${k.polarity}`),
      sortValue: (k) => k.polarity,
    },
    {
      id: "frequency",
      header: t("kpi.definition.frequency"),
      cell: (k) => t(`kpi.definition.frequencies.${k.frequency}`),
      sortValue: (k) => k.frequency,
    },
    {
      id: "leading",
      header: t("kpi.definition.kind"),
      cell: (k) => (k.isLeading ? t("kpi.definition.leading") : t("kpi.definition.lagging")),
      sortValue: (k) => (k.isLeading ? 0 : 1),
    },
    { id: "owner", header: t("common.field.owner"), cell: (k) => <PersonName id={k.ownerUserId} people={byId} /> },
    {
      id: "status",
      header: t("common.field.status"),
      cell: (k) => <RecordStatus status={k.status} />,
      sortValue: (k) => k.status,
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (k) =>
        canEdit ? (
          <span className="row-actions">
            <button
              type="button"
              className="button button--link button--small"
              onClick={() => setDialog({ record: k })}
            >
              <Icon name="pencil" /> {t("common.action.edit")}
              <span className="visually-hidden">: {k.name}</span>
            </button>
            {k.status === "draft" ? (
              <button
                type="button"
                className="button button--link button--small"
                data-action="activate-kpi"
                onClick={() => setActivating(k)}
              >
                <Icon name="check" /> {t("kpi.definition.activate.action")}
                <span className="visually-hidden">: {k.name}</span>
              </button>
            ) : null}
            <ArchiveAction
              url={`/api/v1/transformations/${ws.tid}/kpi-definitions/${k.id}`}
              version={k.version}
              name={k.name}
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
      id="kpi-definitions"
      title={t("kpi.definition.title")}
      intro={t("kpi.definition.intro")}
      actions={
        canEdit ? (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setDialog({ record: null })}
          >
            <Icon name="plus" /> {t("kpi.definition.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={kpis}>
        {(list) => (
          <RegisterTable
            id="kpi-definitions"
            caption={t("kpi.definition.title")}
            rows={list.filter((k) => k.status !== "archived")}
            columns={columns}
            getRowId={(k) => k.id}
            emptyTitle={t("kpi.definition.empty")}
          />
        )}
      </QueryState>
      {dialog ? (
        <RecordDialog<KpiDefinition>
          title={dialog.record ? t("kpi.definition.editTitle") : t("kpi.definition.add")}
          fields={fields}
          record={dialog.record}
          defaults={{ ownerUserId: ws.meId, frequency: "monthly", isLeading: false }}
          createSchema={kpiDefinitionCreate}
          updateSchema={kpiDefinitionUpdate}
          createUrl={`/api/v1/transformations/${ws.tid}/kpi-definitions`}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/kpi-definitions/${r.id}`}
          people={people}
          submitLabel={dialog.record ? t("common.action.save") : t("common.action.create")}
          onSaved={async () => {
            await refresh();
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      ) : null}
      {activating ? <ActivateKpiDialog kpi={activating} onDone={refresh} onClose={() => setActivating(null)} /> : null}
    </Section>
  );
}

/** JSON pointer of an activation precondition (422 kpi_definition.not_measurable) -> its localized reason key. */
const ACTIVATION_POINTERS = ["unitKind", "polarity", "currency", "unitLabel"] as const;

/** The specific unmet precondition of a refused activation, or null (the generic problem message then stands alone). */
export function activationReason(t: TFunction, error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const pointer = error.fieldErrors[0]?.pointer?.replace(/^\//, "") ?? "";
  const known = ACTIVATION_POINTERS.find((p) => p === pointer);
  return known ? t(`kpi.definition.activate.missing.${known}`) : null;
}

/**
 * Activate a draft KPI definition (POST …/kpi-definitions/{id}/activate, If-Match; F-DG2-201, REQ-PB-017). The server
 * decides: a 422 states which precondition is unmet (unit kind, polarity, currency or unit label); a 409 refreshes the
 * list so the next attempt carries the current version. Nothing is activated by the UI on its own.
 */
function ActivateKpiDialog({
  kpi,
  onDone,
  onClose,
}: {
  kpi: KpiDefinition;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<unknown>(null);
  const reason = activationReason(t, serverError);
  const activate = async () => {
    setBusy(true);
    setServerError(null);
    try {
      await api.send(`/api/v1/transformations/${ws.tid}/kpi-definitions/${kpi.id}/activate`, {
        method: "POST",
        ifMatch: kpi.version,
      });
      await onDone();
      onClose();
    } catch (e) {
      setServerError(e);
      if (e instanceof ApiError && e.status === 409) await onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t("kpi.definition.activate.title", { name: kpi.name })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void activate()} disabled={busy}>
            {busy ? t("common.state.saving") : t("kpi.definition.activate.confirm")}
          </button>
        </>
      }
    >
      <p>{t("kpi.definition.activate.description")}</p>
      <p className="muted small">{t("kpi.definition.activate.preconditions")}</p>
      {serverError ? (
        <div
          className="banner banner--error"
          role="alert"
          data-state={serverError instanceof ApiError && serverError.status === 409 ? "conflict" : "error"}
          data-problem={serverError instanceof ApiError ? (serverError.code ?? "") : ""}
        >
          <p>
            <Icon name="alert" /> {errorMessage(t, serverError)}
          </p>
          {reason ? <p data-activation-reason>{reason}</p> : null}
        </div>
      ) : null}
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ guardrails

function GuardrailsSection() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const guardrails = useRegister<StrategicGuardrail>(ws.tid, "strategic-guardrails");
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [dialog, setDialog] = useState<{ record: StrategicGuardrail | null } | null>(null);
  const canEdit = ws.can("charter.edit");
  const fields: FieldSpec[] = [
    { name: "title", kind: "text", label: t("define.guardrails.titleField"), required: true, maxLength: 200 },
    {
      name: "category",
      kind: "select",
      label: t("define.guardrails.category"),
      required: true,
      options: GUARDRAIL_CATEGORIES.map((c) => ({ value: c, label: t(`define.guardrails.categories.${c}`) })),
    },
    { name: "statement", kind: "textarea", label: t("define.guardrails.statement"), required: true, rows: 4 },
    { name: "ownerUserId", kind: "person", label: t("common.field.owner") },
  ];
  const columns: RegisterColumn<StrategicGuardrail>[] = [
    {
      id: "title",
      header: t("define.guardrails.titleField"),
      cell: (g) => g.title,
      sortValue: (g) => g.title,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "category",
      header: t("define.guardrails.category"),
      cell: (g) => t(`define.guardrails.categories.${g.category}`),
      sortValue: (g) => g.category,
    },
    {
      id: "statement",
      header: t("define.guardrails.statement"),
      cell: (g) => <TextCell value={g.statement} />,
      sortValue: (g) => g.statement,
    },
    { id: "owner", header: t("common.field.owner"), cell: (g) => <PersonName id={g.ownerUserId} people={byId} /> },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (g) =>
        canEdit ? (
          <span className="row-actions">
            <button
              type="button"
              className="button button--link button--small"
              onClick={() => setDialog({ record: g })}
            >
              <Icon name="pencil" /> {t("common.action.edit")}
              <span className="visually-hidden">: {g.title}</span>
            </button>
            <ArchiveAction
              url={`/api/v1/transformations/${ws.tid}/strategic-guardrails/${g.id}`}
              version={g.version}
              name={g.title}
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
      id="guardrails"
      title={t("define.guardrails.title")}
      intro={t("define.guardrails.intro")}
      actions={
        canEdit ? (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setDialog({ record: null })}
          >
            <Icon name="plus" /> {t("define.guardrails.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={guardrails}>
        {(list) => (
          <RegisterTable
            id="guardrails"
            caption={t("define.guardrails.title")}
            rows={list.filter((g) => g.status !== "archived")}
            columns={columns}
            getRowId={(g) => g.id}
            emptyTitle={t("define.guardrails.empty")}
          />
        )}
      </QueryState>
      {dialog ? (
        <RecordDialog<StrategicGuardrail>
          title={dialog.record ? t("define.guardrails.editTitle") : t("define.guardrails.add")}
          fields={fields}
          record={dialog.record}
          createSchema={strategicGuardrailCreate}
          updateSchema={strategicGuardrailUpdate}
          createUrl={`/api/v1/transformations/${ws.tid}/strategic-guardrails`}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/strategic-guardrails/${r.id}`}
          people={people}
          submitLabel={dialog.record ? t("common.action.save") : t("common.action.create")}
          onSaved={async () => {
            await refresh();
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      ) : null}
    </Section>
  );
}
