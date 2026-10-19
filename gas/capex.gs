/**
 * 重訊「交易金額」解析（10 檔 R2）：從公告說明欄找出交易總金額／預計投資金額，換算新台幣。
 * 回傳 { ntd, currency, raw }；找不到金額回傳 null（呼叫端標示「金額未知」）。
 * 匯率為概略值（僅用來判斷是否達資本額 5% 門檻，不做財務計算），可在 config_settings 以 fx_usd、fx_cny… 覆寫。
 */
var FX_DEFAULT_ = { TWD: 1, USD: 32, CNY: 4.4, JPY: 0.21, EUR: 35, HKD: 4.1, THB: 0.9, VND: 0.0013, MYR: 7, SGD: 24 };
var CUR_WORDS_ = [
  ['TWD', /新台幣|新臺幣|台幣|臺幣|NT\$|NTD|TWD/i], ['CNY', /人民幣|RMB|CNY/i], ['USD', /美金|美元|USD|US\$/i],
  ['JPY', /日圓|日幣|JPY/i], ['EUR', /歐元|EUR/i], ['HKD', /港幣|港元|HKD/i], ['THB', /泰銖|THB/i],
  ['VND', /越南盾|VND/i], ['MYR', /馬幣|令吉|MYR/i], ['SGD', /新加坡幣|新幣|SGD/i]
];
var UNIT_MUL_ = { '億': 1e8, '仟萬': 1e7, '千萬': 1e7, '佰萬': 1e6, '百萬': 1e6, '萬': 1e4, '仟': 1e3, '千': 1e3, '': 1 };

function parseTxnAmount_(desc, fx) {
  var text = String(desc || '').replace(/\r/g, '');
  var label = /(交易總金額|交易金額|預計投資金額|投資總金額|預計投資總額|投資金額|總金額)[^\n\d]{0,12}/g;
  var m, best = null;
  while ((m = label.exec(text))) {
    // 標籤後 60 字內找第一個「（幣別）數字＋單位」
    var seg = text.substr(m.index + m[0].length - 4, 80);
    var num = seg.match(/(新台幣|新臺幣|台幣|臺幣|NT\$|NTD|人民幣|RMB|美金|美元|USD|US\$|日圓|日幣|歐元|港幣|港元|泰銖|越南盾|馬幣|令吉|新加坡幣|新幣)?\s*約?\s*(?:計)?\s*([\d][\d,]*(?:\.\d+)?)\s*(仟萬|千萬|佰萬|百萬|億|萬|仟|千)?\s*(元|圓)?/);
    if (!num) continue;
    var value = Number(num[2].replace(/,/g, ''));
    if (!(value > 0)) continue;
    var cur = 'TWD', head = num[1] || seg.slice(0, 20);
    CUR_WORDS_.some(function (c) { if (c[1].test(head)) { cur = c[0]; return true; } return false; });
    var rate = (fx && fx[cur]) || FX_DEFAULT_[cur] || 1;
    var ntd = value * (UNIT_MUL_[num[3] || ''] || 1) * rate;
    if (!best || ntd > best.ntd) best = { ntd: Math.round(ntd), currency: cur, raw: num[0].trim() };
  }
  return best;
}
