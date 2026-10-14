---
name: gas-sheets-crawler
description: 用 Google Apps Script（GAS）＋Google Sheets 建立「零成本、可排程、可續跑、容易分析」的爬蟲與資料管線。當使用者要抓公開資料（政府 OpenAPI、HTML 表格、RSS、新聞）、定期更新、存進 Sheets 當資料庫、或要把原始資料整理成可計分／可分析的訊號時使用。涵蓋資料表設計、冪等寫入、6 分鐘上限的斷點續跑、重試、錯誤紀錄、告警、驗證與常見坑。
---

# GAS＋Sheets 爬蟲：高效率、可分析、不會悄悄壞掉

本 skill 來自「企業雲端商機洞察平台」的實戰：每日／每週／每月自動抓台灣證交所、櫃買、公開資訊觀測站、Google News，累積 5 萬多列資料，零成本跑在 Apps Script 上。
目標不是「抓得到」，而是**抓到的資料每一列都能被追溯、能被去重、能被直接拿去分析**。

## 0. 動手前先回答（5 分鐘，決定成敗）

1. **這份資料要回答什麼問題？** 先寫下 3–5 個會被問的問題，再倒推需要哪些欄位。抓了用不到的欄位是成本。
2. **來源是誰、多久更新、單次回多少？** 用 `curl` 實測一次：回應格式、編碼（台灣 MOPS 是 Big5）、筆數上限、是否擋海外 IP（GAS 從海外出口）。**先在本機驗證能抓到，再寫 GAS。**
3. **規模估算**：每次抓多久 × 幾次 → 是否超過 6 分鐘／日總額度（免費帳號觸發器每日約 90 分鐘）？超過就要分批＋斷點（見 §4）。
4. **誰會被誤傷？** 個人資料（姓名、聯絡方式）一律在寫入前丟棄，並寫進文件。

## 1. 資料分層（最重要的設計）

```
config_*   人可編輯的設定：字典、權重、門檻、覆寫（改了不用改程式）
raw_*      只追加、不修改：來源原樣＋fetched_at＋run_id＋source_url＋raw_id
signals    由 raw 以「規則」轉成的標準化訊號（一列一則證據）
scores     由 signals 計算的結果（保留歷史，每個 run_id 一份）
run_log    每個步驟一列：run_id, step, started_at, ended_at, rows_in, rows_out, status, error
mail_log   通知去重
```

規則：
- **raw 不改，換規則就重算 signals／scores**。這讓「改字典後 rescore」只要 1 分鐘，不必重抓。
- **每列都有 `raw_id`（冪等鍵）**：由來源穩定欄位組成，例如 `ann:twse:2330:2026-10-11T07:00:03:<md5(主旨)前10碼>`。同一則資料跨來源（OpenAPI／HTML 回補）也要產生同一個 id，才能去重。
- **每列帶 `source_url`**：最終 UI 才能做到「每個分數點得到原文」。
- **一張表一種語意**。不要把設定、原始、結果混在同一個分頁。
- **欄位用英文蛇形命名、值用最原始型別**（日期用 ISO、金額用數字），在分析層才做轉換。
- 代號、日期、ID 欄位**一律設純文字格式**（`'@'`）：`0050`、`2330`、`2026-10-01` 會被 Sheets 自動轉型，這是最常見的靜默錯誤。

## 2. 寫程式的原則

- **讀一次、算在記憶體、寫一次。** Sheets 的瓶頸是呼叫次數，不是資料量。
  - 讀：`getDataRange().getValues()` 整張讀進來轉成物件陣列。
  - 寫：組好二維陣列後一次 `setValues`；**絕不在迴圈中 `appendRow`**（10 倍到 100 倍慢）。
