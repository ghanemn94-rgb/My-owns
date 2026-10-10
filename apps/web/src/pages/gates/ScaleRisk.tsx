// G5 scale transitions and risk dispositions (T-DG4-FE-F2; p4-work-split §H H.6; ADR-0035 §2, §5, §6, §8, §11; BE-K;
// the FE-F handback "What remains" item 3). SYNTHETIC data only in tests and demos.
//  - REQ-S03-004 / REQ-S04-007: "Scale an initiative" is offered to the Lead whenever they may scale; before the G5
//    business approval the server refuses it 422 `gate.g5_not_approved` and the screen shows the translated refusal,
//    which names G5; outside the approved scale scope it is refused `scale.outside_approved_scope`. The screen never
//    filters the choices to the scope, so the server's rule is what the user meets.
//  - REQ-PB-020: a G5 submission is refused while an open High-impact risk is neither closed nor dispositioned. Here a
//    Lead, Business Owner or Workstream Lead proposes a disposition (accept, transfer, carry into BAU) for an open risk;
//    it is decided by a person other than the proposer in the business approval (`/my-work/approvals/{id}`). Only an
//    approved disposition completes the "Risk closure" criterion; a pending one is shown as pending, never as closed.
// G1-G6 are business approvals inside the product; nothing here touches the engineering gates DG0-DG7.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { RISK_DISPOSITIONS, type RiskDisposition, type ScaleTransition } from "@mth/shared/schemas";
import { p4Keys, useP4Refresh } from "../../api/p4.ts";
import { useInitiatives } from "../../api/portfolio.ts";
import { fetchAllPages, shouldRetry, useBusinessUnits } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { pick } from "../../lib/methodology.ts";
import { BusinessApprovalNote, P4FormDialog, textOf } from "../my-work/p4ui.tsx";
import type { RaidEntry } from "../raid/api.ts";
import { GATE_NS } from "./GateP4.tsx";

const tBase = (tid: string) => `/api/v1/transformations/${tid}`;
export const scaleRiskPaths = {
  transitions: (tid: string) => `${tBase(tid)}/scale-transitions`, // listScaleTransitions / createScaleTransition
  dispositions: (tid: string) => `${tBase(tid)}/risk-dispositions`, // listRiskDispositions / createRiskDisposition
  raid: (tid: string) => `${tBase(tid)}/raid`, // listRaidEntries
} as const;

const opts = { retry: shouldRetry, staleTime: 10_000 } as const;

