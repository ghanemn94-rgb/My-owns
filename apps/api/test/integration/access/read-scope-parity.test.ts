// The ReadScope parity test (ADR-0051 §1; REQ-S10-004; T-DG6-BE-B). Against the run's disposable PostgreSQL, for a
// fixture of 2 organizations, 3 business units (a1 with its nested child a1x, and the sibling a2; plus org B's b1),
// 3 transformations, the 14 seeded roles at organization, business-unit and transformation scope, and benefits,
// business cases and evidence items each in a sensitive and a non-sensitive state, with grants active and revoked:
// for every (reader, record) pair,
//   ReadScope.predicate selects the row   iff   ReadScope.admits returns true   iff   the record view admits it.
// The record view is: the record's GET (200 vs 404) for every non-sensitive record; for a sensitive record, the
// record-view decision `requireTransformationRead` + `requireSensitiveRead` that the record GETs call (wiring those
// two calls into the benefit, business-case and evidence GET routes is task BE-B2, p6-work-split §E/F.3; until then
// the sensitive pairs' HTTP leg is the sensitivity flag's own record-read rule, see the handback). The test prints the
// pair count; a mismatch lists the pair. Every value is SYNTHETIC; nothing here grants a business approval or touches
// DG0-DG7.
import { insertAuditEvent, sql, type Expression } from "@mth/db";
import { ROLE_CODES } from "@mth/shared";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpProblem } from "../../../src/modules/platform/index.ts";
import {
  loadGrants,
  readScopeFor,
  requireSensitiveRead,
  requireTransformationRead,
  resolveTarget,
  type Principal,
  type ReadScope,
  type ResolvedTarget,
  type SensitiveRecordType,
} from "../../../src/modules/access/index.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

interface FixtureRecord {
  readonly type: SensitiveRecordType;
  readonly id: string;
  readonly transformationId: string;
  readonly getUrl: string;
  readonly sensitive: boolean;
  readonly parties: readonly (string | null)[];
}

interface Reader {
  readonly label: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly session: Session;
}

let api: TestApi;
let w: World;
const records: FixtureRecord[] = [];
const readers: Reader[] = [];
let initiativeSeq = 100;

