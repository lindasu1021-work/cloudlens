/**
 * 排程主體：每日、每月工作。
 * 每個工作拆成多個 task；單一 task 失敗不中斷其他 task（spec 第 9 節）。
 * 超過時間預算就把進度存到 Script Properties，1 分鐘後由接續觸發器從斷點繼續。
 */

var BUDGET_MS = 4.5 * 60 * 1000; // GAS 單次上限 6 分鐘，留 1.5 分鐘緩衝

function dailyJob() {
  // 每週工作若因每日執行時間額度（免費帳號 90 分鐘）中斷，由每日排程幫它接續
  if (getProp_('JOB_weekly', '')) scheduleContinuation_('continueWeeklyJob', 5 * 60 * 1000);
  runJob_('daily', function () { return todayStr_() + '-daily'; }, function () {
    var tasks = [];
    // 主檔還沒建立時先抓（第一次部署）
    if (readColumn_('companies', 'stock_code').length === 0) tasks.push('companies:twse', 'companies:tpex', 'aliases_universe');
    // Copilot 預生成：每週一次做不完（Gemini 免費層額度有限），每天接著補；已生成的沿用快取
    // 07 F2：重訊之後重算當週訊號與分數（run_id 沿用當週），新觸發事件隔天就反映在 Timing 與 Tier
    return ['apply_settings'].concat(tasks, ['ann:twse', 'ann:tpex', 'signals:week', 'scores:week'], retryFailedTasks_(tasks), ['weekly_check'],
      missingInsightTasks_(), copilotTasks_());
  }, 'continueDailyJob');
}

function monthlyJob() {
  runJob_('monthly', function () { return todayStr_().slice(0, 7) + '-monthly'; }, function () {
    return ['companies:twse', 'companies:tpex', 'aliases_universe'].concat(revenueTasks_(), cloudCasesTasks_());
  }, 'continueMonthlyJob');
}

/**
 * 自動重試：run_log 中「最近一次狀態仍為 error」的步驟（單次網路／回應異常），每日最多重試 5 個。
 * 成功後該步驟的最新狀態變為 success，資料狀態頁的錯誤就會轉為「已恢復」。
 */
function retryFailedTasks_(exclude) {
  var SUPPORTED = { companies: 1, revenue: 1, ann: 1, annhist: 1, news: 1, esg: 1 };
  var last = {};
  readTable_('run_log').forEach(function (r) { if (String(r.step).indexOf('_done') < 0) last[r.step] = r.status; });
  return Object.keys(last).filter(function (st) {
    return last[st] === 'error' && SUPPORTED[st.split(':')[0]] && (exclude || []).indexOf(st) < 0 && st !== 'ann:twse' && st !== 'ann:tpex';
  }).slice(0, 5);
}

function weeklyJob() {
  runJob_('weekly', function () { return weeklyRunId_(); }, function () {
    return ['apply_settings', 'esg'].concat(annHistTasks_(), newsTasks_(), ['signals', 'scores'], insightTasks_(), ['digest'], copilotTasks_());
  }, 'continueWeeklyJob');
}

/** 每週 run_id：ISO 週次（2026-W42）；同一週重跑沿用同一個 run_id。 */
function weeklyRunId_() { return weekRunId_(new Date()); }

/** 手動：只重抓新聞（含科技媒體查詢）並重算訊號與分數；run_id 沿用本週。 */
function techNewsJob() {
  runJob_('technews', function () { return weeklyRunId_(); }, function () { return newsTasks_().concat(['signals', 'scores']); }, 'continueTechNewsJob');
}
function continueTechNewsJob() { techNewsJob(); }
function continueWeeklyJob() { weeklyJob(); }
function continueDailyJob() { dailyJob(); }
function continueMonthlyJob() { monthlyJob(); }

