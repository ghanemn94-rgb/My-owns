// Administration > Automation (T-DG5-FE-D; REQ-S12-001, REQ-S12-002; ADR-0043 §1, §4, §8; ADR-0044 §1): every
// automation rule I can read — the sixteen starter automations and the rules administrators author — with its origin,
// scope, owner, effective version, enabled state and readable summary, filterable, sortable and paged. A methodology
// administrator (automation.configure) creates a rule with the readable builder; it starts disabled, as a draft that
// needs a passing dry run (and its configured review) before it is published and can be enabled. AUD and the other
// readers see everything read-only. No rule decides a business approval.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useAllTransformations } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionNavigate } from "../../auth/sessionBound.ts";
import { Field } from "../../components/Form.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { ReadOnlyNote } from "../my-work/p4ui.tsx";
import { fedPaths, useCatalogue, useFedRefresh, useRules, type AutomationRule } from "./api.ts";
import { ContentEditor, emptyContent, toContentBody, type ContentDraft } from "./ContentEditor.tsx";
import { Chip, HumanDecisionNote, pick, useRunner } from "./ui.tsx";

export function EnabledChip({ rule }: { rule: Pick<AutomationRule, "enabled"> }) {
  const { t } = useTranslation();
  return rule.enabled ? (
    <Chip tone="good" icon="check" label={t("workflowsP5.rules.enabled")} data="enabled" />
  ) : (
    <Chip tone="closed" icon="pause" label={t("workflowsP5.rules.disabled")} data="disabled" />
  );
}

export function AutomationLinks() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("workflowsP5.rules.linksLabel")} className="card">
      <ul className="plain-list">
        <li>
          <Link className="link" to="/admin/automation">
            {t("nav.p5.automation.title")}
          </Link>
        </li>
        <li>
          <Link className="link" to="/admin/automation/executions">
            {t("workflowsP5.executions.title")}
          </Link>
        </li>
        <li>
          <Link className="link" to="/admin/automation/failures">
            {t("nav.p5.automationFailures.title")}
          </Link>
        </li>
        <li>
          <Link className="link" to="/admin/jobs/operations">
            {t("workflowsP5.jobs.title")}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

