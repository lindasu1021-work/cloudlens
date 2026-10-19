/**
 * 每日重大訊息：證交所 t187ap04_L、櫃買 mopsfin_t187ap04_O（只提供當日）。
 * 只保留主檔內（三產業）的公司。
 * 人事異動類公告的說明欄含個人姓名，依 spec 不保存（觸發事件只比對主旨）。
 */

var ANN_SOURCES = {
  twse: { url: 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L', code: '公司代號' },
  tpex: { url: 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O', code: 'SecuritiesCompanyCode' }
};

var PERSONNEL_RE = /異動|變動|辭任|辭職|解任|新任|委任|退休|聘任|改派|代表人|代理人|發言人|董事長|總經理|經理人/;
// 第二道防線：其他公告的說明欄中，含「姓名」的行（例：交易相對人姓名）整行刪除
var NAME_LINE_RE = /^.*姓名.*$/gm;

// 07 F3：403／429 時同次執行等 2 分鐘再試 1 次；仍失敗就排一次性接續觸發器 retryAnnToday（5 分鐘後，之後每 30 分鐘），當天 23:59 前持續補抓
var ANN_RETRY_KEY = 'ANN_RETRY'; // { date: 'yyyy-MM-dd', sources: ['tpex', ...], attempts: n }
var ANN_INRUN_WAIT_MS = 2 * 60 * 1000;

function fetchAnnJson_(url, waitOnBlock) {
  for (var i = 0; i < 2; i++) {
    var res = fetchWithRetry_(url);
    if ((res.code === 403 || res.code === 429) && waitOnBlock && i === 0) { Utilities.sleep(ANN_INRUN_WAIT_MS); continue; }
    if (res.code !== 200) { var e = new Error('HTTP ' + (res.code || res.error) + ' ' + url); e.blocked = res.code === 403 || res.code === 429 || res.code === 0 || res.code >= 500; throw e; }
    try { return JSON.parse(res.text); } catch (x) { if (i === 1) throw new Error('JSON 解析失敗：' + x + ' ' + url); Utilities.sleep(3000); }
  }
  throw new Error('HTTP 重試後仍失敗 ' + url);
}

function fetchAnnouncements_(runId, src, fromRetry) {
  var s = ANN_SOURCES[src];
  var data;
  try {
    data = fetchAnnJson_(s.url, !fromRetry).map(trimKeys_);
  } catch (e) {
    if (!fromRetry) annRetryAdd_(src);
    throw e;
  }
  var scope = {};
  readColumn_('companies', 'stock_code').forEach(function (c) { scope[c] = true; });
  var now = nowIso_();
  var rows = data.filter(function (r) { return scope[String(r[s.code]).trim()]; }).map(function (r) {
    var code = String(r[s.code]).trim();
    var subject = String(r['主旨'] || '').replace(/\r?\n/g, '').trim();
    var date = rocDateToIso_(r['發言日期']);
    var time = rocTimeToIso_(r['發言時間']);
    var rawDesc = String(r['說明'] || '');
    var desc = PERSONNEL_RE.test(subject) ? '' : rawDesc.replace(/\r/g, '').replace(NAME_LINE_RE, '[略]').slice(0, 40000);
    return {
      raw_id: annRawId_(src, code, date, time, subject),
      run_id: runId, fetched_at: now, source_url: s.url,
      stock_code: code,
      ann_date: date + 'T' + time + '+08:00',
      subject: subject,
      description: desc,
      rule_ref: String(r['符合條款'] || '').trim()
    };
  });
  var added = appendNewRaw_('raw_announcements', rows);
  annRetryRemove_(src);
  return { rows_in: data.length, rows_out: added, note: '三產業 ' + rows.length + ' 則，新增 ' + added };
}

function annRetryState_() {
  var o = null;
  try { o = JSON.parse(getProp_(ANN_RETRY_KEY, 'null')); } catch (e) {}
  return o && o.date === todayStr_() ? o : { date: todayStr_(), sources: [], attempts: 0 };
}
function annRetryAdd_(src) {
  var o = annRetryState_();
  if (o.sources.indexOf(src) < 0) o.sources.push(src);
  PropertiesService.getScriptProperties().setProperty(ANN_RETRY_KEY, JSON.stringify(o));
  if (getProp_('ANN_RETRY_SCHEDULED', '') !== todayStr_()) { scheduleContinuation_('retryAnnToday', 5 * 60 * 1000); PropertiesService.getScriptProperties().setProperty('ANN_RETRY_SCHEDULED', todayStr_()); }
}
function annRetryRemove_(src) {
  var raw = getProp_(ANN_RETRY_KEY, '');
  if (!raw) return;
  var o = annRetryState_();
  o.sources = o.sources.filter(function (x) { return x !== src; });
  PropertiesService.getScriptProperties().setProperty(ANN_RETRY_KEY, JSON.stringify(o));
}

/** 一次性接續觸發器：只重抓今天失敗的重訊來源（OpenAPI 只給當日）；仍失敗就 30 分鐘後再試，直到 23:59。 */
function retryAnnToday() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('ANN_RETRY_SCHEDULED');
  clearContinuation_('retryAnnToday');
  var o = annRetryState_();
  if (!o.sources.length) { props.deleteProperty(ANN_RETRY_KEY); return; }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) { // 每日排程執行中：5 分鐘後再試
    scheduleContinuation_('retryAnnToday', 5 * 60 * 1000); props.setProperty('ANN_RETRY_SCHEDULED', todayStr_()); return;
  }
  try {
    o.attempts++;
    props.setProperty(ANN_RETRY_KEY, JSON.stringify(o));
    var runId = todayStr_() + '-daily';
    o.sources.slice().forEach(function (src) {
      runStep_(runId, 'ann:' + src, function () { return fetchAnnouncements_(runId, src, true); });
    });
  } finally { lock.releaseLock(); }
  var left = annRetryState_();
  var end = new Date(); end.setHours(23, 59, 0, 0);
  if (left.sources.length && Date.now() + 30 * 60 * 1000 < end.getTime()) {
    scheduleContinuation_('retryAnnToday', 30 * 60 * 1000); props.setProperty('ANN_RETRY_SCHEDULED', todayStr_());
  } else if (!left.sources.length) {
    props.deleteProperty(ANN_RETRY_KEY);
  }
}

