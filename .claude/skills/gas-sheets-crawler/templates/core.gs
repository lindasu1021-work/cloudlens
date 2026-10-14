/**
 * GAS＋Sheets 爬蟲核心範本（複製到你的專案）。
 * 需要的分頁：run_log（run_id, step, started_at, ended_at, rows_in, rows_out, status, error）
 * 需要的 Script Properties：SHEET_ID
 * 使用方式：
 *   1. 寫你的 fetchXxx_(runId, ...args) → { rows_in, rows_out, status?, note? }
 *   2. 在 runTask_ 的 switch 註冊 task key（'xxx:arg1:arg2'）
 *   3. 寫 dailyJob/weeklyJob 呼叫 runJob_(name, makeRunId, makeTasks, 'continueXxxJob')
 *   4. 用 time-based trigger 安裝 dailyJob/weeklyJob
 */
var TZ = 'Asia/Taipei';
var BUDGET_MS = 4.5 * 60 * 1000;   // 單次上限 6 分鐘，留緩衝
// 代號、日期、ID 這類欄位寫入前先設純文字，避免 0050 變 50
var TEXT_COL_RE = /code|_id$|_ids$|^key$|date|_at$|year_month/;

// ---------- 屬性 / HTTP ----------
function getProp_(k, fb) { var v = PropertiesService.getScriptProperties().getProperty(k); return v === null || v === '' ? fb : v; }

/** 重試 2 次（2s、8s）；4xx 不重試；回傳 {code, ms, text, error, attempts}，不丟例外。options.charset 例：'Big5' */
function fetchWithRetry_(url, options) {
  var opts = Object.assign({ muteHttpExceptions: true, followRedirects: true }, options || {});
  var charset = opts.charset || 'UTF-8'; delete opts.charset;
  var waits = [2000, 8000], last = { code: 0, ms: 0, text: '', error: '', attempts: 0 };
  for (var i = 0; i <= waits.length; i++) {
    var t0 = Date.now();
    try {
      var res = UrlFetchApp.fetch(url, opts);
      last = { code: res.getResponseCode(), ms: Date.now() - t0, text: res.getContentText(charset), error: '', attempts: i + 1 };
      if (last.code < 500) return last;
    } catch (e) { last = { code: 0, ms: Date.now() - t0, text: '', error: String(e), attempts: i + 1 }; }
    if (i < waits.length) Utilities.sleep(waits[i]);
  }
  return last;
}

/** JSON；非 200 或解析失敗（常見：回應被截斷）都重抓，最多 3 次 */
function fetchJson_(url) {
  var lastErr;
  for (var i = 0; i < 3; i++) {
    var res = fetchWithRetry_(url);
    if (res.code !== 200) throw new Error('HTTP ' + (res.code || res.error) + ' ' + url);
    try { return JSON.parse(res.text); } catch (e) { lastErr = e; Utilities.sleep(3000); }
  }
  throw new Error('JSON 解析失敗：' + lastErr + ' ' + url);
}

// ---------- 小工具 ----------
function nowIso_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function todayStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function md5_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function trimKeys_(o) { var r = {}; Object.keys(o).forEach(function (k) { r[k.trim()] = o[k]; }); return r; }
/** 民國日期 1151011 → 2026-10-11 */
function rocDateToIso_(s) { s = String(s || '').trim(); if (!/^\d{6,7}$/.test(s)) return ''; return (Number(s.slice(0, s.length - 4)) + 1911) + '-' + s.slice(-4, -2) + '-' + s.slice(-2); }

// ---------- Sheets ----------
var ss_ = null;
function ss() { if (!ss_) ss_ = SpreadsheetApp.openById(getProp_('SHEET_ID', '')); return ss_; }
function sheet_(name) { var sh = ss().getSheetByName(name); if (!sh) throw new Error('找不到分頁 ' + name); return sh; }
function header_(name) { var sh = sheet_(name); return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; }

