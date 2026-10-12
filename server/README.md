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

## Deploying from Cloud Shell

Everything below runs in **Cloud Shell**, the terminal in the Google Cloud
console (the `>_` icon at the top right). It already has `gcloud` and `git`,
and the image is built by Cloud Build, so nothing needs installing.

Before you start, create an Anthropic API key at
<https://console.anthropic.com>, ideally in its own workspace with a monthly
spend limit. The service has its own daily cap (see Configuration), but the
Console limit is the hard ceiling.

### 1. Get the code and choose the project

```bash
git clone https://github.com/fernailabs/ai-roi-calculator.git
cd ai-roi-calculator
gcloud config set project fernai-roicalc
```

(While these changes are unmerged, add
`git checkout claude/fernai-roi-calculator-branding-2azxgb` after `cd`.)

### 2. One-time setup

```bash
./server/setup-gcp.sh
```

This enables the Google Cloud services it needs, creates the
`fernai-roi-assistant` service account, lets Cloud Build build from source,
and asks you to paste the API key. The key isn't shown as you paste it and is
stored only in Secret Manager. It's safe to run again; run it again to replace
the key.

### 3. Deploy a private preview and try it

```bash
PREVIEW=1 ./server/deploy.sh
```

The first deploy takes a few minutes, and may ask to create an Artifact
Registry repository: answer `y`. This deploys a separate
`fernai-roi-assistant-preview` service that also serves the calculator page
with the assistant switched on. It is private: only accounts with Cloud Run
access to the project, such as yours, can open it. To open it:

```bash
gcloud run services proxy fernai-roi-assistant-preview --region europe-west2 --port 8080
```

Then click **Web Preview** (the eye-shaped icon above the terminal) and
**Preview on port 8080**. Try some descriptions. Press Ctrl+C in the terminal
to stop the proxy.

To see what each estimate cost:

```bash
./server/costs.sh        # the last day; ./server/costs.sh 7d for a week
```

```
time (UTC)              secs       in      out      cost  model
2026-10-12T15:01:02     14.2     1650     1240   $0.0314  claude-opus-5-5

1 estimates, total $0.0314, average $0.0314
```

To compare cheaper settings, redeploy the preview with, for example,
`CLAUDE_EFFORT=low PREVIEW=1 ./server/deploy.sh` or
`CLAUDE_MODEL=claude-sonnet-5-5 PREVIEW=1 ./server/deploy.sh`, then try the
same descriptions again. The average cost per estimate × the visitors you
expect to use the panel gives the monthly budget.

### 4. Go live

```bash
./server/deploy.sh
```

This deploys the public `fernai-roi-assistant` service, which only answers
the calculator's own sites (see `ALLOWED_ORIGINS`) and doesn't serve the page.
It prints the service URL: put it in `index.html`,

```html
<meta name="fernai-assistant-url" content="https://fernai-roi-assistant-xxxx.a.run.app">
```

and merge to `main`. The page redeploys with the panel visible. Leave the URL
empty to hide the panel again; the rest of the calculator works without the
service. Once live, you can delete the preview service in the Cloud Run
console, or keep it for trying changes.

Re-run the deploy after changing anything in `server/` or
`data/assumptions.json`.

## Running it on your own computer

The same preview runs locally with Node.js 22, without Google Cloud:

```bash
cd server
npm ci
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

Open <http://localhost:8080>. The terminal prints each estimate's time, tokens
and cost. This also works inside Cloud Shell, using Web Preview on port 8080.

## Running the tests

```bash
cd server
npm ci
npm test
```

The tests use a stand-in for the Claude client, so they need no API key and
make no network calls. CI runs them on every pull request.

## Configuration

Set as environment variables by `deploy.sh`. Override any of them when
running it, e.g. `CLAUDE_EFFORT=low ./server/deploy.sh`.

| Variable | Default | What it does |
|---|---|---|
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used for estimates. |
| `CLAUDE_EFFORT` | `medium` | `low` is faster and cheaper; `high` thinks harder. |
| `ALLOWED_ORIGINS` | fernai.co.uk, www.fernai.co.uk, fernailabs.github.io | Sites allowed to call the service. Add the domain the calculator is embedded on if it's different. |
| `RATE_PER_MINUTE` | `3` | Requests per visitor (IP address) per minute. |
| `RATE_PER_DAY` | `15` | Requests per visitor per day. |
| `DAILY_REQUEST_LIMIT` | `500` | Requests across all visitors per day, per instance; after that the panel says to fill the form in by hand. |
| `TURNSTILE` | `0` | `1` requires a Cloudflare Turnstile check (see below). |
| `PREVIEW` | `0` | `1` deploys the private `fernai-roi-assistant-preview` service, which also serves the page and accepts any origin. |

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
   read -rs TURNSTILE_SECRET   # paste the secret, then Enter
   GCP_PROJECT=$(gcloud config get-value project)
   printf %s "$TURNSTILE_SECRET" | gcloud secrets create turnstile-secret --data-file=- --project "$GCP_PROJECT"
   gcloud secrets add-iam-policy-binding turnstile-secret \
     --member "serviceAccount:fernai-roi-assistant@${GCP_PROJECT}.iam.gserviceaccount.com" \
     --role roles/secretmanager.secretAccessor --project "$GCP_PROJECT"
   ```
3. Redeploy with `TURNSTILE=1 ./server/deploy.sh`.
4. Put the site key in `index.html`'s `fernai-turnstile-sitekey` meta tag.

## Privacy

Descriptions are sent to Anthropic's API to produce the estimate. The service
does not store them or write them to its logs; it logs only their length,
timing and token counts. The panel asks visitors not to include names or
anything confidential. Mention this processing in FernAI's privacy notice
before switching the panel on.
