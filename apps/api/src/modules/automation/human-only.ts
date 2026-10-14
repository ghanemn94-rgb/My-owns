// The human-only boundary (REQ-S12-026, M0242; ADR-0043 §2, §9; T-DG5-BE-H). "Human business judgment, investment
// decisions, gate approvals and Finance attestations remain accountable human actions within the platform."
//
// A rule version naming a human-only action is refused with 422 `automation_rule.human_only_action` BEFORE anything is
// read for update or written: this check runs on the parsed request body, first among the content checks. The database
// refuses it again (trigger `automation_rule_version_human_only`, AV01; `automation_action_result_human_only`, AX05).
// The list is the 0074 catalogue's `human_only` rows; `automation-rules.test.ts` pins that the two agree.
import { HUMAN_ONLY_ACTION_CODES } from "@mth/shared/schemas";
import { problems, type HttpProblem } from "../platform/index.ts";

const HUMAN_ONLY: ReadonlySet<string> = new Set(HUMAN_ONLY_ACTION_CODES);

export const HUMAN_ONLY_DETAIL =
  "Approvals, investment decisions and Finance attestations are human decisions and cannot be automated.";

export const humanOnlyRefusal = (): HttpProblem =>
  problems.businessRule("automation_rule.human_only_action", HUMAN_ONLY_DETAIL);

/** True when `code` is one of the six human-only action codes. */
export function isHumanOnlyAction(code: string): boolean {
  return HUMAN_ONLY.has(code);
}

/** Throws 422 `automation_rule.human_only_action` when any action of the content is a human decision. */
export function refuseHumanOnlyActions(actions: readonly { readonly type: string }[] | undefined): void {
  if (actions?.some((a) => HUMAN_ONLY.has(a.type))) throw humanOnlyRefusal();
}