/** 上市/上櫃、日期、時間、主旨（去空白）→ raw_id；OpenAPI 與 MOPS 歷史回補共用，跨來源去重。 */
function annRawId_(src, code, date, time, subject) {
  return 'ann:' + src + ':' + code + ':' + date + 'T' + time + ':' + md5_(String(subject).replace(/\s+/g, '')).slice(0, 10);
}

// ---------- 歷史回補（MOPS 依日期查詢，一次一天、全市場） ----------

var MOPS_ANN_URL = 'https://mopsov.twse.com.tw/mops/web/ajax_t05st02';
// GAS 實測從海外連 MOPS 每天約 27 秒：一個步驟只抓 1 天，避免單一步驟撞到 6 分鐘上限；
// 每次每週工作最多回補 90 天（由新到舊），一年份約 4 週補齊（免費帳號每日排程總時間 90 分鐘）
var ANN_HIST_DAYS = 365, ANN_HIST_CHUNK = 1, ANN_HIST_PER_RUN = 90;

/**
 * 尚未回補的 7 天區段。第一次執行時固定起始日（今天往前 365 天）與結束日（今天），
 * 存在 Script Property ANN_HIST（{start, end, done:{yyyyMMdd:true}}），之後每週只列出還沒完成的區段。
 * 結束日之後的重訊由每日排程（OpenAPI）負責。
 */
var ANN_HIST_RECENT = 7; // 07 F4：每次都重抓最近 7 天（昨天往前），補上 OpenAPI 只給當日而漏掉的日子；以 raw_id 去重，不會重複寫入

function annHistTasks_() {
  var props = PropertiesService.getScriptProperties();
  var st = JSON.parse(props.getProperty('ANN_HIST') || 'null');
  if (!st) st = { start: Date.now() - ANN_HIST_DAYS * 864e5, end: Date.now(), done: {} };
  st.end = Date.now(); // 07 F4：結束日每次更新為今天（原本第一次執行後就固定）
  props.setProperty('ANN_HIST', JSON.stringify(st));
  var tasks = [], seen = {};
  for (var d = 1; d <= ANN_HIST_RECENT; d++) {
    var rk = Utilities.formatDate(new Date(st.end - d * 864e5), TZ, 'yyyyMMdd');
    tasks.push('annhist:' + rk); seen[rk] = true;
  }
  for (var t = st.end - 864e5; t >= st.start && tasks.length < ANN_HIST_PER_RUN; t -= ANN_HIST_CHUNK * 864e5) {
    var key = Utilities.formatDate(new Date(t), TZ, 'yyyyMMdd');
    if (!st.done[key] && !seen[key]) tasks.push('annhist:' + key);
  }
  return tasks;
}

