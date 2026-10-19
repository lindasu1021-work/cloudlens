/**
 * 計分（每週）：Need × Timing ＋ Tier ＋ Play ＋ 雲端現況（spec 第 5 節、01 檔）。
 * 缺資料不算 0 分：該項移出分母（分數欄留空白），另計 data_completeness。
 * 全部算完才切換 current_run_id（網站不會看到算到一半的分數）。
 */

var PLAYS = ['Migration', 'Data', 'GenAI', 'Security'];
var NO_PLAY = '訊號不足';   // 規則 v2（D36）：Play 分數只來自產業先驗、沒有任何實際訊號時的主 Play
var RULE_VERSION = 3;
var INDUSTRY_PRIOR = { '17': ['Security', 'Data'], '28': ['Data', 'Migration'], '05': ['Migration', 'Data'] };

function dimReturn_(max, n) { return max * (1 - Math.pow(0.5, n)); }

function decay_(dateStr, now) {
  var age = (now - new Date(dateStr).getTime()) / 864e5;
  return age <= 30 ? 1 : age <= 90 ? 0.5 : 0;
}

/** ISO 週次 run_id，例：2026-W42 */
function weekRunId_(d) {
  d = d || new Date();
  var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  var y = t.getUTCFullYear();
  var w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return y + '-W' + ('0' + w).slice(-2);
}

/** value 在 values 中的百分位（0–1，最大者為 1）。 */
function pctRank_(v, values) {
  if (values.length <= 1) return 1;
  var less = values.filter(function (x) { return x < v; }).length;
  return less / (values.length - 1);
}

/** 前 p 比例且分數 > 0 者為「高」；同分者一起納入。 */
function highSet_(rows, field, p) {
  var vals = rows.map(function (r) { return r[field]; }).filter(function (v) { return v !== '' && v > 0; }).sort(function (a, b) { return b - a; });
  var k = Math.ceil(rows.length * p);
  if (!vals.length || k === 0) return function () { return false; };
  var cut = vals[Math.min(k, vals.length) - 1];
  return function (v) { return v !== '' && v > 0 && v >= cut; };
}

/** 主 Play／次 Play 判定（規則 v2）：沒有任何帶 Play 的實際訊號 → 訊號不足、次 Play 留空。 */
function pickPlays_(scores, fromSignals) {
  if (!fromSignals) return { primary: NO_PLAY, secondary: '' };
  var ranked = PLAYS.slice().sort(function (a, b) { return scores[b] - scores[a]; });
  var sec = scores[ranked[1]] >= scores[ranked[0]] * 0.5 && scores[ranked[1]] > 0 ? ranked[1] : '';
  return { primary: ranked[0], secondary: sec };
}

