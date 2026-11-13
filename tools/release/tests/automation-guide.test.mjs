// T-H6 (ADR-0072 §6, §8; p7-work-split §H.4, DOC-C): the job table of the automation operations guide equals the jobs
// the worker registers: every queue of DOMAIN_HANDLERS and of the platform handlers appears, and no other name does.
//   node --test tools/release/tests/check-handover.test.mjs tools/release/tests/role-matrix.test.mjs \
//     tools/release/tests/automation-guide.test.mjs
// Needs an installed workspace (the worker modules are imported with Node 24 type stripping); without one the tool
// exits 3 and these tests FAIL (never pass). Fixture files are created under $TMPDIR and removed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { BEGIN, END, GUIDE_PATH, seededSchedules, tableQueues } from "../automation-jobs.mjs";
import { TEXTS } from "../role-matrix.mjs";
import { REPO, runNode, tmp } from "./helpers.mjs";

const TOOL = join(REPO, "tools", "release", "automation-jobs.mjs");
const GUIDE = join(REPO, GUIDE_PATH);
const SUMMARY = join(REPO, "docs", "handover", "automation-operations.ar-summary.md");
const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/**
 * The platform queues worker.ts registers itself (its own work()/boss.work() calls). Pinned here, independently of the
 * tool's reading of worker.ts, so a new platform registration fails this test until the guide is regenerated.
 */
const PLATFORM_QUEUES = [
  "automation.failure_retry",
  "job_schedule.updated",
  "jobs.run_now",
  "maintenance.purge_expired",
  "transformation.created",
];

