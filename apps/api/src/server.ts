// Fastify composition root (ADR-0002, ADR-0007). Builds the app WITHOUT listening, so tests use `inject` against a
// real database and main.ts adds only `listen` and signal handling.
//
// Router-level errors (FST_ERR_BAD_URL ...) and connection-level parser errors are answered as problems by the
// `frameworkErrors` / `clientErrorHandler` server options (platform/framework-errors.ts, T-DG2-BE12).
//
// JSON bodies and query strings are decoded as strict UTF-8 (platform/request-encoding.ts, T-DG2-BE13).
//
// Order matters:
//   1. platform hooks (request IDs, problem+json, route access declarations, fail-closed guard) and the connection
//      hygiene (T-DG2-BE16: an unread body closes its connection; bounded shutdown);
//   2. security headers (helmet, strict same-origin CSP), cookies, rate limiting (per validated-session subject or IP;
//      stricter on auth), then the not-found handler, which the limiter meters too;
//   3. the failed-authorization audit hook, health routes, identity (authentication + CSRF hook), then the modules;
//   4. the built SPA, when present, from the same origin (no CDN).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import helmet, { type FastifyHelmetOptions } from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "@mth/config";
// ADR-0053 §4 (T-DG6-DO-D): the log redaction set and its line redactor.
import { REDACTED_LOG_PATHS, redactLogLine, withSecretRedaction } from "@mth/config";
import { createDb, listMigrationFiles, type Db, type MigrationFile } from "@mth/db";
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance, type FastifyRequest } from "fastify";
import type pg from "pg";
import {
  principalOf,
  registerAccessP2Routes,
  registerAccessP4Routes,
  registerDeniedMutationAudit,
  registerSensitivityRoutes,
  resolveTarget,
  scopeFilter,
} from "./modules/access/index.ts";
import {
  checkBrandingContrast,
  colorTokens,
  contrastPointer,
  deriveDarkerShade,
  tokenSource,
  tokensAreProvisional,
} from "@mth/design-tokens";
import {
  registerAdminRoutes,
  registerBrandingRoutes,
  registerEnvironmentRoutes,
  registerIdentityAdminRoutes,
  registerNotificationChannelRoutes,
  registerSecurityRoutes,
  registerServiceIdentityRoutes,
  registerStorageAdminRoutes,
  registerUploadPolicyRoutes,
} from "./modules/admin/index.ts";
import { registerAuditRoutes, sensitiveRecordsRedactedForEveryone } from "./modules/audit/index.ts";
import {
  RateLimitSubjects,
  registerIdentity,
  registerNavigationRoutes,
  sessionCookieName,
  type OidcService,
} from "./modules/identity/index.ts";
import { registerEvidenceModule } from "./modules/evidence/index.ts";
// BE-H2 (ADR-0054 §2): the driver-selecting evidence store and the storage test's target and setting reads, wired here
// (the composition root) and injected into admin/storage.ts, which may not import evidence.
import {
  loadEffectiveStorage,
  s3SettingsKey,
  SelectingEvidenceStore,
  storageTestTarget,
} from "./modules/evidence/store.ts";
import { loadKpiP3GateFacts, registerKpiModule } from "./modules/kpi/index.ts";
import { createConfigResolver, registerMethodologyModule } from "./modules/methodology/index.ts";
import { registerOrganizationRoutes, registerCalendarRoutes } from "./modules/organization/index.ts";
import { registerJobOperationRoutes, registerJobScheduleRoutes } from "./modules/jobs/index.ts";
// P5 modules (p5-plan §3 seam 24; T-DG5-BE-A): each registers its route files (stubs until their owners fill them).
import { registerAutomationModule } from "./modules/automation/index.ts";
import { pinNewTransformationToForms, registerFormsModule, setFormBulkUpdaters } from "./modules/forms/index.ts";
// T-DG5-BE-H (ADR-0043 §2): the AutomationActionRegistry port and the action descriptors of their owning modules.
import { createAutomationActionRegistry, setAutomationActionRegistry } from "./modules/automation/registry.ts";
import { TASK_AUTOMATION_ACTIONS } from "./modules/tasks/automation-actions.ts";
import { createEmailChannel } from "./modules/tasks/channels/email.ts"; // BE-I (ADR-0054 §3)
import { renderTestMessage } from "./modules/tasks/channels/render.ts"; // BE-I (ADR-0054 §3)
import { registerHealthCheckSchemeProvider, registerHealthModule } from "./modules/health/index.ts";
import { registerLaunchModule } from "./modules/launch/index.ts";
import { launchPlanGenerator } from "./modules/launch/port.ts";
import { registerLaunchPlanPort } from "./modules/automation/ports/launch-plan.ts";
import { registerProceduresModule, wireProcedureApprovals } from "./modules/procedures/index.ts";
// P6 modules (p6-plan §3 seam 21; T-DG6-BE-A): each registers its route files (stubs until their owners fill them).
import { registerAssistantModule } from "./modules/assistant/index.ts";
import { registerIntegrationsModule } from "./modules/integrations/index.ts";
// T-DG6-BE-M (ADR-0056 §1): the ImportTargetRegistry port; the connector mappings read the template columns from it.
import { createImportTargetRegistry, setImportTargetRegistry } from "./modules/integrations/imports/targets.ts";
import { setConnectorTargetColumnsSource } from "./modules/integrations/connectors.ts";
import { createKpiActualImportTarget } from "./modules/kpi/import-target.ts";
import { setOutboundConfirmationPort } from "./modules/integrations/outbound.ts"; // BE-O (ADR-0055 §6)
import { setConnectorSecretProviders } from "./modules/integrations/secret-refs.ts"; // BE-X2 (ADR-0052 §5)
import { requireEvidenceRead } from "./modules/evidence/access.ts"; // BE-O (ADR-0051 §4 read decision)
import {
  recordConnectorConfirmation,
  setExternalChangeEvidenceGate,
} from "./modules/portfolio/deliverable-confirmation.ts"; // BE-O (ADR-0055 §6)
import { registerOperationsModule } from "./modules/operations/index.ts";
import { registerSearchModule } from "./modules/search/index.ts";
// P4 modules (p4-plan §2 seam 19; T-DG4-BE-A): each registers its route files (stubs until their owners fill them).
import { registerAdoptionModule, updateStakeholderGroup } from "./modules/adoption/index.ts";
import { registerBenefitsModule, updateBenefitRecord } from "./modules/benefits/index.ts";
import { registerGovernanceModule, updateExecutiveDecision } from "./modules/governance/index.ts";
import { registerRaidModule, updateRaidEntry } from "./modules/raid/index.ts";
import { registerSustainmentModule, wireTransitionDecisionApprovals } from "./modules/sustainment/index.ts";
import { registerTasksModule } from "./modules/tasks/index.ts";
import {
  loadInheritedApprovalFacts,
  loadPortfolioGateFacts,
  registerPortfolioModule,
  t08ScheduleFlags,
  updateInitiative,
} from "./modules/portfolio/index.ts";
import {
  createClientErrorHandler,
  createFrameworkErrorHandler,
  createSecretProviderRegistry,
  createJsonBodyParser,
  registerBuiltInSecretProviders,
  registerRateLimitClasses,
  DEFAULT_CONSUMES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_GRACE_MS,
  genReqId,
  JSON_MEDIA_TYPE,
  parseQueryString,
  problems,
  registerConnectionHygiene,
  registerHealthRoutes,
  registerInFlightTracking,
  registerMediaTypeEnforcement,
  registerNotFoundHandler,
  registerPlatformHooks,
  restrictParserTo,
  type InFlight,
  type ModuleRegistration,
  type SecretProviderRegistry,
  type SecurityHeaders,
} from "./modules/platform/index.ts";
import { registerReportingModule } from "./modules/reporting/index.ts";
// T-DG4-KBE-G2 (ADR-0037 §1 item 3): the workspace header's gate-readiness port (the raidDependencyPort precedent).
import { setWorkflowsReadPort } from "./modules/reporting/ports.ts";
import { setMeetingPackAssembler } from "./modules/governance/presentation.ts";
import { assemblerOf } from "./modules/reporting/reports/assembler.ts";
import { assembleReport } from "./modules/reporting/reports/snapshots.ts";
import { registerTransformationInitializer, registerTransformationRoutes } from "./modules/transformations/index.ts";
// T-DG4-KBE-C / T-DG4-BE-R1: the approval service for the kpi and sustainment ports, through workflows' public
// interface (workflows/index.ts exports it since BE-C).
import {
  effectiveGateApprover,
  registerApprovalSubject,
  registerWorkflowsModule,
  requestApprovalInTx,
  toApprovals,
  type GateFactsProvider,
  updateDesignDecision,
} from "./modules/workflows/index.ts";
// T-DG4-BE-D (ADR-0031 §2): the RAID Dependency-entry port, implemented by the T08 service (the KBE-C import precedent).
import { raidDependencyPort } from "./modules/workflows/t08-dependencies.ts";
// T-DG4-KBE-G2 (ADR-0037 §1 item 3, §9): the read-only gate readiness behind reporting's WorkflowsReadPort (the same
// precedent; workflows/index.ts's export list is pinned by workflows.test.ts, which this task does not own).
import { gateReadinessReader } from "./modules/workflows/gate-readiness-read.ts";
// P4 (T-DG4-BE-K; ADR-0035 §2): the G5/G6 GateFactsProvider members (read-only loaders in their owning modules).
import { loadAdoptionGateFacts } from "./modules/adoption/gate-facts.ts";
import { loadBenefitsGateFacts } from "./modules/benefits/gate-facts.ts";
import { loadGovernanceGateFacts } from "./modules/governance/gate-facts.ts";
import { loadRaidGateFacts } from "./modules/raid/gate-facts.ts";
import { loadSustainmentGateFacts } from "./modules/sustainment/gate-facts.ts";
// T-DG4-BE-L (ADR-0036 §3, §6): the material-change port (kpi's formula hook, portfolio's threshold refusals) and kpi's
// change-request apply entry point, wired between workflows and kpi/portfolio (the KBE-C import precedent).
import { activateKpiVersionByChangeRequest } from "./modules/kpi/kpi-versions.ts";
import { setMaterialChangePort } from "./modules/platform/index.ts";
import { materialChangePortImpl, setKpiVersionActivator } from "./modules/workflows/change-requests.ts";
// T-DG5-BE-B2 (ADR-0039 §8; REQ-S12-018): the "revision proposed" starter wraps the DG4 material-change port (the DG4
// behaviour runs first, unchanged) and writes its review tasks through tasks' createWorkItemOnce (methodology imports
// no business module).
import { setReviewTaskWriter, withRevisionProposals } from "./modules/methodology/revision-impact.ts";
import { closeWorkItemsOfSubject, createWorkItemOnce } from "./modules/tasks/index.ts";
// T-DG5-BE-C (ADR-0040 §4): methodology migrations request and decide their approval through workflows' service and
// write re-approval tasks through tasks' services, passed in as ports (methodology imports no business module).
import { wireMethodologyMigrations } from "./modules/methodology/migrations.ts";

