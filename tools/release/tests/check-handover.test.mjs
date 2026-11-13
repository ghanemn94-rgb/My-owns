// T-H1, T-H2, T-H4, T-H7, T-H8, T-H9, T-I14 (ADR-0072 §8, ADR-0071 T-I14; p7-work-split §H.4, DOC-B), with T-B14 of
// ADR-0069 inside T-H2, and the T-H5 checker logic on fixtures (DOC-A runs T-H5 on the real guides).
//   node --test tools/release/tests/check-handover.test.mjs tools/release/tests/role-matrix.test.mjs \
//     tools/release/tests/automation-guide.test.mjs
// Fixture roots are created under $TMPDIR and removed; nothing is written to the repository. With
// MTH_STRICT_HANDOVER=1 (the freeze), the full check on the real tree must exit 0: no BLOCKED is accepted.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { APPROVED_SPEC, manifestFromWorkingTree } from "../../gates/lib/candidate.mjs";
import {
  checkDeployment,
  checkGenerated,
  checkGuides,
  checkIndex,
  checkSecurityLinks,
  checkSummaries,
  DEPLOYMENT_ANCHORS,
  exitCodeOf,
  filesUnder,
  ITEMS,
  matchesRoute,
  PENDING,
  routePatterns,
  TEXTS,
} from "../check-handover.mjs";
import * as KL from "../known-limitations.mjs";
import { REPO, runNode, tmp } from "./helpers.mjs";

const TOOL = join(REPO, "tools", "release", "check-handover.mjs");
const KL_TOOL = join(REPO, "tools", "release", "known-limitations.mjs");
const REPORT = join(REPO, "docs/delivery/handbacks/DG7/T-DG7-DO-I-evidence/protocol-audit-all.json");
const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A fixture root: copies of docs/handover, .env.example, compose.yaml, the router files and a register stub. */
function fixtureRoot() {
  const dir = tmp("handover");
  roots.push(dir);
  cpSync(join(REPO, "docs/handover"), join(dir, "docs/handover"), { recursive: true });
  for (const p of [".env.example", "deploy/compose/compose.yaml", "apps/web/src/app/router.tsx", "apps/web/src/app/nav.ts"]) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    cpSync(join(REPO, p), join(dir, p));
  }
  mkdirSync(join(dir, "docs/delivery"), { recursive: true });
  writeFileSync(join(dir, "docs/delivery/requirements.csv"), "req_id\n");
  return dir;
}
const put = (root, p, text) => {
  mkdirSync(dirname(join(root, p)), { recursive: true });
  writeFileSync(join(root, p), text);
};
const get = (root, p) => readFileSync(join(root, p), "utf8");
const edit = (root, p, from, to) => {
  const s = get(root, p);
  assert.ok(s.includes(from), `fixture edit: '${from.slice(0, 40)}' not in ${p}`);
  writeFileSync(join(root, p), s.replace(from, to));
};
/** Writes the pending files, so that the index has no BLOCKED part. */
const addPending = (root) => {
  put(root, "docs/handover/release-notes.md", "# Release notes (fixture)\n");
  put(root, "docs/handover/guides/user/en/x.md", "# x\n");
  put(root, "docs/handover/guides/admin/en/x.md", "# x\n");
};
const onlyPending = (r) =>
  r.blocks.every((m) => PENDING.some((p) => m.includes(p)) || m.includes("guide-keys.json") || m.includes("no guides yet"));

// --------------------------------------------------------------------------------------------------------- T-H1 --

