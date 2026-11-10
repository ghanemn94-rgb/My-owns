// qa-verifier acceptance support for A17 "Import and integration" (DG6, T-DG6-QA-A): API setup helpers. The file
// and signature builders are in a17-files.ts (shared with the e2e specs). Every value is SYNTHETIC; nothing here
// approves anything (G1-G6) or touches the engineering gates DG0-DG7.
import { expect } from "vitest";
import { call, type Loose, type Session, type TestApi } from "./api.ts";

export * from "./a17-files.ts";

export const CONNECTORS = "/api/v1/admin/connectors";
export const WEBHOOKS = "/api/v1/admin/webhooks";
export const EXCEPTIONS = "/api/v1/admin/operations/exceptions";
export const ifm = (v: number): Record<string, string> => ({ "if-match": `"${v}"` });

// ------------------------------------------------------------------ the template columns (from the contract)

/** The `kpi_actual.v1` column keys in template order, read through GET /api/v1/import-templates. */
export async function templateColumns(api: TestApi, session: Session): Promise<string[]> {
  const res = await call<Loose>(api.app, "GET", "/api/v1/import-templates", { session });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const t = (res.body.items as Loose[]).find(
    (i) => i.templateVersion === "kpi_actual.v1" || i.version === "kpi_actual.v1",
  );
  expect(t, JSON.stringify(res.body)).toBeTruthy();
  const keys = (t.columns as Loose[]).map((c) => String(c.key));
  // ADR-0056 §9 names these columns; the fixture needs at least these.
  for (const k of ["source_record_id", "kpi_id", "scope_kind", "scope_id", "period_label", "value", "data_as_of"])
    expect(keys, `template column ${k}`).toContain(k);
  return keys;
}

// ------------------------------------------------------------------ connectors

export interface ConnectorOptions {
  readonly organizationId: string;
  readonly code: string;
  readonly adapterKind: "test_adapter" | "webhook";
  readonly targetTransformationId: string;
  readonly adapterSettings: Record<string, unknown>;
  readonly retryMaxAttempts?: number;
  readonly commitMode?: "manual" | "auto";
  readonly commitOnBehalfOf?: string | null;
}

/** POST /api/v1/admin/connectors (created disabled) then enable it; returns the enabled connector. */
export async function enabledConnector(api: TestApi, admin: Session, o: ConnectorOptions): Promise<Loose> {
  const created = await call<Loose>(api.app, "POST", CONNECTORS, {
    session: admin,
    body: {
      organizationId: o.organizationId,
      code: o.code,
      nameEn: `Synthetic source ${o.code}`,
      nameAr: `مصدر اصطناعي ${o.code}`,
      adapterKind: o.adapterKind,
      targetKind: "kpi_actual",
      config: {
        sourceSystemId: `synthetic.qa-a17:${o.code}`,
        endpointUrl: null,
        credentialRefs: {},
        fieldMappings: [],
        targetTransformationId: o.targetTransformationId,
        cadence: "manual",
        retryMaxAttempts: o.retryMaxAttempts ?? 0,
        retryBackoffSeconds: 10,
        commitMode: o.commitMode ?? "manual",
        commitOnBehalfOf: o.commitOnBehalfOf ?? null,
        outboundActions: [],
        reconciliationRule: "none",
        adapterSettings: o.adapterSettings,
        reason: "Synthetic connector for the A17 acceptance suite.",
      },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(created.body).toMatchObject({ status: "disabled", verification: "not_verified", lastSuccessAt: null });
  const enabled = await call<Loose>(api.app, "POST", `${CONNECTORS}/${created.body.id}/enable`, {
    session: admin,
    headers: ifm(created.body.version),
    body: { reason: null },
  });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
  expect(enabled.body.status).toBe("enabled");
  return enabled.body;
}
