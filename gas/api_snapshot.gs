/**
 * 前端用的 API（Phase 3）。
 * snapshot：一次回傳總覽與帳戶頁需要的全部資料（格式同 web/data/snapshot.json），
 *   以 CacheService 依 run_id 快取 6 小時（單一 key 上限 100KB，切塊存放）；計分完成時清除。
 * summary／accounts：spec 第 6 節的介面，由 snapshot 衍生。
 * methodology：規則版本、權重、字典統計、驗證紀錄。
 */

var SNAP_TTL = 6 * 60 * 60;
var SNAP_CHUNK = 90000;

function snapKey_(runId) { return 'snap:v2:' + runId; } // v2：加入 pool、play_scores、訊號 points/lane

function getSnapshot_(runId) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get(snapKey_(runId) + ':n') || 0);
  if (n) {
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(snapKey_(runId) + ':' + i);
    var got = cache.getAll(keys);
    if (Object.keys(got).length === n) return JSON.parse(keys.map(function (k) { return got[k]; }).join(''));
  }
  var snap = buildSnapshot_(runId);
  var text = JSON.stringify(snap);
  var parts = {};
  for (var j = 0; j * SNAP_CHUNK < text.length; j++) parts[snapKey_(runId) + ':' + j] = text.substr(j * SNAP_CHUNK, SNAP_CHUNK);
  try {
    cache.putAll(parts, SNAP_TTL);
    cache.put(snapKey_(runId) + ':n', String(Object.keys(parts).length), SNAP_TTL);
  } catch (e) { /* 快取失敗不影響回應 */ }
  return snap;
}

/** 計分完成後呼叫：清除該 run 的快取，讓網站讀到新分數。 */
function clearSnapshotCache_(runId) {
  CacheService.getScriptCache().remove(snapKey_(runId) + ':n');
}

