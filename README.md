# Countdown

**Live site:** [https://talrme.github.io/countdown/](https://talrme.github.io/countdown/)

A kid-friendly countdown board for birthdays, trips, camp starts, and other big days. The promoted design is the Wave Watch direction: bright, phone-first, simple to edit, and playful enough for kids.

## What It Does

- Shows a main countdown card for the next big event
- Lets you switch units between years, months, weeks, days, hours, minutes, seconds, and mixed
- Automatically resizes large values so seconds and minutes still fit on phones
- Supports multiple boards through a URL parameter, such as `?board=bari`
- Lets anyone with the page add, edit, delete, and reorder countdowns locally
- Includes settings for board selection, new boards, deleting boards, and color mood
- Includes a Share / Save modal with copy-link and home-screen instructions
- Saves edits in this browser immediately, even before a backend is connected

## Backend Sheet

Google Sheet:
https://docs.google.com/spreadsheets/d/1YxKfctOYI8LLK102KVybU5wy46yqMEGu6vixg3Ay_oU/edit?usp=sharing

Tabs:

- `Boards`: countdown boards such as `bari`, `tal`, and `miri`
- `Events`: countdown items
- `Settings`: global backend settings

The site works immediately with bundled seed data and local browser edits. Once Apps Script is deployed, paste the web app URL into `shared/config.js` as `backendUrl`.

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

The Sheet itself can stay private after setup. The web app runs as the owner and writes to the Sheet.
