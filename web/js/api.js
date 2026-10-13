/**
 * 資料層：呼叫 GAS Web App（?action=snapshot，一次取得總覽與帳戶頁所需資料）。
 * sessionStorage 快取 30 分鐘（spec 第 6 節：降低 GAS 呼叫次數）；GAS 無法連線時退回 data/snapshot.json 靜態快照。
 */
const CL = (() => {
  // Web App 網址本來就公開在前端，不是秘密
  const GAS_URL = 'https://script.google.com/macros/s/AKfycbzb32r6vAc54inssIjGO3ol0FNmevyKkDvp_QMmpNYguGhz4C6k5fNk8Nmc3izW_7fo/exec';
  const CACHE_KEY = 'cl:snapshot:v4', CACHE_MS = 30 * 60 * 1000;

  async function gas(action, params = {}, timeoutMs = 20000) {
    const qs = new URLSearchParams({ action, ...params }).toString();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(GAS_URL + '?' + qs, { signal: ctl.signal });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || 'API 錯誤');
      return body;
    } finally { clearTimeout(timer); }
  }

  async function fetchSnapshot() {
    try {
      const hit = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    } catch (e) { /* 私密模式等情況讀不到 sessionStorage，直接重抓 */ }
    try {
      const body = await gas('snapshot');
      const data = { ...body.data, source: 'live' };
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch (e) { /* 容量不足時略過快取 */ }
      return data;
    } catch (e) {
      const res = await fetch('data/snapshot.json');
      if (!res.ok) throw new Error('資料載入失敗（GAS 與靜態快照皆無法取得）');
      return { ...(await res.json()), source: 'fallback', fallback_reason: String(e.message || e) };
    }
  }

  const LABELS = {
    play: { Migration: 'Migration 遷移現代化', Data: 'Data 數據平台', GenAI: 'GenAI 生成式 AI', Security: 'Security 資安', '訊號不足': '訊號不足' },
    playShort: { Migration: 'Migration', Data: 'Data', GenAI: 'GenAI', Security: 'Security', '訊號不足': '訊號不足' },
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
  const NO_PLAY = '訊號不足';
  const PLAY_COLOR = { Migration: 'var(--play-migration)', Data: 'var(--play-data)', GenAI: 'var(--play-genai)', Security: 'var(--play-security)', [NO_PLAY]: 'var(--white)' };
  // 四種 Play 標記一律加 1px ink-900 外框（Verna 2026-10-13：統一有框線；亮色對白底不足 3:1 也靠它補足）
  const PLAY_STROKE = { Migration: 'var(--ink-900)', Security: 'var(--ink-900)', GenAI: 'var(--ink-900)', Data: 'var(--ink-900)', [NO_PLAY]: 'var(--gray-400)' };
  const PLAY_SHAPE = { Migration: 'circle', Data: 'square', GenAI: 'triangle', Security: 'diamond', [NO_PLAY]: 'circle' }; // 訊號不足＝空心圓
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
    const d = await fetchSnapshot();
    d.prev = d.prev || {};
    const byCode = {};
    d.companies.forEach(c => { byCode[c.code] = { ...c, signals: [] }; });
    d.scores.forEach(s => { if (byCode[s.stock_code]) byCode[s.stock_code].score = s; });
    d.signals.forEach(s => { if (byCode[s.code]) byCode[s.code].signals.push(s); });
    Object.values(byCode).forEach(c => {
      c.signals.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      // 一份文件（同一則重訊／新聞）可能同時產生多個訊號（例：資安事件同時計入 T1、N4、Play），
      // [S#] 以「文件」編號，時間軸一份文件一列
      const docs = {};
      c.docs = [];
      c.signals.forEach(s => {
        const key = s.src + '|' + s.title + '|' + s.at;
        if (!docs[key]) {
          docs[key] = { ref: 'S' + (c.docs.length + 1), at: s.at, title: s.title, src: s.src, url: evidenceUrl(c.code, s), parts: [],
                        lane: s.lane || LANE_OF[s.src] || s.src, points: 0, play: '' };
          c.docs.push(docs[key]);
        }
        const doc = docs[key];
        doc.parts.push(s);
        s.ref = doc.ref;
        // 文件得分＝各訊號貢獻的最大值；文件的 Play＝貢獻最大且有 Play 的訊號的第一個 Play
        const pts = Number(s.points ?? 0);
        if (pts >= doc.points) {
          doc.points = pts;
          const pl = String(s.play || '').split(',')[0].trim();
          if (pl && (pts > 0 || !doc.play)) doc.play = pl;
        }
        if (!doc.play && s.play) doc.play = String(s.play).split(',')[0].trim();
      });
      c.docs.forEach(d => { d.kinds = [...new Set(d.parts.map(p => `${LABELS.type[p.type] || p.type}・${LABELS.cat[p.cat] || p.cat}`))]; });
      c.revenue = d.revenue[c.code] || [];
    });
    cache = { ...d, byCode, accounts: Object.values(byCode).filter(c => c.score) };
    return cache;
  }

  /** 證據連結：新聞＝原文；重訊＝公開資訊觀測站「該公司當月重大訊息」（MOPS 沒有單則的固定網址）；營收＝本頁月營收圖 */
  function evidenceUrl(code, s) {
    if (s.src === 'news') return s.url || '';
    if (s.src === 'ann') {
      const y = Number(String(s.at).slice(0, 4)) - 1911, m = String(s.at).slice(5, 7);
      return `https://mopsov.twse.com.tw/mops/web/ajax_t05st01?encodeURIComponent=1&step=1&firstin=1&off=1&TYPEK=all&co_id=${code}&year=${y}&month=${m}`;
    }
    if (s.src === 'revenue') return '#rev';
    return '';
  }

  const LANE_OF = { ann: 'announcement', news: 'news', revenue: 'revenue', esg: 'esg' };
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
    const s = size, h = s / 2, c = PLAY_COLOR[play], sk = PLAY_STROKE[play];
    const shape = {
      circle: `<circle cx="${h}" cy="${h}" r="${h - 0.5}"/>`,
      square: `<rect x="1" y="1" width="${s - 2}" height="${s - 2}" rx="1.5"/>`,
      triangle: `<path d="M${h} 0.5 L${s - 0.5} ${s - 0.5} L0.5 ${s - 0.5} Z"/>`,
      diamond: `<path d="M${h} 0 L${s} ${h} L${h} ${s} L0 ${h} Z"/>`
    }[PLAY_SHAPE[play]];
    return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true" style="fill:${c};stroke:${sk};stroke-width:1">${shape}</svg>`;
  }

  /** 頁首資料來源說明 */
  function sourceNote(d) {
    if (d.source === 'live') {
      return `資料更新 <b>${esc(String(d.updated_at || '').replace('T', ' ').slice(0, 16))}</b>（${d.run_id}・規則 v${d.rule_version}）・每週一 05:00 自動更新`;
    }
    return `<b>目前無法連線後端，顯示靜態快照</b>（${d.generated_at}・${esc(d.note)}）`;
  }

  return { load, gas, GAS_URL, sourceNote, NO_PLAY, LABELS, PLAY_COLOR, PLAY_STROKE, PLAY_SHAPE, COMPONENTS, ageDays, fmt, esc, tierBadge, playTag, shapeSvg };
})();
