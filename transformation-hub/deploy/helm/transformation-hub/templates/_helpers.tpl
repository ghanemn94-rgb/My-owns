{{/* ============================== names and labels ============================== */}}
{{- define "hub.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "hub.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "hub.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "hub.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: transformation-hub
{{- end -}}

{{/* selector labels for one component: include "hub.selector" (dict "ctx" . "component" "api") */}}
{{- define "hub.selector" -}}
app.kubernetes.io/name: {{ include "hub.name" .ctx }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* pod template labels = common labels + component (no duplicate keys): (dict "ctx" . "component" "api") */}}
{{- define "hub.podLabels" -}}
{{ include "hub.labels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "hub.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "hub.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* ============================== images ============================== */}}
{{- define "hub.imageRef" -}}
{{- $reg := .registry -}}
{{- if .digest -}}
{{- printf "%s/%s@%s" $reg .repository .digest -}}
{{- else -}}
{{- printf "%s/%s:%s" $reg .repository (toString .tag) -}}
{{- end -}}
{{- end -}}

{{- define "hub.apiImage" -}}
{{- $i := .Values.image -}}
{{- if .Values.chromium.enabled -}}
{{- include "hub.imageRef" (dict "registry" $i.registry "repository" $i.api.chromiumRepository "tag" $i.api.tag "digest" $i.api.chromiumDigest) -}}
{{- else -}}
{{- include "hub.imageRef" (dict "registry" $i.registry "repository" $i.api.repository "tag" $i.api.tag "digest" $i.api.digest) -}}
{{- end -}}
{{- end -}}

{{- define "hub.webImage" -}}
{{- $i := .Values.image -}}
{{- include "hub.imageRef" (dict "registry" $i.registry "repository" $i.web.repository "tag" $i.web.tag "digest" $i.web.digest) -}}
{{- end -}}

{{/* ============================== validation (fails the render) ============================== */}}
{{- define "hub.validate" -}}
{{- if not .Values.image.registry -}}{{- fail "image.registry is required (private registry)" -}}{{- end -}}
{{- if eq .Values.database.runtimeSecret.name .Values.database.migrationSecret.name -}}
{{- fail "database.runtimeSecret and database.migrationSecret must be different Secrets (runtime role vs owner role)" -}}
{{- end -}}
{{- if eq .Values.app.nodeEnv "production" -}}
{{- if eq .Values.app.mode "demo" -}}{{- fail "app.mode=demo is not allowed with app.nodeEnv=production" -}}{{- end -}}
{{- if not .Values.app.cookieSecure -}}{{- fail "app.cookieSecure must be true in production" -}}{{- end -}}
{{- if .Values.ai.allowMock -}}{{- fail "ai.allowMock must be false in production (mock AI is simulated)" -}}{{- end -}}
{{- if eq .Values.storage.driver "local" -}}{{- fail "storage.driver=local is for development/evaluation only; use s3 in production" -}}{{- end -}}
{{- if not (hasPrefix "https://" (toString .Values.oidc.issuer)) -}}{{- fail "oidc.issuer must be an https URL in production" -}}{{- end -}}
{{- if not .Values.oidc.cookieSecret.name -}}{{- fail "oidc.cookieSecret.name is required when OIDC is enabled" -}}{{- end -}}
{{- end -}}
{{- if and (eq .Values.storage.driver "local") (not .Values.storage.local.existingClaim) -}}
{{- fail "storage.driver=local needs storage.local.existingClaim (a ReadWriteMany PVC shared by api and worker)" -}}
{{- end -}}
{{- if and .Values.ai.apiKeySecret.name (eq .Values.ai.mode "off") -}}
{{- fail "ai.apiKeySecret is set while ai.mode=off; remove the credential reference or choose a mode" -}}
{{- end -}}
{{- end -}}

{{/* ============================== environment ============================== */}}
{{- define "hub.caEnv" -}}
{{- if .Values.customCA.enabled }}
- name: NODE_EXTRA_CA_CERTS
  value: /etc/hub/ca/{{ .Values.customCA.key }}
{{- end }}
{{- end -}}

{{- define "hub.proxyEnv" -}}
{{- if or .Values.proxy.httpProxy .Values.proxy.httpsProxy }}
- name: NODE_USE_ENV_PROXY
  value: "1"
- name: HTTP_PROXY
  value: {{ .Values.proxy.httpProxy | quote }}
- name: http_proxy
  value: {{ .Values.proxy.httpProxy | quote }}
- name: HTTPS_PROXY
  value: {{ .Values.proxy.httpsProxy | quote }}
- name: https_proxy
  value: {{ .Values.proxy.httpsProxy | quote }}
- name: NO_PROXY
  value: {{ .Values.proxy.noProxy | quote }}
- name: no_proxy
  value: {{ .Values.proxy.noProxy | quote }}
{{- end }}
{{- end -}}

{{- define "hub.otelEnv" -}}
{{- if and .Values.otel.enabled .Values.otel.endpoint }}
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: {{ .Values.otel.endpoint | quote }}
- name: OTEL_EXPORTER_OTLP_PROTOCOL
  value: {{ .Values.otel.protocol | quote }}
- name: OTEL_SERVICE_NAME
  value: {{ printf "transformation-hub-%s" .component | quote }}
- name: OTEL_RESOURCE_ATTRIBUTES
  value: {{ .Values.otel.resourceAttributes | quote }}
{{- else }}
- name: OTEL_SDK_DISABLED
  value: "true"
{{- end }}
{{- end -}}

{{/* Environment shared by api and worker. Call with (dict "ctx" . "component" "api"|"worker") */}}
{{- define "hub.appEnv" -}}
{{- $v := .ctx.Values -}}
- name: NODE_ENV
  value: {{ $v.app.nodeEnv | quote }}
- name: HUB_MODE
  value: {{ $v.app.mode | quote }}
- name: HUB_ORG_SLUG
  value: {{ $v.app.orgSlug | quote }}
- name: HUB_APP_NAME
  value: {{ $v.app.appName | quote }}
- name: HUB_COOKIE_SECURE
  value: {{ $v.app.cookieSecure | toString | quote }}
- name: HUB_TRUST_PROXY
  value: {{ $v.app.trustProxy | toString | quote }}
- name: HUB_SESSION_IDLE_MINUTES
  value: {{ $v.app.session.idleMinutes | toString | quote }}
- name: HUB_SESSION_ABSOLUTE_HOURS
  value: {{ $v.app.session.absoluteHours | toString | quote }}
- name: HUB_PRIVATE_MODE
  value: {{ $v.app.privateMode | toString | quote }}
- name: HUB_EGRESS_ALLOWLIST
  value: {{ join "," $v.app.egressAllowlist | quote }}
- name: HUB_LOG_LEVEL
  value: {{ $v.app.logLevel | quote }}
- name: HUB_MAX_UPLOAD_MB
  value: {{ $v.app.maxUploadMb | toString | quote }}
- name: DATABASE_POOL_MAX
  value: {{ $v.app.database.poolMax | toString | quote }}
- name: HUB_DB_STATEMENT_TIMEOUT_MS
  value: {{ $v.app.database.statementTimeoutMs | toString | quote }}
- name: HUB_DB_LOCK_TIMEOUT_MS
  value: {{ $v.app.database.lockTimeoutMs | toString | quote }}
- name: HUB_DB_IDLE_TX_TIMEOUT_MS
  value: {{ $v.app.database.idleTxTimeoutMs | toString | quote }}
- name: HUB_RATE_LIMIT_PER_MINUTE
  value: {{ $v.app.rateLimits.perMinute | toString | quote }}
- name: HUB_RATE_LIMIT_MUTATIONS_PER_MINUTE
  value: {{ $v.app.rateLimits.mutationsPerMinute | toString | quote }}
- name: HUB_RATE_LIMIT_PUBLIC_PER_MINUTE
  value: {{ $v.app.rateLimits.publicPerMinute | toString | quote }}
- name: HUB_WORKER_POLL_MS
  value: {{ $v.app.workerPollMs | toString | quote }}
- name: HUB_WORKER_ID
  valueFrom:
    fieldRef:
      fieldPath: metadata.name
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ $v.database.runtimeSecret.name }}
      key: {{ $v.database.runtimeSecret.key }}
- name: HUB_STORAGE_DRIVER
  value: {{ $v.storage.driver | quote }}
{{- if eq $v.storage.driver "local" }}
- name: HUB_STORAGE_LOCAL_DIR
  value: {{ $v.storage.local.mountPath | quote }}
{{- else }}
- name: HUB_S3_ENDPOINT
  value: {{ $v.storage.s3.endpoint | quote }}
- name: HUB_S3_BUCKET
  value: {{ $v.storage.s3.bucket | quote }}
- name: HUB_S3_REGION
  value: {{ $v.storage.s3.region | quote }}
{{- /* I-R4: per-object server-side encryption (production refuses `none` unless the bucket default encryption is assured). */}}
- name: HUB_S3_SSE
  value: {{ required "storage.s3.sse is required (AES256 or aws:kms)" $v.storage.s3.sse | quote }}
{{- if $v.storage.s3.kmsKeyId }}
- name: HUB_S3_KMS_KEY_ID
  value: {{ $v.storage.s3.kmsKeyId | quote }}
{{- end }}
{{- if $v.storage.s3.bucketDefaultEncryptionAssured }}
- name: HUB_S3_BUCKET_DEFAULT_ENCRYPTION
  value: "assured"
{{- end }}
- name: HUB_S3_ACCESS_KEY_ID
  valueFrom:
    secretKeyRef:
      name: {{ $v.storage.s3.credentialsSecret.name }}
      key: {{ $v.storage.s3.credentialsSecret.accessKeyIdKey }}
- name: HUB_S3_SECRET_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $v.storage.s3.credentialsSecret.name }}
      key: {{ $v.storage.s3.credentialsSecret.secretAccessKeyKey }}
{{- end }}
{{- if $v.oidc.issuer }}
- name: HUB_OIDC_ISSUER
  value: {{ $v.oidc.issuer | quote }}
