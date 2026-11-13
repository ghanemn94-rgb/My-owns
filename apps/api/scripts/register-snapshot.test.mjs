// T-I1, T-I2, T-I3 (ADR-0071 §2; p7-work-split §I.4; T-DG7-BE-H): the build-time register snapshot generator.
//   node --test apps/api/scripts/register-snapshot.test.mjs
// T-I1 compares the snapshot of the tree's docs/delivery/requirements.csv with an INDEPENDENT parse of the same file
// (a sticky-regex tokenizer, not the generator's code). Fixtures are written under a fresh temporary directory and are
// SYNTHETIC. Nothing here is a DG0-DG7 gate decision or a G1-G6 approval.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { REGISTER_COLUMNS, buildSnapshot, parseRegister } from "./register-snapshot.mjs";

const SCRIPT = fileURLToPath(new URL("./register-snapshot.mjs", import.meta.url));
const TREE_CSV = fileURLToPath(new URL("../../../docs/delivery/requirements.csv", import.meta.url));
const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "register-snapshot-"));
after(() => rmSync(work, { recursive: true, force: true }));

const run = (...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const file = (name, content) => {
  const path = join(work, name);
  writeFileSync(path, content);
  return path;
};

/** An independent RFC 4180 parse: a sticky regex per field ("..." with doubled quotes, or a run without , or line end). */
function independentParse(text) {
  const field = /(?:"((?:[^"]|"")*)"|([^,\r\n]*))(,|\r?\n|$)/y;
  const records = [];
  let current = [];
  field.lastIndex = 0;
  while (field.lastIndex < text.length) {
    const m = field.exec(text);
    assert.ok(m, `independent parse stalled at ${field.lastIndex}`);
    current.push(m[1] !== undefined ? m[1].replace(/""/g, '"').replace(/\r\n/g, "\n") : m[2]);
    if (m[3] !== ",") {
      records.push(current);
      current = [];
      if (m[3] === "") break;
    }
  }
  return records;
}

