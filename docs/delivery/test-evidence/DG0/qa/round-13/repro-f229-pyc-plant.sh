#!/usr/bin/env bash
# qa-verifier round 13: F-DG0-229 re-verification. Plants gitignored sourceless docs/analysis/tools/csv.pyc
# (plus a __pycache__ variant) in a disposable clone at <rev>, then runs that clone's own tools/gates/prefreeze.sh DG0.
# Payload: exit 42 immediately (so if it is ever imported, the analysis check FAILS), and also try to write
# .git/hooks/post-commit of the clone (outside the candidate). Usage: repro-f229-pyc-plant.sh <repo> <rev> <workdir>
set -u
REPO="$1" REV="$2" W="$3"
rm -rf "$W"; mkdir -p "$W"
git clone -q "$REPO" "$W/clone"; cd "$W/clone"; git checkout -q "$REV"
echo "## clone at $(git rev-parse HEAD)"
cat > "$W/csv.py" <<PY
import os
_here = os.path.dirname(os.path.abspath(__file__))
try:
    open(os.path.join("$W/clone", ".git", "hooks", "post-commit"), "w").write("#!/bin/sh\n# QA13 planted\n")
except Exception as e:
    pass
raise SystemExit(42)
PY
python3 -c "import py_compile,sys; py_compile.compile(sys.argv[1], cfile=sys.argv[2])" "$W/csv.py" docs/analysis/tools/csv.pyc
mkdir -p docs/analysis/tools/__pycache__
python3 -c "import py_compile,sys; py_compile.compile(sys.argv[1], cfile=sys.argv[2])" "$W/csv.py" docs/analysis/tools/__pycache__/csv.cpython-311.pyc
echo "## planted:"; ls -la docs/analysis/tools/csv.pyc docs/analysis/tools/__pycache__/
echo "## git status --porcelain --untracked-files=all (expect empty: ignored)"; git status --porcelain --untracked-files=all; echo "[end]"
echo "## sanity: running check_counts.py the OLD way (python3 script) imports the plant?"; python3 docs/analysis/tools/check_counts.py >/dev/null 2>&1; echo "rc=$? (42 = plant executed)"
rm -f .git/hooks/post-commit
echo "## \$ tools/gates/prefreeze.sh DG0"
env -u NODE_TEST_CONTEXT bash tools/gates/prefreeze.sh DG0 2>&1 | sed 's/ :: .*//'
echo "prefreeze_exit=${PIPESTATUS[0]}"
echo "## .git/hooks/post-commit written by the plant during prefreeze?"; if [ -e .git/hooks/post-commit ]; then echo "YES (plant executed with orchestrator rights)"; else echo "no"; fi
