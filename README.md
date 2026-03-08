# FitTrack Daily

> A privacy-first Chrome Extension for daily fat-loss tracking — protein, calories, steps, sleep, mood, fasting timer, and weekly progress. Works for both vegetarian and non-veg diets, and supports any shift schedule (day, night, rotating).

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](manifest.json)

---

## Features

| Feature | Details |
|---|---|
| 🥗 Meal & Protein Tracker | Veg & Non-Veg food lists with auto protein/calorie calculation |
| ✅ Daily Checklist | Protein goal, calorie target, workout, water, no-junk |
| 💧 Water Tracker | 8-glass visual tracker |
| 😄 Mood Logging | 5-level mood picker saved daily |
| ⏱️ Fasting Timer | Configurable target with live ring progress + background alarm |
| 📊 Insights | Yesterday's summary + 7-day table + weekly averages |
| 📈 Trend Chart | Weight trend over last 8 weekly entries |
| 📸 Progress Photos | Upload & gallery with lightbox |
| 🗓️ Diet Plan Builder | Build weekly meal plans or import from CSV |
| ➕ Custom Foods | Add your own foods with custom protein/calorie values |
| 🔔 Daily Reminder | Configurable notification at your chosen time |
| 🌙 Shift Support | Day / Night / Rotating / Custom shift modes |
| ☀️ Light & Dark Mode | Toggle from the toolbar |
| 📤 Export / Import | Full data backup as JSON |
| 🔒 100% Private | All data stored locally — nothing ever leaves your browser |

---

## Privacy

All data is stored in `chrome.storage.local` on your device only. No accounts, no servers, no analytics.

See [privacy_policy.html](privacy_policy.html) for the full policy.

---

## Installation

### From Chrome Web Store *(coming soon)*
Search "FitTrack Daily" on the [Chrome Web Store](https://chrome.google.com/webstore).

### Load Unpacked (Developer Mode)
1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select this folder
5. The FitTrack Daily icon will appear in your toolbar

---

## File Structure

```
fittrack-daily/
├── manifest.json          # Extension manifest (MV3)
├── popup.html             # Main popup UI
├── popup.js               # All UI logic, storage, calculations
├── style.css              # Popup styles (dark + light theme)
├── background.js          # Service worker: alarms & notifications
├── privacy_policy.html    # Privacy policy (Chrome Store requirement)
├── lib/
│   └── simple-chart.js    # Tiny dependency-free canvas chart
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── example_diet_template.csv
├── LICENSE
└── CONTRIBUTING.md
```

---

## Storage Schema (`chrome.storage.local`)

```js
{
  settings: {
    reminderTime: 'HH:MM',
    remindersEnabled: boolean,
    theme: 'dark' | 'light',
    dietType: 'veg' | 'nonveg',
    proteinGoal: number,
    calorieGoal: number,
    stepsGoal: number,
    sleepGoal: number,
    height: number,
    shiftType: 'Day' | 'Night' | 'Rotating' | 'Custom',
    shiftName: string,
    shiftWake: 'HH:MM',
    shiftSleep: 'HH:MM',
    fastStart: timestamp | null
  },
  days: {
    'YYYY-MM-DD': {
      checks: { hitProtein, stayedCalories, workoutDone, drankWater, noJunk },
      meals: { [foodId]: servings },
      extras: [{ name, protein, calories }],
      notes: string,
      totalProtein: number,
      totalCalories: number,
      steps: number,
      sleep: number,
      mood: 'bad' | 'meh' | 'ok' | 'good' | 'pumped' | null,
      water: number,
      lastFastDuration: ms
    }
  },
  weekly: [{ date, weight, waist, photo }],
  dietPlan: { 'DayName': [{ meal, foods, protein, calories }] },
  customFoods: [{ id, label, proteinPerServing, caloriesPerServing }]
}
```

---

## Diet Plan CSV Format

Upload a CSV with these columns:

```
Day,Meal,Food Items,Protein (g),Calories (kcal)
Monday,Breakfast,Paneer + Curd + Fruits,23,310
Monday,Lunch,Dal + Boiled Veg + Curd,25,280
```

Download a template from inside the extension (Diet Plan → Import → Download CSV Template).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

---

## Troubleshooting

- **Reminders not firing?** Check that Chrome has Notification permission and the extension is enabled at `chrome://extensions`
- **Photos not saving?** Use smaller images. Chrome storage has a ~10 MB limit — the extension will warn you when nearing it
- **Import fails?** Ensure you're importing a `.json` file exported from FitTrack Daily (not an arbitrary JSON)

---

## License

[MIT](LICENSE) © 2026 FitTrack Daily Contributors
