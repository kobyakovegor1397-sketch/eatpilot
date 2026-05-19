const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); }

const scenarios = SCENARIOS;
const recipes = RECIPES;
const recipeById = Object.fromEntries(recipes.map(r => [r.id, r]));

const $ = id => document.getElementById(id);

let selectedGoal = "Обычно";
let lastResult = "";
let lastCandidates = [];
let currentMain = null;
let currentDay = [];

const regions = {
  moscow: { name:"Москва", currency:"₽", rate:1.35 },
  spb: { name:"Санкт-Петербург", currency:"₽", rate:1.22 },
  regions_ru: { name:"Регионы РФ", currency:"₽", rate:1 },
  minsk: { name:"Минск", currency:"BYN", rate:0.045 },
  belarus: { name:"Беларусь, регионы", currency:"BYN", rate:0.038 },
  germany: { name:"Германия", currency:"€", rate:0.018 },
  uae: { name:"ОАЭ / Дубай", currency:"AED", rate:0.12 }
};

const region = $("region"), minInput = $("budgetMin"), maxInput = $("budgetMax"), input = $("userInput");
const resultBox = $("resultBox"), resultText = $("resultText"), resultTitle = $("resultTitle"), matchScore = $("matchScore");
const copyStatus = $("copyStatus"), historyList = $("historyList"), historyCount = $("historyCount"), dayPlan = $("dayPlan");
const singleRecipeSlot = $("singleRecipeSlot"), dayRecipeSlot = $("dayRecipeSlot");
const visualResult = $("visualResult"), dayVisuals = $("dayVisuals");

function normalize(text) {
  return (text || "").toLowerCase().replaceAll("ё","е");
}

function detectIntent(text) {
  const t = normalize(text);
  const intents = [];
  const add = m => { if(!intents.includes(m)) intents.push(m); };

  if (/(похуд|сушк|диет|легк|не жир|калор|без калор)/.test(t)) add("Похудение");
  if (/(быстро|срочно|5 минут|лень|не хочу готовить)/.test(t)) add("Быстро");
  if (/(дешев|бюджет|эконом|до зарп|нет денег|недорого)/.test(t)) add("Дешево");
  if (/(трен|зал|спорт|после трен|качал)/.test(t)) add("После тренировки");
  if (/(ноч|дожор|поздно|перед сном)/.test(t)) add("Ночной дожор");
  if (/(заказ|достав|кафе|ресторан|ролл|суши|шаурм|бургер|поке|том)/.test(t)) add("Что заказать");
  if (/(дома|готов|холодильник|сковород|кухн)/.test(t)) add("Что приготовить дома");
  if (/(без мяса|вегет|мясо не|тофу|нут|чечев)/.test(t)) add("Без мяса");

  return intents.length ? intents : ["Любой"];
}

function extractBudgetFromText(text) {
  const t = normalize(text);
  const matches = [...t.matchAll(/(до|от)?\s*(\d{2,6})\s*(₽|руб|byn|€|aed)?/g)];
  if (!matches.length) return null;

  for (const m of matches) {
    const prefix = m[1] || "";
    const num = Number(m[2]);
    if (prefix === "до") return { min: 0, max: num };
    if (prefix === "от") return { min: num, max: Number(maxInput.value || 999999) };
  }

  if (matches.length >= 2) return { min: Number(matches[0][2]), max: Number(matches[1][2]) };
  return null;
}

function getBudget() {
  const fromText = extractBudgetFromText(input.value);
  if (fromText) {
    minInput.value = fromText.min;
    maxInput.value = fromText.max;
  }
  let min = Number(minInput.value || 0);
  let max = Number(maxInput.value || 999999);
  if (max < min) [min, max] = [max, min];
  return { min, max };
}

function priceToRegion(priceRub) {
  const r = regions[region.value];
  const value = priceRub * r.rate;
  if (r.currency === "₽") return Math.round(value / 10) * 10 + " ₽";
  if (r.currency === "BYN") return value.toFixed(1) + " BYN";
  if (r.currency === "€") return value.toFixed(1) + " €";
  if (r.currency === "AED") return Math.round(value) + " AED";
  return Math.round(value) + " " + r.currency;
}

function gramsLine(s) {
  return s.grams.map(g => `${g[0]} — ${g[1]} г`).join("\n");
}

function macroLine(s) {
  return `${s.kcal} ккал · Б ${s.protein} г · Ж ${s.fat} г · У ${s.carbs} г`;
}

function compactMealLine(s) {
  return `${s.name}\n${macroLine(s)}\nСтоимость: ${priceToRegion(s.basePriceRub)}`;
}