describe("T-H1: the handover index", () => {
  it("on the real tree: no FAIL; anything BLOCKED is a file written later in this release", () => {
    const r = checkIndex(REPO);
    assert.deepEqual(r.fails, []);
    assert.ok(onlyPending(r), r.blocks.join("; "));
  });

  it("maps each of the seven REQ-S19-015 items, and has the security-controls.md line (D-247 O3)", () => {
    const md = get(REPO, "docs/handover/README.md");
    for (const item of ITEMS) assert.ok(md.includes(`| ${item} |`), item);
    assert.ok(md.includes("[security-controls.md](security-controls.md)"));
    assert.ok(md.includes("`archive:evidence/`"));
    assert.ok(md.includes("(../delivery/requirements.csv)"));
  });

  it("passes on a fixture once the pending files exist", () => {
    const root = fixtureRoot();
    addPending(root);
    const r = checkIndex(root);
    assert.equal(r.status, "PASS", [...r.fails, ...r.blocks].join("; "));
  });

  it("fails for a file the index does not list", () => {
    const root = fixtureRoot();
    addPending(root);
    put(root, "docs/handover/unlisted.md", "# not indexed\n");
    const r = checkIndex(root);
    assert.equal(r.status, "FAIL");
    assert.ok(r.fails.some((m) => m.includes("unlisted.md is not in the index")));
  });

  it("fails for an index line whose file does not exist", () => {
    const root = fixtureRoot();
    addPending(root);
    rmSync(join(root, "docs/handover/upgrades.md"));
    assert.ok(checkIndex(root).fails.some((m) => m.includes("upgrades.md, which does not exist")));
  });

  it("fails without the security-controls.md line, and for an unmapped item", () => {
    const root = fixtureRoot();
    addPending(root);
    const md = get(root, "docs/handover/README.md");
    writeFileSync(
      join(root, "docs/handover/README.md"),
      md.replace(/^\| \[security-controls\.md\].*\n/m, "").replace(/^\| Role matrix \|.*\n/m, ""),
    );
    const r = checkIndex(root);
    assert.ok(r.fails.some((m) => m.includes("security-controls.md line")));
    assert.ok(r.fails.some((m) => m.includes("security-controls.md is not in the index")));
    assert.ok(r.fails.some((m) => m.includes("'Role matrix' is not mapped")));
  });

  it("reports a missing release-notes.md as BLOCKED, never as a pass", () => {
    const root = fixtureRoot();
    put(root, "docs/handover/guides/user/en/x.md", "# x\n");
    put(root, "docs/handover/guides/admin/en/x.md", "# x\n");
    const r = checkIndex(root);
    assert.equal(r.status, "BLOCKED");
    assert.ok(r.blocks.some((m) => m.includes("release-notes.md")));
  });

  it("refuses an unknown archive path", () => {
    const root = fixtureRoot();
    addPending(root);
    edit(root, "docs/handover/README.md", "`archive:evidence/`", "`archive:elsewhere/`");
    assert.ok(checkIndex(root).fails.some((m) => m.includes("unknown archive path 'elsewhere/'")));
  });
});

// --------------------------------------------------------------------------------------------- T-H2 and T-B14 --

