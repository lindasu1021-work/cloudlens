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
  // Top 10：觸發事件、資安、雲端現況、營收／新聞動能優先，其次依日期
  var top = docs.slice().sort(function (a, b) { return b.weight - a.weight || b.date.localeCompare(a.date); }).slice(0, 10)
    .sort(function (a, b) { return Number(a.ref.slice(1)) - Number(b.ref.slice(1)); })
    .map(function (d) { return { ref: d.ref, date: d.date, source: d.source, title: d.title, kinds: d.kinds, url: d.url }; });
  var rev = readTable_('raw_revenue').filter(function (r) { return String(r.stock_code) === code; })
    .sort(function (a, b) { return String(a.year_month).localeCompare(String(b.year_month)); }).slice(-12);
  var annual = rev.length ? rev.reduce(function (t, r) { return t + Number(r.revenue); }, 0) / rev.length * 12 : null;
  var plays = {};
  readTable_('config_play_aws').forEach(function (p) { plays[p.play] = { aws_offering: p.aws_offering, talking_point: p.talking_point }; });
  var dash = function (v) { return v === '' ? '無資料' : v; };
  return {
    company: { code: code, name: c.name_short, full_name: c.name_full, industry: c.industry_name, market: c.market,
               capital_100m_twd: Math.round(Number(c.capital) / 1e8),
               annual_revenue_100m_twd: annual === null ? '無資料' : Math.round(annual / 1e5) },
    scores: { need: s.need, timing: s.timing, tier: String(s.tier), data_completeness: s.data_completeness,
              N1_scale: dash(s.n1), N2_hiring: dash(s.n2), N3_strategy: dash(s.n3), N4_security_compliance: dash(s.n4),
              T1_trigger: dash(s.t1), T2_news_momentum: dash(s.t2), T3_revenue_momentum: dash(s.t3), T4_hiring_acceleration: dash(s.t4) },
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
  '每個論點都要標註依據的訊號編號，格式 [S1]、[S2]；只能使用上下文 signals 中出現的編號。',
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

function geminiModels_() {
  return String(setting_('gemini_model', 'gemini-flash-latest')).split(',').map(function (m) { return m.trim(); }).filter(String);
}

/** 呼叫 Gemini；模型 404／429／5xx 時改試下一個候選。回傳 { text, tokens, model }。 */
function geminiCall_(contents, json) {
  var key = getProp_('GEMINI_API_KEY', '');
  if (!key) throw new Error('未設定 GEMINI_API_KEY');
  var body = { systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents: contents,
               generationConfig: { temperature: 0.4, responseMimeType: json ? 'application/json' : 'text/plain' } };
  var lastErr = '';
  var models = geminiModels_();
  for (var i = 0; i < models.length; i++) {
    var res = fetchWithRetry_('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent', {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(body), headers: { 'x-goog-api-key': key } });
    if (res.code === 200) {
      var j = JSON.parse(res.text);
      var text = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(function (p) { return p.text || ''; }).join('');
      if (!text) { lastErr = models[i] + ' 回傳空白（' + (((j.candidates || [])[0] || {}).finishReason || '無原因') + '）'; continue; }
      return { text: text, tokens: (j.usageMetadata || {}).totalTokenCount || 0, model: models[i] };
    }
    lastErr = models[i] + ' HTTP ' + (res.code || res.error) + ' ' + String(res.text).slice(0, 160);
    if (res.code !== 404 && res.code !== 429 && res.code < 500) break;
  }
  var err = new Error(lastErr);
  err.quota = /HTTP 429/.test(lastErr);
  throw err;
}

/** 產生一個按鈕的內容（含 schema 驗證與最多 2 次修正重試）。 */
function generate_(button, ctx, lang, question, zhSource) {
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
  var tokens = 0, lastErr = '', raw = '';
  for (var attempt = 0; attempt < 3; attempt++) { // 第 1 次＋最多 2 次修正重試
    var r = geminiCall_(contents, cfg.json);
    tokens += r.tokens;
    raw = r.text;
    var out = raw, err = '';
    if (cfg.json) {
      try { out = JSON.parse(raw.replace(/^```(json)?\s*|\s*```$/g, '')); }
      catch (e) { err = 'JSON 解析失敗：' + e; }
    }
    if (!err) err = validateOutput_(button, out, ctx);
    if (!err) return { output: out, tokens: tokens, model: r.model, attempts: attempt + 1 };
    lastErr = err;
    contents.push({ role: 'model', parts: [{ text: raw }] });
    contents.push({ role: 'user', parts: [{ text: '上一個輸出不符合規格：' + err + '。請修正後重新輸出完整結果。' }] });
  }
  var err = new Error('輸出驗證失敗（已重試 2 次）：' + lastErr);
  err.raw = raw;
  err.tokens = tokens;
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

var PRECOMPUTE_BATCH = 3; // 每個步驟 3 家公司（約 15 次呼叫），避免撞到 6 分鐘上限

function copilotTasks_() {
  var n = Number(setting_('copilot_precompute_max', 40));
  var tasks = [];
  for (var i = 0; i < n; i += PRECOMPUTE_BATCH) tasks.push('copilot:' + i);
  return tasks;
}

/** 替本週 Tier 1 公司（依 Need＋Timing 排序）預先生成各按鈕；上下文沒變的沿用快取，不重複呼叫。 */
function precomputeCopilot_(runId, from) {
  seedPlayAws_();
  var t1 = readTable_('scores').filter(function (r) { return String(r.run_id) === String(setting_('current_run_id', '')) && String(r.tier) === '1'; })
    .sort(function (a, b) { return (Number(b.need) + Number(b.timing)) - (Number(a.need) + Number(a.timing)); })
    .map(function (r) { return String(r.stock_code); });
  var batch = t1.slice(Number(from), Number(from) + PRECOMPUTE_BATCH);
  if (!batch.length) return { status: 'skipped', rows_in: 0, rows_out: 0, note: 'Tier 1 共 ' + t1.length + ' 家，本批無公司' };
  var made = 0, reused = 0, failed = [];
  for (var i = 0; i < batch.length; i++) {
    var code = batch[i], ctx = buildContext_(code);
    for (var j = 0; j < PRECOMPUTE_BUTTONS.length; j++) {
      var b = PRECOMPUTE_BUTTONS[j], key = cacheKey_(code, b, 'zh', ctx);
      if (cacheGet_(key)) { reused++; continue; }
      try {
        var g = generate_(b, ctx, 'zh');
        cachePut_(key, g.output, 'demo');
        aiLog_(code, b + ':zh', 'demo', true, g.attempts > 1 ? '重試 ' + (g.attempts - 1) + ' 次後通過' : '', g.tokens);
        made++;
      } catch (e) {
        aiLog_(code, b + ':zh', 'demo', false, String(e.message) + (e.raw ? '｜原始輸出：' + String(e.raw).slice(0, 600) : ''), e.tokens);
        failed.push(code + ':' + b);
        if (e.quota) return { status: 'partial', rows_in: batch.length, rows_out: made, note: 'Gemini 額度用完，停在 ' + code + ':' + b + '；新增 ' + made + '、沿用 ' + reused };
      }
      Utilities.sleep(4000); // 免費層每分鐘請求數有限
    }
  }
  return { status: failed.length ? 'partial' : 'success', rows_in: batch.length * PRECOMPUTE_BUTTONS.length, rows_out: made,
           note: batch.join(',') + '：新增 ' + made + '、沿用 ' + reused + (failed.length ? '、失敗 ' + failed.join(',') : '') };
}

/** 手動執行：立即替 Need＋Timing 最高的 3 家 Tier 1 公司預先生成（不必等週一排程）。 */
function copilotPrecomputeNow() {
  var runId = String(setting_('current_run_id', ''));
  runStep_(runId, 'copilot:0', function () { return precomputeCopilot_(runId, 0); });
  Logger.log(JSON.stringify(readTable_('run_log').filter(function (r) { return r.step === 'copilot:0'; }).pop()));
}
