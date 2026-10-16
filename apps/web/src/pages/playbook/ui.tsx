// Shared pieces of the playbook reader (T-DG5-FE-G; ADR-0049 §1, §3). The verbatim English text is rendered as plain
// text (a table block's Markdown rows as a table); nothing from the server is ever rendered as HTML.
import { useTranslation } from "react-i18next";
import { truncateText } from "@mth/shared/schemas";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { highlightParts, type SearchHighlight, type SourceBlockText } from "./api.ts";

/** Parses the Markdown rows of a table block into cells; a non-table line ends the table. */
export function parseMarkdownTable(text: string): string[][] | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2 || !lines.every((l) => l.startsWith("|"))) return null;
  const rows = lines
    .filter((l) => !/^\|[\s:|-]+\|?$/.test(l))
    .map((l) =>
      l
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim()),
    );
  return rows.length > 0 ? rows : null;
}

/** A block's text: a table block as a table (first row = header), otherwise the text with its line breaks kept. */
export function BlockText({ text, lang, caption }: { text: string; lang: "en" | "ar"; caption: string }) {
  const table = parseMarkdownTable(text);
  const dir = lang === "ar" ? "rtl" : "ltr";
  if (table) {
    const [head, ...body] = table;
    return (
      <div className="table-wrap" tabIndex={0} role="region" aria-label={caption} lang={lang} dir={dir}>
        <table className="table" data-block-table="">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {head!.map((c, i) => (
                <th key={i} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <p className="block-text" lang={lang} dir={dir} style={{ whiteSpace: "pre-wrap" }}>
      {text}
    </p>
  );
}

/** "Provisional translation" label of an Arabic text that has not had a linguistic review. */
export function ProvisionalArabic() {
  const { t } = useTranslation();
  return (
    <span className="badge badge--provisional" data-state="provisional-arabic">
      {t("playbookP5.arProvisional")}
    </span>
  );
}

/**
 * A verbatim source text: in English the verbatim text; in Arabic the provisional translation, labelled, followed by
 * the English verbatim original (the source of truth, REQ-PB-001).
 */
export function SourceText({ block, testId }: { block: SourceBlockText; testId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <div className="source-text" data-source-text={testId} data-block-ref={block.blockRef}>
      {locale === "ar" ? (
        <>
          <p lang="ar" dir="rtl">
            {block.textAr} {block.arProvisional ? <ProvisionalArabic /> : null}
          </p>
          <p className="muted">
            <span className="visually-hidden">{t("playbookP5.verbatimEnglish")}: </span>
            <span lang="en" dir="ltr" data-verbatim="en">
              {block.textEn}
            </span>
          </p>
        </>
      ) : (
        <p lang="en" dir="ltr" data-verbatim="en">
          {block.textEn}
        </p>
      )}
      <p className="muted">
        <Icon name="info" /> {t("playbookP5.sourceRef")} <bdi dir="ltr">{block.blockRef}</bdi>
      </p>
    </div>
  );
}

/** A plain-text snippet with its highlighted matches as <mark> (offsets from the server; no HTML is received). */
export function Snippet({
  text,
  highlights,
  lang,
}: {
  text: string;
  highlights: readonly SearchHighlight[];
  lang: string;
}) {
  return (
    <span lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} data-snippet="">
      {highlightParts(text, highlights).map((p, i) =>
        p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>,
      )}
    </span>
  );
}

/** The first characters of a text, on a word boundary, for list rows. */
export function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = truncateText(flat, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}