function buildSnapshot_(runId) {
  var companies = readTable_('companies').filter(function (c) { return c.in_universe === true || String(c.in_universe).toUpperCase() === 'TRUE'; });
  var codes = {};
  companies.forEach(function (c) { codes[String(c.stock_code)] = true; });
  var allScores = readTable_('scores');
  var runs = allScores.map(function (r) { return String(r.run_id); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
  var prevRun = runs.filter(function (r) { return r < runId; }).pop() || '';
  var strip = function (r) { var o = {}; Object.keys(r).forEach(function (k) { if (k !== 'run_id') o[k] = r[k]; }); return o; };
  var scores = allScores.filter(function (r) { return String(r.run_id) === runId; }).map(strip);
  var prev = {};
  allScores.filter(function (r) { return String(r.run_id) === prevRun; }).forEach(function (r) {
    prev[String(r.stock_code)] = { need: r.need, timing: r.timing, tier: String(r.tier) };
  });
  var revenue = {};
  readTable_('raw_revenue').forEach(function (r) {
    var c = String(r.stock_code);
    if (codes[c]) (revenue[c] = revenue[c] || []).push([String(r.year_month), Number(r.revenue), r.yoy_pct]);
  });
  Object.keys(revenue).forEach(function (c) { revenue[c].sort(function (a, b) { return a[0].localeCompare(b[0]); }); revenue[c] = revenue[c].slice(-15); });
  var now = Date.now();
  var LANE = { ann: 'announcement', news: 'news', revenue: 'revenue', esg: 'esg' };
  var rawSignals = readTable_('signals').filter(function (s) { return codes[String(s.stock_code)]; });
  var signals = rawSignals.map(function (s) {
    return { id: s.signal_id, code: String(s.stock_code), type: s.signal_type, cat: s.category, play: s.play, strength: s.strength,
             pts: s.points_raw, points: Math.round(signalContribution_(s, now) * 10) / 10, lane: LANE[s.source] || s.source,
             at: String(s.observed_at), title: s.title, url: s.source === 'news' ? s.evidence_url : '', src: s.source };
  });
  // 每家公司的四個 Play 分數（與計分同一公式）
  var byCode = {};
  rawSignals.forEach(function (s) { (byCode[String(s.stock_code)] = byCode[String(s.stock_code)] || []).push(s); });
  var ind = {};
  companies.forEach(function (c) { ind[String(c.stock_code)] = String(c.industry_code); });
  scores.forEach(function (r) {
    var ps = playScores_(byCode[String(r.stock_code)] || [], ind[String(r.stock_code)], now);
    r.play_scores = ps.scores;
    r.play_from_signals = Math.round(ps.fromSignals * 10) / 10;
  });
  // 帳戶池中位數（缺資料不計入）與 Tier 門檻（前 30%）
  var median = function (vals) {
    vals = vals.filter(function (v) { return v !== '' && v !== null && !isNaN(Number(v)); }).map(Number).sort(function (a, b) { return a - b; });
    if (!vals.length) return null;
    var m = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
  };
  var pool = { median: {} };
  ['n1', 'n2', 'n3', 'n4', 't1', 't2', 't3', 't4', 'need', 'timing'].forEach(function (k) {
    pool.median[k] = median(scores.map(function (r) { return r[k]; }));
  });
  var high = function (axis, tiers) {
    var hi = scores.filter(function (r) { return tiers.indexOf(String(r.tier)) >= 0; }).map(function (r) { return Number(r[axis]); });
    var lo = scores.filter(function (r) { return tiers.indexOf(String(r.tier)) < 0; }).map(function (r) { return Number(r[axis]) || 0; });
    return hi.length ? (Math.min.apply(null, hi) + Math.max.apply(null, lo.concat([0]))) / 2 : null;
  };
  pool.need_cut = high('need', ['1', '2']);
  pool.timing_cut = high('timing', ['1', '3']);
  var scoreLog = readTable_('run_log').filter(function (r) { return r.step === 'scores' && String(r.run_id) === runId; }).pop();
  var validation = readTable_('validation').filter(function (v) { return String(v.run_id) === runId; }).pop() || null;
  return {
    generated_at: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'),
    updated_at: scoreLog ? String(scoreLog.ended_at) : '',
    run_id: runId, prev_run_id: prevRun, rule_version: Number(setting_('rule_version', 1)),
    note: 'GAS 每週排程正式資料',
    companies: companies.map(function (c) {
      return { code: String(c.stock_code), name: c.name_short, full: c.name_full, market: c.market, industry: c.industry_name, capital: Number(c.capital) };
    }),
    scores: scores, prev: prev, signals: signals, revenue: revenue, validation: validation, pool: pool,
    aws_cases: readTable_('config_validation')
  };
}

/** spec：KPI、本週動態（Tier 升降、分數變化前 5、新事件）、更新時間。 */
function apiSummary_(runId) {
  var s = getSnapshot_(runId);
  var today = new Date();
  var age = function (iso) { return (today - new Date(iso)) / 864e5; };
  var changes = s.scores.map(function (r) {
    var p = s.prev[String(r.stock_code)];
    if (!p) return null;
    return { code: String(r.stock_code), tier_from: p.tier, tier_to: String(r.tier),
             delta: Math.round(((Number(r.need) || 0) + (Number(r.timing) || 0) - (Number(p.need) || 0) - (Number(p.timing) || 0)) * 10) / 10 };
  }).filter(Boolean);
  return {
    kpi: {
      accounts: s.scores.length,
      tier1: s.scores.filter(function (r) { return String(r.tier) === '1'; }).length,
      new_events_7d: s.signals.filter(function (x) { return x.type === 'T1' && age(x.at) <= 7; }).length,
      greenfield_ratio: s.scores.length ? s.scores.filter(function (r) { return r.cloud_status === 'unknown'; }).length / s.scores.length : 0
    },
    tier_changes: changes.filter(function (c) { return c.tier_from !== c.tier_to; }),
    top_movers: changes.sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); }).slice(0, 5),
    new_events: s.signals.filter(function (x) { return x.type === 'T1' && age(x.at) <= 7; }),
    updated_at: s.updated_at
  };
}

/** spec：帳戶清單，可選 industry、tier、play、cloud。 */
function apiAccounts_(runId, p) {
  var s = getSnapshot_(runId);
  var byCode = {};
  s.companies.forEach(function (c) { byCode[c.code] = c; });
  return s.scores.map(function (r) {
    var c = byCode[String(r.stock_code)] || {};
    return { code: String(r.stock_code), name: c.name, industry: c.industry, need: r.need, timing: r.timing, tier: String(r.tier),
             play: r.play_primary, play_secondary: r.play_secondary, cloud_status: r.cloud_status, data_completeness: r.data_completeness };
  }).filter(function (a) {
    return (!p.industry || a.industry === p.industry) && (!p.tier || a.tier === p.tier) &&
           (!p.play || a.play === p.play) && (!p.cloud || a.cloud_status === p.cloud);
  });
}

function apiMethodology_() {
  var kw = {};
  readTable_('config_keywords').forEach(function (k) {
    if (k.active === false || String(k.active).toUpperCase() === 'FALSE') return;
    kw[k.category] = (kw[k.category] || 0) + 1;
  });
  return {
    rule_version: Number(setting_('rule_version', 1)),
    tier_percentile: Number(setting_('tier_percentile', 0.3)),
    capital_threshold: Number(setting_('capital_threshold', 0)),
    weights: readTable_('config_weights'),
    keyword_counts: kw,
    validation: readTable_('validation'),
    validation_set: readTable_('config_validation')
  };
}
