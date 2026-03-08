# Contributing to FitTrack Daily

Thank you for your interest in contributing! This is a Chrome Extension (Manifest V3) built with vanilla HTML, CSS, and JavaScript — no build step required.

## Prerequisites
- Google Chrome (or Chromium) v88+
- A text editor (VS Code recommended)

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/fittrack-daily.git
   cd fittrack-daily
   ```

2. **Load the extension unpacked**
   - Open `chrome://extensions` in Chrome
   - Enable **Developer mode** (toggle, top-right)
   - Click **Load unpacked** and select the `fittrack-daily/` folder
   - The extension icon will appear in your toolbar

3. **Make changes**
   - Edit `popup.html`, `popup.js`, `style.css`, or `background.js`
   - Click the 🔄 refresh icon on the extension card at `chrome://extensions` to reload

4. **Inspect the popup**
   - Right-click the extension icon → **Inspect popup** to open DevTools for the popup

## File Structure

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (MV3) |
| `popup.html` | Main popup UI |
| `popup.js` | All UI logic, storage, calculations |
| `style.css` | Popup styles |
| `background.js` | Service worker: alarms & notifications |
| `lib/simple-chart.js` | Lightweight canvas chart helper |
| `privacy_policy.html` | Privacy policy page (Chrome Store requirement) |

## Guidelines

- **No external CDN calls** — all code must be self-contained (Chrome Store policy + privacy)
- **No build step** — keep vanilla JS; avoid introducing bundlers unless strictly necessary
- **Storage schema**: See comment at top of `popup.js` for the `chrome.storage.local` schema
- **One food list per diet mode**: `FOODS_VEG` and `FOODS_NONVEG` in `popup.js`; custom foods go into `chrome.storage.local` under `customFoods`
- **Test your changes** by loading unpacked and manually verifying the affected feature

## Submitting a Pull Request

1. Fork the repository and create a branch: `git checkout -b feat/my-feature`
2. Make your changes and test locally
3. Commit with a clear message: `git commit -m "feat: add custom food items"`
4. Push and open a Pull Request against `main`

## Reporting Bugs

Open a GitHub Issue with:
- Chrome version
- Extension version (from `manifest.json`)
- Steps to reproduce
- Expected vs actual behaviour
