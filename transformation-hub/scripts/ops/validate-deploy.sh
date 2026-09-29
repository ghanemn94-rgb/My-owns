#!/usr/bin/env bash
# =====================================================================================================================
# Static validation of the deployment assets (no cluster, no Docker daemon needed):
#   - helm lint + helm template for every deployment mode (AI off / local AI / AI gateway) on Kubernetes and OpenShift
#   - negative renders: unsafe production values must FAIL (demo mode, mock AI, local storage, http issuer, …)
#   - security invariants on the rendered manifests (non-root, no privilege escalation, read-only root FS, drop ALL,
#     seccomp, no fixed UID on OpenShift, default-deny NetworkPolicy, owner secret only in hook Jobs)
#   - kubeconform schema validation (when available; OpenShift Route CRD skipped)
#   - docker compose config (when the docker CLI with compose is available — no daemon needed)
#   - shellcheck on scripts/ops/*.sh and actionlint on the CI workflow (when available)
# Tools: HELM, KUBECONFORM, ACTIONLINT, SHELLCHECK env vars or PATH. Missing optional tools are reported as SKIPPED.
#   bash scripts/ops/validate-deploy.sh [--out DIR]
# =====================================================================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART="$ROOT/deploy/helm/transformation-hub"
OUT="$(mktemp -d)"
[ "${1:-}" = "--out" ] && { OUT="$2"; mkdir -p "$OUT"; }
HELM="${HELM:-$(command -v helm || true)}"
KUBECONFORM="${KUBECONFORM:-$(command -v kubeconform || true)}"
ACTIONLINT="${ACTIONLINT:-$(command -v actionlint || true)}"
SHELLCHECK="${SHELLCHECK:-$(command -v shellcheck || true)}"
# Target Kubernetes minor for rendering and schema checks (chart requires >= 1.27; set to the cluster's version).
KUBE_VERSION="${KUBE_VERSION:-1.30.0}"
FAILS=0
pass() { printf 'PASS     %s\n' "$*"; }
fail() { printf 'FAIL     %s\n' "$*"; FAILS=$((FAILS + 1)); }
skip() { printf 'SKIPPED  %s\n' "$*"; }

# --- Helm ---------------------------------------------------------------------------------------------------------------
if [ -z "$HELM" ]; then
  skip "helm not available (set HELM=/path/to/helm) — chart NOT validated"
else
  echo "helm: $("$HELM" version --short 2>/dev/null)"
  if "$HELM" lint "$CHART" >"$OUT/lint.txt" 2>&1 && "$HELM" lint "$CHART" -f "$CHART/ci/render-values.yaml" --strict >>"$OUT/lint.txt" 2>&1; then
    pass "helm lint (defaults) and helm lint --strict (ci/render-values.yaml)"
  else fail "helm lint"; cat "$OUT/lint.txt"; fi

  render() { # render <name> <helm args...>
    local name="$1"; shift
    if "$HELM" template hub "$CHART" --namespace hub --kube-version "$KUBE_VERSION" -f "$CHART/ci/render-values.yaml" "$@" >"$OUT/$name.yaml" 2>"$OUT/$name.err"; then
      pass "helm template $name ($(grep -c '^kind:' "$OUT/$name.yaml") objects: $(grep '^kind:' "$OUT/$name.yaml" | awk '{print $2}' | sort | uniq -c | awk '{printf "%s×%s ", $2, $1}'))"
    else fail "helm template $name: $(tail -1 "$OUT/$name.err")"; fi
  }
  render k8s-ai-off -f "$CHART/values-private-ai-off.yaml"
  render k8s-local-ai -f "$CHART/values-private-local-ai.yaml"
  render k8s-ai-gateway -f "$CHART/values-private-ai-gateway.yaml" --set autoscaling.api.enabled=true --set chromium.enabled=true
  render openshift-ai-off -f "$CHART/values-private-ai-off.yaml" --set openshift=true --set customCA.configMapName= --set customCA.openshiftInjectTrustedBundle=true
  render k8s-bootstrap -f "$CHART/values-private-ai-off.yaml" --set bootstrap.enabled=true --set bootstrap.orgName=REPLACE_ORG --set bootstrap.adminEmail=first.admin@example.invalid

  # Negative renders: the chart must refuse unsafe production settings.
  refuse() { # refuse <label> <expected message fragment> <helm args...>
    local label="$1" frag="$2"; shift 2
    if "$HELM" template hub "$CHART" --kube-version "$KUBE_VERSION" -f "$CHART/ci/render-values.yaml" "$@" >/dev/null 2>"$OUT/neg.err"; then fail "unsafe values accepted: $label"
    elif grep -q "$frag" "$OUT/neg.err"; then pass "refused: $label"
    else fail "refused for another reason ($label): $(tail -1 "$OUT/neg.err")"; fi
  }
  refuse "HUB_MODE=demo in production" "app.mode=demo" --set app.mode=demo
  refuse "mock AI in production" "ai.allowMock" --set ai.allowMock=true
  refuse "local storage in production" "storage.driver=local" --set storage.driver=local
  refuse "http OIDC issuer in production" "https URL" --set oidc.issuer=http://idp.example.internal
  refuse "insecure cookies in production" "cookieSecure" --set app.cookieSecure=false
  refuse "same Secret for owner and runtime" "must be different" --set database.migrationSecret.name=hub-db-runtime
  refuse "no image registry" "image.registry" --set image.registry=
  refuse "AI credential with AI off" "ai.mode=off" --set ai.apiKeySecret.name=x

  # Security invariants on rendered manifests (python3 + PyYAML).
  if command -v python3 >/dev/null && python3 -c 'import yaml' 2>/dev/null; then
    python3 - "$OUT" <<'PY' && pass "security invariants on all rendered modes" || fail "security invariants"
