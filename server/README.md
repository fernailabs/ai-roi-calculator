# "Describe your team" assistant

A small service behind the calculator's optional **Describe your team** panel.
A visitor types a few sentences about their team; the service asks Claude to
turn that into the calculator's inputs (role, headcount, hourly cost, hours,
time saved, seats or pay-as-you-go, and the kinds of work) with a one-line
reason for each. The page fills in the form and does all the arithmetic itself.

- `src/estimate.mjs`: the prompt, the JSON schema Claude must answer in, and
  `sanitise()`, which clamps every number to a sensible range and drops
  anything unknown before it reaches the page.
- `src/app.mjs`: the HTTP endpoint (`POST /api/estimate`, `GET /healthz`),
  allowed origins (CORS), body and length limits.
- `src/guards.mjs`: per-visitor and daily rate limits; optional Cloudflare
  Turnstile bot check.
- `src/index.mjs`: reads configuration from environment variables.

It reads `data/assumptions.json`, the same file the page uses, so the roles
and task types can't drift apart. That's why the `Dockerfile` sits at the
repository root.

## Try it on your own computer first

You can use the assistant locally with real Claude calls before deploying
anything or setting a budget. You need [Node.js 22](https://nodejs.org) and an
Anthropic API key from <https://console.anthropic.com>. For testing, create a
workspace with a small spend limit, such as $5, and a key in it.

```bash
git clone https://github.com/fernailabs/ai-roi-calculator.git
cd ai-roi-calculator/server
npm ci
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

Open <http://localhost:8080>. The "Describe your team" panel is switched on,
and the terminal prints each estimate's time, token counts and cost, with a
running average:

```
estimate  #1  ·  14.2s  ·  1650 in  ·  1240 out (incl. thinking)  ·  $0.0314  ·  session total $0.0314  ·  average $0.0314
```

To compare cheaper settings, stop it (Ctrl+C) and start it again with, for
example, `CLAUDE_EFFORT=low` or `CLAUDE_MODEL=claude-sonnet-5-5` in front of
`npm run dev`. The average cost per estimate × the visitors you expect gives
you the monthly budget; the [Cost](#cost) section below has more on this.

On Windows PowerShell, set the key first with
`$env:ANTHROPIC_API_KEY="sk-ant-..."` and then run `npm run dev`.

## Running the tests

```bash
cd server
npm ci
npm test
```

The tests use a stand-in for the Claude client, so they need no API key and
make no network calls. CI runs them on every pull request.

## One-time setup

You need a Google Cloud project with billing enabled, the `gcloud` CLI, and an
Anthropic API key from <https://console.anthropic.com>.

1. **Set a spend limit on the Anthropic key.** In the Anthropic Console, give
   this key its own workspace with a monthly spend limit. The service has its
   own daily cap (below), but the Console limit is the hard ceiling.

2. **Enable the APIs and create a service account:**

   ```bash
   export GCP_PROJECT=your-project-id
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
     artifactregistry.googleapis.com secretmanager.googleapis.com --project "$GCP_PROJECT"
   gcloud iam service-accounts create fernai-roi-assistant \
     --display-name "FernAI ROI assistant" --project "$GCP_PROJECT"
   ```

3. **Store the API key in Secret Manager** (it is never put in the image,
   the repository or an environment file):

   ```bash
   read -rs ANTHROPIC_KEY   # paste the key, then Enter
   printf %s "$ANTHROPIC_KEY" | gcloud secrets create anthropic-api-key \
     --data-file=- --project "$GCP_PROJECT"
   gcloud secrets add-iam-policy-binding anthropic-api-key \
     --member "serviceAccount:fernai-roi-assistant@${GCP_PROJECT}.iam.gserviceaccount.com" \
     --role roles/secretmanager.secretAccessor --project "$GCP_PROJECT"
   ```

4. **Deploy** from the repository root:

   ```bash
   GCP_PROJECT=your-project-id ./server/deploy.sh
   ```

   It builds with Cloud Build, deploys to Cloud Run in `europe-west2`
   (London), and prints the service URL.

5. **Switch the panel on.** Put that URL in `index.html`:

   ```html
   <meta name="fernai-assistant-url" content="https://fernai-roi-assistant-xxxx.a.run.app">
   ```

   Merge to `main` and the page redeploys with the panel visible. Leave the
   URL empty to hide the panel again; the rest of the calculator works
   without the service.

Re-run `./server/deploy.sh` after changing anything in `server/` or
`data/assumptions.json`.

## Configuration

Set as environment variables by `deploy.sh`. Override any of them when
running it, e.g. `CLAUDE_EFFORT=low GCP_PROJECT=… ./server/deploy.sh`.

| Variable | Default | What it does |
|---|---|---|
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used for estimates. |
| `CLAUDE_EFFORT` | `medium` | `low` is faster and cheaper; `high` thinks harder. |
| `ALLOWED_ORIGINS` | fernai.co.uk, www.fernai.co.uk, fernailabs.github.io | Sites allowed to call the service. Add the domain the calculator is embedded on if it's different. |
| `RATE_PER_MINUTE` | `3` | Requests per visitor (IP address) per minute. |
| `RATE_PER_DAY` | `15` | Requests per visitor per day. |
| `DAILY_REQUEST_LIMIT` | `500` | Requests across all visitors per day, per instance; after that the panel says to fill the form in by hand. |
| `TURNSTILE` | `0` | `1` requires a Cloudflare Turnstile check (see below). |

Counters are kept in memory per instance and `deploy.sh` caps the service at
two instances, so the effective limits are at most double the figures above.

## Cost

Each estimate sends roughly 1,600 tokens and gets back a few hundred, plus
the model's thinking. On Claude Opus 5.5 ($4 in / $20 out per million tokens)
that is roughly **$0.03 to $0.06 per estimate**: about $30 to $60 for 1,000
visitors who use it. The default daily cap of 500 per instance bounds the
worst case at about $30 to $60 a day. These are estimates; the service logs
`input_tokens` and `output_tokens` for every request, so check the real figures
in Cloud Logging after launch.

To spend less, set `CLAUDE_EFFORT=low`, or `CLAUDE_MODEL=claude-sonnet-5-5`
($2 / $10 per million tokens, roughly half the cost). Cloud Run itself scales
to zero when idle and costs pennies at this volume.

## Optional: Cloudflare Turnstile

If the panel attracts automated abuse, add Turnstile, a free bot check that
is usually invisible to people:

1. Create a Turnstile widget in Cloudflare for your calculator's domain.
2. Store its secret key:
   ```bash
   printf %s "$TURNSTILE_SECRET" | gcloud secrets create turnstile-secret --data-file=- --project "$GCP_PROJECT"
   gcloud secrets add-iam-policy-binding turnstile-secret \
     --member "serviceAccount:fernai-roi-assistant@${GCP_PROJECT}.iam.gserviceaccount.com" \
     --role roles/secretmanager.secretAccessor --project "$GCP_PROJECT"
   ```
3. Redeploy with `TURNSTILE=1 GCP_PROJECT=… ./server/deploy.sh`.
4. Put the site key in `index.html`'s `fernai-turnstile-sitekey` meta tag.

## Privacy

Descriptions are sent to Anthropic's API to produce the estimate. The service
does not store them or write them to its logs; it logs only their length,
timing and token counts. The panel asks visitors not to include names or
anything confidential. Mention this processing in FernAI's privacy notice
before switching the panel on.
