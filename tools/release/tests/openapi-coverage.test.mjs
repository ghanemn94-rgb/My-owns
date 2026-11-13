// T-F4 (p7-work-split §F.2; ADR-0070 §2): tools/release/openapi-coverage.mjs on a fixture OpenAPI document, fixture
// contract sources, fixture pending lists and a fixture vitest JSON report. Each failure kind fails on its own; the
// complete fixture passes; NO_400_OPERATIONS is printed with its reason and is not a skip.
// The real run on the merged tree (T-F5) is recorded in the DO-H handback, not here.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { REPO, runNode, tmp } from "./helpers.mjs";

const TOOL = join(REPO, "tools", "release", "openapi-coverage.mjs");
const REQUIRED = [
  "maps every governed Fastify route to an OpenAPI operation with the same method, and back",
  "covers every operation with at least one success and every successful body with its zod mirror",
];

const OPENAPI = `openapi: 3.1.0
info:
  title: fixture
  version: 9.9.9-fx
tags:
  - name: Widgets
paths:
  /widgets:
    get:
      operationId: listWidgets
      summary: List widgets
      tags: [Widgets]
      responses:
        "200":
          $ref: "#/components/responses/WidgetList"
    post:
      operationId: createWidget
      summary: Create a widget
      tags: [Widgets]
      responses:
        "201":
          description: created
          content:
            application/json:
              schema: { type: object }
        "400":
          description: invalid
components:
  responses:
    WidgetList:
      description: ok
      content:
        application/json:
          schema: { type: array }
`;
const CONTRACT = `import { describe, it, expect } from "vitest";
describe("route coverage", () => {
  it("${REQUIRED[0]}", () => {});
  it("${REQUIRED[1]}", () => {
    // it.skip in a comment is not a skip
    expect(operations).toHaveLength(2);
  });
});
`;
const MALFORMED = `export const NO_400_OPERATIONS: ReadonlySet<string> = new Set(["listWidgets"]);\n`;
const RESPONSE = `import { it } from "vitest";\nit("every validated response", () => {});\n`;
const PENDING = `// "a quoted word in a comment is not an entry"
import { P7_PENDING_BE_X } from "./p7-pending-be-x.ts";
export const P7_PENDING_OPERATIONS: readonly string[] = [...P7_PENDING_BE_X];
`;
const PENDING_BE = `export const P7_PENDING_BE_X: readonly string[] = [];\n`;

const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function fixture({ openapi = OPENAPI, contract = CONTRACT, pendingBe = PENDING_BE, statuses = {}, omit = [] } = {}) {
  const root = tmp("openapi-cov");
  roots.push(root);
  const cdir = join(root, "contract");
  const sdir = join(root, "support");
  mkdirSync(cdir);
  mkdirSync(sdir);
  writeFileSync(join(root, "openapi.yaml"), openapi);
  writeFileSync(join(cdir, "contract.test.ts"), contract);
  writeFileSync(join(cdir, "malformed-input.ts"), MALFORMED);
  writeFileSync(join(cdir, "response-validation.test.ts"), RESPONSE);
  writeFileSync(join(sdir, "p7-pending.ts"), PENDING);
  writeFileSync(join(sdir, "p7-pending-be-x.ts"), pendingBe);
  const a = (title) => ({ title, fullName: `route coverage ${title}`, status: statuses[title] ?? "passed" });
  const vitest = {
    numFailedTests: 0,
    testResults: [
      {
        name: join(cdir, "contract.test.ts"),
        status: "passed",
        assertionResults: REQUIRED.filter((t) => !omit.includes(t)).map(a),
      },
      ...(omit.includes("response-validation")
        ? []
        : [
            {
              name: join(cdir, "response-validation.test.ts"),
              status: "passed",
              assertionResults: [a("every validated response")],
            },
          ]),
      { name: join(root, "elsewhere", "other.test.ts"), status: "failed", assertionResults: [a("not a contract file")] },
    ],
  };
  vitest.testResults[vitest.testResults.length - 1].assertionResults[0].status = "failed";
  writeFileSync(join(root, "vitest.json"), JSON.stringify(vitest));
  const out = join(root, "coverage.json");
  const r = runNode([
    TOOL,
    "--vitest-json",
    join(root, "vitest.json"),
    "--openapi",
    join(root, "openapi.yaml"),
    "--contract-dir",
    cdir,
    "--support-dir",
    sdir,
    "--out",
    out,
  ]);
  let json = null;
  try {
    json = JSON.parse(readFileSync(out, "utf8"));
  } catch {}
  return { ...r, json };
}

