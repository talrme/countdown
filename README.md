# Countdown

**Live site:** [https://talrme.github.io/countdown/](https://talrme.github.io/countdown/)

A kid-friendly countdown board for birthdays, trips, camp starts, and other big days. The promoted design is the Wave Watch direction: bright, phone-first, simple to edit, and playful enough for kids.

## What It Does

- Shows a main countdown card for the next big event
- Chooses a sensible default unit automatically based on how far away the event is
- Lets you switch units between years, months, weeks, days, hours, minutes, seconds, and mixed
- Shows expanded countdowns in the same big-card style as the main countdown
- Automatically resizes large values so seconds and minutes still fit on phones
- Supports multiple boards through a URL parameter, such as `?board=bari`
- Lets anyone with the page add, edit, delete, and reorder countdowns
- Includes settings for board selection, new boards, deleting boards, and color mood
- Includes a Share / Save modal with copy-link and home-screen instructions that preserve the current board link
- Saves edits in this browser immediately, even before a backend is connected
- Shows backend sync status in Settings -> Advanced

## Backend Sheet

Google Sheet:
https://docs.google.com/spreadsheets/d/1YxKfctOYI8LLK102KVybU5wy46yqMEGu6vixg3Ay_oU/edit?usp=sharing

Tabs:

- `Boards`: countdown boards such as `bari`, `tal`, and `miri`
- `Events`: countdown items
- `Settings`: global backend settings

The site works immediately with bundled seed data and local browser edits. The current Apps Script URL is saved in `shared/config.js` as `backendUrl`.

For cross-device syncing to work, the Apps Script deployment must be a Web App with:

- Execute as: **Me**
- Who has access: **Anyone**

The Sheet itself can stay private. The web app runs as the owner and writes to the Sheet.

## URL Boards

Each board can be opened with a URL parameter:

```text
https://talrme.github.io/countdown/?board=bari
https://talrme.github.io/countdown/?board=tal
```

## Apps Script Setup

1. Open the backend Sheet.
2. Go to **Extensions -> Apps Script**.
3. Paste the contents of `setup/Code.gs`.
4. Save.
5. Deploy as a Web App:
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the Web App URL.
7. Paste it into `shared/config.js` as `backendUrl`.

`setup/Code.gs` opens the backend Sheet by ID and creates the expected `Boards`, `Events`, and `Settings` tabs if they do not exist yet. This is intentionally similar to the workout site backend pattern.

If the site stops syncing, test the Apps Script `/exec` URL directly. It should return JSON or JSONP, not a Google “You need access” page.
