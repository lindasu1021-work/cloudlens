/**
 * 雲端案例清單（10 檔 D2）：config_cloud_cases
 *   stock_code, company_name, cloud（aws／azure／gcp／other）, evidence_url, source_type, checked_at, verified, note
 * 來源：
 *   1. aws_case_page   AWS 客戶案例目錄（官方公開 API，zh_TW＋en_US）比對帳戶池公司 → verified = TRUE
 *   2. news_candidate  Google News「公司＋雲端廠商＋採用語境」候選 → verified = FALSE（待 Verna 人工確認，不影響計分）
 *   3. manual          人工整理（Verna 直接在 Sheets 新增，verified 填 TRUE 即生效）
 * verified = TRUE 的列會用在：雲端現況（cloud_status）、驗證集（與 config_validation 合併）。
 * Azure、Google Cloud 的台灣案例頁為前端動態載入、無公開目錄 API，無法穩定擷取，需人工整理（見 docs/phase6）。
 */

var AWS_DIR_ID = 'solution-case-studies-cards-interactive-customer-references';
var CLOUD_CAND_BATCH = 30;
var CLOUD_QUERY = '(AWS OR "Amazon Web Services" OR Azure OR "Google Cloud" OR GCP OR 微軟雲 OR 阿里雲)';

function cloudCasesTasks_() {
  var n = universeCodes_().length, tasks = ['cloudpages'];
  for (var i = 0; i < n; i += CLOUD_CAND_BATCH) tasks.push('cloudcand:' + i + ':' + Math.min(i + CLOUD_CAND_BATCH, n));
  return tasks;
}

/** 手動：重建雲端案例（AWS 案例頁＋新聞候選）。 */
function cloudCasesNow() {
  if (!ss().getSheetByName('config_cloud_cases')) setupSheets();
  runJob_('cloudcases', function () { return weeklyRunId_() + '-cloud'; }, function () { return cloudCasesTasks_(); }, 'continueCloudCases');
}
function continueCloudCases() { cloudCasesNow(); }

function cloudKey_(code, cloud, url) { return code + '|' + cloud + '|' + url; }

/** 已有的案例鍵（避免重複寫入）。 */
function cloudCaseKeys_() {
  var have = {};
  readTable_('config_cloud_cases').forEach(function (r) { have[cloudKey_(String(r.stock_code), String(r.cloud), String(r.evidence_url))] = true; });
  return have;
}

function companyMatchNames_(c) {
  var names = [String(c.name_short).replace(/[-－]?KY$|\*$/, ''), String(c.name_full).replace(/股份有限公司|有限公司/g, '')];
  return names.filter(function (n, i) { return n.length >= 3 && names.indexOf(n) === i; });
}

/** 1. AWS 客戶案例目錄：zh_TW 與 en_US 全部頁面，比對帳戶池公司。 */
function fetchCloudPages_(runId) {
  var pool = readTable_('companies').filter(function (c) { return c.in_universe === true || String(c.in_universe).toUpperCase() === 'TRUE'; });
  var have = cloudCaseKeys_(), rows = [], total = 0, twCases = 0, matched = 0, now = nowIso_();
  ['zh_TW', 'en_US'].forEach(function (loc) {
    for (var page = 0; page < 25; page++) {
      var url = 'https://aws.amazon.com/api/dirs/items/search?item.directoryId=' + AWS_DIR_ID + '&item.locale=' + loc +
        '&sort_by=item.additionalFields.publishedDate&sort_order=desc&size=100&page=' + page;
      var res = fetchWithRetry_(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.code !== 200) throw new Error('HTTP ' + (res.code || res.error) + ' ' + url);
      var items = (JSON.parse(res.text).items || []);
      if (!items.length) break;
      items.forEach(function (it) {
        var f = (it.item || {}).additionalFields || {};
        total++;
        var loc2 = String(f.location || '');
        if (/taiwan|台灣|臺灣/i.test(loc2)) twCases++;
        var hay = [f.mediaAlt, f.title, f.headline, f.body].join(' ');
        var link = String(f.ctaLink || '').replace(/\?.*$/, '');
        pool.forEach(function (c) {
          if (!companyMatchNames_(c).some(function (n) { return hay.indexOf(n) >= 0; })) return;
          var code = String(c.stock_code), key = cloudKey_(code, 'aws', link);
          if (have[key]) return;
          have[key] = true; matched++;
          rows.push({ stock_code: code, company_name: c.name_short, cloud: 'aws', evidence_url: link, source_type: 'aws_case_page',
                      checked_at: now, verified: true, note: String(f.title || f.mediaAlt || '').slice(0, 80) });
        });
      });
      if (items.length < 100) break;
      Utilities.sleep(300);
    }
  });
  appendObjects_('config_cloud_cases', rows);
  return { rows_in: total, rows_out: rows.length, note: 'AWS 案例目錄 ' + total + ' 則（台灣 ' + twCases + ' 則），比對帳戶池 ' + matched + ' 家' };
}

