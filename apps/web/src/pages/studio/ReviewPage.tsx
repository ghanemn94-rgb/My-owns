// One configuration review request (T-DG5-FE-B; REQ-S06-007, REQ-S12-018; ADR-0039 §7): the reviewer of the configured
// role (the `config_review` work item opens here) approves or requests changes with a note; the requester may not
// decide its own request (403 config_review.self_review, shown translated). A configuration review is not a business
// approval: it grants and records no G1-G6 decision, and it is not an engineering delivery gate.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { p5Paths, useConfigVersion, useStudioRefresh } from "../../api/p5.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { TextCell } from "../../components/Section.tsx";
import { NoPermissionState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { P4FormDialog, ReadOnlyNote, textOf, useUserNames } from "../my-work/p4ui.tsx";
import { STUDIO_NS, useReviews, versionState, type ConfigReviewRequest, type ConfigVersion } from "./api.ts";
import { ConfigurationNote, VersionStateChip } from "./ui.tsx";

export function ReviewPage() {
  const { versionId = "", reviewId = "" } = useParams();
  const { t } = useTranslation();
  usePageTitle(t("studio.review.pageTitle"));
  const version = useConfigVersion(versionId);
  const reviews = useReviews(versionId);
  return (
    <div className="page" data-p5-screen="studio-review">
      <QueryState query={version}>
        {(v) => (
          <QueryState query={reviews}>
            {(rows) => {
              const review = rows.find((r) => r.id === reviewId);
              return review ? <ReviewView version={v} review={review} /> : <NoPermissionState />;
            }}
          </QueryState>
        )}
      </QueryState>
    </div>
  );
}

function ReviewView({ version, review }: { version: ConfigVersion; review: ConfigReviewRequest }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useStudioRefresh();
  const names = useUserNames([review.requestedBy, review.decidedBy]);
  const [deciding, setDeciding] = useState(false);
  const canReview = canAnywhere(me, "methodology.review");
  const own = review.requestedBy === me.user.id;
  const title = locale === "ar" ? version.titleAr : version.titleEn;
  return (
    <>
      <PageHeader
        title={t("studio.review.heading", { title })}
        subtitle={
          <>
            <bdi dir="ltr">v{version.versionNo}</bdi> <VersionStateChip state={versionState(version)} />
          </>
        }
        crumbs={[
          { label: t("nav.p5.studio.title"), to: "/admin/studio" },
          { label: title, to: `/admin/studio/versions/${version.id}` },
          { label: t("studio.review.pageTitle") },
        ]}
        actions={
          review.status === "pending" && canReview ? (
            <button type="button" className="button button--primary" onClick={() => setDeciding(true)}>
              {t("studio.review.decide")}
            </button>
          ) : null
        }
      />
      <ConfigurationNote />
      {review.status === "pending" && own ? <ReadOnlyNote body={t("studio.review.ownRequest")} /> : null}
      {!canReview ? <ReadOnlyNote body={t("studio.readOnly")} /> : null}
      <section className="card" aria-labelledby="review-details">
        <h2 id="review-details" className="card__title">
          {t("studio.review.details")}
        </h2>
        <dl className="details">
          <div>
            <dt>{t("studio.reviews.status")}</dt>
            <dd data-review-status={review.status}>{t(`studio.reviewStatus.${review.status}`)}</dd>
          </div>
          <div>
            <dt>{t("studio.reviews.reviewerRole")}</dt>
            <dd>
              <bdi dir="ltr">{review.reviewerRoleCode}</bdi>
            </dd>
          </div>
          <div>
            <dt>{t("studio.reviews.requestedBy")}</dt>
            <dd>
              {names(review.requestedBy)} · {formatDateTime(review.requestedAt, locale)}
            </dd>
          </div>
          <div>
            <dt>{t("studio.review.note")}</dt>
            <dd>
              <TextCell value={review.requestNote} />
            </dd>
          </div>
          <div>
            <dt>{t("studio.reviews.decidedBy")}</dt>
            <dd>
              {review.decidedBy && review.decidedAt ? (
                `${names(review.decidedBy)} · ${formatDateTime(review.decidedAt, locale)}`
              ) : (
                <span className="muted">{t("common.value.none")}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("studio.review.decisionNote")}</dt>
            <dd>
              <TextCell value={review.decisionNote} />
            </dd>
          </div>
          <div>
            <dt>{t("studio.field.contentHash")}</dt>
            <dd>
              <bdi dir="ltr" className="code">
                {review.contentSha256.slice(0, 12)}
              </bdi>
            </dd>
          </div>
        </dl>
        <p>
          <Link className="link" to={`/admin/studio/versions/${version.id}#diff`}>
            {t("studio.review.openDiff")}
          </Link>
          {review.revisionProposalId ? (
            <>
              {" · "}
              <Link className="link" to="/admin/studio/revision-proposals">
                {t("studio.review.openProposal")}
              </Link>
            </>
          ) : null}
        </p>
      </section>
      {deciding ? (
        <P4FormDialog
          title={t("studio.review.decide")}
          description={t("studio.review.decideBody")}
          fields={[
            {
              name: "outcome",
              label: t("studio.review.outcome"),
              kind: "select",
              required: true,
              options: [
                { value: "approve", label: t("studio.review.outcomeName.approve") },
                { value: "request_changes", label: t("studio.review.outcomeName.request_changes") },
              ],
            },
            {
              name: "note",
              label: t("studio.review.decisionNote"),
              hint: t("studio.review.noteHint"),
              kind: "textarea",
              max: 4000,
            },
          ]}
          submitLabel={t("studio.review.record")}
          url={p5Paths.decideConfigReview(version.id, review.id)}
          version={review.version}
          namespaces={STUDIO_NS}
          toBody={(v) => {
            if (v["outcome"] === "request_changes" && !textOf(v["note"]))
              return { fieldErrors: { note: "validation.required" } };
            return { outcome: v["outcome"], ...(textOf(v["note"]) ? { note: v["note"] } : {}) };
          }}
          onDone={refresh}
          onClose={() => setDeciding(false)}
        />
      ) : null}
    </>
  );
}