/** 整張讀成物件陣列（讀一次、在記憶體處理） */
function readTable_(name) {
  var v = sheet_(name).getDataRange().getValues(), h = v[0];
  return v.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o;
  });
}
function readColumn_(name, col) {
  var sh = sheet_(name), idx = header_(name).indexOf(col);
  if (idx < 0 || sh.getLastRow() < 2) return [];
  return sh.getRange(2, idx + 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); });
}
function textFormat_(sh, header, startRow, n) {
  if (n <= 0) return;
  if (sh.getMaxRows() < startRow + n - 1) sh.insertRowsAfter(sh.getMaxRows(), startRow + n - 1 - sh.getMaxRows());
  header.forEach(function (c, i) { if (TEXT_COL_RE.test(c)) sh.getRange(startRow, i + 1, n, 1).setNumberFormat('@'); });
}
/** 批次追加（絕不在迴圈內 appendRow） */
function appendObjects_(name, objs) {
  if (!objs.length) return 0;
  var sh = sheet_(name), h = header_(name);
  var rows = objs.map(function (o) { return h.map(function (k) { return o[k] === undefined || o[k] === null ? '' : o[k]; }); });
  var start = sh.getLastRow() + 1;
  textFormat_(sh, h, start, rows.length);
  sh.getRange(start, 1, rows.length, h.length).setValues(rows);
  return rows.length;
}
/** raw_* 只追加並以 raw_id 去重；回傳實際新增筆數（冪等：重跑得 0） */
function appendNewRaw_(name, objs) {
  var seen = {};
  readColumn_(name, 'raw_id').forEach(function (id) { seen[id] = true; });
  var fresh = objs.filter(function (o) { if (seen[o.raw_id]) return false; seen[o.raw_id] = true; return true; });
  return appendObjects_(name, fresh);
}
/** 以 key upsert；整表讀入、一次寫回 */
function upsertObjects_(name, key, objs) {
  var sh = sheet_(name), values = sh.getDataRange().getValues(), h = values[0], ki = h.indexOf(key), pos = {};
  for (var i = 1; i < values.length; i++) pos[String(values[i][ki])] = i;
  var ins = 0, upd = 0;
  objs.forEach(function (o) {
    var row = h.map(function (k) { return o[k] === undefined || o[k] === null ? '' : o[k]; }), at = pos[String(o[key])];
    if (at) { values[at] = row; upd++; } else { pos[String(o[key])] = values.length; values.push(row); ins++; }
  });
  textFormat_(sh, h, 2, values.length - 1);
  sh.getRange(1, 1, values.length, h.length).setValues(values);
  return { inserted: ins, updated: upd };
}

// ---------- 觸發器 ----------
function scheduleContinuation_(handler, ms) { clearContinuation_(handler); ScriptApp.newTrigger(handler).timeBased().after(ms || 60000).create(); }
function clearContinuation_(handler) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t); });
}

// ---------- 步驟與工作 ----------
/** 執行一步並寫 run_log；丟例外＝error。回傳是否成功（skipped 算成功） */
function runStep_(runId, step, fn) {
  var started = nowIso_(), out = {}, status = 'success', error = '';
  try { out = fn(step, runId) || {}; status = out.status || 'success'; error = out.note || ''; }
  catch (e) { status = 'error'; error = String((e && e.stack) || e).slice(0, 1000); }
  appendObjects_('run_log', [{ run_id: runId, step: step, started_at: started, ended_at: nowIso_(),
    rows_in: out.rows_in === undefined ? '' : out.rows_in, rows_out: out.rows_out === undefined ? '' : out.rows_out, status: status, error: error }]);
  return status !== 'error';
}

/**
 * 可續跑的工作 runner。
 * - checkpoint 在每個 task 之前存入 Script Properties
 * - 時間預算用完 → 1 分鐘後接續
 * - 開跑先排 7 分鐘後的「保險接續」，被 GAS 強制終止時由它從斷點繼續
 */
function runJob_(job, makeRunId, makeTasks, continueHandler, runTask) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { scheduleContinuation_(continueHandler); return; }
  var props = PropertiesService.getScriptProperties(), stateKey = 'JOB_' + job;
  try {
    var t0 = Date.now(), st = JSON.parse(props.getProperty(stateKey) || 'null');
    if (st && Date.now() - st.saved > 864e5) st = null;           // 超過一天視為過期
    var runId = st ? st.run_id : makeRunId(), tasks = st ? st.tasks : makeTasks(), failures = st ? st.failures : [];
    scheduleContinuation_(continueHandler, 7 * 60 * 1000);         // 保險接續
    for (var i = st ? st.idx : 0; i < tasks.length; i++) {
      props.setProperty(stateKey, JSON.stringify({ run_id: runId, tasks: tasks, idx: i, failures: failures, saved: Date.now() }));
      if (Date.now() - t0 > BUDGET_MS) { scheduleContinuation_(continueHandler); return; }
      if (!runStep_(runId, tasks[i], runTask)) failures.push(tasks[i]);
    }
    props.deleteProperty(stateKey);
    clearContinuation_(continueHandler);
    appendObjects_('run_log', [{ run_id: runId, step: job + '_done', started_at: nowIso_(), ended_at: nowIso_(),
      rows_in: tasks.length, rows_out: tasks.length - failures.length, status: failures.length ? 'partial' : 'success', error: failures.join(', ') }]);
    // 這裡可呼叫 sendAlert_（以 run_id:type 去重）通知 failures
  } finally { lock.releaseLock(); }
}

// ---------- 範例：一個步驟 ----------
// function fetchExample_(runId, src) {
//   var data = fetchJson_(URL[src]).map(trimKeys_);
//   var now = nowIso_();
//   var rows = data.map(function (r) { return {
//     raw_id: 'ex:' + src + ':' + r.id,            // 跨來源穩定的冪等鍵
//     run_id: runId, fetched_at: now, source_url: URL[src], id: r.id, title: r.title }; });
//   if (!rows.length && data.length) throw new Error('解析 0 筆，來源結構可能改變');
//   var added = appendNewRaw_('raw_example', rows);
//   return { rows_in: data.length, rows_out: added, note: '新增 ' + added };
// }
