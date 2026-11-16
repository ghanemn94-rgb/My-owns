// T-A9 (ADR-0062 §7; REQ-S16-009 "any licence requiring procurement is flagged"): the SPDX classification table and
// the real inventory's two new columns. The flag is an engineering classification, not legal advice and not a
// procurement decision.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { classifyImage, classifyLicence, REASON_REQUIRED, reasonImage, reasonReview } from "../generate-sbom.mjs";
import { REPO } from "./helpers.mjs";

const C = (e, o) => classifyLicence(e, o).procurement;

test("T-A9 single permissive ids are not_required with an empty reason", () => {
  for (const id of [
    "MIT",
    "MIT-0",
    "ISC",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "0BSD",
    "BlueOak-1.0.0",
    "CC0-1.0",
    "Zlib",
  ])
    assert.deepEqual(classifyLicence(id), { procurement: "not_required", reason: "" }, id);
});

test("T-A9 OR needs one satisfied operand; AND needs all; parentheses and precedence", () => {
  assert.equal(C("(MIT OR GPL-3.0-or-later)"), "not_required");
  assert.equal(C("GPL-2.0-only OR LGPL-2.1-only"), "review");
  assert.equal(C("(MIT AND ISC)"), "not_required");
  assert.equal(C("MIT AND GPL-3.0-only"), "review");
  assert.equal(C("GPL-3.0-only OR MIT AND ISC"), "not_required"); // AND binds tighter
  assert.equal(C("(GPL-3.0-only OR MIT) AND MPL-2.0"), "review");
  assert.equal(C("Apache-2.0 WITH LLVM-exception"), "review"); // an exception is reviewed
});

test("T-A9 required: UNLICENSED, SEE LICENSE IN, LicenseRef-", () => {
  for (const e of ["UNLICENSED", "SEE LICENSE IN LICENSE.txt", "LicenseRef-Commercial", "(MIT OR LicenseRef-Vendor)"])
    assert.deepEqual(classifyLicence(e), { procurement: "required", reason: REASON_REQUIRED }, e);
  assert.equal(REASON_REQUIRED, "Custom or commercial licence: a procurement or legal decision is needed before use.");
});

test("T-A9 review: NOASSERTION, copyleft, OFL-1.1, CC-BY, Python-2.0, unparseable", () => {
  for (const e of [
    "NOASSERTION",
    "GPL-3.0-only",
    "LGPL-2.1-or-later",
    "AGPL-3.0-only",
    "MPL-2.0",
    "EPL-2.0",
    "CDDL-1.0",
    "OFL-1.1",
    "CC-BY-4.0",
    "Python-2.0",
    "MIT OR",
  ])
    assert.deepEqual(classifyLicence(e), { procurement: "review", reason: reasonReview(e) }, e);
  assert.equal(
    reasonReview("MPL-2.0"),
    "Licence MPL-2.0 is not in the permissive set: review the obligations before redistribution.",
  );
});

test("T-A9 PostgreSQL is permissive for images only; a multi-licence image note is review", () => {
  assert.equal(C("PostgreSQL"), "review");
  assert.deepEqual(classifyImage("PostgreSQL"), { procurement: "not_required", reason: "" });
  assert.deepEqual(classifyImage("Apache-2.0"), { procurement: "not_required", reason: "" });
  const note = "MIT (Node.js); Debian packages under their own licences";
  assert.deepEqual(classifyImage(note), { procurement: "review", reason: reasonImage(note) });
  assert.equal(reasonImage("x"), "Image contains components under several licences (x): review before redistribution.");
});

test("T-A9 the real inventory has the two new columns and no empty procurement; the expected base rows", () => {
  const lines = readFileSync(join(REPO, "licenses", "inventory.csv"), "utf8")
    .trim()
    .split("\n");
  assert.equal(lines[0], "name,version,license,scope,direct_dependency_of,integrity,procurement,procurement_reason");
  const rows = lines.slice(1).map((l) => l.split(","));
  for (const r of rows) assert.ok(["not_required", "review", "required"].includes(r[6]), `${r[0]}@${r[1]}: '${r[6]}'`);
  const by = new Map(rows.map((r) => [r[0], r]));
  assert.equal(by.get("@axe-core/playwright")[6], "review");
  assert.equal(by.get("@fontsource/ibm-plex-sans")[6], "review");
  assert.equal(by.get("@fontsource/ibm-plex-sans-arabic")[6], "review");
  assert.equal(by.get("jszip")[6], "not_required");
  const sbom = JSON.parse(readFileSync(join(REPO, "licenses", "sbom.cdx.json"), "utf8"));
  const prop = (c, n) => c.properties.find((p) => p.name === n)?.value;
  const images = Object.fromEntries(
    sbom.components.filter((c) => c.type === "container").map((c) => [c["bom-ref"], prop(c, "mth:procurement")]),
  );
  assert.deepEqual(images, {
    "container:node-runtime": "review",
    "container:postgres": "not_required",
    "container:keycloak": "not_required",
    "container:playwright": "review",
  });
  for (const c of sbom.components) {
    assert.ok(prop(c, "mth:procurement"), c["bom-ref"]);
    assert.notEqual(prop(c, "mth:procurement-reason"), undefined, c["bom-ref"]);
  }
});
