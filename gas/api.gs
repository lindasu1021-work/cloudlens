/**
 * GAS Web App 進入點。回應格式一律 { ok, data?, error?, run_id }（spec 第 6 節）。
 * Phase 1：ping、status（資料狀態）、companies（主檔，供決定資本額門檻）、phase0。
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
    else if (action === 'phase0') data = readPhase0_();
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
  return { sources: Object.keys(sources).sort().map(function (k) { return sources[k]; }), tables: tables, jobs: jobs,
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
