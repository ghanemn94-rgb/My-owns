// The "at a glance" regions of the home page (T-DG6-FE-F2; REQ-S15-001; ADR-0061 §4.1; M0290 "Show decisions, outcomes
// and next actions prominently"). Three labelled regions — key decisions, key outcomes and next actions — sit directly
// under the page header, so at 1440 × 900 all three are above the fold in English and Arabic. They show ONLY data the
// page already loads (`getMyWork`, the same query as the sections below, deduplicated by React Query), or their
// designed empty state; nothing is computed here and nothing is written.
//  - Each region is a <section> with role "region" and an accessible name from the catalogue (`myWork.home.*`), plus a
//    stable `data-glance-region` hook ("decisions", "outcomes", "next-actions") for the acceptance tests.
//  - The region names differ from the section titles below ("Approvals", "Missing updates", …) and from the executive
//    page's Template 10 area cards ("Decisions", "Outcomes"), so every region name on a page is unique.
//  - Loading is a plain busy note (not a role="status" live region; see MyWorkPage's Pending), an error is an
//    "unavailable" note with the sections below as the fallback, and an empty region says what it would hold.
//  - "Business approval" is the product's own G1–G6 decision, never an engineering delivery gate (S-7).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MyWork, MyWorkItem, MyWorkSection } from "@mth/shared/schemas";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { useMyWorkDashboard } from "../dashboards/api.ts";
import { useItemText } from "../dashboards/MyWorkSections.tsx";
import { RecordLink } from "../dashboards/ui.tsx";
import { DueDate } from "./p4ui.tsx";

export type GlanceKind = "decisions" | "outcomes" | "next-actions";

/** How many records a region lists; the rest are in the sections below (each region links to them). */
export const GLANCE_ITEMS = 3;

/** The row of three regions. A plain grid (`grid--3`): three columns at desktop widths, stacked on a phone. */
export function GlanceBand({ children, page }: { children: ReactNode; page: "my-work" | "executive-overview" }) {
  return (
    <div className="grid grid--3 glance-band" data-glance-band={page}>
      {children}
    </div>
  );
}

/** One labelled region: icon + heading (its accessible name), one-line intro, content. */
export function GlanceRegion({
  kind,
  idPrefix,
  title,
  intro,
  icon,
  children,
}: {
  kind: GlanceKind;
  idPrefix: string;
  title: string;
  intro: string;
  icon: IconName;
  children: ReactNode;
}) {
  const id = `${idPrefix}-${kind}`;
  return (
    // An explicit role keeps the region in the accessibility tree even before its heading renders (jsdom, older AT).
    <section className="card glance" role="region" id={id} aria-labelledby={`${id}-title`} data-glance-region={kind}>
      <h2 id={`${id}-title`} className="card__title">
        <Icon name={icon} /> {title}
      </h2>
      <p className="small muted">{intro}</p>
      {children}
    </section>
  );
}

/** The busy and unavailable notes of a region (no live region: the landing page's sign-out status must win). */
export function GlanceNote({ state }: { state: "loading" | "unavailable" }) {
  const { t } = useTranslation();
  if (state === "loading")
    return (
      <p className="muted small" aria-busy="true" data-state="loading">
        {t("common.state.loading")}
      </p>
    );
  return (
    <p className="small" data-state="glance-unavailable">
      <Icon name="info" /> {t("myWork.home.unavailable")}
    </p>
  );
}

/** A region's designed empty state: never a blank box. */
export function GlanceEmpty({ text }: { text: string }) {
  return (
    <p className="muted small" data-state="glance-empty">
      {text}
    </p>
  );
}

function section(d: MyWork, s: MyWorkSection) {
  return d.sections.find((x) => x.section === s) ?? { section: s, total: 0, items: [], nextCursor: null };
}

