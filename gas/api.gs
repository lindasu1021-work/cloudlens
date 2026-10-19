/**
 * GAS Web App 進入點。回應格式一律 { ok, data?, error?, run_id }（spec 第 6 節）。
 * snapshot、summary、accounts、account、status、methodology（spec 第 6 節）；另有 ping、companies、phase0。
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'ping';
  var runId = '';
  try {
    runId = String(setting_('current_run_id', ''));
  } catch (err) { /* 分頁尚未建立 */ }
  try {
    var data;
    if (action === 'ping') data = { method: 'GET', echo: p, server_time: new Date().toISOString() };
    else if (action === 'status') data = apiStatus_();
    else if (action === 'companies') data = readTable_('companies');
    else if (action === 'account') data = apiAccount_(String(p.code || ''), runId);
    else if (action === 'snapshot') data = getSnapshot_(runId);
    else if (action === 'summary') data = apiSummary_(runId);
    else if (action === 'accounts') data = apiAccounts_(runId, p);
    else if (action === 'methodology') data = apiMethodology_(runId);
    else if (action === 'phase0') data = readPhase0_();
    else if (action === 'gcis_probe') data = apiGcisProbe_();
    else if (action === 'lookup') data = apiLookup_(p.q, p.alias);
    else if (action === 'lookup_config') data = apiLookupConfig_();
    else if (action === 'insight') data = apiInsight_(String(p.industry || ''));
    else if (action === 'confirm' || action === 'unsubscribe') return subPage_(action, p.token);
    else return jsonOut_({ ok: false, error: 'unknown action: ' + action, run_id: runId });
    return jsonOut_({ ok: true, data: data, run_id: runId });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err), run_id: runId });
  }
}

/** 前端以 Content-Type: text/plain 送 JSON 字串，避免 CORS 預檢。 */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'subscribe') return jsonOut_({ ok: true, data: apiSubscribe_(body.email), run_id: '' });
    if (body.action === 'copilot') {
      var runId = String(setting_('current_run_id', ''));
      return jsonOut_({ ok: true, data: apiCopilot_(body), run_id: runId });
    }
    return jsonOut_({ ok: true, data: { method: 'POST', content_type: e.postData.type, echo: body,
                                         server_time: new Date().toISOString() }, run_id: '' });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err), run_id: '' });
  }
}

