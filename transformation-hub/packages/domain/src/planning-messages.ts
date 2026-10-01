import { formatMessage, serverMessage, type ServerMessage } from './messages';

/**
 * Planning server messages (QA-P2-04, REQ-UX-001/002): the measurement, health, schedule and My Work explanations that the
 * API computes are returned as codes + parameters next to the English sentence (`<field>I18n`). The English sentence is
 * rendered from exactly these templates; the web translates each code with `planning.messages.<code>` (en + ar), checked
 * by apps/web/scripts/check-i18n.mjs. Every code starts with `plan.` (the web routes `plan.*` codes to the planning
 * catalogue). Parameters are numbers, record codes, dates (YYYY-MM-DD) or enum values — never English prose, except a
 * user's own override reason.
 */
export const PLANNING_MESSAGES_EN: Readonly<Record<string, string>> = {
  // Calculated RAG (measurement rules 4–5) and aggregation (rule 3)
  'plan.rag.open_blocker': 'An open blocker is recorded.',
  'plan.rag.not_updated': 'No accepted update has been recorded.',
  'plan.rag.stale': 'Last accepted update is {age} days old (stale after {limit}).',
  'plan.rag.unknown': 'Baseline or forecast finish is missing.',
  'plan.rag.green': 'Forecast within tolerance (slip {slip} working days).',
  'plan.rag.amber': 'Forecast slip of {slip} working days (amber ≤ {limit}).',
  'plan.rag.red': 'Forecast slip of {slip} working days exceeds {limit}.',
  // The threshold set a calculated RAG used (REQ-PLN-019)
  'plan.rag.thresholds_approved': 'Thresholds: project version {version} (approved).',
  'plan.rag.thresholds_template_default': 'Thresholds: proposed default of template version {templateVersion} (no project version approved).',
  // The rule of each calculated status under a threshold set (spec §9 rule 4, project configuration screen)
  'plan.rag.rule.green': 'Green: forecast slip of at most {green} working days, an accepted update within the last {stale} days and no open blocker.',
  'plan.rag.rule.amber': 'Amber: forecast slip above {green} and at most {amber} working days.',
  'plan.rag.rule.red': 'Red: forecast slip above {amber} working days, or any open blocker.',
  'plan.rag.rule.stale': 'Data stale: no accepted update within the last {stale} days — never shown as green.',
  'plan.rag.rule.unknown': 'Unknown: the baseline or forecast finish is missing — never shown as green.',
  'plan.rag.rule.not_updated': 'Not updated: no accepted update recorded yet — never shown as green.',
  'plan.rag.aggregate_empty': 'No items to aggregate.',
  'plan.rag.aggregate': 'Worst-of {count} item(s): {status}. {red} critical red, {gaps} with data-quality gaps.',
  // Manual overrides (rule 6, DOM-P2-10)
  'plan.rag.override': 'Manual override ({reason}) until {until}; calculated: {calculated}.',
  'plan.rag.override_capped':
    'Manual override to {status} is not applied while {count} red critical item(s) (open blocker / critical milestone) exist — an override cannot conceal them; calculated: {calculated}.',
  // Weighted progress (rules 1–2)
  'plan.progress.none': 'No weighted deliverables in scope — progress cannot be calculated.',
  'plan.progress.basis': '{num} of {den} weight points accepted across {count} deliverable(s); {excluded} excluded.',
  'plan.progress.excluded_cancelled': 'Cancelled',
  'plan.progress.excluded': 'Excluded',
  'plan.progress.no_approved_weight': 'No approved weight',
  'plan.progress.deliverable_cancelled': 'Cancelled — excluded from the denominator, not counted as complete',
  'plan.progress.weight_not_approved': 'Weight not approved',
  // Workstream and project data quality (Health tab)
  'plan.dq.baselined_undated': '{count} baselined item(s) have no planned finish',
  'plan.dq.no_baseline': 'No approved baseline',
  'plan.dq.no_lead': 'No accountable workstream lead',
  'plan.dq.tasks_no_owner': '{count} active task(s) without an accountable owner',
  'plan.dq.tasks_no_duration': '{count} active task(s) without a duration',
  'plan.dq.tasks_undated': '{count} active task(s) without planned/forecast finish',
  'plan.dq.weights_unapproved': '{count} deliverable weight(s) not approved',
  'plan.dq.project_no_baseline': 'No approved baseline — variance cannot be measured',
  'plan.dq.schedule_incomplete': 'Schedule incomplete: {count} issue(s)',
  'plan.dq.schedule_invalid': 'Schedule invalid: {count} issue(s)',
  // The first schedule gap, as an example (activity codes only — titles are data shown on the Timeline tab)
  'plan.dq.example.missing_duration': '(e.g. activity {node} has no duration)',
  'plan.dq.example.negative_duration': '(e.g. activity {node} has an invalid duration)',
  'plan.dq.example.unsupported_dependency_type': '(e.g. a dependency of {node} uses a type the schedule engine does not support yet)',
  'plan.dq.example.unknown_node': '(e.g. a dependency references an unknown activity)',
  'plan.dq.example.cycle': '(e.g. dependencies contain a cycle)',
  'plan.dq.example.invalid_date': '(e.g. the project start date is invalid)',
  'plan.dq.example.missing_project_start': '(e.g. the project has no planned start date)',
  // Red critical items
  'plan.red.override_not_hiding': '(manual override to {status} does not hide the blocker)',
  'plan.red.milestone_missed': 'Critical milestone missed',
  'plan.red.milestone_overdue': 'Critical milestone overdue (planned {date})',
  // Schedule assumptions (engine, then service)
  'plan.assumption.calendar': 'Durations are in working days on the project calendar ({timezone}, working days {days}, {holidays} holiday(s)).',
  'plan.assumption.fs_only': 'Only Finish-to-Start dependencies with working-day lag are used.',
  'plan.assumption.no_predecessor_start': 'Activities without predecessors start at the project start or their start-no-earlier-than date.',
  'plan.assumption.not_probability': 'Results are schedule-based forecasts derived from the plan, not probabilities.',
  'plan.assumption.delay_applied': 'Delay applied as +{days} working day(s) to the duration (and any owner forecast finish) of {node}.',
  'plan.assumption.planned_start_snet': 'Planned start dates act as start-no-earlier-than constraints.',
  'plan.assumption.forecast_extends': 'Owner-entered forecast finish dates can only extend an activity; actual dates replace plan dates.',
  'plan.assumption.cancelled_ignored': 'Cancelled activities and their links are ignored.',
  'plan.assumption.milestones_zero': 'Milestones have zero duration.',
  'plan.assumption.draft_one': '1 activity is still Draft (proposed, not yet confirmed into the plan) and included as proposed.',
  'plan.assumption.drafts': '{count} activities are still Draft (proposed, not yet confirmed into the plan) and included as proposed.',
  'plan.assumption.driving_network': 'Scope: the selected activity and every activity that drives it (transitive predecessors) — other activities are not shown.',
  'plan.assumption.deterministic': 'Deterministic: the same plan, calendar and inputs always give the same result. No probability is estimated.',
  // Template effort estimates ("Assumed: N person-days" / "TBD")
  'plan.effort.tbd': 'TBD',
  'plan.effort.assumed_person_days': 'Assumed: {days} person-days',
  // My Work titles composed by the server
  'plan.work.status_update_workstream': '{workstream} update — period ending {date}',
  'plan.work.status_update_project': 'Project update — period ending {date}',
  'plan.work.rag_override_workstream': 'RAG override to {status} (calculated {calculated}) — {workstream}',
  'plan.work.rag_override_project': 'RAG override to {status} (calculated {calculated}) — Project',
  'plan.work.baseline': 'Baseline version {version} awaiting approval',
};

