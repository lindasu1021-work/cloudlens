/**
 * App 外殼（docs/06_UI改版需求_v3.md 第 3 節）：左側欄＋頂部列，四頁共用。
 * 頁面只需在 <body> 設 data-page（lookup｜overview｜account｜methodology｜status）與 data-title，
 * 側欄分組依 09 檔 v4.1 第 4 節（查詢／機會／關於）；每頁頂端有資料時效列（分數／重訊／新聞各自的更新時間）。
 * 帳戶頁載入公司後再呼叫 Shell.setCrumbs(...)。
 */
const Shell = (() => {
  const NAME = '企業雲端商機洞察平台';
  const ICON = {
    overview: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    accounts: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    methodology: '<path d="M3 5.5C5 4.5 8.5 4.5 12 6.5c3.5-2 7-2 9-1v13c-2-1-5.5-1-9 1-3.5-2-7-2-9-1z"/><path d="M12 6.5v13"/>',
    status: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    lookup: '<circle cx="10" cy="10" r="6"/><path d="M19 19l-4.5-4.5"/><path d="M7.5 10h5M10 7.5v5"/>',
    radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/>',
    watchlist: '<path d="M6 4h12v16l-6-4-6 4z"/>',
    download: '<path d="M12 4v11"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M5 19.5h14"/>'
  };
  const svg = (k, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  const NAV = [
    { group: '查詢', items: [{ id: 'lookup', label: 'Lead 速查', href: 'lookup.html' }] },
    { group: '機會', items: [{ id: 'overview', label: '總覽', href: 'index.html' }, { id: 'radar', label: '觸發事件雷達', href: 'radar.html' },
                            { id: 'watchlist', label: '我的觀察清單', href: 'watchlist.html' }] },
    { group: '關於', items: [{ id: 'methodology', label: '方法論', href: 'methodology.html' }, { id: 'status', label: '資料狀態', href: 'status.html' }] }
  ];
  const PAGE_NAV = { lookup: 'lookup', overview: 'overview', account: 'overview', radar: 'radar', watchlist: 'watchlist', methodology: 'methodology', status: 'status' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let exportProvider = null, accounts = [];

  function build() {
    const page = document.body.dataset.page || 'overview';
    const title = document.body.dataset.title || '';
    const active = PAGE_NAV[page];
    const old = document.querySelector('nav.nav');
    if (old) old.remove();

    const side = document.createElement('aside');
    side.className = 'sidebar';
    side.innerHTML = `
      <div class="side-head">
        <a class="side-brand" href="index.html" aria-label="${NAME}，回總覽"><span class="side-mark">企業雲端<span>商機洞察</span></span></a>
        <button type="button" class="side-toggle" id="side-toggle" aria-label="收合側欄" aria-expanded="true" title="收合側欄">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
        </button>
      </div>
      <nav class="side-nav" aria-label="主要導覽">
        ${NAV.map(g => `<div class="side-group"><div class="side-group-title">${g.group}</div>
          ${g.items.map(i => `<a class="side-item" href="${i.href}" ${i.id === active ? 'aria-current="page"' : ''} title="${i.label}">
            <span class="side-ico">${svg(i.id === 'accounts' ? 'accounts' : i.id)}</span><span class="side-label">${i.label}</span>${i.id === 'watchlist' ? '<span class="side-count" id="watch-count" hidden></span>' : ''}
            ${i.id === active ? '<span class="side-dot" aria-hidden="true"></span>' : ''}</a>`).join('')}</div>`).join('')}
      </nav>
      <div class="update-card" id="update-card" aria-live="polite"><div class="uc-title">資料更新</div><div class="uc-line muted">載入中…</div></div>`;

    const wrap = document.createElement('div');
    wrap.className = 'shell-main';
    const top = document.createElement('header');
    top.className = 'topbar';
    top.innerHTML = `
      <div class="top-title"><h1 id="top-title">${esc(title)}</h1><nav class="crumbs" id="crumbs" aria-label="麵包屑"></nav></div>
      <div class="top-actions">
        <div class="gsearch">
          <span class="gs-ico">${svg('search', 18)}</span>
          <input id="gsearch" type="search" role="combobox" aria-expanded="false" aria-controls="gs-list" aria-autocomplete="list"
                 placeholder="搜尋公司名稱或代號" autocomplete="off" aria-label="搜尋公司">
          <kbd aria-hidden="true">⌘K</kbd>
          <ul id="gs-list" class="gs-list" role="listbox" hidden></ul>
        </div>
        ${page === 'overview' || page === 'account' ? `<button type="button" class="btn-dark export-btn" id="export-csv">${svg('download', 16)}<span>匯出 CSV</span></button>` : ''}
      </div>`;

    // 把導覽列以外的頁面內容搬進內容區（節點保留，頁面腳本以 id 取用不受影響）
    const keep = [...document.body.children].filter(n => n !== side && n.tagName !== 'SCRIPT');
    const app = document.createElement('div');
    app.className = 'app';
    wrap.appendChild(top);
    const fresh = document.createElement('div');
    fresh.className = 'fresh-bar'; fresh.id = 'fresh-bar'; fresh.setAttribute('aria-label', '資料時效');
    fresh.innerHTML = '<span class="muted">資料時效載入中…</span>';
    wrap.appendChild(fresh);
    keep.forEach(n => wrap.appendChild(n));
    app.appendChild(side);
    app.appendChild(wrap);
    document.body.insertBefore(app, document.body.firstChild);
    // 側欄收合：記住選擇（localStorage 讀不到時退回依視窗寬度）
    let pref = null;
    try { pref = localStorage.getItem('cl:sidebar'); } catch (e) { /* 私密模式 */ }
    const setCollapsed = (on, save) => {
      app.classList.toggle('collapsed', on);
      const b = document.getElementById('side-toggle');
      b.setAttribute('aria-expanded', String(!on));
      b.setAttribute('aria-label', on ? '展開側欄' : '收合側欄');
      b.title = on ? '展開側欄' : '收合側欄';
      if (save) { try { localStorage.setItem('cl:sidebar', on ? 'collapsed' : 'open'); } catch (e) { /* 忽略 */ } }
    };
    setCollapsed(pref ? pref === 'collapsed' : innerWidth < 1280, false);
    document.getElementById('side-toggle').addEventListener('click', () => setCollapsed(!app.classList.contains('collapsed'), true));
    setCrumbs([]);
    bindSearch();
    const ex = document.getElementById('export-csv');
    if (ex) ex.addEventListener('click', exportCsv);
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); document.getElementById('gsearch').focus(); }
    });
    fillUpdateCard();
    fillWatchCount();
  }

  function setCrumbs(list) {
    const el = document.getElementById('crumbs');
    if (!el) return;
    el.innerHTML = list.map((c, i) => c.href && i < list.length - 1 ? `<a href="${c.href}">${esc(c.label)}</a>` : `<span>${esc(c.label)}</span>`)
      .join('<span class="sep" aria-hidden="true"> › </span>');
  }
  function setTitle(t) { const h = document.getElementById('top-title'); if (h) h.textContent = t; }

  // ---------- 全站搜尋 ----------
  async function loadAccounts() {
    if (accounts.length) return accounts;
    try { const d = await CL.load(); accounts = d.accounts.map(a => ({ code: a.code, name: a.name, full: a.full, industry: a.industry, tier: String(a.score.tier) })); }
    catch (e) { accounts = []; }
    return accounts;
  }
  function bindSearch() {
    const input = document.getElementById('gsearch'), list = document.getElementById('gs-list');
    let items = [], idx = -1;
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); idx = -1; };
    const go = a => { location.href = 'account.html?code=' + a.code; };
    const paint = () => {
      list.innerHTML = items.length ? items.map((a, i) => `<li role="option" id="gs-${i}" data-i="${i}" aria-selected="${i === idx}">
          <span class="gs-name">${esc(a.name)}</span><span class="gs-meta">${a.code}・${esc(a.industry)}</span>${CL.tierBadge(a.tier)}</li>`).join('')
        : '<li class="gs-empty" role="option" aria-disabled="true">找不到符合的公司</li>';
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
      if (idx >= 0) input.setAttribute('aria-activedescendant', 'gs-' + idx); else input.removeAttribute('aria-activedescendant');
    };
    input.addEventListener('input', async () => {
      const q = input.value.trim().toLowerCase();
      if (!q) return close();
      const all = await loadAccounts();
      items = all.filter(a => a.code.includes(q) || a.name.toLowerCase().includes(q) || String(a.full || '').toLowerCase().includes(q)).slice(0, 8);
      idx = items.length ? 0 : -1;
      paint();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { close(); input.blur(); }
      else if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); idx = (idx + 1) % items.length; paint(); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; paint(); }
      else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); go(items[idx]); }
    });
    list.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) go(items[Number(li.dataset.i)]); });
    document.addEventListener('click', e => { if (!e.target.closest('.gsearch')) close(); });
    loadAccounts();
  }

  // ---------- 匯出 CSV ----------
  /** 頁面可註冊目前顯示的清單（例：總覽的篩選結果）；未註冊則匯出全部帳戶 */
  function setExport(fn) { exportProvider = fn; }
  async function exportCsv() {
    const d = await CL.load();
    const rows = exportProvider ? exportProvider() : d.accounts.map(a => ({
      code: a.code, name: a.name, industry: a.industry, need: a.score.need, timing: a.score.timing, tier: String(a.score.tier),
      play: a.score.play_primary, play2: a.score.play_secondary, cloud: a.score.cloud_status, comp: a.score.data_completeness }));
    const head = ['代號', '公司', '產業', 'Need', 'Timing', 'Tier', '主 Play', '次 Play', '雲端現況', '資料完整度'];
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const body = rows.map(r => [r.code, r.name, r.industry, r.need, r.timing, CL.LABELS.tier[r.tier] || r.tier, r.play || '', r.play2 || '',
      CL.LABELS.cloudShort[r.cloud] || r.cloud, r.comp].map(q).join(','));
    const blob = new Blob(['﻿' + [head.map(q).join(','), ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${NAME}_帳戶清單_${d.run_id || 'snapshot'}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- 觀察清單：有新觸發事件的公司數 ----------
  async function fillWatchCount() {
    const el = document.getElementById('watch-count');
    let list = [];
    try { list = JSON.parse(localStorage.getItem('cl:watch') || '[]'); } catch (e) { return; }
    if (!el || !list.length) return;
    try {
      const d = await CL.load();
      const n = list.filter(w => { const a = w.code && d.byCode[w.code]; return a && a.docs.some(x => x.parts.some(p => p.type === 'T1') && new Date(x.at) > new Date(w.added_at)); }).length;
      el.textContent = n ? String(n) : String(list.length);
      el.classList.toggle('hot', n > 0);
      el.title = n ? `${n} 家有新事件` : `觀察中 ${list.length} 家`;
      el.hidden = false;
    } catch (e) { /* 略過 */ }
  }

  // ---------- 資料更新卡 ----------
  async function fillUpdateCard() {
    const box = document.getElementById('update-card');
    try {
      const d = await CL.load();
      const t = (v) => String(v || '').replace('T', ' ').slice(5, 16) || '—';
      const f = d.freshness || {};
      const at = f.scores_at || d.updated_at;
      box.innerHTML = d.source === 'live'
        ? `<div class="uc-title">資料更新</div><div class="uc-main">${d.run_id}・規則 v${d.rule_version}</div>
           <div class="uc-line">分數：${esc(t(at))}（每日 22:00）</div>
           <div class="uc-line">重訊：${esc(t(f.ann_at))}（每日）</div>
           <div class="uc-line">新聞：${esc(t(f.news_at))}（每週一）</div>`
        : `<div class="uc-title uc-warn">目前顯示靜態快照</div><div class="uc-line">無法連線後端，資料為 ${esc(d.generated_at)} 的備份。</div>`;
      const bar = document.getElementById('fresh-bar');
      if (bar) {
        const age = v => { const t = new Date(v).getTime(); if (!v || isNaN(t)) return ''; const h = (Date.now() - t) / 36e5; return h < 1 ? '（1 小時內）' : h < 48 ? `（${Math.round(h)} 小時前）` : `（${Math.round(h / 24)} 天前）`; };
        bar.innerHTML = d.source === 'live'
          ? [['分數', at, '每日 22:00 重算'], ['重訊', f.ann_at, '每日'], ['新聞', f.news_at, '每週一']].map(([k, v, c]) =>
              `<span class="fb-item"><b>${k}</b> ${esc(t(v))}<span class="fb-age">${age(v)}</span><span class="fb-cycle">${c}</span></span>`).join('')
          : `<span class="fb-item uc-warn">顯示靜態快照（${esc(d.generated_at)}）</span>`;
      }
    } catch (e) {
      box.innerHTML = '<div class="uc-title uc-warn">資料載入失敗</div><div class="uc-line">請稍後重新整理。</div>';
      const bar = document.getElementById('fresh-bar'); if (bar) bar.innerHTML = '<span class="uc-warn">資料時效無法載入</span>';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  return { setCrumbs, setTitle, setExport, NAME };
})();
