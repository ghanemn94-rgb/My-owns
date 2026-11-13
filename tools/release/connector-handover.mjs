#!/usr/bin/env node
// Connector handover list (ADR-0070 §3; REQ-S17-004 procedure "the handover lists required endpoints and
// credentials"; REQ-S19-007 "every … connector in the release is described"; p7-work-split §F.1, T-F6, T-F7).
//
//   node tools/release/connector-handover.mjs --write   # (re)generates docs/handover/api/connectors.md
//   node tools/release/connector-handover.mjs --check   # exit 1 unless the committed file equals a fresh generation
//   options: [--root <dir>] (default: the repository; tests point it at a fixture tree)
//
// Sources, all read-only:
//   - docs/delivery/environment.md, ONLY the table under "## P6 residuals: live integrations not exercised in this
//     environment" (one fixed file: this tool never walks a delivery folder, D-138);
//   - apps/api/src/modules/integrations/adapters/port.ts `CONNECTOR_ADAPTER_KINDS`, which connectors.ts imports;
//   - the file names of each local adapter and its contract tests (checked to exist);
//   - the .env.example keys an integration needs (checked to exist).
// Every enterprise connector reads "Not verified": no authenticated test against a Mobily endpoint has been recorded.
// Credentials are named (a `*_FILE` key or a SecretRef field), never shown.
//
// Exit codes (p7-work-split §2 rule 4): 0 PASS, 1 FAIL (parity: a row without a mapping, a mapping without a row, an
// adapter kind not covered, a named file or key that does not exist, or --check differs), 2 BLOCKED (missing input,
// usage). Dependency-free.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");
export const OUT = "docs/handover/api/connectors.md";
export const ENVIRONMENT = "docs/delivery/environment.md";
export const PORT = "apps/api/src/modules/integrations/adapters/port.ts";
export const CONNECTORS = "apps/api/src/modules/integrations/connectors.ts";
export const ENV_EXAMPLE = ".env.example";
export const TABLE_HEADING = "## P6 residuals: live integrations not exercised in this environment";
export const NOT_VERIFIED_EN = "Not verified: no authenticated test against a Mobily endpoint has been recorded.";
export const NOT_VERIFIED_AR = "غير متحقق منه: لم يُسجَّل أي اختبار موثَّق مقابل نقطة اتصال لدى موبايلي.";

/**
 * One entry per integration row of the environment.md table. `match` is the row's integration name (bold and the
 * trailing "(REQ-…)" removed). Files and env keys are checked to exist at generation time.
 */
