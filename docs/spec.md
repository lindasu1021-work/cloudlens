# CloudLens 規格書（交接給 Claude Code）

> 版本：v1.1（2026-10-12，依 Phase 0 結果更新第 3 節；決策 D17–D20）｜作者：Verna（Wei-Lin Su）
> 本檔整合同資料夾的 00–04 決策檔。細節以這些檔為準：
> - `00_決策紀錄.md`：所有決策與日期
> - `01_Step1_訊號與評分規則_v1.md`：完整關鍵字字典、計分細則
> - `02_Step2_Copilot對話框設計.md`：Copilot 完整規格
> - `03_Step3_呈現與配色原則.md`：色票、元件配色、字體
> - `04_運維與開發階段_草案.md`：排程、失敗處理、開發階段
>
> 若本檔與上述檔案衝突，以本檔為準，並回報 Verna。

---

## 0. 給 Claude Code 的工作守則

1. **照 Phase 順序施工**，每個 Phase 完成後停下來，列出「完成了什麼、怎麼驗證、哪些沒驗證到」，等 Verna 確認再進下一個。
2. **Phase 0 的結論決定後續架構**，不要跳過。
3. **不確定的 API 端點、參數、欄位名稱，一律先實測或查官方文件**，不可憑記憶寫。本檔標「⚠待確認」的項目尤其如此。
4. **秘密不落地**：Gemini 金鑰、通行碼、Email、Sheets ID 只放 GAS Script Properties；repo 是公開的。
5. **零成本**：不得引入任何付費服務。
6. **繁體中文**：介面、註解外的文件、commit 訊息說明可用中文。
7. 每個 Phase 用 Git commit 留下紀錄（commit 歷史本身是作品集證據）。

---

## 1. 專案概述

**一句話**：以公開資料為台灣上市櫃企業打分數並標出切入劇本（Play），協助 AWS 業務決定「先打誰、拿什麼去談」，再用 AI 產出帳戶速覽與破冰信草稿。

**用途**：Verna 的求職作品集，目標職位為 AWS／科技業 AE、SDR，以及 Sales Ops／RevOps／BA。

**範圍**
- 客群：上市櫃中大型企業，以 Greenfield（大型但尚未大量上雲）角度切入
- 產業：金融保險、電機機械、電子零組件；以資本額門檻控制在約 200 家（門檻在 Phase 1 看完分布後由 Verna 決定）
- 不蒐集任何個人姓名或聯絡方式

**成效指標（不宣稱回覆率）**
1. 調研時間實測：手動研究 3 家 vs 系統，各自計時
2. 評分驗證：AWS 台灣公開客戶案例中屬於帳戶池的公司，落在 Need 排名前 20% 的比例（precision@20%）

---

## 2. 技術架構

| 層 | 選擇 | 備註 |
|---|---|---|
| 排程與後端 | Google Apps Script（GAS） | 時間觸發器；Web App 當 API |
| 資料庫 | Google Sheets | 各分頁 = 資料表；config 分頁可由 Verna 直接修改 |
| 前端 | GitHub Pages（靜態 HTML/CSS/JS） | 公開 repo |
| AI | Gemini API 免費層 | 只用在 Copilot；模型名稱放設定 |
| 通知 | GAS MailApp | 寄到 Script Properties 的 `ALERT_EMAIL` |
| 程式碼管理 | GitHub；GAS 程式碼建議用 clasp 同步 | clasp 需 Verna 執行一次 `clasp login`；若不使用，改為手動貼上並在 README 說明 |

```
[每日 GAS 排程]  重大訊息 → raw_announcements
[每週 GAS 排程]  新聞 RSS · ESG 資安 · AWS 案例 → raw_*
[每月 GAS 排程]  公司主檔 · 月營收 → companies / raw_revenue
        ▼
[GAS 處理]  清理 → 公司對應 → 關鍵字比對 → signals
        ▼
[GAS 計分]  Need × Timing ＋ Play ＋ 雲端現況 → scores（含規則版本）
        ▼
[GAS Web App API]  JSON
        ▼
[GitHub Pages]  總覽 · 帳戶 · 方法論 · 資料狀態 · Copilot（唯一呼叫 Gemini 處）
```