function foodCard(s) {
  return `<div class="food-card">
    <img src="${s.image || 'https://images.unsplash.com/photo-1543352634-a1c51d9f1fa7?auto=format&fit=crop&w=900&q=85'}" alt="${s.name}">
    <div>
      <h4>${s.name}</h4>
      <p>${macroLine(s)}</p>
      <p class="food-price">${priceToRegion(s.basePriceRub)}</p>
    </div>
  </div>`;
}

function dayVisualCards(items) {
  const labels = ["Завтрак", "Обед", "Перекус", "Ужин"];
  return `<div class="day-grid">${items.map((s, i) => `
    <div class="day-mini">
      <img src="${s.image || 'https://images.unsplash.com/photo-1543352634-a1c51d9f1fa7?auto=format&fit=crop&w=900&q=85'}" alt="${s.name}">
      <div>
        <h4>${labels[i]}: ${s.name}</h4>
        <p>${s.kcal} ккал · ${priceToRegion(s.basePriceRub)}</p>
      </div>
    </div>`).join("")}</div>`;
}

function detailedRecipeText(s) {
  const recipe = recipeById[s.recipeId];
  if (!recipe) return "Рецепт не найден. Кухня объявила забастовку.";

  const ingredients = s.grams.map(g => `• ${g[0]} — ${g[1]} г`).join("\n");
  const steps = recipe.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");

  return `👨‍🍳 ${recipe.title}

⏱ Время: ${recipe.time}
📌 Сложность: ${recipe.difficulty}

Ингредиенты:
${ingredients}

Подготовка:
${recipe.prep}

Как готовить:
${steps}

Нюанс:
${recipe.note}`;
}

function showRecipe(s, slotId) {
  const slot = $(slotId);
  slot.innerHTML = `<div class="recipe-box">${detailedRecipeText(s)}</div>`;
}

function recipeButtonsFor(items, slotId) {
  const buttons = items.map((s, index) => `<button class="small-btn" data-recipe-id="${s.id}" data-slot="${slotId}">Рецепт: ${index + 1}. ${s.name}</button>`).join("");
  return `<div class="recipe-buttons">${buttons}</div>`;
}

document.addEventListener("click", (e) => {
  if (!e.target.dataset.recipeId) return;
  const id = Number(e.target.dataset.recipeId);
  const slotId = e.target.dataset.slot;
  const item = scenarios.find(s => s.id === id);
  if (item) showRecipe(item, slotId);
});

function scoreScenario(s, intents, text, budget) {
  let score = 0;
  const t = normalize(text);

  if (s.basePriceRub >= budget.min && s.basePriceRub <= budget.max) score += 100;
  else score -= Math.min(80, Math.abs(s.basePriceRub - budget.max) / 10);

  if (intents.includes("Любой")) score += 10;
  for (const intent of intents) if (s.modes.includes(intent)) score += 25;

  for (const kw of s.keywords) if (t.includes(normalize(kw))) score += 35;

  const exactRules = [
    ["шаурм", "шаурм"], ["ролл", "ролл"], ["суши", "ролл"], ["бургер", "бургер"],
    ["поке", "поке"], ["суп", "суп"], ["омлет", "омлет"], ["творог", "творог"],
    ["греч", "греч"], ["паста", "паста"], ["макарон", "макарон"], ["том", "том"],
    ["лосось", "лосось"], ["кревет", "кревет"], ["пицц", "пицц"], ["пельмен", "пельмен"], ["сырник", "сырник"], ["рамен", "рамен"], ["плов", "плов"], ["блин", "блин"], ["кесад", "кесад"], ["фалафель", "фалафель"]
  ];
  for (const [trigger, namePart] of exactRules) {
    if (t.includes(trigger) && normalize(s.name).includes(namePart)) score += 80;
  }

  if (selectedGoal === "Похудение") {
    if (s.kcal <= 600) score += 30;
    if (s.protein >= 25) score += 15;
    if (s.fat <= 22) score += 10;
    if (s.kcal > 800) score -= 40;
  }

  if (selectedGoal === "Набор") {
    if (s.kcal >= 650) score += 30;
    if (s.protein >= 30) score += 20;
    if (s.kcal < 450) score -= 25;
  }

  if (selectedGoal === "Обычно" && s.kcal >= 400 && s.kcal <= 800) score += 15;

  return score + Math.random();
}

function cleanBaseName(s) {
  return s.baseKey || normalize(s.name).replace(/\s*\/\s*(легкая версия|сытная версия|быстрый вариант|без лишнего соуса|домашний вариант).*/g, "").trim();
}

