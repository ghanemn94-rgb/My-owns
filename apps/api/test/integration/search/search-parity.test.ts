// The search parity test (ADR-0057 §3 "Parity rule"; REQ-S15-010 "Search returns only records the user may read";
// T-DG6-BE-P2; p6-work-split §H/G.2). For each of the 12 indexed record types and every reader of T-DG6-BE-B's
// ReadScope parity fixture (the 14 seeded roles at organization, business-unit and transformation scope; each
// transformation's lead, owners and Finance; a reader whose only assignment is revoked; and the world's office, admin,
// auditor, unit lead, nobody and the other organization's office), against the run's disposable PostgreSQL:
//
//   searchRecords returns the record   iff   the record's own view returns it (its GET answers 200; for a lesson, which
//                                            has no item GET, its transformation's lesson list contains it)
//
// including a SENSITIVE benefit, business case and evidence item with and without a grant (active, revoked, held by a
// reader who cannot read the transformation), as a named party, and the same three types not sensitive. The fixture:
// T1 in the NESTED unit a1x (under a1; its three sensitive-type records marked sensitive), T2 in the sibling unit a2
// (not marked), T3 in organization B (marked). The index is built by the real worker reindex job (T-DG6-BE-P). The test
// prints the pair count; a mismatch lists the pair. Every value is SYNTHETIC; nothing here grants a business approval
// or touches DG0-DG7.
import { ROLE_CODES } from "@mth/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEARCH_RECORD_TYPES } from "../../../src/modules/search/query.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { call, createUser, grant, seedWorld, signIn, type Session, type World } from "../../support/harness.ts";
import { searchAll, seedTwelve, startSearchDb, type FixtureRecord, type SearchDb } from "./search-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

interface Reader {
  readonly label: string;
  readonly session: Session;
}

let s: SearchDb;
let w: World;
const records: (FixtureRecord & { readonly sensitive: boolean })[] = [];
const readers: Reader[] = [];

const SENSITIVE_TYPES = ["benefit", "business_case", "evidence"] as const;

