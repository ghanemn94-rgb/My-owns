// The "at a glance" regions of the executive page (T-DG6-FE-F2; REQ-S15-001; ADR-0061 §4.1; M0290). Key decisions, key
// outcomes and next actions sit directly under the page header, above the filters, so at 1440 × 900 all three are above
// the fold in English and Arabic. They show ONLY what `getExecutiveOverview` already returned for the page (the same
// response the six Template 10 area cards below render); nothing is recomputed in the web:
//  - Key decisions: the Decisions area's status chip (icon + label, never colour alone) and its headlines as returned.
//  - Key outcomes: the Outcomes area's status chip and its headlines. Unknown and Stale stay Unknown and Stale (the
//    shared ValueView and RagStatusChip), never 0 or green.
//  - Next actions: the open decisions and blockers (the Decisions and Dependencies areas' records) that carry a due
//    date, earliest first; the first three, each a link to its record.
// The drill-downs, the status logic and every record stay in the area cards below (a note says so).
import { useTranslation } from "react-i18next";
import type { DashboardHeadline, DashboardItem, ExecutiveOverview, T10Area, T10AreaCode } from "@mth/shared/schemas";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import { RagStatusChip, RecordLink, ValueView, areaTitle, keyText } from "../dashboards/ui.tsx";
import {
  GLANCE_ITEMS,
  GlanceBand,
  GlanceEmpty,
  GlanceNote,
  GlanceRegion,
  regionKey,
  type GlanceKind,
} from "../my-work/HomeRegions.tsx";

/** The headlines of one area as returned: label and value (Unknown/Stale/Not applicable as the server states them). */
function Headlines({ area, kind }: { area: T10Area; kind: GlanceKind }) {
  const { t } = useTranslation();
  if (area.headlines.length === 0) return <GlanceEmpty text={t("dashboards.area.noHeadline")} />;
  return (
    <dl className="details details--compact" data-glance-headlines={kind}>
      {area.headlines.map((h: DashboardHeadline, n) => (
        <div key={`${h.metric}-${h.headlineBasis ?? ""}-${n}`} data-glance-metric={h.metric}>
          <dt>{keyText(t, "headline", h.labelKey)}</dt>
          <dd>
            <ValueView value={h.value} strong />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AreaStatus({ area }: { area: T10Area }) {
  const locale = useLocale();
  return (
    <p className="small" data-glance-area={area.code} data-glance-rag={area.rag.status}>
      <RagStatusChip status={area.rag.status} prefix={areaTitle(area, locale)} />
    </p>
  );
}

/** The dated open decisions and blockers, earliest first (records without a due date are left to the cards below). */
export function nextActionItems(d: ExecutiveOverview): { area: T10Area; item: DashboardItem }[] {
  const from: T10AreaCode[] = ["decisions", "dependencies"];
  return d.areas
    .filter((a) => from.includes(a.code))
    .flatMap((area) => area.items.filter((i) => i.dueDate).map((item) => ({ area, item })))
    .sort((a, b) => (a.item.dueDate! < b.item.dueDate! ? -1 : a.item.dueDate! > b.item.dueDate! ? 1 : 0));
}

export function ExecutiveHomeRegions({
  data,
  state,
}: {
  data: ExecutiveOverview | undefined;
  state: "loading" | "unavailable" | null;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const area = (code: T10AreaCode) => data?.areas.find((a) => a.code === code);
  const body = (kind: GlanceKind) => {
    if (state || !data) return <GlanceNote state={state ?? "loading"} />;
    if (kind === "next-actions") {
      const next = nextActionItems(data);
      if (next.length === 0) return <GlanceEmpty text={t("myWork.home.executive.nextActions.empty")} />;
      return (
        <ul className="plain-list glance__list" data-glance-list="next-actions">
          {next.slice(0, GLANCE_ITEMS).map(({ area: a, item: i }) => (
            <li key={`${i.recordType}-${i.recordId}`} data-glance-item={i.recordId}>
              <RecordLink href={i.href}>
                {i.code ? (
                  <bdi dir="ltr" className="code">
                    {i.code}
                  </bdi>
                ) : null}{" "}
                <bdi>{i.label ?? t(`dashboards.recordType.${i.recordType}`, { defaultValue: i.recordType })}</bdi>
              </RecordLink>
              <span className="block small muted">
                <bdi data-due={i.dueDate}>{formatBusinessDate(i.dueDate, locale)}</bdi> · {areaTitle(a, locale)}
              </span>
              {i.rag ? (
                <>
                  {" "}
                  <RagStatusChip status={i.rag} />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      );
    }
    const a = area(kind === "decisions" ? "decisions" : "outcomes");
    if (!a) return <GlanceNote state="unavailable" />;
    return (
      <>
        <AreaStatus area={a} />
        <Headlines area={a} kind={kind} />
      </>
    );
  };
  const kinds: { kind: GlanceKind; icon: "check" | "dot" | "clock" }[] = [
    { kind: "decisions", icon: "check" },
    { kind: "outcomes", icon: "dot" },
    { kind: "next-actions", icon: "clock" },
  ];
  return (
    <>
      <GlanceBand page="executive-overview">
        {kinds.map((k) => (
          <GlanceRegion
            key={k.kind}
            kind={k.kind}
            idPrefix="executive"
            icon={k.icon}
            title={t(`myWork.home.${regionKey(k.kind)}.title`)}
            intro={t(`myWork.home.executive.${regionKey(k.kind)}.intro`)}
          >
            {body(k.kind)}
          </GlanceRegion>
        ))}
      </GlanceBand>
      <p className="small muted" data-glance-note>
        <Icon name="info" /> {t("myWork.home.executive.note")}
      </p>
    </>
  );
}
