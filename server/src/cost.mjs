// What one estimate cost, from the same price list the calculator shows
// (data/prices.json, refreshed weekly). Output tokens include thinking, which
// is billed as output. Returns null when the model isn't in the list.
export function costUsd(prices, model, usage) {
  const p = prices?.models?.find((m) => m.id === model);
  if (!p || !usage) return null;
  const cost = ((usage.input_tokens || 0) * p.inputPer1mUsd + (usage.output_tokens || 0) * p.outputPer1mUsd) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
