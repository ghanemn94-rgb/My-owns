// Self-test of the shared key-shape patterns (ADR-0062 §8 R3, ADR-0063 §1.2 S1). Planted values are assembled at
// run time from fragments, so this file never contains a whole key shape. Run: node --test tools/release/tests/*.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { KEY_SHAPES, keyShapeRegExps, mask } from "../lib/patterns.mjs";

const rep = (s, n) => s.repeat(n);
const PLANTED = {
  "anthropic-api-key": ["sk-" + "ant-" + rep("a1B2", 6)],
  "openai-style-api-key": ["sk" + "-" + rep("Ab3D", 9)],
  "aws-access-key-id": ["AK" + "IA" + rep("Q7", 8), "AS" + "IA" + rep("Z9", 8)],
  "github-token": ["gh" + "p_" + rep("aB1c", 9)],
  "github-fine-grained-token": ["github" + "_pat_" + rep("aB1_", 16)],
  "slack-token": ["xo" + "xb-" + rep("12ab", 4)],
  "google-api-key": ["AI" + "za" + rep("Bc1_", 8) + "xyz"],
  "private-key-block": ["-----BEGIN " + "RSA PRIVATE" + " KEY-----"],
  jwt: ["ey" + "J" + rep("hbGci", 3) + ".ey" + "J" + "zdWIi"],
};
const CLEAN = [
  "AKIA-lowercase-akiaabcdefghijklmnop",
  "sha512-" + rep("Ab+/", 20) + "==",
  "a".repeat(64),
  "sk-short",
  "-----BEGIN CERTIFICATE-----",
  "ghp_tooShort",
  "DATABASE_URL_FILE=/run/secrets/db_url",
];

function classify(text) {
  const hits = [];
  for (const [cls, re] of keyShapeRegExps()) for (const m of text.matchAll(re)) hits.push([cls, m[0]]);
  return hits;
}

test("every key shape has a planted sample, and every planted sample is classified as its own class", () => {
  assert.deepEqual(Object.keys(PLANTED).sort(), KEY_SHAPES.map(([c]) => c).sort());
  for (const [cls, samples] of Object.entries(PLANTED)) {
    for (const s of samples) {
      const hits = classify(`prefix ${s} suffix`);
      assert.ok(
        hits.some(([c]) => c === cls),
        `${cls} not detected`,
      );
    }
  }
});

test("clean look-alikes are not detected", () => {
  for (const s of CLEAN) assert.deepEqual(classify(` ${s} `), [], s.slice(0, 12));
});

test("mask never prints more than four characters of the value", () => {
  const v = PLANTED["aws-access-key-id"][0];
  const m = mask("aws-access-key-id", v);
  assert.equal(m, `[aws-access-key-id:${v.slice(0, 4)}…]`);
  assert.ok(!m.includes(v.slice(0, 5)));
});

test("this module's own source contains no detectable key shape", () => {
  const src = readFileSync(fileURLToPath(new URL("../lib/patterns.mjs", import.meta.url)), "utf8");
  assert.deepEqual(classify(src), []);
});

test("compiled RegExps are fresh per call (no shared lastIndex state)", () => {
  const a = keyShapeRegExps();
  const b = keyShapeRegExps();
  for (let i = 0; i < a.length; i++) assert.notEqual(a[i][1], b[i][1]);
});
