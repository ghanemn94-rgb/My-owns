// The three-way comparison of compare-and-reapply (T-DG6-FE-D2; ADR-0057 §7; REQ-S16-026, A14). Pure functions only,
// shared by the record forms (RecordForm.tsx), useVersionedSave.ts and the inline cell editor.
//  - B is the record as the user loaded it (kept with its version), M the user's edited values, C the current record
//    from a fresh GET after the 409.
//  - "My changes" are the fields where M ≠ B; "their changes" the fields where C ≠ B; a field in both is a conflict,
//    unless both sides arrived at the same value ("agreed": nothing to send, nothing to choose).
//  - Reapply sends only my changes, each conflict resolved by the user (mine → sent; theirs → not sent), with If-Match
//    of C's version. A field only they changed is never sent, so the first change stays intact.
// No new endpoint: every PATCH already answers 409 with `currentVersion` (ADR-0007).

/** One side's values, by field key. A missing key and `null` are the same: no value (Unknown), never 0. */
export type FieldValues = Readonly<Record<string, unknown>>;

export type Resolution = "mine" | "theirs";

export interface ThreeWayResult {
  /** Fields only the user changed: sent on reapply. */
  readonly mine: readonly string[];
  /** Fields only the other user changed: never sent, so their change stays. */
  readonly theirs: readonly string[];
  /** Fields both changed to different values: the user chooses mine or theirs for each. */
  readonly conflicts: readonly string[];
  /** Fields both changed to the same value: nothing to send. */
  readonly agreed: readonly string[];
}

/** Value equality on the JSON form (decimals stay strings; `undefined` and `null` both mean "no value"). */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Groups `keys` (in their order) by who changed them between B, M and C. */
export function threeWay(
  keys: readonly string[],
  base: FieldValues,
  mine: FieldValues,
  current: FieldValues,
  same: (a: unknown, b: unknown) => boolean = sameValue,
): ThreeWayResult {
  const out = { mine: [] as string[], theirs: [] as string[], conflicts: [] as string[], agreed: [] as string[] };
  for (const k of keys) {
    const iChanged = !same(mine[k], base[k]);
    const theyChanged = !same(current[k], base[k]);
    if (iChanged && theyChanged) (same(mine[k], current[k]) ? out.agreed : out.conflicts).push(k);
    else if (iChanged) out.mine.push(k);
    else if (theyChanged) out.theirs.push(k);
  }
  return out;
}

/** True when every conflict has a choice (reapply is offered only then). */
export function allResolved(result: ThreeWayResult, resolutions: Readonly<Record<string, Resolution>>): boolean {
  return result.conflicts.every((k) => resolutions[k] === "mine" || resolutions[k] === "theirs");
}

/**
 * The field keys a reapply sends: my changes, plus each conflict resolved as "mine". A conflict resolved as "theirs"
 * and every field only they changed are left out. Returns null while a conflict has no choice.
 */
export function reapplyKeys(
  result: ThreeWayResult,
  resolutions: Readonly<Record<string, Resolution>>,
): string[] | null {
  if (!allResolved(result, resolutions)) return null;
  return [...result.mine, ...result.conflicts.filter((k) => resolutions[k] === "mine")];
}

/** The values the form shows after a reapply: C, with the sent fields taken from M. */
export function mergedValues(
  current: FieldValues,
  mine: FieldValues,
  sent: readonly string[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const k of sent) merged[k] = mine[k];
  return merged;
}
