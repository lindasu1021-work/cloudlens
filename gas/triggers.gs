/**
 * 時間觸發器（spec 第 9 節，D21）：
 *   每日 22:00–23:00 dailyJob；每月 15 日 05:00–06:00 monthlyJob。
 *   每週一 05:00–06:00 weeklyJob（Phase 2）。
 */

var RECURRING = ['dailyJob', 'monthlyJob', 'weeklyJob'];

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (RECURRING.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(22).inTimezone(TZ).create();
  ScriptApp.newTrigger('monthlyJob').timeBased().onMonthDay(15).atHour(5).inTimezone(TZ).create();
  ScriptApp.newTrigger('weeklyJob').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(5).inTimezone(TZ).create();
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

/** 套用後立即重算帳戶池（改了 capital_threshold 之後可手動執行）。 */
function recomputeUniverse() {
  settingsCache_ = null;
  Logger.log(JSON.stringify(rebuildAliasesAndUniverse_()));
}

/**
 * Phase 2 一鍵設定：補建分頁 → 套用 D22 門檻（僅在空白時）→ 匯入字典與 AWS 案例清單（僅在空白時）
 * → 安裝每週排程 → 重算帳戶池 → 1 分鐘後於背景開始第一次每週工作（新聞回補約 15–25 分鐘）。
 */
function setupPhase2() {
  setupSheets();
  if (String(setting_('capital_threshold', '')) === '') setSetting_('capital_threshold', 1000000000); // D22：10 億
  Logger.log('字典匯入 ' + seedKeywords_() + ' 筆');
  seedAwsCases_();
  seedValidation_();
  installTriggers();
  recomputeUniverse();
  scheduleContinuation_('continueWeeklyJob');
  Logger.log('完成。每週工作 1 分鐘後於背景開始，進度看 run_log 分頁。');
}

/** D20：人工整理的 AWS 公開客戶清單（僅在空白時寫入）。 */
function seedAwsCases_() {
  if (readColumn_('config_aws_cases', 'stock_code').length) return;
  appendObjects_('config_aws_cases', [{
    stock_code: '2882', company_name: '國泰金控',
    case_url: 'https://aws.amazon.com/tw/events/taiwan/news/taipei-region',
    checked_at: '2026-10-12', note: 'AWS 亞太（台北）區域啟用新聞稿點名之台灣客戶'
  }]);
}

/** D28：驗證集（公開來源證實使用公有雲），僅在空白時寫入；之後在 Sheets 維護。 */
function seedValidation_() {
  if (readColumn_('config_validation', 'stock_code').length) return;
  appendObjects_('config_validation', [
    { stock_code: '2882', company_name: '國泰金控', cloud: 'aws', evidence_url: 'https://aws.amazon.com/tw/events/taiwan/news/taipei-region',
      source_type: '雲端廠商官方', checked_at: '2026-10-12', note: 'AWS 台北區域啟用新聞稿點名客戶' },
    { stock_code: '2884', company_name: '玉山金控', cloud: 'gcp', evidence_url: 'https://cloud.google.com/customers/intl/zh-tw/esunbank?hl=zh-TW',
      source_type: '雲端廠商官方', checked_at: '2026-10-12', note: 'Google Cloud 客戶案例：混合雲、AI 房貸顧問；另有 Azure BCDR 海外試點' },
    { stock_code: '2891', company_name: '中信金控', cloud: 'azure', evidence_url: 'https://news.microsoft.com/source/asia/2026/04/10/ctbcbank_aiacrosstheorganization/?lang=zh-hant',
      source_type: '雲端廠商官方', checked_at: '2026-10-12', note: '中國信託銀行導入 Azure 與生成式 AI' },
    { stock_code: '2890', company_name: '永豐金控', cloud: 'azure', evidence_url: 'https://news.microsoft.com/source/asia/2025/04/22/azure-bcdr/?lang=zh-hant',
      source_type: '雲端廠商官方', checked_at: '2026-10-12', note: '永豐銀行 Azure BCDR 上雲' },
    { stock_code: '2371', company_name: '大同', cloud: 'gcp', evidence_url: '',
      source_type: '媒體報導', checked_at: '2026-10-12', note: '天下雜誌：宏庭科技助大同於 Google Cloud 完成 33TB SAP 系統轉型' }
  ]);
}