/** 資料狀態：各來源最後成功時間、筆數、最近錯誤；各資料表筆數。 */
function apiStatus_() {
  var log = readTable_('run_log');
  var sources = {};
  log.forEach(function (r) {
    var p = String(r.step).split(':');
    var src = p[0] === 'revenue' ? 'revenue:' + p[2] : p.slice(0, 2).join(':'); // revenue 依市場彙總
    var s = sources[src] || (sources[src] = { source: src, runs: 0, last_status: '', last_run_at: '', last_success_at: '',
                                              last_rows_out: '', last_error: '', last_error_at: '' });
    s.runs++;
    var at = String(r.ended_at);
    if (at >= s.last_run_at) { s.last_run_at = at; s.last_status = r.status; }
    if (r.status !== 'error' && at >= s.last_success_at) { s.last_success_at = at; s.last_rows_out = r.rows_out; }
    if (r.status === 'error' && at >= s.last_error_at) { s.last_error_at = at; s.last_error = String(r.error).slice(0, 300); }
  });
  var tables = {};
  ['companies', 'company_aliases', 'raw_announcements', 'raw_revenue', 'raw_news', 'raw_esg_security', 'signals', 'scores',
   'config_keywords', 'run_log', 'mail_log'].forEach(function (n) {
    tables[n] = Math.max(sheet_(n).getLastRow() - 1, 0);
  });
  var jobs = ['daily', 'monthly', 'weekly'].map(function (j) {
    var st = getProp_('JOB_' + j, '');
    return { job: j, in_progress: !!st, checkpoint: st ? JSON.parse(st).idx + '/' + JSON.parse(st).tasks.length : '' };
  });
  var cards = statusCards_(log);
  var hist = JSON.parse(getProp_('ANN_HIST', 'null') || 'null');
  var backfill = {
    announcements: hist ? { done_days: Object.keys(hist.done).length, total_days: Math.round((hist.end - hist.start) / 864e5) + 1 } : null,
    news_companies: Object.keys(JSON.parse(getProp_('NEWS_BACKFILLED', '{}'))).length
  };
  var yieldInfo = null;
  try { yieldInfo = JSON.parse(getProp_('SIGNAL_YIELD', 'null')); } catch (e) { /* 尚未計算 */ }
  var cloudCases = null;
  try {
    var cc = readTable_('config_cloud_cases'), isV = function (r) { return r.verified === true || String(r.verified).toUpperCase() === 'TRUE'; };
    cloudCases = { total: cc.length, verified: cc.filter(isV).length, candidates: cc.filter(function (r) { return !isV(r); }).length,
      companies_verified: Object.keys(cc.filter(isV).reduce(function (m, r) { m[r.stock_code] = 1; return m; }, {})).length,
      companies_candidate: Object.keys(cc.filter(function (r) { return !isV(r); }).reduce(function (m, r) { m[r.stock_code] = 1; return m; }, {})).length,
      by_source: cc.reduce(function (m, r) { m[r.source_type] = (m[r.source_type] || 0) + 1; return m; }, {}),
      sample: cc.filter(function (r) { return !isV(r); }).slice(0, 12).map(function (r) { return { code: String(r.stock_code), name: r.company_name, cloud: r.cloud, note: String(r.note).slice(0, 70) }; }) };
  } catch (e) { /* 分頁尚未建立 */ }
  return { cloud_cases: cloudCases, signal_yield: yieldInfo, cards: cards.cards, week_labels: cards.week_labels, recent_errors: cards.recent_errors,
           sources: Object.keys(sources).sort().map(function (k) { return sources[k]; }), tables: tables, jobs: jobs, backfill: backfill,
           schedule: ['每日 22:00–23:00 重大訊息＋訊號與計分', '每週一 05:00–06:00 新聞・ESG・重訊回補・訊號・計分', '每月 15 日 05:00–06:00 公司主檔・月營收'],
           server_time: nowIso_(),
           ai_recent: readTable_('ai_log').slice(-10).reverse().map(function (r) {
             return { ts: String(r.ts), code: String(r.stock_code), action: r.action, mode: r.mode, success: r.success,
                      error: String(r.error).slice(0, 400), est_tokens: r.est_tokens };
           }),
           ai_today: Number(getProp_(quotaKey_(), 0)),
           precompute_today: precomputeUsedToday_(),
           settings: { gemini_model: setting_('gemini_model', ''), rule_version: setting_('rule_version', ''),
                       copilot_precompute_daily: setting_('copilot_precompute_daily', ''), settings_applied: getProp_('SETTINGS_APPLIED', '') },
           gemini_daily_off: geminiDailyOff_(),
           gemini_models: geminiModelsCached_(),
           ann_retry: JSON.parse(getProp_('ANN_RETRY', 'null') || 'null'),
           triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }) };
}

/** 帳戶明細：基本資料、分數拆解（空白＝缺資料）、訊號列表（[S#] 依日期新到舊）。 */
function apiAccount_(code, runId) {
  var company = readTable_('companies').filter(function (c) { return String(c.stock_code) === code; })[0];
  if (!company) throw new Error('查無公司 ' + code);
  var score = readTable_('scores').filter(function (r) { return String(r.stock_code) === code && String(r.run_id) === runId; })[0] || null;
  var signals = readTable_('signals').filter(function (s) { return String(s.stock_code) === code; })
    .sort(function (a, b) { return String(b.observed_at).localeCompare(String(a.observed_at)); })
    .map(function (s, i) { s.ref = 'S' + (i + 1); return s; });
  var revenue = readTable_('raw_revenue').filter(function (r) { return String(r.stock_code) === code; })
    .map(function (r) { return { year_month: r.year_month, revenue: r.revenue, yoy_pct: r.yoy_pct }; })
    .sort(function (a, b) { return String(a.year_month).localeCompare(String(b.year_month)); });
  return { company: company, score: score, signals: signals, revenue: revenue };
}