describe("T-H2 and T-B14: the deployment guide", () => {
  it("on the real tree: no FAIL; only guide-keys.json may be BLOCKED (DO-D has not written it yet)", () => {
    const r = checkDeployment(REPO);
    assert.deepEqual(r.fails, []);
    for (const m of r.blocks) assert.match(m, /guide-keys\.json/);
    if (existsSync(join(REPO, "deploy/scripts/drill/guide-keys.json"))) assert.equal(r.status, "PASS");
  });

  it("holds the seven anchors, the B.5 texts, the redirect URI, the service map and the orchestration target", () => {
    const md = get(REPO, "docs/handover/deployment.md");
    for (const a of DEPLOYMENT_ANCHORS) assert.ok(md.includes(`{#${a}}`), a);
    const flat = md.replace(/\s*\n\s*/g, " ");
    for (const t of [TEXTS.haEn, TEXTS.subPathEn, TEXTS.originEn, TEXTS.readinessEn, TEXTS.orchestrationEn, TEXTS.idpEn])
      assert.ok(flat.includes(t), t);
    assert.ok(md.includes("{#compose-service-roles}") && md.includes("{#orchestration-target}"));
    assert.ok(md.includes("<origin>/api/v1/auth/callback"));
  });

  for (const a of DEPLOYMENT_ANCHORS) {
    it(`fails when the section #${a} is missing`, () => {
      const root = fixtureRoot();
      edit(root, "docs/handover/deployment.md", `{#${a}}`, "{#renamed}");
      assert.ok(checkDeployment(root).fails.some((m) => m.includes(`{#${a}}`)));
    });
  }

  it("fails for an empty section and for a section that names no source", () => {
    const root = fixtureRoot();
    const md = get(root, "docs/handover/deployment.md");
    const start = md.indexOf("## 6. Logging {#logging}");
    const end = md.indexOf("## 7. Monitoring");
    writeFileSync(join(root, "docs/handover/deployment.md"), `${md.slice(0, start)}## 6. Logging {#logging}\n\n${md.slice(end)}`);
    assert.ok(checkDeployment(root).fails.some((m) => m.includes("#logging is empty")));
    writeFileSync(
      join(root, "docs/handover/deployment.md"),
      `${md.slice(0, start)}## 6. Logging {#logging}\n\nLogs are written.\n\n${md.slice(end)}`,
    );
    assert.ok(checkDeployment(root).fails.some((m) => m.includes("#logging names no source")));
  });

  it("fails without the HA statement or the sub-path text", () => {
    const root = fixtureRoot();
    const md = get(root, "docs/handover/deployment.md");
    writeFileSync(join(root, "docs/handover/deployment.md"), md.replaceAll("high-availability readiness", "HA").replaceAll("sub-path (for example", "path (for example"));
    const r = checkDeployment(root);
    assert.ok(r.fails.some((m) => m.includes("HA statement")));
    assert.ok(r.fails.some((m) => m.includes("sub-path")));
  });

  it("fails for a template key the guide does not index, and for a Compose service the map does not name", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, ".env.example"), `${get(root, ".env.example")}\n# fixture\nNEW_FIXTURE_KEY=\n`);
    edit(root, "deploy/compose/compose.yaml", "\n  worker:\n", "\n  worker:\n    x: 1\n  fixture-extra:\n");
    const r = checkDeployment(root);
    assert.ok(r.fails.some((m) => m.includes("NEW_FIXTURE_KEY")));
    assert.ok(r.fails.some((m) => m.includes("'fixture-extra'")));
  });

  it("checks every anchor guide-keys.json cites: present → PASS, absent → FAIL", () => {
    const root = fixtureRoot();
    put(root, "deploy/scripts/drill/guide-keys.json", JSON.stringify({ APP_BASE_URL: "domains-and-tls", PORT: "deployment.md#network-boundaries" }));
    assert.equal(checkDeployment(root).status, "PASS");
    put(root, "deploy/scripts/drill/guide-keys.json", JSON.stringify({ APP_BASE_URL: "no-such-anchor" }));
    assert.ok(checkDeployment(root).fails.some((m) => m.includes("'no-such-anchor'")));
  });

  it("indexes every .env.example key with an existing anchor", () => {
    const keys = [...get(REPO, ".env.example").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    assert.ok(keys.length >= 30);
    const md = get(REPO, "docs/handover/deployment.md");
    for (const k of keys) assert.ok(md.includes(`| \`${k}\` |`), k);
  });
});

// --------------------------------------------------------------------------------------------------------- T-H4 --

