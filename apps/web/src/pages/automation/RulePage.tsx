// One automation rule (T-DG5-FE-D; REQ-S12-001, REQ-S12-002; ADR-0043 §1–§5; ADR-0044 §1; D-142 Q3): its trigger,
// conditions, actions, scope, owner, effective version and execution history, in the readable en/ar summary; the
// version lifecycle Draft → Dry run → Review where configured → Publish; enable and disable.
//  - A dry run evaluates the draft against a sample event in a rolled-back transaction: it creates no task, no
//    notification, no execution and no business record; the screen shows what each action WOULD do.
//  - A starter automation that implements an earlier-stage guarantee cannot be disabled; the screen says why (and the
//    server refuses with 422 automation_rule.guarantee_protected). Its settings change in a new version.
//  - Every action sends If-Match: the version's version (update, submit, review, discard) or the rule's version
//    (create version, publish, enable, disable), as the contract says.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useTransformations } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { ReadOnlyNote, useUserNames } from "../my-work/p4ui.tsx";
import {
  fedPaths,
  useCatalogue,
  useDryRuns,
  useExecutions,
  useFedRefresh,
  useRule,
  useVersions,
  type AutomationCatalogue,
  type AutomationDryRun,
  type AutomationExecution,
  type AutomationRule,
  type AutomationRuleVersion,
} from "./api.ts";
import { ContentEditor, toContentBody, toContentDraft, type ContentDraft } from "./ContentEditor.tsx";
import { AutomationLinks, EnabledChip } from "./RulesPage.tsx";
import { Chip, HumanDecisionNote, NoteForm, StatusChip, pick, useRunner, type Runner } from "./ui.tsx";

export const VERSION_STATUS_CHIP = {
  draft: ["draft", "pencil"],
  in_review: ["draft", "clock"],
  approved: ["draft", "check"],
  published: ["good", "lock"],
  superseded: ["closed", "archive"],
  discarded: ["closed", "archive"],
} as const;

export const EXECUTION_STATUS_CHIP = {
  running: ["neutral", "clock"],
  succeeded: ["good", "check"],
  skipped: ["closed", "pause"],
  failed: ["bad", "cross"],
} as const;

/** The dry-run state of a version's CURRENT content: Pass / Fail, or Not run / Stale (never "Pass" by default). */
export function DryRunChip({ version }: { version: Pick<AutomationRuleVersion, "lastDryRun" | "dryRunCurrent"> }) {
  const { t } = useTranslation();
  if (!version.lastDryRun)
    return <Chip tone="neutral" icon="question" label={t("workflowsP5.dryRun.notRun")} data="not_run" />;
  if (!version.dryRunCurrent)
    return <Chip tone="stale" icon="clock" label={t("workflowsP5.dryRun.stale")} data="stale" />;
  return version.lastDryRun.outcome === "pass" ? (
    <Chip tone="good" icon="check" label={t("workflowsP5.dryRun.pass")} data="pass" />
  ) : (
    <Chip tone="bad" icon="cross" label={t("workflowsP5.dryRun.fail")} data="fail" />
  );
}

export function RulePage() {
  const { t } = useTranslation();
  const { ruleId } = useParams();
  usePageTitle(t("nav.p5.automationRule.title"));
  const rule = useRule(ruleId);
  return (
    <div className="page" data-p5-screen="automation-rule">
      <QueryState query={rule}>{(r) => <RuleView rule={r} />}</QueryState>
    </div>
  );
}

