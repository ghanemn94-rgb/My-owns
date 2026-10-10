// Governance > Forums and meeting series (T-DG4-FE-D; p4-work-split §D.5; ADR-0032 §1-§2). SYNTHETIC data only.
//  - The five operating-system layers seeded per transformation, each with its verbatim B0093 source texts (layer,
//    cadence, purpose, participants, outputs). The Arabic texts are labelled "provisional translation" when the server
//    says so, and the English source stays visible beside them (REQ-PB-060).
//  - Each forum's configuration: chair role, participants, quorum, cut-off in working days, agenda rules (executive
//    asks only, maximum items, late items), outputs and the outputs publication requires (REQ-S10-005).
//  - The series editor: frequency, interval, weekdays or day of month, time, horizon and the non-working-day rule. A
//    change regenerates **future meetings only**: the user confirms it first, and the result lists the meetings that
//    were kept (today's and past meetings, and future meetings with content), cancelled and created (ADR-0032 §2).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useGovernanceParties, useGroups, useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { useMe } from "../../auth/session.tsx";
import { Dialog } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import { P4FormDialog, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import {
  govPaths,
  useForum,
  useForumParticipants,
  useForums,
  useMeetings,
  useMeetingSeries,
  type Forum,
  type MeetingSeries,
  type MeetingSeriesResult,
} from "../meetings/api.ts";
import { Code, FORUM_WRITE_PERMISSIONS, GovSubNav, MeetingStatusText, NS, useActionRunner } from "../meetings/ui.tsx";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** A forum's name in the current language. */
export function useForumName(): (f: Pick<Forum, "nameEn" | "nameAr"> | undefined) => string {
  const locale = useLocale();
  const { t } = useTranslation();
  return (f) => (f ? (locale === "ar" ? f.nameAr : f.nameEn) : t("common.value.unknown"));
}

// ------------------------------------------------------------------------------------------------ list

export function ForumsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="forums"
      title={t("governanceP4.forums.title")}
      subtitle={t("governanceP4.forums.intro")}
      writePermissions={FORUM_WRITE_PERMISSIONS}
    >
      <ForumsBody />
    </WorkspaceFrame>
  );
}

function ForumsBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const forums = useForums(ws.tid, { status: "active" });
  const name = useForumName();
  return (
    <>
      <GovSubNav tid={ws.tid} />
      <QueryState query={forums}>
        {(rows) => (
          <ol className="plain-list" data-forums={rows.length}>
            {[...rows]
              .sort((a, b) => a.ordinal - b.ordinal)
              .map((f) => (
                <li key={f.id}>
                  <Section
                    id={`forum-${f.id}`}
                    title={name(f)}
                    actions={
                      <Link
                        className="button button--secondary button--small"
                        to={`/transformations/${ws.tid}/forums/${f.id}`}
                      >
                        {t("governanceP4.forums.open")}
                        <span className="visually-hidden"> {name(f)}</span>
                      </Link>
                    }
                  >
                    <ForumSource forum={f} />
                    <ForumSummary forum={f} />
                  </Section>
                </li>
              ))}
          </ol>
        )}
      </QueryState>
    </>
  );
}