describe("T-H4: known limitations", () => {
  it("known-limitations.mjs --check exits 0 on the tree with the DO-I report", () => {
    const r = runNode([KL_TOOL, "--protocol-audit", REPORT, "--check"], { cwd: REPO });
    assert.equal(r.code, 0, r.stderr);
  });

  it("names every carried row id of p7-plan §1.4 and every P7 ADR (ADR-0062 to ADR-0073)", () => {
    const md = get(REPO, "docs/handover/known-limitations.md");
    for (const id of ["REQ-S16-007", "REQ-DLV-038", "REQ-S10-002", "REQ-S16-030", "REQ-S17-001", "REQ-S17-009", "REQ-S20-029", "REQ-S20-030"])
      assert.ok(md.includes(`| ${id} |`), id);
    assert.match(md, /\(a\).*\(b\).*\(c\).*Sweep limits/s);
    for (let n = 62; n <= 73; n++) assert.ok(md.includes(`| ADR-00${n} |`), `ADR-00${n}`);
    for (const d of ["D-253", "D-254", "D-255", "D-256"]) assert.ok(md.includes(`| ${d} |`), d);
  });

  it("the protocol-audit block equals the one generated from the report, with the D-249 statement", () => {
    const bytes = readFileSync(REPORT);
    const block = KL.renderProtocolAudit(KL.parseProtocolAudit(bytes), bytes);
    const md = get(REPO, "docs/handover/known-limitations.md");
    assert.ok(md.includes(`${KL.beginOf("protocol-audit")}\n${block}\n${KL.endOf("protocol-audit")}`));
    assert.ok(block.includes(KL.TEXTS.disclosureEn));
    assert.ok(block.includes("F-DG6-952"));
    for (const h of ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10", "H11"]) assert.match(block, new RegExp(`D-249 [H0-9, ]*\\b${h}\\b`), h);
  });

  it("a changed report fails --check (exit 1)", () => {
    const dir = tmp("kl-report");
    roots.push(dir);
    const r = JSON.parse(readFileSync(REPORT, "utf8"));
    r.checks.find((c) => c.status === "HIT").hits.pop();
    writeFileSync(join(dir, "report.json"), JSON.stringify(r));
    const res = runNode([KL_TOOL, "--protocol-audit", join(dir, "report.json"), "--check"], { cwd: REPO });
    assert.equal(res.code, 1, res.stderr);
    assert.match(res.stderr, /FAIL/);
  });

  it("--write on a fixture copy regenerates a hand-damaged block, and --check then passes", () => {
    const root = fixtureRoot();
    mkdirSync(join(root, "docs/delivery"), { recursive: true });
    cpSync(join(REPO, "docs/delivery/environment.md"), join(root, "docs/delivery/environment.md"));
    for (const f of KL_PROVISIONAL_SOURCES) put(root, f, get(REPO, f));
    edit(root, "docs/handover/known-limitations.md", "| `corporate-idp` |", "| `edited-by-hand` |");
    const args = ["--root", root, "--protocol-audit", REPORT];
    assert.equal(runNode([KL_TOOL, ...args, "--check"]).code, 1);
    assert.equal(runNode([KL_TOOL, ...args, "--write"]).code, 0);
    assert.equal(runNode([KL_TOOL, ...args, "--check"]).code, 0);
    assert.equal(get(root, "docs/handover/known-limitations.md"), get(REPO, "docs/handover/known-limitations.md"));
  });

  it("refuses an environment table row it does not know, or a known row that is missing (exit 2)", () => {
    const env = get(REPO, "docs/delivery/environment.md");
    const rows = KL.parseEnvironmentTable(env);
    assert.equal(rows.length, KL.ENV_ROWS.length);
    assert.throws(() => KL.buildDependencies([...rows, { ...rows[0], name: "New integration" }]), /no mapping/);
    assert.throws(() => KL.buildDependencies(rows.slice(1)), /is missing/);
    const root = fixtureRoot();
    put(root, "docs/delivery/environment.md", env.replace("| **SMTP relay**", "| **Mail relay**"));
    const res = runNode([KL_TOOL, "--root", root, "--protocol-audit", REPORT, "--check"]);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /BLOCKED: .*Mail relay/);
  });

  it("refuses a report that is not a protocol-audit report, and runs without one only as BLOCKED", () => {
    const dir = tmp("kl-bad");
    roots.push(dir);
    writeFileSync(join(dir, "r.json"), JSON.stringify({ tool: "other" }));
    assert.equal(runNode([KL_TOOL, "--protocol-audit", join(dir, "r.json"), "--check"], { cwd: REPO }).code, 2);
    const none = runNode([KL_TOOL, "--check"], { cwd: REPO });
    assert.equal(none.code, 2);
    assert.match(none.stderr, /BLOCKED: --protocol-audit/);
    const g = checkGenerated(REPO, undefined);
    assert.equal(g.status === "FAIL" ? "FAIL" : "not FAIL", "not FAIL");
    assert.ok(g.blocks.some((m) => m.includes("no --protocol-audit")));
  });

  it("external-dependencies.json is the contract's ExternalDependency array, and the guide block lists the same keys", async () => {
    const { parseDependencies } = await import("../../../apps/api/scripts/register-snapshot.mjs");
    const text = get(REPO, "docs/handover/external-dependencies.json");
    const deps = parseDependencies(text);
    const keys = deps.map((d) => d.key);
    for (const k of ["corporate-idp", "object-store", "smtp-relay", "enterprise-messaging", "corporate-data-source", "ai-endpoint", "package-registry", "live-ci", "orchestration-target"])
      assert.ok(keys.includes(k), k);
    const md = get(REPO, "docs/handover/known-limitations.md");
    for (const k of keys) assert.ok(md.includes(`| \`${k}\` |`), k);
    assert.ok(md.includes(KL.TEXTS.notVerifiedEn));
    assert.ok(md.includes(KL.TEXTS.idpEn));
  });

  it("arabic-review.json ships empty, and the provisional block lists every Arabic handover file", () => {
    assert.deepEqual(JSON.parse(get(REPO, "docs/handover/arabic-review.json")), []);
    const md = get(REPO, "docs/handover/known-limitations.md");
    for (const f of KL.arabicHandoverFiles(REPO)) assert.ok(md.includes(`- \`${f}\``), f);
    assert.ok(KL.arabicHandoverFiles(REPO).includes("docs/handover/deployment.ar-summary.md"));
  });
});

