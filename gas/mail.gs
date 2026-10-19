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

  // 07 F5：Copilot 預生成的失敗只在每週摘要彙總（近 7 天 ai_log）
  var ai = readTable_('ai_log').filter(function (r) { return r.mode === 'demo' && new Date(r.ts).getTime() >= cutoff; });
  var aiOk = ai.filter(function (r) { return r.success === true || String(r.success).toUpperCase() === 'TRUE'; }).length;
  var aiFail = ai.length - aiOk, aiQuota = ai.filter(function (r) { return /HTTP 429/.test(String(r.error)); }).length;
  var st = statusCards_(readTable_('run_log'));
  var errors = st.recent_errors.filter(function (e) { return !e.resolved; });
  return { runId: runId, ruleVersion: snap.rule_version, first: first, prevRun: snap.prev_run_id, name: name,
           tier1Count: tier1.length, newT1: newT1, droppedT1: droppedT1, movers: movers, events: events,
           sources: st.cards, errors: errors, tierCounts: snap.summary.tier_counts, ai: { ok: aiOk, fail: aiFail, quota: aiQuota } };
}

function digestText_(d, opt) {
  opt = opt || {};
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
  if (opt.publicVersion) {
    L.push('', '網站：' + SITE_URL, '— ' + PRODUCT + '（本信由規則產生，未使用 AI）');
    return L.join('\n');
  }
  L.push('', '■ 各資料源');
  d.sources.forEach(function (c) {
    L.push('  ' + (c.state === 'ok' ? '✓' : c.state === 'error' ? '✕' : '!') + ' ' + c.name + '：' + c.unit + ' ' + c.this_week.toLocaleString());
  });
  L.push('', '■ Copilot 預生成（近 7 天）：成功 ' + d.ai.ok + '、失敗 ' + d.ai.fail + (d.ai.quota ? '（其中 Gemini 額度相關 ' + d.ai.quota + '）' : ''));
  if (d.ai.fail) L.push('  多為 Gemini 免費額度或模型忙碌，每日排程會自動續跑；預生成失敗不寄即時告警。');
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
  var subs = 0;
  try { subs = sendDigestToSubscribers_(runId, d); } catch (e) { Logger.log('訂閱者寄送失敗：' + e); }
  var sent = sendMail_(runId, 'weekly_digest', '[' + PRODUCT + '] 每週摘要 ' + runId + '：Tier 1 共 ' + d.tier1Count + ' 家', text, html);
  return { status: sent ? 'success' : 'skipped', rows_in: d.sources.length, rows_out: sent ? 1 : 0,
           note: (sent ? '已寄出摘要信' : (getProp_('ALERT_EMAIL', '') ? '本週摘要已寄過' : '未設定 ALERT_EMAIL，未寄信')) + '；訂閱者 ' + subs + ' 封' };
}

// ---------- 每週摘要信訂閱（09 檔 5.5；雙重確認、可隨時取消） ----------

var WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbzb32r6vAc54inssIjGO3ol0FNmevyKkDvp_QMmpNYguGhz4C6k5fNk8Nmc3izW_7fo/exec';
var SUB_DAILY_CAP = 20; // 每日最多寄出的確認信（避免被濫用寄信）
var EMAIL_RE = /^[^\s@<>"',;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;

function subToken_() { return Utilities.getUuid().replace(/-/g, ''); }
function subCountKey_() { return 'SUB_COUNT_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'); }

/** POST {action:"subscribe", email}：寄出確認信；確認後才會收到每週摘要。 */
function apiSubscribe_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, message: 'Email 格式不正確' };
  ensureInsightSheets_();
  var rows = readTable_('subscribers'), row = rows.filter(function (r) { return String(r.email) === email; })[0];
  if (row && row.status === 'active') return { ok: true, message: '這個 Email 已經訂閱了。' };
  if (row && row.status === 'pending' && String(row.created_at).slice(0, 10) === todayStr_()) return { ok: true, message: '確認信今天已寄出，請到信箱點確認連結（也請看看垃圾郵件匣）。' };
  var props = PropertiesService.getScriptProperties(), n = Number(getProp_(subCountKey_(), 0));
  if (n >= SUB_DAILY_CAP || MailApp.getRemainingDailyQuota() < 10) return { ok: false, message: '今天的訂閱名額已滿，請明天再試。' };
  var token = subToken_();
  upsertObjects_('subscribers', 'email', [{ email: email, status: 'pending', token: token, created_at: nowIso_(), confirmed_at: '', unsubscribed_at: '' }]);
  props.setProperty(subCountKey_(), String(n + 1));
  MailApp.sendEmail(email, '[' + PRODUCT + '] 請確認訂閱每週摘要',
    '您好，\n\n有人（應該是您）在' + PRODUCT + '輸入了這個 Email，要訂閱每週摘要（每週一寄出：Tier 1 帳戶、分數變化、近 7 天觸發事件）。\n\n' +
    '請點下面連結確認訂閱：\n' + WEBAPP_URL + '?action=confirm&token=' + token + '\n\n如果不是您本人操作，忽略這封信即可，不會收到任何摘要。\n\n— ' + PRODUCT);
  return { ok: true, message: '已寄出確認信，請到信箱點確認連結（也請看看垃圾郵件匣）。' };
}

/** GET ?action=confirm|unsubscribe&token=…：回傳簡單的 HTML 頁面。 */
function subPage_(action, token) {
  ensureInsightSheets_();
  var row = token ? readTable_('subscribers').filter(function (r) { return String(r.token) === String(token); })[0] : null;
  var msg;
  if (!row) msg = '連結無效或已過期。';
  else if (action === 'confirm') {
    row.status = 'active'; row.confirmed_at = nowIso_(); row.unsubscribed_at = '';
    upsertObjects_('subscribers', 'email', [row]);
    msg = '訂閱成功！之後每週一會收到每週摘要。每封信底部都有取消訂閱連結。';
  } else {
    row.status = 'unsubscribed'; row.unsubscribed_at = nowIso_();
    upsertObjects_('subscribers', 'email', [row]);
    msg = '已取消訂閱，不會再收到每週摘要。';
  }
  return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width,initial-scale=1"><div style="font-family:system-ui,-apple-system,\'Noto Sans TC\',sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;line-height:1.8">' +
    '<h2 style="margin:0 0 8px">' + PRODUCT + '</h2><p>' + msg + '</p><p><a href="' + SITE_URL + '">回到網站</a></p></div>').setTitle(PRODUCT);
}

/** 寄給已確認的訂閱者（公開版：不含資料源與錯誤摘要），每人各一封、附取消連結。回傳寄出數。 */
function sendDigestToSubscribers_(runId, d) {
  var list = [];
  try { list = readTable_('subscribers').filter(function (r) { return r.status === 'active'; }); } catch (e) { return 0; }
  var sent = 0;
  list.forEach(function (r) {
    if (MailApp.getRemainingDailyQuota() < 5) return;
    var key = runId + ':digest_sub:' + md5_(String(r.email)).slice(0, 12);
    if (readColumn_('mail_log', 'mail_key').indexOf(key) >= 0) return;
    var text = digestText_(d, { publicVersion: true }) + '\n\n取消訂閱：' + WEBAPP_URL + '?action=unsubscribe&token=' + r.token;
    MailApp.sendEmail(String(r.email), '[' + PRODUCT + '] 每週摘要 ' + runId, text);
    appendObjects_('mail_log', [{ mail_key: key, sent_at: nowIso_() }]);
    sent++;
  });
  return sent;
}