/** 2. 新聞候選：標題含公司名＋雲端廠商（排除供應鏈新聞）；召回優先，供人工確認。 */
function discoverCloudCandidates_(runId, from, to) {
  var kw = loadKeywords_();
  var companies = {};
  readTable_('companies').forEach(function (c) { companies[String(c.stock_code)] = c; });
  var codes = universeCodes_().slice(Number(from), Number(to));
  var have = cloudCaseKeys_(), rows = [], fetched = 0, now = new Date(), day = 864e5;
  codes.forEach(function (code) {
    var c = companies[code], name = String(c.name_short).replace(/[-－]?KY$|\*$/, ''), ind = String(c.industry_code);
    var q = '"' + name + '" ' + CLOUD_QUERY + ' after:' + ymd_(new Date(now - 365 * day)) + ' before:' + ymd_(new Date(now.getTime() + day));
    var res = fetchWithRetry_('https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=zh-TW&gl=TW&ceid=TW:zh-Hant');
    fetched++; Utilities.sleep(300);
    if (res.code !== 200) return;
    res.text.split('<item>').slice(1).forEach(function (it) {
      var title = xmlText_(it, 'title'), publisher = xmlText_(it, 'source');
      if (publisher && title.slice(-(publisher.length + 3)) === ' - ' + publisher) title = title.slice(0, -(publisher.length + 3));
      if (title.indexOf(name) < 0) return;
      var v = matchCat_(kw.VENDOR, title, ind);
      if (!v.length) return;
      // 候選清單只給人工確認，不要求採用語境（召回優先）；是否採用由 Verna 判斷
      if (matchCat_(kw.NEG, title, ind).some(function (n) { return n.play.split(',').indexOf('VENDOR') >= 0; })) return; // 供應鏈新聞
      var cloud = v.some(function (e) { return e.trig_type === 'aws'; }) ? 'aws'
        : /azure|微軟/i.test(title) ? 'azure' : /google|gcp|谷歌/i.test(title) ? 'gcp' : 'other';
      var link = xmlText_(it, 'link'), key = cloudKey_(code, cloud, link);
      if (have[key]) return;
      have[key] = true;
      rows.push({ stock_code: code, company_name: name, cloud: cloud, evidence_url: link, source_type: 'news_candidate',
                  checked_at: nowIso_(), verified: false, note: title.slice(0, 80) + '（' + publisher + '）' });
    });
  });
  appendObjects_('config_cloud_cases', rows);
  return { rows_in: fetched, rows_out: rows.length, note: codes.length + ' 家、候選 ' + rows.length };
}

/** verified = TRUE 的案例：code → cloud（aws／azure／gcp／other），給 computeScores_ 與驗證用。 */
function verifiedCloudCases_() {
  var out = {};
  readTable_('config_cloud_cases').forEach(function (r) {
    if (!(r.verified === true || String(r.verified).toUpperCase() === 'TRUE') || !r.stock_code) return;
    var code = String(r.stock_code), cloud = String(r.cloud).toLowerCase();
    if (!out[code] || cloud === 'aws') out[code] = cloud; // 同時有多家時 AWS 優先（現況：已是 AWS 客戶）
  });
  return out;
}
