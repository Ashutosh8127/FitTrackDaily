/* 
   mock-chrome.js 
   Mocks Chrome extension APIs to allow popup.html to run in a standard browser tab.
*/
window.chrome = {
    runtime: {
        onMessage: { addListener: () => { } },
        sendMessage: (msg, cb) => { if (cb) cb({ success: true }); }
    },
    storage: {
        local: {
            get: (keys, cb) => {
                const mockData = {
                    settings: {
                        reminderTime: '09:00',
                        remindersEnabled: true,
                        theme: 'dark',
                        dietType: 'nonveg',
                        proteinGoal: 160,
                        calorieGoal: 2200,
                        stepsGoal: 10000,
                        sleepGoal: 8,
                        height: 175,
                        shiftType: 'Day',
                        shiftWake: '07:00',
                        shiftSleep: '23:00'
                    },
                    days: {
                        '2026-03-08': {
                            checks: { hitProtein: true, stayedCalories: true, workoutDone: true, drankWater: 5, noJunk: true },
                            meals: {},
                            extras: [],
                            totalProtein: 142,
                            totalCalories: 1850,
                            steps: 8432,
                            sleep: 7.5,
                            mood: 'good',
                            water: 5
                        }
                    },
                    weekly: [
                        { date: '2026-02-01', weight: 85 },
                        { date: '2026-02-08', weight: 84.2 },
                        { date: '2026-02-15', weight: 83.5 },
                        { date: '2026-02-22', weight: 83.1 },
                        { date: '2026-03-01', weight: 82.4 },
                        { date: '2026-03-08', weight: 81.8 }
                    ]
                };
                if (typeof keys === 'string') cb({ [keys]: mockData[keys] });
                else if (Array.isArray(keys)) {
                    const res = {};
                    keys.forEach(k => res[k] = mockData[k]);
                    cb(res);
                } else cb(mockData);
            },
            set: (data, cb) => { if (cb) cb(); },
            remove: (keys, cb) => { if (cb) cb(); }
        }
    },
    alarms: {
        create: () => { },
        clear: () => { }
    },
    notifications: {
        create: () => { }
    }
};

// Prevent errors from chart.js or other libs trying to access extension-only features
console.log("Mock Chrome API initialized");