import sys, glob, yaml, os
out = sys.argv[1]; bad = []
for f in sorted(glob.glob(os.path.join(out, '*.yaml'))):
    name = os.path.basename(f)[:-5]
    docs = [d for d in yaml.safe_load_all(open(f)) if d]
    openshift = name.startswith('openshift')
    kinds = [d['kind'] for d in docs]
    if 'NetworkPolicy' not in kinds: bad.append(f'{name}: no NetworkPolicy')
    deny = [d for d in docs if d['kind'] == 'NetworkPolicy' and d['metadata']['name'].endswith('default-deny')]
    if not deny or deny[0]['spec'].get('policyTypes') != ['Ingress', 'Egress'] or deny[0]['spec'].get('ingress') or deny[0]['spec'].get('egress'):
        bad.append(f'{name}: default-deny policy missing or not deny-all')
    if openshift and 'Ingress' in kinds: bad.append(f'{name}: Ingress rendered on OpenShift')
    if openshift and 'Route' not in kinds: bad.append(f'{name}: no Route on OpenShift')
    for d in docs:
        if d['kind'] not in ('Deployment', 'Job'): continue
        spec = d['spec']['template']['spec']; n = d['metadata']['name']
        psc = spec.get('securityContext', {})
        if not psc.get('runAsNonRoot'): bad.append(f'{name}/{n}: runAsNonRoot missing')
        if psc.get('seccompProfile', {}).get('type') != 'RuntimeDefault': bad.append(f'{name}/{n}: seccomp')
        if openshift and any(k in psc for k in ('runAsUser', 'runAsGroup', 'fsGroup')): bad.append(f'{name}/{n}: fixed UID/GID on OpenShift')
        if spec.get('automountServiceAccountToken') is not False: bad.append(f'{name}/{n}: SA token automounted')
        for c in spec['containers']:
            sc = c.get('securityContext', {})
            if sc.get('allowPrivilegeEscalation') is not False: bad.append(f'{name}/{n}: allowPrivilegeEscalation')
            if sc.get('readOnlyRootFilesystem') is not True: bad.append(f'{name}/{n}: readOnlyRootFilesystem')
            if sc.get('capabilities', {}).get('drop') != ['ALL']: bad.append(f'{name}/{n}: capabilities not dropped')
            envs = {e['name']: e for e in c.get('env', [])}
            is_hook = d['kind'] == 'Job'
            if 'DATABASE_MIGRATION_URL' in envs and not is_hook: bad.append(f'{name}/{n}: owner secret in a long-running pod')
            if not is_hook and d['metadata']['name'].endswith(('-api', '-worker')):
                if envs.get('NODE_ENV', {}).get('value') != 'production': bad.append(f'{name}/{n}: NODE_ENV')
                if envs.get('HUB_TRUST_PROXY', {}).get('value') != 'true': bad.append(f'{name}/{n}: HUB_TRUST_PROXY')
                for secret_env in ('DATABASE_URL', 'HUB_OIDC_CLIENT_SECRET', 'HUB_COOKIE_SECRET'):
                    if secret_env in envs and 'valueFrom' not in envs[secret_env]: bad.append(f'{name}/{n}: {secret_env} inline')
            if name.endswith('ai-off') and any(k in envs for k in ('HUB_AI_BASE_URL', 'HUB_AI_API_KEY')): bad.append(f'{name}/{n}: AI endpoint set in AI-off mode')
    worker_np = [d for d in docs if d['kind'] == 'NetworkPolicy' and d['metadata']['name'].endswith('-worker')]
    ai_rule = any('aiGateway' in yaml.safe_dump(r) or any('192.0.2.10/32' in str(t) or '198.51.100.20/32' in str(t) for t in r.get('to', [])) for r in (worker_np[0]['spec'].get('egress', []) if worker_np else []))
    if name.endswith('ai-off') and ai_rule: bad.append(f'{name}: AI egress present in AI-off mode')
    if name.endswith(('local-ai', 'ai-gateway')) and not ai_rule: bad.append(f'{name}: approved AI egress missing')
