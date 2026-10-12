import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { estimate, sanitise, outputSchema, EstimateError } from "../src/estimate.mjs";
import { createLimiter, verifyTurnstile } from "../src/guards.mjs";
import { createApp, createHandler } from "../src/app.mjs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSite } from "../src/site.mjs";
import { costUsd } from "../src/cost.mjs";

const assumptions = JSON.parse(await readFile(new URL("../../data/assumptions.json", import.meta.url), "utf8"));

const good = {
  understood: true,
  summary: "A 12-person customer support team handling email tickets.",
  roleId: "support",
  people: 12,
  hourlyCost: 26,
  hoursWeek: 15,
  efficiencyPct: 30,
  access: "seats",
  tasks: ["quick", "documents"],
  reasons: [
    { field: "people", text: "You said 12 people." },
    { field: "people", text: "Duplicate, should be dropped." },
    { field: "hoursWeek", text: "Most of their week is answering tickets." },
  ],
};

function fakeClient(reply, seen = []) {
  return {
    beta: {
      messages: {
        create: async (params) => {
          seen.push(params);
          if (reply instanceof Error) throw reply;
          return {
            model: params.model,
            stop_reason: "end_turn",
            usage: { input_tokens: 1500, output_tokens: 700 },
            content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(reply) }],
            ...(reply.__response || {}),
          };
        },
      },
    },
  };
}

// ---- sanitise ---------------------------------------------------------------

test("sanitise keeps sensible values and labels reasons", () => {
  const s = sanitise(good, assumptions);
  assert.equal(s.people, 12);
  assert.equal(s.roleId, "support");
  assert.deepEqual(s.tasks, ["quick", "documents"]);
  assert.equal(s.reasons.length, 2, "duplicate field reason dropped");
  assert.equal(s.reasons[0].label, "People using AI");
});

test("sanitise clamps and rounds out-of-range numbers", () => {
  const s = sanitise({ ...good, people: 99999, hourlyCost: -4, hoursWeek: 7.3, efficiencyPct: 97 }, assumptions);
  assert.equal(s.people, 5000);
  assert.equal(s.hourlyCost, 5);
  assert.equal(s.hoursWeek, 7.5);
  assert.equal(s.efficiencyPct, 80);
});

test("sanitise drops unknown ids and falls back to default tasks", () => {
  const s = sanitise({ ...good, roleId: "astronaut", tasks: ["teleport"], access: "maybe" }, assumptions);
  assert.equal(s.roleId, null);
  assert.deepEqual(s.tasks, ["quick", "writing", "documents"]);
  assert.equal(s.access, "seats");
});

test("sanitise rejects a description the model didn't understand", () => {
  assert.throws(() => sanitise({ ...good, understood: false }, assumptions), (e) => e instanceof EstimateError && e.status === 422);
});

test("schema enums match the assumptions file", () => {
  const schema = outputSchema(assumptions);
  assert.deepEqual(schema.properties.tasks.items.enum, assumptions.taskTypes.map((t) => t.id));
  assert.ok(schema.properties.roleId.enum.includes("none"));
});

// ---- estimate ---------------------------------------------------------------

test("estimate sends structured output and default fallbacks for Opus", async () => {
  const seen = [];
  const { suggestion } = await estimate({
    client: fakeClient(good, seen), model: "claude-opus-5-5", effort: "medium",
    assumptions, description: "12 people in support", currency: "GBP",
  });
  assert.equal(suggestion.people, 12);
  const p = seen[0];
  assert.equal(p.fallbacks, "default");
  assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(p.output_config.format.type, "json_schema");
  assert.equal(p.output_config.effort, "medium");
  assert.ok(p.messages[0].content.includes("<team_description>"));
  assert.equal(p.thinking, undefined, "thinking can't be disabled on Opus 5.5, so it's left unset");
});

