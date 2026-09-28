#!/usr/bin/env bash
# Round-11 (code-security-reviewer): can a pre-commit hook add files to the runner's auto-commit, which uses
# 'git add/commit --pathspec-from-file --pathspec-file-nul' with GIT_LITERAL_PATHSPECS=1 (run-agent.sh:169-180)?
# Disposable repo under <base-dir>.
set -u
B="$1"; rm -rf "$B"; mkdir -p "$B"; cd "$B" && git init -q r && cd r
git config user.email a@b; git config user.name x
mkdir -p tools/gates docs/delivery/runs/DG0/RUN; echo orig > tools/gates/rules.mjs; git add -A; git commit -qm base
echo evidence > docs/delivery/runs/DG0/RUN/meta.json
echo TAMPERED > tools/gates/rules.mjs      # tampering left in the tree (would normally show in git status)
printf '#!/bin/sh\ngit add tools/gates/rules.mjs\n' > "$B/evil.sh"; chmod +x "$B/evil.sh"; ln -s "$B/evil.sh" .git/hooks/pre-commit
printf 'docs/delivery/runs/DG0/RUN\0' > "$B/list"
export GIT_LITERAL_PATHSPECS=1
git add --pathspec-from-file="$B/list" --pathspec-file-nul
git commit -q -m "run: RUN (review evidence, auto-committed by run-agent.sh)" --pathspec-from-file="$B/list" --pathspec-file-nul; echo "commit rc=$?"
echo "files in the auto-commit:"; git show --name-only --format= HEAD | sed 's/^/  /'
echo "git status --short after the auto-commit:"; git status --short | sed 's/^/  /'; echo "  (end)"