/** The provisional-Arabic label files known-limitations.mjs counts (copied into fixtures). */
const KL_PROVISIONAL_SOURCES = [
  "apps/web/src/i18n/provisional-ar-p6.ts",
  "apps/web/src/i18n/provisional-ar-p7-release.ts",
  "apps/web/src/i18n/provisional-ar-p7-transfer.ts",
  "apps/web/src/i18n/provisional-ar-p7.ts",
  "apps/web/src/components/assistant/provisional-ar.ts",
  "apps/web/src/components/compare/provisional-ar.ts",
  "apps/web/src/components/saved-views/provisional-ar.ts",
  "apps/web/src/pages/integrations/provisional-ar.ts",
  "apps/web/src/pages/my-work/provisional-ar.ts",
];

// --------------------------------------------------------------------------------------------------------- T-H7 --

describe("T-H7: Arabic summaries of the IT and operator documents", () => {
  it("on the real tree: PASS", () => {
    const r = checkSummaries(REPO);
    assert.equal(r.status, "PASS", [...r.fails, ...r.blocks].join("; "));
  });

  it("fails without the provisional line under the first heading", () => {
    const root = fixtureRoot();
    edit(root, "docs/handover/deployment.ar-summary.md", `${TEXTS.provisionalEn}\n`, "");
    assert.ok(checkSummaries(root).fails.some((m) => m.includes("deployment.ar-summary.md lacks the provisional line")));
  });

  it("does not require the line for a file arabic-review.json lists", () => {
    const root = fixtureRoot();
    edit(root, "docs/handover/deployment.ar-summary.md", `${TEXTS.provisionalEn}\n`, "");
    put(root, "docs/handover/arabic-review.json", JSON.stringify([{ path: "docs/handover/deployment.ar-summary.md", reviewer: "fixture reviewer", date: "2026-11-13" }]));
    assert.equal(checkSummaries(root).status, "PASS");
  });

  it("fails for a missing summary page, a missing section, or an operator summary without the upgrade guide", () => {
    const root = fixtureRoot();
    rmSync(join(root, "docs/handover/known-limitations.ar-summary.md"));
    edit(root, "docs/handover/operator-guide.ar-summary.md", "(upgrades.md)", "(elsewhere.md)");
    edit(root, "docs/handover/deployment.ar-summary.md", "## الغرض", "## غرض آخر");
    const r = checkSummaries(root);
    assert.ok(r.fails.some((m) => m.includes("known-limitations.ar-summary.md (its Arabic summary) does not exist")));
    assert.ok(r.fails.some((m) => m.includes("does not summarize and link upgrades.md")));
    assert.ok(r.fails.some((m) => m.includes("lacks the section '## الغرض'")));
  });

  it("fails when an Arabic B.5 text of the deployment summary is not verbatim", () => {
    const root = fixtureRoot();
    edit(root, "docs/handover/deployment.ar-summary.md", TEXTS.readinessAr, "نص آخر.");
    assert.ok(checkSummaries(root).fails.some((m) => m.includes("Arabic readiness text")));
  });
});

