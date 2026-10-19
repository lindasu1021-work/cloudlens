/**
 * Copilot（Phase 4，02 檔）：只針對單一公司，以訊號 [S#] 為依據產生業務內容。
 *
 * 模式：
 *   展示模式（預設、公開）：只讀 ai_cache（每週排程替 Tier 1 預先生成），不耗額度
 *   即時模式：前端送出正確通行碼（Script Property LIVE_PASSCODE）才現場呼叫 Gemini；自由提問僅限即時模式
 * 快取 key：代號｜按鈕｜語言｜資料版本。資料版本＝本次上下文內容的雜湊（D30）：
 *   上下文沒變就沿用上週結果，省下每週重複生成的額度；內容一變就重算。
 * JSON 按鈕：schema 驗證 → 失敗附錯誤重試最多 2 次 → 仍失敗回傳錯誤並記 ai_log。
 */

var BUTTONS = {
  overview: { name: '帳戶速覽', json: false },
  cio: { name: '破冰信 CIO', json: true },
  cfo: { name: '破冰信 CFO', json: true },
  objections: { name: '預想異議', json: true },
  meddpicc: { name: 'MEDDPICC 初稿', json: true },
  free: { name: '自由提問', json: false, liveOnly: true }
};
var PRECOMPUTE_BUTTONS = ['overview', 'cio', 'cfo', 'objections', 'meddpicc'];

var DEFAULT_PLAY_AWS = [
  ['Migration', 'AWS 遷移加速計畫（MAP）、AWS Application Migration Service、AWS 亞太（台北）區域（資料落地）',
   '先用 MAP 的評估階段盤點地端系統與總持有成本，再以 Application Migration Service 低停機搬遷；台北區域滿足資料留在台灣的要求'],
  ['Data', 'Amazon S3 資料湖、AWS Glue、Amazon Redshift、Amazon Quick Sight（原 QuickSight）',
   '把分散在 ERP、MES、核心系統的資料集中到 S3 資料湖，用 Glue 整合、Redshift 分析、Quick Sight 提供儀表板'],
  ['GenAI', 'Amazon Bedrock、Amazon Quick（Amazon Q Business 已停止接受新客戶）',
   '以 Bedrock 在受控環境使用多家基礎模型，資料不離開帳戶；從客服、知識查詢等低風險場景開始'],
  ['Security', 'Amazon GuardDuty、AWS Security Hub、AWS Backup、AWS Elastic Disaster Recovery',
   '先建立威脅偵測與集中合規檢視，再以備份與災難復原滿足營運持續與主管機關要求']
];

function seedPlayAws_() {
  if (readColumn_('config_play_aws', 'play').length) return;
  appendObjects_('config_play_aws', DEFAULT_PLAY_AWS.map(function (r) { return { play: r[0], aws_offering: r[1], talking_point: r[2] }; }));
}

// ---------- 上下文 ----------

/** 與前端 js/api.js 相同的 [S#] 編號：訊號依日期新到舊，同一份文件（來源＋標題＋日期）共用一個編號。 */
function companyDocs_(code, signals) {
  var list = signals.filter(function (s) { return String(s.stock_code) === code; })
    .sort(function (a, b) { return String(b.observed_at).localeCompare(String(a.observed_at)); });
  var docs = [], byKey = {};
  list.forEach(function (s) {
    var key = s.source + '|' + s.title + '|' + s.observed_at;
    if (!byKey[key]) {
      byKey[key] = { ref: 'S' + (docs.length + 1), date: String(s.observed_at).slice(0, 10), source: s.source, title: String(s.title),
                     url: s.source === 'news' ? s.evidence_url : '', kinds: [], weight: 0 };
      docs.push(byKey[key]);
    }
    var d = byKey[key];
    d.kinds.push(s.signal_type + ':' + s.category);
    d.weight = Math.max(d.weight, { T1: 5, N4: 5, VENDOR: 4, T3: 3, T2: 3, N3: 2, PLAY: 1 }[s.signal_type] || 1);
  });
  return docs;
}

