// The axe scope of DG6 (ADR-0061 §7.2; REQ-S15-012 "an automated axe scan reports no serious or critical violations on
// key screens"): every route the web router registers in P6, and the key flows. The axe spec (QA-D, e2e/**) scans each
// entry in chromium-en and chromium-ar at 1366 × 900 and 390 × 844 with the helper of apps/web/e2e/support/ui.ts (tags
// wcag2a, wcag2aa, wcag21a, wcag21aa; 0 serious or critical). The 31 P5 screens stay covered by p5-reflow-axe.spec.ts.
//
// Ownership (p6-work-split §I/K.4): created by T-DG6-FE-F2 as a list QA-D extends, because QA-D had not created it yet;
// the file now belongs to QA-D (recorded in both handbacks). The unit test apps/web/src/app/axe-scope.test.ts fails when
// a route added to apps/web/src/app/router.tsx in P6 is missing from P6_AXE_ROUTES, or when an entry here names a route
// the router does not register, so the scope cannot drift.
//
// `route` is the router's pattern exactly as router.tsx registers it, with a leading "/" (":param" segments are filled
// by the spec from its own SYNTHETIC fixtures). `signInAs` is the SYNTHETIC dev user (or the fixture role) whose
// permissions open the screen; a detail route names the list it is reached from (`detailOf`).

export interface AxeScreen {
  /** The router pattern, with a leading "/". */
  readonly route: string;
  /** A short evidence name (screenshots, the axe summary). */
  readonly name: string;
  /** The SYNTHETIC user or fixture role that opens it. */
  readonly signInAs: string;
  /** For a detail route: the list route it is opened from. */
  readonly detailOf?: string;
}

/** Every route registered in router.tsx in P6 (slices A, B, C, D, E, F, H, J; the deep-link landing). */
export const P6_AXE_ROUTES: readonly AxeScreen[] = [
  // Slice E/F (ADR-0051, ADR-0052): Administration > Audit, Security, Upload policy, Sensitive grants.
  { route: "/admin/audit", name: "admin-audit", signInAs: "dev.admin" },
  { route: "/admin/audit/:auditEventId", name: "admin-audit-event", signInAs: "dev.admin", detailOf: "/admin/audit" },
  { route: "/admin/security", name: "admin-security", signInAs: "dev.admin" },
  { route: "/admin/upload-policy", name: "admin-upload-policy", signInAs: "dev.admin" },
  { route: "/admin/sensitive-grants", name: "admin-sensitive-grants", signInAs: "dev.admin" },
  {
    route: "/admin/sensitive-grants/:grantId",
    name: "admin-sensitive-grant",
    signInAs: "dev.admin",
    detailOf: "/admin/sensitive-grants",
  },
  // The deep-link landing (ADR-0051 §3).
  { route: "/l/:token", name: "deep-link-landing", signInAs: "dev.lead" },
  // Slice J (ADR-0053): Operations and Service identities.
  { route: "/admin/operations", name: "admin-operations", signInAs: "dev.admin" },
  {
    route: "/admin/operations/exceptions/:exceptionId",
    name: "admin-operational-exception",
    signInAs: "dev.admin",
    detailOf: "/admin/operations",
  },
  { route: "/admin/service-identities", name: "admin-service-identities", signInAs: "dev.admin" },
  {
    route: "/admin/service-identities/:serviceIdentityId",
    name: "admin-service-identity",
    signInAs: "dev.admin",
    detailOf: "/admin/service-identities",
  },
  // Slice C (ADR-0054): Identity, Storage, Notification channels and deliveries.
  { route: "/admin/identity", name: "admin-identity", signInAs: "dev.admin" },
  { route: "/admin/storage", name: "admin-storage", signInAs: "dev.admin" },
  { route: "/admin/notification-channels", name: "admin-notification-channels", signInAs: "dev.admin" },
  {
    route: "/admin/notification-channels/:channelKind",
    name: "admin-notification-channel",
    signInAs: "dev.admin",
    detailOf: "/admin/notification-channels",
  },
  { route: "/admin/notification-deliveries", name: "admin-notification-deliveries", signInAs: "dev.admin" },
  // Slice B (ADR-0055): Integrations — connectors, runs, mappings, outbound writes, webhooks.
  { route: "/admin/integrations", name: "admin-integrations", signInAs: "dev.admin" },
  { route: "/admin/integrations/connectors/new", name: "admin-connector-new", signInAs: "dev.admin" },
  {
    route: "/admin/integrations/connectors/:connectorId",
    name: "admin-connector",
    signInAs: "dev.admin",
    detailOf: "/admin/integrations",
  },
  {
    route: "/admin/integrations/connectors/:connectorId/edit",
    name: "admin-connector-edit",
    signInAs: "dev.admin",
    detailOf: "/admin/integrations",
  },
  {
    route: "/admin/integrations/connectors/:connectorId/mappings",
    name: "admin-connector-mappings",
    signInAs: "dev.admin",
    detailOf: "/admin/integrations",
  },
  {
    route: "/admin/integrations/connectors/:connectorId/runs/:runId",
    name: "admin-connector-run",
    signInAs: "dev.admin",
    detailOf: "/admin/integrations",
  },
  { route: "/admin/integrations/outbound-writes", name: "admin-outbound-writes", signInAs: "dev.admin" },
  { route: "/admin/integrations/webhooks", name: "admin-webhooks", signInAs: "dev.admin" },
  {
    route: "/admin/integrations/webhooks/:webhookId",
    name: "admin-webhook",
    signInAs: "dev.admin",
    detailOf: "/admin/integrations/webhooks",
  },
  { route: "/transformations/:id/outbound-writes", name: "outbound-writes", signInAs: "dev.lead" },
  {
    route: "/transformations/:id/outbound-writes/:writeId",
    name: "outbound-write",
    signInAs: "dev.lead",
    detailOf: "/transformations/:id/outbound-writes",
  },
  // Slice A (ADR-0056): Imports.
  { route: "/strategy-kpis/imports", name: "imports-entry", signInAs: "dev.lead" },
  { route: "/transformations/:id/imports", name: "imports", signInAs: "dev.lead" },
  {
    route: "/transformations/:id/imports/:importId",
    name: "import",
    signInAs: "dev.lead",
    detailOf: "/transformations/:id/imports",
  },
  // Slice H (ADR-0057): Search.
  { route: "/search", name: "search", signInAs: "dev.lead" },
  // Slice D (ADR-0059): Administration > AI assistant.
  { route: "/admin/assistant", name: "admin-assistant", signInAs: "dev.admin" },
];