/** A planning message (the code must have an English template — a missing one is a programming error). */
export function planMessage(code: string, params: Record<string, string | number> = {}): ServerMessage {
  if (PLANNING_MESSAGES_EN[code] === undefined) throw new Error(`No English template for message code ${code}`);
  return serverMessage(code, params);
}

/** English rendering of planning messages (joined with a space, like `renderMessagesEn`). */
export function planningEn(messages: readonly ServerMessage[]): string {
  return messages.map((m) => formatMessage(PLANNING_MESSAGES_EN[m.code]!, m.params)).join(' ');
}

/** English text + codes of one planning message: `{ text, i18n }`. */
export function planText(code: string, params: Record<string, string | number> = {}): { text: string; i18n: ServerMessage[] } {
  const i18n = [planMessage(code, params)];
  return { text: planningEn(i18n), i18n };
}

/**
 * Template effort estimates are structured English strings ("Assumed: 6 person-days", "TBD"). Recognised forms are
 * returned as a message the client translates; anything else (text a planner typed) returns null and is shown as entered.
 */
export function effortMessages(effort: string | null | undefined): ServerMessage[] | null {
  const s = effort?.trim();
  if (!s) return null;
  if (s === 'TBD') return [planMessage('plan.effort.tbd')];
  const m = /^Assumed: (\d{1,4}) person-days$/.exec(s);
  return m ? [planMessage('plan.effort.assumed_person_days', { days: Number(m[1]) })] : null;
}