export function RulesPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  usePageTitle(t("nav.p5.automation.title"));
  const canConfigure = canAnywhere(me, "automation.configure");
  const [origin, setOrigin] = useState("");
  const [enabled, setEnabled] = useState("");
  const rules = useRules({ ...(origin ? { origin } : {}), ...(enabled ? { enabled } : {}) });
  const [creating, setCreating] = useState(false);
  const columns: RegisterColumn<AutomationRule>[] = [
    {
      id: "name",
      header: t("workflowsP5.rules.rule"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <span className="block">
          <Link className="link" to={`/admin/automation/rules/${r.id}`}>
            {pick(locale, r.nameEn, r.nameAr)}
          </Link>
          <span className="block small muted">
            <bdi dir="ltr">{r.code}</bdi>
          </span>
        </span>
      ),
      sortValue: (r) => r.code,
      filterText: (r) => `${r.code} ${r.nameEn} ${r.nameAr} ${r.summary?.en ?? ""} ${r.summary?.ar ?? ""}`,
    },
    {
      id: "origin",
      header: t("workflowsP5.rules.origin"),
      cell: (r) => t(`workflowsP5.origin.${r.origin}`),
      sortValue: (r) => r.origin,
    },
    { id: "scope", header: t("workflowsP5.rules.scope"), cell: (r) => t(`workflowsP5.scopeLevel.${r.scopeLevel}`) },
    {
      id: "enabled",
      header: t("workflowsP5.field.status"),
      cell: (r) => (
        <span className="block">
          <EnabledChip rule={r} />
          {!r.disableAllowed ? (
            <span className="block small muted" data-protected="true">
              <bdi>{t("workflowsP5.rules.protectedShort")}</bdi>
            </span>
          ) : null}
        </span>
      ),
      sortValue: (r) => (r.enabled ? 1 : 0),
    },
    {
      id: "version",
      header: t("workflowsP5.rules.effectiveVersion"),
      cell: (r) =>
        r.effectiveVersionNo === null ? (
          <span className="muted">{t("workflowsP5.rules.noEffectiveVersion")}</span>
        ) : (
          <bdi dir="ltr">v{r.effectiveVersionNo}</bdi>
        ),
      sortValue: (r) => r.effectiveVersionNo ?? 0,
    },
    {
      id: "open",
      header: t("workflowsP5.rules.openVersion"),
      cell: (r) => (r.openVersionNo === null ? "—" : <bdi dir="ltr">v{r.openVersionNo}</bdi>),
    },
    {
      id: "summary",
      header: t("workflowsP5.rules.summary"),
      cell: (r) => (r.summary ? pick(locale, r.summary.en, r.summary.ar) : <span className="muted">—</span>),
    },
  ];
  return (
    <div className="page" data-p5-screen="automation-rules">
      <PageHeader
        title={t("nav.p5.automation.title")}
        subtitle={t("nav.p5.automation.summary")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("nav.p5.automation.title") }]}
        actions={
          canConfigure && !creating ? (
            <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
              {t("workflowsP5.rules.create")}
            </button>
          ) : null
        }
      />
      <HumanDecisionNote />
      {!canConfigure ? <ReadOnlyNote body={t("workflowsP5.rules.readOnly")} /> : null}
      <AutomationLinks />
      {creating ? <CreateRule onClose={() => setCreating(false)} /> : null}
      <Section
        id="rules"
        title={t("workflowsP5.rules.listTitle")}
        actions={
          <>
            <label className="filters__select">
              <span>{t("workflowsP5.rules.origin")}</span>
              <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
                <option value="">{t("workflowsP5.all")}</option>
                <option value="starter">{t("workflowsP5.origin.starter")}</option>
                <option value="admin">{t("workflowsP5.origin.admin")}</option>
              </select>
            </label>
            <label className="filters__select">
              <span>{t("workflowsP5.field.status")}</span>
              <select value={enabled} onChange={(e) => setEnabled(e.target.value)}>
                <option value="">{t("workflowsP5.all")}</option>
                <option value="true">{t("workflowsP5.rules.enabled")}</option>
                <option value="false">{t("workflowsP5.rules.disabled")}</option>
              </select>
            </label>
          </>
        }
      >
        <QueryState query={rules}>
          {(rows) => (
            <RegisterTable
              id="p5-automation-rules"
              caption={t("workflowsP5.rules.listTitle")}
              rows={rows}
              columns={columns}
              getRowId={(r) => r.id}
              emptyTitle={t("workflowsP5.rules.empty")}
              defaultSort={{ id: "name", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
    </div>
  );
}

function CreateRule({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const catalogue = useCatalogue();
  // D-181: every transformation the user may see (all pages), not the first 100.
  const transformations = useAllTransformations({ sort: "code:asc" });
  const refresh = useFedRefresh();
  const runner = useRunner(refresh);
  const navigate = useSessionNavigate();
  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [scopeLevel, setScopeLevel] = useState<"organization" | "transformation">("transformation");
  const [tid, setTid] = useState("");
  const [content, setContent] = useState<ContentDraft>(emptyContent);
  return (
    <Section id="create-rule" title={t("workflowsP5.rules.createTitle")} intro={t("workflowsP5.rules.createIntro")}>
      <QueryState query={catalogue}>
        {(cat) => (
          <QueryState query={transformations}>
            {(items) => {
              const trs = items.map((x) => ({ id: x.id, code: x.code, name: x.name }));
              return (
                <form
                  className="form"
                  noValidate
                  data-form="create-rule"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const organizationId =
                      scopeLevel === "transformation"
                        ? (items.find((x) => x.id === tid)?.organizationId ?? me.user.organizationId)
                        : me.user.organizationId;
                    void runner
                      .run<AutomationRule>(fedPaths.rules, {
                        body: {
                          code: code.trim(),
                          nameEn: nameEn.trim(),
                          nameAr: nameAr.trim(),
                          scopeLevel,
                          organizationId,
                          ...(scopeLevel === "transformation" && tid ? { transformationId: tid } : {}),
                          ownerUserId: me.user.id,
                          content: toContentBody(content),
                        },
                      })
                      .then((r) => {
                        if (r) navigate(`/admin/automation/rules/${r.id}`);
                      });
                  }}
                >
                  {runner.alert}
                  <div className="grid grid--3">
                    <Field label={t("workflowsP5.field.code")} hint={t("workflowsP5.rules.codeHint")} required>
                      {(p) => (
                        <input {...p} dir="ltr" maxLength={64} value={code} onChange={(e) => setCode(e.target.value)} />
                      )}
                    </Field>
                    <Field label={`${t("workflowsP5.builder.name")} (${t("workflowsP5.lang.en")})`} required>
                      {(p) => (
                        <input
                          {...p}
                          dir="ltr"
                          maxLength={200}
                          value={nameEn}
                          onChange={(e) => setNameEn(e.target.value)}
                        />
                      )}
                    </Field>
                    <Field label={`${t("workflowsP5.builder.name")} (${t("workflowsP5.lang.ar")})`} required>
                      {(p) => (
                        <input {...p} maxLength={200} value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
                      )}
                    </Field>
                    <Field label={t("workflowsP5.rules.scope")} required>
                      {(p) => (
                        <select
                          {...p}
                          value={scopeLevel}
                          onChange={(e) => setScopeLevel(e.target.value as typeof scopeLevel)}
                        >
                          <option value="transformation">{t("workflowsP5.scopeLevel.transformation")}</option>
                          <option value="organization">{t("workflowsP5.scopeLevel.organization")}</option>
                        </select>
                      )}
                    </Field>
                    {scopeLevel === "transformation" ? (
                      <Field label={t("workflowsP5.field.transformation")} required>
                        {(p) => (
                          <select {...p} value={tid} onChange={(e) => setTid(e.target.value)}>
                            <option value="">{t("workflowsP5.choose")}</option>
                            {trs.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.code} · {x.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                    ) : null}
                  </div>
                  <ContentEditor
                    value={content}
                    onChange={setContent}
                    catalogue={cat}
                    transformations={trs}
                    idPrefix="create"
                  />
                  <div className="form__actions">
                    <button type="submit" className="button button--primary" disabled={runner.busy}>
                      {t("workflowsP5.rules.createSubmit")}
                    </button>
                    <button type="button" className="button button--link" onClick={onClose}>
                      {t("workflowsP5.close")}
                    </button>
                  </div>
                </form>
              );
            }}
          </QueryState>
        )}
      </QueryState>
    </Section>
  );
}
