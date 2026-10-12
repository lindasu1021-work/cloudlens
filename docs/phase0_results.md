# Phase 0 技術驗證結果

> 測試日期：2026-10-12（週一）｜測試者：Claude Code
> **A 欄**＝從 Verna 的 Mac（台灣 IP）以 curl 實測，已完成。
> **B 欄**＝從 GAS（Google 海外伺服器）實測，2026-10-12 11:49 執行 `runPhase0`，結果在 Sheets `phase0_results` 分頁，並經 Web App `?action=phase0` 讀回。
> **結論：所有政府來源從海外皆可連，不需備案 B（Mac 排程）。**

## 1. 資料來源連線結果

| # | 來源 | 確認後的端點 | A：台灣 IP | B：GAS | 筆數（2026-10-12） | 結論 |
|---|---|---|---|---|---|---|
| 1 | 證交所 上市公司基本資料 | `openapi.twse.com.tw/v1/opendata/t187ap03_L` | ✅ 200，24.1 s，1.3 MB | ✅ 200，16.6 s | 1,095 | 可用；回應慢，GAS 需留意逾時 |
| 2 | 櫃買 上櫃股票基本資料 | `www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O` | ✅ 200，1.3 s | ✅ 200，7.5 s | 893 | 可用；**欄位為英文**（見 §2） |
| 3 | 證交所 月營收 | **`t187ap05_L`**（上市）；spec 寫的 `t187ap05_P` 是「公開發行公司」，不適用 | ✅ 200，1.5 s | ✅ 200，5.5 s | 868（_P 只有 241） | **修正端點**；只有最新月（見 §3） |
| 3' | 櫃買 月營收 | `www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O` | ✅ 200，0.4 s | ✅ 200，2.0 s | 758 | 可用 |
| 4 | 證交所 每日重大訊息 | `t187ap04_L` | ✅ 200，1.2 s | ✅ 200，0.5 s | 5（週日公告） | 可用；只給當日 |
| 4' | 櫃買 每日重大訊息 | `www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O` | ✅ 200，0.1 s | ✅ 200，0.3 s | 2 | **已確認端點** |
| 5 | 證交所 ESG 資訊安全 | `t187ap46_L_16` | ✅ 200，3.3 s | ✅ 200，1.5 s | 831（報告年度 114） | 可用；**上櫃無對應端點**（見 §3） |
| 6 | Google News RSS | `news.google.com/rss/search?q=<查詢>&hl=zh-TW&gl=TW&ceid=TW:zh-Hant` | ✅ 200，0.8 s | ✅ 200，0.4 s | 單次最多約 100 則 | 參數確認；`q` 內可加 `when:30d` 限期間 |
| 7 | 台灣就業通職缺 | 見 §3 | ⚠️ 200 但不可用 | ⚠️ 200，12.0 s（同樣 1,000 筆） | **上限 1,000 筆、99% 台北市** | **不可作為 N2/T4 來源** |
| 8 | AWS 客戶案例 | `aws.amazon.com/api/dirs/items/search?item.directoryId=solution-case-studies-cards-interactive-customer-references&item.locale=zh_TW` | ⚠️ 200 但不完整 | ⚠️ 200，0.3 s | 241 則（全球），標 Taiwan 只有 1 則 | 依 spec 備案：一次性整理清單存 config |
| F1 | 備案：FinMind 月營收 | `api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMonthRevenue` | ✅ 200（未登入即可） | ❌ **402 已達請求上限** | — | GAS 共用 Google IP，匿名額度被用光；**不採用** |
| F2 | MOPS 月營收彙總 HTML | `mopsov.twse.com.tw/nas/t21/{sii\|otc}/t21sc03_{民國年}_{月}_{0\|1}.html`（0＝國內、1＝KY；Big5 編碼） | ✅ 200，379 KB | ✅ 200，4.2 s | 2026-08：三產業 **351/351** | **改為月營收主來源**（可取任一歷史月） |
| 9 | Gemini API | `generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` | 端點存在（無金鑰回 403） | ⏳ | — | 待 Verna 設金鑰後執行 `testGemini` |
| 10 | Web App GET | `<exec>?action=ping` | — | ✅ 回 JSON | — | 可用；GitHub Pages 實測待 push |
| 11 | Web App POST（text/plain） | `<exec>` | — | ✅ 回 JSON，中文正常 | — | 可用；GitHub Pages 實測待 push |

## 2. 已確認的欄位與代碼（原標 ⚠待確認）

**產業代碼**：上市與上櫃**相同** — `05` 電機機械、`17` 金融保險、`28` 電子零組件。
（上市欄位 `產業別`；上櫃欄位 `SecuritiesIndustryCode`）

| 產業 | 上市 | 上櫃 | 合計 |
|---|---|---|---|
| 05 電機機械 | 50 | 51 | 101 |
| 17 金融保險 | 31 | 9 | 40 |
| 28 電子零組件 | 104 | 106 | 210 |
| **合計** | 185 | 166 | **351** |

