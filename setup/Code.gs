const SHEETS = {
  BOARDS: 'Boards',
  EVENTS: 'Events',
  SETTINGS: 'Settings'
};

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
  return {
    ok: true,
    boards: readObjects(SHEETS.BOARDS),
    events: readObjects(SHEETS.EVENTS),
    settings: readObjects(SHEETS.SETTINGS),
    spreadsheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl()
  };
}

function upsertBoard(board) {
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
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Missing sheet: ' + name);
  return sheet;
}

function nextSort(sheet) {
  return Math.max(1, sheet.getLastRow());
}

function clean(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}