/**
 * 關鍵字字典 v2（01 檔第 7 節）→ config_keywords 分頁，Verna 可直接在 Sheets 修改。
 * Phase 2 新增（依實測新聞雜訊）：
 *   EXCLUDE_NEWS：股市行情類新聞標題，整則不計
 *   NEG：與指定類別同時出現時，該類別不計（play 欄填被否定的類別），例：「AI伺服器」不算 AI 策略意圖、「拉貨」不算 AWS 客戶
 *   CTX／CTX_VENDOR：VENDOR 必須與這些語境詞同時出現才算；新聞中的弱訊號也須與 CTX 同現（避免「AI 重電訂單」這類行情新聞）
 */

var PLAY_OF = { MIG: 'Migration', DATA: 'Data', AI: 'GenAI', SEC: 'Security' };

function kwList_(category, strength, scope, words) {
  return words.map(function (w) { return { category: category, keyword: w, strength: strength, industry_scope: scope }; });
}

function defaultKeywords_() {
  var k = [];
  // 7.1 MIG
  k = k.concat(kwList_('MIG', 'strong', 'all', ['上雲', '公有雲', '公雲', '混合雲', '多雲', '雲原生', '雲端遷移', '雲端化', '機房搬遷', '資料中心汰換', '主機汰換',
    '核心系統更換', '核心系統轉換', '新核心系統', '系統現代化', 'IT現代化', '微服務', '中台', 'Open API', 'DevSecOps', '平台工程', 'Kubernetes', '容器化']));
  k = k.concat(kwList_('MIG', 'strong', 'fin', ['金融上雲', '雲端服務自律規範', '作業委外', '委外雲端', '韌性管理', '退場機制']));
  k = k.concat(kwList_('MIG', 'strong', 'mfg', ['ERP 導入', 'ERP 升級', 'SAP S/4HANA', 'MES 導入', '雲端 ERP']));
  k = k.concat(kwList_('MIG', 'weak', 'all', ['雲端', '資料中心', 'DevOps', '敏捷開發', 'ERP', 'SAP', 'VMware', '虛擬化', '數位轉型']));
  // 7.2 DATA
  k = k.concat(kwList_('DATA', 'strong', 'all', ['數據平台', '資料平台', '資料中台', '數據中台', '資料湖', '資料倉儲', '湖倉', '數據治理', '資料治理', '數據整合',
    '即時分析', '預測分析', '顧客數據平台', 'CDP']));
  k = k.concat(kwList_('DATA', 'strong', 'fin', ['IFRS 17', '新一代清償能力制度', 'ICS', '開放金融', '開放銀行', '數位帳戶', '數位分行', '精準行銷', '反洗錢系統', 'AML', '風控模型']));
  k = k.concat(kwList_('DATA', 'strong', 'mfg', ['智慧製造', '智慧工廠', '工業 4.0', 'AIoT', '物聯網', '預測性維護', '數位孿生', '數位分身', '良率分析', 'APS', '排程最佳化',
    '邊緣運算', '碳盤查', '碳足跡', '碳費', '溫室氣體盤查', '淨零', 'ESG 數據平台', 'CBAM']));
  k = k.concat(kwList_('DATA', 'weak', 'all', ['大數據', '數據分析', '商業智慧', 'BI', '儀表板', '可視化']));
  // 7.3 AI
  k = k.concat(kwList_('AI', 'strong', 'all', ['生成式AI', 'GenAI', '大型語言模型', 'LLM', 'RAG', '檢索增強生成', 'AI 助理', 'AI Agent', '智慧代理', '企業級 AI', 'AI 平台',
    'AI 應用落地', 'AI數位同事']));
  k = k.concat(kwList_('AI', 'strong', 'fin', ['金融業運用AI指引', '智慧客服', 'AI 理賠', 'AI 核保', '智能理專']));
  k = k.concat(kwList_('AI', 'strong', 'mfg', ['AI 瑕疵檢測', 'AOI', 'AI 視覺檢測', 'AI 排程']));
  k = k.concat(kwList_('AI', 'weak', 'all', ['AI', '人工智慧', '機器學習', '聊天機器人', 'RPA', '流程自動化', 'ChatGPT']));
  // 7.4 SEC
  k = k.concat(kwList_('SEC', 'strong', 'all', ['網路資安事件', '資安事件', '遭受駭客', '網路攻擊', '勒索軟體', '勒索病毒', '資料外洩', '個資外洩', '零信任', '資安長',
    '資安專責單位', '營運持續', '災難復原', '異地備援', 'DDoS']));
  k = k.concat(kwList_('SEC', 'strong', 'fin', ['金融資安行動方案', '資安監控中心', 'SOC', '金融 Fast-ID']));
  k = k.concat(kwList_('SEC', 'strong', 'mfg', ['SEMI E187', '供應鏈資安', 'OT 資安', '工控資安']));
  k = k.concat(kwList_('SEC', 'weak', 'all', ['資安', '資訊安全', 'ISO 27001', '個資保護']));
  // 7.5 TRIG（比對重訊主旨）
  var trig = [
    ['security_incident', 25, 'Security', ['網路資安事件', '資安事件說明', '遭受駭客網路攻擊', '資訊系統遭受']],
    ['m_and_a', 20, 'Migration,Data', ['合併', '收購', '併購', '取得股權', '投資設立', '增資子公司', '策略聯盟']],
    ['expansion', 20, 'Migration,Data', ['新建廠房', '擴建', '擴廠', '設廠', '海外子公司', '取得土地', '取得廠房']],
    ['cio_change', 20, 'Migration', ['資訊長', '技術長', '數位長', '資安長']], // 需同時出現 異動/新任 等詞（signals.gs 處理）
    ['transformation', 15, 'Migration', ['數位轉型', '系統上線', '核心系統', '系統轉換', 'ERP']],
    // D26：「取得使用權資產」實測多為集團內部租約，不列入
    ['capex', 10, 'Data,Migration', ['取得機器設備', '資本支出', '取得資訊設備']]
  ];
  trig.forEach(function (t) {
    t[3].forEach(function (w) { k.push({ category: 'TRIG', keyword: w, strength: 'strong', industry_scope: 'all', trig_type: t[0], points: t[1], play: t[2] }); });
  });
  k.push({ category: 'TRIG', keyword: '取得.{0,20}股份(?!有限)', match_type: 'regex', strength: 'strong', industry_scope: 'all', trig_type: 'm_and_a', points: 20, play: 'Migration,Data' });
  // 7.6 VENDOR（trig_type 欄記雲端類別）
  [['aws', ['AWS', 'Amazon Web Services', '亞馬遜雲端', '亞馬遜網路服務']],
   ['competitor', ['Azure', 'Microsoft Azure', '微軟雲', 'GCP', 'Google Cloud', '谷歌雲', '阿里雲', 'Oracle Cloud', 'OCI', 'IBM Cloud', 'hicloud']],
   ['onprem', ['自建機房', '地端系統', '主機汰換', 'AS/400', '大型主機']]].forEach(function (v) {
    v[1].forEach(function (w) { k.push({ category: 'VENDOR', keyword: w, strength: 'strong', industry_scope: 'all', trig_type: v[0] }); });
  });
  k = k.concat(kwList_('CTX', 'strong', 'all', ['採用', '導入', '上雲', '雲端服務', '遷移', '建置', '部署', '上線', '啟用', '推動', '打造']));
  // VENDOR 的語境可較寬（「助大同完成 SAP 轉型」「與 AWS 簽約」）
  k = k.concat(kwList_('CTX_VENDOR', 'strong', 'all', ['轉型', '合作', '夥伴', '攜手', '簽約', '完成']));
  // 7.8 EXCLUDE（重訊例行公告）
  k = k.concat(kwList_('EXCLUDE', 'strong', 'all', ['股利', '股東常會', '股東會', '公司債', '可轉換公司債', '澄清媒體報導', '董事會召開日期', '代子公司公告背書保證', '資金貸與',
    '庫藏股', '財務報告', '自結損益', '法說會', '董事辭任', '獨立董事', '薪酬委員會', '除權息', '轉投資損益',
    // Phase 2 新增：財報類（避免「合併自結業績」被當成併購）
    '自結', '財報', '財務報表', '損益', '業績', '董事會日期', '股東臨時會', '營收', '營業收入', '理財商品', '債券', '金融債', '次順位', '營運情形']));
  // Phase 2 新增：股市行情類新聞
  k = k.concat(kwList_('EXCLUDE_NEWS', 'strong', 'all', ['目標價', '概念股', '法人', '外資', '投信', '買超', '賣超', '漲停', '跌停', '股價', '本益比', 'EPS', '除息',
    '台股', '大盤', '盤中', '收盤', '飆', '噴', '利多', '利空', '接單', '訂單', '商機', '受惠', '族群', '補漲', '法說', '營收', '獲利',
    '熱門股', '個股', '題材', '市值', '漲價', '產能', '出貨']));
  // Phase 2 新增：否定詞（play 欄＝被否定的類別）
  k = k.concat(['AI伺服器', 'AI 伺服器', 'AI晶片', 'AI PC', 'AI供應鏈', 'AI 供應鏈', 'AI商機', 'AI題材', 'AI需求', 'AI電源', 'AI機櫃',
    '電源', '變壓器', '散熱', '液冷', '大單', '算力', '重電', '電力']
    .map(function (w) { return { category: 'NEG', keyword: w, strength: 'strong', industry_scope: 'all', play: 'AI' }; }));
  k = k.concat(['拉貨', '供應鏈', '供應商', '受惠', '訂單', '出貨', '機櫃', '伺服器', 'Trainium', 'ASIC', '資本支出', '採購']
    .map(function (w) { return { category: 'NEG', keyword: w, strength: 'strong', industry_scope: 'all', play: 'VENDOR' }; }));

  // 規則 v3（R1）：賣方語境——製造業公司「賣」AI 產品、參展、做先進封裝，不等於「導入」AI。只否定 AI 類（play 欄＝AI），限製造業
  k = k.concat(['預製', '模組化', '缺電', '電網', '解方', '解決方案', 'AIDC', 'AI資料中心', 'AI 資料中心', '先進封裝', '光通訊', '小晶片', 'Chiplet',
    'COMPUTEX', '首展', '展出', '亮相', '展覽', '自動化展', '能源展', '工具機展', '電子展', '產學', 'MOU', '基礎建設']
    .map(function (w) { return { category: 'NEG', keyword: w, strength: 'strong', industry_scope: 'mfg', play: 'AI' }; }));
  // 規則 v3（R1）：公司名稱誤配。這些詞含公司簡稱但不是該公司（例：「AI新巨獸」≠新巨、「台產業」≠台產）；比對公司名前先移除
  k = k.concat(['新巨獸', '台產業', '大同大學', '東台灣', '聯電子']
    .map(function (w) { return { category: 'NAME_FALSE', keyword: w, strength: 'strong', industry_scope: 'all', play: '' }; }));
  var seq = {};
  return k.map(function (r) {
    seq[r.category] = (seq[r.category] || 0) + 1;
    var ascii = /^[\x20-\x7e]+$/.test(r.keyword);
    return {
      keyword_id: r.category + '-' + ('00' + seq[r.category]).slice(-3),
      category: r.category, keyword: r.keyword, strength: r.strength, industry_scope: r.industry_scope,
      match_type: r.match_type || (ascii ? 'word' : 'substring'),
      trig_type: r.trig_type || '', points: r.points || '',
      play: r.play || PLAY_OF[r.category] || '', active: true
    };
  });
}

