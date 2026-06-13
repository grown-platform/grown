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

{{/* S3 endpoint grown uses (bundled MinIO service, or external) */}}
{{- define "grown.s3Endpoint" -}}
{{- if .Values.minio.enabled -}}
http://{{ .Release.Name }}-minio.{{ .Release.Namespace }}.svc.cluster.local:{{ .Values.minio.apiPort }}
{{- else -}}
{{ .Values.minio.external.endpoint }}
{{- end -}}
{{- end -}}

{{/* In-cluster Zitadel issuer used by grown (server-to-server). */}}
{{- define "grown.zitadelInternalURL" -}}
http://{{ .Release.Name }}-zitadel.{{ .Release.Namespace }}.svc.cluster.local:8080
{{- end -}}

{{/* OIDC issuer handed to grown. External issuer when auth.mode=external,
     bundled Zitadel internal URL otherwise. */}}
{{- define "grown.oidcIssuer" -}}
{{- if eq .Values.auth.mode "external" -}}
{{ .Values.auth.external.issuer }}
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