/** A transformation with its TL and BO, two benefits, two business cases and two evidence items. */
async function seedTransformation(organizationId: string, businessUnitId: string, marker: Session) {
  const transformationId = await createTransformationRow(api.db, organizationId, businessUnitId, w.grantor.id);
  const scope = { type: "transformation" as const, id: transformationId };
  const tl = await createUser(api.db, organizationId);
  const bo = await createUser(api.db, organizationId);
  await grant(api.db, w.grantor.id, tl.id, "TL", scope, organizationId);
  await grant(api.db, w.grantor.id, bo.id, "BO", scope, organizationId);
  const tlS = await signIn(api.app, tl.subject);
  const boS = await signIn(api.app, bo.subject);
  readers.push({ label: `TL@tr:${transformationId}`, userId: tl.id, organizationId, session: tlS });
  readers.push({ label: `BO@tr:${transformationId}`, userId: bo.id, organizationId, session: boS });
  const base = `/api/v1/transformations/${transformationId}`;
  const ok = (res: { status: number; body: Body }, status = 201) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body.id as string;
  };
  const out: FixtureRecord[] = [];
  for (const sensitive of [true, false]) {
    const benefitId = ok(
      await call<Body>(api.app, "POST", `${base}/benefits`, {
        session: boS,
        body: {
          title: `Synthetic parity benefit ${sensitive ? "S" : "N"}`,
          description: "Synthetic.",
          benefitType: "revenue",
          valueClass: "revenue_uplift",
          ownerUserId: bo.id,
          currency: "SAR",
          financialStatementLine: "Revenue - prepaid",
        },
      }),
    );
    out.push({
      type: "benefit",
      id: benefitId,
      transformationId,
      getUrl: `${base}/benefits/${benefitId}`,
      sensitive,
      parties: [bo.id, null, bo.id],
    });
    const evidenceId = ok(
      await call<Body>(api.app, "POST", `${base}/evidence`, {
        session: tlS,
        body: {
          kind: "note",
          title: `Synthetic parity note ${sensitive ? "S" : "N"}`,
          noteBody: "Synthetic",
          ownerUserId: tl.id,
        },
      }),
    );
    out.push({
      type: "evidence",
      id: evidenceId,
      transformationId,
      getUrl: `${base}/evidence/${evidenceId}`,
      sensitive,
      parties: [tl.id, tl.id],
    });
  }
  // Business cases: one transformation-level case, one initiative-level case (an initiative written directly with
  // its audit event, as the P2 audit guard demands; its routes belong to another module).
  const tCase = ok(
    await call<Body>(api.app, "POST", "/api/v1/business-cases", {
      session: tlS,
      body: { transformationId, level: "transformation", title: "Synthetic parity case S" },
    }),
  );
  const initiativeId = uuidv7();
  initiativeSeq += 1;
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("initiative")
      .values({
        id: initiativeId,
        organization_id: organizationId,
        transformation_id: transformationId,
        code: `INI-${String(initiativeSeq).padStart(4, "0")}`,
        name: `Synthetic parity initiative ${initiativeSeq}`,
        created_by: tl.id,
        updated_by: tl.id,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: tl.id, requestId: `fixture-${initiativeId}`, source: "api" },
      {
        action: "initiative.create",
        recordType: "initiative",
        recordId: initiativeId,
        organizationId,
        transformationId,
        newVersion: 1,
      },
    );
  });
  const iCase = ok(
    await call<Body>(api.app, "POST", "/api/v1/business-cases", {
      session: tlS,
      body: { transformationId, level: "initiative", initiativeId, title: "Synthetic parity case N" },
    }),
  );
  for (const [id, sensitive] of [
    [tCase, true],
    [iCase, false],
  ] as const)
    out.push({
      type: "business_case",
      id,
      transformationId,
      getUrl: `/api/v1/business-cases/${id}`,
      sensitive,
      parties: [null, null, null, tl.id],
    });
  // Mark the sensitive half (by the organization's TO), and mark one non-sensitive record "unmarked" explicitly
  // (a flag row with is_sensitive = false must behave like no row).
  for (const r of out.filter((x) => x.sensitive)) {
    const res = await call<Body>(api.app, "PUT", `${base}/records/${r.type}/${r.id}/sensitivity`, {
      session: marker,
      headers: ifm(0),
      body: { isSensitive: true, reason: "Synthetic parity fixture" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  const unmarked = out.find((x) => !x.sensitive && x.type === "evidence")!;
  const res = await call<Body>(api.app, "PUT", `${base}/records/evidence/${unmarked.id}/sensitivity`, {
    session: marker,
    headers: ifm(0),
    body: { isSensitive: false, reason: "Synthetic parity fixture (explicitly not sensitive)" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  records.push(...out);
  return { transformationId, tl, bo };
}

async function principalOfUser(userId: string, organizationId: string): Promise<Principal> {
  return { kind: "user", userId, organizationId, grants: await loadGrants(api.db, userId), tracker: { decisions: 0 } };
}

/** The ids of `type` (among the fixture's) that the SQL predicate selects for this scope. */
async function selected(scope: ReadScope, type: SensitiveRecordType, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const ref = (c: string) => sql.ref(`r.${c}`) as Expression<string | null>;
  if (type === "benefit") {
    const rows = await api.db
      .selectFrom("benefit as r")
      .innerJoin("transformation as t", "t.id", "r.transformation_id")
      .select("r.id")
      .where("r.id", "in", ids)
      .where(
        scope.predicate({
          recordType: "benefit",
          recordId: sql.ref("r.id"),
          organizationId: sql.ref("r.organization_id"),
          businessUnitId: sql.ref("t.business_unit_id"),
          transformationId: sql.ref("r.transformation_id"),
          partyUserIds: [ref("owner_user_id"), ref("finance_validator_user_id"), ref("created_by")],
        }),
      )
      .execute();
    return new Set(rows.map((r) => r.id));
  }
  if (type === "business_case") {
    const rows = await api.db
      .selectFrom("business_case as r")
      .select("r.id")
      .where("r.id", "in", ids)
      .where(
        scope.predicate({
          recordType: "business_case",
          recordId: sql.ref("r.id"),
          organizationId: sql.ref("r.organization_id"),
          businessUnitId: sql<
            string | null
          >`(SELECT t.business_unit_id FROM transformation t WHERE t.id = r.transformation_id)`,
          transformationId: sql.ref("r.transformation_id"),
          partyUserIds: [
            ref("benefit_owner_user_id"),
            ref("initiative_owner_user_id"),
            ref("finance_validator_user_id"),
            ref("created_by"),
          ],
        }),
      )
      .execute();
    return new Set(rows.map((r) => r.id));
  }
  // Evidence omits businessUnitId: the predicate derives it from the transformation (ReadScopeColumns contract).
  const rows = await api.db
    .selectFrom("evidence as r")
    .select("r.id")
    .where("r.id", "in", ids)
    .where(
      scope.predicate({
        recordType: "evidence",
        recordId: sql.ref("r.id"),
        organizationId: sql.ref("r.organization_id"),
        transformationId: sql.ref("r.transformation_id"),
        partyUserIds: [ref("owner_user_id"), ref("created_by")],
      }),
    )
    .execute();
  return new Set(rows.map((r) => r.id));
}

/** The record-view decision the record GETs make for a sensitive type (ADR-0051 §1). */
async function recordViewAdmits(p: Principal, r: FixtureRecord): Promise<boolean> {
  try {
    const target = await requireTransformationRead(api.db, p, r.transformationId);
    await requireSensitiveRead(api.db, p, r.type, r.id, target, r.parties);
    return true;
  } catch (err) {
    if (err instanceof HttpProblem && err.status === 404) return false;
    throw err;
  }
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const office = await signIn(api.app, w.office.subject);
  const officeB = await signIn(api.app, w.officeB.subject);
  // T1 in the NESTED unit a1x (under a1), T2 in the sibling unit a2, T3 in organization B.
  const t1 = await seedTransformation(w.orgA.id, w.a1x, office);
  await seedTransformation(w.orgA.id, w.a2, office);
  await seedTransformation(w.orgB.id, w.b1, officeB);
  // The 14 seeded roles at organization (A), business-unit (a1, the parent of T1's unit) and transformation (T1) scope.
  const scopes = [
    { type: "organization" as const, id: w.orgA.id, tag: "org:A" },
    { type: "business_unit" as const, id: w.a1, tag: "bu:a1" },
    { type: "transformation" as const, id: t1.transformationId, tag: "tr:T1" },
  ];
  expect(ROLE_CODES).toHaveLength(14);
  for (const s of scopes)
    for (const role of ROLE_CODES) {
      const u = await createUser(api.db, w.orgA.id);
      await grant(api.db, w.grantor.id, u.id, role, { type: s.type, id: s.id }, w.orgA.id);
      readers.push({
        label: `${role}@${s.tag}`,
        userId: u.id,
        organizationId: w.orgA.id,
        session: await signIn(api.app, u.subject),
      });
    }
  // A reader whose only assignment (TO @ org A) is revoked: reads nothing.
  const revoked = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, revoked.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
  await api.owner.query(
    `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic parity fixture' where user_id = $2`,
    [w.grantor.id, revoked.id],
  );
  readers.push({
    label: "revoked-TO@org:A",
    userId: revoked.id,
    organizationId: w.orgA.id,
    session: await signIn(api.app, revoked.subject),
  });
  for (const name of ["office", "admin", "auditor", "leadA1", "nobody", "officeB"] as const)
    readers.push({
      label: `world:${name}`,
      userId: w[name].id,
      organizationId: name === "officeB" ? w.orgB.id : w.orgA.id,
      session: await signIn(api.app, w[name].subject),
    });
  // Grants: active (a T1 workstream lead, a BU-level KDS who cannot read T1 at all), and revoked (a T1 SME).
  const who = (label: string) => readers.find((r) => r.label === label)!;
  const sensitiveOf = (type: SensitiveRecordType) =>
    records.find((r) => r.transformationId === t1.transformationId && r.sensitive && r.type === type)!;
  const mkGrant = async (reader: Reader, rec: FixtureRecord) => {
    const res = await call<Body>(api.app, "POST", "/api/v1/admin/sensitive-grants", {
      session: office,
      body: {
        transformationId: rec.transformationId,
        recordType: rec.type,
        recordId: rec.id,
        granteeUserId: reader.userId,
        reason: "Synthetic parity grant",
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  await mkGrant(who("WL@tr:T1"), sensitiveOf("benefit"));
  await mkGrant(who("WL@tr:T1"), sensitiveOf("business_case"));
  await mkGrant(who("KDS@bu:a1"), sensitiveOf("benefit"));
  const toRevoke = await mkGrant(who("SEC@tr:T1"), sensitiveOf("evidence"));
  const rv = await call<Body>(api.app, "POST", `/api/v1/admin/sensitive-grants/${toRevoke}/revoke`, {
    session: office,
    headers: ifm(1),
    body: { reason: "Synthetic parity revocation" },
  });
  expect(rv.status, JSON.stringify(rv.body)).toBe(200);
}, 300_000);
afterAll(() => api.close());

describe("ReadScope parity (ADR-0051 §1)", () => {
  it("predicate <=> admits <=> record view, for every (reader, record) pair", { timeout: 300_000 }, async () => {
    const mismatches: string[] = [];
    const targets = new Map<string, ResolvedTarget>();
    for (const r of records)
      if (!targets.has(r.transformationId))
        targets.set(
          r.transformationId,
          (await resolveTarget(api.db, { type: "transformation", id: r.transformationId }))!,
        );
    let pairs = 0;
    let admittedPairs = 0;
    let httpPairs = 0;
    let decisionPairs = 0;
    for (const reader of readers) {
      const p = await principalOfUser(reader.userId, reader.organizationId);
      const scope = await readScopeFor(api.db, p, "transformation.read");
      const sel = new Map<SensitiveRecordType, Set<string>>();
      for (const type of ["benefit", "business_case", "evidence"] as const)
        sel.set(
          type,
          await selected(
            scope,
            type,
            records.filter((r) => r.type === type).map((r) => r.id),
          ),
        );
      for (const r of records) {
        pairs += 1;
        const inSql = sel.get(r.type)!.has(r.id);
        const inMemory = scope.admits({
          recordType: r.type,
          recordId: r.id,
          target: targets.get(r.transformationId)!,
          partyUserIds: r.parties,
        });
        let view: boolean;
        if (r.sensitive) {
          view = await recordViewAdmits(p, r);
          decisionPairs += 1;
        } else {
          const res = await call(api.app, "GET", r.getUrl, { session: reader.session });
          if (res.status !== 200 && res.status !== 404)
            mismatches.push(`${reader.label} x ${r.type}:${r.id}: GET answered ${res.status}`);
          view = res.status === 200;
          httpPairs += 1;
        }
        if (inSql) admittedPairs += 1;
        if (inSql !== inMemory || inMemory !== view)
          mismatches.push(
            `${reader.label} x ${r.type}${r.sensitive ? "(sensitive)" : ""}:${r.id} predicate=${inSql} admits=${inMemory} view=${view}`,
          );
      }
    }
    console.log(
      `[read-scope-parity] readers=${readers.length} records=${records.length} pairs=${pairs} admitted=${admittedPairs} ` +
        `view-by-GET=${httpPairs} view-by-record-decision=${decisionPairs} mismatches=${mismatches.length}`,
    );
    expect(mismatches, mismatches.join("\n")).toEqual([]);
    expect(pairs).toBe(readers.length * 18);
    // The fixture really exercises both outcomes, the sensitivity clause and every admission rule.
    expect(admittedPairs).toBeGreaterThan(0);
    expect(admittedPairs).toBeLessThan(pairs);
  });

  it("the sensitivity clause's admissions are the expected ones (grant, revoked grant, party, TO, AUD, ADM_ACCESS)", async () => {
    const t1 = records[0]!.transformationId;
    const sb = records.find((r) => r.transformationId === t1 && r.sensitive && r.type === "benefit")!;
    const se = records.find((r) => r.transformationId === t1 && r.sensitive && r.type === "evidence")!;
    const admits = async (label: string, r: FixtureRecord) => {
      const reader = readers.find((x) => x.label === label)!;
      const p = await principalOfUser(reader.userId, reader.organizationId);
      const scope = await readScopeFor(api.db, p, "transformation.read");
      const target = (await resolveTarget(api.db, { type: "transformation", id: r.transformationId }))!;
      return scope.admits({ recordType: r.type, recordId: r.id, target, partyUserIds: r.parties });
    };
    expect(await admits("WL@tr:T1", sb)).toBe(true); // active grant
    expect(await admits("BO@tr:T1", sb)).toBe(false); // a BO at T1 who is not this benefit's named party
    expect(await admits("SEC@tr:T1", se)).toBe(false); // revoked grant
    expect(await admits("TD@tr:T1", sb)).toBe(false); // a member without a grant (REQ-S10-002)
    expect(await admits("KDS@bu:a1", sb)).toBe(false); // granted but no transformation read: the grant never widens
    expect(await admits("TO@org:A", sb)).toBe(true); // sensitive_record.grant at scope
    expect(await admits("AUD@org:A", sb)).toBe(false); // AUD alone admits nothing
    expect(await admits("ADM_ACCESS@org:A", sb)).toBe(false); // no transformation.read
    expect(await admits(`BO@tr:${t1}`, sb)).toBe(true); // the benefit's owner and creator: named party
    expect(await admits(`TL@tr:${t1}`, se)).toBe(true); // the evidence's owner and creator: named party
  });
});
