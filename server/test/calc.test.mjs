// The page's arithmetic (js/calc.js) is a classic browser script; evaluate it
// with a stub window so the same file is tested that the page loads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const src = await readFile(new URL("../../js/calc.js", import.meta.url), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(src, sandbox);
const C = sandbox.window.FernCalc;
const { taskTypes } = JSON.parse(await readFile(new URL("../../data/assumptions.json", import.meta.url), "utf8"));

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test("task usage sums requests and weights tokens per type", () => {
  const u = C.usageFromTasks(["quick", "documents"], taskTypes);
  // quick: 6/day = 30/week at 900 tokens; documents: 2/day = 10/week at 8,600
  assert.equal(u.requestsWeek, 40);
  close(u.avgTokensPerRequest, (30 * 900 + 10 * 8600) / 40);
});

test("unknown task ids are ignored", () => {
  assert.equal(C.usageFromTasks(["nope"], taskTypes).requestsWeek, 0);
});

test("API cost prices input and output separately, per task type", () => {
  const model = { inputPer1mUsd: 4, outputPer1mUsd: 20 };
  const u = C.usageFromManual(10, 1_000_000, 100_000); // 10 requests a week
  // per request: $4 + $2 = $6; 2 people × 10 × 4.345 weeks × $6
  close(C.apiUsageCost(model, 2, u, "USD"), 2 * 10 * C.WEEKS_PER_MONTH * 6);
  close(C.apiUsageCost(model, 2, u, "GBP"), 2 * 10 * C.WEEKS_PER_MONTH * 6 * C.USD_TO_GBP);
});

test("outcome: value, net and value per unit of cost", () => {
  const r = C.outcome({ people: 10, hoursWeek: 8, efficiencyPct: 25, hourlyCost: 40, monthlyCost: 200 });
  close(r.hoursSavedMonth, 10 * 8 * 0.25 * C.WEEKS_PER_MONTH);
  close(r.monthlyValue, r.hoursSavedMonth * 40);
  close(r.netValue, r.monthlyValue - 200);
  close(r.valuePerUnitCost, r.monthlyValue / 200);
  assert.equal(C.outcome({ people: 1, hoursWeek: 1, efficiencyPct: 10, hourlyCost: 1, monthlyCost: 0 }).valuePerUnitCost, null);
});

test("currency round trip", () => {
  close(C.toUsd(C.fromUsd(25, "GBP"), "GBP"), 25);
  assert.equal(C.fromUsd(25, "USD"), 25);
});