function uniqueByBase(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = cleanBaseName(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function getCandidates() {
  const budget = getBudget();
  const intents = detectIntent(input.value);
  let strict = scenarios.filter(s => s.basePriceRub >= budget.min && s.basePriceRub <= budget.max);

  const t = normalize(input.value);
  const exactRules = [
    ["шаурм", "шаурм"], ["ролл", "ролл"], ["суши", "ролл"], ["бургер", "бургер"],
    ["поке", "поке"], ["суп", "суп"], ["омлет", "омлет"], ["творог", "творог"],
    ["греч", "греч"], ["паста", "паста"], ["макарон", "макарон"], ["том", "том"],
    ["лосось", "лосось"], ["кревет", "кревет"], ["пицц", "пицц"], ["пельмен", "пельмен"], ["сырник", "сырник"], ["рамен", "рамен"], ["плов", "плов"], ["блин", "блин"], ["кесад", "кесад"], ["фалафель", "фалафель"], ["пицц", "пицц"], ["пельмен", "пельмен"],
    ["сырник", "сырник"], ["плов", "плов"], ["рамен", "рамен"], ["блин", "блин"],
    ["кесад", "кесад"], ["фалафель", "фалафель"], ["картош", "картош"]
  ];

  for (const [trigger, namePart] of exactRules) {
    if (t.includes(trigger)) {
      const exact = strict.filter(s => normalize(s.name).includes(namePart));
      if (exact.length) strict = exact;
      break;
    }
  }

  if (!strict.length) {
    strict = [...scenarios].sort((a,b) => 
      Math.min(Math.abs(a.basePriceRub-budget.min), Math.abs(a.basePriceRub-budget.max)) -
      Math.min(Math.abs(b.basePriceRub-budget.min), Math.abs(b.basePriceRub-budget.max))
    ).slice(0, 180);
  }

  const sorted = strict.sort((a,b) => scoreScenario(b, intents, input.value, budget) - scoreScenario(a, intents, input.value, budget));
  return uniqueByBase(sorted).slice(0, 8);
}

function budgetLine() {
  const b = getBudget();
  return `от ${b.min} до ${b.max >= 999999 ? "без лимита" : b.max + " ₽"}`;
}

function generateResult(useNext=false) {
  if (!input.value.trim()) input.value = "что съесть сейчас";

  showResult("Думаю…", "Сверяю запрос, бюджет и КБЖУ…", "loading");
  singleRecipeSlot.innerHTML = "";
  visualResult.innerHTML = "";

  setTimeout(() => {
    if (!useNext || !lastCandidates.length) lastCandidates = getCandidates();
    const main = useNext ? (lastCandidates.shift() || getCandidates()[0]) : lastCandidates[0];
    currentMain = main;
    const alternatives = uniqueByBase(getCandidates().filter(s => s.id !== main.id && cleanBaseName(s) !== cleanBaseName(main))).slice(0,2);
    const allShown = [main, ...alternatives];

    const altText = alternatives.map((s,i) => `${i+2}. ${compactMealLine(s)}`).join("\n\n");

    const result = `🍽 ${main.name}

Запрос: ${input.value.trim()}
Регион: ${regions[region.value].name}
Бюджет: ${budgetLine()}

Основной вариант:
1. ${compactMealLine(main)}

Еще варианты:
${altText || "Под выбранный диапазон мало вариантов. Расширь бюджет."}

Совет:
${main.tip}

Мини-прикол:
${main.humor}`;

    lastResult = result;
    showResult(main.name, result, "точно");
    visualResult.innerHTML = foodCard(main);
    singleRecipeSlot.innerHTML = recipeButtonsFor(allShown, "singleRecipeSlot");
    addToHistory(main);
  }, 600);
}

function showResult(title, text, match) {
  resultBox.classList.remove("hidden");
  resultTitle.textContent = title;
  resultText.textContent = text;
  matchScore.textContent = match;
  copyStatus.textContent = "";
}

async function copyResult() {
  if(!lastResult) return;
  try {
    await navigator.clipboard.writeText(lastResult);
    copyStatus.textContent = "Скопировано. Можно отправить другу.";
  } catch(e) {
    copyStatus.textContent = "Не получилось скопировать.";
  }
}

function candidatesByType(type, usedKeys = []) {
  const b = getBudget();
  let pool = scenarios.filter(s => 
    s.mealTypes.includes(type) &&
    s.basePriceRub >= b.min &&
    s.basePriceRub <= b.max &&
    !usedKeys.includes(cleanBaseName(s))
  );

  if (selectedGoal === "Похудение") {
    pool = pool.filter(s => s.kcal <= (type === "snack" ? 560 : 760));
  }

  if (selectedGoal === "Набор") {
    pool = pool.filter(s => s.kcal >= (type === "snack" ? 380 : 550));
  }

  if (!pool.length) {
    pool = scenarios.filter(s => s.mealTypes.includes(type) && !usedKeys.includes(cleanBaseName(s)));
  }

  const sorted = pool.sort((a,b) => scoreScenario(b, ["Любой"], input.value, getBudget()) - scoreScenario(a, ["Любой"], input.value, getBudget()));
  return uniqueByBase(sorted);
}

function generateDayPlan() {
  const used = [];
  const breakfast = candidatesByType("breakfast", used)[0]; used.push(cleanBaseName(breakfast));
  const lunch = candidatesByType("lunch", used)[0]; used.push(cleanBaseName(lunch));
  const snack = candidatesByType("snack", used)[0]; used.push(cleanBaseName(snack));
  const dinner = candidatesByType("dinner", used)[0]; used.push(cleanBaseName(dinner));

  currentDay = [breakfast, lunch, snack, dinner];

  const total = currentDay.reduce((a,s) => ({
    kcal:a.kcal+s.kcal,
    p:a.p+s.protein,
    f:a.f+s.fat,
    c:a.c+s.carbs,
    rub:a.rub+s.basePriceRub
  }), {kcal:0,p:0,f:0,c:0,rub:0});

  dayPlan.classList.remove("hidden");
  dayRecipeSlot.innerHTML = "";

  dayPlan.textContent = `🗓 День питания

Регион: ${regions[region.value].name}
Бюджет на блюдо: ${budgetLine()}
Цель: ${selectedGoal}

Завтрак:
1. ${compactMealLine(breakfast)}

Обед:
2. ${compactMealLine(lunch)}

Перекус:
3. ${compactMealLine(snack)}

Ужин:
4. ${compactMealLine(dinner)}

Итого:
${total.kcal} ккал · Б ${total.p} г · Ж ${total.f} г · У ${total.c} г

Примерная стоимость дня:
${priceToRegion(total.rub)}

Мини-прикол:
День собран. Осталось только не заменить ужин на “чай с печеньками”.`;

  dayVisuals.innerHTML = dayVisualCards(currentDay);
  dayRecipeSlot.innerHTML = recipeButtonsFor(currentDay, "dayRecipeSlot");
}

function addToHistory(s) {
  const h = JSON.parse(localStorage.getItem("eatpilot_smart_history") || "[]");
  h.unshift({name:s.name, macro:macroLine(s), price:priceToRegion(s.basePriceRub), time:new Date().toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})});
  localStorage.setItem("eatpilot_smart_history", JSON.stringify(h.slice(0,6)));
  renderHistory();
}

