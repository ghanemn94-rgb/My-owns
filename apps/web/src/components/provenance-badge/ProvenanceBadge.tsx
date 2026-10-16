// The provenance badge and the guiding-question tag (T-DG5-FE-G; ADR-0049 §2, §4; REQ-PB-002, REQ-PB-011, REQ-S02-004).
//  - The badge says, in words and with an icon (never colour alone), whether an element is a custom extension of the
//    playbook v1.0 (B0158–B0162) or inspired by the PMI/Brightline/BRM foundations (B0156). It never says "PMI
//    standard", "official" or "certified" (M0089).
//  - The question tag names the one B0016 question a template answers.
//  - `TemplateProvenance` is the form-header strip: the template's badge, its question tag and its "Source" links back to
//    the playbook blocks that define it (listTemplateSourceLinks; T01 -> B0031). It reads only; it approves nothing.
// Labels are render-time i18n keys (`playbookP5.provenance.<value>`, `playbookP5.question.<code>`), in en and ar.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  useMethodologyElements,
  useTemplateSourceLinks,
  type Provenance,
  type QuestionCode,
} from "../../pages/playbook/api.ts";
import { Icon } from "../Icon.tsx";

export function ProvenanceBadge({ provenance, overridden }: { provenance: Provenance; overridden?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className="lifecycle-chip"
      data-provenance={provenance}
      title={overridden ? t("playbookP5.provenance.overriddenHint") : undefined}
    >
      <Icon name={provenance === "custom_extension" ? "pencil" : "info"} /> {t(`playbookP5.provenance.${provenance}`)}
      {overridden ? <span className="visually-hidden"> ({t("playbookP5.provenance.overriddenHint")})</span> : null}
    </span>
  );
}

export function QuestionTag({ code }: { code: QuestionCode }) {
  const { t } = useTranslation();
  return (
    <span className="lifecycle-chip lifecycle-chip--draft" data-question-tag={code}>
      <Icon name="question" /> <span className="visually-hidden">{t("playbookP5.question.label")}: </span>
      {t(`playbookP5.question.${code}`)}
    </span>
  );
}

/**
 * The form-header strip of a numbered template (T01–T16): provenance badge, question tag and the source links to the
 * playbook reader. A failed read shows nothing extra (the form itself stays usable); it never shows a wrong badge.
 */
export function TemplateProvenance({ templateCode }: { templateCode: string }) {
  const { t } = useTranslation();
  const profiles = useMethodologyElements({ kind: "template" });
  const links = useTemplateSourceLinks(templateCode);
  const profile = profiles.data?.items.find(
    (p) => p.stableKey === templateCode || p.elementRef.endsWith(`.${templateCode}`),
  );
  const sources = links.data?.items ?? [];
  if (!profile && sources.length === 0) return null;
  return (
    <p className="template-provenance" data-template-provenance={templateCode}>
      {profile ? <ProvenanceBadge provenance={profile.provenance} overridden={profile.overridden} /> : null}{" "}
      {profile?.questionTag ? <QuestionTag code={profile.questionTag} /> : null}{" "}
      {sources.length > 0 ? (
        <span data-source-links={templateCode}>
          {t("playbookP5.source.label")}{" "}
          {sources.map((s, i) => (
            <span key={s.blockRef}>
              {i > 0 ? ", " : null}
              <Link className="link" to={`/playbook/reader/${s.blockRef}`} data-source-link={s.blockRef}>
                <bdi dir="ltr">{s.blockRef}</bdi>
              </Link>
            </span>
          ))}
        </span>
      ) : null}
    </p>
  );
}
