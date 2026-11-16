// qa-verifier (T-DG7-QA-E): the inputs of the A18 transfer drill harness (tests/qa/integration/a18-transfer-drill.test.ts).
//
// Project rule (CLAUDE.md, p7-work-split §2 rule 4): a check whose inputs are missing is BLOCKED, never passed, and a
// BLOCKED check is not a product failure either. So the harness has three outcomes:
//   absent  - none of QA_A18_ARCHIVE, QA_A18_ARCHIVE_SHA256, QA_A18_STORE is set (the default `pnpm test:integration`
//             run, which has no DO-A archive or offline store). The drill tests are SKIPPED with an explicit
//             "BLOCKED:" reason that names the missing inputs. They are never reported as passed.
//   invalid - at least one input is set, but the set is incomplete or wrong (a path that does not exist or is the wrong
//             kind, a checksum that is not 64 lowercase hex digits), or QA_A18_REQUIRE=1 is set without the inputs.
//             The drill tests FAIL hard, naming each problem.
//   ready   - all three are set and well formed. The drill runs; a drill that rejects them (for example a checksum
//             that does not match the archive) fails the tests, as before (QA-C's run with inputs is unchanged).
// QA_A18_REQUIRE=1 lets a gate or evidence run demand the drill: with it, absent inputs fail instead of skipping.
import { statSync } from "node:fs";

export const A18_INPUT_KEYS = ["QA_A18_ARCHIVE", "QA_A18_ARCHIVE_SHA256", "QA_A18_STORE"] as const;
export type A18InputKey = (typeof A18_INPUT_KEYS)[number];

export interface A18Inputs {
  archive: string;
  archiveSha256: string;
  store: string;
}

export type A18InputState =
  | { kind: "absent"; reason: string }
  | { kind: "invalid"; problems: string[]; message: string }
  | { kind: "ready"; inputs: A18Inputs };

/** What a path is on disk; injectable so the unit test needs no files. */
export type PathKind = (path: string) => "file" | "directory" | "other" | "missing";

export const pathKindOnDisk: PathKind = (path) => {
  try {
    const s = statSync(path);
    return s.isFile() ? "file" : s.isDirectory() ? "directory" : "other";
  } catch {
    return "missing";
  }
};

const WHAT = "the DO-A release archive, its SHA-256 and the offline pnpm store";

export function classifyA18Inputs(
  env: Readonly<Record<string, string | undefined>>,
  kindOf: PathKind = pathKindOnDisk,
): A18InputState {
  const value = (k: A18InputKey): string => (env[k] ?? "").trim();
  const unset = A18_INPUT_KEYS.filter((k) => value(k) === "");
  const required = (env["QA_A18_REQUIRE"] ?? "").trim() === "1";

  if (unset.length === A18_INPUT_KEYS.length && !required)
    return {
      kind: "absent",
      reason: `BLOCKED: A18 transfer drill not run: input missing: ${unset.join(", ")} (${WHAT}); skipped, not passed`,
    };

  const problems: string[] = [];
  if (unset.length > 0)
    problems.push(`${unset.join(", ")} not set${required ? " (QA_A18_REQUIRE=1)" : " while other A18 inputs are"}`);
  const archive = value("QA_A18_ARCHIVE");
  const archiveSha256 = value("QA_A18_ARCHIVE_SHA256");
  const store = value("QA_A18_STORE");
  if (archive !== "" && kindOf(archive) !== "file")
    problems.push(`QA_A18_ARCHIVE is not an existing file: ${archive} (${kindOf(archive)})`);
  if (archiveSha256 !== "" && !/^[0-9a-f]{64}$/.test(archiveSha256))
    problems.push("QA_A18_ARCHIVE_SHA256 is not 64 lowercase hex digits");
  if (store !== "" && kindOf(store) !== "directory")
    problems.push(`QA_A18_STORE is not an existing directory: ${store} (${kindOf(store)})`);

  if (problems.length > 0)
    return { kind: "invalid", problems, message: `A18 input invalid: ${problems.join("; ")} (${WHAT})` };
  return { kind: "ready", inputs: { archive, archiveSha256, store } };
}
