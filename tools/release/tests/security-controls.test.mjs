// T-G7, T-G8 (ADR-0063 §4, §6; p7-work-split §G.4; REQ-S16-033 "the matrix links each control to a test"): the
// security-controls matrix `docs/handover/security-controls.md` is parsed and checked against the repository, and both
// scans pass over it. The header must equal ADR-0063 §4.1 (the matrix is evidence for IT's own assessment, not a
// statement of conformity). Read-only: reads the matrix, the ADR, the anchored master prompt and the register.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, it } from "node:test";
import { scanClaims } from "../claims-scan.mjs";
import { scanSecrets } from "../secret-scan.mjs";
import { REPO } from "./helpers.mjs";

const MATRIX_REL = "docs/handover/security-controls.md";
const MATRIX = join(REPO, MATRIX_REL);
const ADR = join(REPO, "docs/architecture/adr/ADR-0063-p7-secret-hygiene-claims-scan-security-controls-evidence.md");
const TEST_FILE = /\.(test\.ts|test\.tsx|test\.mjs|vitest\.mjs|spec\.ts)$/;
const LEVELS = ["unit", "integration", "e2e", "integration-level only"];
const S1_HEADER = "| Id | Control | Source | Implemented in | Test(s) | Level | Evidence | Notes |";
const S2_HEADER = "| Id | Responsibility (hosting environment) | Product-side integration point | Product test, if any | Guide |";

const text = readFileSync(MATRIX, "utf8");
const lines = text.split("\n");

/** The rows of the table that follows the heading `title`: [{ cells, line }]. */
function table(title) {
  const start = lines.findIndex((l) => l.startsWith(title));
  assert.ok(start >= 0, `heading ${title} missing`);
  const header = lines.slice(start + 1).find((l) => l.startsWith("|"));
  const h = lines.indexOf(header, start);
  const rows = [];
  for (let i = h + 2; i < lines.length && lines[i].startsWith("|"); i++)
    rows.push({ cells: lines[i].slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim()), line: i + 1 });
  return { header, rows };
}
const backticked = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const isRegularFile = (rel) => existsSync(join(REPO, rel)) && statSync(join(REPO, rel)).isFile();

const anchored = readFileSync(join(REPO, "docs/source/master-prompt.anchored.md"), "utf8");
const register = new Set(
  readFileSync(join(REPO, "docs/delivery/requirements.csv"), "utf8")
    .split("\n")
    .map((l) => l.split(",")[0]),
);

describe("T-G7 the security-controls matrix (REQ-S16-033)", () => {
  it("the header equals ADR-0063 §4.1 verbatim", () => {
    const adr = readFileSync(ADR, "utf8");
    const sec = adr.slice(adr.indexOf("#### 4.1"));
    const header = /```text\n([\s\S]*?)\n```/.exec(sec)[1];
    assert.ok(header.startsWith("# Security controls: evidence for Mobily IT's assessment"));
    assert.equal(text.slice(0, header.length), header);
  });

  const s1 = table("## Section 1");
  it("Section 1 has the exact columns of ADR-0063 §4.2, in order", () => assert.equal(s1.header, S1_HEADER));

  it("Section 1 holds at least SC-01…SC-17, each id once", () => {
    const ids = s1.rows.map((r) => r.cells[0]);
    for (let n = 1; n <= 17; n++) assert.ok(ids.includes(`SC-${String(n).padStart(2, "0")}`), `SC-${n} missing`);
    assert.equal(new Set(ids).size, ids.length, "an id is repeated");
    for (const id of ids) assert.match(id, /^SC-\d{2}$/);
  });

  for (const row of s1.rows) {
    const [id, control, source, implemented, tests, level, evidence, notes] = row.cells;
    describe(`${id} (line ${row.line})`, () => {
      it("has 8 cells and a control text", () => {
        assert.equal(row.cells.length, 8);
        assert.ok(control.length > 10);
        assert.ok(implemented.length > 0);
      });
      it("links at least one existing test file", () => {
        const paths = backticked(tests);
        assert.ok(paths.length >= 1, "no test linked");
        for (const p of paths) {
          assert.match(p, TEST_FILE, `${p} is not a test file`);
          assert.ok(isRegularFile(p), `${p} does not exist`);
        }
      });
      it("names Source ids that exist (M-anchor or register id)", () => {
        const ids = source.match(/\bM\d{4}\b|\bREQ-[A-Z0-9]+-\d{3}\b/g) ?? [];
        assert.ok(ids.length >= 1, "no source id");
        for (const s of ids)
          if (s.startsWith("M")) assert.ok(anchored.includes(`[${s} `), `${s} is not an anchor`);
          else assert.ok(register.has(s), `${s} is not in the register`);
      });
      it("has a valid Level (integration-level only carries its reason)", () => {
        assert.ok(LEVELS.includes(level), level);
        if (level === "integration-level only") assert.ok(notes.length > 20, "reason missing");
      });
      it("every Evidence path exists", () => {
        if (evidence === "—") return;
        for (const p of backticked(evidence)) assert.ok(isRegularFile(p.replace(/#.*$/, "")), `${p} does not exist`);
      });
    });
  }

  it("SC-07 is marked integration-level only (REQ-S16-030 carry-forward)", () => {
    assert.equal(s1.rows.find((r) => r.cells[0] === "SC-07").cells[5], "integration-level only");
  });

  const s2 = table("## Section 2");
  it("Section 2 has the exact columns of ADR-0063 §4.3, in order", () => assert.equal(s2.header, S2_HEADER));

  it("Section 2 holds HR-01…HR-07", () => {
    const ids = s2.rows.map((r) => r.cells[0]);
    assert.deepEqual(ids, ["HR-01", "HR-02", "HR-03", "HR-04", "HR-05", "HR-06", "HR-07"]);
  });

  for (const row of s2.rows) {
    const [id, , , productTest, guide] = row.cells;
    it(`${id}: every guide link resolves to an existing file, and named test files exist`, () => {
      assert.equal(row.cells.length, 5);
      const links = [...guide.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
      assert.ok(links.length >= 1, "no guide link");
      for (const l of links) {
        const rel = normalize(join(dirname(MATRIX_REL), l.replace(/#.*$/, "")));
        assert.ok(isRegularFile(rel), `${l} does not resolve (${rel})`);
      }
      for (const p of backticked(productTest).filter((x) => TEST_FILE.test(x)))
        assert.ok(isRegularFile(p), `${p} does not exist`);
    });
  }

  it("HR-02 names the database TLS test (T-G9), not a claim", () => {
    const hr02 = s2.rows.find((r) => r.cells[0] === "HR-02");
    assert.ok(hr02.cells[3].includes("packages/db/test/integration/db-tls.test.ts"));
    assert.ok(hr02.cells[2].includes("No product code sets TLS on its own"));
  });
});

describe("T-G8 both scans pass over the matrix", () => {
  it("the claims scan passes", async () => {
    const r = await scanClaims({ roots: [MATRIX] });
    assert.equal(r.files, 1);
    assert.deepEqual(r.hits, []);
    assert.equal(r.ok, true);
  });
  it("the secret scan passes", async () => {
    const r = await scanSecrets({ scope: "path", paths: [MATRIX] });
    assert.equal(r.files, 1);
    assert.deepEqual(r.hits, []);
    assert.equal(r.ok, true);
  });
});
