// P6 contract exercises of BE-K (p6-work-split §J/C.3 and §2 rule 16; T-DG6-BE-K): the four operational-exception
// operations and the worker heartbeat (ADR-0053 §2, §6), each with a success and every declared refusal it can reach,
// through the validating client. The exceptions are raised by the API's raise service (the path the heartbeat watch
// uses) on a synthetic job source unique to this run, so no other suite's exception is touched. No shared zod mirror
// exists for these bodies in packages/shared (outside BE-K's files); the mirrors below restate the contract schemas.
// Every value is synthetic. Acknowledging or resolving an exception approves nothing (G1-G6) and never touches DG0-DG7.
import { randomBytes } from "node:crypto";
import { expect } from "vitest";
import { z } from "zod";
import { raiseOperationalException } from "../../../src/modules/operations/index.ts";
import { signIn, type P6ExerciseContext } from "../../support/harness.ts";

const ts = z.iso.datetime({ offset: true });
const tsN = ts.nullable();
const failureClass = z.enum([
  "job_failed",
  "connector_run_failed",
  "connector_unreachable",
  "connector_credentials_rejected",
  "data_stale",
  "heartbeat_missed",
]);
const status = z.enum(["open", "acknowledged", "resolved"]);
const exceptionShape = {
  id: z.uuid(),
  organizationId: z.uuid().nullable(),
  sourceKind: z.enum(["job", "connector", "data_freshness", "worker"]),
  sourceCode: z.string().max(200),
  failureClass,
  dedupKey: z.string(),
  status,
  occurrenceCount: z.number().int().min(1),
  firstOccurredAt: ts,
  lastOccurredAt: ts,
  lastErrorCode: z.string().max(100),
  lastErrorMessage: z.string().max(2000),
  serviceIdentityId: z.uuid().nullable(),
  acknowledgedAt: tsN,
  acknowledgedBy: z.uuid().nullable(),
  acknowledgeNote: z.string().max(1000).nullable(),
  resolvedAt: tsN,
  resolvedBy: z.uuid().nullable(),
  resolution: z.enum(["manual", "recovered"]).nullable(),
  resolutionNote: z.string().max(1000).nullable(),
  linkedKpiCount: z.number().int().min(0),
  version: z.number().int().min(1),
};
const operationalException = z.strictObject(exceptionShape);
const operationalExceptionDetail = z.strictObject({
  ...exceptionShape,
  linkedKpis: z.array(
    z.strictObject({
      kpiDefinitionId: z.uuid(),
      transformationId: z.uuid(),
      name: z.string(),
      unitKind: z.enum(["currency", "percentage", "count", "ratio", "duration", "score", "other"]),
      freshness: z.enum(["fresh", "stale", "unknown"]),
      lastValue: z
        .string()
        .regex(/^-?[0-9]+(\.[0-9]+)?$/)
        .nullable(),
      lastValueAt: tsN,
    }),
  ),
  hiddenKpiCount: z.number().int().min(0),
  events: z.array(
    z.strictObject({
      recordVersion: z.number().int().min(1),
      eventKind: z.enum(["opened", "recurred", "acknowledged", "resolved", "updated"]),
      status,
      occurrenceCount: z.number().int().min(1),
      errorCode: z.string(),
      actorUserId: z.uuid().nullable(),
      note: z.string().nullable(),
      occurredAt: ts,
    }),
  ),
});
const workerHeartbeatStatus = z.strictObject({
  status: z.enum(["alive", "stale", "unknown"]),
  checkedAt: ts,
  staleAfterSeconds: z.number().int().min(1),
  newestBeatAt: tsN,
  instances: z.array(
    z.strictObject({
      instanceKey: z.string(),
      appVersion: z.string(),
      startedAt: ts,
      lastBeatAt: ts,
      beatCount: z.string().regex(/^[0-9]+$/),
      queueCount: z.number().int().min(0),
      status: z.enum(["alive", "stale"]),
    }),
  ),
});