// --------------------------------------------------------------------------------------------------------- T-H8 --

describe("T-H8: security-controls guide links (D-247 O5)", () => {
  it("HR-01, HR-02, HR-04 and HR-06 link existing deployment.md anchors, and HR-04 the backup guide", () => {
    const r = checkSecurityLinks(REPO);
    assert.equal(r.status, "PASS", r.fails.join("; "));
  });

  it("fails for a link to a missing anchor, and for HR-04 without the backup guide", () => {
    const root = fixtureRoot();
    edit(root, "docs/handover/security-controls.md", "(deployment.md#secrets)", "(deployment.md#vault)");
    edit(root, "docs/handover/security-controls.md", "; [backup guide](backup-restore.md)", "");
    const r = checkSecurityLinks(root);
    assert.ok(r.fails.some((m) => m.includes("HR-06: deployment.md#vault does not exist")));
    assert.ok(r.fails.some((m) => m.includes("HR-04: no backup-restore.md link")));
  });

  it("DO-B's matrix test (T-G7) still passes", () => {
    const r = runNode(["--test", join(REPO, "tools/release/tests/security-controls.test.mjs")], { cwd: REPO });
    assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  });
});

// ------------------------------------------------------------------------------------------- T-H9 and T-I14 --

describe("T-H9 and T-I14: scans over the handover, and the candidate manifest", () => {
  it("the secret scan over docs/handover reports nothing", () => {
    const r = runNode([join(REPO, "tools/release/secret-scan.mjs"), "--path", join(REPO, "docs/handover")], { cwd: REPO });
    assert.equal(r.code, 0, r.stdout + r.stderr);
  });

  it("the claims scan (docs/handover/** in its scope) reports nothing", () => {
    const r = runNode([join(REPO, "tools/release/claims-scan.mjs")], { cwd: REPO });
    assert.equal(r.code, 0, r.stdout + r.stderr);
  });

  it("every file under docs/handover/ is in the candidate manifest, so the payload scan covers it (T-I14)", () => {
    const paths = new Set(manifestFromWorkingTree(REPO, APPROVED_SPEC).map((e) => e.path));
    const files = filesUnder(join(REPO, "docs/handover"));
    assert.ok(files.length >= 20);
    for (const f of files) assert.ok(paths.has(`docs/handover/${f}`), f);
  });
});

// ------------------------------------------------------------------------------------- T-H5 checker logic --

