# AI ROI Calculator

A small, static, no-build calculator that estimates the monthly return on
adopting AI tools for a team, and compares API token costs across current
frontier models from Anthropic, OpenAI, Google, xAI, and Meta (via a hosted
provider, since Meta doesn't sell first-party per-token API access).

Built by [FernAI](https://fernai.uk) to drive traffic to the site — not a
commercial product.

## How it works

- `index.html` / `css/styles.css` / `js/app.js` — the calculator itself.
  Plain HTML/CSS/JS, no build step, no framework, no dependencies.
- `data/prices.json` — a curated list of model token prices (USD per 1M
  input/output tokens), regenerated weekly.
- `scripts/normalise-prices.mjs` — pulls the curated model list's prices out
  of [BerriAI/litellm](https://github.com/BerriAI/litellm)'s community-maintained
  pricing catalogue and writes `data/prices.json`. Run manually with
  `node scripts/normalise-prices.mjs`.
- `.github/workflows/refresh-prices.yml` — runs the script weekly (and on
  demand) and commits `data/prices.json` if prices changed.
- `.github/workflows/deploy-pages.yml` — deploys the site to GitHub Pages on
  every push to `main`.

## Updating the model list

`scripts/normalise-prices.mjs` has a `CURATED_MODELS` array mapping our
model IDs to LiteLLM's catalogue keys. When a vendor ships a new generation,
add/replace the entry there — the list is deliberately hand-maintained
rather than "pick whatever's newest," since vendor naming (dated snapshots,
`-latest` aliases, preview tags) is too inconsistent to infer reliably.

## Local development

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

No build step — just serve the directory.

## Deploying

Push to `main`. GitHub Actions builds nothing and deploys the repository
root straight to GitHub Pages. Enable Pages once, under
**Settings → Pages → Source: GitHub Actions**.

## Disclaimer

Figures are illustrative estimates, not quotes. Token prices are vendor
list prices with no volume/committed-use discount applied, refreshed
weekly — treat as indicative. GBP conversion uses a fixed approximate rate,
not a live feed.
