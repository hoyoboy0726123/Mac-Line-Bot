# Mac-Line-Bot（Windows 版）

在 Windows 電腦上用**本機大模型**自動回覆 LINE 官方帳號。功能與 Mac 版相同：

- 知識庫回答，不亂編
- 轉真人
- 預約收單（接受／婉拒）
- 多帳號
- 每日摘要與提醒
- 待補清單一鍵補成 FAQ
- 7 步設定精靈
- Cloudflare Tunnel 自訂網域
- MIL 版另有「軍規機種」管理：可匯入華碩官方報告 PDF，一鍵產生知識庫

另外多了**區網網頁管理**：同一個 Wi-Fi 裡的電腦或手機，用瀏覽器輸入密碼就能管理。

| | Mac 版 | Windows 版 |
| --- | --- | --- |
| 介面 | SwiftUI | Electron（同一套畫面也能用瀏覽器從區網開） |
| 回答模型 | Qwen（Ollama），Apple Intelligence 備援 | Qwen（Ollama） |
| 知識庫搜尋 | bge-m3 向量 + 關鍵詞 | 同左 |
| 金鑰保存 | 本機檔案（僅自己可讀） | Windows DPAPI 加密 |
| 資料格式 | JSON | 與 Mac 版相同，可以互相搬移 |

## 一般使用者：安裝

1. 到 GitHub 的 **Actions → Windows 版**，打開最新一次成功的執行，下載 `windows-installer`，解壓縮後執行 `Mac-Line-Bot-…-Setup-….exe`。
   - Windows 可能顯示「Windows 已保護您的電腦」，按「其他資訊 → 仍要執行」。這是因為安裝檔沒有付費數位簽章。
2. 安裝 [Ollama for Windows](https://ollama.com/download/windows)，並保持開啟。
3. 打開 App，跟著設定精靈走：
   - 第 1 步可以一鍵下載模型（`qwen3.5:9b` 和 `bge-m3`，約 7 GB）。
   - 第 6 步可以一鍵安裝 cloudflared。

建議配備：

- Windows 10 / 11 64 位元，記憶體 16 GB 以上。
- 有 8 GB 以上顯示卡時回答最快。
- 沒有獨立顯示卡的話，可以到「系統」把回答模型改成 `qwen3.5:4b`。

關掉視窗後 App 會縮到右下角通知區域，繼續回覆 LINE。要完全結束，請在圖示上按右鍵選「結束」。

## 區網管理

1. 到「系統 → 區網網頁管理」，先設定密碼，再打開「允許區網連入」。
2. 頁面會列出網址（例如 `http://192.168.1.20:8791`）。同一個區網的電腦或手機打開這個網址、輸入密碼即可。

安全設計：

- LINE 的 webhook 只開在本機（127.0.0.1），從區網連不到。
- 區網設定只能在主機上修改。
- 其他網站無法冒用你的登入狀態送出修改。

## 開發者

需要 Node.js 22。

```bash
cd windows
npm install
npm test          # 單元測試（FAQ 產生器與 Mac 版逐字比對、75 題 FAQ 回歸、PDF 解析…）
npm start         # 開 Electron 視窗
npm run server    # 不開視窗，只跑服務（瀏覽器開 http://127.0.0.1:8791）
npm run e2e       # 端對端測試：假 LINE 伺服器 + 本機 Ollama
npm run dist      # 打包 Windows 安裝檔（在 Windows 或 GitHub Actions 上執行）
```

### 程式結構

| 路徑 | 內容 |
| --- | --- |
| `src/core/` | 跟介面無關的核心 |
| `src/core/bot.js` | 自動回覆流程 |
| `src/core/retriever.js` | FAQ 比對與檢索 |
| `src/core/agent.js` | Agent 模式 |
| `src/core/mil/` | 軍規機種 |
| `src/web/` | 介面（Vue，App 視窗與區網瀏覽器共用） |
| `src/main.js` | Electron：視窗、通知區域圖示、開機自動啟動 |
| `edition.json` | 版本設定：`mil`（軍規專用版）或 `base`（基礎版） |

每次推上 `windows/` 的修改，GitHub Actions 都會在 Windows 上：

1. 跑測試
2. 打包安裝檔
3. 實際開啟 App，逐頁截圖

截圖可以在該次執行的 `windows-screenshots` 下載。
