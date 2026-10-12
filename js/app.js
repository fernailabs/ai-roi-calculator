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
    hourlyCost: document.getElementById("hourly-cost"),
    hourlyCostSym: document.getElementById("hourly-cost-sym"),
    hourlyCostExample: document.getElementById("hourly-cost-example"),
    seatCostSym: document.getElementById("seat-cost-sym"),
    seatCostExample: document.getElementById("seat-cost-example"),
    efficiencyExample: document.getElementById("efficiency-example"),
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
    year: document.getElementById("year"),
  };

  const LOCALE = "en-GB";
  const EMBEDDED = document.documentElement.hasAttribute("data-embed");

  let priceData = null;

  function fmtMoney(n, currency) {
    const sym = CURRENCY_SYMBOL[currency] || "";
    const sign = n < 0 ? "-" : "";
    // Pence below £10, so cheap models don't all read as "£0".
    const digits = Math.abs(n) < 10 && n !== 0 ? 2 : 0;
    return `${sign}${sym}${Math.abs(n).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
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

  // "£156 of value for every £1 spent on AI" reads more plainly than an ROI
  // percentage in the tens of thousands.
  function describeReturn(r, currency) {
    if (r.monthlyCost <= 0) return "No AI cost entered.";
    if (r.netValue < 0) return "At these inputs, AI costs more than the time it saves.";
    const sym = CURRENCY_SYMBOL[currency] || "";
    const perUnit = r.monthlyValue / r.monthlyCost;
    const shown = perUnit < 10
      ? perUnit.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : Math.round(perUnit).toLocaleString(LOCALE);
    return `${sym}${shown} of time saved for every ${sym}1 spent on AI.`;
  }

  function render() {
    if (!priceData) return;
    const inputs = readInputs();
    const r = compute(inputs);

    const sym = CURRENCY_SYMBOL[inputs.currency] || "";
    els.hourlyCostSym.textContent = sym;
    els.seatCostSym.textContent = sym;
    els.hourlyCostExample.textContent = inputs.currency === "USD"
      ? "a $65,000 salary is about $50 an hour"
      : "a £50,000 salary is about £38 an hour";
    els.seatCostExample.textContent = `10 seats at ${sym}25 is ${sym}250`;
    const tenHours = 10 * (1 - inputs.efficiencyPct / 100);
    els.efficiencyExample.textContent =
      `At ${inputs.efficiencyPct}%, a 10-hour task takes ${tenHours.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} hours.`;
    els.hoursWeekVal.textContent = inputs.hoursWeek;
    els.efficiencyVal.textContent = `${inputs.efficiencyPct}%`;
    els.interactionsWeekVal.textContent = inputs.interactionsWeek;

    els.netValue.textContent = fmtMoney(r.netValue, inputs.currency);
    els.roiPct.textContent = describeReturn(r, inputs.currency);
    els.netValueTile.classList.toggle("roi-neg", r.netValue < 0);

    els.monthlyValue.textContent = fmtMoney(r.monthlyValue, inputs.currency);
    els.monthlyCost.textContent = fmtMoney(r.monthlyCost, inputs.currency);
    els.hoursSaved.textContent = r.hoursSavedMonth.toLocaleString(LOCALE, { maximumFractionDigits: 0 });

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
      const vendor = document.createElement("span");
      vendor.className = "vendor";
      vendor.textContent = model.vendor + (model.hostNote ? " · " + model.hostNote : "");
      name.append(vendor, model.label);
      name.title = model.label;

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

  // Light is the brand default (no attribute); dark is stamped. The inline
  // bootstrap in index.html has already applied any saved or ?theme= choice.
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function initTheme() {
    updateThemeLabel();
    els.themeToggle.addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      if (next === "dark") document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
      try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* storage unavailable */ }
      updateThemeLabel();
    });
  }

  function updateThemeLabel() {
    els.themeToggle.textContent = currentTheme() === "dark" ? "Light theme" : "Dark theme";
  }

  // In an iframe, tell the host page how tall the content is so it can size
  // the frame without an inner scrollbar. See README "Embedding".
  function initEmbedResize() {
    if (!EMBEDDED || window.parent === window) return;
    let last = 0;
    const post = () => {
      const height = Math.ceil(document.documentElement.scrollHeight);
      if (height === last) return;
      last = height;
      window.parent.postMessage({ type: "fernai-roi-calc:height", height }, "*");
    };
    if ("ResizeObserver" in window) new ResizeObserver(post).observe(document.body);
    window.addEventListener("load", post);
    post();
  }

  function wireInputs() {
    const all = [
      els.teamSize, els.hourlyCost, els.currency, els.hoursWeek, els.efficiency,
      els.model, els.inputTokens, els.outputTokens, els.interactionsWeek, els.seatCost,
    ];
    all.forEach((el) => el.addEventListener("input", render));
  }

  async function init() {
    if (els.year) els.year.textContent = new Date().getFullYear();
    initTheme();
    initEmbedResize();
    wireInputs();
    try {
      const res = await fetch("data/prices.json", { cache: "no-store" });
      priceData = await res.json();
    } catch (err) {
      els.barList.innerHTML = '<div class="loading">Couldn\'t load pricing data. Please refresh the page.</div>';
      console.error(err);
      return;
    }
    populateModelSelect();
    restore();
    if (!els.model.value && priceData.models[0]) els.model.value = priceData.models[0].id;

    const generated = new Date(priceData.generatedAt);
    els.priceSource.innerHTML =
      `Token prices are refreshed weekly from <a href="${priceData.source}" target="_blank" rel="noopener">${priceData.sourceProject}</a>, ` +
      `last updated ${generated.toLocaleDateString(LOCALE, { year: "numeric", month: "long", day: "numeric" })}. ` +
      `GBP figures use a fixed approximate exchange rate.`;

    render();
  }

  init();
})();
