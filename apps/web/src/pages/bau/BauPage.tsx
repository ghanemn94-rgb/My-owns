// BAU and Improvement > Performance areas (T-DG4-FE-E; p4-work-split §F+G FG.8; ADR-0034 §4). SYNTHETIC data only.
//  - REQ-S03-002: a performance area outlives its (origin) transformation; it keeps its owner, reviews and links.
//  - REQ-S11-009: the area page lists every cycle with the prior accepted handover and the closure it followed, as
//    they were; reopening writes a new cycle and never changes the earlier ones.
//  - `/transformations/:id/performance-areas/:areaId` is the `performance_review_due` / `control_check_due` link.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { PERFORMANCE_AREA_STATUSES, SUSTAIN_FREQUENCIES } from "@mth/shared/schemas";
import { useBusinessUnits } from "../../api/queries.ts";
import { useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { useBenefitRegister } from "../benefits/api.ts";
import { useKpiDictionary } from "../kpi/api.ts";
import { P4FormDialog, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import { useActionRunner } from "../adoption/actions.tsx";
import { sustainPaths, useAreaLinks, usePerformanceArea, usePerformanceAreas, type PerformanceArea } from "./api.ts";
import { ControlsTable, ChecksTable, ReviewsTable } from "./ControlsPage.tsx";
import { HandoversTable } from "./HandoverPage.tsx";
import {
  Code,
  frequencyText,
  NS,
  ScheduledDate,
  StatusText,
  SUSTAIN_WRITE_PERMISSIONS,
  SustainSubNav,
  vocabOptions,
} from "./ui.tsx";

export function BauPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="bau"
      title={t("sustainP4.areas.title")}
      subtitle={t("sustainP4.areas.intro")}
      writePermissions={SUSTAIN_WRITE_PERMISSIONS}
    >
      <AreasBody />
    </WorkspaceFrame>
  );
}

export function AreaPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame tab="bau" title={t("sustainP4.areas.detailTitle")} writePermissions={SUSTAIN_WRITE_PERMISSIONS}>
      <AreaDetail />
    </WorkspaceFrame>
  );
}

function AreasBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [status, setStatus] = useState("");
  const areas = usePerformanceAreas(ws.tid, status ? { status } : {});
  const { byId } = usePeople(ws.tid);
  const [creating, setCreating] = useState(false);
  const columns: RegisterColumn<PerformanceArea>[] = [
    {
      id: "code",
      header: t("sustainP4.col.code"),
      rowHeader: true,
      hideable: false,
      cell: (a) => (
        <Link className="link" to={`/transformations/${ws.tid}/performance-areas/${a.id}`} data-area-link={a.code}>
          <Code>{a.code}</Code>
        </Link>
      ),
      sortValue: (a) => a.code,
    },
    { id: "name", header: t("sustainP4.col.name"), cell: (a) => a.name, sortValue: (a) => a.name },
    {
      id: "status",
      header: t("sustainP4.col.status"),
      cell: (a) => <StatusText status={a.status} />,
      sortValue: (a) => PERFORMANCE_AREA_STATUSES.indexOf(a.status),
      filterText: (a) => t(`sustainP4.status.${a.status}`),
    },
    { id: "cycle", header: t("sustainP4.areas.cycle"), cell: (a) => String(a.cycleNo), sortValue: (a) => a.cycleNo },
    {
      id: "bauOwner",
      header: t("sustainP4.areas.bauOwner"),
      cell: (a) => (a.bauOwnerUserId ? <PersonName id={a.bauOwnerUserId} people={byId} /> : <UnknownOwner />),
    },
    {
      id: "review",
      header: t("sustainP4.areas.reviewCadence"),
      cell: (a) => frequencyText(t, a.reviewFrequency, a.reviewInterval),
    },
    {
      id: "nextReview",
      header: t("sustainP4.areas.nextReview"),
      cell: (a) => <ScheduledDate date={a.nextReviewDate} />,
      sortValue: (a) => a.nextReviewDate,
    },
  ];
  return (
    <>
      <SustainSubNav tid={ws.tid} />
      <Section
        id="performance-areas"
        title={t("sustainP4.areas.tableTitle")}
        intro={t("sustainP4.areas.tableIntro")}
        actions={
          ws.can("performance_area.manage") ? (
            <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> {t("sustainP4.areas.create")}
            </button>
          ) : null
        }
      >
        <div className="filters" role="group" aria-label={t("sustainP4.filters")}>
          <div className="filters__select">
            <label htmlFor="area-filter-status">{t("sustainP4.col.status")}</label>
            <select id="area-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("sustainP4.all")}</option>
              {PERFORMANCE_AREA_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {t(`sustainP4.status.${v}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <QueryState query={areas}>
          {(rows) => (
            <RegisterTable
              id="performance-areas"
              caption={t("sustainP4.areas.tableTitle")}
              rows={rows}
              columns={columns}
              getRowId={(a) => a.id}
              emptyTitle={t("sustainP4.areas.empty")}
              emptyBody={t("sustainP4.areas.emptyBody")}
              defaultSort={{ id: "code", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
      {creating ? <AreaDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}

export function UnknownOwner() {
  const { t } = useTranslation();
  return (
    <span className="status-chip status-chip--unknown" data-owner="unknown">
      <Icon name="question" /> {t("common.value.unknown")}
    </span>
  );
}

function AreaDialog({ area, onClose }: { area?: PerformanceArea; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const units = useBusinessUnits(ws.tr.organizationId);
  const locale = useLocale();
  const fields: P4FieldSpec[] = [
    { name: "name", label: t("sustainP4.col.name"), kind: "text", required: true, max: 200 },
    { name: "description", label: t("sustainP4.field.description"), kind: "textarea", max: 4000 },
    {
      name: "businessUnitId",
      label: t("sustainP4.areas.businessUnit"),
      kind: "select",
      options: (units.data ?? []).map((u) => ({ value: u.id, label: locale === "ar" ? u.nameAr : u.nameEn })),
    },
    {
      name: "sponsorUserId",
      label: t("sustainP4.areas.sponsor"),
      kind: "select",
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    {
      name: "reviewFrequency",
      label: t("sustainP4.areas.reviewFrequency"),
      kind: "select",
      required: true,
      options: vocabOptions(t, "frequency", SUSTAIN_FREQUENCIES),
    },
    {
      name: "reviewInterval",
      label: t("sustainP4.areas.reviewInterval"),
      kind: "number",
      required: true,
      min: 1,
      max: 12,
    },
  ];
  const initial: P4Values = area
    ? {
        name: area.name,
        description: area.description ?? "",
        businessUnitId: area.businessUnitId ?? "",
        sponsorUserId: area.sponsorUserId ?? "",
        reviewFrequency: area.reviewFrequency,
        reviewInterval: String(area.reviewInterval),
      }
    : { reviewFrequency: "monthly", reviewInterval: "1" };
  const build = (v: P4Values): Record<string, unknown> => ({
    name: v["name"],
    description: textOf(v["description"]) ?? null,
    businessUnitId: v["businessUnitId"] ? v["businessUnitId"] : null,
    sponsorUserId: v["sponsorUserId"] ? v["sponsorUserId"] : null,
    reviewFrequency: v["reviewFrequency"],
    reviewInterval: Number(v["reviewInterval"]),
  });
  return (
    <P4FormDialog
      title={area ? t("sustainP4.areas.editTitle", { code: area.code }) : t("sustainP4.areas.create")}
      fields={fields}
      initial={initial}
      submitLabel={area ? t("sustainP4.save") : t("sustainP4.areas.createSubmit")}
      method={area ? "PATCH" : "POST"}
      url={area ? sustainPaths.area(ws.tid, area.id) : sustainPaths.areas(ws.tid)}
      {...(area ? { version: area.version } : {})}
      namespaces={NS}
      toBody={(v) => {
        const body = build(v);
        if (!area) return Object.fromEntries(Object.entries(body).filter(([, x]) => x !== null));
        const before = build(initial);
        const patch = Object.fromEntries(
          Object.entries(body).filter(([k, x]) => JSON.stringify(x) !== JSON.stringify(before[k])),
        );
        return Object.keys(patch).length === 0 ? { fieldErrors: { name: "validation.empty_patch" } } : patch;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function ReasonDialog({
  title,
  intro,
  url,
  version,
  submit,
  onClose,
}: {
  title: string;
  intro: string;
  url: string;
  version: number;
  submit: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  return (
    <P4FormDialog
      title={title}
      description={intro}
      fields={[
        { name: "reason", label: t("sustainP4.field.reason"), kind: "textarea", required: true, min: 3, max: 1000 },
      ]}
      submitLabel={submit}
      url={url}
      version={version}
      namespaces={NS}
      toBody={(v) => ({ reason: v["reason"] })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function AreaDetail() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { areaId = "" } = useParams();
  const query = usePerformanceArea(ws.tid, areaId);
  const { byId } = usePeople(ws.tid);
  const [dialog, setDialog] = useState<"edit" | "reopen" | "retire" | null>(null);
  return (
    <>
      <SustainSubNav tid={ws.tid} />
      <QueryState query={query}>
        {(a) => (
          <>
            <Section
              id="performance-area"
              title={`${a.code} · ${a.name}`}
              intro={a.description ?? undefined}
              actions={
                <span className="chip-row">
                  {ws.can("performance_area.manage") && a.status !== "retired" ? (
                    <button type="button" className="button button--secondary" onClick={() => setDialog("edit")}>
                      <Icon name="pencil" /> {t("sustainP4.edit")}
                    </button>
                  ) : null}
                  {ws.can("performance_area.reopen") && a.status === "bau" ? (
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => setDialog("reopen")}
                      data-reopen
                    >
                      <Icon name="refresh" /> {t("sustainP4.areas.reopen")}
                    </button>
                  ) : null}
                  {ws.can("performance_area.manage") && a.status !== "retired" ? (
                    <button type="button" className="button button--secondary" onClick={() => setDialog("retire")}>
                      <Icon name="archive" /> {t("sustainP4.areas.retire")}
                    </button>
                  ) : null}
                </span>
              }
            >
              <dl className="details" data-area={a.code}>
                <dt>{t("sustainP4.col.status")}</dt>
                <dd>
                  <StatusText status={a.status} />
                </dd>
                <dt>{t("sustainP4.areas.cycle")}</dt>
                <dd>{a.cycleNo}</dd>
                <dt>{t("sustainP4.areas.bauOwner")}</dt>
                <dd>{a.bauOwnerUserId ? <PersonName id={a.bauOwnerUserId} people={byId} /> : <UnknownOwner />}</dd>
                <dt>{t("sustainP4.areas.kpiOwner")}</dt>
                <dd>{a.kpiOwnerUserId ? <PersonName id={a.kpiOwnerUserId} people={byId} /> : <UnknownOwner />}</dd>
                <dt>{t("sustainP4.areas.reviewCadence")}</dt>
                <dd>{frequencyText(t, a.reviewFrequency, a.reviewInterval)}</dd>
                <dt>{t("sustainP4.areas.nextReview")}</dt>
                <dd>
                  <ScheduledDate date={a.nextReviewDate} />
                </dd>
                {a.retireReason ? (
                  <>
                    <dt>{t("sustainP4.areas.retireReason")}</dt>
                    <dd>
                      <TextCell value={a.retireReason} />
                    </dd>
                  </>
                ) : null}
              </dl>
              <p className="small muted">
                <Icon name="info" /> {t("sustainP4.areas.outlives")}
              </p>
            </Section>
            <CycleHistory area={a} />
            <AreaLinks area={a} />
            <Section id="area-handovers" title={t("sustainP4.handover.tableTitle")}>
              <HandoversTable areaId={a.id} area={a} />
            </Section>
            <Section id="area-controls" title={t("sustainP4.controls.tableTitle")}>
              <ControlsTable areaId={a.id} />
            </Section>
            <Section id="area-checks" title={t("sustainP4.checks.tableTitle")}>
              <ChecksTable areaId={a.id} />
            </Section>
            <Section id="area-reviews" title={t("sustainP4.reviews.tableTitle")}>
              <ReviewsTable areaId={a.id} />
            </Section>
            {dialog === "edit" ? <AreaDialog area={a} onClose={() => setDialog(null)} /> : null}
            {dialog === "reopen" ? (
              <ReasonDialog
                title={t("sustainP4.areas.reopenTitle", { code: a.code })}
                intro={t("sustainP4.areas.reopenIntro")}
                url={sustainPaths.areaReopen(ws.tid, a.id)}
                version={a.version}
                submit={t("sustainP4.areas.reopen")}
                onClose={() => setDialog(null)}
              />
            ) : null}
            {dialog === "retire" ? (
              <ReasonDialog
                title={t("sustainP4.areas.retireTitle", { code: a.code })}
                intro={t("sustainP4.areas.retireIntro")}
                url={sustainPaths.areaRetire(ws.tid, a.id)}
                version={a.version}
                submit={t("sustainP4.areas.retire")}
                onClose={() => setDialog(null)}
              />
            ) : null}
          </>
        )}
      </QueryState>
    </>
  );
}

/** Every cycle, with the prior accepted handover and the closure it followed, unchanged (REQ-S11-009). */
function CycleHistory({ area }: { area: PerformanceArea }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const { byId } = usePeople(ws.tid);
  const when = (iso: string | null) => (iso ? (formatDateTime(iso, locale) ?? iso) : null);
  return (
    <Section id="area-cycles" title={t("sustainP4.areas.cyclesTitle")} intro={t("sustainP4.areas.cyclesIntro")}>
      <div className="table-wrap" tabIndex={0} role="region" aria-label={t("sustainP4.areas.cyclesTable")}>
        <table className="table" data-cycles>
          <caption className="visually-hidden">{t("sustainP4.areas.cyclesTitle")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("sustainP4.areas.cycle")}</th>
              <th scope="col">{t("sustainP4.areas.openedAt")}</th>
              <th scope="col">{t("sustainP4.areas.reopenReason")}</th>
              <th scope="col">{t("sustainP4.areas.priorHandover")}</th>
              <th scope="col">{t("sustainP4.areas.priorClosure")}</th>
            </tr>
          </thead>
          <tbody>
            {[...area.cycles]
              .sort((x, y) => x.cycleNo - y.cycleNo)
              .map((c) => (
                <tr key={c.cycleNo} data-cycle={c.cycleNo}>
                  <th scope="row">{c.cycleNo}</th>
                  <td>{when(c.openedAt)}</td>
                  <td>{c.reopenReason ?? <span className="muted">{t("sustainP4.none")}</span>}</td>
                  <td data-prior-handover-accepted={c.priorHandoverAcceptedAt ?? ""}>
                    {c.priorHandoverId ? (
                      <span className="block">
                        <Link className="link" to={`/transformations/${ws.tid}/bau-handovers/${c.priorHandoverId}`}>
                          {t("sustainP4.areas.acceptedOn", { when: when(c.priorHandoverAcceptedAt) ?? "—" })}
                        </Link>
                        {c.priorHandoverAcceptedBy ? (
                          <span className="block small">
                            <PersonName id={c.priorHandoverAcceptedBy} people={byId} />
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="muted">{t("sustainP4.none")}</span>
                    )}
                  </td>
                  <td data-prior-closed={c.priorClosedAt ?? ""}>
                    {c.priorClosedAt ? (
                      t("sustainP4.areas.closedOn", { when: when(c.priorClosedAt) })
                    ) : (
                      <span className="muted">{t("sustainP4.none")}</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function AreaLinks({ area }: { area: PerformanceArea }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const links = useAreaLinks(ws.tid, area.id);
  const kpis = useKpiDictionary(ws.tid);
  const benefits = useBenefitRegister(ws.tid);
  const runner = useActionRunner(ws.tid, NS);
  const [adding, setAdding] = useState(false);
  const refresh = useP4Refresh(ws.tid);
  const canManage = ws.can("performance_area.manage") && area.status !== "retired";
  const kpiName = (id: string | null) => (kpis.data ?? []).find((k) => k.definition.id === id)?.definition.name ?? "—";
  const benefitName = (id: string | null) => {
    const b = (benefits.data ?? []).find((x) => x.id === id);
    return b ? `${b.code} · ${b.title}` : "—";
  };
  return (
    <Section
      id="area-links"
      title={t("sustainP4.links.title")}
      intro={t("sustainP4.links.intro")}
      actions={
        canManage ? (
          <button type="button" className="button button--secondary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> {t("sustainP4.links.add")}
          </button>
        ) : null
      }
    >
      {runner.alert}
      <QueryState query={links}>
        {(rows) =>
          rows.filter((l) => l.status === "active").length === 0 ? (
            <p className="muted">{t("sustainP4.links.empty")}</p>
          ) : (
            <ul className="plain-list" data-area-links>
              {rows
                .filter((l) => l.status === "active")
                .map((l) => (
                  <li key={l.id} className="chip-row">
                    <span>
                      {t(`sustainP4.links.kind.${l.linkKind}`)}:{" "}
                      {l.linkKind === "kpi" ? kpiName(l.kpiDefinitionId) : benefitName(l.benefitId)}
                    </span>
                    {canManage ? (
                      <button
                        type="button"
                        className="button button--link button--small"
                        disabled={runner.busy !== null}
                        onClick={() =>
                          void runner.run(l.id, sustainPaths.areaLinkRemove(ws.tid, area.id, l.id), l.version)
                        }
                      >
                        {t("sustainP4.links.remove")}
                      </button>
                    ) : null}
                  </li>
                ))}
            </ul>
          )
        }
      </QueryState>
      {adding ? (
        <P4FormDialog
          title={t("sustainP4.links.add")}
          fields={[
            {
              name: "linkKind",
              label: t("sustainP4.links.kindLabel"),
              kind: "select",
              required: true,
              options: ["kpi", "benefit"].map((k) => ({ value: k, label: t(`sustainP4.links.kind.${k}`) })),
            },
            {
              name: "kpiDefinitionId",
              label: t("sustainP4.links.kind.kpi"),
              kind: "select",
              required: true,
              options: (kpis.data ?? []).map((k) => ({ value: k.definition.id, label: k.definition.name })),
              when: (v) => v["linkKind"] === "kpi",
            },
            {
              name: "benefitId",
              label: t("sustainP4.links.kind.benefit"),
              kind: "select",
              required: true,
              options: (benefits.data ?? []).map((b) => ({ value: b.id, label: `${b.code} · ${b.title}` })),
              when: (v) => v["linkKind"] === "benefit",
            },
          ]}
          submitLabel={t("sustainP4.links.addSubmit")}
          url={sustainPaths.areaLinks(ws.tid, area.id)}
          namespaces={NS}
          toBody={(v) =>
            v["linkKind"] === "kpi"
              ? { linkKind: "kpi", kpiDefinitionId: v["kpiDefinitionId"] }
              : { linkKind: "benefit", benefitId: v["benefitId"] }
          }
          onDone={refresh}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Section>
  );
}
