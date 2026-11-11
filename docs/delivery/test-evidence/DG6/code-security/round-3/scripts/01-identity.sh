#!/bin/bash
# candidate identity on the live repository (read-only)
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-3
cd /home/user/My-owns
{ echo "# $(date -u +%FT%TZ) candidate identity (Node $(node -v))"
  echo "git rev-parse HEAD: $(git rev-parse HEAD)"
  echo "source_commit f56f1b3d24c00d1803f6627c99b3f422a47b3014 is ancestor of HEAD: $(git merge-base --is-ancestor f56f1b3d24c00d1803f6627c99b3f422a47b3014 HEAD && echo yes || echo no)"
  echo "files changed f56f1b3d..HEAD outside docs/delivery: $(git diff --name-only f56f1b3d24c00d1803f6627c99b3f422a47b3014 HEAD -- . ':!docs/delivery' | wc -l)"
  echo "git diff a0cf22bba f56f1b3d -- . ':!docs/delivery' (must be empty):"; git diff --stat a0cf22bba f56f1b3d24c00d1803f6627c99b3f422a47b3014 -- . ':!docs/delivery'; echo "(end, lines=$(git diff a0cf22bba f56f1b3d24c00d1803f6627c99b3f422a47b3014 -- . ':!docs/delivery' | wc -l))"
  echo "is shallow: $(git rev-parse --is-shallow-repository)"
  echo "node tools/gates/candidate.mjs --stage DG6 (working tree):"; node tools/gates/candidate.mjs --stage DG6; echo "exit=$?"
  echo "node tools/gates/candidate.mjs --stage DG6 --ref f56f1b3d…:"; node tools/gates/candidate.mjs --stage DG6 --ref f56f1b3d24c00d1803f6627c99b3f422a47b3014; echo "exit=$?"
  echo "manifest file:"; ls -l docs/delivery/candidates/DG6/32e41b5581a9beeb.manifest.json; sha256sum docs/delivery/candidates/DG6/32e41b5581a9beeb.manifest.json
  echo "assignment sha256:"; sha256sum docs/delivery/assignments/DG6/round-3/code-security-reviewer.md
  echo "Node 22: $(/opt/node22/bin/node -v)  Node 24: $(node -v)  pnpm $(pnpm -v)"
} > $E/01-candidate-identity.log 2>&1
