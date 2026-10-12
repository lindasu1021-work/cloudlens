# Step 2：Copilot 對話框設計（v1 定案，2026-10-11）

## 1. 定位
- 位置：每家公司的帳戶卡片旁，對話範圍限定「這一家公司」。
- AI 只在這裡使用（Gemini，模型名稱放設定檔可替換）。

## 2. 上下文組裝（GAS 每次呼叫時打包）
1. 公司基本資料（代號、名稱、產業、資本額、營收規模）
2. 分數拆解：Need（N1–N4）、Timing（T1–T4）、Tier、資料完整度
3. Top 10 訊號：編號 [S1]…、類型、日期、標題/摘要、來源連結
4. Play（主/次）與雲端現況標籤
5. 「Play → AWS 方案」對照表（Sheets config 分頁，可自行修改），v1 內容：
   - Migration → AWS 遷移加速計畫（MAP）、Application Migration Service、AWS 台北區域（資料落地）
   - Data → Amazon S3 資料湖、AWS Glue、Amazon Redshift、Amazon QuickSight
   - GenAI → Amazon Bedrock、Amazon Q
   - Security → Amazon GuardDuty、AWS Security Hub、AWS Backup／災難復原
   （實作時需逐一確認服務名稱仍有效）

## 3. 回答規則（System Prompt 核心）
- 角色：資深 AWS 台灣企業業務（Greenfield）
- 每個論點必須標註依據訊號 [S#]；資料中沒有的事，回答「目前資料中沒有」，不得推測或編造數字
- 不出現任何個人姓名；收件對象只用職稱
- 預設繁體中文；破冰信可切換英文（先生成中文，英文版由中文版翻譯，確保內容一致）

## 4. 快捷按鈕（v1）
| 按鈕 | 產出 | 輸出格式 |
|---|---|---|
| 帳戶速覽 | 為什麼是這家、為什麼是現在、建議 Play、未知事項 | Markdown |
| 破冰信：CIO 版 | 技術痛點 + 觸發事件切入，≤200 字 | JSON {subject, body, signals_used[]} |
| 破冰信：CFO 版 | 成本/韌性/合規切入；營收衰退者走降本話術，≤200 字 | JSON 同上 |
| 預想異議 | 3–5 個異議（資料落地、既有競品、預算凍結…）＋回應 | JSON [{objection, response, signals_used[]}] |
| MEDDPICC 初稿 | 8 個欄位；推不出來的標「待驗證」並列出驗證問題 | JSON {M, E, D1, D2, P, I, C1, C2} 各含 content/status/questions |
| 自由提問 | 開放問答 | Markdown |
| 中/EN 切換 | 破冰信英文版 | 同破冰信 |

JSON 輸出流程：schema 驗證 → 失敗附錯誤訊息重試（最多 2 次）→ 仍失敗則顯示錯誤並保留原始回覆於 ai_log。

## 5. 額度與成本控管
- 快取：key = 公司代號 + 按鈕 + 資料版本（每週排程 run_id）；命中直接回傳，不呼叫 API。存在 Sheets `ai_cache`。
- 每日上限：預設 30 次（Script Properties 計數，台灣時間午夜歸零），可調。
- 超過上限或 API 失敗：回傳快取內容；無快取則提示「今日額度已用完」。
- 紀錄：Sheets `ai_log`（時間、公司、按鈕、模式、成功/失敗、錯誤訊息、估計 token）。

## 6. 展示模式與即時模式
- 展示模式（預設、公開）：每週排程跑完後，替 Tier 1 公司預先生成各按鈕結果存入 ai_cache；訪客只讀快取，不耗額度。
- 即時模式：需輸入通行碼（存在 GAS Script Properties，不進前端）才可現場呼叫 Gemini；自由提問僅限即時模式。
- Gemini API 金鑰只存在 GAS Script Properties。

## 7. 每週摘要信（規則產生，不用 AI）
- 每週主排程結束後寄到 Verna 的 Gmail（GAS MailApp）
- 內容：本週新進 Tier 1、分數變化前 5 名、新觸發事件、各資料源抓取筆數、錯誤摘要
- 兼作「排程正常完成」通知；排程失敗另寄失敗通知
