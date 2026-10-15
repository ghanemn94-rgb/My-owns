// One methodology migration (T-DG5-FE-B; REQ-S06-008, REQ-S06-010; ADR-0040 §1-§4, §8): the plan — default mappings,
// new required fields (with the administrator's inputs; blank = "leave empty until the record's next edit"),
// invalidated calculations, required gate re-approvals, removed elements and the history that stays unchanged — and its
// lifecycle: preview (recomputes the plan), submit, the business decision (approve / reject / request changes, with a
// rationale; the requester may not decide its own migration: 403 methodology_migration.self_approval), execute (moves
// the pin; 409 methodology_migration.pin_moved when the pin moved meanwhile) and withdraw. Execution never rewrites a
// historical record, submission, snapshot or decision. The decision is a business approval inside the product.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { p5Paths, useConfigVersion, useP5Refresh } from "../../api/p5.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { BusinessApprovalNote, P4FormDialog, ReadOnlyNote, useUserNames } from "../my-work/p4ui.tsx";
import { STUDIO_NS, displayValue } from "../studio/api.ts";
import { useActionRunner } from "../studio/ui.tsx";
import { itemsByKind, previewInputs, useMigration, type MethodologyMigration } from "./api.ts";
import { MigrationStatusChip } from "./ui.tsx";

export function MigrationPage() {
  const { id: tid = "", migrationId = "" } = useParams();
  const { t } = useTranslation();
  usePageTitle(t("studio.migration.pageTitle"));
  const migration = useMigration(tid, migrationId);
  return (
    <div className="page" data-p5-screen="methodology-migration">
      <QueryState query={migration}>{(m) => <MigrationView tid={tid} migration={m} />}</QueryState>
    </div>
  );
}

