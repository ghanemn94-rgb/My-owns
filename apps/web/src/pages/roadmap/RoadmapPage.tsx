// Wave Roadmap (T07) screen (T-DG3-FE-B; REQ-PB-050, REQ-S09-006; ADR-0023 §1-§3, §5). Replaces FE-A0's seam stub.
//  - the four source waves verbatim (B0079; the English source text always shown, Arabic marked provisional), with
//    their overlapping planning horizons drawn on one axis (overlap is allowed: horizons, not deadlines);
//  - the TIMELINE, the INITIATIVE TABLE and the WORK BOARD all render the one cache entry ["roadmap", tid]
//    (useRoadmap): moving a milestone (PATCH forecastDate with If-Match) refreshes that entry once and all three follow;
//    a 409 shows the conflict notice and reloads;
//  - approve-date (roadmap.approve; reason required, also explaining a re-approval) and deliverable submit / accept;
//  - schedule flags translated from their codes; Unknown is shown as Unknown, never as "no conflict". There is no
//    critical-path highlighting: P3 has no duration model (ADR-0023 §5).
import type { Deliverable, Initiative, Milestone } from "@mth/shared/schemas";
import { INITIATIVE_STATUSES } from "@mth/shared/schemas";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.ts";
import { useP3Refresh } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Dialog, Field, isBlankText, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Section, SectionNav } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { WorkspaceFrame, useWorkspace } from "../../components/Workspace.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import {
  ConflictNotice,
  FlagList,
  FormAlert,
  TableRegion,
  codeText,
  isVersionConflict,
  p3ErrorMessage,
} from "../prioritization/p3ui.tsx";
import { roadmapUrls, useRoadmap, type RoadmapView, type RoadmapWave } from "./api.ts";

export function RoadmapPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="roadmap"
      title={t("roadmap.title")}
      subtitle={t("roadmap.subtitle")}
      writePermissions={["roadmap.edit", "roadmap.approve", "deliverable.accept", "initiative.edit"]}
    >
      <RoadmapBody />
    </WorkspaceFrame>
  );
}

function RoadmapBody() {
  const { t } = useTranslation();
  const { tid } = useWorkspace();
  const roadmap = useRoadmap(tid);
  const [conflict, setConflict] = useState(false);
  return (
    <>
      <SectionNav
        sections={[
          { id: "waves", title: t("roadmap.waves.title") },
          { id: "timeline", title: t("roadmap.timeline.title") },
          { id: "initiatives", title: t("roadmap.table.title") },
          { id: "board", title: t("roadmap.board.title") },
          { id: "milestones", title: t("roadmap.milestones.title") },
          { id: "deliverables", title: t("roadmap.deliverables.title") },
        ]}
      />
      {conflict ? <ConflictNotice onDismiss={() => setConflict(false)} /> : null}
      <QueryState query={roadmap}>
        {(view) => (
          <>
            <WavesSection waves={view.waves} />
            <TimelineSection view={view} />
            <InitiativeTable view={view} />
            <WorkBoard view={view} />
            <MilestonesSection view={view} onConflict={() => setConflict(true)} />
            <DeliverablesSection view={view} onConflict={() => setConflict(true)} />
          </>
        )}
      </QueryState>
    </>
  );
}

const byOrdinal = (a: RoadmapWave, b: RoadmapWave) => a.ordinal - b.ordinal;

function useWaveText() {
  const locale = useLocale();
  return (w: RoadmapWave, field: "name" | "purpose" | "horizon" | "entryCriteria" | "exitEvidence") =>
    locale === "ar" ? w[`${field}Ar`] : w[`${field}En`];
}

