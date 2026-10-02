// Transformation Charter (REQ-PB-029/030/031/035): the 14 charter fields (B0035), the four-part transformation thesis
// (B0037), the five scope sanity checks with the system pre-checks (B0038-B0043), the version history with a field
// diff, and the 3-5 top-outcomes warning. Every saved change is a new immutable version (server side); a version
// conflict shows "nothing was saved" with compare / re-apply / discard.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { charterUpdate, charterWrite, SCOPE_CHECK_CODES, type Warning } from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { useCharter, useCharterVersions, useNorthStar, useP2Refresh } from "../../api/queries.ts";
import type { Charter, CharterVersion, CharterView } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Icon } from "../../components/Icon.tsx";
import { ResultChip } from "../../components/P2Badges.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { InlineRecordForm, type FieldSpec } from "../../components/RecordForm.tsx";
import { Section, SectionNav, TextCell } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { pick } from "../../lib/methodology.ts";

/** Scope check code -> the charter's answer and evidence fields. */
const SCOPE_FIELDS: Record<(typeof SCOPE_CHECK_CODES)[number], { answer: keyof Charter; evidence: keyof Charter }> = {
  outcome_linkage: { answer: "scOutcomeLinkage", evidence: "scOutcomeLinkageEvidence" },
  problem_traceability: { answer: "scProblemTraceability", evidence: "scProblemTraceabilityEvidence" },
  exclusions_documented: { answer: "scExclusionsDocumented", evidence: "scExclusionsDocumentedEvidence" },
  baseline_measurable: { answer: "scBaselineMeasurable", evidence: "scBaselineMeasurableEvidence" },
  executive_decisions_visible: {
    answer: "scExecutiveDecisionsVisible",
    evidence: "scExecutiveDecisionsVisibleEvidence",
  },
};

/** The fields compared in the version diff, in charter order. */
const DIFF_FIELDS = [
  "transformationName",
  "executiveSponsorUserId",
  "transformationLeadUserId",
  "caseForChange",
  "northStarId",
  "inScope",
  "outOfScope",
  "baselineDate",
  "targetHorizonValue",
  "targetHorizonUnit",
  "governanceForum",
  "decisionRights",
  "successDefinition",
  "thesisChange",
  "thesisOutcomes",
  "thesisBenefits",
  "thesisBecause",
  ...Object.values(SCOPE_FIELDS).flatMap((f) => [f.answer, f.evidence]),
] as const;

export function CharterPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="charter"
      title={t("define.charter.title")}
      subtitle={t("define.charter.intro")}
      writePermissions={["charter.edit"]}
    >
      <CharterBody />
    </WorkspaceFrame>
  );
}

function CharterBody() {
  const ws = useWorkspace();
  const charter = useCharter(ws.tid);
  return (
    <QueryState query={charter}>
      {(view) => (view === null ? <NoCharter /> : <CharterContent view={view} />)}
    </QueryState>
  );
}

