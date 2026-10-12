(() => {
  "use strict";

  const C = window.FernCalc;
  const CURRENCY_SYMBOL = { GBP: "£", USD: "$" };
  const LOCALE = "en-GB";
  const EMBEDDED = document.documentElement.hasAttribute("data-embed");
  const PANEL = document.documentElement.hasAttribute("data-embed-panel");

  const STORAGE_KEY = "fernai-roi-calc-inputs-v2";
  const THEME_KEY = "fernai-roi-calc-theme";
  const CUSTOM_PLAN = "custom";
  const DEFAULT_TASKS = ["quick", "writing", "documents"];

  const $ = (id) => document.getElementById(id);
  const els = {
    role: $("role"),
    teamSize: $("team-size"),
    hourlyCost: $("hourly-cost"),
    hourlyCostSym: $("hourly-cost-sym"),
    hourlyCostExample: $("hourly-cost-example"),
    currency: $("currency"),
    hoursWeek: $("hours-week"),
    hoursWeekVal: $("hours-week-val"),
    efficiency: $("efficiency"),
    efficiencyVal: $("efficiency-val"),
    efficiencyExample: $("efficiency-example"),
    plan: $("plan"),
    planHint: $("plan-hint"),
    customPlanField: $("custom-plan-field"),
    customPlanPrice: $("custom-plan-price"),
    customPlanSym: $("custom-plan-sym"),
    model: $("model"),
    taskList: $("task-list"),
    usageSummary: $("usage-summary"),
    manualUsage: $("manual-usage"),
    manualFields: $("manual-fields"),
    inputTokens: $("input-tokens"),
    outputTokens: $("output-tokens"),
    interactionsWeek: $("interactions-week"),
    interactionsWeekVal: $("interactions-week-val"),
    seatCost: $("seat-cost"),
    seatCostSym: $("seat-cost-sym"),
    netValue: $("net-value"),
    netValueTile: $("net-value-tile"),
    roiPct: $("roi-pct"),
    monthlyValue: $("monthly-value"),
    monthlyCost: $("monthly-cost"),
    monthlyCostHint: $("monthly-cost-hint"),
    hoursSaved: $("hours-saved"),
    barsHead: $("bars-head"),
    barsNote: $("bars-note"),
    barsLegend: $("bars-legend"),
    barList: $("bar-list"),
    priceSource: $("price-source"),
    themeToggle: $("theme-toggle"),
    year: $("year"),
    assistant: $("assistant"),
    assistantForm: $("assistant-form"),
    assistantText: $("assistant-text"),
    assistantSubmit: $("assistant-submit"),
    assistantStatus: $("assistant-status"),
    assistantResult: $("assistant-result"),
    assistantSummary: $("assistant-summary"),
    assistantReasons: $("assistant-reasons"),
    turnstile: $("turnstile"),
    miniSummary: $("mini-summary"),
    miniNet: $("mini-net"),
    miniJump: $("mini-jump"),
  };

  let priceData = null;
  let assumptions = null;

  // ---- formatting -----------------------------------------------------------

  function fmtMoney(n, currency) {
    const sym = CURRENCY_SYMBOL[currency] || "";
    const sign = n < 0 ? "-" : "";
    // Pence below £10, so cheap options don't all read as "£0".
    const digits = Math.abs(n) < 10 && n !== 0 ? 2 : 0;
    return `${sign}${sym}${Math.abs(n).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }

  function fmtNum(n, digits = 0) {
    return n.toLocaleString(LOCALE, { maximumFractionDigits: digits });
  }

  // "£156 of time saved for every £1 spent on AI" reads more plainly than an
  // ROI percentage in the tens of thousands.
  function describeReturn(r, currency) {
    if (r.monthlyCost <= 0) return "No AI cost entered.";
    if (r.netValue < 0) return "At these inputs, AI costs more than the time it saves.";
    const sym = CURRENCY_SYMBOL[currency] || "";
    const perUnit = r.valuePerUnitCost;
    const shown = perUnit < 10
      ? perUnit.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : Math.round(perUnit).toLocaleString(LOCALE);
    return `${sym}${shown} of time saved for every ${sym}1 spent on AI.`;
  }

  // ---- reading state ----------------------------------------------------------

  function accessMode() {
    const checked = document.querySelector('input[name="access"]:checked');
    return checked ? checked.value : "seats";
  }

  function selectedTasks() {
    return [...els.taskList.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
  }

  function readInputs() {
    return {
      roleId: els.role.value,
      people: Number(els.teamSize.value) || 0,
      hourlyCost: Number(els.hourlyCost.value) || 0,
      currency: els.currency.value,
      hoursWeek: Number(els.hoursWeek.value) || 0,
      efficiencyPct: Number(els.efficiency.value) || 0,
      access: accessMode(),
      planId: els.plan.value,
      customPlanPrice: Number(els.customPlanPrice.value) || 0,
      modelId: els.model.value,
      tasks: selectedTasks(),
      manual: els.manualUsage.checked,
      requestsWeek: Number(els.interactionsWeek.value) || 0,
      inputTokens: Number(els.inputTokens.value) || 0,
      outputTokens: Number(els.outputTokens.value) || 0,
      otherCost: Number(els.seatCost.value) || 0,
    };
  }

  function usageFor(inputs) {
    return inputs.manual
      ? C.usageFromManual(inputs.requestsWeek, inputs.inputTokens, inputs.outputTokens)
      : C.usageFromTasks(inputs.tasks, assumptions.taskTypes);
  }

  function seatPrice(plan, inputs) {
    return plan.id === CUSTOM_PLAN
      ? inputs.customPlanPrice
      : C.fromUsd(plan.usdPerSeatMonth, inputs.currency);
  }

  function plansWithCustom() {
    return [...assumptions.seatPlans.plans, { id: CUSTOM_PLAN, vendor: "Other", label: "Another plan" }];
  }

  // Every option for the current mode, each with its monthly cost; the chart
  // and the headline both read from this so they can't disagree.
  function costOptions(inputs) {
    if (inputs.access === "api") {
      const usage = usageFor(inputs);
      return priceData.models.map((m) => ({
        id: m.id,
        vendor: m.vendor + (m.hostNote ? " · " + m.hostNote : ""),
        label: m.label,
        efficient: m.tier === "efficient",
        cost: C.apiUsageCost(m, inputs.people, usage, inputs.currency) + inputs.otherCost,
      }));
    }
    return plansWithCustom().map((p) => ({
      id: p.id,
      vendor: p.vendor,
      label: p.label,
      efficient: false,
      cost: C.seatCost(seatPrice(p, inputs), inputs.people) + inputs.otherCost,
    }));
  }

  // ---- rendering --------------------------------------------------------------

  function render() {
    if (!priceData || !assumptions) return;
    const inputs = readInputs();
    const sym = CURRENCY_SYMBOL[inputs.currency] || "";

    document.querySelectorAll("[data-mode]").forEach((el) => {
      el.hidden = el.dataset.mode !== inputs.access;
    });
    els.manualFields.hidden = !inputs.manual;
    els.taskList.closest("fieldset").disabled = inputs.manual;
    els.customPlanField.hidden = inputs.planId !== CUSTOM_PLAN;

    els.hourlyCostSym.textContent = sym;
    els.seatCostSym.textContent = sym;
    els.customPlanSym.textContent = sym;
    els.hourlyCostExample.textContent = inputs.currency === "USD"
      ? "a $65,000 salary is about $50 an hour"
      : "a £50,000 salary is about £38 an hour";
    const tenHours = 10 * (1 - inputs.efficiencyPct / 100);
    els.efficiencyExample.textContent = `At ${inputs.efficiencyPct}%, a 10-hour task takes ${fmtNum(tenHours, 1)} hours.`;
    els.hoursWeekVal.textContent = inputs.hoursWeek;
    els.efficiencyVal.textContent = `${inputs.efficiencyPct}%`;
    els.interactionsWeekVal.textContent = inputs.requestsWeek;

    renderPlanHint(inputs);
    renderUsageSummary(inputs);

    const options = costOptions(inputs);
    const selectedId = inputs.access === "api" ? inputs.modelId : inputs.planId;
    const selected = options.find((o) => o.id === selectedId) || options[0];
    const r = C.outcome({ ...inputs, monthlyCost: selected.cost });

    els.netValue.textContent = fmtMoney(r.netValue, inputs.currency);
    els.roiPct.textContent = describeReturn(r, inputs.currency);
    els.netValueTile.classList.toggle("roi-neg", r.netValue < 0);
    els.miniNet.textContent = els.netValue.textContent;
    els.miniSummary.classList.toggle("neg", r.netValue < 0);
    els.monthlyValue.textContent = fmtMoney(r.monthlyValue, inputs.currency);
    els.monthlyCost.textContent = fmtMoney(r.monthlyCost, inputs.currency);
    els.monthlyCostHint.textContent = inputs.access === "api" ? "Usage plus other costs" : "Seats plus other costs";
    els.hoursSaved.textContent = fmtNum(r.hoursSavedMonth);

    renderBars(inputs, options, selected.id);
    persist(inputs);
  }

  function renderPlanHint(inputs) {
    const plan = plansWithCustom().find((p) => p.id === inputs.planId);
    if (!plan) return;
    const reviewed = new Date(assumptions.seatPlans.reviewedOn)
      .toLocaleDateString(LOCALE, { month: "long", year: "numeric" });
    els.planHint.textContent = plan.id === CUSTOM_PLAN
      ? "Enter the price you pay, or expect to pay, per person."
      : `${fmtMoney(seatPrice(plan, inputs), inputs.currency)} per person per month. ${plan.note}. List price, last checked ${reviewed}.`;
  }

  function renderUsageSummary(inputs) {
    if (inputs.access !== "api") return;
    const usage = usageFor(inputs);
    if (usage.requestsWeek === 0) {
      els.usageSummary.textContent = "Tick at least one kind of work, or enter your own figures.";
      return;
    }
    const words = usage.avgTokensPerRequest * 0.75;
    els.usageSummary.textContent =
      `That's about ${fmtNum(usage.requestsWeek)} AI requests per person a week, averaging ` +
      `${fmtNum(Math.round(usage.avgTokensPerRequest / 100) * 100)} tokens (around ${fmtNum(Math.round(words / 50) * 50)} words) each, in and out.`;
  }

  function renderBars(inputs, options, selectedId) {
    const api = inputs.access === "api";
    els.barsHead.textContent = api ? "Monthly AI cost by model" : "Monthly AI cost by plan";
    els.barsNote.textContent = api
      ? "What the same usage would cost each month on each model, cheapest first. Your chosen model is in red. Flagship models are the most capable; efficient models are cheaper and faster, and are often good enough for routine work."
      : "What each plan would cost for your team each month, cheapest first. Your chosen plan is in red. Seat plans are a fixed price per person however much they use it.";
    els.barsLegend.hidden = !api;

    const rows = [...options].sort((a, b) => a.cost - b.cost);
    const max = Math.max(...rows.map((r) => r.cost), 1);
    els.barList.innerHTML = "";
    rows.forEach((o) => {
      const row = document.createElement("div");
      row.className = "bar-row" + (o.id === selectedId ? " selected" : "");

      const name = document.createElement("div");
      name.className = "bar-name";
      const vendor = document.createElement("span");
      vendor.className = "vendor";
      vendor.textContent = o.vendor;
      name.append(vendor, o.label);
      name.title = o.label;

      const track = document.createElement("div");
      track.className = "bar-track";
      const fill = document.createElement("div");
      fill.className = "bar-fill" + (o.efficient ? " efficient" : "");
      fill.style.width = `${Math.max((o.cost / max) * 100, 2)}%`;
      track.appendChild(fill);

      const value = document.createElement("div");
      value.className = "bar-value";
      value.textContent = fmtMoney(o.cost, inputs.currency);

      row.append(name, track, value);
      els.barList.appendChild(row);
    });
  }

  // ---- building the controls ------------------------------------------------------

  function addOption(select, value, text) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    select.appendChild(opt);
  }

  function populateControls() {
    assumptions.roles.forEach((r) => addOption(els.role, r.id, r.label));
    plansWithCustom().forEach((p) => addOption(els.plan, p.id, p.id === CUSTOM_PLAN ? "Another plan: enter a price" : `${p.label} (${p.vendor})`));
    priceData.models.forEach((m) =>
      addOption(els.model, m.id, `${m.vendor} — ${m.label} (${m.tier === "flagship" ? "flagship" : "efficient"})`)
    );

    assumptions.taskTypes.forEach((t) => {
      const label = document.createElement("label");
      label.className = "check task";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = t.id;
      box.checked = DEFAULT_TASKS.includes(t.id);
      const text = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = t.label;
      const desc = document.createElement("small");
      desc.textContent = t.description;
      text.append(title, desc);
      label.append(box, text);
      els.taskList.appendChild(label);
    });
  }

  function setTasks(ids) {
    els.taskList.querySelectorAll('input[type="checkbox"]').forEach((el) => {
      el.checked = ids.includes(el.value);
    });
  }

  function setAccess(value) {
    const radio = document.querySelector(`input[name="access"][value="${value}"]`);
    if (radio) radio.checked = true;
  }

  function applyRole(roleId) {
    const role = assumptions.roles.find((r) => r.id === roleId);
    if (!role) return;
    els.hoursWeek.value = role.hoursWeek;
    els.efficiency.value = role.efficiencyPct;
    const hourly = els.currency.value === "USD" ? C.toUsd(role.hourlyCostGbp, "GBP") : role.hourlyCostGbp;
    els.hourlyCost.value = Math.round(hourly);
    setTasks(role.tasks);
    els.manualUsage.checked = false;
  }

  // Any manual edit to a figure the role filled in means it's no longer that
  // role's preset, so clear the selector rather than let it mislead.
  function clearRole() {
    els.role.value = "";
  }

  // ---- persistence -----------------------------------------------------------------

  function persist(inputs) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
    } catch (_) { /* storage unavailable — ignore */ }
  }

  function restore() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (_) {
      return;
    }
    if (!saved) return;
    const set = (el, v) => { if (v !== undefined && v !== null && v !== "") el.value = v; };
    set(els.currency, saved.currency);
    set(els.teamSize, saved.people);
    set(els.hourlyCost, saved.hourlyCost);
    set(els.hoursWeek, saved.hoursWeek);
    set(els.efficiency, saved.efficiencyPct);
    set(els.plan, saved.planId);
    set(els.customPlanPrice, saved.customPlanPrice);
    set(els.model, saved.modelId);
    set(els.interactionsWeek, saved.requestsWeek);
    set(els.inputTokens, saved.inputTokens);
    set(els.outputTokens, saved.outputTokens);
    set(els.seatCost, saved.otherCost);
    set(els.role, saved.roleId);
    if (saved.access) setAccess(saved.access);
    if (Array.isArray(saved.tasks)) setTasks(saved.tasks);
    els.manualUsage.checked = !!saved.manual;
    // A saved id that no longer exists (a retired model) leaves the select blank.
    if (!els.model.value && priceData.models[0]) els.model.value = priceData.models[0].id;
    if (!els.plan.value) els.plan.selectedIndex = 0;
  }

  // ---- theme and embedding ---------------------------------------------------------

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
    // A panel embed has a fixed-height frame and scrolls inside it instead.
    if (!EMBEDDED || PANEL || window.parent === window) return;
    let last = 0;
    const post = () => {
      // The body's own height, not the document's scrollHeight: scrollHeight
      // is never less than the frame itself, so the frame could grow (e.g. on
      // switching to pay as you go) but never shrink back, leaving a tail.
      const height = Math.ceil(document.body.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      window.parent.postMessage({ type: "fernai-roi-calc:height", height }, "*");
    };
    if ("ResizeObserver" in window) new ResizeObserver(post).observe(document.body);
    window.addEventListener("load", post);
    post();
  }

  // Panel embed: the frame is shorter than the calculator and scrolls, so
  // show the headline figure in a pinned bar whenever the result itself is
  // out of view.
  function initPanel() {
    if (!PANEL) return;
    els.miniJump.addEventListener("click", () => {
      $("outcome-head").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    if (!("IntersectionObserver" in window)) return;
    new IntersectionObserver(([entry]) => {
      els.miniSummary.classList.toggle("show", !entry.isIntersecting);
    }).observe(els.netValueTile);
  }

  // ---- assistant ("Describe your team") --------------------------------------------
  //
  // Optional. Shown only when index.html names the assistant service's URL in
  // <meta name="fernai-assistant-url">. The service returns suggested inputs;
  // the arithmetic always stays in this page.

  function meta(name) {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? el.content.trim() : "";
  }

  let turnstileWidget = null;

  function initAssistant() {
    const url = meta("fernai-assistant-url");
    if (!url) return;
    els.assistant.hidden = false;

    const siteKey = meta("fernai-turnstile-sitekey");
    if (siteKey) {
      window.onFernTurnstileLoad = () => {
        turnstileWidget = window.turnstile.render(els.turnstile, { sitekey: siteKey, size: "flexible" });
      };
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onFernTurnstileLoad";
      s.async = true;
      document.head.appendChild(s);
    }

    els.assistantForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const description = els.assistantText.value.trim();
      if (description.length < 15) {
        els.assistantStatus.textContent = "Tell us a little more about the team first.";
        return;
      }
      els.assistantSubmit.disabled = true;
      els.assistantStatus.textContent = "Working it out… this can take up to 30 seconds.";
      try {
        const token = turnstileWidget !== null ? window.turnstile.getResponse(turnstileWidget) : undefined;
        const res = await fetch(url.replace(/\/$/, "") + "/api/estimate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description, currency: els.currency.value, turnstileToken: token }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Something went wrong. Please try again.");
        applySuggestion(body);
        els.assistantStatus.textContent = "Done. We've filled in the calculator below.";
      } catch (err) {
        els.assistantStatus.textContent = err.message || "Couldn't reach the assistant. Please try again.";
      } finally {
        els.assistantSubmit.disabled = false;
        if (turnstileWidget !== null) window.turnstile.reset(turnstileWidget);
      }
    });
  }

  function applySuggestion(s) {
    const roleKnown = assumptions.roles.some((r) => r.id === s.roleId);
    els.role.value = roleKnown ? s.roleId : "";
    els.teamSize.value = s.people;
    els.hourlyCost.value = s.hourlyCost;
    els.hoursWeek.value = s.hoursWeek;
    els.efficiency.value = s.efficiencyPct;
    setAccess(s.access);
    setTasks(s.tasks);
    els.manualUsage.checked = false;

    els.assistantSummary.textContent = s.summary;
    els.assistantReasons.innerHTML = "";
    s.reasons.forEach((r) => {
      const li = document.createElement("li");
      const label = document.createElement("strong");
      label.textContent = r.label + ": ";
      li.append(label, r.text);
      els.assistantReasons.appendChild(li);
    });
    els.assistantResult.hidden = false;
    render();
  }

  // ---- start -----------------------------------------------------------------------

  function wireInputs() {
    const roleOwned = [els.teamSize, els.hourlyCost, els.hoursWeek, els.efficiency];
    [
      ...roleOwned, els.currency, els.plan, els.customPlanPrice, els.model,
      els.inputTokens, els.outputTokens, els.interactionsWeek, els.seatCost, els.manualUsage,
    ].forEach((el) => el.addEventListener("input", render));
    [els.hourlyCost, els.hoursWeek, els.efficiency].forEach((el) => el.addEventListener("input", clearRole));
    els.taskList.addEventListener("change", () => { clearRole(); render(); });
    document.querySelectorAll('input[name="access"]').forEach((el) => el.addEventListener("change", render));
    els.role.addEventListener("change", () => { applyRole(els.role.value); render(); });
  }

  function renderPriceSource() {
    const generated = new Date(priceData.generatedAt);
    els.priceSource.innerHTML =
      `Pay-as-you-go prices are refreshed weekly from <a href="${priceData.source}" target="_blank" rel="noopener">${priceData.sourceProject}</a>, ` +
      `last updated ${generated.toLocaleDateString(LOCALE, { year: "numeric", month: "long", day: "numeric" })}. ` +
      `Seat prices are vendors' list prices, checked by hand. GBP figures use a fixed approximate exchange rate.`;
  }

  async function init() {
    if (els.year) els.year.textContent = new Date().getFullYear();
    initTheme();
    initPanel();
    initEmbedResize();
    try {
      const [prices, assume] = await Promise.all([
        fetch("data/prices.json", { cache: "no-store" }).then((r) => r.json()),
        fetch("data/assumptions.json", { cache: "no-store" }).then((r) => r.json()),
      ]);
      priceData = prices;
      assumptions = assume;
    } catch (err) {
      els.barList.innerHTML = '<div class="loading">Couldn\'t load pricing data. Please refresh the page.</div>';
      console.error(err);
      return;
    }
    populateControls();
    restore();
    wireInputs();
    renderPriceSource();
    initAssistant();
    render();
  }

  init();
})();
