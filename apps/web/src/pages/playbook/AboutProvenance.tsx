// The provenance statement on the About page (T-DG5-FE-G; REQ-PB-001; ADR-0049 §5): block B0004 verbatim (with its
// provisional Arabic), and a link to "About this methodology" in the reader with the foundations and custom extensions.
// A failed read shows nothing extra: the About page's own texts stay, and no statement is ever invented here.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useMethodologyProvenance } from "./api.ts";
import { SourceText } from "./ui.tsx";

export function AboutProvenance() {
  const { t } = useTranslation();
  const provenance = useMethodologyProvenance();
  if (!provenance.data) return null;
  return (
    <section className="card" aria-labelledby="about-provenance" data-about-provenance="">
      <h2 id="about-provenance" className="card__title">
        {t("playbookP5.about.statement")}
      </h2>
      <SourceText block={provenance.data.statement} testId="about-statement" />
      <p>
        <Link className="link" to="/playbook/reader#about">
          {t("playbookP5.about.title")}
        </Link>
      </p>
    </section>
  );
}
