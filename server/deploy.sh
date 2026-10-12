#!/usr/bin/env bash
# Build and deploy the assistant to Cloud Run from the repository root.
# One-time setup (project, APIs, the API key secret) is in server/README.md.
#
#   GCP_PROJECT=my-project ./server/deploy.sh
#
# Optional: GCP_REGION (default europe-west2, London), SERVICE (default
# fernai-roi-assistant), ALLOWED_ORIGINS, CLAUDE_MODEL, CLAUDE_EFFORT,
# RATE_PER_MINUTE, RATE_PER_DAY, DAILY_REQUEST_LIMIT, and TURNSTILE=1 to
# require the Cloudflare Turnstile check (needs the turnstile-secret secret).
set -euo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT to your Google Cloud project ID}"
REGION="${GCP_REGION:-europe-west2}"
SERVICE="${SERVICE:-fernai-roi-assistant}"

cd "$(dirname "$0")/.."

env_vars="CLAUDE_MODEL=${CLAUDE_MODEL:-claude-opus-5-5},CLAUDE_EFFORT=${CLAUDE_EFFORT:-medium}"
env_vars+=",RATE_PER_MINUTE=${RATE_PER_MINUTE:-3},RATE_PER_DAY=${RATE_PER_DAY:-15},DAILY_REQUEST_LIMIT=${DAILY_REQUEST_LIMIT:-500}"
# Commas separate --set-env-vars entries, so the origin list uses gcloud's
# alternative-delimiter syntax (^;^) with semicolons between origins.
origins="${ALLOWED_ORIGINS:-https://fernai.co.uk,https://www.fernai.co.uk,https://fernailabs.github.io}"
env_vars="^;^${env_vars//,/;};ALLOWED_ORIGINS=${origins}"

secrets="ANTHROPIC_API_KEY=anthropic-api-key:latest"
if [[ "${TURNSTILE:-0}" == "1" ]]; then
  secrets+=",TURNSTILE_SECRET=turnstile-secret:latest"
fi

gcloud run deploy "$SERVICE" \
  --project "$GCP_PROJECT" \
  --region "$REGION" \
  --source . \
  --allow-unauthenticated \
  --service-account "${SERVICE}@${GCP_PROJECT}.iam.gserviceaccount.com" \
  --set-env-vars "$env_vars" \
  --set-secrets "$secrets" \
  --cpu 1 --memory 256Mi \
  --concurrency 20 \
  --min-instances 0 --max-instances 2 \
  --timeout 90

echo
echo "Deployed. Put this URL in index.html's fernai-assistant-url meta tag:"
gcloud run services describe "$SERVICE" --project "$GCP_PROJECT" --region "$REGION" --format 'value(status.url)'