export const JSON_BODY_LIMIT_BYTES = 1_048_576;

export interface ServerOptions {
  readonly config: AppConfig;
  readonly pool: pg.Pool;
  /** Defaults to a pino logger at config.logLevel with credential redaction; tests pass false. */
  readonly logger?: boolean;
  /** Destination of that logger (default stdout); tests capture log lines with it. Ignored when logger is false. */
  readonly logStream?: { write(line: string): unknown };
  /** Override the OIDC service (tests bind it to a local fake IdP). null disables OIDC routes. */
  readonly oidc?: OidcService | null;
  /** Directory of the built SPA; null disables static serving. Default: the first existing candidate. */
  readonly webRoot?: string | null;
  /** Migrations the readiness check expects (default: those shipped with @mth/db). */
  readonly migrationFiles?: readonly MigrationFile[];
  /** T-DG2-BE16: time in-flight requests get after `app.close()` (default DEFAULT_SHUTDOWN_GRACE_MS, 5 s). */
  readonly shutdownGraceMs?: number;
  /** T-DG2-BE16: Node `requestTimeout` for headers + body (default DEFAULT_REQUEST_TIMEOUT_MS, 300 s). */
  readonly requestTimeoutMs?: number;
  /** How often Node checks that timeout (default Node's 30 s; tests shorten it). */
  readonly connectionsCheckingIntervalMs?: number;
}

