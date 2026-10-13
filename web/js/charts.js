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
    const W = 600, H = 460, m = { t: 14, r: 14, b: 44, l: 50 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const x = v => m.l + (v / 100) * iw, y = v => m.t + ih - (v / 100) * ih;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Need 與 Timing 象限散佈圖，每點為一家公司' });
    host.querySelector('.chart').appendChild(svg);

    // Tier 1 象限淡底
    el('rect', { x: x(opt.timingCut), y: m.t, width: x(100) - x(opt.timingCut), height: y(opt.needCut) - m.t, fill: 'var(--orange-50)' }, svg);
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
    el('line', { x1: x(opt.timingCut), x2: x(opt.timingCut), y1: m.t, y2: m.t + ih, stroke: 'var(--gray-400)', 'stroke-dasharray': '4 4' }, svg);
    el('line', { x1: m.l, x2: m.l + iw, y1: y(opt.needCut), y2: y(opt.needCut), stroke: 'var(--gray-400)', 'stroke-dasharray': '4 4' }, svg);
    const ql = (tx, ty, anchor, text, strong) => {
      const t = el('text', { x: tx, y: ty, 'text-anchor': anchor, 'font-size': 12, fill: strong ? 'var(--orange-800)' : 'var(--ink-500)', 'font-weight': strong ? 700 : 400 }, svg);
      t.textContent = text;
    };
    ql(m.l + iw - 6, m.t + 14, 'end', 'Tier 1 立即開發', true);
    ql(m.l + 6, m.t + 14, 'start', 'Tier 2 培養');
    ql(m.l + iw - 6, m.t + ih - 8, 'end', 'Tier 3 事件型輕觸');
    ql(m.l + 6, m.t + ih - 8, 'start', '暫緩');

    // 點（相同座標的公司以小幅水平錯開，避免完全重疊）
    const seen = {};
    const g = el('g', {}, svg);
    const marks = rows.map(r => {
      const key = r.timing + '|' + r.need;
      const n = (seen[key] = (seen[key] || 0) + 1) - 1;
      const cx = x(r.timing) + (n ? ((n % 2 ? 1 : -1) * Math.ceil(n / 2) * 3) : 0), cy = y(r.need);
      const p = el('path', {
        d: markPath(CL.PLAY_SHAPE[r.play], cx, cy, 5.5), fill: CL.PLAY_COLOR[r.play],
        stroke: CL.PLAY_STROKE[r.play], 'stroke-width': 1, opacity: 0.85, tabindex: 0, role: 'link',
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
    const hide = () => { marks.forEach(o => { o.style.opacity = 0.85; }); tip.style.display = 'none'; };
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

  return { quadrant, revenueBars };
})();
