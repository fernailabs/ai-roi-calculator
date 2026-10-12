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
// weights, so its entries are priced via a third-party host (DeepInfra) and
// labelled as such.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SOURCE_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const CURATED_MODELS = [
  {
    id: "claude-opus-5-5",
    vendor: "Anthropic",
    tier: "flagship",
    label: "Claude Opus 5.5",
    litellmKey: "claude-opus-5-5",
  },
  {
    id: "claude-fable-5-1",
    vendor: "Anthropic",
    tier: "flagship",
    label: "Claude Fable 5.1",
    litellmKey: "claude-fable-5-1",
  },
  {
    id: "claude-sonnet-5-5",
    vendor: "Anthropic",
    tier: "efficient",
    label: "Claude Sonnet 5.5",
    litellmKey: "claude-sonnet-5-5",
  },
  {
    id: "claude-haiku-5-5",
    vendor: "Anthropic",
    tier: "efficient",
    label: "Claude Haiku 5.5",
    litellmKey: "claude-haiku-5-5",
  },
  {
    id: "gpt-6-astra",
    vendor: "OpenAI",
    tier: "flagship",
    label: "GPT-6 Astra",
    litellmKey: "gpt-6-astra",
  },
  {
    id: "gpt-6.1-sol",
    vendor: "OpenAI",
    tier: "flagship",
    label: "GPT-6.1 Sol",
    litellmKey: "gpt-6.1-sol",
  },
  {
    id: "gpt-6-luna",
    vendor: "OpenAI",
    tier: "efficient",
    label: "GPT-6 Luna",
    litellmKey: "gpt-6-luna",
  },
  {
    id: "gemini-3.1-pro-preview",
    vendor: "Google",
    tier: "flagship",
    label: "Gemini 3.1 Pro",
    litellmKey: "gemini-3.1-pro-preview",
  },
  {
    id: "gemini-3.8-flash",
    vendor: "Google",
    tier: "efficient",
    label: "Gemini 3.8 Flash",
    litellmKey: "gemini-3.8-flash",
  },
  {
    id: "grok-4.7",
    vendor: "xAI",
    tier: "flagship",
    label: "Grok 4.7",
    litellmKey: "xai/grok-4.7",
  },
  {
    id: "grok-4.3",
    vendor: "xAI",
    tier: "efficient",
    label: "Grok 4.3",
    litellmKey: "xai/grok-4.3",
  },
  {
    id: "llama-4-maverick",
    vendor: "Meta",
    tier: "flagship",
    label: "Llama 4 Maverick",
    litellmKey: "deepinfra/meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
    hostNote: "via DeepInfra",
  },
  {
    id: "llama-4-scout",
    vendor: "Meta",
    tier: "efficient",
    label: "Llama 4 Scout",
    litellmKey: "deepinfra/meta-llama/Llama-4-Scout-17B-16E-Instruct",
    hostNote: "via DeepInfra",
  },
];

function perMillion(costPerToken) {
  if (typeof costPerToken !== "number") return null;
  const perM = costPerToken * 1_000_000;
  // 4 sig figs is plenty of precision for an estimate; avoids float noise.
  return Number(perM.toPrecision(4));
}

async function readPrevious(outPath) {
  try {
    const data = JSON.parse(await readFile(outPath, "utf8"));
    return new Map(data.models.map((m) => [m.id, m]));
  } catch {
    return new Map();
  }
}

async function main() {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch pricing source: ${res.status} ${res.statusText}`);
  }
  const catalogue = await res.json();

  const outPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "data",
    "prices.json"
  );
  const previous = await readPrevious(outPath);

  const models = CURATED_MODELS.map((m) => {
    const entry = catalogue[m.litellmKey];
    const inputPer1m = perMillion(entry?.input_cost_per_token);
    const outputPer1m = perMillion(entry?.output_cost_per_token);
    if (inputPer1m == null || outputPer1m == null) {
      const problem = entry
        ? `litellm key "${m.litellmKey}" for ${m.id} has no usable pricing`
        : `litellm key "${m.litellmKey}" for ${m.id} not found in source catalogue — ` +
          `the model may have been renamed or retired. Update CURATED_MODELS.`;
      // One retired key shouldn't freeze every other model's price, so keep
      // the last published price for this model and flag it in the run.
      const last = previous.get(m.id);
      if (!last) throw new Error(problem);
      console.log(`::warning title=Stale price for ${m.id}::${problem} Keeping last published price.`);
      return last;
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

  await writeFile(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`Wrote ${models.length} models to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
