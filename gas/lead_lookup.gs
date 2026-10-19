/**
 * Lead 速查（09 檔 v4.1 衝刺 1）：經濟部商工登記開放資料（data.gcis.nat.gov.tw）。
 * 技術驗證（2026-10-19）：公司登記類端點免授權可查；商業（行號）登記類端點要求授權 IP（回「非授權介接之IP」）。
 * 回應含負責人姓名（Responsible_Name），依 spec 不保存、不回傳。
 */

var GCIS = {
  byTaxId: 'https://data.gcis.nat.gov.tw/od/data/api/5F64D864-61CB-4D0D-8AD9-492047CC1EA6',   // 公司登記基本資料（統編）
  byName: 'https://data.gcis.nat.gov.tw/od/data/api/6BBA2268-1367-4B42-9CCA-BC17499EBE8C',    // 公司登記關鍵字查詢（名稱 like、狀態）
  items: 'https://data.gcis.nat.gov.tw/od/data/api/236EE382-4942-41A9-BD03-CA0709025E7C',     // 公司營業項目（統編）
  bizByName: 'https://data.gcis.nat.gov.tw/od/data/api/855A3C87-003A-4930-AA4B-2F4130D713DC'  // 商業登記（行號）名稱查詢：需授權 IP
};
var GCIS_PERSONAL_FIELDS = ['Responsible_Name'];

function gcisUrl_(base, filter, top) {
  return base + '?$format=json&$filter=' + encodeURIComponent(filter) + '&$skip=0&$top=' + (top || 10);
}

/** 呼叫 GCIS，回傳 { code, ms, rows, error }；移除個人姓名欄位。 */
function gcisGet_(url) {
  var t0 = Date.now(), res;
  try { res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true }); }
  catch (e) { return { code: 0, ms: Date.now() - t0, rows: [], error: String(e).slice(0, 200) }; }
  var text = res.getContentText('UTF-8'), code = res.getResponseCode(), rows = [];
  if (code === 200 && text && text.charAt(0) === '[') {
    rows = JSON.parse(text).map(function (r) { GCIS_PERSONAL_FIELDS.forEach(function (k) { delete r[k]; }); return r; });
    return { code: code, ms: Date.now() - t0, rows: rows, error: '' };
  }
  return { code: code, ms: Date.now() - t0, rows: [], error: text ? text.slice(0, 120) : '空白回應（查無資料）' };
}

/** 技術驗證：從 GAS（海外 IP）測試各端點，回傳狀態碼、耗時、欄位名稱（不含個人姓名）。 */
function apiGcisProbe_() {
  var tests = [
    { name: '公司登記（統編）', url: gcisUrl_(GCIS.byTaxId, 'Business_Accounting_NO eq 22099131', 1) },
    { name: '公司登記（名稱關鍵字）', url: gcisUrl_(GCIS.byName, 'Company_Name like 鼎泰豐 and Company_Status eq 01', 5) },
    { name: '公司營業項目（統編）', url: gcisUrl_(GCIS.items, 'Business_Accounting_NO eq 22099131', 1) },
    { name: '商業登記（行號名稱）', url: gcisUrl_(GCIS.bizByName, 'Business_Name like 鼎泰豐', 3) }
  ];
  return tests.map(function (t) {
    var r = gcisGet_(t.url);
    return { name: t.name, http: r.code, ms: r.ms, rows: r.rows.length, fields: r.rows[0] ? Object.keys(r.rows[0]) : [], error: r.error };
  });
}

// ---------- 設定（seed 到 config_routing／config_bant，可在 Sheets 修改） ----------