const HEADER = REGISTER_COLUMNS.join(",");
/** A synthetic valid row; `over` replaces fields by column name. */
function row(id, over = {}) {
  const v = Object.fromEntries(REGISTER_COLUMNS.map((c) => [c, `${c} of ${id}`]));
  Object.assign(v, { req_id: id, class: "USER", final_gate: "DG7", status: "IMPLEMENTED", increments: "P7" }, over);
  return REGISTER_COLUMNS.map((c) => {
    const s = v[c];
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",");
}
const fixture = (...rows) => `${HEADER}\n${rows.join("\n")}\n`;

describe("T-I1: the snapshot of the tree's register equals the file", () => {
  const bytes = readFileSync(TREE_CSV);
  const text = bytes.toString("utf8");
  const independent = independentParse(text);
  const [header, ...records] = independent;
  const out = join(work, "tree-snapshot.json");
  const res = run("--csv", TREE_CSV, "--out", out);

  it("exits 0 with the I.3 line", () => {
    assert.equal(res.status, 0, res.stderr);
    const sha = createHash("sha256").update(bytes).digest("hex");
    assert.equal(
      res.stdout.trim(),
      `register-snapshot: wrote ${out} (${records.length} rows, sha256 ${sha.slice(0, 12)})`,
    );
  });

  it("rowCount, ids in order, sourceSha256 and every field byte for byte (multi-line fields included)", () => {
    const snap = JSON.parse(readFileSync(out, "utf8"));
    assert.deepEqual(header, [...REGISTER_COLUMNS]);
    assert.equal(snap.schemaVersion, "mth-register-snapshot/1");
    assert.equal(snap.sourcePath, "docs/delivery/requirements.csv");
    assert.equal(snap.sourceSha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(snap.rowCount, records.length);
    assert.equal(snap.rows.length, records.length);
    assert.deepEqual(
      snap.rows.map((r) => r[0]),
      records.map((r) => r[0]),
    );
    assert.deepEqual(snap.columns, [...REGISTER_COLUMNS]);
    for (let k = 0; k < records.length; k += 1) assert.deepEqual(snap.rows[k], records[k], `row ${records[k][0]}`);
    // Keys in the ADR-0071 §2.3 order; no --deps -> externalDependencies null (never []).
    assert.deepEqual(Object.keys(snap), [
      "schemaVersion",
      "sourcePath",
      "sourceSha256",
      "rowCount",
      "generatedAt",
      "columns",
      "rows",
      "externalDependencies",
    ]);
    assert.equal(snap.externalDependencies, null);
  });

  it("the record count equals an independent count of the file's record starts", () => {
    // Every record of this register starts a line with REQ- outside a quoted field: count by the quote parity.
    let quoted = false;
    let starts = 0;
    let lineStart = true;
    for (let i = 0; i < text.length; i += 1) {
      if (lineStart && !quoted && text.startsWith("REQ-", i)) starts += 1;
      const c = text[i];
      if (c === '"') quoted = !quoted;
      lineStart = c === "\n";
    }
    assert.equal(starts, records.length);
    assert.equal(parseRegister(bytes).rows.length, starts);
  });

  it("a register with multi-line, quoted and comma fields: the same parity, field by field", () => {
    const csv = file(
      "multiline.csv",
      fixture(
        row("REQ-S02-003", { notes: 'first line\nsecond, with "quotes"\n\nfourth', acceptance: "a,b" }),
        row("REQ-DLV-010", { evidence: "x\ny", title: " padded " }),
      ),
    );
    const out = join(work, "multiline.json");
    assert.equal(run("--csv", csv, "--out", out).status, 0);
    const snap = JSON.parse(readFileSync(out, "utf8"));
    const [, ...fixtureRecords] = independentParse(readFileSync(csv, "utf8"));
    assert.equal(snap.rowCount, 2);
    assert.deepEqual(snap.rows, fixtureRecords);
    assert.equal(snap.rows[0][18], 'first line\nsecond, with "quotes"\n\nfourth');
    assert.equal(snap.rows[1][2], " padded ");
  });

  it("generatedAt follows SOURCE_DATE_EPOCH", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--csv", TREE_CSV, "--out", join(work, "epoch.json")], {
      encoding: "utf8",
      env: { ...process.env, SOURCE_DATE_EPOCH: "1700000000" },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(join(work, "epoch.json"), "utf8")).generatedAt, "2023-11-14T22:13:20Z");
  });
});

describe("T-I2: --check", () => {
  it("exits 0 on a fresh snapshot and 1 with the I.3 line after one byte of the register changes", () => {
    const csv = file("check.csv", fixture(row("REQ-S02-003"), row("REQ-DLV-010")));
    const out = join(work, "check.json");
    assert.equal(run("--csv", csv, "--out", out).status, 0);
    const fresh = run("--check", out, "--csv", csv);
    assert.equal(fresh.status, 0, fresh.stderr);
    const before = createHash("sha256").update(readFileSync(csv)).digest("hex");
    const changed = readFileSync(csv, "utf8").replace("title of REQ-S02-003", "title of REQ-S02-00X");
    writeFileSync(csv, changed);
    const after = createHash("sha256").update(readFileSync(csv)).digest("hex");
    const stale = run("--check", out, "--csv", csv);
    assert.equal(stale.status, 1);
    assert.equal(
      stale.stderr.trim(),
      `register-snapshot: ${out} is stale: it was built from sha256 ${before}, the register is sha256 ${after}`,
    );
  });
});

