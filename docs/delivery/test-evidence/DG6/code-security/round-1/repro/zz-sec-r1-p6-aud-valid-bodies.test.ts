// code-security-reviewer, DG6 re-gate round 1 (T-DG6-REV-CS-RG-R1): second pass of the P6 AUD sweep. The first pass
// (zz-sec-r1-p6-role-sweep.test.ts) sent `{}` and 26 of the 40 P6 mutating operations answered 400 validation before
// their permission gate (the documented order: 400 body, 404 read gate, 403 permission gate). This pass sends a
// SCHEMA-VALID body to each of those 26 (built by hand from docs/api/openapi.yaml), as the read-only auditor (AUD @
// org A), against an existing transformation of org A, so the permission gate is reached. Expected: 403 (or 404 where a
// path names a record that does not exist), and no non-denial audit event by the auditor.
// Run from a disposable clone only, copied to apps/api/test/integration/. All data is SYNTHETIC.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createTransformationRow,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let tid: string;
let aud: Session;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  tid = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  aud = await signIn(api.app, w.auditor.subject);
}, 120_000);

afterAll(async () => {
  await api?.close();
});

const r = () => crypto.randomUUID();
const reason = "Synthetic SEC-R1 AUD sweep";

describe("SEC-R1 P6 AUD sweep with schema-valid bodies", () => {
  it("every one of the 26 operations is refused 403 (404 only for a non-existent record) and writes nothing", async () => {
    const T = `/api/v1/transformations/${tid}`;
    const config = {
      sourceSystemId: "synthetic-src",
      endpointUrl: null,
      credentialRefs: {},
      fieldMappings: [],
      targetTransformationId: tid,
      cadence: "manual",
      retryMaxAttempts: 0,
      retryBackoffSeconds: 10,
      commitMode: "manual",
      commitOnBehalfOf: null,
      outboundActions: [],
      reconciliationRule: "none",
      adapterSettings: {},
      reason,
    };
    const ref = { provider: "env", name: "MTH_SECRET_SYNTHETIC_SEC_R1" };
    // [operationId, method, url, body, pathNamesAnExistingRecordOnly (404 not acceptable)]
    const cases: [string, string, string, unknown, boolean][] = [
      ["putRecordSensitivity", "PUT", `${T}/records/benefit/${r()}/sensitivity`, { isSensitive: true, reason }, false],
      [
        "createSensitiveGrant",
        "POST",
        "/api/v1/admin/sensitive-grants",
        { transformationId: tid, recordType: "benefit", recordId: r(), granteeUserId: w.office.id, reason },
        false,
      ],
      ["revokeSensitiveGrant", "POST", `/api/v1/admin/sensitive-grants/${r()}/revoke`, { reason }, false],
      ["putUploadPolicy", "PUT", `/api/v1/admin/upload-policy?organizationId=${w.orgA.id}`, { allowedTypes: ["pdf"], maxBytes: 1000, reason }, true],
      ["acknowledgeOperationalException", "POST", `/api/v1/admin/operations/exceptions/${r()}/acknowledge`, { note: reason }, false],
      ["resolveOperationalException", "POST", `/api/v1/admin/operations/exceptions/${r()}/resolve`, { note: reason }, false],
      ["putServiceIdentity", "PUT", `/api/v1/admin/service-identities/${r()}`, { grantedPermissionCodes: ["transformation.read"], reason }, false],
      ["putNotificationChannel", "PUT", `/api/v1/admin/notification-channels/email?organizationId=${w.orgA.id}`, { enabled: false, smtp: null, reason }, true],
      ["testNotificationChannel", "POST", `/api/v1/admin/notification-channels/email/test?organizationId=${w.orgA.id}`, { recipient: "self" }, true],
      [
        "createConnector",
        "POST",
        "/api/v1/admin/connectors",
        { organizationId: w.orgA.id, code: "sec-r1-aud", nameEn: "Synthetic", nameAr: "اصطناعي", adapterKind: "test_adapter", targetKind: "kpi_actual", config },
        true,
      ],
      ["putConnector", "PUT", `/api/v1/admin/connectors/${r()}`, { nameEn: "Synthetic", nameAr: "اصطناعي", config }, false],
      ["enableConnector", "POST", `/api/v1/admin/connectors/${r()}/enable`, { reason }, false],
      ["disableConnector", "POST", `/api/v1/admin/connectors/${r()}/disable`, { reason }, false],
      ["putConnectorMappings", "PUT", `/api/v1/admin/connectors/${r()}/mappings`, { fieldMappings: [{ source: "a", target: "a" }], reason }, false],
      ["commitImport", "POST", `${T}/imports/${r()}/commit`, { note: reason }, false],
      ["cancelImport", "POST", `${T}/imports/${r()}/cancel`, { reason }, false],
      ["createWebhookEndpoint", "POST", "/api/v1/admin/webhooks", { connectorId: r(), label: "Synthetic", signingSecretRef: ref, toleranceSeconds: 300 }, false],
      ["rotateWebhookSecret", "POST", `/api/v1/admin/webhooks/${r()}/rotate-secret`, { signingSecretRef: ref, graceHours: 1, reason }, false],
      ["disableWebhookEndpoint", "POST", `/api/v1/admin/webhooks/${r()}/disable`, { reason }, false],
      [
        "executeOutboundWrite",
        "POST",
        `${T}/outbound-writes`,
        { connectorId: r(), actionCode: "deliverable_status_push", deliverableId: r(), idempotencyKey: "sec-r1-aud-0001", payload: {} },
        false,
      ],
      ["confirmDeliverableExternalChange", "POST", `/api/v1/deliverables/${r()}/confirmation`, { evidenceId: r(), note: reason }, false],
      ["putDeliverableExternalChange", "PUT", `/api/v1/deliverables/${r()}/external-change`, { isExternalChange: true, changeType: "other", description: reason }, false],
      ["createSavedView", "POST", "/api/v1/saved-views", { listKey: "transformations", name: "Synthetic SEC-R1", columns: ["name"] }, true],
      ["putSavedView", "PUT", `/api/v1/saved-views/${r()}`, { name: "Synthetic", columns: ["name"], filters: {}, sort: [], isDefault: false }, false],
      ["shareSavedView", "POST", `/api/v1/saved-views/${r()}/share`, { shared: true }, false],
    ];
    const before = await api.db
      .selectFrom("audit_event")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("actor_user_id", "=", w.auditor.id)
      .where("action", "not like", "%denied%")
      .executeTakeFirstOrThrow();
    const rows: string[] = [];
    const bad: string[] = [];
    for (const [op, method, url, body, noRecord] of cases) {
      const res = await call<Body>(api.app, method, url, { session: aud, body, headers: { "if-match": '"1"' }, contract: false });
      const line = `${op} ${method} ${url.replace(tid, "{tid}")} -> ${res.status} ${res.body?.code ?? ""}`;
      rows.push(line);
      if (!(res.status === 403 || (res.status === 404 && !noRecord))) bad.push(line);
    }
    // createImport: the body is the file (text/csv).
    const csv = await api.app.inject({
      method: "POST",
      url: `${T}/imports?template=kpi_actuals.v1`,
      headers: {
        cookie: aud.cookie,
        origin: "http://localhost:3000",
        "x-csrf-token": aud.csrf,
        "content-type": "text/csv",
        "x-file-name": "synthetic.csv",
      },
      payload: "a,b\n1,2\n",
    });
    rows.push(`createImport POST ${T.replace(tid, "{tid}")}/imports (text/csv) -> ${csv.statusCode} ${csv.body.slice(0, 160)}`);
    if (csv.statusCode !== 403) bad.push(rows[rows.length - 1]!);
    const after = await api.db
      .selectFrom("audit_event")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("actor_user_id", "=", w.auditor.id)
      .where("action", "not like", "%denied%")
      .executeTakeFirstOrThrow();
    console.log(`[SEC-R1 AUD valid-body sweep] ${rows.length} operations\n${rows.join("\n")}`);
    console.log(`[SEC-R1 AUD valid-body sweep] NOT refused 403/404: ${bad.length}\n${bad.join("\n")}`);
    console.log(`[SEC-R1 AUD valid-body sweep] non-denial audit events by AUD: before ${before.n}, after ${after.n}`);
    expect(Number(after.n)).toBe(Number(before.n));
    expect(bad).toEqual([]);
  }, 600_000);
});
