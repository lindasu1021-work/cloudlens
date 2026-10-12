# Phase 2 訊號與計分：結果

> 日期：2026-10-12｜狀態：程式完成、模擬驗證通過（真實資料）；待 GAS 實跑 `setupPhase2` 與 Verna 人工核對

## 1. 完成了什麼

| 項目 | 檔案 | 說明 |
|---|---|---|
| 關鍵字字典 | `gas/keywords.gs` | 01 檔第 7 節全部詞彙，匯入 `config_keywords`（Verna 可在 Sheets 改）；另加 EXCLUDE_NEWS、NEG、CTX、CTX_VENDOR（D23） |
| 新聞 | `gas/fetch_news.gs` | Google News RSS，185 家；首次回補近 3 個月逐月＋近 1 年，之後每週 8 天（D25） |
| 重訊歷史 | `gas/fetch_announcements.gs` | MOPS 依日期回補近 365 天（D24），一次性；之後由每日排程接續 |
| ESG 資安 | `gas/fetch_esg.gs` | 上市 148 家；上櫃無資料（D19） |
| AWS 案例 | `config_aws_cases` | 人工清單（D20），目前 1 家（見 §4） |
| 訊號 | `gas/signals.gs` | N3／PLAY／N4／T1／VENDOR；每則文件同類別只計一次 |
| 計分 | `gas/scoring.gs` | Need、Timing、百分位、Tier、Play、雲端現況、資料完整度；全部算完才切換 `current_run_id` |
| 每週排程 | `gas/jobs.gs`、`gas/triggers.gs` | 每週一 05:00；ESG → 重訊回補（首次）→ 新聞 → 訊號 → 計分 |
| 帳戶 API | `gas/api.gs` | `GET ?action=account&code=XXXX`：分數拆解、[S#] 訊號、營收 |

## 2. 驗證結果（Node 模擬 GAS，真實資料）

| 驗收項目 | 結果 |
|---|---|
| 資料量 | 重訊 16,242 則（一年）、新聞 14,748 則、ESG 148 筆、訊號 549 筆 |
| 計分 | 185 家全部有分數；Tier 1 27、Tier 2 29、Tier 3 60、暫緩 69 |
| 主 Play 分布 | Migration 113、Data 44、Security 20、GenAI 8 |
| 雲端現況 | aws 1（國泰金）、competitor 1（大同：Google Cloud 協助 SAP 轉型）、unknown 183 |
| 缺資料不算 0 分 | ✅ N2、T4 移出分母；上櫃 72 家 N4 滿分改 15、資料完整度 0.94 |
| 重跑不重複 | ✅ 重跑每週工作後所有 raw 表 raw_id 無重複、分數同一 run_id 覆寫 |
| 斷點接續 | ✅ 每週工作 69 步跨多次接續完成，0 錯誤 |

### 雜訊校正紀錄（模擬時發現並修正）

| 問題 | 實例 | 修正 |
|---|---|---|
| 「AI」被行情新聞灌爆（1,851 筆、118 家主 Play 變 GenAI） | 「士電：AI 重電設備瘋搶」 | 新聞弱訊號須與「導入、建置…」同現；行情詞整則排除；產品詞（電源、變壓器、散熱、大單）列為 AI 否定詞 |
| 電子廠以 AWS **供應商**身分上新聞 | 「AWS 拉貨，台達電受惠」 | VENDOR 須有採用／合作語境，且不得有拉貨、供應鏈等詞 |
| 「合併」誤中財報公告 | 「合併自結業績」「合併營收」 | 自結、財報、損益、營收等列入重訊排除詞 |
| 「取得使用權資產」多為集團內部租約 | 「元大金向元大人壽取得使用權資產」 | 移出資本支出觸發詞（D26） |
| 「取得…股份」誤中「股份有限公司」、金融債 | 「取得越南…股份商業銀行次順位金融債」 | 正規式排除「股份有限」；金融債、次順位列入排除詞 |
| 基金名稱含「AI」 | 「取得 Andreessen Horowitz X-AI 基金」 | 弱訊號只比對主旨且須與動作詞同現 |

## 3. 人工核對：三產業各 1 家逐分明細

> 請 Verna 點開證據連結核對：每一分是否對得到合理的訊號。

### 2882 國泰金（金融保險・上市）

- **Need 93**（百分位 1）／**Timing 38.9**（百分位 0.93）→ **Tier 1**
- 主 Play：**GenAI**　次 Play：—　雲端現況：**aws**　資料完整度：1

| 項目 | 得分 / 滿分 | 計算依據 |
|---|---|---|
| N1 規模 | 24.7 / 25 | 近 12 個月營收 3,503 億元（2025-09～2026-08），帳戶池百分位 × 25 |
| N2 數位人才招募 | 缺資料 | 就業通不可用（D18） → 移出分母 |
| N3 策略意圖 | 25 / 25 | 近 365 天命中 MIG/DATA/AI 文件 13 份，加權 n=11（強 1、弱 0.5）→ 25×(1−0.5ⁿ)。例：S4, S5, S6, S7, S8, S9 |
| N4 資安合規壓力 | 20 / 25 | 金融業基礎 10；ESG 外洩 +10（S3）；近 365 天無資安事件重訊 |
| T1 觸發事件 | 0 / 50 | 近 90 天無觸發事件 |
| T2 新聞動能 | 20 / 20 | 近 30 天命中新聞 9 則，過去 90 天月均 3.0 則（3.0 倍） |
| T3 營收動能 | 15 / 20 | 2026-06、2026-07、2026-08 營收 YoY -42.0%、-69.7%、-69.5% |
| T4 招募加速 | 缺資料 | 就業通不可用（D18） → 移出分母 |

訊號節錄（[S#] 依日期新到舊）：

| # | 日期 | 類型 | 類別 | 標題 |
|---|---|---|---|---|
| S1 | 2026-10-12 | T2 | news_momentum | 近 30 天命中新聞 9 則，過去 90 天月均 3.0 則（3.0 倍） |
| S2 | 2026-10-12 | T3 | revenue_decline | 2026-06、2026-07、2026-08 營收 YoY -42.0%、-69.7%、-69.5% |
| S3 | 2026-10-12 | N4 | esg_breach | 民國 114 年 ESG 揭露資訊外洩事件 20 件 |
| S4 | 2026-09-24 | N3 | AI | [國泰金控技術年會登場 重磅推出AI數位同事（青年日報）](https://news.google.com/rss/articles/CBMibkFVX3lxTE5jVkV1MzlTcEJDNDZ4VzNRdW9sdTFHbk04U3VEaVdvd0l6WkhJUUhWQzZCWWpXZmc5UXJCUlFLUDJZZHNxZ3JWSnBBUmFtdXNTQ0JrSlZnRFcxZmk4YTFrcVR6cVoyano3Tm1vOG1R?oc=5) |
| S5 | 2026-09-24 | N3 | AI | [國泰金控技術年會登場重磅推出AI數位同事／ 青年日報（LINE TODAY）](https://news.google.com/rss/articles/CBMiVkFVX3lxTE03YlZTXzBLQWthVjJlbXVXc2kxdlprYm5lWmtTMHROd0JNa2prc2tTbkYxVG5iTHR6cXN0c2JSLXo3Q0JoWnBfcFVSZ0VSRnhHZTl6ZEZB?oc=5) |
| S6 | 2026-09-16 | N3 | AI | [不只等人下指令！國泰金測試AI數位同事，能長期記憶、主動推進任務（iThome）](https://news.google.com/rss/articles/CBMiTkFVX3lxTE5RWWJ1alcycHRHak16ZURPaWpJTDhFSkFZaXg1SG1JQ3VpUzc2WWpmc1o2YmVKa21lVjBBNXo1LW1Kd2NFNC1velF3enNBZw?oc=5) |
| S7 | 2026-09-16 | N3 | AI | [從 Cloud First 邁向 Agent First 國泰金 AI 數位同事亮相（CIO Taiwan）](https://news.google.com/rss/articles/CBMiREFVX3lxTE8tTjZPMnhOOHdvSnNrQXdVclFyM0tYejQxMGlxMlJhU05tWVBiclhnakpPcGF2NDljdHh3bzl5RWVCUGJF?oc=5) |
| S8 | 2026-09-16 | N3 | AI | [國泰金技術年會宣告Agent First階段來臨 首度公開「AI數位同事」創新試驗（鉅亨網）](https://news.google.com/rss/articles/CBMiT0FVX3lxTE1hZ29KR1QwYnVOM21Wck01N1Yyb1ZzUmJ3UV9lVGt5OXMyXzM2Vll5RFZNU3ZLbzUwYWJ4UUtTZUNGSFYzenFRMlVOZ09vODQ?oc=5) |
| S9 | 2026-09-16 | N3 | AI | [國泰金導入AI優化企金平台，壽險/財富管理齊成長（台視全球資訊網）](https://news.google.com/rss/articles/CBMikgFBVV95cUxQT2dsYlJmaVVielNiS3ZReWxLaGhfbU1sSVlES2VEWVpDTjY4Tm5pQkluSFdicHppTFg1T0ZDWWYyV05FWEd1WllMeUVaRGd0UFN4NFNsOWJqVHl2Qlo0cUlsMEozOXF3UHd6ak5SenFRMEplUU5yblZwOHprc2VvQXNaaUIyeEtKS2prRjV4OWlrZw?oc=5) |
| S10 | 2026-09-15 | N3 | AI | [國泰金首發 AI 數位同事！蔡宗翰曝未來十年 AI 戰略走向「千人千面」（TechNews 科技新報）](https://news.google.com/rss/articles/CBMiZkFVX3lxTFBmMEE0a1dVSF9CQnRLUGNHVHVnbWI0d2xISGR4RU43Z2lTdDVtV3VQWnZmbDU0aWlDSlNybUl3TlVaWjZSLUt0UGJkRV9uMnZWVmlncmJOb2EwNWtCQ2xzRnpBQmI0Zw?oc=5) |
| S11 | 2026-09-15 | N3 | AI | [蔡宗翰首度演講2／AI非替代而是協作！國泰金控科技長拋AI新戰略：打造「GAIA」架構與數位同事時代（鏡週刊Mirror Media）](https://news.google.com/rss/articles/CBMiZkFVX3lxTE5FdEFjdnlCSmx1STU4YTRVTHE1SWpFcDNLc0U5SzFhamxKZXVoWkVFQ21wel82MFRCQTRYMHJDV3VVb0ljYlYxb19GVVFjV2lwdml6akowVUpXenhjZnQtWUJzVkctd9IBa0FVX3lxTE1pQ2pEUWlnRWx2aXk1aThyYmRtdFBNS3E2eS1PdUNlN0hFOUIyeU1INzBQdGY5UXV1WG9xY3Q2MzZLMTJvaUQ2Z0JtbWxUa2YwYTc5RzJob0psLXhueEIzM0xWR2p1cEpZUzZz?oc=5) |
| S17 | 2025-11-13 | T1 | m_and_a | 代子公司國泰人壽公告擬增資子公司Cathay Walbrook Holding 2 Limited |
| S18 | 2025-11-13 | T1 | m_and_a | 代子公司國泰人壽公告擬增資子公司Cathay Walbrook Holding 1 Limited |

### 2308 台達電（電子零組件・上市）

- **Need 66.6**（百分位 0.94）／**Timing 44.4**（百分位 0.95）→ **Tier 1**
- 主 Play：**Migration**　次 Play：Data　雲端現況：**unknown**　資料完整度：1

| 項目 | 得分 / 滿分 | 計算依據 |
|---|---|---|
| N1 規模 | 25 / 25 | 近 12 個月營收 6,929 億元（2025-09～2026-08），帳戶池百分位 × 25 |
| N2 數位人才招募 | 缺資料 | 就業通不可用（D18） → 移出分母 |
| N3 策略意圖 | 24.9 / 25 | 近 365 天命中 MIG/DATA/AI 文件 14 份，加權 n=8.5（強 1、弱 0.5）→ 25×(1−0.5ⁿ)。例：S4, S5, S7, S9, S10, S11 |
| N4 資安合規壓力 | 0 / 25 | ESG 無外洩 +0；近 365 天無資安事件重訊 |
| T1 觸發事件 | 20 / 50 | S2 capex 10×1；S3 capex 10×0.5；S8 capex 10×0.5 |
| T2 新聞動能 | 0 / 20 | 近 30 天命中新聞未達 1.5 倍月均（或少於 2 則） |
| T3 營收動能 | 20 / 20 | 2026-06、2026-07、2026-08 營收 YoY 55.4%、47.7%、34.9% |
| T4 招募加速 | 缺資料 | 就業通不可用（D18） → 移出分母 |

訊號節錄（[S#] 依日期新到舊）：

| # | 日期 | 類型 | 類別 | 標題 |
|---|---|---|---|---|
| S1 | 2026-10-12 | T3 | revenue_growth | 2026-06、2026-07、2026-08 營收 YoY 55.4%、47.7%、34.9% |
| S2 | 2026-09-17 | T1 | capex | 本公司代子公司中達電子(江蘇)有限公司公告向關係人取得機器設備 |
| S3 | 2026-08-28 | T1 | capex | 本公司代子公司Delta Electronics (Thailand) Public Company Limited公告向非關係人取得機器設 |
| S4 | 2026-08-26 | N3 | DATA | [實體AI開始走進工廠！台達電、研華搶攻智慧製造　下一戰比誰先落地（經濟日報）](https://news.google.com/rss/articles/CBMiWkFVX3lxTE5yeFJnaWZiNHFiV3l2UnV2UXlXb3REcTFrUUtaeDdTNEhJeXZTMkdkeGFiUGZ4Mlo0Y3puRXRJNjZnRW5UQzlfc3hKSS1jLW10LVRlM1VxUm9JUdIBX0FVX3lxTFBNVHVwU0s4ZkUzM0F6RUtnLTNzSjFuLVRQMmlyUzg3VGRoSnhJOWxhZVVhTnVYM2loZWIzckxJa0Y4YU00TGNWUFJPQS1zM0tsaW9vNHNJNkRMa0IxaDlJ?oc=5) |
| S5 | 2026-08-19 | N3 | AI | [〈台北國際自動化展〉台達電首展具身智能雙臂協作 AI強化整線數位雙生導入泰國廠（鉅亨網）](https://news.google.com/rss/articles/CBMiT0FVX3lxTE5jN1ZnMHNUYWJ4NVB4aFFRVjhjVVdCZzgyWDUtbEJNdGZ3MmdEc011UTAtTDBOV3d1RzQzdzVKZDlxc0pqcDhadzJ3RUFORFE?oc=5) |
| S6 | 2026-08-10 | PLAY | SEC | [【專訪】台達電子資訊長暨資安長曾立峰：企業架構思維，驅動全球營運（CIO Taiwan）](https://news.google.com/rss/articles/CBMiREFVX3lxTFBEZHpIWXdEQUF3TVRjc0F2WmtCdXdEZ29FV2FQTGRKcVBRdFJFYnk1elk1ZGl4bER3dFFaSzZ5RXlxV085?oc=5) |
| S7 | 2026-07-31 | N3 | AI | [台達電：AI建置潮不會停…董座鄭平喊下半年營運更旺（UDN）](https://news.google.com/rss/articles/CBMiUEFVX3lxTE1BY0NDSklYV21GYk5nWGFNRW1nY3lRTm1ETVE5Y19hRXNfSjljTUVrOV82WVo1TTZjZ3VBVGtEMXE3X1dpU2p1eFNTNjRNYUg40gFWQVVfeXFMTmEzakhXQ0liZzNhaTQzaXZzQVlOQ2pQY0F5NnQ2eE1zYk5qY05ET0ozRFd2anNSd0EwOXI1ZThsWEphbnNkbjY0ZGxZOVktbFNOeFlMRHc?oc=5) |
| S8 | 2026-07-24 | T1 | capex | 本公司代子公司Delta Electronics (Thailand) PublicCompany Limited公告向關係人取得機器設備 |
| S9 | 2026-07-23 | N3 | DATA | [AI淨零／台達電前進國際珊瑚礁研討會 以AI科技投入生態保育 ／ 生活（中央社 CNA）](https://news.google.com/rss/articles/CBMiX0FVX3lxTE85d0ZYV0hibno2cnhDVTZYZ0RQM0hLM3dFRnlSanFWLXVUS2hHbUxNV0NUODd1R3Y1dXpEZnlGSXh4QXYtQTdLc0hKanA5bjIxM19VYU9rRkZrWW5NWFA4?oc=5) |
| S10 | 2026-07-23 | N3 | DATA | [台達電進入珊瑚礁「世界盃」，以數位孿生等科技，為全球珊瑚白化找救命解方（CSR@天下）](https://news.google.com/rss/articles/CBMiS0FVX3lxTE5Ldk9nVmUwUGpqaVJHWlpPUDMzMlhJYjlXRXhBZ1RFWmVmWDFRd3JsemxIRzJJYTNrNW1LaGg1MmtXVWNPbTRCOFc3QQ?oc=5) |
| S11 | 2026-07-14 | N3 | MIG | [台達電液冷散熱方案 導入日本首座AI貨櫃資料中心（自由財經）](https://news.google.com/rss/articles/CBMiVkFVX3lxTFBhVmdkOWtYYjdvSTdUdnEyUFpoa3ppeXpVdS1wblVpa1lGM3JJd1dlX0d1MXUtSEdlQ1BERmNRZ3BFNVBFZXNZbnd3Ri1CeUVYN19DWnRn0gFbQVVfeXFMTlViM3p5NWdmUDU0RlR6ZEVnT3pvSEt4c2hSLUx0NEtDYUl2YUE0R2twUWdYa3NNWF9ZZWZaOGtIalhPdmxOelJfVm40bEZpSll3YWVYZEYyOFlXUQ?oc=5) |
| S12 | 2026-06-29 | N3 | MIG | [台達電挪威新研發中心啟用 鎖定次世代資料中心電源（自由財經）](https://news.google.com/rss/articles/CBMiX0FVX3lxTFAtQUtteTNrLWpnRVdiaFpIcm1tQzNuQ05ubEN2by1BcFg4MVR0bTFKRVZJZFV6NVJIM3owRHExc1NleFR4TFVWNXFaaEw3MFd0RDhteF9tZXVnY3RFS2Uw0gFkQVVfeXFMTW1UUHNEbDFhcUR6RGRla0p0Z2t0VDhVbmp3QTFwd0xKR21SSWV1QkJWTURaaElfUUtoZVVHVnJxV1FPWHotb29leXBCZDA0Y25JN2kyanVZbXY4TTRIM2p4QzhLWQ?oc=5) |
| S14 | 2026-06-04 | T1 | capex | 本公司代子公司Delta Electronics (Thailand) Public Company Limited公告向非關係人取得機器設 |
| S23 | 2026-05-05 | T1 | capex | 本公司代子公司Delta Electronics (Thailand) Public Company Limited公告向非關係人取得機器設 |
| S24 | 2026-05-05 | T1 | expansion | 本公司代子公司Delta America Ltd.公告擬取得土地及建物 |
| S25 | 2026-05-04 | T1 | capex | 本公司代子公司Delta Electronics (Thailand) Public Company Limited公告向非關係人取得機器設 |

### 2049 上銀（電機機械・上市）

- **Need 90.4**（百分位 0.99）／**Timing 36.1**（百分位 0.92）→ **Tier 1**
- 主 Play：**Security**　次 Play：Data　雲端現況：**unknown**　資料完整度：0.94

| 項目 | 得分 / 滿分 | 計算依據 |
|---|---|---|
| N1 規模 | 19.3 / 25 | 近 12 個月營收 285 億元（2025-10～2026-09），帳戶池百分位 × 25 |
| N2 數位人才招募 | 缺資料 | 就業通不可用（D18） → 移出分母 |
| N3 策略意圖 | 24.4 / 25 | 近 365 天命中 MIG/DATA/AI 文件 7 份，加權 n=5.5（強 1、弱 0.5）→ 25×(1−0.5ⁿ)。例：S2, S7, S8, S9, S10, S11 |
| N4 資安合規壓力 | 15 / 25 | ESG 無外洩 +0；資安事件重訊 +15（S5） |
| T1 觸發事件 | 12.5 / 50 | S4 security_incident 25×0.5 |
| T2 新聞動能 | 0 / 20 | 近 30 天命中新聞未達 1.5 倍月均（或少於 2 則） |
| T3 營收動能 | 20 / 20 | 2026-07、2026-08、2026-09 營收 YoY 33.9%、42.3%、30.1% |
| T4 招募加速 | 缺資料 | 就業通不可用（D18） → 移出分母 |

訊號節錄（[S#] 依日期新到舊）：

| # | 日期 | 類型 | 類別 | 標題 |
|---|---|---|---|---|
| S1 | 2026-10-12 | T3 | revenue_growth | 2026-07、2026-08、2026-09 營收 YoY 33.9%、42.3%、30.1% |
| S2 | 2026-08-07 | N3 | DATA | [台新新光淨零論壇第5年登場 上銀、強茂、宏碁、金寶經驗分享！（民視新聞網）](https://news.google.com/rss/articles/CBMiYEFVX3lxTE5xUUM0NXNIb0NsMWE3YmJ6WDJKVFBobzV2ZW5WTXNrZG1PMUUyYnMxcHBLVUdfZmgwbTRkbVhWOE5ELUppY3d3Q3JwZXBITENTRExERkRvai1CdDJ1LXB5aw?oc=5) |
| S3 | 2026-07-28 | PLAY | SEC | 代子公司義大利上銀公司公告部分資訊系統遭受駭客網路攻擊 |
| S4 | 2026-07-28 | T1 | security_incident | 代子公司義大利上銀公司公告部分資訊系統遭受駭客網路攻擊 |
| S5 | 2026-07-28 | N4 | incident | 代子公司義大利上銀公司公告部分資訊系統遭受駭客網路攻擊 |
| S6 | 2026-07-28 | PLAY | SEC | [上銀：義大利子公司遭駭客網路攻擊　營運無重大影響（經濟日報）](https://news.google.com/rss/articles/CBMiWkFVX3lxTE1ycXcybHB3RklFTVVKUjl1bUlZQkxZQ0xPNy1PUDhWdUJpLUxyaTBPY082azZKeWxFUm9SZGRXQ04zVW9NaVVqaEJkOHNPR0ptOWg3eVRObkZtd9IBX0FVX3lxTFBuVXR1cWpxVkM5eU4wdWUyUHdSOWxHWm5MQzYtT1V0eGVBX2ZCbVlHT2hsTnVGd2FCQVRXeXdPYkxZdXRXUmYxQmhmbXBkZ21pZGdxMXI2anNLQkhPVWd3?oc=5) |
| S7 | 2026-06-05 | N3 | AI | [AI機台裝「智慧眼睛」 上銀導入高通晶片打造半導體設備（Yahoo新聞）](https://news.google.com/rss/articles/CBMi4AJBVV95cUxQRkxtSG9VNF9yYVNzbHpjNnladEs3amY3T202SE94RU9XYTlQbEZid0VhNTdDVUVYU1A1dnNlX01MbHRtZDFwZTVnMjY1Q0lDOEFhSEZwZXd4V2NHM3U4X3haWmVQU3VjckRqUWhORGt5WXpwQXZza0ptRS0zMTlyekJWY1ktSS1OelR2and5ZUlfUlo4RkxBaFJkVjJSNXFldjA3QTQ5VlVlNVRJRERqU3ZfQUx4Wnd0NVZjYURKQ25tOVZFcElFRmFwU0hMVklTSDM3SFR3UUY3Mkh2eFIxMXJYZE1iaE9oZjhZak15U3lSaHpORUlzcUVNeDRVdV9NQ2tlNWtyZ2tZelFFZTBPWllTRkNkWlN6c3Y0SGlOUzhyaWtKU25ZbEY5YVktLVhROE9kODZKUWwzSlBuUG9hcUtiTnZLcFZwcjZqR1otYlhwU21rYzJCYXQxcnh4ZEd4?oc=5) |
| S8 | 2026-06-05 | N3 | AI | [AI變機台當監工！上銀攜手高通 打造智慧半導體設備（自由財經）](https://news.google.com/rss/articles/CBMiX0FVX3lxTE5BZjVJcGF4YWJPVUZDbTQ3aWllUDBZdlE2NlRDdTFCYVlMSkhNLXhObUFLTklZQzQyMHlST3FBbkVjVkl3VmZBTGJjRWNJNHlBQTZ1VERUemlzaXVRSGhv0gFkQVVfeXFMUEUxTkhtaDV3aTBPQU80S05tZEx2c1MxZXAxRjhBeS16TWdSb09xQTlFeS1EZjYyeEtrQjhMVHlSdFNkeVplRkpBTjhYRXZuMlhQSHBUOGhROWJJMDJIN0UxMXRaag?oc=5) |
| S9 | 2026-06-03 | N3 | AI | [上銀科技首登COMPUTEX 核心關鍵技術打造Physical AI 新未來， 也同時演繹如何讓藝術文化成為科技產業的隱形翅膀（電子工程專輯](https://news.google.com/rss/articles/CBMijgJBVV95cUxORUNDVHZpN2llU1Y2dVo3UGxHNUwwVWlnQ2gwQUJOdHhOeVRlcEozMzdqS2xtSWFoX09CNTZXWnRaSzlvSXNjQmtjMU9yTzBRemU2SFp2NXN0LTFqWld5djNkMjA0QWFIUEpNY3d3Rm80NnpxNVlwbjlGOUd2dXpnYTJVUG10ZmhLYU9oTVU5Z3dnUHdnR3QzcUctM3BkZTBsMW9FVnlYTXNXU0llWFpXekZOZ0h3N0Nabnd3NElOMTh3T2lNekt0RFBRSzlJSFFMaGNnaVVwcUZVYWJUVG9RLWxNRUM0V3QxSUNXTXc3anhXS2c1NVpmNDlFTzcwVmRyZ2lfOGpmeTE1VkY5ekE?oc=5) |
| S10 | 2026-04-01 | N3 | DATA | [上銀攜手虎科大成立研發暨人才培育中心未來十年將斥5千萬元打造智慧製造實戰基地- 產業（工商時報）](https://news.google.com/rss/articles/CBMiX0FVX3lxTE8zZXJGQWRyck9zZnBaMU1VUG52ZnF5RjRtNzZkTklNWWpjaENhdk8wT0prUDBzMXk5N3ZjNlh1XzU3VkExZ3ZCbnBNV21IOWQ1dmRPY25SbllPYTd0eVdv?oc=5) |
| S11 | 2026-04-01 | N3 | DATA | [上銀與虎科大攜手成「HIWIN-NFU智慧製造研發暨人才培育中心」（工商時報）](https://news.google.com/rss/articles/CBMiX0FVX3lxTE53N1dPOUwxQ2pjVmFyMzJUVTZoMVN6VngxTDFpRElyVXVVSFFjdDdJQVBDeHRmUUo3bGdzMm5QUzVqbEh2OTE1VGlrN2JobVlBekIyTkdwRDBnU1VDaFA4?oc=5) |

## 4. 已知限制與需要 Verna 決定的事

1. **驗證集只有 1 家**：AWS 官方公開、且屬於帳戶池的台灣客戶只確認到國泰金控（台北區域啟用新聞稿）。precision@20% 在 n=1 時沒有統計意義。
   建議 Phase 5 改用「公開報導中明確使用公有雲（AWS／Azure／GCP）」的公司當驗證集（例：大同－Google Cloud），驗證的是「Need 高 = 有雲端需求」，與原設計意圖一致。
2. **金融業 T3 營收動能失真**：國泰金近 3 個月營收 YoY −42%～−70%，來自保險業投資收益波動，不代表「降本需求」，卻拿到 15 分。
   建議：金融保險業 T3 視為缺資料（移出分母）。
3. **N3 上限飽和**：遞減報酬下 n≥5 就接近滿分（國泰金、台達電、上銀都在 24–25），前段班區分度低。建議上線後依驗證結果調整（rule v2）。
4. **同一新聞多家媒體轉載會重複計算**：例：國泰金「AI 數位同事」有 6 家媒體報導。因遞減報酬影響有限，先註記。
5. **新聞仍有產品類雜訊**：例：電子零組件廠的「AI 應用」產品新聞。字典可在 Sheets 持續調整。

## 5. 待完成
- [ ] GAS 實跑 `setupPhase2`（首次每週工作約 30–45 分鐘，背景自動接續）
- [ ] Verna 人工核對 §3
- [ ] Verna 決定 §4 第 1、2 點