- **去重用物件當 hash**：先讀 `raw_id` 欄位建 `seen = {}`，過濾後再 append。
- **Upsert 用 key→列號表**，整表讀入、修改、整表寫回。
- **每個步驟是一個純函式** `fetchX_(runId, ...args) → {rows_in, rows_out, status?, note?}`，不丟例外時由 runner 記錄；丟例外 = error，由 runner 捕捉、記進 run_log，**不中斷其他步驟**。
- **偵測「解析 0 筆」要丟錯**：頁面改版時最危險的是「成功但沒資料」。`if (parsed === 0 && text.length > 5000) throw ...`。
- **HTTP 一律走 `fetchWithRetry_`**：重試 2 次（2 秒、8 秒）、5xx 重試、4xx 不重試、`muteHttpExceptions`、可指定 charset。JSON 被截斷會 parse 失敗，也要重抓（實測櫃買主檔發生過）。
- **禮貌**：步驟內 `Utilities.sleep(300–500)`；一次只抓一個來源；不要偽裝成瀏覽器去繞過擋爬。
- **設定放 Sheets／Script Properties，不放程式碼**：API key、通行碼、Email、Sheet ID 只存 Script Properties。
- 範本：`templates/core.gs`（可直接複製：屬性、重試、Sheets 讀寫、upsert、run_log、斷點 runner）。

## 3. 去重、補抓、回補

- **日常增量**：只抓「最近 N 天」，靠 raw_id 去重；N 要大於排程間隔（每週抓 8 天）。
- **歷史回補**：另開步驟族（例如 `annhist:20260812`），**一步只做一個最小單位**（一天／一個月檔案／一批公司），完成標記存在 Script Property（`{done:{key:true}}`），每次排程只取「尚未完成」的前 K 個。這樣：可中斷、可續跑、進度可顯示。
- **晚到資料**：最近 2 個月的月檔可能有公司晚申報，不要標記為「已完成」，每次重抓並靠 raw_id 去重。
- **分批索引要穩定**：批次用「排序後的代號切片」，不要用隨機順序，否則續跑會漏抓或重抓。

## 4. 6 分鐘上限：斷點續跑（必備）

GAS 單次執行上限 6 分鐘，免費帳號觸發器每日約 90 分鐘。模式（已在 `templates/core.gs` 實作）：

1. 工作 = 有序的 task 字串陣列（`'news:0:15'`、`'revenue:2026-08:sii:0'`）。
2. **每個 task 開始前先把 `{run_id, tasks, idx, failures}` 存進 Script Properties**（checkpoint-before-step）。
3. 時間預算 4.5 分鐘；用完就排一個 1 分鐘後的接續觸發器，下次從 `idx` 繼續。
4. **保險接續**：開跑時先排一個 7 分鐘後的接續。若這次被 GAS 強制殺掉（無法 catch），就由它從最後 checkpoint 繼續。正常完成再 `clearContinuation_`。
5. `LockService.getScriptLock()` 防重入；拿不到鎖就排接續後離開。
6. 超過一天的斷點視為過期。
7. **每日排程順手檢查「每週排程是否卡住」**並幫它接續；超過 8 天沒成功就寄告警。

單一步驟本身也不能超過 6 分鐘：MOPS 歷史重訊從 GAS 連線一天要約 27 秒，所以一步只抓 1 天。**先實測單步耗時再決定 chunk 大小**。

## 5. 讓資料「容易分析」

- **先寫「訊號」再算分**：把雜亂文字規則化為 `signals` 表：`stock_code, type, category, points_basis, evidence_ref, occurred_at, source_url`。分析、計分、UI 都只吃 signals。
- **字典放 Sheets**（`config_keywords`：類別、詞、強弱、啟用、備註），可直接在 Sheets 改；規則版本號寫進 scores，並維護版本紀錄。
- **降噪**：先看命中樣本再調字典；過短或多義詞（「平台」「系統」）降為弱詞或加排除詞；轉載造成的重複新聞用「來源＋標題」去重。
- **缺資料不是 0 分**：資料缺失時從分母移除並顯示完整度；不要讓缺失被誤讀為「沒有需求」。
- **同時存「值」與「依據」**：每個分數附 `[S#]` 證據編號，UI 才能展示並讓 AI 引用。
- **保留歷史**：scores 每週一份，才有「這週比上週變了什麼」。
- **先用簡單基準驗證**：做一份小驗證集（已知答案），並對照最笨的基準（例如只看營收）。若不優於基準，要老實寫出來。
- 時間用 ISO 8601 含時區（`+08:00`）；民國年在**擷取層**就轉掉。

