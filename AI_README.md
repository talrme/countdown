# AI Notes - Countdown

## Project Shape

- \`index.html\`: promoted Wave Watch countdown app.
- \`styles.css\`: Wave Watch theme CSS.
- \`shared/app.js\`: shared countdown logic, modals, local state, JSONP backend calls.
- \`shared/config.js\`: spreadsheet ID/URL and eventual Apps Script URL.
- \`shared/data.js\`: fallback seed data matching the Google Sheet.
- \`setup/Code.gs\`: Apps Script backend.
- Device-local settings include theme, drag ordering, and animation level.

## Product Intent

This is primarily kid-facing. Keep the UI playful, tactile, animated, and very readable on phones. Parent/admin controls should exist but remain secondary.

Expanded secondary countdowns should reuse the same big-card pattern as the primary countdown. The default unit can be \`auto\`, which lets the app choose years/months/weeks/days/hours/minutes/seconds based on distance from the event.

Clicking unit buttons is intentionally device-local. It updates \`activeUnits\` in \`localStorage\` and should not mutate \`default_unit\` or sync an event write to the Sheet. Editing the countdown form is still the way to set a shared default unit.

Drag ordering is an optional device-local setting. It is off by default; when enabled, tile grab handles appear and reorder through the same Sheet-backed sort_order field as the Up/Down buttons.

Animation level is also device-local. It runs 1-5 with default 3: 1 is minimal/no animations, 5 is intentionally extra playful.

## Data Contract

Boards:
\`board_slug, board_name, sort_order, created_at, updated_at, deleted\`

Events:
\`event_id, board_slug, title, target_date, target_time, timezone, default_unit, icon, theme, sort_order, created_at, updated_at, deleted\`

Settings:
\`key, value, notes\`

## Backend

The frontend uses JSONP-style Apps Script requests so it works from GitHub Pages without CORS pain. Supported actions:

- \`snapshot\`
- \`upsertBoard\`
- \`upsertEvent\`

The app is usable without backend sync; edits save in \`localStorage\`.
