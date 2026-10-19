/**
 * 產業洞察素材包（09 檔 v4.1 第 5.4 節，衝刺 3；零售先行）。
 * 每個產業在 config_industries 設定主題關鍵字與 AWS 部落格 RSS；每兩週彙整一次（近 14 天 vs 前 14 天）存入 insight_packs。
 * 主題熱度＝近 14 天 Google News 命中則數；重點事件、AWS 切入角度、建議標題皆由規則產生（不用 AI）。
 */

var INSIGHT_WINDOW_DAYS = 14;
var INSIGHT_VERSION = 4; // 規則改版時 +1，舊素材包在下次讀取時重新產生
// 標題中的公司比對：簡稱 3 字以上直接比對；2 字簡稱只比對該產業相關的證交所產業別（避免「世界」「全台」等一般詞誤判）
var INSIGHT_COMPANY_INDUSTRIES = { retail: ['18', '16'] };
// news_keywords 格式：「_context=情境詞|…;主題名稱=關鍵字|關鍵字@AWS 切入角度;…」
var DEFAULT_INDUSTRIES = [
  ['retail', '零售（含餐飲）',
   '_context=零售|超商|便利商店|量販|百貨|電商|通路|餐飲|連鎖|超市;' +
   '全通路／OMO=全通路|OMO|虛實整合|線上線下@整合線上線下的訂單、庫存與會員資料，建立即時資料平台;' +
   '會員經濟=會員|點數|忠誠|CRM|APP@用會員資料做個人化推薦與分群行銷;' +
   '零售媒體=零售媒體|Retail Media|廣告聯播|聯播網@以第一方數據經營零售媒體，並用資料乾淨室與品牌合作;' +
   '生成式 AI=生成式AI|生成式 AI|AI客服|AI 客服|AI導購|ChatGPT|大型語言模型@用生成式 AI 產生商品文案、客服回覆與店員助理;' +
   '智慧物流=物流|倉儲|冷鏈|配送|供應鏈@需求預測與庫存最佳化，降低缺貨與報廢;' +
   '智慧商店=無人店|自助結帳|智慧商店|自助點餐|電子貨架@店內設備與影像資料的即時分析;' +
   '支付=電子支付|行動支付|支付|Pay@促銷高峰的流量彈性擴展與交易資安;' +
   '資安與個資=資安|個資|外洩|駭客|勒索@個資保護、威脅偵測與備份還原;' +
   '展店與併購=展店|併購|新店|插旗|收購|擴點@新據點快速上線的標準化 IT 環境;' +
   '永續=永續|ESG|減碳|淨零|循環@碳排與能耗資料的蒐集與報告',
   'https://aws.amazon.com/blogs/industries/category/industries/retail/feed/', true],
  ['finance', '金融保險', '', '', false],
  ['manufacturing', '製造', '', '', false]
];
var INSIGHT_EVENT_RE = /併購|收購|展店|新店|上線|導入|合作|攜手|推出|啟用|外洩|駭客|投資|轉型|擴大|首家|開幕/;

/** 關鍵字在標題中的位置；英數關鍵字須是獨立的詞（「APP」不算命中「91APP」）。 */
function kwPos_(title, k) {
  if (!/^[A-Za-z0-9 ]+$/.test(k)) return title.indexOf(k);
  var m = new RegExp('(^|[^A-Za-z0-9])' + k.replace(/ /g, '\\s*') + '(?![A-Za-z0-9])', 'i').exec(title);
  return m ? m.index + m[1].length : -1;
}

function parseIndustryKeywords_(s) {
  var ctx = [], topics = [];
  String(s || '').split(';').forEach(function (part) {
    var m = /^\s*([^=]+)=(.*)$/.exec(part);
    if (!m) return;
    if (m[1].trim() === '_context') { ctx = m[2].split('|').map(function (x) { return x.trim(); }).filter(String); return; }
    var kv = m[2].split('@');
    topics.push({ name: m[1].trim(), kws: kv[0].split('|').map(function (x) { return x.trim(); }).filter(String), angle: (kv[1] || '').trim() });
  });
  return { context: ctx, topics: topics };
}

function ensureInsightSheets_() {
  if (!ss().getSheetByName('config_industries') || !ss().getSheetByName('insight_packs') || !ss().getSheetByName('subscribers')) setupSheets();
}

function industries_() {
  ensureInsightSheets_();
  return readTable_('config_industries').filter(function (r) { return r.active === true || String(r.active).toUpperCase() === 'TRUE'; });
}