/** task key → 實際執行的函式。回傳 { rows_in, rows_out, status? }。 */
function runTask_(key, runId) {
  var p = key.split(':');
  switch (p[0]) {
    case 'companies': return fetchCompanies_(runId, p[1]);
    case 'aliases_universe': return rebuildAliasesAndUniverse_();
    case 'revenue': return fetchRevenueFile_(runId, p[1], p[2], p[3]);
    case 'ann': return fetchAnnouncements_(runId, p[1]);
    case 'weekly_check': return checkWeeklyFreshness_(runId);
    case 'esg': return fetchEsg_(runId);
    case 'news': return fetchNewsBatch_(runId, p[1], p[2]);
    case 'annhist': return fetchAnnHistory_(runId, p[1]);
    // signals:week／scores:week（每日排程）寫入當週 run_id；同一週內每天覆寫，「分數變化」仍與上週 run 比較
    case 'signals': return buildSignals_(p[1] === 'week' ? weeklyRunId_() : runId);
    case 'scores': return computeScores_(p[1] === 'week' ? weeklyRunId_() : runId);
    case 'apply_settings': return applySettings_();
    case 'insight': return runInsightTask_(p[1]);
    case 'digest': return sendWeeklyDigest_(runId);
    case 'cloudpages': return fetchCloudPages_(runId);
    case 'cloudcand': return discoverCloudCandidates_(runId, p[1], p[2]);
    case 'copilot': return precomputeCopilot_(runId, p[1]);
  }
  throw new Error('unknown task ' + key);
}

function runJob_(job, makeRunId, makeTasks, continueHandler) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log(job + '：另一個排程執行中，1 分鐘後再試');
    scheduleContinuation_(continueHandler);
    return;
  }
  var props = PropertiesService.getScriptProperties();
  var stateKey = 'JOB_' + job;
  try {
    var t0 = Date.now();
    var st = JSON.parse(props.getProperty(stateKey) || 'null');
    if (st && Date.now() - st.saved > 864e5) st = null; // 超過一天的斷點視為過期
    var runId = st ? st.run_id : makeRunId();
    var tasks = st ? st.tasks : makeTasks();
    var failures = st ? st.failures : [], aiFailures = st ? (st.aiFailures || []) : [];
    // 保險：先排一個 7 分鐘後的接續。若這次執行被 GAS 6 分鐘上限強制終止，會從最後存的斷點繼續
    scheduleContinuation_(continueHandler, 7 * 60 * 1000);
    for (var i = st ? st.idx : 0; i < tasks.length; i++) {
      var save = { run_id: runId, tasks: tasks, idx: i, failures: failures, aiFailures: aiFailures, saved: Date.now() };
      props.setProperty(stateKey, JSON.stringify(save));
      if (Date.now() - t0 > BUDGET_MS) {
        scheduleContinuation_(continueHandler);
        Logger.log(job + '：時間預算用完，停在 ' + i + '/' + tasks.length + '，1 分鐘後接續');
        return;
      }
      // 07 F5：Copilot 預生成失敗不算排程失敗（不寄失敗信，只在每週摘要彙總）
      if (!runStep_(runId, tasks[i], runTask_)) (String(tasks[i]).indexOf('copilot') === 0 ? aiFailures : failures).push(tasks[i]);
    }
    props.deleteProperty(stateKey);
    clearContinuation_(continueHandler);
    appendObjects_('run_log', [{ run_id: runId, step: job + '_done', started_at: nowIso_(), ended_at: nowIso_(),
      rows_in: tasks.length, rows_out: tasks.length - failures.length,
      status: failures.length ? 'partial' : 'success',
      error: failures.join(', ') + (aiFailures.length ? (failures.length ? '；' : '') + 'Copilot 預生成失敗（不計入）：' + aiFailures.join(', ') : '') }]);
    if (failures.length) {
      sendAlert_(runId, job + '_failure', '[企業雲端商機洞察平台] ' + job + ' 排程：資料來源失敗 ' + failures.length + ' 個步驟', failureMailBody_(runId, failures, aiFailures));
    }
    Logger.log(job + ' 完成：' + (tasks.length - failures.length) + '/' + tasks.length + ' 成功');
  } finally {
    lock.releaseLock();
  }
}

