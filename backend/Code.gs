/**
 * Simple POS: Google Sheets backend (Google Apps Script).
 *
 * What it does
 *   - Receives sales and expenses from the POS app and saves them in this spreadsheet.
 *     Records are saved by id, so sending the same record twice never creates duplicates.
 *   - Lets the app read the receipts sheet your Telegram bot already fills.
 *
 * Setup (about 5 minutes, see docs/WORKFLOW.md for the pictures-free walkthrough)
 *   1. Open your Google Sheet > Extensions > Apps Script. Paste this whole file.
 *   2. Project Settings > Script properties > add  SECRET  = a long random phrase.
 *      (Optional) add RECEIPTS_SHEET = the tab name the Telegram bot writes to (default "Receipts").
 *   3. Run the function  setup  once and approve the permissions.
 *   4. Deploy > New deployment > type "Web app" > Execute as: Me > Who has access: Anyone.
 *      Copy the Web app link. Paste the link and the same SECRET into the app's Settings.
 *
 * Safety notes
 *   - "Anyone" only means anyone who has the link AND the SECRET can use it. Keep both private.
 *   - After changing this file, use Deploy > Manage deployments > Edit > New version.
 */

var SALES = 'Sales';
var ITEMS = 'SaleItems';
var EXPENSES = 'Expenses';

var SALES_HEAD = ['id', 'receipt', 'date', 'status', 'payment', 'subtotal', 'discount', 'tax', 'total', 'currency', 'tax mode', 'note', 'created at', 'updated at'];
var ITEMS_HEAD = ['sale id', 'receipt', 'date', 'item', 'qty', 'unit price', 'discount', 'net', 'tax', 'total'];
var EXPENSES_HEAD = ['id', 'date', 'category', 'vendor', 'amount', 'tax included', 'paid by', 'note', 'source', 'status', 'updated at'];

// Column names the Telegram receipts sheet may use (lower case). The first match wins.
var RECEIPT_COLUMNS = {
  id: ['id', 'receipt id', 'key'],
  date: ['date', 'receipt date', 'transaction date', 'timestamp'],
  vendor: ['vendor', 'merchant', 'store', 'shop', 'supplier', 'name'],
  amount: ['amount', 'total', 'grand total', 'price', 'cost'],
  category: ['category', 'type', 'expense category'],
  note: ['note', 'notes', 'description', 'items', 'details']
};