describe("openapi-coverage (T-F4)", () => {
  it("a complete fixture passes; NO_400_OPERATIONS is printed with its reason and is not a skip", () => {
    const r = fixture();
    assert.equal(r.code, 0, r.stdout);
    assert.equal(
      r.stdout.split("\n")[0],
      "openapi-coverage: PASS: 2 operations described, routed and exercised; no pending entry; no skipped contract test",
    );
    assert.match(
      r.stdout,
      /^openapi-coverage: note: NO_400_OPERATIONS listWidgets: no input that can be invalid \(not a skip\)$/m,
    );
    assert.equal(r.json.schemaVersion, "mth-openapi-coverage/1");
    assert.equal(r.json.contractVersion, "9.9.9-fx");
    assert.deepEqual([r.json.operations, r.json.routed, r.json.exercised, r.json.countPin], [2, 2, 2, 2]);
    assert.equal(r.json.pendingEntries, 0);
    assert.deepEqual(r.json.skippedTests, []);
    assert.equal(r.json.responseValidated, true);
    assert.match(r.json.openapiSha256, /^[0-9a-f]{64}$/);
  });

  it("a non-empty pending list fails, and routed/exercised are Unknown (null), never zero", () => {
    const r = fixture({ pendingBe: `export const P7_PENDING_BE_X: readonly string[] = ["createWidget"];\n` });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^openapi-coverage: FAIL: pending operation createWidget \(p7-pending-be-x\.ts\)$/m);
    assert.equal(r.json.routed, null);
    assert.equal(r.json.exercised, null);
  });

  for (const kind of ["skip", "todo", "only", "skipIf"]) {
    it(`a .${kind} in a contract test file fails with its file and line`, () => {
      const r = fixture({ contract: `${CONTRACT}it.${kind}("x", () => {});\n` });
      assert.equal(r.code, 1, r.stdout);
      assert.match(r.stdout, /^openapi-coverage: FAIL: skipped test in contract\.test\.ts:9$/m);
    });
  }

  it("a count pin unequal to the document fails", () => {
    const r = fixture({ contract: CONTRACT.replace("toHaveLength(2)", "toHaveLength(3)") });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^openapi-coverage: FAIL: count pin 3 does not equal 2 operations$/m);
  });

  it("a failed required test fails", () => {
    const r = fixture({ statuses: { [REQUIRED[0]]: "failed" } });
    assert.equal(r.code, 1);
    assert.match(r.stdout, new RegExp(`^openapi-coverage: FAIL: required test failed: ${REQUIRED[0]} \\(failed\\)$`, "m"));
  });

  it("a required test missing from the run fails", () => {
    const r = fixture({ omit: [REQUIRED[1]] });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /required test failed: covers every operation .* \(not in the run\)$/m);
  });

  it("a run without response-validation.test.ts fails", () => {
    const r = fixture({ omit: ["response-validation"] });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^openapi-coverage: FAIL: required test failed: response-validation\.test\.ts \(not in the run\)$/m);
  });

  it("a skipped test in the run fails", () => {
    const r = fixture({ statuses: { "every validated response": "skipped" } });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /required test failed: response-validation\.test\.ts: .*every validated response \(skipped\)$/m);
  });

  it("an operation without a summary, or with an undeclared tag, is not described", () => {
    const r = fixture({ openapi: OPENAPI.replace("      summary: Create a widget\n", "").replace("tags: [Widgets]\n      responses:\n        \"200\"", "tags: [Gadgets]\n      responses:\n        \"200\"") });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^openapi-coverage: FAIL: operation createWidget is not described: no summary$/m);
    assert.match(r.stdout, /^openapi-coverage: FAIL: operation listWidgets is not described: tag Gadgets is not declared under tags$/m);
  });

  it("a missing vitest report is BLOCKED (exit 2)", () => {
    const r = runNode([TOOL, "--vitest-json", join(REPO, "no-such-report.json")]);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /^openapi-coverage: BLOCKED: vitest JSON .* not found$/m);
  });
});
