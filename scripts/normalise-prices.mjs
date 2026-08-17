#!/usr/bin/env node
// Pulls per-token pricing for a curated set of frontier models out of
// LiteLLM's community-maintained pricing catalogue and writes it into the
// flat shape the calculator's front end reads (data/prices.json).
//
// Why curated rather than "grab whatever's newest": vendors ship new model
// generations often and name them inconsistently (dated snapshots, "-latest"
// aliases, preview tags). A fixed list of litellm keys is predictable to
// update by hand and never silently swaps in a model nobody chose.
//
// Meta doesn't sell first-party per-token API access to Llama's flagship
// weights, so its entries are priced via a third-party host (Groq) and
// labelled as such.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SOURCE_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const CURATED_MODELS = [
  {
    id: "claude-opus-5",
    vendor: "Anthropic",
    tier: "flagship",
    label: "Claude Opus 5",
    litellmKey: "claude-opus-5",
  },
  {
    id: "claude-haiku-4-5",
    vendor: "Anthropic",
    tier: "efficient",
    label: "Claude Haiku 4.5",
    litellmKey: "claude-haiku-4-5",
  },
  {
    id: "gpt-5.2",
    vendor: "OpenAI",
    tier: "flagship",
    label: "GPT-5.2",
    litellmKey: "gpt-5.2",
  },
  {
    id: "gpt-5-mini",
    vendor: "OpenAI",
    tier: "efficient",
    label: "GPT-5 mini",
    litellmKey: "gpt-5-mini",
  },
  {
    id: "gemini-3-pro-preview",
    vendor: "Google",
    tier: "flagship",
    label: "Gemini 3 Pro",
    litellmKey: "gemini-3-pro-preview",
  },
  {
    id: "gemini-3.1-flash-lite",
    vendor: "Google",
    tier: "efficient",
    label: "Gemini 3.1 Flash Lite",
    litellmKey: "gemini-3.1-flash-lite",
  },
  {
    id: "grok-4.5",
    vendor: "xAI",
    tier: "flagship",
    label: "Grok 4.5",
    litellmKey: "xai/grok-4.5",
  },
  {
    id: "grok-4-1-fast",
    vendor: "xAI",
    tier: "efficient",
    label: "Grok 4.1 Fast",
    litellmKey: "xai/grok-4-1-fast",
  },
  {
    id: "llama-4-maverick",
    vendor: "Meta",
    tier: "flagship",
    label: "Llama 4 Maverick",
    litellmKey: "groq/meta-llama/llama-4-maverick-17b-128e-instruct",
    hostNote: "via Groq",
  },
  {
    id: "llama-4-scout",
    vendor: "Meta",
    tier: "efficient",
    label: "Llama 4 Scout",
    litellmKey: "groq/meta-llama/llama-4-scout-17b-16e-instruct",
    hostNote: "via Groq",
  },
];

function perMillion(costPerToken) {
  if (typeof costPerToken !== "number") return null;
  const perM = costPerToken * 1_000_000;
  // 4 sig figs is plenty of precision for an estimate; avoids float noise.
  return Number(perM.toPrecision(4));
}

async function main() {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch pricing source: ${res.status} ${res.statusText}`);
  }
  const catalogue = await res.json();

  const models = CURATED_MODELS.map((m) => {
    const entry = catalogue[m.litellmKey];
    if (!entry) {
      throw new Error(
        `litellm key "${m.litellmKey}" for ${m.id} not found in source catalogue — ` +
          `the model may have been renamed or retired. Update CURATED_MODELS.`
      );
    }
    const inputPer1m = perMillion(entry.input_cost_per_token);
    const outputPer1m = perMillion(entry.output_cost_per_token);
    if (inputPer1m == null || outputPer1m == null) {
      throw new Error(`litellm key "${m.litellmKey}" for ${m.id} has no usable pricing`);
    }
    return {
      id: m.id,
      vendor: m.vendor,
      tier: m.tier,
      label: m.label,
      hostNote: m.hostNote ?? null,
      inputPer1mUsd: inputPer1m,
      outputPer1mUsd: outputPer1m,
    };
  });

  const output = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_URL,
    sourceProject: "BerriAI/litellm",
    notes:
      "Prices are USD per 1M tokens, list price, no volume/committed-use discounts. " +
      "Meta doesn't sell first-party per-token Llama API access, so its entries " +
      "are priced via a third-party inference host (noted per model). Refreshed " +
      "weekly by GitHub Actions from the source above — treat as indicative, not " +
      "a live quote.",
    models,
  };

  const outPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "data",
    "prices.json"
  );
  await writeFile(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`Wrote ${models.length} models to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