/** Run once from the editor. Creates the tabs and header rows. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SALES, SALES_HEAD);
  ensureSheet_(ss, ITEMS, ITEMS_HEAD);
  ensureSheet_(ss, EXPENSES, EXPENSES_HEAD);
  if (!prop_('SECRET')) {
    throw new Error('Add a script property named SECRET first (Project Settings > Script properties).');
  }
  return 'Ready. Now deploy as a web app.';
}

function doGet() {
  return json_({ ok: true, app: 'simple-pos', hint: 'Use the POS app to talk to this link.' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json_({ ok: false, error: 'The sheet is busy. Try again in a moment.' });
  }
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var secret = prop_('SECRET');
    if (!secret) return json_({ ok: false, error: 'The script has no SECRET property yet.' });
    if (!safeEqual_(String(body.token || ''), secret)) return json_({ ok: false, error: 'Wrong secret. Check it in the app Settings.' });

    if (body.action === 'push') return json_(push_(body));
    if (body.action === 'pullExpenses') return json_(pullExpenses_());
    return json_({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    return json_({ ok: false, error: 'Script error: ' + err.message });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- push

function push_(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var unit = Math.pow(10, Number(body.decimals) >= 0 ? Number(body.decimals) : 2);
  var money = function (n) { return Number(n || 0) / unit; };
  var saved = { sales: [], expenses: [] };

  var sales = body.sales || [];
  if (sales.length) {
    var salesSheet = ensureSheet_(ss, SALES, SALES_HEAD);
    var itemsSheet = ensureSheet_(ss, ITEMS, ITEMS_HEAD);
    var saleRows = sales.map(function (s) {
      var t = s.totals || {};
      return [s.id, s.receiptNo, s.date, s.status, (s.payment && s.payment.method) || '', money(t.subtotal), money(t.discount), money(t.tax), money(t.total), s.currency || body.currency || '', s.taxMode || body.taxMode || '', s.note || '', s.createdAt, s.updatedAt];
    });
    upsert_(salesSheet, saleRows, SALES_HEAD.length);

    // Item lines: remove any old lines of these sales, then add the current ones.
    deleteRowsWhere_(itemsSheet, 1, sales.map(function (s) { return s.id; }));
    var itemRows = [];
    sales.forEach(function (s) {
      (s.lines || []).forEach(function (l) {
        itemRows.push([s.id, s.receiptNo, s.date, l.name, l.qty, money(l.unitPrice), money((l.lineDiscount || 0) + (l.orderShare || 0)), money(l.net), money(l.tax), money(l.total)]);
      });
    });
    appendRows_(itemsSheet, itemRows, ITEMS_HEAD.length);
    saved.sales = sales.map(function (s) { return s.id; });
  }

  var expenses = body.expenses || [];
  if (expenses.length) {
    var expSheet = ensureSheet_(ss, EXPENSES, EXPENSES_HEAD);
    var expRows = expenses.map(function (x) {
      return [x.id, x.date, x.category, x.vendor || '', money(x.amount), money(x.taxAmount), x.paymentMethod || '', x.note || '', x.source || 'manual', x.status, x.updatedAt];
    });
    upsert_(expSheet, expRows, EXPENSES_HEAD.length);
    saved.expenses = expenses.map(function (x) { return x.id; });
  }
  return { ok: true, saved: saved };
}

// ---------------------------------------------------------------- pull (Telegram receipts)

function pullExpenses_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(prop_('RECEIPTS_SHEET') || 'Receipts');
  if (!sheet) return { ok: false, error: 'No receipts tab found. Set RECEIPTS_SHEET in Script properties to your tab name.' };
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: true, rows: [] };

  var heads = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var col = {};
  Object.keys(RECEIPT_COLUMNS).forEach(function (k) {
    for (var i = 0; i < RECEIPT_COLUMNS[k].length; i++) {
      var at = heads.indexOf(RECEIPT_COLUMNS[k][i]);
      if (at >= 0) { col[k] = at; return; }
    }
  });
  if (col.date === undefined || col.amount === undefined) {
    return { ok: false, error: 'The receipts tab needs a date column and an amount (or total) column. Found: ' + heads.join(', ') };
  }

  var tz = ss.getSpreadsheetTimeZone();
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var rawDate = row[col.date];
    if (rawDate === '' && row[col.amount] === '') continue; // blank line
    var date = rawDate instanceof Date ? Utilities.formatDate(rawDate, tz, 'yyyy-MM-dd') : String(rawDate);
    var amount = row[col.amount];
    rows.push({
      key: col.id !== undefined && row[col.id] !== '' ? String(row[col.id]) : 'row' + (r + 1),
      date: date,
      amount: typeof amount === 'number' ? String(amount) : String(amount),
      vendor: col.vendor !== undefined ? String(row[col.vendor]) : '',
      category: col.category !== undefined ? String(row[col.category]) : '',
      note: col.note !== undefined ? String(row[col.note]) : ''
    });
  }
  return { ok: true, rows: rows };
}

// ---------------------------------------------------------------- helpers

function prop_(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function ensureSheet_(ss, name, head) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Text that starts with = + - @ would be run as a formula by Sheets. Store it as plain text instead.
function safe_(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v) && isNaN(Number(v))) return "'" + v;
  return v;
}

function cleanRows_(rows) {
  return rows.map(function (r) { return r.map(safe_); });
}

function appendRows_(sheet, rows, width) {
  if (!rows.length) return;
  var start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, width).setValues(cleanRows_(rows));
}

/** Update rows whose first column matches an id, append the rest. */
function upsert_(sheet, rows, width) {
  var last = sheet.getLastRow();
  var existing = {};
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (v, i) { existing[String(v[0])] = i + 2; });
  }
  var fresh = [];
  cleanRows_(rows).forEach(function (row) {
    var at = existing[String(row[0])];
    if (at) sheet.getRange(at, 1, 1, width).setValues([row]);
    else fresh.push(row);
  });
  appendRows_(sheet, fresh, width);
}

/** Delete every row whose value in column `colIndex` (1-based) is in `ids`. Works from the bottom up. */
function deleteRowsWhere_(sheet, colIndex, ids) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var wanted = {};
  ids.forEach(function (id) { wanted[String(id)] = true; });
  var vals = sheet.getRange(2, colIndex, last - 1, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (wanted[String(vals[i][0])]) sheet.deleteRow(i + 2);
  }
}
