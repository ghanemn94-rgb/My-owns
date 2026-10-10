// qa-verifier acceptance support for A08 "Gate controls" (DG4, T-DG4-QA-B). Setup only; no assertion about a gate
// decision lives here.
//
// The world is built with NATIVE operations through the real API (Fastify inject; every response validated against
// docs/api/openapi.yaml by the harness):
//  - the transformation is created by a Transformation Lead with POST /api/v1/transformations (which instantiates the
//    six gate instances, the T11 decision rights and the forums);
//  - every role is granted by the access administrator through POST /api/v1/role-assignments;
//  - G1-G4 are passed the way a business user would: each missing mandatory criterion is covered by a gate exception
//    requested by the Lead and accepted by the Sponsor, then the Lead submits and the Sponsor approves.
// The only direct database writes are the harness's user rows (createUser, the identity a person signs in with) and,
// in the A08 suite, one disclosed TEST CLOCK (an exception's expiry moved into the past, with its audit event), because
// the API cannot inject the server clock.
// All data is SYNTHETIC. Every gate decision, exception decision and approval here is a synthetic in-product business
// action by a test person on test data. It approves nothing real and never touches the engineering gates DG0-DG7.
import { expect } from "vitest";
import { call, createUser, signIn, uniq, type Res, type Session, type TestApi } from "./api.ts";
import type { World } from "./p4.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;

export interface Person {
  readonly id: string;
  readonly session: Session;
}

export interface NativeGateWorld {
  readonly transformationId: string;
  readonly organizationId: string;
  /** /api/v1/transformations/{id} */
  readonly base: string;
  /** /api/v1/transformations/{id}/gates */
  readonly gates: string;
  readonly tl: Person;
  readonly to: Person;
  readonly sp: Person;
  readonly sp2: Person;
  readonly bo: Person;
  readonly wl: Person;
  readonly auditor: Person;
  readonly outsider: Person;
}

export const ifm = (version: number): Record<string, string> => ({ "if-match": `"${version}"` });