function renderHistory() {
  const h = JSON.parse(localStorage.getItem("eatpilot_smart_history") || "[]");
  historyCount.textContent = h.length;
  historyList.innerHTML = h.length ? h.map(i => `<div class="history-item">${i.name}<span>${i.macro} · ${i.price} · ${i.time}</span></div>`).join("") : '<p class="muted">Здесь появятся последние рекомендации.</p>';
}

function saveState() {
  localStorage.setItem("eatpilot_smart_state", JSON.stringify({
    region:region.value, min:minInput.value, max:maxInput.value, goal:selectedGoal
  }));
}

function loadState() {
  const s = JSON.parse(localStorage.getItem("eatpilot_smart_state") || "{}");
  if(s.region) region.value = s.region;
  if(s.min) minInput.value = s.min;
  if(s.max) maxInput.value = s.max;
  if(s.goal) {
    selectedGoal = s.goal;
    document.querySelectorAll("#goalTabs button").forEach(b => b.classList.toggle("active", b.dataset.goal === selectedGoal));
  }
}

$("budgetPresets").addEventListener("click", e => {
  if(e.target.tagName !== "BUTTON") return;
  document.querySelectorAll("#budgetPresets button").forEach(b => b.classList.remove("active"));
  e.target.classList.add("active");
  minInput.value = e.target.dataset.min;
  maxInput.value = e.target.dataset.max;
  saveState();
});

$("goalTabs").addEventListener("click", e => {
  if(e.target.tagName !== "BUTTON") return;
  document.querySelectorAll("#goalTabs button").forEach(b => b.classList.remove("active"));
  e.target.classList.add("active");
  selectedGoal = e.target.dataset.goal;
  saveState();
});

$("generateBtn").addEventListener("click", () => generateResult(false));
$("againBtn").addEventListener("click", () => generateResult(true));
$("shareBtn").addEventListener("click", copyResult);
$("dayPlanBtn").addEventListener("click", generateDayPlan);
[region,minInput,maxInput].forEach(el => el.addEventListener("change", saveState));

loadState();
renderHistory();
