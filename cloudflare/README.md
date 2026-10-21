# Mac-Line-Bot MIL 雲端版（Cloudflare）

跟軍規版共用同一套核心程式（`../windows/src/core`）和管理介面（`../windows/src/web`），只把底層換成 Cloudflare：

| 桌面版 | 雲端版 |
| --- | --- |
| Electron 視窗、本機 HTTP 服務 | Worker（`src/worker.js`） |
| JSON 檔案 | Durable Object 儲存空間（`src/shims/store.cjs`） |
| Ollama（qwen3.5:9b + bge-m3） | Workers AI（`@cf/qwen/qwen3-30b-a3b-fp8` + `@cf/baai/bge-m3`） |
| Cloudflare Tunnel（網址會變） | Worker 固定網址 |
| 區網密碼 | 管理密碼（Cloudflare Secret `ADMIN_PASSWORD`） |
| `setInterval` 排程 | Durable Object 鬧鐘，每 5 分鐘一次 |

台灣時間固定為 UTC+8（`src/tz.js`），每日摘要、統計日期才會跟桌面版一樣。

## 部署

```bash
cd cloudflare
npm install
npx wrangler login                        # 第一次：登入 Cloudflare（帳號 Line-bot-Media）
npm run deploy                            # 打包並部署
npx wrangler secret put ADMIN_PASSWORD    # 設定管理密碼（至少 8 個字）
```

部署完成後打開 `https://mac-line-bot-mil.<子網域>.workers.dev`，用管理密碼登入，跟著設定精靈填入 LINE 金鑰。

## 測試

```bash
npx wrangler dev -c wrangler.test.jsonc --port 8799   # 本機（沒有 Workers AI）
node test/e2e.mjs                                       # 登入、FAQ、卡片、比較、轉真人、Excel 匯入
```

## 目前限制

- **PDF 匯入暫時不能用：**在 Worker 裡解析太吃 CPU。請用 Excel 匯入或手動新增，之後會改在瀏覽器解析。
- **CPU 時間有限制：**免費方案每次請求最多 10 ms CPU 時間（等 AI 回覆的時間不算）。部署後要實測「產生知識庫」和「Excel 匯入」。