**README 必附**：「正式上線版在 AWS 上的對應架構」— GAS 觸發器→EventBridge、GAS→Lambda、Sheets→S3＋Athena、Gemini→Bedrock、GitHub Pages→S3＋CloudFront。

---

## 3. 資料來源

| # | 來源 | 用途 | 頻率 | 端點／方式 |
|---|---|---|---|---|
| 1 | 證交所 OpenAPI 公司基本資料 | 主檔 | 每月 | `https://openapi.twse.com.tw/v1/opendata/t187ap03_L` ✅ |
| 2 | 櫃買中心 OpenAPI 公司基本資料 | 主檔（上櫃） | 每月 | `https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O` ✅（欄位為英文） |
| 3 | 證交所 OpenAPI 月營收 | T3 營收動能、N1 規模 | 每月 | MOPS `mopsov.twse.com.tw/nas/t21/{sii|otc}/t21sc03_{民國年}_{月}_{0|1}.html`（Big5；D17）；OpenAPI `t187ap05_L`/`mopsfin_t187ap05_O` 為次要 |
| 4 | 證交所 OpenAPI 每日重大訊息 | T1 觸發事件、N3、N4 | **每日**（只給當日） | `/v1/opendata/t187ap04_L`；上櫃 `mopsfin_t187ap04_O` ✅ |
| 5 | 證交所 OpenAPI ESG 資訊安全 | N4 | 每月檢查 | `/v1/opendata/t187ap46_L_16`（欄位含資訊外洩事件數量等） |
| 6 | Google News RSS | T2 新聞動能、N3 | 每週 | `https://news.google.com/rss/search?q=<查詢>&hl=zh-TW&gl=TW&ceid=TW:zh-Hant` ✅；`q` 可加 `when:30d`；每家一次查詢 |
| 7 | ~~台灣就業通~~ | ~~N2、T4~~ | — | ❌ 不採用（D18）：上限 1,000 筆且幾乎全為台北市；N2、T4 視為缺資料 |
| 8 | AWS 台灣客戶案例頁 | 驗證集、雲端現況「已是 AWS 客戶」 | 每月 | ❌ 無法自動取得台灣清單 → 一次性人工整理存 `config_aws_cases`（D20） |

產業代碼（篩選用）：電機機械 05、金融保險 17、電子零組件 28 ✅（上市與上櫃相同）。上櫃無 ESG 資訊安全端點（D19）。

---

## 4. Google Sheets 資料表

> 所有表第一列為欄位名稱。`*` 為主鍵。時間一律存 ISO 8601（台灣時區）。

### 4.1 設定（Verna 可直接修改）
| 分頁 | 欄位 |
|---|---|
| `config_settings` | key*, value, note（例：capital_threshold、daily_ai_limit=30、tier_percentile=0.30、gemini_model、rule_version、current_run_id） |
| `config_weights` | component*（N1–N4、T1–T4）, max_points, enabled, note |
| `config_keywords` | keyword_id*, category（MIG/DATA/AI/SEC/TRIG/VENDOR/JOB/EXCLUDE）, keyword, strength（strong/weak）, industry_scope（all/fin/mfg）, match_type（substring/word）, trig_type（TRIG 用）, points（TRIG 用）, play（逗號分隔）, active |
| `config_play_aws` | play*, aws_offering, talking_point |
| `config_company_overrides` | stock_code*, news_query, news_exclude_terms, note |

### 4.2 主檔
| 分頁 | 欄位 |
|---|---|
| `companies` | stock_code*, name_full, name_short, market（上市/上櫃）, industry_code, industry_name, capital, in_universe（bool）, updated_at |
| `company_aliases` | alias*, stock_code（主檔全名、簡稱、英文名等，用於公司對應） |

### 4.3 原始資料（只追加，不覆寫）
共同欄位：`raw_id*`（來源＋原始 ID 或內容雜湊）, `run_id`, `fetched_at`, `source_url`
| 分頁 | 額外欄位 |
|---|---|
| `raw_announcements` | stock_code, ann_date, subject, description, rule_ref |
| `raw_revenue` | stock_code, year_month, revenue, yoy_pct |
| `raw_news` | stock_code, query, title, published_at, publisher, link |
| `raw_jobs` | company_name_raw, tax_id（若有）, stock_code（對應後）, job_title, job_desc, posted_at |
| `raw_esg_security` | stock_code, report_year, breach_count, pii_breach_ratio, affected_customers |
| `raw_aws_cases` | company_name_raw, stock_code（對應後）, case_url |

