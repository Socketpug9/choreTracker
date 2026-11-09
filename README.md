# choreTracker

A one-person chore tracker that runs on your iPhone like a normal app, with no App Store.
It's a web app you add to your Home Screen. It works offline, and your chores stay on your phone.

## What it does

- **Today:** what's due today, with late chores at the top. Tap the circle to check a chore off, and tap again to undo.
- **Repeats:** every day, some days of the week, every few days (counted from when you last did it), or once.
- **Streaks:** daily and weekly chores show how many times in a row you've done them.
- **Coming up:** the next week of chores.
- **All chores:** tap any chore to edit or delete it.
- **Backup:** save your chores to a file and restore them later.

## Put it on your iPhone

1. Open the app's web address in **Safari**.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open it from the new Chores icon on your Home Screen.

## Hosting (GitHub Pages)

The app is plain HTML, CSS, and JavaScript with no build step. Serve the repo root from any static host.
For GitHub Pages: **Settings → Pages → Build and deployment → Deploy from a branch**, then pick the branch and the `/ (root)` folder.

When you change files, bump `VERSION` in `sw.js` so installed copies pick up the update.

## Files

- `index.html`: the page
- `styles.css`: the look (light and dark mode)
- `app.js`: chores, schedules, streaks, and saving
- `sw.js`: offline support
- `manifest.webmanifest` and `icons/`: the Home Screen icon and name