describe("T-I3: refusals", () => {
  const refused = (name, content, expected) => {
    const csv = file(name, content);
    const r = run("--csv", csv, "--out", join(work, `${name}.json`));
    assert.equal(r.status, 1, `${name}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stderr.trim(), `register-snapshot: ${expected}`);
  };

  it("header", () =>
    refused(
      "header.csv",
      fixture(row("REQ-S02-003")).replace("notes", "note"),
      "1: header differs from the 19 register columns",
    ));
  it("field count", () =>
    refused(
      "count.csv",
      `${HEADER}\n${row("REQ-S02-003")}\n${row("REQ-S02-004")},extra\n`,
      "3: expected 19 fields, found 20",
    ));
  it("id", () => refused("id.csv", fixture(row("REQ-S02-003"), row("REQ-S22-001")), "3: invalid req_id 'REQ-S22-001'"));
  it("id pattern", () => refused("id2.csv", fixture(row("REQ-S02-3")), "2: invalid req_id 'REQ-S02-3'"));
  it("duplicate", () =>
    refused("dup.csv", fixture(row("REQ-S02-003"), row("REQ-S02-003")), "3: duplicate req_id 'REQ-S02-003'"));
  it("class", () => refused("class.csv", fixture(row("REQ-S02-003", { class: "OTHER" })), "2: invalid class 'OTHER'"));
  it("status", () =>
    refused("status.csv", fixture(row("REQ-S02-003", { status: "DONE" })), "2: invalid status 'DONE'"));
  it("final gate", () =>
    refused("gate.csv", fixture(row("REQ-S02-003", { final_gate: "DG8" })), "2: invalid final_gate 'DG8'"));
  it("unterminated quote", () =>
    refused("quote.csv", `${HEADER}\n${row("REQ-S02-003")}\nREQ-S02-004,"open\n`, "3: unterminated quoted field"));
  it("byte order mark", () => refused("bom.csv", `﻿${fixture(row("REQ-S02-003"))}`, "1: byte order mark not allowed"));

  it("a record's line is the line it starts on, after a multi-line field", () =>
    refused(
      "lines.csv",
      fixture(row("REQ-S02-003", { notes: "one\ntwo\nthree" }), row("REQ-S02-004", { status: "x" })),
      "5: invalid status 'x'",
    ));

  it("a missing --csv file -> exit 2 BLOCKED; a usage error -> exit 2", () => {
    const missing = join(work, "absent.csv");
    const r = run("--csv", missing, "--out", join(work, "absent.json"));
    assert.equal(r.status, 2);
    assert.equal(r.stderr.trim(), `register-snapshot: BLOCKED: ${missing} not found`);
    assert.equal(run("--out", join(work, "x.json")).status, 2);
    assert.equal(run("--bogus").status, 2);
  });

  it("--deps absent or naming no file -> externalDependencies null (never [])", () => {
    const csv = file("deps.csv", fixture(row("REQ-S02-003")));
    for (const extra of [[], ["--deps", join(work, "no-such-deps.json")]]) {
      const out = join(work, `deps-${extra.length}.json`);
      assert.equal(run("--csv", csv, ...extra, "--out", out).status, 0);
      assert.equal(JSON.parse(readFileSync(out, "utf8")).externalDependencies, null);
    }
  });

  it("a valid dependency list is carried; an invalid entry -> exit 1", () => {
    const csv = file("deps2.csv", fixture(row("REQ-S02-003")));
    const good = [
      { key: "corporate_idp", title: "Corporate identity provider", owner: "Mobily IT", status: "not_verified" },
    ];
    const out = join(work, "deps-good.json");
    assert.equal(run("--csv", csv, "--deps", file("good-deps.json", JSON.stringify(good)), "--out", out).status, 0);
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")).externalDependencies, good);
    // An empty array file is carried as [] (the file says so); only an absent file is null.
    const empty = join(work, "deps-empty.json");
    assert.equal(run("--csv", csv, "--deps", file("empty-deps.json", "[]"), "--out", empty).status, 0);
    assert.deepEqual(JSON.parse(readFileSync(empty, "utf8")).externalDependencies, []);
    for (const [name, bad] of [
      ["bad-status", [{ ...good[0], status: "done" }]],
      ["bad-key", [{ ...good[0], key: "Bad Key" }]],
      ["extra-field", [{ ...good[0], secret: "x" }]],
      ["not-array", { items: good }],
    ]) {
      const depsPath = file(`${name}.json`, JSON.stringify(bad));
      const r = run("--csv", csv, "--deps", depsPath, "--out", join(work, `${name}-out.json`));
      assert.equal(r.status, 1, name);
      assert.match(
        r.stderr,
        /^register-snapshot: .*: (invalid dependency entry|the dependency list is not an array)\n$/,
      );
    }
  });
});

describe("parseRegister and buildSnapshot (exports)", () => {
  it("keeps quoted commas, doubled quotes and CRLF inside a field as LF, untrimmed", () => {
    const text = `${HEADER}\r\n${row("REQ-PB-001", { title: '  a, "b"  ', notes: "x\r\ny" })}\r\n`;
    const parsed = parseRegister(Buffer.from(text, "utf8"));
    assert.equal(parsed.rows[0][2], '  a, "b"  ');
    assert.equal(parsed.rows[0][18], "x\ny");
    const snap = buildSnapshot({
      csvBytes: Buffer.from(text),
      parsed,
      externalDependencies: null,
      generatedAt: "2026-11-13T00:00:00Z",
    });
    assert.equal(snap.rowCount, 1);
    assert.equal(snap.externalDependencies, null);
  });
});

// T-R16 (ADR-0064 Amendment 2 §A2.8 item 2; p7-work-split §C.13; T-DG7-BE-R2): the early guard. The snapshot built from
// the tree's register goes into dist/release/ (the runtime tree, target T1 of ADR-0062 §8), so every field of every
// row must pass the asset scan there: no R1, R2, R3, R5 or R6 hit, and every R4 hit allowed by a T1 host entry of the
// allow-list. A register edit that reintroduces a build-host path then fails here, naming the row, column and rule.
// register-snapshot.mjs itself is unchanged (A2.8). scanLine is imported read-only from tools/release/scan-assets.mjs.
const { scanLine } = await import(new URL("../../../tools/release/scan-assets.mjs", import.meta.url).href);
const ALLOWLIST = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../tools/release/asset-scan-allowlist.json", import.meta.url)), "utf8"),
);

/** The T1 findings of a snapshot: `<row id> <column> <rule>` for every disallowed hit. */
function t1Findings(snapshot) {
  const hosts = ALLOWLIST.entries.filter((e) => e.rule === "R4" && e.target === "T1" && typeof e.host === "string");
  const out = [];
  for (const row of snapshot.rows)
    row.forEach((value, i) => {
      for (const line of String(value).split("\n"))
        for (const hit of scanLine(line, { target: "T1" })) {
          if (hit.rule === "R4" && hosts.some((e) => hit.host === e.host || hit.host?.endsWith(`.${e.host}`))) continue;
          out.push(`${row[0]} ${snapshot.columns[i]} ${hit.rule}`);
        }
    });
  return out;
}

describe("T-R16: the register snapshot passes the T1 asset scan (A2.8)", () => {
  it("the snapshot of the tree's register has no T1 finding", () => {
    const csvBytes = readFileSync(TREE_CSV);
    const snap = buildSnapshot({
      csvBytes,
      parsed: parseRegister(csvBytes),
      externalDependencies: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepEqual(t1Findings(snap), []);
  });

  it("a SYNTHETIC register with a planted build-host path fails and names the row, the column and R2", () => {
    const csvBytes = readFileSync(TREE_CSV);
    const parsed = parseRegister(csvBytes);
    const col = parsed.columns.indexOf("notes");
    assert.ok(col > 0);
    const planted = parsed.rows.map((r) => [...r]);
    planted[0][col] = `${planted[0][col]} (synthetic: see ${["", "var", "tmp", "mth-run.ABC123", "x"].join("/")})`;
    const snap = buildSnapshot({
      csvBytes,
      parsed: { columns: parsed.columns, rows: planted },
      externalDependencies: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.ok(t1Findings(snap).includes(`${planted[0][0]} notes R2`), JSON.stringify(t1Findings(snap)));
  });
});