function computeScores_(runId) {
  if (Number(setting_('rule_version', 1)) < RULE_VERSION) setSetting_('rule_version', RULE_VERSION);
  // D28 的驗證集分頁在 setupPhase2 之後才加入：不存在時自動建立並寫入預設清單
  if (!ss().getSheetByName('config_validation')) { setupSheets(); seedValidation_(); }
  if (header_('scores').indexOf('tier_pool') < 0 || header_('validation').indexOf('baseline_precision') < 0) setupSheets(); // v3 新增欄位
  var now = Date.now();
  var weights = {};
  readTable_('config_weights').forEach(function (w) {
    weights[w.component] = { max: Number(w.max_points), on: !(w.enabled === false || String(w.enabled).toUpperCase() === 'FALSE') };
  });
  var tierP = Number(setting_('tier_percentile', 0.3));
  var tierScope = String(setting_('tier_scope', 'industry'));
  var repeatDecay = Number(setting_('t1_repeat_decay', 0.5));
  var ruleVersion = setting_('rule_version', 1);
  var companies = readTable_('companies').filter(function (c) { return c.in_universe === true || String(c.in_universe).toUpperCase() === 'TRUE'; });
  var codes = companies.map(function (c) { return String(c.stock_code); });

  var sigs = {};
  readTable_('signals').forEach(function (s) { (sigs[String(s.stock_code)] = sigs[String(s.stock_code)] || []).push(s); });
  var rev = {};
  readTable_('raw_revenue').forEach(function (r) { (rev[String(r.stock_code)] = rev[String(r.stock_code)] || {})[String(r.year_month)] = r; });
  var esg = {};
  readTable_('raw_esg_security').forEach(function (e) { esg[String(e.stock_code)] = true; });
  var awsCases = {}, known = {};
  readTable_('config_aws_cases').forEach(function (a) { if (a.stock_code) awsCases[String(a.stock_code)] = a.case_url || true; });
  readTable_('config_validation').forEach(function (v) { if (v.stock_code) known[String(v.stock_code)] = String(v.cloud).toLowerCase(); });
  var newsDone = JSON.parse(getProp_('NEWS_BACKFILLED', '{}'));
  var allMonths = Object.keys(rev).reduce(function (acc, k) { return acc.concat(Object.keys(rev[k])); }, []).sort();
  var latestYm = allMonths[allMonths.length - 1];

  // N1：近 12 個月營收（不足 12 個月以月均年化，至少 6 個月）；無營收者以實收資本額百分位代理（D17）
  var annual = {};
  codes.forEach(function (code) {
    var months = Object.keys(rev[code] || {}).sort().slice(-12);
    if (months.length >= 6) annual[code] = months.reduce(function (s, m) { return s + Number(rev[code][m].revenue); }, 0) / months.length * 12;
  });
  var revVals = Object.keys(annual).map(function (k) { return annual[k]; });
  var capVals = companies.map(function (c) { return Number(c.capital); });

  var extraSignals = [];
  var rows = companies.map(function (c) {
    var code = String(c.stock_code), list = sigs[code] || [];
    var r = { run_id: runId, stock_code: code, rule_version: ruleVersion };
    var avail = { need: 0, timing: 0 }, got = { need: 0, timing: 0 }, total = 0;
    function put(comp, axis, val, max) {
      if (!weights[comp] || !weights[comp].on) { r[comp.toLowerCase()] = ''; return; }
      total += weights[comp].max;
      if (val === null) { r[comp.toLowerCase()] = ''; return; }
      r[comp.toLowerCase()] = Math.round(val * 10) / 10;
      avail[axis] += max; got[axis] += val;
    }

    // N1
    var n1 = annual[code] !== undefined ? pctRank_(annual[code], revVals) : pctRank_(Number(c.capital), capVals);
    put('N1', 'need', n1 * weights.N1.max, weights.N1.max);
    // N2：就業通不可用（D18）
    put('N2', 'need', null, weights.N2.max);
    // N3：近 365 天命中 MIG/DATA/AI 的文件數（強 1、弱 0.5），同週同類別跨來源只計一次
    var docs = {}, annWeekCat = {};
    list.filter(function (s) { return s.signal_type === 'N3'; }).forEach(function (s) {
      var wk = weekRunId_(new Date(s.observed_at));
      if (s.source === 'ann') annWeekCat[wk + '|' + s.category] = true;
    });
    list.filter(function (s) { return s.signal_type === 'N3'; }).forEach(function (s) {
      var wk = weekRunId_(new Date(s.observed_at));
      if (s.source === 'news' && annWeekCat[wk + '|' + s.category]) return;
      var key = s.source + '|' + s.title + '|' + s.observed_at;
      docs[key] = Math.max(docs[key] || 0, Number(s.points_raw));
    });
    var n3n = Object.keys(docs).reduce(function (s, k) { return s + docs[k]; }, 0);
    put('N3', 'need', dimReturn_(weights.N3.max, n3n), weights.N3.max);
    // N4：金融業 10；ESG 外洩 >0 加 10（上櫃無 ESG → 該子項移出分母）；近 365 天資安事件重訊加 15；上限 25
    var n4 = (c.industry_code === '17' || String(c.industry_code) === '17') ? 10 : 0;
    var n4max = weights.N4.max;
    if (list.some(function (s) { return s.category === 'esg_breach'; })) n4 += 10;
    if (!esg[code]) n4max -= 10;
    if (list.some(function (s) { return s.category === 'incident'; })) n4 += 15;
    put('N4', 'need', Math.min(n4, n4max), n4max);

    // T1：觸發事件 × 時間衰減，上限 50
    // 規則 v3（R2）：同一公司同一類事件重複出現 → 依分數×時間衰減由大到小，第 k 次乘 repeat^(k−1)（1、0.5、0.25…）
    var byCat = {};
    list.filter(function (s) { return s.signal_type === 'T1'; }).forEach(function (s) {
      (byCat[s.category] = byCat[s.category] || []).push(Number(s.points_raw) * decay_(s.observed_at, now));
    });
    var t1 = Object.keys(byCat).reduce(function (sum, cat) {
      return sum + byCat[cat].sort(function (a, b) { return b - a; }).reduce(function (a, v, i) { return a + v * Math.pow(repeatDecay, i); }, 0);
    }, 0);
    put('T1', 'timing', Math.min(t1, weights.T1.max), weights.T1.max);
    // T2：近 30 天命中新聞數 ÷ 過去 90 天月均（至少 2 則才計）
    if (newsDone[code]) {
      var newsDocs = {};
      list.filter(function (s) { return s.signal_type === 'N3' && s.source === 'news'; }).forEach(function (s) { newsDocs[s.title + '|' + s.observed_at] = s.observed_at; });
      var ages = Object.keys(newsDocs).map(function (k) { return (now - new Date(newsDocs[k]).getTime()) / 864e5; });
      var c30 = ages.filter(function (a) { return a <= 30; }).length, c90 = ages.filter(function (a) { return a <= 90; }).length;
      var ratio = c90 ? c30 / (c90 / 3) : 0;
      var t2 = c30 >= 2 && ratio >= 2 ? weights.T2.max : c30 >= 2 && ratio >= 1.5 ? weights.T2.max / 2 : 0;
      put('T2', 'timing', t2, weights.T2.max);
      if (t2 > 0) extraSignals.push(evidence_(runId, code, 'T2', 'news_momentum', t2,
        '近 30 天命中新聞 ' + c30 + ' 則，過去 90 天月均 ' + (c90 / 3).toFixed(1) + ' 則（' + ratio.toFixed(1) + ' 倍）'));
    } else put('T2', 'timing', null, weights.T2.max);
    // T3：連 3 個月 YoY > +15% → 20；< −15% → 15。金融保險業營收受投資收益波動，視為缺資料（D27）
    var months = String(c.industry_code) === '17' ? [] : Object.keys(rev[code] || {}).sort().slice(-3);
    var yoys = months.map(function (m) { return rev[code][m].yoy_pct; }).filter(function (v) { return v !== '' && v !== null; }).map(Number);
    if (yoys.length === 3 && months[2] >= prevYm_(latestYm, 1)) {
      var t3 = yoys.every(function (v) { return v > 15; }) ? 20 : yoys.every(function (v) { return v < -15; }) ? 15 : 0;
      put('T3', 'timing', Math.min(t3, weights.T3.max), weights.T3.max);
      if (t3 > 0) extraSignals.push(evidence_(runId, code, 'T3', t3 === 20 ? 'revenue_growth' : 'revenue_decline', t3,
        months.join('、') + ' 營收 YoY ' + yoys.map(function (v) { return v.toFixed(1) + '%'; }).join('、')));
    } else put('T3', 'timing', null, weights.T3.max);
    // T4：就業通不可用（D18）
    put('T4', 'timing', null, weights.T4.max);

    r.need = avail.need ? Math.round(got.need / avail.need * 1000) / 10 : '';
    r.timing = avail.timing ? Math.round(got.timing / avail.timing * 1000) / 10 : '';
    r.data_completeness = total ? Math.round((avail.need + avail.timing) / total * 100) / 100 : '';

    var ps = playScores_(list, String(c.industry_code), now);
    var pp = pickPlays_(ps.scores, ps.fromSignals);
    r.play_primary = pp.primary;
    r.play_secondary = pp.secondary;

    // 雲端現況：AWS 案例 → aws；競品 → competitor；提及 AWS → aws；其他 → unknown
    var vendors = list.filter(function (s) { return s.signal_type === 'VENDOR'; }).map(function (s) { return s.category; });
    var kc = known[code] || '';
    r.cloud_status = awsCases[code] || /aws/.test(kc) ? 'aws'
      : /azure|gcp|google/.test(kc) || vendors.indexOf('competitor') >= 0 ? 'competitor'
      : vendors.indexOf('aws') >= 0 ? 'aws' : 'unknown';

    r.top_signal_ids = list.filter(function (s) { return s.signal_type !== 'VENDOR'; })
      .sort(function (a, b) { return String(b.observed_at).localeCompare(String(a.observed_at)); })
      .slice(0, 10).map(function (s) { return s.signal_id; }).join(',');
    return r;
  });

  // 百分位與 Tier（帳戶池內）
  var needVals = rows.map(function (r) { return r.need; }).filter(function (v) { return v !== ''; });
  var timVals = rows.map(function (r) { return r.timing; }).filter(function (v) { return v !== ''; });
  var needHigh = highSet_(rows, 'need', tierP), timHigh = highSet_(rows, 'timing', tierP);
  // 規則 v3（R3）：同時算「全帳戶池」與「產業內」兩種 Tier；tier 欄依 tier_scope 設定（預設產業內）
  var indOf = {};
  companies.forEach(function (c) { indOf[String(c.stock_code)] = String(c.industry_code); });
  var byInd = {};
  rows.forEach(function (r) { (byInd[indOf[r.stock_code]] = byInd[indOf[r.stock_code]] || []).push(r); });
  var indHigh = {};
  Object.keys(byInd).forEach(function (k) { indHigh[k] = { need: highSet_(byInd[k], 'need', tierP), timing: highSet_(byInd[k], 'timing', tierP) }; });
  var tierOf = function (nh, th) { return nh && th ? '1' : nh ? '2' : th ? '3' : 'hold'; };
  rows.forEach(function (r) {
    r.need_pct = r.need === '' ? '' : Math.round(pctRank_(r.need, needVals) * 100) / 100;
    r.timing_pct = r.timing === '' ? '' : Math.round(pctRank_(r.timing, timVals) * 100) / 100;
    r.tier_pool = tierOf(needHigh(r.need), timHigh(r.timing));
    var ih = indHigh[indOf[r.stock_code]];
    r.tier_industry = tierOf(ih.need(r.need), ih.timing(r.timing));
    r.tier = tierScope === 'pool' ? r.tier_pool : r.tier_industry;
  });

  // T2/T3 證據寫入 signals（buildSignals_ 已重建，這裡只追加）
  var haveIds = {};
  readColumn_('signals', 'signal_id').forEach(function (id) { haveIds[id] = true; });
  appendObjects_('signals', extraSignals.filter(function (s) { return !haveIds[s.signal_id]; }));
  // 同一 run_id 先刪後寫（重跑不重複）
  var sh = sheet_('scores');
  var keep = readTable_('scores').filter(function (r) { return String(r.run_id) !== runId; });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  appendObjects_('scores', keep.concat(rows));
  setSetting_('current_run_id', runId);
  clearSnapshotCache_(runId);
  var val = computeValidation_(runId, rows, ruleVersion);

  var t = { '1': 0, '2': 0, '3': 0, hold: 0 };
  rows.forEach(function (r) { t[r.tier]++; });
  return { rows_in: codes.length, rows_out: rows.length,
           note: 'Tier1 ' + t['1'] + '、Tier2 ' + t['2'] + '、Tier3 ' + t['3'] + '、暫緩 ' + t.hold +
                 '；驗證 precision@20% = ' + val.hits + '/' + val.size };
}

