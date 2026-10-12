/**
 * 新聞（每週）：Google News RSS。
 * 查詢：「"公司簡稱" (主題詞 OR …) after:… before:…」，只留標題含公司名稱者。
 * 第一次（回補）：近 3 個月逐月 3 個區間＋近 1 年 1 次；之後每週只抓最近 8 天，raw_news 持續累積。
 * 單次查詢上限約 100 則（Phase 0 實測），新聞量極大的公司會被截斷，方法論頁需註明。
 */

var NEWS_TOPIC = '(雲端 OR 數位轉型 OR AI OR 數據 OR 資料 OR 資安 OR ERP OR 智慧製造 OR 系統 OR 平台)';
var NEWS_BATCH = 15;

function newsTasks_() {
  var codes = universeCodes_();
  var tasks = [];
  for (var i = 0; i < codes.length; i += NEWS_BATCH) tasks.push('news:' + i + ':' + Math.min(i + NEWS_BATCH, codes.length));
  return tasks;
}

/** 帳戶池（in_universe）代號，依代號排序以確保分批穩定。 */
function universeCodes_() {
  return readTable_('companies').filter(function (c) { return c.in_universe === true || String(c.in_universe).toUpperCase() === 'TRUE'; })
    .map(function (c) { return String(c.stock_code); }).sort();
}

function newsQueryName_(c, overrides) {
  var o = overrides[c.stock_code];
  if (o && o.news_query) return String(o.news_query);
  return String(c.name_short).replace(/[-－]?KY$|\*$/, '');
}

function ymd_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }

function fetchNewsBatch_(runId, from, to) {
  var codes = universeCodes_().slice(Number(from), Number(to));
  var companies = {};
  readTable_('companies').forEach(function (c) { companies[String(c.stock_code)] = c; });
  var overrides = {};
  readTable_('config_company_overrides').forEach(function (o) { overrides[String(o.stock_code)] = o; });
  var aliases = {};
  readTable_('company_aliases').forEach(function (a) { (aliases[String(a.stock_code)] = aliases[String(a.stock_code)] || []).push(String(a.alias)); });
  var props = PropertiesService.getScriptProperties();
  var backfilled = JSON.parse(props.getProperty('NEWS_BACKFILLED') || '{}');

  var now = new Date(), day = 864e5, rows = [], fetched = 0, failed = [];
  codes.forEach(function (code) {
    var c = companies[code];
    var name = newsQueryName_(c, overrides);
    var exclude = String((overrides[code] || {}).news_exclude_terms || '').split(',').filter(String)
      .map(function (t) { return ' -"' + t.trim() + '"'; }).join('');
    var windows = backfilled[code]
      ? [[new Date(now - 8 * day), now]]
      : [[new Date(now - 30 * day), now], [new Date(now - 60 * day), new Date(now - 30 * day)], [new Date(now - 90 * day), new Date(now - 60 * day)],
         [new Date(now - 365 * day), new Date(now - 90 * day)]];
    var names = (aliases[code] || []).concat([name]).filter(function (a) { return a.length >= 2; });
    var ok = true;
    windows.forEach(function (w) {
      var q = '"' + name + '" ' + NEWS_TOPIC + exclude + ' after:' + ymd_(w[0]) + ' before:' + ymd_(new Date(w[1].getTime() + day));
      var url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=zh-TW&gl=TW&ceid=TW:zh-Hant';
      var res = fetchWithRetry_(url);
      fetched++;
      Utilities.sleep(300);
      if (res.code !== 200) { ok = false; return; }
      res.text.split('<item>').slice(1).forEach(function (it) {
        var title = xmlText_(it, 'title');
        var publisher = xmlText_(it, 'source');
        if (publisher && title.slice(-(publisher.length + 3)) === ' - ' + publisher) title = title.slice(0, -(publisher.length + 3));
        // 標題須含公司名稱，排除只在內文順帶一提的文章
        if (!names.some(function (n) { return title.indexOf(n) >= 0; })) return;
        var guid = xmlText_(it, 'guid') || xmlText_(it, 'link');
        var pub = new Date(xmlText_(it, 'pubDate'));
        rows.push({
          raw_id: 'news:' + code + ':' + md5_(guid).slice(0, 16),
          run_id: runId, fetched_at: nowIso_(), source_url: url,
          stock_code: code, query: q, title: title,
          published_at: isNaN(pub) ? '' : Utilities.formatDate(pub, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"),
          publisher: publisher, link: xmlText_(it, 'link')
        });
      });
    });
    if (ok) backfilled[code] = true; else failed.push(code);
  });
  props.setProperty('NEWS_BACKFILLED', JSON.stringify(backfilled));
  var added = appendNewRaw_('raw_news', rows);
  if (failed.length === codes.length) throw new Error('本批全部查詢失敗：' + failed.join(','));
  return { rows_in: fetched, rows_out: added, status: failed.length ? 'partial' : 'success',
           note: codes.length + ' 家、' + fetched + ' 次查詢、標題相符 ' + rows.length + '、新增 ' + added + (failed.length ? '；失敗 ' + failed.join(',') : '') };
}

function xmlText_(s, tag) {
  var m = s.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>'));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