function buildContext_(code) {
  var runId = String(setting_('current_run_id', ''));
  var c = readTable_('companies').filter(function (x) { return String(x.stock_code) === code; })[0];
  if (!c) throw new Error('查無公司 ' + code);
  var s = readTable_('scores').filter(function (r) { return String(r.stock_code) === code && String(r.run_id) === runId; })[0];
  if (!s) throw new Error('此公司不在帳戶池或尚未計分');
  var docs = companyDocs_(code, readTable_('signals'));
  // Top 10：先保證每種訊號類型至少一則（避免 10 則都是同類重訊、漏掉營收或策略訊號），同一類型最多 5 則，其餘依重要性與日期補滿
  var ranked = docs.slice().sort(function (a, b) { return b.weight - a.weight || b.date.localeCompare(a.date); });
  var typeOf = function (d) { return d.kinds[0].split(':')[0]; };
  var picked = [], perType = {};
  ranked.forEach(function (d) { if (!perType[typeOf(d)]) { picked.push(d); perType[typeOf(d)] = 1; } });
  ranked.forEach(function (d) {
    if (picked.length >= 10 || picked.indexOf(d) >= 0 || perType[typeOf(d)] >= 5) return;
    picked.push(d); perType[typeOf(d)]++;
  });
  var top = picked.slice(0, 10)
    .sort(function (a, b) { return Number(a.ref.slice(1)) - Number(b.ref.slice(1)); })
    .map(function (d) { return { ref: d.ref, date: d.date, source: d.source, title: d.title, kinds: d.kinds, url: d.url }; });
  var rev = readTable_('raw_revenue').filter(function (r) { return String(r.stock_code) === code; })
    .sort(function (a, b) { return String(a.year_month).localeCompare(String(b.year_month)); }).slice(-12);
  var annual = rev.length ? rev.reduce(function (t, r) { return t + Number(r.revenue); }, 0) / rev.length * 12 : null;
  var plays = {};
  readTable_('config_play_aws').forEach(function (p) { plays[p.play] = { aws_offering: p.aws_offering, talking_point: p.talking_point }; });
  var fin = String(c.industry_code) === '17';
  var dash = function (v, why) { return v === '' ? why : v; };
  var NOJOB = '無資料（公開職缺資料不足，此項停用）';
  return {
    company: { code: code, name: c.name_short, full_name: c.name_full, industry: c.industry_name, market: c.market,
               capital_100m_twd: Math.round(Number(c.capital) / 1e8),
               annual_revenue_100m_twd: annual === null ? '無資料' : Math.round(annual / 1e5) },
    scores: { need: s.need, timing: s.timing, tier: String(s.tier), data_completeness: s.data_completeness,
              N1_scale: dash(s.n1, '無資料'), N2_hiring: dash(s.n2, NOJOB), N3_strategy: dash(s.n3, '無資料'), N4_security_compliance: dash(s.n4, '無資料'),
              T1_trigger: dash(s.t1, '無資料'), T2_news_momentum: dash(s.t2, '無資料'),
              T3_revenue_momentum: dash(s.t3, fin ? '不適用（金融業營收受投資收益波動，不納入計分）' : '無資料'), T4_hiring_acceleration: dash(s.t4, NOJOB) },
    play_primary: s.play_primary, play_secondary: s.play_secondary || '無',
    cloud_status: { aws: '已是 AWS 客戶（擴充）', competitor: '使用競品雲（替換）', unknown: '未知（新導入）' }[s.cloud_status],
    signals: top,
    play_to_aws: plays
    // 不放 run_id：快取 key 以上下文雜湊為資料版本，內容沒變就沿用（D30）
  };
}

// ---------- 提示詞 ----------

var SYSTEM_PROMPT = [
  '你是 AWS 台灣企業業務（AE），專門開發尚未大量上雲的大型企業（Greenfield）。',
  '只根據使用者提供的「上下文」回答；上下文以外的事一律回答「目前資料中沒有」，不得推測、不得編造任何數字、日期、專案名稱或客戶名稱。',
  '每個論點都要標註依據的訊號編號，每個編號各自用方括號，例如 [S2][S3]（不要寫成 [S2, S3]）；只能使用上下文 signals 中出現的編號。',
  '[S#] 只用來引用 signals 裡的訊號。公司基本資料（資本額、營收規模）與分數不是訊號，引用時標註「（公司資料）」，不要配 [S#]。',
  '分數欄位寫「不適用」或「無資料」的項目，照實說明原因，不要當成缺點或推測。',
  '若 play_primary 為「訊號不足」，代表目前沒有足夠訊號判斷切入方向：不要硬挑 Play，說明「目前資料中沒有足夠訊號」，並建議業務先做哪些驗證。',
  '不得出現任何個人姓名；收件對象只用職稱（例：資訊長、財務長）。',
  'AWS 服務只能從上下文 play_to_aws 中挑選。語氣專業、具體、精簡，避免行銷空話。',
  '預設使用繁體中文（台灣用語）。'
].join('\n');

var TASKS = {
  overview: '請產出「帳戶速覽」，Markdown 格式，總長 350 字以內，固定四個段落標題：\n' +
    '## 為什麼是這家\n## 為什麼是現在\n## 建議切入（Play 與 AWS 方案）\n## 目前資料中沒有（需要驗證）\n' +
    '前三段每個項目結尾標註 [S#]；第四段列出上下文缺少、但業務需要確認的事。',
  cio: '請寫一封給「資訊長」的破冰信。以技術痛點與觸發事件切入，提出一個具體的 AWS 方案，最後邀約 30 分鐘交流。\n' +
    '內文 200 字以內，稱謂用「資訊長您好」，不要署名。只輸出 JSON：{"subject": 字串, "body": 字串, "signals_used": ["S1", ...]}。',
  cfo: '請寫一封給「財務長」的破冰信。從成本、營運韌性或法規遵循切入；若上下文顯示營收衰退（T3），改走降低成本的話術。\n' +
    '內文 200 字以內，稱謂用「財務長您好」，不要署名。只輸出 JSON：{"subject": 字串, "body": 字串, "signals_used": ["S1", ...]}。',
  objections: '請預想這家公司最可能提出的 3 到 5 個異議（例：資料落地、已用其他雲、預算凍結、資安疑慮、內部人力不足），並各給一段回應。\n' +
    '只輸出 JSON 陣列：[{"objection": 字串, "response": 字串, "signals_used": ["S1", ...]}]。沒有直接依據的回應 signals_used 給空陣列。',
  meddpicc: '請產出 MEDDPICC 初稿。8 個欄位：M（Metrics 量化效益）、E（Economic Buyer 經濟決策者，只寫職稱）、D1（Decision Criteria）、' +
    'D2（Decision Process）、P（Paper Process）、I（Identify Pain）、C1（Champion，只寫職稱）、C2（Competition）。\n' +
    '能從上下文推論的填 content 並標 status「已知」；推不出來的 status 標「待驗證」，content 寫目前的假設，questions 列出 1–3 個驗證問題。\n' +
    '只輸出 JSON：{"M": {"content": 字串, "status": "已知"|"待驗證", "questions": [字串]}, "E": {...}, "D1": {...}, "D2": {...}, "P": {...}, "I": {...}, "C1": {...}, "C2": {...}}。'
};

