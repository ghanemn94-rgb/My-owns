// T-F6, T-F7 (p7-work-split §F.2; ADR-0070 §3): docs/handover/api/connectors.md is generated from the environment.md
// residual table and the connector adapter kinds, cannot drift from them, reads "Not verified" for every enterprise
// connector, and names credentials without values (the ADR-0063 secret scan finds nothing in docs/handover/api/).
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import {
  ADAPTER_KINDS,
  adapterKinds,
  CONNECTORS,
  ENV_EXAMPLE,
  ENVIRONMENT,
  generate,
  INTEGRATIONS,
  NOT_VERIFIED_AR,
  NOT_VERIFIED_EN,
  OUT,
  PORT,
  residualRows,
} from "../connector-handover.mjs";
import { REPO, runNode, tmp } from "./helpers.mjs";

const TOOL = join(REPO, "tools", "release", "connector-handover.mjs");
const committed = () => readFileSync(join(REPO, OUT), "utf8");
const integrationRows = (text) => {
  const lines = text.split("\n");
  const start = lines.indexOf("## Integrations");
  const rows = [];
  for (let i = start + 4; i < lines.length && lines[i].startsWith("|"); i++) rows.push(lines[i]);
  return rows.map((l) => ({ name: l.split(" | ")[0].replace(/^\|\s*/, ""), line: l }));
};

const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A fixture root holding exactly the sources the generator reads (real copies; mapped files as empty stand-ins). */
function fixtureRoot(mutateEnvironment = (t) => t) {
  const root = tmp("connector-handover");
  roots.push(root);
  const put = (p, text) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  };
  put(ENVIRONMENT, mutateEnvironment(readFileSync(join(REPO, ENVIRONMENT), "utf8")));
  for (const p of [PORT, CONNECTORS, ENV_EXAMPLE]) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    cpSync(join(REPO, p), join(root, p));
  }
  const files = new Set();
  for (const x of INTEGRATIONS) for (const p of [...x.adapter, ...x.tests, ...(x.double ? [x.double] : [])]) files.add(p);
  for (const k of Object.values(ADAPTER_KINDS)) for (const p of [k.adapter, ...k.tests]) files.add(p);
  for (const p of files) put(p, "");
  return root;
}

describe("connector-handover parity (T-F6)", () => {
  it("--check: the committed connectors.md equals a fresh generation", () => {
    const r = runNode([TOOL, "--check"]);
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.stdout.trim(), `connector-handover: PASS: ${OUT} equals a fresh generation`);
  });

  it("every integration row of the environment.md table is in connectors.md, and every connectors.md row has a source row", () => {
    const source = residualRows(readFileSync(join(REPO, ENVIRONMENT), "utf8")).map((r) => r.name);
    const listed = integrationRows(committed()).map((r) => r.name);
    assert.ok(source.length >= 8, `expected the P6 residual rows, got ${source.length}`);
    assert.deepEqual([...listed].sort(), [...source].sort());
    assert.deepEqual(generate(REPO).problems, []);
  });

  it("every adapter kind of connectors.ts appears, with its adapter and contract test file", () => {
    const kinds = adapterKinds(REPO);
    assert.deepEqual([...kinds].sort(), ["http_pull", "test_adapter", "webhook"]);
    for (const k of kinds) {
      const row = committed()
        .split("\n")
        .find((l) => l.startsWith(`| \`${k}\` |`));
      assert.ok(row, `adapter kind ${k} has a row`);
      assert.match(row, /\.test\.ts`/);
    }
  });

  it("each mapped integration names its local adapter's contract test file", () => {
    for (const { name, line } of integrationRows(committed())) {
      const x = INTEGRATIONS.find((i) => i.match === name);
      for (const t of x.tests) assert.ok(line.includes(t), `${name}: ${t}`);
    }
  });

  it("a new environment.md row without a mapping fails with the F.3 line", () => {
    const root = fixtureRoot((t) =>
      t.replace(
        "| **Enterprise messaging** |",
        "| **Payroll feed** | nothing | everything | an endpoint | `docs/x.md` |\n| **Enterprise messaging** |",
      ),
    );
    const r = runNode([TOOL, "--write", "--root", root]);
    assert.equal(r.code, 1);
    assert.match(
      r.stdout,
      /^connector-handover: connectors\.md differs from environment\.md: row "Payroll feed" has no mapping in connector-handover\.mjs$/m,
    );
  });

  it("a removed environment.md row fails (a mapping without a source row)", () => {
    const root = fixtureRoot((t) => t.replace(/^\| \*\*SMTP relay\*\*.*\n/m, ""));
    const r = runNode([TOOL, "--check", "--root", root]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /mapping "SMTP relay" has no row in docs\/delivery\/environment\.md$/m);
  });

  it("--check fails when connectors.md is edited by hand, and passes after --write", () => {
    const root = fixtureRoot();
    assert.equal(runNode([TOOL, "--write", "--root", root]).code, 0);
    assert.equal(runNode([TOOL, "--check", "--root", root]).code, 0);
    writeFileSync(join(root, OUT), `${readFileSync(join(root, OUT), "utf8")}\nHand edit.\n`);
    const r = runNode([TOOL, "--check", "--root", root]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^connector-handover: connectors\.md differs from environment\.md: .* is not a fresh generation/m);
  });

  it("an adapter kind added to port.ts without a handover entry fails", () => {
    const root = fixtureRoot();
    const p = join(root, PORT);
    writeFileSync(p, readFileSync(p, "utf8").replace('"http_pull"]', '"http_pull", "sftp_pull"]'));
    const r = runNode([TOOL, "--check", "--root", root]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /adapter kind sftp_pull of .*connectors\.ts is not covered$/m);
  });

  it("usage without --write or --check is BLOCKED (exit 2)", () => {
    const r = runNode([TOOL]);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /^connector-handover: BLOCKED: usage/m);
  });
});

describe("connector-handover honesty (T-F7)", () => {
  it('every enterprise connector reads "Not verified", with the exact F.3 sentence in English and Arabic', () => {
    const text = committed();
    const rows = integrationRows(text);
    assert.ok(rows.length > 0);
    for (const { name, line } of rows) assert.ok(line.endsWith("| Not verified |"), `${name}: ${line}`);
    assert.ok(text.includes(NOT_VERIFIED_EN));
    assert.ok(text.includes(NOT_VERIFIED_AR));
  });

  it('no text claims a live, Mobily-integrated or production-tested connector', () => {
    // The only occurrence of "live" allowed is the quoted name of the source table, which states the opposite.
    const text = committed().replaceAll("P6 residuals: live integrations not exercised in this environment", "");
    assert.doesNotMatch(text, /\blive\b/i);
    assert.doesNotMatch(text, /integrated with Mobily/i);
    assert.doesNotMatch(text, /tested against production/i);
  });

  it("credentials appear by name only: the ADR-0063 secret scan finds nothing in docs/handover/api/", () => {
    const r = runNode([join(REPO, "tools", "release", "secret-scan.mjs"), "--path", join(REPO, "docs", "handover", "api")]);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /^secret-scan: PASS/m);
  });
});
