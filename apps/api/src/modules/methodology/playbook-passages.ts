// The PlaybookPassagePort (ADR-0059 §4 item 3; ADR-0049; T-DG6-BE-U): at most `limit` blocks of the playbook v1.0
// (`playbook_block`, B0001-B0165, 0092) whose search vector matches the prompt's terms: `search_en` over the
// 'english' configuration, or `search_ar` over 'arabic' for an Arabic conversation, ranked by ts_rank then block_ref.
// The playbook is not record data and needs no scope. text_en is the verbatim playbook; text_ar is a PROVISIONAL
// translation (ar_provisional), and the passage says so in its title. The text is given to the model as quoted data.
// Read-only: registered by the composition root (server.ts) with registerAssistantPlaybookPassagePort, because
// `assistant` may not import `methodology`; the structural type below is the port `assistant/retrieval.ts` declares.
import { sql, type Db } from "@mth/db";

export interface PlaybookPassage {
  readonly blockRef: string;
  readonly title: string;
  readonly text: string;
}

export interface PlaybookPassagePort {
  find(terms: string, locale: "en" | "ar", limit: number): Promise<readonly PlaybookPassage[]>;
}

/** The title of a passage: its block ref and the heading it sits under (at most 200 characters). */
export const PASSAGE_TITLE_MAX = 200;

export function createPlaybookPassagePort(db: Db): PlaybookPassagePort {
  return {
    async find(terms, locale, limit) {
      const n = Math.max(0, Math.min(3, Math.trunc(limit)));
      if (n === 0 || terms.trim() === "") return [];
      // The configuration, vector and text columns are chosen from fixed literals by `locale`, never from input.
      const config = locale === "ar" ? sql.lit("arabic") : sql.lit("english");
      const vector = locale === "ar" ? sql.ref("b.search_ar") : sql.ref("b.search_en");
      const text = locale === "ar" ? sql.ref("b.text_ar") : sql.ref("b.text_en");
      const heading = locale === "ar" ? sql.ref("s.text_ar") : sql.ref("s.text_en");
      const rows = await sql<{ block_ref: string; body: string; heading: string | null; provisional: boolean }>`
        WITH q AS (SELECT websearch_to_tsquery(${config}::regconfig, ${terms}) AS query)
        SELECT b.block_ref, ${text} AS body, ${heading} AS heading, b.ar_provisional AS provisional
          FROM playbook_block b
          CROSS JOIN q
          LEFT JOIN playbook_block s ON s.block_ref = b.section_block_ref
         WHERE ${vector} @@ q.query
         ORDER BY ts_rank(${vector}, q.query) DESC, b.block_ref
         LIMIT ${n}`.execute(db);
      return rows.rows.map((r) => {
        const head = (r.heading ?? "").split("\n")[0]!.trim();
        const suffix = locale === "ar" && r.provisional ? " (ترجمة مؤقتة)" : "";
        const title = `Playbook ${r.block_ref}${head === "" ? "" : `: ${head}`}`;
        return {
          blockRef: r.block_ref,
          title: `${Array.from(title)
            .slice(0, PASSAGE_TITLE_MAX - suffix.length)
            .join("")}${suffix}`,
          text: r.body,
        };
      });
    },
  };
}
