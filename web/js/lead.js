/**
 * 共用的業務規則（Lead 速查與帳戶頁共用，docs/09_v4角色旅程與平台設計.md 第 5 節）。
 * 結論列、建議分群、BANT 預審、開場白、Discovery 問題、轉交摘要、異議回應、MEDDPICC 缺口、會議準備包；皆以規則產生（不用 AI）。
 * 觀察清單存在瀏覽器 localStorage（cl:watch），不寫入後端。
 */
const Lead = (() => {
  const CONFIG_KEY = 'cl:lookup:config:v1', WATCH_KEY = 'cl:watch';

  // ---------- 規則（與方法論頁「Lead 速查」一節一致） ----------
  const EVENT_PHRASE = {
    m_and_a: '有併購／投資動作', expansion: '正在擴廠或拓展海外據點', capex: '公布新的資本支出計畫',
    cio_change: '資訊主管有異動', transformation: '正推動系統更新或數位轉型', security_incident: '發生資安事件'
  };
  const PLAY_TOPIC = {
    Migration: '把既有系統搬上雲、降低機房與維運成本', Data: '整合各系統資料、建立即時分析',
    GenAI: '用生成式 AI 提升客服與內部知識查詢效率', Security: '強化資安偵測、備份與營運持續'
  };
  const QUESTIONS = {
    Migration: ['目前核心系統與機房的合約或汰換時程是什麼時候？', '如果要搬遷，最在意的是停機時間、成本，還是資料留在台灣？', 'IT 團隊目前花最多時間在維運哪一類系統？'],
    Data: ['各事業單位的資料目前集中在哪裡？跨系統報表要花多久才拿得到？', '管理層最想即時看到、但現在看不到的數字是什麼？', '資料治理與權限控管由哪個單位負責？'],
    GenAI: ['內部已經在試用哪些 AI 工具？有沒有資料外流的顧慮？', '哪一個流程最耗人力、最想先自動化？', '導入 AI 需要經過哪些資安或法遵審查？'],
    Security: ['近一年最擔心的資安風險是什麼？主管機關有沒有要求的期限？', '目前的威脅偵測與備份還原演練多久做一次？', '發生事件時，從發現到通報大約需要多久？'],
    none: ['公司未來一年最重要的營運目標是什麼？IT 需要支援哪些專案？', '目前系統以地端、私有雲還是公有雲為主？', '評估新的 IT 方案時，通常由哪些部門一起決定？']
  };
  const ROLES = {
    Migration: '資訊長（CIO）、IT 基礎架構主管', Data: '資訊長、數據／BI 主管', GenAI: '數位轉型主管、資訊長',
    Security: '資安長（CISO）、資訊長', none: '資訊長或 IT 主管'
  };
  const VERDICT_BY_TIER = {
    '1': { key: 'priority', label: '優先跟進' }, '2': { key: 'nurture', label: '培養' },
    '3': { key: 'nurture', label: '培養' }, hold: { key: 'hold', label: '暫緩' }
  };
  const SRC_LABEL = { ann: '重大訊息', news: '新聞', esg: 'ESG 報告', revenue: '月營收' };

  // ---------- 設定（建議分群、BANT 欄位）：GAS 讀 config_routing／config_bant，取不到時用預設 ----------
  const DEFAULT_CONFIG = {
    routing: [
      { condition: 'listed=true and capital>=10000000000', segment: '大型企業（上市櫃）' },
      { condition: 'capital>=1000000000', segment: '中大型企業' },
      { condition: 'capital>=100000000', segment: '成長型企業' },
      { condition: 'capital>=0', segment: '中小企業（線上／電話開發）' }
    ],
    bant: [{ key: 'B', label: '預算（Budget）', visible: true }, { key: 'A', label: '決策者（Authority）', visible: true },
           { key: 'N', label: '需求（Need）', visible: true }, { key: 'T', label: '時程（Timing）', visible: true },
           { key: 'F', label: '合適度（Fit）', visible: false }, { key: 'C', label: '競爭（Competition）', visible: false }]
  };
  async function loadConfig() {
    try { const hit = JSON.parse(sessionStorage.getItem(CONFIG_KEY) || 'null'); if (hit) return hit; } catch (e) { /* 略過 */ }
    try {
      const b = await CL.gas('lookup_config');
      try { sessionStorage.setItem(CONFIG_KEY, JSON.stringify(b.data)); } catch (e) { /* 略過 */ }
      return b.data;
    } catch (e) { return DEFAULT_CONFIG; }
  }
  function route(rules, ctx) {
    for (const r of rules) {
      const ok = String(r.condition).split(/\s+and\s+/i).every(c => {
        const m = /^\s*(\w+)\s*(>=|<=|=|>|<)\s*(\S+)\s*$/.exec(c);
        if (!m) return false;
        const v = ctx[m[1]], t = m[3] === 'true' ? true : m[3] === 'false' ? false : Number(m[3]);
        return { '>=': v >= t, '<=': v <= t, '>': v > t, '<': v < t, '=': v === t }[m[2]];
      });
      if (ok) return r.segment;
    }
    return '';
  }

  const scaleLabel = c => c >= 1e10 ? '大型（實收資本額 100 億以上）' : c >= 1e9 ? '中大型（10–100 億）' : c >= 1e8 ? '中型（1–10 億）'
    : c >= 1e7 ? '小型（1,000 萬–1 億）' : c > 0 ? '微型（1,000 萬以下）' : '未提供';
  const money = c => c >= 1e8 ? (c / 1e8).toFixed(c >= 1e10 ? 0 : 1).replace(/\.0$/, '') + ' 億' : c >= 1e4 ? Math.round(c / 1e4).toLocaleString() + ' 萬' : '—';
  const day = s => String(s || '').slice(0, 10);
  const pr = v => v === '' || v === null || v === undefined ? '—' : 'PR ' + Math.round(Number(v) * 100);

  // ---------- 統一的「速查檔案」 ----------
  function profileFromAccount(a) {
    const s = a.score;
    const evDocs = a.docs.filter(d => d.parts.some(p => p.type === 'T1'));
    const stratDocs = a.docs.filter(d => d.parts.some(p => p.type === 'N3' || p.type === 'PLAY'));
    const play = s.play_primary && s.play_primary !== CL.NO_PLAY ? s.play_primary : '';
    const v = VERDICT_BY_TIER[String(s.tier)] || VERDICT_BY_TIER.hold;
    const top = evDocs[0];
    const reason = {
      '1': `Need 與 Timing 都在帳戶池前 30%（${pr(s.need_pct)}／${pr(s.timing_pct)}）`,
      '2': `需求高（Need ${pr(s.need_pct)}），但近期觸發事件不足（Timing ${pr(s.timing_pct)}）`,
      '3': `近期有觸發事件（Timing ${pr(s.timing_pct)}），但需求訊號偏弱（Need ${pr(s.need_pct)}）`,
      hold: `Need 與 Timing 都未進帳戶池前 30%（${pr(s.need_pct)}／${pr(s.timing_pct)}）`
    }[String(s.tier)] || '';
    return {
      mode: 'full', key: 'code:' + a.code, name: a.name, full: a.full, code: a.code, listed: true, market: a.market,
      industry: a.industry, capital: Number(a.capital) || 0, tier: String(s.tier),
      verdict: { ...v, reason: reason + (top ? `；最新事件：${day(top.at)} ${top.title.length > 28 ? top.title.slice(0, 28) + '…' : top.title}` : '') },
      play, play2: s.play_secondary || '', cloud: s.cloud_status,
      need: s.need, timing: s.timing, need_pct: s.need_pct, timing_pct: s.timing_pct, n1: s.n1,
      events: evDocs.slice(0, 2).map(d => ({ at: d.at, title: d.title, src: d.src, url: d.url, type: (d.parts.find(p => p.type === 'T1') || {}).cat })),
      signals: stratDocs.slice(0, 2).map(d => ({ at: d.at, title: d.title, src: d.src, url: d.url })),
      sources: ['帳戶池完整評分（' + String(window.__runId || '') + '）：重大訊息、新聞、月營收、ESG'],
      account_url: 'account.html?code=' + a.code
    };
  }
  function profileFromLite(d) {
    const c = d.company;
    return {
      mode: 'lite', key: 'tax:' + c.tax_id, name: c.short || c.name, full: c.name, code: c.stock_code || '', tax_id: c.tax_id,
      listed: !!c.listed, market: c.market || '', industry: (c.items || []).length ? '營業項目：' + c.items.slice(0, 3).map(i => i.desc).join('、') : '營業項目未提供',
      capital: Number(c.capital) || 0, city: c.city, setup_year: c.setup_year, status: c.status,
      verdict: d.verdict, play: (d.plays || [])[0] || '', play2: (d.plays || [])[1] || '',
      events: (d.events || []).map(n => ({ at: n.at, title: n.title + (n.publisher ? `（${n.publisher}）` : ''), src: 'news', url: n.url, type: n.triggers[0] })),
      signals: (d.news || []).filter(n => n.cats.length).slice(0, 2).map(n => ({ at: n.at, title: n.title, src: 'news', url: n.url })),
      news_total: d.news_total, news_error: d.news_error, sources: d.sources || [], cached_at: d.cached_at || ''
    };
  }

  function opening(p) {
    const ev = p.events[0], topic = PLAY_TOPIC[p.play];
    const hi = '您好，我是 ＿＿＿，協助企業規劃雲端與數據架構。';
    if (ev) {
      const phrase = EVENT_PHRASE[ev.type] || '近期有重要的營運消息';
      return `${hi}注意到貴公司 ${day(ev.at).slice(5).replace('-', '/')} ${phrase}，很多企業在這個階段會同時檢視${topic || '既有系統能否支撐新的業務量'}。想請教您目前這部分的規劃，方便約 15 分鐘交流嗎？`;
    }
    if (topic) return `${hi}注意到貴公司近期在相關議題上有不少動作，想了解您對${topic}的規劃，看看有沒有能協助的地方，方便約 15 分鐘交流嗎？`;
    return `${hi}想了解貴公司未來一年的 IT 規劃與重點專案，看看有沒有能協助的地方，方便約 15 分鐘交流嗎？`;
  }
  function bant(p, cfg) {
    const roles = ROLES[p.play] || ROLES.none;
    const cio = p.events.some(e => e.type === 'cio_change');
    const ev = p.events[0];
    const rows = {
      B: { text: `${scaleLabel(p.capital)}${p.capital ? `；實收資本額 ${money(p.capital)}` : ''}${p.mode === 'full' && p.n1 !== '' && p.n1 !== undefined ? `；規模分數 N1 ${CL.fmt(p.n1)}／25` : ''}`, state: 'pending', note: '預算金額需在通話中確認' },
      A: { text: `建議接觸：${roles}${cio ? '（近期資訊主管異動，先確認新任窗口）' : ''}`, state: 'pending', note: '實際決策者需確認' },
      N: p.mode === 'full'
        ? { text: `Need ${CL.fmt(p.need)}（${pr(p.need_pct)}）${p.play ? `；主 Play ${CL.LABELS.play[p.play] || p.play}` : '；Play 訊號不足'}`, state: p.play ? 'estimated' : 'pending' }
        : { text: p.play ? `近 90 天新聞出現 ${[p.play, p.play2].filter(Boolean).map(x => CL.LABELS.play[x] || x).join('、')} 相關議題` : '近 90 天新聞未出現相關議題', state: p.play ? 'estimated' : 'pending' },
      T: ev
        ? { text: `${day(ev.at)} ${EVENT_PHRASE[ev.type] || '觸發事件'}${p.mode === 'full' ? `；Timing ${CL.fmt(p.timing)}（${pr(p.timing_pct)}）` : ''}`, state: 'estimated' }
        : { text: p.mode === 'full' ? `近期無觸發事件；Timing ${CL.fmt(p.timing)}（${pr(p.timing_pct)}）` : '近 90 天沒有觸發事件', state: 'pending' },
      F: { text: '（預留）', state: 'pending' }, C: { text: p.cloud === 'aws' ? '已是 AWS 客戶' : p.cloud === 'competitor' ? '公開資料顯示使用其他雲' : '（預留）', state: 'pending' }
    };
    return cfg.bant.filter(f => f.visible).map(f => ({ key: f.key, label: f.label, ...(rows[f.key] || { text: '—', state: 'pending' }) }));
  }
  const STATE = { estimated: '系統推估', pending: '待確認' };

  function handoff(p, seg, b, qs) {
    const L = [];
    L.push(`【轉交摘要】${p.full || p.name}${p.code ? `（${p.code}）` : ''}${p.tax_id ? `　統編 ${p.tax_id}` : ''}`);
    L.push(`產業／規模：${p.industry}｜${scaleLabel(p.capital)}${p.listed ? `｜${p.market || '上市櫃'}` : '｜非上市櫃'}`);
    L.push(`結論：${p.verdict.label}｜建議分群：${seg || '—'}${p.mode === 'lite' ? '｜輕量評估' : `｜${CL.LABELS.tierLong[p.tier] || ''}`}`);
    L.push(`理由：${p.verdict.reason}`);
    L.push('為什麼是現在：');
    if (p.events.length) p.events.forEach(e => L.push(`・${day(e.at)} ${e.title}（${SRC_LABEL[e.src] || e.src}${e.url && !e.url.startsWith('#') ? ' ' + e.url : ''}）`));
    else L.push('・近期無觸發事件');
    L.push('BANT 預審：');
    b.forEach(r => L.push(`・${r.label}：${r.text}［${STATE[r.state]}］`));
    L.push('建議 Discovery 問題：');
    qs.forEach((q, i) => L.push(`${i + 1}. ${q}`));
    L.push(`資料來源：企業雲端商機洞察平台 Lead 速查（${new Date().toISOString().slice(0, 10)}）；${p.sources.join('；')}`);
    return L.join('\n');
  }


  // ---------- 會議準備（帳戶頁下半部） ----------
  const OBJECTIONS = {
    Migration: [['已經有自建機房，搬遷風險太高', '可先從非核心系統或災備環境開始，評估階段就盤點停機時間與回退計畫，不必一次全搬。'],
                ['雲端長期成本比較貴', '先用實際用量做總持有成本試算（含硬體汰換、人力、機房），再決定哪些系統適合上雲。']],
    Data: [['資料散在各系統，整合工程太大', '先挑一個管理層最在意的指標做概念驗證，資料管線可逐步擴充。'],
           ['擔心資料外流或不符合法規', '資料可存放在台灣區域，搭配權限與稽核記錄；可先請資安與法遵一起參與設計。']],
    GenAI: [['AI 回答不準確，不敢用在客戶端', '先用內部知識查詢、客服摘要等低風險場景，並限定只從自家文件回答、保留來源。'],
            ['不想把資料交給外部模型', '可在自己的雲端帳戶內呼叫模型，資料不用於模型訓練，並能控管存取。']],
    Security: [['已經有資安廠商，不需要再換', '可以先做現況健檢，補強偵測與備份還原演練的缺口，不一定要取代既有方案。'],
               ['預算已經用完', '把主管機關要求的期限與事件發生的損失放在一起評估，排進下一期預算。']],
    none: [['目前沒有雲端計畫', '先了解未來一年的重點專案，看有沒有適合從小範圍試行的項目。'],
           ['已經在用其他雲', '多雲是常見做法，可以從特定工作負載或災備開始比較。']]
  };
  const SUITE = { Migration: 'CIO、IT 基礎架構、財務', Data: 'CIO、數據／BI、業務單位主管', GenAI: '數位轉型、CIO、資安／法遵', Security: 'CISO、CIO、稽核／法遵', none: 'CIO 或 IT 主管' };

  /** 建議接觸職稱（不放人名）：主、次 Play 各自對應的職稱，去重。 */
  function contactRoles(p) {
    const list = [ROLES[p.play] || ROLES.none, p.play2 ? ROLES[p.play2] : ''].filter(Boolean).join('、').split('、').map(x => x.trim()).filter(Boolean);
    // 「資訊長」與「資訊長（CIO）」視為同一職稱，保留較完整的寫法
    const byBase = new Map();
    list.forEach(x => { const b = x.replace(/（.*?）/g, ''); if (!byBase.has(b) || x.length > byBase.get(b).length) byBase.set(b, x); });
    return [...byBase.values()];
  }

  /** MEDDPICC 缺口：公開資料能提供線索的欄位標「有線索」，其餘為缺口並附要問的問題。 */
  function meddpicc(p, peers) {
    const ev = p.events[0];
    return [
      { k: 'M', name: '指標（Metrics）', ok: !!p.capital, have: p.capital ? `規模：${scaleLabel(p.capital)}` : '', ask: '這個專案成功與否，管理層用哪個數字判斷？' },
      { k: 'E', name: '經濟決策者（Economic Buyer）', ok: false, have: '', ask: `最終核准預算的是誰？（建議先找：${contactRoles(p).join('、')}）` },
      { k: 'D', name: '決策標準（Decision Criteria）', ok: false, have: '', ask: '評估方案時最看重哪三件事？成本、資安、上線時程的優先順序？' },
      { k: 'D', name: '決策流程（Decision Process）', ok: false, have: '', ask: '從評估到簽約要經過哪些部門與會議？大約多久？' },
      { k: 'P', name: '採購流程（Paper Process）', ok: false, have: '', ask: '採購、法務、資安審查各需要哪些文件？有沒有既定的供應商名單？' },
      { k: 'I', name: '痛點（Identify Pain）', ok: !!(ev || p.play), have: ev ? `${day(ev.at)} ${EVENT_PHRASE[ev.type] || '觸發事件'}` : p.play ? `公開訊號偏向 ${CL.LABELS.play[p.play] || p.play}` : '', ask: '這件事如果不處理，對營運最大的影響是什麼？' },
      { k: 'C', name: '內部支持者（Champion）', ok: false, have: '', ask: '內部誰最希望這件事成功？他需要我們提供什麼來說服其他人？' },
      { k: 'C', name: '競爭（Competition）', ok: p.cloud === 'aws' || p.cloud === 'competitor', have: p.cloud === 'aws' ? '公開資料顯示已使用 AWS' : p.cloud === 'competitor' ? '公開資料顯示使用其他雲' : '', ask: '目前還在評估哪些方案或廠商？' }
    ];
  }

  /** 同業證明：同產業中有公開雲端使用證據的公司（config_validation），AWS 優先、同主 Play 優先。 */
  function peerProof(p, d) {
    const cases = (d.aws_cases || []).filter(x => String(x.stock_code) !== String(p.code));
    const byCode = d.byCode || {};
    const CLOUD = { aws: 'AWS', gcp: 'Google Cloud', azure: 'Microsoft Azure' };
    return cases.map(x => {
      const a = byCode[String(x.stock_code)];
      return { code: String(x.stock_code), name: (a && a.name) || x.company_name, industry: a ? a.industry : '', cloud: CLOUD[x.cloud] || x.cloud,
               aws: x.cloud === 'aws', samePlay: !!(a && a.score && p.play && a.score.play_primary === p.play),
               sameInd: !!(a && a.industry === p.industry), url: x.evidence_url, src: x.source_type, note: x.note };
    }).filter(x => x.sameInd || x.samePlay)
      .sort((a, b) => (b.sameInd - a.sameInd) || (b.aws - a.aws) || (b.samePlay - a.samePlay));
  }

  /** 會議準備包（Markdown）：議程、問題、異議回應、同業證明、MEDDPICC 缺口。 */
  function meetingPack(p, seg, cfg, d) {
    const qs = QUESTIONS[p.play] || QUESTIONS.none, obj = OBJECTIONS[p.play] || OBJECTIONS.none;
    const proof = peerProof(p, d), gaps = meddpicc(p).filter(x => !x.ok);
    const L = [];
    L.push(`# 會議準備包：${p.full || p.name}${p.code ? `（${p.code}）` : ''}`, '');
    L.push(`- 結論：${p.verdict.label}｜建議分群：${seg || '—'}${p.tier ? `｜${CL.LABELS.tierLong[p.tier] || ''}` : ''}`);
    L.push(`- 理由：${p.verdict.reason}`);
    L.push(`- 建議出席（對方）：${SUITE[p.play] || SUITE.none}；建議接觸職稱：${contactRoles(p).join('、')}`, '');
    L.push('## 議程（30 分鐘）', '1. 開場與目的（3 分鐘）', `2. 了解現況與重點專案（12 分鐘）${p.events[0] ? `：從「${EVENT_PHRASE[p.events[0].type] || '近期事件'}」切入` : ''}`,
           `3. 分享同業做法${proof.length ? `（${proof.slice(0, 2).map(x => x.name).join('、')}）` : ''}（8 分鐘）`, '4. 確認下一步與窗口（7 分鐘）', '');
    L.push('## 為什麼是現在');
    if (p.events.length) p.events.forEach(e => L.push(`- ${day(e.at)} ${e.title}${e.url && !String(e.url).startsWith('#') ? `（${e.url}）` : ''}`));
    else L.push('- 近期無觸發事件');
    L.push('', '## Discovery 問題'); qs.forEach((q, i) => L.push(`${i + 1}. ${q}`));
    L.push('', '## MEDDPICC 待確認（公開資料無法回答）'); gaps.forEach(g => L.push(`- ${g.name}：${g.ask}`));
    L.push('', '## 可能的異議與回應'); obj.forEach(([o, r]) => L.push(`- 「${o}」→ ${r}`));
    L.push('', '## 同業證明（公開資料）');
    if (proof.length) proof.slice(0, 4).forEach(x => L.push(`- ${x.name}${x.code ? `（${x.code}）` : ''}：${x.cloud}${x.url ? `｜${x.url}` : ''}${x.note ? `｜${x.note}` : ''}`));
    else L.push('- 目前驗證集中沒有同產業或同 Play 的公開案例');
    L.push('', `資料來源：企業雲端商機洞察平台（${new Date().toISOString().slice(0, 10)}）；${p.sources.join('；')}。內容由規則產生，使用前請依實際情況修改。`);
    return L.join('\n');
  }

  // ---------- 共用 UI 小工具 ----------
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (x) { /* 略過 */ } ta.remove();
    }
    if (!btn) return;
    const old = btn.textContent; btn.textContent = '已複製'; btn.classList.add('done');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1600);
  }
  function download(name, text, type = 'text/markdown') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const watchList = () => { try { return JSON.parse(localStorage.getItem(WATCH_KEY) || '[]'); } catch (e) { return []; } };
  const inWatch = key => watchList().some(w => w.key === key);
  function toggleWatch(p) {
    let list = watchList();
    if (list.some(w => w.key === p.key)) list = list.filter(w => w.key !== p.key);
    else list.push({ key: p.key, name: p.name, code: p.code || '', tax_id: p.tax_id || '', mode: p.mode, added_at: new Date().toISOString() });
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(list)); } catch (e) { /* 私密模式 */ }
    return list.some(w => w.key === p.key);
  }
  function removeWatch(key) {
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(watchList().filter(w => w.key !== key))); } catch (e) { /* 略過 */ }
  }

  return { EVENT_PHRASE, PLAY_TOPIC, QUESTIONS, ROLES, SRC_LABEL, OBJECTIONS, STATE, DEFAULT_CONFIG,
           loadConfig, route, scaleLabel, money, day, pr, profileFromAccount, profileFromLite, opening, bant, handoff,
           contactRoles, meddpicc, peerProof, meetingPack, copy, download, watchList, inWatch, toggleWatch, removeWatch };
})();
