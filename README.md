# Stash

A personal money tracker that runs on your iPhone like a normal app, with no App Store.
It's a web app you add to your Home Screen. It works offline, and your data stays on your phone.

## What it does

- **Balance:** your total at the top, with how much it changed this week.
- **Add / Spend:** one split button that opens a keypad. Quick amounts ($5 to $100), an optional note, and a date if you're catching up on past entries. Every change can be undone from the message that pops up.
- **Graph:** your balance over the last 2 or 4 weeks, and a forecast for the same length of time ahead. Drag across it to see any day.
- **Forecast:** a straight-line trend through your money in and out over the last 4 weeks. Balance corrections don't count toward it.
- **Goals:** a target amount, with an optional date. Put a goal on the graph to see its line and the day the forecast reaches it. Goals with a date say whether you're on track, and how much more a week you'd need if not.
- **Activity:** every entry by day. Tap one to edit or delete it.
- **Settings:** correct your balance, save or restore a backup, and turn the liquid background off.

## Look

Butter yellow and black, set in Schibsted Grotesk, with the balance in big flat type.
The background is a live liquid simulation that is always slowly flowing, and you can push it around with your finger.
Sheets (add, spend, goals) are made of liquid: black ink rises from the bottom and forms the sheet when it opens, and a closing sheet drains away and soaks into the gold background. With the liquid turned off, sheets simply slide up.

## Put it on your iPhone

1. Open the app's web address in **Safari**.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open it from the new Stash icon.

## Hosting (GitHub Pages)

Plain HTML, CSS, and JavaScript, with no build step needed to run it. Serve the repo root from any static host.
For GitHub Pages: **Settings → Pages → Deploy from a branch**, then pick the branch and the `/ (root)` folder.

When you change files, bump `VERSION` in `sw.js` so installed copies pick up the update.

## Files

- `index.html`, `styles.css`: the page and its look
- `js/app.js`: money entries, balance, graph, forecast, goals, backup
- `js/fluid.js`: the liquid background, and the ink that forms and melts the sheets
- `vendor/three.js`: the parts of three.js the liquid background uses, bundled into one file (MIT license)
- `fonts/`: Schibsted Grotesk (SIL Open Font License)
- `sw.js`: offline support
- `manifest.webmanifest`, `icons/`: Home Screen name and icon