function RuleView({ rule: r }: { rule: AutomationRule }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const canConfigure = canAnywhere(me, "automation.configure");
  const refresh = useFedRefresh();
  const runner = useRunner(refresh);
  const versions = useVersions(r.id);
  const names = useUserNames([r.ownerUserId]);
  // The `automation_rule_review` work item links to /admin/automation-rules/<id>/versions/<no>: open that version.
  const { versionNo } = useParams();
  const linked = versionNo && /^\d+$/.test(versionNo) ? Number(versionNo) : null;
  const [selectedNo, setSelectedNo] = useState<number | null>(linked);
  const rows = versions.data ?? [];
  const defaultNo = r.openVersionNo ?? r.effectiveVersionNo ?? rows[0]?.versionNo ?? null;
  const shownNo = selectedNo ?? defaultNo;
  const shown = rows.find((v) => v.versionNo === shownNo) ?? null;
  return (
    <>
      <PageHeader
        title={pick(locale, r.nameEn, r.nameAr)}
        subtitle={<bdi dir="ltr">{r.code}</bdi>}
        crumbs={[{ label: t("nav.p5.automation.title"), to: "/admin/automation" }, { label: r.code }]}
      />
      <HumanDecisionNote />
      {!canConfigure ? <ReadOnlyNote body={t("workflowsP5.rules.readOnly")} /> : null}
      <AutomationLinks />
      {runner.alert}
      <section className="card" aria-labelledby="rule-facts" data-rule={r.code} data-enabled={String(r.enabled)}>
        <h2 id="rule-facts" className="card__title">
          {t("workflowsP5.rules.factsTitle")}
        </h2>
        <p data-summary="effective">
          {r.summary ? pick(locale, r.summary.en, r.summary.ar) : t("workflowsP5.rules.noEffectiveVersion")}
        </p>
        <dl className="workspace-header__grid">
          <dt>{t("workflowsP5.field.status")}</dt>
          <dd>
            <EnabledChip rule={r} />
          </dd>
          <dt>{t("workflowsP5.rules.origin")}</dt>
          <dd>
            {t(`workflowsP5.origin.${r.origin}`)}
            {r.sourceRef ? (
              <bdi dir="ltr" className="small muted">
                {" "}
                {r.sourceRef}
              </bdi>
            ) : null}
          </dd>
          <dt>{t("workflowsP5.rules.scope")}</dt>
          <dd>{t(`workflowsP5.scopeLevel.${r.scopeLevel}`)}</dd>
          <dt>{t("workflowsP5.rules.owner")}</dt>
          <dd>
            {r.ownerUserId ? names(r.ownerUserId) : r.ownerRoleCode ? <bdi dir="ltr">{r.ownerRoleCode}</bdi> : "—"}
          </dd>
          <dt>{t("workflowsP5.rules.effectiveVersion")}</dt>
          <dd>
            {r.effectiveVersionNo === null ? t("workflowsP5.rules.noEffectiveVersion") : `v${r.effectiveVersionNo}`}
          </dd>
          {r.disabledReason ? (
            <>
              <dt>{t("workflowsP5.rules.disabledReason")}</dt>
              <dd>{r.disabledReason}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <Section id="enable" title={t("workflowsP5.rules.enableTitle")}>
        {!r.disableAllowed ? (
          <p className="banner banner--info" role="note" data-state="guarantee-protected">
            {t("problems.automation_rule__guarantee_protected")}
          </p>
        ) : null}
        {canConfigure ? (
          r.enabled ? (
            r.disableAllowed ? (
              <NoteForm
                id="disable-rule"
                label={t("workflowsP5.field.reason")}
                submitLabel={t("workflowsP5.rules.disable")}
                required
                min={3}
                busy={runner.busy}
                danger
                onSubmit={(reason) =>
                  void runner.run(fedPaths.disableRule(r.id), { body: { reason }, ifMatch: r.version })
                }
              />
            ) : null
          ) : (
            <button
              type="button"
              className="button button--primary"
              disabled={runner.busy}
              onClick={() => void runner.run(fedPaths.enableRule(r.id), { ifMatch: r.version })}
            >
              {t("workflowsP5.rules.enable")}
            </button>
          )
        ) : null}
      </Section>

      <Section
        id="versions"
        title={t("workflowsP5.rules.versionsTitle")}
        actions={
          canConfigure && r.openVersionNo === null ? (
            <button
              type="button"
              className="button button--secondary"
              disabled={runner.busy}
              onClick={() =>
                void runner
                  .run<AutomationRuleVersion>(fedPaths.versions(r.id), { body: {}, ifMatch: r.version })
                  .then((v) => v && setSelectedNo(v.versionNo))
              }
            >
              {t("workflowsP5.rules.newVersion")}
            </button>
          ) : null
        }
      >
        <QueryState query={versions}>
          {(vs) => (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t("workflowsP5.rules.versionsTitle")}>
              <table className="table" data-table="rule-versions">
                <caption className="visually-hidden">{t("workflowsP5.rules.versionsTitle")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("workflowsP5.rules.version")}</th>
                    <th scope="col">{t("workflowsP5.field.status")}</th>
                    <th scope="col">{t("workflowsP5.dryRun.title")}</th>
                    <th scope="col">{t("workflowsP5.rules.summary")}</th>
                    <th scope="col">{t("workflowsP5.rules.publishedAt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {vs.map((v) => (
                    <tr key={v.id} data-version={v.versionNo} data-version-status={v.status}>
                      <th scope="row">
                        <button
                          type="button"
                          className="button button--link"
                          aria-pressed={v.versionNo === shownNo}
                          onClick={() => setSelectedNo(v.versionNo)}
                        >
                          v{v.versionNo}
                        </button>
                      </th>
                      <td>
                        <StatusChip value={v.status} table={VERSION_STATUS_CHIP} labelKey="workflowsP5.versionStatus" />
                      </td>
                      <td>{v.status === "draft" ? <DryRunChip version={v} /> : "—"}</td>
                      <td>{pick(locale, v.summary.en, v.summary.ar)}</td>
                      <td>{v.publishedAt ? formatDateTime(v.publishedAt, locale) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </Section>

      {shown ? <VersionPanel key={shown.id} rule={r} version={shown} runner={runner} /> : null}
      <RuleExecutions ruleId={r.id} />
    </>
  );
}

function VersionPanel({
  rule: r,
  version: v,
  runner,
}: {
  rule: AutomationRule;
  version: AutomationRuleVersion;
  runner: Runner;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const canConfigure = canAnywhere(me, "automation.configure");
  const canReview = canAnywhere(me, "automation.review");
  const catalogue = useCatalogue();
  const editable = canConfigure && v.status === "draft" && r.origin === "admin";
  return (
    <Section
      id="version"
      title={t("workflowsP5.rules.versionTitle", { no: v.versionNo })}
      intro={<StatusChip value={v.status} table={VERSION_STATUS_CHIP} labelKey="workflowsP5.versionStatus" />}
    >
      <p data-summary="version">{pick(locale, v.summary.en, v.summary.ar)}</p>
      {v.reviewNote ? (
        <p className="small">
          {t("workflowsP5.rules.reviewNote")}: {v.reviewNote}
        </p>
      ) : null}
      <QueryState query={catalogue}>
        {(cat) =>
          editable ? (
            <EditContent rule={r} version={v} catalogue={cat} runner={runner} />
          ) : (
            <ContentView version={v} catalogue={cat} />
          )
        }
      </QueryState>
      {canConfigure && v.status === "draft" ? <DryRunPanel rule={r} version={v} /> : null}
      {canConfigure ? (
        <div className="form__actions" data-actions="version-lifecycle">
          {v.status === "draft" ? (
            <button
              type="button"
              className="button button--secondary"
              disabled={runner.busy}
              onClick={() => void runner.run(fedPaths.submit(r.id, v.versionNo), { ifMatch: v.version })}
            >
              {t("workflowsP5.rules.submit")}
            </button>
          ) : null}
          {v.status === "draft" || v.status === "approved" ? (
            <button
              type="button"
              className="button button--primary"
              disabled={runner.busy}
              onClick={() => void runner.run(fedPaths.publish(r.id, v.versionNo), { ifMatch: r.version })}
            >
              {t("workflowsP5.rules.publish")}
            </button>
          ) : null}
          {["draft", "in_review", "approved"].includes(v.status) ? (
            <button
              type="button"
              className="button button--danger"
              disabled={runner.busy}
              onClick={() => void runner.run(fedPaths.discard(r.id, v.versionNo), { ifMatch: v.version })}
            >
              {t("workflowsP5.rules.discard")}
            </button>
          ) : null}
        </div>
      ) : null}
      {canReview && v.status === "in_review" ? <ReviewForm rule={r} version={v} runner={runner} /> : null}
    </Section>
  );
}

function ContentView({ version: v, catalogue }: { version: AutomationRuleVersion; catalogue: AutomationCatalogue }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const c = v.content as unknown as {
    triggerCodes: string[];
    conditions: { field: string; op: string; value?: unknown }[];
    actions: { type: string; parameters?: Record<string, unknown>; handlers?: string[] }[];
    runAs: string;
    servicePermissionCodes: string[];
    parameters?: Record<string, unknown>;
  };
  const label = (code: string, list: readonly { code: string; labelEn: string; labelAr: string }[]) => {
    const x = list.find((y) => y.code === code);
    return x ? pick(locale, x.labelEn, x.labelAr) : code;
  };
  return (
    <dl className="workspace-header__grid" data-content="read-only">
      <dt>{t("workflowsP5.rules.whenTitle")}</dt>
      <dd>
        {c.triggerCodes.map((x) => (
          <span key={x} className="block">
            {label(x, catalogue.triggers)}{" "}
            <bdi dir="ltr" className="small muted">
              {x}
            </bdi>
          </span>
        ))}
      </dd>
      <dt>{t("workflowsP5.rules.ifTitle")}</dt>
      <dd>
        {(c.conditions ?? []).length === 0
          ? t("workflowsP5.rules.noConditions")
          : c.conditions.map((x, i) => (
              <bdi key={i} dir="ltr" className="block code">
                {x.field} {x.op} {x.value === undefined ? "" : JSON.stringify(x.value)}
              </bdi>
            ))}
      </dd>
      <dt>{t("workflowsP5.rules.thenTitle")}</dt>
      <dd>
        {c.actions.map((a, i) => (
          <span key={i} className="block">
            {label(a.type, catalogue.actionTypes)}
            {a.parameters && Object.keys(a.parameters).length ? (
              <bdi dir="ltr" className="small muted code">
                {" "}
                {JSON.stringify(a.parameters)}
              </bdi>
            ) : null}
          </span>
        ))}
      </dd>
      <dt>{t("workflowsP5.rules.runAs")}</dt>
      <dd>{t(`workflowsP5.runAs.${c.runAs}`)}</dd>
      {c.parameters && Object.keys(c.parameters).length ? (
        <>
          <dt>{t("workflowsP5.rules.settings")}</dt>
          <dd>
            <bdi dir="ltr" className="code">
              {JSON.stringify(c.parameters)}
            </bdi>
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function EditContent({
  rule: r,
  version: v,
  catalogue,
  runner,
}: {
  rule: AutomationRule;
  version: AutomationRuleVersion;
  catalogue: AutomationCatalogue;
  runner: Runner;
}) {
  const { t } = useTranslation();
  const transformations = useTransformations({ sort: "code:asc", limit: 100 });
  const trs = (transformations.data?.items ?? []).map((x) => ({ id: x.id, code: x.code, name: x.name }));
  const [draft, setDraft] = useState<ContentDraft>(() =>
    toContentDraft(v.content as unknown as Parameters<typeof toContentDraft>[0]),
  );
  return (
    <form
      className="form"
      noValidate
      data-form="edit-rule-content"
      onSubmit={(e) => {
        e.preventDefault();
        void runner.run(fedPaths.version(r.id, v.versionNo), {
          method: "PATCH",
          body: { content: toContentBody(draft) },
          ifMatch: v.version,
        });
      }}
    >
      <ContentEditor
        value={draft}
        onChange={setDraft}
        catalogue={catalogue}
        transformations={trs}
        idPrefix={`v${v.versionNo}`}
      />
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={runner.busy}>
          {t("workflowsP5.rules.saveDraft")}
        </button>
      </div>
    </form>
  );
}

/** The dry run of a draft against a sample event (rolled back; it writes only its own dry-run row). */
function DryRunPanel({ rule: r, version: v }: { rule: AutomationRule; version: AutomationRuleVersion }) {
  const { t } = useTranslation();
  const refresh = useFedRefresh();
  const runner = useRunner(refresh);
  const catalogue = useCatalogue();
  const history = useDryRuns(r.id, v.versionNo);
  const triggerCodes = (v.content as unknown as { triggerCodes: string[] }).triggerCodes;
  const [triggerCode, setTriggerCode] = useState(triggerCodes[0] ?? "");
  const fields = useMemo(
    () => catalogue.data?.triggers.find((x) => x.code === triggerCode)?.conditionFields ?? [],
    [catalogue.data, triggerCode],
  );
  const template = useMemo(() => {
    const o: Record<string, unknown> = {};
    if (r.transformationId) o["transformationId"] = r.transformationId;
    for (const f of fields) o[f] = "";
    return JSON.stringify(o, null, 2);
  }, [fields, r.transformationId]);
  const [payload, setPayload] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState(false);
  const [result, setResult] = useState<AutomationDryRun | null>(null);
  return (
    <section className="card form--inset" aria-labelledby="dry-run-title" data-panel="dry-run">
      <h3 id="dry-run-title">{t("workflowsP5.dryRun.title")}</h3>
      <p className="small muted">{t("workflowsP5.dryRun.intro")}</p>
      <p>
        <DryRunChip version={v} />
      </p>
      <form
        className="form"
        noValidate
        data-form="dry-run"
        onSubmit={(e) => {
          e.preventDefault();
          let parsed: unknown;
          try {
            parsed = JSON.parse(payload ?? template);
          } catch {
            setJsonError(true);
            return;
          }
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            setJsonError(true);
            return;
          }
          setJsonError(false);
          void runner
            .run<AutomationDryRun>(fedPaths.dryRuns(r.id, v.versionNo), { body: { triggerCode, payload: parsed } })
            .then((d) => d && setResult(d));
        }}
      >
        {runner.alert}
        <div className="field">
          <label className="field__label" htmlFor="dry-run-trigger">
            {t("workflowsP5.dryRun.trigger")}
          </label>
          <select id="dry-run-trigger" value={triggerCode} onChange={(e) => setTriggerCode(e.target.value)}>
            {triggerCodes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className={`field${jsonError ? " field--invalid" : ""}`}>
          <label className="field__label" htmlFor="dry-run-payload">
            {t("workflowsP5.dryRun.payload")}
          </label>
          <p className="field__hint" id="dry-run-payload-hint">
            {t("workflowsP5.dryRun.payloadHint")}
          </p>
          <textarea
            id="dry-run-payload"
            dir="ltr"
            rows={6}
            className="code"
            aria-describedby={jsonError ? "dry-run-payload-hint dry-run-payload-error" : "dry-run-payload-hint"}
            aria-invalid={jsonError}
            value={payload ?? template}
            onChange={(e) => setPayload(e.target.value)}
          />
          {jsonError ? (
            <p className="field__error" id="dry-run-payload-error">
              {t("workflowsP5.dryRun.jsonInvalid")}
            </p>
          ) : null}
        </div>
        <div className="form__actions">
          <button type="submit" className="button button--secondary" disabled={runner.busy}>
            {t("workflowsP5.dryRun.run")}
          </button>
        </div>
      </form>
      {result ? <DryRunResult run={result} /> : null}
      <QueryState query={history}>
        {(runs) =>
          runs.length === 0 ? null : (
            <p className="small muted" data-dry-runs={runs.length}>
              {t("workflowsP5.dryRun.history", { count: runs.length })}
            </p>
          )
        }
      </QueryState>
    </section>
  );
}

function DryRunResult({ run }: { run: AutomationDryRun }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <div data-dry-run-result={run.outcome} role="status">
      <p>
        {run.outcome === "pass" ? (
          <Chip tone="good" icon="check" label={t("workflowsP5.dryRun.pass")} data="pass" />
        ) : (
          <Chip tone="bad" icon="cross" label={t("workflowsP5.dryRun.fail")} data="fail" />
        )}{" "}
        {run.conditionsMet === null
          ? t("workflowsP5.dryRun.conditionsUnknown")
          : run.conditionsMet
            ? t("workflowsP5.dryRun.conditionsMet")
            : t("workflowsP5.dryRun.conditionsNotMet")}
      </p>
      <p className="small">{t("workflowsP5.dryRun.noSideEffects")}</p>
      {run.findings.length ? (
        <ul data-findings={run.findings.length}>
          {run.findings.map((f, i) => (
            <li key={i}>
              {pick(locale, f.messageEn, f.messageAr)}{" "}
              <bdi dir="ltr" className="small code">
                {f.code}
              </bdi>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="table-wrap" tabIndex={0} role="region" aria-label={t("workflowsP5.dryRun.planned")}>
        <table className="table" data-table="planned-actions">
          <caption>{t("workflowsP5.dryRun.planned")}</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{t("workflowsP5.rules.action")}</th>
              <th scope="col">{t("workflowsP5.dryRun.outcome")}</th>
              <th scope="col">{t("workflowsP5.dryRun.target")}</th>
            </tr>
          </thead>
          <tbody>
            {run.plannedActions.map((a) => (
              <tr key={a.ordinal} data-planned={a.outcome}>
                <td>{a.ordinal}</td>
                <th scope="row">
                  <bdi dir="ltr">{a.actionType}</bdi>
                </th>
                <td>{t(`workflowsP5.plannedOutcome.${a.outcome}`)}</td>
                <td>
                  <bdi dir="ltr" className="code small">
                    {JSON.stringify(a.target)}
                  </bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReviewForm({
  rule: r,
  version: v,
  runner,
}: {
  rule: AutomationRule;
  version: AutomationRuleVersion;
  runner: Runner;
}) {
  const { t } = useTranslation();
  const [outcome, setOutcome] = useState<"approve" | "request_changes">("approve");
  return (
    <section className="card form--inset" aria-labelledby="review-title" data-panel="rule-review">
      <h3 id="review-title">{t("workflowsP5.rules.reviewTitle")}</h3>
      <p className="small muted">{t("workflowsP5.rules.reviewIntro")}</p>
      <div className="field">
        <label className="field__label" htmlFor="review-outcome">
          {t("workflowsP5.rules.reviewOutcome")}
        </label>
        <select id="review-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
          <option value="approve">{t("workflowsP5.reviewOutcome.approve")}</option>
          <option value="request_changes">{t("workflowsP5.reviewOutcome.request_changes")}</option>
        </select>
      </div>
      <NoteForm
        id="rule-review"
        label={t("workflowsP5.field.note")}
        submitLabel={t("workflowsP5.rules.recordReview")}
        required={outcome === "request_changes"}
        min={outcome === "request_changes" ? 3 : 0}
        max={2000}
        busy={runner.busy}
        onSubmit={(note) =>
          void runner.run(fedPaths.review(r.id, v.versionNo), {
            body: { outcome, ...(note ? { note } : {}) },
            ifMatch: v.version,
          })
        }
      />
    </section>
  );
}

/** The execution history (REQ-S12-001: each execution with its rule version, trigger event and outcome). */
export function ExecutionsTable({ rows, showRule }: { rows: readonly AutomationExecution[]; showRule?: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const columns: RegisterColumn<AutomationExecution>[] = [
    {
      id: "started",
      header: t("workflowsP5.executions.started"),
      rowHeader: true,
      hideable: false,
      cell: (x) => (
        <Link className="link" to={`/admin/automation/executions/${x.id}`}>
          {formatDateTime(x.startedAt, locale)}
        </Link>
      ),
      sortValue: (x) => x.startedAt,
      filterText: (x) => `${x.ruleCode} ${x.triggerCode} ${x.status} ${x.errorCode ?? ""}`,
    },
    ...(showRule
      ? [
          {
            id: "rule",
            header: t("workflowsP5.rules.rule"),
            cell: (x: AutomationExecution) => (
              <Link className="link" to={`/admin/automation/rules/${x.ruleId}`}>
                <bdi dir="ltr">{x.ruleCode}</bdi>
              </Link>
            ),
            sortValue: (x: AutomationExecution) => x.ruleCode,
          },
        ]
      : []),
    {
      id: "version",
      header: t("workflowsP5.rules.version"),
      cell: (x) => <bdi dir="ltr">v{x.versionNo}</bdi>,
      sortValue: (x) => x.versionNo,
    },
    {
      id: "trigger",
      header: t("workflowsP5.executions.trigger"),
      cell: (x) => <bdi dir="ltr">{x.triggerCode}</bdi>,
      sortValue: (x) => x.triggerCode,
    },
    {
      id: "status",
      header: t("workflowsP5.executions.outcome"),
      cell: (x) => <StatusChip value={x.status} table={EXECUTION_STATUS_CHIP} labelKey="workflowsP5.executionStatus" />,
      sortValue: (x) => x.status,
    },
    {
      id: "conditions",
      header: t("workflowsP5.executions.conditions"),
      cell: (x) =>
        x.conditionsMet === null ? (
          <span className="muted">{t("workflowsP5.unknown")}</span>
        ) : x.conditionsMet ? (
          t("workflowsP5.executions.met")
        ) : (
          t("workflowsP5.executions.notMet")
        ),
    },
    {
      id: "attempt",
      header: t("workflowsP5.executions.attempt"),
      cell: (x) => x.attemptNo,
      sortValue: (x) => x.attemptNo,
    },
    {
      id: "error",
      header: t("workflowsP5.executions.error"),
      cell: (x) =>
        x.errorCode ? t(`problems.${x.errorCode.replace(/\./g, "__")}`, { defaultValue: x.errorCode }) : "—",
    },
  ];
  return (
    <RegisterTable
      id={showRule ? "p5-executions" : "p5-rule-executions"}
      caption={t("workflowsP5.executions.title")}
      rows={rows}
      columns={columns}
      getRowId={(x) => x.id}
      emptyTitle={t("workflowsP5.executions.empty")}
      defaultSort={{ id: "started", dir: "desc" }}
    />
  );
}

function RuleExecutions({ ruleId }: { ruleId: string }) {
  const { t } = useTranslation();
  const executions = useExecutions({ ruleId });
  return (
    <Section id="executions" title={t("workflowsP5.executions.title")} intro={t("workflowsP5.executions.intro")}>
      <QueryState query={executions}>{(rows) => <ExecutionsTable rows={rows} />}</QueryState>
    </Section>
  );
}