// ---------- 驗證 ----------

function validateOutput_(button, out, ctx) {
  var refs = {};
  ctx.signals.forEach(function (s) { refs[s.ref] = true; });
  // 只認方括號格式 [S3]，避免「Amazon S3」被當成訊號編號
  var norm = function (r) { return String(r).replace(/[\[\]\s]/g, ''); };
  var badRefs = function (arr) { return (arr || []).map(norm).filter(function (r) { return !refs[r]; }); };
  var textRefs = function (t) { return (String(t).match(/\[S\d+\]/g) || []).map(norm).filter(function (r) { return !refs[r]; }); };
  var flat = typeof out === 'string' ? out : JSON.stringify(out || '');
  if (/\[S\d+\s*[,，、]/.test(flat)) return '多個訊號編號請各自加方括號，例如 [S2][S3]，不要寫成 [S2, S3]';
  if (button === 'overview' || button === 'free') {
    if (typeof out !== 'string' || out.length < 30) return '輸出太短或不是文字';
    var br = textRefs(out);
    if (br.length) return '引用了上下文沒有的訊號編號：' + br.join(',');
    if (button === 'overview' && (out.match(/^##\s/gm) || []).length < 4) return '缺少四個固定段落標題（## ）';
    return '';
  }
  if (button === 'cio' || button === 'cfo') {
    if (!out || typeof out.subject !== 'string' || typeof out.body !== 'string' || !Array.isArray(out.signals_used)) return '缺少 subject、body 或 signals_used';
    if (out.body.replace(/\s/g, '').length > 230) return 'body 超過 200 字（目前 ' + out.body.replace(/\s/g, '').length + ' 字），請縮短';
    var b = badRefs(out.signals_used).concat(textRefs(out.body));
    return b.length ? '引用了上下文沒有的訊號編號：' + b.join(',') : '';
  }
  if (button === 'objections') {
    if (!Array.isArray(out) || out.length < 3 || out.length > 5) return '需要 3 到 5 個異議的陣列';
    for (var i = 0; i < out.length; i++) {
      var o = out[i];
      if (!o || typeof o.objection !== 'string' || typeof o.response !== 'string' || !Array.isArray(o.signals_used)) return '第 ' + (i + 1) + ' 項缺少 objection、response 或 signals_used';
      var bo = badRefs(o.signals_used);
      if (bo.length) return '第 ' + (i + 1) + ' 項引用了不存在的訊號：' + bo.join(',');
    }
    return '';
  }
  if (button === 'meddpicc') {
    var keys = ['M', 'E', 'D1', 'D2', 'P', 'I', 'C1', 'C2'];
    for (var k = 0; k < keys.length; k++) {
      var f = out && out[keys[k]];
      if (!f || typeof f.content !== 'string' || ['已知', '待驗證'].indexOf(f.status) < 0 || !Array.isArray(f.questions)) return '欄位 ' + keys[k] + ' 缺少 content、status（已知／待驗證）或 questions';
      if (f.status === '待驗證' && !f.questions.length) return '欄位 ' + keys[k] + ' 標為待驗證但沒有驗證問題';
    }
    return '';
  }
  return '未知按鈕';
}

// ---------- Gemini ----------

// 免費層每分鐘約 5 次請求：以「上次呼叫時間」計算等待（跨執行以 Script Property 記錄），每次至少間隔 13 秒（≈4.6 次／分）
var GEMINI_MIN_INTERVAL_MS = 13000;
var GEMINI_503_WAIT_MS = 30000;          // 模型忙碌（5xx）時等 30 秒再試 1 次，仍失敗就換下一個模型
var GEMINI_MAX_MINUTE_WAIT_MS = 60000;   // 每分鐘上限（429 PerMinute）：照回應建議秒數等待，最多 60 秒
var GEMINI_LAST_CALL_KEY = 'GEMINI_LAST_CALL_MS';
var GEMINI_DAILY_OFF_KEY = 'GEMINI_DAILY_OFF'; // { date: 'yyyyMMdd', models: [...] }：已用完每日額度的模型，當日停用
var geminiLastCallMem_ = 0;

function geminiModels_() {
  return String(setting_('gemini_model', 'gemini-flash-latest')).split(',').map(function (m) { return m.trim(); }).filter(String);
}

/** 等到距離上次 Gemini 呼叫滿 GEMINI_MIN_INTERVAL_MS，再記下這次呼叫時間。 */
function geminiThrottle_() {
  var last = Math.max(geminiLastCallMem_, Number(getProp_(GEMINI_LAST_CALL_KEY, 0)));
  var wait = last + GEMINI_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) Utilities.sleep(Math.min(wait, GEMINI_MIN_INTERVAL_MS));
  geminiLastCallMem_ = Date.now();
  PropertiesService.getScriptProperties().setProperty(GEMINI_LAST_CALL_KEY, String(geminiLastCallMem_));
}

function geminiDailyOff_() {
  var o = null;
  try { o = JSON.parse(getProp_(GEMINI_DAILY_OFF_KEY, 'null')); } catch (e) {}
  return o && o.date === Utilities.formatDate(new Date(), TZ, 'yyyyMMdd') ? (o.models || []) : [];
}

function geminiDisableToday_(model) {
  var off = geminiDailyOff_();
  if (off.indexOf(model) < 0) off.push(model);
  PropertiesService.getScriptProperties().setProperty(GEMINI_DAILY_OFF_KEY, JSON.stringify({ date: Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'), models: off }));
}

/** 解析 Gemini 錯誤回應：訊息、額度類型（quotaId）、建議等待秒數。 */
function parseGeminiError_(text) {
  var o = { message: '', quotaIds: [], retrySec: 0 };
  try {
    var e = JSON.parse(text).error || {};
    o.message = String(e.message || '').split('\n')[0].slice(0, 120);
    (e.details || []).forEach(function (d) {
      (d.violations || []).forEach(function (v) { if (v.quotaId) o.quotaIds.push(v.quotaId); });
      if (d.retryDelay) { var m = /([\d.]+)s/.exec(String(d.retryDelay)); if (m) o.retrySec = Math.ceil(Number(m[1])); }
    });
  } catch (x) { o.message = String(text).slice(0, 160); }
  return o;
}

/**
 * 對單一模型發出請求（每次請求前先節流）。回傳 { ok, result?, fatal? }；失敗原因寫進 trail（模型名稱＋HTTP 狀態＋quotaId）。
 * patient=true（排程預生成）才會做 30 秒／最長 60 秒的等待；即時模式（使用者在等）不等待，直接換下一個模型。
 */
function geminiTryModel_(model, body, key, patient, trail) {
  var minuteRetried = false, retried5xx = false;
  for (var n = 0; n < 4; n++) {
    geminiThrottle_();
    var res;
    try {
      var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
        method: 'post', contentType: 'application/json', payload: JSON.stringify(body), headers: { 'x-goog-api-key': key }, muteHttpExceptions: true });
      res = { code: r.getResponseCode(), text: r.getContentText() };
    } catch (e) { res = { code: 0, text: String(e) }; }
    if (res.code === 200) {
      var j = JSON.parse(res.text);
      var text = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(function (p) { return p.text || ''; }).join('');
      if (!text) { trail.push(model + ' 回傳空白（' + (((j.candidates || [])[0] || {}).finishReason || '無原因') + '）'); return { ok: false }; }
      return { ok: true, result: { text: text, tokens: (j.usageMetadata || {}).totalTokenCount || 0, model: model } };
    }
    var pe = parseGeminiError_(res.text);
    trail.push(model + ' HTTP ' + (res.code || '網路錯誤') + (pe.quotaIds.length ? '｜quotaId：' + pe.quotaIds.join(',') : '') +
               (pe.message ? '｜' + pe.message : '') + (pe.retrySec ? '｜建議等待 ' + pe.retrySec + 's' : ''));
    if (res.code === 429) {
      if (pe.quotaIds.some(function (q) { return /PerDay/i.test(q); })) { geminiDisableToday_(model); return { ok: false }; } // 每日上限：該模型當日停用
      if (patient && !minuteRetried) { // 每分鐘上限：等回應建議的秒數後繼續，不暫停整個排程
        minuteRetried = true;
        Utilities.sleep(Math.min(Math.max(pe.retrySec * 1000, GEMINI_MIN_INTERVAL_MS), GEMINI_MAX_MINUTE_WAIT_MS));
        continue;
      }
      return { ok: false };
    }
    if (res.code === 0 || res.code >= 500) {
      if (patient && !retried5xx) { retried5xx = true; Utilities.sleep(GEMINI_503_WAIT_MS); continue; }
      return { ok: false };
    }
    if (res.code === 404) return { ok: false };
    return { ok: false, fatal: true }; // 其他 4xx（請求內容或金鑰問題）換模型也不會好
  }
  return { ok: false };
}

/** 呼叫 Gemini，依序嘗試候選模型。回傳 { text, tokens, model, trail }；全部失敗丟例外（err.trail 為各模型各自的錯誤）。 */
function geminiCall_(contents, json, patient) {
  var key = getProp_('GEMINI_API_KEY', '');
  if (!key) throw new Error('未設定 GEMINI_API_KEY');
  var body = { systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents: contents,
               generationConfig: { temperature: 0.4, responseMimeType: json ? 'application/json' : 'text/plain' } };
  var models = geminiModels_(), off = geminiDailyOff_(), trail = [], usable = 0;
  for (var i = 0; i < models.length; i++) {
    if (off.indexOf(models[i]) >= 0) { trail.push(models[i] + ' 今日已用完每日額度，略過'); continue; }
    usable++;
    var o = geminiTryModel_(models[i], body, key, !!patient, trail);
    if (o.ok) { o.result.trail = trail; return o.result; }
    if (o.fatal) break;
  }
  var err = new Error(trail.join('；') || '沒有可用的 Gemini 模型');
  err.trail = trail;
  err.quotaDaily = usable === 0 || geminiModels_().every(function (m) { return geminiDailyOff_().indexOf(m) >= 0; });
  err.quota = err.quotaDaily || /HTTP 429/.test(err.message);
  throw err;
}

/** 手動執行：列出這把金鑰可用、支援 generateContent 的模型（不顯示金鑰），用來挑選不同額度桶的備援模型。 */
function listGeminiModels() {
  var key = getProp_('GEMINI_API_KEY', '');
  if (!key) throw new Error('未設定 GEMINI_API_KEY');
  var out = [], token = '';
  do {
    var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100' + (token ? '&pageToken=' + encodeURIComponent(token) : ''),
      { headers: { 'x-goog-api-key': key }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('ListModels HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
    var j = JSON.parse(res.getContentText());
    (j.models || []).forEach(function (m) {
      if ((m.supportedGenerationMethods || []).indexOf('generateContent') >= 0)
        out.push(String(m.name).replace(/^models\//, '') + '｜' + (m.displayName || '') + '｜輸入上限 ' + (m.inputTokenLimit || '?') + '｜' + String(m.description || '').slice(0, 70));
    });
    token = j.nextPageToken || '';
  } while (token);
  out.forEach(function (l) { Logger.log(l); });
  return out;
}

var QUOTA_PAUSE_KEY = 'COPILOT_QUOTA_PAUSE_UNTIL';
function quotaPaused_() { return Date.now() < Number(getProp_(QUOTA_PAUSE_KEY, 0)); }
/** 所有模型當日額度都用完才暫停，暫停到台灣時間隔天 00:00（不再固定 1 小時）。 */
function pauseForQuota_() {
  var t = new Date(); t.setHours(24, 0, 0, 0);
  PropertiesService.getScriptProperties().setProperty(QUOTA_PAUSE_KEY, String(t.getTime()));
}

/** 產生一個按鈕的內容（含 schema 驗證與最多 2 次修正重試）。 */
function generate_(button, ctx, lang, question, zhSource, patient) {
  var cfg = BUTTONS[button];
  var prompt;
  if (lang === 'en') {
    prompt = 'Translate the following JSON cold email from Traditional Chinese into professional business English. ' +
      'Keep the same JSON keys and keep signals_used and every [S#] marker unchanged. Body within 150 words. Output JSON only.\n\n' + JSON.stringify(zhSource);
  } else if (button === 'free') {
    prompt = '請回答業務的問題，Markdown 格式，300 字以內，每個論點標註 [S#]；上下文沒有的回答「目前資料中沒有」。\n問題：' + question;
  } else {
    prompt = TASKS[button];
  }
  var contents = [{ role: 'user', parts: [{ text: '上下文（JSON）：\n' + JSON.stringify(ctx) + '\n\n任務：\n' + prompt }] }];
  var tokens = 0, lastErr = '', raw = '', trail = [];
  for (var attempt = 0; attempt < 3; attempt++) { // 第 1 次＋最多 2 次修正重試
    var r;
    try { r = geminiCall_(contents, cfg.json, patient); }
    catch (ge) { ge.trail = trail.concat(ge.trail || []); ge.tokens = tokens; throw ge; }
    tokens += r.tokens;
    trail = trail.concat(r.trail || []);
    raw = r.text;
    var out = raw, err = '';
    if (cfg.json) {
      try { out = JSON.parse(raw.replace(/^```(json)?\s*|\s*```$/g, '')); }
      catch (e) { err = 'JSON 解析失敗：' + e; }
    }
    if (!err) err = validateOutput_(button, out, ctx);
    if (!err) return { output: out, tokens: tokens, model: r.model, attempts: attempt + 1, trail: trail };
    lastErr = err;
    contents.push({ role: 'model', parts: [{ text: raw }] });
    contents.push({ role: 'user', parts: [{ text: '上一個輸出不符合規格：' + err + '。請修正後重新輸出完整結果。' }] });
  }
  var err = new Error('輸出驗證失敗（已重試 2 次）：' + lastErr);
  err.raw = raw;
  err.tokens = tokens;
  err.trail = trail;
  throw err;
}

// ---------- 快取、額度、紀錄 ----------

function cacheKey_(code, button, lang, ctx) {
  return [code, button, lang, md5_(JSON.stringify(ctx)).slice(0, 12)].join('|');
}

function cacheGet_(key) {
  var row = readTable_('ai_cache').filter(function (r) { return r.cache_key === key; })[0];
  return row ? { output: JSON.parse(row.output_json), created_at: String(row.created_at), mode: row.mode } : null;
}

/** 同一公司＋按鈕＋語言的最新快取（資料版本不同也可，用於額度用完時降級顯示）。 */
function cacheLatest_(code, button, lang) {
  var prefix = [code, button, lang].join('|') + '|';
  var rows = readTable_('ai_cache').filter(function (r) { return String(r.cache_key).indexOf(prefix) === 0; })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  return rows[0] ? { output: JSON.parse(rows[0].output_json), created_at: String(rows[0].created_at), mode: rows[0].mode } : null;
}

function cachePut_(key, output, mode) {
  upsertObjects_('ai_cache', 'cache_key', [{ cache_key: key, output_json: JSON.stringify(output), created_at: nowIso_(), mode: mode }]);
}

function aiLog_(code, action, mode, success, error, tokens) {
  appendObjects_('ai_log', [{ ts: nowIso_(), stock_code: code, action: action, mode: mode, success: success,
                              error: String(error || '').slice(0, 1000), est_tokens: tokens || 0 }]);
}

function quotaKey_() { return 'AI_COUNT_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'); }
function quotaUsed_() { return Number(getProp_(quotaKey_(), 0)); }
function quotaUse_() { PropertiesService.getScriptProperties().setProperty(quotaKey_(), String(quotaUsed_() + 1)); }

// ---------- API ----------

/**
 * POST {action:"copilot", code, button, lang, passcode?, question?}
 * 回傳 { button, lang, mode: demo|live, cached, created_at, output, notice? }
 */
function apiCopilot_(body) {
  var code = String(body.code || ''), button = String(body.button || ''), lang = body.lang === 'en' ? 'en' : 'zh';
  if (!BUTTONS[button]) throw new Error('未知按鈕：' + button);
  if (lang === 'en' && button !== 'cio' && button !== 'cfo') throw new Error('英文版只提供破冰信');
  var passcode = getProp_('LIVE_PASSCODE', '');
  var live = !!passcode && String(body.passcode || '') === passcode;
  if (body.passcode && !live) return { button: button, lang: lang, mode: 'demo', cached: false, output: null, notice: '通行碼不正確，維持展示模式。' };
  if (BUTTONS[button].liveOnly && !live) return { button: button, lang: lang, mode: 'demo', cached: false, output: null, notice: '自由提問僅限即時模式，請輸入通行碼。' };

  seedPlayAws_();
  var ctx = buildContext_(code);
  var key = cacheKey_(code, button, lang, ctx);
  if (button !== 'free') {
    var hit = cacheGet_(key);
    if (hit) return { button: button, lang: lang, mode: live ? 'live' : 'demo', cached: true, created_at: hit.created_at, output: hit.output, refs: ctx.signals };
  }
  if (!live) {
    var old = button === 'free' ? null : cacheLatest_(code, button, lang);
    if (old) return { button: button, lang: lang, mode: 'demo', cached: true, stale: true, created_at: old.created_at, output: old.output, refs: ctx.signals,
                      notice: '顯示先前產生的版本（資料已更新，尚未重新生成）。' };
    return { button: button, lang: lang, mode: 'demo', cached: false, output: null,
             notice: '展示模式只提供 Tier 1 公司的預先生成內容；輸入通行碼可即時產生。' };
  }
  var limit = Number(setting_('daily_ai_limit', 30));
  if (quotaUsed_() >= limit) {
    var fallback = button === 'free' ? null : cacheLatest_(code, button, lang);
    return { button: button, lang: lang, mode: 'live', cached: !!fallback, output: fallback ? fallback.output : null,
             created_at: fallback ? fallback.created_at : '', refs: ctx.signals,
             notice: '今日即時產生額度（' + limit + ' 次）已用完，台灣時間午夜重置。' + (fallback ? '以下為先前產生的版本。' : '') };
  }
  var zh = null;
  if (lang === 'en') {
    var zhKey = cacheKey_(code, button, 'zh', ctx);
    var zhHit = cacheGet_(zhKey);
    if (zhHit) zh = zhHit.output;
    else {
      quotaUse_();
      var gz = generate_(button, ctx, 'zh');
      cachePut_(zhKey, gz.output, 'live');
      aiLog_(code, button + ':zh', 'live', true, '', gz.tokens);
      zh = gz.output;
    }
  }
  quotaUse_();
  try {
    var g = generate_(button, ctx, lang, String(body.question || '').slice(0, 300), zh);
    if (button !== 'free') cachePut_(key, g.output, 'live');
    aiLog_(code, button + ':' + lang, 'live', true, g.attempts > 1 ? '重試 ' + (g.attempts - 1) + ' 次後通過' : '', g.tokens);
    return { button: button, lang: lang, mode: 'live', cached: false, created_at: nowIso_(), output: g.output, refs: ctx.signals };
  } catch (e) {
    aiLog_(code, button + ':' + lang, 'live', false, String(e.message) + (e.raw ? '｜原始輸出：' + String(e.raw).slice(0, 600) : ''), e.tokens);
    var fb = button === 'free' ? null : cacheLatest_(code, button, lang);
    return { button: button, lang: lang, mode: 'live', cached: !!fb, output: fb ? fb.output : null, created_at: fb ? fb.created_at : '', refs: ctx.signals,
             notice: (e.quota ? 'Gemini 免費額度暫時用完。' : 'AI 產生失敗：' + e.message) + (fb ? '以下為先前產生的版本。' : '') };
  }
}

// ---------- 每週預生成（展示模式） ----------

// 每個步驟 1 家公司（5 個按鈕 ≈ 5 次呼叫 × 13 秒），避免撞到 6 分鐘上限
var PRECOMPUTE_BATCH = 1;
var PRECOMPUTE_COUNT_KEY = 'PRECOMPUTE_COUNT';   // { date: 'yyyyMMdd', n }：今日預生成已發出的按鈕生成次數
var PRECOMPUTE_FAIL_KEY = 'PRECOMPUTE_FAILS';    // { 代號: ['yyyyMMdd', ...] }：非額度原因的失敗日期

function copilotTasks_() {
  var n = Number(setting_('copilot_precompute_max', 40));
  var tasks = [];
  for (var i = 0; i < n; i += PRECOMPUTE_BATCH) tasks.push('copilot:' + i);
  return tasks;
}

function todayKey_() { return Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'); }
function dayNum_(key) { return Math.floor(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8))) / 864e5); }

function precomputeUsedToday_() {
  var o = null;
  try { o = JSON.parse(getProp_(PRECOMPUTE_COUNT_KEY, 'null')); } catch (e) {}
  return o && o.date === todayKey_() ? Number(o.n) || 0 : 0;
}
function precomputeCount_() {
  PropertiesService.getScriptProperties().setProperty(PRECOMPUTE_COUNT_KEY, JSON.stringify({ date: todayKey_(), n: precomputeUsedToday_() + 1 }));
}
function precomputeCapReached_() { return precomputeUsedToday_() >= Number(setting_('copilot_precompute_daily', 15)); }

function precomputeFails_() { try { return JSON.parse(getProp_(PRECOMPUTE_FAIL_KEY, '{}')) || {}; } catch (e) { return {}; } }
function precomputeFailNote_(code, failedNonQuota) {
  var f = precomputeFails_();
  if (failedNonQuota) {
    var list = (f[code] || []).filter(function (d) { return d !== todayKey_(); });
    list.push(todayKey_());
    f[code] = list.slice(-5);
  } else if (failedNonQuota === false) {
    delete f[code];
  }
  PropertiesService.getScriptProperties().setProperty(PRECOMPUTE_FAIL_KEY, JSON.stringify(f));
}
/** 連續 2 天（今天與昨天，或昨天與前天）都失敗的公司排到隊尾，避免每天卡在同一家。 */
function failedTwoDays_(code, fails) {
  var days = (fails[code] || []).map(dayNum_), today = dayNum_(todayKey_());
  return days.some(function (d) { return d >= today - 1 && days.indexOf(d - 1) >= 0; });
}

/** 本週 Tier 1 公司，依 Need＋Timing 排序；連續失敗 2 天的排到最後。 */
function precomputeOrder_() {
  var t1 = readTable_('scores').filter(function (r) { return String(r.run_id) === String(setting_('current_run_id', '')) && String(r.tier) === '1'; })
    .sort(function (a, b) { return (Number(b.need) + Number(b.timing)) - (Number(a.need) + Number(a.timing)); })
    .map(function (r) { return String(r.stock_code); });
  var fails = precomputeFails_();
  return t1.filter(function (c) { return !failedTwoDays_(c, fails); }).concat(t1.filter(function (c) { return failedTwoDays_(c, fails); }));
}

/**
 * 替單一公司預先生成各按鈕。回傳 { made, reused, failed[], stop }；stop='quota'（所有模型當日額度用完）、'cap'（今日預生成上限）、''。
 * ignoreCap：手動執行時不受每日預生成上限限制（仍會計入）。
 */
function precomputeCompany_(code, ignoreCap) {
  var ctx = buildContext_(code), made = 0, reused = 0, failed = [], nonQuotaFail = false;
  for (var j = 0; j < PRECOMPUTE_BUTTONS.length; j++) {
    var b = PRECOMPUTE_BUTTONS[j], key = cacheKey_(code, b, 'zh', ctx);
    if (cacheGet_(key)) { reused++; continue; }
    if (!ignoreCap && precomputeCapReached_()) return { made: made, reused: reused, failed: failed, stop: 'cap' };
    precomputeCount_();
    try {
      var g = generate_(b, ctx, 'zh', undefined, undefined, true);
      cachePut_(key, g.output, 'demo');
      aiLog_(code, b + ':zh', 'demo', true, '模型 ' + g.model + (g.attempts > 1 ? '｜重試 ' + (g.attempts - 1) + ' 次後通過' : '') + (g.trail.length ? '｜前序失敗：' + g.trail.join('；') : ''), g.tokens);
      made++;
    } catch (e) {
      aiLog_(code, b + ':zh', 'demo', false, String(e.message) + (e.raw ? '｜原始輸出：' + String(e.raw).slice(0, 600) : ''), e.tokens);
      failed.push(code + ':' + b);
      if (!e.quota) nonQuotaFail = true;
      if (e.quotaDaily) { pauseForQuota_(); precomputeFailNote_(code, nonQuotaFail ? true : null); return { made: made, reused: reused, failed: failed, stop: 'quota' }; }
    }
  }
  precomputeFailNote_(code, failed.length ? (nonQuotaFail ? true : null) : false);
  return { made: made, reused: reused, failed: failed, stop: '' };
}

/** 替本週 Tier 1 公司（依 Need＋Timing 排序）預先生成各按鈕；上下文沒變的沿用快取，不重複呼叫。 */
function precomputeCopilot_(runId, from) {
  seedPlayAws_();
  var t1 = precomputeOrder_();
  var batch = t1.slice(Number(from), Number(from) + PRECOMPUTE_BATCH);
  if (!batch.length) return { status: 'skipped', rows_in: 0, rows_out: 0, note: 'Tier 1 共 ' + t1.length + ' 家，本批無公司' };
  // 所有模型當日額度用完才會暫停到隔天；未完成的部分由之後的每日排程接著補（已生成的會沿用，不重複呼叫）
  if (quotaPaused_()) return { status: 'skipped', rows_in: 0, rows_out: 0, note: 'Gemini 額度暫停中（所有模型當日額度已用完），明天自動續跑' };
  var made = 0, reused = 0, failed = [], stop = '';
  for (var i = 0; i < batch.length && !stop; i++) {
    var r = precomputeCompany_(batch[i], false);
    made += r.made; reused += r.reused; failed = failed.concat(r.failed); stop = r.stop;
  }
  var note = batch.join(',') + '：新增 ' + made + '、沿用 ' + reused + (failed.length ? '、失敗 ' + failed.join(',') : '') +
             (stop === 'cap' ? '；已達今日預生成上限（' + setting_('copilot_precompute_daily', 15) + '），保留額度給即時模式' : '') +
             (stop === 'quota' ? '；所有模型當日額度用完，暫停到隔天' : '');
  if (stop === 'cap' && !made && !failed.length) return { status: 'skipped', rows_in: 0, rows_out: 0, note: note };
  return { status: failed.length || stop === 'quota' ? 'partial' : 'success', rows_in: batch.length * PRECOMPUTE_BUTTONS.length, rows_out: made, note: note };
}

/** 手動執行：立即替 Need＋Timing 最高、尚未生成的 3 家 Tier 1 公司預先生成（不必等排程；不受每日預生成上限限制，但會計入）。 */
function copilotPrecomputeNow() {
  var runId = String(setting_('current_run_id', ''));
  seedPlayAws_();
  var t0 = Date.now();
  runStep_(runId, 'copilot:now', function () {
    var worked = 0, made = 0, reused = 0, failed = [], stop = '', order = precomputeOrder_();
    for (var i = 0; i < order.length && worked < 3 && !stop; i++) {
      if (Date.now() - t0 > 4.2 * 60 * 1000) { stop = 'time'; break; }
      if (quotaPaused_()) { stop = 'quota'; break; }
      var r = precomputeCompany_(order[i], true);
      if (r.made + r.failed.length > 0) worked++;
      made += r.made; reused += r.reused; failed = failed.concat(r.failed); if (r.stop) stop = r.stop;
    }
    return { status: failed.length ? 'partial' : 'success', rows_in: worked * PRECOMPUTE_BUTTONS.length, rows_out: made,
             note: '手動預生成 ' + worked + ' 家：新增 ' + made + '、沿用 ' + reused + (failed.length ? '、失敗 ' + failed.join(',') : '') + (stop ? '；停止原因：' + stop : '') };
  });
  Logger.log(JSON.stringify(readTable_('run_log').filter(function (r) { return r.step === 'copilot:now'; }).pop()));
}

/**
 * 設定變更（07 F1）：排程開頭的 apply_settings 步驟會套用一次（以 SETTINGS_APPLIED 記錄已套用的版本），也可手動執行 applyPendingSettings。
 * 只改這裡列出的 config_settings 值，並補上缺少的設定 key；不動 Script Properties 的金鑰與通行碼、不動其他設定值。
 */
// ListModels（2026-10-19）確認：gemini-flash-latest 是別名，可能與主模型共用額度；改用明確型號、不同額度桶的備援
var PENDING_SETTINGS = { version: 'f1-2026-10-19', values: { gemini_model: 'gemini-3.8-flash,gemini-3.5-flash-lite,gemini-2.5-flash' } };

function applySettings_() {
  var done = getProp_('SETTINGS_APPLIED', '');
  seedConfig_('config_settings', 'key', DEFAULT_SETTINGS);
  settingsCache_ = null;
  var changed = [];
  if (Number(setting_('rule_version', 1)) < RULE_VERSION) { setSetting_('rule_version', RULE_VERSION); changed.push('rule_version=' + RULE_VERSION); }
  if (done !== PENDING_SETTINGS.version) {
    Object.keys(PENDING_SETTINGS.values).forEach(function (k) {
      if (String(setting_(k, '')) !== String(PENDING_SETTINGS.values[k])) { setSetting_(k, PENDING_SETTINGS.values[k]); changed.push(k + '=' + PENDING_SETTINGS.values[k]); }
    });
    PropertiesService.getScriptProperties().setProperty('SETTINGS_APPLIED', PENDING_SETTINGS.version);
  }
  return { status: changed.length ? 'success' : 'skipped', rows_in: 0, rows_out: changed.length,
           note: (changed.length ? '已套用：' + changed.join('、') : '無需變更') + '（設定版本 ' + PENDING_SETTINGS.version + '）' };
}

/** 手動執行：立即套用 PENDING_SETTINGS。 */
function applyPendingSettings() { Logger.log(JSON.stringify(applySettings_())); }

/** 可用模型清單（快取 6 小時），資料狀態 API 顯示用；只回傳模型名稱，不含金鑰。 */
function geminiModelsCached_() {
  var c = CacheService.getScriptCache(), hit = c.get('gemini_models');
  if (hit) return JSON.parse(hit);
  var list = [];
  try { list = listGeminiModels(); } catch (e) { return ['（ListModels 失敗：' + String(e.message).slice(0, 120) + '）']; }
  c.put('gemini_models', JSON.stringify(list), 6 * 3600);
  return list;
}