/** 建議分群：由上往下第一條成立者。condition 支援 capital（元）、listed（true/false），以 and 連接。 */
var DEFAULT_ROUTING = [
  ['R1', 'listed=true and capital>=10000000000', '大型企業（上市櫃）', '實收資本額 100 億以上的上市櫃公司'],
  ['R2', 'capital>=1000000000', '中大型企業', '實收資本額 10 億以上'],
  ['R3', 'capital>=100000000', '成長型企業', '實收資本額 1 億以上'],
  ['R4', 'capital>=0', '中小企業（線上／電話開發）', '其餘公司']
];
/** BANT 預審欄位；F、C 預留但預設隱藏（09 檔第 3 節）。 */
var DEFAULT_BANT = [
  ['B', '預算（Budget）', true, '依實收資本額、營收規模推估 IT 預算量級；金額一律待確認'],
  ['A', '決策者（Authority）', true, '依主要 Play 建議接觸職稱（不放人名）；新任資訊主管事件會特別標示'],
  ['N', '需求（Need）', true, '上市櫃：Need 分數與策略意圖訊號；其他：近 90 天新聞命中的策略關鍵字'],
  ['T', '時程（Timing）', true, '上市櫃：Timing 分數與近期觸發事件；其他：近 90 天新聞中的觸發事件'],
  ['F', '合適度（Fit）', false, '預留欄位'],
  ['C', '競爭（Competition）', false, '預留欄位']
];

function ensureLookupSheets_() {
  if (!ss().getSheetByName('lead_lookups') || !ss().getSheetByName('config_routing') || !ss().getSheetByName('config_bant')) setupSheets();
}

/** GET ?action=lookup_config：建議分群規則與 BANT 欄位設定（前端完整評分與輕量評估共用）。 */
function apiLookupConfig_() {
  ensureLookupSheets_();
  return {
    routing: readTable_('config_routing').map(function (r) { return { rule_id: r.rule_id, condition: String(r.condition), segment: r.segment }; }),
    bant: readTable_('config_bant').map(function (r) {
      return { key: r.field_key, label: r.label, visible: !(r.visible === false || String(r.visible).toUpperCase() === 'FALSE'), rule: r.prefill_rule };
    })
  };
}

// ---------- 速查 ----------

var LOOKUP_TTL_DAYS = 7;
var LOOKUP_VERSION = 3; // 規則改版時 +1，舊快取自動失效
var LOOKUP_NEWS_DAYS = 90;
// 輕量評估專用：股市行情類標題不算觸發事件（仍列在新聞清單）
var MARKET_NEWS_RE = /股價|股市|指數|重挫|大漲|大跌|漲停|跌停|拋售|外資|目標價|評等|成交量|台股|美股|個股|類股/;
// 營業項目代碼第一碼 → 大類（經濟部營業項目代碼表）
var ITEM_SECTOR = { A: '農林漁牧', B: '礦業及土石採取', C: '製造業', D: '水電燃氣', E: '營造及工程', F: '批發及零售', G: '運輸倉儲及通信',
                    H: '金融保險及不動產', I: '專業服務', J: '文教及休閒', Z: '其他' };

/**
 * 全體上市櫃公司索引（證交所＋櫃買主檔，全產業）：公司全名 → { code, short, market, industry }；快取 6 小時（依市場分 2 個 key）。
 * 用途：判斷是否上市櫃、取得簡稱（新聞比對用，例：台灣積體電路製造 → 台積電）、讓使用者用簡稱查詢。
 */
function listedIndex_() {
  var cache = CacheService.getScriptCache(), idx = {};
  ['twse', 'tpex'].forEach(function (src) {
    var key = 'listed_idx_' + src, hit = cache.get(key), part;
    if (hit) part = JSON.parse(hit);
    else {
      var s = COMPANY_SOURCES[src];
      part = {};
      try {
        fetchJson_(s.url).forEach(function (r) {
          part[String(r[s.full]).trim()] = [String(r[s.code]).trim(), String(r[s.short]).trim(), String(r[s.industry]).trim()];
        });
        cache.put(key, JSON.stringify(part), 6 * 3600);
      } catch (e) { part = {}; }
    }
    Object.keys(part).forEach(function (full) { idx[full] = { code: part[full][0], short: part[full][1], industry: part[full][2], market: COMPANY_SOURCES[src].market }; });
  });
  return idx;
}

