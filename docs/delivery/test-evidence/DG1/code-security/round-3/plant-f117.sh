#!/usr/bin/env bash
# Runs plant-f117.test.ts in a DISPOSABLE clone (arg 1), never the candidate tree. The round-2 lint (commit 18c1e61,
# the round-2 freeze) is placed next to the current one as architecture.testkit.round2.ts for the fail-before cases.
set -uo pipefail
C="${1:?usage: plant-f117.sh <disposable clone>}"; HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$C"
git show 18c1e61:apps/api/src/architecture.testkit.ts > apps/api/src/architecture.testkit.round2.ts
cp "$HERE/plant-f117.test.ts" apps/api/src/zz-plant-f117.test.ts
echo "# clone HEAD $(git rev-parse HEAD); current lint = candidate apps/api/src/architecture.testkit.ts; round-2 lint = 18c1e61"
pnpm exec vitest run --project unit-node apps/api/src/zz-plant-f117.test.ts 2>&1
rc=$?
echo "# planted architecture.test.ts (candidate suite) with a real planted module file - must FAIL:"
mkdir -p apps/api/src/modules/access
printf 'export async function x() {\n  const m = (process as any)["get" + "BuiltinModule"]("module");\n  return m;\n}\n' > apps/api/src/modules/access/zz-planted.ts
pnpm exec vitest run --project unit-node apps/api/src/architecture.test.ts 2>&1 | grep -E "zz-planted|Tests |FAIL|✓|×" | head -12
echo "architecture.test.ts with plant: exit=${PIPESTATUS[0]}"
rm -f apps/api/src/modules/access/zz-planted.ts apps/api/src/zz-plant-f117.test.ts apps/api/src/architecture.testkit.round2.ts
pnpm exec vitest run --project unit-node apps/api/src/architecture.test.ts 2>&1 | grep -E "Tests " ; echo "architecture.test.ts after removing plant: exit=${PIPESTATUS[0]}"
git status --porcelain
exit $rc
