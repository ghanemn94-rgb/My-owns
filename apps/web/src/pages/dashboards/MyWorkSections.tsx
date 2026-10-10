// My Work's sections and upcoming deadlines (T-DG4-FE-G; ADR-0037 §7; REQ-S03-008), read from `getMyWork`: assigned
// actions, drafts, reviews, approvals, missing updates and other items, each with its total, and the upcoming deadlines
// within the organization's horizon (overdue ones flagged). Only the caller's own items exist in the response.
//  - Work items are rendered from `messageKey` + `messageParams` at render time (S-6, `renderMessage`); a draft names
//    its record type and code. A draft is labelled "Draft – not submitted", never as submitted or approved data.
//  - A due date that is null is Unknown, never a guessed date. The horizon is Unknown when no calendar is configured.
//  - Every item links to its record (`href`: the work item's stored link, or the record's path mapped to its screen).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MY_WORK_SECTIONS, type MyWorkItem, type MyWorkSectionPage } from "@mth/shared/schemas";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import { renderMessage } from "../my-work/MyWorkPage.tsx";
import { DueDate } from "../my-work/p4ui.tsx";
import { useMyWorkDashboard, useMyWorkSectionPages } from "./api.ts";
import { RecordLink } from "./ui.tsx";

/** The text of one My Work item: its translated message, or for a draft its record type and code. */
export function useItemText(): (item: MyWorkItem) => string {
  const { t } = useTranslation();
  const locale = useLocale();
  return (item) => {
    if (item.messageKey)
      return renderMessage(
        t,
        locale,
        item.messageKey,
        (item.messageParams ?? {}) as Record<string, string | number | boolean | null>,
        item.kind ?? undefined,
      );
    const type = t(`dashboards.recordType.${item.recordType}`, { defaultValue: item.recordType.replace(/_/g, " ") });
    if (item.source === "draft") return t("dashboards.myWork.draftText", { type, code: item.code ?? item.label ?? "" });
    return [item.code, item.label ?? type].filter(Boolean).join(" ");
  };
}

