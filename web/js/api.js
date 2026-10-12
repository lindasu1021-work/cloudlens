/**
 * 資料層。MVP 讀 data/snapshot.json（本機以真實資料試算的快照）；
 * Phase 3 正式版改為呼叫 GAS Web App（?action=summary/accounts/account），介面不變。
 */
const CL = (() => {
  const LABELS = {
    play: { Migration: 'Migration 遷移現代化', Data: 'Data 數據平台', GenAI: 'GenAI 生成式 AI', Security: 'Security 資安' },
    playShort: { Migration: 'Migration', Data: 'Data', GenAI: 'GenAI', Security: 'Security' },
    cloud: { aws: '已是 AWS 客戶（擴充）', competitor: '用競品（替換）', unknown: '未知（新導入）' },
    cloudShort: { aws: 'AWS 客戶', competitor: '用競品', unknown: '未知' },
    tier: { '1': 'Tier 1', '2': 'Tier 2', '3': 'Tier 3', hold: '暫緩' },
    tierLong: { '1': 'Tier 1 立即開發', '2': 'Tier 2 培養', '3': 'Tier 3 事件型輕觸', hold: '暫緩' },
    type: { N3: '策略意圖', PLAY: '資安議題', N4: '資安合規', T1: '觸發事件', T2: '新聞動能', T3: '營收動能', VENDOR: '雲端現況' },
    cat: {
      MIG: '遷移／現代化', DATA: '數據', AI: 'AI', SEC: '資安',
      m_and_a: '併購／投資', expansion: '擴廠／海外', capex: '資本支出', cio_change: '資訊主管異動',
      transformation: '系統／轉型', security_incident: '資安事件',
      incident: '資安事件重訊', esg_breach: 'ESG 資訊外洩',
      news_momentum: '新聞量上升', revenue_growth: '營收成長', revenue_decline: '營收衰退',
      aws: '提及 AWS', competitor: '提及競品雲', onprem: '地端線索'
    }
  };
  const PLAY_COLOR = { Migration: 'var(--play-migration)', Data: 'var(--play-data)', GenAI: 'var(--play-genai)', Security: 'var(--play-security)' };
  const PLAY_SHAPE = { Migration: 'circle', Data: 'square', GenAI: 'triangle', Security: 'diamond' };
  const COMPONENTS = [
    { key: 'n1', axis: 'need', name: 'N1 規模', max: 25 },
    { key: 'n2', axis: 'need', name: 'N2 數位人才招募', max: 25 },
    { key: 'n3', axis: 'need', name: 'N3 策略意圖', max: 25 },
    { key: 'n4', axis: 'need', name: 'N4 資安合規壓力', max: 25 },
    { key: 't1', axis: 'timing', name: 'T1 觸發事件', max: 50 },
    { key: 't2', axis: 'timing', name: 'T2 新聞動能', max: 20 },
    { key: 't3', axis: 'timing', name: 'T3 營收動能', max: 20 },
    { key: 't4', axis: 'timing', name: 'T4 招募加速', max: 10 }
  ];

  let cache = null;
  async function load() {
    if (cache) return cache;
    const res = await fetch('data/snapshot.json');
    if (!res.ok) throw new Error('資料載入失敗（HTTP ' + res.status + '）');
    const d = await res.json();
    const byCode = {};
    d.companies.forEach(c => { byCode[c.code] = { ...c, signals: [] }; });
    d.scores.forEach(s => { if (byCode[s.stock_code]) byCode[s.stock_code].score = s; });
    d.signals.forEach(s => { if (byCode[s.code]) byCode[s.code].signals.push(s); });
    Object.values(byCode).forEach(c => {
      c.signals.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      c.signals.forEach((s, i) => { s.ref = 'S' + (i + 1); });
      c.revenue = d.revenue[c.code] || [];
    });
    cache = { ...d, byCode, accounts: Object.values(byCode).filter(c => c.score) };
    return cache;
  }

  const ageDays = (iso, ref) => (new Date(ref + 'T23:59:59+08:00') - new Date(iso)) / 864e5;
  const fmt = (v, d = 1) => (v === '' || v === null || v === undefined) ? '—' : Number(v).toFixed(d).replace(/\.0$/, '');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function tierBadge(t) {
    return `<span class="badge tier-${t}">${LABELS.tier[t] || t}</span>`;
  }
  function playTag(p) {
    if (!p) return '<span class="muted">—</span>';
    return `<span class="play">${shapeSvg(p, 10)}${LABELS.playShort[p]}</span>`;
  }
  function shapeSvg(play, size) {
    const s = size, h = s / 2, c = PLAY_COLOR[play];
    const shape = {
      circle: `<circle cx="${h}" cy="${h}" r="${h - 0.5}"/>`,
      square: `<rect x="1" y="1" width="${s - 2}" height="${s - 2}" rx="1.5"/>`,
      triangle: `<path d="M${h} 0.5 L${s - 0.5} ${s - 0.5} L0.5 ${s - 0.5} Z"/>`,
      diamond: `<path d="M${h} 0 L${s} ${h} L${h} ${s} L0 ${h} Z"/>`
    }[PLAY_SHAPE[play]];
    return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true" style="fill:${c}">${shape}</svg>`;
  }

  return { load, LABELS, PLAY_COLOR, PLAY_SHAPE, COMPONENTS, ageDays, fmt, esc, tierBadge, playTag, shapeSvg };
})();