function NoCharter() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [creating, setCreating] = useState(false);
  const refresh = useP2Refresh(ws.tid);
  if (creating) {
    return (
      <Section id="charter-form" title={t("define.charter.createTitle")}>
        <CharterForm
          view={null}
          onDone={async () => {
            await refresh();
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      </Section>
    );
  }
  return (
    <EmptyState
      title={t("define.charter.empty")}
      body={t("define.charter.emptyBody")}
      action={
        ws.can("charter.edit") ? (
          <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> {t("define.charter.create")}
          </button>
        ) : undefined
      }
    />
  );
}

function useCharterFields(): FieldSpec[] {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const northStar = useNorthStar(ws.tid);
  const answer = (name: string, label: string): FieldSpec => ({
    name,
    kind: "select",
    label,
    options: (["yes", "partly", "no"] as const).map((a) => ({ value: a, label: t(`define.charter.answer.${a}`) })),
  });
  const checks = [...ws.methodology.charterScopeChecks].sort((a, b) => a.ordinal - b.ordinal);
  const question = (code: string) => {
    const c = checks.find((x) => x.code === code);
    return c ? pick(locale, c.sourceQuestionEn, c.questionAr) : t(`define.charter.scope.${code}`);
  };
  return [
    { name: "transformationName", kind: "text", label: t("define.charter.field.transformationName"), maxLength: 200 },
    { name: "executiveSponsorUserId", kind: "person", label: t("transformations.field.sponsor") },
    { name: "transformationLeadUserId", kind: "person", label: t("transformations.field.lead") },
    { name: "caseForChange", kind: "textarea", label: t("define.charter.field.caseForChange"), rows: 5 },
    {
      name: "northStarId",
      kind: "select",
      label: t("define.northStar.title"),
      hint: t("define.charter.northStarHint"),
      options: northStar.data ? [{ value: northStar.data.id, label: northStar.data.statement }] : [],
    },
    { name: "inScope", kind: "textarea", label: t("define.charter.field.inScope"), rows: 4 },
    { name: "outOfScope", kind: "textarea", label: t("define.charter.field.outOfScope"), rows: 4 },
    { name: "baselineDate", kind: "date", label: t("define.charter.field.baselineDate") },
    {
      name: "targetHorizonValue",
      kind: "integer",
      label: t("define.charter.field.targetHorizonValue"),
      min: 1,
      max: 600,
      hint: t("define.charter.horizonHint"),
    },
    {
      name: "targetHorizonUnit",
      kind: "select",
      label: t("define.charter.field.targetHorizonUnit"),
      options: (["months", "quarters", "years"] as const).map((u) => ({
        value: u,
        label: t(`define.charter.horizonUnit.${u}`),
      })),
    },
    { name: "governanceForum", kind: "text", label: t("define.charter.field.governanceForum"), maxLength: 500 },
    { name: "decisionRights", kind: "textarea", label: t("define.charter.field.decisionRights") },
    { name: "successDefinition", kind: "textarea", label: t("define.charter.field.successDefinition") },
    { name: "thesisChange", kind: "textarea", label: t("define.charter.thesis.change"), rows: 2 },
    { name: "thesisOutcomes", kind: "textarea", label: t("define.charter.thesis.outcomes"), rows: 2 },
    { name: "thesisBenefits", kind: "textarea", label: t("define.charter.thesis.benefits"), rows: 2 },
    { name: "thesisBecause", kind: "textarea", label: t("define.charter.thesis.because"), rows: 3 },
    ...SCOPE_CHECK_CODES.flatMap((code) => [
      answer(SCOPE_FIELDS[code].answer, question(code)),
      {
        name: SCOPE_FIELDS[code].evidence,
        kind: "textarea" as const,
        label: t("define.charter.scope.evidence"),
        rows: 2,
      },
    ]),
    {
      name: "changeSummary",
      kind: "text",
      label: t("define.charter.changeSummary"),
      hint: t("define.charter.changeSummaryHint"),
      maxLength: 1000,
      editOnly: true,
    },
  ];
}

function CharterForm({
  view,
  onDone,
  onCancel,
}: {
  view: CharterView | null;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const fields = useCharterFields();
  const { people } = usePeople(ws.tid);
  const url = `/api/v1/transformations/${ws.tid}/charter`;
  return (
    <InlineRecordForm<Charter>
      fields={fields}
      record={view?.charter ?? null}
      defaults={{ transformationName: ws.tr.name }}
      createSchema={charterWrite}
      updateSchema={charterUpdate}
      createUrl={url}
      updateUrl={() => url}
      loadLatest={async () => (await api.get<CharterView>(url)).charter}
      people={people}
      submitLabel={view ? t("define.charter.saveVersion") : t("define.charter.create")}
      sections={[
        {
          title: t("define.charter.fieldsTitle"),
          fields: [
            "transformationName",
            "executiveSponsorUserId",
            "transformationLeadUserId",
            "caseForChange",
            "northStarId",
            "inScope",
            "outOfScope",
            "baselineDate",
            "targetHorizonValue",
            "targetHorizonUnit",
            "governanceForum",
            "decisionRights",
            "successDefinition",
          ],
          intro: t("define.charter.fieldsFormIntro"),
        },
        {
          title: t("define.charter.thesis.title"),
          fields: ["thesisChange", "thesisOutcomes", "thesisBenefits", "thesisBecause"],
          intro: t("define.charter.thesis.pattern"),
        },
        {
          title: t("define.charter.scope.title"),
          fields: SCOPE_CHECK_CODES.flatMap((c) => [SCOPE_FIELDS[c].answer, SCOPE_FIELDS[c].evidence]),
        },
        ...(view ? [{ title: t("define.charter.changeTitle"), fields: ["changeSummary"] }] : []),
      ]}
      onSaved={onDone}
      onCancel={onCancel}
    />
  );
}

function CharterContent({ view }: { view: CharterView }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const refresh = useP2Refresh(ws.tid);
  const { byId } = usePeople(ws.tid);
  const [editing, setEditing] = useState(false);
  const c = view.charter;
  const topCount = view.topOutcomes.length;
  const checks = [...ws.methodology.charterScopeChecks].sort((a, b) => a.ordinal - b.ordinal);
  const text = (v: string | null) => <TextCell value={v} />;

  return (
    <>
      <SectionNav
        sections={[
          { id: "charter-fields", title: t("define.charter.fieldsTitle") },
          { id: "charter-thesis", title: t("define.charter.thesis.title") },
          { id: "charter-scope", title: t("define.charter.scope.title") },
          { id: "charter-versions", title: t("define.charter.versions.title") },
        ]}
      />
      <p className="banner banner--info" role="note" data-state="charter-version" data-charter-version={c.version}>
        <Icon name="info" />{" "}
        {t("define.charter.currentVersion", {
          version: c.version,
          when: formatDateTime(c.updatedAt, locale, ws.tr.timezone) ?? t("common.value.unknown"),
        })}
      </p>
      <CharterWarnings warnings={view.warnings} topCount={topCount} />

      {editing ? (
        <Section id="charter-form" title={t("define.charter.editTitle")}>
          <CharterForm
            view={view}
            onDone={async () => {
              await refresh();
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </Section>
      ) : (
        <>
          <Section
            id="charter-fields"
            title={t("define.charter.fieldsTitle")}
            intro={t("define.charter.fieldsIntro")}
            actions={
              ws.can("charter.edit") ? (
                <button type="button" className="button button--primary button--small" onClick={() => setEditing(true)}>
                  <Icon name="pencil" /> {t("define.charter.edit")}
                </button>
              ) : null
            }
          >
            <ol className="charter-fields">
              <CharterField n={1} label={t("define.charter.field.transformationName")}>
                {text(c.transformationName)}
              </CharterField>
              <CharterField n={2} label={t("transformations.field.sponsor")}>
                <PersonName id={c.executiveSponsorUserId} people={byId} />
              </CharterField>
              <CharterField n={3} label={t("transformations.field.lead")}>
                <PersonName id={c.transformationLeadUserId} people={byId} />
              </CharterField>
              <CharterField n={4} label={t("define.charter.field.caseForChange")}>
                {text(c.caseForChange)}
              </CharterField>
              <CharterField n={5} label={t("define.northStar.title")}>
                {view.northStar ? (
                  <q className="north-star">{view.northStar.statement}</q>
                ) : (
                  <Unknown hint={t("define.northStar.notSet")} />
                )}
              </CharterField>
              <CharterField n={6} label={t("define.charter.field.topOutcomes")}>
                {topCount === 0 ? (
                  <Unknown hint={t("define.outcomes.noTop")} />
                ) : (
                  <ol className="plain-list">
                    {view.topOutcomes.map((o) => (
                      <li key={o.id}>
                        {o.topRank ? <span className="muted">#{o.topRank} </span> : null}
                        {o.statement}
                      </li>
                    ))}
                  </ol>
                )}
              </CharterField>
              <CharterField n={7} label={t("define.charter.field.inScope")}>
                {text(c.inScope)}
              </CharterField>
              <CharterField n={8} label={t("define.charter.field.outOfScope")}>
                {text(c.outOfScope)}
              </CharterField>
              <CharterField n={9} label={t("define.charter.field.baselineDate")}>
                {formatBusinessDate(c.baselineDate, locale) ?? <Unknown />}
              </CharterField>
              <CharterField n={10} label={t("define.charter.field.targetHorizon")}>
                {c.targetHorizonValue !== null && c.targetHorizonUnit !== null ? (
                  t(`define.charter.horizon.${c.targetHorizonUnit}`, { n: c.targetHorizonValue })
                ) : (
                  <Unknown />
                )}
              </CharterField>
              <CharterField n={11} label={t("define.guardrails.title")}>
                {view.guardrails.length === 0 ? (
                  <Unknown hint={t("define.guardrails.empty")} />
                ) : (
                  <ul className="plain-list">
                    {view.guardrails.map((g) => (
                      <li key={g.id}>
                        <strong>{g.title}</strong>{" "}
                        <span className="muted">({t(`define.guardrails.categories.${g.category}`)})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CharterField>
              <CharterField n={12} label={t("define.charter.field.governanceForum")}>
                {text(c.governanceForum)}
              </CharterField>
              <CharterField n={13} label={t("define.charter.field.decisionRights")}>
                {text(c.decisionRights)}
              </CharterField>
              <CharterField n={14} label={t("define.charter.field.successDefinition")}>
                {text(c.successDefinition)}
              </CharterField>
            </ol>
          </Section>

          <Section
            id="charter-thesis"
            title={t("define.charter.thesis.title")}
            intro={t("define.charter.thesis.pattern")}
          >
            <dl className="thesis">
              <div>
                <dt>{t("define.charter.thesis.change")}</dt>
                <dd>{text(c.thesisChange)}</dd>
              </div>
              <div>
                <dt>{t("define.charter.thesis.outcomes")}</dt>
                <dd>{text(c.thesisOutcomes)}</dd>
              </div>
              <div>
                <dt>{t("define.charter.thesis.benefits")}</dt>
                <dd>{text(c.thesisBenefits)}</dd>
              </div>
              <div>
                <dt>{t("define.charter.thesis.because")}</dt>
                <dd>{text(c.thesisBecause)}</dd>
              </div>
            </dl>
          </Section>

          <Section id="charter-scope" title={t("define.charter.scope.title")} intro={t("define.charter.scope.intro")}>
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">{t("define.charter.scope.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("define.charter.scope.question")}</th>
                    <th scope="col">{t("define.charter.scope.answer")}</th>
                    <th scope="col">{t("define.charter.scope.evidence")}</th>
                    <th scope="col">{t("define.charter.scope.precheck")}</th>
                  </tr>
                </thead>
                <tbody>
                  {SCOPE_CHECK_CODES.map((code) => {
                    const def = checks.find((x) => x.code === code);
                    const f = SCOPE_FIELDS[code];
                    const answer = c[f.answer] as string | null;
                    const pre = view.scopeCheckPrechecks.find((p) => p.code === code);
                    return (
                      <tr key={code} data-scope-check={code}>
                        <th scope="row">
                          {def ? pick(locale, def.sourceQuestionEn, def.questionAr) : t(`define.charter.scope.${code}`)}
                        </th>
                        <td>
                          {answer ? (
                            t(`define.charter.answer.${answer}`)
                          ) : (
                            <Unknown hint={t("define.charter.answer.notAssessed")} />
                          )}
                        </td>
                        <td>{text(c[f.evidence] as string | null)}</td>
                        <td>
                          {pre ? (
                            <>
                              <ResultChip
                                result={pre.result}
                                label={t(`define.charter.precheck.result.${pre.result}`)}
                              />
                              <span className="block small">
                                {t(`define.charter.precheck.detail.${code}.${pre.result}`)}
                              </span>
                            </>
                          ) : (
                            <ResultChip result="unknown" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">{t("define.charter.scope.precheckNote")}</p>
          </Section>
        </>
      )}
      <VersionHistory current={c} />
    </>
  );
}

function CharterField({ n, label, children }: { n: number; label: string; children: ReactNode }) {
  return (
    <li className="charter-field" value={n}>
      <span className="charter-field__label">{label}</span>
      <div className="charter-field__value">{children}</div>
    </li>
  );
}

function CharterWarnings({ warnings, topCount }: { warnings: readonly Warning[]; topCount: number }) {
  const { t } = useTranslation();
  const top = warnings.find((w) => w.code === "charter.top_outcomes_count");
  const other = warnings.filter((w) => w.code !== "charter.top_outcomes_count");
  return (
    <>
      {top ? (
        <p className="banner banner--warning" role="status" data-warning="charter.top_outcomes_count">
          <span className="status-chip status-chip--at-risk">
            <Icon name="alert" /> {t("define.charter.warning")}
          </span>{" "}
          {t("define.charter.topOutcomesWarning", { n: topCount })}
        </p>
      ) : null}
      {other.length > 0 ? (
        <ul className="banner banner--warning plain-list" role="status">
          {other.map((w) => (
            <li key={`${w.code}-${w.pointer ?? ""}`}>
              <Icon name="alert" />{" "}
              {t(`define.charter.warnings.${w.code.replace(/\./g, "__")}`, {
                defaultValue: t("define.charter.warningGeneric"),
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function VersionHistory({ current }: { current: Charter }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const versions = useCharterVersions(ws.tid);
  const { byId } = usePeople(ws.tid);
  const [compare, setCompare] = useState<number | null>(null);
  return (
    <Section
      id="charter-versions"
      title={t("define.charter.versions.title")}
      intro={t("define.charter.versions.intro")}
    >
      <QueryState
        query={versions}
        isEmpty={(v) => v.length === 0}
        empty={<EmptyState title={t("define.charter.versions.empty")} />}
      >
        {(list) => {
          const sorted = [...list].sort((a, b) => b.versionNo - a.versionNo);
          const selected = compare === null ? null : sorted.find((v) => v.versionNo === compare);
          const previous = selected ? sorted.find((v) => v.versionNo === selected.versionNo - 1) : undefined;
          return (
            <>
              <div className="table-wrap">
                <table className="table table--compact">
                  <caption className="visually-hidden">{t("define.charter.versions.title")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("common.field.version")}</th>
                      <th scope="col">{t("define.charter.versions.savedAt")}</th>
                      <th scope="col">{t("define.charter.versions.savedBy")}</th>
                      <th scope="col">{t("define.charter.changeSummary")}</th>
                      <th scope="col">{t("common.field.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((v) => (
                      <tr key={v.id} aria-current={v.versionNo === current.version ? "true" : undefined}>
                        <th scope="row">
                          <bdi dir="ltr">v{v.versionNo}</bdi>
                          {v.versionNo === current.version ? (
                            <span className="muted small"> ({t("define.charter.versions.current")})</span>
                          ) : null}
                        </th>
                        <td>{formatDateTime(v.savedAt, locale, ws.tr.timezone)}</td>
                        <td>
                          <PersonName id={v.savedBy} people={byId} />
                        </td>
                        <td>{v.changeSummary ?? <span className="muted">{t("common.value.none")}</span>}</td>
                        <td>
                          {v.versionNo > 1 ? (
                            <button
                              type="button"
                              className="button button--link button--small"
                              aria-pressed={compare === v.versionNo}
                              onClick={() => setCompare(compare === v.versionNo ? null : v.versionNo)}
                            >
                              {t("define.charter.versions.compare", {
                                version: v.versionNo,
                                previous: v.versionNo - 1,
                              })}
                            </button>
                          ) : (
                            <span className="muted small">{t("define.charter.versions.first")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selected ? <VersionDiff a={previous ?? null} b={selected} /> : null}
            </>
          );
        }}
      </QueryState>
    </Section>
  );
}

function VersionDiff({ a, b }: { a: CharterVersion | null; b: CharterVersion }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { byId } = usePeople(ws.tid);
  const fields = useCharterFields();
  const label = (name: string) => fields.find((f) => f.name === name)?.label ?? name;
  if (!a) {
    return (
      <p className="banner banner--warning" role="status">
        {t("define.charter.versions.previousMissing")}
      </p>
    );
  }
  const rows = DIFF_FIELDS.filter(
    (f) => JSON.stringify(a[f as keyof CharterVersion]) !== JSON.stringify(b[f as keyof CharterVersion]),
  );
  const show = (name: string, v: unknown): string => {
    if (v === null || v === undefined || v === "") return t("common.value.none");
    const spec = fields.find((f) => f.name === name);
    if (spec?.kind === "person") return byId.get(String(v))?.label ?? t("common.value.notVisible");
    if (spec?.options) return spec.options.find((o) => o.value === String(v))?.label ?? String(v);
    return String(v);
  };
  return (
    <section className="version-diff" aria-labelledby="diff-title" data-diff={`${a.versionNo}-${b.versionNo}`}>
      <h3 id="diff-title" className="card__subtitle">
        {t("define.charter.versions.diffTitle", { previous: a.versionNo, version: b.versionNo })}
      </h3>
      {rows.length === 0 ? (
        <p className="muted">{t("define.charter.versions.noFieldChange")}</p>
      ) : (
        <div className="table-wrap">
          <table className="table table--compact">
            <caption className="visually-hidden">
              {t("define.charter.versions.diffTitle", { previous: a.versionNo, version: b.versionNo })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("common.conflict.field")}</th>
                <th scope="col">{t("define.charter.versions.before", { version: a.versionNo })}</th>
                <th scope="col">{t("define.charter.versions.after", { version: b.versionNo })}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f}>
                  <th scope="row">{label(f)}</th>
                  <td>
                    <del className="text-cell">{show(f, a[f as keyof CharterVersion])}</del>
                  </td>
                  <td>
                    <ins className="text-cell">{show(f, b[f as keyof CharterVersion])}</ins>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
