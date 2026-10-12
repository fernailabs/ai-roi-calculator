#!/usr/bin/env bash
# Build and deploy the assistant to Cloud Run. Run from Cloud Shell (or
# anywhere with gcloud) after the one-time ./server/setup-gcp.sh.
#
#   PREVIEW=1 ./server/deploy.sh   private preview: also serves the calculator
#                                  page, only reachable by you (see README)
#   ./server/deploy.sh             public: the API the live page calls
#
# The project is GCP_PROJECT, or gcloud's current project. Optional:
# GCP_REGION (default europe-west2, London), ALLOWED_ORIGINS, CLAUDE_MODEL, CLAUDE_EFFORT,
# RATE_PER_MINUTE, RATE_PER_DAY, DAILY_REQUEST_LIMIT, and TURNSTILE=1 to
# require the Cloudflare Turnstile check (needs the turnstile-secret secret).
set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
: "${GCP_PROJECT:?Set GCP_PROJECT, or run: gcloud config set project YOUR_PROJECT}"
REGION="${GCP_REGION:-europe-west2}"
PREVIEW="${PREVIEW:-0}"
# The preview is a separate Cloud Run service, so it can never become the
# public one by accident. Both run as the same service account.
if [[ "$PREVIEW" == "1" ]]; then SERVICE="fernai-roi-assistant-preview"; else SERVICE="fernai-roi-assistant"; fi
SA="fernai-roi-assistant@${GCP_PROJECT}.iam.gserviceaccount.com"

cd "$(dirname "$0")/.."

env_vars="CLAUDE_MODEL=${CLAUDE_MODEL:-claude-opus-5-5},CLAUDE_EFFORT=${CLAUDE_EFFORT:-medium}"
env_vars+=",RATE_PER_MINUTE=${RATE_PER_MINUTE:-3},RATE_PER_DAY=${RATE_PER_DAY:-15},DAILY_REQUEST_LIMIT=${DAILY_REQUEST_LIMIT:-500}"
env_vars+=",PREVIEW=${PREVIEW}"
# Commas separate --set-env-vars entries, so the origin list uses gcloud's
# alternative-delimiter syntax (^;^) with semicolons between entries.
origins="${ALLOWED_ORIGINS:-https://fernai.co.uk,https://www.fernai.co.uk,https://roi.fernai.co.uk,https://fernailabs.github.io}"
env_vars="^;^${env_vars//,/;};ALLOWED_ORIGINS=${origins}"

secrets="ANTHROPIC_API_KEY=anthropic-api-key:latest"
if [[ "${TURNSTILE:-0}" == "1" ]]; then
  secrets+=",TURNSTILE_SECRET=turnstile-secret:latest"
fi

# A preview accepts requests from any origin, so it is never public: only
# accounts with Cloud Run Invoker (you, as project owner) can reach it.
#
# The public service turns off Cloud Run's invoker check rather than granting
# "allUsers" access: Google Cloud organisations created since 2024 block
# allUsers by default (domain restricted sharing), and when they do,
# --allow-unauthenticated only warns and leaves the service private, so
# browsers get "Failed to fetch".
if [[ "$PREVIEW" == "1" ]]; then
  access=(--invoker-iam-check --no-allow-unauthenticated)
  echo "Deploying a PRIVATE preview of $SERVICE to $GCP_PROJECT ($REGION)."
else
  access=(--no-invoker-iam-check)
  echo "Deploying $SERVICE to $GCP_PROJECT ($REGION) as a PUBLIC API for: $origins"
fi

gcloud run deploy "$SERVICE" \
  --project "$GCP_PROJECT" \
  --region "$REGION" \
  --source . \
  "${access[@]}" \
  --service-account "$SA" \
  --set-env-vars "$env_vars" \
  --set-secrets "$secrets" \
  --cpu 1 --memory 256Mi \
  --concurrency 20 \
  --min-instances 0 --max-instances 2 \
  --timeout 90

url="$(gcloud run services describe "$SERVICE" --project "$GCP_PROJECT" --region "$REGION" --format 'value(status.url)')"
echo
if [[ "$PREVIEW" == "1" ]]; then
  cat <<MSG
Preview deployed. To open it:

  gcloud run services proxy $SERVICE --project $GCP_PROJECT --region $REGION --port 8080

then click Web Preview (the eye-shaped icon above the terminal) > Preview on port 8080.
Costs per estimate:  ./server/costs.sh
MSG
else
  echo "Deployed at $url"
  echo -n "Health check:          "
  curl -s --max-time 30 "$url/api/health" || echo -n "no response"
  echo
  # The same preflight a browser sends before calling the API from the
  # calculator page (the last allowed origin: the GitHub Pages address).
  check_origin="${origins##*,}"
  echo -n "Browser access check:  "
  status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -X OPTIONS "$url/api/estimate" \
    -H "Origin: $check_origin" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type")"
  if [[ "$status" == "204" ]]; then echo "OK (from $check_origin)"; else echo "FAILED (HTTP $status from $check_origin)"; fi
  echo "index.html's fernai-assistant-url meta tag must point at this service."
fi
