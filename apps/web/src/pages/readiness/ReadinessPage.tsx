// Readiness (T-DG3-FE-A; ADR-0021 §4, §5, §9; REQ-PB-007, B0012, B0009, B0032). Read-only early-warning view:
//  - `missingDiagnosticAreas`: the B0012 areas (economics, customer, operations, capability, technology) whose T01
//    dimensions are not yet covered, with the dimensions behind each area;
//  - G1-G4 status. An inherited approval (Modular) shows as "pending verification" until it COUNTS (evidence verified
//    and accepted by another person); a waiver shows as such. Neither is ever shown as an approval of the gate;
//  - the sequencing blockers of submitting and launching initiatives, translated from their codes.
// Nothing is green by default: an area is "covered" only when the server says so.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useReadiness } from "../../api/portfolio.ts";
import type { GateDispensation, TransformationReadiness } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { GateStatusChip } from "../../components/P2Badges.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import { diagnosticDimensionLabel } from "../../lib/methodology.ts";

const codeKey = (code: string) => code.replace(/\./g, "__");

export function ReadinessPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="readiness"
      title={t("readiness.title")}
      subtitle={t("readiness.intro")}
      writePermissions={["initiative.edit", "gate.submit"]}
    >
      <ReadinessBody />
    </WorkspaceFrame>
  );
}

function ReadinessBody() {
  const ws = useWorkspace();
  const readiness = useReadiness(ws.tid);
  return <QueryState query={readiness}>{(r) => <ReadinessView r={r} />}</QueryState>;
}

function ReadinessView({ r }: { r: TransformationReadiness }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="chip-row" data-mode={r.mode}>
        <span>
          {t("readiness.mode")}: <strong>{t(`transformations.mode.${r.mode}`)}</strong>
        </span>
        {r.entryPhase ? (
          <span>
            {t("readiness.entryPhase")}:{" "}
            <strong>{t(`transformations.phase.${r.entryPhase}`, { defaultValue: r.entryPhase })}</strong>
          </span>
        ) : null}
      </p>
      <Sequencing r={r} />
      <Diagnostic r={r} />
      <Gates r={r} />
    </>
  );
}