test("estimate omits fallbacks for Haiku", async () => {
  const seen = [];
  await estimate({ client: fakeClient(good, seen), model: "claude-haiku-5-5", effort: "low", assumptions, description: "x".repeat(20), currency: "GBP" });
  assert.equal(seen[0].fallbacks, undefined);
  assert.equal(seen[0].betas, undefined);
});

test("estimate turns a refusal into a 422", async () => {
  const client = fakeClient({ ...good, __response: { stop_reason: "refusal", content: [] } });
  await assert.rejects(
    estimate({ client, model: "claude-opus-5-5", effort: "medium", assumptions, description: "x".repeat(20), currency: "GBP" }),
    (e) => e.status === 422
  );
});

test("estimate turns unparseable output into a 502", async () => {
  const client = fakeClient({ __response: { content: [{ type: "text", text: "not json" }] } });
  await assert.rejects(
    estimate({ client, model: "claude-opus-5-5", effort: "medium", assumptions, description: "x".repeat(20), currency: "GBP" }),
    (e) => e.status === 502
  );
});

// ---- guards -----------------------------------------------------------------

test("limiter enforces per-minute, per-day and daily total", () => {
  let t = Date.UTC(2026, 9, 12, 10);
  const lim = createLimiter({ perMinute: 2, perDay: 3, dailyTotal: 4, now: () => t });
  assert.equal(lim.check("a"), null);
  assert.equal(lim.check("a"), null);
  assert.equal(lim.check("a"), "visitor", "third in a minute");
  t += 61_000;
  assert.equal(lim.check("a"), null);
  t += 61_000;
  assert.equal(lim.check("a"), "visitor", "fourth in a day");
  assert.equal(lim.check("b"), null, "refused requests don't count towards the total");
  assert.equal(lim.check("c"), "daily", "total of 4 reached");
  t = Date.UTC(2026, 9, 13, 0, 1);
  assert.equal(lim.check("a"), null, "resets at UTC midnight");
});

test("turnstile is skipped without a secret and enforced with one", async () => {
  assert.equal(await verifyTurnstile({ secret: "", token: undefined, ip: "1" }), true);
  assert.equal(await verifyTurnstile({ secret: "s", token: undefined, ip: "1" }), false);
  const ok = async () => ({ json: async () => ({ success: true }) });
  assert.equal(await verifyTurnstile({ secret: "s", token: "t", ip: "1", fetchImpl: ok }), true);
});

// ---- HTTP -------------------------------------------------------------------

const ORIGIN = "https://fernai.co.uk";

async function withApp(opts, fn) {
  const config = {
    model: "claude-opus-5-5", effort: "medium", allowedOrigins: [ORIGIN], turnstileSecret: "",
    limits: { perMinute: 2, perDay: 10, dailyTotal: 100 }, ...opts.config,
  };
  const logs = [];
  const server = createApp({ client: opts.client || fakeClient(good), assumptions, config, log: (o) => logs.push(o) });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, logs);
  } finally {
    server.close();
  }
}

