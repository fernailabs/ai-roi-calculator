// Entry point for the Cloud Run service. All configuration comes from
// environment variables; see server/README.md for what each one does.

import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { createApp } from "./app.mjs";

const env = process.env;
const int = (v, d) => (Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : d);

const config = {
  model: env.CLAUDE_MODEL || "claude-opus-5-5",
  effort: env.CLAUDE_EFFORT || "medium",
  allowedOrigins: (env.ALLOWED_ORIGINS || "https://fernai.co.uk,https://www.fernai.co.uk,https://fernailabs.github.io")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  turnstileSecret: env.TURNSTILE_SECRET || "",
  limits: {
    perMinute: int(env.RATE_PER_MINUTE, 3),
    perDay: int(env.RATE_PER_DAY, 15),
    dailyTotal: int(env.DAILY_REQUEST_LIMIT, 500),
  },
};

const assumptionsPath = env.ASSUMPTIONS_PATH || new URL("../../data/assumptions.json", import.meta.url);
const assumptions = JSON.parse(await readFile(assumptionsPath, "utf8"));

// Reads ANTHROPIC_API_KEY, which Cloud Run injects from Secret Manager.
const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });

const port = int(env.PORT, 8080);
createApp({ client, assumptions, config }).listen(port, () => {
  console.log(JSON.stringify({ event: "listening", port, model: config.model, effort: config.effort, origins: config.allowedOrigins }));
});
