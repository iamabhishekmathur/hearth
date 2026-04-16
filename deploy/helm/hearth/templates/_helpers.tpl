{{/*
Expand the name of the chart.
*/}}
{{- define "hearth.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
*/}}
{{- define "hearth.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "hearth.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "hearth.labels" -}}
helm.sh/chart: {{ include "hearth.chart" . }}
{{ include "hearth.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "hearth.selectorLabels" -}}
app.kubernetes.io/name: {{ include "hearth.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Require a secret value to be set — fail at template render time if empty.
Usage: {{ include "hearth.requireSecret" (dict "name" "ENCRYPTION_KEY" "value" .Values.secrets.encryptionKey) }}
*/}}
{{- define "hearth.requireSecret" -}}
{{- if not .value }}
{{- fail (printf "ERROR: .Values.secrets.%s must be set for production deployment" .name) }}
{{- end }}
{{- end }}
