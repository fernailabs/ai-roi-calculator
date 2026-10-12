# AI ROI Calculator

A small, static, no-build calculator that estimates the monthly return on
adopting AI tools for a team, and compares API token costs across current
frontier models from Anthropic, OpenAI, Google, xAI, and Meta (via a hosted
provider, since Meta doesn't sell first-party per-token API access).

A free tool from [FernAI](https://fernai.co.uk), hosted on the FernAI website —
not a commercial product.

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

## Branding

The look matches FernAI's public brand system — the same token set as the
Value Discovery app (`fernailabs/fernai`, `value-discovery/frontend/src/theme.css`,
ADR 0004): FernAI navy `#0f172a` and red `#ec3013`, Archivo as the only
typeface, square corners everywhere, two rule weights, and the inline SVG
wordmark. Light is the default theme; dark is a toggle. Copy is British English.
If the brand tokens change there, copy the `:root` and `[data-theme="dark"]`
blocks at the top of `css/styles.css` across.

## Embedding on fernai.co.uk

The page can be linked to directly, or embedded in an iframe on any page of
the website. Query parameters:

| Parameter     | Effect                                                          |
|---------------|-----------------------------------------------------------------|
| `embed=1`     | Hides the header bar and footer (the host page supplies those). |
| `theme=light` / `theme=dark` | Pins the theme, overriding the visitor's saved choice. |

In embed mode the page posts its content height to the parent so the frame
can grow to fit without an inner scrollbar. Paste this into the website
(e.g. a WordPress *Custom HTML* block), replacing the `src` with wherever
the calculator is deployed:

```html
<iframe id="fernai-roi-calc"
        src="https://CALCULATOR-URL/?embed=1"
        title="AI ROI Calculator"
        style="width:100%;border:0;min-height:1400px"
        loading="lazy"></iframe>
<script>
  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "fernai-roi-calc:height") {
      document.getElementById("fernai-roi-calc").style.height = e.data.height + "px";
    }
  });
</script>
```

Links inside the calculator (the CTA and footer) open in the top window, so a
visitor clicking through leaves the iframe rather than loading the site inside it.

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

To serve it from a FernAI subdomain (e.g. `roi.fernai.co.uk`), set the custom
domain under **Settings → Pages** and add a `CNAME` DNS record pointing at
`fernailabs.github.io`. All asset paths are relative, so the site also works
from any sub-path if it's copied into the website's own hosting instead.

## Disclaimer

Figures are illustrative estimates, not quotes. Token prices are vendor
list prices with no volume/committed-use discount applied, refreshed
weekly — treat as indicative. GBP conversion uses a fixed approximate rate,
not a live feed.
