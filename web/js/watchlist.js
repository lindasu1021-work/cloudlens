/**
 * 我的觀察清單（docs/09_v4角色旅程與平台設計.md 第 4 節）：存在瀏覽器 localStorage（cl:watch），不寫入後端。
 * 帳戶池公司：加入後若有新的觸發事件（日期晚於加入時間）標示「新事件」；輕量評估的公司提供重新查詢連結。
 */
(async () => {
  const { esc, tierBadge } = CL;
  const $ = id => document.getElementById(id);
  const d = await CL.load().catch(() => null);
  function newEvents(w) {
    const a = d && w.code && d.byCode[w.code];
    if (!a) return { a: null, fresh: [], last: null };
    const ev = a.docs.filter(x => x.parts.some(p => p.type === 'T1'));
    return { a, fresh: ev.filter(x => new Date(x.at) > new Date(w.added_at)), last: ev[0] || null };
  }
  function render() {
    const list = Lead.watchList().slice().reverse();
    if (!list.length) {
      $('wlist').innerHTML = `<li class="empty-state" style="display:block">清單是空的。可以在 <a href="lookup.html">Lead 速查</a>、<a href="radar.html">觸發事件雷達</a> 或帳戶頁按「加入觀察清單」。</li>`;
      return;
    }
    const rows = list.map(w => ({ w, ...newEvents(w) })).sort((x, y) => y.fresh.length - x.fresh.length);
    $('wlist').innerHTML = rows.map(({ w, a, fresh, last }) => {
      const link = a ? `account.html?code=${w.code}` : `lookup.html?q=${encodeURIComponent(w.tax_id || w.code || w.name)}`;
      return `<li><div><div class="wl-name"><a href="${link}">${esc(w.name)}</a>${fresh.length ? `<span class="wl-new">新事件 ${fresh.length}</span>` : ''}</div>
          <div class="wl-meta">${a ? `${w.code}・${esc(a.industry)}・` : w.tax_id ? `統編 ${esc(w.tax_id)}・輕量評估・` : ''}加入於 ${esc(String(w.added_at).slice(0, 10))}${a ? '' : '・需重新查詢才會更新'}</div></div>
        <div class="wl-actions">${a ? tierBadge(String(a.score.tier)) : ''}<button type="button" class="lk-copy" data-rm="${esc(w.key)}">移除</button></div>
        <div class="wl-ev">${last ? `最新事件：${esc(String(last.at).slice(0, 10))} ${esc(last.title)}` : a ? '近一年沒有觸發事件' : ''}</div></li>`;
    }).join('');
    $('wlist').querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { Lead.removeWatch(b.dataset.rm); render(); }));
  }
  $('wl-export').addEventListener('click', () => {
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const rows = Lead.watchList().map(w => { const { a, fresh, last } = newEvents(w); return [w.name, w.code, w.tax_id, a ? (CL.LABELS.tier[a.score.tier] || a.score.tier) : '輕量評估', w.added_at.slice(0, 10), fresh.length, last ? last.at.slice(0, 10) + ' ' + last.title : '']; });
    Lead.download('觀察清單.csv', '﻿' + [['公司', '代號', '統編', 'Tier', '加入日', '新事件數', '最新事件'], ...rows].map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
  });
  render();
})();
