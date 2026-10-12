# CloudLens

以公開資料為台灣上市櫃企業打分數並標出切入劇本（Play），協助 AWS 業務決定「先打誰、拿什麼去談」，再用 AI 產出帳戶速覽與破冰信草稿。

> 狀態：**Phase 3 前端完成**（網站：https://lindasu1021-work.github.io/cloudlens/）。完整規格見 [docs/spec.md](docs/spec.md)；各階段結果見 `docs/phase*_results.md`。

## 架構

| 層 | 本專案（零成本） | 正式上線版在 AWS 上的對應 |
|---|---|---|
| 排程 | GAS 時間觸發器 | Amazon EventBridge Scheduler |
| 後端運算 | Google Apps Script | AWS Lambda |
| 資料庫 | Google Sheets | Amazon S3 ＋ Amazon Athena |
| AI | Gemini API 免費層 | Amazon Bedrock |
| 前端 | GitHub Pages | Amazon S3 ＋ Amazon CloudFront |

```
[每日] 重大訊息 ─┐
[每週] 新聞 · ESG · AWS 案例 ─┼─▶ GAS 清理/對應/訊號 ─▶ 計分（Need × Timing ＋ Play）─▶ GAS Web App API ─▶ GitHub Pages
[每月] 公司主檔 · 月營收 ─┘                                                        └─ Copilot（Gemini）
```

## Repo 結構

```
docs/   規格書、決策紀錄、Phase 結果
gas/    Apps Script 原始碼（clasp 同步）
web/    GitHub Pages 靜態前端
```

## 設定步驟
- Phase 0：見 [docs/phase0_setup.md](docs/phase0_setup.md)
- 其餘（手動觸發、看 log、常見錯誤、停用排程、資料來源與限制、成本）於 Phase 5 補齊。

## 秘密管理
Gemini 金鑰、通行碼、Email、Sheets ID 只存在 GAS **Script Properties**，不進此 repo。

## 資料來源
臺灣證券交易所 OpenAPI、證券櫃檯買賣中心 OpenAPI、Google News RSS、AWS 公開客戶案例。不蒐集任何個人姓名或聯絡方式。
