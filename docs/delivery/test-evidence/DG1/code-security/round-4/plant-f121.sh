#!/usr/bin/env bash
# DG1 round-4: runs plant-f121.test.ts and a REAL planted module file against architecture.test.ts, in a DISPOSABLE clone
# (arg 1) only. Restores the clone afterwards.
set -uo pipefail
C="${1:?usage: plant-f121.sh <disposable clone>}"; HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$C"
echo "# clone HEAD $(git rev-parse HEAD)"
cp "$HERE/plant-f121.test.ts" apps/api/src/zz-plant-f121.test.ts
pnpm exec vitest run --project unit-node apps/api/src/zz-plant-f121.test.ts 2>&1 | grep -E "CAUGHT|MISSED|clean|FALSE|Tests |✓|×|AssertionError|expected" | head -40
echo "plant-f121.test.ts exit=${PIPESTATUS[0]}"
rm -f apps/api/src/zz-plant-f121.test.ts
mkdir -p apps/api/src/modules/access
for v in alias computed-concat; do
  case $v in
    alias) printf 'export async function x() {\n  const C = (async () => {}).constructor;\n  return C("s", "return import(s)")("../transformations/routes.ts");\n}\n' ;;
    computed-concat) printf 'export async function x() {\n  const f: any = async () => {};\n  const F = f["constr" + "uctor"];\n  return F("s", "return import(s)")("../transformations/routes.ts");\n}\n' ;;
  esac > apps/api/src/modules/access/zz-planted.ts
  echo "# planted apps/api/src/modules/access/zz-planted.ts ($v) -> architecture.test.ts must FAIL:"
  pnpm exec vitest run --project unit-node apps/api/src/architecture.test.ts 2>&1 | grep -E "zz-planted|Tests " | head -6
  echo "architecture.test.ts with $v plant: exit=${PIPESTATUS[0]}"
  rm -f apps/api/src/modules/access/zz-planted.ts
done
pnpm exec vitest run --project unit-node apps/api/src/architecture.test.ts 2>&1 | grep -E "Tests "; echo "architecture.test.ts after removing plants: exit=${PIPESTATUS[0]}"
git status --porcelain
