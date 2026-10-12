/**
 * 時間觸發器（spec 第 9 節，D21）：
 *   每日 22:00–23:00 dailyJob；每月 15 日 05:00–06:00 monthlyJob。
 * 每週排程於 Phase 2 加入。
 */

var RECURRING = ['dailyJob', 'monthlyJob'];

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (RECURRING.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(22).inTimezone(TZ).create();
  ScriptApp.newTrigger('monthlyJob').timeBased().onMonthDay(15).atHour(5).inTimezone(TZ).create();
  return listTriggers();
}

/** 停用所有排程（README「停用排程」用）。 */
function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

function listTriggers() {
  var list = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction() + ' (' + t.getEventType() + ')'; });
  Logger.log(list.join('\n'));
  return list;
}

/** 接續觸發器：同名只保留一個。 */
function scheduleContinuation_(handler) {
  clearContinuation_(handler);
  ScriptApp.newTrigger(handler).timeBased().after(60 * 1000).create();
}

function clearContinuation_(handler) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t);
  });
}

/**
 * Phase 1 一鍵設定：建立分頁 → 安裝排程 → 跑一次每日工作（含第一次抓主檔）→ 1 分鐘後自動開始每月工作（回補 15 個月營收）。
 * 可重複執行，不會產生重複資料。
 */
function setupPhase1() {
  setupSheets();
  installTriggers();
  dailyJob();
  scheduleContinuation_('continueMonthlyJob');
  Logger.log('完成。每月工作（月營收回補）會在 1 分鐘後於背景開始，約需 5–10 分鐘，進度看 run_log 分頁。');
}
