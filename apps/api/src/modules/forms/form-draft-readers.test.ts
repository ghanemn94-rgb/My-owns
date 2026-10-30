// Static test (ADR-0057 §6 "Labelled and never counted"; REQ-S15-011 "a draft ... never counted in approved totals";
// p6-work-split §H/G.4, T-DG6-BE-Q2): no module other than `forms/drafts.ts` reads `form_draft`. A draft is the author's
// unsaved work; if no API module, worker handler, report, dashboard, export or seed query selects from or joins the
// table, a draft cannot enter any total. The scan covers every non-test TypeScript source of the API, the worker and
// the shared and db packages (not the migrations, which define the table). It reads only source folders, never the
// growing delivery folders (D-138), and is deterministic.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));
const ROOTS = ["apps/api/src", "apps/worker/src", "packages/shared/src", "packages/db/src"];
const ALLOWED = "apps/api/src/modules/forms/drafts.ts";

/** A Kysely table read (`selectFrom`, any join, `with`-free subquery) or raw SQL `FROM`/`JOIN` of `form_draft`. */
const READS = [
  /\b(?:selectFrom|innerJoin|leftJoin|rightJoin|fullJoin|crossJoin|innerJoinLateral|leftJoinLateral)\(\s*["'`]form_draft(?:\s+as\s+\w+)?["'`]/g,
  /\b(?:FROM|JOIN)\s+(?:public\.)?"?form_draft"?(?![\w])/gi,
];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".claude") continue;
      out.push(...sources(p));
    } else if (/\.(?:ts|tsx|mts|mjs)$/.test(e.name) && !/\.test\.(?:ts|tsx|mts|mjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function readersOf(files: readonly string[]): Map<string, number> {
  const found = new Map<string, number>();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const n = READS.reduce((acc, re) => acc + [...text.matchAll(re)].length, 0);
    if (n > 0) found.set(relative(REPO, f).split(sep).join("/"), n);
  }
  return found;
}

describe("form_draft readers (ADR-0057 §6)", () => {
  const files = ROOTS.flatMap((r) => sources(join(REPO, r)));

  it("scans the API, worker, shared and db sources", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith(join("forms", "drafts.ts")))).toBe(true);
  });

  it("the detector finds the reads of forms/drafts.ts (it is not vacuous)", () => {
    const own = readersOf(files.filter((f) => f.endsWith(join("modules", "forms", "drafts.ts"))));
    expect(own.get(ALLOWED) ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("the detector recognises Kysely and raw SQL reads, and ignores the table's constraint and code names", () => {
    const hits = (s: string) => READS.reduce((acc, re) => acc + [...s.matchAll(re)].length, 0);
    expect(hits(`db.selectFrom("form_draft")`)).toBe(1);
    expect(hits(`q.leftJoin("form_draft as d", "d.id", "x.id")`)).toBe(1);
    expect(hits("sql`SELECT count(*) FROM form_draft WHERE status = 'open'`")).toBe(1);
    expect(hits("sql`select 1 from t join form_draft d on d.id = t.id`")).toBe(1);
    expect(hits(`"form_draft_open_record_key"; "form_draft.open_exists"; recordType: "form_draft"`)).toBe(0);
  });

  it("no module other than forms/drafts.ts selects from or joins form_draft", () => {
    const others = [...readersOf(files).keys()].filter((f) => f !== ALLOWED);
    expect(others).toEqual([]);
  });
});