- name: HUB_OIDC_CLIENT_ID
  value: {{ $v.oidc.clientId | quote }}
- name: HUB_OIDC_REDIRECT_URI
  value: {{ default (printf "%s/api/v1/auth/oidc/callback" (trimSuffix "/" $v.app.publicUrl)) $v.oidc.redirectUri | quote }}
- name: HUB_OIDC_LINK_BY_EMAIL
  value: {{ $v.oidc.linkByEmail | toString | quote }}
{{- if $v.oidc.linkByEmailAck }}
- name: HUB_OIDC_LINK_BY_EMAIL_ACK
  value: {{ $v.oidc.linkByEmailAck | quote }}
{{- end }}
- name: HUB_OIDC_CLIENT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ $v.oidc.clientSecret.name }}
      key: {{ $v.oidc.clientSecret.key }}
- name: HUB_COOKIE_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ $v.oidc.cookieSecret.name }}
      key: {{ $v.oidc.cookieSecret.key }}
{{- end }}
- name: HUB_AI_ALLOW_MOCK
  value: {{ $v.ai.allowMock | toString | quote }}
- name: HUB_AI_MODE
  value: {{ $v.ai.mode | quote }}
{{- if ne $v.ai.mode "off" }}
- name: HUB_AI_BASE_URL
  value: {{ $v.ai.baseUrl | quote }}