function gnewsItems_(q, from, to) {
  var url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' after:' + ymd_(from) + ' before:' + ymd_(new Date(to.getTime() + 864e5))) + '&hl=zh-TW&gl=TW&ceid=TW:zh-Hant';
  var res = fetchWithRetry_(url);
  Utilities.sleep(300);
  if (res.code !== 200) throw new Error('Google News HTTP ' + (res.code || res.error));
  return res.text.split('<item>').slice(1).map(function (it) {
    var title = xmlText_(it, 'title'), publisher = xmlText_(it, 'source');
    if (publisher && title.slice(-(publisher.length + 3)) === ' - ' + publisher) title = title.slice(0, -(publisher.length + 3));
    var pub = new Date(xmlText_(it, 'pubDate'));
    return { title: title, publisher: publisher, url: xmlText_(it, 'link'), at: isNaN(pub) ? '' : Utilities.formatDate(pub, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX") };
  });
}

/** 產生一個產業的素材包（近 14 天 vs 前 14 天）並寫入 insight_packs；回傳素材包。 */
function buildInsightPack_(key) {
  var ind = industries_().filter(function (r) { return r.industry_key === key; })[0];
  if (!ind) throw new Error('config_industries 沒有啟用的產業：' + key);
  var cfg = parseIndustryKeywords_(ind.news_keywords);
  var now = new Date(), w = INSIGHT_WINDOW_DAYS * 864e5;
  var curFrom = new Date(now - w), prevFrom = new Date(now - 2 * w), prevTo = new Date(now - w - 864e5);
  var ctxQ = cfg.context.length ? '(' + cfg.context.map(function (c) { return '"' + c + '"'; }).join(' OR ') + ') ' : '';
  var exclude = /股價|股市|指數|漲停|跌停|目標價|外資|台股|美股|個股|類股|營收公布|EPS/;
  var listed = listedIndex_(), shorts = {};
  var indOk = INSIGHT_COMPANY_INDUSTRIES[key] || [];
  Object.keys(listed).forEach(function (f) { var s = listed[f].short; if (s && (s.length >= 3 || (s.length === 2 && indOk.indexOf(listed[f].industry) >= 0))) shorts[s] = listed[f].code; });
  var seen = {}, topics = [];
  cfg.topics.forEach(function (t) {
    var q = ctxQ + '(' + t.kws.map(function (k) { return '"' + k + '"'; }).join(' OR ') + ')';
    var cur = gnewsItems_(q, curFrom, now).filter(function (n) { return !exclude.test(n.title); });
    var prev = gnewsItems_(q, prevFrom, prevTo).filter(function (n) { return !exclude.test(n.title); });
    var uniq = {};
    cur = cur.filter(function (n) { var k = n.title.replace(/\s+/g, ''); if (uniq[k]) return false; uniq[k] = 1; return true; })
      .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    var cos = {};
    cur.forEach(function (n) { Object.keys(shorts).forEach(function (s) { if (n.title.indexOf(s) >= 0) cos[s] = shorts[s]; }); });
    cur.forEach(function (n) { var k = n.title.replace(/\s+/g, ''); (seen[k] = seen[k] || { n: n, topics: [] }).topics.push(t.name); });
    topics.push({ name: t.name, angle: t.angle, heat: cur.length, prev: prev.length, change: cur.length - prev.length,
                  news: cur.slice(0, 8), companies: Object.keys(cos).slice(0, 8).map(function (s) { return { name: s, code: cos[s] }; }) });
  });
  topics.sort(function (a, b) { return b.heat - a.heat || b.change - a.change; });
  // 重點事件：近 14 天、標題含事件動詞，跨主題命中多者優先，再依日期
  var events = Object.keys(seen).map(function (k) { return seen[k]; })
    .filter(function (x) { return INSIGHT_EVENT_RE.test(x.n.title); })
    .sort(function (a, b) { return b.topics.length - a.topics.length || String(b.n.at).localeCompare(String(a.n.at)); })
    .slice(0, 5).map(function (x) {
      // 切入角度取標題中命中關鍵字最多的主題（例：個資外洩→資安與個資，而不是會員經濟）
      var best = x.topics.map(function (name) {
        var t = cfg.topics.filter(function (tt) { return tt.name === name; })[0];
        var pos = t ? t.kws.map(function (k) { return kwPos_(x.n.title, k); }).filter(function (i) { return i >= 0; }) : [];
        return { t: t, hits: pos.length, first: pos.length ? Math.min.apply(null, pos) : 9999 };
      }).sort(function (a, b) { return b.hits - a.hits || a.first - b.first; })[0]; // 同分時取關鍵字在標題中較早出現的主題
      var topicsSorted = [best.t.name].concat(x.topics.filter(function (n) { return n !== best.t.name; }));
      return { title: x.n.title, publisher: x.n.publisher, url: x.n.url, at: x.n.at, topics: topicsSorted, angle: best.t ? best.t.angle : '' };
    });
  var top = topics.filter(function (t) { return t.heat > 0; });
  var rising = topics.slice().sort(function (a, b) { return b.change - a.change; })[0];
  var titles = [];
  if (top[0]) titles.push(top[0].name + '正在改變' + ind.name.replace(/（.*）/, '') + '：近兩週 ' + top[0].heat + ' 則新聞的三個觀察');
  if (rising && rising.change > 0) titles.push(rising.name + '升溫（比前兩週多 ' + rising.change + ' 則）：業者該先準備的三件事');
  if (events[0]) titles.push('從「' + events[0].title.slice(0, 24) + (events[0].title.length > 24 ? '…' : '') + '」看' + events[0].topics[0] + '的下一步');
  if (titles.length < 3 && top[1]) titles.push(top[1].name + '與' + (top[2] ? top[2].name : '數位轉型') + '：' + ind.name.replace(/（.*）/, '') + '本期重點整理');
  // AWS 部落格（公開）最新文章，作為切入角度的參考資料
  var refs = [];
  if (ind.aws_blog_feed) {
    var r = fetchWithRetry_(String(ind.aws_blog_feed));
    if (r.code === 200) refs = r.text.split('<item>').slice(1, 4).map(function (it) { return { title: xmlText_(it, 'title'), url: xmlText_(it, 'link'), at: xmlText_(it, 'pubDate') }; });
  }
  var period = ymd_(curFrom) + '~' + ymd_(now);
  var pack = { industry_key: key, industry: ind.name, period: period, prev_period: ymd_(prevFrom) + '~' + ymd_(prevTo), window_days: INSIGHT_WINDOW_DAYS,
               topics: topics, events: events, titles: titles.slice(0, 3), aws_refs: refs, created_at: nowIso_(),
               sources: ['Google News（近 ' + INSIGHT_WINDOW_DAYS + ' 天，排除股市行情）', ind.aws_blog_feed ? 'AWS for Industries 部落格 RSS' : ''].filter(String) };
  appendObjects_('insight_packs', [{ pack_id: key + ':' + ymd_(now), industry_key: key, period: period,
    topics_json: JSON.stringify({ v: INSIGHT_VERSION, topics: topics, titles: pack.titles, aws_refs: refs, sources: pack.sources, prev_period: pack.prev_period }),
    events_json: JSON.stringify(events), created_at: pack.created_at }]);
  return pack;
}

/** 排程步驟：每兩週（偶數 ISO 週，或該產業還沒有素材包）產生一次。 */
function insightTasks_() {
  var even = Number(String(weeklyRunId_()).split('W')[1]) % 2 === 0;
  return industries_().map(function (r) { return r.industry_key; }).filter(function (k) { return even || !latestPack_(k); }).map(function (k) { return 'insight:' + k; });
}
function runInsightTask_(key) {
  var p = buildInsightPack_(key);
  return { rows_in: p.topics.length, rows_out: p.events.length, note: p.industry + ' ' + p.period + '：熱門主題 ' + (p.topics[0] ? p.topics[0].name + '（' + p.topics[0].heat + '）' : '—') + '、重點事件 ' + p.events.length };
}

function latestPack_(key) {
  var rows = readTable_('insight_packs').filter(function (r) { return r.industry_key === key; });
  return rows.length ? rows[rows.length - 1] : null;
}

/** GET ?action=insight&industry=retail：最新素材包；沒有任何素材包時當場產生一次。另回傳可選的產業清單。 */
function apiInsight_(key) {
  var list = industries_().map(function (r) { return { key: r.industry_key, name: r.name }; });
  key = key || (list[0] && list[0].key);
  if (!key) return { industries: list, pack: null };
  var row = latestPack_(key), pack;
  var t = row ? JSON.parse(row.topics_json) : null;
  if (row && t.v === INSIGHT_VERSION) {
    pack = { industry_key: key, industry: (list.filter(function (x) { return x.key === key; })[0] || {}).name, period: String(row.period), prev_period: t.prev_period,
             window_days: INSIGHT_WINDOW_DAYS, topics: t.topics, titles: t.titles, aws_refs: t.aws_refs, sources: t.sources,
             events: JSON.parse(row.events_json), created_at: String(row.created_at) };
  } else {
    pack = buildInsightPack_(key);
  }
  return { industries: list, pack: pack };
}

/** 手動執行：立即產生零售素材包。 */
function buildInsightPackNow() { Logger.log(JSON.stringify(runInsightTask_('retail'))); }