export const INTEGRATIONS = Object.freeze([
  {
    match: "Corporate identity provider (OIDC)",
    adapter: ["apps/api/src/modules/identity/oidc.ts"],
    tests: ["apps/api/test/integration/oidc.test.ts", "apps/api/test/integration/identity/other-realm.test.ts"],
    double: "apps/api/test/support/fake-idp.ts",
    endpoint: "The issuer URL (https), as `OIDC_ISSUER_URL`; the redirect URI `<origin>/api/v1/auth/callback` registered at the IdP",
    credentials: "`OIDC_CLIENT_ID` (not secret); the client secret as `OIDC_CLIENT_SECRET_FILE` (a mounted file)",
    envKeys: ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_SCOPES"],
  },
  {
    match: "Keycloak test realm e2e",
    adapter: ["deploy/keycloak/realm-mth-test.json"],
    tests: ["apps/api/test/integration/identity/other-realm.test.ts"],
    double: "deploy/keycloak/realm-mth-test.json",
    endpoint: "The `test-idp` Compose profile on a host with a container runtime (a test realm, never production)",
    credentials: "None from IT: the test realm's synthetic users and client are test fixtures",
    envKeys: ["OIDC_ISSUER_URL"],
  },
  {
    match: "Brokered SAML",
    adapter: [],
    tests: [],
    double: null,
    endpoint: "The corporate SAML IdP metadata URL, configured in the Keycloak broker (the hub itself speaks OIDC only)",
    credentials: "The IdP signing certificate (public, not a secret); the broker's OIDC client secret as `OIDC_CLIENT_SECRET_FILE`",
    envKeys: ["OIDC_CLIENT_SECRET"],
  },
  {
    match: "IT object store (S3-compatible)",
    adapter: ["apps/api/src/modules/evidence/stores/s3.ts", "apps/api/src/modules/evidence/stores/filesystem.ts"],
    tests: ["apps/api/test/integration/evidence/store-contract.test.ts", "apps/api/test/integration/admin/storage.test.ts"],
    double: "apps/api/test/support/fake-s3.ts",
    endpoint: "The store endpoint (https), region, bucket and optional key prefix, entered in Administration > Storage",
    credentials: "SecretRefs `accessKeyRef` and `secretKeyRef` of the storage setting, resolved through `SECRETS_DIR` and bound in `SECRET_BINDINGS_FILE`",
    envKeys: ["EVIDENCE_STORAGE_DRIVER", "SECRETS_DIR", "SECRET_BINDINGS_FILE"],
  },
  {
    match: "SMTP relay",
    adapter: ["apps/api/src/modules/tasks/channels/email.ts"],
    tests: [
      "apps/api/test/integration/tasks/email-adapter-contract.test.ts",
      "apps/api/test/integration/admin/notification-channels.test.ts",
    ],
    double: "apps/api/test/support/fake-smtp.ts",
    endpoint: "The relay host and port and its security mode, entered in Administration > Notification channels",
    credentials: "Optional SecretRefs `usernameRef` and `passwordRef` of the email channel (both or neither)",
    envKeys: ["SECRETS_DIR", "SECRET_BINDINGS_FILE"],
  },
  {
    match: "Enterprise messaging",
    adapter: [],
    tests: ["apps/api/test/integration/admin/notification-channels.test.ts"],
    double: null,
    endpoint: "None in this release: no adapter ships, and enabling the channel is refused",
    credentials: "None in this release",
    envKeys: [],
  },
  {
    match: "Corporate data source (`http_pull` connector)",
    adapter: ["apps/api/src/modules/integrations/adapters/http-pull.ts"],
    tests: [
      "apps/api/test/integration/integrations/adapter-contract.test.ts",
      "apps/api/test/integration/integrations/connectors.test.ts",
    ],
    double: "apps/api/test/support/fake-http-source.ts",
    endpoint: "The source URL (https) in the connector's adapter settings, and the network route to it",
    credentials: "The connector's credential reference `bearer` (a SecretRef, sent as `Authorization: Bearer`)",
    envKeys: ["SECRETS_DIR", "SECRET_BINDINGS_FILE"],
  },
  {
    match: "AI model endpoint (optional assistant)",
    adapter: ["apps/api/src/modules/assistant/provider.ts"],
    tests: ["apps/api/test/integration/assistant/provider.test.ts"],
    double: "apps/api/test/support/fake-model.ts",
    endpoint: "The chat-completions endpoint (https) and model name, entered in the assistant setting (disabled by default)",
    credentials: "The assistant setting's SecretRef `credentialRef`",
    envKeys: ["SECRETS_DIR", "SECRET_BINDINGS_FILE"],
  },
]);

/** Adapter kinds of connectors.ts: their local adapter and contract test. */
export const ADAPTER_KINDS = Object.freeze({
  test_adapter: {
    adapter: "apps/api/src/modules/integrations/adapters/test-adapter.ts",
    tests: ["apps/api/test/integration/integrations/adapter-contract.test.ts"],
    note: "The local adapter (M0335): healthy, failing or stopped on demand. Never contacts a network.",
  },
  http_pull: {
    adapter: "apps/api/src/modules/integrations/adapters/http-pull.ts",
    tests: [
      "apps/api/test/integration/integrations/adapter-contract.test.ts",
      "apps/api/test/integration/integrations/connectors.test.ts",
    ],
    note: "Pulls rows from an IT-supplied HTTPS source (row \"Corporate data source\" below).",
  },
  webhook: {
    adapter: "apps/api/src/modules/integrations/webhooks.ts",
    tests: ["apps/api/test/integration/integrations/webhooks.test.ts"],
    note: "Inbound: the source system calls the hub's webhook endpoint with a signed request; no outbound endpoint.",
  },
});

export class Blocked extends Error {}

const cellsOf = (line) => {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  return t
    .slice(1, t.endsWith("|") ? -1 : undefined)
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
};

export const integrationName = (cell) =>
  cell
    .replace(/\*\*/g, "")
    .replace(/\s*\((?:REQ-[A-Z0-9-]+(?:,\s*)?)+\)\s*$/, "")
    .trim();

