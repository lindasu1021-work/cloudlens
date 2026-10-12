/**
 * ESG 資訊安全（每週檢查）：證交所 t187ap46_L_16。上櫃無對應端點（D19），上櫃公司此子項為缺資料。
 * 「N/A」存空白（缺資料），不當 0。
 */

var ESG_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap46_L_16';

function fetchEsg_(runId) {
  var data = fetchJson_(ESG_URL);
  var scope = {};
  readColumn_('companies', 'stock_code').forEach(function (c) { scope[c] = true; });
  var num = function (v) { v = String(v || '').replace(/[,%]/g, '').trim(); return v === '' || isNaN(Number(v)) ? '' : Number(v); };
  var now = nowIso_();
  var rows = data.filter(function (r) { return scope[String(r['公司代號']).trim()]; }).map(function (r) {
    var code = String(r['公司代號']).trim();
    var year = String(r['報告年度']).trim();
    return {
      raw_id: 'esg_sec:' + code + ':' + year, run_id: runId, fetched_at: now, source_url: ESG_URL,
      stock_code: code, report_year: year,
      breach_count: num(r['資訊外洩事件數量']),
      pii_breach_ratio: num(r['與個資相關的資訊外洩事件占比']),
      affected_customers: num(r['因資訊外洩事件而受影響的顧客數(人)'])
    };
  });
  var added = appendNewRaw_('raw_esg_security', rows);
  return { rows_in: data.length, rows_out: added, note: '三產業 ' + rows.length + ' 筆，新增 ' + added };
}
