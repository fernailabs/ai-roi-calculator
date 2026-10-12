// Try the calculator and the assistant together on your own machine, with
// real Claude calls, before deploying anything:
//
//   cd server && npm ci
//   ANTHROPIC_API_KEY=sk-ant-... npm run dev
//   open http://localhost:8080
//
// Serves the static site from the repository root (switching the assistant
// panel on) and the assistant API on the same port. Every estimate prints its
// token counts and what it cost, so you can see real figures before setting a
// budget. CLAUDE_MODEL and CLAUDE_EFFORT work as in production, so you can
// compare models; PORT changes the port.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { createHandler } from "./app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.env.PORT) || 8080;
const origin = `http://localhost:${port}`;

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
  allowedOrigins: [origin, `http://127.0.0.1:${port}`],
  turnstileSecret: "",
  limits: { perMinute: 10, perDay: 200, dailyTotal: 200 },
};

// Running cost for this session, from the same price list the calculator uses.
const price = prices.models.find((m) => m.id === config.model);
let runs = 0;
let spent = 0;

function log(entry) {
  if (entry.event === "estimate") {
    runs += 1;
    const line = [`#${runs}`, `${(entry.ms / 1000).toFixed(1)}s`, `${entry.input_tokens} in`, `${entry.output_tokens} out (incl. thinking)`];
    if (price) {
      const cost = (entry.input_tokens * price.inputPer1mUsd + entry.output_tokens * price.outputPer1mUsd) / 1_000_000;
      spent += cost;
      line.push(`$${cost.toFixed(4)}`, `session total $${spent.toFixed(4)}`, `average $${(spent / runs).toFixed(4)}`);
    }
    console.log("estimate  " + line.join("  ·  "));
  } else if (entry.event === "refused") {
    console.log(`refused   ${entry.status}: ${entry.reason}`);
  } else if (entry.event === "error") {
    console.log(`error     ${entry.message}`);
  }
}

const api = createHandler({ client: new Anthropic({ timeout: 60_000, maxRetries: 1 }), assumptions, config, log });

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

async function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.resolve(root, rel);
  const ext = path.extname(file);
  // Only the site's own files: nothing outside the repository or under server/.
  if (!file.startsWith(root + path.sep) || file.startsWith(path.join(root, "server")) || !TYPES[ext]) {
    res.writeHead(404).end();
    return;
  }
  try {
    let body = await readFile(file);
    if (rel === "index.html") {
      body = body
        .toString("utf8")
        .replace(/<meta name="fernai-assistant-url" content="[^"]*">/, `<meta name="fernai-assistant-url" content="${origin}">`);
    }
    res.writeHead(200, { "content-type": TYPES[ext], "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, origin);
    if (pathname.startsWith("/api/") || pathname === "/healthz") return api(req, res);
    if (req.method !== "GET") return res.writeHead(405).end();
    return serveStatic(req, res, pathname);
  })
  .listen(port, () => {
    console.log(`\nFernAI ROI calculator with the assistant: ${origin}`);
    console.log(`Model ${config.model}, effort ${config.effort}${price ? ` ($${price.inputPer1mUsd} in / $${price.outputPer1mUsd} out per million tokens)` : ""}.`);
    console.log("Each estimate's cost is printed below. Ctrl+C to stop.\n");
  });
