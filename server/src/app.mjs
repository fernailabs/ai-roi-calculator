// HTTP handling for the assistant: one POST endpoint plus a health check.
// Plain node:http to keep the image small and the dependency list to the SDK.

import http from "node:http";
import { estimate, EstimateError } from "./estimate.mjs";
import { createLimiter, verifyTurnstile, clientIp } from "./guards.mjs";
import { costUsd } from "./cost.mjs";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_DESCRIPTION = 1200;
const MIN_DESCRIPTION = 15;

export function createApp(options) {
  return http.createServer(createHandler(options));
}

// The request handler on its own, so the local dev server (src/dev.mjs) can
// put it in front of the static site.
export function createHandler({ client, assumptions, prices, config, log = (o) => console.log(JSON.stringify(o)), fetchImpl }) {
  const limiter = createLimiter(config.limits);
  const allowed = new Set(config.allowedOrigins);
  // Preview and local runs serve the page from the same address as the API,
  // and that address isn't known in advance (localhost, a Cloud Shell Web
  // Preview, the Cloud Run proxy), so they accept any origin. Only use this
  // where the service itself isn't public.
  const originOk = (origin) => config.allowAnyOrigin || allowed.has(origin);

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && originOk(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      res.setHeader("Access-Control-Max-Age", "3600");
    }
    return !origin || originOk(origin);
  }

  function send(res, status, body) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          reject(new EstimateError(413, "That description is too long."));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
        } catch {
          reject(new EstimateError(400, "Invalid request."));
        }
      });
      req.on("error", reject);
    });
  }

  async function handleEstimate(req, res) {
    const started = Date.now();
    const ip = clientIp(req);
    const body = await readJson(req);
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const currency = body.currency === "USD" ? "USD" : "GBP";

    if (description.length < MIN_DESCRIPTION) throw new EstimateError(400, "Tell us a little more about the team first.");
    if (description.length > MAX_DESCRIPTION) throw new EstimateError(400, `Please keep it under ${MAX_DESCRIPTION} characters.`);

    const human = await verifyTurnstile({ secret: config.turnstileSecret, token: body.turnstileToken, ip, fetchImpl });
    if (!human) throw new EstimateError(403, "Please complete the quick human check next to the button, then try again.");

    const refused = limiter.check(ip);
    if (refused === "daily") throw new EstimateError(429, "The assistant has reached today's limit. You can still fill in the calculator by hand.");
    if (refused) throw new EstimateError(429, "That's a lot of requests in a short time. Please wait a minute and try again.");

    const { suggestion, usage, model } = await estimate({
      client,
      model: config.model,
      effort: config.effort,
      assumptions,
      description,
      currency,
    });
    // Never log the description itself: visitors may include personal details.
    log({
      event: "estimate",
      ms: Date.now() - started,
      model,
      chars: description.length,
      input_tokens: usage?.input_tokens,
      output_tokens: usage?.output_tokens,
      cost_usd: costUsd(prices, model, usage),
    });
    send(res, 200, suggestion);
  }

  return async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    try {
      // Not /healthz: Cloud Run reserves some paths ending in "z" and answers
      // them itself with a Google 404, so they never reach the service.
      if (req.method === "GET" && path === "/api/health") return send(res, 200, { ok: true });

      if (path !== "/api/estimate") return send(res, 404, { error: "Not found." });
      const permitted = cors(req, res);
      if (req.method === "OPTIONS") {
        res.writeHead(permitted ? 204 : 403);
        return res.end();
      }
      if (req.method !== "POST") return send(res, 405, { error: "Method not allowed." });
      if (!permitted) return send(res, 403, { error: "Not allowed from this site." });

      await handleEstimate(req, res);
    } catch (err) {
      if (err instanceof EstimateError) {
        log({ event: "refused", status: err.status, reason: err.message });
        return send(res, err.status, { error: err.message });
      }
      log({ event: "error", message: err?.message });
      send(res, 500, { error: "Something went wrong. Please try again." });
    }
  };
}
