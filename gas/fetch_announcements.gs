/**
 * 每日重大訊息：證交所 t187ap04_L、櫃買 mopsfin_t187ap04_O（只提供當日）。
 * 只保留主檔內（三產業）的公司。
 * 人事異動類公告的說明欄含個人姓名，依 spec 不保存（觸發事件只比對主旨）。
 */

var ANN_SOURCES = {
  twse: { url: 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L', code: '公司代號' },
  tpex: { url: 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O', code: 'SecuritiesCompanyCode' }
};

var PERSONNEL_RE = /異動|變動|辭任|辭職|解任|新任|委任|退休|聘任|改派|代表人|代理人|發言人|董事長|總經理|經理人/;
// 第二道防線：其他公告的說明欄中，含「姓名」的行（例：交易相對人姓名）整行刪除
var NAME_LINE_RE = /^.*姓名.*$/gm;

function fetchAnnouncements_(runId, src) {
  var s = ANN_SOURCES[src];
  var data = fetchJson_(s.url).map(trimKeys_);
  var scope = {};
  readColumn_('companies', 'stock_code').forEach(function (c) { scope[c] = true; });
  var now = nowIso_();
  var rows = data.filter(function (r) { return scope[String(r[s.code]).trim()]; }).map(function (r) {
    var code = String(r[s.code]).trim();
    var subject = String(r['主旨'] || '').replace(/\r?\n/g, '').trim();
    var date = rocDateToIso_(r['發言日期']);
    var time = rocTimeToIso_(r['發言時間']);
    var rawDesc = String(r['說明'] || '');
    var desc = PERSONNEL_RE.test(subject) ? '' : rawDesc.replace(/\r/g, '').replace(NAME_LINE_RE, '[略]').slice(0, 40000);
    return {
      raw_id: 'ann:' + src + ':' + code + ':' + date + 'T' + time + ':' + md5_(subject).slice(0, 10),
      run_id: runId, fetched_at: now, source_url: s.url,
      stock_code: code,
      ann_date: date + 'T' + time + '+08:00',
      subject: subject,
      description: desc,
      rule_ref: String(r['符合條款'] || '').trim()
    };
  });
  var added = appendNewRaw_('raw_announcements', rows);
  return { rows_in: data.length, rows_out: added, note: '三產業 ' + rows.length + ' 則，新增 ' + added };
}
