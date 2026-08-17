(() => {
  "use strict";

  const WEEKS_PER_MONTH = 4.345;
  // Fixed, approximate — not a live feed. Only converts the USD-denominated
  // model token prices into GBP for display; good enough for an estimate tool.
  const USD_TO_GBP = 0.79;

  const CURRENCY_SYMBOL = { GBP: "£", USD: "$" };

  const STORAGE_KEY = "fernai-roi-calc-inputs-v1";
  const THEME_KEY = "fernai-roi-calc-theme";

  const els = {
    teamSize: document.getElementById("team-size"),
    teamSizeVal: document.getElementById("team-size-val"),
    hourlyCost: document.getElementById("hourly-cost"),
    hourlyCostVal: document.getElementById("hourly-cost-val"),
    currency: document.getElementById("currency"),
    hoursWeek: document.getElementById("hours-week"),
    hoursWeekVal: document.getElementById("hours-week-val"),
    efficiency: document.getElementById("efficiency"),
    efficiencyVal: document.getElementById("efficiency-val"),
    model: document.getElementById("model"),
    inputTokens: document.getElementById("input-tokens"),
    outputTokens: document.getElementById("output-tokens"),
    interactionsWeek: document.getElementById("interactions-week"),
    interactionsWeekVal: document.getElementById("interactions-week-val"),
    seatCost: document.getElementById("seat-cost"),
    netValue: document.getElementById("net-value"),
    netValueTile: document.getElementById("net-value-tile"),
    roiPct: document.getElementById("roi-pct"),
    monthlyValue: document.getElementById("monthly-value"),
    monthlyCost: document.getElementById("monthly-cost"),
    hoursSaved: document.getElementById("hours-saved"),
    barList: document.getElementById("bar-list"),
    priceSource: document.getElementById("price-source"),
    themeToggle: document.getElementById("theme-toggle"),
  };

  let priceData = null;

  function fmtMoney(n, currency) {
    const sym = CURRENCY_SYMBOL[currency] || "";
    const sign = n < 0 ? "-" : "";
    return `${sign}${sym}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }

  function priceInCurrency(usdPer1m, currency) {
    return currency === "GBP" ? usdPer1m * USD_TO_GBP : usdPer1m;
  }

  function readInputs() {
    return {
      teamSize: Number(els.teamSize.value) || 0,
      hourlyCost: Number(els.hourlyCost.value) || 0,
      currency: els.currency.value,
      hoursWeek: Number(els.hoursWeek.value) || 0,
      efficiencyPct: Number(els.efficiency.value) || 0,
      modelId: els.model.value,
      inputTokens: Number(els.inputTokens.value) || 0,
      outputTokens: Number(els.outputTokens.value) || 0,
      interactionsWeek: Number(els.interactionsWeek.value) || 0,
      seatCost: Number(els.seatCost.value) || 0,
    };
  }

  function monthlyAiCostFor(model, inputs) {
    const interactionsPerMonth = inputs.teamSize * inputs.interactionsWeek * WEEKS_PER_MONTH;
    const inCost = priceInCurrency(model.inputPer1mUsd, inputs.currency) * (inputs.inputTokens / 1_000_000);
    const outCost = priceInCurrency(model.outputPer1mUsd, inputs.currency) * (inputs.outputTokens / 1_000_000);
    return interactionsPerMonth * (inCost + outCost) + inputs.seatCost;
  }

  function compute(inputs) {
    const model = priceData.models.find((m) => m.id === inputs.modelId) || priceData.models[0];

    const hoursSavedWeek = inputs.teamSize * inputs.hoursWeek * (inputs.efficiencyPct / 100);
    const hoursSavedMonth = hoursSavedWeek * WEEKS_PER_MONTH;
    const monthlyValue = hoursSavedMonth * inputs.hourlyCost;
    const monthlyCost = monthlyAiCostFor(model, inputs);
    const netValue = monthlyValue - monthlyCost;
    const roiPct = monthlyCost > 0 ? (netValue / monthlyCost) * 100 : null;

    return { model, hoursSavedMonth, monthlyValue, monthlyCost, netValue, roiPct };
  }

  function render() {
    if (!priceData) return;
    const inputs = readInputs();
    const r = compute(inputs);

    els.teamSizeVal.textContent = inputs.teamSize;
    els.hourlyCostVal.textContent = fmtMoney(inputs.hourlyCost, inputs.currency);
    els.hoursWeekVal.textContent = inputs.hoursWeek;
    els.efficiencyVal.textContent = `${inputs.efficiencyPct}%`;
    els.interactionsWeekVal.textContent = inputs.interactionsWeek;

    els.netValue.textContent = fmtMoney(r.netValue, inputs.currency);
    els.roiPct.textContent = r.roiPct == null ? "ROI —" : `ROI ${r.roiPct >= 0 ? "+" : ""}${r.roiPct.toFixed(0)}% / month`;
    els.netValueTile.classList.toggle("roi-neg", r.netValue < 0);

    els.monthlyValue.textContent = fmtMoney(r.monthlyValue, inputs.currency);
    els.monthlyCost.textContent = fmtMoney(r.monthlyCost, inputs.currency);
    els.hoursSaved.textContent = r.hoursSavedMonth.toLocaleString(undefined, { maximumFractionDigits: 0 });

    renderBars(inputs);
    persist(inputs);
  }

  function renderBars(inputs) {
    const rows = priceData.models
      .map((m) => ({ model: m, cost: monthlyAiCostFor(m, inputs) }))
      .sort((a, b) => a.cost - b.cost);
    const max = Math.max(...rows.map((r) => r.cost), 1);

    els.barList.innerHTML = "";
    rows.forEach(({ model, cost }) => {
      const row = document.createElement("div");
      row.className = "bar-row" + (model.id === inputs.modelId ? " selected" : "");

      const name = document.createElement("div");
      name.className = "bar-name";
      name.innerHTML = `<span class="vendor">${model.vendor}${model.hostNote ? " · " + model.hostNote : ""}</span>${model.label}`;

      const track = document.createElement("div");
      track.className = "bar-track";
      const fill = document.createElement("div");
      fill.className = "bar-fill" + (model.tier === "efficient" ? " efficient" : "");
      fill.style.width = `${Math.max((cost / max) * 100, 2)}%`;
      track.appendChild(fill);

      const value = document.createElement("div");
      value.className = "bar-value";
      value.textContent = fmtMoney(cost, inputs.currency);

      row.append(name, track, value);
      els.barList.appendChild(row);
    });
  }

  function populateModelSelect() {
    els.model.innerHTML = "";
    priceData.models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.vendor} — ${m.label} (${m.tier === "flagship" ? "flagship" : "efficient"})`;
      els.model.appendChild(opt);
    });
  }

  function persist(inputs) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
    } catch (_) { /* storage unavailable — ignore */ }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.teamSize) els.teamSize.value = saved.teamSize;
      if (saved.hourlyCost) els.hourlyCost.value = saved.hourlyCost;
      if (saved.currency) els.currency.value = saved.currency;
      if (saved.hoursWeek) els.hoursWeek.value = saved.hoursWeek;
      if (saved.efficiencyPct) els.efficiency.value = saved.efficiencyPct;
      if (saved.inputTokens) els.inputTokens.value = saved.inputTokens;
      if (saved.outputTokens) els.outputTokens.value = saved.outputTokens;
      if (saved.interactionsWeek) els.interactionsWeek.value = saved.interactionsWeek;
      if (saved.seatCost !== undefined) els.seatCost.value = saved.seatCost;
      if (saved.modelId) els.model.value = saved.modelId;
    } catch (_) { /* ignore malformed storage */ }
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    updateThemeLabel();
    els.themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme")
        || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
      const next = current === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(THEME_KEY, next);
      updateThemeLabel();
    });
  }

  function updateThemeLabel() {
    const current = document.documentElement.getAttribute("data-theme")
      || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    els.themeToggle.textContent = current === "light" ? "Dark mode" : "Light mode";
  }

  function wireInputs() {
    const all = [
      els.teamSize, els.hourlyCost, els.currency, els.hoursWeek, els.efficiency,
      els.model, els.inputTokens, els.outputTokens, els.interactionsWeek, els.seatCost,
    ];
    all.forEach((el) => el.addEventListener("input", render));
  }

  async function init() {
    initTheme();
    wireInputs();
    try {
      const res = await fetch("data/prices.json", { cache: "no-store" });
      priceData = await res.json();
    } catch (err) {
      els.barList.innerHTML = '<div class="loading-note">Couldn\'t load pricing data.</div>';
      console.error(err);
      return;
    }
    populateModelSelect();
    restore();
    if (!els.model.value && priceData.models[0]) els.model.value = priceData.models[0].id;

    const generated = new Date(priceData.generatedAt);
    els.priceSource.innerHTML =
      `Token prices refreshed weekly from <a href="${priceData.source}" target="_blank" rel="noopener">${priceData.sourceProject}</a> — ` +
      `last updated ${generated.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.`;

    render();
  }

  init();
})();
