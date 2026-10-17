// One configuration version in the Playbook Studio (T-DG5-FE-B; REQ-S06-004, REQ-S06-006, REQ-S06-007, REQ-S06-009,
// REQ-S06-010, REQ-S02-001; ADR-0039 §1-§7, §13): the draft's details and elements, the publish pipeline
// Draft → Preview/Test → Review (where configured) → Publish with each check's result for the CURRENT content (a run on
// older content is Stale, a check never run is Not run — never passed by default), the side-by-side diff against the
// base, the affected records per transformation (Unknown with its reason, never 0), the review requests, discard, and
// rollback of a published version (a new audited version; later business records stay). Published versions are
// read-only; the API answers 409 config_version.not_editable to any edit. Refusals are shown translated by code.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { p5Paths, useConfigVersion, useStudioRefresh } from "../../api/p5.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionBoundAction } from "../../auth/sessionBound.ts";
import { Unknown } from "../../components/Badges.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section, SectionNav, TextCell } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { P4FormDialog, ReadOnlyNote, textOf, useUserNames } from "../my-work/p4ui.tsx";
import {
  STUDIO_NS,
  VERSION_CHECKS,
  checkStatusOf,
  displayValue,
  isEditableDraft,
  isOpenDraft,
  useAffectedRecords,
  useCheckRuns,
  useReviews,
  useVersionDiff,
  versionState,
  type ConfigCheckKind,
  type ConfigVersion,
} from "./api.ts";
import { ElementsSection } from "./ElementsSection.tsx";
import { CheckChip, ConfigurationNote, VersionStateChip, useActionRunner } from "./ui.tsx";

export function VersionPage() {
  const { versionId = "" } = useParams();
  const { t } = useTranslation();
  const query = useConfigVersion(versionId);
  usePageTitle(t("studio.version.pageTitle"));
  return (
    <div className="page" data-p5-screen="studio-version">
      <QueryState query={query}>{(version) => <VersionView version={version} />}</QueryState>
    </div>
  );
}

