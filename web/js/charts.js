/**
 * 圖表（純 SVG，無外部函式庫）。
 *  - quadrant：Need × Timing 象限散佈圖，依主 Play 上色＋形狀；hover 其他點降到 30% 並顯示提示框
 *  - revenueBars：月營收長條圖，hover 顯示金額與 YoY
 */
const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  };

  function markPath(shape, x, y, r) {
    switch (shape) {
      case 'square': return `M${x - r} ${y - r}h${2 * r}v${2 * r}h${-2 * r}Z`;
      case 'triangle': return `M${x} ${y - r * 1.15}L${x + r * 1.1} ${y + r * 0.85}L${x - r * 1.1} ${y + r * 0.85}Z`;
      case 'diamond': return `M${x} ${y - r * 1.25}L${x + r * 1.25} ${y}L${x} ${y + r * 1.25}L${x - r * 1.25} ${y}Z`;
      default: return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
    }
  }

  /**
   * @param {HTMLElement} host  容器（需 position:relative，內含 .tooltip）
   * @param {Array} rows  [{code,name,industry,need,timing,tier,play}]
   * @param {{needCut:number,timingCut:number,onClick:Function}} opt
   */
  function quadrant(host, rows, opt) {
    const W = 600, H = 600, m = { t: 14, r: 14, b: 44, l: 50 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const x = v => m.l + (v / 100) * iw, y = v => m.t + ih - (v / 100) * ih;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Need 與 Timing 象限散佈圖，每點為一家公司' });
    host.querySelector('.chart').innerHTML = '';
    host.querySelector('.chart').appendChild(svg);
    const hasCut = opt.needCut !== null && opt.needCut !== undefined; // 產業內排名時各產業門檻不同，不畫單一門檻線

    // Tier 1 象限淡底
    if (hasCut) el('rect', { x: x(opt.timingCut), y: m.t, width: x(100) - x(opt.timingCut), height: y(opt.needCut) - m.t, fill: 'var(--orange-50)' }, svg);
    // 格線與軸
    [0, 25, 50, 75, 100].forEach(v => {
      el('line', { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v), stroke: 'var(--gray-100)' }, svg);
      el('line', { x1: x(v), x2: x(v), y1: m.t, y2: m.t + ih, stroke: 'var(--gray-100)' }, svg);
      el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 12, fill: 'var(--ink-500)' }, svg).textContent = v;
      el('text', { x: x(v), y: m.t + ih + 18, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink-500)' }, svg).textContent = v;
    });
    el('line', { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, stroke: 'var(--gray-300)' }, svg);
    el('line', { x1: m.l, x2: m.l, y1: m.t, y2: m.t + ih, stroke: 'var(--gray-300)' }, svg);
    el('text', { x: m.l + iw / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 13, fill: 'var(--ink-600)' }, svg).textContent = 'Timing 時機（0–100）→';
    el('text', { x: 14, y: m.t + ih / 2, 'text-anchor': 'middle', 'font-size': 13, fill: 'var(--ink-600)', transform: `rotate(-90 14 ${m.t + ih / 2})` }, svg).textContent = 'Need 需求強度（0–100）→';
    // 象限分隔線（前 30% 門檻）
    if (hasCut) el('line', { x1: x(opt.timingCut), x2: x(opt.timingCut), y1: m.t, y2: m.t + ih, stroke: 'var(--gray-400)', 'stroke-dasharray': '4 4' }, svg);
    if (hasCut) el('line', { x1: m.l, x2: m.l + iw, y1: y(opt.needCut), y2: y(opt.needCut), stroke: 'var(--gray-400)', 'stroke-dasharray': '4 4' }, svg);
    const ql = (tx, ty, anchor, text, strong) => {
      const t = el('text', { x: tx, y: ty, 'text-anchor': anchor, 'font-size': 12, fill: strong ? 'var(--orange-800)' : 'var(--ink-500)', 'font-weight': strong ? 700 : 400 }, svg);
      t.textContent = text;
    };
    if (hasCut) {
      ql(m.l + iw - 6, m.t + 14, 'end', 'Tier 1 立即開發', true);
      ql(m.l + 6, m.t + 14, 'start', 'Tier 2 培養');
      ql(m.l + iw - 6, m.t + ih - 8, 'end', 'Tier 3 事件型輕觸');
      ql(m.l + 6, m.t + ih - 8, 'start', '暫緩');
    }

    // 點（相同座標的公司以小幅水平錯開，避免完全重疊）
    // 同座標的點：依代號做固定的 ±0.8（資料單位）抖動，並依序水平錯開，避免疊成一條線
    const seen = {};
    const jit = code => { let h = 0; for (const ch of String(code)) h = (h * 31 + ch.charCodeAt(0)) % 997; return (h / 997 * 2 - 1) * 0.8; };
    const g = el('g', {}, svg);
    const marks = rows.map(r => {
      const key = r.timing + '|' + r.need;
      const n = (seen[key] = (seen[key] || 0) + 1) - 1;
      const cx = x(Math.max(0, Math.min(100, r.timing + jit(r.code)))) + (n ? ((n % 2 ? 1 : -1) * Math.ceil(n / 2) * 3) : 0);
      const cy = y(Math.max(0, Math.min(100, r.need + jit(r.code + 'n'))));
      if (!hasCut && r.tier === '1') el('circle', { cx, cy, r: 10, fill: 'var(--orange-50)', stroke: 'var(--orange-600)', 'stroke-width': 1.3, 'pointer-events': 'none' }, g);
      const p = el('path', {
        d: markPath(CL.PLAY_SHAPE[r.play], cx, cy, 5.5), fill: CL.PLAY_COLOR[r.play],
        stroke: CL.PLAY_STROKE[r.play], 'stroke-width': r.play === CL.NO_PLAY ? 1.5 : 1, opacity: 0.7, tabindex: 0, role: 'link',
        'aria-label': `${r.name}，Need ${r.need}，Timing ${r.timing}，${CL.LABELS.tier[r.tier]}，主 Play ${r.play}`
      }, g);
      p.style.cursor = 'pointer';
      p.style.transition = 'opacity .12s';
      p.__row = r; p.__x = cx; p.__y = cy;
      return p;
    });

    const tip = host.querySelector('.tooltip');
    const show = p => {
      marks.forEach(o => { o.style.opacity = o === p ? 1 : 0.25; });
      const r = p.__row;
      tip.innerHTML = `<b>${CL.esc(r.name)} ${r.code}</b><span class="muted">${CL.esc(r.industry)}</span><br>` +
        `Need <b style="display:inline">${CL.fmt(r.need)}</b>　Timing <b style="display:inline">${CL.fmt(r.timing)}</b><br>` +
        `${CL.tierBadge(r.tier)} ${CL.playTag(r.play)}`;
      tip.style.display = 'block';
      const box = svg.getBoundingClientRect(), k = box.width / W;
      let left = p.__x * k + 14, top = p.__y * k - 10;
      if (left + 200 > box.width) left = p.__x * k - 214;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    };
    const hide = () => { marks.forEach(o => { o.style.opacity = 0.7; }); tip.style.display = 'none'; };
    marks.forEach(p => {
      p.addEventListener('mouseenter', () => show(p));
      p.addEventListener('focus', () => show(p));
      p.addEventListener('mouseleave', hide);
      p.addEventListener('blur', hide);
      p.addEventListener('click', () => opt.onClick(p.__row));
      p.addEventListener('keydown', e => { if (e.key === 'Enter') opt.onClick(p.__row); });
    });
  }

  /** 月營收長條（單位：千元 → 顯示億元）。rows: [[ym, revenue, yoy], ...] */
  function revenueBars(host, rows) {
    const W = 320, H = 150, m = { t: 10, r: 6, b: 22, l: 6 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    if (!rows.length) { host.querySelector('.chart').innerHTML = '<p class="muted">無月營收資料</p>'; return; }
    const max = Math.max(...rows.map(r => r[1])) || 1;
    const bw = iw / rows.length;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '近 15 個月月營收長條圖' });
    host.querySelector('.chart').appendChild(svg);
    el('line', { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, stroke: 'var(--gray-300)' }, svg);
    const tip = host.querySelector('.tooltip');
    rows.forEach((r, i) => {
      const h = Math.max(2, (r[1] / max) * ih);
      const bx = m.l + i * bw + 1, by = m.t + ih - h;
      const bar = el('path', {
        d: `M${bx} ${m.t + ih}V${by + 3}q0 -3 3 -3h${bw - 8}q3 0 3 3V${m.t + ih}Z`,
        fill: 'var(--gray-400)'
      }, svg);
      if (i === 0 || i === rows.length - 1 || r[0].endsWith('-01')) {
        el('text', { x: bx + (bw - 2) / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--ink-500)' }, svg).textContent = r[0].slice(2).replace('-', '/');
      }
      const hit = el('rect', { x: m.l + i * bw, y: m.t, width: bw, height: ih, fill: 'transparent' }, svg);
      hit.addEventListener('mouseenter', () => {
        bar.setAttribute('fill', 'var(--chart-mark)');
        tip.innerHTML = `<b>${r[0]}</b>營收 ${(r[1] / 1e5).toFixed(1)} 億元<br><span class="muted">YoY ${r[2] === '' ? '—' : Number(r[2]).toFixed(1) + '%'}</span>`;
        tip.style.display = 'block';
        const k = svg.getBoundingClientRect().width / W;
        tip.style.left = Math.min((bx + bw) * k, svg.getBoundingClientRect().width - 150) + 'px';
        tip.style.top = (by * k - 10) + 'px';
      });
      hit.addEventListener('mouseleave', () => { bar.setAttribute('fill', 'var(--gray-400)'); tip.style.display = 'none'; });
    });
  }

  // ---------- 總覽頁新增圖表 ----------
  const TIER_ORDER = ['1', '2', '3', 'hold'];
  const TIER_VAR = { '1': 'var(--tier-1)', '2': 'var(--tier-2)', '3': 'var(--tier-3)', hold: 'var(--tier-hold)' };

  /** Tier 分布鬆餅圖：每家公司一個圓點，依 Tier 階梯上色（淺色點以 ink-900 外框補足對比） */
  function waffle(host, rows, onClick) {
    const cols = 15, cell = 22, r = 8, n = rows.length, rowsN = Math.ceil(n / cols);
    const W = cols * cell, H = rowsN * cell;
    host.innerHTML = '';
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `帳戶池 ${n} 家的 Tier 分布，每點一家公司` }, host);
    const sorted = rows.slice().sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || (b.need + b.timing) - (a.need + a.timing));
    const tip = host.parentElement.querySelector('.tooltip');
    sorted.forEach((c, i) => {
      const cx = (i % cols) * cell + cell / 2, cy = Math.floor(i / cols) * cell + cell / 2;
      const dot = el('circle', { cx, cy, r, fill: TIER_VAR[c.tier], stroke: 'var(--ink-900)', 'stroke-width': 0.8, tabindex: 0, role: 'link',
        'aria-label': `${c.name}，${CL.LABELS.tier[c.tier]}` }, svg);
      dot.style.cursor = 'pointer';
      const show = () => {
        tip.innerHTML = `<b>${CL.esc(c.name)} ${c.code}</b><span class="muted">${CL.esc(c.industry)}</span><br>${CL.tierBadge(c.tier)}`;
        tip.style.display = 'block';
        const k = svg.getBoundingClientRect().width / W;
        tip.style.left = Math.min(cx * k + 14, svg.getBoundingClientRect().width - 170) + 'px';
        tip.style.top = (cy * k - 10) + 'px';
      };
      dot.addEventListener('mouseenter', show); dot.addEventListener('focus', show);
      dot.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
      dot.addEventListener('click', () => onClick(c));
      dot.addEventListener('keydown', e => { if (e.key === 'Enter') onClick(c); });
    });
  }

  /** 觸發事件日曆熱圖：近 26 週 × 週一至週日；格子顏色＝當日觸發事件數 */
  function calendar(host, days, opt) {
    const WEEKS = 26, cell = 16, gap = 3, step = cell + gap, L = 30, T = 18;
    const end = new Date(opt.endDate + 'T00:00:00');
    const dow = (end.getDay() + 6) % 7;                       // 週一＝0
    const start = new Date(end); start.setDate(end.getDate() - dow - (WEEKS - 1) * 7);
    const byDay = {}; days.forEach(d => { byDay[d.d] = d; });
    const W = L + WEEKS * step, H = T + 7 * step + 4;
    host.innerHTML = '';
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `近 ${WEEKS} 週每日觸發事件數` }, host);
    ['一', '二', '三', '四', '五', '六', '日'].forEach((t, i) => {
      if (i % 2 === 0) { const x = el('text', { x: L - 8, y: T + i * step + cell - 3, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--ink-500)' }, svg); x.textContent = t; }
    });
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const level = n => n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4;
    const FILL = ['var(--gray-100)', 'var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)'];
    const tip = host.parentElement.querySelector('.tooltip');
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const monday = new Date(start); monday.setDate(start.getDate() + w * 7);
      if (monday.getMonth() !== lastMonth) {
        lastMonth = monday.getMonth();
        const t = el('text', { x: L + w * step, y: 10, 'font-size': 10, fill: 'var(--ink-500)' }, svg); t.textContent = `${lastMonth + 1}月`;
      }
      for (let d = 0; d < 7; d++) {
        const day = new Date(monday); day.setDate(monday.getDate() + d);
        if (day > end) continue;
        const key = fmt(day), rec = byDay[key], n = rec ? rec[opt.group] : 0;
        const rect = el('rect', { x: L + w * step, y: T + d * step, width: cell, height: cell, rx: 4, fill: FILL[level(n)], stroke: level(n) ? 'var(--ink-900)' : 'none', 'stroke-width': 0.5 }, svg);
        rect.addEventListener('mouseenter', () => {
          const titles = (rec ? rec.titles.filter(t => opt.group === 'n' || t.ind === opt.group) : []).slice(0, 3);
          tip.innerHTML = `<b>${key}</b>${n ? n + ' 件觸發事件' : '沒有觸發事件'}` + titles.map(t => `<br><span class="muted">${CL.esc(t.name)}：${CL.esc(t.title.slice(0, 26))}${t.title.length > 26 ? '…' : ''}</span>`).join('');
          tip.style.display = 'block';
          const k = svg.getBoundingClientRect().width / W;
          tip.style.left = Math.min(Math.max(0, (L + w * step) * k - 60), svg.getBoundingClientRect().width - 250) + 'px';
          tip.style.top = ((T + d * step) * k + 26) + 'px';
        });
        rect.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
      }
    }
    return { FILL };
  }

  return { quadrant, revenueBars, waffle, calendar, TIER_ORDER, TIER_VAR };
})();
