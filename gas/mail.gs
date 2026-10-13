/**
 * 通知信（寄到 Script Property ALERT_EMAIL；以 mail_log 防止同一 run 重寄）：
 *   sendAlert_       排程失敗／過期告警
 *   sendWeeklyDigest_ 每週摘要信（02 檔第 7 節；規則產生，不用 AI）
 */

var SITE_URL = 'https://lindasu1021-work.github.io/cloudlens/';
var PRODUCT = '企業雲端商機洞察平台';

/** 共用：寄信並寫入 mail_log。回傳 true＝實際寄出。 */
function sendMail_(runId, type, subject, textBody, htmlBody) {
  var key = runId + ':' + type;
  if (readColumn_('mail_log', 'mail_key').indexOf(key) >= 0) return false;
  var to = getProp_('ALERT_EMAIL', '');
  if (!to) {
    Logger.log('未設定 ALERT_EMAIL，只寫 log：' + subject);
    return false;
  }
  var opts = htmlBody ? { htmlBody: htmlBody } : {};
  MailApp.sendEmail(to, subject, textBody, opts);
  appendObjects_('mail_log', [{ mail_key: key, sent_at: nowIso_() }]);
  return true;
}

function sendAlert_(runId, type, subject, body) {
  return sendMail_(runId, type, subject, body + '\n\n— ' + PRODUCT + ' 自動通知');
}

// ---------- 每週摘要信 ----------

/** 組出摘要內容（純函式，不寄信；方便測試）。 */
function buildWeeklyDigest_(runId) {
  var snap = getSnapshot_(runId);
  var name = {};
  snap.companies.forEach(function (c) { name[c.code] = c.name; });
  var tierNow = {}, tierPrev = snap.prev || {};
  snap.scores.forEach(function (r) { tierNow[String(r.stock_code)] = String(r.tier); });
  var first = !snap.prev_run_id;

  var newT1 = [], droppedT1 = [];
  Object.keys(tierNow).forEach(function (c) {
    var p = tierPrev[c] && String(tierPrev[c].tier);
    if (tierNow[c] === '1' && p && p !== '1') newT1.push(c);
    if (tierNow[c] !== '1' && p === '1') droppedT1.push(c);
  });
  var tier1 = Object.keys(tierNow).filter(function (c) { return tierNow[c] === '1'; });

  var movers = snap.scores.map(function (r) {
    var p = tierPrev[String(r.stock_code)];
    if (!p) return null;
    return { code: String(r.stock_code), delta: Math.round(((Number(r.need) || 0) + (Number(r.timing) || 0) - (Number(p.need) || 0) - (Number(p.timing) || 0)) * 10) / 10,
             from: String(p.tier), to: String(r.tier) };
  }).filter(function (m) { return m && (m.delta !== 0 || m.from !== m.to); })
    .sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); }).slice(0, 5);

  var cutoff = Date.now() - 7 * 864e5, seen = {};
  var events = snap.signals.filter(function (s) {
    if (s.type !== 'T1' || new Date(s.at).getTime() < cutoff) return false;
    var k = s.code + '|' + s.title + '|' + s.at;
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  }).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); }).slice(0, 8);

  var st = statusCards_(readTable_('run_log'));
  var errors = st.recent_errors.filter(function (e) { return !e.resolved; });
  return { runId: runId, ruleVersion: snap.rule_version, first: first, prevRun: snap.prev_run_id, name: name,
           tier1Count: tier1.length, newT1: newT1, droppedT1: droppedT1, movers: movers, events: events,
           sources: st.cards, errors: errors, tierCounts: snap.summary.tier_counts };
}

function digestText_(d) {
  var T = { '1': 'Tier 1', '2': 'Tier 2', '3': 'Tier 3', hold: '暫緩' };
  var L = [];
  L.push(PRODUCT + '｜每週摘要 ' + d.runId + '（規則 v' + d.ruleVersion + '）', '');
  L.push('■ Tier 1 立即開發：' + d.tier1Count + ' 家（Tier 2：' + d.tierCounts['2'] + '、Tier 3：' + d.tierCounts['3'] + '、暫緩：' + d.tierCounts.hold + '）');
  if (d.first) L.push('  這是第一次計分，下週起顯示與上週的比較。');
  else {
    L.push('  本週新進 Tier 1：' + (d.newT1.length ? d.newT1.map(function (c) { return d.name[c] + '（' + c + '）'; }).join('、') : '無'));
    if (d.droppedT1.length) L.push('  本週移出 Tier 1：' + d.droppedT1.map(function (c) { return d.name[c] + '（' + c + '）'; }).join('、'));
  }
  L.push('', '■ 分數變化前 5 名' + (d.first ? '' : '（與 ' + d.prevRun + ' 比較）'));
  if (!d.movers.length) L.push('  ' + (d.first ? '尚無上週資料' : '與上週相比沒有變化'));
  d.movers.forEach(function (m) {
    L.push('  ' + (m.delta > 0 ? '▲' : m.delta < 0 ? '▼' : '・') + ' ' + d.name[m.code] + '（' + m.code + '）' + (m.delta ? ' ' + (m.delta > 0 ? '+' : '') + m.delta : '') +
           (m.from !== m.to ? '　' + T[m.from] + ' → ' + T[m.to] : ''));
  });
  L.push('', '■ 近 7 天新觸發事件（' + d.events.length + ' 則）');
  if (!d.events.length) L.push('  無');
  d.events.forEach(function (e) { L.push('  ' + String(e.at).slice(5, 10) + '　' + (d.name[e.code] || e.code) + '：' + e.title); });
  L.push('', '■ 各資料源');
  d.sources.forEach(function (c) {
    L.push('  ' + (c.state === 'ok' ? '✓' : c.state === 'error' ? '✕' : '!') + ' ' + c.name + '：' + c.unit + ' ' + c.this_week.toLocaleString());
  });
  L.push('', '■ 錯誤摘要');
  if (!d.errors.length) L.push('  無待處理的錯誤');
  d.errors.forEach(function (e) { L.push('  ✕ ' + e.step + '：' + e.message.slice(0, 100)); });
  L.push('', '網站：' + SITE_URL, '— ' + PRODUCT + ' 自動通知（本信由規則產生，未使用 AI）');
  return L.join('\n');
}

/** 每週排程最後一步：寄摘要。未設定 ALERT_EMAIL 時只記錄、不算失敗。 */
function sendWeeklyDigest_(runId) {
  var d = buildWeeklyDigest_(runId);
  var text = digestText_(d);
  var html = '<pre style="font-family:system-ui,-apple-system,\'Noto Sans TC\',sans-serif;font-size:14px;line-height:1.7;white-space:pre-wrap">' +
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>') + '</pre>';
  var sent = sendMail_(runId, 'weekly_digest', '[' + PRODUCT + '] 每週摘要 ' + runId + '：Tier 1 共 ' + d.tier1Count + ' 家', text, html);
  return { status: sent ? 'success' : 'skipped', rows_in: d.sources.length, rows_out: sent ? 1 : 0,
           note: sent ? '已寄出摘要信' : (getProp_('ALERT_EMAIL', '') ? '本週摘要已寄過' : '未設定 ALERT_EMAIL，未寄信') };
}
