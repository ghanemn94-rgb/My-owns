// Administration > Calendar (T-DG4-FE-A; ADR-0025 §1-§2; REQ-S10-006, REQ-S15-008 display side).
//  - Business calendars of the signed-in user's organization: time zone (IANA, default Asia/Riyadh), workweek
//    (1 = Monday … 7 = Sunday; the default is Sunday-Thursday), the default flag, and holidays.
//  - Technical administrators (calendar.configure; ADM_TECH by default) edit; everyone else who can read the
//    organization sees the same screen read-only. Technical administration never grants a business approval.
//  - The working-day calculator calls the server (computeWorkingDayDueDate): it adds N working days, skipping weekends
//    and holidays, and lists the skipped dates. Without a calendar the due date is Unknown, never guessed.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  p4Paths,
  useCalendars,
  useHolidays,
  useP4KeyRefresh,
  useWorkingDayComputation,
  type BusinessCalendar,
  type CalendarHoliday,
} from "../../api/p4.ts";
import { useLocale, localName } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { NoPermissionState, QueryState } from "../../components/States.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import { isNoPermission } from "../../lib/problem.ts";
import { DueDate, P4FormDialog, ReadOnlyNote, textOf, type P4Values } from "../my-work/p4ui.tsx";

const NS = ["calendar"] as const;
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Workweek days as translated names in workweek order (1 = Monday … 7 = Sunday). */
export function workweekText(t: (k: string) => string, days: readonly number[]): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => t(`calendar.weekday.${d}`))
    .join(t("calendar.listSeparator"));
}