/** The B0093 source texts (verbatim English; Arabic labelled provisional when it is). */
function ForumSource({ forum }: { forum: Forum }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const s = forum.source;
  if (!s)
    return (
      <p className="small muted" data-source="custom">
        {t("governanceP4.forums.customForum")}
      </p>
    );
  const ar = locale === "ar";
  const rows: { key: string; en: string; ar: string }[] = [
    { key: "layer", en: s.layerEn, ar: s.layerAr },
    { key: "cadence", en: s.cadenceEn, ar: s.cadenceAr },
    { key: "purpose", en: s.purposeEn, ar: s.purposeAr },
    { key: "participants", en: s.participantsEn, ar: s.participantsAr },
    { key: "outputs", en: s.outputsEn, ar: s.outputsAr },
  ];
  return (
    <div data-source={s.sourceRef} data-template={forum.templateKey ?? ""}>
      <h3 className="small">
        {t("governanceP4.forums.sourceTitle")} <Code>{s.sourceRef}</Code>
      </h3>
      {ar && s.arProvisional ? (
        <p className="small muted" data-provisional="true">
          <Icon name="info" /> {t("governanceP4.forums.arProvisional")}
        </p>
      ) : null}
      <dl className="details details--compact">
        {rows.map((r) => (
          <div key={r.key} data-source-field={r.key}>
            <dt>{t(`governanceP4.forums.field.${r.key}`)}</dt>
            <dd>
              {ar ? (
                <>
                  <span className="block">{r.ar}</span>
                  <span className="block small muted" dir="ltr" lang="en" data-verbatim-en={r.key}>
                    {r.en}
                  </span>
                </>
              ) : (
                <span data-verbatim-en={r.key}>{r.en}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ForumSummary({ forum }: { forum: Forum }) {
  const { t } = useTranslation();
  return (
    <dl className="details details--compact" data-forum-config={forum.id}>
      <div>
        <dt>{t("governanceP4.forums.field.chair")}</dt>
        <dd>{forum.chairPartyCode ? <Code>{forum.chairPartyCode}</Code> : t("governanceP4.forums.noChair")}</dd>
      </div>
      <div>
        <dt>{t("governanceP4.forums.field.quorum")}</dt>
        <dd data-quorum-min={forum.quorumMin ?? "none"}>
          {forum.quorumMin === null ? t("governanceP4.forums.quorumNone") : String(forum.quorumMin)}
        </dd>
      </div>
      <div>
        <dt>{t("governanceP4.forums.field.cutoff")}</dt>
        <dd>{t("governanceP4.forums.workingDays", { count: forum.cutoffWorkingDays })}</dd>
      </div>
      <div>
        <dt>{t("governanceP4.forums.field.agendaRules")}</dt>
        <dd>
          <span className="block" data-asks-only={forum.executiveAsksOnly}>
            {forum.executiveAsksOnly ? t("governanceP4.forums.asksOnly") : t("governanceP4.forums.allItems")}
          </span>
          <span className="block">
            {forum.agendaMaxItems === null
              ? t("governanceP4.forums.noMax")
              : t("governanceP4.forums.maxItems", { count: forum.agendaMaxItems })}
          </span>
          <span className="block">{t(`governanceP4.forums.late.${forum.lateItemsRule}`)}</span>
        </dd>
      </div>
      <div>
        <dt>{t("governanceP4.forums.field.outputKinds")}</dt>
        <dd>{forum.outputKinds.map((k) => t(`governanceP4.output.${k}`)).join(" · ")}</dd>
      </div>
      <div>
        <dt>{t("governanceP4.forums.field.publishRequires")}</dt>
        <dd>
          {forum.publishRequiresAnyOutput.length === 0
            ? t("common.value.none")
            : forum.publishRequiresAnyOutput.map((k) => t(`governanceP4.output.${k}`)).join(" · ")}
        </dd>
      </div>
    </dl>
  );
}

// ------------------------------------------------------------------------------------------------ one forum

export function ForumPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame tab="forums" title={t("governanceP4.forums.forumTitle")} writePermissions={FORUM_WRITE_PERMISSIONS}>
      <ForumBody />
    </WorkspaceFrame>
  );
}

function ForumBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { forumId = "" } = useParams();
  const forum = useForum(ws.tid, forumId);
  const name = useForumName();
  const [editing, setEditing] = useState(false);
  const canConfigure = ws.can("forum.configure");
  return (
    <>
      <GovSubNav tid={ws.tid} />
      <QueryState query={forum}>
        {(f) => (
          <>
            <Section
              id="forum"
              title={name(f)}
              actions={
                canConfigure && f.status === "active" ? (
                  <button type="button" className="button button--secondary" onClick={() => setEditing(true)}>
                    <Icon name="pencil" /> {t("governanceP4.forums.configure")}
                  </button>
                ) : null
              }
            >
              <ForumSource forum={f} />
              <ForumSummary forum={f} />
            </Section>
            <Participants forum={f} />
            <SeriesSection forum={f} />
            {editing ? <EditForumDialog forum={f} onClose={() => setEditing(false)} /> : null}
          </>
        )}
      </QueryState>
    </>
  );
}

function EditForumDialog({ forum, onClose }: { forum: Forum; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const parties = useGovernanceParties();
  const initial: P4Values = {
    chairPartyCode: forum.chairPartyCode ?? "",
    quorumMin: forum.quorumMin === null ? "" : String(forum.quorumMin),
    cutoffWorkingDays: String(forum.cutoffWorkingDays),
    agendaMaxItems: forum.agendaMaxItems === null ? "" : String(forum.agendaMaxItems),
    lateItemsRule: forum.lateItemsRule,
    executiveAsksOnly: forum.executiveAsksOnly,
    cadenceLabel: forum.cadenceLabel,
  };
  const fields: P4FieldSpec[] = [
    {
      name: "chairPartyCode",
      label: t("governanceP4.forums.field.chair"),
      kind: "select",
      options: (parties.data ?? []).map((p) => ({ value: p.code, label: `${p.code} · ${p.labelEn}` })),
    },
    { name: "cadenceLabel", label: t("governanceP4.forums.field.cadence"), kind: "text", required: true, max: 200 },
    {
      name: "quorumMin",
      label: t("governanceP4.forums.field.quorum"),
      kind: "number",
      min: 1,
      max: 100,
      hint: t("governanceP4.forums.quorumHint"),
    },
    {
      name: "cutoffWorkingDays",
      label: t("governanceP4.forums.field.cutoff"),
      kind: "number",
      required: true,
      min: 0,
      max: 20,
    },
    { name: "agendaMaxItems", label: t("governanceP4.forums.field.agendaMax"), kind: "number", min: 1, max: 50 },
    {
      name: "lateItemsRule",
      label: t("governanceP4.forums.field.lateRule"),
      kind: "select",
      required: true,
      options: ["flag", "refuse"].map((v) => ({ value: v, label: t(`governanceP4.forums.late.${v}`) })),
    },
    { name: "executiveAsksOnly", label: t("governanceP4.forums.asksOnly"), kind: "checkbox" },
  ];
  const num = (v: string | boolean | undefined) => (typeof v === "string" && v !== "" ? Number(v) : null);
  return (
    <P4FormDialog
      title={t("governanceP4.forums.configure")}
      fields={fields}
      initial={initial}
      submitLabel={t("governanceP4.save")}
      method="PATCH"
      url={govPaths.forum(ws.tid, forum.id)}
      version={forum.version}
      namespaces={NS}
      toBody={(v) => {
        const body: Record<string, unknown> = {};
        if (v["chairPartyCode"] !== initial["chairPartyCode"]) body["chairPartyCode"] = v["chairPartyCode"] || null;
        if (v["cadenceLabel"] !== initial["cadenceLabel"]) body["cadenceLabel"] = v["cadenceLabel"];
        if (v["quorumMin"] !== initial["quorumMin"]) body["quorumMin"] = num(v["quorumMin"]);
        if (v["cutoffWorkingDays"] !== initial["cutoffWorkingDays"])
          body["cutoffWorkingDays"] = num(v["cutoffWorkingDays"]);
        if (v["agendaMaxItems"] !== initial["agendaMaxItems"]) body["agendaMaxItems"] = num(v["agendaMaxItems"]);
        if (v["lateItemsRule"] !== initial["lateItemsRule"]) body["lateItemsRule"] = v["lateItemsRule"];
        if ((v["executiveAsksOnly"] === true) !== initial["executiveAsksOnly"])
          body["executiveAsksOnly"] = v["executiveAsksOnly"] === true;
        return Object.keys(body).length === 0 ? { fieldErrors: { cadenceLabel: "validation.empty_patch" } } : body;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function Participants({ forum }: { forum: Forum }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const me = useMe();
  const participants = useForumParticipants(ws.tid, forum.id);
  const groups = useGroups(me.user.organizationId);
  const { people, byId } = usePeople(ws.tid);
  const runner = useActionRunner(ws.tid);
  const refresh = useP4Refresh(ws.tid);
  const [adding, setAdding] = useState(false);
  const canConfigure = ws.can("forum.configure") && forum.status === "active";
  const groupName = (id: string | null) =>
    (groups.data ?? []).find((g) => g.id === id)?.code ?? t("common.value.notVisible");
  return (
    <Section
      id="forum-participants"
      title={t("governanceP4.participants.title")}
      intro={t("governanceP4.participants.intro")}
      actions={
        canConfigure ? (
          <button type="button" className="button button--secondary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t("governanceP4.participants.add")}
          </button>
        ) : null
      }
    >
      {runner.alert}
      <QueryState query={participants}>
        {(rows) => (
          <RegisterTable
            id="forum-participants"
            caption={t("governanceP4.participants.title")}
            rows={rows.filter((p) => p.status === "active")}
            getRowId={(p) => p.id}
            emptyTitle={t("governanceP4.participants.empty")}
            columns={[
              {
                id: "who",
                header: t("governanceP4.participants.who"),
                rowHeader: true,
                hideable: false,
                cell: (p) =>
                  p.userId ? (
                    <PersonName id={p.userId} people={byId} />
                  ) : (
                    <span>
                      {t("governanceP4.participants.group")}: <Code>{groupName(p.groupId)}</Code>
                    </span>
                  ),
              },
              {
                id: "quorum",
                header: t("governanceP4.participants.countsForQuorum"),
                cell: (p) => t(p.countsForQuorum ? "governanceP4.yes" : "governanceP4.no"),
                sortValue: (p) => (p.countsForQuorum ? 0 : 1),
              },
              {
                id: "rowActions",
                header: t("governanceP4.actionsCol"),
                hideable: false,
                cell: (p) =>
                  canConfigure ? (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      disabled={runner.busy === p.id}
                      onClick={() =>
                        void runner.run(p.id, govPaths.removeParticipant(ws.tid, forum.id, p.id), p.version)
                      }
                    >
                      {t("governanceP4.participants.remove")}
                    </button>
                  ) : null,
              },
            ]}
          />
        )}
      </QueryState>
      {adding ? (
        <P4FormDialog
          title={t("governanceP4.participants.add")}
          fields={[
            {
              name: "who",
              label: t("governanceP4.participants.kind"),
              kind: "select",
              required: true,
              options: [
                { value: "user", label: t("governanceP4.participants.person") },
                { value: "group", label: t("governanceP4.participants.group") },
              ],
            },
            {
              name: "userId",
              label: t("governanceP4.participants.person"),
              kind: "select",
              required: true,
              options: people.map((p) => ({ value: p.id, label: p.label })),
              when: (v) => v["who"] === "user",
            },
            {
              name: "groupId",
              label: t("governanceP4.participants.group"),
              kind: "select",
              required: true,
              options: (groups.data ?? []).map((g) => ({ value: g.id, label: `${g.code} · ${g.nameEn}` })),
              when: (v) => v["who"] === "group",
            },
            { name: "countsForQuorum", label: t("governanceP4.participants.countsForQuorum"), kind: "checkbox" },
          ]}
          initial={{ who: "user", countsForQuorum: true }}
          submitLabel={t("governanceP4.participants.add")}
          url={govPaths.participants(ws.tid, forum.id)}
          namespaces={NS}
          toBody={(v) => ({
            ...(v["who"] === "group" ? { groupId: v["groupId"] } : { userId: v["userId"] }),
            countsForQuorum: v["countsForQuorum"] === true,
          })}
          onDone={refresh}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ series editor

function seriesFields(t: ReturnType<typeof useTranslation>["t"], create: boolean): P4FieldSpec[] {
  return [
    {
      name: "frequency",
      label: t("governanceP4.series.frequency"),
      kind: "select",
      required: true,
      options: ["daily", "weekly", "monthly"].map((v) => ({ value: v, label: t(`governanceP4.series.freq.${v}`) })),
    },
    {
      name: "intervalCount",
      label: t("governanceP4.series.interval"),
      kind: "number",
      required: true,
      min: 1,
      max: 12,
      hint: t("governanceP4.series.intervalHint"),
    },
    ...WEEKDAYS.map(
      (d): P4FieldSpec => ({
        name: `wd${d}`,
        label: t(`calendar.weekday.${d}`),
        kind: "checkbox",
        when: (v) => v["frequency"] === "weekly",
      }),
    ),
    {
      name: "monthDay",
      label: t("governanceP4.series.monthDay"),
      kind: "number",
      required: true,
      min: 1,
      max: 28,
      when: (v) => v["frequency"] === "monthly",
    },
    { name: "startDate", label: t("governanceP4.series.startDate"), kind: "date", required: true },
    { name: "endDate", label: t("governanceP4.series.endDate"), kind: "date" },
    {
      name: "startTime",
      label: t("governanceP4.series.startTime"),
      kind: "text",
      required: true,
      ltr: true,
      hint: "HH:MM",
    },
    {
      name: "durationMinutes",
      label: t("governanceP4.series.duration"),
      kind: "number",
      required: true,
      min: 15,
      max: 480,
    },
    {
      name: "nonWorkingDayRule",
      label: t("governanceP4.series.nonWorkingDay"),
      kind: "select",
      required: true,
      options: ["next_working_day", "skip", "keep"].map((v) => ({
        value: v,
        label: t(`governanceP4.series.nwd.${v}`),
      })),
    },
    { name: "horizonDays", label: t("governanceP4.series.horizon"), kind: "number", required: true, min: 7, max: 366 },
    { name: "location", label: t("governanceP4.series.location"), kind: "text", max: 300 },
    ...(create
      ? []
      : [
          {
            // A required choice (not a checkbox), so a missing confirmation shows its error on the field.
            name: "confirmFuture",
            label: t("governanceP4.series.confirmFuture"),
            kind: "select",
            required: true,
            hint: t("governanceP4.series.confirmFutureHint"),
            options: [{ value: "confirmed", label: t("governanceP4.series.confirmFutureOption") }],
          } satisfies P4FieldSpec,
        ]),
  ];
}

function seriesValues(s: MeetingSeries | null): P4Values {
  const v: P4Values = {
    frequency: s?.frequency ?? "weekly",
    intervalCount: String(s?.intervalCount ?? 1),
    monthDay: s?.monthDay ? String(s.monthDay) : "",
    startDate: s?.startDate ?? "",
    endDate: s?.endDate ?? "",
    startTime: s?.startTime ?? "09:00",
    durationMinutes: String(s?.durationMinutes ?? 60),
    nonWorkingDayRule: s?.nonWorkingDayRule ?? "next_working_day",
    horizonDays: String(s?.horizonDays ?? 90),
    location: s?.location ?? "",
    confirmFuture: "",
  };
  for (const d of WEEKDAYS) v[`wd${d}`] = (s?.weekdays ?? []).includes(d);
  return v;
}

function seriesBody(v: P4Values): Record<string, unknown> {
  const freq = v["frequency"];
  return {
    frequency: freq,
    intervalCount: Number(v["intervalCount"]),
    weekdays: freq === "weekly" ? WEEKDAYS.filter((d) => v[`wd${d}`] === true) : null,
    monthDay: freq === "monthly" ? Number(v["monthDay"]) : null,
    startDate: v["startDate"],
    endDate: typeof v["endDate"] === "string" && v["endDate"] !== "" ? v["endDate"] : null,
    startTime: v["startTime"],
    durationMinutes: Number(v["durationMinutes"]),
    nonWorkingDayRule: v["nonWorkingDayRule"],
    horizonDays: Number(v["horizonDays"]),
    location: textOf(v["location"]) ?? null,
  };
}

function SeriesSection({ forum }: { forum: Forum }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const series = useMeetingSeries(ws.tid, { forumId: forum.id, status: "active" });
  const refresh = useP4Refresh(ws.tid);
  const runner = useActionRunner(ws.tid);
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [result, setResult] = useState<MeetingSeriesResult | null>(null);
  const canConfigure = ws.can("forum.configure") && forum.status === "active";
  return (
    <Section id="forum-series" title={t("governanceP4.series.title")} intro={t("governanceP4.series.intro")}>
      {runner.alert}
      <QueryState query={series}>
        {(rows) => {
          const s = rows[0] ?? null;
          return (
            <>
              {s === null ? (
                <p className="muted" data-series="none">
                  {t("governanceP4.series.none")}
                </p>
              ) : (
                <dl className="details details--compact" data-series={s.id}>
                  <div>
                    <dt>{t("governanceP4.series.frequency")}</dt>
                    <dd data-frequency={`${s.frequency}:${s.intervalCount}`}>
                      {t(`governanceP4.series.every.${s.frequency}`, { count: s.intervalCount })}
                      {s.weekdays ? ` · ${s.weekdays.map((d) => t(`calendar.weekday.${d}`)).join(", ")}` : ""}
                      {s.monthDay ? ` · ${t("governanceP4.series.monthDay")} ${s.monthDay}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("governanceP4.series.startTime")}</dt>
                    <dd>
                      <bdi dir="ltr">{s.startTime}</bdi> ({s.durationMinutes} {t("governanceP4.series.minutes")}),{" "}
                      <bdi dir="ltr">{s.timezone}</bdi>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("governanceP4.series.nonWorkingDay")}</dt>
                    <dd>{t(`governanceP4.series.nwd.${s.nonWorkingDayRule}`)}</dd>
                  </div>
                  <div>
                    <dt>{t("governanceP4.series.generatedThrough")}</dt>
                    <dd>
                      {formatBusinessDate(s.generatedThrough, locale) ?? (
                        <span className="status-chip status-chip--unknown">
                          <Icon name="question" /> {t("common.value.unknown")}
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
              )}
              {canConfigure ? (
                <p className="chip-row">
                  {s === null ? (
                    <button type="button" className="button button--primary" onClick={() => setDialog("create")}>
                      <Icon name="plus" /> {t("governanceP4.series.create")}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() => setDialog("edit")}
                        data-edit-series={s.id}
                      >
                        <Icon name="pencil" /> {t("governanceP4.series.edit")}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={runner.busy === s.id}
                        onClick={() => void runner.run(s.id, govPaths.endSeries(ws.tid, s.id), s.version)}
                      >
                        <Icon name="stop" /> {t("governanceP4.series.end")}
                      </button>
                    </>
                  )}
                </p>
              ) : null}
              {dialog ? (
                <P4FormDialog
                  title={t(dialog === "create" ? "governanceP4.series.create" : "governanceP4.series.edit")}
                  description={dialog === "edit" ? t("governanceP4.series.futureOnly") : undefined}
                  fields={seriesFields(t, dialog === "create")}
                  initial={seriesValues(dialog === "edit" ? s : null)}
                  submitLabel={t("governanceP4.save")}
                  method={dialog === "create" ? "POST" : "PATCH"}
                  url={dialog === "create" || !s ? govPaths.series(ws.tid) : govPaths.oneSeries(ws.tid, s.id)}
                  {...(dialog === "edit" && s ? { version: s.version } : {})}
                  namespaces={NS}
                  toBody={(v) => {
                    if (v["frequency"] === "weekly" && !WEEKDAYS.some((d) => v[`wd${d}`] === true))
                      return { fieldErrors: { frequency: "meeting_series.rule_invalid" } };
                    const body = seriesBody(v);
                    return dialog === "create" ? { forumId: forum.id, ...body } : body;
                  }}
                  onDone={async (r) => {
                    const ok = await refresh();
                    if (ok && r && typeof r === "object" && "series" in r) setResult(r as MeetingSeriesResult);
                    return ok;
                  }}
                  onClose={() => setDialog(null)}
                />
              ) : null}
            </>
          );
        }}
      </QueryState>
      {result ? <SeriesResultDialog result={result} onClose={() => setResult(null)} /> : null}
    </Section>
  );
}

/** After a create or change: which meetings were kept, cancelled (future, without content) and created. */
function SeriesResultDialog({ result, onClose }: { result: MeetingSeriesResult; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const meetings = useMeetings(ws.tid, { forumId: result.series.forumId });
  const byId = new Map((meetings.data ?? []).map((m) => [m.id, m]));
  const list = (ids: readonly string[], kind: string) => (
    <ul className="plain-list" data-series-result={kind}>
      {ids.length === 0 ? <li className="muted">{t("common.value.none")}</li> : null}
      {ids.map((id) => {
        const m = byId.get(id);
        return (
          <li key={id}>
            <Link className="link" to={`/transformations/${ws.tid}/meetings/${id}`}>
              {m ? formatBusinessDate(m.scheduledDate, locale) : t("governanceP4.meetings.meeting")}
            </Link>{" "}
            {m ? <MeetingStatusText status={m.status} /> : null}
          </li>
        );
      })}
    </ul>
  );
  return (
    <Dialog
      title={t("governanceP4.series.resultTitle")}
      onClose={onClose}
      footer={
        <button type="button" className="button button--primary" onClick={onClose}>
          {t("governanceP4.close")}
        </button>
      }
    >
      <p>{t("governanceP4.series.futureOnly")}</p>
      {result.generationUnknownReason ? (
        <p className="banner banner--warning" role="note">
          <Icon name="alert" /> {t("governanceP4.series.noCalendar")}
        </p>
      ) : null}
      <h3>{t("governanceP4.series.kept", { count: result.keptMeetingIds.length })}</h3>
      {list(result.keptMeetingIds, "kept")}
      <h3>{t("governanceP4.series.cancelled", { count: result.cancelledMeetingIds.length })}</h3>
      {list(result.cancelledMeetingIds, "cancelled")}
      <h3>{t("governanceP4.series.created", { count: result.createdMeetingIds.length })}</h3>
      <p data-series-result="created-count">
        {t("governanceP4.series.createdBody", { count: result.createdMeetingIds.length })}
      </p>
    </Dialog>
  );
}
