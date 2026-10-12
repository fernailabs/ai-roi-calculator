// Abuse protection for a public endpoint that spends money on every call.
//
// Counters are in memory, so they are per instance: deploy with a small
// --max-instances (the README uses 2) and the effective limits are at most
// that multiple of the configured ones. That's the trade for not running a
// database; the hard ceiling on spend is the Anthropic Console spend limit.

export function createLimiter({ perMinute, perDay, dailyTotal, now = () => Date.now() }) {
  const visitors = new Map();
  let day = utcDay(now());
  let total = 0;

  function utcDay(ms) {
    return Math.floor(ms / 86_400_000);
  }

  return {
    // Returns null when allowed, or a reason the request was refused.
    check(ip) {
      const t = now();
      if (utcDay(t) !== day) {
        day = utcDay(t);
        total = 0;
        visitors.clear();
      }
      if (total >= dailyTotal) return "daily";
      const v = visitors.get(ip) || { minuteStart: t, minute: 0, day: 0 };
      if (t - v.minuteStart >= 60_000) {
        v.minuteStart = t;
        v.minute = 0;
      }
      if (v.minute >= perMinute || v.day >= perDay) return "visitor";
      v.minute += 1;
      v.day += 1;
      total += 1;
      visitors.set(ip, v);
      return null;
    },
  };
}

// Cloudflare Turnstile. Only enforced when a secret is configured.
export async function verifyTurnstile({ secret, token, ip, fetchImpl = fetch }) {
  if (!secret) return true;
  if (!token) return false;
  try {
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    });
    const body = await res.json();
    return body.success === true;
  } catch {
    return false;
  }
}

// Cloud Run's front end appends the caller's real address to
// X-Forwarded-For, after anything the caller sent in that header itself. So
// only the last entry can be trusted: taking the first would let a script
// claim a new address on every request and slip past the per-visitor limits.
export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress || "unknown";
}