beforeAll(async () => {
  s = await startSearchDb("mth_be_p2_parity");
  w = await seedWorld(s.db);
  const office = await signIn(s.api.app, w.office.subject);
  const officeB = await signIn(s.api.app, w.officeB.subject);
  const t1 = await seedTwelve(s.api, w, "wombat", { organizationId: w.orgA.id, businessUnitId: w.a1x });
  const t2 = await seedTwelve(s.api, w, "wombat", { organizationId: w.orgA.id, businessUnitId: w.a2 });
  const t3 = await seedTwelve(s.api, w, "wombat", { organizationId: w.orgB.id, businessUnitId: w.b1 });
  for (const [t, marker, sensitive] of [
    [t1, office, true],
    [t2, office, false],
    [t3, officeB, true],
  ] as const) {
    for (const r of t.records) {
      const isSensitive = sensitive && (SENSITIVE_TYPES as readonly string[]).includes(r.type);
      records.push({ ...r, sensitive: isSensitive });
      if (!isSensitive) continue;
      const res = await call<Body>(s.api.app, "PUT", `${t.b.base}/records/${r.type}/${r.id}/sensitivity`, {
        session: marker,
        headers: ifm(0),
        body: { isSensitive: true, reason: "Synthetic search parity fixture" },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    for (const k of ["tl", "bo", "bo2", "fin"] as const)
      readers.push({ label: `${k.toUpperCase()}@tr:${t.b.transformationId}`, session: t.b.s[k] });
  }
  // The 14 seeded roles at organization (A), business-unit (a1, the parent of T1's unit) and transformation (T1) scope.
  const scopes = [
    { type: "organization" as const, id: w.orgA.id, tag: "org:A" },
    { type: "business_unit" as const, id: w.a1, tag: "bu:a1" },
    { type: "transformation" as const, id: t1.b.transformationId, tag: "tr:T1" },
  ];
  expect(ROLE_CODES).toHaveLength(14);
  const userOf = new Map<string, string>();
  for (const sc of scopes)
    for (const role of ROLE_CODES) {
      const u = await createUser(s.db, w.orgA.id);
      await grant(s.db, w.grantor.id, u.id, role, { type: sc.type, id: sc.id }, w.orgA.id);
      const label = `${role}@${sc.tag}`;
      userOf.set(label, u.id);
      readers.push({ label, session: await signIn(s.api.app, u.subject) });
    }
  // A reader whose only assignment (TO @ org A) is revoked: reads nothing.
  const revoked = await createUser(s.db, w.orgA.id);
  await grant(s.db, w.grantor.id, revoked.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  const revokedSession = await signIn(s.api.app, revoked.subject);
  await s.api.owner.query(
    `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic parity fixture' where user_id = $2`,
    [w.grantor.id, revoked.id],
  );
  readers.push({ label: "revoked-TO@org:A", session: revokedSession });
  for (const name of ["office", "admin", "auditor", "leadA1", "nobody", "officeB"] as const)
    readers.push({ label: `world:${name}`, session: await signIn(s.api.app, w[name].subject) });
  // Grants on T1's sensitive records: active (a T1 workstream lead; a BU-level KDS who cannot read T1 at all), and
  // revoked (a T1 security reviewer).
  const sensitiveOf = (type: string) =>
    records.find((r) => r.transformationId === t1.b.transformationId && r.type === type)!;
  const mkGrant = async (label: string, type: string) => {
    const rec = sensitiveOf(type);
    const res = await call<Body>(s.api.app, "POST", "/api/v1/admin/sensitive-grants", {
      session: office,
      body: {
        transformationId: rec.transformationId,
        recordType: rec.type,
        recordId: rec.id,
        granteeUserId: userOf.get(label)!,
        reason: "Synthetic search parity grant",
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  await mkGrant("WL@tr:T1", "benefit");
  await mkGrant("WL@tr:T1", "business_case");
  await mkGrant("KDS@bu:a1", "benefit");
  const toRevoke = await mkGrant("SEC@tr:T1", "evidence");
  const rv = await call<Body>(s.api.app, "POST", `/api/v1/admin/sensitive-grants/${toRevoke}/revoke`, {
    session: office,
    headers: ifm(1),
    body: { reason: "Synthetic search parity revocation" },
  });
  expect(rv.status, JSON.stringify(rv.body)).toBe(200);
  await s.reindex();
}, 600_000);
afterAll(async () => {
  await s?.close();
}, 60_000);

/** The record's own view: 200 (and, for the lesson list, containing it) = readable. */
async function viewAdmits(reader: Reader, r: FixtureRecord): Promise<{ readable: boolean; status: number }> {
  const res = await call<Body>(s.api.app, "GET", r.viewUrl, { session: reader.session });
  if (res.status !== 200) return { readable: false, status: res.status };
  if (!r.viewIsList) return { readable: true, status: 200 };
  return { readable: (res.body.items as Body[]).some((i) => i.id === r.id), status: 200 };
}

describe("search parity (ADR-0057 §3): a hit iff the record's own view returns it", () => {
  it("for every (reader, record) pair of the 12 types", { timeout: 600_000 }, async () => {
    expect(new Set(records.map((r) => r.type))).toEqual(new Set(SEARCH_RECORD_TYPES));
    expect(records).toHaveLength(36);
    const mismatches: string[] = [];
    let pairs = 0;
    let admitted = 0;
    let sensitivePairs = 0;
    const perType = new Map<string, { hits: number; misses: number }>();
    for (const reader of readers) {
      const res = await call<Body>(s.api.app, "GET", "/api/v1/search?q=wombat&limit=1", { session: reader.session });
      // A reader without transformation.read anywhere is refused (403) and so finds nothing.
      const hits =
        res.status === 403
          ? new Set<string>()
          : new Set(
              (await searchAll(s.api, reader.session, "wombat")).map((h: Body) => `${h.recordType}:${h.recordId}`),
            );
      if (res.status !== 200 && res.status !== 403) mismatches.push(`${reader.label}: search answered ${res.status}`);
      for (const r of records) {
        pairs += 1;
        if (r.sensitive) sensitivePairs += 1;
        const view = await viewAdmits(reader, r);
        if (![200, 403, 404].includes(view.status))
          mismatches.push(`${reader.label} x ${r.type}:${r.id}: view answered ${view.status}`);
        const hit = hits.has(`${r.type}:${r.id}`);
        if (hit) admitted += 1;
        const t = perType.get(r.type) ?? { hits: 0, misses: 0 };
        perType.set(r.type, hit ? { ...t, hits: t.hits + 1 } : { ...t, misses: t.misses + 1 });
        if (hit !== view.readable)
          mismatches.push(
            `${reader.label} x ${r.type}${r.sensitive ? "(sensitive)" : ""}:${r.id} search=${hit} view=${view.readable} (${view.status})`,
          );
      }
    }
    console.log(
      `[search-parity] readers=${readers.length} records=${records.length} pairs=${pairs} admitted=${admitted} ` +
        `sensitive-pairs=${sensitivePairs} mismatches=${mismatches.length} per-type=${JSON.stringify(Object.fromEntries(perType))}`,
    );
    expect(mismatches, mismatches.join("\n")).toEqual([]);
    expect(pairs).toBe(readers.length * 36);
    // The fixture exercises both outcomes for every type.
    for (const [type, t] of perType) {
      expect(t.hits, type).toBeGreaterThan(0);
      expect(t.misses, type).toBeGreaterThan(0);
    }
  });

  it("the sensitivity admissions are the expected ones (grant, revoked grant, party, TO, AUD, no transformation read)", async () => {
    const t1 = records.find((r) => r.type === "transformation" && r.transformationId === records[0]!.transformationId)!;
    const sb = records.find((r) => r.transformationId === t1.id && r.type === "benefit")!;
    const se = records.find((r) => r.transformationId === t1.id && r.type === "evidence")!;
    const sees = async (label: string, r: FixtureRecord) => {
      const reader = readers.find((x) => x.label === label)!;
      const res = await call<Body>(s.api.app, "GET", `/api/v1/search?q=wombat&recordType=${r.type}&limit=100`, {
        session: reader.session,
      });
      return res.status === 200 && (res.body.items as Body[]).some((h) => h.recordId === r.id);
    };
    expect(sb.sensitive && se.sensitive).toBe(true);
    expect(await sees("WL@tr:T1", sb)).toBe(true); // active grant
    expect(await sees("SEC@tr:T1", se)).toBe(false); // revoked grant
    expect(await sees("TD@tr:T1", sb)).toBe(false); // a member without a grant (REQ-S10-002)
    expect(await sees("KDS@bu:a1", sb)).toBe(false); // granted but no transformation read: the grant never widens
    expect(await sees("TO@org:A", sb)).toBe(true); // sensitive_record.grant at scope
    expect(await sees("AUD@org:A", sb)).toBe(false); // AUD alone admits nothing
    expect(await sees(`BO@tr:${t1.id}`, sb)).toBe(true); // the benefit's owner: named party
    expect(await sees(`TL@tr:${t1.id}`, se)).toBe(true); // the evidence's owner and creator: named party
    expect(await sees(`BO2@tr:${t1.id}`, sb)).toBe(false); // a BO at T1 who is not this benefit's named party
  });
});
