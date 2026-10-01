#!/usr/bin/env bash
set -u
cd "$TMPDIR/review-qa" || exit 2
echo "# clone @ $(git rev-parse HEAD); node $(node -v); $(date -u +%FT%TZ)"
echo "## e2e files covered by tsconfig.e2e.json (tsc --listFilesOnly, project files only)"
(cd apps/web && npx tsc -p tsconfig.e2e.json --listFilesOnly | grep -v node_modules)
echo "## control: pnpm --filter @mth/web typecheck"
pnpm --filter "./apps/web" typecheck >/dev/null 2>&1; echo "control exit=$? (0 expected)"
F=$(ls apps/web/e2e/*.spec.ts | head -1)
echo "## mutation 1: append a type error to $F"
printf '\nconst __qaTypeError: number = "not a number";\nvoid __qaTypeError;\n' >> "$F"
pnpm --filter "./apps/web" typecheck 2>&1 | grep -E "error TS|ERR" | head -3; echo "mutation1 exit=${PIPESTATUS[0]} (non-zero expected)"
git checkout -q -- "$F"
echo "## mutation 2: type error in root playwright.config.ts"
printf '\nconst __qaTypeError2: string = 42;\nvoid __qaTypeError2;\n' >> playwright.config.ts
pnpm --filter "./apps/web" typecheck 2>&1 | grep -E "error TS|ERR" | head -3; echo "mutation2 exit=${PIPESTATUS[0]} (non-zero expected)"
git checkout -q -- playwright.config.ts
echo "## mutation 3: same error via the root entry point pnpm -r typecheck (spec file)"
printf '\nconst __qaTypeError3: number = "x";\nvoid __qaTypeError3;\n' >> "$F"
pnpm -r typecheck 2>&1 | grep -E "error TS" | head -2; echo "mutation3 pnpm -r typecheck exit=${PIPESTATUS[0]} (non-zero expected)"
git checkout -q -- "$F"
echo "## restored; git status (expect clean):"; git status --short
pnpm -r typecheck >/dev/null 2>&1; echo "restored pnpm -r typecheck exit=$? (0 expected)"
echo "## informational: QA root e2e/** specs are outside tsconfig.e2e.json scope; ad-hoc tsc check of them"
npx tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2023 --lib ES2023,DOM,DOM.Iterable --types node --skipLibCheck e2e/*.ts e2e/support/*.ts 2>&1 | tail -5; echo "adhoc root-e2e tsc exit=${PIPESTATUS[0]} (informational)"