/** The first records of a list, each a link with its due date (Unknown when null, never a guessed date). */
function GlanceList({ items, list }: { items: readonly MyWorkItem[]; list: string }) {
  const { t } = useTranslation();
  const text = useItemText();
  return (
    <ul className="plain-list glance__list" data-glance-list={list}>
      {items.slice(0, GLANCE_ITEMS).map((i) => (
        <li key={`${i.source}-${i.recordId}-${i.kind ?? ""}`} data-glance-item={i.recordId}>
          <RecordLink href={i.href} contextTid={i.transformationId}>
            {text(i)}
          </RecordLink>
          <span className="block small muted">
            <DueDate date={i.dueDate} />
          </span>
          {i.overdue ? (
            <>
              {" "}
              <span className="status-chip status-chip--off-track" data-overdue="true">
                <Icon name="alert" /> {t("dashboards.myWork.overdue")}
              </span>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** A count with a link to its full section below ("#mw-<section>"). */
function SectionCount({ section: s, label, total }: { section: MyWorkSection; label: string; total: number }) {
  const { t } = useTranslation();
  return (
    <p className="small" data-glance-count={s} data-total={total}>
      <strong>{label}</strong>{" "}
      <a className="link" href={`#mw-${s}`}>
        {t("myWork.home.showSection", { section: t(`dashboards.myWork.section.${s}`) })}
      </a>
    </p>
  );
}

/** The three regions of My Work, from `getMyWork`. */
export function MyWorkHomeRegions() {
  const { t } = useTranslation();
  const query = useMyWorkDashboard();
  const state = query.isPending ? "loading" : query.isError && !query.data ? "unavailable" : null;
  const d = query.data;
  const regions: { kind: GlanceKind; icon: IconName; body: () => ReactNode }[] = [
    {
      kind: "decisions",
      icon: "check",
      body: () => {
        const approvals = section(d!, "approvals");
        if (approvals.total === 0) return <GlanceEmpty text={t("myWork.home.decisions.empty")} />;
        return (
          <>
            <SectionCount
              section="approvals"
              total={approvals.total}
              label={t("myWork.home.decisions.count", { count: approvals.total })}
            />
            <GlanceList items={approvals.items} list="decisions" />
          </>
        );
      },
    },
    {
      kind: "outcomes",
      icon: "dot",
      body: () => {
        const owed = section(d!, "missing_updates");
        const reviews = section(d!, "reviews");
        if (owed.total === 0 && reviews.total === 0) return <GlanceEmpty text={t("myWork.home.outcomes.empty")} />;
        return (
          <>
            <SectionCount
              section="missing_updates"
              total={owed.total}
              label={t("myWork.home.outcomes.owed", { count: owed.total })}
            />
            <SectionCount
              section="reviews"
              total={reviews.total}
              label={t("myWork.home.outcomes.reviews", { count: reviews.total })}
            />
            <GlanceList items={[...owed.items, ...reviews.items]} list="outcomes" />
          </>
        );
      },
    },
    {
      kind: "next-actions",
      icon: "clock",
      body: () => {
        const assigned = section(d!, "assigned_actions");
        // The next deadlines (the server's horizon list, earliest first); without one, the assigned actions.
        const next = d!.upcomingDeadlines.length > 0 ? d!.upcomingDeadlines : assigned.items;
        if (next.length === 0 && assigned.total === 0) return <GlanceEmpty text={t("myWork.home.nextActions.empty")} />;
        return (
          <>
            <SectionCount
              section="assigned_actions"
              total={assigned.total}
              label={t("myWork.home.nextActions.assigned", { count: assigned.total })}
            />
            <GlanceList items={next} list="next-actions" />
          </>
        );
      },
    },
  ];
  return (
    <GlanceBand page="my-work">
      {regions.map((r) => (
        <GlanceRegion
          key={r.kind}
          kind={r.kind}
          idPrefix="home"
          icon={r.icon}
          title={t(`myWork.home.${regionKey(r.kind)}.title`)}
          intro={t(`myWork.home.${regionKey(r.kind)}.intro`)}
        >
          {state ? <GlanceNote state={state} /> : r.body()}
        </GlanceRegion>
      ))}
    </GlanceBand>
  );
}

/** The catalogue key of a region ("next-actions" → "nextActions"). */
export function regionKey(kind: GlanceKind): "decisions" | "outcomes" | "nextActions" {
  return kind === "next-actions" ? "nextActions" : kind;
}