**資本額分布（供 Phase 1 決定門檻，先給參考）**：≥10 億 185 家；≥20 億 95 家；≥30 億 70 家。要落在約 200 家，門檻約 **8.9 億**。

**欄位對照**（主檔，兩市場欄位名稱不同，normalize 時要對齊）：

| spec 欄位 | 上市 t187ap03_L | 上櫃 mopsfin_t187ap03_O |
|---|---|---|
| stock_code | 公司代號 | SecuritiesCompanyCode |
| name_full | 公司名稱 | CompanyName |
| name_short | 公司簡稱 | CompanyAbbreviation |
| 英文名（alias） | 英文簡稱 | Symbol |
| industry_code | 產業別 | SecuritiesIndustryCode |
| capital | 實收資本額 | Paidin.Capital.NTDollars |
| 統一編號（對應用） | 營利事業統一編號 | UnifiedBusinessNo. |

**其他注意事項**
- 日期為**民國年**字串：`1151011` = 2026-10-11；月營收 `資料年月` `11509` = 2026-09。
- 月營收單位為**千元**；已附 `營業收入-去年同月增減(%)`（YoY），但只有**最新一個月**。
- 上市重大訊息的主旨欄位名稱是 **`"主旨 "`（尾端有空格）**；上櫃是 `"主旨"`。上市／上櫃重訊欄位：發言日期、發言時間、公司代號、公司名稱、主旨、符合條款、事實發生日、說明。
- ESG 資訊安全欄位：報告年度、公司代號、資訊外洩事件數量、與個資相關的資訊外洩事件占比、因資訊外洩事件而受影響的顧客數(人)。數量值有 **`N/A`（297 筆）**，要當「缺資料」而不是 0。
- 主檔含董事長、發言人等個人姓名；依 spec **不得寫入 Sheets**，normalize 時直接丟棄。

## 3. 問題與備案（2026-10-12 Verna 已確認，見決策 D17–D20）

### 問題 1：月營收（影響 N1、T3）→ 已解決
- 9 月資料「缺 70 家」（含台達電、全部金控）**是時間差不是缺漏**：10/10 國慶日放假，申報期限順延至 10/12，測試當下尚未申報。8 月資料三產業 351 家全數都有，金控也有。
- OpenAPI 只給最新一個月；FinMind 從 GAS 被擋（402）。
- **改用 MOPS 月營收彙總 HTML** 為主來源：上市 `sii`、上櫃 `otc`，國內 `_0`＋KY `_1`，可取任一歷史月份，GAS 可連。需以 Big5 解碼。
- **建議**：每月排程由 12 日改為 **15 日**，避開連假順延。

### 問題 2：就業通不可用（影響 N2、T4，共 35 分）
- data.gov.tw 44062 的下載檔、Webservice、Datastore API **都只回傳最多 1,000 筆**，且 99% 位於**台北市**（端點名稱就叫 `webservice_taipei`），offset 超過 1000 回 0 筆。
- 1,000 筆中與三產業 351 家公司名稱完全相符：**0 家**；資訊類職缺只有 36 筆。
- **建議（擇一）**：
  - **A1（建議）**：N2/T4 改為「缺資料」，依 spec 的缺資料機制從分母移除；同時把重訊／新聞中的「招募、徵才、擴編研發」等詞加入 N3 字典作弱訊號。零成本、誠實，方法論頁說明限制。
  - A2：改用公司官網徵才頁（各家格式不同，維護成本高，不建議）。
  - 104／1111 等人力銀行：其服務條款限制爬取，不建議用在公開作品集。

### 問題 3：上櫃沒有 ESG 資訊安全端點（影響 N4）
- 櫃買 OpenAPI 的 ESG 系列只有 `t187ap46_O_1~9, 12~15, 19~21`，沒有資訊安全（_16）。
- **建議**：上櫃公司 N4 的 ESG 子項當「缺資料」；金融業基礎分與資安重訊照算。

### 問題 4：AWS 客戶案例無法自動抓台灣清單（影響驗證集、雲端現況）
- 案例目錄 API 可用但 zh_TW 只有 241 則全球案例，標記台灣的只有 1 則；台灣案例散在個別頁面。
- **建議**：依 spec 備案，Phase 2 一次性人工整理「AWS 台灣公開客戶案例 × 帳戶池」清單，存成 `config_aws_cases` 分頁（附案例網址），每季檢查一次。

## 4. 剩餘待辦
- [x] B 欄：GAS 對所有來源的結果（#1 在 GAS 為 16.6 秒，未逾時）
- [x] Web App GET／text/plain POST（curl 實測）
- [ ] Gemini：執行 `testGemini`
- [ ] GitHub Pages → GAS：瀏覽器跨網域實測（push 後）