/** Security headers (helmet) with a strict same-origin CSP. Also applied to router- and connection-level errors. */
export const HELMET_OPTIONS = {
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
} satisfies FastifyHelmetOptions;

const TRANSPORT_HEADERS = new Set(["content-type", "content-length", "date", "connection", "keep-alive"]);

/**
 * T-DG2-BE12: the exact headers helmet adds with HELMET_OPTIONS, captured once from a throwaway Fastify instance with
 * only helmet registered. Router-level (`frameworkErrors`) and connection-level (`clientErrorHandler`) errors run no
 * onRequest/onSend hook, so they set these themselves; the values never drift from the plugin's.
 */
export async function captureSecurityHeaders(options: FastifyHelmetOptions = HELMET_OPTIONS): Promise<SecurityHeaders> {
  const probe = Fastify({ logger: false });
  try {
    await probe.register(helmet, options);
    probe.get("/", async () => "");
    const res = await probe.inject({ method: "GET", url: "/" });
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(res.headers)) {
      if (!TRANSPORT_HEADERS.has(name) && typeof value === "string") headers[name] = value;
    }
    return headers;
  } finally {
    await probe.close();
  }
}

export function defaultWebRoot(): string | null {
  const candidates = [new URL("../public/", import.meta.url), new URL("../../web/dist/", import.meta.url)].map((u) =>
    fileURLToPath(u),
  );
  return candidates.find((dir) => existsSync(`${dir}index.html`)) ?? null;
}

