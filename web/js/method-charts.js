/**
 * 方法論頁圖表（docs/06_UI改版需求_v3.md 第 6 節）。純 SVG／HTML，顏色一律取自 tokens.css 變數。
 * 資料全部來自 GET ?action=methodology，這裡不放任何數字。
 */
const MC = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  };
  const text = (parent, x, y, s, attrs = {}) => { const t = el('text', { x, y, 'font-size': 12, fill: 'var(--ink-600)', ...attrs }, parent); t.textContent = s; return t; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 共用提示框
  let tipEl = null;
  function tip(e, html) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tooltip floating'; tipEl.setAttribute('role', 'status'); document.body.appendChild(tipEl); }
    tipEl.innerHTML = html; tipEl.style.display = 'block';
    const r = tipEl.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  const untip = () => { if (tipEl) tipEl.style.display = 'none'; };
  const hover = (n, html) => { n.addEventListener('mousemove', e => tip(e, typeof html === 'function' ? html() : html)); n.addEventListener('mouseleave', untip); };
  const empty = (host, msg) => { host.innerHTML = `<p class="empty">${esc(msg)}</p>`; };

  // ---------- 2 漏斗圖：灰階由深到淺，最後一層橘 ----------
  function funnel(host, steps) {
    if (!steps || !steps.length || !steps[0].n) return empty(host, '沒有漏斗資料');
    const GRAY = ['var(--ink-600)', 'var(--gray-400)', 'var(--gray-300)', 'var(--gray-200)'];
    const max = steps[0].n;
    host.innerHTML = `<div class="funnel">${steps.map((s, i) => {
      const last = i === steps.length - 1;
      const w = Math.max(6, s.n / max * 100);
      const prev = i ? steps[i - 1].n : null;
      const keep = prev ? Math.round(s.n / prev * 100) : null;
      const bg = last ? 'var(--orange-600)' : GRAY[Math.min(i, GRAY.length - 1)];
      const ink = last || i === 0 ? 'var(--white)' : 'var(--ink-900)';
      return `<div class="fn-row"><div class="fn-label">${esc(s.label)}</div>
        <div class="fn-track"><div class="fn-bar" style="width:${w}%;background:${bg};color:${ink}" data-tip="<b>${esc(s.label)}</b>${s.n.toLocaleString()} 家${keep !== null ? '・留存 ' + keep + '%（上一層 ' + prev.toLocaleString() + ' 家）' : ''}">
          <span class="fn-n">${s.n.toLocaleString()}</span></div>${keep !== null ? `<span class="fn-keep">${keep}%</span>` : ''}</div></div>`;
    }).join('')}</div>`;
    host.querySelectorAll('[data-tip]').forEach(n => hover(n, n.dataset.tip));
  }

  // ---------- 3a 兩軸＋Tier 示意圖 ----------
  function quadSchema(host, cutPct) {
    host.innerHTML = '';
    const W = 420, H = 300, m = { l: 36, r: 10, t: 10, b: 34 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '兩軸四象限示意圖：Need 與 Timing，各軸前 30% 為高' }, host);
    const cx = m.l + iw / 2, cy = m.t + ih / 2;   // 示意圖：四格等大（真實門檻見 3d）
    const Q = [
      { x: m.l, y: m.t, w: cx - m.l, h: cy - m.t, t: 'Tier 2 培養', d: '需求高、時機未到', f: 'var(--orange-400)' },
      { x: cx, y: m.t, w: m.l + iw - cx, h: cy - m.t, t: 'Tier 1 立即開發', d: '需求高、時機到', f: 'var(--orange-600)' },
      { x: m.l, y: cy, w: cx - m.l, h: m.t + ih - cy, t: '暫緩', d: '需求與時機皆低', f: 'var(--gray-300)' },
      { x: cx, y: cy, w: m.l + iw - cx, h: m.t + ih - cy, t: 'Tier 3 事件型輕觸', d: '時機到、需求低', f: 'var(--orange-200)' }
    ];
    Q.forEach(q => {
      el('rect', { x: q.x + 1, y: q.y + 1, width: q.w - 2, height: q.h - 2, rx: 12, fill: q.f, stroke: 'var(--ink-900)', 'stroke-width': 0.8 }, svg);
      const hot = q.t.startsWith('Tier 1');
      text(svg, q.x + q.w / 2, q.y + q.h / 2 - 2, q.t, { 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: hot ? 'var(--white)' : 'var(--ink-900)' });
      text(svg, q.x + q.w / 2, q.y + q.h / 2 + 15, q.d, { 'text-anchor': 'middle', 'font-size': 11, fill: hot ? 'var(--white)' : 'var(--ink-900)' });
    });
    text(svg, m.l + iw / 2, H - 8, `Timing 時機　→　前 ${Math.round(cutPct * 100)}% 為「高」`, { 'text-anchor': 'middle' });
    text(svg, 12, m.t + ih / 2, `Need 需求強度　→`, { 'text-anchor': 'middle', transform: `rotate(-90 12 ${m.t + ih / 2})` });
  }

  // ---------- 3b 權重組成：百分比堆疊長條（可展開） ----------
  function weights(host, axes, onPick) {
    host.innerHTML = axes.map(ax => {
      const tot = ax.parts.reduce((a, p) => a + p.max, 0);
      return `<div class="wt-axis"><div class="wt-title"><b>${esc(ax.name)}</b><span class="muted">滿分 ${tot}</span></div>
        <div class="wt-bar" role="group" aria-label="${esc(ax.name)}權重">${ax.parts.map(p => `
          <button type="button" class="wt-seg${p.disabled ? ' off' : ''}" style="flex:${p.max} 1 0" data-key="${p.key}" aria-expanded="false" aria-controls="wt-rule-${p.key}"
            data-tip="<b>${esc(p.key)} ${esc(p.name)}</b>滿分 ${p.max}${p.disabled ? '（目前停用：' + esc(p.code) + '）' : ''}">
            <span class="wt-k">${p.key}</span><span class="wt-n">${esc(p.name)}</span><span class="wt-m">${p.max}${p.disabled ? '・' + esc(p.code) : ''}</span>
          </button>`).join('')}</div>
        ${ax.parts.map(p => `<div class="wt-rule" id="wt-rule-${p.key}" hidden><b>${p.key} ${esc(p.name)}</b>（${p.max} 分${p.disabled ? '，目前停用' : ''}）<br>${p.rule}</div>`).join('')}</div>`;
    }).join('');
    host.querySelectorAll('.wt-seg').forEach(b => {
      hover(b, b.dataset.tip);
      b.addEventListener('click', () => {
        const open = b.getAttribute('aria-expanded') === 'true';
        b.closest('.wt-axis').querySelectorAll('.wt-seg').forEach(x => x.setAttribute('aria-expanded', 'false'));
        b.closest('.wt-axis').querySelectorAll('.wt-rule').forEach(x => { x.hidden = true; });
        if (!open) { b.setAttribute('aria-expanded', 'true'); document.getElementById('wt-rule-' + b.dataset.key).hidden = false; }
        if (onPick) onPick(b.dataset.key, !open);
      });
    });
  }

  // ---------- 3c 計分機制小圖 ----------
  function curve(host, opt) {
    host.innerHTML = '';
    const W = 300, H = 190, m = { l: 40, r: 14, t: 14, b: 38 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opt.label }, host);
    const x = v => m.l + (v - opt.x0) / (opt.x1 - opt.x0) * iw, y = v => m.t + ih - v * ih;
    [0, 0.5, 1].forEach(v => {
      el('line', { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v), stroke: 'var(--gray-200)' }, svg);
      text(svg, m.l - 6, y(v) + 4, Math.round(v * 100) + '%', { 'text-anchor': 'end', 'font-size': 10 });
    });
    el('line', { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, stroke: 'var(--gray-300)' }, svg);
    let d = '';
    opt.points.forEach((p, i) => { d += (i ? (opt.step ? `H${x(p[0])}V` + y(p[1]) : `L${x(p[0])} ${y(p[1])}`) : `M${x(p[0])} ${y(p[1])}`); });
    if (opt.step) d = opt.points.map((p, i) => i ? `H${x(p[0])}V${y(p[1])}` : `M${x(p[0])} ${y(p[1])}`).join('');
    el('path', { d, fill: 'none', stroke: 'var(--chart-mark)', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, svg);
    opt.marks.forEach(p => {
      const c = el('circle', { cx: x(p[0]), cy: y(p[1]), r: 4.5, fill: 'var(--chart-mark)', stroke: 'var(--ink-900)', 'stroke-width': 1 }, svg);
      hover(c, `<b>${esc(p[2])}</b>${esc(p[3])}`);
      text(svg, x(p[0]), y(p[1]) + (p[1] >= 0.95 && opt.step ? 18 : -9), p[3], { 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--ink-900)' });
    });
    opt.xticks.forEach(([v, t]) => text(svg, x(v), H - 20, t, { 'text-anchor': 'middle', 'font-size': 10 }));
    text(svg, m.l + iw / 2, H - 4, opt.xlabel, { 'text-anchor': 'middle', 'font-size': 11 });
    text(svg, 10, m.t + ih / 2, opt.ylabel, { 'text-anchor': 'middle', 'font-size': 11, transform: `rotate(-90 10 ${m.t + ih / 2})` });
  }

  // ---------- 3d 直方圖 ----------
  function histogram(host, bins, cut, label) {
    host.innerHTML = '';
    const total = bins.reduce((a, b) => a + b, 0);
    if (!total) return empty(host, '沒有分數資料');
    const W = 300, H = 190, m = { l: 34, r: 10, t: 16, b: 34 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${label} 分數分布，前 30% 門檻 ${cut === null ? '無' : cut.toFixed(1)} 分` }, host);
    const max = Math.max(...bins), bw = iw / bins.length;
    el('line', { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, stroke: 'var(--gray-300)' }, svg);
    text(svg, m.l - 6, m.t + 8, String(max), { 'text-anchor': 'end', 'font-size': 10 });
    text(svg, m.l - 6, m.t + ih + 4, '0', { 'text-anchor': 'end', 'font-size': 10 });
    bins.forEach((n, i) => {
      const h = n / max * ih, lo = i * 10, over = cut !== null && lo + 10 > cut && lo >= Math.floor(cut / 10) * 10 && lo + 10 > cut;
      const r = el('rect', { x: m.l + i * bw + 2, y: m.t + ih - h, width: bw - 4, height: Math.max(h, n ? 1 : 0), rx: 3,
        fill: over ? 'var(--chart-mark)' : 'var(--gray-300)' }, svg);
      hover(r, `<b>${lo}–${lo + 10} 分</b>${n} 家${over ? '（落在前 30% 門檻以上）' : ''}`);
      if (i % 2 === 0) text(svg, m.l + i * bw, H - 20, String(lo), { 'text-anchor': 'middle', 'font-size': 10 });
    });
    text(svg, m.l + iw, H - 20, '100', { 'text-anchor': 'middle', 'font-size': 10 });
    if (cut !== null) {
      const cxp = m.l + cut / 100 * iw;
      el('line', { x1: cxp, x2: cxp, y1: m.t - 4, y2: m.t + ih, stroke: 'var(--ink-900)', 'stroke-dasharray': '4 3', 'stroke-width': 1.5 }, svg);
      text(svg, cxp + 4, m.t + 4, `前 30%：${cut.toFixed(1)} 分`, { 'font-size': 10, fill: 'var(--ink-900)' });
    }
    text(svg, m.l + iw / 2, H - 4, `${label}（0–100）・縱軸＝家數`, { 'text-anchor': 'middle', 'font-size': 11 });
  }

  // ---------- 4 樹狀圖（slice-and-dice） ----------
  function treemap(host, items) {
    const vis = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value);
    if (!vis.length) return empty(host, '沒有命中資料');
    host.innerHTML = '<div class="treemap" role="img" aria-label="各字典類別命中次數樹狀圖"></div>';
    const root = host.firstChild, tipHtml = i => `<b>${esc(i.label)}</b>${i.value} 次命中`;
    (function lay(list, x, y, w, h, vertical) {
      if (!list.length) return;
      const total = list.reduce((a, b) => a + b.value, 0);
      if (list.length === 1) { place(list[0], x, y, w, h); return; }
      // 第一塊占比切一刀，其餘遞迴（交替切割方向）
      const first = list[0], f = first.value / total;
      if (vertical) { place(first, x, y, w * f, h); lay(list.slice(1), x + w * f, y, w * (1 - f), h, false); }
      else { place(first, x, y, w, h * f); lay(list.slice(1), x, y + h * f, w, h * (1 - f), true); }
    })(vis, 0, 0, 100, 100, true);
    function place(i, x, y, w, h) {
      const d = document.createElement('div');
      d.className = 'tm-cell';
      d.style.cssText = `left:${x}%;top:${y}%;width:${w}%;height:${h}%;background:${i.fill};color:${i.ink}`;
      d.innerHTML = `<b>${esc(i.label)}</b><span>${i.value}</span>`;
      d.tabIndex = 0;
      hover(d, tipHtml(i));
      root.appendChild(d);
    }
  }

  // ---------- 4 熱度圖：類別 × 產業 ----------
  function heatmap(host, rows, cols, get) {
    const vals = rows.flatMap(r => cols.map(c => get(r, c)));
    const max = Math.max(...vals, 1);
    const level = v => v <= 0 ? 0 : Math.min(4, Math.ceil(v / max * 4));
    const FILL = ['var(--gray-100)', 'var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)'];
    host.innerHTML = `<div class="heat" style="grid-template-columns:120px repeat(${cols.length},1fr)">
      <div></div>${cols.map(c => `<div class="heat-h">${esc(c)}</div>`).join('')}
      ${rows.map(r => `<div class="heat-r">${esc(r.label)}</div>${cols.map(c => {
        const v = get(r, c), l = level(v);
        return `<div class="heat-c" style="background:${FILL[l]};color:${l === 4 ? 'var(--white)' : 'var(--ink-900)'};${l ? 'box-shadow:inset 0 0 0 1px var(--ink-900);' : ''}"
          data-tip="<b>${esc(r.label)}・${esc(c)}</b>${v} 次命中">${v}</div>`; }).join('')}`).join('')}</div>`;
    host.querySelectorAll('[data-tip]').forEach(n => hover(n, n.dataset.tip));
  }

  // ---------- 5 甜甜圈計量圖 ----------
  function donut(host, value, labelBelow) {
    host.innerHTML = '';
    const S = 180, c = S / 2, R = 70, SW = 20, C = 2 * Math.PI * R;
    const svg = el('svg', { viewBox: `0 0 ${S} ${S}`, role: 'img', 'aria-label': value === null ? '驗證集建置中' : `precision@20% ${Math.round(value * 100)}%` }, host);
    el('circle', { cx: c, cy: c, r: R, fill: 'none', stroke: value === null ? 'var(--gray-300)' : 'var(--gray-200)', 'stroke-width': SW, 'stroke-dasharray': value === null ? '4 6' : 'none' }, svg);
    if (value !== null) {
      el('circle', { cx: c, cy: c, r: R, fill: 'none', stroke: 'var(--chart-mark)', 'stroke-width': SW, 'stroke-linecap': 'round',
        'stroke-dasharray': `${C * value} ${C}`, transform: `rotate(-90 ${c} ${c})` }, svg);
    }
    const t = el('text', { x: c, y: c + 8, 'text-anchor': 'middle', 'font-size': value === null ? 18 : 34, 'font-weight': 600, fill: 'var(--ink-900)', class: 'num-font' }, svg);
    t.textContent = value === null ? '驗證集建置中' : Math.round(value * 100) + '%';
    if (labelBelow) text(svg, c, c + 28, labelBelow, { 'text-anchor': 'middle', 'font-size': 11 });
  }

  // ---------- 6 啞鈴圖 ----------
  function dumbbell(host, versions) {
    host.innerHTML = '';
    const rowH = 54, W = 560, m = { l: 70, r: 20, t: 24, b: 28 }, H = m.t + versions.length * rowH + m.b, iw = W - m.l - m.r;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '各規則版本調整前後的 precision@20%' }, host);
    const x = v => m.l + v * iw;
    [0, 0.5, 1].forEach(v => {
      el('line', { x1: x(v), x2: x(v), y1: m.t - 6, y2: H - m.b + 4, stroke: 'var(--gray-200)' }, svg);
      text(svg, x(v), H - 8, Math.round(v * 100) + '%', { 'text-anchor': 'middle', 'font-size': 10 });
    });
    versions.forEach((v, i) => {
      const y = m.t + i * rowH + rowH / 2;
      text(svg, m.l - 12, y + 4, 'v' + v.v, { 'text-anchor': 'end', 'font-size': 14, 'font-weight': 700, fill: 'var(--ink-900)' });
      const a = v.precision_before, b = v.precision_after;
      if (b === null || b === undefined) { text(svg, x(0) + 8, y + 4, '尚未驗證', { fill: 'var(--ink-500)' }); return; }
      if (a === null || a === undefined || a === b) {
        const c = el('circle', { cx: x(b), cy: y, r: 7, fill: 'var(--chart-mark)', stroke: 'var(--ink-900)', 'stroke-width': 1 }, svg);
        hover(c, `<b>v${v.v}</b>precision ${Math.round(b * 100)}%${a === null || a === undefined ? '（基準版）' : '（與上一版相同）'}`);
        text(svg, x(b) - 14, y + 4, `${Math.round(b * 100)}%${a === null || a === undefined ? '・基準版' : '・與上一版相同'}`, { 'text-anchor': 'end', fill: 'var(--ink-900)' });
      } else {
        el('line', { x1: x(a), x2: x(b), y1: y, y2: y, stroke: 'var(--ink-900)', 'stroke-width': 2 }, svg);
        const c1 = el('circle', { cx: x(a), cy: y, r: 7, fill: 'var(--gray-400)', stroke: 'var(--ink-900)', 'stroke-width': 1 }, svg);
        const c2 = el('circle', { cx: x(b), cy: y, r: 7, fill: 'var(--chart-mark)', stroke: 'var(--ink-900)', 'stroke-width': 1 }, svg);
        hover(c1, `<b>v${v.v} 調整前</b>${Math.round(a * 100)}%`); hover(c2, `<b>v${v.v} 調整後</b>${Math.round(b * 100)}%`);
      }
    });
  }

  // ---------- 7 圖形表：子項 × 產業 ----------
  function coverage(host, comps, inds, cov, reasons) {
    const ICON = {
      ok: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="var(--white)" stroke="var(--ink-900)" stroke-width="1.5"/><path d="M5.5 10.5l3 3 6-6.5" fill="none" stroke="var(--ink-900)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      disabled: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.5" height="5" fill="var(--gray-400)"/></pattern></defs><circle cx="10" cy="10" r="9" fill="url(#hatch)" stroke="var(--ink-600)" stroke-width="1.5"/></svg>',
      na: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" stroke="var(--ink-500)" stroke-width="2" stroke-linecap="round"/></svg>'
    };
    const NAME = { ok: '可用', disabled: '停用（缺資料）', na: '不適用' };
    host.innerHTML = `<table class="cov"><thead><tr><th class="plain">評分子項</th>${inds.map(i => `<th class="plain c">${esc(i)}</th>`).join('')}</tr></thead>
      <tbody>${comps.map(c => `<tr><th scope="row" class="plain">${c.key} ${esc(c.name)}</th>${inds.map(i => {
        const s = (cov[c.key] || {})[i] || { s: 'ok' };
        const why = s.s === 'ok' ? (s.note || '資料齊全') : (reasons[s.code] || '');
        return `<td class="c" tabindex="0" data-tip="<b>${c.key}・${esc(i)}：${NAME[s.s]}</b>${esc(why)}" aria-label="${c.key} ${i} ${NAME[s.s]}">${ICON[s.s]}${s.code ? `<span class="code">${s.code}</span>` : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table>
      <div class="legend cov-legend"><span>${ICON.ok}可用</span><span>${ICON.disabled}停用（缺資料，移出分母）</span><span>${ICON.na}不適用</span></div>`;
    host.querySelectorAll('[data-tip]').forEach(n => hover(n, n.dataset.tip));
  }

  return { funnel, quadSchema, weights, curve, histogram, treemap, heatmap, donut, dumbbell, coverage, hover, esc };
})();
