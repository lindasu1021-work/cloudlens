# Phase 0：需要 Verna 操作的步驟

> 全部免費。預計 20–30 分鐘。做完把 **Web App URL（…/exec）** 貼回給 Claude Code，
> 我會用 `?action=phase0` 讀回 GAS 端的測試結果，回填 `phase0_results.md`。

## 步驟 1：建立 Google Sheets（資料庫）
1. 到 <https://sheets.new> 建立新試算表，命名 `CloudLens DB`。
2. 從網址列複製 ID：`https://docs.google.com/spreadsheets/d/`**`這一段`**`/edit`。先記著，步驟 3 會用到。

## 步驟 2：建立 Apps Script 專案並上傳程式碼

**方式 A：clasp（建議，之後程式碼可直接同步）**
1. 開 <https://script.google.com/home/usersettings>，把「Google Apps Script API」打開。
2. 在終端機依序執行（一次一行）：

```bash
npm install -g @google/clasp
```

```bash
clasp login
```
（會開瀏覽器，用你的 Google 帳號授權）

```bash
cd ~/Desktop/AWS校園大使/BD-side-project/cloudlens/gas
```

```bash
clasp create --type standalone --title "CloudLens" --rootDir .
```
（如果它問要不要覆寫 `appsscript.json`，選 **不要**）

```bash
clasp push
```

```bash
clasp open-script
```
（舊版 clasp 指令是 `clasp open`）

**方式 B：手動貼上**
1. 到 <https://script.google.com> → 新專案，命名 `CloudLens`。
2. 專案設定（齒輪）→ 勾選「在編輯器中顯示 appsscript.json」。
3. 把 `gas/` 內的 `appsscript.json`、`utils.gs`、`api.gs`、`phase0.gs` 逐一建立同名檔案並貼上內容。

## 步驟 3：設定 Script Properties（秘密只放這裡）
專案設定（齒輪）→ 最下方「指令碼屬性」→ 新增：

| 屬性 | 值 |
|---|---|
| `SHEET_ID` | 步驟 1 的試算表 ID |
| `GEMINI_API_KEY` | 到 <https://aistudio.google.com/apikey> 建立的金鑰 |
| `GEMINI_MODEL` | （可不填；不填會自動挑一個 flash 模型） |

`ALERT_EMAIL`、`LIVE_PASSCODE` Phase 1／4 才用，現在不用設。

## 步驟 4：執行連線測試
1. 編輯器上方函式選單選 **`runPhase0`** → 執行。
2. 第一次會要求授權：選你的帳號 →「進階」→「前往 CloudLens（不安全）」→ 允許。
   （這是自己寫的程式尚未經 Google 審查的正常提示）
3. 約 1–2 分鐘跑完。看「執行記錄」，並確認試算表多了 `phase0_results` 分頁。
4. 函式選單選 **`testGemini`** → 執行。

## 步驟 5：部署 Web App
1. 右上「部署」→「新增部署作業」→ 類型選「網頁應用程式」。
2. 執行身分：**我**；誰可以存取：**所有人**。
3. 部署 → 複製 **網頁應用程式網址**（結尾是 `/exec`）。
4. 瀏覽器開 `<網址>?action=ping`，應看到 `{"ok":true,...}`。

## 步驟 6：建立 GitHub repo 並開啟 Pages
1. 在 GitHub 建立**公開** repo，名稱 `cloudlens`（不要勾 README）。
2. 在終端機（repo 已由 Claude Code 在本機 `git init` 並 commit）：

```bash
cd ~/Desktop/AWS校園大使/BD-side-project/cloudlens
```

```bash
git remote add origin https://github.com/<你的帳號>/cloudlens.git
```

```bash
git push -u origin main
```

3. repo → Settings → Pages → Source 選 **GitHub Actions**。
4. Actions 分頁跑完後，開 `https://<你的帳號>.github.io/cloudlens/phase0.html`。
5. 貼上步驟 5 的 `/exec` 網址 → 按「測試 GET」、「測試 POST」，兩個都要 ✔。

## 步驟 7：回報
把以下貼回給 Claude Code：
- Web App `/exec` 網址（這個網址本來就會公開在前端，不是秘密）
- phase0.html 兩個測試的結果截圖或文字
- `testGemini` 執行記錄中的模型名稱（**不要貼金鑰**）