## 6. 可觀測性：不要悄悄壞掉

- `run_log` 每步一列；`status ∈ success | skipped | warning | partial | error`；錯誤訊息截 1000 字。
- **自動重試**：每日排程挑「最近一次狀態仍是 error」的步驟重跑（上限 5 個），成功後狀態自然轉為「已恢復」。
- **告警信**：失敗步驟彙整成一封信，`mail_log` 用 `run_id:type` 去重，避免洗版。
- **資料狀態頁／儀表板**：每個來源顯示「上次成功時間、本週筆數、錯誤數」。
- 摘要信（每週）：新進／移出、變動前 5、近 7 天事件、各來源筆數、待處理錯誤。

## 7. 部署與維運慣例

- 用 `clasp`：`clasp push --force` → `clasp update-deployment <id>`（Web App 要更新**既有部署**，網址才不變）。
- 前端 POST 用 `text/plain`，避免 CORS preflight（GAS 不支援 OPTIONS）。
- 對外 API 加 CacheService（分塊；單值上限約 100KB），計分完成後主動清除快取。
- 一鍵初始化函式（`setupSheets`、`installTriggers`）要**可重複執行**且不產生重複資料。
- 排程放離峰（每日 22:00、每週一 05:00），並預留「手動觸發」函式與 `removeAllTriggers`。
- 在本機用 Node 寫一個**GAS 模擬器**（mock SpreadsheetApp／UrlFetchApp／PropertiesService／ScriptApp），把真實回應用 curl 快取下來離線跑——能在不燒配額的情況下驗證斷點、去重與重跑。

## 8. 開工檢查表

- [ ] 寫下要回答的問題與需要的欄位
- [ ] curl 實測來源（格式、編碼、筆數、可達性）
- [ ] 設計 raw／signals／scores／config／run_log 欄位與 raw_id
- [ ] 代號與日期欄設純文字
- [ ] fetch 函式：重試、解析 0 筆報錯、去個資、回傳 {rows_in, rows_out}
- [ ] 批次切片穩定；單步耗時實測 < 2 分鐘
- [ ] runner：checkpoint、預算、保險接續、鎖
- [ ] 冪等：同一步驟連跑兩次，第二次新增 0 筆
- [ ] 每日重試與告警；狀態頁
- [ ] 文件：來源與限制、個資處理、規則版本

## 9. 常見坑（細節見 references/lessons.md）

| 坑 | 對策 |
|---|---|
| 代號 `0050` 變 `50` | 欄位設 `@` 文字格式，寫入前先設 |
| 逐列 `appendRow` 超慢 | 整批 `setValues` |
| 單次超過 6 分鐘被殺 | 一步一小單位＋checkpoint＋保險接續 |
| 頁面改版後「成功但 0 筆」 | 解析 0 筆就丟錯 |
| 同一則資料兩個來源各存一份 | 跨來源共用 raw_id 組成規則 |
| 轉載新聞灌水 | 以來源＋標題去重、每查詢上限要在方法論註明 |
| 欄名尾端有空白 | `trimKeys_` |
| JSON 被截斷 | parse 失敗也重抓 |
| 日期／數字被 Sheets 自動轉型 | 純文字，分析層再轉 |
| 無人看的排程靜默失敗 | run_log＋告警＋狀態頁＋每日檢查每週是否停擺 |
