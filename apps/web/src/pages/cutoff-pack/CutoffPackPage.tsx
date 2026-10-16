// A meeting's cut-off pack (T-DG5-FE-D; REQ-S12-015; ADR-0044 §6; D-155): when the meeting's agenda cut-off is reached,
// the daily scan generates ONE draft agenda from current data — one draft item per open executive ask — and its pack.
// The pack is a draft: none of its items can be published until the meeting's chair or secretary has reviewed it
// (422 agenda_item.pack_not_reviewed); with neither assigned, the pack says "No reviewer assigned". Publishing stays
// the DG4 per-item publish on the meeting page. A review is a human action; no job reviews a pack.
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { DueDate, useUserNames } from "../my-work/p4ui.tsx";
import { fedPaths, useCutoffPack, useFedRefresh, type MeetingCutoffPack } from "../automation/api.ts";
import { Chip, NoteForm, useRunner } from "../automation/ui.tsx";

export function CutoffPackPage() {
  const { t } = useTranslation();
  const { id = "", meetingId } = useParams();
  usePageTitle(t("workflowsP5.cutoff.title"));
  const pack = useCutoffPack(id, meetingId);
  const notYet = pack.isError && pack.error instanceof ApiError && pack.error.status === 404;
  return (
    <div className="page" data-p5-screen="cutoff-pack">
      <PageHeader
        title={t("workflowsP5.cutoff.title")}
        subtitle={t("workflowsP5.cutoff.intro")}
        crumbs={[
          { label: t("workflowsP5.cutoff.meeting"), to: `/transformations/${id}/meetings/${meetingId ?? ""}` },
          { label: t("workflowsP5.cutoff.title") },
        ]}
      />
      {notYet ? (
        <EmptyState title={t("workflowsP5.cutoff.none")} body={t("workflowsP5.cutoff.noneBody")} />
      ) : (
        <QueryState query={pack}>{(p) => <PackView tid={id} pack={p} />}</QueryState>
      )}
    </div>
  );
}

function PackView({ tid, pack: p }: { tid: string; pack: MeetingCutoffPack }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useFedRefresh();
  const runner = useRunner(refresh);
  const names = useUserNames([p.reviewedBy, ...p.openAsks.map((a) => a.ownerUserId)]);
  const mayReview = canAnywhere(me, "meeting.chair") || canAnywhere(me, "meeting.prepare");
  return (
    <>
      <section className="card" aria-labelledby="pack-facts" data-pack-status={p.status}>
        <h2 id="pack-facts" className="card__title">
          {p.status === "draft" ? (
            <Chip tone="draft" icon="pencil" label={t("workflowsP5.cutoff.status.draft")} data="draft" />
          ) : (
            <Chip tone="good" icon="check" label={t("workflowsP5.cutoff.status.reviewed")} data="reviewed" />
          )}
        </h2>
        <dl className="workspace-header__grid">
          <dt>{t("workflowsP5.cutoff.cutoffDate")}</dt>
          <dd>{formatBusinessDate(p.cutoffDate, locale)}</dd>
          <dt>{t("workflowsP5.cutoff.asOf")}</dt>
          <dd>{formatDateTime(p.asOf, locale)}</dd>
          <dt>{t("workflowsP5.cutoff.reviewer")}</dt>
          <dd data-reviewer-assigned={String(p.reviewerAssigned)}>
            {p.reviewerAssigned ? t("workflowsP5.cutoff.reviewerAssigned") : t("workflowsP5.cutoff.noReviewer")}
          </dd>
          {p.reviewedAt ? (
            <>
              <dt>{t("workflowsP5.cutoff.reviewedBy")}</dt>
              <dd>
                {names(p.reviewedBy)} · {formatDateTime(p.reviewedAt, locale)}
                {p.reviewNote ? <span className="block small">{p.reviewNote}</span> : null}
              </dd>
            </>
          ) : null}
        </dl>
        {p.status === "draft" ? (
          <p className="banner banner--info" role="note" data-state="not-reviewed">
            {t("workflowsP5.cutoff.notPublishable")}
          </p>
        ) : null}
      </section>
      <Section
        id="draft-agenda"
        title={t("workflowsP5.cutoff.agendaTitle")}
        intro={t("workflowsP5.cutoff.agendaIntro")}
      >
        {p.openAsks.length === 0 ? (
          <p className="muted">{t("workflowsP5.cutoff.noAsks")}</p>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("workflowsP5.cutoff.agendaTitle")}>
            <table className="table" data-table="cutoff-asks">
              <caption className="visually-hidden">{t("workflowsP5.cutoff.agendaTitle")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("workflowsP5.cutoff.ask")}</th>
                  <th scope="col">{t("workflowsP5.field.status")}</th>
                  <th scope="col">{t("workflowsP5.conditions.owner")}</th>
                  <th scope="col">{t("workflowsP5.procedures.dueDate")}</th>
                  <th scope="col">{t("workflowsP5.cutoff.agendaItem")}</th>
                </tr>
              </thead>
              <tbody>
                {p.openAsks.map((a) => (
                  <tr key={a.decisionId} data-ask={a.code}>
                    <th scope="row">
                      <Link className="link" to={`/transformations/${tid}/executive-decisions/${a.decisionId}`}>
                        {a.title}
                      </Link>
                      <span className="block small muted">
                        <bdi dir="ltr">{a.code}</bdi>
                      </span>
                    </th>
                    <td>{t(`workflowsP5.cutoff.askStatus.${a.status}`)}</td>
                    <td>{names(a.ownerUserId)}</td>
                    <td>
                      <DueDate date={a.dueDate} />
                    </td>
                    <td data-agenda-item={a.agendaItemId ?? ""}>
                      {a.agendaItemId ? t("workflowsP5.cutoff.draftItem") : t("workflowsP5.cutoff.noRoom")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {p.status === "draft" && mayReview ? (
        <Section
          id="review-pack"
          title={t("workflowsP5.cutoff.reviewTitle")}
          intro={t("workflowsP5.cutoff.reviewIntro")}
        >
          {runner.alert}
          <NoteForm
            id="review-pack"
            label={t("workflowsP5.field.note")}
            submitLabel={t("workflowsP5.cutoff.review")}
            required={false}
            min={3}
            max={2000}
            busy={runner.busy}
            onSubmit={(note) =>
              void runner.run(fedPaths.reviewCutoffPack(tid, p.meetingId), {
                body: note ? { note } : {},
                ifMatch: p.version,
              })
            }
          />
        </Section>
      ) : null}
    </>
  );
}