/** 單一訊號對 Play 的貢獻：N3/PLAY 強 10、弱 5；T1 依分數×時間衰減；N4 依分數；其餘 0。前端泳道圖的點大小也用這個值。 */
function signalContribution_(s, now) {
  var t = s.signal_type;
  if (t === 'N3' || t === 'PLAY') return Number(s.points_raw) * 10;
  if (t === 'T1') return Number(s.points_raw) * decay_(s.observed_at, now);
  if (t === 'N4' || t === 'T2' || t === 'T3') return Number(s.points_raw);
  return 0;
}

/** 四個 Play 的分數＝訊號貢獻加總＋產業先驗（各 +5）。回傳 { scores, fromSignals }。 */
function playScores_(list, industryCode, now) {
  var play = {}, sig = 0;
  PLAYS.forEach(function (p) { play[p] = 0; });
  (INDUSTRY_PRIOR[industryCode] || []).forEach(function (p) { play[p] += 5; });
  list.forEach(function (s) {
    var v = signalContribution_(s, now);
    String(s.play || '').split(',').forEach(function (p) { p = p.trim(); if (play[p] !== undefined && v) { play[p] += v; sig += v; } });
  });
  return { scores: play, fromSignals: sig };
}

function evidence_(runId, code, type, category, points, title) {
  return { signal_id: md5_([code, type, category, runId].join('|')).slice(0, 16), stock_code: code, signal_type: type,
           category: category, play: '', strength: 'strong', points_raw: points, observed_at: nowIso_(), title: title,
           evidence_url: '', source: type === 'T2' ? 'news' : 'revenue', run_id: runId };
}

