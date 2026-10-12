/**
 * Phase 0 技術驗證：從 GAS（Google 海外伺服器）逐一測試 spec 第 3 節資料來源，
 * 以及 Web App 的 GET / text/plain POST、Gemini 免費層一次呼叫。
 *
 * 執行方式：在 Apps Script 編輯器選 runPhase0 → 執行；選 testGemini → 執行。
 * 結果寫入 Sheets 的 phase0_results 分頁（需設定 Script Property SHEET_ID），
 * 並可透過 Web App 的 GET ?action=phase0 讀回。
 */

var PHASE0_SHEET = 'phase0_results';

// 樣本中不輸出個人姓名／聯絡方式（spec 第 1 節：不蒐集個人資料）
var REDACT_KEY_RE = /董事長|總經理|發言人|Chairman|GeneralManager|Spokes|Deputy|會計師|CPA|電話|Telephone|傳真|Fax|mail|過戶/i;

function phase0Sources_() {
  var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  var start = Utilities.formatDate(new Date(Date.now() - 120 * 864e5), 'Asia/Taipei', 'yyyy-MM-dd');
  var news = 'https://news.google.com/rss/search?q=' + encodeURIComponent('"台達電" when:30d') +
    '&hl=zh-TW&gl=TW&ceid=TW:zh-Hant';
  return [
    { id: '1_twse_company', url: 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L', type: 'json' },
    { id: '2_tpex_company', url: 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O', type: 'json' },
    { id: '3_twse_revenue_L', url: 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L', type: 'json' },
    { id: '3_twse_revenue_P', url: 'https://openapi.twse.com.tw/v1/opendata/t187ap05_P', type: 'json' },
    { id: '3_tpex_revenue', url: 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O', type: 'json' },
    { id: '3_finmind_revenue', url: 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMonthRevenue&data_id=2308&start_date=' + start, type: 'json', path: 'data' },
    { id: '3_mops_revenue_html', url: 'https://mopsov.twse.com.tw/nas/t21/sii/t21sc03_115_9_0.html', type: 'html' },
    { id: '4_twse_announce', url: 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L', type: 'json' },
    { id: '4_tpex_announce', url: 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O', type: 'json' },
    { id: '5_twse_esg_security', url: 'https://openapi.twse.com.tw/v1/opendata/t187ap46_L_16', type: 'json' },
    { id: '6_google_news', url: news, type: 'rss' },
    { id: '7_jobs_webservice', url: 'https://free.taiwanjobs.gov.tw/webservice_taipei/Webservice.ashx?count=5', type: 'jobsxml' },
    { id: '7_jobs_datastore', url: 'https://apiservice.mol.gov.tw/OdService/rest/datastore/A17000000J-030144-VAL?limit=1000&offset=0', type: 'json', path: 'result.records' },
    { id: '8_aws_cases', url: 'https://aws.amazon.com/api/dirs/items/search?item.directoryId=solution-case-studies-cards-interactive-customer-references&item.locale=zh_TW&size=100&page=0', type: 'json', path: 'items' }
  ].map(function (s) { s.tested_on = today; return s; });
}

function runPhase0() {
  var rows = phase0Sources_().map(testSource_);
  writePhase0_(rows);
  rows.forEach(function (r) {
    Logger.log([r.id, r.ok ? 'OK' : 'FAIL', r.http, r.ms + 'ms', r.count, r.note].join(' | '));
  });
  return rows;
}

function testSource_(s) {
  var res = fetchWithRetry_(s.url);
  var out = { id: s.id, url: s.url, ok: false, http: res.code, ms: res.ms, attempts: res.attempts,
              count: '', fields: '', sample: '', note: res.error, tested_at: new Date().toISOString() };
  if (res.code !== 200) { out.note = out.note || ('HTTP ' + res.code + ' ' + res.text.slice(0, 120)); return out; }
  try {
    if (s.type === 'json') {
      var data = JSON.parse(res.text);
      if (s.path) s.path.split('.').forEach(function (k) { data = data[k]; });
      out.count = data.length;
      var recs = data.slice(0, 2).map(function (r) { return r.item ? r.item.additionalFields : r; });
      out.fields = recs.length ? Object.keys(recs[0]).join(', ') : '';
      out.sample = JSON.stringify(recs.map(redact_)).slice(0, 1500);
    } else if (s.type === 'rss') {
      var items = res.text.split('<item>').slice(1);
      out.count = items.length;
      out.fields = 'title, link, guid, pubDate, description, source';
      out.sample = items.slice(0, 2).map(function (x) {
        return (x.match(/<title>([^<]*)<\/title>/) || [])[1] + ' @ ' + (x.match(/<pubDate>([^<]*)/) || [])[1];
      }).join(' ／ ');
    } else if (s.type === 'jobsxml') {
      var datas = res.text.split('<Data>').slice(1);
      out.count = datas.length;
      out.fields = (datas[0] || '').match(/<([^\/!>][^>]*)>/g).map(function (t) { return t.slice(1, -1); }).join(', ');
      out.sample = datas.slice(0, 2).map(function (x) {
        return (x.match(/COMPNAME[^>]*><!\[CDATA\[([^\]]*)/) || [])[1] + '：' + (x.match(/OCCU_DESC[^>]*><!\[CDATA\[([^\]]*)/) || [])[1];
      }).join(' ／ ');
    } else if (s.type === 'html') {
      out.count = (res.text.match(/<tr/gi) || []).length;
      out.fields = res.text.indexOf('公司代號') >= 0 ? 'HTML 表格（含「公司代號」）' : 'HTML（未找到公司代號欄）';
    }
    out.ok = out.count !== '' && out.count > 0;
    if (!out.ok) out.note = out.note || '回傳 0 筆';
  } catch (e) {
    out.note = 'parse error: ' + e + ' / ' + res.text.slice(0, 120);
  }
  return out;
}

function redact_(rec) {
  var o = {};
  Object.keys(rec).forEach(function (k) {
    o[k] = REDACT_KEY_RE.test(k) ? '[略]' : String(rec[k]).slice(0, 60);
  });
  return o;
}

/** Gemini 免費層一次呼叫。模型名稱讀 Script Property GEMINI_MODEL；未設定則從 ListModels 挑第一個 flash。 */
function testGemini() {
  var key = getProp_('GEMINI_API_KEY', '');
  if (!key) throw new Error('請先在 Script Properties 設定 GEMINI_API_KEY');
  var base = 'https://generativelanguage.googleapis.com/v1beta/';
  var hdr = { headers: { 'x-goog-api-key': key } };
  var model = getProp_('GEMINI_MODEL', '');
  var list = fetchWithRetry_(base + 'models?pageSize=200', hdr);
  var names = [];
  if (list.code === 200) {
    names = JSON.parse(list.text).models
      .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
      .map(function (m) { return m.name.replace('models/', ''); });
  }
  if (!model) model = names.filter(function (n) { return /flash/.test(n) && !/preview|exp|image|tts|live/.test(n); })[0] || names[0];
  var body = { contents: [{ parts: [{ text: '用一句繁體中文回答：雲端運算是什麼？' }] }] };
  var res = fetchWithRetry_(base + 'models/' + model + ':generateContent', Object.assign({
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body) }, hdr));
  var text = '';
  try { text = JSON.parse(res.text).candidates[0].content.parts[0].text; } catch (e) { text = res.text.slice(0, 300); }
  var row = { id: '9_gemini', url: 'models/' + model + ':generateContent', ok: res.code === 200, http: res.code, ms: res.ms,
              attempts: res.attempts, count: names.length, fields: 'available models: ' + names.slice(0, 15).join(', '),
              sample: text.slice(0, 300), note: list.code === 200 ? '' : 'ListModels HTTP ' + list.code, tested_at: new Date().toISOString() };
  writePhase0_([row]);
  Logger.log(JSON.stringify(row, null, 2));
  return row;
}

var PHASE0_COLS = ['id', 'ok', 'http', 'ms', 'attempts', 'count', 'fields', 'sample', 'note', 'url', 'tested_at'];

/** 以 id upsert 到 phase0_results 分頁（重跑不重複）。 */
function writePhase0_(rows) {
  var sheetId = getProp_('SHEET_ID', '');
  if (!sheetId) { Logger.log('未設定 SHEET_ID，只輸出到 Logger'); return; }
  var ss = SpreadsheetApp.openById(sheetId);
  var sh = ss.getSheetByName(PHASE0_SHEET) || ss.insertSheet(PHASE0_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(PHASE0_COLS);
  var ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
  rows.forEach(function (r) {
    var vals = [PHASE0_COLS.map(function (c) { return r[c] === undefined ? '' : r[c]; })];
    var i = ids.indexOf(r.id);
    if (i >= 0) sh.getRange(i + 2, 1, 1, PHASE0_COLS.length).setValues(vals);
    else { sh.appendRow(vals[0]); ids.push(r.id); }
  });
}

function readPhase0_() {
  var sheetId = getProp_('SHEET_ID', '');
  if (!sheetId) return [];
  var sh = SpreadsheetApp.openById(sheetId).getSheetByName(PHASE0_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues();
  return v.slice(1).map(function (r) { var o = {}; v[0].forEach(function (k, i) { o[k] = r[i]; }); return o; });
}