function VersionView({ version }: { version: ConfigVersion }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useStudioRefresh();
  const runner = useActionRunner(refresh);
  const begin = useSessionBoundAction();
  const canEdit = canAnywhere(me, "methodology.configure");
  const canPublish = canAnywhere(me, "methodology.publish");
  const canRunCoverage = canAnywhere(me, "source_coverage.run");
  const state = versionState(version);
  const editable = canEdit && isEditableDraft(version);
  const [dialog, setDialog] = useState<"details" | "submit" | "rollback" | null>(null);
  const title = locale === "ar" ? version.titleAr : version.titleEn;
  const sections = [
    { id: "pipeline", title: t("studio.pipeline.title") },
    { id: "elements", title: t("studio.elements.title") },
    { id: "diff", title: t("studio.diff.title") },
    { id: "affected", title: t("studio.affected.title") },
    { id: "reviews", title: t("studio.reviews.title") },
  ];

  return (
    <>
      <PageHeader
        demoBadge
        title={title}
        subtitle={
          <>
            {t(`studio.kind.${version.configKind}`)} · <bdi dir="ltr">v{version.versionNo}</bdi>{" "}
            <VersionStateChip state={state} />
          </>
        }
        crumbs={[
          { label: t("nav.areas.admin.label"), to: "/admin" },
          { label: t("nav.p5.studio.title"), to: "/admin/studio" },
          { label: title },
        ]}
      />
      <ConfigurationNote />
      {!canEdit && !canPublish ? <ReadOnlyNote body={t("studio.readOnly")} /> : null}
      {state === "published" || state === "newest_published" || state === "retired" ? (
        <p className="banner banner--info" role="note" data-state="immutable">
          {t("studio.version.immutable")}
        </p>
      ) : (
        <p className="banner banner--warning" role="note" data-state="draft">
          {t("studio.version.draftNote")}
        </p>
      )}
      {runner.alert}
      <SectionNav sections={sections} />
      <section className="card" aria-labelledby="version-details">
        <div className="card__header section__header">
          <h2 id="version-details" className="card__title">
            {t("studio.version.details")}
          </h2>
          {editable ? (
            <button type="button" className="button button--secondary" onClick={() => setDialog("details")}>
              {t("studio.version.editDetails")}
            </button>
          ) : null}
        </div>
        <dl className="details">
          <div>
            <dt>{t("studio.field.titleEn")}</dt>
            <dd dir="ltr">{version.titleEn}</dd>
          </div>
          <div>
            <dt>{t("studio.field.titleAr")}</dt>
            <dd dir="rtl">{version.titleAr}</dd>
          </div>
          <div>
            <dt>{t("studio.field.changeSummary")}</dt>
            <dd>
              <TextCell value={version.changeSummary} />
            </dd>
          </div>
          <div>
            <dt>{t("studio.field.origin")}</dt>
            <dd>{t(`studio.origin.${version.origin}`)}</dd>
          </div>
          <div>
            <dt>{t("studio.field.basedOn")}</dt>
            <dd>
              {version.basedOnVersionId ? (
                <Link className="link" to={`/admin/studio/versions/${version.basedOnVersionId}`}>
                  {t("studio.version.openBase")}
                </Link>
              ) : (
                <span className="muted">{t("common.value.none")}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("studio.field.contentHash")}</dt>
            <dd>
              <bdi dir="ltr" className="code">
                {version.contentSha256.slice(0, 12)}
              </bdi>
            </dd>
          </div>
          <div>
            <dt>{t("studio.field.publishedAt")}</dt>
            <dd>
              {version.publishedAt ? (
                formatDateTime(version.publishedAt, locale)
              ) : (
                <span className="muted">{t("studio.version.notPublished")}</span>
              )}
            </dd>
          </div>
        </dl>
        {version.configKind === "scoring_defaults" ? (
          <p>
            <Link className="link" to={`/admin/studio/scoring-defaults?versionId=${version.id}`}>
              {t("studio.defaults.openEditor")}
            </Link>
          </p>
        ) : null}
      </section>

      <PipelineSection
        version={version}
        runner={runner}
        canEdit={canEdit}
        canPublish={canPublish}
        canRunCoverage={canRunCoverage}
        onSubmit={() => setDialog("submit")}
        onRollback={() => setDialog("rollback")}
      />
      <ElementsSection version={version} editable={editable} runner={runner} refresh={refresh} />
      <DiffSection version={version} />
      <AffectedSection version={version} />
      <ReviewsSection version={version} runner={runner} />

      {dialog === "details" ? (
        <P4FormDialog
          title={t("studio.version.editDetails")}
          fields={[
            { name: "titleEn", label: t("studio.field.titleEn"), kind: "text", required: true, max: 200, ltr: true },
            { name: "titleAr", label: t("studio.field.titleAr"), kind: "text", required: true, max: 200 },
            { name: "changeSummary", label: t("studio.field.changeSummary"), kind: "textarea", max: 4000 },
          ]}
          initial={{
            titleEn: version.titleEn,
            titleAr: version.titleAr,
            changeSummary: version.changeSummary ?? "",
          }}
          submitLabel={t("studio.elements.save")}
          method="PATCH"
          url={p5Paths.configVersion(version.id)}
          version={version.version}
          namespaces={STUDIO_NS}
          toBody={(v) => ({
            titleEn: v["titleEn"],
            titleAr: v["titleAr"],
            changeSummary: textOf(v["changeSummary"]) ?? null,
          })}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "submit" ? (
        <P4FormDialog
          title={t("studio.review.submitTitle")}
          description={t("studio.review.submitBody")}
          fields={[{ name: "note", label: t("studio.review.note"), kind: "textarea", max: 4000 }]}
          submitLabel={t("studio.review.submit")}
          url={p5Paths.submitConfigReview(version.id)}
          version={version.version}
          namespaces={STUDIO_NS}
          toBody={(v) => (textOf(v["note"]) ? { note: v["note"] } : {})}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "rollback" ? (
        <P4FormDialog
          title={t("studio.rollback.title", { n: version.versionNo })}
          description={t("studio.rollback.body")}
          fields={[
            {
              name: "reason",
              label: t("studio.rollback.reason"),
              kind: "textarea",
              required: true,
              min: 3,
              max: 4000,
            },
          ]}
          submitLabel={t("studio.rollback.submit")}
          danger
          url={p5Paths.rollbackConfigVersion(version.id)}
          version={version.version}
          namespaces={STUDIO_NS}
          toBody={(v) => ({ reason: v["reason"] })}
          onDone={async (result) => {
            const action = begin();
            if (!(await refresh())) return false;
            const created = result as ConfigVersion | null;
            if (created?.id) action.navigate(`/admin/studio/versions/${created.id}`);
            return true;
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

function PipelineSection({
  version,
  runner,
  canEdit,
  canPublish,
  canRunCoverage,
  onSubmit,
  onRollback,
}: {
  version: ConfigVersion;
  runner: ReturnType<typeof useActionRunner>;
  canEdit: boolean;
  canPublish: boolean;
  canRunCoverage: boolean;
  onSubmit: () => void;
  onRollback: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const runs = useCheckRuns(version.id);
  const open = isOpenDraft(version);
  const editable = isEditableDraft(version);
  const checks = VERSION_CHECKS.filter((k) => k !== "source_coverage" || version.configKind === "methodology");
  const stage = version.draftStage;
  const steps = [
    { id: "editing", done: stage !== "editing" || version.status !== "draft" },
    { id: "preview", done: ["review", "approved"].includes(stage ?? "") || version.status === "published" },
    ...(version.reviewRequired ? [{ id: "review", done: stage === "approved" || version.status === "published" }] : []),
    { id: "publish", done: version.status === "published" },
  ];

  const runCheck = (kind: ConfigCheckKind) => {
    if (kind === "preview")
      void runner.run(p5Paths.configPreview(version.id), { body: { samples: [] }, ifMatch: version.version });
    else if (kind === "compatibility")
      void runner.run(p5Paths.compatibilityCheck(version.id), { ifMatch: version.version });
    else void runner.run(p5Paths.sourceCoverageRuns, { body: { versionId: version.id } });
  };
  const mayRun = (kind: ConfigCheckKind) => (kind === "source_coverage" ? canRunCoverage : canEdit);

  return (
    <Section id="pipeline" title={t("studio.pipeline.title")} intro={t("studio.pipeline.intro")}>
      <ol className="steps" aria-label={t("studio.pipeline.steps")}>
        {steps.map((s) => (
          <li key={s.id} data-step={s.id} data-done={s.done ? "true" : "false"}>
            {t(`studio.pipeline.step.${s.id}`)}{" "}
            <span className="small muted">({s.done ? t("studio.pipeline.done") : t("studio.pipeline.notDone")})</span>
          </li>
        ))}
      </ol>
      <p className="small">
        {version.reviewRequired ? t("studio.pipeline.reviewRequired") : t("studio.pipeline.reviewNotRequired")}
      </p>
      <QueryState query={runs}>
        {(rows) => (
          <div className="table-wrap">
            <table className="table" data-table="checks">
              <caption>{t("studio.check.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("studio.check.kind")}</th>
                  <th scope="col">{t("studio.check.result")}</th>
                  <th scope="col">{t("studio.check.ranAt")}</th>
                  <th scope="col">{t("studio.check.findings")}</th>
                  {open ? <th scope="col">{t("studio.elements.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {checks.map((kind) => {
                  const { status, run } = checkStatusOf(rows, kind, version.contentSha256);
                  return (
                    <tr key={kind} data-check-kind={kind}>
                      <th scope="row">{t(`studio.check.kindName.${kind}`)}</th>
                      <td>
                        <CheckChip status={status} />
                      </td>
                      <td>
                        {run ? (
                          formatDateTime(run.createdAt, locale)
                        ) : (
                          <span className="muted">{t("studio.check.status.not_run")}</span>
                        )}
                      </td>
                      <td>
                        <CheckFindings report={run?.report} />
                      </td>
                      {open ? (
                        <td>
                          {mayRun(kind) && (kind === "source_coverage" || editable || stage === "preview") ? (
                            <button
                              type="button"
                              className="button button--secondary button--small"
                              disabled={runner.busy}
                              data-run-check={kind}
                              onClick={() => runCheck(kind)}
                            >
                              {t(`studio.check.run.${kind}`)}
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
      {version.pendingReviewId ? (
        <p className="banner banner--info" role="note" data-state="pending-review">
          {t("studio.review.pending")}{" "}
          <Link className="link" to={`/admin/studio/versions/${version.id}/reviews/${version.pendingReviewId}`}>
            {t("studio.review.open")}
          </Link>
        </p>
      ) : null}
      <div className="form__actions">
        {open && canEdit && version.reviewRequired && !version.pendingReviewId && stage !== "approved" ? (
          <button type="button" className="button button--secondary" onClick={onSubmit} disabled={runner.busy}>
            {t("studio.review.submit")}
          </button>
        ) : null}
        {open && canPublish ? (
          <button
            type="button"
            className="button button--primary"
            disabled={runner.busy}
            data-action="publish"
            onClick={() => void runner.run(p5Paths.publishConfigVersion(version.id), { ifMatch: version.version })}
          >
            {t("studio.publish.action")}
          </button>
        ) : null}
        {open && canEdit ? (
          <button
            type="button"
            className="button button--danger"
            disabled={runner.busy}
            onClick={() => void runner.run(p5Paths.discardConfigDraft(version.id), { ifMatch: version.version })}
          >
            {t("studio.discard.action")}
          </button>
        ) : null}
        {version.status === "published" && !version.isNewestPublished && canPublish ? (
          <button type="button" className="button button--secondary" onClick={onRollback} disabled={runner.busy}>
            {t("studio.rollback.action")}
          </button>
        ) : null}
      </div>
      {open && canPublish ? <p className="small muted">{t("studio.publish.hint")}</p> : null}
    </Section>
  );
}

/** The findings of a check run's report: its `findings` / `messages` list when present, else its result only. */
function CheckFindings({ report }: { report: Record<string, unknown> | undefined }) {
  const { t } = useTranslation();
  if (!report) return <span className="muted">{t("common.value.none")}</span>;
  const list = (report["findings"] ?? report["items"] ?? report["messages"]) as unknown;
  if (!Array.isArray(list) || list.length === 0) return <span className="muted">{t("studio.check.noFindings")}</span>;
  return (
    <ul className="plain-list small">
      {list.slice(0, 10).map((f, i) => (
        <li key={i}>
          <bdi dir="ltr">{summarize(f)}</bdi>
        </li>
      ))}
      {list.length > 10 ? <li>{t("studio.check.more", { n: list.length - 10 })}</li> : null}
    </ul>
  );
}

function summarize(f: unknown): string {
  if (typeof f === "string") return f;
  if (f && typeof f === "object") {
    const o = f as Record<string, unknown>;
    return [o["result"], o["code"], o["elementType"], o["stableKey"], o["message"]]
      .filter((x) => typeof x === "string")
      .join(" · ");
  }
  return String(f);
}

function DiffSection({ version }: { version: ConfigVersion }) {
  const { t } = useTranslation();
  const diff = useVersionDiff(version.basedOnVersionId ? version.id : undefined);
  if (!version.basedOnVersionId)
    return (
      <Section id="diff" title={t("studio.diff.title")}>
        <p className="muted">{t("studio.diff.noBase")}</p>
      </Section>
    );
  return (
    <Section id="diff" title={t("studio.diff.title")} intro={t("studio.diff.intro")}>
      <QueryState
        query={diff}
        isEmpty={(d) => d.entries.length === 0 && !d.titleChanged && !d.definitionChanged}
        empty={<EmptyState title={t("studio.diff.empty")} />}
      >
        {(d) => (
          <div className="table-wrap">
            <table className="table" data-table="diff">
              <caption>{t("studio.diff.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("studio.diff.element")}</th>
                  <th scope="col">{t("studio.diff.change")}</th>
                  <th scope="col">{t("studio.diff.field")}</th>
                  <th scope="col">{t("studio.diff.before")}</th>
                  <th scope="col">{t("studio.diff.after")}</th>
                </tr>
              </thead>
              <tbody>
                {d.entries.flatMap((e) => {
                  const rows = e.fields.length > 0 ? e.fields : [{ field: "", from: undefined, to: undefined }];
                  return rows.map((f, i) => (
                    <tr key={`${e.elementType}/${e.stableKey}/${f.field}/${i}`} data-diff={e.change}>
                      <th scope="row">
                        {t(`studio.elementType.${e.elementType}`, { defaultValue: e.elementType })}{" "}
                        <bdi dir="ltr" className="code">
                          {e.stableKey}
                        </bdi>
                      </th>
                      <td>{t(`studio.diff.kind.${e.change}`)}</td>
                      <td>
                        <bdi dir="ltr">{f.field}</bdi>
                      </td>
                      <td>
                        <TextCell value={displayValue(f.from)} />
                      </td>
                      <td>
                        <TextCell value={displayValue(f.to)} />
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </Section>
  );
}

function AffectedSection({ version }: { version: ConfigVersion }) {
  const { t } = useTranslation();
  const affected = useAffectedRecords(version.id);
  return (
    <Section id="affected" title={t("studio.affected.title")} intro={t("studio.affected.intro")}>
      <QueryState
        query={affected}
        isEmpty={(a) => a.transformations.length === 0}
        empty={<EmptyState title={t("studio.affected.empty")} />}
      >
        {(a) => (
          <div className="table-wrap">
            <table className="table" data-table="affected">
              <caption className="visually-hidden">{t("studio.affected.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("studio.affected.transformation")}</th>
                  <th scope="col">{t("studio.affected.recordType")}</th>
                  <th scope="col">{t("studio.affected.count")}</th>
                </tr>
              </thead>
              <tbody>
                {a.transformations.flatMap((tr) =>
                  (tr.records.length > 0 ? tr.records : [null]).map((r, i) => (
                    <tr key={`${tr.transformationId}/${r?.recordType ?? i}`}>
                      <th scope="row">
                        <Link className="link" to={`/transformations/${tr.transformationId}/config-pins`}>
                          <bdi dir="ltr">{tr.code}</bdi>
                        </Link>
                      </th>
                      <td>{r ? <bdi dir="ltr">{r.recordType}</bdi> : t("common.value.none")}</td>
                      <td>
                        {r === null ? (
                          <span className="muted">{t("common.value.none")}</span>
                        ) : r.count === null ? (
                          <Unknown {...(r.unknownReason ? { hint: r.unknownReason } : {})} />
                        ) : (
                          r.count
                        )}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </Section>
  );
}

function ReviewsSection({ version, runner }: { version: ConfigVersion; runner: ReturnType<typeof useActionRunner> }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const reviews = useReviews(version.id);
  const names = useUserNames((reviews.data ?? []).flatMap((r) => [r.requestedBy, r.decidedBy]));
  return (
    <Section id="reviews" title={t("studio.reviews.title")}>
      <QueryState
        query={reviews}
        isEmpty={(rows) => rows.length === 0}
        empty={<EmptyState title={t("studio.reviews.empty")} />}
      >
        {(rows) => (
          <div className="table-wrap">
            <table className="table" data-table="reviews">
              <caption className="visually-hidden">{t("studio.reviews.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("studio.reviews.requestedAt")}</th>
                  <th scope="col">{t("studio.reviews.status")}</th>
                  <th scope="col">{t("studio.reviews.reviewerRole")}</th>
                  <th scope="col">{t("studio.reviews.requestedBy")}</th>
                  <th scope="col">{t("studio.reviews.decidedBy")}</th>
                  <th scope="col">{t("studio.elements.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-review={r.status}>
                    <th scope="row">
                      <Link className="link" to={`/admin/studio/versions/${version.id}/reviews/${r.id}`}>
                        {formatDateTime(r.requestedAt, locale)}
                      </Link>
                    </th>
                    <td>{t(`studio.reviewStatus.${r.status}`)}</td>
                    <td>
                      <bdi dir="ltr">{r.reviewerRoleCode}</bdi>
                    </td>
                    <td>{names(r.requestedBy)}</td>
                    <td>
                      {r.decidedBy ? names(r.decidedBy) : <span className="muted">{t("common.value.none")}</span>}
                    </td>
                    <td>
                      {r.status === "pending" && r.requestedBy === me.user.id ? (
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          disabled={runner.busy}
                          onClick={() =>
                            void runner.run(p5Paths.withdrawConfigReview(version.id, r.id), { ifMatch: r.version })
                          }
                        >
                          {t("studio.review.withdraw")}
                        </button>
                      ) : r.status === "pending" ? (
                        <Link className="link" to={`/admin/studio/versions/${version.id}/reviews/${r.id}`}>
                          {t("studio.review.open")}
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </Section>
  );
}
