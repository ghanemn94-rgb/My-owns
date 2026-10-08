#!/usr/bin/env bash
# qa-verifier DG3 round 7: static negative probe (regression of the round-6 T-DG3-KBE-H probe, forms unchanged) (throwaway, probe clone only).
# Appends forms to an engine file, runs ESLint on that file and the fuzz.test.ts source scan, then restores the file.
set -u
C="$1"; cd "$C" || exit 2
FORMS_R6=$(cat <<'TS'
// QA PROBE (throwaway, round 6): the self-handling forms named by T-DG3-KBE-H, in qa-verifier's own spellings.
declare const qaGen: () => number;
declare const qaP: { then(f: () => void): typeof qaP; catch(f: () => void): typeof qaP; finally(f: () => void): typeof qaP };
export function* qaG1(): Generator<number> { try { yield qaGen(); } finally { yield 0; } }
export const qaG2 = { *m(): Generator<number> { yield 1; } };
export class QaG3 { *m(): Generator<number> { yield 1; } }
export const qaG4 = function* (): Generator<number> { yield* [1]; };
export function qaG5(): number { const it = (function* () { try { yield qaGen(); } finally { return; } })(); it.next(); it.return(undefined); return 0; }
export function qaT1(p: typeof qaP): void { const { then: t } = p; void t; }
export const qaT2 = { "finally": 1 };
export const qaT3 = `then`;
export class QaT4 { #then = 1; get v(): number { return this.#then; } }
export const qaT5 = { then(r: (v: number) => void): void { r(qaGen()); } };
export const qaT6 = { catch: 1 };
export function qaA1(): unknown { return (Array as unknown as { fromAsync(x: unknown): unknown }).fromAsync([qaGen()]); }
export const qaA2 = { [Symbol.asyncIterator](): typeof qaP { return qaP; } };
export const qaA3 = (Array as unknown as Record<string, unknown>)["fromAsync"];
TS
)
FORMS_R5=$(cat <<'TS'
// Round-5 forms (regression; byte-identical to the round-5 probe):
export function qaW1(): number { try { return qaGen(); } catch { return 0; } }
export function qaW2(): number { try { return qaGen(); } finally { return 0; } }
export function qaW4(): void { void Promise.resolve().then(() => qaGen()).catch(() => undefined); }
export function qaW5(): number { try { return qaGen(); } catch (e) { throw new Error("wrapped", { cause: e }); } }
export function qaR1(): number { try { return qaGen(); } catch (err) { if (err instanceof EvalError) throw err; return 0; } }
export function qaR2(): number { try { return qaGen(); } catch (e) { if (e instanceof EvalError) throw e; else return 0; } }
export function qaR3(): number { try { return qaGen(); } catch (e) { const z = 1; if (e instanceof EvalError) throw e; return z; } }
export function qaR4(): number { try { return qaGen(); } catch (e) { if (e instanceof TypeError) throw e; return 0; } }
export function qaR5(): number { for (;;) { try { return qaGen(); } finally { break; } } return 0; }
export function qaR6(): number { try { return qaGen(); } finally { throw new RangeError("x"); } }
export const qaR7 = (): void => { const EvalError = RangeError; void EvalError; };
export async function qaR8(): Promise<number> { return await Promise.resolve(qaGen()); }
export function qaR9(): void { queueMicrotask(() => { qaGen(); }); }
export function qaR10(): void { qaP["then"](() => undefined); qaP?.catch(() => undefined); qaP.finally(() => undefined); }
export const qaR11 = async (): Promise<void> => {};
export function qaR12(): number { try { return qaGen(); } catch (e) { if (e instanceof EvalError) { throw e; } return 0; } }
export function qaR13(): number { try { return qaGen(); } catch (e) { if (!(e instanceof EvalError)) return 0; throw e; } }
TS
)
OK=$(cat <<'TS'
// Allowed shapes (must NOT be reported): the documented rethrow, and a plain try/finally with no control transfer.
export function qaOK(): number { try { return qaGen(); } catch (e) { if (e instanceof EvalError) throw e; return 0; } }
export function qaOK2(): number { let n = 0; try { n = qaGen(); } finally { n += 0; } return n; }
TS
)
probe() { # file label forms
  local f="$1" label="$2" forms="$3"
  cp "$f" "$TMPDIR/qa/orig.bak"
  printf '%s\n%s\n' "$forms" "$OK" >> "$f"
  echo "=================== [$label] forms appended to $f (probe clone, throwaway):"
  git --no-pager diff -- "$f"
  echo "\$ npx eslint $f"; npx eslint "$f" 2>&1 | grep -v "npm warn"; echo "EXIT ${PIPESTATUS[0]}"
  echo "\$ npx vitest run --project unit-node packages/shared/src/formula/fuzz.test.ts -t 'source scan'"
  npx vitest run --project unit-node packages/shared/src/formula/fuzz.test.ts -t 'source scan' 2>&1 | grep -v "npm warn" | grep -vE "^\s+✓ .*flags " ; echo "EXIT ${PIPESTATUS[0]}"
  cp "$TMPDIR/qa/orig.bak" "$f"
  echo "restored: git status --porcelain = '$(git status --porcelain)'"
}
for f in packages/shared/src/formula/parse.ts packages/shared/src/value.ts; do
  probe "$f" "R6 new forms" "$FORMS_R6"
  probe "$f" "R5 regression forms" "$(printf '%s\n%s' "declare const qaGen: () => number;
declare const qaP: { then(f: () => void): typeof qaP; catch(f: () => void): typeof qaP; finally(f: () => void): typeof qaP };" "$FORMS_R5")"
done
echo "=================== after restore"
echo "\$ npx eslint packages/shared/src/formula packages/shared/src/value.ts"; npx eslint packages/shared/src/formula packages/shared/src/value.ts 2>&1 | grep -v "npm warn"; echo "EXIT ${PIPESTATUS[0]}"
echo "git status --porcelain = '$(git status --porcelain)'"