function prevYm_(ym, n) {
  var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - n;
  while (m < 1) { m += 12; y--; }
  return y + '-' + ('0' + m).slice(-2);
}

function setSetting_(key, value) {
  upsertObjects_('config_settings', 'key', readTable_('config_settings').filter(function (r) { return r.key === key; })
    .map(function (r) { r.value = value; return r; }));
  settingsCache_ = null;
}

/**
 * 驗證（D28；規則 v3 R4 改為「對基準線的增益」）：config_validation 中屬於帳戶池的公司，
 * 落在 Need 排名前 20% 的比例，並與「只看 N1 規模」的基準線比較；另算平均名次，以及「大型／中型」各自的命中。
 * 同一 run_id + rule_version 先刪後寫。
 */
function computeValidation_(runId, rows, ruleVersion) {
  var set = readTable_('config_validation').map(function (v) { return String(v.stock_code); });
  var capital = {};
  readTable_('companies').forEach(function (c) { capital[String(c.stock_code)] = Number(c.capital) || 0; });
  var largeCut = Number(setting_('large_capital', 1e10));
  var ranked = rows.filter(function (r) { return r.need !== ''; }).sort(function (a, b) { return b.need - a.need; });
  var topN = Math.ceil(ranked.length * 0.2);
  var top = {}, rankOf = {};
  ranked.forEach(function (r, i) { rankOf[r.stock_code] = i + 1; if (i < topN) top[r.stock_code] = true; });
  var inPool = set.filter(function (c) { return rows.some(function (r) { return r.stock_code === c; }); });
  // 基準線：只用 N1（營收規模）排名
  var baseRanked = rows.slice().sort(function (a, b) { return Number(b.n1) - Number(a.n1); });
  var base = {}, baseRankOf = {};
  baseRanked.forEach(function (r, i) { baseRankOf[r.stock_code] = i + 1; if (i < topN) base[r.stock_code] = true; });
  var avg = function (list, map, fb) { return list.length ? Math.round(list.reduce(function (s, c) { return s + (map[c] || fb); }, 0) / list.length * 10) / 10 : ''; };
  var hits = inPool.filter(function (c) { return top[c]; }), baseHits = inPool.filter(function (c) { return base[c]; });
  var large = inPool.filter(function (c) { return capital[c] >= largeCut; }), mid = inPool.filter(function (c) { return capital[c] < largeCut; });
  var pr = function (h, n) { return n ? Math.round(h / n * 100) / 100 : ''; };
  var rec = { run_id: runId, rule_version: ruleVersion, validation_set_size: inPool.length, hits_top20pct: hits.length,
              precision: pr(hits.length, inPool.length),
              note: '前 20% = Need 前 ' + topN + ' 名；命中：' + hits.join(',') + '；未命中：' +
                    inPool.filter(function (c) { return !top[c]; }).join(',') + '；平均名次 ' + avg(inPool, rankOf, ranked.length) + '/' + ranked.length +
                    '；基準線（只看營收規模）命中 ' + baseHits.length + '/' + inPool.length + '，平均名次 ' + avg(inPool, baseRankOf, ranked.length),
              baseline_hits: baseHits.length, baseline_precision: pr(baseHits.length, inPool.length),
              gain: inPool.length ? Math.round((hits.length - baseHits.length) / inPool.length * 100) / 100 : '',
              avg_rank: avg(inPool, rankOf, ranked.length), baseline_avg_rank: avg(inPool, baseRankOf, ranked.length),
              large_n: large.length, large_hits: large.filter(function (c) { return top[c]; }).length, large_base_hits: large.filter(function (c) { return base[c]; }).length,
              mid_n: mid.length, mid_hits: mid.filter(function (c) { return top[c]; }).length, mid_base_hits: mid.filter(function (c) { return base[c]; }).length };
  var keep = readTable_('validation').filter(function (v) { return !(String(v.run_id) === runId && String(v.rule_version) === String(ruleVersion)); });
  var sh = sheet_('validation');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  appendObjects_('validation', keep.concat([rec]));
  return { size: inPool.length, hits: hits.length };
}
