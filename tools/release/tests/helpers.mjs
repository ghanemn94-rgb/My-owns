// Shared helpers of the tools/release tests (ADR-0062 §9). Everything is created under $TMPDIR and removed by the
// caller; nothing is written to the repository.
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..", "..");
export const FIXTURES = join(HERE, "fixtures");
export const DEMO_FIXTURE = join(FIXTURES, "demo-data");

export const tmp = (prefix) => mkdtempSync(join(process.env.TMPDIR || tmpdir(), `mth-${prefix}-`));

const git = (dir, args) =>
  execFileSync("git", ["-C", dir, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    },
  })
    .toString()
    .trim();

/**
 * A git repository made from fixtures/archive/repo plus the run-time paths a candidate must exclude (delivery metadata,
 * trading_agent/) and an optional extra hook. Returns { dir, commit }.
 */
export function fixtureRepo({ extra } = {}) {
  const dir = tmp("archive-repo");
  cpSync(join(FIXTURES, "archive", "repo"), dir, { recursive: true });
  chmodSync(join(dir, "scripts", "run.sh"), 0o755);
  const put = (p, text) => {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  };
  put("docs/delivery/reviews/DG7/round-1/qa.json", "{}\n"); // META_EXCLUDES: never in source/
  put("docs/delivery/findings.json", "[]\n");
  put("trading_agent/notes.txt", "a separate project, excluded by the approved spec\n");
  put("tools/release/build-from-archive.sh", "#!/bin/sh\n");
  if (extra) extra({ dir, put, git: (args) => git(dir, args) });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture"]);
  return { dir, commit: git(dir, ["rev-parse", "HEAD"]) };
}

/** Runs a node script; returns { code, stdout, stderr } without throwing. */
export function runNode(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], ...opts }).toString();
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? -1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}