/** The integration rows of the environment.md residual table: [{ name, proven, residual, supplies, guide }]. */
export function residualRows(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === TABLE_HEADING);
  if (start < 0) throw new Blocked(`heading "${TABLE_HEADING}" not found in ${ENVIRONMENT}`);
  let i = start + 1;
  while (i < lines.length && !/^#{1,2}\s/.test(lines[i])) {
    const c = cellsOf(lines[i]);
    if (c && c[0] === "Integration") break;
    i++;
  }
  const header = cellsOf(lines[i] ?? "");
  if (!header || header[0] !== "Integration") throw new Blocked(`no "| Integration |" table under "${TABLE_HEADING}"`);
  const rows = [];
  for (let j = i + 2; j < lines.length; j++) {
    const c = cellsOf(lines[j]);
    if (!c) break;
    rows.push({ name: integrationName(c[0]), proven: c[1] ?? "", residual: c[2] ?? "", supplies: c[3] ?? "", guide: c[4] ?? "" });
  }
  if (rows.length === 0) throw new Blocked(`the table under "${TABLE_HEADING}" has no row`);
  return rows;
}

/** `CONNECTOR_ADAPTER_KINDS` of port.ts, after checking that connectors.ts uses it. */
export function adapterKinds(root) {
  const port = join(root, PORT);
  const con = join(root, CONNECTORS);
  if (!existsSync(port) || !existsSync(con)) throw new Blocked(`${PORT} or ${CONNECTORS} not found`);
  if (!readFileSync(con, "utf8").includes("CONNECTOR_ADAPTER_KINDS"))
    throw new Blocked(`${CONNECTORS} does not use CONNECTOR_ADAPTER_KINDS`);
  const m = /CONNECTOR_ADAPTER_KINDS\s*=\s*\[([^\]]*)\]/.exec(readFileSync(port, "utf8"));
  if (!m) throw new Blocked(`CONNECTOR_ADAPTER_KINDS not found in ${PORT}`);
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

const code = (p) => `\`${p}\``;
const esc = (s) => s.replace(/\|/g, "\\|");