function Sequencing({ r }: { r: TransformationReadiness }) {
  const { t } = useTranslation();
  const s = r.sequencing;
  const yesNo = (ok: boolean, key: string) => (
    <li data-sequencing={key} data-allowed={ok ? "true" : "false"}>
      <Icon name={ok ? "check" : "cross"} /> {t(`readiness.sequencing.${key}.${ok ? "yes" : "no"}`)}
    </li>
  );
  return (
    <Section id="sequencing" title={t("readiness.sequencing.title")} intro={t("readiness.sequencing.intro")}>
      <ul className="plain-list">
        {yesNo(s.canSubmitInitiatives, "submit")}
        {yesNo(s.canLaunchInitiatives, "launch")}
      </ul>
      {s.blockers.length === 0 ? (
        <p className="muted" data-state="no-blockers">
          {t("readiness.sequencing.noBlockers")}
        </p>
      ) : (
        <div className="banner banner--warning" role="note" data-state="blockers">
          <p>
            <strong>{t("readiness.sequencing.blockersTitle")}</strong>
          </p>
          <ul className="plain-list">
            {s.blockers.map((b) => (
              <li key={b.code} data-blocker={b.code}>
                <Icon name="alert" />{" "}
                {t(`readiness.blocker.${codeKey(b.code)}`, { defaultValue: t("readiness.blocker.generic") })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function Diagnostic({ r }: { r: TransformationReadiness }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const dim = (code: string) => diagnosticDimensionLabel(ws.methodology, code, locale) ?? code;
  return (
    <Section id="diagnostic" title={t("readiness.diagnostic.title")} intro={t("readiness.diagnostic.intro")}>
      {r.missingDiagnosticAreas.length > 0 ? (
        <div className="banner banner--warning" role="note" data-state="missing-areas">
          <p>
            <strong>{t("readiness.diagnostic.missingTitle")}</strong>
          </p>
          <ul className="plain-list" data-missing-areas={r.missingDiagnosticAreas.join(" ")}>
            {r.missingDiagnosticAreas.map((a) => (
              <li key={a} data-missing-area={a}>
                <Icon name="cross" /> {t(`readiness.area.${a}`)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p data-state="all-covered">
          <Icon name="check" /> {t("readiness.diagnostic.allCovered")}
        </p>
      )}
      <div className="table-wrap">
        <table className="table">
          <caption className="visually-hidden">{t("readiness.diagnostic.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("readiness.diagnostic.area")}</th>
              <th scope="col">{t("readiness.diagnostic.coverage")}</th>
              <th scope="col">{t("readiness.diagnostic.dimensions")}</th>
              <th scope="col">{t("readiness.diagnostic.missing")}</th>
            </tr>
          </thead>
          <tbody>
            {r.diagnostic.map((d) => (
              <tr key={d.area} data-area={d.area} data-covered={d.covered ? "true" : "false"}>
                <th scope="row">{t(`readiness.area.${d.area}`)}</th>
                <td>
                  {d.covered ? (
                    <span className="lifecycle-chip">
                      <Icon name="check" /> {t("readiness.diagnostic.covered")}
                    </span>
                  ) : (
                    <span className="status-chip status-chip--off-track">
                      <Icon name="cross" /> {t("readiness.diagnostic.notCovered")}
                    </span>
                  )}
                </td>
                <td>{d.dimensions.map(dim).join(t("readiness.listSeparator"))}</td>
                <td>
                  {d.missing.length === 0 ? (
                    <span className="muted">{t("common.value.none")}</span>
                  ) : (
                    d.missing.map(dim).join(t("readiness.listSeparator"))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        <Link className="link" to={`/transformations/${ws.tid}/diagnose`}>
          {t("readiness.diagnostic.openDiagnose")}
        </Link>
      </p>
    </Section>
  );
}

/** How a dispensation shows in readiness: never as an approval of the gate. */
function DispensationLine({ d }: { d: GateDispensation }) {
  const { t } = useTranslation();
  const locale = useLocale();
  let key: string;
  if (d.kind === "inherited_approval") key = d.counts ? "inheritedCounts" : "inheritedPending";
  else key = d.counts ? "waiverActive" : d.status === "pending" ? "waiverPending" : "waiverInactive";
  return (
    <li data-dispensation={d.kind} data-counts={d.counts ? "true" : "false"} data-dispensation-status={d.status}>
      <Icon name={d.counts ? "info" : "clock"} /> {t(`readiness.dispensation.${key}`, { gate: d.gateCode })}
      {d.kind === "waiver" && d.expiresOn ? (
        <span className="small muted">
          {" "}
          · {t("readiness.dispensation.expires", { date: formatBusinessDate(d.expiresOn, locale) ?? "" })}
        </span>
      ) : null}
    </li>
  );
}

function Gates({ r }: { r: TransformationReadiness }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  return (
    <Section id="gates-status" title={t("readiness.gates.title")} intro={t("readiness.gates.intro")}>
      <div className="table-wrap">
        <table className="table">
          <caption className="visually-hidden">{t("readiness.gates.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("readiness.gates.gate")}</th>
              <th scope="col">{t("readiness.gates.status")}</th>
              <th scope="col">{t("readiness.gates.dispensations")}</th>
            </tr>
          </thead>
          <tbody>
            {r.gates.map((g) => {
              const visible = g.dispensations.filter((d) => d.status === "pending" || d.status === "accepted");
              return (
                <tr key={g.gateCode} data-gate={g.gateCode} data-gate-status={g.status}>
                  <th scope="row">
                    <Link className="link" to={`/transformations/${ws.tid}/gates/${g.gateCode}`}>
                      <bdi dir="ltr">{g.gateCode}</bdi>
                    </Link>
                  </th>
                  <td>
                    <GateStatusChip status={g.status} />
                  </td>
                  <td>
                    {visible.length === 0 ? (
                      <span className="muted">{t("common.value.none")}</span>
                    ) : (
                      <ul className="plain-list">
                        {visible.map((d) => (
                          <DispensationLine key={d.id} d={d} />
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small">
        <Link className="link" to={`/transformations/${ws.tid}/dispensations`}>
          {t("readiness.gates.openDispensations")}
        </Link>
      </p>
    </Section>
  );
}
