// Governance > Meeting workspace (T-DG4-FE-D; p4-work-split §D.5; ADR-0032 §3-§5, §8). SYNTHETIC data only.
// The committee workflow on one meeting record (REQ-S10-011): agenda with executive-ask briefs (the seven elements and
// the missing-element list, REQ-S10-012, REQ-PB-068), attendance and quorum (decisions are refused below quorum),
// outputs linked to canonical records (REQ-PB-061), minutes draft → approved → published (read-only after
// publication), meeting actions with overdue flags, and the blocker RAG per cycle (REQ-PB-082).
//  - Recording a decided Outcome is a **business decision** of the decision owner (or the owner's active delegate),
//    never an engineering delivery gate; the server re-checks owner, quorum and session state.
//  - `/transformations/:id/meetings/:meetingId` is the work-item link of `minutes_to_approve` and `meeting_action_due`.
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import {
  AGENDA_ASK_ELEMENTS,
  AGENDA_ITEM_KINDS,
  BLOCKER_RECORD_TYPES,
  MEETING_OUTPUT_RECORD_TYPES,
} from "@mth/shared/schemas";
import { useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { ActionsTable, EditActionDialog } from "../actions/ActionsPage.tsx";
import { useForumName } from "../forums/ForumsPage.tsx";
import { DueDate, P4FormDialog, ReadOnlyNote, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import { useRaidEntries, type RaidAction } from "../raid/api.ts";
import {
  govPaths,
  useAgendaItems,
  useAttendance,
  useBlockerStatuses,
  useExecutiveDecisions,
  useForum,
  useMeeting,
  useMeetingActions,
  useMeetingOutputs,
  useMinutes,
  type AgendaItem,
  type Forum,
  type Meeting,
  type MeetingAttendance,
} from "./api.ts";
import {
  BusinessDecisionNote,
  Code,
  GovSubNav,
  MEETING_WRITE_PERMISSIONS,
  MeetingStatusText,
  MinutesStatusText,
  NS,
  QuorumState,
  useActionRunner,
} from "./ui.tsx";

const FROZEN = new Set(["minutes_published", "cancelled"]);

export function MeetingPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="meetings"
      title={t("governanceP4.meeting.title")}
      writePermissions={[...MEETING_WRITE_PERMISSIONS, "executive_decision.decide"]}
    >
      <MeetingBody />
    </WorkspaceFrame>
  );
}

function MeetingBody() {
  const ws = useWorkspace();
  const { meetingId = "" } = useParams();
  const meeting = useMeeting(ws.tid, meetingId);
  return (
    <>
      <GovSubNav tid={ws.tid} />
      <QueryState query={meeting}>{(m) => <MeetingView meeting={m} />}</QueryState>
    </>
  );
}

