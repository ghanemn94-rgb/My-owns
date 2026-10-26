#!/usr/bin/env bash
# code-security-reviewer, DG5 corrected clean re-gate, round 2 (T-DG5-RG2-SEC-R2): static scans of the candidate, run in
# the disposable working copy $TMPDIR/rv (freeze commit 7a02e7d = source 660f40c + delivery records) after pnpm -r build.
# Usage: scans.sh <step>   Each step writes one log in the evidence directory that ends with "exit=<status>".
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG5/code-security/round-2
cd "$TMPDIR/rv" || exit 2
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
BASE=e70ac02f63cd1f42487cfa4dae73f68e933da015
SRC=660f40c7d141b6fb73c145e0ee7a053ceb5905de
R1=2fe8f853e54ef7ab7b88527f11633c0c3542edd6
hdr() { echo "# $1  $(date -u +%FT%TZ)  node=$(node -v)  commit=$(git rev-parse HEAD)"; }
case "$1" in
  outbox)
    { hdr "40 outbox registry cross-check"; echo "\$ node $E/repro/outbox-registry.mjs"; node "$E/repro/outbox-registry.mjs"; echo "exit=$?"; } >"$E/40-outbox-registry.log" 2>&1
    ;;
  contract)
    {
      hdr "42 contract: p5-pending lists, operation count, consumes, media-type pin"
      echo "\$ find apps packages tests -name 'p5-pending-*.ts' -not -path '*/node_modules/*' | wc -l"
      find apps packages tests -name 'p5-pending-*.ts' -not -path '*/node_modules/*' | wc -l
      echo "\$ non-empty arrays in p5-pending-*.ts (an element after '[' that is not ']' ; expect none)"
      for f in $(find apps packages tests -name 'p5-pending-*.ts' -not -path '*/node_modules/*'); do
        node -e '
          const s=require("fs").readFileSync(process.argv[1],"utf8").replace(/\/\/.*$/gm,"").replace(/\/\*[\s\S]*?\*\//g,"");
          const arrs=[...s.matchAll(/export const (\w+)[^=]*=\s*(\[[\s\S]*?\])\s*(?:as const)?\s*;/g)];
          if(arrs.length===0){console.log("NO-EXPORTED-ARRAY "+process.argv[1]);process.exit(0)}
          for(const a of arrs){const inner=a[2].slice(1,-1).trim(); if(inner.length>0) console.log("NON-EMPTY "+process.argv[1]+" "+a[1]+" "+inner.slice(0,120)); else console.log("empty "+process.argv[1]+" "+a[1]);}
        ' "$f"
      done
      echo "\$ grep -c 'operationId:' docs/api/openapi.yaml"
      grep -c 'operationId:' docs/api/openapi.yaml
      echo "\$ P5_PENDING_TESTS_BE_O"
      grep -rn "P5_PENDING_TESTS_BE_O" apps packages tests --include=*.ts | grep -v node_modules | head
      echo "\$ non-JSON consumes declarations in the API modules"
      grep -rn 'consumes:' apps/api/src --include=*.ts | grep -v '\.test\.ts' | grep -v 'JSON_BODY\|application/json' | head -20
      echo "\$ the media-type pin (consumes enforcement) in the platform"
      grep -rn "consumes" apps/api/src/modules/platform/*.ts | grep -v test | head -12
    } >"$E/42-contract-pending.log" 2>&1
    echo "exit=0" >>"$E/42-contract-pending.log"
    ;;
  graph)
    {
      hdr "43 module graph"
      echo "\$ reporting imports workflows or admin (expect none)"
      grep -rnE "from ['\"](\.\./)+(workflows|admin)/" apps/api/src/modules/reporting --include=*.ts; echo "grep exit=$? (1 = none)"
      echo "\$ worker imports API code (expect none)"
      grep -rnE "from ['\"][^'\"]*apps/api|from ['\"]@mth/api" apps/worker/src --include=*.ts; echo "grep exit=$? (1 = none)"
      echo "\$ WorkflowsReadPort wiring"
      grep -rn 'WorkflowsReadPort' apps/api/src --include=*.ts | grep -v test | head
      echo "\$ import cycles among apps/api/src/modules/* (module-level graph, relative imports, non-test files)"
      node -e '
        const fs=require("fs"),path=require("path");const root="apps/api/src/modules";
        const mods=fs.readdirSync(root).filter(d=>fs.statSync(path.join(root,d)).isDirectory());
        const g=new Map(mods.map(m=>[m,new Set()]));
        const walk=d=>fs.readdirSync(d).flatMap(n=>{const p=path.join(d,n);return fs.statSync(p).isDirectory()?walk(p):(/\.ts$/.test(n)&&!/\.test\.ts$/.test(n)?[p]:[])});
        for(const m of mods)for(const f of walk(path.join(root,m))){const s=fs.readFileSync(f,"utf8");for(const x of s.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+["\x27](\.[^"\x27]+)["\x27]/gm)){const t=path.resolve(path.dirname(f),x[1]);const rel=path.relative(path.resolve(root),t).split(path.sep)[0];if(mods.includes(rel)&&rel!==m)g.get(m).add(rel)}}
        const seen=new Map();const cyc=[];const st=[];
        const dfs=v=>{seen.set(v,1);st.push(v);for(const w of g.get(v)){if(seen.get(w)===1)cyc.push([...st.slice(st.indexOf(w)),w].join(" -> "));else if(!seen.has(w))dfs(w)}st.pop();seen.set(v,2)};
        for(const m of mods)if(!seen.has(m))dfs(m);
        console.log("modules="+mods.length+" value-import edges="+[...g.values()].reduce((a,s)=>a+s.size,0));
        console.log("reporting -> "+[...g.get("reporting")].sort().join(","));
        console.log(cyc.length===0?"no module-level value-import cycle":"CYCLES:\n"+cyc.join("\n"));
      '
      echo "\$ web: lazy routes and no cycle (madge not installed; the router is read instead)"
      grep -c "lazyPage(" apps/web/src/app/router.tsx; echo "\$ eager page imports in the router (expect none)"; grep -nE "^import .* from \"\.\./pages/" apps/web/src/app/router.tsx; echo "grep exit=$? (1 = none)"
    } >"$E/43-module-graph.log" 2>&1
    echo "exit=0" >>"$E/43-module-graph.log"
    ;;
  locks)
    {
      hdr "44 exactly-once backstops and the advisory-lock registry"
      echo "\$ unique backstops in the P5 migrations"
      grep -nE 'UNIQUE|CREATE UNIQUE INDEX' packages/db/migrations/00{62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97}*.sql 2>/dev/null | grep -iE 'execution|starter|cutoff|cut_off|day|health|export|reminder|idempot|digest|dry_run|reissue|launch|reset|trigger_key|dedupe|effect|failure'
      echo "\$ the P5 lock classes (730250+) in advisory-locks.ts"
      grep -nE '7302[5-9][0-9]' apps/api/src/modules/platform/advisory-locks.ts
      echo "\$ duplicate lock class numbers across the API and worker registries (expect none within one registry)"
      for f in apps/api/src/modules/platform/advisory-locks.ts $(grep -rl "730250\|730264" apps/worker/src --include=*.ts | grep -v test); do echo "-- $f"; grep -oE ':\s*7[0-9]{5}' "$f" | tr -d ': ' | sort | uniq -d; done
      echo "\$ the migrations directory: ids 0062-0097 present, forward-only (no gap other than the retired ids pinned by seed.test.ts)"
      ls packages/db/migrations | grep -E '^00(6[2-9]|[7-9][0-9])_' | cut -c1-4 | tr '\n' ' '; echo
    } >"$E/44-exactly-once-backstops.log" 2>&1
    echo "exit=0" >>"$E/44-exactly-once-backstops.log"
    ;;
  committime)
    {
      hdr "47 commit-time authorization: static scan of every P5-touched API file that registers a write route"
      echo "# Flags a file that registers app.post/put/patch/delete but names no commit-time helper itself; each flag is then traced by hand in the review record."
      for f in $(git diff --name-only $BASE..$SRC -- apps/api/src | grep '\.ts$' | grep -v '\.test\.ts$'); do
        [ -f "$f" ] || continue
        grep -qE 'app\.(post|put|patch|delete)\(' "$f" || continue
        if grep -qE 'atCommit|refreshPrincipal|requireWriteAtCommit|openWrite\(|requireStudioWrite|openLaunchWrite|requireMigrationWrite|reloadPrincipal|commitPrincipal' "$f"; then echo "ok   $f"; else echo "FLAG $f"; fi
      done
    } >"$E/47-commit-time-scan.log" 2>&1
    echo "exit=0" >>"$E/47-commit-time-scan.log"
    ;;
  secrets)
    {
      hdr "49 secrets and public URLs in the P5 diff"
      echo "\$ credential-shaped assignments added by the P5 diff (expect none)"
      git diff $BASE..$SRC -- apps packages deploy e2e tests scripts ':!**/*.lock' ':!pnpm-lock.yaml' | grep '^+' | grep -inE '(api[_-]?key|secret|passw(or)?d|token|private[_-]?key|BEGIN [A-Z ]*PRIVATE KEY|aws_access|xox[bp]-|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,})\s*[:=]\s*['"'"'"][^'"'"'"]{8,}' | grep -viE 'csrf|example|synthetic|placeholder|test|fixture|redact'; echo "grep exit=$? (1 = none)"
      echo "\$ key/cert/env files added (expect none)"
      git diff --name-only $BASE..$SRC | grep -iE '\.(pem|key|p12|pfx|env)$|id_rsa'; echo "grep exit=$? (1 = none)"
      echo "\$ external URLs added in product code (outside spec/XML namespaces; expect none that is fetched at runtime)"
      git diff $BASE..$SRC -- apps packages ':!**/THIRD_PARTY_NOTICES.md' | grep '^+' | grep -nE 'https?://' | grep -vE 'localhost|127\.0\.0\.1|example\.(invalid|com|org)|w3\.org|openxmlformats|purl\.org|schemas\.microsoft|ietf\.org|json-schema\.org|mozilla\.org|apache\.org|github\.com/[^ ]*licen|xml\.org|unicode\.org|opensource\.org' | head -20
      echo "\$ the round-1 -> round-2 delta adds no dependency (package.json / lockfile unchanged)"
      git diff --stat $R1..$SRC -- '**/package.json' pnpm-lock.yaml; echo "(empty = unchanged)"
    } >"$E/49-secrets-scan.log" 2>&1
    echo "exit=0" >>"$E/49-secrets-scan.log"
    ;;
esac
