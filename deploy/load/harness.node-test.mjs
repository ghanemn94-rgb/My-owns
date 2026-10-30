// Self-test of the load harness's pure parts (T-DG6-DO-F): nearest-rank percentiles, the integer sample conversion, the
// class draw, the think time, the update partition and the search terms. Node's built-in runner, no dependency, no
// database:   node --test deploy/load/harness.node-test.mjs
// (Not in a Vitest project: the Vitest include lists do not cover deploy/; see the T-DG6-DO-F handback.)
import assert from "node:assert/strict";
import { test } from "node:test";
import { nearestRank, summarize } from "./report.mjs";
import { CLASSES, buildPlan, micros, pickClass, searchTerms, thinkMs, userRng } from "./workload.mjs";

test("nearest-rank percentiles: rank = ceil(p/100 * n), no interpolation", () => {
  const s = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  assert.equal(nearestRank(s, 50), 50);
  assert.equal(nearestRank(s, 95), 95);
  assert.equal(nearestRank(s, 99), 99);
  assert.equal(nearestRank(s, 100), 100);
  assert.equal(nearestRank([7], 95), 7);
  assert.equal(nearestRank([1, 2, 3], 95), 3); // ceil(2.85) = 3
  assert.equal(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 95), 19); // ceil(19)
  assert.equal(
    nearestRank(
      Array.from({ length: 21 }, (_, i) => i + 1),
      95,
    ),
    20,
  ); // ceil(19.95) = 20
  assert.equal(nearestRank([], 95), null);
});

test("summarize counts errors and conflicts and reports null (not 0) when nothing was measured", () => {
  const rows = [
    { micros: 10, outcome: "ok" },
    { micros: 30, outcome: "error" },
    { micros: 20, outcome: "conflict" },
  ];
  assert.deepEqual(summarize(rows), { count: 3, errors: 1, conflicts: 1, p50: 20, p95: 30, p99: 30, max: 30 });
  assert.deepEqual(summarize([]), { count: 0, errors: 0, conflicts: 0, p50: null, p95: null, p99: null, max: null });
});

test("samples are integer microseconds", () => {
  assert.equal(micros(1000, 1001.2345), 1235);
  assert.ok(Number.isInteger(micros(0.1, 0.30000000000000004)));
});

test("the class draw follows the ADR-0058 §3 shares and leaves out unavailable classes", () => {
  assert.equal(
    CLASSES.reduce((s, c) => s + c.share, 0),
    100,
  );
  const rng = userRng(20261027, 1, 0);
  const all = new Set(CLASSES.map((c) => c.key));
  const n = 100000;
  const counts = Object.fromEntries(CLASSES.map((c) => [c.key, 0]));
  for (let i = 0; i < n; i++) counts[pickClass(rng, all)]++;
  for (const c of CLASSES) assert.ok(Math.abs((counts[c.key] * 100) / n - c.share) < 0.5, `${c.key} ${counts[c.key]}`);
  const noUpdate = new Set(["read", "search", "dashboard"]);
  for (let i = 0; i < 1000; i++) assert.ok(noUpdate.has(pickClass(rng, noUpdate)));
});

test("think time is a whole number of milliseconds in 1000-3000, and the sequence is deterministic", () => {
  const a = userRng(20261027, 2, 5);
  const b = userRng(20261027, 2, 5);
  for (let i = 0; i < 5000; i++) {
    const t = thinkMs(a);
    assert.equal(t, thinkMs(b));
    assert.ok(Number.isInteger(t) && t >= 1000 && t <= 3000);
  }
  assert.notEqual(userRng(20261027, 2, 5)(), userRng(20261027, 2, 6)());
});

test("the update partition gives each initiative to exactly one editor of its transformation", () => {
  const sessions = [0, 1, 2, 3].map((i) => ({ userId: `u${i}`, roles: ["TL"] }));
  const d = {
    assignments: [
      { user_id: "u0", transformation_id: "t1", can_edit: true },
      { user_id: "u1", transformation_id: "t1", can_edit: true },
      { user_id: "u2", transformation_id: "t1", can_edit: false },
      { user_id: "u3", transformation_id: "t2", can_edit: true },
    ],
    initiatives: [1, 2, 3, 4, 5].map((n) => ({ id: `i${n}`, transformation_id: n <= 3 ? "t1" : "t2" })),
    workstreams: [],
    transformations: [{ id: "t1", organization_id: "o1" }],
    reportDefs: [],
  };
  const plan = buildPlan(sessions, d);
  const owned = plan.flatMap((u) => u.ownUpdates.map((o) => o.id));
  assert.deepEqual([...owned].sort(), ["i1", "i2", "i3", "i4", "i5"]);
  assert.equal(new Set(owned).size, owned.length);
  assert.deepEqual(plan[2].ownUpdates, []); // no initiative.edit: never an update target
  assert.ok(plan[3].ownUpdates.every((o) => ["i4", "i5"].includes(o.id)));
});

test("search terms come from the generated titles, without the LOAD label", () => {
  assert.deepEqual(searchTerms(["LOAD Network modernisation 12", "تجريبي تحسين الشبكة", "LOAD Billing"]), [
    "billing",
    "modernisation",
    "network",
    "الشبكة",
    "تحسين",
  ]);
});