export interface RouteRecord {
  readonly method: string;
  readonly url: string;
  readonly access: unknown;
  /** The request media types the route accepts (F-DG2-320). */
  readonly consumes: readonly string[];
  /** P6 (ADR-0052 §4): the route's rate-limit class, or null (the global limit only). */
  readonly rateLimitClass: string | null;
}

export async function buildServer(options: ServerOptions): Promise<{
  app: FastifyInstance;
  db: Db;
  routes: readonly RouteRecord[];
  modules: readonly ModuleRegistration[];
  inFlight: InFlight;
  /** P6 (ADR-0052 §5): the SecretProvider registry of this process (BE-E registers the env and file providers). */
  secrets: SecretProviderRegistry;
}> {
  const { config, pool } = options;
  if (!config.appBaseUrl) throw new Error("APP_BASE_URL is required by the API");
  const webRoot = options.webRoot === undefined ? defaultWebRoot() : options.webRoot;

  // T-DG2-BE12: errors raised before routing answer the declared problem+json, with the same security headers.
  const securityHeaders = await captureSecurityHeaders();
  let appLog: FastifyBaseLogger | null = null;
  const onClientError = createClientErrorHandler(securityHeaders, (requestId, code) =>
    appLog?.info({ requestId, code }, "request refused by the HTTP parser"),
  );

  const requestTimeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            ...(options.logStream ? { stream: options.logStream } : {}),
            // ADR-0053 §4 (T-DG6-DO-D): the header paths (the DG1 four plus x-mth-signature) are censored by pino;
            // every serialized line then passes the process-wide redaction set (SecretProvider values, configuration
            // secrets, storage keys, URLs and paths, link tokens, OIDC parameters) before it is written.
            redact: { paths: [...REDACTED_LOG_PATHS], censor: "[redacted]" },
            hooks: { streamWrite: redactLogLine },
          },
    genReqId,
    // T-DG6-DO-A2: fastify 5.12 deprecates the top-level `requestIdLogLabel` (FSTDEP024); same label, same log lines.
    logController: new LogController({ requestIdLogLabel: "requestId" }),
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    trustProxy: config.trustProxy.length > 0 ? [...config.trustProxy] : false,
    // F-DG2-290: strict percent-decoding; an undecodable component is refused by the central preHandler check.
    routerOptions: { querystringParser: parseQueryString },
    frameworkErrors: createFrameworkErrorHandler(securityHeaders),
    clientErrorHandler: onClientError,
    // T-DG2-BE16: a request (headers and body) must arrive within requestTimeout, else Node answers 408 and closes the
    // connection (Fastify's default 0 let a stalled body hold its connection forever). `forceCloseConnections` stays
    // Fastify's "idle": close() drops idle keep-alive connections at once and in-flight ones get the shutdown grace
    // period (platform/connection-hygiene.ts), instead of `true`, which would cut every in-flight request at close().
    // Node arms the timeout only when it is passed to http.createServer (Fastify's own option is assigned afterwards
    // and alone has no effect: verified on Node 22 and 24), so it is given in `http` as well.
    requestTimeout,
    http: {
      requestTimeout,
      ...(options.connectionsCheckingIntervalMs !== undefined
        ? { connectionsCheckingInterval: options.connectionsCheckingIntervalMs }
        : {}),
    },
    forceCloseConnections: "idle",
  });
  appLog = app.log;
  // F-DG2-290: JSON bodies are read as raw bytes and decoded as strict UTF-8 (never rewritten to U+FFFD), then parsed
  // by Fastify's default JSON parser (same empty/invalid-JSON errors and prototype-poisoning protection). Registered on
  // the root instance, so every module inherits it; the evidence octet-stream parser is separate.
  // F-DG2-320: each route accepts only its declared `config.consumes` media types (platform/media-types.ts): the
  // text/plain parser is removed, a central preParsing hook refuses any other media type with 400
  // validation.content_type before a body byte is read, and each parser re-checks the route's set.
  registerMediaTypeEnforcement(app);
  app.addContentTypeParser(
    JSON_MEDIA_TYPE,
    { parseAs: "buffer" },
    restrictParserTo(JSON_MEDIA_TYPE, createJsonBodyParser(app.getDefaultJsonParser("error", "error"))),
  );
  const db = createDb(pool);
  // Every registered route, for the route-coverage and access-declaration tests.
  const routes: RouteRecord[] = [];
  app.addHook("onRoute", (r) => {
    for (const method of [r.method].flat())
      routes.push({
        method: String(method),
        url: r.url,
        access: r.config?.access,
        consumes: r.config?.consumes ?? DEFAULT_CONSUMES,
        rateLimitClass: r.config?.rateLimitClass ?? null,
      });
  });

  // The not-found handler is registered after the rate limiter, which meters it too (T-DG2-BE16).
  registerPlatformHooks(app, { notFound: "deferred" });
  // T-DG2-BE16: a response sent before its request body was consumed closes the connection (bounded lingering close),
  // and app.close() destroys what is still open after the shutdown grace period.
  registerConnectionHygiene(app, { shutdownGraceMs: options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS });
  // T-DG2-BE18A (F-DG2-460): every route handler registered from here on is tracked until it settles (including its
  // cleanup), so shutdown can wait for it before the pool closes (main.ts).
  const inFlight = registerInFlightTracking(app);

  await app.register(helmet, HELMET_OPTIONS);
  await app.register(cookie);

  const cookieName = sessionCookieName(config.appBaseUrl);
  // F-DG1-142: the limiter never trusts a presented cookie value. Only a cookie the identity hook has RESOLVED to a
  // live session (within the idle timeout) maps to the authenticated subject; everything else - no cookie, forged,
  // expired or revoked - is keyed by the client IP, so rotating fake cookies cannot open fresh buckets.
  const rateLimitSubjects = new RateLimitSubjects(config.session.idleMinutes * 60_000);
  const rateLimitKey = (request: FastifyRequest) => {
    const token = request.cookies?.[cookieName];
    const subject = token ? rateLimitSubjects.subjectOf(token) : null;
    return subject ? `u:${subject}` : `ip:${request.ip}`;
  };
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.perMinute,
    timeWindow: "1 minute",
    // Keyed by the authenticated subject (user id) of a validated session, or else the client IP (TRUST_PROXY decides
    // which X-Forwarded-For hops count). Decided without a database lookup, so floods are refused before any query.
    // In-process store (ADR-0007 T-3); a PostgreSQL store comes with multi-instance P6.
    keyGenerator: rateLimitKey,
    allowList: (request: FastifyRequest) => request.url === "/healthz" || request.url === "/readyz",
    errorResponseBuilder: () => problems.rateLimited(),
  });
  // T-DG2-BE16 (audit round 10, P3): `global: true` attaches the limiter through `onRoute`, and an unmatched route has
  // no route, so unmatched-route 404s were never metered. The not-found handler runs it as a preHandler (the plugin's
  // documented form; same key, store and limit). Its 429, like the unmatched 404 itself, belongs to no operation and is
  // outside the contract by design (ADR-0007 §5b).
  registerNotFoundHandler(app, { spaFallback: webRoot !== null, preHandler: app.rateLimit() });
  // P6 (T-DG6-BE-E; ADR-0052 §4): the rate-limit classes, each in addition to the global limit, same key.
  registerRateLimitClasses(app, config.rateLimitClasses, rateLimitKey);

  registerDeniedMutationAudit(app, db);
  registerHealthRoutes(app, pool, options.migrationFiles ?? listMigrationFiles());
  const deps = { db, config };
  registerIdentity(app, deps, {
    rateLimitSubjects,
    ...(options.oidc !== undefined ? { oidc: options.oidc } : {}),
  });
  registerOrganizationRoutes(app, deps);
  registerTransformationRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerAccessP2Routes(app, deps);
  // T-DG5-BE-R (ADR-0049 §8): the versioned branding routes; the token route merges the current version's colours and
  // re-derives the ADR-0009 §3 shades from the same single token source at read time.
  registerBrandingRoutes(
    app,
    {
      colorTokens,
      tokensAreProvisional,
      derived: tokenSource.derived,
      deriveDarkerShade,
      // T-DG6-BE-W (ADR-0061 §1): the runtime contrast rule and the SHA-256 of the tokens.json bytes read at start-up.
      checkBrandingContrast: (primary, secondary) =>
        checkBrandingContrast(primary, secondary).map((p) => ({ ...p, pointer: contrastPointer(p) })),
      tokenSourceSha256: createHash("sha256")
        .update(readFileSync(createRequire(import.meta.url).resolve("@mth/design-tokens/tokens.json")))
        .digest("hex"),
    },
    deps,
  );
  // P4 (T-DG4-BE-A; ADR-0025, ADR-0026): business calendars (organization), job schedules (jobs) and the BE-B access
  // route files (groups, role mappings, delegations). The workspace header is served by reporting (ADR-0037 §11).
  registerCalendarRoutes(app, deps);
  registerJobScheduleRoutes(app, db);
  registerAccessP4Routes(app, deps);
  // P5 (T-DG5-BE-A stubs; p5-plan §5.1): the jobs operations view (BE-I), GET /me/navigation (BE-R) and the environment
  // read (BE-S). Each owner fills its own file; these lines do not change.
  registerJobOperationRoutes(app, deps);
  registerNavigationRoutes(app, deps);
  registerEnvironmentRoutes(app, deps);
  // P6 (T-DG6-BE-A stubs; p6-plan §5.1, p6-work-split §E/F.1): the route files outside the four P6 modules that the
  // composition root registers. Each owner fills its own file; these lines do not change, except that BE-E fills the
  // members of the audit routes' access port on its line (audit cannot import access: ADR-0002 rule 5).
  registerSensitivityRoutes(app, deps); // BE-B: record sensitivity and sensitive-record grants (ADR-0051 §2)
  registerUploadPolicyRoutes(app, deps); // BE-D: the upload policy (ADR-0052 §1)
  registerSecurityRoutes(app, deps); // BE-E: the security view, rate-limit classes (ADR-0052 §4)
  registerAuditRoutes(app, deps, {
    // BE-E: the global audit API (ADR-0052 §8). The access port (D-197 item 5): audit_event.read per ADR-0006, and the
    // ADR-0051 §2 redaction. MERGE NOTE: when T-DG6-BE-B's sensitivity clause lands, restrictedRecords uses it instead
    // of the fail-closed interim (which redacts every sensitive record's events for everyone).
    organizationAccess: async (request, organizationId) => {
      const principal = principalOf(request);
      principal.tracker.decisions += 1;
      if (!(await resolveTarget(db, { type: "organization", id: organizationId }))) return "not_found";
      const holds = principal.grants.some(
        (g) => g.organizationId === organizationId && g.permissions.has("audit_event.read"),
      );
      return holds ? "allowed" : "forbidden";
    },
    readFilter: (request, cols) => scopeFilter(principalOf(request), "audit_event.read", cols),
    restrictedRecords: sensitiveRecordsRedactedForEveryone(db),
  });
  registerIdentityAdminRoutes(app, deps); // BE-G: Administration > Identity (slice C)
  // BE-H2: Administration > Storage (slice C). admin may not import evidence, so the setting read and the storage test's
  // target are injected; the evidence module's store selects the driver per upload and per content row (ADR-0054 §2).
  const evidenceStore = new SelectingEvidenceStore({
    db,
    environment: config.evidenceStorage,
    secrets: () => secrets,
  });
  registerStorageAdminRoutes(app, deps, {
    secrets: () => secrets,
    storage: {
      load: (d) => loadEffectiveStorage(d, config.evidenceStorage),
      settingsKey: s3SettingsKey,
      testTarget: (driver, s3) => storageTestTarget(driver, s3, config.evidenceStorage, secrets),
    },
  });
  // BE-I: Administration > Notifications (slice C). admin may not import tasks, so the email adapter and the test
  // renderer of tasks/channels/** are injected here; the SecretProvider registry (created below) is read at request time.
  registerNotificationChannelRoutes(app, deps, {
    secrets: () => secrets,
    channels: { createEmailChannel, renderTestMessage },
  });
  registerServiceIdentityRoutes(app, deps); // BE-J: Administration > Service identities (slice J)
  // P3 (ADR-0021 §1): workflows' G4 evaluators read portfolio and kpi facts through this provider (dependency
  // injection; workflows never imports portfolio). The kpi part is kpi's P3 loader (KBE-C, kpi/p3-gate-facts.ts).
  const gateFacts: GateFactsProvider = {
    portfolio: loadPortfolioGateFacts,
    kpi: loadKpiP3GateFacts,
    // The gate list/view inherited-approval annotation (ADR-0021 §5; F-DG3-120): read-only, never a gate status.
    inheritedApprovals: loadInheritedApprovalFacts,
    // P4 (T-DG4-BE-K; ADR-0035 §2): the G5/G6 fact loaders, each read-only in its owning module's gate-facts.ts.
    raid: loadRaidGateFacts,
    adoption: loadAdoptionGateFacts,
    governance: loadGovernanceGateFacts,
    sustainment: loadSustainmentGateFacts,
    benefits: loadBenefitsGateFacts,
  };
  // Business modules reporting their registration (D-048): the P2 modules (workflows, methodology, evidence; kpi by
  // kpi-benefits-engineer), the P3 portfolio module, and the remaining scaffold (reporting, P5), which registers no
  // routes until its stage.
  // T-DG4-BE-J (D-107): sustainment requests transition-decision approvals through workflows' approval service, passed
  // in as a port (sustainment cannot import workflows).
  wireTransitionDecisionApprovals({ requestApproval: requestApprovalInTx, registerSubject: registerApprovalSubject });
  // T-DG4-KBE-G2 (ADR-0037 §1 item 3, §9): the workspace header's live gate readiness, through reporting's port.
  // T-DG5-KBE-D4 (D-164 c): the gate pack names the effective approver (workflows' routing rule) when not submitted.
  setWorkflowsReadPort({
    gateReadiness: gateReadinessReader(gateFacts),
    gateApprover: async (db, tId, code) => {
      const a = await effectiveGateApprover(db, tId, code);
      return a === undefined ? null : { roleCode: a.roleCode, userId: a.userId };
    },
  });
  // T-DG5-BE-B2 (ADR-0039 §8 case 2): benefitFormulaVersionCreated also records the S12-018 revision proposal.
  setReviewTaskWriter(createWorkItemOnce);
  setMaterialChangePort(withRevisionProposals(materialChangePortImpl));
  setKpiVersionActivator(activateKpiVersionByChangeRequest);
  // T-DG5-BE-C (ADR-0040 §4): the methodology_migration approval subject (decided through its record) and its ports.
  wireMethodologyMigrations({
    requestApproval: requestApprovalInTx,
    registerSubject: registerApprovalSubject,
    createWorkItem: createWorkItemOnce,
    closeWorkItems: closeWorkItemsOfSubject,
  });
  // T-DG5-BE-F2 (ADR-0042 §2): a procedure approval step requests its `procedure_step` approval through workflows'
  // service and completes when its business approver approves (procedures imports no workflows code).
  wireProcedureApprovals({ requestApproval: requestApprovalInTx, registerSubject: registerApprovalSubject });
  // P5 wiring points (p5-plan §2, §5.3; T-DG5-BE-A).
  //  - ConfigResolver (ADR-0039 §3): the one resolver of pinned configuration versions. Modules that read configuration
  //    receive it in their register options (named wiring lines below); methodology imports none of them.
  //  - AutomationActionRegistry (p5-plan §2; BE-H defines it in automation): domain modules register their actions into
  //    it here, so automation imports no domain module (the GateFactsProvider pattern). BE-H adds the registry line and
  //    each action owner adds one registration line below it.
  const configResolver = createConfigResolver();
  // T-DG5-BE-D (ADR-0041 §4): a transformation created from this release on is pinned to the newest published forms
  // version in its create transaction (DG1-DG4 transformations stay unpinned and read forms v1).
  registerTransformationInitializer("forms.pin", pinNewTransformationToForms);
  registerLaunchPlanPort(launchPlanGenerator); // T-DG5-BE-P (ADR-0044 §1, ADR-0048 §1): the S12-004 LaunchPlanPort of the API process
  registerHealthCheckSchemeProvider(); // T-DG5-KBE-G (ADR-0048 §6): the health_check_scheme kind provider (default key health-check)
  // T-DG5-BE-O (ADR-0045 §7; D-159): the live presentation of a meeting is reporting's meeting_pack document (KBE-D2's
  // assembler). A port, because reporting depends on governance and the reverse import would close a module cycle.
  setMeetingPackAssembler(async (db, { transformationId, meetingId }) =>
    assemblerOf("meeting_pack") === undefined
      ? null
      : (
          await assembleReport(db, {
            definitionCode: "meeting_pack",
            transformationId,
            subjectId: meetingId,
            reportingPeriodId: undefined,
            parameters: {},
          })
        ).document,
  );
  // T-DG5-BE-E3 (D-159 a; ADR-0041 §5): the forms bulk map, one line per register whose PATCH core its own module
  // exports (forms imports none of these modules under ADR-0002; no P5 module imports workflows).
  setFormBulkUpdaters({
    T04: updateDesignDecision,
    T05: updateInitiative,
    T13: updateStakeholderGroup,
    T14: updateBenefitRecord,
    T15: updateRaidEntry,
    T16: updateExecutiveDecision,
  });
  // T-DG5-BE-H: the registry line; each action owner adds one registration line below it (BE-J: launch_procedure).
  const automationActions = createAutomationActionRegistry();
  for (const descriptor of TASK_AUTOMATION_ACTIONS) automationActions.register(descriptor); // tasks (BE-H)
  setAutomationActionRegistry(automationActions);
  // P6 wiring points (p6-plan §2, §5.1, §5.3; p6-work-split §E/F.1; T-DG6-BE-A).
  //  - SecretProvider (ADR-0052 §5): the registry of this process. BE-E registers the built-in `env` and `file`
  //    providers on the line below it (`secrets.register(...)`); an IT-supplied adapter is registered the same way. The
  //    worker's composition (apps/worker/src/main.ts) gets its own registry when a job first needs a secret.
  //  - ReadScope (ADR-0051 §1): BE-B's `readScopeFor` in access/read-scope.ts, re-exported by access/index.ts. Modules
  //    import it from access directly (every P6 module depends on access); nothing is wired here. The worker's job
  //    identities (ADR-0053, BE-J) receive it through the job kit, not through this file.
  //  - ImportTargetRegistry (p6-plan §2; ARCH-03 defines it in integrations, BE-M creates it): the registry line goes
  //    below this block, and each domain adds one registration line below it (KBE-A: kpi's import target first), so
  //    integrations imports no domain module (the AutomationActionRegistry pattern above).
  //  - NotificationChannel (ARCH-02; BE-I, tasks/channels/**): the channel registry line goes below this block (the
  //    in-app channel first, then the email adapter when configured); fan-out runs in the worker after commit.
  //  - ModelProvider (ARCH-05; BE-T, assistant/provider.ts): the provider line goes below this block (the local test
  //    adapter, or the HTTP adapter when configured); with nothing configured the assistant stays disabled.
  // ADR-0053 §4 item 1 (DO-D): every value a registered provider resolves joins the log redaction set.
  const secrets = withSecretRedaction(createSecretProviderRegistry());
  registerBuiltInSecretProviders(secrets, { secretsDir: config.secretsDir }); // BE-E: env and file (ADR-0052 §5)
  // T-DG6-BE-X2 (F-DG6-QA-A-1): the integrations module resolves connector credentials and webhook signing secrets
  // through this process's registry (secret-refs.ts); without this line every reference is unresolvable.
  setConnectorSecretProviders(secrets);
  // T-DG6-BE-M: the ImportTargetRegistry line; each import target's owner adds one registration line below it
  // (KBE-A: kpi_actual.v1). The connector mappings' target columns come from the registered templates (ADR-0056 §9).
  const importTargets = createImportTargetRegistry();
  setImportTargetRegistry(importTargets);
  setConnectorTargetColumnsSource((kind) => importTargets.columnsOf(kind));
  importTargets.register(createKpiActualImportTarget()); // T-DG6-KBE-A: kpi_actual.v1 (ADR-0056 §4-§6, §9)
  // T-DG6-BE-O: a confirmed deliverable_status_push confirms its flagged deliverable (connector_result; integrations
  // imports no portfolio code), and a reviewed-evidence confirmation cites only evidence the confirmer may read.
  setOutboundConfirmationPort({
    onConfirmed: async (tx, ctx, confirmed) => void (await recordConnectorConfirmation(tx, ctx, confirmed)),
  });
  setExternalChangeEvidenceGate(requireEvidenceRead);
  const modules: ModuleRegistration[] = [
    registerWorkflowsModule(app, deps, { gateFacts, t08ScheduleFlags }),
    // T-DG4-KBE-C (D-095): kpi requests kpi_version_activation approvals through workflows' approval service, passed
    // in as a port (kpi cannot import workflows, which depends on kpi).
    registerKpiModule(app, deps, {
      approvals: {
        requestApproval: requestApprovalInTx,
        registerSubject: registerApprovalSubject,
        present: toApprovals,
      },
    }),
    registerReportingModule(app, deps),
    registerMethodologyModule(app, deps, { configResolver }),
    registerEvidenceModule(app, deps, evidenceStore), // BE-H2: the driver-selecting store above
    registerPortfolioModule(app, deps),
    // P4 modules (p4-plan §2 seam 19): tasks is active (BE-A); the others report "scaffold" until a route exists.
    registerTasksModule(app, deps),
    registerGovernanceModule(app, deps),
    registerRaidModule(app, deps, { dependencies: raidDependencyPort }),
    registerBenefitsModule(app, deps),
    registerAdoptionModule(app, deps),
    registerSustainmentModule(app, deps),
    // P5 modules (p5-plan §3 seam 24): each reports "scaffold" until a route exists.
    registerFormsModule(app, deps),
    registerProceduresModule(app, deps),
    registerAutomationModule(app, deps),
    registerLaunchModule(app, deps),
    registerHealthModule(app, deps),
    // P6 modules (p6-plan §3 seam 21): each reports "scaffold" until a route exists.
    registerIntegrationsModule(app, deps),
    registerSearchModule(app, deps),
    registerAssistantModule(app, deps),
    registerOperationsModule(app, deps),
  ];

  if (webRoot) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false, index: ["index.html"] });
  }

  await app.ready();
  return { app, db, routes, modules, inFlight, secrets };
}
