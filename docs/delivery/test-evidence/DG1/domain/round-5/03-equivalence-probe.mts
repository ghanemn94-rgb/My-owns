// DG1 round-5 domain-reviewer (reviewer-authored evidence, not part of the candidate).
// F-DG1-124 regression probe: the refactored module functions must behave exactly like the round-4 (016433d) versions.
// Run from the disposable clone root at 5f83a33 AFTER placing the round-4 files next to the new ones:
//   git show 016433d:apps/api/src/modules/platform/cursor.ts > apps/api/src/modules/platform/cursor.old.ts
//   git show 016433d:apps/api/src/modules/access/rules.ts    > apps/api/src/modules/access/rules.old.ts
//   node 03-equivalence-probe.mts
import { PERMISSIONS, TRANSFORMATION_STATUSES, TRANSFORMATION_STATUS_TRANSITIONS } from "@mth/shared";
import * as newCursor from "./apps/api/src/modules/platform/cursor.ts";
import * as oldCursor from "./apps/api/src/modules/platform/cursor.old.ts";
import * as newRules from "./apps/api/src/modules/access/rules.ts";
import * as oldRules from "./apps/api/src/modules/access/rules.old.ts";
import { isAllowedTransition, GOVERNED_TARGET_STATUSES } from "./apps/api/src/modules/transformations/routes.ts";

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`);
};

// 1. canonical JSON / filter hash: random nested objects with awkward keys (unicode, digits, case, surrogates, empty).
const KEYS = ["b", "a", "B", "A", "_", "10", "2", "z", "é", "ä", "\u{1F600}", "Ａ", "", "status", "sort", "q", "constructor", "toString"];
let seed = 42;
const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
function gen(depth: number): unknown {
  const t = rnd(depth > 2 ? 4 : 6);
  if (t === 0) return rnd(1000);
  if (t === 1) return KEYS[rnd(KEYS.length)];
  if (t === 2) return null;
  if (t === 3) return rnd(2) === 0;
  if (t === 4) return Array.from({ length: rnd(4) }, () => gen(depth + 1));
  const o: Record<string, unknown> = {};
  for (let i = rnd(6); i > 0; i -= 1) o[KEYS[rnd(KEYS.length)]] = gen(depth + 1);
  return o;
}
let mism = 0;
for (let i = 0; i < 20000; i += 1) {
  const v = gen(0);
  if (newCursor.canonicalJson(v) !== oldCursor.canonicalJson(v)) mism += 1;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const f = { ...(v as Record<string, unknown>), cursor: "x", limit: 5, undef: undefined };
    if (newCursor.filterHash(f) !== oldCursor.filterHash(f)) mism += 1;
  }
}
check("C1 canonicalJson + filterHash identical old vs new over 20000 random values", mism === 0, `mismatches=${mism}`);
// A realistic transformations list filter (the route's own shape): cursors issued before the change still validate.
const q = { sort: "name:asc", status: ["on_hold", "active"].sort(), businessUnitId: "01920000-0000-7000-9000-000000000102", q: "رحلة", limit: 2 };
check("C2 list filter hash unchanged", newCursor.filterHash(q) === oldCursor.filterHash(q), newCursor.filterHash(q));
const cur = oldCursor.encodeCursor(["2026-01-01T00:00:00.000000Z", "id-1"], oldCursor.filterHash(q));
let decoded: unknown;
try { decoded = newCursor.decodeCursor(cur, newCursor.filterHash(q), 2); } catch (e) { decoded = e; }
check("C3 a cursor encoded by the old code decodes under the new code", Array.isArray(decoded), JSON.stringify(decoded));
let refused = false;
try { newCursor.decodeCursor(cur, newCursor.filterHash({ ...q, sort: "name:desc" }), 2); } catch { refused = true; }
check("C4 the same cursor with a different filter is still refused", refused);

// 2. isApprovalPermission: identical classification for every permission (and an unknown string).
const perms = [...Object.keys(PERMISSIONS), "not.a.permission", "__proto__", "constructor"];
const diff = perms.filter((p) => newRules.isApprovalPermission(p as never) !== oldRules.isApprovalPermission(p as never));
check(`R1 isApprovalPermission identical for ${perms.length} inputs`, diff.length === 0, diff.join(","));
console.log("   approval permissions:", Object.keys(PERMISSIONS).filter((p) => newRules.isApprovalPermission(p as never)).join(", "));

// 3. isAllowedTransition vs the round-4 rule, over all 16 status pairs.
const oldAllowed = (from: string, to: string) =>
  from === to ? true : GOVERNED_TARGET_STATUSES.has(to as never) ? false : (TRANSFORMATION_STATUS_TRANSITIONS as Record<string, readonly string[]>)[from].includes(to);
const table: string[] = [];
let tdiff = 0;
for (const f of TRANSFORMATION_STATUSES)
  for (const t of TRANSFORMATION_STATUSES) {
    const n = isAllowedTransition(f, t);
    if (n !== oldAllowed(f, t)) tdiff += 1;
    if (n && f !== t) table.push(`${f}->${t}`);
  }
check("T1 isAllowedTransition identical over 16 pairs", tdiff === 0, `allowed non-noop: ${table.join(", ")}`);
check("T2 no transition into closed is allowed (G6 governs closure)", !TRANSFORMATION_STATUSES.some((f) => f !== "closed" && isAllowedTransition(f, "closed")));
console.log(`SUMMARY failures=${fail}`);
process.exit(fail ? 1 : 0);
