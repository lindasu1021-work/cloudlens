/**
 * 資料表結構（spec 第 4 節）與設定讀取。
 * 依決策調整：不建 raw_jobs（D18 就業通不採用）；AWS 案例改為人工維護的 config_aws_cases（D20）。
 */

var RAW_COMMON = ['raw_id', 'run_id', 'fetched_at', 'source_url'];

var SCHEMA = {
  // 4.1 設定（Verna 可直接修改）
  config_settings: ['key', 'value', 'note'],
  config_weights: ['component', 'max_points', 'enabled', 'note'],
  config_keywords: ['keyword_id', 'category', 'keyword', 'strength', 'industry_scope', 'match_type', 'trig_type', 'points', 'play', 'active'],
  config_play_aws: ['play', 'aws_offering', 'talking_point'],
  config_company_overrides: ['stock_code', 'news_query', 'news_exclude_terms', 'note'],
  config_aws_cases: ['stock_code', 'company_name', 'case_url', 'checked_at', 'note'],
  // D28：驗證集＝公開來源證實使用公有雲的帳戶池公司；cloud 欄同時用於雲端現況
  config_validation: ['stock_code', 'company_name', 'cloud', 'evidence_url', 'source_type', 'checked_at', 'note'],
  // 4.2 主檔
  companies: ['stock_code', 'name_full', 'name_short', 'market', 'industry_code', 'industry_name', 'capital', 'in_universe', 'updated_at'],
  company_aliases: ['alias', 'stock_code'],
  // 4.3 原始資料（只追加）
  raw_announcements: RAW_COMMON.concat(['stock_code', 'ann_date', 'subject', 'description', 'rule_ref']),
  raw_revenue: RAW_COMMON.concat(['stock_code', 'year_month', 'revenue', 'yoy_pct']),
  raw_news: RAW_COMMON.concat(['stock_code', 'query', 'title', 'published_at', 'publisher', 'link']),
  raw_esg_security: RAW_COMMON.concat(['stock_code', 'report_year', 'breach_count', 'pii_breach_ratio', 'affected_customers']),
  // 4.4 處理結果
  signals: ['signal_id', 'stock_code', 'signal_type', 'category', 'play', 'strength', 'points_raw', 'observed_at', 'title', 'evidence_url', 'source', 'run_id'],
  scores: ['run_id', 'stock_code', 'rule_version', 'n1', 'n2', 'n3', 'n4', 'need', 't1', 't2', 't3', 't4', 'timing', 'need_pct', 'timing_pct',
           'tier', 'play_primary', 'play_secondary', 'cloud_status', 'data_completeness', 'top_signal_ids'],
  validation: ['run_id', 'rule_version', 'validation_set_size', 'hits_top20pct', 'precision', 'note'],
  // 4.5 AI 與維運
  ai_cache: ['cache_key', 'output_json', 'created_at', 'mode'],
  ai_log: ['ts', 'stock_code', 'action', 'mode', 'success', 'error', 'est_tokens'],
  run_log: ['run_id', 'step', 'started_at', 'ended_at', 'rows_in', 'rows_out', 'status', 'error'],
  mail_log: ['mail_key', 'sent_at']
};

// 這些欄位存成純文字，避免 Sheets 把代號、日期自動轉型
var TEXT_COL_RE = /stock_code|_id$|_ids$|^key$|_key$|date|_at$|^ts$|year_month|^alias$|report_year|^value$/;

var DEFAULT_SETTINGS = [
  ['capital_threshold', '', '實收資本額門檻（元）；空白＝三產業全部納入。Phase 1 看完分布後由 Verna 決定'],
  ['industry_codes', '05,17,28', '05 電機機械、17 金融保險、28 電子零組件（上市上櫃相同）'],
  ['revenue_backfill_months', '15', '月營收回補月數（N1 年化需 12 個月、T3 需連 3 個月）'],
  ['daily_ai_limit', '30', 'Copilot 每日上限'],
  ['tier_percentile', '0.30', '各軸前 30% 為高'],
  ['gemini_model', 'gemini-3.8-flash,gemini-flash-latest', '候選模型，依序嘗試（Phase 0：免費層會暫時 503）'],
  ['rule_version', '1', '調整權重或字典時 +1'],
  ['current_run_id', '', '網站目前顯示的計分 run_id']
];

var DEFAULT_WEIGHTS = [
  ['N1', 25, true, '規模：年化營收百分位；金控以實收資本額代理'],
  ['N2', 25, false, '數位人才招募：就業通不可用（D18），停用＝缺資料'],
  ['N3', 25, true, '策略意圖：重訊＋新聞命中 MIG/DATA/AI'],
  ['N4', 25, true, '資安合規壓力'],
  ['T1', 50, true, '觸發事件'],
  ['T2', 20, true, '新聞動能'],
  ['T3', 20, true, '營收動能'],
  ['T4', 10, false, '招募加速：就業通不可用（D18）']
];

var INDUSTRY_NAMES = { '05': '電機機械', '17': '金融保險', '28': '電子零組件' };

/** 建立所有分頁；已存在者只補缺少的欄位，不覆寫資料。可重複執行。 */
function setupSheets() {
  var book = ss();
  Object.keys(SCHEMA).forEach(function (name) {
    var cols = SCHEMA[name];
    var sh = book.getSheetByName(name) || book.insertSheet(name);
    var existing = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].filter(String) : [];
    var missing = cols.filter(function (c) { return existing.indexOf(c) < 0; });
    if (missing.length) sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    var header = existing.concat(missing);
    header.forEach(function (c, i) {
      if (TEXT_COL_RE.test(c)) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  });
  seedConfig_('config_settings', 'key', DEFAULT_SETTINGS);
  seedConfig_('config_weights', 'component', DEFAULT_WEIGHTS);
  // 移除建立試算表時的預設空白分頁
  ['工作表1', 'Sheet1'].forEach(function (n) {
    var sh = book.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && book.getSheets().length > 1) book.deleteSheet(sh);
  });
}

/** 只補沒有的 key，不覆寫 Verna 改過的值。 */
function seedConfig_(name, key, rows) {
  var have = readColumn_(name, key);
  var header = header_(name);
  var fresh = rows.filter(function (r) { return have.indexOf(String(r[0])) < 0; }).map(function (r) {
    var o = {};
    header.forEach(function (k, i) { o[k] = r[i]; });
    return o;
  });
  appendObjects_(name, fresh);
}

var settingsCache_ = null;
function setting_(key, fallback) {
  if (!settingsCache_) {
    settingsCache_ = {};
    readTable_('config_settings').forEach(function (r) { settingsCache_[r.key] = r.value; });
  }
  var v = settingsCache_[key];
  return v === undefined || v === '' ? fallback : v;
}
