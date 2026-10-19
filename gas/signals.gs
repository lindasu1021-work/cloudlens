/**
 * 訊號（每週）：重訊、新聞、ESG → signals。
 * signals 是衍生表：每次以近 365 天原始資料整張重建（signal_id 穩定，可追溯到同一份原始文件）。
 *
 * signal_type：
 *   N3      MIG/DATA/AI 策略意圖（重訊＋新聞）
 *   PLAY    SEC 一般資安詞，只用於 Play 計分
 *   N4      資安事件重訊（incident）、ESG 資訊外洩（esg_breach）
 *   T1      重訊主旨觸發事件（category＝事件類型）
 *   T2/T3   由 scoring.gs 寫入（新聞動能、營收動能的證據）
 *   VENDOR  雲端現況（category＝aws/competitor/onprem）
 */

var CIO_CHANGE_RE = /異動|新任|委任|聘任|接任|任命/;

function buildSignals_(runId) {
  if (header_('signals').indexOf('source_type') < 0) setupSheets(); // v3 新增欄位
  var added = seedKeywords_(); // 補上程式更新後新增的字典詞
  var kw = loadKeywords_();
  var ind = {}, cap = {}, names = {};
  readTable_('companies').forEach(function (c) {
    var code = String(c.stock_code);
    ind[code] = String(c.industry_code);
    cap[code] = Number(c.capital) || 0;
    names[code] = [String(c.name_short).replace(/[-－]?KY$|\*$/, '')];
  });
  readTable_('company_aliases').forEach(function (a) { (names[String(a.stock_code)] = names[String(a.stock_code)] || []).push(String(a.alias)); });
  var capexPct = Number(setting_('capex_materiality_pct', 0.05));
  var techW = Number(setting_('tech_news_weight', 1.5));
  var nameFalse = (kw.NAME_FALSE || []).map(function (e) { return e.kw; });
  var cutoff = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  var out = [];
  var stats = { ann: 0, ann_excluded: 0, news: 0, news_excluded: 0, news_mismatch: 0, capex: 0, capex_below: 0, capex_unknown: 0 };

  // 訊號產出率（D1 驗收指標）：各來源原始筆數 → 至少產生 1 則訊號的文件數
  var YG = { ann: '重大訊息', news_finance: '新聞（財經／一般）', news_tech: '新聞（科技媒體）' };
  var yraw = { ann: { all: 0, w7: 0 }, news_finance: { all: 0, w7: 0 }, news_tech: { all: 0, w7: 0 } };
  var yhit = { ann: {}, news_finance: {}, news_tech: {} };
  var cut7 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  function yCount(g, dateStr) { yraw[g].all++; if (String(dateStr).slice(0, 10) >= cut7) yraw[g].w7++; }
  function yGroup(doc) { return doc.source === 'ann' ? 'ann' : doc.source_type === 'tech' ? 'news_tech' : doc.source === 'news' ? 'news_finance' : null; }

  function push(code, type, category, play, weight, points, doc) {
    var yg = yGroup(doc); if (yg) yhit[yg][doc.key] = String(doc.observed_at).slice(0, 10);
    out.push({
      source_type: doc.source_type || '',
      signal_id: md5_([code, type, category, doc.key].join('|')).slice(0, 16),
      stock_code: code, signal_type: type, category: category, play: play,
      strength: weight >= 1 ? 'strong' : 'weak', points_raw: points,
      observed_at: doc.observed_at, title: doc.title, evidence_url: doc.url, source: doc.source, run_id: runId
    });
  }

  /**
   * 類別命中（套用否定詞），回傳 { MIG: weight, ... }。
   * 強訊號比對全文；弱訊號（如單獨的「AI」「雲端」）只比對 weakText（重訊主旨／新聞標題），且須與 CTX 動作詞同現。
   */
  function hits(text, weakText, code, cats) {
    var neg = matchCat_(kw.NEG, text, ind[code]);
    var ctx = matchCat_(kw.CTX, weakText, ind[code]).length > 0;
    var res = {};
    cats.forEach(function (cat) {
      if (neg.some(function (n) { return n.play.split(',').indexOf(cat) >= 0; })) return;
      var m = matchCat_(kw[cat], text, ind[code]).filter(function (e) { return e.weight >= 1; });
      if (ctx) m = m.concat(matchCat_(kw[cat], weakText, ind[code]).filter(function (e) { return e.weight < 1; }));
      if (m.length) res[cat] = Math.max.apply(null, m.map(function (e) { return e.weight; }));
    });
    return res;
  }

  function vendor(text, code, doc) {
    var v = matchCat_(kw.VENDOR, text, ind[code]);
    if (!v.length) return;
    if (!matchCat_(kw.CTX, text, ind[code]).length && !matchCat_(kw.CTX_VENDOR, text, ind[code]).length) return; // 須有「採用、導入、合作…」語境
    if (matchCat_(kw.NEG, text, ind[code]).some(function (n) { return n.play.split(',').indexOf('VENDOR') >= 0; })) return; // 供應鏈新聞
    var seen = {};
    v.forEach(function (e) {
      if (seen[e.trig_type]) return;
      seen[e.trig_type] = true;
      push(code, 'VENDOR', e.trig_type, '', 1, 0, doc);
    });
  }

  // 重大訊息
  readTable_('raw_announcements').forEach(function (a) {
    var code = String(a.stock_code);
    if (!ind[code] || String(a.ann_date).slice(0, 10) < cutoff) return;
    stats.ann++; yCount('ann', a.ann_date);
    var subject = String(a.subject);
    if (matchCat_(kw.EXCLUDE, subject, ind[code]).length) { stats.ann_excluded++; return; }
    var doc = { key: a.raw_id, observed_at: a.ann_date, title: subject, url: a.source_url, source: 'ann' };
    var text = subject + '\n' + a.description;
    var h = hits(text, subject, code, ['MIG', 'DATA', 'AI', 'SEC']);
    Object.keys(h).forEach(function (cat) {
      push(code, cat === 'SEC' ? 'PLAY' : 'N3', cat, PLAY_OF[cat], h[cat], h[cat], doc);
    });
    // 觸發事件只比對主旨
    var byType = {};
    matchCat_(kw.TRIG, subject, ind[code]).forEach(function (e) {
      if (e.trig_type === 'cio_change' && !CIO_CHANGE_RE.test(subject)) return;
      if (!byType[e.trig_type] || e.points > byType[e.trig_type].points) byType[e.trig_type] = e;
    });
    Object.keys(byType).forEach(function (t) {
      var pts = byType[t].points, d1 = doc;
      if (t === 'capex') {
        // 規則 v3（R2）：資本支出看金額 ÷ 實收資本額；解析不到金額維持原分數
        stats.capex++;
        var amt = parseTxnAmount_(a.description), billions = amt ? Math.round(amt.ntd / 1e7) / 10 : 0;
        if (!amt || !cap[code]) { stats.capex_unknown++; d1 = Object.assign({}, doc, { title: doc.title + '（金額未知）' }); }
        else if (amt.ntd / cap[code] < capexPct) {
          stats.capex_below++; pts = 0;
          d1 = Object.assign({}, doc, { title: doc.title + '（金額約 ' + billions + ' 億元，未達資本額 ' + Math.round(capexPct * 100) + '%）' });
        } else d1 = Object.assign({}, doc, { title: doc.title + '（金額約 ' + billions + ' 億元，占資本額 ' + Math.round(amt.ntd / cap[code] * 100) + '%）' });
      }
      push(code, 'T1', t, byType[t].play, 1, pts, d1);
      if (t === 'security_incident') push(code, 'N4', 'incident', 'Security', 1, 15, doc);
    });
    vendor(text, code, doc);
  });

  // 新聞（只比對標題）
  readTable_('raw_news').forEach(function (n) {
    var code = String(n.stock_code);
    if (!ind[code] || String(n.published_at).slice(0, 10) < cutoff) return;
    stats.news++; yCount(TECH_PUBLISHER_RE.test(String(n.publisher)) ? 'news_tech' : 'news_finance', n.published_at);
    var title = String(n.title);
    if (matchCat_(kw.EXCLUDE_NEWS, title, ind[code]).length) { stats.news_excluded++; return; }
    // 規則 v3（R1）：移除已知誤配詞後，標題仍須含公司名稱（避免「AI新巨獸」被當成新巨）
    var clean = nameFalse.reduce(function (t, f) { return t.split(f).join(''); }, title);
    if (!(names[code] || []).some(function (nm) { return nm.length >= 2 && clean.indexOf(nm) >= 0; })) { stats.news_mismatch++; return; }
    var tech = TECH_PUBLISHER_RE.test(String(n.publisher));
    var doc = { key: n.raw_id, observed_at: n.published_at, title: title + '（' + n.publisher + '）', url: n.link, source: 'news', source_type: tech ? 'tech' : 'finance' };
    var h = hits(title, title, code, ['MIG', 'DATA', 'AI', 'SEC']);
    Object.keys(h).forEach(function (cat) {
      // 規則 v3（D1）：科技媒體命中給 1.5 倍權重
      var w = h[cat] * (tech ? techW : 1);
      push(code, cat === 'SEC' ? 'PLAY' : 'N3', cat, PLAY_OF[cat], w, w, doc);
    });
    vendor(title, code, doc);
  });

  // ESG 資訊外洩：取每家最新報告年度
  var latest = {};
  readTable_('raw_esg_security').forEach(function (e) {
    var code = String(e.stock_code);
    if (!latest[code] || String(e.report_year) > String(latest[code].report_year)) latest[code] = e;
  });
  Object.keys(latest).forEach(function (code) {
    var e = latest[code];
    if (Number(e.breach_count) > 0) {
      push(code, 'N4', 'esg_breach', 'Security', 1, 10, {
        key: e.raw_id, observed_at: String(e.fetched_at), url: e.source_url, source: 'esg',
        title: '民國 ' + e.report_year + ' 年 ESG 揭露資訊外洩事件 ' + e.breach_count + ' 件' });
    }
  });

  var yieldRows = Object.keys(YG).map(function (g) {
    var hit = Object.keys(yhit[g]), hit7 = hit.filter(function (k) { return yhit[g][k] >= cut7; }).length;
    return { key: g, name: YG[g], raw_all: yraw[g].all, hit_all: hit.length, raw_w7: yraw[g].w7, hit_w7: hit7 };
  });
  PropertiesService.getScriptProperties().setProperty('SIGNAL_YIELD', JSON.stringify({ at: nowIso_(), run_id: runId, rows: yieldRows }));
  var sh = sheet_('signals');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  appendObjects_('signals', out);
  return { rows_in: stats.ann + stats.news, rows_out: out.length,
           note: '重訊 ' + stats.ann + '（排除 ' + stats.ann_excluded + '）、新聞 ' + stats.news + '（排除 ' + stats.news_excluded + '、公司名誤配 ' + stats.news_mismatch + '）、資本支出 ' + stats.capex + '（未達門檻 ' + stats.capex_below + '、金額未知 ' + stats.capex_unknown + '）' +
                 (added ? '；字典新增 ' + added + ' 詞' : '') };
}
