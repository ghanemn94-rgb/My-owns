// Administration > Jobs (T-DG4-FE-A; ADR-0025 §3; REQ-S16-005 display side): the scheduled jobs of the worker (the
// approval escalation scan, the delegation expiry sweep, the KPI reporting-period opening, …). Technical
// administrators with job.configure enable or disable a job and change its five-field cron schedule and time zone
// (default Asia/Riyadh); job.read holders see the list read-only. A job never decides a business approval: a timer
// only escalates (REQ-S10-019).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isFiveFieldCron } from "@mth/shared/schemas";
import { p4Keys, p4Paths, useJobSchedules, useP4KeyRefresh, type JobSchedule } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { NoPermissionState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { P4FormDialog, ReadOnlyNote } from "../my-work/p4ui.tsx";

const NS = ["calendar"] as const;

export function JobsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  usePageTitle(t("calendar.jobs.title"));
  const canRead = canAnywhere(me, "job.read");
  const canConfigure = canAnywhere(me, "job.configure");
  const jobs = useJobSchedules(canRead);
  const refresh = useP4KeyRefresh();
  const [editing, setEditing] = useState<JobSchedule | null>(null);
  if (!canRead || (jobs.isError && jobs.data === undefined && (jobs.error as { status?: number }).status === 403))
    return (
      <div className="page">
        <NoPermissionState />
      </div>
    );
  const columns: RegisterColumn<JobSchedule>[] = [
    {
      id: "job",
      header: t("calendar.jobs.job"),
      rowHeader: true,
      hideable: false,
      cell: (j) => (
        <span className="block">
          {locale === "ar" ? j.descriptionAr : j.descriptionEn}
          <span className="block small muted">
            <bdi dir="ltr" className="code">
              {j.code}
            </bdi>
          </span>
        </span>
      ),
      sortValue: (j) => j.code,
      filterText: (j) => `${j.code} ${j.descriptionEn} ${j.descriptionAr}`,
    },
    {
      id: "schedule",
      header: t("calendar.jobs.cron"),
      cell: (j) => (
        <bdi dir="ltr" className="code">
          {j.cron}
        </bdi>
      ),
    },
    {
      id: "timezone",
      header: t("calendar.field.timezone"),
      cell: (j) => <bdi dir="ltr">{j.timezone}</bdi>,
    },
    {
      id: "enabled",
      header: t("calendar.jobs.enabled"),
      cell: (j) => (
        <span className={`lifecycle-chip${j.enabled ? "" : " lifecycle-chip--draft"}`} data-enabled={String(j.enabled)}>
          <Icon name={j.enabled ? "check" : "pause"} /> {j.enabled ? t("calendar.jobs.on") : t("calendar.jobs.off")}
        </span>
      ),
      sortValue: (j) => (j.enabled ? 1 : 0),
    },
    {
      id: "module",
      header: t("calendar.jobs.module"),
      cell: (j) => <bdi dir="ltr">{j.ownerModule}</bdi>,
      sortValue: (j) => j.ownerModule,
    },
    {
      id: "updated",
      header: t("calendar.jobs.updated"),
      cell: (j) => formatDateTime(j.updatedAt, locale),
      sortValue: (j) => j.updatedAt,
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (j) =>
        canConfigure ? (
          <button
            type="button"
            className="button button--link button--small"
            data-action="edit-job"
            onClick={() => setEditing(j)}
          >
            <Icon name="pencil" /> {t("common.action.edit")}
            <span className="visually-hidden">: {j.code}</span>
          </button>
        ) : (
          <span className="muted small">{t("common.readOnly")}</span>
        ),
    },
  ];
  return (
    <div className="page" data-page="jobs">
      <PageHeader
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("calendar.jobs.title") }]}
        title={t("calendar.jobs.title")}
        subtitle={t("calendar.jobs.intro")}
      />
      {canConfigure ? null : <ReadOnlyNote body={t("calendar.jobs.readOnly")} />}
      <Section id="jobs" title={t("calendar.jobs.listTitle")}>
        <QueryState query={jobs}>
          {(rows) => (
            <RegisterTable
              id="p4-jobs"
              caption={t("calendar.jobs.listTitle")}
              rows={rows}
              columns={columns}
              getRowId={(j) => j.code}
              emptyTitle={t("calendar.jobs.empty")}
              defaultSort={{ id: "job", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
      {editing ? (
        <P4FormDialog
          title={t("calendar.jobs.editTitle", { code: editing.code })}
          description={<p>{t("calendar.jobs.editDescription")}</p>}
          fields={[
            { name: "enabled", label: t("calendar.jobs.enabledLabel"), kind: "checkbox" },
            {
              name: "cron",
              label: t("calendar.jobs.cron"),
              kind: "text",
              required: true,
              max: 100,
              ltr: true,
              hint: t("calendar.jobs.cronHint"),
            },
            {
              name: "timezone",
              label: t("calendar.field.timezone"),
              kind: "text",
              required: true,
              max: 64,
              ltr: true,
              hint: t("calendar.edit.timezoneHint"),
            },
          ]}
          initial={{ enabled: editing.enabled, cron: editing.cron, timezone: editing.timezone }}
          submitLabel={t("common.action.save")}
          method="PATCH"
          url={p4Paths.jobSchedule(editing.code)}
          version={editing.version}
          toBody={(v) => {
            const cron = String(v["cron"]).trim();
            if (!isFiveFieldCron(cron)) return { fieldErrors: { cron: "job.cron_invalid" } };
            const body: Record<string, unknown> = {};
            if (v["enabled"] !== editing.enabled) body["enabled"] = v["enabled"] === true;
            if (cron !== editing.cron) body["cron"] = cron;
            const tz = String(v["timezone"]).trim();
            if (tz !== editing.timezone) body["timezone"] = tz;
            if (Object.keys(body).length === 0) return { fieldErrors: { cron: "validation.empty_update" } };
            return body;
          }}
          namespaces={NS}
          onDone={() => refresh(p4Keys.jobSchedules)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