/** A fresh synthetic person granted `role` on the transformation through the access-administration API. */
export async function nativePerson(
  api: TestApi,
  w: World,
  admin: Session,
  transformationId: string,
  role: string,
): Promise<Person> {
  const u = await createUser(api.db, w.orgA.id);
  const r = await call<Body>(api.app, "POST", "/api/v1/role-assignments", {
    session: admin,
    body: {
      userId: u.id,
      roleCode: role,
      scope: { type: "transformation", id: transformationId },
      reason: `Synthetic QA ${role} for the A08 acceptance suite (approves nothing real)`,
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: u.id, session: await signIn(api.app, u.subject) };
}

/** A transformation created through the API by the BU-scoped Lead, with its people. */
export async function seedNativeGateWorld(api: TestApi, w: World, label = "A08"): Promise<NativeGateWorld> {
  const tl = { id: w.leadA1.id, session: await signIn(api.app, w.leadA1.subject) };
  const created = await call<Body>(api.app, "POST", "/api/v1/transformations", {
    session: tl.session,
    body: { businessUnitId: w.a1, name: `Synthetic QA ${label} ${uniq("T")}`, mode: "end_to_end" },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const transformationId = created.body.id as string;
  const admin = await signIn(api.app, w.admin.subject);
  const mk = (role: string) => nativePerson(api, w, admin, transformationId, role);
  const world: NativeGateWorld = {
    transformationId,
    organizationId: w.orgA.id,
    base: `/api/v1/transformations/${transformationId}`,
    gates: `/api/v1/transformations/${transformationId}/gates`,
    tl,
    to: { id: w.office.id, session: await signIn(api.app, w.office.subject) },
    sp: await mk("SP"),
    sp2: await mk("SP"),
    bo: await mk("BO"),
    wl: await mk("WL"),
    auditor: { id: w.auditor.id, session: await signIn(api.app, w.auditor.subject) },
    outsider: { id: w.officeB.id, session: await signIn(api.app, w.officeB.subject) },
  };
  // The Sponsor and Business Owner parties are mapped to named people (T11 routing of approvals).
  const mapped = await call<Body>(api.app, "POST", `${world.base}/role-mappings`, {
    session: tl.session,
    body: { partyCode: "SP", targetKind: "user", userId: world.sp.id },
  });
  expect(mapped.status, JSON.stringify(mapped.body)).toBe(201);
  const mappedBo = await call<Body>(api.app, "POST", `${world.base}/role-mappings`, {
    session: tl.session,
    body: { partyCode: "BO", targetKind: "user", userId: world.bo.id },
  });
  expect(mappedBo.status, JSON.stringify(mappedBo.body)).toBe(201);
  return world;
}

export async function gateView(api: TestApi, g: NativeGateWorld, code: string, session = g.tl.session): Promise<Body> {
  const r = await call<Body>(api.app, "GET", `${g.gates}/${code}`, { session });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

/** The keys of the mandatory criteria the live gate view reports as not complete. */
export async function missingKeys(api: TestApi, g: NativeGateWorld, code: string): Promise<string[]> {
  const v = await gateView(api, g, code);
  return (v.criteria as Body[]).filter((c) => c.mandatory && c.completeness !== "complete").map((c) => c.key);
}

/**
 * The mandatory criteria that block a submission now: incomplete in the live view AND not covered by an accepted
 * exception that covers today (GET .../gate-exceptions, `covering`). The live view keeps a covered criterion
 * "incomplete" (the evidence is still missing); the exception is what lets the submission through.
 */
export async function uncoveredKeys(api: TestApi, g: NativeGateWorld, code: string): Promise<string[]> {
  const incomplete = await missingKeys(api, g, code);
  const ex = await call<Body>(api.app, "GET", `${g.base}/gate-exceptions?limit=100`, { session: g.auditor.session });
  expect(ex.status, JSON.stringify(ex.body)).toBe(200);
  const covered = new Set(
    (ex.body.items as Body[]).filter((e) => e.gateCode === code && e.covering).map((e) => e.criterionKey as string),
  );
  return incomplete.filter((k) => !covered.has(k));
}

/** The five REQ-S04-013 fields of an exception request (synthetic). */
export const exceptionRequest = (g: NativeGateWorld, gateCode: string, criterionKey: string, expiresOn: string) => ({
  gateCode,
  criterionKey,
  reason: "Synthetic QA: the evidence is produced after the pilot.",
  scope: `Synthetic QA: ${criterionKey} for this ${gateCode} submission only.`,
  compensatingAction: "Synthetic QA: weekly interim report reviewed by the Business Owner.",
  compensatingOwnerUserId: g.bo.id,
  expiresOn,
});

/** The Lead requests an exception and the gate approver (Sponsor by default) accepts it. Returns the accepted body. */
export async function coverWithException(
  api: TestApi,
  g: NativeGateWorld,
  gateCode: string,
  criterionKey: string,
  expiresOn: string,
  approver: Session = g.sp.session,
): Promise<Body> {
  const req = await call<Body>(api.app, "POST", `${g.base}/gate-exceptions`, {
    session: g.tl.session,
    body: exceptionRequest(g, gateCode, criterionKey, expiresOn),
  });
  expect(req.status, JSON.stringify(req.body)).toBe(201);
  const dec = await call<Body>(api.app, "POST", `${g.base}/gate-exceptions/${req.body.id}/decision`, {
    session: approver,
    headers: ifm(req.body.version),
    body: { outcome: "accepted", note: "Synthetic QA: accepted with the compensating report." },
  });
  expect(dec.status, JSON.stringify(dec.body)).toBe(200);
  return dec.body;
}

/** Submits `code` as `session` (the Lead by default) with the gate's current version as If-Match. */
export async function submitGate(
  api: TestApi,
  g: NativeGateWorld,
  code: string,
  session = g.tl.session,
  version?: number,
): Promise<Res<Body>> {
  const v = version ?? (await gateView(api, g, code)).gate.version;
  return call<Body>(api.app, "POST", `${g.gates}/${code}/submissions`, {
    session,
    headers: ifm(v),
    body: { submissionNote: `Synthetic QA ${code} submission` },
  });
}

export const RATIONALE = "Synthetic QA decision; approves nothing real.";

export async function decideGate(
  api: TestApi,
  g: NativeGateWorld,
  code: string,
  session: Session,
  body: Record<string, unknown>,
): Promise<Res<Body>> {
  return call<Body>(api.app, "POST", `${g.gates}/${code}/decision`, { session, body });
}

/** G1 needs the three B0032 agreements with an approval (REQ-PB-016; setup only here). */
const G1_AGREEMENTS = { problem: true, baseline: true, materialValuePools: true };

/** Passes G1..G4 natively: covers every missing mandatory criterion, submits as the Lead, approves as the Sponsor. */
export async function passGatesNatively(
  api: TestApi,
  g: NativeGateWorld,
  codes: readonly string[],
  expiresOn: string,
): Promise<void> {
  for (const code of codes) {
    for (const key of await missingKeys(api, g, code)) await coverWithException(api, g, code, key, expiresOn);
    const sub = await submitGate(api, g, code);
    expect(sub.status, `${code}: ${JSON.stringify(sub.body)}`).toBe(201);
    const d = await decideGate(api, g, code, g.sp.session, {
      submissionNo: sub.body.submissionNo,
      outcome: "approved",
      rationale: `Synthetic QA approval of ${code} (approves nothing real).`,
      ...(code === "G1" ? { agreements: G1_AGREEMENTS } : {}),
    });
    expect(d.status, `${code}: ${JSON.stringify(d.body)}`).toBe(201);
  }
}

/** A business date `n` calendar days after `date`. */
export const plusDays = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The relay's message for one outbox row, found by its idempotency key (what the queue delivers to a consumer). */
export async function envelopeByKey(api: TestApi, idempotencyKey: string) {
  const e = await api.db
    .selectFrom("outbox_event")
    .selectAll()
    .where("idempotency_key", "=", idempotencyKey)
    .executeTakeFirstOrThrow();
  return {
    outboxEventId: e.id,
    eventType: e.event_type,
    schemaVersion: e.schema_version,
    idempotencyKey: e.idempotency_key,
    organizationId: e.organization_id,
    payload: typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload,
  };
}

/**
 * Completes every step of phase `phaseIndex` (0 = Diagnose) through the phase-step API: the Lead owns and starts it,
 * links a note evidence item the office verified, requests review, and the office accepts it. Returns the step keys.
 */
export async function completePhaseSteps(
  api: TestApi,
  p: { base: string; tl: Person; to: Person; reader: Session },
  phaseIndex = 0,
): Promise<string[]> {
  const send = (method: string, url: string, opts?: Parameters<typeof call>[3]) =>
    call<Body>(api.app, method, url, opts);
  const phases = await send("GET", `${p.base}/phases`, { session: p.reader });
  expect(phases.status, JSON.stringify(phases.body)).toBe(200);
  const keys = (phases.body.phases[phaseIndex].steps as Body[]).map((s) => s.stepKey as string);
  for (const key of keys) {
    const S = `${p.base}/phase-steps/${key}`;
    const started = await send("PATCH", S, {
      session: p.tl.session,
      headers: ifm(0),
      body: { ownerUserId: p.tl.id, start: true },
    });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const ev = await send("POST", `${p.base}/evidence`, {
      session: p.tl.session,
      body: { kind: "note", title: "Synthetic QA step evidence", noteBody: "Synthetic", ownerUserId: p.tl.id },
    });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    const verified = await send("POST", `${p.base}/evidence/${ev.body.id}/review`, {
      session: p.to.session,
      headers: ifm(1),
      body: { result: "verified", accessibilityStatus: "accessible", note: "Synthetic QA: checked" },
    });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    const link = await send("POST", `${S}/evidence`, { session: p.tl.session, body: { evidenceId: ev.body.id } });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const rr = await send("POST", `${S}/request-review`, { session: p.tl.session, headers: ifm(started.body.version) });
    expect(rr.status, JSON.stringify(rr.body)).toBe(200);
    const done = await send("POST", `${S}/review`, {
      session: p.to.session,
      headers: ifm(rr.body.version),
      body: { outcome: "accepted" },
    });
    expect([done.status, done.body.status], JSON.stringify(done.body)).toEqual([200, "complete"]);
  }
  return keys;
}
