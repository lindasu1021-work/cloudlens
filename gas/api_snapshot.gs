/**
 * 前端用的 API（Phase 3）。
 * snapshot：一次回傳總覽與帳戶頁需要的全部資料（格式同 web/data/snapshot.json），
 *   以 CacheService 依 run_id 快取 6 小時（單一 key 上限 100KB，切塊存放）；計分完成時清除。
 * summary／accounts：spec 第 6 節的介面，由 snapshot 衍生。
 * methodology：規則版本、權重、字典統計、驗證紀錄。
 */

var SNAP_TTL = 6 * 60 * 60;
var SNAP_CHUNK = 90000;

function snapKey_(runId) { return 'snap:v4:' + runId; } // v3：加入 summary（總覽頁）與規則 v2 的訊號不足

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
    // 規則 v2 立即生效（不必等下一次計分）：與 computeScores_ 共用 pickPlays_
    var pp = pickPlays_(ps.scores, ps.fromSignals);
    r.play_primary = pp.primary;
    r.play_secondary = pp.secondary;
  });
  // 帳戶池排名：依 Need＋Timing 總分由高到低（同分並列）
  var order = scores.slice().sort(function (a, b) { return (Number(b.need) || 0) + (Number(b.timing) || 0) - (Number(a.need) || 0) - (Number(a.timing) || 0); });
  var last = null, rk = 0;
  order.forEach(function (r, i) {
    var t = (Number(r.need) || 0) + (Number(r.timing) || 0);
    if (t !== last) { rk = i + 1; last = t; }
    r.pool_rank = rk;
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
  var runLog = readTable_('run_log');
  // 每日排程也會重算當週分數（07 F2），步驟名為 scores:week；取最後一次成功的計分時間
  var lastOk = function (prefixes) {
    var r = runLog.filter(function (x) { return prefixes.indexOf(String(x.step).split(':')[0]) >= 0 && x.status !== 'error' && x.status !== 'skipped'; }).pop();
    return r ? String(r.ended_at) : '';
  };
  var scoreLog = runLog.filter(function (r) { return String(r.step).split(':')[0] === 'scores' && r.status !== 'error'; }).pop();
  var validation = readTable_('validation').filter(function (v) { return String(v.run_id) === runId; }).pop() || null;
  return {
    generated_at: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'),
    updated_at: scoreLog ? String(scoreLog.ended_at) : '',
    freshness: { scores_at: scoreLog ? String(scoreLog.ended_at) : '', news_at: lastOk(['news']), ann_at: lastOk(['ann', 'annhist']) },
    run_id: runId, prev_run_id: prevRun, rule_version: Math.max(Number(setting_('rule_version', 1)), RULE_VERSION),
    summary: buildSummary_(companies, scores, signals, validation),
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
    updated_at: s.updated_at,
    freshness: s.freshness
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

/** 規則版本歷史（rule_version 調整時在這裡新增一筆；precision 取自 validation 表，缺少時沿用前一版）。 */
var RULE_HISTORY = [
  { v: 1, date: '2026-10-12', title: '初版', note: '月營收改用 MOPS；就業通停用（N2、T4）；新聞弱訊號須與動作詞同現；金融業營收動能不適用；驗證集改公有雲客戶' },
  { v: 2, date: '2026-10-13', title: '「訊號不足」規則', note: 'Play 分數只來自產業先驗者，主 Play 改標「訊號不足」（Migration 122 → 31 家）；分數與 Tier 不變' },
  { v: 3, date: '2026-10-19', title: '賣方語境、資本支出金額、產業內排名', note: 'AI 新聞排除製造業「賣 AI 產品、參展」的賣方語境，並修正公司名稱誤配；資本支出依交易金額占實收資本額 5% 判斷、同公司同類事件重複遞減；Tier 預設改為各產業內各軸前 30%（可切換全帳戶池）；驗證改對照「只看規模」基準線' }
];

/** 方法論頁用的資料（06 檔第 8 節）：全部由真實資料即時彙總，前端不放數字。 */
function apiMethodology_(runId) {
  var snap = getSnapshot_(runId);
  var scores = snap.scores, signals = snap.signals;
  var indOf = {};
  snap.companies.forEach(function (c) { indOf[c.code] = c.industry; });
  var inds = ['金融保險', '電機機械', '電子零組件'];
  var log = readTable_('run_log');

  // 漏斗
  var lastRows = function (step) {
    var r = log.filter(function (x) { return x.step === step && x.status !== 'error'; }).pop();
    return r ? Number(r.rows_in) || 0 : 0;
  };
  var withSignal = {};
  signals.forEach(function (x) { withSignal[x.code] = true; });
  var inPool = scores.length;
  var funnel = [
    { key: 'listed', label: '全部上市櫃公司', n: lastRows('companies:twse') + lastRows('companies:tpex') },
    { key: 'industry', label: '三個目標產業', n: readTable_('companies').length },
    { key: 'pool', label: '實收資本額 ≥ ' + (Number(setting_('capital_threshold', 0)) / 1e8) + ' 億（帳戶池）', n: inPool },
    { key: 'signal', label: '至少 1 則訊號', n: scores.filter(function (r) { return withSignal[String(r.stock_code)]; }).length },
    { key: 'tier1', label: 'Tier 1 立即開發', n: scores.filter(function (r) { return String(r.tier) === '1'; }).length }
  ];

  // 分數分布（10 個區間，100 分併入最後一區）
  var hist = function (k) {
    var bins = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    scores.forEach(function (r) {
      if (r[k] === '' || r[k] === null) return;
      bins[Math.min(9, Math.floor(Number(r[k]) / 10))]++;
    });
    return bins;
  };

  // 字典命中（近一年訊號；N3 的 MIG／DATA／AI、PLAY 的 SEC、T1 觸發事件）
  var hits = {};
  signals.forEach(function (x) {
    var cat = x.type === 'N3' ? x.cat : x.type === 'PLAY' ? 'SEC' : x.type === 'T1' ? 'TRIG' : null;
    if (!cat) return;
    hits[cat] = hits[cat] || {};
    var ind = indOf[x.code] || '';
    hits[cat][ind] = (hits[cat][ind] || 0) + 1;
  });

  // 評分子項 × 產業的覆蓋狀態
  var cov = {};
  var put = function (comp, fn) { cov[comp] = {}; inds.forEach(function (i) { cov[comp][i] = fn(i); }); };
  put('N1', function () { return { s: 'ok' }; });
  put('N2', function () { return { s: 'disabled', code: 'D18' }; });
  put('N3', function () { return { s: 'ok' }; });
  put('N4', function () { return { s: 'ok', note: '上櫃公司無 ESG 揭露，該子項移出分母（D19）' }; });
  put('T1', function () { return { s: 'ok' }; });
  put('T2', function () { return { s: 'ok' }; });
  put('T3', function (i) { return i === '金融保險' ? { s: 'na', code: 'D27' } : { s: 'ok' }; });
  put('T4', function () { return { s: 'disabled', code: 'D18' }; });

  // 各來源近 7 天新增筆數（取自 run_log，避免掃描大表）
  var since = Date.now() - 7 * 864e5;
  var groupOf = function (step) {
    var h = String(step).split(':')[0];
    return { ann: 'announcements', annhist: 'announcements', news: 'news', esg: 'esg', revenue: 'revenue', companies: 'companies' }[h] || null;
  };
  var sc = { announcements: 0, news: 0, esg: 0, revenue: 0, companies: 0 };
  log.forEach(function (r) {
    var g = groupOf(r.step);
    if (g && r.status !== 'error' && new Date(r.ended_at).getTime() >= since) sc[g] += Number(r.rows_out) || 0;
  });

  // 版本歷史與 precision
  var vals = readTable_('validation');
  var prev = null;
  var versions = RULE_HISTORY.map(function (h) {
    var vs = vals.filter(function (x) { return Number(x.rule_version) === h.v && x.precision !== ''; });
    var p = vs.length ? Number(vs[vs.length - 1].precision) : prev;
    var o = { v: h.v, date: h.date, title: h.title, note: h.note, precision_before: prev, precision_after: p, measured: vs.length > 0 };
    prev = p;
    return o;
  });

  var kw = {};
  readTable_('config_keywords').forEach(function (k) {
    if (k.active === false || String(k.active).toUpperCase() === 'FALSE') return;
    kw[k.category] = (kw[k.category] || 0) + 1;
  });
  var dict = readTable_('config_keywords').filter(function (k) { return !(k.active === false || String(k.active).toUpperCase() === 'FALSE'); })
    .map(function (k) { return { c: k.category, k: String(k.keyword), s: k.strength, scope: k.industry_scope }; });

  return {
    rule_version: snap.rule_version,
    tier_percentile: Number(setting_('tier_percentile', 0.3)),
    capital_threshold: Number(setting_('capital_threshold', 0)),
    weights: readTable_('config_weights'),
    keyword_counts: kw,
    dictionary: dict,
    validation: vals,
    validation_set: readTable_('config_validation'),
    funnel: funnel,
    score_histogram: { need: hist('need'), timing: hist('timing') },
    threshold_need: snap.pool.need_cut,
    threshold_timing: snap.pool.timing_cut,
    keyword_hits: hits,
    industries: inds,
    coverage: cov,
    source_counts: sc,
    signal_total: signals.length,
    rule_versions: versions,
    tier_counts: snap.summary.tier_counts,
    validation_precision: snap.summary.validation_precision
  };
}

/**
 * 總覽頁用的彙總（06 檔第 8 節）：Tier 家數、產業 × Tier、近 182 天每日觸發事件（含各產業與前 3 則標題）、驗證 precision、回補進度。
 * 觸發事件以「文件」計（同一則重訊同時命中多個規則只算一次）。
 */
function buildSummary_(companies, scores, signals, validation) {
  var info = {};
  companies.forEach(function (c) { info[String(c.stock_code)] = { name: c.name_short, industry: String(c.industry_name) }; });
  var tierCounts = { '1': 0, '2': 0, '3': 0, hold: 0 }, matrix = {};
  scores.forEach(function (r) {
    var t = String(r.tier), ind = (info[String(r.stock_code)] || {}).industry || '';
    tierCounts[t] = (tierCounts[t] || 0) + 1;
    matrix[ind] = matrix[ind] || { '1': 0, '2': 0, '3': 0, hold: 0 };
    matrix[ind][t]++;
  });
  var group = function (ind) { return ind === '金融保險' ? 'fin' : 'mfg'; };
  var cutoff = Date.now() - 182 * 864e5, seen = {}, days = {};
  signals.filter(function (s) { return s.type === 'T1' && new Date(s.at).getTime() >= cutoff; }).forEach(function (s) {
    var key = s.code + '|' + s.title + '|' + s.at;
    if (seen[key]) return;
    seen[key] = true;
    var d = Utilities.formatDate(new Date(s.at), TZ, 'yyyy-MM-dd');
    var e = days[d] = days[d] || { d: d, n: 0, fin: 0, mfg: 0, titles: [] };
    var ind = (info[s.code] || {}).industry || '';
    e.n++; e[group(ind)]++;
    e.titles.push({ code: s.code, name: (info[s.code] || {}).name || s.code, title: s.title, ind: group(ind) });
  });
  var hist = JSON.parse(getProp_('ANN_HIST', 'null') || 'null');
  return {
    rank_total: scores.length,
    tier_counts: tierCounts,
    industry_tier_matrix: matrix,
    trigger_calendar: Object.keys(days).sort().map(function (d) { var e = days[d]; e.titles = e.titles.slice(0, 20); return e; }),
    validation_precision: validation && validation.precision !== '' ? Number(validation.precision) : null,
    announcement_backfill: hist ? { done_days: Object.keys(hist.done).length, total_days: Math.round((hist.end - hist.start) / 864e5) + 1 } : null
  };
}