function cityOf_(loc) { var m = /^(.{2}[市縣])/.exec(String(loc || '')) || /(.{2}[市縣])/.exec(String(loc || '')); return m ? m[1] : ''; }

function shortName_(full) { return String(full).replace(/股份有限公司|有限公司|有限合夥|分公司$/g, '').trim(); }
function rocYear_(s) { var y = Number(String(s || '').slice(0, 3)); return y ? y + 1911 : ''; }

function scaleLabel_(capital) {
  if (capital >= 1e10) return '大型（實收資本額 100 億以上）';
  if (capital >= 1e9) return '中大型（10–100 億）';
  if (capital >= 1e8) return '中型（1–10 億）';
  if (capital >= 1e7) return '小型（1,000 萬–1 億）';
  return '微型（1,000 萬以下）';
}

function routeSegment_(rules, ctx) {
  for (var i = 0; i < rules.length; i++) {
    var ok = String(rules[i].condition).split(/\s+and\s+/i).every(function (c) {
      var m = /^\s*(\w+)\s*(>=|<=|=|>|<)\s*(\S+)\s*$/.exec(c);
      if (!m) return false;
      var v = ctx[m[1]], t = m[3] === 'true' ? true : m[3] === 'false' ? false : Number(m[3]);
      return m[2] === '>=' ? v >= t : m[2] === '<=' ? v <= t : m[2] === '>' ? v > t : m[2] === '<' ? v < t : v === t;
    });
    if (ok) return rules[i].segment;
  }
  return '';
}

/**
 * GET ?action=lookup&q=公司名或統編
 * 回傳 { mode:'candidates', candidates[] } 或 { mode:'pool', code }（帳戶池公司，前端用完整評分）或 { mode:'lite', ... }。
 * 輕量評估結果快取 7 天（lead_lookups）。
 */
function apiLookup_(q, alias) {
  q = String(q || '').trim().replace(/\s+/g, '');
  alias = String(alias || '').trim().replace(/\s+/g, '').slice(0, 20);
  if (q.length < 2) throw new Error('請輸入至少 2 個字的公司名稱或 8 碼統一編號');
  var T0 = Date.now(), tm = {};
  ensureLookupSheets_();
  tm.sheets = Date.now() - T0;
  var isTax = /^\d{8}$/.test(q);
  // 快取
  var cutoff = Date.now() - LOOKUP_TTL_DAYS * 864e5;
  var hit = readTable_('lead_lookups').filter(function (r) {
    return (String(r.query) === q || (isTax && String(r.tax_id) === q)) && new Date(r.created_at).getTime() >= cutoff && r.result_json;
  }).pop();
  tm.cache = Date.now() - T0;
  if (hit) { var cached = JSON.parse(hit.result_json); if (cached.v === LOOKUP_VERSION) { cached.cached_at = String(hit.created_at); return cached; } }

  var rows;
  if (isTax) rows = gcisGet_(gcisUrl_(GCIS.byTaxId, 'Business_Accounting_NO eq ' + q, 1)).rows;
  else {
    // 使用者輸入上市櫃簡稱（例：台積電）時，先換成登記全名
    var listed = listedIndex_(); tm.listed = Date.now() - T0;
    var full = Object.keys(listed).filter(function (f) { return listed[f].short === q || listed[f].code === q; })[0];
    var r1 = gcisGet_(gcisUrl_(GCIS.byName, 'Company_Name like ' + (full ? shortName_(full) : q) + ' and Company_Status eq 01', 20));
    rows = r1.rows; tm.gcis = Date.now() - T0;
    if (r1.code !== 200) throw new Error('商工登記查詢失敗（HTTP ' + r1.code + '）');
    if (full) { var ex = rows.filter(function (r) { return r.Company_Name === full; }); if (ex.length) rows = ex; }
  }
  if (!rows.length) return { mode: 'notfound', query: q, note: '商工登記查無「核准設立」的公司（獨資、合夥行號的商業登記需授權介接，目前未提供）' };
  if (!isTax && rows.length > 1) {
    var exact = rows.filter(function (r) { return shortName_(r.Company_Name) === q || r.Company_Name === q; });
    if (exact.length !== 1) {
      return { mode: 'candidates', query: q, candidates: rows.slice(0, 10).map(function (r) {
        return { tax_id: r.Business_Accounting_NO, name: r.Company_Name, capital: Number(r.Paid_In_Capital_Amount) || Number(r.Capital_Stock_Amount) || 0,
                 city: cityOf_(r.Company_Location), setup_year: rocYear_(r.Company_Setup_Date) };
      }) };
    }
    rows = exact;
  }
  var co = rows[0];
  // 帳戶池公司（三產業上市櫃）→ 前端用完整評分
  var pool = readTable_('companies').filter(function (c) { return String(c.name_full) === String(co.Company_Name); })[0];
  if (pool) return { mode: 'pool', code: String(pool.stock_code), tax_id: co.Business_Accounting_NO, name: co.Company_Name };

  var result = liteAssess_(co, isTax ? alias : q, tm, T0);
  tm.total = Date.now() - T0;
  result.timing_ms = tm;
  appendObjects_('lead_lookups', [{
    lookup_id: md5_(q + '|' + Date.now()).slice(0, 12), query: q, tax_id: result.company.tax_id, company_name: result.company.name,
    capital: result.company.capital, industry: result.company.sector, listed: result.company.listed, mode: 'lite', verdict: result.verdict.label,
    created_at: nowIso_(), result_json: JSON.stringify(result)
  }]);
  return result;
}

