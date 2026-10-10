// Modular entry (T-DG4-FE-G2; p4-work-split §J+K JK.7; ADR-0038 §7 and amendments B1-B4; BE-M2, BE-R3).
// SYNTHETIC data only in tests and demos.
//  - Missing links (REQ-PB-005): the baseline and outcome links a Modular transformation must reconnect, blocking ones
//    first, each with a link to where it is supplied; the Modular-links waiver (a G3 waiver with no initiative) is shown
//    when one is in force. A waiver never supplies the links; it only lets G3 be submitted (ADR-0021 W1-W7).
//  - Gate labels (REQ-S03-005, ADR-0038 §7.2): "approved" only for a platform approval; an inherited prior approval is
//    "Inherited", never "Approved".
//  - Inherited records: evidence items and baselines recorded as inherited, with provenance, read one by one
//    (`getInheritedRecord`), and withdrawn with a reason. Prior approvals are read-only entries: they are inherited gate
//    approvals (DG3 dispensations) and are recorded there, never here. Every entry carries the label
//    "Inherited - recorded, not granted in platform" (Arabic provisional). Nothing here creates a gate decision or
//    grants any business approval.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { INHERITED_LABEL_TEXT } from "@mth/shared/schemas";
import { useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { GateStatusChip } from "../../components/P2Badges.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import { DueDate, P4FormDialog, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import {
  tracePaths,
  useBaselineOptions,
  useDispensations,
  useEvidenceOptions,
  useInheritedRecord,
  useInheritedRecords,
  useMissingLinks,
  type GateDispensation,
  type InheritedRecord,
  type MissingLinks,
} from "./api.ts";
import { apiHrefToWebPath, NS, ReasonAction, StatusTag, TraceSubNav } from "./ui.tsx";

export function ModularEntryPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="modular-entry"
      title={t("traceability.modular.title")}
      subtitle={t("traceability.modular.intro")}
      writePermissions={["inherited_record.record"]}
    >
      <ModularBody />
    </WorkspaceFrame>
  );
}

/** Today's date (YYYY-MM-DD) in a time zone; the server's business date decides, this only labels the waiver. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      now,
    );
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * The Modular-links waiver in force (ADR-0038 B1): an accepted G3 waiver with no initiative whose expiry date is on or
 * after the business date (inclusive); the latest expiry wins, ties by the newest id. Null when none is in force.
 */
export function modularWaiverInForce(rows: readonly GateDispensation[], businessDate: string): GateDispensation | null {
  const inForce = rows.filter(
    (d) =>
      d.kind === "waiver" &&
      d.gateCode === "G3" &&
      d.initiativeId === null &&
      d.status === "accepted" &&
      d.expiresOn !== null &&
      d.expiresOn >= businessDate,
  );
  inForce.sort((a, b) => (b.expiresOn! > a.expiresOn! ? 1 : b.expiresOn! < a.expiresOn! ? -1 : b.id > a.id ? 1 : -1));
  return inForce[0] ?? null;
}

function ModularBody() {
  const ws = useWorkspace();
  const missing = useMissingLinks(ws.tid);
  return (
    <>
      <TraceSubNav tid={ws.tid} />
      <QueryState query={missing}>{(m) => <MissingLinksView m={m} />}</QueryState>
      <InheritedRecordsSection />
    </>
  );
}

