// node --test deploy/load/export-proof.node-test.mjs (T-DG6-BE-S): the export proof's pure helpers. Outside Vitest,
// like harness.node-test.mjs: no Vitest project includes deploy/load. No database, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { matchUsers, nearestRank, nonDecreasing, REGISTERS, START_TARGET_MS } from "./export-proof.mjs";

test("nearest rank: rank = ceil(p·n/100) on the sorted integers; no sample is null, never 0", () => {
  assert.equal(nearestRank([5, 1, 3], 95), 5);
  assert.equal(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(
    nearestRank(
      Array.from({ length: 20 }, (_, i) => i + 1),
      95,
    ),
    19,
  );
  assert.equal(nearestRank([], 95), null);
});

test("percent sequences: equal steps are allowed, a decrease is not", () => {
  assert.equal(nonDecreasing([0, 0, 40, 40, 100]), true);
  assert.equal(nonDecreasing([0, 60, 50, 100]), false);
  assert.equal(nonDecreasing([]), true);
});

test("the 50-at-once plan gives each transformation a different user (augmenting paths), deterministically", () => {
  const candidates = new Map([
    ["t1", [1, 2]],
    ["t2", [1]],
    ["t3", [2, 3]],
    ["t4", []],
  ]);
  const m = matchUsers(["t1", "t2", "t3", "t4"], candidates);
  assert.deepEqual(Object.fromEntries(m), { t1: 2, t2: 1, t3: 3 });
  assert.equal(new Set(m.values()).size, m.size);
  assert.deepEqual(Object.fromEntries(matchUsers(["t1", "t2", "t3", "t4"], candidates)), Object.fromEntries(m));
});

test("the proof covers the six registers and the 2 s start target (ADR-0058 §7)", () => {
  assert.deepEqual(REGISTERS, ["raid", "benefits", "kpis", "decisions", "dependencies", "actions"]);
  assert.equal(START_TARGET_MS, 2000);
});
