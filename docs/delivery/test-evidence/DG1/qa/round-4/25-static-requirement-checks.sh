#!/usr/bin/env bash
# qa-verifier DG1 round 3: static requirement checks on a disposable clone (argument 1, must be built: pnpm -r build).
set -u
C="${1:?usage: $0 <disposable-clone>}"; cd "$C" || exit 2
echo "# static requirement checks; clone @ $(git rev-parse HEAD); $(date -u +%FT%TZ)"
echo "## REQ-S15-006: image/logo assets tracked (excluding trading_agent/, docs/delivery/test-evidence/)"
git ls-files | grep -vE '^(trading_agent/|docs/delivery/test-evidence/)' | grep -iE '\.(png|jpe?g|gif|svg|ico|webp)$' ; echo "(end of list)"
echo "## REQ-S15-006: files named *logo* / *mobily*"
git ls-files | grep -vE '^(trading_agent/|docs/delivery/)' | grep -iE 'logo|mobily'; echo "(end)"
echo "## REQ-S15-006: Wordmark component is text (no <img>/<svg>) and labelled provisional"
W=$(git ls-files apps/web/src | grep -i wordmark | grep -vi test); echo "files: $W"
echo "img/svg matches: $(cat $W | grep -cE '<img|<svg')"
grep -n -iE 'provisional' $W | head -5
echo "## REQ-S15-002: seeded token values (expect the seven exact values, provenance provisional)"
node -e '
const t=require("./packages/design-tokens/src/tokens.json");
const want={"brand.primary":"#0078FF","brand.deep":"#003B73","surface.page":"#F5F8FC","surface.card":"#FFFFFF","text.primary":"#142438","text.secondary":"#526174","border.default":"#DCE5EF"};
const flat={};(function walk(o,p){for(const[k,v]of Object.entries(o)){const q=p?p+"."+k:k;if(v&&typeof v==="object"&&!("value"in v)&&!("$value"in v))walk(v,q);else flat[q]=v;}})(t,"");
let bad=0;for(const[k,v]of Object.entries(want)){const e=JSON.stringify((t.color||{})[k]??null);const ok=e.toUpperCase().includes(v.toUpperCase());if(!ok)bad++;console.log((ok?"OK  ":"BAD ")+k+" "+v+" :: "+e.slice(0,160));}
console.log("provisional mentions in tokens.json: "+(JSON.stringify(t).match(/provisional/gi)||[]).length);
process.exitCode=bad?1:0;'; echo "exit=$?"
echo "## REQ-S15-002: positive claims of official/certified Mobily brand compliance in web locale strings (expect none; only negations)"
grep -rn -iE 'official|certified|verified' apps/web/src/i18n/*/*.json | head -10
echo "## REQ-S15-005: fonts bundled locally, no font CDN"
grep -n '@fontsource' apps/web/package.json
echo "woff2 files in built bundle: $(ls apps/web/dist/assets 2>/dev/null | grep -c '\.woff2$')"
echo "font CDN references in source/dist: $(grep -rIlE 'fonts\.googleapis|fonts\.gstatic|use\.typekit|cdnjs|jsdelivr|unpkg' apps/web/src apps/web/dist apps/web/index.html 2>/dev/null | wc -l)"
echo "licence inventory mentions: $(grep -rIl -iE 'ibm-plex|IBM Plex' docs/ --include=*.md --include=*.csv --include=*.json | grep -vE 'delivery/(reviews|test-evidence|runs)' | head -5 | tr '\n' ' ')"
grep -rIn -iE 'OFL|SIL Open Font' $(grep -rIl -iE 'ibm-plex|IBM Plex' docs/ --include=*.md | grep -vE 'delivery/' | head -3) 2>/dev/null | head -3
echo "## REQ-S16-001: API and worker are two processes of one codebase; ADR-0002 module boundaries"
ls -d apps/api apps/worker; grep -n '"start"\|"main"' apps/api/package.json apps/worker/package.json
head -5 docs/architecture/adr/ADR-0002-modular-monolith-boundaries.md
echo "## REQ-S16-002: TypeScript + React frontend, strict mode, ADR-0009"
grep -n '"react"\|"typescript"' apps/web/package.json package.json | head
node -e 'const c=require("./apps/web/tsconfig.json");console.log("web tsconfig strict:",JSON.stringify(c.compilerOptions&&c.compilerOptions.strict),"extends:",c.extends||"-")'
grep -rn '"strict"' packages/config/tsconfig*.json tsconfig*.json 2>/dev/null | head -3
echo "## REQ-S16-003: explicit API modules (identity/access, transformations, workflows, formulas/kpi, reporting, admin), each with index + tests"
for m in apps/api/src/modules/*/; do printf '%-40s index:%s tests:%s\n' "$m" "$(ls $m | grep -cE '^index\.ts$')" "$(find $m -name '*.test.ts' | wc -l)"; done
grep -n -iE 'formula' docs/architecture/adr/ADR-0002-modular-monolith-boundaries.md | head -3
echo "## REQ-S16-004: persistence only in PostgreSQL via migrations (no other DB drivers / local file stores in apps)"
ls packages/db/migrations 2>/dev/null || git ls-files | grep -E 'migrations/.*\.sql$'
echo "other DB drivers in package.json files: $(git ls-files '*package.json' | grep -v trading_agent | xargs grep -lE '"(sqlite3|better-sqlite3|mysql2?|mongodb|mongoose|redis|ioredis|level)"' | wc -l)"
echo "## REQ-S19-006: OpenAPI versioned, auth described"
grep -nE '^openapi:|^  version:' docs/api/openapi.yaml; sed -n '/securitySchemes:/,/^[a-z]/p' docs/api/openapi.yaml | head -12
echo "## REQ-S19-004: ERD + data dictionary present"
ls docs/architecture/erd.md docs/architecture/data-dictionary.md
