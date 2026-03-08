/*
  popup.js — FitTrack Daily
  - Handles UI interactions, storage, meal/protein/calorie calculations, and messaging the
    background service worker to schedule daily reminders.
  - Storage schema:
      {
        settings:    { reminderTime, remindersEnabled, theme, dietType, ... },
        days:        { 'YYYY-MM-DD': { checks, meals, extras, notes, totalProtein, totalCalories, steps, sleep, mood, water, lastFastDuration } },
        weekly:      [ { date, weight, waist, photo } ],
        dietPlan:    { 'DayName': [ { meal, foods, protein, calories } ] },
        customFoods: [ { id, label, proteinPerServing, caloriesPerServing } ]
      }

  Protein and calorie defaults per serving are provided and can be adjusted.
  Custom foods persist across sessions via chrome.storage.local under 'customFoods'.
*/

(function () {
  'use strict';

  // --- Food lists ---
  const FOODS_VEG = [
    { id: 'paneer', label: 'Paneer 🧀', proteinPerServing: 18, caloriesPerServing: 200 },
    { id: 'curd', label: 'Curd 🥛', proteinPerServing: 4, caloriesPerServing: 60 },
    { id: 'dal', label: 'Dal 🫘', proteinPerServing: 18, caloriesPerServing: 180 },
    { id: 'tofu', label: 'Tofu', proteinPerServing: 10, caloriesPerServing: 94 },
    { id: 'sprouts', label: 'Sprouts 🌱', proteinPerServing: 4, caloriesPerServing: 50 },
    { id: 'boiledVeg', label: 'Boiled Veg 🥦', proteinPerServing: 3, caloriesPerServing: 40 },
    { id: 'nuts', label: 'Nuts 🥜', proteinPerServing: 6, caloriesPerServing: 170 },
    { id: 'fruits', label: 'Fruits 🍎', proteinPerServing: 1, caloriesPerServing: 50 },
  ];

  const FOODS_NONVEG = [
    { id: 'chicken', label: 'Chicken Breast 🍗', proteinPerServing: 31, caloriesPerServing: 165 },
    { id: 'eggs', label: 'Eggs 🥚', proteinPerServing: 6, caloriesPerServing: 78 },
    { id: 'fish', label: 'Fish 🐟', proteinPerServing: 22, caloriesPerServing: 120 },
    { id: 'tuna', label: 'Tuna (canned) 🐠', proteinPerServing: 25, caloriesPerServing: 109 },
    { id: 'curd', label: 'Curd 🥛', proteinPerServing: 4, caloriesPerServing: 60 },
    { id: 'dal', label: 'Dal 🫘', proteinPerServing: 18, caloriesPerServing: 180 },
    { id: 'boiledVeg', label: 'Boiled Veg 🥦', proteinPerServing: 3, caloriesPerServing: 40 },
    { id: 'fruits', label: 'Fruits 🍎', proteinPerServing: 1, caloriesPerServing: 50 },
  ];

  let FOODS = FOODS_VEG; // active list, switched by diet mode
  let CUSTOM_FOODS = []; // persisted custom foods, merged into FOODS on load

  let MIN_PROTEIN_WARN = 90; // updated from user goals
  let CALORIE_GOAL = 1800; // updated from user goals
  let STEPS_GOAL = 8000; // updated from user goals
  let SLEEP_GOAL = 7;    // updated from user goals
  const MOODS = [
    { key: 'bad', emoji: '😔', label: 'Bad' },
    { key: 'meh', emoji: '😐', label: 'Meh' },
    { key: 'ok', emoji: '🙂', label: 'OK' },
    { key: 'good', emoji: '😄', label: 'Good' },
    { key: 'pumped', emoji: '💪', label: 'Pumped' },
  ];

  // DOM
  const mealRows = document.getElementById('mealRows');
  const totalProteinEl = document.getElementById('totalProtein');
  const totalCaloriesEl = document.getElementById('totalCalories');
  const proteinWarning = document.getElementById('proteinWarning');
  const notesEl = document.getElementById('notes');
  const saveDayBtn = document.getElementById('saveDay');
  const resetWeekBtn = document.getElementById('resetWeek');
  const saveWeeklyBtn = document.getElementById('saveWeekly');
  const weightEl = document.getElementById('weight');
  const waistEl = document.getElementById('waist');
  const photoEl = document.getElementById('photo');
  const weeklyStats = document.getElementById('weeklyStats');
  const trendCanvas = document.getElementById('trendChart');
  const reminderTimeEl = document.getElementById('reminderTime');
  const enableRemindersEl = document.getElementById('enableReminders');
  const dietFileEl = document.getElementById('dietFile');
  const uploadDietBtn = document.getElementById('uploadDiet');
  const downloadTemplateBtn = document.getElementById('downloadTemplate');
  const dietStatus = document.getElementById('dietStatus');
  const weeklyScheduleEl = document.getElementById('weeklySchedule');
  const streakBadge = document.getElementById('streakBadge');
  const headerSubtitle = document.getElementById('headerSubtitle');
  const dietModeVegBtn = document.getElementById('dietModeVeg');
  const dietModeNonvegBtn = document.getElementById('dietModeNonveg');
  const heightInput = document.getElementById('heightInput');
  const stepsEl = document.getElementById('stepsToday');
  const sleepEl = document.getElementById('sleepHours');
  const shiftNameInput = document.getElementById('shiftName');
  const shiftWakeInput = document.getElementById('shiftWake');
  const shiftSleepInput = document.getElementById('shiftSleep');
  const saveShiftBtn = document.getElementById('saveShift');
  // mood buttons resolved via querySelectorAll('.mood-btn') at runtime

  const checklistKeys = ['hitProtein', 'stayedCalories', 'workoutDone', 'drankWater', 'noJunk'];

  // Create meal rows
  function renderMealRows() {
    mealRows.innerHTML = '';
    for (const food of FOODS) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${food.label}</td>
        <td><input type="number" min="0" step="0.25" value="0" data-id="${food.id}" class="serving"></td>
        <td><span class="pp" data-id="${food.id}">${food.proteinPerServing}</span></td>
        <td><span class="cal" data-id="${food.id}">${food.caloriesPerServing}</span></td>
        <td><span class="total" data-id="${food.id}">0</span></td>
        <td><span class="calTotal" data-id="${food.id}">0</span></td>
      `;
      mealRows.appendChild(tr);
    }
  }

  // Utility: promisified storage get/set
  function storageGet(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }
  function storageSet(obj) {
    return new Promise(resolve => chrome.storage.local.set(obj, resolve));
  }

  // Get key for today's date
  function dateKey(d = new Date()) {
    return d.toISOString().slice(0, 10);
  }

  // Load today's data and settings
  async function loadState() {
    const today = dateKey();
    const res = await storageGet(['settings', 'days', 'weekly', 'dietPlan', 'customFoods']);
    const settings = res.settings || {};
    const days = res.days || {};
    const weekly = res.weekly || [];

    // reminder settings
    reminderTimeEl.value = settings.reminderTime || '09:00';
    enableRemindersEl.checked = !!settings.remindersEnabled;

    // theme
    applyTheme(settings.theme || 'dark');

    // goals
    MIN_PROTEIN_WARN = settings.proteinGoal || 90;
    CALORIE_GOAL = settings.calorieGoal || 1800;
    STEPS_GOAL = settings.stepsGoal || 8000;
    SLEEP_GOAL = settings.sleepGoal || 7;
    const pgEl = document.getElementById('proteinGoal');
    const cgEl = document.getElementById('calorieGoal');
    const sgEl = document.getElementById('stepsGoal');
    const slEl = document.getElementById('sleepGoal');
    if (pgEl) pgEl.value = MIN_PROTEIN_WARN;
    if (cgEl) cgEl.value = CALORIE_GOAL;
    if (sgEl) sgEl.value = STEPS_GOAL;
    if (slEl) slEl.value = SLEEP_GOAL;

    // height
    if (heightInput) heightInput.value = settings.height || '';

    // diet mode (must be set before renderMealRows so correct FOODS are used)
    setDietMode(settings.dietType || 'veg');

    // shift settings
    if (shiftNameInput) shiftNameInput.value = settings.shiftName || '';
    if (shiftWakeInput) shiftWakeInput.value = settings.shiftWake || '';
    if (shiftSleepInput) shiftSleepInput.value = settings.shiftSleep || '';
    setShiftType(settings.shiftType || 'Day');
    updateSubtitle();

    // checklist
    for (const k of checklistKeys) {
      const cb = document.getElementById(k);
      cb.checked = false;
      cb.addEventListener('change', onCheckChange);
      updateCheckVisual(cb);
    }

    // fill today's saved data
    const todayData = days[today] || {};
    if (todayData.checks) {
      for (const k of checklistKeys) {
        const cb = document.getElementById(k);
        cb.checked = !!todayData.checks[k];
        updateCheckVisual(cb);
      }
    }
    if (todayData.meals) {
      for (const f of FOODS) {
        const inp = document.querySelector(`input.serving[data-id="${f.id}"]`);
        if (inp) inp.value = todayData.meals[f.id] || 0;
      }
    }
    notesEl.value = todayData.notes || '';

    // daily extras
    if (stepsEl) stepsEl.value = todayData.steps || '';
    if (sleepEl) sleepEl.value = todayData.sleep || '';
    setMoodUI(todayData.mood || null);
    renderExtras(todayData.extras || []);
    renderWaterGlasses(todayData.water || 0);

    // streak badge
    const streak = getStreak(days);
    if (streakBadge) streakBadge.textContent = streak > 0 ? `🔥 ${streak}d` : '';

    // weekly
    if (weekly.length) {
      drawTrend(weekly);
      renderWeeklyStats(weekly, settings.height);
    }

    // protein/cal totals
    updateProteinAndCalories();

    // custom foods — load and merge before rendering meal rows
    const customFoods = res.customFoods || [];
    loadCustomFoods(customFoods);

    // diet schedule + plan builder
    renderPlanBuilder(res.dietPlan || {});
    if (res && res.dietPlan) renderWeeklySchedule(res.dietPlan);

    // insights
    renderInsights(days);

    // photos gallery
    renderPhotosGallery(weekly);

    // fasting timer
    updateFastDisplay();
    startFastInterval();

    // collapsible sections
    initCollapsible();

    // badge
    updateBadge(days);

    // custom food manager UI
    renderCustomFoodsManager(customFoods);
  }

  function onCheckChange(ev) {
    updateCheckVisual(ev.target);
  }

  function updateCheckVisual(cb) {
    const label = cb.closest('.check');
    if (!label) return;
    label.classList.remove('done', 'missed');
    if (cb.checked) label.classList.add('done');
  }

  // calculate protein and calories totals from serving inputs
  function updateProteinAndCalories() {
    let totalProtein = 0;
    let totalCalories = 0;
    for (const f of FOODS) {
      const inp = document.querySelector(`input.serving[data-id="${f.id}"]`);
      if (!inp) continue;
      const servings = Math.max(0, parseFloat(inp.value) || 0);
      const tProtein = +(servings * f.proteinPerServing).toFixed(1);
      const tCal = Math.round(servings * f.caloriesPerServing);
      const totalEl = document.querySelector(`.total[data-id="${f.id}"]`);
      const calTotalEl = document.querySelector(`.calTotal[data-id="${f.id}"]`);
      totalEl.textContent = tProtein;
      calTotalEl.textContent = tCal;
      totalProtein += tProtein;
      totalCalories += tCal;
    }
    // add any ad-hoc extras
    let extraProt = 0, extraCal = 0;
    document.querySelectorAll('.extra-item-row').forEach(row => {
      extraProt += parseFloat(row.dataset.protein) || 0;
      extraCal += parseFloat(row.dataset.calories) || 0;
    });
    const finalProt = Math.round(totalProtein + extraProt);
    const finalCal = Math.round(totalCalories + extraCal);
    totalProteinEl.textContent = finalProt;
    totalCaloriesEl.textContent = finalCal;
    // protein warning
    if (finalProt < MIN_PROTEIN_WARN) {
      proteinWarning.classList.remove('hidden');
    } else {
      proteinWarning.classList.add('hidden');
    }
    // calorie progress bar
    const calBar = document.getElementById('calorieBar');
    const calBarFill = document.getElementById('calorieBarFill');
    const calBarText = document.getElementById('calorieBarText');
    if (calBar && CALORIE_GOAL > 0) {
      calBar.classList.remove('hidden');
      const pct = Math.min(finalCal / CALORIE_GOAL * 100, 100);
      if (calBarFill) calBarFill.style.width = pct + '%';
      const over = finalCal > CALORIE_GOAL;
      if (calBarFill) calBarFill.style.background = over ? 'var(--danger)' : 'var(--accent)';
      if (calBarText) calBarText.textContent = `${finalCal} / ${CALORIE_GOAL} kcal${over ? ' ⚠️' : ''}`;
    }
  }

  // --- Diet upload / parsing ---
  // Accepts CSV natively; will use SheetJS (`XLSX`) for .xlsx/.xls if the library file is present in /lib/
  async function handleDietUpload(file) {
    if (!file) return;
    const name = file.name.toLowerCase();
    dietStatus.textContent = 'Parsing...';
    try {
      if (name.endsWith('.csv')) {
        const text = await readFileAsText(file);
        const rows = parseCSV(text);
        const plan = normalizeDietRows(rows);
        await storageSet({ dietPlan: plan });
        dietStatus.textContent = 'Diet plan imported ✓';
        renderWeeklySchedule(plan);
        renderPlanBuilder(plan);
      } else if ((name.endsWith('.xlsx') || name.endsWith('.xls')) && window.XLSX) {
        // If SheetJS is added to lib/, use it
        const ab = await readFileAsArrayBuffer(file);
        const wb = window.XLSX.read(ab, { type: 'array' });
        const first = wb.SheetNames[0];
        const text = window.XLSX.utils.sheet_to_csv(wb.Sheets[first]);
        const rows = parseCSV(text);
        const plan = normalizeDietRows(rows);
        await storageSet({ dietPlan: plan });
        dietStatus.textContent = 'Diet plan uploaded from Excel.';
        renderWeeklySchedule(plan);
      } else {
        dietStatus.textContent = 'Excel support not available. Please upload CSV or add lib/xlsx.full.min.js to support .xlsx/.xls.';
      }
    } catch (err) {
      console.error(err);
      dietStatus.textContent = 'Error parsing file: ' + (err.message || err);
    }
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsText(file);
    });
  }
  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsArrayBuffer(file);
    });
  }

  // Very small CSV parser (handles simple CSV with headers)
  function parseCSV(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const headers = lines[0].split(/,|;|\t/).map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const cols = line.split(/,|;|\t/).map(c => c.trim());
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] || '');
      return obj;
    });
    return rows;
  }

  // Normalize rows into a dietPlan object keyed by day -> array of meals
  function normalizeDietRows(rows) {
    // Expect columns: Day, Meal, Food Items, Protein (g), Calories (kcal)
    const plan = {};
    for (const r of rows) {
      const day = (r['Day'] || r['day'] || '').trim();
      if (!day) continue;
      const meal = r['Meal'] || r['meal'] || '';
      const foods = r['Food Items'] || r['Food items'] || r['food items'] || '';
      const protein = parseFloat((r['Protein (g)'] || r['Protein'] || r['protein'] || 0)) || 0;
      const calories = parseFloat((r['Calories (kcal)'] || r['Calories'] || r['calories'] || 0)) || 0;
      if (!plan[day]) plan[day] = [];
      plan[day].push({ meal, foods, protein, calories });
    }
    return plan;
  }

  // ── Diet Plan Builder ──────────────────────────────────────────────────────
  const PLAN_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const PLAN_MEALS = ['Breakfast', 'Morning Snack', 'Lunch', 'Evening Snack', 'Dinner', 'Pre-Workout', 'Post-Workout'];

  function renderPlanBuilder(plan) {
    const container = document.getElementById('planBuilderRows');
    if (!container) return;
    container.innerHTML = '';
    const rows = [];
    for (const day of Object.keys(plan || {})) {
      for (const entry of (plan[day] || [])) {
        rows.push({ day, ...entry });
      }
    }
    if (rows.length === 0) {
      addPlanBuilderRow(); // start with one blank row
    } else {
      rows.forEach(r => addPlanBuilderRow(r.day, r.meal, r.foods, r.protein, r.calories));
    }
  }

  function addPlanBuilderRow(day = 'Monday', meal = 'Breakfast', foods = '', protein = '', calories = '') {
    const container = document.getElementById('planBuilderRows');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'plan-builder-row';
    div.innerHTML = `
      <div class="pbr-top">
        <select class="pbr-day">
          ${PLAN_DAYS.map(d => `<option${d === day ? ' selected' : ''}>${d}</option>`).join('')}
        </select>
        <select class="pbr-meal">
          ${PLAN_MEALS.map(m => `<option${m === meal ? ' selected' : ''}>${m}</option>`).join('')}
        </select>
        <button class="pbr-del" title="Remove row">✕</button>
      </div>
      <input class="pbr-foods" type="text" placeholder="Food items (e.g. Rice + Dal + Curd)" value="${foods}">
      <div class="pbr-nums">
        <div class="pbr-num-field">
          <label>Protein (g)</label>
          <input class="pbr-protein" type="number" min="0" step="0.5" placeholder="0" value="${protein}">
        </div>
        <div class="pbr-num-field">
          <label>Calories</label>
          <input class="pbr-cal" type="number" min="0" placeholder="0" value="${calories}">
        </div>
      </div>`;
    div.querySelector('.pbr-del').addEventListener('click', () => div.remove());
    container.appendChild(div);
  }

  async function savePlanFromBuilder() {
    const rows = document.querySelectorAll('.plan-builder-row');
    const plan = {};
    rows.forEach(row => {
      const day = row.querySelector('.pbr-day').value;
      const meal = row.querySelector('.pbr-meal').value;
      const foods = row.querySelector('.pbr-foods').value.trim();
      const protein = parseFloat(row.querySelector('.pbr-protein').value) || 0;
      const calories = parseFloat(row.querySelector('.pbr-cal').value) || 0;
      if (!plan[day]) plan[day] = [];
      plan[day].push({ meal, foods, protein, calories });
    });
    await storageSet({ dietPlan: plan });
    renderWeeklySchedule(plan);
    if (dietStatus) {
      dietStatus.textContent = `✓ Plan saved — ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}.`;
      setTimeout(() => { dietStatus.textContent = ''; }, 2000);
    }
    const btn = document.getElementById('savePlanBtn');
    if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save Plan'; }, 1400); }
  }

  // ── Today's Extras ─────────────────────────────────────────────────────────
  // extras = [{ name, protein, calories }]
  function renderExtras(extras) {
    const list = document.getElementById('extrasList');
    if (!list) return;
    list.innerHTML = '';
    (extras || []).forEach((ex, i) => {
      const row = document.createElement('div');
      row.className = 'extra-item-row';
      row.dataset.protein = ex.protein || 0;
      row.dataset.calories = ex.calories || 0;
      row.innerHTML = `
        <span class="extra-name">${ex.name}</span>
        <span class="extra-macros">${ex.protein || 0}g · ${ex.calories || 0} kcal</span>
        <button class="extra-del" data-idx="${i}" title="Remove">✕</button>`;
      row.querySelector('.extra-del').addEventListener('click', async () => {
        const r = await storageGet(['days']);
        const days = r.days || {};
        const today = dateKey();
        const td = days[today] || {};
        td.extras = (td.extras || []).filter((_, j) => j !== i);
        days[today] = td;
        await storageSet({ days });
        renderExtras(td.extras);
        updateProteinAndCalories();
      });
      list.appendChild(row);
    });
    updateProteinAndCalories();
  }

  async function addExtra() {
    const name = (document.getElementById('efName')?.value || '').trim();
    const protein = parseFloat(document.getElementById('efProtein')?.value) || 0;
    const calories = parseFloat(document.getElementById('efCal')?.value) || 0;
    if (!name) return;
    const r = await storageGet(['days']);
    const days = r.days || {};
    const today = dateKey();
    if (!days[today]) days[today] = {};
    days[today].extras = [...(days[today].extras || []), { name, protein, calories }];
    await storageSet({ days });
    renderExtras(days[today].extras);
    // clear form
    const efName = document.getElementById('efName');
    const efPro = document.getElementById('efProtein');
    const efCal = document.getElementById('efCal');
    if (efName) efName.value = '';
    if (efPro) efPro.value = '';
    if (efCal) efCal.value = '';
  }

  // ── Weekly Meal Schedule ───────────────────────────────────────────────────
  // Render the weekly meal schedule into the popup
  function renderWeeklySchedule(plan) {
    weeklyScheduleEl.innerHTML = '';
    // Expect plan keys like Monday, Tue, or dates; show in insertion order
    for (const day of Object.keys(plan)) {
      const entries = plan[day];
      let totalProtein = 0, totalCalories = 0;
      const dayCard = document.createElement('div'); dayCard.className = 'day-card';
      const header = document.createElement('div'); header.className = 'day-header'; header.textContent = day;
      const list = document.createElement('div'); list.className = 'day-list';
      for (const e of entries) {
        totalProtein += (e.protein || 0);
        totalCalories += (e.calories || 0);
        const row = document.createElement('div'); row.className = 'meal-row';
        row.innerHTML = `<div class="meal-name">${e.meal || ''}</div><div class="meal-foods muted">${e.foods || ''}</div><div class="meal-stats">${e.protein} g · ${e.calories} kcal</div>`;
        list.appendChild(row);
      }
      const totals = document.createElement('div'); totals.className = 'day-totals';
      totals.innerHTML = `Total: <strong>${Math.round(totalProtein)} g</strong> · <span>${Math.round(totalCalories)} kcal</span>`;
      if (totalProtein < 90) { totals.classList.add('low-protein'); } else { totals.classList.add('ok-protein'); }
      dayCard.appendChild(header); dayCard.appendChild(list); dayCard.appendChild(totals);
      weeklyScheduleEl.appendChild(dayCard);
    }
  }


  // Save today's data
  async function saveToday() {
    const today = dateKey();
    const res = await storageGet(['days']);
    const days = res.days || {};

    const checks = {};
    for (const k of checklistKeys) { checks[k] = !!document.getElementById(k).checked; }

    const meals = {};
    for (const f of FOODS) {
      const inp = document.querySelector(`input.serving[data-id="${f.id}"]`);
      meals[f.id] = Math.max(0, parseFloat(inp.value) || 0);
    }

    const totalProtein = parseFloat(totalProteinEl.textContent) || 0;
    const totalCalories = parseFloat(totalCaloriesEl.textContent) || 0;
    const steps = stepsEl ? (parseInt(stepsEl.value) || 0) : 0;
    const sleep = sleepEl ? (parseFloat(sleepEl.value) || 0) : 0;
    const mood = document.querySelector('.mood-btn.mood-active')?.dataset.mood || null;

    days[today] = {
      checks, meals,
      notes: notesEl.value,
      totalProtein, totalCalories,
      steps, sleep, mood,
      extras: days[today]?.extras || [],
      water: days[today]?.water || 0,
    };
    await storageSet({ days });

    // update badge
    updateBadge(days);

    // auto-tick protein goal
    const hitProteinCb = document.getElementById('hitProtein');
    hitProteinCb.checked = totalProtein >= MIN_PROTEIN_WARN;
    updateCheckVisual(hitProteinCb);

    // update streak badge
    const streak = getStreak(days);
    if (streakBadge) streakBadge.textContent = streak > 0 ? `🔥 ${streak}d` : '';

    // refresh insights with new data
    renderInsights(days);

    saveDayBtn.textContent = 'Saved ✓';
    setTimeout(() => saveDayBtn.textContent = 'Save Today', 1400);
  }

  // Save weekly entry (weight, waist, photo)
  async function saveWeeklyEntry() {
    const weight = parseFloat(weightEl.value) || null;
    const waist = parseFloat(waistEl.value) || null;
    const file = photoEl.files && photoEl.files[0];
    let photoData = null;
    if (file) {
      // Warn if photo is very large
      if (file.size > 2 * 1024 * 1024) {
        showToast('⚠️ Photo is large (>2 MB) — consider compressing it first');
      }
      photoData = await readFileAsDataURL(file);
    }
    const today = dateKey();
    const res = await storageGet(['weekly']);
    const weekly = res.weekly || [];
    weekly.push({ date: today, weight, waist, photo: photoData });
    await storageSet({ weekly });
    // Check storage usage and warn if nearing Chrome's 10 MB limit
    if (chrome.storage.local.getBytesInUse) {
      chrome.storage.local.getBytesInUse(null, bytes => {
        if (bytes > 8 * 1024 * 1024) {
          showToast('⚠️ Storage nearly full (~' + Math.round(bytes / 1024 / 1024) + ' MB). Export & clear old photos.', 4000);
        }
      });
    }
    const sr = await storageGet(['settings']);
    drawTrend(weekly);
    renderWeeklyStats(weekly, (sr.settings || {}).height);
    saveWeeklyBtn.textContent = 'Saved ✓';
    setTimeout(() => saveWeeklyBtn.textContent = 'Save Weekly Entry', 1200);
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  function renderWeeklyStats(weekly, height) {
    const last = weekly.slice(-7);
    const latest = last.length ? last[last.length - 1] : null;
    const h = height ? parseFloat(height) : (heightInput ? parseFloat(heightInput.value) : 0);
    let bmiHtml = '';
    if (latest && latest.weight && h > 0) {
      const bmi = latest.weight / Math.pow(h / 100, 2);
      const cat = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal ✓' : bmi < 30 ? 'Overweight' : 'Obese';
      const col = bmi < 25 ? 'var(--accent)' : bmi < 30 ? 'var(--warn)' : 'var(--danger)';
      bmiHtml = `<div class="weekly-stat-row"><span>BMI</span><strong style="color:${col}">${bmi.toFixed(1)} <small>(${cat})</small></strong></div>`;
    }
    weeklyStats.innerHTML = `
      <div class="weekly-stat-row"><span>Entries</span><strong>${weekly.length}</strong></div>
      <div class="weekly-stat-row"><span>Weight</span><strong>${latest ? (latest.weight || '—') + ' kg' : '—'}</strong></div>
      <div class="weekly-stat-row"><span>Waist</span><strong>${latest ? (latest.waist || '—') + ' cm' : '—'}</strong></div>
      ${bmiHtml}
    `;
  }

  // ── Custom Foods ───────────────────────────────────────────────────────────
  // Merges custom foods into the active FOODS list and persists to storage.
  function loadCustomFoods(customs) {
    CUSTOM_FOODS = customs || [];
  }

  function getActiveFoodsWithCustom() {
    const base = FOODS === FOODS_NONVEG ? [...FOODS_NONVEG] : [...FOODS_VEG];
    // Append custom foods (de-dupe by id)
    const existingIds = new Set(base.map(f => f.id));
    CUSTOM_FOODS.forEach(f => { if (!existingIds.has(f.id)) base.push(f); });
    return base;
  }

  async function saveCustomFoods() {
    await storageSet({ customFoods: CUSTOM_FOODS });
  }

  function renderCustomFoodsManager(customs) {
    const container = document.getElementById('customFoodsManager');
    if (!container) return;
    CUSTOM_FOODS = customs || [];
    container.innerHTML = '';
    if (CUSTOM_FOODS.length) {
      const list = document.createElement('div');
      list.className = 'custom-foods-list';
      CUSTOM_FOODS.forEach((f, idx) => {
        const row = document.createElement('div');
        row.className = 'custom-food-row';
        row.innerHTML = `
          <span class="cf-label">${f.label}</span>
          <span class="cf-macros">${f.proteinPerServing}g · ${f.caloriesPerServing} kcal</span>
          <button class="cf-del" data-idx="${idx}" title="Remove">✕</button>`;
        row.querySelector('.cf-del').addEventListener('click', async () => {
          CUSTOM_FOODS.splice(idx, 1);
          await saveCustomFoods();
          renderCustomFoodsManager(CUSTOM_FOODS);
          refreshMealRows();
        });
        list.appendChild(row);
      });
      container.appendChild(list);
    }
  }

  async function addCustomFood() {
    const nameEl = document.getElementById('cfName');
    const protEl = document.getElementById('cfProtein');
    const calEl = document.getElementById('cfCal');
    const label = (nameEl?.value || '').trim();
    const protein = parseFloat(protEl?.value) || 0;
    const cal = parseFloat(calEl?.value) || 0;
    if (!label) { showToast('Enter a food name'); return; }
    const id = 'custom_' + label.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
    CUSTOM_FOODS.push({ id, label, proteinPerServing: protein, caloriesPerServing: cal });
    await saveCustomFoods();
    renderCustomFoodsManager(CUSTOM_FOODS);
    refreshMealRows();
    if (nameEl) nameEl.value = '';
    if (protEl) protEl.value = '';
    if (calEl) calEl.value = '';
    showToast(`"${label}" added to today's meal list ✓`);
  }

  // Refreshes meal rows preserving current serving values
  function refreshMealRows() {
    const activeList = getActiveFoodsWithCustom();
    // Snapshot current values
    const snapshot = {};
    FOODS.forEach(f => {
      const inp = document.querySelector(`input.serving[data-id="${f.id}"]`);
      if (inp) snapshot[f.id] = inp.value;
    });
    // Update global FOODS reference for the active list
    FOODS = activeList;
    renderMealRows();
    // Restore values
    Object.keys(snapshot).forEach(id => {
      const inp = document.querySelector(`input.serving[data-id="${id}"]`);
      if (inp && snapshot[id]) inp.value = snapshot[id];
    });
    document.querySelectorAll('.serving').forEach(inp =>
      inp.addEventListener('input', updateProteinAndCalories)
    );
    updateProteinAndCalories();
  }

  // ── Diet mode switcher ─────────────────────────────────────────────────────
  function setDietMode(type) {
    const base = type === 'nonveg' ? FOODS_NONVEG : FOODS_VEG;
    // Merge custom foods
    const existingIds = new Set(base.map(f => f.id));
    const merged = [...base, ...CUSTOM_FOODS.filter(f => !existingIds.has(f.id))];
    FOODS = merged;
    if (dietModeVegBtn) dietModeVegBtn.classList.toggle('diet-active', type === 'veg');
    if (dietModeNonvegBtn) dietModeNonvegBtn.classList.toggle('diet-active', type === 'nonveg');
    renderMealRows();
    document.querySelectorAll('.serving').forEach(inp =>
      inp.addEventListener('input', updateProteinAndCalories)
    );
    updateProteinAndCalories();
    updateSubtitle();
  }

  async function saveDietType(type) {
    const r = await storageGet(['settings']);
    const s = r.settings || {};
    s.dietType = type;
    await storageSet({ settings: s });
  }

  // ── Dynamic subtitle ───────────────────────────────────────────────────────
  function updateSubtitle() {
    if (!headerSubtitle) return;
    const dietLabel = (FOODS === FOODS_NONVEG) ? '🍗 Non-Veg' : '🥦 Veg';
    const activeShiftBtn = document.querySelector('.shift-type-btn.shift-active');
    const shiftLabel = activeShiftBtn ? activeShiftBtn.dataset.shift : null;
    const customName = shiftNameInput ? shiftNameInput.value.trim() : '';
    let shiftText = customName || shiftLabel || 'Day Shift';
    headerSubtitle.textContent = `${dietLabel} · ${shiftText}`;
  }

  // ── Shift settings ─────────────────────────────────────────────────────────
  function setShiftType(type) {
    document.querySelectorAll('.shift-type-btn').forEach(b =>
      b.classList.toggle('shift-active', b.dataset.shift === type)
    );
    updateSubtitle();
  }

  async function saveShift() {
    const r = await storageGet(['settings']);
    const s = r.settings || {};
    const activeBtn = document.querySelector('.shift-type-btn.shift-active');
    s.shiftType = activeBtn ? activeBtn.dataset.shift : 'Day';
    s.shiftName = shiftNameInput ? shiftNameInput.value.trim() : '';
    s.shiftWake = shiftWakeInput ? shiftWakeInput.value : '';
    s.shiftSleep = shiftSleepInput ? shiftSleepInput.value : '';
    await storageSet({ settings: s });
    // also update reminder time to match wake time if wake is set
    if (s.shiftWake && reminderTimeEl) reminderTimeEl.value = s.shiftWake;
    if (saveShiftBtn) {
      saveShiftBtn.textContent = 'Saved ✓';
      setTimeout(() => { saveShiftBtn.textContent = 'Save Shift'; }, 1400);
    }
    updateSubtitle();
  }

  // ── Height → BMI ───────────────────────────────────────────────────────────
  async function saveHeight() {
    const r = await storageGet(['settings', 'weekly']);
    const s = r.settings || {};
    s.height = heightInput ? (parseFloat(heightInput.value) || '') : '';
    await storageSet({ settings: s });
    renderWeeklyStats(r.weekly || [], s.height);
  }

  // ── Mood UI ────────────────────────────────────────────────────────────────
  function setMoodUI(activeKey) {
    document.querySelectorAll('.mood-btn').forEach(btn =>
      btn.classList.toggle('mood-active', btn.dataset.mood === activeKey)
    );
  }

  // ── Streak counter (consecutive days with saved data before today) ─────────
  function getStreak(days) {
    let streak = 0;
    const base = new Date();
    for (let i = 1; i <= 90; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      if (days[dateKey(d)]) streak++;
      else break;
    }
    return streak;
  }

  // ── Insights: yesterday + last 7 days ─────────────────────────────────────
  function renderInsights(days) {
    const insightsEl = document.getElementById('insightsPanel');
    if (!insightsEl) return;

    // Helper: format date label
    function fmtDate(key) {
      const d = new Date(key + 'T00:00:00');
      return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }

    // ── Yesterday card ──────────────────────────────────────────────────────
    const todayD = new Date();
    const yesterdayD = new Date(todayD);
    yesterdayD.setDate(todayD.getDate() - 1);
    const yk = dateKey(yesterdayD);
    const yd = days[yk];

    let yHtml = '';
    if (yd) {
      const checks = yd.checks || {};
      const done = Object.values(checks).filter(Boolean).length;
      const total = checklistKeys.length;
      const prot = yd.totalProtein || 0;
      const cals = yd.totalCalories || 0;
      const steps = yd.steps || 0;
      const sleep = yd.sleep || 0;
      const mood = yd.mood || null;
      const moodInfo = mood ? MOODS.find(m => m.key === mood) : null;
      const protColor = prot >= MIN_PROTEIN_WARN ? 'var(--accent)' : 'var(--danger)';
      const stepsColor = steps >= STEPS_GOAL ? 'var(--accent)' : 'var(--warn)';
      const sleepColor = sleep >= SLEEP_GOAL ? 'var(--accent)' : 'var(--warn)';
      const badge = done === total ? '🔥 Perfect day!' : done >= 3 ? '👍 Good effort' : '😐 Keep going';
      yHtml = `
        <div class="insight-card">
          <div class="insight-title">Yesterday <span class="insight-date">${fmtDate(yk)}</span></div>
          <div class="insight-row"><span>Protein</span><strong style="color:${protColor}">${prot} g</strong></div>
          <div class="insight-row"><span>Calories</span><strong>${cals} kcal</strong></div>
          <div class="insight-row"><span>Steps</span><strong style="color:${stepsColor}">${steps ? steps.toLocaleString() : '—'}</strong></div>
          <div class="insight-row"><span>Sleep</span><strong style="color:${sleepColor}">${sleep ? sleep + ' hrs' : '—'}</strong></div>
          <div class="insight-row"><span>Mood</span><strong>${moodInfo ? moodInfo.emoji + ' ' + moodInfo.label : '—'}</strong></div>
          <div class="insight-row"><span>Checklist</span><strong>${done}/${total} done</strong></div>
          <div class="insight-badge">${badge}</div>
          ${yd.notes ? `<div class="insight-note">&ldquo;${yd.notes}&rdquo;</div>` : ''}
        </div>`;
    } else {
      yHtml = `<div class="insight-card insight-empty">No data logged for yesterday.</div>`;
    }

    // ── Last 7 days table ──────────────────────────────────────────────────
    const dayKeys = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(todayD);
      d.setDate(todayD.getDate() - (i + 1));
      return dateKey(d);
    }).reverse();

    let rowsHtml = dayKeys.map(k => {
      const d = days[k];
      if (!d) return `<tr class="ins-row ins-empty"><td>${fmtDate(k)}</td><td colspan="4">—</td></tr>`;
      const checks = d.checks || {};
      const done = Object.values(checks).filter(Boolean).length;
      const prot = d.totalProtein || 0;
      const steps = d.steps || 0;
      const sleep = d.sleep || 0;
      const moodInfo = d.mood ? MOODS.find(m => m.key === d.mood) : null;
      const protOk = prot >= MIN_PROTEIN_WARN;
      const stepsOk = steps >= STEPS_GOAL;
      const sleepOk = sleep >= SLEEP_GOAL;
      return `<tr class="ins-row">
        <td>${fmtDate(k)}</td>
        <td style="color:${protOk ? 'var(--accent)' : 'var(--danger)'}">${prot}g</td>
        <td style="color:${stepsOk ? 'var(--accent)' : 'var(--warn)'}">${steps ? Math.round(steps / 1000) + 'k' : '—'}</td>
        <td style="color:${sleepOk ? 'var(--accent)' : 'var(--warn)'}">${sleep ? sleep + 'h' : '—'}</td>
        <td>${moodInfo ? moodInfo.emoji : '—'}</td>
      </tr>`;
    }).join('');

    const weekHtml = `
      <div class="insight-card">
        <div class="insight-title">Last 7 Days</div>
        <table class="ins-table">
          <thead><tr><th>Day</th><th>Prot</th><th>Steps</th><th>Sleep</th><th>Mood</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;

    insightsEl.innerHTML = yHtml + weekHtml;
  }

  // draw trend using simple-chart helper (weight over time)
  function drawTrend(weekly) {
    const last = weekly.slice(-8);
    if (!last.length) return;
    const data = last.map(e => e.weight || 0);
    const labels = last.map(e => e.date.slice(5));
    try {
      window.renderLineChart(trendCanvas, labels, data, { color: '#10b981' });
    } catch (e) {
      // fallback to noop
      console.warn(e);
    }
  }

  // Download a blank CSV diet template for the user to fill in
  function downloadCsvTemplate() {
    const header = 'Day,Meal,Food Items,Protein (g),Calories (kcal)';
    const rows = [
      'Monday,Breakfast,Paneer + Curd + Fruits,23,310',
      'Monday,Lunch,Dal + Boiled Veg + Curd,25,280',
      'Monday,Dinner,Paneer + Dal + Boiled Veg,39,420',
      'Tuesday,Breakfast,Nuts + Curd + Fruits,11,280',
      'Tuesday,Lunch,Dal + Paneer + Boiled Veg,39,420',
      'Tuesday,Dinner,Curd + Dal + Boiled Veg,25,280',
    ];
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diet_template.csv';
    // Must be in the DOM for Firefox/Chrome extension popups to trigger download
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    dietStatus.textContent = 'Template downloaded.';
    setTimeout(() => { dietStatus.textContent = ''; }, 2000);
  }

  // ── Theme toggle ────────────────────────────────────────────────────────────
  function applyTheme(theme) {
    document.body.classList.toggle('light', theme === 'light');
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
  }
  async function toggleTheme() {
    const r = await storageGet(['settings']);
    const s = r.settings || {};
    s.theme = s.theme === 'light' ? 'dark' : 'light';
    await storageSet({ settings: s });
    applyTheme(s.theme);
  }

  // ── Goals ────────────────────────────────────────────────────────────────────
  async function saveGoals() {
    const pg = parseInt(document.getElementById('proteinGoal')?.value) || 90;
    const cg = parseInt(document.getElementById('calorieGoal')?.value) || 1800;
    const sg = parseInt(document.getElementById('stepsGoal')?.value) || 8000;
    const sl = parseFloat(document.getElementById('sleepGoal')?.value) || 7;
    MIN_PROTEIN_WARN = pg;
    CALORIE_GOAL = cg;
    STEPS_GOAL = sg;
    SLEEP_GOAL = sl;
    const r = await storageGet(['settings']);
    const s = r.settings || {};
    s.proteinGoal = pg;
    s.calorieGoal = cg;
    s.stepsGoal = sg;
    s.sleepGoal = sl;
    await storageSet({ settings: s });
    updateProteinAndCalories();
    showToast('Goals saved ✓');
  }

  // ── Water Tracker ─────────────────────────────────────────────────────────────
  function renderWaterGlasses(count) {
    const container = document.getElementById('waterGlasses');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const btn = document.createElement('button');
      btn.className = 'glass-btn' + (i < count ? ' glass-filled' : '');
      btn.title = 'Glass ' + (i + 1);
      btn.textContent = i < count ? '🥤' : '🫙';
      btn.dataset.idx = i;
      btn.addEventListener('click', () => {
        // clicking a filled glass clears from that glass onward; clicking empty fills up to it
        const newCount = i < count ? i : i + 1;
        saveWater(newCount);
      });
      container.appendChild(btn);
    }
    const countEl = document.getElementById('waterCount');
    if (countEl) countEl.textContent = count;
  }

  async function saveWater(count) {
    const r = await storageGet(['days']);
    const days = r.days || {};
    const today = dateKey();
    if (!days[today]) days[today] = {};
    days[today].water = count;
    await storageSet({ days });
    renderWaterGlasses(count);
  }

  // ── Fasting Timer ──────────────────────────────────────────────────────────────
  let _fastInterval = null;

  function formatFastDuration(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function updateFastDisplay() {
    const display = document.getElementById('fastTimeDisplay');
    const statusEl = document.getElementById('fastStatus');
    const btn = document.getElementById('fastToggleBtn');
    const ring = document.getElementById('fastRing');
    if (!display) return;
    chrome.storage.local.get(['settings'], res => {
      const s = res.settings || {};
      const fastStart = s.fastStart || null;
      const targetHrs = parseFloat(document.getElementById('fastTarget')?.value) || 16;
      const targetMs = targetHrs * 3600 * 1000;
      const circ = 2 * Math.PI * 28; // r=28
      if (fastStart) {
        const elapsed = Date.now() - fastStart;
        display.textContent = formatFastDuration(elapsed);
        const pct = Math.min(elapsed / targetMs * 100, 100);
        if (ring) ring.style.strokeDashoffset = circ - (pct / 100) * circ;
        if (elapsed >= targetMs) {
          display.style.color = 'var(--accent)';
          if (statusEl) statusEl.textContent = `✅ Goal reached! ${formatFastDuration(elapsed)} fasted`;
        } else {
          display.style.color = 'var(--text)';
          if (statusEl) statusEl.textContent = `${formatFastDuration(targetMs - elapsed)} to ${targetHrs}h goal`;
        }
        if (btn) btn.textContent = 'Stop Fast';
      } else {
        display.textContent = '——:——:——';
        display.style.color = 'var(--muted)';
        if (statusEl) statusEl.textContent = 'No active fast';
        if (btn) btn.textContent = 'Start Fast';
        if (ring) ring.style.strokeDashoffset = circ;
      }
    });
  }

  async function toggleFast() {
    const r = await storageGet(['settings']);
    const s = r.settings || {};
    if (s.fastStart) {
      // Clear the background completion alarm
      chrome.alarms.clear('fast_complete');
      // Record duration on today's data
      const dur = Date.now() - s.fastStart;
      const dr = await storageGet(['days']);
      const days = dr.days || {};
      const today = dateKey();
      if (!days[today]) days[today] = {};
      days[today].lastFastDuration = dur;
      await storageSet({ days });
      delete s.fastStart;
      showToast(`Fast ended — ${formatFastDuration(dur)} ✓`);
    } else {
      s.fastStart = Date.now();
      // Schedule a background alarm so notification fires even if popup is closed
      const targetHrs = parseFloat(document.getElementById('fastTarget')?.value) || 16;
      chrome.alarms.create('fast_complete', { delayInMinutes: targetHrs * 60 });
      showToast('Fast started ⏱️');
    }
    await storageSet({ settings: s });
    updateFastDisplay();
  }

  function startFastInterval() {
    if (_fastInterval) clearInterval(_fastInterval);
    _fastInterval = setInterval(updateFastDisplay, 1000);
  }

  // ── Copy Meals from Yesterday ──────────────────────────────────────────────
  async function copyYesterdayMeals() {
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    const r = await storageGet(['days']);
    const yd = (r.days || {})[dateKey(yest)];
    if (!yd || !yd.meals) { showToast('No meal data from yesterday'); return; }
    for (const f of FOODS) {
      const inp = document.querySelector(`input.serving[data-id="${f.id}"]`);
      if (inp && yd.meals[f.id] != null) inp.value = yd.meals[f.id];
    }
    updateProteinAndCalories();
    showToast('Filled from yesterday ✓');
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  function showToast(msg, duration = 2200) {
    let toast = document.getElementById('fitToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'fitToast';
      toast.className = 'fit-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('toast-show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('toast-show'), duration);
  }

  // ── Export / Import ────────────────────────────────────────────────────────
  async function exportData() {
    const data = await new Promise(resolve => chrome.storage.local.get(null, resolve));
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fittrack-backup-${dateKey()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Data exported ✓');
  }

  async function importData(file) {
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      let data;
      try { data = JSON.parse(text); }
      catch (parseErr) { showToast('❌ Invalid file — not valid JSON'); return; }
      // Validate it looks like a FitTrack Daily backup
      const hasKnownKey = data && (
        'settings' in data || 'days' in data || 'weekly' in data || 'dietPlan' in data
      );
      if (!hasKnownKey) {
        showToast('❌ File does not look like a FitTrack Daily backup');
        return;
      }
      // Guard against unexpected types in days values
      if (data.days && typeof data.days !== 'object') {
        showToast('❌ Backup data is corrupted (days field)');
        return;
      }
      if (data.weekly && !Array.isArray(data.weekly)) {
        showToast('❌ Backup data is corrupted (weekly field)');
        return;
      }
      await new Promise(resolve => chrome.storage.local.set(data, resolve));
      showToast('Imported! Reloading…');
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      showToast('Import failed: ' + (e.message || e));
    }
  }

  // ── Weekly Summary ─────────────────────────────────────────────────────────
  async function toggleWeeklySummary() {
    const panel = document.getElementById('weeklySummaryPanel');
    if (!panel) return;
    const isHidden = panel.classList.toggle('hidden');
    const btn = document.getElementById('weeklySummaryBtn');
    if (btn) btn.textContent = isHidden ? '📊 Weekly Summary' : '📊 Hide Summary';
    if (isHidden) return;
    const r = await storageGet(['days']);
    const days = r.days || {};
    const keys = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (i + 1)); return dateKey(d);
    }).reverse();
    const logged = keys.map(k => days[k]).filter(Boolean);
    if (!logged.length) { panel.innerHTML = '<div class="insight-empty">No data for the past week.</div>'; return; }
    const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const avgProt = avg(logged.map(d => d.totalProtein || 0));
    const avgCals = avg(logged.map(d => d.totalCalories || 0));
    const avgSteps = avg(logged.map(d => d.steps || 0));
    const avgSleep = (logged.reduce((a, d) => a + (d.sleep || 0), 0) / logged.length).toFixed(1);
    const totalWater = logged.reduce((a, d) => a + (d.water || 0), 0);
    const bestDay = keys.reduce((best, k) => {
      const d = days[k]; if (!d) return best;
      const score = Object.values(d.checks || {}).filter(Boolean).length;
      return score > (best.score || -1) ? { k, score } : best;
    }, { k: null, score: -1 }).k;
    const protColor = avgProt >= MIN_PROTEIN_WARN ? 'var(--accent)' : 'var(--danger)';
    const calColor = CALORIE_GOAL > 0 && avgCals > CALORIE_GOAL ? 'var(--danger)' : 'var(--text)';
    panel.innerHTML = `
      <div class="insight-card" style="margin-top:8px">
        <div class="insight-title">📊 7-Day Summary <span class="insight-date">(last 7 days)</span></div>
        <div class="insight-row"><span>Days logged</span><strong>${logged.length}/7</strong></div>
        <div class="insight-row"><span>Avg protein</span><strong style="color:${protColor}">${avgProt}g / ${MIN_PROTEIN_WARN}g goal</strong></div>
        <div class="insight-row"><span>Avg calories</span><strong style="color:${calColor}">${avgCals} kcal</strong></div>
        <div class="insight-row"><span>Avg steps</span><strong>${avgSteps.toLocaleString()}</strong></div>
        <div class="insight-row"><span>Avg sleep</span><strong>${avgSleep} hrs</strong></div>
        <div class="insight-row"><span>Total water</span><strong>💧 ${totalWater} glasses</strong></div>
        ${bestDay ? `<div class="insight-row"><span>Best day</span><strong>🏆 ${new Date(bestDay + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</strong></div>` : ''}
      </div>`;
  }

  // ── Photos Gallery ──────────────────────────────────────────────────────────
  function renderPhotosGallery(weekly) {
    const gallery = document.getElementById('photosGallery');
    if (!gallery) return;
    const withPhotos = (weekly || []).filter(e => e.photo);
    if (!withPhotos.length) { gallery.innerHTML = ''; return; }
    gallery.innerHTML = `
      <div class="gallery-title">📸 Progress Photos</div>
      <div class="gallery-grid">
        ${withPhotos.map(e => `
          <div class="gallery-item" data-date="${e.date}" data-src="${e.photo}">
            <img src="${e.photo}" alt="${e.date}" class="gallery-thumb">
            <div class="gallery-label">${e.date.slice(5)}${e.weight ? ' · ' + e.weight + 'kg' : ''}</div>
          </div>`).join('')}
      </div>`;
    gallery.querySelectorAll('.gallery-item').forEach(item => {
      item.addEventListener('click', () => showPhotoLightbox(item.dataset.src, item.dataset.date));
    });
  }

  function showPhotoLightbox(src, date) {
    let lb = document.getElementById('photoLightbox');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'photoLightbox';
      lb.className = 'lightbox';
      lb.innerHTML = '<div class="lb-backdrop"></div><div class="lb-content"><img id="lbImg" alt=""><div id="lbDate" class="lb-date"></div><button id="lbClose" class="lb-close">✕</button></div>';
      document.body.appendChild(lb);
      lb.querySelector('.lb-backdrop').addEventListener('click', () => lb.classList.add('hidden'));
      lb.querySelector('#lbClose').addEventListener('click', () => lb.classList.add('hidden'));
    }
    lb.querySelector('#lbImg').src = src;
    lb.querySelector('#lbDate').textContent = date;
    lb.classList.remove('hidden');
  }

  // ── Collapsible sections ────────────────────────────────────────────────────
  function initCollapsible() {
    document.querySelectorAll('section.collapsible').forEach(sec => {
      const h2 = sec.querySelector('h2');
      if (!h2) return;
      // derive storage key from most specific class
      const cls = Array.from(sec.classList).filter(c => c !== 'collapsible')[0] || sec.id;
      const key = 'col_' + cls;
      if (localStorage.getItem(key) === 'collapsed') sec.classList.add('collapsed');
      h2.addEventListener('click', () => {
        sec.classList.toggle('collapsed');
        localStorage.setItem(key, sec.classList.contains('collapsed') ? 'collapsed' : 'open');
      });
    });
  }

  // ── Badge counter ────────────────────────────────────────────────────────────
  function updateBadge(days) {
    try {
      const today = dateKey();
      const td = days[today] || {};
      const done = Object.values(td.checks || {}).filter(Boolean).length;
      const streak = getStreak(days);
      const text = streak > 0 ? `${streak}` : (done > 0 ? `${done}` : '');
      chrome.action.setBadgeText({ text });
      chrome.action.setBadgeBackgroundColor({ color: streak > 0 ? '#f59e0b' : '#10b981' });
    } catch (_) { }
  }

  // Schedule reminder — create alarm directly (reliable in MV3; no SW messaging needed)
  async function scheduleReminder() {
    const time = reminderTimeEl.value || '09:00';
    const enabled = enableRemindersEl.checked;
    // Merge into existing settings so nothing else is lost
    const r = await storageGet(['settings']);
    const s = r.settings || {};
    s.reminderTime = time;
    s.remindersEnabled = enabled;
    await storageSet({ settings: s });
    if (enabled) {
      const [hh, mm] = time.split(':').map(Number);
      const now = new Date();
      const when = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
      if (when.getTime() <= now.getTime()) when.setDate(when.getDate() + 1);
      chrome.alarms.create('daily_reminder', { when: when.getTime(), periodInMinutes: 24 * 60 });
    } else {
      chrome.alarms.clear('daily_reminder');
    }
  }

  // Reset weekly data
  async function resetWeek() {
    await storageSet({ weekly: [] });
    weeklyStats.innerHTML = '';
    // Explicitly clear the canvas so the stale chart disappears
    if (trendCanvas) {
      const ctx = trendCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, trendCanvas.width, trendCanvas.height);
    }
    const gallery = document.getElementById('photosGallery');
    if (gallery) gallery.innerHTML = '';
    renderInsights({});
    showToast('Weekly entries & photos cleared ✓');
  }

  // init
  function attachHandlers() {
    saveDayBtn.addEventListener('click', saveToday);
    saveWeeklyBtn.addEventListener('click', saveWeeklyEntry);
    resetWeekBtn.addEventListener('click', () => {
      if (confirm('Reset all weekly entries?\n\n⚠️ This will permanently delete all weekly logs AND progress photos. This cannot be undone.')) resetWeek();
    });
    reminderTimeEl.addEventListener('change', scheduleReminder);
    enableRemindersEl.addEventListener('change', scheduleReminder);

    // Diet mode toggle
    if (dietModeVegBtn) dietModeVegBtn.addEventListener('click', async () => {
      setDietMode('veg');
      await saveDietType('veg');
    });
    if (dietModeNonvegBtn) dietModeNonvegBtn.addEventListener('click', async () => {
      setDietMode('nonveg');
      await saveDietType('nonveg');
    });

    // Height (for BMI)
    if (heightInput) heightInput.addEventListener('change', saveHeight);

    // Shift type buttons
    document.querySelectorAll('.shift-type-btn').forEach(btn => {
      btn.addEventListener('click', () => setShiftType(btn.dataset.shift));
    });
    if (saveShiftBtn) saveShiftBtn.addEventListener('click', saveShift);
    // Live subtitle update when typing custom shift name
    if (shiftNameInput) shiftNameInput.addEventListener('input', updateSubtitle);

    // Mood buttons
    document.querySelectorAll('.mood-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const already = btn.classList.contains('mood-active');
        document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('mood-active'));
        if (!already) btn.classList.add('mood-active');
      });
    });

    // Diet upload handlers
    if (uploadDietBtn) uploadDietBtn.addEventListener('click', () => handleDietUpload(dietFileEl.files && dietFileEl.files[0]));
    if (downloadTemplateBtn) downloadTemplateBtn.addEventListener('click', downloadCsvTemplate);

    // Plan builder tabs
    const tabBuild = document.getElementById('tabBuild');
    const tabImport = document.getElementById('tabImport');
    const panelBuild = document.getElementById('panelBuild');
    const panelImport = document.getElementById('panelImport');
    if (tabBuild && tabImport) {
      tabBuild.addEventListener('click', () => {
        tabBuild.classList.add('plan-tab-active');
        tabImport.classList.remove('plan-tab-active');
        panelBuild.classList.remove('hidden');
        panelImport.classList.add('hidden');
      });
      tabImport.addEventListener('click', () => {
        tabImport.classList.add('plan-tab-active');
        tabBuild.classList.remove('plan-tab-active');
        panelImport.classList.remove('hidden');
        panelBuild.classList.add('hidden');
      });
    }

    // Plan builder add/save
    const addPlanRowBtn = document.getElementById('addPlanRowBtn');
    const savePlanBtn = document.getElementById('savePlanBtn');
    if (addPlanRowBtn) addPlanRowBtn.addEventListener('click', () => addPlanBuilderRow());
    if (savePlanBtn) savePlanBtn.addEventListener('click', savePlanFromBuilder);

    // Today's Extras
    const showExtraForm = document.getElementById('showExtraForm');
    const extraFormEl = document.getElementById('extraForm');
    const addExtraBtn = document.getElementById('addExtraBtn');
    if (showExtraForm && extraFormEl) {
      showExtraForm.addEventListener('click', () => {
        const hidden = extraFormEl.classList.toggle('hidden');
        showExtraForm.textContent = hidden ? '+ Add' : '− Close';
      });
    }
    if (addExtraBtn) addExtraBtn.addEventListener('click', addExtra);

    // Theme toggle
    const themeToggleBtn = document.getElementById('themeToggle');
    if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);

    // Goals: save on blur
    const pgEl = document.getElementById('proteinGoal');
    const cgEl = document.getElementById('calorieGoal');
    const sgEl = document.getElementById('stepsGoal');
    const slEl = document.getElementById('sleepGoal');
    if (pgEl) pgEl.addEventListener('change', saveGoals);
    if (cgEl) cgEl.addEventListener('change', saveGoals);
    if (sgEl) sgEl.addEventListener('change', saveGoals);
    if (slEl) slEl.addEventListener('change', saveGoals);

    // Copy meals from yesterday
    const copyYestBtn = document.getElementById('copyYesterdayBtn');
    if (copyYestBtn) copyYestBtn.addEventListener('click', copyYesterdayMeals);

    // Fasting timer
    const fastToggleBtn = document.getElementById('fastToggleBtn');
    if (fastToggleBtn) fastToggleBtn.addEventListener('click', toggleFast);
    const fastTargetEl = document.getElementById('fastTarget');
    if (fastTargetEl) fastTargetEl.addEventListener('change', updateFastDisplay);

    // Custom food form toggle + add
    const showCfBtn = document.getElementById('showCustomFoodForm');
    const cfFormEl = document.getElementById('customFoodForm');
    const addCfBtn = document.getElementById('addCustomFoodBtn');
    if (showCfBtn && cfFormEl) {
      showCfBtn.addEventListener('click', () => {
        const hidden = cfFormEl.classList.toggle('hidden');
        showCfBtn.textContent = hidden ? '+ Add Food' : '− Close';
      });
    }
    if (addCfBtn) addCfBtn.addEventListener('click', addCustomFood);

    // Export / Import
    const exportBtn = document.getElementById('exportDataBtn');
    const importInput = document.getElementById('importDataInput');
    if (exportBtn) exportBtn.addEventListener('click', exportData);
    if (importInput) importInput.addEventListener('change', e => importData(e.target.files[0]));

    // Weekly summary
    const summaryBtn = document.getElementById('weeklySummaryBtn');
    if (summaryBtn) summaryBtn.addEventListener('click', toggleWeeklySummary);
  }

  attachHandlers();
  loadState();

})();