function MeetingView({ meeting: m }: { meeting: Meeting }) {
  const { t } = useTranslation();
  const forum = useForum(m.transformationId, m.forumId);
  const frozen = FROZEN.has(m.status);
  return (
    <>
      <MeetingHeader meeting={m} forum={forum.data} />
      {frozen ? (
        <ReadOnlyNote
          body={t("governanceP4.meeting.frozen", { status: t(`governanceP4.meetingStatus.${m.status}`) })}
        />
      ) : null}
      <Agenda meeting={m} forum={forum.data} frozen={frozen} />
      <Attendance meeting={m} frozen={frozen} />
      <Outputs meeting={m} forum={forum.data} frozen={frozen} />
      <Minutes meeting={m} />
      <MeetingActions meeting={m} frozen={frozen} />
      <Blockers meeting={m} frozen={frozen} />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ header

function MeetingHeader({ meeting: m, forum }: { meeting: Meeting; forum: Forum | undefined }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const name = useForumName();
  const { byId } = usePeople(ws.tid);
  const runner = useActionRunner(ws.tid);
  const refresh = useP4Refresh(ws.tid);
  const [dialog, setDialog] = useState<"cancel" | "edit" | null>(null);
  const prepare = ws.can("meeting.prepare");
  const isChair = ws.can("meeting.chair") && m.chairUserId === ws.meId;
  return (
    <Section
      id="meeting"
      title={`${name(forum)} · ${formatBusinessDate(m.scheduledDate, locale) ?? ""}`}
      actions={
        <span className="chip-row">
          {m.status === "scheduled" && isChair ? (
            <button
              type="button"
              className="button button--primary"
              disabled={runner.busy !== null}
              onClick={() => void runner.run("publish", govPaths.publishAgenda(ws.tid, m.id), m.version)}
              data-meeting-action="publish-agenda"
            >
              {t("governanceP4.meeting.publishAgenda")}
            </button>
          ) : null}
          {(m.status === "scheduled" || m.status === "agenda_published") && prepare ? (
            <button
              type="button"
              className="button button--secondary"
              disabled={runner.busy !== null}
              onClick={() => void runner.run("start", govPaths.start(ws.tid, m.id), m.version)}
              data-meeting-action="start"
            >
              {t("governanceP4.meeting.start")}
            </button>
          ) : null}
          {m.status === "in_session" && prepare ? (
            <button
              type="button"
              className="button button--secondary"
              disabled={runner.busy !== null}
              onClick={() => void runner.run("close", govPaths.close(ws.tid, m.id), m.version)}
              data-meeting-action="close"
            >
              {t("governanceP4.meeting.close")}
            </button>
          ) : null}
          {(m.status === "scheduled" || m.status === "agenda_published") && prepare ? (
            <>
              <button type="button" className="button button--secondary" onClick={() => setDialog("edit")}>
                <Icon name="pencil" /> {t("governanceP4.meeting.edit")}
              </button>
              <button type="button" className="button button--secondary" onClick={() => setDialog("cancel")}>
                <Icon name="cross" /> {t("governanceP4.meeting.cancel")}
              </button>
            </>
          ) : null}
        </span>
      }
    >
      {runner.alert}
      <dl className="details details--compact" data-meeting-detail={m.id}>
        <div>
          <dt>{t("governanceP4.meetings.status")}</dt>
          <dd>
            <MeetingStatusText status={m.status} />
            {m.cancelReason ? (
              <span className="block small muted">{t(`governanceP4.meeting.cancelReason.${m.cancelReason}`)}</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>{t("governanceP4.meeting.time")}</dt>
          <dd>
            {formatDateTime(m.startsAt, locale, m.timezone)} – {formatDateTime(m.endsAt, locale, m.timezone)}{" "}
            <bdi dir="ltr">({m.timezone})</bdi>
          </dd>
        </div>
        <div>
          <dt>{t("governanceP4.meetings.chair")}</dt>
          <dd>
            {m.chairUserId ? (
              <PersonName id={m.chairUserId} people={byId} />
            ) : (
              <span className="status-chip status-chip--unknown" data-chair="unassigned">
                <Icon name="question" /> {t("governanceP4.meetings.noChair")}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("governanceP4.meetings.quorum")}</dt>
          <dd>
            <QuorumState state={m.quorumState} present={m.presentCount} required={m.quorumMin} />
          </dd>
        </div>
        <div>
          <dt>{t("governanceP4.meetings.cutoff")}</dt>
          <dd>
            <DueDate date={m.cutoffDate} reason={m.cutoffUnknownReason} />
          </dd>
        </div>
        <div>
          <dt>{t("governanceP4.series.location")}</dt>
          <dd>
            <TextCell value={m.location} />
          </dd>
        </div>
      </dl>
      {dialog === "cancel" ? (
        <P4FormDialog
          title={t("governanceP4.meeting.cancel")}
          fields={[
            { name: "reason", label: t("governanceP4.reason"), kind: "textarea", required: true, min: 3, max: 1000 },
          ]}
          submitLabel={t("governanceP4.meeting.cancel")}
          danger
          url={govPaths.cancel(ws.tid, m.id)}
          version={m.version}
          namespaces={NS}
          toBody={(v) => ({ reason: v["reason"] })}
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "edit" ? <EditMeetingDialog meeting={m} onClose={() => setDialog(null)} /> : null}
    </Section>
  );
}

function EditMeetingDialog({ meeting: m, onClose }: { meeting: Meeting; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const initial: P4Values = {
    chairUserId: m.chairUserId ?? "",
    quorumMin: m.quorumMin === null ? "" : String(m.quorumMin),
    location: m.location ?? "",
  };
  return (
    <P4FormDialog
      title={t("governanceP4.meeting.edit")}
      fields={[
        {
          name: "chairUserId",
          label: t("governanceP4.meetings.chair"),
          kind: "select",
          options: people.map((p) => ({ value: p.id, label: p.label })),
        },
        { name: "quorumMin", label: t("governanceP4.forums.field.quorum"), kind: "number", min: 1, max: 100 },
        { name: "location", label: t("governanceP4.series.location"), kind: "text", max: 300 },
      ]}
      initial={initial}
      submitLabel={t("governanceP4.save")}
      method="PATCH"
      url={govPaths.meeting(ws.tid, m.id)}
      version={m.version}
      namespaces={NS}
      toBody={(v) => {
        const body: Record<string, unknown> = {};
        if (v["chairUserId"] !== initial["chairUserId"]) body["chairUserId"] = v["chairUserId"] || null;
        if (v["quorumMin"] !== initial["quorumMin"])
          body["quorumMin"] = v["quorumMin"] === "" ? null : Number(v["quorumMin"]);
        if (v["location"] !== initial["location"]) body["location"] = textOf(v["location"]) ?? null;
        return Object.keys(body).length === 0 ? { fieldErrors: { location: "validation.empty_patch" } } : body;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

// ------------------------------------------------------------------------------------------------ agenda

/** The seven brief fields of an executive ask (ADR-0032 §3.2). */
function briefFields(t: TFunction, people: readonly { value: string; label: string }[]): P4FieldSpec[] {
  return [
    { name: "decisionRequired", label: t("governanceP4.ask.decision_required"), kind: "text", max: 500, when: isAsk },
    { name: "whyNow", label: t("governanceP4.ask.why_now"), kind: "textarea", max: 4000, when: isAsk },
    {
      name: "options",
      label: t("governanceP4.ask.options"),
      kind: "textarea",
      hint: t("governanceP4.ask.optionsHint"),
      when: isAsk,
    },
    {
      name: "recommendation",
      label: t("governanceP4.ask.recommendation"),
      hint: t("governanceP4.ask.recommendationHint"),
      kind: "textarea",
      max: 4000,
      when: isAsk,
    },
    { name: "impactOfDelay", label: t("governanceP4.ask.impact_of_delay"), kind: "textarea", max: 4000, when: isAsk },
    { name: "ownerUserId", label: t("governanceP4.ask.decision_owner"), kind: "select", options: people, when: isAsk },
    { name: "requiredDate", label: t("governanceP4.ask.required_date"), kind: "date", when: isAsk },
  ];
}
const isAsk = (v: P4Values) => v["itemKind"] === "executive_ask";

function briefBody(v: P4Values): Record<string, unknown> | undefined {
  const options =
    typeof v["options"] === "string"
      ? v["options"]
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s !== "")
      : [];
  const brief: Record<string, unknown> = {
    ...(textOf(v["decisionRequired"]) ? { decisionRequired: v["decisionRequired"] } : {}),
    ...(textOf(v["whyNow"]) ? { whyNow: v["whyNow"] } : {}),
    ...(options.length > 0 ? { options } : {}),
    ...(textOf(v["recommendation"]) ? { recommendation: v["recommendation"] } : {}),
    ...(textOf(v["impactOfDelay"]) ? { impactOfDelay: v["impactOfDelay"] } : {}),
    ...(typeof v["ownerUserId"] === "string" && v["ownerUserId"] ? { ownerUserId: v["ownerUserId"] } : {}),
    ...(typeof v["requiredDate"] === "string" && v["requiredDate"] ? { requiredDate: v["requiredDate"] } : {}),
  };
  return Object.keys(brief).length > 0 ? brief : undefined;
}

/** Missing elements of an executive-ask brief, as a labelled list (never colour alone). */
function MissingElements({ item }: { item: AgendaItem }) {
  const { t } = useTranslation();
  if (item.itemKind !== "executive_ask" || item.decisionId) return null;
  if (item.missingElements.length === 0)
    return (
      <span className="status-chip status-chip--on-track" data-missing="none">
        <Icon name="check" /> {t("governanceP4.ask.complete")}
      </span>
    );
  return (
    <span className="block" data-missing={item.missingElements.join(",")}>
      <span className="status-chip status-chip--at-risk status-chip--wrap">
        <Icon name="alert" /> {t("governanceP4.ask.missing", { count: item.missingElements.length })}
      </span>
      <ul className="small">
        {item.missingElements.map((e) => (
          <li key={e}>{t(`governanceP4.ask.${e}`)}</li>
        ))}
      </ul>
    </span>
  );
}

type AgendaDialog =
  | { kind: "create" }
  | { kind: "edit"; item: AgendaItem }
  | { kind: "outcome"; item: AgendaItem }
  | null;

function Agenda({ meeting: m, forum, frozen }: { meeting: Meeting; forum: Forum | undefined; frozen: boolean }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const items = useAgendaItems(ws.tid, m.id);
  const { byId } = usePeople(ws.tid);
  const runner = useActionRunner(ws.tid);
  const [dialog, setDialog] = useState<AgendaDialog>(null);
  const prepare = ws.can("meeting.prepare") && !frozen;
  const isChair = ws.can("meeting.chair") && m.chairUserId === ws.meId && !frozen;
  const canOutcome = (m.status === "in_session" || m.status === "held") && !frozen;
  return (
    <Section
      id="meeting-agenda"
      title={t("governanceP4.agenda.title")}
      intro={forum?.executiveAsksOnly ? t("governanceP4.agenda.asksOnlyIntro") : t("governanceP4.agenda.intro")}
      actions={
        prepare ? (
          <button type="button" className="button button--primary" onClick={() => setDialog({ kind: "create" })}>
            <Icon name="plus" /> {t("governanceP4.agenda.add")}
          </button>
        ) : null
      }
    >
      {runner.alert}
      <QueryState query={items}>
        {(rows) => (
          <RegisterTable
            id="meeting-agenda"
            caption={t("governanceP4.agenda.title")}
            rows={rows}
            getRowId={(i) => i.id}
            emptyTitle={t("governanceP4.agenda.empty")}
            defaultSort={{ id: "ordinal", dir: "asc" }}
            columns={[
              { id: "ordinal", header: "#", cell: (i) => i.ordinal, sortValue: (i) => i.ordinal },
              {
                id: "title",
                header: t("governanceP4.agenda.item"),
                rowHeader: true,
                hideable: false,
                cell: (i) => (
                  <span className="block" data-agenda-item={i.id}>
                    {i.title}
                    <span className="block small muted">{t(`governanceP4.agenda.kind.${i.itemKind}`)}</span>
                    {i.late ? (
                      <span className="status-chip status-chip--at-risk" data-late="true">
                        <Icon name="clock" /> {t("governanceP4.agenda.late")}
                      </span>
                    ) : null}
                  </span>
                ),
                sortValue: (i) => i.title,
              },
              {
                id: "brief",
                header: t("governanceP4.agenda.brief"),
                cell: (i) => (
                  <span className="block">
                    <MissingElements item={i} />
                    {i.decisionId ? (
                      <Link
                        className="link block"
                        to={`/transformations/${ws.tid}/executive-decisions/${i.decisionId}`}
                      >
                        {t("governanceP4.agenda.openT16")}
                      </Link>
                    ) : null}
                  </span>
                ),
              },
              {
                id: "presenter",
                header: t("governanceP4.agenda.presenter"),
                cell: (i) => <PersonName id={i.presenterUserId} people={byId} />,
              },
              {
                id: "status",
                header: t("governanceP4.meetings.status"),
                cell: (i) => (
                  <span className="block" data-item-status={i.status}>
                    {t(`governanceP4.agenda.status.${i.status}`)}
                    {i.outcome ? (
                      <span className="block small" data-outcome={i.outcome}>
                        {t(`governanceP4.agenda.outcome.${i.outcome}`)}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                id: "rowActions",
                header: t("governanceP4.actionsCol"),
                hideable: false,
                cell: (i) => (
                  <span className="chip-row">
                    {i.status === "draft" && prepare ? (
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        onClick={() => setDialog({ kind: "edit", item: i })}
                        data-edit-item={i.id}
                      >
                        <Icon name="pencil" /> {t("governanceP4.agenda.edit")}
                      </button>
                    ) : null}
                    {i.status === "draft" && isChair ? (
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        disabled={runner.busy !== null}
                        onClick={() => void runner.run(i.id, govPaths.publishItem(ws.tid, m.id, i.id), i.version)}
                        data-publish-item={i.id}
                      >
                        {t("governanceP4.agenda.publish")}
                      </button>
                    ) : null}
                    {(i.status === "draft" || i.status === "published") && prepare && !i.outcome ? (
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        disabled={runner.busy !== null}
                        onClick={() =>
                          void runner.run(`w${i.id}`, govPaths.withdrawItem(ws.tid, m.id, i.id), i.version)
                        }
                      >
                        {t("governanceP4.agenda.withdraw")}
                      </button>
                    ) : null}
                    {i.status === "published" && canOutcome && (prepare || ws.can("executive_decision.decide")) ? (
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        onClick={() => setDialog({ kind: "outcome", item: i })}
                        data-outcome-item={i.id}
                      >
                        {t("governanceP4.agenda.recordOutcome")}
                      </button>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        )}
      </QueryState>
      {dialog?.kind === "create" || dialog?.kind === "edit" ? (
        <AgendaItemDialog
          meeting={m}
          forum={forum}
          item={dialog.kind === "edit" ? dialog.item : null}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "outcome" ? (
        <OutcomeDialog meeting={m} item={dialog.item} onClose={() => setDialog(null)} />
      ) : null}
    </Section>
  );
}

function AgendaItemDialog({
  meeting: m,
  forum,
  item,
  onClose,
}: {
  meeting: Meeting;
  forum: Forum | undefined;
  item: AgendaItem | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const peopleOptions = people.map((p) => ({ value: p.id, label: p.label }));
  const kinds = forum?.executiveAsksOnly ? (["executive_ask"] as const) : AGENDA_ITEM_KINDS;
  const b = item?.brief;
  const initial: P4Values = {
    itemKind: item?.itemKind ?? (forum?.executiveAsksOnly ? "executive_ask" : ""),
    title: item?.title ?? "",
    description: item?.description ?? "",
    presenterUserId: item?.presenterUserId ?? "",
    durationMinutes: item?.durationMinutes ? String(item.durationMinutes) : "",
    decisionRequired: b?.decisionRequired ?? "",
    whyNow: b?.whyNow ?? "",
    options: (b?.options ?? []).join("\n"),
    recommendation: b?.recommendation ?? "",
    impactOfDelay: b?.impactOfDelay ?? "",
    ownerUserId: b?.ownerUserId ?? "",
    requiredDate: b?.requiredDate ?? "",
  };
  const fields: P4FieldSpec[] = [
    ...(item
      ? []
      : [
          {
            name: "itemKind",
            label: t("governanceP4.agenda.kindLabel"),
            kind: "select",
            required: true,
            options: kinds.map((k) => ({ value: k, label: t(`governanceP4.agenda.kind.${k}`) })),
          } satisfies P4FieldSpec,
        ]),
    { name: "title", label: t("governanceP4.agenda.item"), kind: "text", required: true, max: 500 },
    { name: "description", label: t("governanceP4.agenda.description"), kind: "textarea", max: 8000 },
    { name: "presenterUserId", label: t("governanceP4.agenda.presenter"), kind: "select", options: peopleOptions },
    { name: "durationMinutes", label: t("governanceP4.agenda.duration"), kind: "number", min: 1, max: 480 },
    ...briefFields(t, peopleOptions),
  ];
  return (
    <P4FormDialog
      title={item ? t("governanceP4.agenda.edit") : t("governanceP4.agenda.add")}
      description={t("governanceP4.ask.intro")}
      fields={fields}
      initial={initial}
      submitLabel={t("governanceP4.save")}
      method={item ? "PATCH" : "POST"}
      url={item ? govPaths.agendaItem(ws.tid, m.id, item.id) : govPaths.agenda(ws.tid, m.id)}
      {...(item ? { version: item.version } : {})}
      namespaces={NS}
      toBody={(v) => {
        const kind = item ? item.itemKind : v["itemKind"];
        const brief = kind === "executive_ask" ? briefBody({ ...v, itemKind: "executive_ask" }) : undefined;
        const common = {
          title: v["title"],
          ...(textOf(v["description"]) ? { description: v["description"] } : {}),
          ...(typeof v["presenterUserId"] === "string" && v["presenterUserId"]
            ? { presenterUserId: v["presenterUserId"] }
            : {}),
          ...(typeof v["durationMinutes"] === "string" && v["durationMinutes"]
            ? { durationMinutes: Number(v["durationMinutes"]) }
            : {}),
        };
        if (!item) return { itemKind: kind, ...common, ...(brief ? { brief } : {}) };
        return { ...common, ...(brief ? { brief } : {}) };
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function OutcomeDialog({ meeting: m, item, onClose }: { meeting: Meeting; item: AgendaItem; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const decisions = useExecutiveDecisions(ws.tid);
  const decision = (decisions.data ?? []).find((d) => d.id === item.decisionId);
  const ask = item.itemKind === "executive_ask" && item.decisionId !== null;
  return (
    <P4FormDialog
      title={t("governanceP4.agenda.recordOutcome")}
      note={ask ? <BusinessDecisionNote /> : undefined}
      description={
        <span className="block">
          <QuorumState state={m.quorumState} present={m.presentCount} required={m.quorumMin} />
        </span>
      }
      fields={[
        {
          name: "outcome",
          label: t("governanceP4.agenda.outcomeLabel"),
          kind: "select",
          required: true,
          options: (ask ? ["decided", "deferred", "noted"] : ["deferred", "noted"]).map((o) => ({
            value: o,
            label: t(`governanceP4.agenda.outcome.${o}`),
          })),
        },
        {
          name: "chosenOptionLabel",
          label: t("governanceP4.decisions.chosenOption"),
          kind: "select",
          required: true,
          options: (decision?.options ?? []).map((o) => ({ value: o.label, label: `${o.label} · ${o.title}` })),
          when: (v) => v["outcome"] === "decided",
        },
        { name: "outcomeText", label: t("governanceP4.decisions.outcomeText"), kind: "textarea", max: 8000 },
      ]}
      submitLabel={t("governanceP4.agenda.recordOutcome")}
      url={govPaths.itemOutcome(ws.tid, m.id, item.id)}
      version={item.version}
      namespaces={NS}
      toBody={(v) => ({
        outcome: v["outcome"],
        ...(v["outcome"] === "decided" ? { chosenOptionLabel: v["chosenOptionLabel"] } : {}),
        ...(textOf(v["outcomeText"]) ? { outcomeText: v["outcomeText"] } : {}),
        ...(v["outcome"] === "decided" && decision ? { decisionVersion: decision.version } : {}),
      })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

// ------------------------------------------------------------------------------------------------ attendance

function Attendance({ meeting: m, frozen }: { meeting: Meeting; frozen: boolean }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const rows = useAttendance(ws.tid, m.id);
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP4Refresh(ws.tid);
  const [dialog, setDialog] = useState<{ row: MeetingAttendance | null } | null>(null);
  const prepare = ws.can("meeting.prepare") && !frozen;
  const kindOptions = ["present", "absent", "apologies"].map((k) => ({
    value: k,
    label: t(`governanceP4.attendance.${k}`),
  }));
  return (
    <Section
      id="meeting-attendance"
      title={t("governanceP4.attendance.title")}
      intro={<QuorumState state={m.quorumState} present={m.presentCount} required={m.quorumMin} />}
      actions={
        prepare ? (
          <button type="button" className="button button--secondary" onClick={() => setDialog({ row: null })}>
            <Icon name="plus" /> {t("governanceP4.attendance.record")}
          </button>
        ) : null
      }
    >
      <QueryState query={rows}>
        {(list) => (
          <RegisterTable
            id="meeting-attendance"
            caption={t("governanceP4.attendance.title")}
            rows={list}
            getRowId={(r) => r.id}
            emptyTitle={t("governanceP4.attendance.empty")}
            columns={[
              {
                id: "person",
                header: t("governanceP4.participants.person"),
                rowHeader: true,
                hideable: false,
                cell: (r) => <PersonName id={r.userId} people={byId} />,
                sortValue: (r) => byId.get(r.userId)?.label ?? r.userId,
              },
              {
                id: "attendance",
                header: t("governanceP4.attendance.kind"),
                cell: (r) => <span data-attendance={r.attendance}>{t(`governanceP4.attendance.${r.attendance}`)}</span>,
                sortValue: (r) => r.attendance,
              },
              {
                id: "quorum",
                header: t("governanceP4.participants.countsForQuorum"),
                cell: (r) => t(r.countsForQuorum ? "governanceP4.yes" : "governanceP4.no"),
              },
              {
                id: "rowActions",
                header: t("governanceP4.actionsCol"),
                hideable: false,
                cell: (r) =>
                  prepare ? (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => setDialog({ row: r })}
                    >
                      <Icon name="pencil" /> {t("governanceP4.attendance.change")}
                    </button>
                  ) : null,
              },
            ]}
          />
        )}
      </QueryState>
      {dialog ? (
        <P4FormDialog
          title={t("governanceP4.attendance.record")}
          fields={[
            ...(dialog.row
              ? []
              : [
                  {
                    name: "userId",
                    label: t("governanceP4.participants.person"),
                    kind: "select",
                    required: true,
                    options: people.map((p) => ({ value: p.id, label: p.label })),
                  } satisfies P4FieldSpec,
                ]),
            {
              name: "attendance",
              label: t("governanceP4.attendance.kind"),
              kind: "select",
              required: true,
              options: kindOptions,
            },
          ]}
          initial={{ attendance: dialog.row?.attendance ?? "present" }}
          submitLabel={t("governanceP4.save")}
          method={dialog.row ? "PATCH" : "POST"}
          url={dialog.row ? govPaths.attendanceRow(ws.tid, m.id, dialog.row.id) : govPaths.attendance(ws.tid, m.id)}
          {...(dialog.row ? { version: dialog.row.version } : {})}
          namespaces={NS}
          toBody={(v) =>
            dialog.row ? { attendance: v["attendance"] } : { userId: v["userId"], attendance: v["attendance"] }
          }
          onDone={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ outputs

function Outputs({ meeting: m, forum, frozen }: { meeting: Meeting; forum: Forum | undefined; frozen: boolean }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const outputs = useMeetingOutputs(ws.tid, m.id);
  const refresh = useP4Refresh(ws.tid);
  const [adding, setAdding] = useState(false);
  const prepare = ws.can("meeting.prepare") && !frozen;
  return (
    <Section
      id="meeting-outputs"
      title={t("governanceP4.outputs.title")}
      intro={
        forum && forum.publishRequiresAnyOutput.length > 0
          ? t("governanceP4.outputs.required", {
              outputs: forum.publishRequiresAnyOutput.map((k) => t(`governanceP4.output.${k}`)).join(", "),
            })
          : t("governanceP4.outputs.intro")
      }
      actions={
        prepare ? (
          <button type="button" className="button button--secondary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t("governanceP4.outputs.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={outputs}>
        {(rows) => (
          <RegisterTable
            id="meeting-outputs"
            caption={t("governanceP4.outputs.title")}
            rows={rows}
            getRowId={(o) => o.id}
            emptyTitle={t("governanceP4.outputs.empty")}
            columns={[
              {
                id: "kind",
                header: t("governanceP4.outputs.kind"),
                rowHeader: true,
                hideable: false,
                cell: (o) => <span data-output={o.outputKind}>{t(`governanceP4.output.${o.outputKind}`)}</span>,
                sortValue: (o) => t(`governanceP4.output.${o.outputKind}`),
              },
              {
                id: "record",
                header: t("governanceP4.outputs.record"),
                cell: (o) =>
                  o.recordType ? (
                    <span>
                      {t(`governanceP4.recordType.${o.recordType}`)}
                      {o.recordId ? (
                        <>
                          {" "}
                          <Code>{o.recordId.slice(0, 8)}</Code>
                        </>
                      ) : null}
                    </span>
                  ) : (
                    <span className="muted">{t("common.value.none")}</span>
                  ),
              },
              { id: "note", header: t("governanceP4.outputs.note"), cell: (o) => <TextCell value={o.note} /> },
            ]}
          />
        )}
      </QueryState>
      {adding ? (
        <P4FormDialog
          title={t("governanceP4.outputs.add")}
          fields={[
            {
              name: "outputKind",
              label: t("governanceP4.outputs.kind"),
              kind: "select",
              required: true,
              options: (forum?.outputKinds ?? []).map((k) => ({ value: k, label: t(`governanceP4.output.${k}`) })),
            },
            {
              name: "recordType",
              label: t("governanceP4.outputs.recordType"),
              kind: "select",
              options: MEETING_OUTPUT_RECORD_TYPES.map((r) => ({ value: r, label: t(`governanceP4.recordType.${r}`) })),
            },
            {
              name: "recordId",
              label: t("governanceP4.outputs.recordId"),
              kind: "text",
              ltr: true,
              hint: t("governanceP4.outputs.recordIdHint"),
              when: (v) => typeof v["recordType"] === "string" && v["recordType"] !== "",
              required: true,
            },
            { name: "note", label: t("governanceP4.outputs.note"), kind: "textarea", max: 4000 },
          ]}
          submitLabel={t("governanceP4.outputs.add")}
          url={govPaths.outputs(ws.tid, m.id)}
          namespaces={NS}
          toBody={(v) => ({
            outputKind: v["outputKind"],
            ...(typeof v["recordType"] === "string" && v["recordType"]
              ? { recordType: v["recordType"], recordId: v["recordId"] }
              : {}),
            ...(textOf(v["note"]) ? { note: v["note"] } : {}),
          })}
          onDone={refresh}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ minutes

function Minutes({ meeting: m }: { meeting: Meeting }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const minutes = useMinutes(ws.tid, m.id);
  const refresh = useP4Refresh(ws.tid);
  const runner = useActionRunner(ws.tid);
  const { byId } = usePeople(ws.tid);
  const [editing, setEditing] = useState<"create" | "edit" | "return" | null>(null);
  const prepare = ws.can("meeting.prepare") && m.status !== "cancelled";
  const isChair = ws.can("meeting.chair") && m.chairUserId === ws.meId;
  return (
    <Section id="meeting-minutes" title={t("governanceP4.minutes.title")} intro={t("governanceP4.minutes.intro")}>
      {runner.alert}
      <QueryState query={minutes}>
        {(mm) =>
          mm === null ? (
            <>
              <p className="muted" data-minutes="none">
                {t("governanceP4.minutes.none")}
              </p>
              {prepare ? (
                <button type="button" className="button button--secondary" onClick={() => setEditing("create")}>
                  <Icon name="plus" /> {t("governanceP4.minutes.create")}
                </button>
              ) : null}
            </>
          ) : (
            <div data-minutes={mm.status}>
              <p className="chip-row">
                <MinutesStatusText status={mm.status} />
                {mm.status === "draft" ? (
                  <span className="small muted">{t("governanceP4.minutes.draftNote")}</span>
                ) : null}
              </p>
              {mm.status === "published" ? (
                <p className="banner banner--info" role="note" data-state="minutes-published">
                  <Icon name="lock" /> {t("governanceP4.minutes.publishedNote")}{" "}
                  {formatDateTime(mm.publishedAt, locale)} · <PersonName id={mm.publishedBy} people={byId} />
                </p>
              ) : null}
              <div className="text-cell card" data-minutes-body>
                {mm.body}
              </div>
              <p className="chip-row">
                {mm.status === "draft" && prepare ? (
                  <button type="button" className="button button--secondary" onClick={() => setEditing("edit")}>
                    <Icon name="pencil" /> {t("governanceP4.minutes.edit")}
                  </button>
                ) : null}
                {mm.status === "draft" && isChair ? (
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={runner.busy !== null}
                    onClick={() => void runner.run("approve", govPaths.approveMinutes(ws.tid, m.id), mm.version)}
                    data-minutes-action="approve"
                  >
                    <Icon name="check" /> {t("governanceP4.minutes.approve")}
                  </button>
                ) : null}
                {mm.status === "approved" && prepare ? (
                  <button type="button" className="button button--secondary" onClick={() => setEditing("return")}>
                    {t("governanceP4.minutes.returnToDraft")}
                  </button>
                ) : null}
                {mm.status === "approved" && isChair ? (
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={runner.busy !== null}
                    onClick={() => void runner.run("publish", govPaths.publishMinutes(ws.tid, m.id), mm.version)}
                    data-minutes-action="publish"
                  >
                    <Icon name="lock" /> {t("governanceP4.minutes.publish")}
                  </button>
                ) : null}
              </p>
              {editing === "edit" || editing === "return" ? (
                <P4FormDialog
                  title={t(editing === "edit" ? "governanceP4.minutes.edit" : "governanceP4.minutes.returnToDraft")}
                  fields={
                    editing === "edit"
                      ? [
                          {
                            name: "body",
                            label: t("governanceP4.minutes.body"),
                            kind: "textarea",
                            required: true,
                            max: 50000,
                          },
                        ]
                      : []
                  }
                  initial={{ body: mm.body }}
                  submitLabel={t("governanceP4.save")}
                  method="PATCH"
                  url={govPaths.minutes(ws.tid, m.id)}
                  version={mm.version}
                  namespaces={NS}
                  toBody={(v) => (editing === "edit" ? { body: v["body"] } : { status: "draft" })}
                  onDone={refresh}
                  onClose={() => setEditing(null)}
                />
              ) : null}
            </div>
          )
        }
      </QueryState>
      {editing === "create" ? (
        <P4FormDialog
          title={t("governanceP4.minutes.create")}
          fields={[
            { name: "body", label: t("governanceP4.minutes.body"), kind: "textarea", required: true, max: 50000 },
          ]}
          submitLabel={t("governanceP4.save")}
          url={govPaths.minutes(ws.tid, m.id)}
          namespaces={NS}
          toBody={(v) => ({ body: v["body"] })}
          onDone={refresh}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ actions

function MeetingActions({ meeting: m, frozen }: { meeting: Meeting; frozen: boolean }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const actions = useMeetingActions(ws.tid, m.id);
  const items = useAgendaItems(ws.tid, m.id);
  const { people } = usePeople(ws.tid);
  const refresh = useP4Refresh(ws.tid);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RaidAction | null>(null);
  const prepare = ws.can("meeting.prepare") && !frozen;
  return (
    <Section
      id="meeting-actions"
      title={t("governanceP4.actions.title")}
      intro={t("governanceP4.actions.intro")}
      actions={
        prepare ? (
          <button type="button" className="button button--secondary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t("governanceP4.actions.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={actions}>
        {(rows) => (
          <ActionsTable
            id="meeting-actions"
            rows={rows.map((r) => ({ ...r.action, overdue: r.overdue }))}
            compact
            onEdit={setEditing}
          />
        )}
      </QueryState>
      {adding ? (
        <P4FormDialog
          title={t("governanceP4.actions.add")}
          fields={[
            {
              name: "agendaItemId",
              label: t("governanceP4.agenda.item"),
              kind: "select",
              options: (items.data ?? []).map((i) => ({ value: i.id, label: `${i.ordinal}. ${i.title}` })),
            },
            { name: "title", label: t("raidP4.actions.col.title"), kind: "text", required: true, max: 500 },
            { name: "description", label: t("raidP4.actions.col.description"), kind: "textarea", max: 4000 },
            {
              name: "ownerUserId",
              label: t("raidP4.actions.col.owner"),
              kind: "select",
              required: true,
              options: people.map((p) => ({ value: p.id, label: p.label })),
            },
            { name: "dueDate", label: t("raidP4.actions.col.due"), kind: "date" },
          ]}
          submitLabel={t("governanceP4.actions.add")}
          url={govPaths.actions(ws.tid, m.id)}
          namespaces={NS}
          toBody={(v) => ({
            ...(typeof v["agendaItemId"] === "string" && v["agendaItemId"] ? { agendaItemId: v["agendaItemId"] } : {}),
            title: v["title"],
            ...(textOf(v["description"]) ? { description: v["description"] } : {}),
            ownerUserId: v["ownerUserId"],
            ...(typeof v["dueDate"] === "string" && v["dueDate"] ? { dueDate: v["dueDate"] } : {}),
          })}
          onDone={refresh}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {editing ? <EditActionDialog action={editing} onClose={() => setEditing(null)} /> : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ blockers

function Blockers({ meeting: m, frozen }: { meeting: Meeting; frozen: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const statuses = useBlockerStatuses(ws.tid, m.id);
  const raid = useRaidEntries(ws.tid, { status: "open" });
  const refresh = useP4Refresh(ws.tid);
  const [adding, setAdding] = useState(false);
  const prepare = ws.can("meeting.prepare") && !frozen && (m.status === "in_session" || m.status === "held");
  const codeOf = (id: string) => (raid.data ?? []).find((e) => e.id === id)?.code ?? id.slice(0, 8);
  const ragChip = (rag: string) =>
    rag === "unknown" ? (
      <span className="status-chip status-chip--unknown" data-rag="unknown">
        <Icon name="question" /> {t("raidP4.rag.unknown")}
      </span>
    ) : (
      <span
        className={`status-chip status-chip--${rag === "red" ? "off-track" : rag === "amber" ? "at-risk" : "on-track"}`}
        data-rag={rag}
      >
        <Icon name={rag === "red" ? "alert" : rag === "amber" ? "pause" : "check"} /> {t(`raidP4.rag.${rag}`)}
      </span>
    );
  return (
    <Section
      id="meeting-blockers"
      title={t("governanceP4.blockers.title")}
      intro={t("governanceP4.blockers.intro")}
      actions={
        prepare ? (
          <button type="button" className="button button--secondary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t("governanceP4.blockers.record")}
          </button>
        ) : null
      }
    >
      <QueryState query={statuses}>
        {(rows) => (
          <RegisterTable
            id="meeting-blockers"
            caption={t("governanceP4.blockers.title")}
            rows={rows}
            getRowId={(b) => b.id}
            emptyTitle={t("governanceP4.blockers.empty")}
            columns={[
              {
                id: "blocker",
                header: t("governanceP4.blockers.blocker"),
                rowHeader: true,
                hideable: false,
                cell: (b) => (
                  <span>
                    {t(`governanceP4.recordType.${b.sourceRecordType}`)} <Code>{codeOf(b.sourceRecordId)}</Code>
                  </span>
                ),
              },
              {
                id: "rag",
                header: t("governanceP4.blockers.rag"),
                cell: (b) => ragChip(b.rag),
                sortValue: (b) => b.rag,
              },
              {
                id: "cycle",
                header: t("governanceP4.blockers.cycle"),
                cell: (b) => formatBusinessDate(b.cycleDate, locale),
                sortValue: (b) => b.cycleDate,
              },
              { id: "note", header: t("governanceP4.outputs.note"), cell: (b) => <TextCell value={b.note} /> },
            ]}
          />
        )}
      </QueryState>
      {adding ? (
        <P4FormDialog
          title={t("governanceP4.blockers.record")}
          fields={[
            {
              name: "source",
              label: t("governanceP4.blockers.blocker"),
              kind: "select",
              required: true,
              options: (raid.data ?? [])
                .filter((e) => BLOCKER_RECORD_TYPES.includes(e.recordTable))
                .map((e) => ({
                  value: `${e.recordTable}:${e.id}`,
                  label: `${e.code} · ${e.description.slice(0, 60)}`,
                })),
            },
            {
              name: "rag",
              label: t("governanceP4.blockers.rag"),
              kind: "select",
              required: true,
              options: ["red", "amber", "green", "unknown"].map((r) => ({ value: r, label: t(`raidP4.rag.${r}`) })),
            },
            { name: "note", label: t("governanceP4.outputs.note"), kind: "textarea", max: 2000 },
          ]}
          submitLabel={t("governanceP4.blockers.record")}
          url={govPaths.blockers(ws.tid, m.id)}
          namespaces={NS}
          toBody={(v) => {
            const [type, id] = String(v["source"]).split(":");
            return {
              sourceRecordType: type,
              sourceRecordId: id,
              rag: v["rag"],
              ...(textOf(v["note"]) ? { note: v["note"] } : {}),
            };
          }}
          onDone={refresh}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Section>
  );
}

/** Exported for tests: the order of the seven ask elements. */
export const ASK_ELEMENTS = AGENDA_ASK_ELEMENTS;