/** 執行一個步驟並寫入 run_log；回傳是否成功（skipped 也算成功）。 */
function runStep_(runId, step, fn) {
  var started = nowIso_();
  var out = {}, status = 'success', error = '';
  try {
    out = fn(step, runId) || {};
    status = out.status || 'success';
    error = out.note || '';
  } catch (e) {
    status = 'error';
    error = String((e && e.stack) || e).slice(0, 1000);
  }
  appendObjects_('run_log', [{ run_id: runId, step: step, started_at: started, ended_at: nowIso_(),
    rows_in: out.rows_in === undefined ? '' : out.rows_in, rows_out: out.rows_out === undefined ? '' : out.rows_out,
    status: status, error: error }]);
  return status !== 'error';
}

/** 每日檢查：每週排程超過 8 天未成功就寄告警（spec 第 9 節）。 */
function checkWeeklyFreshness_(runId) {
  var done = readTable_('run_log').filter(function (r) { return r.step === 'weekly_done' && r.status !== 'error'; });
  if (!done.length) return { status: 'skipped', note: '尚無每週排程紀錄（Phase 2 建立）' };
  var last = done.map(function (r) { return String(r.ended_at); }).sort().pop();
  var days = (Date.now() - new Date(last).getTime()) / 864e5;
  if (days > 8) {
    sendAlert_(runId, 'weekly_stale', '[企業雲端商機洞察平台] 每週排程已 ' + Math.floor(days) + ' 天未成功',
      '最後一次成功：' + last + '\n請到 Apps Script 的「執行作業」查看錯誤。');
    return { status: 'warning', note: '每週排程 ' + Math.floor(days) + ' 天未成功' };
  }
  return { status: 'success', note: '最後成功 ' + last };
}

/** 07 F5：失敗通知內容，區分「資料來源失敗」與「Copilot 預生成失敗」，並寫出建議處置。 */
var FAILURE_ADVICE = {
  ann: '證交所／櫃買 OpenAPI 偶發拒絕（403/429）：系統已在同次執行等 2 分鐘重試，並排了接續觸發器 retryAnnToday 自動補抓到 23:59；漏掉的日子也會由每週一的重訊歷史回補（最近 7 天）補回。通常無需處理。',
  annhist: '公開資訊觀測站歷史查詢失敗：下次每週排程會自動重抓（最近 7 天每週都會重抓）。無需處理。',
  news: 'Google News 抓取失敗：隔天每日排程會自動重試（每天最多重試 5 個失敗步驟）。',
  esg: 'ESG 資料抓取失敗：隔天每日排程會自動重試。',
  companies: '公司主檔抓取失敗：隔天每日排程會自動重試；若連續失敗請檢查來源網址。',
  revenue: '月營收抓取失敗：隔天每日排程會自動重試。',
  signals: '訊號計算失敗：請看 run_log 錯誤訊息；修正後可手動執行 rescoreNow()。',
  scores: '計分失敗：網站仍顯示上一次成功的分數；請看 run_log 錯誤訊息，修正後可手動執行 rescoreNow()。',
  insight: '產業洞察素材包產生失敗（多為 Google News 暫時拒絕）：下次每週排程會重新產生，網站仍顯示上一期。',
  apply_settings: '設定套用失敗：請看 run_log 錯誤訊息，可手動執行 applyPendingSettings()。'
};
function failureMailBody_(runId, failures, aiFailures) {
  var L = ['■ 資料來源失敗（' + failures.length + '）'];
  failures.forEach(function (f) {
    L.push('・' + f);
    var adv = FAILURE_ADVICE[String(f).split(':')[0]];
    if (adv) L.push('　建議處置：' + adv);
  });
  if (aiFailures && aiFailures.length) {
    L.push('', '■ Copilot 預生成失敗（' + aiFailures.length + '，不計入排程失敗）', '・' + aiFailures.join('、'),
           '　建議處置：多為 Gemini 免費額度用完或模型忙碌，明天自動續跑，無需處理（每週摘要信會彙總）。');
  }
  L.push('', '詳細錯誤請看 Sheets 的 run_log 分頁（run_id = ' + runId + '）。');
  return L.join('\n');
}

/** 還沒有任何素材包的產業（新啟用時），每日排程先補一次；之後由每週排程每兩週產生。 */
function missingInsightTasks_() {
  try { return industries_().map(function (r) { return r.industry_key; }).filter(function (k) { return !latestPack_(k); }).map(function (k) { return 'insight:' + k; }); }
  catch (e) { return []; }
}
