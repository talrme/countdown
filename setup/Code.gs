const SPREADSHEET_ID = '1YxKfctOYI8LLK102KVybU5wy46yqMEGu6vixg3Ay_oU';

const SHEETS = {
  BOARDS: 'Boards',
  EVENTS: 'Events',
  SETTINGS: 'Settings'
};

const HEADERS = {
  Boards: ['board_slug', 'board_name', 'sort_order', 'created_at', 'updated_at', 'deleted'],
  Events: ['event_id', 'board_slug', 'title', 'target_date', 'target_time', 'timezone', 'default_unit', 'icon', 'theme', 'sort_order', 'created_at', 'updated_at', 'deleted'],
  Settings: ['key', 'value', 'notes']
};

const DEFAULT_BOARDS = [
  ['bari', "Bari's Countdowns", 1, '', '', false],
  ['tal', "Tal's Countdowns", 2, '', '', false],
  ['miri', "Miri's Countdowns", 3, '', '', false]
];

const DEFAULT_EVENTS = [
  ['evt_bari_birthday', 'bari', "Bari's birthday", '2027-02-14', '', 'America/Los_Angeles', 'days', '🎂', 'birthday', 1, '', '', false],
  ['evt_dad_birthday', 'bari', "Dad's birthday", '2027-05-02', '', 'America/Los_Angeles', 'months', '🎈', 'birthday', 2, '', '', false],
  ['evt_camp', 'bari', 'Camp starts', '2027-06-21', '09:00', 'America/Los_Angeles', 'days', '🏕️', 'camp', 3, '', '', false]
];

function doGet(e) {
  const params = e.parameter || {};
  const action = params.action || 'snapshot';
  const callback = params.callback;
  let payload = {};
  if (params.payload) {
    try {
      payload = JSON.parse(params.payload);
    } catch (err) {
      return output({ ok: false, error: 'Invalid payload' }, callback);
    }
  }

  try {
    let result;
    if (action === 'snapshot') result = snapshot();
    else if (action === 'upsertBoard') result = upsertBoard(payload.board || {});
    else if (action === 'upsertEvent') result = upsertEvent(payload.event || {});
    else result = { ok: false, error: 'Unknown action: ' + action };
    return output(result, callback);
  } catch (err) {
    return output({ ok: false, error: err.message }, callback);
  }
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return output({ ok: false, error: 'Invalid JSON' });
  }
  const action = body.action || 'snapshot';
  if (action === 'upsertBoard') return output(upsertBoard(body.board || {}));
  if (action === 'upsertEvent') return output(upsertEvent(body.event || {}));
  return output(snapshot());
}

function output(data, callback) {
  const text = callback ? callback + '(' + JSON.stringify(data) + ')' : JSON.stringify(data);
  return ContentService
    .createTextOutput(text)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function snapshot() {
  setupSheets_();
  return {
    ok: true,
    boards: readObjects(SHEETS.BOARDS),
    events: readObjects(SHEETS.EVENTS),
    settings: readObjects(SHEETS.SETTINGS),
    spreadsheetUrl: spreadsheet_().getUrl()
  };
}

function upsertBoard(board) {
  setupSheets_();
  const sheet = sheetByName(SHEETS.BOARDS);
  const headers = headersFor(sheet);
  const slug = clean(board.board_slug || board.slug || board.board_name);
  if (!slug) throw new Error('Missing board_slug');
  board.board_slug = slug;
  board.board_name = board.board_name || board.name || slug;
  board.sort_order = board.sort_order || nextSort(sheet);
  board.updated_at = new Date().toISOString();
  if (!board.created_at) board.created_at = board.updated_at;
  upsertById(sheet, headers, 'board_slug', slug, board);
  return { ok: true, board: board };
}

function upsertEvent(event) {
  setupSheets_();
  const sheet = sheetByName(SHEETS.EVENTS);
  const headers = headersFor(sheet);
  if (!event.event_id) event.event_id = 'evt_' + Date.now();
  if (!event.board_slug) throw new Error('Missing board_slug');
  event.updated_at = new Date().toISOString();
  if (!event.created_at) event.created_at = event.updated_at;
  upsertById(sheet, headers, 'event_id', event.event_id, event);
  return { ok: true, event: event };
}

function readObjects(name) {
  const sheet = sheetByName(name);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(function(row) {
    return row.some(function(cell) { return cell !== ''; });
  }).map(function(row) {
    const obj = {};
    headers.forEach(function(header, index) {
      obj[header] = row[index] instanceof Date ? Utilities.formatDate(row[index], Session.getScriptTimeZone(), 'yyyy-MM-dd') : row[index];
    });
    return obj;
  });
}

function upsertById(sheet, headers, key, value, obj) {
  const data = sheet.getDataRange().getValues();
  const keyIndex = headers.indexOf(key);
  if (keyIndex < 0) throw new Error('Missing header: ' + key);
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyIndex]) === String(value)) {
      rowIndex = i + 1;
      break;
    }
  }
  const row = headers.map(function(header) {
    if (obj[header] === undefined || obj[header] === null) return '';
    return obj[header];
  });
  if (rowIndex < 0) sheet.appendRow(row);
  else sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
}

function headersFor(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
}

function sheetByName(name) {
  const sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Missing sheet: ' + name);
  return sheet;
}

function spreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function setupSheets_() {
  ensureSheet_(SHEETS.BOARDS, HEADERS.Boards, DEFAULT_BOARDS);
  ensureSheet_(SHEETS.EVENTS, HEADERS.Events, DEFAULT_EVENTS);
  ensureSheet_(SHEETS.SETTINGS, HEADERS.Settings, [
    ['schema_version', '1', 'Countdown backend schema version']
  ]);
}

function ensureSheet_(name, headers, defaults) {
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0].map(String);
  const missing = headers.filter(function(header) {
    return currentHeaders.indexOf(header) < 0;
  });
  if (missing.length) {
    throw new Error('Sheet ' + name + ' is missing headers: ' + missing.join(', '));
  }
  if (sheet.getLastRow() === 1 && defaults && defaults.length) {
    const now = new Date().toISOString();
    const rows = defaults.map(function(row) {
      return row.map(function(value, index) {
        const header = headers[index];
        if ((header === 'created_at' || header === 'updated_at') && !value) return now;
        return value;
      });
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function nextSort(sheet) {
  return Math.max(1, sheet.getLastRow());
}

function clean(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