export function CalendarPage() {
  const { t } = useTranslation();
  const me = useMe();
  usePageTitle(t("calendar.title"));
  const calendars = useCalendars(me.user.organizationId);
  const canConfigure = canAnywhere(me, "calendar.configure");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const refresh = useP4KeyRefresh();
  const refreshCalendars = () => refresh(["p4", "org", me.user.organizationId, "calendars"]);

  if (calendars.isError && isNoPermission(calendars.error))
    return (
      <div className="page">
        <NoPermissionState error={calendars.error} />
      </div>
    );
  return (
    <div className="page" data-page="calendar">
      <PageHeader
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("calendar.title") }]}
        title={t("calendar.title")}
        subtitle={t("calendar.intro")}
      />
      {canConfigure ? null : <ReadOnlyNote body={t("calendar.readOnly")} />}
      <QueryState query={calendars}>
        {(list) => {
          const selected = list.find((c) => c.id === selectedId) ?? list.find((c) => c.isDefault) ?? list[0] ?? null;
          return (
            <>
              <Section
                id="calendars"
                title={t("calendar.list.title")}
                actions={
                  canConfigure ? (
                    <button
                      type="button"
                      className="button button--primary button--small"
                      onClick={() => setDialog("create")}
                    >
                      <Icon name="plus" /> {t("calendar.create.action")}
                    </button>
                  ) : null
                }
              >
                <CalendarList calendars={list} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
              </Section>
              {selected ? (
                <>
                  <CalendarDetail calendar={selected} canConfigure={canConfigure} onEdit={() => setDialog("edit")} />
                  <HolidaysSection calendar={selected} canConfigure={canConfigure} />
                  <WorkingDayCalculator calendar={selected} />
                </>
              ) : (
                <p className="banner banner--warning" role="status" data-state="no-calendar">
                  <Icon name="alert" /> {t("calendar.none")}
                </p>
              )}
              {dialog === "create" ? (
                <CalendarDialog
                  calendar={null}
                  onDone={refreshCalendars}
                  onClose={() => setDialog(null)}
                  orgId={me.user.organizationId}
                />
              ) : null}
              {dialog === "edit" && selected ? (
                <CalendarDialog
                  calendar={selected}
                  onDone={refreshCalendars}
                  onClose={() => setDialog(null)}
                  orgId={me.user.organizationId}
                />
              ) : null}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}

function CalendarList({
  calendars,
  selectedId,
  onSelect,
}: {
  calendars: readonly BusinessCalendar[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const columns: RegisterColumn<BusinessCalendar>[] = [
    {
      id: "name",
      header: t("calendar.field.name"),
      rowHeader: true,
      hideable: false,
      cell: (c) => (
        <button
          type="button"
          className="button button--link"
          aria-pressed={c.id === selectedId}
          data-calendar={c.code}
          onClick={() => onSelect(c.id)}
        >
          {localName(c, locale)}
        </button>
      ),
      sortValue: (c) => localName(c, locale),
    },
    {
      id: "code",
      header: t("calendar.field.code"),
      cell: (c) => (
        <bdi dir="ltr" className="code">
          {c.code}
        </bdi>
      ),
      sortValue: (c) => c.code,
    },
    {
      id: "timezone",
      header: t("calendar.field.timezone"),
      cell: (c) => <bdi dir="ltr">{c.timezone}</bdi>,
      sortValue: (c) => c.timezone,
    },
    { id: "workweek", header: t("calendar.field.workweek"), cell: (c) => workweekText(t, c.workweek) },
    {
      id: "default",
      header: t("calendar.field.default"),
      cell: (c) =>
        c.isDefault ? (
          <span className="lifecycle-chip" data-default="true">
            <Icon name="check" /> {t("calendar.isDefault")}
          </span>
        ) : (
          <span className="muted">{t("calendar.notDefault")}</span>
        ),
    },
    {
      id: "status",
      header: t("calendar.field.status"),
      cell: (c) => t(`calendar.status.${c.status}`),
      sortValue: (c) => c.status,
    },
  ];
  return (
    <RegisterTable
      id="p4-calendars"
      caption={t("calendar.list.title")}
      rows={calendars}
      columns={columns}
      getRowId={(c) => c.id}
      emptyTitle={t("calendar.list.empty")}
    />
  );
}

function CalendarDetail({
  calendar: c,
  canConfigure,
  onEdit,
}: {
  calendar: BusinessCalendar;
  canConfigure: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <section className="card" aria-labelledby="calendar-detail" data-calendar-detail={c.code}>
      <h2 id="calendar-detail" className="card__title">
        {localName(c, locale)}
      </h2>
      <dl className="details">
        <div>
          <dt>{t("calendar.field.timezone")}</dt>
          <dd>
            <bdi dir="ltr">{c.timezone}</bdi>
          </dd>
        </div>
        <div>
          <dt>{t("calendar.field.workweek")}</dt>
          <dd data-workweek={c.workweek.join(",")}>{workweekText(t, c.workweek)}</dd>
        </div>
        <div>
          <dt>{t("calendar.field.default")}</dt>
          <dd>{c.isDefault ? t("calendar.isDefault") : t("calendar.notDefault")}</dd>
        </div>
        <div>
          <dt>{t("calendar.field.version")}</dt>
          <dd>{c.version}</dd>
        </div>
      </dl>
      {canConfigure ? (
        <div className="form__actions">
          <button type="button" className="button button--secondary" data-action="edit-calendar" onClick={onEdit}>
            <Icon name="pencil" /> {t("calendar.edit.action")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function CalendarDialog({
  calendar,
  orgId,
  onDone,
  onClose,
}: {
  calendar: BusinessCalendar | null;
  orgId: string;
  onDone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const initial: P4Values = calendar
    ? {
        nameEn: calendar.nameEn,
        nameAr: calendar.nameAr,
        timezone: calendar.timezone,
        ...Object.fromEntries(WEEKDAYS.map((d) => [`day${d}`, calendar.workweek.includes(d)])),
      }
    : { timezone: "Asia/Riyadh", ...Object.fromEntries(WEEKDAYS.map((d) => [`day${d}`, d === 7 || d <= 4])) };
  return (
    <P4FormDialog
      title={calendar ? t("calendar.edit.title") : t("calendar.create.title")}
      description={<p>{t("calendar.edit.description")}</p>}
      fields={[
        ...(calendar
          ? []
          : [
              {
                name: "code",
                label: t("calendar.field.code"),
                kind: "text" as const,
                required: true,
                max: 32,
                ltr: true,
                hint: t("calendar.create.codeHint"),
              },
            ]),
        { name: "nameEn", label: t("calendar.field.nameEn"), kind: "text", required: true, max: 200 },
        { name: "nameAr", label: t("calendar.field.nameAr"), kind: "text", required: true, max: 200 },
        {
          name: "timezone",
          label: t("calendar.field.timezone"),
          kind: "text",
          required: true,
          max: 64,
          ltr: true,
          hint: t("calendar.edit.timezoneHint"),
        },
        ...WEEKDAYS.map((d) => ({
          name: `day${d}`,
          label: t("calendar.edit.workday", { day: t(`calendar.weekday.${d}`) }),
          kind: "checkbox" as const,
        })),
        ...(calendar && !calendar.isDefault
          ? [{ name: "makeDefault", label: t("calendar.edit.makeDefault"), kind: "checkbox" as const }]
          : []),
        ...(calendar
          ? [
              {
                name: "status",
                label: t("calendar.field.status"),
                kind: "select" as const,
                required: true,
                options: ["active", "archived"].map((s) => ({ value: s, label: t(`calendar.status.${s}`) })),
              },
            ]
          : []),
      ]}
      initial={calendar ? { ...initial, status: calendar.status } : initial}
      submitLabel={t("common.action.save")}
      method={calendar ? "PATCH" : "POST"}
      url={calendar ? p4Paths.calendar(calendar.id) : p4Paths.orgCalendars(orgId)}
      {...(calendar ? { version: calendar.version } : {})}
      toBody={(v) => {
        const workweek = WEEKDAYS.filter((d) => v[`day${d}`] === true);
        if (workweek.length === 0) return { fieldErrors: { day1: "calendar.workweek_invalid" } };
        const body: Record<string, unknown> = {
          nameEn: textOf(v["nameEn"]),
          nameAr: textOf(v["nameAr"]),
          timezone: String(v["timezone"]).trim(),
          workweek,
        };
        if (!calendar) return { code: String(v["code"]).trim(), ...body };
        if (v["makeDefault"] === true) body["isDefault"] = true;
        if (v["status"] !== calendar.status) body["status"] = v["status"];
        return body;
      }}
      namespaces={NS}
      onDone={onDone}
      onClose={onClose}
    />
  );
}

// ------------------------------------------------------------------------------------------------ holidays

function HolidaysSection({ calendar, canConfigure }: { calendar: BusinessCalendar; canConfigure: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [year, setYear] = useState<number | null>(null);
  const holidays = useHolidays(calendar.id, year);
  const refresh = useP4KeyRefresh();
  const refreshHolidays = () => refresh(["p4", "calendar", calendar.id]);
  const [dialog, setDialog] = useState<CalendarHoliday | "create" | null>(null);
  const thisYear = new Date().getUTCFullYear();
  const columns: RegisterColumn<CalendarHoliday>[] = [
    {
      id: "name",
      header: t("calendar.holiday.name"),
      rowHeader: true,
      hideable: false,
      cell: (h) => localName(h, locale),
      sortValue: (h) => localName(h, locale),
    },
    {
      id: "from",
      header: t("calendar.holiday.from"),
      cell: (h) => formatBusinessDate(h.dateFrom, locale),
      sortValue: (h) => h.dateFrom,
    },
    {
      id: "to",
      header: t("calendar.holiday.to"),
      cell: (h) => formatBusinessDate(h.dateTo, locale),
      sortValue: (h) => h.dateTo,
    },
    {
      id: "status",
      header: t("calendar.field.status"),
      cell: (h) => t(`calendar.holiday.status.${h.status}`),
      sortValue: (h) => h.status,
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (h) =>
        canConfigure ? (
          <button
            type="button"
            className="button button--link button--small"
            data-action="edit-holiday"
            onClick={() => setDialog(h)}
          >
            <Icon name="pencil" /> {t("common.action.edit")}
            <span className="visually-hidden">: {localName(h, locale)}</span>
          </button>
        ) : (
          <span className="muted small">{t("common.readOnly")}</span>
        ),
    },
  ];
  return (
    <Section
      id="holidays"
      title={t("calendar.holiday.title")}
      intro={t("calendar.holiday.intro")}
      actions={
        <span className="p4-chips">
          <label className="p4-inline-field">
            <span>{t("calendar.holiday.year")}</span>
            <select
              value={year === null ? "" : String(year)}
              data-filter="year"
              onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t("calendar.holiday.allYears")}</option>
              {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          {canConfigure ? (
            <button type="button" className="button button--primary button--small" onClick={() => setDialog("create")}>
              <Icon name="plus" /> {t("calendar.holiday.add")}
            </button>
          ) : null}
        </span>
      }
    >
      <QueryState query={holidays}>
        {(rows) => (
          <RegisterTable
            id="p4-holidays"
            caption={t("calendar.holiday.title")}
            rows={rows}
            columns={columns}
            getRowId={(h) => h.id}
            emptyTitle={t("calendar.holiday.empty")}
            defaultSort={{ id: "from", dir: "asc" }}
          />
        )}
      </QueryState>
      {dialog ? (
        <P4FormDialog
          title={dialog === "create" ? t("calendar.holiday.add") : t("calendar.holiday.edit")}
          description={<p>{t("calendar.holiday.rule")}</p>}
          fields={[
            { name: "nameEn", label: t("calendar.field.nameEn"), kind: "text", required: true, max: 200 },
            { name: "nameAr", label: t("calendar.field.nameAr"), kind: "text", required: true, max: 200 },
            { name: "dateFrom", label: t("calendar.holiday.from"), kind: "date", required: true },
            { name: "dateTo", label: t("calendar.holiday.to"), kind: "date", required: true },
            ...(dialog === "create"
              ? []
              : [
                  {
                    name: "status",
                    label: t("calendar.field.status"),
                    kind: "select" as const,
                    required: true,
                    options: ["active", "removed"].map((s) => ({ value: s, label: t(`calendar.holiday.status.${s}`) })),
                  },
                ]),
          ]}
          initial={
            dialog === "create"
              ? {}
              : {
                  nameEn: dialog.nameEn,
                  nameAr: dialog.nameAr,
                  dateFrom: dialog.dateFrom,
                  dateTo: dialog.dateTo,
                  status: dialog.status,
                }
          }
          submitLabel={t("common.action.save")}
          method={dialog === "create" ? "POST" : "PATCH"}
          url={dialog === "create" ? p4Paths.holidays(calendar.id) : p4Paths.holiday(calendar.id, dialog.id)}
          {...(dialog === "create" ? {} : { version: dialog.version })}
          toBody={(v) => {
            if (String(v["dateTo"]) < String(v["dateFrom"]))
              return { fieldErrors: { dateTo: "calendar.holiday_range_invalid" } };
            const body: Record<string, unknown> = {
              nameEn: textOf(v["nameEn"]),
              nameAr: textOf(v["nameAr"]),
              dateFrom: v["dateFrom"],
              dateTo: v["dateTo"],
            };
            if (dialog !== "create" && v["status"] !== dialog.status) body["status"] = v["status"];
            return body;
          }}
          namespaces={NS}
          onDone={refreshHolidays}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ calculator

function WorkingDayCalculator({ calendar }: { calendar: BusinessCalendar }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [from, setFrom] = useState("");
  const [days, setDays] = useState("5");
  const n = /^\d{1,3}$/.test(days) && Number(days) >= 1 && Number(days) <= 250 ? Number(days) : null;
  const result = useWorkingDayComputation(calendar.id, from, n);
  return (
    <Section id="working-days" title={t("calendar.calc.title")} intro={t("calendar.calc.intro")}>
      <div className="grid grid--2">
        <Field label={t("calendar.calc.from")}>
          {(control) => <input {...control} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
        </Field>
        <Field
          label={t("calendar.calc.days")}
          hint={t("calendar.calc.daysHint")}
          error={n === null && days !== "" ? t("calendar.calc.daysInvalid") : undefined}
        >
          {(control) => (
            <input
              {...control}
              type="number"
              min={1}
              max={250}
              step={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          )}
        </Field>
      </div>
      {from && n !== null ? (
        <QueryState query={result}>
          {(r) => (
            <div role="status" data-state="working-days" data-due={r.dueDate ?? "unknown"}>
              <p>
                <strong>{t("calendar.calc.due")}:</strong> <DueDate date={r.dueDate} reason={r.unknownReason} />
              </p>
              {r.skippedDates.length > 0 ? (
                <>
                  <p className="small">{t("calendar.calc.skipped", { count: r.skippedDates.length })}</p>
                  <ul className="plain-list small">
                    {r.skippedDates.map((s) => (
                      <li key={s.date} data-skipped={s.reason}>
                        {formatBusinessDate(s.date, locale)} · {t(`calendar.calc.reason.${s.reason}`)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          )}
        </QueryState>
      ) : (
        <p className="muted">{t("calendar.calc.enter")}</p>
      )}
    </Section>
  );
}
