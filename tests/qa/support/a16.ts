// qa-verifier acceptance support for A16 "Health and launch" (DG5, T-DG5-QA-D). Setup and SOURCE parsing only: no
// assertion about an acceptance criterion lives here.
//
// Every expected text is read from the read-only playbook (docs/source/playbook.md, D-142 Q5: rendered verbatim), never
// from the product: the 25 B0150 questions, the four B0152 bands, the three B0134 windows (objective, actions and
// outputs) and the six Day-90 questions B0136-B0141. Splitting a B0134 cell at ";" and dropping its final "." is the
// fragment rule the contract states for template items (LaunchPlanTemplate: "Verbatim B0134 texts").
// All data is SYNTHETIC. A health-check score or a Day-90 answer is an assessment of test data, not an approval; no
// fixture here grants a real business, Finance or IT approval or touches the engineering gates DG0-DG7.
import { readFileSync } from "node:fs";
import path from "node:path";

export { envelopesOf } from "./a11.ts";
export { handleTransformationCreated } from "../../../apps/worker/src/handlers/platform.ts";
export { wireWorkerLaunchPlanPort } from "../../../apps/worker/src/automation/ports/launch-plan-generator.ts";

const PLAYBOOK = readFileSync(path.join(process.cwd(), "docs", "source", "playbook.md"), "utf8");

function between(start: string, end: string): string {
  const a = PLAYBOOK.indexOf(start);
  const b = PLAYBOOK.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`playbook anchors not found: ${start} .. ${end}`);
  return PLAYBOOK.slice(a, b);
}

/** B0150: the 25 questions in source order, without the checkbox and the number. */
export function b0150Questions(): string[] {
  const table = between("<!-- B0150 table -->", "Interpretation <!-- B0151");
  const found = [...table.matchAll(/☐ (\d+)\. ([^|]+?)\s*\|/g)].map((m) => [Number(m[1]), m[2]!.trim()] as const);
  return found.sort((x, y) => x[0] - y[0]).map(([, text]) => text);
}

/** B0152: [range label, interpretation] in source order (21-25, 16-20, 10-15, 0-9). */
export function b0152Bands(): Array<[string, string]> {
  const table = between("<!-- B0152 table -->", "<!-- B0153");
  return [...table.matchAll(/^\| (\d+-\d+) \| (.+?) \|$/gm)].map((m) => [m[1]!, m[2]!]);
}

export interface SourceWindow {
  readonly label: string;
  readonly objective: string;
  readonly actionsCell: string;
  readonly outputsCell: string;
  readonly actions: string[];
  readonly outputs: string[];
}

const fragments = (cell: string): string[] =>
  cell
    .replace(/\.\s*$/, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** B0134: the three windows (Days 0-30, Days 31-60, Days 61-90) with their cells and ";" fragments. */
export function b0134Windows(): SourceWindow[] {
  const table = between("<!-- B0134 table -->", "Day-90 leadership test <!-- B0135");
  return [...table.matchAll(/^\| (Days \d+-\d+) \| (.+?) \| (.+?) \| (.+?) \|$/gm)].map((m) => ({
    label: m[1]!,
    objective: m[2]!,
    actionsCell: m[3]!,
    outputsCell: m[4]!,
    actions: fragments(m[3]!),
    outputs: fragments(m[4]!),
  }));
}

/** B0136-B0141: the six Day-90 leadership questions in source order. */
export function dayNinetyQuestions(): string[] {
  const out: string[] = [];
  for (let n = 136; n <= 141; n++) {
    const anchor = `<!-- B0${n} -->`;
    const line = PLAYBOOK.split("\n").find((l) => l.endsWith(anchor));
    if (!line) throw new Error(`playbook block B0${n} not found`);
    out.push(line.slice(0, -anchor.length).trim());
  }
  return out;
}

/** A business date `n` calendar days after `date` (day d = start date + d calendar days, D-142 Q6). */
export const addDays = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Health-check question codes q01..q25 (contract HealthQuestionCode). */
export const QUESTION_CODES: readonly string[] = Array.from(
  { length: 25 },
  (_, i) => `q${String(i + 1).padStart(2, "0")}`,
);
