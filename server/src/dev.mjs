// Try the calculator and the assistant together on your own machine, with
// real Claude calls, before deploying anything:
//
//   cd server && npm ci
//   ANTHROPIC_API_KEY=sk-ant-... npm run dev
//   open http://localhost:8080
//
// Serves the static site from the repository root (switching the assistant
// panel on) and the assistant API on the same port. Works the same in
// Cloud Shell: open it with Web Preview on port 8080. Every estimate prints its
// token counts and what it cost, so you can see real figures before setting a
// budget. CLAUDE_MODEL and CLAUDE_EFFORT work as in production, so you can
// compare models; PORT changes the port.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { createHandler } from "./app.mjs";
import { withSite } from "./site.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.env.PORT) || 8080;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "Set ANTHROPIC_API_KEY first, for example:\n\n" +
      "  ANTHROPIC_API_KEY=sk-ant-... npm run dev\n\n" +
      "Create a key at https://console.anthropic.com. A workspace with a small\n" +
      "spend limit (say $5) is plenty for testing."
  );
  process.exit(1);
}

const assumptions = JSON.parse(await readFile(path.join(root, "data/assumptions.json"), "utf8"));
const prices = JSON.parse(await readFile(path.join(root, "data/prices.json"), "utf8"));

const config = {
  model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  effort: process.env.CLAUDE_EFFORT || "medium",
  allowedOrigins: [],
  // The page is served from this process, opened as localhost or through a
  // Cloud Shell Web Preview address, so any origin is accepted.
  allowAnyOrigin: true,
  turnstileSecret: "",
  limits: { perMinute: 10, perDay: 200, dailyTotal: 200 },
};

let runs = 0;
let spent = 0;

function log(entry) {
  if (entry.event === "estimate") {
    runs += 1;
    const line = [`#${runs}`, `${(entry.ms / 1000).toFixed(1)}s`, `${entry.input_tokens} in`, `${entry.output_tokens} out (incl. thinking)`];
    if (entry.cost_usd !== null) {
      spent += entry.cost_usd;
      line.push(`$${entry.cost_usd.toFixed(4)}`, `session total $${spent.toFixed(4)}`, `average $${(spent / runs).toFixed(4)}`);
    }
    console.log("estimate  " + line.join("  ·  "));
  } else if (entry.event === "refused") {
    console.log(`refused   ${entry.status}: ${entry.reason}`);
  } else if (entry.event === "error") {
    console.log(`error     ${entry.message}`);
  }
}

const api = createHandler({ client: new Anthropic({ timeout: 60_000, maxRetries: 1 }), assumptions, prices, config, log });
const price = prices.models.find((m) => m.id === config.model);

http.createServer(withSite(api, root)).listen(port, () => {
  console.log(`\nFernAI ROI calculator with the assistant: http://localhost:${port}`);
  console.log("(In Cloud Shell, use Web Preview → Preview on port " + port + " instead.)");
  console.log(`Model ${config.model}, effort ${config.effort}${price ? ` ($${price.inputPer1mUsd} in / $${price.outputPer1mUsd} out per million tokens)` : ""}.`);
  console.log("Each estimate's cost is printed below. Ctrl+C to stop.\n");
});
