// Page sections of the workspace screens: a labelled region with a heading, optional actions, and an in-page
// table of contents (anchor links) for long pages. Text cells render missing text as "None", never blank.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { hasText } from "@mth/shared/schemas";

export function Section({
  id,
  title,
  intro,
  actions,
  children,
}: {
  id: string;
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card section" id={id} aria-labelledby={`${id}-title`}>
      <div className="card__header section__header">
        <h2 id={`${id}-title`} className="card__title">
          {title}
        </h2>
        {actions ? <div className="section__actions">{actions}</div> : null}
      </div>
      {intro ? <div className="section__intro muted">{intro}</div> : null}
      {children}
    </section>
  );
}

export function SectionNav({ sections }: { sections: readonly { id: string; title: string }[] }) {
  const { t } = useTranslation();
  return (
    <nav className="section-nav" aria-label={t("common.onThisPage")}>
      <ul className="section-nav__list">
        {sections.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className="link">
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Multi-line user text; "None" when it has no visible content (the shared `hasText`, F-DG2-150 / F-DG2-160). */
export function TextCell({ value }: { value: string | null | undefined }) {
  const { t } = useTranslation();
  if (!hasText(value)) return <span className="muted">{t("common.value.none")}</span>;
  return <span className="text-cell">{value}</span>;
}
