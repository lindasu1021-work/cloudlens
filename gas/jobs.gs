/**
 * 排程主體：每日、每月工作。
 * 每個工作拆成多個 task；單一 task 失敗不中斷其他 task（spec 第 9 節）。
 * 超過時間預算就把進度存到 Script Properties，1 分鐘後由接續觸發器從斷點繼續。
 */

var BUDGET_MS = 4.5 * 60 * 1000; // GAS 單次上限 6 分鐘，留 1.5 分鐘緩衝

function dailyJob() {
  runJob_('daily', function () { return todayStr_() + '-daily'; }, function () {
    var tasks = [];
    // 主檔還沒建立時先抓（第一次部署）
    if (readColumn_('companies', 'stock_code').length === 0) tasks.push('companies:twse', 'companies:tpex', 'aliases_universe');
    return tasks.concat(['ann:twse', 'ann:tpex', 'weekly_check']);
  }, 'continueDailyJob');
}

function monthlyJob() {
  runJob_('monthly', function () { return todayStr_().slice(0, 7) + '-monthly'; }, function () {
    return ['companies:twse', 'companies:tpex', 'aliases_universe'].concat(revenueTasks_());
  }, 'continueMonthlyJob');
}

function weeklyJob() {
  runJob_('weekly', function () { return weeklyRunId_(); }, function () {
    return ['esg'].concat(annHistTasks_(), newsTasks_(), ['signals', 'scores']);
  }, 'continueWeeklyJob');
}

/** 每週 run_id：ISO 週次（2026-W42）；同一週重跑沿用同一個 run_id。 */
function weeklyRunId_() { return weekRunId_(new Date()); }

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
    case 'signals': return buildSignals_(runId);
    case 'scores': return computeScores_(runId);
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
    var failures = st ? st.failures : [];
    // 保險：先排一個 7 分鐘後的接續。若這次執行被 GAS 6 分鐘上限強制終止，會從最後存的斷點繼續
    scheduleContinuation_(continueHandler, 7 * 60 * 1000);
    for (var i = st ? st.idx : 0; i < tasks.length; i++) {
      var save = { run_id: runId, tasks: tasks, idx: i, failures: failures, saved: Date.now() };
      props.setProperty(stateKey, JSON.stringify(save));
      if (Date.now() - t0 > BUDGET_MS) {
        scheduleContinuation_(continueHandler);
        Logger.log(job + '：時間預算用完，停在 ' + i + '/' + tasks.length + '，1 分鐘後接續');
        return;
      }
      if (!runStep_(runId, tasks[i], runTask_)) failures.push(tasks[i]);
    }
    props.deleteProperty(stateKey);
    clearContinuation_(continueHandler);
    appendObjects_('run_log', [{ run_id: runId, step: job + '_done', started_at: nowIso_(), ended_at: nowIso_(),
      rows_in: tasks.length, rows_out: tasks.length - failures.length,
      status: failures.length ? 'partial' : 'success', error: failures.join(', ') }]);
    if (failures.length) {
      sendAlert_(runId, job + '_failure', '[CloudLens] ' + job + ' 排程有 ' + failures.length + ' 個步驟失敗',
        '失敗步驟：\n' + failures.join('\n') + '\n\n詳細錯誤請看 Sheets 的 run_log 分頁（run_id = ' + runId + '）。');
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
    sendAlert_(runId, 'weekly_stale', '[CloudLens] 每週排程已 ' + Math.floor(days) + ' 天未成功',
      '最後一次成功：' + last + '\n請到 Apps Script 的「執行作業」查看錯誤。');
    return { status: 'warning', note: '每週排程 ' + Math.floor(days) + ' 天未成功' };
  }
  return { status: 'success', note: '最後成功 ' + last };
}
