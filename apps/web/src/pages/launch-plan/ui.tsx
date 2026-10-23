// Shared UI of the FE-F screens (T-DG5-FE-F; p5-plan §5.1 row FE-F; slices G and H): the 90-day launch plan, the
// Day-90 leadership test, the health check, the scoring schemes, KPI restatement, formula preview and the optional
// financial metrics.
//  - Every text is `launchHealthP5.*` in en and ar; problem codes are translated through `problems.*` (the code is the
//    i18n key, ADR-0007), with this namespace's `problem.*` overrides first.
//  - Status chips always carry a text label and an icon (never colour alone; blue never means favourable). Unknown,
//    Stale, Not computable and Incomplete are neutral chips, never green and never zero.
//  - Every action goes through the guarded FE-D runner (If-Match from the record the user saw, session-bound, one
//    form-level alert per form, a 409/422 reloads the data).
//  - Nothing here is a business approval made by an agent or a job, and nothing names the engineering gates DG0–DG7.
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useAllTransformations } from "../../api/queries.ts";
import { Icon } from "../../components/Icon.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { FormAlert } from "../my-work/p4ui.tsx";
import { Chip, useRunner, type Runner } from "../automation/ui.tsx";

/** The i18n namespace of every FE-F text (en and ar; `launchHealthP5.problem.*` overrides come before `problems.*`). */
export const FEF_NS = ["launchHealthP5"] as const;

/** The guarded runner of the FE-D screens, with the FE-F namespace in its one form-level alert. */
export function useFefRunner(refresh: () => Promise<unknown>): Runner {
  const runner = useRunner(refresh);
  return { ...runner, alert: <FormAlert error={runner.error} namespaces={FEF_NS} /> };
}

/**
 * Completion of a test or an assessment: "Complete (6/6)" or "Incomplete (5/6)" (REQ-S14-002, REQ-PB-087). Incomplete
 * is a neutral chip with a text label, never a score of zero.
 */
export function CompletionChip({ answered, total, complete }: { answered: number; total: number; complete: boolean }) {
  const { t } = useTranslation();
  return complete ? (
    <Chip
      tone="good"
      icon="check"
      label={t("launchHealthP5.completion.complete", { answered, total })}
      data="complete"
    />
  ) : (
    <Chip
      tone="neutral"
      icon="question"
      label={t("launchHealthP5.completion.incomplete", { answered, total })}
      data="incomplete"
    />
  );
}

/** A neutral "Not computable" / "Unknown" value: never 0, never green. */
export function NotComputable({ reason }: { reason?: string | null }) {
  const { t } = useTranslation();
  return (
    <span className="status-chip status-chip--unknown status-chip--wrap" data-value="not-computable">
      <Icon name="question" /> <span>{t("launchHealthP5.notComputable")}</span>
      {reason ? <span className="small"> ({reason})</span> : null}
    </span>
  );
}

/** The note that an Arabic source text is a provisional translation of the English verbatim source (D-142 Q5). */
export function ProvisionalTranslationNote() {
  const { t, i18n } = useTranslation();
  if (i18n.language !== "ar") return null;
  return (
    <p className="banner banner--info" role="note" data-state="provisional-translation">
      <Icon name="info" /> {t("launchHealthP5.provisionalTranslation")}
    </p>
  );
}

/** A notice banner (role note) with an icon. */
export function Notice({ state, children }: { state: string; children: ReactNode }) {
  return (
    <p className="banner banner--info" role="note" data-state={state}>
      <Icon name="info" /> {children}
    </p>
  );
}

/** The entry of a transformation-scoped screen from the navigation: the visible transformations, each a link. */
export function TransformationPicker({ segment, title }: { segment: string; title: string }) {
  const { t } = useTranslation();
  // D-181: every transformation the user may see (all pages), most recently updated first.
  const list = useAllTransformations({ sort: "updatedAt:desc" });
  return (
    <section className="card" aria-labelledby="fef-entry-title">
      <h2 id="fef-entry-title" className="card__title">
        {title}
      </h2>
      <p>{t("launchHealthP5.entry.body")}</p>
      <QueryState
        query={list}
        isEmpty={(items) => items.length === 0}
        empty={<EmptyState title={t("transformations.emptyTitle")} body={t("transformations.emptyBody")} />}
      >
        {(items) => (
          <ul className="plain-list entry-list" data-entry={segment}>
            {items.map((tr) => (
              <li key={tr.id}>
                <Link className="link" to={`/transformations/${tr.id}/${segment}`}>
                  <bdi dir="ltr" className="code">
                    {tr.code}
                  </bdi>{" "}
                  {tr.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </section>
  );
}

/** Today's business date in Asia/Riyadh (the default zone), as YYYY-MM-DD. */
export function todayRiyadh(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
}
