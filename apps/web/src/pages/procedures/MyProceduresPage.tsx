// Playbook and Procedures > My procedures (T-DG5-FE-D; REQ-S06-002; ADR-0042 §4, §7): the procedure steps assigned to
// me or my role (listMyProcedureSteps), the procedure instances I can read (listProcedureInstances), and the launch of
// a published procedure (launchProcedureInstance, with an Idempotency-Key so a retried launch creates one instance).
// A due date the business calendar cannot compute is shown as Unknown with its reason, never as a guessed date.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { newIdempotencyKey } from "../../api/client.ts";
import { p5Paths, useP5Refresh } from "../../api/p5.ts";
import { useAllTransformations } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionNavigate } from "../../auth/sessionBound.ts";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { DueDate } from "../my-work/p4ui.tsx";
import { StatusChip, pick, useRunner } from "../automation/ui.tsx";
import {
  INSTANCE_STATUS_CHIP,
  STEP_STATUS_CHIP,
  useDefinitions,
  useInstances,
  useMySteps,
  type MyProcedureStep,
  type ProcedureInstance,
} from "./api.ts";

/** Overdue: Yes / No, or Unknown when the due date cannot be computed (never "on time" by default). */
export function OverdueCell({ overdue }: { overdue: boolean | null }) {
  const { t } = useTranslation();
  if (overdue === null) return <span className="muted">{t("workflowsP5.unknown")}</span>;
  return (
    <span data-overdue={String(overdue)}>
      {overdue ? t("workflowsP5.procedures.overdueYes") : t("workflowsP5.procedures.overdueNo")}
    </span>
  );
}

export function MyProceduresPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  usePageTitle(t("nav.p5.myProcedures.title"));
  const steps = useMySteps();
  const [status, setStatus] = useState("active");
  const instances = useInstances(status ? { status } : {});

  const stepColumns: RegisterColumn<MyProcedureStep>[] = [
    {
      id: "procedure",
      header: t("workflowsP5.procedures.procedure"),
      rowHeader: true,
      hideable: false,
      cell: (s) => (
        <Link className="link" to={`/playbook/procedures/${s.instanceId}`}>
          {pick(locale, s.procedureNameEn, s.procedureNameAr)}
        </Link>
      ),
      sortValue: (s) => s.procedureNameEn,
      filterText: (s) => `${s.procedureNameEn} ${s.procedureNameAr} ${s.step.nameEn} ${s.step.nameAr}`,
    },
    { id: "step", header: t("workflowsP5.procedures.step"), cell: (s) => pick(locale, s.step.nameEn, s.step.nameAr) },
    {
      id: "status",
      header: t("workflowsP5.field.status"),
      cell: (s) => <StatusChip value={s.step.status} table={STEP_STATUS_CHIP} labelKey="workflowsP5.stepStatus" />,
      sortValue: (s) => s.step.status,
    },
    {
      id: "role",
      header: t("workflowsP5.procedures.assigneeRole"),
      cell: (s) => <bdi dir="ltr">{s.step.assigneeRoleCode}</bdi>,
    },
    {
      id: "due",
      header: t("workflowsP5.procedures.dueDate"),
      cell: (s) => <DueDate date={s.step.dueDate} reason={s.step.dueDateUnknownReason} />,
      sortValue: (s) => s.step.dueDate ?? "",
    },
    {
      id: "overdue",
      header: t("workflowsP5.procedures.overdue"),
      cell: (s) => <OverdueCell overdue={s.step.overdue} />,
    },
  ];

  const instanceColumns: RegisterColumn<ProcedureInstance>[] = [
    {
      id: "name",
      header: t("workflowsP5.procedures.procedure"),
      rowHeader: true,
      hideable: false,
      cell: (i) => (
        <Link className="link" to={`/playbook/procedures/${i.id}`}>
          {pick(locale, i.nameEn, i.nameAr)}
        </Link>
      ),
      sortValue: (i) => i.nameEn,
      filterText: (i) => `${i.nameEn} ${i.nameAr} ${i.procedureCode}`,
    },
    {
      id: "status",
      header: t("workflowsP5.field.status"),
      cell: (i) => <StatusChip value={i.status} table={INSTANCE_STATUS_CHIP} labelKey="workflowsP5.instanceStatus" />,
      sortValue: (i) => i.status,
    },
    {
      id: "version",
      header: t("workflowsP5.procedures.definitionVersion"),
      cell: (i) => <bdi dir="ltr">v{i.versionNo}</bdi>,
      sortValue: (i) => i.versionNo,
    },
    {
      id: "current",
      header: t("workflowsP5.procedures.currentStep"),
      cell: (i) => {
        const current = i.steps.filter((s) => i.currentStepKeys.includes(s.stepKey));
        return current.length === 0 ? (
          <span className="muted">{t("workflowsP5.none")}</span>
        ) : (
          current.map((s) => pick(locale, s.nameEn, s.nameAr)).join(" · ")
        );
      },
    },
    {
      id: "due",
      header: t("workflowsP5.procedures.dueDate"),
      cell: (i) => <DueDate date={i.dueDate} />,
      sortValue: (i) => i.dueDate ?? "",
    },
    {
      id: "launched",
      header: t("workflowsP5.procedures.launchedAt"),
      cell: (i) => formatDateTime(i.launchedAt, locale),
      sortValue: (i) => i.launchedAt,
    },
  ];

  return (
    <div className="page" data-p5-screen="my-procedures">
      <PageHeader
        title={t("nav.p5.myProcedures.title")}
        subtitle={t("workflowsP5.procedures.mySummary")}
        crumbs={[{ label: t("nav.areas.playbook.label"), to: "/playbook" }, { label: t("nav.p5.myProcedures.title") }]}
      />
      <Section id="my-steps" title={t("workflowsP5.procedures.myStepsTitle")}>
        <QueryState query={steps}>
          {(rows) => (
            <RegisterTable
              id="p5-my-steps"
              caption={t("workflowsP5.procedures.myStepsTitle")}
              rows={rows}
              columns={stepColumns}
              getRowId={(s) => `${s.instanceId}:${s.step.stepKey}`}
              emptyTitle={t("workflowsP5.procedures.myStepsEmpty")}
              defaultSort={{ id: "due", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
      <LaunchSection />
      <Section
        id="instances"
        title={t("workflowsP5.procedures.instancesTitle")}
        actions={
          <label className="filters__select">
            <span>{t("workflowsP5.field.status")}</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("workflowsP5.all")}</option>
              {(["active", "completed", "cancelled"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`workflowsP5.instanceStatus.${s}`)}
                </option>
              ))}
            </select>
          </label>
        }
      >
        <QueryState query={instances}>
          {(rows) => (
            <RegisterTable
              id="p5-procedure-instances"
              caption={t("workflowsP5.procedures.instancesTitle")}
              rows={rows}
              columns={instanceColumns}
              getRowId={(i) => i.id}
              emptyTitle={t("workflowsP5.procedures.instancesEmpty")}
              defaultSort={{ id: "launched", dir: "desc" }}
            />
          )}
        </QueryState>
      </Section>
    </div>
  );
}

