// Contextual help (T-DG6-FE-D; ADR-0057 §9; REQ-S15-010 "contextual help"): a disclosure button that opens the help
// topics of the page's `screenKey` (`listHelpTopics` GET /api/v1/help-topics?screenKey=; any signed-in user, AUD
// included; read-only). Each topic is shown in the interface language; an Arabic text the catalogue marks
// `arabicProvisional` carries the provisional label. Loading, empty and error states are explicit; nothing here
// approves anything.
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../app/locale.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";
import { Icon } from "../Icon.tsx";
import { EmptyState, ErrorState, LoadingState } from "../States.tsx";
import "../saved-views/productivity.css";

/** `HelpTopic` of the contract. */
export interface HelpTopic {
  readonly topicKey: string;
  readonly screenKey: string;
  readonly ordinal: number;
  readonly titleEn: string;
  readonly titleAr: string;
  readonly bodyEn: string;
  readonly bodyAr: string;
  readonly arabicProvisional: boolean;
  readonly sourceRefs: readonly string[];
}

/** The screens that have help topics (0108 seeds; ADR-0057 §9). */
export type HelpScreenKey = "search" | "lists" | "records" | "navigation" | "reports";

export const helpKeys = { screen: (screenKey: string) => ["help-topics", screenKey] as const };

export function useHelpTopics(screenKey: string, enabled: boolean) {
  return useQuery({
    queryKey: helpKeys.screen(screenKey),
    queryFn: () => fetchAllPages<HelpTopic>("/api/v1/help-topics", { screenKey }),
    enabled,
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  });
}

export function HelpPanel({ screenKey }: { screenKey: HelpScreenKey }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const headingId = useId();
  const topics = useHelpTopics(screenKey, open);
  return (
    <div className="help" data-help={screenKey}>
      <button
        type="button"
        className="button button--secondary button--small"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        data-help-toggle
      >
        <Icon name="question" /> {t("productivity.help.open")}
      </button>
      {open ? (
        <section id={panelId} className="help__panel card" aria-labelledby={headingId} data-help-panel>
          <h2 id={headingId} className="help__title">
            {t("productivity.help.title")}
          </h2>
          {topics.isPending ? <LoadingState /> : null}
          {topics.isError ? <ErrorState error={topics.error} onRetry={() => void topics.refetch()} /> : null}
          {topics.data && topics.data.length === 0 ? <EmptyState title={t("productivity.help.empty")} /> : null}
          {topics.data && topics.data.length > 0 ? (
            <ul className="help__list">
              {topics.data.map((topic) => (
                <li key={topic.topicKey} data-help-topic={topic.topicKey}>
                  <h3 className="help__topic-title">{locale === "ar" ? topic.titleAr : topic.titleEn}</h3>
                  <p className="help__body">{locale === "ar" ? topic.bodyAr : topic.bodyEn}</p>
                  {locale === "ar" && topic.arabicProvisional ? (
                    <p className="small muted" data-help-provisional>
                      {t("productivity.help.provisional")}
                    </p>
                  ) : null}
                  <p className="small muted">
                    {t("productivity.help.sources")} <bdi dir="ltr">{topic.sourceRefs.join(", ")}</bdi>
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
