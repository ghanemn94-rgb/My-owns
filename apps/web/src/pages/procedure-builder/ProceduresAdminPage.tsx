// Administration > Procedure builder (T-DG5-FE-D; REQ-S06-001; ADR-0042 §1–§2, §9): the procedure definitions of one
// `procedures` configuration version (published or a draft), filterable, sortable and paged, with column selection.
// Definitions are authored only inside a Playbook Studio draft of kind `procedure` (the draft is created, reviewed and
// published in the Studio; there is no separate procedure publish). Everyone with procedure.read sees them read-only.
// A procedure definition is configuration, never a business approval.
import { PROCEDURE_CODE_PATTERN } from "@mth/shared/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useConfigVersions } from "../../api/p5.ts";
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
import { isEditableDraft, versionState } from "../studio/api.ts";
import { ConfigurationNote, VersionStateChip } from "../studio/ui.tsx";
import { pick } from "../automation/ui.tsx";
import { useDefinitions, type ProcedureDefinition } from "../procedures/api.ts";

export function ProceduresAdminPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  usePageTitle(t("nav.p5.procedureBuilder.title"));
  const canEdit = canAnywhere(me, "methodology.configure");
  const versions = useConfigVersions({ kind: "procedure" });
  const [versionId, setVersionId] = useState("");
  const rows = versions.data ?? [];
  const newest = rows.find((v) => v.status === "published" && v.isNewestPublished);
  const selectedId = versionId || newest?.id || "";
  const selected = rows.find((v) => v.id === selectedId);
  const definitions = useDefinitions(
    selectedId ? { versionId: selectedId, includeRemoved: "true" } : {},
    Boolean(selectedId),
  );
  const draftEditable = Boolean(selected && isEditableDraft(selected) && canEdit);

  const columns: RegisterColumn<ProcedureDefinition>[] = [
    {
      id: "name",
      header: t("workflowsP5.builder.name"),
      rowHeader: true,
      hideable: false,
      cell: (d) => (
        <Link className="link" to={`/admin/procedures/${d.code}?versionId=${d.methodologyVersionId}`}>
          {pick(locale, d.nameEn, d.nameAr)}
        </Link>
      ),
      sortValue: (d) => d.ordinal,
      filterText: (d) => `${d.code} ${d.nameEn} ${d.nameAr}`,
    },
    {
      id: "code",
      header: t("workflowsP5.field.code"),
      cell: (d) => (
        <bdi dir="ltr" className="code">
          {d.code}
        </bdi>
      ),
      sortValue: (d) => d.code,
    },
    {
      id: "trigger",
      header: t("workflowsP5.builder.trigger"),
      cell: (d) => t(`workflowsP5.triggerKind.${d.trigger.kind}`),
      sortValue: (d) => d.trigger.kind,
    },
    {
      id: "steps",
      header: t("workflowsP5.builder.stepCount"),
      cell: (d) => d.steps.filter((s) => !s.removed).length,
      sortValue: (d) => d.steps.length,
    },
    {
      id: "origin",
      header: t("workflowsP5.builder.origin"),
      cell: (d) =>
        d.origin === "source" ? t("workflowsP5.builder.originSource") : t("workflowsP5.builder.originAdmin"),
    },
    {
      id: "state",
      header: t("workflowsP5.field.status"),
      cell: (d) =>
        d.removed ? (
          <span className="lifecycle-chip lifecycle-chip--archived" data-removed="true">
            {t("workflowsP5.builder.removed")}
          </span>
        ) : (
          <span className={`lifecycle-chip${d.versionStatus === "draft" ? " lifecycle-chip--draft" : ""}`}>
            {t(`workflowsP5.builder.versionStatus.${d.versionStatus}`)}
          </span>
        ),
    },
  ];

  return (
    <div className="page" data-p5-screen="procedure-builder">
      <PageHeader
        title={t("nav.p5.procedureBuilder.title")}
        subtitle={t("workflowsP5.builder.summary")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("nav.p5.procedureBuilder.title") }]}
      />
      <ConfigurationNote />
      {!canEdit ? <ReadOnlyNote body={t("workflowsP5.builder.readOnly")} /> : null}
      <p className="small">
        <Link className="link" to="/admin/coverage">
          {t("nav.p5.methodologyCoverage.title")}
        </Link>
      </p>
      <Section id="version" title={t("workflowsP5.builder.versionTitle")} intro={t("workflowsP5.builder.versionIntro")}>
        <QueryState query={versions}>
          {() => (
            <div className="filters__select">
              <label htmlFor="procedure-version">{t("workflowsP5.builder.version")}</label>
              <select id="procedure-version" value={selectedId} onChange={(e) => setVersionId(e.target.value)}>
                {rows.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNo} · {pick(locale, v.titleEn, v.titleAr)} · {t(`studio.state.${versionState(v)}`)}
                  </option>
                ))}
              </select>
              {selected ? <VersionStateChip state={versionState(selected)} /> : null}
              {canEdit && selected && !isEditableDraft(selected) ? (
                <p className="small muted">
                  {t("workflowsP5.builder.needDraft")}{" "}
                  <Link className="link" to="/admin/studio">
                    {t("nav.p5.studio.title")}
                  </Link>
                </p>
              ) : null}
            </div>
          )}
        </QueryState>
      </Section>
      {draftEditable && selected ? <NewProcedureForm versionId={selected.id} /> : null}
      <Section id="definitions" title={t("workflowsP5.builder.definitionsTitle")}>
        <QueryState query={definitions}>
          {(defs) => (
            <RegisterTable
              id="p5-procedure-definitions"
              caption={t("workflowsP5.builder.definitionsTitle")}
              rows={defs}
              columns={columns}
              getRowId={(d) => d.code}
              emptyTitle={t("workflowsP5.builder.empty")}
              defaultSort={{ id: "name", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
    </div>
  );
}

/** Start a new admin procedure in the open draft: the code is fixed here, the content is authored in the editor. */
function NewProcedureForm({ versionId }: { versionId: string }) {
  const { t } = useTranslation();
  const navigate = useSessionNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  return (
    <Section id="new-procedure" title={t("workflowsP5.builder.newTitle")}>
      <form
        className="form form--inset"
        noValidate
        data-form="new-procedure"
        onSubmit={(e) => {
          e.preventDefault();
          const c = code.trim();
          if (!PROCEDURE_CODE_PATTERN.test(c)) {
            setError(true);
            return;
          }
          navigate(`/admin/procedures/${c}?versionId=${versionId}&new=1`);
        }}
      >
        <Field
          label={t("workflowsP5.field.code")}
          hint={t("problems.procedure_definition__code_invalid")}
          required
          error={error ? t("problems.procedure_definition__code_invalid") : undefined}
        >
          {(p) => <input {...p} dir="ltr" value={code} maxLength={48} onChange={(e) => setCode(e.target.value)} />}
        </Field>
        <div className="form__actions">
          <button type="submit" className="button button--primary">
            {t("workflowsP5.builder.newAction")}
          </button>
        </div>
      </form>
    </Section>
  );
}
