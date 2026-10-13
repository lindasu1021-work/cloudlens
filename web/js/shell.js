/**
 * App 外殼（docs/06_UI改版需求_v3.md 第 3 節）：左側欄＋頂部列，四頁共用。
 * 頁面只需在 <body> 設 data-page（overview｜account｜methodology｜status）與 data-title，
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
    download: '<path d="M12 4v11"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M5 19.5h14"/>'
  };
  const svg = (k, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  const NAV = [
    { group: '主要', items: [{ id: 'overview', label: '總覽', href: 'index.html' }, { id: 'accounts', label: '帳戶清單', href: 'index.html#accounts' }] },
    { group: '洞察', items: [{ id: 'methodology', label: '方法論', href: 'methodology.html' }] },
    { group: '系統', items: [{ id: 'status', label: '資料狀態', href: 'status.html' }] }
  ];
  const PAGE_NAV = { overview: 'overview', account: 'accounts', methodology: 'methodology', status: 'status' };
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
      <a class="side-brand" href="index.html" aria-label="${NAME}，回總覽"><span class="side-mark">企業雲端<span>商機洞察</span></span></a>
      <nav class="side-nav" aria-label="主要導覽">
        ${NAV.map(g => `<div class="side-group"><div class="side-group-title">${g.group}</div>
          ${g.items.map(i => `<a class="side-item" href="${i.href}" ${i.id === active ? 'aria-current="page"' : ''} title="${i.label}">
            <span class="side-ico">${svg(i.id === 'accounts' ? 'accounts' : i.id)}</span><span class="side-label">${i.label}</span>
            ${i.id === active ? '<span class="side-dot" aria-hidden="true"></span>' : ''}</a>`).join('')}</div>`).join('')}
      </nav>
      <div class="update-card" id="update-card" aria-live="polite"><div class="uc-title">資料更新</div><div class="uc-line muted">載入中…</div></div>`;

    const wrap = document.createElement('div');
    wrap.className = 'shell-main';
    const top = document.createElement('header');
    top.className = 'topbar';
    top.innerHTML = `
      <div class="top-title"><h1 id="top-title">${esc(title)}</h1><div class="crumbs" id="crumbs" aria-label="麵包屑"></div></div>
      <div class="top-actions">
        <div class="gsearch">
          <span class="gs-ico">${svg('search', 18)}</span>
          <input id="gsearch" type="search" role="combobox" aria-expanded="false" aria-controls="gs-list" aria-autocomplete="list"
                 placeholder="搜尋公司名稱或代號" autocomplete="off" aria-label="搜尋公司">
          <kbd aria-hidden="true">⌘K</kbd>
          <ul id="gs-list" class="gs-list" role="listbox" hidden></ul>
        </div>
        <button type="button" class="btn-dark export-btn" id="export-csv">${svg('download', 16)}<span>匯出 CSV</span></button>
      </div>`;

    // 把導覽列以外的頁面內容搬進內容區（節點保留，頁面腳本以 id 取用不受影響）
    const keep = [...document.body.children].filter(n => n !== side && n.tagName !== 'SCRIPT');
    const app = document.createElement('div');
    app.className = 'app';
    wrap.appendChild(top);
    keep.forEach(n => wrap.appendChild(n));
    app.appendChild(side);
    app.appendChild(wrap);
    document.body.insertBefore(app, document.body.firstChild);
    setCrumbs([]);
    bindSearch();
    document.getElementById('export-csv').addEventListener('click', exportCsv);
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); document.getElementById('gsearch').focus(); }
    });
    fillUpdateCard();
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

  // ---------- 資料更新卡 ----------
  async function fillUpdateCard() {
    const box = document.getElementById('update-card');
    try {
      const d = await CL.load();
      const at = String(d.updated_at || '').replace('T', ' ').slice(0, 16) || d.generated_at;
      box.innerHTML = d.source === 'live'
        ? `<div class="uc-title">資料更新</div><div class="uc-main">${d.run_id}・規則 v${d.rule_version}</div>
           <div class="uc-line">上次：${esc(at)}</div><div class="uc-line">下次：週一 05:00</div>`
        : `<div class="uc-title uc-warn">目前顯示靜態快照</div><div class="uc-line">無法連線後端，資料為 ${esc(d.generated_at)} 的備份。</div>`;
    } catch (e) {
      box.innerHTML = '<div class="uc-title uc-warn">資料載入失敗</div><div class="uc-line">請稍後重新整理。</div>';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  return { setCrumbs, setTitle, setExport, NAME };
})();
