// Methodology migrations of one transformation (T-DG5-FE-B; REQ-S06-008, REQ-S06-010; ADR-0040 §1-§4): the pinned
// configuration versions, the migrations (one open per kind), the "plan a migration" form (methodology_migration.plan:
// the methodology administrator) and the gate re-approvals a migration requires. Publishing a new version never moves
// a pin: only a deliberate, approved migration does, and it never rewrites history. A migration's approval is a
// business approval inside the product (the Executive Sponsor by default), never an engineering delivery gate.
import { CONFIG_KINDS } from "@mth/shared/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { p5Paths, useConfigPins, useConfigVersions, useP5Refresh } from "../../api/p5.ts";
import { useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionBoundAction } from "../../auth/sessionBound.ts";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { BusinessApprovalNote, P4FormDialog, ReadOnlyNote, type P4Values } from "../my-work/p4ui.tsx";
import { STUDIO_NS } from "../studio/api.ts";
import { isOpenMigration, useMigrations, useReapprovals, type MethodologyMigration } from "./api.ts";
import { MigrationStatusChip } from "./ui.tsx";

export function MigrationsPage() {
  const { id: tid = "" } = useParams();
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  usePageTitle(t("nav.p5.methodologyMigrations.title"));
  const transformation = useTransformation(tid);
  const migrations = useMigrations(tid);
  const reapprovals = useReapprovals(tid);
  const pins = useConfigPins(tid);
  const canPlan = canAnywhere(me, "methodology_migration.plan");
  const published = useConfigVersions({ status: "published" }, canPlan);
  const refresh = useP5Refresh(tid);
  const begin = useSessionBoundAction();
  const [planning, setPlanning] = useState(false);
  const [kind, setKind] = useState("methodology");
  const name = transformation.data ? `${transformation.data.code} · ${transformation.data.name}` : "";

  const targets = (published.data ?? []).filter((v) => {
    const pin = pins.data?.find((p) => p.kind === v.configKind);
    return v.configKind === kind && (!pin || (v.key === pin.key && v.versionNo > pin.versionNo));
  });

  return (
    <div className="page" data-p5-screen="methodology-migrations">
      <PageHeader
        title={t("nav.p5.methodologyMigrations.title")}
        subtitle={name}
        crumbs={[
          { label: t("nav.sub.methodologyMigrations"), to: "/admin/methodology-migrations" },
          ...(name ? [{ label: name, to: `/transformations/${tid}` }] : []),
          { label: t("nav.p5.methodologyMigrations.title") },
        ]}
        actions={
          canPlan ? (
            <button type="button" className="button button--primary" onClick={() => setPlanning(true)}>
              {t("studio.migration.plan")}
            </button>
          ) : null
        }
      />
      <BusinessApprovalNote body={t("studio.migration.approvalNote")} />
      {!canPlan ? <ReadOnlyNote body={t("studio.migration.readOnly")} /> : null}
      <p>
        <Link className="link" to={`/transformations/${tid}/config-pins`}>
          {t("studio.pins.title")}
        </Link>
      </p>
      <Section id="migrations" title={t("studio.migration.listTitle")}>
        <QueryState
          query={migrations}
          isEmpty={(rows) => rows.length === 0}
          empty={<EmptyState title={t("studio.migration.empty")} body={t("studio.migration.emptyBody")} />}
        >
          {(rows) => (
            <div className="table-wrap">
              <table className="table" data-table="migrations">
                <caption className="visually-hidden">{t("studio.migration.listTitle")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("studio.migration.createdAt")}</th>
                    <th scope="col">{t("studio.field.kind")}</th>
                    <th scope="col">{t("studio.migration.status")}</th>
                    <th scope="col">{t("studio.migration.items")}</th>
                    <th scope="col">{t("studio.migration.open")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows]
                    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                    .map((m: MethodologyMigration) => (
                      <tr key={m.id} data-migration={m.status}>
                        <th scope="row">
                          <Link className="link" to={`/transformations/${tid}/methodology-migrations/${m.id}`}>
                            {formatDateTime(m.createdAt, locale)}
                          </Link>
                        </th>
                        <td>{t(`studio.kind.${m.configKind}`)}</td>
                        <td>
                          <MigrationStatusChip status={m.status} />
                        </td>
                        <td>{m.items.length}</td>
                        <td>{isOpenMigration(m) ? t("studio.policies.yes") : t("studio.policies.no")}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </Section>
      <Section id="reapprovals" title={t("studio.reapproval.title")} intro={t("studio.reapproval.intro")}>
        <QueryState
          query={reapprovals}
          isEmpty={(rows) => rows.length === 0}
          empty={<EmptyState title={t("studio.reapproval.empty")} />}
        >
          {(rows) => (
            <div className="table-wrap">
              <table className="table" data-table="reapprovals">
                <caption className="visually-hidden">{t("studio.reapproval.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("studio.reapproval.gate")}</th>
                    <th scope="col">{t("studio.migration.status")}</th>
                    <th scope="col">{t("studio.migration.createdAt")}</th>
                    <th scope="col">{t("studio.reapproval.resolvedAt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} data-reapproval={r.status}>
                      <th scope="row">
                        <Link className="link" to={`/transformations/${tid}/gates/${r.gateCode}`}>
                          <bdi dir="ltr">{r.gateCode}</bdi>
                        </Link>
                      </th>
                      <td>{t(`studio.reapproval.status.${r.status}`)}</td>
                      <td>{formatDateTime(r.createdAt, locale)}</td>
                      <td>
                        {r.resolvedAt ? (
                          formatDateTime(r.resolvedAt, locale)
                        ) : (
                          <span className="muted">{t("common.value.none")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </Section>
      {planning ? (
        <P4FormDialog
          title={t("studio.migration.planTitle")}
          description={t("studio.migration.planBody")}
          fields={[
            {
              name: "configKind",
              label: t("studio.field.kind"),
              kind: "select",
              required: true,
              options: CONFIG_KINDS.map((k) => ({ value: k, label: t(`studio.kind.${k}`) })),
            },
            {
              name: "toVersionId",
              label: t("studio.migration.target"),
              hint: targets.length === 0 ? t("studio.migration.noTarget") : t("studio.migration.targetHint"),
              kind: "select",
              required: true,
              options: targets.map((v) => ({
                value: v.id,
                label: `v${v.versionNo} · ${locale === "ar" ? v.titleAr : v.titleEn}`,
              })),
            },
            {
              name: "reason",
              label: t("studio.migration.reason"),
              kind: "textarea",
              required: true,
              min: 3,
              max: 4000,
            },
          ]}
          initial={{ configKind: kind }}
          onValuesChange={(v: P4Values) => setKind(String(v["configKind"] ?? "methodology"))}
          submitLabel={t("studio.migration.planSubmit")}
          url={p5Paths.methodologyMigrations(tid)}
          namespaces={STUDIO_NS}
          toBody={(v) => ({ configKind: v["configKind"], toVersionId: v["toVersionId"], reason: v["reason"] })}
          onDone={async (result) => {
            const action = begin();
            if (!(await refresh())) return false;
            const created = result as MethodologyMigration | null;
            if (created?.id) action.navigate(`/transformations/${tid}/methodology-migrations/${created.id}`);
            return true;
          }}
          onClose={() => setPlanning(false)}
        />
      ) : null}
    </div>
  );
}