export const P6_MIRRORS_BE_K: Readonly<Record<string, z.ZodType>> = {
  listOperationalExceptions: z.strictObject({
    items: z.array(operationalException),
    nextCursor: z.string().nullable(),
  }),
  getOperationalException: operationalExceptionDetail,
  acknowledgeOperationalException: operationalExceptionDetail,
  resolveOperationalException: operationalExceptionDetail,
  getWorkerHeartbeat: workerHeartbeatStatus,
};

const ifm = (v: number) => ({ "if-match": `"${v}"` });
/** A synthetic queue name of letters only (the 0074 queue_name rule), unique to this run. */
const syntheticQueue = () =>
  `contract.bek_${[...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join("")}`;

export async function exerciseP6BeKOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, w.admin.subject); // ADM_TECH @ A: operations.read + operations.acknowledge
  const auditor = await signIn(api.app, w.auditor.subject); // AUD @ A: operations.read only
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  const service = { actorUserId: null, actorType: "service" as const, requestId: "contract:be-k" };
  const raise = (queue: string) =>
    api.db.transaction().execute((tx) =>
      raiseOperationalException(tx, service, {
        organizationId: w.orgA.id,
        sourceKind: "job",
        sourceCode: queue,
        failureClass: "job_failed",
        errorCode: "automation.retries_exhausted",
        errorMessage: "Synthetic contract failure.",
      }),
    );
  const first = await raise(syntheticQueue());
  const second = await raise(syntheticQueue());

  // listOperationalExceptions: 200 (ADM_TECH page with a cursor, AUD); 400; 401; 403; 404.
  const L = "/api/v1/admin/operations/exceptions";
  const page = await mirrored("GET", `${L}?organizationId=${w.orgA.id}&sourceKind=job&limit=1`, { session: admin });
  expect(page.status).toBe(200);
  expect(page.body.items).toHaveLength(1);
  expect(typeof page.body.nextCursor).toBe("string");
  const next = await mirrored(
    "GET",
    `${L}?organizationId=${w.orgA.id}&sourceKind=job&limit=1&cursor=${encodeURIComponent(page.body.nextCursor)}`,
    { session: auditor },
  );
  expect(next.status).toBe(200);
  expect(next.body.items[0].id).not.toBe(page.body.items[0].id);
  const filtered = await mirrored(
    "GET",
    `${L}?organizationId=${w.orgA.id}&status=open&status=acknowledged&failureClass=job_failed&limit=100`,
    { session: auditor },
  );
  expect(filtered.status).toBe(200);
  expect((filtered.body.items as { id: string }[]).map((i) => i.id)).toEqual(
    expect.arrayContaining([first.exceptionId, second.exceptionId]),
  );
  expect((await mirrored("GET", `${L}?organizationId=x`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", `${L}?organizationId=${w.orgA.id}&status=closed`, { session: admin })).status).toBe(
    400,
  );
  expect((await mirrored("GET", `${L}?organizationId=${w.orgA.id}`)).status).toBe(401);
  expect((await mirrored("GET", `${L}?organizationId=${w.orgA.id}`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${L}?organizationId=${missing}`, { session: admin })).status).toBe(404);

  // getOperationalException: 200 (AUD, with the ETag); 400; 401; 404 (missing; a caller without operations.read).
  const one = `${L}/${first.exceptionId}`;
  const got = await mirrored("GET", one, { session: auditor });
  expect(got.status).toBe(200);
  expect(got.headers["etag"]).toBe(`"${got.body.version}"`);
  expect(got.body.events.map((e: { eventKind: string }) => e.eventKind)).toEqual(["opened"]);
  expect((await mirrored("GET", `${L}/x`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", one)).status).toBe(401);
  expect((await mirrored("GET", `${L}/${missing}`, { session: admin })).status).toBe(404);
  expect((await mirrored("GET", one, { session: nobody })).status).toBe(404);

  // acknowledgeOperationalException: 200; 400; 401; 403 (AUD); 404; 409 (stale; not open); 422; 428.
  const ack = `${one}/acknowledge`;
  const v = got.body.version as number;
  const note = "Synthetic contract exercise: looking into it.";
  expect((await mirrored("POST", ack, { session: admin, body: { note: 5 }, headers: ifm(v) })).status).toBe(400);
  expect((await mirrored("POST", ack, { body: { note }, headers: ifm(v) })).status).toBe(401);
  expect((await mirrored("POST", ack, { session: auditor, body: { note }, headers: ifm(v) })).status).toBe(403);
  expect(
    (await mirrored("POST", `${L}/${missing}/acknowledge`, { session: admin, body: { note }, headers: ifm(1) })).status,
  ).toBe(404);
  const blank = await mirrored("POST", ack, { session: admin, body: { note: "  " }, headers: ifm(v) });
  expect([blank.status, blank.body.code]).toEqual([422, "operations.note_required"]);
  expect((await mirrored("POST", ack, { session: admin, body: { note } })).status).toBe(428);
  expect((await mirrored("POST", ack, { session: admin, body: { note }, headers: ifm(v + 5) })).status).toBe(409);
  const acked = await mirrored("POST", ack, { session: admin, body: { note }, headers: ifm(v) });
  expect(acked.status).toBe(200);
  expect([acked.body.status, acked.body.acknowledgeNote, acked.body.version]).toEqual(["acknowledged", note, v + 1]);
  const again = await mirrored("POST", ack, { session: admin, body: { note: null }, headers: ifm(v + 1) });
  expect([again.status, again.body.code]).toEqual([409, "operations.exception_not_open"]);

  // resolveOperationalException: 200; 400; 401; 403 (AUD); 404; 409 (resolved; stale); 422; 428.
  const res = `${one}/resolve`;
  const done = "Synthetic contract exercise: fixed.";
  expect((await mirrored("POST", res, { session: admin, body: { note: null }, headers: ifm(v + 1) })).status).toBe(400);
  expect((await mirrored("POST", res, { body: { note: done }, headers: ifm(v + 1) })).status).toBe(401);
  expect((await mirrored("POST", res, { session: auditor, body: { note: done }, headers: ifm(v + 1) })).status).toBe(
    403,
  );
  expect(
    (await mirrored("POST", `${L}/${missing}/resolve`, { session: admin, body: { note: done }, headers: ifm(1) }))
      .status,
  ).toBe(404);
  const short = await mirrored("POST", res, { session: admin, body: { note: "ok" }, headers: ifm(v + 1) });
  expect([short.status, short.body.code]).toEqual([422, "operations.note_required"]);
  expect((await mirrored("POST", res, { session: admin, body: { note: done } })).status).toBe(428);
  expect((await mirrored("POST", res, { session: admin, body: { note: done }, headers: ifm(v) })).status).toBe(409);
  const resolved = await mirrored("POST", res, { session: admin, body: { note: done }, headers: ifm(v + 1) });
  expect(resolved.status).toBe(200);
  expect([resolved.body.status, resolved.body.resolution, resolved.body.resolutionNote]).toEqual([
    "resolved",
    "manual",
    done,
  ]);
  const final = await mirrored("POST", res, { session: admin, body: { note: done }, headers: ifm(v + 2) });
  expect([final.status, final.body.code]).toEqual([409, "operations.exception_resolved"]);
  // The second exception is resolved straight from open (open -> resolved), leaving no active synthetic row.
  const s2 = await mirrored("POST", `${L}/${second.exceptionId}/resolve`, {
    session: admin,
    body: { note: done },
    headers: ifm(1),
  });
  expect(s2.status).toBe(200);

  // getWorkerHeartbeat: 200 (AUD); 400; 401; 403.
  const H = "/api/v1/admin/operations/heartbeat";
  const hb = await mirrored("GET", H, { session: auditor });
  expect(hb.status).toBe(200);
  expect(hb.body.staleAfterSeconds).toBe(90);
  if (hb.body.newestBeatAt === null) expect(hb.body.status).toBe("unknown");
  expect((await mirrored("GET", `${H}?x=1`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", H)).status).toBe(401);
  expect((await mirrored("GET", H, { session: nobody })).status).toBe(403);
}
