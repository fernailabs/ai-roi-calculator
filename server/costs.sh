#!/usr/bin/env bash
# Each assistant estimate in the last day, from the preview and the public
# service: time taken, tokens, and cost in USD, with a total. From Cloud Shell:  ./server/costs.sh   (or ./server/costs.sh 7d)
set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
: "${GCP_PROJECT:?Set GCP_PROJECT, or run: gcloud config set project YOUR_PROJECT}"

rows="$(gcloud logging read \
  "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=~\"^fernai-roi-assistant\" AND jsonPayload.event=\"estimate\"" \
  --project "$GCP_PROJECT" --freshness "${1:-1d}" --order asc \
  --format 'csv[no-heading](timestamp,jsonPayload.ms,jsonPayload.input_tokens,jsonPayload.output_tokens,jsonPayload.cost_usd,jsonPayload.model)')"

if [[ -z "$rows" ]]; then
  echo "No estimates logged yet. (Logs can take a minute to appear.)"
  exit 0
fi

printf '%-20s %7s %8s %8s %9s  %s\n' "time (UTC)" "secs" "in" "out" "cost" "model"
echo "$rows" | awk -F, '{
  n++; total += $5
  printf "%-20s %7.1f %8d %8d %9s  %s\n", substr($1,1,19), $2/1000, $3, $4, sprintf("$%.4f", $5), $6
} END {
  printf "\n%d estimates, total $%.4f, average $%.4f\n", n, total, total/n
}'
