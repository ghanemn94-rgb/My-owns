#!/bin/bash
# F-DG1-109 re-test (code-security-reviewer DG1 r2). Plants a NON-exported loader construct into the kpi scaffold of a
# DISPOSABLE clone, runs architecture.test.ts + kpi.test.ts, restores the file. Verdict is taken from the dependency-lint
# test itself ("every import respects dependsOn ..."), not from unrelated assertions; the lint's own message is shown.
cd "$1"; F=apps/api/src/modules/kpi/index.ts
plant(){ name="$1"; code="$2"; git checkout -q -- $F; printf '\n%s\n' "$code" >> $F
  out=$(npx vitest run --project unit-node apps/api/src/architecture.test.ts apps/api/src/modules/kpi/kpi.test.ts 2>&1); rc=$?
  msg=$(printf '%s' "$out" | grep -oE '"modules/kpi/index.ts: [^"]+"' | head -1)
  if printf '%s' "$out" | grep -q "× API module boundaries (ADR-0002) > every import respects"; then echo "CAUGHT  rc=$rc  $name  -> $msg"
  else echo "MISSED  rc=$rc  $name  (other failures: $(printf '%s' "$out" | grep -cE '^ +×'))"; fi; }
plant "control (no plant)" "// nothing"
plant "createRequire from node:module" 'import { createRequire } from "node:module"; const _r = () => createRequire(import.meta.url)("../admin/routes.ts"); void _r;'
plant "computed import()" 'const _p = "../admin/" + "routes.ts"; const _m = () => import(_p); void _m;'
plant "template import() with substitution" 'const _x = "routes"; const _m2 = () => import(`../admin/${_x}.ts`); void _m2;'
plant "literal deep import of a non-dependency" 'const _m3 = () => import("../admin/routes.ts"); void _m3;'
plant "process.getBuiltinModule + computed member" 'const _m4 = () => (process.getBuiltinModule("node:module") as any)["create" + "Require"](import.meta.url)("../admin/routes.ts"); void _m4;'
plant "new Function dynamic import" 'const _m5 = () => new Function("s", "return import(s)")("../admin/routes.ts"); void _m5;'
git checkout -q -- $F; git status --short