### 4.4 處理結果
| 分頁 | 欄位 |
|---|---|
| `signals` | signal_id*, stock_code, signal_type（N2/N3/N4/T1/T2/T3/T4/VENDOR）, category, play, strength, points_raw, observed_at, title, evidence_url, source, run_id |
| `scores` | run_id*, stock_code*, rule_version, n1..n4, need, t1..t4, timing, need_pct, timing_pct, tier（1/2/3/hold）, play_primary, play_secondary, cloud_status（aws/competitor/unknown）, data_completeness, top_signal_ids |
| `validation` | run_id*, rule_version, validation_set_size, hits_top20pct, precision, note |

### 4.5 AI 與維運
| 分頁 | 欄位 |
|---|---|
| `ai_cache` | cache_key*（stock_code＋action＋lang＋run_id）, output_json, created_at, mode（demo/live） |
| `ai_log` | ts, stock_code, action, mode, success, error, est_tokens |
| `run_log` | run_id, step, started_at, ended_at, rows_in, rows_out, status, error |
| `mail_log` | mail_key*（run_id＋type）, sent_at |

---

## 5. 評分規則（摘要；完整版見 01 檔）

**通用**
- 遞減報酬：同類訊號 n 次，得分 = 滿分 × (1 − 0.5ⁿ)
- 時間衰減（Timing）：0–30 天 ×1.0；31–90 天 ×0.5；>90 天 ×0
- 缺資料不算 0 分：該項移出分母，另計 data_completeness
- 同一文件同一類別只計一次；同事件跨來源同週只計一次
- 強訊號權重 1.0、弱訊號 0.5；英文關鍵字整字比對；產業限定詞只對該產業計分；命中排除詞的重大訊息整則不計

**Need（0–100，各 25）**
- N1 規模：年化營收在帳戶池內的百分位 × 25
- N2 數位人才招募：近 90 天命中技術職缺字典的職缺數（遞減報酬）
- N3 策略意圖：近 365 天重訊＋新聞命中 MIG/DATA/AI 的文件數（遞減報酬）
- N4 資安合規壓力：金融業基礎 10；ESG 資訊外洩事件 >0 加 10；近 365 天資安事件重訊加 15；上限 25

**Timing（0–100）**
- T1 觸發事件（50）：重訊主旨命中 TRIG，依類型給分 × 時間衰減，加總上限 50（資安事件 25、併購 20、擴廠／海外 20、資訊主管異動 20、系統／轉型 15、資本支出 10）
- T2 新聞動能（20）：近 30 天命中新聞數 ÷ 過去 90 天月均；≥2 倍滿分，≥1.5 倍一半
- T3 營收動能（20）：連 3 個月 YoY > +15% → 20；連 3 個月 YoY < −15% → 15（降本需求）
- T4 招募加速（10）：近 30 天技術職缺 > 前 60 天月均 → 10

**Tier**：各軸在帳戶池內前 30% 為「高」。Need 高＋Timing 高 = Tier 1；Need 高 = Tier 2；Timing 高 = Tier 3；皆低 = 暫緩。

**Play**：訊號帶 Play 類別；各 Play 分數加總＋產業先驗（金融→Security、Data；電子零組件→Data、Migration；電機機械→Migration、Data，各 +5，只作平手依據）；最高為主 Play，第二名 ≥ 主 Play 50% 列次 Play。

**雲端現況**：在 AWS 案例 → aws（擴充）；提及 Azure/GCP 等 → competitor（替換）；提及 AWS → aws；皆無 → unknown（新導入）。

**規則版本**：每次調整權重或字典，`rule_version` +1，並在 `validation` 記錄驗證結果。

---

## 6. API 規格（GAS Web App）

讀取一律 GET；寫入／AI 一律 POST，`Content-Type: text/plain`，body 為 JSON 字串（避免 CORS 預檢）。回應皆為 `{ ok: bool, data?: any, error?: string, run_id: string }`。

