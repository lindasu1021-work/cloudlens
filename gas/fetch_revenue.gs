/**
 * 月營收（每月）：MOPS 月營收彙總 HTML（D17）。
 * URL：mopsov.twse.com.tw/nas/t21/{sii|otc}/t21sc03_{民國年}_{月}_{0|1}.html，0＝國內、1＝KY；Big5 編碼。
 * 表格欄位：公司代號、公司名稱、當月營收、上月營收、去年當月營收、上月比較增減(%)、去年同月增減(%)、…（單位千元）
 */

/** 回補 N 個月 × 上市/上櫃 × 國內/KY。最新月為上個月。 */
function revenueTasks_() {
  var n = Number(setting_('revenue_backfill_months', 15));
  var d = new Date();
  var tasks = [];
  for (var i = n; i >= 1; i--) {
    var m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    var ym = Utilities.formatDate(m, TZ, 'yyyy-MM');
    ['sii', 'otc'].forEach(function (mk) {
      ['0', '1'].forEach(function (k) { tasks.push(['revenue', ym, mk, k].join(':')); });
    });
  }
  return tasks;
}

function revenueUrl_(ym, mk, kind) {
  var y = Number(ym.slice(0, 4)) - 1911, m = Number(ym.slice(5, 7));
  return 'https://mopsov.twse.com.tw/nas/t21/' + mk + '/t21sc03_' + y + '_' + m + '_' + kind + '.html';
}

function fetchRevenueFile_(runId, ym, mk, kind) {
  var url = revenueUrl_(ym, mk, kind);
  // 已抓過且不是最近 2 個月 → 略過（最近 2 個月可能有晚申報的公司，重抓並以 raw_id 去重）
  var latest2 = revenueTasks_().map(function (t) { return t.split(':')[1]; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(-2);
  if (latest2.indexOf(ym) < 0 && readColumn_('raw_revenue', 'source_url').indexOf(url) >= 0) {
    return { status: 'skipped', rows_in: 0, rows_out: 0, note: '已抓過' };
  }
  var res = fetchWithRetry_(url, { charset: 'Big5' });
  if (res.code !== 200) throw new Error('HTTP ' + (res.code || res.error) + ' ' + url);
  var scope = {};
  readColumn_('companies', 'stock_code').forEach(function (c) { scope[c] = true; });
  var now = nowIso_();
  var parsed = 0, rows = [];
  (res.text.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []).forEach(function (tr) {
    var c = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map(function (td) {
      return td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim();
    });
    if (c.length < 7 || !/^\d{4,6}$/.test(c[0])) return;
    parsed++;
    if (!scope[c[0]]) return;
    var yoy = parseFloat(c[6].replace(/,/g, ''));
    rows.push({
      raw_id: 'mops_rev:' + c[0] + ':' + ym,
      run_id: runId, fetched_at: now, source_url: url,
      stock_code: c[0], year_month: ym,
      revenue: Number(c[2].replace(/,/g, '')) || 0,
      yoy_pct: isNaN(yoy) ? '' : yoy
    });
  });
  if (parsed === 0 && res.text.length > 5000) throw new Error('解析 0 筆，頁面結構可能改變：' + url);
  var added = appendNewRaw_('raw_revenue', rows);
  return { rows_in: parsed, rows_out: added, note: '三產業 ' + rows.length + ' 筆，新增 ' + added };
}
