// The two text rules are one rule in two languages (ADR-0049 §7; p5-work-split §I.7 item 4; T-DG5-BE-R2): the SQL
// functions of 0089 (`p5_claims_official_pmi`, `p5_mentions_engineering_gate`) and their TypeScript mirrors
// (packages/shared/src/text-scan) agree on one corpus, run against the real PostgreSQL of the integration project (the
// pinned C-ctype cluster, ADR-0003). The corpus is the shared rule corpus (with its expected answers) plus every string
// of the web catalogues and every literal of the API source, so the agreement covers the product texts themselves.
import { claimsOfficialPmi, mentionsEngineeringGate } from "@mth/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLAIM_CORPUS, ENGINEERING_GATE_CORPUS } from "../../../../../packages/shared/src/text-scan/corpus.ts";
import { startApi, type TestApi } from "../../support/harness.ts";
import { i18nStrings, literalsUnder } from "../../text-scan/scan.ts";

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
}, 120_000);
afterAll(() => api.close());

async function sqlRule(
  fn: "p5_claims_official_pmi" | "p5_mentions_engineering_gate",
  texts: readonly (string | null)[],
) {
  const r = await api.owner.query<{ a: boolean[] | null }>(
    `SELECT array_agg(${fn}(t) ORDER BY i) AS a FROM unnest($1::text[]) WITH ORDINALITY u(t, i)`,
    [texts],
  );
  return r.rows[0]!.a ?? [];
}

describe("SQL and TypeScript agree", () => {
  it("the server runs the pinned C ctype (the mirrors' character classes)", async () => {
    const r = await api.owner.query<{ c: string }>(
      "SELECT datctype AS c FROM pg_database WHERE datname = current_database()",
    );
    expect(r.rows[0]!.c).toBe("C");
  });

  it("on the claim corpus, with the expected answers", async () => {
    const sql = await sqlRule(
      "p5_claims_official_pmi",
      CLAIM_CORPUS.map((s) => s.text),
    );
    expect(CLAIM_CORPUS.map((s, i) => [s.text, sql[i], claimsOfficialPmi(s.text)])).toEqual(
      CLAIM_CORPUS.map((s) => [s.text, s.expected, s.expected]),
    );
  });

  it("on the engineering-gate corpus, with the expected answers", async () => {
    const sql = await sqlRule(
      "p5_mentions_engineering_gate",
      ENGINEERING_GATE_CORPUS.map((s) => s.text),
    );
    expect(ENGINEERING_GATE_CORPUS.map((s, i) => [s.text, sql[i], mentionsEngineeringGate(s.text)])).toEqual(
      ENGINEERING_GATE_CORPUS.map((s) => [s.text, s.expected, s.expected]),
    );
  });

  it("on every UI string (en, ar) and every API literal", async () => {
    // PostgreSQL text cannot hold U+0000 and the driver replaces a lone surrogate, so those few literals (control and
    // encoding probes of the API's input rules, not product text) are not sent; they are counted below.
    const all = [
      ...new Set([...i18nStrings("en"), ...i18nStrings("ar"), ...literalsUnder(["apps/api/src"])].map((t) => t.text)),
    ];
    const unsendable = (t: string) =>
      t.includes("\u0000") || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(t);
    const texts = all.filter((t) => !unsendable(t));
    expect(all.length - texts.length).toBeLessThan(50);
    expect(texts.length).toBeGreaterThan(20_000);
    const claims = await sqlRule("p5_claims_official_pmi", texts);
    const gates = await sqlRule("p5_mentions_engineering_gate", texts);
    const disagree = texts.filter(
      (t, i) => claims[i] !== claimsOfficialPmi(t) || gates[i] !== mentionsEngineeringGate(t),
    );
    expect(disagree).toEqual([]);
    // The corpus is not trivially negative: it holds the reported existing findings (scan.ts).
    expect(claims.filter(Boolean).length + gates.filter(Boolean).length).toBeGreaterThan(0);
  });
});
