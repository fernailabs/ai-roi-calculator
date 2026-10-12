// The calculator's arithmetic, kept free of the DOM so it can be tested on its
// own (tests/calc.test.mjs). Loaded as a classic script in the page, where it
// sets window.FernCalc; under Node the tests evaluate it with a stub window.
(function (root) {
  "use strict";

  const WEEKS_PER_MONTH = 4.345;
  const WORKING_DAYS_PER_WEEK = 5;
  // Fixed, approximate — not a live feed. Vendor prices are in USD; this only
  // converts them for display. Good enough for an estimate tool.
  const USD_TO_GBP = 0.79;

  function fromUsd(usd, currency) {
    return currency === "GBP" ? usd * USD_TO_GBP : usd;
  }

  function toUsd(amount, currency) {
    return currency === "GBP" ? amount / USD_TO_GBP : amount;
  }

  // Requests per person per week, and the token profile of each, implied by
  // the kinds of work ticked. Each task type carries its own per-request
  // tokens and frequency, so costs are summed per type rather than averaged.
  function usageFromTasks(taskIds, taskTypes) {
    const byId = new Map(taskTypes.map((t) => [t.id, t]));
    const parts = taskIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((t) => ({
        requestsWeek: t.requestsPerDay * WORKING_DAYS_PER_WEEK,
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
      }));
    const requestsWeek = parts.reduce((n, p) => n + p.requestsWeek, 0);
    const tokensWeek = parts.reduce((n, p) => n + p.requestsWeek * (p.inputTokens + p.outputTokens), 0);
    return {
      parts,
      requestsWeek,
      avgTokensPerRequest: requestsWeek > 0 ? tokensWeek / requestsWeek : 0,
    };
  }

  // The same shape from figures typed in by hand.
  function usageFromManual(requestsWeek, inputTokens, outputTokens) {
    return {
      parts: [{ requestsWeek, inputTokens, outputTokens }],
      requestsWeek,
      avgTokensPerRequest: inputTokens + outputTokens,
    };
  }

  // Monthly usage cost on one model, excluding other fixed costs.
  function apiUsageCost(model, people, usage, currency) {
    const inPrice = fromUsd(model.inputPer1mUsd, currency) / 1_000_000;
    const outPrice = fromUsd(model.outputPer1mUsd, currency) / 1_000_000;
    const perPersonWeek = usage.parts.reduce(
      (sum, p) => sum + p.requestsWeek * (p.inputTokens * inPrice + p.outputTokens * outPrice),
      0
    );
    return people * perPersonWeek * WEEKS_PER_MONTH;
  }

  function seatCost(pricePerSeat, people) {
    return pricePerSeat * people;
  }

  function outcome({ people, hoursWeek, efficiencyPct, hourlyCost, monthlyCost }) {
    const hoursSavedMonth = people * hoursWeek * (efficiencyPct / 100) * WEEKS_PER_MONTH;
    const monthlyValue = hoursSavedMonth * hourlyCost;
    const netValue = monthlyValue - monthlyCost;
    return {
      hoursSavedMonth,
      monthlyValue,
      monthlyCost,
      netValue,
      valuePerUnitCost: monthlyCost > 0 ? monthlyValue / monthlyCost : null,
    };
  }

  root.FernCalc = {
    WEEKS_PER_MONTH,
    USD_TO_GBP,
    fromUsd,
    toUsd,
    usageFromTasks,
    usageFromManual,
    apiUsageCost,
    seatCost,
    outcome,
  };
})(typeof window !== "undefined" ? window : globalThis);