describe("T-H5 checker logic (DOC-A runs it on the real guides)", () => {
  const guidePair = (root, kind, name, en, ar) => {
    put(root, `docs/handover/guides/${kind}/en/${name}`, en);
    put(root, `docs/handover/guides/${kind}/ar/${name}`, ar);
  };
  const EN = "# Sign in\n\n## Open the hub {#open}\n\nGo to `/my-work`, then `/admin/retention`.\n";
  const AR = `<div dir="rtl" lang="ar">\n\n# تسجيل الدخول\n\n${TEXTS.provisionalEn}\n\n${TEXTS.provisionalAr}\n\n## فتح المنصة {#open}\n\nانتقل إلى \`/my-work\`.\n\n</div>\n`;

  it("no guides yet → BLOCKED (exit 2), never a pass", () => {
    if (!existsSync(join(REPO, "docs/handover/guides"))) assert.equal(checkGuides(REPO).status, "BLOCKED");
    const root = fixtureRoot();
    const r = checkGuides(root);
    assert.equal(r.status, "BLOCKED");
    assert.match(r.blocks[0], /no guides yet/);
    assert.equal(runNode([TOOL, "--root", root, "--only", "guides"]).code, 2);
  });

  it("matching en/ar pairs with known screen paths pass", () => {
    const root = fixtureRoot();
    for (const kind of ["user", "admin"]) guidePair(root, kind, "sign-in.md", EN, AR);
    const r = checkGuides(root);
    assert.equal(r.status, "PASS", [...r.fails, ...r.blocks].join("; "));
  });

  it("fails for a missing ar file, a heading or anchor mismatch, a missing marker and an unknown screen path", () => {
    const root = fixtureRoot();
    guidePair(root, "user", "sign-in.md", `${EN}\n## Extra {#extra}\n\nSee \`/no/such/screen\`.\n`, AR.replace(`${TEXTS.provisionalEn}\n`, ""));
    put(root, "docs/handover/guides/user/en/only-en.md", "# x\n");
    guidePair(root, "admin", "sign-in.md", EN, AR);
    const r = checkGuides(root);
    assert.ok(r.fails.some((m) => m.includes("guides/user/ar/only-en.md is missing")));
    assert.ok(r.fails.some((m) => m.includes("'##' headings")));
    assert.ok(r.fails.some((m) => m.includes("anchor sets differ")));
    assert.ok(r.fails.some((m) => m.includes("lacks the provisional line")));
    assert.ok(r.fails.some((m) => m.includes("/no/such/screen")));
  });

  it("route matching: parameters match one segment; API paths are not screens", () => {
    const patterns = routePatterns(REPO);
    assert.ok(matchesRoute("/admin/retention/runs/:retentionRunId", patterns));
    assert.ok(matchesRoute("/transformations/<id>/kpis", patterns));
    assert.ok(!matchesRoute("/admin/no-such-screen", patterns));
  });
});

// -------------------------------------------------------------------------------------------- exit codes --

describe("check-handover exit codes", () => {
  it("FAIL wins over BLOCKED, BLOCKED over PASS", () => {
    const res = (s) => ({ status: s });
    assert.equal(exitCodeOf([res("PASS"), res("BLOCKED"), res("FAIL")]), 1);
    assert.equal(exitCodeOf([res("PASS"), res("BLOCKED")]), 2);
    assert.equal(exitCodeOf([res("PASS")]), 0);
  });

  it("a usage error is BLOCKED (exit 2)", () => {
    assert.equal(runNode([TOOL, "--only", "nonsense"]).code, 2);
    assert.equal(runNode([TOOL, "--bogus"]).code, 2);
  });

  it("the full check on the real tree never FAILs; with MTH_STRICT_HANDOVER=1 (the freeze) it must PASS", () => {
    const r = runNode([TOOL, "--protocol-audit", REPORT], { cwd: REPO });
    if (process.env.MTH_STRICT_HANDOVER === "1") assert.equal(r.code, 0, r.stdout + r.stderr);
    else assert.notEqual(r.code, 1, r.stdout + r.stderr);
    if (r.code === 2) assert.match(r.stderr, /BLOCKED/);
  });
});
