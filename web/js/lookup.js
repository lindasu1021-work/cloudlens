/**
 * Lead 速查（docs/09_v4角色旅程與平台設計.md 第 5.1 節）。
 * 帳戶池公司（三產業上市櫃）用前端已載入的完整評分；其他公司呼叫 GAS ?action=lookup（商工登記＋近 90 天新聞的輕量評估）。
 * 結論列、BANT 預審、開場白、轉交摘要皆以規則產生（不用 AI），每段附複製鈕；觀察清單存在瀏覽器。
 */
(() => {
  const esc = CL.esc;
  const $ = id => document.getElementById(id);
  const RECENT_KEY = 'cl:lookup:recent';

  const { QUESTIONS, SRC_LABEL, STATE, DEFAULT_CONFIG, loadConfig, route, scaleLabel, money, day, profileFromAccount, profileFromLite,
          opening, bant, handoff, copy, inWatch, toggleWatch: toggleW } = Lead;

  // ---------- 畫面 ----------
  function copyBtn(id, label = '複製') { return `<button type="button" class="lk-copy" data-copy="${id}" aria-label="${label}">${label}</button>`; }

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

  function toggleWatch(p, btn) {
    const on = toggleW(p);
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
      const b = await CL.gas('lookup', alias ? { q, alias } : { q }, 60000);
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