/** DOMAIN_HANDLERS' queues, imported directly from the worker in a child process (independent of the tool). */
function domainHandlerQueues() {
  const script =
    "const m = await import(process.argv[1]); process.stdout.write(JSON.stringify(m.DOMAIN_HANDLERS.map((h) => h.queue)));";
  const out = execFileSync(
    process.execPath,
    [
      "--conditions=@mth/source",
      "--input-type=module",
      "-e",
      script,
      new URL(`file://${join(REPO, "apps/worker/src/handlers/index.ts")}`).href,
    ],
    { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out);
}

/** worker.ts's own registrations of a named queue constant (the platform handlers), as written in the source. */
function workerPlatformIdentifiers() {
  const src = readFileSync(join(REPO, "apps/worker/src/worker.ts"), "utf8").replace(/\/\/[^\n]*/g, "");
  return [...src.matchAll(/(?<!\w)(?:boss\.)?work\(\s*([A-Za-z_][\w.]*)\s*,/g)]
    .map((m) => m[1])
    .filter((id) => id !== "queue" && id !== "h.queue")
    .sort();
}

const guideCopy = (text) => {
  const dir = tmp("automation-guide");
  roots.push(dir);
  const file = join(dir, "automation-operations.md");
  writeFileSync(file, text);
  return file;
};

describe("T-H6 automation job table", () => {
  const guide = readFileSync(GUIDE, "utf8");
  const listed = tableQueues(guide);

  it("--check exits 0: the generated table equals the worker registry", () => {
    const r = runNode([TOOL, "--check"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /PASS/);
  });

  it("every DOMAIN_HANDLERS queue and every platform handler appears, and no other name", () => {
    assert.ok(listed !== null, "the guide holds the generated block");
    const domain = domainHandlerQueues();
    assert.ok(domain.length > 0);
    const expected = [...new Set([...domain, ...PLATFORM_QUEUES])].sort();
    assert.deepEqual([...listed].sort(), expected);
    assert.equal(new Set(listed).size, listed.length, "no queue is listed twice");
  });

  it("the platform handlers pinned here are exactly the ones worker.ts registers", () => {
    assert.deepEqual(workerPlatformIdentifiers(), [
      "FAILURE_RETRY_QUEUE",
      "QUEUES.jobScheduleUpdated",
      "QUEUES.purge",
      "QUEUES.transformationCreated",
      "RUN_NOW_QUEUE",
    ]);
  });

  it("a guide missing a registered job, or listing a job the worker does not register, fails --check (exit 1)", () => {
    const lines = guide.split("\n");
    const without = lines.filter((l) => !l.startsWith("| `retention.archive` |")).join("\n");
    assert.notEqual(without, guide);
    const r1 = runNode([TOOL, "--check", "--guide", guideCopy(without)]);
    assert.equal(r1.code, 1, r1.stderr);
    assert.ok(!tableQueues(without).includes("retention.archive"));

    const bogus = guide.replace(END, `| \`not.registered\` | x | x | x | x | x | x |\n${END}`);
    const r2 = runNode([TOOL, "--check", "--guide", guideCopy(bogus)]);
    assert.equal(r2.code, 1, r2.stderr);
    const domain = domainHandlerQueues();
    const unregistered = tableQueues(bogus).filter((q) => !domain.includes(q) && !PLATFORM_QUEUES.includes(q));
    assert.deepEqual(unregistered, ["not.registered"]);
  });

  it("--write restores a damaged copy; a guide without the markers is BLOCKED (exit 2)", () => {
    const damaged = guideCopy(guide.replace(/\| `transfer\.export` \|[^\n]*\n/, ""));
    assert.equal(runNode([TOOL, "--write", "--guide", damaged]).code, 0);
    assert.equal(readFileSync(damaged, "utf8"), guide);
    const r = runNode([TOOL, "--check", "--guide", guideCopy(guide.replace(BEGIN, ""))]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^BLOCKED: /m);
  });

  it("without an installed workspace the tool is BLOCKED (exit 3), never a pass", () => {
    const dir = tmp("automation-noworkspace");
    roots.push(dir);
    mkdirSync(join(dir, "apps", "worker"), { recursive: true });
    cpSync(join(REPO, "apps", "worker", "src"), join(dir, "apps", "worker", "src"), { recursive: true });
    cpSync(join(REPO, "packages", "db", "migrations"), join(dir, "packages", "db", "migrations"), { recursive: true });
    const r = runNode([TOOL, "--root", dir, "--check", "--guide", guideCopy(guide)]);
    assert.equal(r.code, 3, r.stderr);
    assert.match(r.stderr, /^BLOCKED: /m);
  });

  it("each seeded schedule is shown with its cron and state; retention.archive ships disabled; transfer.export is unscheduled", () => {
    const schedules = seededSchedules(join(REPO, "packages", "db", "migrations"));
    const rowOf = (q) => guide.split("\n").find((l) => l.startsWith(`| \`${q}\` |`));
    for (const [queue, s] of schedules) {
      const row = rowOf(queue);
      assert.ok(row !== undefined, queue);
      assert.ok(row.includes(`schedule \`${s.cron}\` (${s.timezone}), ${s.enabled ? "enabled" : "**disabled**"}`), queue);
    }
    assert.equal(schedules.get("retention.archive")?.enabled, false);
    assert.match(rowOf("retention.archive"), /\*\*disabled\*\*/);
    assert.match(rowOf("retention.archive"), /`job:retention\.archive` \(`retention\.read`\)/);
    assert.equal(schedules.has("transfer.export"), false);
    assert.match(rowOf("transfer.export"), /`job:transfer\.export` \(no permission\)/);
    assert.doesNotMatch(rowOf("transfer.export"), /schedule `/);
  });

  it("the guide covers the retention job, the transfer export, the failure queue and the heartbeat", () => {
    for (const anchor of ["job-table", "schedules", "failure-queue", "exceptions", "heartbeat", "retention-job", "transfer-export"])
      assert.ok(guide.includes(`{#${anchor}}`), anchor);
    assert.match(guide, /createRetentionDryRun/);
    assert.match(guide, /ships \*\*disabled\*\*/);
    assert.match(guide, /createMigrationExport/);
    assert.match(guide, /retryAutomationFailure/);
    assert.match(guide, /runJobNow/);
    assert.match(guide, /`automation\.job_failed`/);
    assert.match(guide, /alive|stale|unknown/);
    assert.doesNotMatch(guide, /certified|compliant|approved by Mobily|production-ready/i);
  });

  it("the Arabic summary carries the provisional marker under its first heading, RTL, and the §H.3 texts", () => {
    const ar = readFileSync(SUMMARY, "utf8");
    const lines = ar.split("\n");
    assert.equal(lines[0], '<div dir="rtl" lang="ar">');
    assert.equal(lines.at(-2), "</div>");
    const h = lines.findIndex((l) => l.startsWith("# "));
    assert.equal(lines[h + 2], TEXTS.provisionalEn);
    assert.equal(lines[h + 4], TEXTS.provisionalAr);
    assert.ok(ar.includes("تلخص هذه الصفحة الدليل الإنجليزي Automation operations guide. الدليل الإنجليزي هو النص الكامل."));
    assert.ok(ar.includes("قبول هذا التسليم قرار تتخذه تقنية المعلومات في موبايلي خارج المنصة. هذه الحزمة دليل هندسي وليست ذلك القبول."));
    for (const section of ["## الغرض", "## المتطلبات المسبقة", "## ترتيب الخطوات", "## التبعيات الخارجية"])
      assert.ok(ar.includes(section), section);
    assert.ok(ar.includes("لم يُتحقق منه في هذا الإصدار. يجب أن توفره تقنية المعلومات في موبايلي وتختبره."));
  });
});