/** 資料狀態頁（06 檔第 7 節）的來源群組。days＝預期更新週期，超過 1.5 倍未成功視為過期。 */
var STATUS_GROUPS = [
  { key: 'companies', name: '公司主檔', src: '證交所＋櫃買 OpenAPI', prefixes: ['companies', 'aliases_universe'], days: 31, unit: '最近一次筆數' },
  { key: 'revenue', name: '月營收', src: '公開資訊觀測站', prefixes: ['revenue'], days: 31, unit: '最近一次筆數' },
  { key: 'ann', name: '重大訊息（每日）', src: '證交所＋櫃買 OpenAPI', prefixes: ['ann'], days: 1, unit: '本週新增' },
  { key: 'annhist', name: '重大訊息（歷史回補）', src: '公開資訊觀測站', prefixes: ['annhist'], days: 7, unit: '本週新增' },
  { key: 'news', name: '新聞', src: 'Google News', prefixes: ['news'], days: 7, unit: '本週新增' },
  { key: 'esg', name: 'ESG 資訊安全', src: '證交所 OpenAPI', prefixes: ['esg'], days: 7, unit: '本週新增' },
  { key: 'scoring', name: '訊號與計分（每日）', src: '規則引擎（Apps Script）', prefixes: ['signals', 'scores'], days: 1, unit: '本週產生' },
  { key: 'copilot', name: 'Copilot 預生成', src: 'Gemini API', prefixes: ['copilot'], days: 7, unit: '本週新增' }
];

/** 各來源：狀態、最後成功時間、本週筆數、近 8 週筆數（每個 7 天為一週，最後一格＝最近 7 天）；另附最近 10 筆錯誤。 */
function statusCards_(log) {
  var now = Date.now(), WEEK = 7 * 864e5, tz = TZ;
  var fmtD = function (t) { return Utilities.formatDate(new Date(t), tz, 'MM/dd'); };
  var weekLabels = [];
  for (var w = 7; w >= 0; w--) weekLabels.push(fmtD(now - (w + 1) * WEEK + 864e5) + '–' + fmtD(now - w * WEEK));
  var okStatus = function (s) { return s !== 'error'; };
  var lastByStep = {};
  log.forEach(function (r) { if (String(r.step).indexOf('_done') < 0) lastByStep[r.step] = r; });
  var cards = STATUS_GROUPS.map(function (g) {
    var rows = log.filter(function (r) { return g.prefixes.indexOf(String(r.step).split(':')[0]) >= 0; });
    var counts = [0, 0, 0, 0, 0, 0, 0, 0], lastOk = null, lastRows = '';
    rows.forEach(function (r) {
      var t = new Date(r.ended_at).getTime();
      if (isNaN(t)) return;
      if (okStatus(r.status)) {
        var idx = Math.floor((now - t) / WEEK);
        if (idx >= 0 && idx < 8) counts[7 - idx] += Number(r.rows_out) || 0;
        if (r.status !== 'skipped' && (!lastOk || t > lastOk)) { lastOk = t; lastRows = Number(r.rows_out) || 0; }
      }
    });
    var errSteps = Object.keys(lastByStep).filter(function (st) {
      return g.prefixes.indexOf(st.split(':')[0]) >= 0 && lastByStep[st].status === 'error';
    });
    var stale = !lastOk || (now - lastOk) / 864e5 > g.days * 1.5;
    return { key: g.key, name: g.name, src: g.src, unit: g.unit, cycle_days: g.days,
             state: errSteps.length ? 'error' : stale ? 'stale' : 'ok',
             error_steps: errSteps.slice(0, 5), error_count: errSteps.length,
             last_success_at: lastOk ? Utilities.formatDate(new Date(lastOk), tz, "yyyy-MM-dd'T'HH:mm:ssXXX") : '',
             this_week: g.days <= 7 ? counts[7] : lastRows, weekly_counts: counts };
  });
  var errors = [];
  for (var i = log.length - 1; i >= 0 && errors.length < 10; i--) {
    var r = log[i];
    if (r.status !== 'error') continue;
    var resolved = log.slice(i + 1).some(function (x) { return x.step === r.step && x.status !== 'error'; });
    errors.push({ at: String(r.ended_at), step: String(r.step), run_id: String(r.run_id),
                  message: String(r.error).split('\n')[0].slice(0, 240), resolved: resolved });
  }
  return { cards: cards, week_labels: weekLabels, recent_errors: errors };
}