/**
 * Launch a published procedure in a transformation (or at organization level when its scope says so). Offered only to
 * a user who holds procedure.launch somewhere (T-DG5-FE-RG1, F-DG5-140): a user who cannot launch any procedure (the
 * Auditor, for example) gets a read-only note instead of a form that could only end in 403. This only decides what the
 * UI offers; the server still checks the permission and the procedure's launch roles on every launch (instances.ts).
 */
function LaunchSection() {
  const { t } = useTranslation();
  const me = useMe();
  if (!canAnywhere(me, "procedure.launch"))
    return (
      <Section
        id="launch"
        title={t("workflowsP5.procedures.launchTitle")}
        intro={t("workflowsP5.procedures.launchIntro")}
      >
        <p className="banner banner--info" role="note" data-state="read-only">
          <Icon name="lock" /> {t("workflowsP5.procedures.launchReadOnly")}
        </p>
      </Section>
    );
  return <LaunchForm />;
}

function LaunchForm() {
  const { t } = useTranslation();
  const locale = useLocale();
  const definitions = useDefinitions();
  // D-181: every transformation the user may see (all pages), not the first 100.
  const transformations = useAllTransformations({ sort: "code:asc" });
  const refresh = useP5Refresh();
  const runner = useRunner(refresh);
  const navigate = useSessionNavigate();
  const [code, setCode] = useState("");
  const [tid, setTid] = useState("");
  const [missing, setMissing] = useState(false);
  // One idempotency key per intended launch: a retry of the same submission reuses it (one instance).
  const key = useMemo(() => newIdempotencyKey(), [code, tid]); // eslint-disable-line react-hooks/exhaustive-deps
  const published = (definitions.data ?? []).filter((d) => !d.removed && d.versionStatus === "published");
  const selected = published.find((d) => d.code === code);
  const needsTransformation = selected?.scope.level === "transformation";
  return (
    <Section
      id="launch"
      title={t("workflowsP5.procedures.launchTitle")}
      intro={t("workflowsP5.procedures.launchIntro")}
    >
      <form
        className="form"
        noValidate
        data-form="launch-procedure"
        onSubmit={(e) => {
          e.preventDefault();
          if (!selected || (needsTransformation && !tid)) {
            setMissing(true);
            return;
          }
          setMissing(false);
          void runner
            .run<ProcedureInstance>(p5Paths.procedureInstances, {
              body: { procedureCode: selected.code, transformationId: needsTransformation ? tid : null },
              idempotencyKey: key,
            })
            .then((created) => {
              if (created) navigate(`/playbook/procedures/${created.id}`);
            });
        }}
      >
        {runner.alert}
        <Field
          label={t("workflowsP5.procedures.procedure")}
          required
          error={missing && !selected ? t("problems.validation__required") : undefined}
        >
          {(p) => (
            <select {...p} value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">{t("workflowsP5.choose")}</option>
              {published.map((d) => (
                <option key={d.code} value={d.code}>
                  {pick(locale, d.nameEn, d.nameAr)} (v{d.versionNo})
                </option>
              ))}
            </select>
          )}
        </Field>
        {needsTransformation ? (
          <QueryState query={transformations}>
            {(items) => (
              <Field
                label={t("workflowsP5.field.transformation")}
                required
                error={missing && !tid ? t("problems.validation__required") : undefined}
              >
                {(p) => (
                  <select {...p} value={tid} onChange={(e) => setTid(e.target.value)}>
                    <option value="">{t("workflowsP5.choose")}</option>
                    {items.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.code} · {tr.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </QueryState>
        ) : null}
        <div className="form__actions">
          <button type="submit" className="button button--primary" disabled={runner.busy}>
            {t("workflowsP5.procedures.launch")}
          </button>
        </div>
      </form>
    </Section>
  );
}