/** Generates connectors.md. Returns { text, problems } (problems: parity and existence failures). */
export function generate(root = REPO, { integrations = INTEGRATIONS, kinds = ADAPTER_KINDS } = {}) {
  const envPath = join(root, ENVIRONMENT);
  if (!existsSync(envPath)) throw new Blocked(`${ENVIRONMENT} not found`);
  const rows = residualRows(readFileSync(envPath, "utf8"));
  const envExample = existsSync(join(root, ENV_EXAMPLE)) ? readFileSync(join(root, ENV_EXAMPLE), "utf8") : "";
  const problems = [];
  const byName = new Map(integrations.map((x) => [x.match, x]));
  for (const r of rows) if (!byName.has(r.name)) problems.push(`row "${r.name}" has no mapping in connector-handover.mjs`);
  for (const x of integrations)
    if (!rows.some((r) => r.name === x.match)) problems.push(`mapping "${x.match}" has no row in ${ENVIRONMENT}`);
  const exists = (p, what) => {
    if (!existsSync(join(root, p))) problems.push(`${what} ${p} does not exist`);
  };
  for (const x of integrations) {
    for (const p of [...x.adapter, ...x.tests, ...(x.double ? [x.double] : [])]) exists(p, `"${x.match}":`);
    for (const k of x.envKeys)
      if (!new RegExp(`^${k}=`, "m").test(envExample)) problems.push(`"${x.match}": key ${k} is not in ${ENV_EXAMPLE}`);
  }
  const live = adapterKinds(root);
  for (const k of live) if (!kinds[k]) problems.push(`adapter kind ${k} of ${CONNECTORS} is not covered`);
  for (const k of Object.keys(kinds)) if (!live.includes(k)) problems.push(`adapter kind ${k} is not in ${PORT}`);
  for (const k of live) if (kinds[k]) for (const p of [kinds[k].adapter, ...kinds[k].tests]) exists(p, `adapter kind ${k}:`);

  const out = [
    "# Connector contracts, endpoints and credentials (handover)",
    "",
    "<!-- Generated by `node tools/release/connector-handover.mjs --write` from the table \"P6 residuals: live integrations not exercised in this environment\" in `docs/delivery/environment.md`, the adapter kinds of `apps/api/src/modules/integrations/connectors.ts` and `.env.example`. Do not edit by hand: `--check` fails when this file differs from a fresh generation. -->",
    "",
    "This list is for Mobily IT. For each integration it names the local adapter and its contract tests, the endpoint IT supplies, and the credential IT supplies **by name** (a `*_FILE` key or a SecretRef field). No credential value appears here or anywhere in the repository.",
    "",
    "Contract tests run against local test doubles in this environment. A passing contract test proves the adapter against its local double, not against a Mobily system.",
    "",
    "## Status against Mobily systems",
    "",
    `Every enterprise connector below has the same status: **${NOT_VERIFIED_EN}**`,
    "",
    `> ${NOT_VERIFIED_AR} (ملخص عربي مؤقت)`,
    "",
    "In the product, a connector's status reads \"Not verified\" until a test run succeeds on its current configuration (`verification` in `connectors.ts`, derived, never stored).",
    "",
    "## Integrations",
    "",
    "| Integration | Local adapter | Contract tests (local double) | Endpoint IT supplies | Credentials IT supplies (by name) | Status against Mobily systems |",
    "|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    const x = byName.get(r.name);
    if (!x) continue;
    const adapter = x.adapter.length ? x.adapter.map(code).join("<br>") : "None in this release";
    const tests = x.tests.length
      ? [...x.tests.map(code), ...(x.double ? [`double: ${code(x.double)}`] : [])].join("<br>")
      : "None (configuration only)";
    out.push(`| ${esc(r.name)} | ${adapter} | ${tests} | ${esc(x.endpoint)} | ${esc(x.credentials)} | Not verified |`);
  }
  out.push(
    "",
    "## What IT supplies, as recorded in `environment.md`",
    "",
    "Copied verbatim from the source table's \"What Mobily IT supplies\" and \"Guide\" columns, so the two documents cannot drift.",
    "",
    "| Integration | What Mobily IT supplies | Guide |",
    "|---|---|---|",
  );
  for (const r of rows) out.push(`| ${esc(r.name)} | ${r.supplies} | ${r.guide} |`);
  out.push(
    "",
    "## Connector adapter kinds",
    "",
    "The adapter kinds a connector can use (`CONNECTOR_ADAPTER_KINDS`, imported by `connectors.ts`).",
    "",
    "| Kind | Adapter | Contract tests | Note |",
    "|---|---|---|---|",
  );
  for (const k of live) {
    const d = kinds[k];
    if (!d) continue;
    out.push(`| \`${k}\` | ${code(d.adapter)} | ${d.tests.map(code).join("<br>")} | ${esc(d.note)} |`);
  }
  out.push(
    "",
    "## Secrets",
    "",
    "- A secret is supplied as a mounted file named by `<NAME>_FILE`, or as a SecretRef (`{provider, name}`) that the file provider resolves from `SECRETS_DIR` and that `SECRET_BINDINGS_FILE` binds to one setting, one organization and the hosts it may be sent to. See `docs/operations/configuration.md`.",
    "- Setting both `NAME` and `NAME_FILE` is refused at startup.",
    "",
  );
  return { text: out.join("\n"), problems, rows };
}

async function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { write: { type: "boolean" }, check: { type: "boolean" }, root: { type: "string" } },
    }));
  } catch (e) {
    console.log(`connector-handover: BLOCKED: usage: ${e.message}`);
    return 2;
  }
  if (!!values.write === !!values.check) {
    console.log("connector-handover: BLOCKED: usage: exactly one of --write or --check");
    return 2;
  }
  const root = resolve(values.root ?? REPO);
  try {
    const { text, problems } = generate(root);
    for (const p of problems) console.log(`connector-handover: connectors.md differs from environment.md: ${p}`);
    if (problems.length > 0) return 1;
    const target = join(root, OUT);
    if (values.write) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
      console.log(`connector-handover: wrote ${OUT}`);
      return 0;
    }
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (current !== text) {
      console.log(
        `connector-handover: connectors.md differs from environment.md: ${current === null ? `${OUT} is missing` : `${OUT} is not a fresh generation (run --write)`}`,
      );
      return 1;
    }
    console.log(`connector-handover: PASS: ${OUT} equals a fresh generation`);
    return 0;
  } catch (e) {
    if (!(e instanceof Blocked)) throw e;
    console.log(`connector-handover: BLOCKED: ${e.message}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main(process.argv.slice(2));