/** The sections, their totals and the upcoming deadlines. */
export function MyWorkSections() {
  const { t } = useTranslation();
  const query = useMyWorkDashboard();
  // Not the shared role="status" LoadingState: My Work is the landing page, and a polite live region announcing
  // "Loading…" would race with the sign-in page's "You have signed out" status (see MyWorkPage's Pending).
  if (query.isPending)
    return (
      <p className="muted" aria-busy="true" data-state="loading" data-my-work-sections>
        {t("common.state.loading")}
      </p>
    );
  if (query.isError && !query.data)
    return (
      <p className="small" data-state="sections-unavailable" data-my-work-sections>
        <Icon name="info" /> {t("dashboards.myWork.unavailable")}{" "}
        <button type="button" className="button button--link button--small" onClick={() => void query.refetch()}>
          <Icon name="refresh" /> {t("common.action.retry")}
        </button>
      </p>
    );
  const d = query.data!;
  return (
    <div data-my-work-sections>
      <>
        <UpcomingDeadlines items={d.upcomingDeadlines} horizon={d.horizonWorkingDays} businessDate={d.businessDate} />
        <nav className="section-nav" aria-label={t("dashboards.myWork.sectionsNav")}>
          <ul className="section-nav__list">
            {MY_WORK_SECTIONS.map((s) => {
              const page = d.sections.find((x) => x.section === s);
              return (
                <li key={s}>
                  <a className="link" href={`#mw-${s}`} data-section-link={s}>
                    {t(`dashboards.myWork.section.${s}`)}{" "}
                    <span className="lifecycle-chip small" data-section-total={page?.total ?? 0}>
                      {page?.total ?? 0}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        {MY_WORK_SECTIONS.map((s) => {
          const page = d.sections.find((x) => x.section === s) ?? {
            section: s,
            total: 0,
            items: [],
            nextCursor: null,
          };
          return <SectionBlock key={s} page={page} />;
        })}
      </>
    </div>
  );
}

function UpcomingDeadlines({
  items,
  horizon,
  businessDate,
}: {
  items: readonly MyWorkItem[];
  horizon: number;
  businessDate: string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const text = useItemText();
  return (
    <Section
      id="mw-deadlines"
      title={t("dashboards.myWork.deadlines")}
      intro={t("dashboards.myWork.deadlinesIntro", {
        n: horizon,
        date: formatBusinessDate(businessDate, locale) ?? businessDate,
      })}
    >
      {items.length === 0 ? (
        <p className="muted" data-deadlines-empty>
          {t("dashboards.myWork.noDeadlines")}
        </p>
      ) : (
        <ol className="plain-list" data-deadlines={items.length}>
          {items.map((i) => (
            <li key={`${i.source}-${i.recordId}-${i.kind ?? ""}`} data-deadline={i.recordId} data-overdue={i.overdue}>
              <DueDate date={i.dueDate} />{" "}
              {i.overdue ? (
                <span className="status-chip status-chip--off-track">
                  <Icon name="alert" /> {t("dashboards.myWork.overdue")}
                </span>
              ) : null}{" "}
              <RecordLink href={i.href} contextTid={i.transformationId}>
                {text(i)}
              </RecordLink>{" "}
              <span className="small muted">({t(`dashboards.myWork.section.${i.section}`)})</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function SectionBlock({ page }: { page: MyWorkSectionPage }) {
  const { t } = useTranslation();
  const text = useItemText();
  const [cursors, setCursors] = useState<string[]>([]);
  const more = useMyWorkSectionPages(page.section, cursors);
  const extra = more.map((q) => q.data?.sections.find((s) => s.section === page.section));
  const rows = [...page.items, ...extra.flatMap((x) => x?.items ?? [])];
  const last = extra[extra.length - 1];
  const loading = more.some((q) => q.isFetching);
  const nextCursor = cursors.length === 0 ? page.nextCursor : (last?.nextCursor ?? null);
  const columns: RegisterColumn<MyWorkItem>[] = [
    {
      id: "item",
      header: t("dashboards.myWork.item"),
      rowHeader: true,
      hideable: false,
      cell: (i) => (
        <>
          <RecordLink href={i.href} contextTid={i.transformationId}>
            {text(i)}
          </RecordLink>
          {i.source === "draft" ? (
            <span className="lifecycle-chip lifecycle-chip--draft small" data-draft>
              {t("dashboards.myWork.draftLabel")}
            </span>
          ) : null}
        </>
      ),
      sortValue: (i) => text(i),
      filterText: (i) => text(i),
    },
    {
      id: "source",
      header: t("dashboards.myWork.source"),
      cell: (i) => t(`dashboards.myWork.sourceValue.${i.source}`),
      sortValue: (i) => i.source,
    },
    {
      id: "due",
      header: t("dashboards.myWork.due"),
      cell: (i) => (
        <>
          <DueDate date={i.dueDate} />
          {i.overdue ? (
            <span className="status-chip status-chip--off-track" data-overdue="true">
              <Icon name="alert" /> {t("dashboards.myWork.overdue")}
            </span>
          ) : null}
        </>
      ),
      sortValue: (i) => i.dueDate,
    },
  ];
  return (
    <Section
      id={`mw-${page.section}`}
      title={t(`dashboards.myWork.section.${page.section}`)}
      intro={t(`dashboards.myWork.sectionIntro.${page.section}`)}
    >
      <p className="small" data-section={page.section} data-total={page.total}>
        {t("dashboards.myWork.total", { count: page.total, shown: rows.length })}
      </p>
      <RegisterTable
        id={`my-work-${page.section}`}
        caption={t(`dashboards.myWork.section.${page.section}`)}
        rows={rows}
        columns={columns}
        getRowId={(i) => `${i.source}-${i.recordId}-${i.kind ?? ""}`}
        emptyTitle={t("dashboards.myWork.sectionEmpty")}
        defaultSort={{ id: "due", dir: "asc" }}
      />
      {nextCursor ? (
        <button
          type="button"
          className="button button--secondary button--small"
          disabled={loading}
          onClick={() => setCursors((c) => [...c, nextCursor])}
        >
          {t("dashboards.myWork.loadMore")}
        </button>
      ) : null}
    </Section>
  );
}
