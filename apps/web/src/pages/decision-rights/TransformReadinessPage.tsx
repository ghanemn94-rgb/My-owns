// Governance > Readiness (Transform) (T-DG4-FE-A; ADR-0026 §9; REQ-PB-008 display side). Read-only.
// Lists what is missing before the Transform phase: the charter's decision rights, the four seeded T11 decisions, the
// approver of every T11 row mapped to a person or group, and exactly one accountable per T12 deliverable. "Ready" is
// shown only when the server says every check passed; an unloadable answer is an error, never "ready".
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useTransformReadiness } from "../../api/p4.ts";
import { Icon } from "../../components/Icon.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";

const FIX_TAB: Record<string, string> = {
  charter_decision_rights: "charter",
  t11_seeded_decisions: "decision-rights",
  t11_approvers_mapped: "role-mappings",
  t12_accountable: "raci",
};

export function TransformReadinessPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="transform-readiness"
      title={t("decisionRights.readiness.title")}
      subtitle={t("decisionRights.readiness.intro")}
      writePermissions={[]}
    >
      <Readiness />
    </WorkspaceFrame>
  );
}

function Readiness() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const readiness = useTransformReadiness(ws.tid);
  return (
    <QueryState query={readiness}>
      {(r) => (
        <>
          <p
            className={`banner ${r.status === "ready" ? "banner--info" : "banner--warning"}`}
            role="status"
            data-readiness={r.status}
          >
            <Icon name={r.status === "ready" ? "check" : "alert"} />{" "}
            <strong>{t(`decisionRights.readiness.status.${r.status}`)}</strong>
          </p>
          <Section id="checks" title={t("decisionRights.readiness.checks")}>
            <ul className="plain-list">
              {r.checks.map((c) => (
                <li key={c.code} data-check={c.code} data-passed={String(c.passed)}>
                  <span className={`status-chip ${c.passed ? "status-chip--on-track" : "status-chip--off-track"}`}>
                    <Icon name={c.passed ? "check" : "cross"} />{" "}
                    {c.passed ? t("decisionRights.readiness.passed") : t("decisionRights.readiness.missing")}
                  </span>{" "}
                  {t(`decisionRights.readiness.check.${c.code}`)}
                  {c.missing.length > 0 ? (
                    <ul className="small">
                      {c.missing.map((m) => (
                        <li key={m}>
                          <bdi dir="ltr" className="code">
                            {m}
                          </bdi>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {!c.passed && FIX_TAB[c.code] ? (
                    <span className="block small">
                      <Link className="link" to={`/transformations/${ws.tid}/${FIX_TAB[c.code]}`}>
                        {t("decisionRights.readiness.fix")}
                      </Link>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </QueryState>
  );
}