export function useScaleTransitions(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("gate-exceptions", tid, "scale-transitions"),
    queryFn: () => fetchAllPages<ScaleTransition>(scaleRiskPaths.transitions(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useRiskDispositions(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("gate-exceptions", tid, "risk-dispositions"),
    queryFn: () => fetchAllPages<RiskDisposition>(scaleRiskPaths.dispositions(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

/** Open risks of the transformation (type risk, not closed), High impact first. */
export function useOpenRisks(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("gate-exceptions", tid, "open-risks"),
    queryFn: async () =>
      (await fetchAllPages<RaidEntry>(scaleRiskPaths.raid(tid), { type: "risk" })).filter(
        (r) => r.type === "risk" && r.status !== "closed",
      ),
    enabled: Boolean(tid),
    ...opts,
  });
}

/** The units offered: the organization's (where readable) plus the transformation's own unit. */
function useUnitOptions() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const locale = useLocale();
  const units = useBusinessUnits(ws.tr.organizationId);
  const own = ws.tr.businessUnitId;
  const list = [
    ...(units.data ?? []).map((u) => ({ value: u.id, label: pick(locale, u.nameEn, u.nameAr) })),
    ...((units.data ?? []).some((u) => u.id === own) ? [] : [{ value: own, label: t("gates.scale.ownUnit") }]),
  ];
  const name = (id: string) => list.find((u) => u.value === id)?.label ?? t("gates.scale.unitNotVisible");
  return { list, name };
}

export function ScaleTransitionsSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const list = useScaleTransitions(ws.tid);
  const initiatives = useInitiatives(ws.tid);
  const units = useUnitOptions();
  const { byId } = usePeople(ws.tid);
  const refresh = useP4Refresh(ws.tid);
  const [open, setOpen] = useState(false);
  const canScale = ws.can("scale.transition");
  const iniName = (id: string) => {
    const i = (initiatives.data ?? []).find((x) => x.id === id);
    return i ? `${i.code} ${i.name}` : t("gates.scale.initiativeNotVisible");
  };
  return (
    <Section
      id="scale-transitions"
      title={t("gates.scaleTransition.title")}
      intro={t("gates.scaleTransition.intro")}
      actions={
        canScale ? (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setOpen(true)}
            data-action="scale-initiative"
          >
            <Icon name="plus" /> {t("gates.scaleTransition.create")}
          </button>
        ) : null
      }
    >
      <QueryState
        query={list}
        isEmpty={(l) => l.length === 0}
        empty={<EmptyState title={t("gates.scaleTransition.empty")} />}
      >
        {(rows) => (
          <ul className="plain-list" data-scale-transitions={rows.length}>
            {rows.map((r) => (
              <li key={r.id} data-scale-transition={`${r.initiativeId}:${r.businessUnitId}`}>
                <Icon name="check" /> <bdi>{iniName(r.initiativeId)}</bdi> · {units.name(r.businessUnitId)}
                <span className="block small muted">
                  {formatDateTime(r.transitionedAt, locale, ws.tr.timezone)} ·{" "}
                  <PersonName id={r.transitionedBy} people={byId} />
                </span>
                {r.note ? <span className="block small">{r.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      {open ? (
        <P4FormDialog
          title={t("gates.scaleTransition.create")}
          description={t("gates.scaleTransition.formIntro")}
          fields={[
            {
              name: "initiativeId",
              label: t("gates.scaleTransition.initiative"),
              kind: "select",
              required: true,
              options: (initiatives.data ?? [])
                .filter((i) => i.status !== "cancelled")
                .map((i) => ({ value: i.id, label: `${i.code} ${i.name}` })),
            },
            {
              name: "businessUnitId",
              label: t("gates.scaleTransition.unit"),
              kind: "select",
              required: true,
              options: units.list,
            },
            { name: "note", label: t("gates.scaleTransition.note"), kind: "textarea", max: 2000 },
          ]}
          submitLabel={t("gates.scaleTransition.submit")}
          url={scaleRiskPaths.transitions(ws.tid)}
          namespaces={GATE_NS}
          toBody={(v) => {
            const note = textOf(v["note"]);
            return {
              initiativeId: v["initiativeId"],
              businessUnitId: v["businessUnitId"],
              ...(note ? { note } : {}),
            };
          }}
          onDone={refresh}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Section>
  );
}

const APPROVAL_ICON: Record<string, "check" | "clock" | "cross" | "refresh"> = {
  approved: "check",
  pending: "clock",
  deferred: "clock",
  changes_requested: "refresh",
  rejected: "cross",
  withdrawn: "cross",
};

export function RiskDispositionsSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const risks = useOpenRisks(ws.tid);
  const list = useRiskDispositions(ws.tid);
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP4Refresh(ws.tid);
  const [open, setOpen] = useState<string | null>(null);
  const canPropose = ws.can("risk_disposition.propose");
  const dispositionsOf = (riskId: string) => (list.data ?? []).filter((d) => d.raidEntryId === riskId);
  const allRisks = risks.data ?? [];
  return (
    <Section id="risk-dispositions" title={t("gates.riskDisposition.title")} intro={t("gates.riskDisposition.intro")}>
      <BusinessApprovalNote body={t("gates.riskDisposition.businessApproval")} />
      <QueryState
        query={risks}
        isEmpty={(l) => l.length === 0}
        empty={<EmptyState title={t("gates.riskDisposition.noOpenRisks")} />}
      >
        {(rows) => (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("gates.tableRegion.dispositions")}>
            <table className="table table--compact" data-open-risks={rows.length}>
              <caption className="visually-hidden">{t("gates.riskDisposition.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("gates.riskDisposition.risk")}</th>
                  <th scope="col">{t("gates.riskDisposition.impact")}</th>
                  <th scope="col">{t("gates.riskDisposition.dispositions")}</th>
                  <th scope="col">{t("common.field.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {[...rows]
                  .sort(
                    (a, b) =>
                      (a.impact === "high" ? 0 : 1) - (b.impact === "high" ? 0 : 1) || a.code.localeCompare(b.code),
                  )
                  .map((r) => {
                    const ds = dispositionsOf(r.id);
                    const approved = ds.some((d) => d.approvalStatus === "approved");
                    return (
                      <tr key={r.id} data-risk={r.code} data-risk-dispositioned={approved ? "true" : "false"}>
                        <th scope="row">
                          <bdi dir="ltr" className="code">
                            {r.code}
                          </bdi>{" "}
                          <TextCell value={r.description} />
                        </th>
                        <td data-impact={r.impact ?? "unknown"}>
                          {r.impact ? t(`gates.riskDisposition.level.${r.impact}`) : t("common.value.unknown")}
                          {r.impact === "high" ? (
                            <span className="block small">
                              <Icon name="alert" /> {t("gates.riskDisposition.material")}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {ds.length === 0 ? (
                            <span className="status-chip status-chip--unknown" data-disposition="none">
                              <Icon name="question" /> {t("gates.riskDisposition.none")}
                            </span>
                          ) : (
                            <ul className="plain-list small">
                              {ds.map((d) => (
                                <li
                                  key={d.id}
                                  data-disposition={d.disposition}
                                  data-approval-status={d.approvalStatus ?? "none"}
                                >
                                  <Icon name={APPROVAL_ICON[d.approvalStatus ?? "pending"] ?? "clock"} />{" "}
                                  <strong>{t(`gates.riskDisposition.kind.${d.disposition}`)}</strong> ·{" "}
                                  {t(`gates.riskDisposition.approval.${d.approvalStatus ?? "none"}`)}
                                  <span className="block muted">
                                    {t("gates.riskDisposition.residualOwner")}:{" "}
                                    <PersonName id={d.residualOwnerUserId} people={byId} /> ·{" "}
                                    {formatDateTime(d.createdAt, locale, ws.tr.timezone)}
                                  </span>
                                  <span className="block">{d.rationale}</span>
                                  {d.approvalId ? (
                                    <Link className="link" to={`/my-work/approvals/${d.approvalId}`}>
                                      {t("gates.riskDisposition.openApproval")}
                                    </Link>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td>
                          {canPropose && !approved ? (
                            <button
                              type="button"
                              className="button button--link button--small"
                              onClick={() => setOpen(r.id)}
                              data-action="propose-disposition"
                            >
                              <Icon name="plus" /> {t("gates.riskDisposition.propose")}
                              <span className="visually-hidden"> {r.code}</span>
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
      {open ? (
        <P4FormDialog
          title={t("gates.riskDisposition.proposeTitle", {
            code: allRisks.find((r) => r.id === open)?.code ?? "",
          })}
          description={t("gates.riskDisposition.formIntro")}
          fields={[
            {
              name: "disposition",
              label: t("gates.riskDisposition.disposition"),
              kind: "select",
              required: true,
              options: RISK_DISPOSITIONS.map((d) => ({ value: d, label: t(`gates.riskDisposition.kind.${d}`) })),
            },
            {
              name: "residualOwnerUserId",
              label: t("gates.riskDisposition.residualOwner"),
              kind: "select",
              required: true,
              options: people.map((p) => ({ value: p.id, label: p.label })),
            },
            {
              name: "rationale",
              label: t("gates.riskDisposition.rationale"),
              kind: "textarea",
              required: true,
              min: 3,
              max: 4000,
            },
          ]}
          submitLabel={t("gates.riskDisposition.submit")}
          url={scaleRiskPaths.dispositions(ws.tid)}
          namespaces={GATE_NS}
          toBody={(v) => ({
            raidEntryId: open,
            disposition: v["disposition"],
            residualOwnerUserId: v["residualOwnerUserId"],
            rationale: v["rationale"],
          })}
          onDone={refresh}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </Section>
  );
}

/** Both slice H actions of the G5 page, with the requests they make visible in one place. */
export function G5ScaleAndRisk() {
  return (
    <>
      <RiskDispositionsSection />
      <ScaleTransitionsSection />
    </>
  );
}
