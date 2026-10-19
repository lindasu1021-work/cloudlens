/**
 * Lead 速查（docs/09_v4角色旅程與平台設計.md 第 5.1 節）。
 * 帳戶池公司（三產業上市櫃）用前端已載入的完整評分；其他公司呼叫 GAS ?action=lookup（商工登記＋近 90 天新聞的輕量評估）。
 * 結論列、BANT 預審、開場白、轉交摘要皆以規則產生（不用 AI），每段附複製鈕；觀察清單存在瀏覽器。
 */
(() => {
  const esc = CL.esc;
  const $ = id => document.getElementById(id);
  const RECENT_KEY = 'cl:lookup:recent', WATCH_KEY = 'cl:watch', CONFIG_KEY = 'cl:lookup:config:v1';

  // ---------- 規則（與方法論頁「Lead 速查」一節一致） ----------
  const EVENT_PHRASE = {
    m_and_a: '有併購／投資動作', expansion: '正在擴廠或拓展海外據點', capex: '公布新的資本支出計畫',
    cio_change: '資訊主管有異動', transformation: '正推動系統更新或數位轉型', security_incident: '發生資安事件'
  };
  const PLAY_TOPIC = {
    Migration: '把既有系統搬上雲、降低機房與維運成本', Data: '整合各系統資料、建立即時分析',
    GenAI: '用生成式 AI 提升客服與內部知識查詢效率', Security: '強化資安偵測、備份與營運持續'
  };
  const QUESTIONS = {
    Migration: ['目前核心系統與機房的合約或汰換時程是什麼時候？', '如果要搬遷，最在意的是停機時間、成本，還是資料留在台灣？', 'IT 團隊目前花最多時間在維運哪一類系統？'],
    Data: ['各事業單位的資料目前集中在哪裡？跨系統報表要花多久才拿得到？', '管理層最想即時看到、但現在看不到的數字是什麼？', '資料治理與權限控管由哪個單位負責？'],
    GenAI: ['內部已經在試用哪些 AI 工具？有沒有資料外流的顧慮？', '哪一個流程最耗人力、最想先自動化？', '導入 AI 需要經過哪些資安或法遵審查？'],
    Security: ['近一年最擔心的資安風險是什麼？主管機關有沒有要求的期限？', '目前的威脅偵測與備份還原演練多久做一次？', '發生事件時，從發現到通報大約需要多久？'],
    none: ['公司未來一年最重要的營運目標是什麼？IT 需要支援哪些專案？', '目前系統以地端、私有雲還是公有雲為主？', '評估新的 IT 方案時，通常由哪些部門一起決定？']
  };
  const ROLES = {
    Migration: '資訊長（CIO）、IT 基礎架構主管', Data: '資訊長、數據／BI 主管', GenAI: '數位轉型主管、資訊長',
    Security: '資安長（CISO）、資訊長', none: '資訊長或 IT 主管'
  };
  const VERDICT_BY_TIER = {
    '1': { key: 'priority', label: '優先跟進' }, '2': { key: 'nurture', label: '培養' },
    '3': { key: 'nurture', label: '培養' }, hold: { key: 'hold', label: '暫緩' }
  };
  const SRC_LABEL = { ann: '重大訊息', news: '新聞', esg: 'ESG 報告', revenue: '月營收' };

  // ---------- 設定（建議分群、BANT 欄位）：GAS 讀 config_routing／config_bant，取不到時用預設 ----------
  const DEFAULT_CONFIG = {
    routing: [
      { condition: 'listed=true and capital>=10000000000', segment: '大型企業（上市櫃）' },
      { condition: 'capital>=1000000000', segment: '中大型企業' },
      { condition: 'capital>=100000000', segment: '成長型企業' },
      { condition: 'capital>=0', segment: '中小企業（線上／電話開發）' }
    ],
    bant: [{ key: 'B', label: '預算（Budget）', visible: true }, { key: 'A', label: '決策者（Authority）', visible: true },
           { key: 'N', label: '需求（Need）', visible: true }, { key: 'T', label: '時程（Timing）', visible: true },
           { key: 'F', label: '合適度（Fit）', visible: false }, { key: 'C', label: '競爭（Competition）', visible: false }]
  };
  async function loadConfig() {
    try { const hit = JSON.parse(sessionStorage.getItem(CONFIG_KEY) || 'null'); if (hit) return hit; } catch (e) { /* 略過 */ }
    try {
      const b = await CL.gas('lookup_config');
      try { sessionStorage.setItem(CONFIG_KEY, JSON.stringify(b.data)); } catch (e) { /* 略過 */ }
      return b.data;
    } catch (e) { return DEFAULT_CONFIG; }
  }
  function route(rules, ctx) {
    for (const r of rules) {
      const ok = String(r.condition).split(/\s+and\s+/i).every(c => {
        const m = /^\s*(\w+)\s*(>=|<=|=|>|<)\s*(\S+)\s*$/.exec(c);
        if (!m) return false;
        const v = ctx[m[1]], t = m[3] === 'true' ? true : m[3] === 'false' ? false : Number(m[3]);
        return { '>=': v >= t, '<=': v <= t, '>': v > t, '<': v < t, '=': v === t }[m[2]];
      });
      if (ok) return r.segment;
    }
    return '';
  }

  const scaleLabel = c => c >= 1e10 ? '大型（實收資本額 100 億以上）' : c >= 1e9 ? '中大型（10–100 億）' : c >= 1e8 ? '中型（1–10 億）'
    : c >= 1e7 ? '小型（1,000 萬–1 億）' : c > 0 ? '微型（1,000 萬以下）' : '未提供';
  const money = c => c >= 1e8 ? (c / 1e8).toFixed(c >= 1e10 ? 0 : 1).replace(/\.0$/, '') + ' 億' : c >= 1e4 ? Math.round(c / 1e4).toLocaleString() + ' 萬' : '—';
  const day = s => String(s || '').slice(0, 10);
  const pr = v => v === '' || v === null || v === undefined ? '—' : 'PR ' + Math.round(Number(v) * 100);

  // ---------- 統一的「速查檔案」 ----------
  function profileFromAccount(a) {
    const s = a.score;
    const evDocs = a.docs.filter(d => d.parts.some(p => p.type === 'T1'));
    const stratDocs = a.docs.filter(d => d.parts.some(p => p.type === 'N3' || p.type === 'PLAY'));
    const play = s.play_primary && s.play_primary !== CL.NO_PLAY ? s.play_primary : '';
    const v = VERDICT_BY_TIER[String(s.tier)] || VERDICT_BY_TIER.hold;
    const top = evDocs[0];
    const reason = {
      '1': `Need 與 Timing 都在帳戶池前 30%（${pr(s.need_pct)}／${pr(s.timing_pct)}）`,
      '2': `需求高（Need ${pr(s.need_pct)}），但近期觸發事件不足（Timing ${pr(s.timing_pct)}）`,
      '3': `近期有觸發事件（Timing ${pr(s.timing_pct)}），但需求訊號偏弱（Need ${pr(s.need_pct)}）`,
      hold: `Need 與 Timing 都未進帳戶池前 30%（${pr(s.need_pct)}／${pr(s.timing_pct)}）`
    }[String(s.tier)] || '';
    return {
      mode: 'full', key: 'code:' + a.code, name: a.name, full: a.full, code: a.code, listed: true, market: a.market,
      industry: a.industry, capital: Number(a.capital) || 0, tier: String(s.tier),
      verdict: { ...v, reason: reason + (top ? `；最新事件：${day(top.at)} ${top.title.length > 28 ? top.title.slice(0, 28) + '…' : top.title}` : '') },
      play, play2: s.play_secondary || '', cloud: s.cloud_status,
      need: s.need, timing: s.timing, need_pct: s.need_pct, timing_pct: s.timing_pct, n1: s.n1,
      events: evDocs.slice(0, 2).map(d => ({ at: d.at, title: d.title, src: d.src, url: d.url, type: (d.parts.find(p => p.type === 'T1') || {}).cat })),
      signals: stratDocs.slice(0, 2).map(d => ({ at: d.at, title: d.title, src: d.src, url: d.url })),
      sources: ['帳戶池完整評分（' + String(window.__runId || '') + '）：重大訊息、新聞、月營收、ESG'],
      account_url: 'account.html?code=' + a.code
    };
  }
  function profileFromLite(d) {
    const c = d.company;
    return {
      mode: 'lite', key: 'tax:' + c.tax_id, name: c.short || c.name, full: c.name, code: c.stock_code || '', tax_id: c.tax_id,
      listed: !!c.listed, market: c.market || '', industry: (c.items || []).length ? '營業項目：' + c.items.slice(0, 3).map(i => i.desc).join('、') : '營業項目未提供',
      capital: Number(c.capital) || 0, city: c.city, setup_year: c.setup_year, status: c.status,
      verdict: d.verdict, play: (d.plays || [])[0] || '', play2: (d.plays || [])[1] || '',
      events: (d.events || []).map(n => ({ at: n.at, title: n.title + (n.publisher ? `（${n.publisher}）` : ''), src: 'news', url: n.url, type: n.triggers[0] })),
      signals: (d.news || []).filter(n => n.cats.length).slice(0, 2).map(n => ({ at: n.at, title: n.title, src: 'news', url: n.url })),
      news_total: d.news_total, news_error: d.news_error, sources: d.sources || [], cached_at: d.cached_at || ''
    };
  }

  function opening(p) {
    const ev = p.events[0], topic = PLAY_TOPIC[p.play];
    const hi = '您好，我是 ＿＿＿，協助企業規劃雲端與數據架構。';
    if (ev) {
      const phrase = EVENT_PHRASE[ev.type] || '近期有重要的營運消息';
      return `${hi}注意到貴公司 ${day(ev.at).slice(5).replace('-', '/')} ${phrase}，很多企業在這個階段會同時檢視${topic || '既有系統能否支撐新的業務量'}。想請教您目前這部分的規劃，方便約 15 分鐘交流嗎？`;
    }
    if (topic) return `${hi}注意到貴公司近期在相關議題上有不少動作，想了解您對${topic}的規劃，看看有沒有能協助的地方，方便約 15 分鐘交流嗎？`;
    return `${hi}想了解貴公司未來一年的 IT 規劃與重點專案，看看有沒有能協助的地方，方便約 15 分鐘交流嗎？`;
  }
  function bant(p, cfg) {
    const roles = ROLES[p.play] || ROLES.none;
    const cio = p.events.some(e => e.type === 'cio_change');
    const ev = p.events[0];
    const rows = {
      B: { text: `${scaleLabel(p.capital)}${p.capital ? `；實收資本額 ${money(p.capital)}` : ''}${p.mode === 'full' && p.n1 !== '' && p.n1 !== undefined ? `；規模分數 N1 ${CL.fmt(p.n1)}／25` : ''}`, state: 'pending', note: '預算金額需在通話中確認' },
      A: { text: `建議接觸：${roles}${cio ? '（近期資訊主管異動，先確認新任窗口）' : ''}`, state: 'pending', note: '實際決策者需確認' },
      N: p.mode === 'full'
        ? { text: `Need ${CL.fmt(p.need)}（${pr(p.need_pct)}）${p.play ? `；主 Play ${CL.LABELS.play[p.play] || p.play}` : '；Play 訊號不足'}`, state: p.play ? 'estimated' : 'pending' }
        : { text: p.play ? `近 90 天新聞出現 ${[p.play, p.play2].filter(Boolean).map(x => CL.LABELS.play[x] || x).join('、')} 相關議題` : '近 90 天新聞未出現相關議題', state: p.play ? 'estimated' : 'pending' },
      T: ev
        ? { text: `${day(ev.at)} ${EVENT_PHRASE[ev.type] || '觸發事件'}${p.mode === 'full' ? `；Timing ${CL.fmt(p.timing)}（${pr(p.timing_pct)}）` : ''}`, state: 'estimated' }
        : { text: p.mode === 'full' ? `近期無觸發事件；Timing ${CL.fmt(p.timing)}（${pr(p.timing_pct)}）` : '近 90 天沒有觸發事件', state: 'pending' },
      F: { text: '（預留）', state: 'pending' }, C: { text: p.cloud === 'aws' ? '已是 AWS 客戶' : p.cloud === 'competitor' ? '公開資料顯示使用其他雲' : '（預留）', state: 'pending' }
    };
    return cfg.bant.filter(f => f.visible).map(f => ({ key: f.key, label: f.label, ...(rows[f.key] || { text: '—', state: 'pending' }) }));
  }
  const STATE = { estimated: '系統推估', pending: '待確認' };

  function handoff(p, seg, b, qs) {
    const L = [];
    L.push(`【轉交摘要】${p.full || p.name}${p.code ? `（${p.code}）` : ''}${p.tax_id ? `　統編 ${p.tax_id}` : ''}`);
    L.push(`產業／規模：${p.industry}｜${scaleLabel(p.capital)}${p.listed ? `｜${p.market || '上市櫃'}` : '｜非上市櫃'}`);
    L.push(`結論：${p.verdict.label}｜建議分群：${seg || '—'}${p.mode === 'lite' ? '｜輕量評估' : `｜${CL.LABELS.tierLong[p.tier] || ''}`}`);
    L.push(`理由：${p.verdict.reason}`);
    L.push('為什麼是現在：');
    if (p.events.length) p.events.forEach(e => L.push(`・${day(e.at)} ${e.title}（${SRC_LABEL[e.src] || e.src}${e.url && !e.url.startsWith('#') ? ' ' + e.url : ''}）`));
    else L.push('・近期無觸發事件');
    L.push('BANT 預審：');
    b.forEach(r => L.push(`・${r.label}：${r.text}［${STATE[r.state]}］`));
    L.push('建議 Discovery 問題：');
    qs.forEach((q, i) => L.push(`${i + 1}. ${q}`));
    L.push(`資料來源：企業雲端商機洞察平台 Lead 速查（${new Date().toISOString().slice(0, 10)}）；${p.sources.join('；')}`);
    return L.join('\n');
  }

  // ---------- 畫面 ----------
  function copyBtn(id, label = '複製') { return `<button type="button" class="lk-copy" data-copy="${id}" aria-label="${label}">${label}</button>`; }
  const watchList = () => { try { return JSON.parse(localStorage.getItem(WATCH_KEY) || '[]'); } catch (e) { return []; } };
  const inWatch = key => watchList().some(w => w.key === key);

  function render(p, cfg) {
    const seg = route(cfg.routing, { capital: p.capital, listed: p.listed });
    const qs = QUESTIONS[p.play] || QUESTIONS.none;
    const b = bant(p, cfg);
    const open = opening(p);
    const text = handoff(p, seg, b, qs);
    const texts = { open, handoff: text };
    qs.forEach((q, i) => { texts['q' + i] = q; });
    const evList = p.events.length ? p.events : p.signals;
    const card = $('lk-card');
    card.innerHTML = `
      <section class="card lk-who" aria-labelledby="lk-name">
        <div class="lk-who-top">
          <div>
            <h2 id="lk-name">${esc(p.name)}${p.code ? ` <span class="lk-code">${esc(p.code)}</span>` : ''}</h2>
            <div class="lk-meta">${esc(p.full && p.full !== p.name ? p.full + '・' : '')}${p.tax_id ? '統編 ' + esc(p.tax_id) + '・' : ''}${esc(p.industry)}</div>
          </div>
          <span class="badge lk-mode ${p.mode}">${p.mode === 'full' ? '完整評分' : '輕量評估'}</span>
        </div>
        <dl class="lk-facts">
          <div><dt>規模</dt><dd>${esc(scaleLabel(p.capital))}</dd></div>
          <div><dt>上市櫃</dt><dd>${p.listed ? esc(p.market || '是') + (p.mode === 'lite' ? '（不在帳戶池產業）' : '') : '否'}</dd></div>
          ${p.mode === 'full' ? `<div><dt>Tier</dt><dd>${CL.tierBadge(p.tier)}</dd></div>` : `<div><dt>所在地</dt><dd>${esc(p.city || '—')}${p.setup_year ? `・${p.setup_year} 年設立` : ''}</dd></div>`}
        </dl>
      </section>

      <section class="lk-verdict v-${p.verdict.key}" aria-label="結論">
        <div class="lk-v-main"><span class="lk-v-label">${esc(p.verdict.label)}</span><span class="lk-v-seg">建議分群：${esc(seg || '—')}</span></div>
        <p class="lk-v-reason">${esc(p.verdict.reason)}</p>
      </section>

      <section class="card" aria-labelledby="lk-now">
        <div class="card-head"><h2 id="lk-now">為什麼是現在</h2><span class="hint">${[p.events.length ? '最新觸發事件' : p.signals.length ? '近期無觸發事件，以下為數位化相關新聞' : '', p.mode === 'lite' && p.news_total !== undefined ? `近 90 天標題含公司名稱的新聞 ${p.news_total} 則` : ''].filter(Boolean).join('・')}</span></div>
        <ul class="lk-events">${evList.length ? evList.map(e => `<li><time>${esc(day(e.at))}</time><span class="lk-src">${esc(SRC_LABEL[e.src] || e.src)}</span>
            ${e.url && !String(e.url).startsWith('#') ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</li>`).join('')
          : `<li class="muted">${p.news_error ? esc(p.news_error) : '近期沒有觸發事件或數位化相關新聞'}</li>`}</ul>
      </section>

      <section class="card" aria-labelledby="lk-say">
        <div class="card-head"><h2 id="lk-say">怎麼開口</h2><span class="hint">依觸發事件與主要 Play 由規則產生，可直接修改後使用</span></div>
        <div class="lk-say"><p id="lk-open">${esc(open)}</p>${copyBtn('open', '複製開場白')}</div>
        <ol class="lk-qs">${qs.map((q, i) => `<li><span>${esc(q)}</span>${copyBtn('q' + i)}</li>`).join('')}</ol>
      </section>

      <section class="card" aria-labelledby="lk-bant">
        <div class="card-head"><h2 id="lk-bant">BANT 預審</h2><span class="hint">系統推估＝公開資料可支持；待確認＝需在通話中確認</span></div>
        <ul class="lk-bant">${b.map(r => `<li><div class="lk-b-key">${esc(r.key)}</div><div class="lk-b-body"><div class="lk-b-label">${esc(r.label)}</div><div>${esc(r.text)}</div>
            ${r.note ? `<div class="hint">${esc(r.note)}</div>` : ''}</div><span class="lk-state ${r.state}">${STATE[r.state]}</span></li>`).join('')}</ul>
      </section>

      <div class="lk-actions">
        <button type="button" class="btn-dark lk-act" data-copy="handoff">複製轉交摘要</button>
        ${p.account_url ? `<a class="lk-act lk-link" href="${p.account_url}">開啟完整帳戶頁</a>` : ''}
        <button type="button" class="lk-act lk-watch" id="lk-watch" aria-pressed="${inWatch(p.key)}">${inWatch(p.key) ? '已在觀察清單' : '加入觀察清單'}</button>
      </div>
      <p class="lk-foot">資料來源：${p.sources.map(esc).join('；')}${p.cached_at ? `・快取於 ${esc(String(p.cached_at).replace('T', ' ').slice(0, 16))}` : ''}。輕量評估與完整評分的規則見<a href="methodology.html#lookup">方法論</a>。</p>`;
    card.hidden = false;
    card.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', () => copy(texts[btn.dataset.copy], btn)));
    $('lk-watch').addEventListener('click', e => toggleWatch(p, e.currentTarget));
  }

  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (x) { /* 略過 */ } ta.remove();
    }
    const old = btn.textContent; btn.textContent = '已複製'; btn.classList.add('done');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1600);
  }
  function toggleWatch(p, btn) {
    let list = watchList();
    if (list.some(w => w.key === p.key)) list = list.filter(w => w.key !== p.key);
    else list.push({ key: p.key, name: p.name, code: p.code || '', tax_id: p.tax_id || '', added_at: new Date().toISOString() });
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(list)); } catch (e) { /* 私密模式 */ }
    const on = list.some(w => w.key === p.key);
    btn.setAttribute('aria-pressed', String(on)); btn.textContent = on ? '已在觀察清單' : '加入觀察清單';
  }

  // ---------- 查詢流程 ----------
  let data = null, cfg = DEFAULT_CONFIG;
  const norm = s => String(s || '').trim().replace(/\s+/g, '').toLowerCase();
  function findPool(q) {
    if (!data) return null;
    const n = norm(q);
    return data.accounts.find(a => a.code === n || norm(a.name) === n || norm(a.full) === n) || null;
  }
  function setStatus(msg, kind = '') { const s = $('lk-status'); s.className = 'lk-status ' + kind; s.innerHTML = msg; }
  function remember(label, q) {
    try {
      const r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter(x => x.q !== q);
      r.unshift({ label, q }); localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 5)));
    } catch (e) { /* 略過 */ }
    paintRecent();
  }
  function paintRecent() {
    let r = [];
    try { r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { /* 略過 */ }
    $('lk-recent').innerHTML = r.length ? '<span class="hint">最近查詢：</span>' + r.map(x => `<button type="button" class="lk-chip" data-q="${esc(x.q)}">${esc(x.label)}</button>`).join('') : '';
  }

  async function run(q, alias) {
    $('lk-candidates').hidden = true; $('lk-card').hidden = true;
    const t0 = performance.now();
    const pool = findPool(q);
    history.replaceState(null, '', '?q=' + encodeURIComponent(q));
    if (pool) { render(profileFromAccount(pool), cfg); remember(pool.name, pool.code); setStatus(''); return; }
    setStatus('查詢商工登記與近 90 天新聞中…（第一次查詢約 5–20 秒，之後 7 天內走快取）', 'busy');
    try {
      const b = await CL.gas('lookup', alias ? { q, alias } : { q }, 45000);
      const d = b.data;
      if (d.mode === 'pool') {
        const a = data && data.byCode[d.code];
        if (a && a.score) { render(profileFromAccount(a), cfg); remember(a.name, a.code); setStatus(''); return; }
      }
      if (d.mode === 'candidates') {
        setStatus('');
        $('lk-cand-list').innerHTML = d.candidates.map(c => `<li><button type="button" data-tax="${esc(c.tax_id)}">
          <span class="lk-c-name">${esc(c.name)}</span><span class="lk-c-meta">統編 ${esc(c.tax_id)}・${esc(c.city || '—')}・實收資本額 ${money(c.capital)}${c.setup_year ? `・${c.setup_year} 年設立` : ''}</span></button></li>`).join('');
        $('lk-candidates').hidden = false;
        $('lk-cand-list').querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => run(btn.dataset.tax, q)));
        return;
      }
      if (d.mode === 'notfound') { setStatus(esc(d.note), 'warn'); return; }
      const p = profileFromLite(d);
      render(p, cfg);
      remember(p.name, p.tax_id);
      setStatus(`<span class="muted">輕量評估完成（${((performance.now() - t0) / 1000).toFixed(1)} 秒${d.cached_at ? '，使用 7 天內快取' : ''}）</span>`);
    } catch (e) {
      setStatus('查詢失敗：' + esc(e.message || e) + '。請稍後再試，或改用統一編號查詢。', 'warn');
    }
  }

  function bindSuggest() {
    const input = $('lk-q'), list = $('lk-suggest');
    let items = [], idx = -1;
    const close = () => { list.hidden = true; idx = -1; };
    const paint = () => {
      list.innerHTML = items.map((a, i) => `<li role="option" data-i="${i}" aria-selected="${i === idx}"><span>${esc(a.name)}</span>
        <span class="muted">${a.code}・${esc(a.industry)}</span>${CL.tierBadge(String(a.score.tier))}</li>`).join('');
      list.hidden = !items.length;
    };
    input.addEventListener('input', () => {
      const n = norm(input.value);
      if (!n || !data) return close();
      items = data.accounts.filter(a => a.code.includes(n) || norm(a.name).includes(n) || norm(a.full).includes(n)).slice(0, 6);
      idx = -1; paint();
    });
    input.addEventListener('keydown', e => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % items.length; paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; paint(); }
      else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); input.value = items[idx].name; close(); run(items[idx].code); }
      else if (e.key === 'Escape') close();
    });
    list.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { const a = items[Number(li.dataset.i)]; input.value = a.name; close(); run(a.code); } });
    document.addEventListener('click', e => { if (!e.target.closest('.lk-search')) close(); });
  }

  async function init() {
    paintRecent();
    $('lk-form').addEventListener('submit', e => { e.preventDefault(); const q = $('lk-q').value.trim(); if (q.length >= 2) run(q); });
    $('lk-recent').addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (b) { $('lk-q').value = b.textContent; run(b.dataset.q); } });
    bindSuggest();
    [data, cfg] = await Promise.all([CL.load().catch(() => null), loadConfig()]);
    if (data) window.__runId = data.run_id;
    const q = new URLSearchParams(location.search).get('q');
    if (q) { $('lk-q').value = q; run(q); } else $('lk-q').focus();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
