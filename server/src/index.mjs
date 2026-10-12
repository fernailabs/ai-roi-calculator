// Entry point for the Cloud Run service. All configuration comes from
// environment variables; see server/README.md for what each one does.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { createHandler } from "./app.mjs";
import { withSite } from "./site.mjs";

const env = process.env;
const int = (v, d) => (Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : d);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// PREVIEW=1 also serves the calculator page, with the assistant switched on,
// for testing before launch. deploy.sh makes a preview private (callers need
// Cloud Run Invoker), because a preview accepts requests from any origin.
const preview = env.PREVIEW === "1";

const config = {
  model: env.CLAUDE_MODEL || "claude-opus-5-5",
  effort: env.CLAUDE_EFFORT || "medium",
  allowedOrigins: (env.ALLOWED_ORIGINS || "https://fernai.co.uk,https://www.fernai.co.uk,https://fernailabs.github.io")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  allowAnyOrigin: preview,
  turnstileSecret: env.TURNSTILE_SECRET || "",
  limits: {
    perMinute: int(env.RATE_PER_MINUTE, 3),
    perDay: int(env.RATE_PER_DAY, 15),
    dailyTotal: int(env.DAILY_REQUEST_LIMIT, 500),
  },
};

const readJson = async (rel) => JSON.parse(await readFile(path.join(root, rel), "utf8"));
const assumptions = await readJson("data/assumptions.json");
const prices = await readJson("data/prices.json").catch(() => null);

// Reads ANTHROPIC_API_KEY, which Cloud Run injects from Secret Manager.
const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });

const api = createHandler({ client, assumptions, prices, config });
const port = int(env.PORT, 8080);
http.createServer(preview ? withSite(api, root) : api).listen(port, () => {
  console.log(JSON.stringify({ event: "listening", port, preview, model: config.model, effort: config.effort, origins: config.allowedOrigins }));
});
