/**
 * 帳戶頁視覺化（docs/05_UI改版需求_v2.md 第 2 節）。純 SVG／HTML，顏色一律取自 tokens.css 的 CSS 變數。
 *  A1/A2 gauge       半圓計量圖（含前 30% 門檻刻度）
 *  A3    miniQuad    帳戶池位置迷你象限圖
 *  A4    lollipop    同產業排名棒棒糖圖（Need／Timing 切換）
 *  C     swimlane    訊號泳道點圖（顏色＋形狀＝Play、大小＝得分、背景＝時間衰減）
 *  D     control     營收管制圖（營收長條＋YoY 折線與 ±15% 門檻）
 *  E     playStack   Play 組成百分比堆疊長條
 * 每張圖都有：結論式標題（由頁面產生）、軸標籤、滑過提示、無資料時的空狀態。
 */
const AC = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  };
  const txt = (parent, x, y, s, attrs = {}) => { const t = el('text', { x, y, 'font-size': 11, fill: 'var(--ink-500)', ...attrs }, parent); t.textContent = s; return t; };
  const empty = (host, msg) => { host.innerHTML = `<p class="empty">${CL.esc(msg)}</p>`; };

  // ---------- 共用提示框 ----------
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
  function untip() { if (tipEl) tipEl.style.display = 'none'; }
  /** 讓 data-tip 屬性的 HTML 元素也有滑過提示 */
  function bindTips(scope) {
    scope.querySelectorAll('[data-tip]').forEach(n => {
      n.addEventListener('mousemove', e => tip(e, n.dataset.tip));
      n.addEventListener('mouseleave', untip);
      n.addEventListener('focus', () => { const r = n.getBoundingClientRect(); tip({ clientX: r.left, clientY: r.bottom }, n.dataset.tip); });
      n.addEventListener('blur', untip);
    });
  }
  const hover = (node, html) => {
    node.addEventListener('mousemove', e => tip(e, typeof html === 'function' ? html() : html));
    node.addEventListener('mouseleave', untip);
  };

  function markPath(shape, x, y, r) {
    switch (shape) {
      case 'square': return `M${x - r} ${y - r}h${2 * r}v${2 * r}h${-2 * r}Z`;
      case 'triangle': return `M${x} ${y - r * 1.15}L${x + r * 1.1} ${y + r * 0.85}L${x - r * 1.1} ${y + r * 0.85}Z`;
      case 'diamond': return `M${x} ${y - r * 1.25}L${x + r * 1.25} ${y}L${x} ${y + r * 1.25}L${x - r * 1.25} ${y}Z`;
      default: return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
    }
  }
  /** Play 標記：有 Play 依色＋形狀；沒有 Play（營收、新聞動能證據）用灰色空心圓 */
  function playMark(parent, play, x, y, r, extra = {}) {
    if (!play || !CL.PLAY_SHAPE[play]) return el('path', { d: markPath('circle', x, y, r), fill: 'var(--white)', stroke: 'var(--ink-500)', 'stroke-width': 1.5, ...extra }, parent);
    return el('path', { d: markPath(CL.PLAY_SHAPE[play], x, y, r), fill: CL.PLAY_COLOR[play], stroke: CL.PLAY_STROKE[play], 'stroke-width': 1, ...extra }, parent);
  }

  // ---------- A1/A2 計量圖 ----------
  function gauge(host, { value, pct, cut, tipHtml }) {
    host.innerHTML = '';
    const W = 220, H = 128, cx = 110, cy = 112, R = 88, SW = 16;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${value === null ? '無資料' : value + ' 分'}` }, host);
    const pt = v => { const a = Math.PI * (1 - v / 100); return [cx + R * Math.cos(a), cy - R * Math.sin(a)]; };
    const arc = (a, b) => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `M${x1} ${y1}A${R} ${R} 0 0 1 ${x2} ${y2}`; };
    el('path', { d: arc(0, 100), fill: 'none', stroke: 'var(--gray-200)', 'stroke-width': SW, 'stroke-linecap': 'round' }, svg);
    if (value !== null && value > 0) el('path', { d: arc(0, Math.min(100, value)), fill: 'none', stroke: 'var(--chart-mark)', 'stroke-width': SW, 'stroke-linecap': 'round' }, svg);
    if (cut !== null && cut !== undefined) {
      const a = Math.PI * (1 - cut / 100), r1 = R - SW / 2 - 4, r2 = R + SW / 2 + 4;
      el('line', { x1: cx + r1 * Math.cos(a), y1: cy - r1 * Math.sin(a), x2: cx + r2 * Math.cos(a), y2: cy - r2 * Math.sin(a), stroke: 'var(--ink-900)', 'stroke-width': 2 }, svg);
      // 門檻數值寫在計量圖下方的說明（標籤放弧上容易壓到中央數字）
    }
    txt(svg, cx - R, cy + 14, '0', { 'text-anchor': 'middle', 'font-size': 10 });
    txt(svg, cx + R, cy + 14, '100', { 'text-anchor': 'middle', 'font-size': 10 });
    el('text', { x: cx, y: cy - 22, 'text-anchor': 'middle', 'font-size': 30, 'font-weight': 700, fill: 'var(--ink-900)' }, svg).textContent = value === null ? '—' : CL.fmt(value);
    txt(svg, cx, cy - 4, pct === null ? '無資料' : `帳戶池百分位 ${Math.round(pct * 100)}`, { 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--ink-600)' });
    hover(svg, tipHtml);
  }

  // ---------- A3 迷你象限圖 ----------
  function miniQuad(host, { rows, self, needCut, timingCut, onClick }) {
    host.innerHTML = '';
    const W = 240, H = 176, m = { t: 6, r: 6, b: 22, l: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const x = v => m.l + v / 100 * iw, y = v => m.t + ih - v / 100 * ih;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `帳戶池 ${rows.length} 家的位置，本公司 Need ${self.need}、Timing ${self.timing}` }, host);
    el('rect', { x: x(timingCut), y: m.t, width: x(100) - x(timingCut), height: y(needCut) - m.t, fill: 'var(--orange-50)' }, svg);
    el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'none', stroke: 'var(--gray-300)' }, svg);
    el('line', { x1: x(timingCut), x2: x(timingCut), y1: m.t, y2: m.t + ih, stroke: 'var(--ink-500)', 'stroke-dasharray': '3 3' }, svg);
    el('line', { x1: m.l, x2: m.l + iw, y1: y(needCut), y2: y(needCut), stroke: 'var(--ink-500)', 'stroke-dasharray': '3 3' }, svg);
    txt(svg, m.l + iw - 3, m.t + 11, 'Tier 1', { 'text-anchor': 'end', 'font-size': 10, fill: 'var(--orange-800)', 'font-weight': 700 });
    txt(svg, m.l + iw / 2, H - 6, 'Timing →', { 'text-anchor': 'middle', 'font-size': 10 });
    txt(svg, 10, m.t + ih / 2, 'Need →', { 'text-anchor': 'middle', 'font-size': 10, transform: `rotate(-90 10 ${m.t + ih / 2})` });
    rows.forEach(r => { if (r.code !== self.code) el('circle', { cx: x(r.timing), cy: y(r.need), r: 2.2, fill: 'var(--gray-400)', opacity: 0.4 }, svg); });
    const me = playMark(svg, self.play, x(self.timing), y(self.need), 7, { stroke: 'var(--ink-900)', 'stroke-width': 1.5 });
    svg.style.cursor = 'pointer';
    svg.setAttribute('tabindex', '0');
    hover(svg, `<b>${CL.esc(self.name)}</b>Need ${CL.fmt(self.need)}・Timing ${CL.fmt(self.timing)}<br><span class="muted">點擊到總覽頁定位這家公司</span>`);
    svg.addEventListener('click', onClick);
    svg.addEventListener('keydown', e => { if (e.key === 'Enter') onClick(); });
    return me;
  }

  // ---------- A4 同產業排名 ----------
  function lollipop(host, { peers, selfCode, metric }) {
    host.innerHTML = '';
    if (!peers.length) return empty(host, '同產業沒有其他帳戶');
    const sorted = peers.slice().sort((a, b) => b[metric] - a[metric]);
    const rank = sorted.findIndex(p => p.code === selfCode) + 1;
    let show = sorted.slice(0, 10);
    if (rank > 10) show = show.concat([sorted[rank - 1]]);
    const rowH = 15, W = 260, L = 64, R = 30, H = show.length * rowH + 8 + (rank > 10 ? 8 : 0);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `同產業 ${sorted.length} 家中排第 ${rank}` }, host);
    const x = v => L + v / 100 * (W - L - R);
    show.forEach((p, i) => {
      const yy = 10 + i * rowH + (rank > 10 && i === 10 ? 8 : 0), me = p.code === selfCode;
      if (rank > 10 && i === 10) txt(svg, L - 6, yy - 9, '⋯', { 'text-anchor': 'end' });
      txt(svg, L - 6, yy + 4, (me ? '' : '') + p.name.slice(0, 5), { 'text-anchor': 'end', 'font-size': 10.5, fill: me ? 'var(--ink-900)' : 'var(--ink-600)', 'font-weight': me ? 700 : 400 });
      el('line', { x1: x(0), x2: x(p[metric]), y1: yy, y2: yy, stroke: me ? 'var(--chart-mark)' : 'var(--gray-400)', 'stroke-width': me ? 2.5 : 1.5 }, svg);
      el('circle', { cx: x(p[metric]), cy: yy, r: me ? 4.5 : 3, fill: me ? 'var(--chart-mark)' : 'var(--gray-400)' }, svg);
      txt(svg, x(p[metric]) + 7, yy + 4, CL.fmt(p[metric]), { 'font-size': 10, fill: me ? 'var(--ink-900)' : 'var(--ink-500)', 'font-weight': me ? 700 : 400 });
      const hit = el('rect', { x: 0, y: yy - rowH / 2, width: W, height: rowH, fill: 'transparent' }, svg);
      hover(hit, `<b>${CL.esc(p.name)} ${p.code}</b>第 ${sorted.indexOf(p) + 1} 名・${metric === 'need' ? 'Need' : 'Timing'} ${CL.fmt(p[metric])}`);
    });
    return rank;
  }

  // ---------- C 訊號泳道點圖 ----------
  function swimlane(host, { docs, refDate, onPick }) {
    host.innerHTML = '';
    const LANES = [['announcement', '重大訊息'], ['news', '新聞'], ['revenue', '月營收'], ['esg', 'ESG']];
    const W = 820, laneH = 42, m = { t: 24, r: 16, b: 26, l: 70 }, iw = W - m.l - m.r, H = m.t + LANES.length * laneH + m.b;
    const end = new Date(refDate + 'T23:59:59+08:00').getTime(), start = end - 365 * 864e5;
    const x = t => m.l + (t - start) / (end - start) * iw;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `近 365 天訊號 ${docs.length} 份，依來源分泳道` }, host);
    // 時間衰減色帶
    const d30 = end - 30 * 864e5, d90 = end - 90 * 864e5;
    el('rect', { x: x(d30), y: m.t, width: x(end) - x(d30), height: LANES.length * laneH, fill: 'var(--orange-50)' }, svg);
    el('rect', { x: x(d90), y: m.t, width: x(d30) - x(d90), height: LANES.length * laneH, fill: 'var(--gray-100)' }, svg);
    txt(svg, (x(d30) + x(end)) / 2, m.t - 8, '×1.0', { 'text-anchor': 'middle', fill: 'var(--orange-800)', 'font-weight': 700 });
    txt(svg, (x(d90) + x(d30)) / 2, m.t - 8, '×0.5', { 'text-anchor': 'middle', fill: 'var(--ink-600)' });
    txt(svg, (m.l + x(d90)) / 2, m.t - 8, '超過 90 天：只計入 Need，不計入 Timing', { 'text-anchor': 'middle' });
    LANES.forEach(([k, name], i) => {
      const yy = m.t + i * laneH;
      el('line', { x1: m.l, x2: m.l + iw, y1: yy + laneH, y2: yy + laneH, stroke: 'var(--gray-300)' }, svg);
      txt(svg, m.l - 8, yy + laneH / 2 + 4, name, { 'text-anchor': 'end', 'font-size': 12, fill: 'var(--ink-600)' });
    });
    for (let mo = 0; mo <= 12; mo += 2) {
      const t = new Date(end); t.setMonth(t.getMonth() - mo); t.setDate(1);
      if (t.getTime() < start) continue;
      el('line', { x1: x(t.getTime()), x2: x(t.getTime()), y1: m.t + LANES.length * laneH, y2: m.t + LANES.length * laneH + 4, stroke: 'var(--gray-400)' }, svg);
      txt(svg, x(t.getTime()), H - 8, `${t.getFullYear() % 100}/${t.getMonth() + 1}`, { 'text-anchor': 'middle' });
    }
    if (!docs.length) { txt(svg, W / 2, m.t + LANES.length * laneH / 2, '近 365 天沒有訊號', { 'text-anchor': 'middle', 'font-size': 13 }); return; }
    // 同一泳道相近日期的點垂直錯開（beeswarm）
    LANES.forEach(([k], li) => {
      const yc = m.t + li * laneH + laneH / 2;
      const placed = [];
      docs.filter(d => d.lane === k && new Date(d.at).getTime() >= start).sort((a, b) => b.points - a.points).forEach(d => {
        const r = Math.min(10, 3.5 + Math.sqrt(Math.max(0, d.points)) * 1.1), cx = x(new Date(d.at).getTime());
        let off = 0, n = 0;
        while (placed.some(p => Math.abs(p.x - cx) < p.r + r && Math.abs(p.y - (yc + off)) < p.r + r) && n < 12) { n++; off = (n % 2 ? -1 : 1) * Math.ceil(n / 2) * (r + 1.5); }
        placed.push({ x: cx, y: yc + off, r });
        const mk = playMark(svg, d.play, cx, yc + Math.max(-laneH / 2 + r, Math.min(laneH / 2 - r, off)), r, { tabindex: 0, role: 'button', 'aria-label': `${d.ref} ${String(d.at).slice(0, 10)} ${d.title}` });
        mk.style.cursor = 'pointer';
        hover(mk, `<b>${d.ref}・${String(d.at).slice(0, 10)}</b>${CL.esc(d.title)}<br><span class="muted">${d.kinds.join('、')}・得分 ${CL.fmt(d.points)}</span>`);
        mk.addEventListener('click', () => onPick(d.ref));
        mk.addEventListener('keydown', e => { if (e.key === 'Enter') onPick(d.ref); });
      });
    });
  }

  // ---------- D 營收管制圖 ----------
  function control(host, { rows, applicable }) {
    host.innerHTML = '';
    if (!rows.length) return empty(host, '沒有月營收資料');
    const W = 820, m = { l: 56, r: 16 }, iw = W - m.l - m.r, topH = 110, gap = 30, botH = 110, H = 14 + topH + gap + botH + 26;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '近 15 個月營收與年增率管制圖' }, host);
    const bw = iw / rows.length, maxRev = Math.max(...rows.map(r => r[1])) || 1;
    const top0 = 14, bot0 = top0 + topH + gap;
    txt(svg, m.l - 8, top0 + 4, `${(maxRev / 1e5).toFixed(0)} 億`, { 'text-anchor': 'end' });
    txt(svg, m.l - 8, top0 + topH, '0', { 'text-anchor': 'end' });
    txt(svg, 4, top0 + topH / 2, '月營收', { 'font-size': 11, fill: 'var(--ink-600)' });
    el('line', { x1: m.l, x2: m.l + iw, y1: top0 + topH, y2: top0 + topH, stroke: 'var(--gray-300)' }, svg);
    const yoys = rows.map(r => r[2] === '' || r[2] === null ? null : Number(r[2]));
    const vals = yoys.filter(v => v !== null);
    // 金融業等極端年增率會把 ±15% 門檻擠在一起：Y 軸截在 ±100%，超出的點畫在邊緣並標實際值
    const CAP = 100;
    const lo = Math.max(-CAP, Math.min(-25, ...vals)), hi = Math.min(CAP, Math.max(25, ...vals));
    const clamp = v => Math.max(lo, Math.min(hi, v));
    const yy = v => bot0 + botH - (clamp(v) - lo) / (hi - lo) * botH;
    const lineColor = 'var(--gray-400)'; // ±15% 門檻線一律灰（金融業不適用時同色，標題另行說明）
    [15, -15].forEach(v => {
      el('line', { x1: m.l, x2: m.l + iw, y1: yy(v), y2: yy(v), stroke: lineColor, 'stroke-dasharray': '5 4' }, svg);
      txt(svg, m.l - 8, yy(v) + 4, (v > 0 ? '+' : '') + v + '%', { 'text-anchor': 'end', fill: applicable ? 'var(--ink-600)' : 'var(--ink-500)' });
    });
    el('line', { x1: m.l, x2: m.l + iw, y1: yy(0), y2: yy(0), stroke: 'var(--gray-300)' }, svg);
    txt(svg, m.l - 8, yy(0) + 4, '0%', { 'text-anchor': 'end' });
    txt(svg, 4, bot0 + 10, 'YoY', { 'font-size': 11, fill: 'var(--ink-600)' });
    let path = '';
    rows.forEach((r, i) => {
      const bx = m.l + i * bw + 3, h = Math.max(2, r[1] / maxRev * topH), recent = applicable && i >= rows.length - 3; // 最新 3 個月＝T3 判斷區間
      el('path', { d: `M${bx} ${top0 + topH}V${top0 + topH - h + 3}q0 -3 3 -3h${bw - 12}q3 0 3 3V${top0 + topH}Z`, fill: recent ? 'var(--chart-mark)' : 'var(--gray-300)' }, svg);
      if (i === 0 || i === rows.length - 1 || i % 3 === 0) txt(svg, bx + (bw - 6) / 2, H - 6, r[0].slice(2).replace('-', '/'), { 'text-anchor': 'middle' });
      const v = yoys[i];
      if (v !== null) path += (path ? 'L' : 'M') + (bx + (bw - 6) / 2) + ' ' + yy(v);
      const hit = el('rect', { x: m.l + i * bw, y: top0, width: bw, height: H - top0 - 20, fill: 'transparent' }, svg);
      hover(hit, `<b>${r[0]}</b>營收 ${(r[1] / 1e5).toFixed(1)} 億元<br>YoY ${v === null ? '—' : v.toFixed(1) + '%'}`);
    });
    el('path', { d: path, fill: 'none', stroke: applicable ? 'var(--chart-mark)' : 'var(--gray-400)', 'stroke-width': 2 }, svg);
    // 超出 ±100% 的點畫成邊緣三角形，只在絕對值最大的那一點標實際數值
    const clipped = yoys.map((v, i) => v !== null && v !== clamp(v) ? i : -1).filter(i => i >= 0);
    const peak = clipped.length ? clipped.reduce((a, i) => Math.abs(yoys[i]) > Math.abs(yoys[a]) ? i : a, clipped[0]) : -1;
    rows.forEach((r, i) => {
      const v = yoys[i]; if (v === null) return;
      const out = applicable && Math.abs(v) > 15, px = m.l + i * bw + 3 + (bw - 6) / 2, py = yy(v);
      const fill = applicable ? 'var(--chart-mark)' : 'var(--gray-400)';
      if (v !== clamp(v)) {
        el('path', { d: v > 0 ? `M${px} ${py - 6}l5 8h-10Z` : `M${px} ${py + 6}l5 -8h-10Z`, fill, 'pointer-events': 'none' }, svg);
        if (i === peak) txt(svg, px, py + (v > 0 ? -10 : 18), (v > 0 ? '+' : '') + Math.round(v) + '%', { 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--ink-900)', 'font-weight': 700 });
      } else el('circle', { cx: px, cy: py, r: out ? 4.5 : 2.5, fill, 'pointer-events': 'none' }, svg);
    });
    if (clipped.length) txt(svg, m.l + iw, bot0 - 8, `▲▼ ${clipped.length} 個月超出 ±${CAP}%，畫在邊緣（滑過看實際值）`, { 'text-anchor': 'end', 'font-size': 10 });
  }

  // ---------- E Play 組成 ----------
  /** 段內文字顏色：深色段用白字、亮橘段用黑字；對比不足 4.5:1 的段（GenAI）把標籤放到長條下方 */
  const LABEL_INK = { Migration: 'var(--white)', Security: 'var(--white)', Data: 'var(--ink-900)', GenAI: 'var(--ink-900)' };
  function playStack(host, { scores }) {
    host.innerHTML = '';
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    if (!total) return empty(host, '沒有 Play 分數');
    const order = Object.keys(scores).filter(p => scores[p] > 0).sort((a, b) => scores[b] - scores[a]);
    const share = p => scores[p] / total * 100;
    const p1 = order[0];
    const bar = order.map(p => {
      const w = share(p), inside = LABEL_INK[p] && w >= 9;
      return `<div class="seg" style="width:${w}%;background:${CL.PLAY_COLOR[p]};box-shadow:inset 0 0 0 1px var(--ink-900);color:${inside ? LABEL_INK[p] : 'transparent'}"
        data-tip="<b>${p}</b>${Math.round(w)}%（分數 ${Math.round(scores[p])}）">${inside ? Math.round(w) + '%' : ''}</div>`;
    }).join('');
    const mark = Math.min(100, share(p1) * 1.5);
    host.innerHTML = `<div class="stack-wrap"><div class="stack" role="img" aria-label="${order.map(p => p + ' ' + Math.round(share(p)) + '%').join('、')}">${bar}</div>
      <div class="stack-mark" style="left:${mark}%" data-tip="次 Play 門檻：第二名需達主 Play 的 50%"></div></div>
      <div class="legend stack-legend">${order.map(p => `<span>${CL.shapeSvg(p, 11)}${CL.LABELS.playShort[p]} ${Math.round(share(p))}%</span>`).join('')}
      <span class="muted">┆ 虛線＝次 Play 門檻</span></div>`;
    bindTips(host);
  }

  return { gauge, miniQuad, lollipop, swimlane, control, playStack, bindTips, tip, untip, playMark };
})();