/** The key flows of ADR-0061 §7.2 (DG1–DG5 routes; scanned with the P6 routes). */
export const KEY_FLOW_AXE_SCREENS: readonly AxeScreen[] = [
  { route: "/my-work", name: "my-work", signInAs: "dev.lead" },
  { route: "/my-work/approvals", name: "approvals", signInAs: "SP fixture" },
  {
    route: "/my-work/approvals/:approvalId",
    name: "approval",
    signInAs: "SP fixture",
    detailOf: "/my-work/approvals",
  },
  { route: "/executive-overview", name: "executive-overview", signInAs: "dev.lead" },
  { route: "/transformations/:id/kpis/:kpiId", name: "kpi", signInAs: "dev.lead" },
  { route: "/transformations/:id/kpis/:kpiId/actuals", name: "kpi-actual-entry", signInAs: "KDS fixture" },
  { route: "/transformations/:id/kpi-review", name: "kpi-review-queue", signInAs: "BO fixture" },
  { route: "/transformations/:id/gates/:gateCode", name: "gate", signInAs: "SP fixture" },
  { route: "/transformations/:id/benefits/:benefitId", name: "benefit", signInAs: "dev.lead" },
  { route: "/transformations/:id/prioritization", name: "prioritization", signInAs: "dev.lead" },
  { route: "/transformations/:id/health-check", name: "health-check", signInAs: "dev.lead" },
  { route: "/transformations/:id/financial-metrics", name: "financial-metrics", signInAs: "dev.lead" },
  { route: "/walkthrough", name: "walkthrough", signInAs: "dev.office (demo database)" },
  { route: "/admin/branding", name: "branding-settings", signInAs: "dev.admin" },
];
