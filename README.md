# 顧店 GuDian（Beta）

**macOS 本地端 AI 串 LINE 客服。** 裝在 Mac 上，照設定精靈走七步，你的 LINE 官方帳號就會開始自己回訊息。

用的是 macOS 內建的 **Apple Intelligence 本地模型**（Foundation Models），
不用 API key、沒有 token 費用，顧客的對話和你的資料都留在自己的電腦上。

## 目前做到的事

- **依你的知識庫回答**：常見問題直接回標準答案（不經過模型）；其他問題 AI 只依店家資料回答，沒資料就老實說沒有，不亂編。
- **轉人工**：顧客要找專人、問到不該回的問題（退款、客訴…），AI 停手改推播通知你；你回覆後它自動閃開，一段時間沒動靜再交還 AI。
- **預約收單**：AI 問完日期、時間、人數（可選姓名、電話）整理成一筆，你在 LINE 按一下「接受 / 婉拒」，顧客馬上收到確認。
- **多個官方帳號同時跑**：分店各有自己的知識庫、規則與對話，共用同一個 Tunnel。
- **推播到你的 LINE**：每日摘要、待回覆提醒、斷線通知。
- **越用越準**：AI 答不出來的問題自動整理成「待補清單」，一鍵補成 FAQ。
- **自動維護 webhook**：Cloudflare Quick Tunnel 網址變動時自動更新 LINE 後台並測試；也支援自訂網域（固定網址）。

## 需要

- Apple 晶片的 Mac
- macOS 26 以上（開發於 macOS 27）、並開啟 Apple Intelligence
- 一個開通 Messaging API 的 LINE 官方帳號
- 長期跑的話 Mac mini 還是首選（記得關閉自動睡眠）

## 安裝

需要 Xcode 26 以上。

```bash
git clone <this repo>
cd Mac-Line-Bot
./scripts/build-app.sh          # 產生 build/顧店.app
open build/顧店.app
```

開發時也可以直接 `swift run`，或用 Xcode 打開 `Package.swift`。

## 七步設定精靈

1. **歡迎**：檢查 Apple 晶片、macOS 版本、Apple Intelligence 與本機服務
2. **建立官方帳號**：開通 Messaging API、關閉 OA 的「自動回應訊息」、開啟 Webhook
3. **填入金鑰**：Channel secret + Channel access token，會自動讀取帳號名稱與頭像
4. **店家資訊**：店名、地址、電話、營業時間
5. **常見問題**：先放幾題最常被問的
6. **建立連線**：一鍵安裝 cloudflared、建立 Tunnel、自動設定並測試 LINE webhook
7. **綁定你的 LINE**：用自己的 LINE 對官方帳號傳「綁定 123456」

## 在 LINE 上管理

綁定後，你的 LINE 就是遙控器：

| 傳送 | 作用 |
| --- | --- |
| `#AB12 您好，我是店長` | 以店家身分回覆代碼 AB12 的顧客（AI 自動暫停） |
| `交還 AB12` | 把顧客交還給 AI |
| `待回覆` | 等待真人回覆的顧客 |
| `預約` | 待確認的預約 |
| `待補` | AI 答不出來的問題 |
| `摘要` | 今日數據 |
| `指令` | 顯示說明 |

預約通知與轉人工通知也有按鈕，直接按「接受 / 婉拒 / 交還 AI」即可。

## 運作方式

```
顧客 LINE ─▶ LINE Platform ─▶ Cloudflare Tunnel ─▶ 127.0.0.1:8787/webhook/<帳號>
                                                          │
                                         簽章驗證 → 轉人工關鍵字 → 預約流程
                                         → FAQ 比對 → Apple 本機模型（知識庫檢索）
                                         → 答不出來：婉轉回覆 + 待補清單 + 通知店家
```

- 本機服務只綁在 `127.0.0.1`，外部只能經由 Tunnel 進來，且每個請求都驗證 `X-Line-Signature`。
- AI 回覆使用 reply API（不計費）；推播通知、真人回覆、預約確認使用 push（計入官方帳號額度）。
- 所有資料存在 `~/Library/Application Support/GuDian/`，金鑰存在同資料夾權限 600 的 `secrets.json`。

## 固定網址（自訂網域）

Quick Tunnel（`xxx.trycloudflare.com`）免設定，但重啟後網址會變（顧店會自動更新 LINE 後台）。
想要固定網址：

1. 把網域交給 Cloudflare 管理（一年約 US$10）
2. Cloudflare Zero Trust → Networks → Tunnels 建立 Tunnel，Public Hostname 例如 `bot.你的網域.com` → `http://localhost:8787`
3. 在顧店「LINE 連線」選「自訂網域」，填入網域與 Tunnel Token

同一個網域可以開很多子網域，不用另外付錢。

## 專案結構

```
Sources/GuDian/
├── App/        GuDianApp（視窗、選單列）、AppState（服務總控、排程、通知）
├── Models/     帳號、知識庫、對話、預約、統計
├── Services/   HTTPServer、LineAPI、TunnelManager、AIEngine、BotEngine、
│               KnowledgeRetriever（FAQ 比對 / 知識檢索）、ReservationParser
└── Views/      總覽、客服對話、預約、使用量、知識庫、店家資訊、回覆規則、
                LINE 連線、帳號管理、系統、設定精靈
```