function VersionLink({ versionId }: { versionId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const v = useConfigVersion(versionId);
  const label = v.data
    ? `v${v.data.versionNo} · ${locale === "ar" ? v.data.titleAr : v.data.titleEn}`
    : t("studio.migration.versionRef");
  return (
    <Link className="link" to={`/admin/studio/versions/${versionId}`}>
      {label}
    </Link>
  );
}

function MigrationView({ tid, migration: m }: { tid: string; migration: MethodologyMigration }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useP5Refresh(tid);
  const runner = useActionRunner(refresh);
  const names = useUserNames([m.requestedBy, m.submittedBy, m.decidedBy, m.executedBy]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [deciding, setDeciding] = useState(false);
  const canPlan = canAnywhere(me, "methodology_migration.plan");
  const canApprove = canAnywhere(me, "methodology_migration.approve");
  const canExecute = canAnywhere(me, "methodology_migration.execute");
  const planning = m.status === "draft" || m.status === "changes_requested";
  const groups = itemsByKind(m.items);
  const needsInput = m.items.filter(
    (i) => i.itemKind === "new_required_field" && (i.resolution === "needs_input" || i.resolution === "provided"),
  );

  return (
    <>
      <PageHeader
        title={t("studio.migration.heading", { kind: t(`studio.kind.${m.configKind}`) })}
        subtitle={<MigrationStatusChip status={m.status} />}
        crumbs={[
          { label: t("nav.p5.methodologyMigrations.title"), to: `/transformations/${tid}/methodology-migrations` },
          { label: t("studio.migration.pageTitle") },
        ]}
      />
      <BusinessApprovalNote body={t("studio.migration.approvalNote")} />
      {!canPlan && !canApprove && !canExecute ? <ReadOnlyNote body={t("studio.migration.readOnly")} /> : null}
      {runner.alert}
      <section className="card" aria-labelledby="migration-details">
        <h2 id="migration-details" className="card__title">
          {t("studio.migration.details")}
        </h2>
        <dl className="details">
          <div>
            <dt>{t("studio.migration.from")}</dt>
            <dd>
              <VersionLink versionId={m.fromVersionId} />
            </dd>
          </div>
          <div>
            <dt>{t("studio.migration.target")}</dt>
            <dd>
              <VersionLink versionId={m.toVersionId} />
            </dd>
          </div>
          <div>
            <dt>{t("studio.migration.reason")}</dt>
            <dd>
              <TextCell value={m.reason} />
            </dd>
          </div>
          <div>
            <dt>{t("studio.migration.planRevision")}</dt>
            <dd>
              {m.planRevision} · {m.planReady ? t("studio.migration.planReady") : t("studio.migration.planNotReady")}
            </dd>
          </div>
          <div>
            <dt>{t("studio.migration.requestedBy")}</dt>
            <dd>
              {names(m.requestedBy)} · {formatDateTime(m.createdAt, locale)}
            </dd>
          </div>
          {m.decidedBy && m.decidedAt ? (
            <div>
              <dt>{t("studio.migration.decidedBy")}</dt>
              <dd>
                {names(m.decidedBy)} · {formatDateTime(m.decidedAt, locale)}
              </dd>
            </div>
          ) : null}
          {m.executedBy && m.executedAt ? (
            <div>
              <dt>{t("studio.migration.executedBy")}</dt>
              <dd>
                {names(m.executedBy)} · {formatDateTime(m.executedAt, locale)}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="form__actions">
          {planning && canPlan ? (
            <button
              type="button"
              className="button button--secondary"
              disabled={runner.busy}
              data-action="preview"
              onClick={() =>
                void runner.run(p5Paths.previewMethodologyMigration(tid, m.id), {
                  body: { inputs: previewInputs(m.items, inputs) },
                  ifMatch: m.version,
                })
              }
            >
              {t("studio.migration.preview")}
            </button>
          ) : null}
          {planning && canPlan ? (
            <button
              type="button"
              className="button button--primary"
              disabled={runner.busy}
              onClick={() => void runner.run(p5Paths.submitMethodologyMigration(tid, m.id), { ifMatch: m.version })}
            >
              {t("studio.migration.submit")}
            </button>
          ) : null}
          {m.status === "submitted" && canApprove ? (
            <button type="button" className="button button--primary" onClick={() => setDeciding(true)}>
              {t("studio.migration.decide")}
            </button>
          ) : null}
          {m.status === "approved" && canExecute ? (
            <button
              type="button"
              className="button button--primary"
              disabled={runner.busy}
              onClick={() => void runner.run(p5Paths.executeMethodologyMigration(tid, m.id), { ifMatch: m.version })}
            >
              {t("studio.migration.execute")}
            </button>
          ) : null}
          {(planning || m.status === "submitted" || m.status === "approved") && canPlan ? (
            <button
              type="button"
              className="button button--danger"
              disabled={runner.busy}
              onClick={() => void runner.run(p5Paths.withdrawMethodologyMigration(tid, m.id), { ifMatch: m.version })}
            >
              {t("studio.migration.withdraw")}
            </button>
          ) : null}
        </div>
      </section>
      {planning && canPlan && needsInput.length > 0 ? (
        <Section id="inputs" title={t("studio.migration.inputs")} intro={t("studio.migration.inputsIntro")}>
          {needsInput.map((i) => {
            const key = i.stableKey ?? "";
            const id = `input-${key}`;
            return (
              <div className="field" key={`${i.ordinal}-${key}`}>
                <label htmlFor={id} className="field__label">
                  <bdi dir="ltr">{key}</bdi>
                  {i.recordType ? (
                    <>
                      {" "}
                      (<bdi dir="ltr">{i.recordType}</bdi>)
                    </>
                  ) : null}
                </label>
                <input
                  id={id}
                  type="text"
                  value={inputs[key] ?? displayValue(i.detail["value"]) ?? ""}
                  onChange={(e) => setInputs((s) => ({ ...s, [key]: e.target.value }))}
                />
              </div>
            );
          })}
        </Section>
      ) : null}
      <Section id="plan" title={t("studio.migration.planTitleSection")} intro={t("studio.migration.planIntro")}>
        {groups.length === 0 ? (
          <EmptyState title={t("studio.migration.planEmpty")} />
        ) : (
          groups.map((g) => (
            <div key={g.kind} data-item-kind={g.kind}>
              <h3>
                {t(`studio.migration.itemKind.${g.kind}`)} ({g.items.length})
              </h3>
              <div className="table-wrap">
                <table className="table table--compact">
                  <caption className="visually-hidden">{t(`studio.migration.itemKind.${g.kind}`)}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("studio.migration.item")}</th>
                      <th scope="col">{t("studio.migration.resolution")}</th>
                      <th scope="col">{t("studio.migration.detail")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((i) => (
                      <tr key={`${i.planRevision}-${i.ordinal}`}>
                        <th scope="row">
                          <bdi dir="ltr">
                            {[i.gateCode, i.elementType, i.stableKey, i.recordType].filter(Boolean).join(" · ") ||
                              `#${i.ordinal}`}
                          </bdi>
                        </th>
                        <td>{t(`studio.migration.resolutionName.${i.resolution}`)}</td>
                        <td>
                          <TextCell value={Object.keys(i.detail).length > 0 ? JSON.stringify(i.detail) : null} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </Section>
      {deciding ? (
        <P4FormDialog
          title={t("studio.migration.decide")}
          note={<BusinessApprovalNote body={t("studio.migration.decisionNote")} />}
          fields={[
            {
              name: "outcome",
              label: t("studio.review.outcome"),
              kind: "select",
              required: true,
              options: (["approve", "reject", "request_changes"] as const).map((o) => ({
                value: o,
                label: t(`studio.migration.outcome.${o}`),
              })),
            },
            {
              name: "rationale",
              label: t("studio.migration.rationale"),
              kind: "textarea",
              required: true,
              max: 8000,
            },
          ]}
          submitLabel={t("studio.review.record")}
          url={p5Paths.decideMethodologyMigration(tid, m.id)}
          version={m.version}
          namespaces={STUDIO_NS}
          toBody={(v) => ({ outcome: v["outcome"], rationale: v["rationale"] })}
          onDone={refresh}
          onClose={() => setDeciding(false)}
        />
      ) : null}
    </>
  );
}
