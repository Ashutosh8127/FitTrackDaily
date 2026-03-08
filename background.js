/*
  background.js — FitTrack Daily (service worker)
  - Listens for chrome.alarms and shows notifications when they trigger:
      • daily_reminder  : daily log reminder at the user's chosen time
      • fast_complete   : fasting timer reached its target (fired from popup.js)
  - Uses chrome.storage to persist the scheduled reminder time
*/

'use strict';

async function createDailyAlarm(timeStr) {
  const [hh, mm] = (timeStr || '09:00').split(':').map(Number);
  const now = new Date();
  const when = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  if (when.getTime() <= now.getTime()) when.setDate(when.getDate() + 1);
  chrome.alarms.create('daily_reminder', { when: when.getTime(), periodInMinutes: 24 * 60 });
  chrome.storage.local.set({ scheduledReminder: timeStr });
}

function clearDailyAlarm() {
  chrome.alarms.clear('daily_reminder');
  chrome.storage.local.remove('scheduledReminder');
}

function showReminderNotification() {
  const options = {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'FitTrack Daily — Log today',
    message: 'Tap to log meals, protein, water, steps and mood.',
    priority: 2
  };
  chrome.notifications.create('daily_reminder_notif', options, () => { });
}

function showFastCompleteNotification() {
  const options = {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'FitTrack Daily — Fast Complete! 🎉',
    message: 'You reached your fasting goal. Open the extension to stop the timer and log your fast.',
    priority: 2
  };
  chrome.notifications.create('fast_complete_notif', options, () => { });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'daily_reminder') {
    showReminderNotification();
  } else if (alarm.name === 'fast_complete') {
    showFastCompleteNotification();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'createAlarm') {
    createDailyAlarm(msg.time || '09:00');
    sendResponse({ success: true });
  } else if (msg && msg.action === 'clearAlarm') {
    clearDailyAlarm();
    sendResponse({ success: true });
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['settings'], (res) => {
    const settings = res.settings || { reminderTime: '09:00', remindersEnabled: false };
    if (settings.remindersEnabled) {
      createDailyAlarm(settings.reminderTime);
    }
  });
});