| 方法 | 參數 | 回傳 |
|---|---|---|
| GET `?action=summary` | — | KPI（帳戶數、Tier 1 數、本週新觸發事件數、Greenfield 比例）、本週動態（升降 Tier、分數變化前 5、新事件）、更新時間 |
| GET `?action=accounts` | 可選 industry、tier、play、cloud | 帳戶清單：代號、名稱、產業、need、timing、tier、play、cloud_status、data_completeness |
| GET `?action=account&code=XXXX` | code | 基本資料、分數拆解（N1–N4、T1–T4、缺資料標記）、訊號列表（含 [S#] 編號）、Play、雲端現況 |
| GET `?action=status` | — | 各來源最後成功時間、筆數、最近錯誤 |
| GET `?action=methodology` | — | 目前規則版本、權重、驗證結果、歷次版本紀錄 |
| POST `copilot` | `{action:"copilot", code, button, lang, passcode?, question?}` | 見第 7 節 |

前端快取：同一 run_id 的 GET 結果可存 sessionStorage，降低 GAS 呼叫次數。

---

## 7. Copilot（完整版見 02 檔）

- 位置：帳戶頁右欄；只針對該公司
- 上下文：公司資料、分數拆解、Top 10 訊號（[S1]…含日期、標題、連結）、Play、雲端現況、`config_play_aws` 對照表
- 規則：每個論點標 [S#]；資料沒有就說「目前資料中沒有」；不得編造數字；不出現人名；預設繁中，破冰信可切英文（由中文版翻譯）
- 按鈕：帳戶速覽、破冰信 CIO、破冰信 CFO、預想異議、MEDDPICC 初稿、自由提問（僅即時模式）、中/EN
- JSON 輸出（破冰信、異議、MEDDPICC）：schema 驗證 → 失敗附錯誤重試最多 2 次 → 仍失敗回傳錯誤並記 ai_log
- 快取：key = 代號＋按鈕＋語言＋run_id，命中直接回傳
- 每日上限：`daily_ai_limit`（預設 30），台灣午夜歸零；用完回傳快取或提示
- 展示模式（預設）：每週排程為 Tier 1 預生成所有按鈕結果；訪客只讀快取
- 即時模式：需 `LIVE_PASSCODE`

---

## 8. 前端（配色與元件見 03 檔）

- 4 頁：總覽儀表板、帳戶頁、方法論、資料狀態
- 桌機為主，最小設計寬度 1280px；中文介面；字體 Noto Sans TC，數字 tabular-nums
- 總覽：KPI 列 → 象限散佈圖（依主 Play 上色＋形狀）＋本週動態 → 可篩選排序的帳戶表
- 帳戶頁：左欄分數拆解（可展開到訊號）＋訊號時間軸；右欄 Copilot；[S#] 與時間軸雙向對應（hover 高亮）
- 方法論：資料流架構圖（含 AWS 對照版）、評分規則、規則版本紀錄、驗證結果、限制說明
- 資料狀態：讀 status API
- 配色要點：靛紫 `#4A2F9F` 為唯一互動色、導覽列 `#2F1A7A`；橘只標示 Tier 1／新事件／分數上升；文字對比 ≥ 4.5:1；分數變化用 ▲▼ 不用紅綠；漸層只在品牌位置
- 不使用 AWS Logo，不模仿 AWS 主控台外觀

---

## 9. 排程與維運（完整版見 04 檔）

| 排程 | 時間（台灣） | 內容 |
|---|---|---|
| 每日 | 22:00–23:00 | 重大訊息；檢查週排程是否 >8 天未成功 |
| 每週 | 週一 05:00–06:00 | 新聞、ESG → 訊號 → 計分 → 預生成 Copilot → API 快照 → 摘要信 |
| 每月 | 15 日 05:00–06:00 | 公司主檔、月營收（避開 10 日申報期限遇假日順延；D21） |

- 6 分鐘上限：分批＋斷點（Script Properties）＋接續觸發器
- 網路錯誤重試 2 次（2 秒、8 秒）
- 單一來源失敗不中斷其他；計分寫到暫存，全部完成才切換 `current_run_id`
- 冪等：raw_id 去重、signal_id upsert、mail_log 防重寄
- 失敗通知與每週摘要信寄 `ALERT_EMAIL`
- Script Properties：`GEMINI_API_KEY`、`LIVE_PASSCODE`、`ALERT_EMAIL`、`SHEET_ID`

---

## 10. 開發階段與驗收

| Phase | 內容 | 驗收標準 |
|---|---|---|
| 0 技術驗證 | GAS 對第 3 節 8 個來源的連線測試；GitHub Pages ↔ GAS 的 GET 與 text/plain POST 測試；Gemini 免費層一次呼叫測試 | 產出連線結果表（可/不可、HTTP 狀態、耗時、筆數、欄位樣本）；確認所有 ⚠待確認 項目；不可連者依備案處理 |
| 1 資料骨幹 | 建立第 4 節所有分頁；主檔、月營收、重大訊息；run_log；每日排程 | 主檔篩出三產業公司並提供資本額分布給 Verna 決定門檻；每日排程連跑 3 天無誤、重跑不重複 |
| 2 訊號與計分 | 匯入 01 檔字典到 config；新聞、ESG、AWS 案例清單；signals、scores、Tier、Play、雲端現況；每週排程 | 挑 3 家公司（三產業各 1）輸出逐分明細供 Verna 人工核對；缺資料不算 0 分機制正確 |
| 3 前端 | 4 頁、配色、API 串接、篩選排序、證據追溯 | 1280px 下版面正確；任何分數可追到訊號與來源連結；Lighthouse 無障礙 ≥ 90 |
| 4 Copilot | Gemini 串接、按鈕、JSON 驗證重試、快取、展示/即時模式、每日上限 | 每個按鈕對 2 家公司產出合理結果；[S#] 皆對得到真實訊號；額度用完能降級 |
| 5 驗證與文件 | precision@20% 驗證、方法論頁、每週摘要信、README | README 含：架構圖＋AWS 對照圖、設定步驟、手動觸發、看 log、常見錯誤、停用排程、資料來源與限制、預估成本（零） |

**備案（Phase 0 連線被擋時）**
- A（優先）：改用可從海外連的來源，例如政府資料開放平臺下載連結、第三方台股資料 API（如 FinMind，使用前確認條款與免費額度）
- B：在 Verna 的 Mac 上排程跑爬蟲並寫回 Sheets（缺點：Mac 需開機）
- 選擇備案前先回報 Verna

---

## 11. Repo 結構（建議）

```
cloudlens/
├── README.md
├── docs/            ← 本規格書與 00–04 決策檔
├── gas/             ← Apps Script 原始碼（clasp 同步）
│   ├── config.gs  fetch_*.gs  normalize.gs  signals.gs  scoring.gs
│   ├── api.gs  copilot.gs  mail.gs  triggers.gs  utils.gs
│   └── appsscript.json
└── web/             ← GitHub Pages
    ├── index.html  account.html  methodology.html  status.html
    ├── css/tokens.css  css/app.css
    └── js/api.js  js/charts.js  js/copilot.js
```

---

## 12. 開場指令（貼給 Claude Code）

```
請先完整閱讀 docs/spec.md，以及 docs/ 內的 00–04 決策檔。
這是我的求職作品集專案，請依 spec 第 0 節的工作守則進行。

現在只做 Phase 0 技術驗證：
1. 建立 repo 結構與 README 骨架
2. 寫一支 GAS 測試腳本，逐一測試 spec 第 3 節的 8 個資料來源（HTTP 狀態、耗時、回傳筆數、前 2 筆欄位樣本），並確認所有標「⚠待確認」的端點與欄位
3. 測試 GitHub Pages 對 GAS Web App 的 GET 與 text/plain POST
4. 測試 Gemini 免費層一次呼叫（金鑰放 Script Properties）
5. 產出 docs/phase0_results.md 結果表

需要我操作的步驟（例如 clasp login、建立 Sheets、部署 Web App、設定 Script Properties），請寫成逐步說明讓我照做。
完成後停下來，回報結果與建議的備案，等我確認再進 Phase 1。
```

---

## 13. Step 4（不在本次開發範圍）

系統跑出真實資料並選出 Tier 1 後，回到一般 Claude 製作：Tier 1 標的 1–2 家的 MEDDPICC 戰略報告、CIO/CFO 破冰信定稿、90 天推進計畫（Mutual Action Plan）、作品集 Pitch Deck。