function MissingLinksView({ m }: { m: MissingLinks }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const dispensations = useDispensations(ws.tid);
  const businessDate = todayIn(ws.tr.timezone);
  const waiver = dispensations.data ? modularWaiverInForce(dispensations.data, businessDate) : null;
  const blocking = m.items.filter((i) => i.severity === "blocking");
  const warnings = m.items.filter((i) => i.severity === "warning");
  const modular = m.mode === "modular";
  return (
    <>
      <Section id="modular-mode" title={t("traceability.modular.modeTitle")}>
        <p data-mode={m.mode} data-entry-phase={m.entryPhase ?? ""}>
          {t(`traceability.modular.mode.${m.mode}`, { defaultValue: m.mode })}
          {m.entryPhase
            ? ` · ${t("traceability.modular.entryPhase")}: ${t(`transformations.phase.${m.entryPhase}`)}`
            : ""}
        </p>
        {!modular ? (
          <p className="banner banner--info" role="note" data-not-modular>
            <Icon name="info" /> {t("traceability.modular.notModular")}
          </p>
        ) : null}
      </Section>
      <Section
        id="modular-gates"
        title={t("traceability.modular.gatesTitle")}
        intro={t("traceability.modular.gatesIntro")}
      >
        <div className="table-wrap">
          <table className="table table--compact" data-gate-labels>
            <caption className="visually-hidden">{t("traceability.modular.gatesTitle")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("traceability.modular.gate")}</th>
                <th scope="col">{t("traceability.modular.label")}</th>
                <th scope="col">{t("traceability.modular.gateStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {m.gates.map((g) => (
                <tr key={g.gateCode} data-gate={g.gateCode} data-gate-label={g.label}>
                  <th scope="row">
                    <Link className="link" to={`/transformations/${ws.tid}/gates/${g.gateCode}`}>
                      <bdi dir="ltr">{g.gateCode}</bdi>
                    </Link>
                  </th>
                  <td>
                    {g.label === "approved" ? (
                      <StatusTag tone="ok">{t("traceability.gateLabel.approved")}</StatusTag>
                    ) : g.label === "inherited" ? (
                      <StatusTag tone="info" wrap>
                        {/* The canonical label text once (it already starts with "Inherited"). */}
                        {t("traceability.inheritedLabel")}
                      </StatusTag>
                    ) : g.label === "inherited_pending_verification" ? (
                      <StatusTag tone="warn" wrap>
                        {t("traceability.gateLabel.inherited_pending_verification")}
                      </StatusTag>
                    ) : (
                      <GateStatusChip status={g.label} />
                    )}
                  </td>
                  <td>
                    <GateStatusChip status={g.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">{t("traceability.modular.businessApproval")}</p>
      </Section>
      <Section
        id="modular-missing"
        title={t("traceability.modular.missingTitle")}
        intro={t("traceability.modular.missingIntro")}
      >
        {blocking.length === 0 ? (
          <p data-blocking="0">
            <StatusTag tone="ok" wrap>
              {t("traceability.modular.noBlocking")}
            </StatusTag>
          </p>
        ) : (
          <>
            <p data-blocking={blocking.length}>
              <StatusTag tone="block">{t("traceability.modular.blockingCount", { n: blocking.length })}</StatusTag>
            </p>
            {modular ? (
              waiver ? (
                <p
                  className="banner banner--info"
                  role="note"
                  data-waiver={waiver.id}
                  data-waiver-expires={waiver.expiresOn}
                >
                  <Icon name="info" />{" "}
                  {t("traceability.modular.waiverInForce", {
                    date: formatBusinessDate(waiver.expiresOn, locale) ?? waiver.expiresOn,
                  })}{" "}
                  <TextCell value={waiver.reason} />
                </p>
              ) : dispensations.isError ? (
                <p className="small muted" data-waiver="unknown">
                  {t("traceability.modular.waiverUnknown")}
                </p>
              ) : (
                <p className="small" data-waiver="none">
                  {t("traceability.modular.noWaiver")}{" "}
                  <Link className="link" to={`/transformations/${ws.tid}/dispensations`}>
                    {t("traceability.modular.openDispensations")}
                  </Link>
                </p>
              )
            ) : null}
          </>
        )}
        {m.items.length === 0 ? (
          <p className="muted" data-missing-empty>
            {t("traceability.modular.noMissing")}
          </p>
        ) : (
          <ul className="plain-list" data-missing-items={m.items.length}>
            {[...blocking, ...warnings].map((i, n) => {
              const to = apiHrefToWebPath(i.href, ws.tid);
              return (
                <li key={`${i.code}-${i.recordId ?? n}`} data-missing={i.code} data-severity={i.severity}>
                  <StatusTag tone={i.severity === "blocking" ? "block" : "warn"}>
                    {t(`traceability.severity.${i.severity}`)}
                  </StatusTag>{" "}
                  <strong>{t(`traceability.missingCode.${i.code}`)}</strong>
                  {i.label ? <span> · {i.label}</span> : null}{" "}
                  {to ? (
                    <Link className="link" to={to}>
                      {t("traceability.modular.supply")}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ inherited records

function InheritedRecordsSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const list = useInheritedRecords(ws.tid, includeRemoved);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<InheritedRecord | null>(null);
  const canRecord = ws.can("inherited_record.record") && ws.tr.mode === "modular";
  const columns: RegisterColumn<InheritedRecord>[] = [
    {
      id: "kind",
      header: t("traceability.inherited.kind"),
      rowHeader: true,
      hideable: false,
      cell: (r) => t(`traceability.inherited.kindName.${r.kind}`),
      sortValue: (r) => r.kind,
      filterText: (r) => t(`traceability.inherited.kindName.${r.kind}`),
    },
    {
      id: "label",
      header: t("traceability.modular.label"),
      hideable: false,
      cell: () => (
        <span data-inherited-label>
          <StatusTag tone="info" wrap>
            {t("traceability.inheritedLabel")}
          </StatusTag>
        </span>
      ),
    },
    {
      id: "source",
      header: t("traceability.inherited.source"),
      cell: (r) =>
        r.kind === "prior_approval" ? (
          <span>
            {r.gateCode ? <bdi dir="ltr">{r.gateCode}</bdi> : null} · <TextCell value={r.approvingBody} />
          </span>
        ) : (
          <TextCell value={r.sourceDescription} />
        ),
    },
    {
      id: "date",
      header: t("traceability.inherited.originalDate"),
      cell: (r) =>
        r.originalDate ? <DueDate date={r.originalDate} /> : <span className="muted">{t("traceability.unknown")}</span>,
      sortValue: (r) => r.originalDate,
    },
    {
      id: "status",
      header: t("traceability.col.status"),
      cell: (r) => (
        <span className="block">
          {t(`traceability.inherited.status.${r.status}`, { defaultValue: r.status })}
          {r.withdrawReason ? <span className="block small">{r.withdrawReason}</span> : null}
        </span>
      ),
      sortValue: (r) => r.status,
    },
    {
      id: "rowActions",
      header: t("traceability.col.actions"),
      hideable: false,
      cell: (r) =>
        r.kind === "prior_approval" ? (
          <Link className="link" to={`/transformations/${ws.tid}/dispensations`} data-prior-approval={r.id}>
            {t("traceability.inherited.openDispensation")}
          </Link>
        ) : (
          <span className="chip-row">
            <button
              type="button"
              className="button button--secondary button--small"
              data-action="view-inherited"
              onClick={() => setViewing(r.id)}
            >
              {t("traceability.inherited.view")}
            </button>
            {canRecord && r.status === "active" ? (
              <button
                type="button"
                className="button button--secondary button--small"
                data-action="withdraw-inherited"
                onClick={() => setWithdrawing(r)}
              >
                <Icon name="archive" /> {t("traceability.inherited.withdraw")}
              </button>
            ) : null}
          </span>
        ),
    },
  ];
  return (
    <Section
      id="modular-inherited"
      title={t("traceability.inherited.title")}
      intro={t("traceability.inherited.intro")}
      actions={
        canRecord ? (
          <button
            type="button"
            className="button button--primary"
            data-action="create-inherited"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" /> {t("traceability.inherited.create")}
          </button>
        ) : null
      }
    >
      {locale === "ar" ? (
        <p className="small muted" data-provisional>
          {t("traceability.provisionalAr", { en: INHERITED_LABEL_TEXT.en })}
        </p>
      ) : null}
      <label className="checkbox">
        <input type="checkbox" checked={includeRemoved} onChange={(e) => setIncludeRemoved(e.target.checked)} />{" "}
        {t("traceability.inherited.includeWithdrawn")}
      </label>
      <QueryState query={list}>
        {(rows) => (
          <RegisterTable
            id="inherited-records"
            caption={t("traceability.inherited.title")}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            emptyTitle={t("traceability.inherited.empty")}
            defaultSort={{ id: "kind", dir: "asc" }}
          />
        )}
      </QueryState>
      {viewing ? <InheritedRecordView id={viewing} onClose={() => setViewing(null)} /> : null}
      {creating ? <InheritedRecordDialog onClose={() => setCreating(false)} /> : null}
      {withdrawing ? (
        <ReasonAction
          title={t("traceability.inherited.withdrawTitle")}
          description={t("traceability.inherited.withdrawBody")}
          submitLabel={t("traceability.inherited.withdraw")}
          url={tracePaths.withdrawInherited(ws.tid, withdrawing.id)}
          version={withdrawing.version}
          onDone={refresh}
          onClose={() => setWithdrawing(null)}
        />
      ) : null}
    </Section>
  );
}

/** One inherited record read through `getInheritedRecord` (active or withdrawn), with its provenance. */
function InheritedRecordView({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const one = useInheritedRecord(ws.tid, id);
  return (
    <div className="card" role="region" aria-labelledby="inherited-view-title" data-inherited-view={id}>
      <div className="card__header">
        <h3 id="inherited-view-title" className="card__subtitle">
          {t("traceability.inherited.viewTitle")}
        </h3>
        <button type="button" className="button button--secondary button--small" onClick={onClose}>
          {t("traceability.close")}
        </button>
      </div>
      <QueryState query={one}>
        {(r) => (
          <dl>
            <dt>{t("traceability.modular.label")}</dt>
            <dd>
              <StatusTag tone="info" wrap>
                {t("traceability.inheritedLabel")}
              </StatusTag>
            </dd>
            <dt>{t("traceability.inherited.kind")}</dt>
            <dd>{t(`traceability.inherited.kindName.${r.kind}`)}</dd>
            <dt>{t("traceability.inherited.record")}</dt>
            <dd>
              {r.evidenceId ? (
                <Link className="link" to={`/transformations/${ws.tid}/evidence`}>
                  {t("traceability.inherited.openEvidence")}
                </Link>
              ) : r.baselineId ? (
                <Link className="link" to={`/transformations/${ws.tid}/define`}>
                  {t("traceability.inherited.openBaseline")}
                </Link>
              ) : (
                <span className="muted">{t("traceability.unknown")}</span>
              )}
            </dd>
            <dt>{t("traceability.inherited.source")}</dt>
            <dd>
              <TextCell value={r.sourceDescription} />
            </dd>
            <dt>{t("traceability.inherited.originalOwner")}</dt>
            <dd>
              {r.originalOwner ? (
                <TextCell value={r.originalOwner} />
              ) : (
                <span className="muted">{t("traceability.unknown")}</span>
              )}
            </dd>
            <dt>{t("traceability.inherited.originalDate")}</dt>
            <dd>
              {r.originalDate ? (
                <DueDate date={r.originalDate} />
              ) : (
                <span className="muted">{t("traceability.unknown")}</span>
              )}
            </dd>
            <dt>{t("traceability.col.status")}</dt>
            <dd data-inherited-status={r.status}>
              {t(`traceability.inherited.status.${r.status}`, { defaultValue: r.status })}
              {r.withdrawReason ? ` · ${r.withdrawReason}` : ""}
            </dd>
          </dl>
        )}
      </QueryState>
    </div>
  );
}

function InheritedRecordDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const [kind, setKind] = useState("evidence");
  const evidence = useEvidenceOptions(ws.tid, kind === "evidence");
  const baselines = useBaselineOptions(ws.tid, kind === "baseline");
  const fields: P4FieldSpec[] = [
    {
      name: "kind",
      label: t("traceability.inherited.kind"),
      kind: "select",
      required: true,
      options: (["evidence", "baseline"] as const).map((k) => ({
        value: k,
        label: t(`traceability.inherited.kindName.${k}`),
      })),
    },
    {
      name: "evidenceId",
      label: t("traceability.inherited.kindName.evidence"),
      kind: "select",
      required: true,
      options: (evidence.data ?? []).filter((e) => e.status === "active").map((e) => ({ value: e.id, label: e.title })),
      when: (v) => v["kind"] === "evidence",
    },
    {
      name: "baselineId",
      label: t("traceability.inherited.kindName.baseline"),
      kind: "select",
      required: true,
      options: (baselines.data ?? []).map((b) => ({ value: b.id, label: b.metric })),
      when: (v) => v["kind"] === "baseline",
    },
    {
      name: "sourceDescription",
      label: t("traceability.inherited.source"),
      hint: t("traceability.inherited.sourceHint"),
      kind: "textarea",
      required: true,
      min: 3,
      max: 2000,
    },
    { name: "originalOwner", label: t("traceability.inherited.originalOwner"), kind: "text", max: 300 },
    { name: "originalDate", label: t("traceability.inherited.originalDate"), kind: "date" },
  ];
  return (
    <P4FormDialog
      title={t("traceability.inherited.create")}
      note={
        <p className="small" role="note">
          <Icon name="info" /> {t("traceability.inherited.createNote")}
        </p>
      }
      fields={fields}
      initial={{ kind: "evidence" } satisfies P4Values}
      submitLabel={t("traceability.inherited.createSubmit")}
      method="POST"
      url={tracePaths.inherited(ws.tid)}
      namespaces={NS}
      onValuesChange={(v) => setKind(String(v["kind"] ?? ""))}
      toBody={(v) => ({
        kind: v["kind"],
        ...(v["kind"] === "evidence" ? { evidenceId: v["evidenceId"] } : { baselineId: v["baselineId"] }),
        sourceDescription: v["sourceDescription"],
        ...(textOf(v["originalOwner"]) ? { originalOwner: v["originalOwner"] } : {}),
        ...(v["originalDate"] ? { originalDate: v["originalDate"] } : {}),
      })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}