function WavesSection({ waves }: { waves: readonly RoadmapWave[] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const text = useWaveText();
  const active = waves.filter((w) => w.status === "active").sort(byOrdinal);
  return (
    <Section id="waves" title={t("roadmap.waves.title")} intro={t("roadmap.waves.intro")}>
      {locale === "ar" ? (
        <p className="badge badge--provisional" role="note">
          {t("roadmap.waves.provisionalAr")}
        </p>
      ) : null}
      <TableRegion label={t("roadmap.waves.caption")}>
        <table className="table table--compact" data-testid="waves">
          <caption>{t("roadmap.waves.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("roadmap.waves.wave")}</th>
              <th scope="col">{t("roadmap.waves.purpose")}</th>
              <th scope="col">{t("roadmap.waves.horizon")}</th>
              <th scope="col">{t("roadmap.waves.entry")}</th>
              <th scope="col">{t("roadmap.waves.exit")}</th>
            </tr>
          </thead>
          <tbody>
            {active.map((w) => (
              <tr key={w.id} data-wave={w.code}>
                <th scope="row">
                  {text(w, "name")}
                  {locale === "ar" && w.isSourceSeeded ? (
                    <span className="muted" lang="en" dir="ltr">
                      <br />
                      {w.nameEn}
                    </span>
                  ) : null}
                </th>
                <td>{text(w, "purpose")}</td>
                <td>{text(w, "horizon")}</td>
                <td>{text(w, "entryCriteria")}</td>
                <td>{text(w, "exitEvidence")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>
      {active.some((w) => w.isSourceSeeded) ? <p className="muted">{t("roadmap.waves.source")}</p> : null}
    </Section>
  );
}

const dayOf = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** Timeline: the wave horizons (weeks, overlapping) and the milestones placed by forecast (else approved) date. */
function TimelineSection({ view }: { view: RoadmapView }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const text = useWaveText();
  const waves = view.waves.filter((w) => w.status === "active").sort(byOrdinal);
  const maxWeeks = Math.max(1, ...waves.map((w) => w.horizonToWeeks));
  const codeOf = new Map(view.initiatives.map((i) => [i.id, i.code]));
  const dated = view.milestones
    .filter((m) => m.status !== "cancelled")
    .map((m) => ({ m, date: m.forecastDate ?? m.approvedDate }))
    .filter((x): x is { m: Milestone; date: string } => x.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const undated = view.milestones.filter((m) => m.status !== "cancelled" && !m.forecastDate && !m.approvedDate);
  const first = dated.length ? dayOf(dated[0]!.date) : 0;
  const last = dated.length ? dayOf(dated[dated.length - 1]!.date) : 0;
  const span = Math.max(1, last - first);
  const pct = (d: string) => (dated.length < 2 ? 50 : ((dayOf(d) - first) / span) * 92 + 4);

  return (
    <Section id="timeline" title={t("roadmap.timeline.title")} intro={t("roadmap.timeline.intro")}>
      <h3>{t("roadmap.timeline.horizons")}</h3>
      <ul className="plain-list" data-testid="wave-horizons" aria-label={t("roadmap.timeline.horizons")}>
        {waves.map((w) => (
          <li key={w.id} style={{ marginBlockEnd: "0.5rem" }}>
            <div>
              <strong>{text(w, "name")}</strong>{" "}
              <span className="muted">
                {t("roadmap.timeline.weeks", { from: w.horizonFromWeeks, to: w.horizonToWeeks })}
              </span>
            </div>
            <div
              style={{
                position: "relative",
                height: "0.75rem",
                background: "var(--mth-surface-selected)",
                border: "1px solid var(--mth-border-default)",
              }}
              aria-hidden="true"
            >
              <div
                style={{
                  position: "absolute",
                  insetBlock: 0,
                  insetInlineStart: `${(w.horizonFromWeeks / maxWeeks) * 100}%`,
                  width: `${Math.max(1, ((w.horizonToWeeks - w.horizonFromWeeks) / maxWeeks) * 100)}%`,
                  background: "var(--mth-text-secondary)",
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="muted">{t("roadmap.timeline.overlap")}</p>
      <h3>{t("roadmap.timeline.milestones")}</h3>
      {dated.length === 0 ? (
        <p className="muted">{t("roadmap.timeline.noDated")}</p>
      ) : (
        <ol className="plain-list" data-testid="timeline-milestones" aria-label={t("roadmap.timeline.milestones")}>
          {dated.map(({ m, date }) => (
            <li
              key={m.id}
              data-milestone={m.id}
              style={{ position: "relative", paddingBlockStart: "0.9rem", marginBlockEnd: "0.4rem" }}
            >
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  insetBlockStart: "0.1rem",
                  insetInlineStart: `${pct(date)}%`,
                  width: "0.6rem",
                  height: "0.6rem",
                  transform: "rotate(45deg)",
                  background: "var(--mth-text-primary)",
                }}
              />
              <span>
                <bdi dir="ltr" className="code">
                  {codeOf.get(m.initiativeId) ?? "—"}
                </bdi>{" "}
                <bdi>{m.title}</bdi> · <bdi data-testid="timeline-date">{formatBusinessDate(date, locale)}</bdi>
                {m.forecastDate ? null : <span className="muted"> ({t("roadmap.milestones.approvedOnly")})</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {undated.length > 0 ? (
        <p>
          <Unknown /> {t("roadmap.timeline.undated", { titles: undated.map((m) => m.title).join(", ") })}
        </p>
      ) : null}
    </Section>
  );
}

function waveName(view: RoadmapView, waveId: string | null, text: ReturnType<typeof useWaveText>, none: string) {
  const w = view.waves.find((x) => x.id === waveId);
  return w ? text(w, "name") : none;
}

/** The latest forecast (else approved) date of an initiative's non-cancelled milestones, or null (Unknown). */
function nextMilestone(view: RoadmapView, ini: Initiative): Milestone | null {
  const ms = view.milestones
    .filter((m) => m.initiativeId === ini.id && m.status === "planned" && (m.forecastDate ?? m.approvedDate))
    .sort((a, b) => (a.forecastDate ?? a.approvedDate)!.localeCompare((b.forecastDate ?? b.approvedDate)!));
  return ms[0] ?? null;
}

function InitiativeTable({ view }: { view: RoadmapView }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const text = useWaveText();
  const date = (d: string | null) => (d ? formatBusinessDate(d, locale) : null);
  return (
    <Section id="initiatives" title={t("roadmap.table.title")} intro={t("roadmap.table.intro")}>
      {view.initiatives.length === 0 ? (
        <EmptyState title={t("roadmap.table.emptyTitle")} body={t("roadmap.table.emptyBody")} />
      ) : (
        <TableRegion label={t("roadmap.table.caption")}>
          <table className="table table--compact" data-testid="roadmap-table">
            <caption>{t("roadmap.table.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("roadmap.table.initiative")}</th>
                <th scope="col">{t("roadmap.table.status")}</th>
                <th scope="col">{t("roadmap.table.wave")}</th>
                <th scope="col">{t("roadmap.table.plannedStart")}</th>
                <th scope="col">{t("roadmap.table.plannedEnd")}</th>
                <th scope="col">{t("roadmap.table.nextMilestone")}</th>
                <th scope="col">{t("roadmap.table.flags")}</th>
              </tr>
            </thead>
            <tbody>
              {view.initiatives.map((i) => {
                const next = nextMilestone(view, i);
                return (
                  <tr key={i.id} data-initiative={i.code}>
                    <th scope="row">
                      <bdi dir="ltr" className="code">
                        {i.code}
                      </bdi>{" "}
                      {i.name}
                    </th>
                    <td>{t(`prioritization.status.${i.status}`)}</td>
                    <td>{waveName(view, i.waveId, text, t("roadmap.table.noWave"))}</td>
                    <td>{date(i.plannedStart) ?? <Unknown />}</td>
                    <td>{date(i.plannedEnd) ?? <Unknown />}</td>
                    <td data-testid="table-next-milestone">
                      {next ? (
                        <>
                          <bdi>{next.title}</bdi> · <bdi>{date(next.forecastDate ?? next.approvedDate)}</bdi>
                        </>
                      ) : (
                        <Unknown />
                      )}
                    </td>
                    <td>
                      <FlagList flags={i.flags} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableRegion>
      )}
    </Section>
  );
}

function WorkBoard({ view }: { view: RoadmapView }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const text = useWaveText();
  return (
    <Section id="board" title={t("roadmap.board.title")} intro={t("roadmap.board.intro")}>
      <div className="grid grid--3" data-testid="work-board">
        {INITIATIVE_STATUSES.map((s) => {
          const cards = view.initiatives.filter((i) => i.status === s);
          return (
            <section key={s} className="card" aria-labelledby={`board-${s}`} data-column={s}>
              <h3 id={`board-${s}`} className="card__title">
                {t(`prioritization.status.${s}`)} <span className="muted">({cards.length})</span>
              </h3>
              {cards.length === 0 ? (
                <p className="muted">{t("roadmap.board.emptyColumn")}</p>
              ) : (
                <ul className="plain-list">
                  {cards.map((i) => {
                    const next = nextMilestone(view, i);
                    return (
                      <li key={i.id} className="card" data-card={i.code}>
                        <p>
                          <bdi dir="ltr" className="code">
                            {i.code}
                          </bdi>{" "}
                          <strong>{i.name}</strong>
                        </p>
                        <p className="muted">{waveName(view, i.waveId, text, t("roadmap.table.noWave"))}</p>
                        <p data-testid="board-next-milestone">
                          {t("roadmap.table.nextMilestone")}:{" "}
                          {next ? (
                            <bdi>{formatBusinessDate(next.forecastDate ?? next.approvedDate, locale)}</bdi>
                          ) : (
                            <Unknown />
                          )}
                        </p>
                        <FlagList flags={i.flags} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </Section>
  );
}

function MilestonesSection({ view, onConflict }: { view: RoadmapView; onConflict: () => void }) {
  const { t } = useTranslation();
  const { tid, can } = useWorkspace();
  const locale = useLocale();
  const refresh = useP3Refresh(tid);
  const [moving, setMoving] = useState<Milestone | null>(null);
  const [approving, setApproving] = useState<Milestone | null>(null);
  const codeOf = new Map(view.initiatives.map((i) => [i.id, i.code]));
  const date = (d: string | null) => (d ? formatBusinessDate(d, locale) : null);
  const canMove = can("roadmap.edit") || can("initiative.edit");
  const canApprove = can("roadmap.approve");
  const conflictThenReload = async () => {
    setMoving(null);
    setApproving(null);
    onConflict();
    await refresh();
  };
  return (
    <Section id="milestones" title={t("roadmap.milestones.title")} intro={t("roadmap.milestones.intro")}>
      {view.milestones.length === 0 ? (
        <p className="muted">{t("roadmap.milestones.empty")}</p>
      ) : (
        <TableRegion label={t("roadmap.milestones.caption")}>
          <table className="table table--compact" data-testid="milestones">
            <caption>{t("roadmap.milestones.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("roadmap.milestones.milestone")}</th>
                <th scope="col">{t("roadmap.table.initiative")}</th>
                <th scope="col">{t("roadmap.milestones.approved")}</th>
                <th scope="col">{t("roadmap.milestones.forecast")}</th>
                <th scope="col">{t("roadmap.milestones.variance")}</th>
                <th scope="col">{t("roadmap.milestones.status")}</th>
                <th scope="col">{t("roadmap.milestones.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {view.milestones.map((m) => (
                <tr key={m.id} data-milestone-row={m.title}>
                  <th scope="row">{m.title}</th>
                  <td>
                    <bdi dir="ltr" className="code">
                      {codeOf.get(m.initiativeId) ?? "—"}
                    </bdi>
                  </td>
                  <td>
                    {m.approvedDate ? (
                      <bdi>{date(m.approvedDate)}</bdi>
                    ) : (
                      <span className="muted">{t("roadmap.milestones.notApproved")}</span>
                    )}
                  </td>
                  <td data-testid="milestone-forecast">
                    {m.forecastDate ? <bdi>{date(m.forecastDate)}</bdi> : <Unknown />}
                  </td>
                  <td>
                    {m.varianceDays === null ? (
                      <Unknown />
                    ) : (
                      <bdi>{t("roadmap.milestones.varianceDays", { days: m.varianceDays })}</bdi>
                    )}
                  </td>
                  <td>{t(`roadmap.milestones.state.${m.status}`)}</td>
                  <td>
                    <div className="toolbar">
                      {canMove && m.status !== "cancelled" ? (
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          onClick={() => setMoving(m)}
                        >
                          {t("roadmap.milestones.move", { title: m.title })}
                        </button>
                      ) : null}
                      {canApprove && m.status !== "cancelled" ? (
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          onClick={() => setApproving(m)}
                        >
                          {m.approvedDate
                            ? t("roadmap.milestones.reapprove", { title: m.title })
                            : t("roadmap.milestones.approveDate", { title: m.title })}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}
      <p className="muted">{t("roadmap.milestones.calendarDays")}</p>
      {moving ? (
        <MilestoneDialog
          milestone={moving}
          mode="move"
          onClose={() => setMoving(null)}
          onConflict={conflictThenReload}
          onDone={async () => {
            if (!(await refresh())) return;
            setMoving(null);
          }}
        />
      ) : null}
      {approving ? (
        <MilestoneDialog
          milestone={approving}
          mode="approve"
          onClose={() => setApproving(null)}
          onConflict={conflictThenReload}
          onDone={async () => {
            if (!(await refresh())) return;
            setApproving(null);
          }}
        />
      ) : null}
    </Section>
  );
}

function MilestoneDialog({
  milestone,
  mode,
  onClose,
  onDone,
  onConflict,
}: {
  milestone: Milestone;
  mode: "move" | "approve";
  onClose: () => void;
  onDone: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [date, setDate] = useState(
    mode === "move" ? (milestone.forecastDate ?? "") : (milestone.forecastDate ?? milestone.approvedDate ?? ""),
  );
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(ref);
  const reapproval = mode === "approve" && milestone.approvedDate !== null;

  const submit = async () => {
    setServerError(null);
    const errs: Record<string, string> = {};
    if (date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errs["date"] = "validation.format";
    if (mode === "approve" && date === "") errs["date"] = "validation.required";
    if (mode === "approve") {
      if (reason === "") errs["reason"] = "validation.required";
      else if (isBlankText(reason)) errs["reason"] = "validation.blank";
      else if ([...reason.trim()].length < 3) errs["reason"] = "validation.too_small";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      if (mode === "move") {
        await api.send(roadmapUrls.milestone(milestone.id), {
          method: "PATCH",
          body: { forecastDate: date === "" ? null : date },
          ifMatch: milestone.version,
        });
      } else {
        await api.send(roadmapUrls.approveDate(milestone.id), {
          method: "POST",
          body: { approvedDate: date, reason },
          ifMatch: milestone.version,
        });
      }
      if (action.stale()) return;
      await onDone();
    } catch (e) {
      if (action.stale(e)) return;
      if (isVersionConflict(e)) {
        await onConflict();
        return;
      }
      setServerError(e);
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === "move"
      ? t("roadmap.milestones.moveTitle", { title: milestone.title })
      : reapproval
        ? t("roadmap.milestones.reapproveTitle", { title: milestone.title })
        : t("roadmap.milestones.approveTitle", { title: milestone.title });
  const err = (k: string) => (errors[k] ? (codeText(t, errors[k]!) ?? undefined) : undefined);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      dialogRef={ref}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy}>
            {busy
              ? t("common.state.saving")
              : mode === "move"
                ? t("roadmap.milestones.moveConfirm")
                : t("roadmap.milestones.approveConfirm")}
          </button>
        </>
      }
    >
      <p>{mode === "move" ? t("roadmap.milestones.moveBody") : t("roadmap.milestones.approveBody")}</p>
      <FormAlert message={serverError ? p3ErrorMessage(t, serverError) : null} />
      <Field
        label={mode === "move" ? t("roadmap.milestones.forecast") : t("roadmap.milestones.approved")}
        error={err("date")}
        required={mode === "approve"}
      >
        {(control) => <input {...control} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
      {mode === "approve" ? (
        <Field
          label={t("common.form.reason")}
          hint={reapproval ? t("roadmap.milestones.reapproveHint") : t("roadmap.milestones.reasonHint")}
          error={err("reason")}
          required
        >
          {(control) => (
            <textarea
              {...control}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
            />
          )}
        </Field>
      ) : null}
    </Dialog>
  );
}

function DeliverablesSection({ view, onConflict }: { view: RoadmapView; onConflict: () => void }) {
  const { t } = useTranslation();
  const { tid, can, meId } = useWorkspace();
  const locale = useLocale();
  const refresh = useP3Refresh(tid);
  const [deciding, setDeciding] = useState<Deliverable | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const codeOf = new Map(view.initiatives.map((i) => [i.id, i.code]));
  const active = view.deliverables.filter((d) => d.status === "active");

  const submitDeliverable = async (d: Deliverable) => {
    setSubmitError(null);
    const action = beginSessionGuard();
    try {
      await api.send(roadmapUrls.submitDeliverable(d.id), { method: "POST", body: {}, ifMatch: d.version });
      if (action.stale()) return;
      await refresh();
    } catch (e) {
      if (action.stale(e)) return;
      if (isVersionConflict(e)) {
        onConflict();
        await refresh();
        return;
      }
      setSubmitError(e);
    }
  };

  return (
    <Section id="deliverables" title={t("roadmap.deliverables.title")} intro={t("roadmap.deliverables.intro")}>
      <FormAlert message={submitError ? p3ErrorMessage(t, submitError) : null} />
      {active.length === 0 ? (
        <p className="muted">{t("roadmap.deliverables.empty")}</p>
      ) : (
        <TableRegion label={t("roadmap.deliverables.caption")}>
          <table className="table table--compact" data-testid="deliverables">
            <caption>{t("roadmap.deliverables.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("roadmap.deliverables.deliverable")}</th>
                <th scope="col">{t("roadmap.table.initiative")}</th>
                <th scope="col">{t("roadmap.deliverables.due")}</th>
                <th scope="col">{t("roadmap.deliverables.acceptance")}</th>
                <th scope="col">{t("roadmap.milestones.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {active.map((d) => (
                <tr key={d.id} data-deliverable={d.title}>
                  <th scope="row">{d.title}</th>
                  <td>
                    <bdi dir="ltr" className="code">
                      {codeOf.get(d.initiativeId) ?? "—"}
                    </bdi>
                  </td>
                  <td>{d.dueDate ? formatBusinessDate(d.dueDate, locale) : <Unknown />}</td>
                  <td>
                    <span className="status-chip" data-acceptance={d.acceptanceStatus}>
                      <Icon
                        name={
                          d.acceptanceStatus === "accepted"
                            ? "check"
                            : d.acceptanceStatus === "rejected"
                              ? "cross"
                              : "clock"
                        }
                      />{" "}
                      {t(`roadmap.deliverables.state.${d.acceptanceStatus}`)}
                    </span>
                  </td>
                  <td>
                    <div className="toolbar">
                      {can("initiative.edit") &&
                      (d.acceptanceStatus === "pending" || d.acceptanceStatus === "rejected") ? (
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          onClick={() => void submitDeliverable(d)}
                        >
                          {t("roadmap.deliverables.submit", { title: d.title })}
                        </button>
                      ) : null}
                      {can("deliverable.accept") && d.acceptanceStatus === "submitted" ? (
                        d.submittedBy === meId ? (
                          <span className="muted">{t("roadmap.deliverables.ownSubmission")}</span>
                        ) : (
                          <button
                            type="button"
                            className="button button--primary button--small"
                            onClick={() => setDeciding(d)}
                          >
                            {t("roadmap.deliverables.decide", { title: d.title })}
                          </button>
                        )
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}
      {deciding ? (
        <DecideDeliverableDialog
          deliverable={deciding}
          onClose={() => setDeciding(null)}
          onConflict={async () => {
            setDeciding(null);
            onConflict();
            await refresh();
          }}
          onDone={async () => {
            if (!(await refresh())) return;
            setDeciding(null);
          }}
        />
      ) : null}
    </Section>
  );
}

function DecideDeliverableDialog({
  deliverable,
  onClose,
  onDone,
  onConflict,
}: {
  deliverable: Deliverable;
  onClose: () => void;
  onDone: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [result, setResult] = useState<"accepted" | "rejected" | "">("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(ref);
  const submit = async () => {
    setServerError(null);
    const errs: Record<string, string> = {};
    if (!result) errs["result"] = "validation.required";
    if (isBlankText(note)) errs["note"] = "validation.blank";
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(roadmapUrls.decideDeliverable(deliverable.id), {
        method: "POST",
        body: note ? { result, note } : { result },
        ifMatch: deliverable.version,
      });
      if (action.stale()) return;
      await onDone();
    } catch (e) {
      if (action.stale(e)) return;
      if (isVersionConflict(e)) {
        await onConflict();
        return;
      }
      setServerError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t("roadmap.deliverables.decideTitle", { title: deliverable.title })}
      onClose={onClose}
      dialogRef={ref}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? t("common.state.saving") : t("roadmap.deliverables.decideConfirm")}
          </button>
        </>
      }
    >
      <p>{t("roadmap.deliverables.decideBody")}</p>
      <FormAlert message={serverError ? p3ErrorMessage(t, serverError) : null} />
      <fieldset className="fieldset">
        <legend>{t("roadmap.deliverables.outcome")}</legend>
        {(["accepted", "rejected"] as const).map((r) => (
          <label key={r} className="checkbox">
            <input
              type="radio"
              name="deliverable-result"
              checked={result === r}
              aria-invalid={errors["result"] ? true : undefined}
              onChange={() => setResult(r)}
            />
            {t(`roadmap.deliverables.result.${r}`)}
          </label>
        ))}
        {errors["result"] ? <p className="field__error">{codeText(t, errors["result"])}</p> : null}
      </fieldset>
      <Field
        label={t("prioritization.shared.noteOptional")}
        error={errors["note"] ? (codeText(t, errors["note"]) ?? undefined) : undefined}
      >
        {(control) => (
          <textarea {...control} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        )}
      </Field>
    </Dialog>
  );
}
