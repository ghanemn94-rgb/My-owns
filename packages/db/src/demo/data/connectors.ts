// The demo dataset's connector (p6-plan §3 row 25; p6-work-split §B/A.1 "one disabled test connector"; ADR-0055 §1;
// T-DG6-BE-L): ONE connector of the local test adapter, DISABLED, targeting the roaming transformation's KPI actuals,
// with its configuration version 1 and its service identity (ADR-0053 §1: `connector:<id>`, declared = granted =
// ['transformation.read']). It has no run, so the connector page shows "Not verified" and "Never succeeded" until a
// demo administrator enables and tests it; it is never called live or connected to any Mobily system (p6-plan R3).
// No credential is configured (no secret reference, no value). Every id is a fixed literal in the namespace
// `01995000-6000-7000-8000-…` (second group 6000, used by no other module), every time is the synthetic clock.
// SYNTHETIC: an illustrative example, not Mobily actual performance (M0339).
//
// The dataset checksum (ADR-0050 §4) covers these three registered rows, so it changes once with this module (the
// re-baseline: the counts gain connector 1, connector_config_version 1, connector_change 1, service_identity 1,
// service_identity_change 1, demo_seed_record 3 and their audit events); two seeds or resets still agree.
import type { DemoDatasetModule, DemoSeedContext } from "../seed.ts";
import { DEMO_ANCHORS } from "./kpis.ts";
import { DEMO_ACCESS_ADMIN } from "./roaming.ts";

const connectorId = (n: number): string => `01995000-6000-7000-8000-${n.toString(16).padStart(12, "0")}`;

/** The fixed ids of the demo connector's three rows. */
export const DEMO_CONNECTOR_IDS = {
  connector: connectorId(1),
  configVersion: connectorId(2),
  serviceIdentity: connectorId(3),
} as const;

export const DEMO_CONNECTOR_CODE = "demo-kpi-test-source";

async function seedDemoConnector(ctx: DemoSeedContext): Promise<void> {
  const by = DEMO_ACCESS_ADMIN.id; // the demo technical administrator (a stamp; it approves nothing)
  const at = ctx.at({ days: -1 });
  const reason = "Synthetic demo connector of the local test adapter (illustrative example; not a live integration).";
  await ctx.insert("connector", "connectors.demo.connector", {
    id: DEMO_CONNECTOR_IDS.connector,
    organization_id: DEMO_ANCHORS.organizationId,
    code: DEMO_CONNECTOR_CODE,
    name_en: "Demo KPI source (test adapter, synthetic)",
    name_ar: "مصدر مؤشرات تجريبي (محوّل اختبار، بيانات اصطناعية)",
    adapter_kind: "test_adapter",
    target_kind: "kpi_actual",
    status: "disabled",
    config_version_no: 1,
    status_reason: null,
    created_at: at,
    created_by: by,
    updated_at: at,
    updated_by: by,
  });
  await ctx.insert(
    "connector_config_version",
    "connectors.demo.config_v1",
    {
      id: DEMO_CONNECTOR_IDS.configVersion,
      organization_id: DEMO_ANCHORS.organizationId,
      connector_id: DEMO_CONNECTOR_IDS.connector,
      version_no: 1,
      source_system_id: "demo.synthetic-kpi-source",
      endpoint_url: null,
      credential_refs: JSON.stringify({}),
      field_mappings: JSON.stringify([
        { source: "KPI", target: "kpi_id" },
        { source: "Period", target: "period_label" },
        { source: "Value", target: "value" },
      ]),
      target_transformation_id: DEMO_ANCHORS.transformationId,
      cadence: "manual",
      retry_max_attempts: 3,
      retry_backoff_seconds: 60,
      commit_mode: "manual",
      commit_on_behalf_of: null,
      outbound_actions: [],
      reconciliation_rule: "row_count",
      adapter_settings: JSON.stringify({ mode: "healthy", confirm: "immediate" }),
      reason,
      created_at: at,
      created_by: by,
    },
    { transformationId: null },
  );
  await ctx.insert("service_identity", "connectors.demo.service_identity", {
    id: DEMO_CONNECTOR_IDS.serviceIdentity,
    code: `connector:${DEMO_CONNECTOR_IDS.connector}`,
    subject_kind: "connector",
    queue_name: null,
    connector_id: DEMO_CONNECTOR_IDS.connector,
    scope_level: "organization",
    organization_id: DEMO_ANCHORS.organizationId,
    declared_permission_codes: ["transformation.read"],
    granted_permission_codes: ["transformation.read"],
    label_en: `Connector ${DEMO_CONNECTOR_CODE}`,
    label_ar: `الموصل ${DEMO_CONNECTOR_CODE}`,
    reason: `The service identity of the synthetic demo connector ${DEMO_CONNECTOR_CODE} (ADR-0053 §1).`,
    created_at: at,
    created_by: by,
    updated_at: at,
    updated_by: by,
  });
}

/** After the roaming foundation (organization, users, transformation; orders 100-110), before KBE-H (400). */
export const DEMO_CONNECTORS_MODULE: DemoDatasetModule = {
  key: "connectors.demo",
  order: 300,
  seed: seedDemoConnector,
};
