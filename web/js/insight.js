/**
 * 產業洞察素材包（docs/09_v4角色旅程與平台設計.md 第 5.4 節）：GET ?action=insight&industry=…（GAS 每兩週產生，存在 insight_packs）。
 * 主題熱度表（可展開看相關新聞與公司）、本期 5 則重點事件＋AWS 切入角度、建議標題 3 個、匯出 Markdown；另含每週摘要信訂閱。
 */
(async () => {
  const { esc } = CL;
  const $ = id => document.getElementById(id);
  const CACHE = 'cl:insight:';
  let pack = null;

  async function load(ind) {
    const key = CACHE + (ind || 'default');
    try { const hit = JSON.parse(sessionStorage.getItem(key) || 'null'); if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.data; } catch (e) { /* 略過 */ }
    const b = await CL.gas('insight', ind ? { industry: ind } : {}, 90000);
    try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data: b.data })); } catch (e) { /* 略過 */ }
    return b.data;
  }
  const arrow = n => n > 0 ? `<span class="chg up">▲ ${n}</span>` : n < 0 ? `<span class="chg down">▼ ${-n}</span>` : '<span class="chg">－ 0</span>';

  function markdown(p) {
    const L = [`# ${p.industry} 產業洞察素材包（${p.period}）`, '', `資料：${p.sources.join('；')}。熱度＝近 ${p.window_days} 天新聞則數，變化與前 ${p.window_days} 天（${p.prev_period}）比較。`, ''];
    L.push('## 主題熱度', '| 主題 | 熱度 | 雙週變化 | 相關公司 |', '|---|---|---|---|');
    p.topics.forEach(t => L.push(`| ${t.name} | ${t.heat} | ${t.change > 0 ? '▲' : t.change < 0 ? '▼' : '－'} ${Math.abs(t.change)} | ${t.companies.map(c => c.name).join('、') || '—'} |`));
    L.push('', '## 本期重點事件');
    p.events.forEach((e, i) => L.push(`${i + 1}. ${String(e.at).slice(0, 10)}｜${e.title}（${e.publisher || '新聞'}）${e.url}`, `   - 主題：${e.topics.join('、')}`, `   - AWS 切入角度：${e.angle}`));
    L.push('', '## 建議標題'); p.titles.forEach((t, i) => L.push(`${i + 1}. ${t}`));
    if (p.aws_refs.length) { L.push('', '## AWS 參考資源'); p.aws_refs.forEach(r => L.push(`- ${r.title}：${r.url}`)); }
    L.push('', `— 企業雲端商機洞察平台（產生於 ${String(p.created_at).replace('T', ' ').slice(0, 16)}；內容由規則產生，未使用 AI）`);
    return L.join('\n');
  }

  function render(d) {
    pack = d.pack;
    const p = pack;
    $('in-ind').innerHTML = d.industries.map(x => `<option value="${esc(x.key)}"${x.key === p.industry_key ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
    $('in-title').textContent = `${p.industry} 產業洞察素材包`;
    $('in-sub').textContent = `${p.period}・與 ${p.prev_period} 比較・產生於 ${String(p.created_at).replace('T', ' ').slice(0, 16)}`;
    const mx = Math.max(1, ...p.topics.map(t => t.heat));
    $('heat').innerHTML = p.topics.map((t, i) => `<li>
      <button type="button" class="heat-row" aria-expanded="false" aria-controls="ht-${i}">
        <span class="h-name">${esc(t.name)}</span><span class="rt-bar"><i style="width:${t.heat / mx * 100}%"></i></span><b class="h-num">${t.heat}</b>${arrow(t.change)}</button>
      <div class="heat-detail" id="ht-${i}" hidden>
        <p class="h-angle"><b>AWS 切入角度：</b>${esc(t.angle)}</p>
        ${t.companies.length ? `<p class="h-cos"><b>相關公司：</b>${t.companies.map(c => `<a href="lookup.html?q=${esc(c.code)}">${esc(c.name)}</a>`).join('、')}</p>` : ''}
        <ul>${t.news.map(n => `<li><time>${esc(String(n.at).slice(0, 10))}</time> <a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted">${esc(n.publisher || '')}</span></li>`).join('') || '<li class="muted">近 14 天沒有新聞</li>'}</ul>
      </div></li>`).join('');
    $('heat').querySelectorAll('.heat-row').forEach(b => b.addEventListener('click', () => {
      const box = document.getElementById(b.getAttribute('aria-controls')), open = b.getAttribute('aria-expanded') === 'true';
      b.setAttribute('aria-expanded', String(!open)); box.hidden = open;
    }));
    $('titles').innerHTML = p.titles.map((t, i) => `<li><span>${esc(t)}</span><button type="button" class="lk-copy" data-t="${i}">複製</button></li>`).join('');
    $('titles').querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => Lead.copy(p.titles[Number(b.dataset.t)], b)));
    $('refs').innerHTML = p.aws_refs.map(r => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></li>`).join('') || '<li class="muted">沒有設定參考資源</li>';
    $('events').innerHTML = p.events.map(e => `<li><div class="ev-top"><time>${esc(String(e.at).slice(0, 10))}</time>${e.topics.map(t => `<span class="rl-type">${esc(t)}</span>`).join('')}</div>
      <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a> <span class="muted">${esc(e.publisher || '')}</span>
      <p class="ev-angle"><b>AWS 切入角度：</b>${esc(e.angle)}</p></li>`).join('') || '<li class="muted">本期沒有符合條件的重點事件</li>';
    $('in-foot').textContent = `資料來源：${p.sources.join('；')}。熱度只計標題命中產業情境詞與主題關鍵字的新聞，排除股市行情；相關公司為標題中出現的上市櫃簡稱。內容由規則產生，未使用 AI。`;
  }

  $('in-copy').addEventListener('click', e => pack && Lead.copy(markdown(pack), e.currentTarget));
  $('in-dl').addEventListener('click', () => pack && Lead.download(`${pack.industry}_產業洞察_${pack.period.replace('~', '_')}.md`, markdown(pack)));
  $('in-ind').addEventListener('change', async e => { $('in-sub').textContent = '載入中…'; render(await load(e.target.value)); });

  // 訂閱每週摘要信（POST，text/plain 避免 CORS 預檢）
  $('sub-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('sub-email').value.trim(), msg = $('sub-msg');
    msg.className = 'lk-status busy'; msg.textContent = '送出中…';
    try {
      const res = await fetch(CL.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'subscribe', email }) });
      const b = await res.json();
      const r = b.data || {};
      msg.className = 'lk-status' + (r.ok ? '' : ' warn'); msg.textContent = r.message || b.error || '送出失敗，請稍後再試。';
    } catch (err) { msg.className = 'lk-status warn'; msg.textContent = '送出失敗，請稍後再試。'; }
  });

  try { render(await load(new URLSearchParams(location.search).get('industry') || '')); }
  catch (e) { $('in-sub').textContent = '素材包載入失敗：' + (e.message || e); }
})();