const post = (base, body, origin = ORIGIN) =>
  fetch(`${base}/api/estimate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("POST returns a sanitised suggestion with CORS for an allowed origin", async () => {
  await withApp({}, async (base, logs) => {
    const res = await post(base, { description: "We are 12 people in customer support answering email.", currency: "GBP" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
    const body = await res.json();
    assert.equal(body.people, 12);
    const entry = logs.find((l) => l.event === "estimate");
    assert.ok(entry && !JSON.stringify(entry).includes("customer support"), "description is not logged");
  });
});

test("POST from another site is refused", async () => {
  await withApp({}, async (base) => {
    const res = await post(base, { description: "We are 12 people in customer support." }, "https://evil.example");
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });
});

test("preflight succeeds for an allowed origin", async () => {
  await withApp({}, async (base) => {
    const res = await fetch(`${base}/api/estimate`, { method: "OPTIONS", headers: { origin: ORIGIN } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  });
});

test("short, long and malformed bodies are rejected before calling Claude", async () => {
  const seen = [];
  await withApp({ client: fakeClient(good, seen) }, async (base) => {
    assert.equal((await post(base, { description: "hi" })).status, 400);
    assert.equal((await post(base, { description: "x".repeat(1201) })).status, 400);
    assert.equal((await post(base, "{not json")).status, 400);
    assert.equal(seen.length, 0);
  });
});

test("rate limit returns 429 with a friendly message", async () => {
  await withApp({}, async (base) => {
    const body = { description: "We are 12 people in customer support." };
    await post(base, body);
    await post(base, body);
    const res = await post(base, body);
    assert.equal(res.status, 429);
    assert.match((await res.json()).error, /wait a minute/);
  });
});

test("a failing Claude call becomes a 502, not a crash", async () => {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const err = new Anthropic.APIError(500, { type: "error" }, "boom", new Headers());
  await withApp({ client: fakeClient(err) }, async (base) => {
    const res = await post(base, { description: "We are 12 people in customer support." });
    assert.equal(res.status, 502);
  });
});

test("health check and unknown paths", async () => {
  await withApp({}, async (base) => {
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  });
});

// ---- preview mode -------------------------------------------------------------


const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("preview serves the page with the assistant pointed at itself, and nothing else", async () => {
  const api = createHandler({ client: fakeClient(good), assumptions, config: {
    model: "claude-opus-5-5", effort: "medium", allowedOrigins: [], allowAnyOrigin: true, turnstileSecret: "",
    limits: { perMinute: 5, perDay: 5, dailyTotal: 5 } }, log: () => {} });
  const server = http.createServer(withSite(api, repoRoot));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await (await fetch(`${base}/`)).text();
    assert.match(page, /<meta name="fernai-assistant-url" content=".">/);
    assert.equal((await fetch(`${base}/js/calc.js`)).status, 200);
    assert.equal((await fetch(`${base}/data/assumptions.json`)).status, 200);
    for (const p of ["/server/src/app.mjs", "/server/package.json", "/Dockerfile", "/%2e%2e/%2e%2e/etc/passwd", "/.git/config"]) {
      assert.equal((await fetch(`${base}${p}`)).status, 404, p);
    }
    // Any origin is accepted in preview: the Web Preview address isn't known in advance.
    const res = await post(base, { description: "We are 12 people in customer support." }, "https://8080-cs-123.cloudshell.dev");
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});

test("cost uses the price list and counts thinking as output", () => {
  const prices = { models: [{ id: "claude-opus-5-5", inputPer1mUsd: 4, outputPer1mUsd: 20 }] };
  assert.equal(costUsd(prices, "claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 }), 6);
  assert.equal(costUsd(prices, "unknown", { input_tokens: 1 }), null);
  assert.equal(costUsd(null, "claude-opus-5-5", { input_tokens: 1 }), null);
});

test("client address comes from the last forwarded entry, which a caller can't forge", async () => {
  const { clientIp } = await import("../src/guards.mjs");
  const req = (xff) => ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: "10.0.0.1" } });
  assert.equal(clientIp(req("203.0.113.7")), "203.0.113.7");
  assert.equal(clientIp(req("1.2.3.4, 203.0.113.7")), "203.0.113.7", "a spoofed first entry is ignored");
  assert.equal(clientIp(req("")), "10.0.0.1");
  assert.equal(clientIp(req(undefined)), "10.0.0.1");
});

test("the page's security policy allows its inline script and the assistant", async () => {
  const { createHash } = await import("node:crypto");
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(inline.length, 1, "one inline script, covered by a hash");
  const hash = createHash("sha256").update(inline[0]).digest("base64");
  assert.ok(csp.includes(`'sha256-${hash}'`), "update the sha256 in index.html's CSP after editing its inline script");
  const assistantUrl = html.match(/name="fernai-assistant-url" content="([^"]*)"/)[1];
  if (assistantUrl) assert.ok(new URL(assistantUrl).hostname.endsWith(".run.app") && csp.includes("https://*.run.app"));
});