/**
 * 把程式內建字典中「Sheets 還沒有的詞」補進 config_keywords（以 類別＋關鍵字 判斷）。
 * 不覆蓋、不刪除既有列：Verna 要停用某詞請把 active 改成 FALSE（直接刪列會在下次被補回）。
 */
function seedKeywords_() {
  var have = {}, maxSeq = {};
  readTable_('config_keywords').forEach(function (r) {
    have[r.category + '|' + r.keyword] = true;
    var m = String(r.keyword_id).match(/^(.*)-(\d+)$/);
    if (m) maxSeq[m[1]] = Math.max(maxSeq[m[1]] || 0, Number(m[2]));
  });
  var fresh = defaultKeywords_().filter(function (k) { return !have[k.category + '|' + k.keyword]; }).map(function (k) {
    maxSeq[k.category] = (maxSeq[k.category] || 0) + 1;
    k.keyword_id = k.category + '-' + ('00' + maxSeq[k.category]).slice(-3);
    return k;
  });
  return appendObjects_('config_keywords', fresh);
}

// ---------- 比對 ----------

/** 讀 active 字典並預先編譯；回傳 { byCat: {MIG: [...]}, ... } */
function loadKeywords_() {
  var byCat = {};
  readTable_('config_keywords').forEach(function (r) {
    if (r.active === false || String(r.active).toUpperCase() === 'FALSE') return;
    var kw = String(r.keyword);
    var re;
    if (r.match_type === 'regex') re = new RegExp(kw);
    else if (r.match_type === 'word') re = new RegExp('(^|[^A-Za-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&').replace(/ /g, '\\s*') + '($|[^A-Za-z0-9])', 'i');
    else re = null;
    (byCat[r.category] = byCat[r.category] || []).push({
      id: r.keyword_id, kw: kw.replace(/\s+/g, ''), re: re, weight: r.strength === 'weak' ? 0.5 : 1,
      scope: r.industry_scope || 'all', trig_type: r.trig_type, points: Number(r.points) || 0, play: String(r.play || '')
    });
  });
  return byCat;
}

function scopeOk_(scope, industryCode) {
  if (scope === 'fin') return industryCode === '17';
  if (scope === 'mfg') return industryCode === '05' || industryCode === '28';
  return true;
}

/** 回傳命中的字典項目（依產業限定）。text 為原文；substring 比對時忽略空白。 */
var compactCache_ = { text: null, compact: '' };
function matchCat_(entries, text, industryCode) {
  if (compactCache_.text !== text) compactCache_ = { text: text, compact: String(text).replace(/\s+/g, '') };
  var compact = compactCache_.compact;
  return (entries || []).filter(function (e) {
    if (!scopeOk_(e.scope, industryCode)) return false;
    return e.re ? e.re.test(text) : compact.indexOf(e.kw) >= 0;
  });
}
