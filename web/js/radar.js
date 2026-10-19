/**
 * 觸發事件雷達（docs/09_v4角色旅程與平台設計.md 第 5.3 節）：帳戶池公司的觸發事件（重大訊息主旨命中事件類型，T1）。
 * 頂部：近 7／30 天事件數與類型分布（可點，套用篩選）；事件流可依期間、產業、類型、Play、Tier 篩選；每列可加入觀察清單或開啟帳戶。
 */
(async () => {
  const { esc, LABELS, tierBadge } = CL;
  const $ = id => document.getElementById(id);
  const d = await CL.load();
  const now = new Date(d.generated_at + 'T23:59:59+08:00').getTime();
  const age = at => (now - new Date(at).getTime()) / 864e5;
  // 一份文件（同一則重訊）只列一次；事件類型取 T1 子類型
  const events = [];
  d.accounts.forEach(a => a.docs.forEach(doc => {
    const t1 = doc.parts.filter(p => p.type === 'T1');
    if (!t1.length) return;
    events.push({ at: doc.at, code: a.code, name: a.name, industry: a.industry, tier: String(a.score.tier), type: t1[0].cat,
                  types: [...new Set(t1.map(p => p.cat))], play: doc.play || '', title: doc.title, url: doc.url, src: doc.src });
  }));
  events.sort((x, y) => String(y.at).localeCompare(String(x.at)));
  const typeName = t => LABELS.cat[t] || t;
  const in30 = events.filter(e => age(e.at) <= 30);
  $('k7').textContent = events.filter(e => age(e.at) <= 7).length;
  $('k30').textContent = in30.length;
  $('kt1').textContent = new Set(in30.filter(e => e.tier === '1').map(e => e.code)).size + ' 家';
  $('rk-sub').textContent = `${d.run_id}・資料截至 ${d.generated_at}`;
  const cnt = {};
  in30.forEach(e => e.types.forEach(t => { cnt[t] = (cnt[t] || 0) + 1; }));
  const mx = Math.max(1, ...Object.values(cnt));
  $('ktypes').innerHTML = Object.keys(cnt).length ? Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([t, n]) => `<button type="button" class="rt-row kpi-type" data-type="${esc(t)}" style="background:none;border:0;padding:0;font:inherit;cursor:pointer;text-align:left">
      <span>${esc(typeName(t))}</span><span class="rt-bar"><i style="width:${n / mx * 100}%"></i></span><b>${n}</b></button>`).join('') : '<span class="band-label">近 30 天沒有事件</span>';

  // 篩選選項
  const opts = (id, vals, label) => { $(id).insertAdjacentHTML('beforeend', vals.map(v => `<option value="${esc(v)}">${esc(label(v))}</option>`).join('')); };
  opts('f-ind', [...new Set(d.accounts.map(a => a.industry))], v => v);
  opts('f-type', [...new Set(events.flatMap(e => e.types))], typeName);
  opts('f-play', ['Migration', 'Data', 'GenAI', 'Security'], v => LABELS.play[v]);
  // 網址參數可帶入篩選（KPI 與其他頁可直接連過來）
  const qp = new URLSearchParams(location.search);
  ['days', 'ind', 'type', 'play', 'tier'].forEach(k => { if (qp.get(k) !== null) $('f-' + k).value = qp.get(k); });

  let limit = 50;
  function render() {
    const f = { days: Number($('f-days').value), ind: $('f-ind').value, type: $('f-type').value, play: $('f-play').value, tier: $('f-tier').value };
    const list = events.filter(e => age(e.at) <= f.days && (!f.ind || e.industry === f.ind) && (!f.type || e.types.includes(f.type))
      && (!f.play || e.play === f.play) && (!f.tier || e.tier === f.tier));
    $('rl-hint').textContent = `共 ${list.length} 則・${new Set(list.map(e => e.code)).size} 家公司・依日期新到舊`;
    $('rlist').innerHTML = list.length ? list.slice(0, limit).map((e, i) => {
      const key = 'code:' + e.code, on = Lead.inWatch(key);
      return `<li><time>${esc(String(e.at).slice(0, 10))}</time>
        <div class="rl-co"><a href="account.html?code=${e.code}">${esc(e.name)}</a><span class="muted">${e.code}・${esc(e.industry)}</span></div>
        <div class="rl-ev">${e.types.map(t => `<span class="rl-type">${esc(typeName(t))}</span>`).join('')}${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</div>
        <div class="rl-meta">${e.play ? CL.playTag(e.play) : ''}${tierBadge(e.tier)}
          <button type="button" class="lk-copy" data-watch="${i}" aria-pressed="${on}">${on ? '觀察中' : '＋觀察'}</button></div></li>`;
    }).join('') : '<li class="muted">沒有符合條件的事件</li>';
    $('rmore').hidden = list.length <= limit;
    $('rmore').textContent = `再顯示 ${Math.min(50, list.length - limit)} 則`;
    $('rlist').querySelectorAll('[data-watch]').forEach(b => b.addEventListener('click', () => {
      const e = list[Number(b.dataset.watch)];
      const on = Lead.toggleWatch({ key: 'code:' + e.code, name: e.name, code: e.code, mode: 'full' });
      document.querySelectorAll('[data-watch]').forEach(x => { const ee = list[Number(x.dataset.watch)]; if (ee.code === e.code) { x.setAttribute('aria-pressed', String(on)); x.textContent = on ? '觀察中' : '＋觀察'; } });
    }));
    const sp = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v && !(k === 'days' && v === 30)) sp.set(k, v); });
    history.replaceState(null, '', sp.toString() ? '?' + sp : location.pathname);
  }
  ['f-days', 'f-ind', 'f-type', 'f-play', 'f-tier'].forEach(id => $(id).addEventListener('change', () => { limit = 50; render(); }));
  $('rmore').addEventListener('click', () => { limit += 50; render(); });
  document.querySelectorAll('.kpi-btn').forEach(b => b.addEventListener('click', () => {
    $('f-days').value = b.dataset.days; $('f-tier').value = b.dataset.tier || ''; $('f-type').value = ''; limit = 50; render();
    $('rl-title').scrollIntoView({ behavior: 'smooth' });
  }));
  document.querySelectorAll('.kpi-type').forEach(b => b.addEventListener('click', () => {
    $('f-days').value = '30'; $('f-type').value = b.dataset.type; limit = 50; render(); $('rl-title').scrollIntoView({ behavior: 'smooth' });
  }));
  render();
})();
