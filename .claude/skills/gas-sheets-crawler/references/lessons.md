# 實戰教訓（企業雲端商機洞察平台，Phase 0–5）

## 來源實測筆記（台灣公開資料）
- **證交所 OpenAPI**（openapi.twse.com.tw/v1/opendata/…）：JSON、UTF-8。重大訊息 `t187ap04_L` 只回「當日」；欄名尾端常有空白 → `trimKeys_`。民國日期 `1151011`、時間 `70003`（缺前導 0）。
- **櫃買 OpenAPI**（tpex.org.tw/openapi/v1/…）：回應偶爾被截斷導致 JSON 解析失敗，需重抓；欄名與上市不同（`SecuritiesCompanyCode`）。
- **公開資訊觀測站 MOPS**：
  - 月營收彙總 `nas/t21/{sii|otc}/t21sc03_{民國年}_{月}_{0|1}.html`，**Big5**，HTML 表格，單位千元；0＝國內、1＝KY。
  - 歷史重訊 `ajax_t05st02` POST（form-urlencoded），一次一天全市場；回傳 `<form>` 列表，欄位名 `h`＋列號＋欄位碼，需取最後一碼對應（1 代號、2 日期、3 時間、4 主旨、8 說明）。**GAS 連線實測每天約 27 秒**。
- **Google News RSS**：每次查詢上限約 100 則；轉載造成重複；以「公司簡稱＋主題詞＋after/before」查詢，只留標題含公司名者；金控／KY 公司名稱要正規化（別名表）。
- **就業通（勞動部）**：僅 1,000 筆且集中台北市 → 評估後**停用此訊號**並記錄決策，而不是勉強使用。
- 資料不可得就老實移出分母並公開原因（決策紀錄 D18、D19、D27）。

## GAS 平台限制
| 限制 | 數值／行為 | 對策 |
|---|---|---|
| 單次執行 | 6 分鐘 | 預算 4.5 分鐘＋checkpoint |
| 觸發器總時間 | 免費帳號約 90 分鐘／日 | 回補分週攤平；每日只做增量 |
| CacheService 單值 | ~100KB | 分塊存取 |
| Web App CORS | 不支援 OPTIONS | 前端 POST 用 `text/plain` |
| 接續觸發器 | 同名重複會累積 | `scheduleContinuation_` 先清再建 |
| Script Properties | 單值 9KB、總 500KB | 只存斷點與小狀態，大資料放 Sheets |
| 試算表格式 | 自動轉型 | 純文字欄位 |

## 過程中踩過的坑與解法
1. **週排程被 6 分鐘殺掉**：原本 7 天／步 → 改 1 天／步、單次最多回補 90 天、checkpoint 先於步驟、先排 7 分鐘後的保險接續、每日排程幫忙接續。
2. **關鍵字噪音**：多義詞命中大量無關文件 → 降級為弱詞／加排除詞，並在 UI 顯示命中詞；改字典後只需 `rescoreNow`。
3. **規則 v1 預設 Play 造成誤導**：只有產業先驗也被標成 Migration → v2 改標「訊號不足」，並保留版本紀錄。
4. **驗證集過小且與基準相同**：precision@20% 5/5，但「只看營收」也 5/5 → 在方法論頁直接寫明「尚不能證明優於挑最大公司」。
5. **前端快取舊資料**：sessionStorage 快取鍵未升版導致缺新欄位 → 快取鍵帶版本號，靜態檔加 `?v=`。
6. **Gemini 額度／404／503**：候選模型 fallback、429 暫停 1 小時、每日補生成；同 context 以 hash 當快取鍵。
7. **CSS 一個多餘的 `}` 讓下一條規則失效**：視覺上整頁間距消失 → 改 CSS 後用腳本檢查大括號平衡，並在線上以 `getBoundingClientRect` 量測。
8. **刪 HTML 元素忘了刪 JS 引用**：整個頁面腳本中斷、圖表全消失 → 改頁面後比對 `getElementById` 與實際 id，四個頁面都要實際開過。

## 好用的小函式
見 `templates/core.gs`：`fetchWithRetry_`、`fetchJson_`、`readTable_`、`appendObjects_`、`appendNewRaw_`、`upsertObjects_`、`runStep_`、`runJob_`、`scheduleContinuation_`。

## 驗收指令（每個新來源都做）
1. 本機 curl 取樣 → 確認欄位。
2. 在 GAS 執行該步驟一次 → run_log 有一列、rows_out > 0。
3. **立即再執行一次** → rows_out 應為 0（冪等）。
4. 抽 5 列對照來源網站，確認數值與日期無誤。
5. 故意斷網／改錯 URL → run_log 出現 error，且其他步驟照常。
