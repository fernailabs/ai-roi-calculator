# AI ROI Calculator

A small, static, no-build calculator that estimates the monthly return on
adopting AI tools for a team. It compares per-seat subscriptions (ChatGPT,
Claude, Copilot, Gemini) and pay-as-you-go API costs across current frontier
models from Anthropic, OpenAI, Google, xAI and Meta (via a hosted provider,
since Meta doesn't sell first-party per-token API access).

Visitors describe their team in terms they know — a role, headcount, the
kinds of work — rather than tokens. An optional AI assistant can fill the
form in from a plain-English description.

A free tool from [FernAI](https://fernai.co.uk), hosted on the FernAI website —
not a commercial product.

## How it works

- `index.html` / `css/styles.css` / `js/app.js` — the calculator itself.
  Plain HTML/CSS/JS, no build step, no framework, no dependencies.
- `js/calc.js` — the arithmetic, kept separate from the page so it's tested
  on its own.
- `data/assumptions.json` — hand-maintained starting assumptions: role
  presets, the kinds of work (each with typical requests and tokens), and
  seat-plan list prices. Check seat prices against the vendors' pages every
  few months and update `reviewedOn`; the page shows that date.
- `server/` — the optional "Describe your team" assistant, a small Cloud Run
  service that calls Claude. See [server/README.md](server/README.md) for
  setup and costs. The page works without it; the panel stays hidden until
  its URL is set in `index.html`.
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

## Linking from fernai.co.uk (recommended)

fernai.co.uk's managed WordPress strips `<script>` tags, so an embedded frame
can't resize to fit the calculator and shows empty space or cuts it off.
Instead, the WordPress page introduces the calculator and links to it
full-page, where it works on every screen size. Paste into a Custom HTML
block:

```html
<p><a href="https://roi.fernai.co.uk/"
      style="display:inline-block;background:#ec3013;color:#fff;padding:14px 22px;
             font-weight:700;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none">
  Open the AI ROI calculator &rarr;</a></p>
```

### Serving it at roi.fernai.co.uk

1. In the DNS for fernai.co.uk, add a `CNAME` record: name `roi`, value
   `fernailabs.github.io`.
2. In this repository on GitHub, **Settings → Pages → Custom domain**, enter
   `roi.fernai.co.uk` and save. Once the DNS check passes (minutes to a few
   hours), tick **Enforce HTTPS**.
3. The assistant service already allows `https://roi.fernai.co.uk`.

GitHub then redirects `fernailabs.github.io/ai-roi-calculator/` to the new
address, so existing links keep working. Until the domain is set up, link to
`https://fernailabs.github.io/ai-roi-calculator/` instead.

## Embedding in other sites

Where the host page can run a script, the calculator can also be embedded in
an iframe. Query parameters:

| Parameter     | Effect                                                          |
|---------------|-----------------------------------------------------------------|
| `embed=1`     | Hides the header bar and footer (the host page supplies those). |
| `theme=light` / `theme=dark` | Pins the theme, overriding the visitor's saved choice. |

In embed mode the page posts its content height to the parent so the frame
can grow to fit without an inner scrollbar. Paste this into the website
(e.g. a WordPress *Custom HTML* block):

```html
<iframe id="fernai-roi-calc"
        src="https://fernailabs.github.io/ai-roi-calculator/?embed=1"
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

The "Describe your team" assistant works inside the iframe without changes:
its requests come from the calculator's own address (`fernailabs.github.io`),
which the assistant service already allows. If you serve the calculator from
a different address, such as a `roi.fernai.co.uk` subdomain, redeploy the
service with that address added:
`ALLOWED_ORIGINS=https://roi.fernai.co.uk,https://fernailabs.github.io ./server/deploy.sh`.

## Updating the model list

`scripts/normalise-prices.mjs` has a `CURATED_MODELS` array mapping our
model IDs to LiteLLM's catalogue keys. When a vendor ships a new generation,
add/replace the entry there — the list is deliberately hand-maintained
rather than "pick whatever's newest," since vendor naming (dated snapshots,
`-latest` aliases, preview tags) is too inconsistent to infer reliably.

If LiteLLM drops a key (a model is retired or renamed), the weekly run keeps
that model's last published price, posts a "Stale price" warning on the
Actions run, and still updates every other model. Check the run summary from
time to time and swap in the new key when that warning appears.

## Local development

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

No build step — just serve the directory. Tests for the maths and the
assistant service: `cd server && npm ci && npm test`.

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
