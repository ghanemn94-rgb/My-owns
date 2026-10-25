// Shared pieces of the playbook reader (T-DG5-FE-G; ADR-0049 §1, §3). The verbatim English text is rendered as plain
// text (a table block's Markdown rows as a table); nothing from the server is ever rendered as HTML.
// T-DG5-FE-RG1 (F-DG5-122): a table block is never shown as raw Markdown anywhere in the reader. The About panel's
// source texts (B0024 is a table block) are rendered with BlockText; list excerpts and search snippets show the cells
// as text ("·" between cells, ";" between rows); a `<br>` in a cell (B0003) is a line break element, never HTML; and a
// one-cell callout table (B0016, B0124) wraps inside the page instead of being one unwrapped header line.
import { Fragment, type ReactNode } from "react";
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

const BR = /<br\s*\/?>/i;

/** A cell's text with each `<br>` of the source as a line break element (React elements; the text is never HTML). */
export function cellContent(cell: string): ReactNode {
  const lines = cell.split(new RegExp(BR.source, "gi"));
  if (lines.length === 1) return cell;
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 ? <br /> : null}
      {line}
    </Fragment>
  ));
}

/** A one-cell table block (a callout such as B0016 "Rule of thumb" or B0124 "PMI BRM connection"). */
export const isCalloutTable = (table: readonly (readonly string[])[]): boolean =>
  table.length === 1 && table[0]!.length === 1;

/**
 * The text of a block for list rows: a table block's cells as text ("·" between cells, ";" between rows, a `<br>` as a
 * space), never its Markdown; any other text unchanged.
 */
export function plainBlockText(text: string): string {
  const table = parseMarkdownTable(text);
  if (!table) return text;
  return table.map((row) => row.map((c) => c.replace(new RegExp(BR.source, "gi"), " ").trim()).join(" · ")).join("; ");
}

/**
 * One piece of a search snippet (a window of the source text, perhaps cut inside a table) without Markdown table
 * syntax: separator rows dropped, cell pipes as "·", `<br>` as a space. Offsets of the highlights are applied BEFORE
 * this (per piece), so the marks stay on the matched words. `first` / `last` trim a leading / trailing separator.
 */
export function plainSnippetPiece(text: string, first: boolean, last: boolean): string {
  if (!text.includes("|") && !BR.test(text)) return text;
  let out = text
    .replace(new RegExp(BR.source, "gi"), " ")
    .replace(/\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+/g, " ")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/(?:\s*·\s*){2,}/g, " · ");
  if (first) out = out.replace(/^\s*·\s*/, "");
  if (last) out = out.replace(/\s*·\s*$/, "");
  return out;
}

/** A block's text: a table block as a table (first row = header), otherwise the text with its line breaks kept. */
export function BlockText({ text, lang, caption }: { text: string; lang: "en" | "ar"; caption: string }) {
  const table = parseMarkdownTable(text);
  const dir = lang === "ar" ? "rtl" : "ltr";
  if (table) {
    const [head, ...body] = table;
    const callout = isCalloutTable(table);
    return (
      <div className="table-wrap" tabIndex={0} role="region" aria-label={caption} lang={lang} dir={dir}>
        <table className={callout ? "table table--callout" : "table"} data-block-table={callout ? "callout" : ""}>
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {head!.map((c, i) => (
                <th key={i} scope="col">
                  {cellContent(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{cellContent(c)}</td>
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
  // F-DG5-122: a table block (B0024 in the About panel, B0124 in the Realize note) is a table, never raw Markdown.
  if (parseMarkdownTable(block.textEn) !== null || parseMarkdownTable(block.textAr) !== null) {
    const caption = `${t("playbookP5.sourceRef")} ${block.blockRef}`;
    return (
      <div className="source-text" data-source-text={testId} data-block-ref={block.blockRef}>
        {locale === "ar" ? (
          <>
            {block.arProvisional ? (
              <p>
                <ProvisionalArabic />
              </p>
            ) : null}
            <BlockText text={block.textAr} lang="ar" caption={caption} />
            <div className="muted">
              <span className="visually-hidden">{t("playbookP5.verbatimEnglish")}: </span>
              <div data-verbatim="en">
                <BlockText text={block.textEn} lang="en" caption={`${caption} · ${t("playbookP5.verbatimEnglish")}`} />
              </div>
            </div>
          </>
        ) : (
          <div data-verbatim="en">
            <BlockText text={block.textEn} lang="en" caption={caption} />
          </div>
        )}
        <p className="muted">
          <Icon name="info" /> {t("playbookP5.sourceRef")} <bdi dir="ltr">{block.blockRef}</bdi>
        </p>
      </div>
    );
  }
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
      {highlightParts(text, highlights).map((p, i, all) => {
        const shown = plainSnippetPiece(p.text, i === 0, i === all.length - 1);
        return p.mark ? <mark key={i}>{shown}</mark> : <span key={i}>{shown}</span>;
      })}
    </span>
  );
}

/** The first characters of a text, on a word boundary, for list rows. */
export function excerpt(text: string, max = 160): string {
  const flat = plainBlockText(text).replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = truncateText(flat, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}
