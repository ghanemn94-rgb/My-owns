#!/usr/bin/env bash
# domain-reviewer DG4 round 9 (D-136 confirmation round): candidate identity on a complete clone, and the product diff from round 8's remapped source 5cd1e06.
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:/usr/bin:/bin
R=/home/user/My-owns; C="$TMPDIR/review-r9"
echo "### assignment sha256"; sha256sum $R/docs/delivery/assignments/DG4/round-9/domain-reviewer.md
echo "### repo HEAD $(git -C $R rev-parse HEAD)"
cd "$C"
echo "### clone shallow? $(git rev-parse --is-shallow-repository)  commits reachable: $(git rev-list --all | wc -l)"
for rev in f2ae7170630456a772e1ceac90ab6d96b68e3f5c 01ad2e185962ebec0bbf541503c09ae4075eeec6; do
  git checkout -q $rev; echo "### clone at $(git rev-parse HEAD)"; node tools/gates/candidate.mjs --stage DG4; echo "exit=$?"; done
git checkout -q f2ae7170630456a772e1ceac90ab6d96b68e3f5c
echo "### repo working tree"; (cd $R && node tools/gates/candidate.mjs --stage DG4; echo "exit=$?")
echo "### manifest"; node -e 'const m=require(process.argv[1]);const f=m.files||m.entries||[];console.log(JSON.stringify({candidate_id:m.candidate_id,source_commit:m.source_commit,stage:m.stage||m.stage_id,n:Array.isArray(f)?f.length:Object.keys(f).length}))' $R/docs/delivery/candidates/DG4/18c18fe4eda7cbc1.manifest.json
echo "### f2ae717..01ad2e1 files"; git diff --name-only f2ae717 01ad2e1
echo "### product diff 5cd1e06..f2ae717 outside docs/delivery: lines=$(git diff 5cd1e06..f2ae7170630456a772e1ceac90ab6d96b68e3f5c -- . ':!docs/delivery' | wc -l)"
echo "### files changed 5cd1e06..f2ae717"; git diff --name-status 5cd1e06..f2ae7170630456a772e1ceac90ab6d96b68e3f5c
echo "### files outside docs/delivery: $(git diff --name-only 5cd1e06..f2ae7170630456a772e1ceac90ab6d96b68e3f5c | grep -vc '^docs/delivery/')"
echo "### register unchanged? "; git diff --quiet 5cd1e06..f2ae717 -- docs/delivery/requirements.csv; echo "requirements.csv diff exit=$?"
echo "### round-8 manifest vs round-9 manifest (entry diff)"
node -e '
const a=require(process.argv[1]),b=require(process.argv[2]);
const norm=m=>{const f=m.files||m.entries;const o={};if(Array.isArray(f))for(const e of f)o[e.path||e[0]]=e.sha256||e.hash||e[1];else Object.assign(o,f);return o};
const A=norm(a),B=norm(b);const ks=new Set([...Object.keys(A),...Object.keys(B)]);let d=[];for(const k of ks)if(A[k]!==B[k])d.push(k);
console.log("r8 entries",Object.keys(A).length,"r9 entries",Object.keys(B).length,"differing:",d.length);d.forEach(x=>console.log("  ",x));' $R/docs/delivery/candidates/DG4/8014e5ceffe1f374.manifest.json $R/docs/delivery/candidates/DG4/18c18fe4eda7cbc1.manifest.json
echo "### 8014e5ce ancestry: 5cd1e06 is ancestor of f2ae717?"; git merge-base --is-ancestor 5cd1e06 f2ae717; echo "exit=$?"
echo "### diff of decisions.md 5cd1e06..f2ae717 (stat)"; git diff --stat 5cd1e06..f2ae717 -- docs/delivery/decisions.md
