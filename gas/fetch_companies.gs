/**
 * 公司主檔（每月）：證交所 t187ap03_L、櫃買 mopsfin_t187ap03_O。
 * 只保留 config_settings.industry_codes 的產業；不寫入董事長、發言人等個人欄位。
 */

var COMPANY_SOURCES = {
  twse: { url: 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L', market: '上市',
          code: '公司代號', full: '公司名稱', short: '公司簡稱', industry: '產業別', capital: '實收資本額', en: '英文簡稱' },
  tpex: { url: 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O', market: '上櫃',
          code: 'SecuritiesCompanyCode', full: 'CompanyName', short: 'CompanyAbbreviation', industry: 'SecuritiesIndustryCode',
          capital: 'Paidin.Capital.NTDollars', en: 'Symbol' }
};

function industryCodes_() {
  return String(setting_('industry_codes', '05,17,28')).split(',').map(function (s) { return s.trim(); });
}

function fetchCompanies_(runId, src) {
  var s = COMPANY_SOURCES[src];
  var data = fetchJson_(s.url);
  var codes = industryCodes_();
  var now = nowIso_();
  var rows = data.filter(function (r) { return codes.indexOf(String(r[s.industry]).trim()) >= 0; }).map(function (r) {
    var ind = String(r[s.industry]).trim();
    return {
      stock_code: String(r[s.code]).trim(),
      name_full: String(r[s.full]).trim(),
      name_short: String(r[s.short]).trim(),
      market: s.market,
      industry_code: ind,
      industry_name: INDUSTRY_NAMES[ind] || ind,
      capital: Number(r[s.capital]) || '',
      in_universe: '', // 由 rebuildAliasesAndUniverse_ 依門檻計算
      updated_at: now,
      _en: String(r[s.en] || '').trim()
    };
  });
  if (!rows.length) throw new Error(src + ' 主檔篩選後 0 筆，可能欄位名稱變了');
  // 英文簡稱暫存在 Script Properties，供 aliases 使用（不放進 companies 表）
  var en = {};
  rows.forEach(function (r) { if (r._en) en[r.stock_code] = r._en; delete r._en; });
  PropertiesService.getScriptProperties().setProperty('EN_NAMES_' + src, JSON.stringify(en));
  var res = upsertObjects_('companies', 'stock_code', rows);
  return { rows_in: data.length, rows_out: rows.length, note: '新增 ' + res.inserted + '、更新 ' + res.updated };
}

/** 依資本額門檻重算 in_universe，並重建 company_aliases（公司對應用）。 */
function rebuildAliasesAndUniverse_() {
  var threshold = Number(setting_('capital_threshold', 0)) || 0;
  var companies = readTable_('companies');
  var updates = companies.map(function (c) {
    c.in_universe = Number(c.capital) >= threshold;
    return c;
  });
  upsertObjects_('companies', 'stock_code', updates);

  var props = PropertiesService.getScriptProperties();
  var en = Object.assign({}, JSON.parse(props.getProperty('EN_NAMES_twse') || '{}'), JSON.parse(props.getProperty('EN_NAMES_tpex') || '{}'));
  var owner = {}, ambiguous = {};
  function add(alias, code) {
    alias = String(alias || '').trim();
    if (alias.length < 2) return;
    if (owner[alias] && owner[alias] !== code) ambiguous[alias] = true;
    else owner[alias] = code;
  }
  companies.forEach(function (c) {
    var code = String(c.stock_code);
    add(c.name_full, code);
    add(String(c.name_full).replace(/股份有限公司$/, ''), code);
    add(c.name_short, code);
    add(String(c.name_short).replace(/[-－]?KY$|\*$/, ''), code);
    add(en[code], code);
  });
  var rows = Object.keys(owner).filter(function (a) { return !ambiguous[a]; })
    .map(function (a) { return { alias: a, stock_code: owner[a] }; });
  // aliases 是衍生表：整張重建
  var sh = sheet_('company_aliases');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  appendObjects_('company_aliases', rows);
  var inU = updates.filter(function (c) { return c.in_universe; }).length;
  return { rows_in: companies.length, rows_out: rows.length,
           note: '帳戶池 ' + inU + '/' + companies.length + ' 家（門檻 ' + (threshold || '未設定') + '）；別名 ' + rows.length +
                 '，歧義略過 ' + Object.keys(ambiguous).length };
}
