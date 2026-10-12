#!/usr/bin/env bash
# One-time Google Cloud setup for the assistant. Safe to run again: each step
# skips what already exists. Run from Cloud Shell:
#
#   gcloud config set project YOUR_PROJECT
#   ./server/setup-gcp.sh
#
# It asks for the Anthropic API key without echoing it, and stores it only in
# Secret Manager.
set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
: "${GCP_PROJECT:?Set GCP_PROJECT, or run: gcloud config set project YOUR_PROJECT}"
SA_NAME="fernai-roi-assistant"
SA="${SA_NAME}@${GCP_PROJECT}.iam.gserviceaccount.com"
P=(--project "$GCP_PROJECT")

echo "Setting up $GCP_PROJECT"

echo "1/4 Enabling Cloud Run, Cloud Build, Artifact Registry and Secret Manager (takes a minute the first time)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com "${P[@]}"

echo "2/4 Service account the assistant runs as"
if ! gcloud iam service-accounts describe "$SA" "${P[@]}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --display-name "FernAI ROI assistant" "${P[@]}"
fi

echo "3/4 Letting Cloud Build build from source"
# Source deploys build as the Compute Engine default service account, which
# newer projects don't give build permissions by default.
number="$(gcloud projects describe "$GCP_PROJECT" --format 'value(projectNumber)')"
gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
  --member "serviceAccount:${number}-compute@developer.gserviceaccount.com" \
  --role roles/run.builder --condition None >/dev/null

echo "4/4 Anthropic API key in Secret Manager"
if gcloud secrets describe anthropic-api-key "${P[@]}" >/dev/null 2>&1; then
  read -rp "    A key is already stored. Replace it? [y/N] " replace
else
  gcloud secrets create anthropic-api-key --replication-policy automatic "${P[@]}" >/dev/null
  replace=y
fi
if [[ "$replace" =~ ^[Yy]$ ]]; then
  read -rsp "    Paste the Anthropic API key (it won't be shown), then press Enter: " key
  echo
  [[ "$key" == sk-ant-* ]] || { echo "    That doesn't look like an Anthropic key (sk-ant-...). Nothing saved."; exit 1; }
  printf %s "$key" | gcloud secrets versions add anthropic-api-key --data-file=- "${P[@]}" >/dev/null
  unset key
  echo "    Saved."
fi
gcloud secrets add-iam-policy-binding anthropic-api-key \
  --member "serviceAccount:${SA}" --role roles/secretmanager.secretAccessor "${P[@]}" >/dev/null

echo
echo "Done. Next: PREVIEW=1 ./server/deploy.sh"