/** 07 F4 一次性補洞（手動執行）：立即補抓指定區間（預設 2026-10-12～昨天）的重訊，含上櫃。 */
function backfillRecentAnnouncements(fromKey) {
  var from = fromKey || '20261012';
  var st = JSON.parse(getProp_('ANN_HIST', 'null') || 'null') || { start: Date.now() - ANN_HIST_DAYS * 864e5, done: {} };
  st.end = Date.now();
  PropertiesService.getScriptProperties().setProperty('ANN_HIST', JSON.stringify(st));
  var runId = todayStr_() + '-backfill';
  for (var t = Date.now() - 864e5; ; t -= 864e5) {
    var key = Utilities.formatDate(new Date(t), TZ, 'yyyyMMdd');
    if (key < from) break;
    runStep_(runId, 'annhist:' + key, function (step) { return fetchAnnHistory_(runId, step.split(':')[1]); });
  }
  Logger.log(JSON.stringify(readTable_('run_log').filter(function (r) { return r.run_id === runId; })));
}

function fetchAnnHistory_(runId, startKey) {
  var scope = {};
  readColumn_('companies', 'stock_code').forEach(function (c) { scope[c] = true; });
  var start = new Date(Number(startKey.slice(0, 4)), Number(startKey.slice(4, 6)) - 1, Number(startKey.slice(6, 8)));
  var rows = [], total = 0;
  for (var i = 0; i < ANN_HIST_CHUNK; i++) {
    var d = new Date(start.getTime() + i * 864e5);
    var st = JSON.parse(getProp_('ANN_HIST', '{}'));
    if (d.getTime() > (st.end || Date.now())) break;
    var payload = 'encodeURIComponent=1&step=1&step00=0&firstin=1&off=1&TYPEK=all&year=' + (d.getFullYear() - 1911) +
      '&month=' + ('0' + (d.getMonth() + 1)).slice(-2) + '&day=' + ('0' + d.getDate()).slice(-2);
    var res = fetchWithRetry_(MOPS_ANN_URL, { method: 'post', payload: payload, contentType: 'application/x-www-form-urlencoded' });
    if (res.code !== 200) throw new Error('HTTP ' + (res.code || res.error) + ' MOPS ' + payload);
    var forms = res.text.split('<form ').slice(1);
    total += forms.length;
    forms.forEach(function (f) {
      // 欄位名稱為 h＋列號＋欄位碼（第 1 列 h10–h18、第 12 列 h120–h128）；取最後一碼：1 代號、2 日期、3 時間、4 主旨、8 說明
      var h = {};
      (f.match(/name='h\d+' value='[\s\S]*?'>/g) || []).forEach(function (inp) {
        var m = inp.match(/name='h\d*(\d)' value='([\s\S]*?)'>/);
        h['h5' + m[1]] = m[2];
      });
      var code = String(h.h51 || '').trim();
      if (!scope[code]) return;
      var typek = (f.match(/TYPEK\.value="(\w+)"/) || [])[1];
      var src = typek === 'otc' ? 'tpex' : 'twse';
      var date = h.h52.slice(0, 4) + '-' + h.h52.slice(4, 6) + '-' + h.h52.slice(6, 8);
      var time = ('000000' + h.h53).slice(-6).replace(/(\d\d)(\d\d)(\d\d)/, '$1:$2:$3');
      var subject = unescapeHtml_(h.h54).replace(/\r?\n/g, '').trim();
      var rawDesc = unescapeHtml_(h.h58 || '');
      var rule = (rawDesc.match(/第XX款：(\d+)/) || [])[1];
      rows.push({
        raw_id: annRawId_(src, code, date, time, subject),
        run_id: runId, fetched_at: nowIso_(), source_url: MOPS_ANN_URL,
        stock_code: code, ann_date: date + 'T' + time + '+08:00', subject: subject,
        description: PERSONNEL_RE.test(subject) ? '' : rawDesc.replace(/\r/g, '').replace(NAME_LINE_RE, '[略]').slice(0, 40000),
        rule_ref: rule ? '第' + rule + '款' : ''
      });
    });
    Utilities.sleep(500);
  }
  var added = appendNewRaw_('raw_announcements', rows);
  var props = PropertiesService.getScriptProperties();
  var hist = JSON.parse(props.getProperty('ANN_HIST'));
  hist.done[startKey] = true;
  props.setProperty('ANN_HIST', JSON.stringify(hist));
  return { rows_in: total, rows_out: added, note: '全市場 ' + total + ' 則，三產業 ' + rows.length + '，新增 ' + added };
}

function unescapeHtml_(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