/** 輕量評估：規模（商工登記）＋近 90 天新聞訊號（Google News，標題須含公司名稱）。 */
function liteAssess_(co, userQuery, tm, T0) {
  tm = tm || {}; T0 = T0 || Date.now();
  var taxId = String(co.Business_Accounting_NO);
  var items = gcisGet_(gcisUrl_(GCIS.items, 'Business_Accounting_NO eq ' + taxId, 1)).rows;
  tm.items = Date.now() - T0;
  var biz = ((items[0] || {}).Cmp_Business || []).slice(0, 5).map(function (b) { return { code: b.Business_Item, desc: b.Business_Item_Desc }; });
  var sector = biz.length ? (ITEM_SECTOR[String(biz[0].code).charAt(0)] || '其他') : '未提供';
  var capital = Number(co.Paid_In_Capital_Amount) || Number(co.Capital_Stock_Amount) || 0;
  var name = shortName_(co.Company_Name);
  var lst = listedIndex_()[String(co.Company_Name)] || null;
  tm.listed2 = Date.now() - T0;
  // 新聞比對用名稱：上市櫃簡稱、登記名稱（去掉公司型態）、使用者輸入的名稱
  var aliases = [lst ? lst.short : '', name, userQuery || ''].filter(function (a, i, arr) { return a && a.length >= 2 && arr.indexOf(a) === i; });

  // 新聞
  var kw = loadKeywords_();
  tm.keywords = Date.now() - T0;
  var now = new Date(), from = new Date(now - LOOKUP_NEWS_DAYS * 864e5);
  var qy = '(' + aliases.map(function (a) { return '"' + a + '"'; }).join(' OR ') + ') ' + NEWS_TOPIC + ' after:' + ymd_(from);
  var url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(qy) + '&hl=zh-TW&gl=TW&ceid=TW:zh-Hant';
  var res = fetchWithRetry_(url), news = [], newsError = '';
  tm.news = Date.now() - T0;
  if (res.code !== 200) newsError = '新聞查詢失敗（HTTP ' + (res.code || res.error) + '）';
  else res.text.split('<item>').slice(1).forEach(function (it) {
    var title = xmlText_(it, 'title'), publisher = xmlText_(it, 'source');
    if (publisher && title.slice(-(publisher.length + 3)) === ' - ' + publisher) title = title.slice(0, -(publisher.length + 3));
    if (!aliases.some(function (a) { return title.indexOf(a) >= 0; })) return;
    if (matchCat_(kw.EXCLUDE_NEWS, title, '').length) return;
    var pub = new Date(xmlText_(it, 'pubDate'));
    var ctx = matchCat_(kw.CTX, title, '').length > 0;
    var cats = ['MIG', 'DATA', 'AI', 'SEC'].filter(function (cat) {
      var m = matchCat_(kw[cat], title, '').filter(function (e) { return e.weight >= 1 || ctx; });
      return m.length && !matchCat_(kw.NEG, title, '').some(function (n) { return n.play.split(',').indexOf(cat) >= 0; });
    });
    var trig = {};
    if (!MARKET_NEWS_RE.test(title)) matchCat_(kw.TRIG, title, '').forEach(function (e) {
      if (e.trig_type === 'cio_change' && !CIO_CHANGE_RE.test(title)) return;
      trig[e.trig_type] = e.play;
    });
    news.push({ at: isNaN(pub) ? '' : Utilities.formatDate(pub, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"), title: title, publisher: publisher,
                url: xmlText_(it, 'link'), cats: cats.map(function (c) { return PLAY_OF[c]; }), triggers: Object.keys(trig) });
  });
  news.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  var age = function (n) { return (Date.now() - new Date(n.at).getTime()) / 864e5; };
  var trigNews = news.filter(function (n) { return n.triggers.length; });
  var stratNews = news.filter(function (n) { return n.cats.length; });
  var playCount = {};
  stratNews.forEach(function (n) { n.cats.forEach(function (c) { playCount[c] = (playCount[c] || 0) + 1; }); });
  var plays = Object.keys(playCount).sort(function (a, b) { return playCount[b] - playCount[a]; });

  // 結論列（輕量評估規則；方法論頁說明）
  var recentTrig = trigNews.filter(function (n) { return age(n) <= 30; });
  var verdict;
  if (recentTrig.length && capital >= 1e8) verdict = { key: 'priority', label: '優先跟進', reason: '近 30 天有觸發事件（' + (recentTrig[0].title.length > 30 ? recentTrig[0].title.slice(0, 30) + '…' : recentTrig[0].title) + '），且實收資本額達 1 億以上' };
  else if (trigNews.length || stratNews.length || capital >= 1e9) verdict = { key: 'nurture', label: '培養',
    reason: trigNews.length ? '近 90 天有觸發事件，但距今超過 30 天或規模較小' : stratNews.length ? '近 90 天新聞出現數位化／雲端相關議題，尚無明確觸發事件' : '規模大，但近 90 天新聞未出現數位化相關議題或觸發事件' };
  else verdict = { key: 'hold', label: '暫緩', reason: '近 90 天新聞未出現數位化相關議題或觸發事件，且實收資本額未達 10 億' };

  return {
    mode: 'lite', v: LOOKUP_VERSION, query: name,
    company: { tax_id: taxId, name: co.Company_Name, short: lst ? lst.short : name, status: co.Company_Status_Desc, capital: capital, scale: scaleLabel_(capital),
               sector: sector, items: biz, city: cityOf_(co.Company_Location), setup_year: rocYear_(co.Company_Setup_Date),
               listed: !!lst, market: lst ? lst.market : '', stock_code: lst ? lst.code : '', aliases: aliases,
               source_url: 'https://findbiz.nat.gov.tw/' },
    verdict: verdict, segment: routeSegment_(apiLookupConfig_().routing, { capital: capital, listed: !!lst }), plays: plays, news: news.slice(0, 8), news_total: news.length, news_error: newsError,
    events: trigNews.slice(0, 2), generated_at: nowIso_(),
    sources: ['經濟部商工登記開放資料（公司登記基本資料、營業項目）', 'Google News（近 ' + LOOKUP_NEWS_DAYS + ' 天，標題須含公司名稱）']
  };
}
