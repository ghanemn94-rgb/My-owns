#!/bin/bash
# candidate identity on the live repository (read-only)
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-5
cd /home/user/My-owns
{ echo "# $(date -u +%FT%TZ) candidate identity (Node $(node -v))"
  echo "git rev-parse HEAD: $(git rev-parse HEAD)"
  echo "source_commit 3c8b9a3acfe657348249feb297b52cf208324a07 is ancestor of HEAD: $(git merge-base --is-ancestor 3c8b9a3acfe657348249feb297b52cf208324a07 HEAD && echo yes || echo no)"
  echo "files changed 3c8b9a3a..HEAD outside docs/delivery: $(git diff --name-only 3c8b9a3acfe657348249feb297b52cf208324a07 HEAD -- . ':!docs/delivery' | wc -l)"
  echo "git diff 60787d89ffa2562d491af424bc1024b4e3bc2d57 3c8b9a3a -- . ':!docs/delivery' (must be empty):"; git diff --stat 60787d89ffa2562d491af424bc1024b4e3bc2d57 3c8b9a3acfe657348249feb297b52cf208324a07 -- . ':!docs/delivery'; echo "(end, lines=$(git diff 60787d89ffa2562d491af424bc1024b4e3bc2d57 3c8b9a3acfe657348249feb297b52cf208324a07 -- . ':!docs/delivery' | wc -l))"
  echo "is shallow: $(git rev-parse --is-shallow-repository)"
  echo "node tools/gates/candidate.mjs --stage DG6 (working tree):"; node tools/gates/candidate.mjs --stage DG6; echo "exit=$?"
  echo "node tools/gates/candidate.mjs --stage DG6 --ref 3c8b9a3a…:"; node tools/gates/candidate.mjs --stage DG6 --ref 3c8b9a3acfe657348249feb297b52cf208324a07; echo "exit=$?"
  echo "manifest file:"; ls -l docs/delivery/candidates/DG6/5e819f7a579dbf98.manifest.json; sha256sum docs/delivery/candidates/DG6/5e819f7a579dbf98.manifest.json
  echo "assignment sha256:"; sha256sum docs/delivery/assignments/DG6/round-5/code-security-reviewer.md
  echo "Node 22: $(/opt/node22/bin/node -v)  Node 24: $(node -v)  pnpm $(pnpm -v)"
} > $E/01-candidate-identity.log 2>&1
