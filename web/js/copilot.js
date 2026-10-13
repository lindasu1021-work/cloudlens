/**
 * Copilot 面板（帳戶頁右欄）。POST 到 GAS（Content-Type: text/plain，避免 CORS 預檢）。
 * 展示模式：只讀預先生成的快取；即時模式：輸入通行碼後現場呼叫 Gemini（通行碼只存在本分頁的 sessionStorage）。
 */
const Copilot = (() => {
  const BTN = [
    { id: 'overview', name: '帳戶速覽' },
    { id: 'cio', name: '破冰信 CIO', lang: true },
    { id: 'cfo', name: '破冰信 CFO', lang: true },
    { id: 'objections', name: '預想異議' },
    { id: 'meddpicc', name: 'MEDDPICC 初稿' },
    { id: 'free', name: '自由提問', live: true, hidden: true }   // 以底部輸入框呈現
  ];
  const MEDD = { M: 'Metrics 量化效益', E: 'Economic Buyer 經濟決策者', D1: 'Decision Criteria 決策標準', D2: 'Decision Process 決策流程',
    P: 'Paper Process 採購流程', I: 'Identify Pain 痛點', C1: 'Champion 內部支持者', C2: 'Competition 競爭' };
  const PASS_KEY = 'cl:passcode';
  const esc = s => CL.esc(s);
  let state = { code: '', button: 'overview', lang: 'zh', busy: false, hook: () => {} };

  const getPass = () => { try { return sessionStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } };
  const setPass = v => { try { v ? sessionStorage.setItem(PASS_KEY, v) : sessionStorage.removeItem(PASS_KEY); } catch (e) { /* 無法儲存時只在本次有效 */ } };

  async function call(body) {
    const res = await fetch(CL.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || '後端錯誤');
    return j.data;
  }

  // [S#] → 可點的引用（與分數拆解、時間軸共用 hover 高亮）
  // 也容許舊版快取中的合併寫法 [S2, S3]
  const refify = html => html.replace(/\[(S\d+(?:\s*[,，、]\s*S\d+)*)\]/g, (m, list) =>
    list.split(/\s*[,，、]\s*/).map(r => `<span class="ref" data-ref="${r}" tabindex="0">[${r}]</span>`).join(''));
  const chips = arr => (arr || []).length ? `<div class="cp-used">依據：${refify(arr.map(r => '[' + String(r).replace(/[\[\]]/g, '') + ']').join(' '))}</div>` : '';

  function md(text) {
    const lines = String(text).split('\n');
    let html = '', inList = false;
    lines.forEach(l => {
      const t = l.trim();
      const close = () => { if (inList) { html += '</ul>'; inList = false; } };
      if (!t) { close(); return; }
      const inline = s => refify(esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'));
      if (/^#{1,4}\s/.test(t)) { close(); html += `<h3 class="cp-h">${inline(t.replace(/^#+\s*/, ''))}</h3>`; }
      else if (/^[-*•]\s/.test(t) || /^\d+\.\s/.test(t)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(t.replace(/^([-*•]|\d+\.)\s*/, ''))}</li>`; }
      else { close(); html += `<p>${inline(t)}</p>`; }
    });
    return html + (inList ? '</ul>' : '');
  }

  function render(button, out) {
    if (button === 'overview' || button === 'free') return md(out);
    if (button === 'cio' || button === 'cfo') {
      const text = `主旨：${out.subject}\n\n${out.body}`;
      return `<div class="cp-mail"><div class="cp-subject"><span class="muted">主旨</span> ${esc(out.subject)}</div>
        <div class="cp-body">${refify(esc(out.body)).replace(/\n/g, '<br>')}</div></div>${chips(out.signals_used)}
        <button type="button" class="btn-secondary cp-copy" data-copy="${esc(text)}">複製信件</button>`;
    }
    if (button === 'objections') {
      return `<ol class="cp-obj">${out.map(o => `<li><b>${refify(esc(o.objection))}</b><p>${refify(esc(o.response))}</p>${chips(o.signals_used)}</li>`).join('')}</ol>`;
    }
    if (button === 'meddpicc') {
      return `<table class="cp-medd"><tbody>${Object.keys(MEDD).map(k => {
        const f = out[k] || {};
        const st = f.status === '已知' ? '<span class="badge tier-2">已知</span>' : '<span class="badge tier-3">待驗證</span>';
        const q = (f.questions || []).length ? `<ul>${f.questions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
        return `<tr><th scope="row" class="plain">${k}<br><span class="muted">${MEDD[k]}</span></th><td>${st}<p>${refify(esc(f.content))}</p>${q}</td></tr>`;
      }).join('')}</tbody></table>`;
    }
    return esc(JSON.stringify(out));
  }

  function paintHeader(root) {
    const live = !!getPass();
    root.querySelectorAll('.cp-modeseg button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.mode === 'live') === live)));
    root.querySelectorAll('.cp-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === state.button)));
    const cur = BTN.find(x => x.id === state.button);
    root.querySelector('.cp-lang').hidden = !(cur && cur.lang);
    root.querySelectorAll('.cp-lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
    const ask = root.querySelector('.cp-ask');
    const inp = ask.querySelector('input'), send = ask.querySelector('button');
    inp.disabled = !live; send.disabled = !live;
    inp.placeholder = live ? '只針對這家公司提問，例如：資安的切入點是什麼？' : '即時模式才能自由提問（需通行碼）';
  }

  async function run(root) {
    if (state.busy) return;
    const out = root.querySelector('.cp-out');
    if (state.button === 'free' && !root.querySelector('.cp-ask input').value.trim()) { out.innerHTML = '<p class="muted">請先輸入問題。</p>'; return; }
    state.busy = true;
    out.setAttribute('aria-busy', 'true');
    out.innerHTML = `<p class="muted">${getPass() ? '產生中…（約 10–30 秒）' : '讀取中…'}</p>`;
    try {
      const d = await call({ action: 'copilot', code: state.code, button: state.button, lang: state.button === 'cio' || state.button === 'cfo' ? state.lang : 'zh',
        passcode: getPass() || undefined, question: state.button === 'free' ? root.querySelector('.cp-ask input').value.trim() : undefined });
      if (/通行碼不正確/.test(d.notice || '')) setPass('');
      const meta = d.output ? `<div class="cp-meta">${d.cached ? '快取' : '剛產生'}${d.created_at ? '・' + esc(String(d.created_at).replace('T', ' ').slice(0, 16)) : ''}・${d.mode === 'live' ? '即時模式' : '展示模式'}・AI 產生，請依 [S#] 查證</div>` : '';
      out.innerHTML = (d.notice ? `<p class="cp-notice">${esc(d.notice)}</p>` : '') + (d.output ? render(state.button, d.output) + meta : '');
      out.querySelectorAll('.cp-copy').forEach(b => b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = '已複製'; } catch (e) { b.textContent = '無法複製，請手動選取'; }
      }));
      state.hook(out);
    } catch (e) {
      out.innerHTML = `<p class="cp-notice">目前無法連線 Copilot：${esc(e.message)}</p>`;
    } finally {
      state.busy = false;
      out.removeAttribute('aria-busy');
      paintHeader(root);
    }
  }

  function mount(root, code, hookRefs) {
    state = { code, button: 'overview', lang: 'zh', busy: false, hook: hookRefs };
    root.innerHTML = `
      <div class="cp-head"><h2>Copilot</h2>
        <div class="cp-modeseg seg-toggle" role="group" aria-label="模式"><button type="button" data-mode="demo">展示模式</button><button type="button" data-mode="live">即時模式</button></div></div>
      <form class="cp-login" hidden><label for="cp-pass" class="sr-only">通行碼</label>
        <input id="cp-pass" type="password" autocomplete="off" placeholder="即時模式通行碼"><button type="submit" class="btn-primary">確認</button></form>
      <div class="cp-btns" role="group" aria-label="Copilot 功能">${BTN.filter(b => !b.hidden).map(b => `<button type="button" class="cp-btn" data-id="${b.id}">${b.name}</button>`).join('')}</div>
      <div class="cp-lang" role="group" aria-label="語言"><button type="button" data-lang="zh">中文</button><button type="button" data-lang="en">EN</button></div>
      <div class="cp-out" aria-live="polite"></div>
      <form class="cp-ask"><label for="cp-q" class="sr-only">向 Copilot 提問</label>
        <input id="cp-q" type="text" maxlength="300" autocomplete="off"><button type="submit" class="btn-primary">送出</button></form>
      <p class="cp-foot">AI 產生・請依 [S#] 查證。只依據本頁訊號，資料沒有的會註明「目前資料中沒有」；不含個人姓名。</p>`;
    root.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || b.type === 'submit') return;
      if (b.classList.contains('cp-btn')) { state.button = b.dataset.id; state.lang = 'zh'; paintHeader(root); run(root); }
      else if (b.dataset.lang) { state.lang = b.dataset.lang; paintHeader(root); run(root); }
      else if (b.dataset.mode === 'live') {
        if (getPass()) return;
        const f = root.querySelector('.cp-login'); f.hidden = false; f.querySelector('input').focus();
      } else if (b.dataset.mode === 'demo') {
        root.querySelector('.cp-login').hidden = true;
        if (getPass()) { setPass(''); if (state.button === 'free') state.button = 'overview'; paintHeader(root); run(root); }
      }
    });
    root.querySelector('.cp-ask').addEventListener('submit', e => {
      e.preventDefault();
      if (!getPass() || !e.target.querySelector('input').value.trim()) return;
      state.button = 'free'; paintHeader(root); run(root);
    });
    root.querySelector('.cp-login').addEventListener('submit', e => {
      e.preventDefault();
      const v = e.target.querySelector('input').value.trim();
      if (!v) return;
      setPass(v); e.target.hidden = true; e.target.querySelector('input').value = '';
      paintHeader(root); run(root);
    });
    paintHeader(root);
    run(root);
  }

  return { mount };
})();
