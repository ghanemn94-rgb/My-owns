// Product stage gates G1-G6 (REQ-PB-016/017/018, REQ-S04-003…005, REQ-S13-012). These are BUSINESS approvals inside
// the product, recorded by the configured approver; the UI labels them so. P2 enables submission for G1-G3.
// Readiness is the server's LIVE evaluation of every required output: unverified evidence is shown as unverified and
// never completes a criterion that needs verified evidence; failing good-outcome tests are listed at G2.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useGates } from "../../api/queries.ts";
import type { GateView } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { GateStatusChip } from "../../components/P2Badges.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { gateLabel, pick } from "../../lib/methodology.ts";

export function GatesPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="gates"
      title={t("gates.title")}
      subtitle={t("gates.intro")}
      writePermissions={["gate.submit", "gate.decide", "gate.configure"]}
    >
      <BusinessApprovalNote />
      <GateList />
    </WorkspaceFrame>
  );
}

/** States plainly that a product gate is a business approval decided by people, never by this software. */
export function BusinessApprovalNote() {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-business-approval="true">
      <span className="lifecycle-chip">
        <Icon name="lock" /> {t("gates.businessApproval")}
      </span>{" "}
      {t("gates.businessApprovalBody")}
    </p>
  );
}

/** "3 of 5 mandatory required outputs complete" — computed from the live evaluation; nothing is assumed complete. */
export function readiness(view: GateView) {
  const mandatory = view.criteria.filter((c) => c.mandatory);
  const complete = mandatory.filter((c) => c.completeness === "complete").length;
  const unverified = new Set(view.criteria.flatMap((c) => c.unverifiedEvidenceIds)).size;
  return {
    complete,
    total: mandatory.length,
    unverified,
    ready: mandatory.length > 0 && complete === mandatory.length,
  };
}

function GateList() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const gates = useGates(ws.tid);
  return (
    <Section id="gates" title={t("gates.listTitle")}>
      <QueryState query={gates}>
        {(data) => (
          <ol className="gate-list">
            {data.items.map((g) => {
              const r = readiness(g);
              const name = gateLabel(g.definition, locale);
              return (
                <li key={g.gate.id} className="gate-card" data-gate={g.definition.code}>
                  <h3 className="gate-card__title">
                    <Link className="link" to={`/transformations/${ws.tid}/gates/${g.definition.code}`}>
                      {name}
                    </Link>
                  </h3>
                  <p className="muted small">
                    {pick(locale, g.definition.sourceDecisionQuestionEn, g.definition.decisionQuestionAr)}
                  </p>
                  <p className="chip-row">
                    <GateStatusChip status={g.gate.status} />
                    {g.submissionEnabled ? (
                      <span
                        className={`status-chip status-chip--${r.ready ? "on-track" : r.total === 0 ? "unknown" : "off-track"}`}
                        data-readiness={`${r.complete}/${r.total}`}
                      >
                        <Icon name={r.ready ? "check" : "cross"} />{" "}
                        {t("gates.readiness", { complete: r.complete, total: r.total })}
                      </span>
                    ) : (
                      <span className="status-chip status-chip--unknown" data-readiness="not-enabled">
                        <Icon name="clock" /> {t("gates.notEnabled")}
                      </span>
                    )}
                    {r.unverified > 0 ? (
                      <span className="status-chip status-chip--unknown" data-unverified={r.unverified}>
                        <Icon name="question" /> {t("gates.unverifiedCount", { n: r.unverified })}
                      </span>
                    ) : null}
                  </p>
                  <p className="small">
                    {t("gates.approver")}:{" "}
                    {t(`transformations.audit.role.${g.gate.approverRoleCode}`, {
                      defaultValue: g.gate.approverRoleCode,
                    })}
                    {g.currentSubmission ? (
                      <>
                        {" · "}
                        {t("gates.submissionN", { n: g.currentSubmission.submissionNo })}
                      </>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </QueryState>
    </Section>
  );
}
