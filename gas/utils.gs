/**
 * 共用工具：設定讀取、含重試的 HTTP 請求、JSON 回應、Sheets 讀寫、日期轉換。
 */

var TZ = 'Asia/Taipei';

function getProp_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === '' ? fallback : v;
}

/**
 * 網路錯誤重試 2 次（間隔 2 秒、8 秒），見 spec 第 9 節。
 * options.charset 指定回應編碼（MOPS 為 Big5）。
 * 回傳 { code, ms, text, error, attempts }，不丟例外。
 */
function fetchWithRetry_(url, options) {
  var opts = Object.assign({ muteHttpExceptions: true, followRedirects: true }, options || {});
  var charset = opts.charset || 'UTF-8';
  delete opts.charset;
  var waits = [2000, 8000];
  var last = { code: 0, ms: 0, text: '', error: '', attempts: 0 };
  for (var i = 0; i <= waits.length; i++) {
    var t0 = Date.now();
    try {
      var res = UrlFetchApp.fetch(url, opts);
      last = { code: res.getResponseCode(), ms: Date.now() - t0, text: res.getContentText(charset), error: '', attempts: i + 1 };
      // 4xx 不重試；5xx 重試
      if (last.code < 500) return last;
    } catch (e) {
      last = { code: 0, ms: Date.now() - t0, text: '', error: String(e), attempts: i + 1 };
    }
    if (i < waits.length) Utilities.sleep(waits[i]);
  }
  return last;
}

/**
 * 取得 JSON；非 200 或解析失敗丟例外（由 run_log 記錄）。
 * 回應偶爾會被截斷（Phase 1 實測櫃買主檔發生過），解析失敗也重抓，最多 3 次。
 */
function fetchJson_(url) {
  var lastErr;
  for (var i = 0; i < 3; i++) {
    var res = fetchWithRetry_(url);
    if (res.code !== 200) throw new Error('HTTP ' + (res.code || res.error) + ' ' + url);
    try {
      return JSON.parse(res.text);
    } catch (e) {
      lastErr = e;
      Utilities.sleep(3000);
    }
  }
  throw new Error('JSON 解析失敗（重試 3 次）：' + lastErr + ' ' + url);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- 日期 ----------

function nowIso_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function todayStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

/** 民國日期字串 1151011 → 2026-10-11 */
function rocDateToIso_(s) {
  s = String(s || '').trim();
  if (!/^\d{6,7}$/.test(s)) return '';
  var y = Number(s.slice(0, s.length - 4)) + 1911;
  return y + '-' + s.slice(-4, -2) + '-' + s.slice(-2);
}

/** 發言時間 70003 → 07:00:03 */
function rocTimeToIso_(s) {
  s = ('000000' + String(s || '').trim()).slice(-6);
  return s.slice(0, 2) + ':' + s.slice(2, 4) + ':' + s.slice(4, 6);
}

function md5_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** 物件的 key 去除前後空白（上市重訊的「主旨 」欄名尾端有空格） */
function trimKeys_(obj) {
  var o = {};
  Object.keys(obj).forEach(function (k) { o[k.trim()] = obj[k]; });
  return o;
}

// ---------- Sheets ----------

var ss_ = null;
function ss() {
  if (!ss_) ss_ = SpreadsheetApp.openById(getProp_('SHEET_ID', ''));
  return ss_;
}

function sheet_(name) {
  var sh = ss().getSheetByName(name);
  if (!sh) throw new Error('找不到分頁 ' + name + '，請先執行 setupSheets');
  return sh;
}

/** 讀整張表為物件陣列。 */
function readTable_(name) {
  var sh = sheet_(name);
  var v = sh.getDataRange().getValues();
  var header = v[0];
  return v.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {};
    header.forEach(function (k, i) { o[k] = r[i]; });
    return o;
  });
}

function header_(name) {
  var sh = sheet_(name);
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

/** 讀單一欄位的所有值（不含標題）。 */
function readColumn_(name, col) {
  var sh = sheet_(name);
  var idx = header_(name).indexOf(col);
  if (idx < 0 || sh.getLastRow() < 2) return [];
  return sh.getRange(2, idx + 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); });
}

function appendObjects_(name, objs) {
  if (!objs.length) return 0;
  var sh = sheet_(name);
  var header = header_(name);
  var rows = objs.map(function (o) { return header.map(function (k) { return o[k] === undefined || o[k] === null ? '' : o[k]; }); });
  var start = sh.getLastRow() + 1;
  textFormat_(sh, header, start, rows.length);
  sh.getRange(start, 1, rows.length, header.length).setValues(rows);
  return rows.length;
}

/** 代號、日期等欄位先設為純文字再寫入（新列可能超出 setupSheets 設定的範圍）。 */
function textFormat_(sh, header, startRow, n) {
  if (n <= 0) return;
  if (sh.getMaxRows() < startRow + n - 1) sh.insertRowsAfter(sh.getMaxRows(), startRow + n - 1 - sh.getMaxRows());
  header.forEach(function (c, i) {
    if (TEXT_COL_RE.test(c)) sh.getRange(startRow, i + 1, n, 1).setNumberFormat('@');
  });
}

/** raw_* 只追加：以 raw_id 去重，回傳實際新增筆數（spec 第 9 節冪等）。 */
function appendNewRaw_(name, objs) {
  var seen = {};
  readColumn_(name, 'raw_id').forEach(function (id) { seen[id] = true; });
  var fresh = objs.filter(function (o) {
    if (seen[o.raw_id]) return false;
    seen[o.raw_id] = true;
    return true;
  });
  return appendObjects_(name, fresh);
}

/** 以 key 欄位 upsert（整表讀入記憶體、一次寫回）；回傳 { inserted, updated }。 */
function upsertObjects_(name, key, objs) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  var header = values[0];
  var ki = header.indexOf(key);
  var pos = {};
  for (var i = 1; i < values.length; i++) pos[String(values[i][ki])] = i;
  var inserted = 0, updated = 0;
  objs.forEach(function (o) {
    var row = header.map(function (k) { return o[k] === undefined || o[k] === null ? '' : o[k]; });
    var at = pos[String(o[key])];
    if (at) { values[at] = row; updated++; }
    else { pos[String(o[key])] = values.length; values.push(row); inserted++; }
  });
  textFormat_(sh, header, 2, values.length - 1);
  sh.getRange(1, 1, values.length, header.length).setValues(values);
  return { inserted: inserted, updated: updated };
}
