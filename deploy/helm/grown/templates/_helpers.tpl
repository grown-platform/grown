{{/* Chart name */}}
{{- define "grown.name" -}}
grown
{{- end -}}

{{/* Common labels */}}
{{- define "grown.labels" -}}
app.kubernetes.io/name: grown
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/* grown app image ref */}}
{{- define "grown.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}

{{/* Public external URL for grown (scheme + domain) */}}
{{- define "grown.externalURL" -}}
{{- printf "%s://%s" .Values.scheme .Values.domain -}}
{{- end -}}

{{/* In-cluster Postgres host */}}
{{- define "grown.pgHost" -}}
{{ .Release.Name }}-postgres.{{ .Release.Namespace }}.svc.cluster.local
{{- end -}}

{{/* grown Postgres DSN. Uses externalDsn when set, else the bundled PG. */}}
{{- define "grown.pgDSN" -}}
{{- if .Values.postgres.externalDsn -}}
{{ .Values.postgres.externalDsn }}
{{- else -}}
postgres://{{ .Values.postgres.auth.username }}:{{ .Values.postgres.auth.password }}@{{ include "grown.pgHost" . }}:5432/{{ .Values.postgres.auth.database }}?sslmode=disable
{{- end -}}
{{- end -}}

{{/* PDF Postgres DSN */}}
{{- define "grown.pdfDSN" -}}
postgres://{{ .Values.postgres.auth.username }}:{{ .Values.postgres.auth.password }}@{{ include "grown.pgHost" . }}:5432/{{ .Values.pdf.database }}?sslmode=disable
{{- end -}}

{{/* ---------------------------------------------------------------------
     Object storage (S3). 0.2.0 replaced the bundled MinIO with rustfs.
     --------------------------------------------------------------------- */}}

{{/* Bundled rustfs Service name. */}}
{{- define "grown.rustfsName" -}}
{{ .Release.Name }}-rustfs
{{- end -}}

{{/* Bundled (legacy) MinIO Service name. */}}
{{- define "grown.minioName" -}}
{{ .Release.Name }}-minio
{{- end -}}

{{/* grown's app bucket. rustfs.bucket wins; else the 0.1.x minio.bucket so an
     upgraded install keeps its bucket name; else grown-default. */}}
{{- define "grown.bucket" -}}
{{- .Values.rustfs.bucket | default .Values.minio.bucket | default "grown-default" -}}
{{- end -}}

{{/* rustfs PVC size: rustfs.persistence.size, else the 0.1.x
     minio.persistence.size, else 20Gi. */}}
{{- define "grown.rustfsSize" -}}
{{- .Values.rustfs.persistence.size | default .Values.minio.persistence.size | default "20Gi" -}}
{{- end -}}

{{/* rustfs PVC storageClass: rustfs.persistence.storageClass, else global. */}}
{{- define "grown.rustfsStorageClass" -}}
{{- .Values.rustfs.persistence.storageClass | default .Values.storageClass -}}
{{- end -}}

{{/* S3 endpoint grown uses: bundled rustfs Service, or an external endpoint
     (rustfs.external.endpoint, falling back to the 0.1.x
     minio.external.endpoint). */}}
{{- define "grown.s3Endpoint" -}}
{{- if .Values.rustfs.enabled -}}
http://{{ include "grown.rustfsName" . }}.{{ .Release.Namespace }}.svc.cluster.local:{{ .Values.rustfs.port }}
{{- else -}}
{{ .Values.rustfs.external.endpoint | default .Values.minio.external.endpoint }}
{{- end -}}
{{- end -}}

{{/* Secret holding the S3 credentials (keys access_key / secret_key) that
     grown, the pdf app, rustfs itself and the storage Jobs read.
       - rustfs.existingSecret, when set
       - bundled rustfs: {release}-rustfs (generated once, lookup-preserved)
       - external S3:   {release}-s3 (from rustfs.external / minio keys) */}}
{{- define "grown.s3CredsSecret" -}}
{{- if .Values.rustfs.existingSecret -}}
{{ .Values.rustfs.existingSecret }}
{{- else if .Values.rustfs.enabled -}}
{{ include "grown.rustfsName" . }}
{{- else -}}
{{ .Release.Name }}-s3
{{- end -}}
{{- end -}}

{{/* Buckets the chart manages, as "src:dst" pairs for the MinIO -> rustfs
     migration (the app bucket keeps its MinIO name as the source). */}}
{{- define "grown.bucketPairs" -}}
{{- $pairs := list (printf "%s:%s" (.Values.minio.bucket | default (include "grown.bucket" .)) (include "grown.bucket" .)) -}}
{{- if .Values.pdf.enabled -}}
{{- $pairs = append $pairs (printf "%s:%s" .Values.pdf.bucket .Values.pdf.bucket) -}}
{{- end -}}
{{- join " " $pairs -}}
{{- end -}}

{{/* In-cluster Zitadel issuer used by grown (server-to-server). */}}
{{- define "grown.zitadelInternalURL" -}}
http://{{ .Release.Name }}-zitadel.{{ .Release.Namespace }}.svc.cluster.local:8080
{{- end -}}

{{/* Browser-facing issuer URL for the bundled Zitadel, derived from
     zitadel.externalDomain (+ externalSecure/externalPort). Empty when no
     external domain is configured. */}}
{{- define "grown.zitadelExternalURL" -}}
{{- if .Values.zitadel.externalDomain -}}
{{- $scheme := ternary "https" "http" (.Values.zitadel.externalSecure | toString | eq "true") -}}
{{- $port := .Values.zitadel.externalPort | toString -}}
{{- if or (and (eq $scheme "https") (eq $port "443")) (and (eq $scheme "http") (eq $port "80")) -}}
{{- printf "%s://%s" $scheme .Values.zitadel.externalDomain -}}
{{- else -}}
{{- printf "%s://%s:%s" $scheme .Values.zitadel.externalDomain $port -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* OIDC issuer handed to grown.
     - auth.mode=external           -> auth.external.issuer
     - bundled + zitadel.externalDomain set -> the browser-facing Zitadel URL
       (so the OIDC redirect to the issuer is reachable from the user's browser)
     - bundled, no externalDomain   -> in-cluster Zitadel Service URL (kind/local) */}}
{{- define "grown.oidcIssuer" -}}
{{- if eq .Values.auth.mode "external" -}}
{{ .Values.auth.external.issuer }}
{{- else if .Values.zitadel.externalDomain -}}
{{ include "grown.zitadelExternalURL" . }}
{{- else -}}
{{ include "grown.zitadelInternalURL" . }}
{{- end -}}
{{- end -}}

{{/* OIDC redirect URL (public) */}}
{{- define "grown.oidcRedirectURL" -}}
{{ include "grown.externalURL" . }}/api/v1/auth/callback
{{- end -}}

{{/* Resolved image pull secret name (existing, created, or empty) */}}
{{- define "grown.pullSecretName" -}}
{{- if .Values.imagePullSecrets.existingSecret -}}
{{ .Values.imagePullSecrets.existingSecret }}
{{- else if .Values.imagePullSecrets.create.enabled -}}
{{ .Values.imagePullSecrets.create.name }}
{{- end -}}
{{- end -}}

{{/* ---------------------------------------------------------------------
     Home Assistant (optional, bring-your-own is the primary path).
     --------------------------------------------------------------------- */}}

{{/* Home Assistant resource name. */}}
{{- define "grown.haName" -}}
{{ .Release.Name }}-homeassistant
{{- end -}}

{{/* Public hostname Home Assistant is served on: homeAssistant.host, else
     ha.<domain>. HA can't live under a sub-path, so it gets its own host. */}}
{{- define "grown.haHost" -}}
{{- .Values.homeAssistant.host | default (printf "ha.%s" .Values.domain) -}}
{{- end -}}

{{/* URL grown's Home Assistant tile defaults to (GROWN_HOMEASSISTANT_URL):
     homeAssistant.url, else <scheme>://<haHost>. */}}
{{- define "grown.haURL" -}}
{{- .Values.homeAssistant.url | default (printf "%s://%s" .Values.scheme (include "grown.haHost" .)) -}}
{{- end -}}

{{/* Secret holding the HA owner's username/password (onboarding sidecar):
     homeAssistant.owner.existingSecret, else {release}-homeassistant-owner
     (generated once, lookup-preserved). */}}
{{- define "grown.haOwnerSecret" -}}
{{- .Values.homeAssistant.owner.existingSecret | default (printf "%s-owner" (include "grown.haName" .)) -}}
{{- end -}}

{{/* In-cluster URL of the grown HA integration bundle (the HA pod fetches it
     on every start). */}}
{{- define "grown.haIntegrationURL" -}}
{{- .Values.homeAssistant.grownIntegration.url | default (printf "http://%s-grown.%s.svc.cluster.local:%v/integrations/homeassistant/grown.zip" .Release.Name .Release.Namespace .Values.grown.service.httpPort) -}}
{{- end -}}