for b in bad: print('   ', b)
sys.exit(1 if bad else 0)
PY
  else skip "python3/PyYAML not available — security invariants not checked"; fi

  if [ -n "$KUBECONFORM" ]; then
    for f in "$OUT"/*.yaml; do
      if "$KUBECONFORM" -strict -summary -ignore-missing-schemas -kubernetes-version "$KUBE_VERSION" "$f" >"$OUT/kc.txt" 2>&1 && grep -qE "Valid: [1-9]" "$OUT/kc.txt"; then
        pass "kubeconform $(basename "$f"): $(tail -1 "$OUT/kc.txt")"
      else
        if grep -qiE 'could not download|failed downloading|no such host|connection refused|dial tcp' "$OUT/kc.txt"; then
          skip "kubeconform $(basename "$f"): schemas not downloadable here ($(grep -m1 -oiE 'could not download[^:]*|failed downloading[^:]*|dial tcp[^,]*' "$OUT/kc.txt"))"
        else fail "kubeconform $(basename "$f")"; cat "$OUT/kc.txt"; fi
      fi
    done
  else skip "kubeconform not available"; fi
fi

# --- Compose ---------------------------------------------------------------------------------------------------------------
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  if docker compose -f "$ROOT/deploy/compose/compose.dev.yml" --env-file "$ROOT/deploy/compose/.env.example" --profile demo --profile s3 config --quiet 2>"$OUT/compose.err"; then
    pass "docker compose config (profiles demo+s3; $(docker compose version --short))"
  else fail "docker compose config: $(tail -2 "$OUT/compose.err")"; fi
else skip "docker compose CLI not available"; fi

# --- Shell scripts and workflow ---------------------------------------------------------------------------------------------
for f in "$ROOT"/scripts/ops/*.sh "$ROOT"/deploy/compose/initdb/*.sh; do bash -n "$f" || fail "bash -n $f"; done
pass "bash -n on scripts/ops/*.sh and compose init scripts"
if [ -n "$SHELLCHECK" ]; then
  if "$SHELLCHECK" -S warning "$ROOT"/scripts/ops/*.sh "$ROOT"/deploy/compose/initdb/*.sh >"$OUT/shellcheck.txt" 2>&1; then pass "shellcheck -S warning"
  else fail "shellcheck"; cat "$OUT/shellcheck.txt"; fi
else skip "shellcheck not available"; fi
WF="$ROOT/../.github/workflows/transformation-hub-ci.yml"
if [ -n "$ACTIONLINT" ] && [ -f "$WF" ]; then
  if "$ACTIONLINT" -shellcheck= "$WF" >"$OUT/actionlint.txt" 2>&1; then pass "actionlint $(basename "$WF")"
  else fail "actionlint"; cat "$OUT/actionlint.txt"; fi
else skip "actionlint not available or workflow missing"; fi
node -e "JSON.parse(require('fs').readFileSync('$ROOT/scripts/ops/licence-policy.json','utf8'))" && pass "licence-policy.json parses"

echo "rendered manifests: $OUT"
if [ "$FAILS" = 0 ]; then echo "VALIDATION: PASS"; else echo "VALIDATION: FAIL ($FAILS)"; fi
[ "$FAILS" = 0 ]