- name: HUB_AI_MODEL
  value: {{ $v.ai.model | quote }}
{{- if $v.ai.apiKeySecret.name }}
- name: HUB_AI_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $v.ai.apiKeySecret.name }}
      key: {{ $v.ai.apiKeySecret.key }}
{{- end }}
{{- end }}
{{- if $v.chromium.enabled }}
- name: HUB_CHROMIUM_PATH
  value: {{ $v.chromium.path | quote }}
{{- end }}
- name: NEXT_TELEMETRY_DISABLED
  value: "1"
{{- include "hub.proxyEnv" .ctx }}
{{- include "hub.caEnv" .ctx }}
{{- include "hub.otelEnv" (dict "Values" $v "component" .component) }}
{{- with $v.app.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/* ============================== pod-level pieces ============================== */}}
{{- define "hub.podSecurityContext" -}}
{{- $psc := deepCopy .Values.podSecurityContext -}}
{{- if .Values.openshift -}}
{{- $psc = omit $psc "runAsUser" "runAsGroup" "fsGroup" -}}
{{- end -}}
{{- toYaml $psc -}}
{{- end -}}

{{- define "hub.caVolume" -}}
{{- if .Values.customCA.enabled }}
- name: ca-bundle
  configMap:
    name: {{ default (printf "%s-trusted-ca" (include "hub.fullname" .)) .Values.customCA.configMapName }}
    items:
      - key: {{ .Values.customCA.key }}
        path: {{ .Values.customCA.key }}
{{- end }}
{{- end -}}

{{- define "hub.caMount" -}}
{{- if .Values.customCA.enabled }}
- name: ca-bundle
  mountPath: /etc/hub/ca
  readOnly: true
{{- end }}
{{- end -}}
