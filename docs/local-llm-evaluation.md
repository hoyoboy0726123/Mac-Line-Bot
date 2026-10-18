# 本地模型升級評估：Qwen 系列 + BGE 向量檢索

> 評估日期：2026-10-18｜測試機器：MacBook Pro (Mac16,8) M4 Pro 12C CPU / 16C GPU / 24 GB／macOS 27.0｜Ollama 0.34.0
> 範圍：只做研究與實測，沒有改動 `Sources/`。實測腳本與原始結果放在 `docs/local-llm-eval/`。

---

## 0. 結論先講

| 項目 | 建議 |
|---|---|
| 主力模型 | **Qwen3.5-9B（Ollama `qwen3.5:9b`，Q4_K_M，已在機器上）**，`think:false` + JSON schema 結構化輸出 |
| 速度優先的替代 | **Qwen3.5-4B（`qwen3.5:4b`，Q4_K_M）**：品質跟 9B 差不多（這次測試 9.5/10 對 9.5/10），速度快約 1.7 倍，但區分相似型號的能力比較弱 |
| 執行方式 | **Ollama 原生 API**（`POST /api/chat`、`/api/embed`）。已經安裝，Ollama.app 開機會自己啟動，結構化輸出和關閉 thinking 都實測可用 |
| 向量模型 | **bge-m3（Ollama `bge-m3`，1024 維）**：實測 10 題全部第一名命中，也是唯一一個把標題裡的口語提示拿掉之後還能 10/10 的模型；每次查詢約 32 ms |
| Reranker | 現階段**不需要**（知識庫只有幾十段）。之後知識庫超過幾百段再考慮 bge-reranker-v2-m3 |
| Apple 內建模型 | 留著當**備援**：Ollama 沒在跑、逾時或回傳 JSON 失敗時改用 Apple 模型 |
| 工作量 | 約 **3～5 個工作天**（LLM 後端抽象＋Ollama client 1～1.5 天，向量索引＋混合檢索 1～1.5 天，評估與調 prompt 1 天，UI 與狀態檢查 0.5 天） |

一句話：「換成 Qwen3.5 + bge-m3、透過 Ollama 呼叫」是值得做的升級。**品質提升明顯**（這組測試 Apple 6.0/10，Qwen3.5 9.5/10），太保守、型號混淆這兩個問題大幅減少。**速度不會變快很多**：9B 平均每題 9.2 秒，4B 是 5.5 秒；Apple 在同樣條件下平均 9.0 秒。

---

## 1. Qwen 系列實際有哪些版本（釐清「qwen3.8」）

**沒有可以下載到本機的「Qwen3.8」小模型**。截至 2026-10，可以在本機跑的開源權重版本整理如下。

| 世代 | 發布 | 開源尺寸 | 授權 | 備註 |
|---|---|---|---|---|
| Qwen3 | 2025-04 | 0.6B / 1.7B / 4B / 8B / 14B / 32B（dense）、30B-A3B / 235B-A22B（MoE） | Apache 2.0 | 同一個模型可以切換 thinking 和 non-thinking |
| Qwen3-2507 | 2025-07～08 | 4B-Instruct-2507 / 4B-Thinking-2507、30B-A3B-Instruct/Thinking-2507、235B | Apache 2.0 | Instruct 版**只有 non-thinking**，256K context。Ollama 的 `qwen3:4b` 已經是 2507 版（context 262144） |
| **Qwen3.5** | **2026-03-02** | **0.8B / 2B / 4B / 9B**（dense，Gated DeltaNet 混合架構）、27B、35B-A3B、122B-A10B | Apache 2.0 | 原生多模態（可以讀圖），262K context，支援 201 種語言。**9B 是目前 10B 以下最強的開源模型** |
| Qwen3.6 | 2026-04 | 只有 **27B** 與 **35B-A3B** | Apache 2.0 | 沒有小尺寸。Q4 檔案 17～24 GB，在 24 GB 機器上太緊 |
| Qwen3.7 / 3.8 | 2026-05～07 | **沒有開源權重**（只有 API 的 Max / Plus） | — | 第三方消息說有 Qwen3.8-Max preview，但沒有權重 |

所以「qwen3.8 或更低」實際上可以選的是 **Qwen3.5-9B / 4B / 2B**，以及上一代的 Qwen3-8B / Qwen3-4B-2507。

---

## 2. 各尺寸在 M4 Pro 24 GB 上的表現

測試條件：Ollama 0.34.0，`num_ctx=8192`，每題 prompt 約 1,000～1,200 tokens（系統規則加上 4 段資料），JSON schema 輸出，`think:false`。「常駐占用」取自 `ollama ps`。

| 模型（Ollama tag） | 量化 | 檔案大小 | 常駐占用 | Prompt 處理（實測） | 生成速度（實測） | 每題平均（實測） | 能否與其他程式常駐 |
|---|---|---|---|---|---|---|---|
| Qwen3.5-0.8B `qwen3.5:0.8b` | Q8_0 | 1.0 GB | ~1.5 GB | — | — | — | 可以，但品質不夠，不建議 |
| Qwen3.5-2B `qwen3.5:2b` | Q4_K_M | 1.9 GB | ~2.5 GB | — | — | — | 可以，只適合做意圖分類 |
| **Qwen3.5-4B `qwen3.5:4b`** | Q4_K_M | 3.3 GB | **3.4 GB** | **~480 tok/s** | **~52 tok/s** | **5.5 s** | 很輕鬆 |
| **Qwen3.5-9B `qwen3.5:9b`** | Q4_K_M | 6.6 GB | **5.7 GB** | **~313 tok/s** | **~35.5 tok/s** | **9.2 s** | 可以（加上 bge-m3 一共約 6.4 GB） |
| Qwen3-4B-2507 `qwen3:4b` | Q4_K_M | 2.5 GB | 3.9 GB | ~940 tok/s | ~70 tok/s | 3.6 s | 很輕鬆 |
| Qwen3-8B `qwen3:8b` | Q4_K_M | 5.2 GB | 6.5 GB（8K ctx）／**10 GB（32K ctx）** | ~535 tok/s | ~42 tok/s | 5.0 s | 可以，但 context 不要開太大 |
| Qwen3.5-9B Q8 `qwen3.5:9b-q8_0` | Q8_0 | 10 GB | ~11 GB | 估約 300 | 估約 22～25 | — | 勉強，不划算 |
| Qwen3.5-9B MLX `qwen3.5:9b-mlx` | MLX | 8.9 GB | — | 社群數據 361（4bit） | 社群數據 49.7（4bit） | — | 可以 |
| Qwen3.6-27B `qwen3.6:27b` | Q4_K_M | 17 GB | ~18 GB+ | 估約 100 | 估約 10～12 | 估 20 s 以上 | **不行**：會超過 macOS 預設 GPU 可用記憶體（約 RAM 的 2/3～3/4，即 16～18 GB） |
| Qwen3.6-35B-A3B | Q4_K_M | 24 GB | — | — | — | — | **不行** |

觀察：

- **量化**：4B／9B 用 **Q4_K_M** 就夠了。Q8 檔案大一倍、速度慢約 40%，對這種「照資料回答」的任務幫助很小。走 MLX 的話用 4bit。
- **MLX 比 GGUF 快**：社群在 M4 Pro 24 GB 上量到 Qwen3.5-9B MLX 4bit 的 prompt 處理 361 tok/s、生成 49.7 tok/s，比這次 Ollama GGUF 實測的 313／35.5 快約 15～40%。Ollama 也有 `-mlx` tag 可以選，但結構化輸出在 MLX 引擎上的行為還沒驗證。
- **Qwen3.5 的 KV cache 比 Qwen3 小很多**（混合注意力架構）：qwen3:8b 開到 32K context 會吃到 10 GB，qwen3.5:9b 在 8K 只要 5.7 GB。
- **每題時間的組成**：prompt 約 1,000 tok ÷ 313 tok/s ≈ 3.2 s，生成約 200 tok ÷ 35 tok/s ≈ 5.6 s。**大部分時間花在生成**，其中 `evidence` 摘錄欄位就占了一半左右的 token，詳見第 6 節的優化方法。
- **Thinking 模式完全不能開**：qwen3.5:9b 開 thinking 後，每題要 **92～235 秒**，會產生 2,700～6,400 個思考 token。
- **24 GB 的餘裕**：qwen3.5:9b 和 bge-m3 同時常駐時，系統可用記憶體還有約 38%，同時開 Xcode 和瀏覽器沒有問題。

---

## 3. 執行方式比較（給 Swift App 呼叫用）

| | **Ollama** | llama.cpp `llama-server` | MLX（mlx-lm／mlx-swift-lm） | LM Studio |
|---|---|---|---|---|
| 呼叫方式 | REST：`/api/chat`、`/api/embed`，另有 OpenAI 相容 `/v1` | OpenAI 相容 REST | mlx-lm：Python `mlx_lm.server`（OpenAI 相容）；mlx-swift-lm：**直接嵌進 Swift，不需要 server** | OpenAI 相容 REST、`lms` CLI |
| 結構化 JSON | `format: <JSON Schema>`，用 grammar 限制輸出。**實測 50/50 次都是合法 JSON** | `json_schema` / GBNF grammar | Python server 沒有內建 schema 限制；mlx-swift-lm 有 MLXGuidedGeneration（JSON Schema） | `response_format: json_schema` |
| 關閉 Qwen thinking | 原生 API 加 `"think": false`（**實測有效**）。注意：`/v1` 相容端點不會帶這個參數 | `--reasoning-budget 0` 或 `chat_template_kwargs: {enable_thinking:false}` | chat template 參數 `enable_thinking=False` | UI／API 設定（有 Qwen3.5 關不掉 thinking 的 bug 回報） |
| Embedding | `/api/embed`（bge-m3、bge-large-zh、qwen3-embedding） | `--embeddings` | mlx-embeddings | 有 |
| Reranker | **沒有** rerank API | **有** `--reranking`（可以載 bge-reranker-v2-m3 GGUF） | 自己寫 | 沒有 |
| 開機常駐 | Ollama.app 是選單列 App，預設登入後自動啟動；`keep_alive: -1` 可以讓模型一直留在記憶體 | 要自己寫 launchd plist | 嵌入式：跟著 App 一起啟動；Python：要自己寫 launchd | llmster headless daemon（0.4 版起） |
| 多模型同時載入 | 可以（LLM + embedding 同時） | 一個 process 一個模型（或用 router 模式） | 自己管理 | 可以 |
| 授權 | MIT | MIT | MIT | 免費商用，但**閉源**，不能重新散布 |
| 這台機器的現況 | **已安裝，正在執行** | 沒有 | 沒有 | 沒有 |
| 整合難度 | ★ 最低 | ★★ | ★★★（嵌入式需要處理模型下載、記憶體、Metal） | ★★ |

**建議用 Ollama。** 機器上已經裝好、會自己常駐，結構化輸出、`think:false`、embedding 這三件事一個 server 就能處理，Swift 這邊只需要 `URLSession` + `Codable`。

- **關於已知 bug**：GitHub issue #14645 回報 Ollama 0.17.6 上 Qwen3.5 的 `think:false` + `format` 會讓 format 失效。在 **0.34.0 實測沒有重現**，40 次都是合法 JSON。Ollama 更新後建議重新跑 `docs/local-llm-eval/qa.py` 確認。
- **長期選項**：如果之後要把 App 給其他店家用、又不想要求對方裝 Ollama，可以改成 **mlx-swift-lm 嵌入式**（LLM）加 **swift-embeddings**（向量），全部在同一個 process 裡跑，但工程量大約是 Ollama 方案的 2～3 倍。

---

## 4. 向量模型（BGE 等）

### 4.1 候選規格

| 模型 | 參數 | 維度 | 最長輸入 | 檔案大小 | 語言 | 授權 |
|---|---|---|---|---|---|---|
| bge-small-zh-v1.5 | 24M | 512 | 512 tok | ~95 MB | 中文（以簡體為主） | MIT |
| bge-base-zh-v1.5 | 102M | 768 | 512 tok | ~400 MB | 中文 | MIT |
| bge-large-zh-v1.5 | 326M | 1024 | 512 tok | ~1.3 GB（Ollama f16 651 MB） | 中文 | MIT |
| **bge-m3** | 568M | 1024 | **8192 tok** | ~2.2 GB fp32（Ollama f16 1.2 GB，常駐 673 MB） | 100+ 語言（繁簡都可以），支援 dense、sparse、multi-vector | MIT |
| bge-reranker-v2-m3 | 568M | （cross-encoder） | 8192 | ~1.1 GB f16 | 多語 | Apache 2.0 |
| Qwen3-Embedding-0.6B / 4B / 8B | 0.6B / 4B / 8B | 1024 / 2560 / 4096 | 32K | 639 MB / ~2.5 GB / 4.7 GB | 多語 | Apache 2.0 |

### 4.2 實測：口語問題能不能找到正確段落

測試方法如下：

- **段落與題目**：文件依空行切成 26 段（跟 `KnowledgeRetriever.chunks` 一樣），問 10 題口語問題，用 cosine 相似度排序。✅ 表示第一名就命中，🟡 表示前三名有命中，❌ 表示前三名都沒有。
- **為什麼另外做「去提示」版**：目前的知識檔在每段標題後面人工加了口語關鍵詞，例如「（摔落 掉落 掉到地上 摔到地上…）」，這會讓檢索比實際情況容易很多。所以另外做了一組把標題括號提示拿掉的版本，比較接近一般店家直接貼上來的資料。
- **測試題**：溫度衝擊測試怎麼做、摔到地上會壞嗎、B1400 有做沙塵測試嗎、P5 可以耐多低溫、筆電可以淋雨嗎、坐飛機帶著沒問題吧、L1400 有沒有做溫度衝擊、摔壞了保固有賠嗎、放在車上曬太陽會怎樣、開車載著一直震動可以嗎。

| 檢索方式 | 原文 Top1 | 原文 Top3 | **去提示 Top1** | **去提示 Top3** | 每次查詢 | 建立 26 段索引 |
|---|---|---|---|---|---|---|
| 現行雙字詞覆蓋率（不含 AI 關鍵詞擴充） | 10/10 | 10/10 | **8/10** | **8/10**（「摔到地上」「坐飛機」完全找不到） | <1 ms | — |
| bge-large-zh-v1.5（含官方 query 前綴） | 9/10 | 10/10 | 8/10 | 10/10 | 18 ms | 0.9 s |
| **bge-m3** | **10/10** | **10/10** | **10/10** | **10/10** | 32 ms | 0.7 s |
| Qwen3-Embedding-0.6B（含 instruct 前綴） | 9/10 | 9/10 | 9/10 | 9/10（「保固」完全找不到） | 28 ms | 1.3 s |
| Qwen3-Embedding-8B（含 instruct 前綴） | 9/10 | 10/10 | 9/10 | 10/10 | 146 ms | 13.8 s |

觀察：

- **bge-m3 最穩**，繁體口語對上技術用語都能找到，例如「坐飛機」對到 500.6 低氣壓，「淋雨」對到 507.6 濕度段（該段寫明沒有防水測試），「摔壞保固」對到注意事項。
- **雙字詞法很依賴人工加的提示詞**，提示拿掉就漏掉 2 題。現在每題要多呼叫一次 AI 做關鍵詞擴充（約 1～3 秒），就是為了補這個缺口。**改用向量之後，這次 AI 呼叫可以拿掉**，等於每題省下一次模型呼叫。
- **分數差距不大**：bge-m3 第一名和第二名常常只差 0.03～0.08，所以建議做「向量 + 雙字詞」**混合排序**（見第 6 節），型號代碼這類精確字串（B1400、P5405CSA）由雙字詞法補強。
- **過去 NLContextualEmbedding 效果差**，是因為它不是為檢索訓練的模型（加上平均池化）。BGE / Qwen3-Embedding 是專門做檢索的對比學習模型，兩者不是同一類東西。
- **樣本很小**：只有 10 題、26 段，結論是「方向明確」，還不能當成統計上的定論。

### 4.3 在 Mac 本機跑 embedding 的方式

| 方式 | 優點 | 缺點 | 適合度 |
|---|---|---|---|
| **Ollama `/api/embed`** | 已經裝好；實測 26 段 0.7 s、單次查詢 32 ms；跟 LLM 同一個 server | 需要 Ollama 在跑；只有 dense 向量，沒有 sparse 和 rerank | **★★★ 現在就用這個** |
| swift-embeddings（jkrukowski，MLTensor） | 純 Swift、在 App 內執行；支援 BERT、XLM-RoBERTa（bge-m3 的架構） | 版本 0.x，維護不算活躍；bge-m3 要自己驗證權重格式 | ★★ 之後「不依賴 Ollama」時的選項 |
| Core ML 轉換（coremltools） | 可以跑在 ANE，省電 | 要自己轉模型、自己處理 tokenizer（swift-transformers）；bge-m3 的 8K 輸入轉換比較麻煩 | ★ |
| MLX（mlx-embeddings Python／MLX Swift） | 速度快 | 要 Python 環境或另外寫 Swift 整合 | ★ |
| Python sidecar（FlagEmbedding） | 可以用 bge-m3 的 sparse、ColBERT 和 reranker 完整功能 | 要打包 Python，維運最重 | ★ |

**Reranker**：Ollama 不支援 rerank。真的需要的話，用 `llama-server --reranking` 載 bge-reranker-v2-m3 的 GGUF，再開一個 port。以目前的資料量，排序交給 LLM 自己挑就夠了，不建議現在加。

---

## 5. 實測：問答品質與速度（Apple vs Qwen）

### 5.1 測試設定

- **上下文相同**：所有模型拿到**同一份上下文**，由 bge-large-zh 取前 4 段、1,800 字以內，存在 `docs/local-llm-eval/contexts.json`。
- **規則相同**：系統規則跟 `AIEngine.instructions` 相同，語氣「親切有禮」，回覆 150 字以內。
- **輸出格式**：`{intent, evidence, reply}`。Apple 用 `@Generable`，Qwen 用 Ollama JSON schema。temperature 都是 0.2。
- **Apple 模型的測法**：用 `docs/local-llm-eval/fm.swift`，在同一台機器上呼叫 FoundationModels。
- **評分**：✓ = 正確完整（1 分），△ = 部分正確、過度保守、措辭有誤導或違反規則（0.5 分），✗ = 錯誤、空白或過度承諾（0 分）。由評估者人工判斷。
- **知識檔版本**：測試期間知識檔有被同步修改（C2 段改成「P5405CSA 的結果總表列為 C1，測試說明另列此 C2 參數」）。本表以修改後的版本為準（sha1 `30c394da…`），因此「P5 可以耐多低溫」的正確答案是 C1 的 -25～-33°C（儲存）／-21～-32°C（運作）。

### 5.2 速度彙總

| 模型 | 每題平均 | 最快～最慢 | 平均生成 token | 生成速度 | 常駐記憶體 | 冷啟動載入 |
|---|---|---|---|---|---|---|
| Apple 內建（FoundationModels） | 9.0 s | 3.8～15.4 s | — | — | 系統管理 | — |
| qwen3:4b（Qwen3-4B-2507） | **3.6 s** | 1.4～6.1 s | 162 | 70 tok/s | 3.9 GB | 1.9 s |
| qwen3:8b | 5.0 s | 3.2～7.7 s | 107 | 42 tok/s | 6.5 GB | 2.8 s |
| **qwen3.5:4b** | **5.5 s** | 3.9～7.4 s | 167 | 52 tok/s | 3.4 GB | 2.5 s |
| **qwen3.5:9b** | 9.2 s | 6.0～12.3 s | 197 | 35.5 tok/s | 5.7 GB | 4.0 s |
| qwen3.5:9b（開 thinking） | **152 s** | 92～235 s | 4,068 | 28 tok/s | 5.7 GB | — |

### 5.3 品質逐題

| 問題 | Apple | qwen3:4b | qwen3:8b | **qwen3.5:4b** | **qwen3.5:9b** |
|---|---|---|---|---|---|
| 溫度衝擊測試怎麼做 | ✓ 完整，但像照抄 | ✓ | △ 只講 I-A | ✓ | ✓ |
| 摔到地上會壞嗎 | △ 結尾加了「目前沒有…詳細結果」（保守） | ✗ **回覆空白** | ✓ | ✓ | ✓ |
| B1400 有做沙塵測試嗎（B1400CBA 有吹沙，B1400/B1500 沒有） | △ 只講 B1400CBA | △ 只講 B1400CBA | ✗ **直接說「B1400 有做」，型號混淆** | △ 只講 B1400CBA，還說「具備防護能力」 | ✓ **有區分子型號** |
| P5 可以耐多低溫 | △ **把溫度衝擊混進低溫答案** | ✓ | ✓ | ✓ | ✓ 還補充「極寒要看其他型號」 |
| 筆電可以淋雨嗎 | △ 說沒有防水測試，卻接著列出「通過型號」（會誤導） | △ 說「根據華碩官方測試報告」（違反規則 6）、錯字「潛規」 | ✓ | ✓ | ✓ |
| 坐飛機帶著沒問題吧 | △ 「目前無法確認」（保守） | △ 「可安全帶飛機」（過度承諾） | △ 沒有數字 | ✓ 先講條件，再請顧客確認型號 | △ 「應可安全搭乘」（輕微過度承諾） |
| L1400 有沒有做溫度衝擊（沒有） | △ 答得含糊 | ✓ | ✓ | ✓ | ✓ |
| 摔壞了保固有賠嗎 | △ 「目前無法確認」開頭（保守） | ✓ | ✓ | ✓ | ✓ |
| 放在車上曬太陽會怎樣 | ✓ | ✓ | △ 說「可承受」 | ✓ | ✓ |
| 開車載著一直震動可以嗎 | △ 整段照抄規格 | ✓ | ✗ **「可正常使用」，過度承諾** | ✓ | ✓ |
| **總分（10 分）** | **6.0** | **7.5** | **6.5** | **9.5** | **9.5** |

**意圖分類**另外測了 6 句（打招呼、找真人、訂位、道謝、抱怨、詢問）：qwen3:4b、qwen3.5:4b、qwen3.5:9b 都是 **6/6**。其中 qwen3:4b 出現簡體「不客气」；Qwen3.5 系列輸出的繁體比較穩定。

### 5.4 跟 Apple 內建模型已知問題的比較

| Apple 的已知問題 | Qwen3.5 的表現 |
|---|---|
| 太保守，常說「目前無法確認」或「沒有資訊」 | 這次 10 題中，Apple 有 3 題用保守語氣開頭；Qwen3.5-4B 和 9B **0 題** |
| 把 A 型號的資料說成 B 型號 | Apple 把溫度衝擊混進低溫答案，淋雨題列出無關型號。qwen3.5:9b 是唯一能區分 B1400CBA 和 B1400/B1500 的模型。注意：**qwen3:8b 反而混淆了** |
| 回答像照抄規格 | Qwen3.5 會先整理再回答，語氣更像客服 |
| 新的風險 | Qwen 有時會輕微過度承諾（「應可安全」），回覆也偏長（9B 平均 118 字，有幾題超過 150 字上限），要靠 prompt 和截斷控制 |

---

## 6. 整合建議

### 6.1 架構

```
顧客訊息
  │
  ├─ FAQ 比對（不變，不經過模型）
  │
  ├─ 檢索：bge-m3 查詢向量（Ollama /api/embed，約 30 ms）
  │        ＋ 雙字詞覆蓋率（現有程式碼）
  │        → 混合分數 = 0.7 × 向量相似度（正規化）＋ 0.3 × coverage，或用 RRF
  │        → 取前 3～4 段，1,800～3,000 字（Qwen context 大，可以放寬）
  │        ※ 拿掉 AI 關鍵詞擴充（searchTerms）這次呼叫
  │
  └─ 回答：LLMBackend
           ├─ 主力：OllamaBackend（qwen3.5:9b 或 4b，think:false，format=JSON schema）
           └─ 備援：AppleFMBackend（現有 @Generable 程式碼）
              觸發條件：Ollama 沒在跑、逾時（建議 20 s）、JSON 解析失敗
```

### 6.2 對現有程式碼的改動範圍（只是規劃，這次沒有修改）

| 檔案 | 改動 |
|---|---|
| `Services/AIEngine.swift` | 抽出 `protocol LLMBackend { answer / extractSlots / freeform }`。現有 FoundationModels 程式碼原樣搬到 `AppleFMBackend`。`instructions()` 共用。`status()` 改成回報「主力／備援」兩個狀態 |
| 新增 `Services/OllamaClient.swift`（約 150～200 行） | `URLSession` 呼叫 `/api/chat`（`think:false`、`format` 用 JSON Schema，跟 `KnowledgeAnswer`、`ReservationSlots` 一一對應）、`/api/embed`、`/api/tags`、`/api/ps`；用 `Codable` 解碼；App 啟動時送一次 `keep_alive: -1` 暖機 |
| `Services/KnowledgeRetriever.swift` | `context(for:)` 改成接收查詢向量，做混合排序；`termScore` 可以保留當備援（沒有 embedding 時） |
| 新增 `Services/VectorIndex.swift` | 知識文件新增或修改時，對每段做 embedding，用 chunk 文字的 hash 當 key，存成 float32 二進位或 JSON（跟 `Persistence` 同一個資料夾）；查詢時用 `Accelerate`（vDSP）算 cosine。幾千段以內直接逐筆比對就夠了 |
| `Services/BotEngine.swift` | 第 215 和 598 行附近的 `searchTerms` 改成取查詢向量；`answer` 改走 `LLMBackend` |
| 設定 UI | 模型名稱（預設 `qwen3.5:9b`）、Ollama URL（預設 `http://127.0.0.1:11434`）、「Ollama 失敗時用 Apple 模型」開關、狀態燈號、「重建向量索引」按鈕 |

**加速方法**（9B 可以從約 9 秒降到 5～6 秒）：

1. **縮短 `evidence`**：只摘錄最相關的 1～2 句，最多 120 字；或改成只回傳段落編號，由程式自己取原文。這個欄位目前占了大約一半的生成 token。
2. **固定 system prompt 放最前面**，讓 Ollama 重複使用 prompt cache。
3. **限制輸出長度**：`num_predict` 設 300 左右，避免偶爾出現過長回覆。
4. **改用 4B**：`qwen3.5:4b` 平均 5.5 秒，品質在這組測試和 9B 相同。

### 6.3 風險與對策

| 風險 | 說明 | 對策 |
|---|---|---|
| 記憶體 | 9B 加 bge-m3 常駐約 6.4 GB，24 GB 足夠；但如果同時開大型 App（例如 Xcode 模擬器），macOS 可能會換頁 | 設定裡可以切換成 4B（約 4 GB）；用 `keep_alive` 設定閒置一段時間後釋放 |
| 耗電與發熱 | 生成時 GPU 滿載數秒；閒置時模型只占記憶體、不耗電 | LINE 客服的流量不大，影響有限；用電池時可以自動切換 4B |
| 開機常駐 | 依賴 Ollama.app 登入後自動啟動 | App 啟動時檢查 `/api/tags`；沒有回應就顯示提示，並改用 Apple 模型；也可以在 App 裡用 `Process` 執行 `ollama serve` |
| Ollama 更新導致行為改變 | 0.17.6 曾經有 think+format 的 bug | 固定 Ollama 版本，更新後跑 `docs/local-llm-eval/qa.py` 回歸測試；JSON 失敗時自動退回 Apple 模型 |
| 過度承諾 | Qwen 偶爾會說「應可安全」 | 在 prompt 規則 2 加上「不要說『可以安全、沒問題、可正常使用』」；`saysNoInfo` 的反向檢查可以加「保證」類詞彙 |
| 繁簡混用 | qwen3:4b 出現「不客气」 | 選 Qwen3.5；必要時在輸出後用 OpenCC 或簡單字表轉成繁體 |
| 散布給其他店家 | 對方要另外安裝 Ollama 並下載約 7.8 GB 模型 | 初期提供安裝說明；長期改用 mlx-swift-lm + swift-embeddings 嵌入式方案 |
| 授權 | Qwen3 / Qwen3.5 / Qwen3-Embedding：**Apache 2.0，可以商用**。bge-m3、bge-*-zh-v1.5：**MIT，可以商用**。bge-reranker-v2-m3：Apache 2.0。Ollama、llama.cpp、MLX：MIT | 保留授權聲明即可。LM Studio 可以免費用在工作上，但它是閉源軟體，不能隨 App 一起散布 |

### 6.4 明確建議

1. **現在**：用 **Ollama + `qwen3.5:9b`（Q4_K_M）+ `bge-m3`**，Apple 模型當備援。這兩個模型機器上都有，不用再下載。
2. 如果回覆速度比品質重要，設定預設改成 **`qwen3.5:4b`**。建議做成設定選項，讓使用者自己切換。
3. 檢索改成 **bge-m3 + 雙字詞混合排序**，並**拿掉 AI 關鍵詞擴充**這次呼叫。
4. 不建議的選項：Qwen3-8B（會混淆型號、過度承諾，KV cache 也大）、任何開 thinking 的模式、Qwen3.6-27B 以上（24 GB 放不下）、現階段的 reranker。

---

## 7. 這次實測下載的模型與清理方式

| 模型 | 大小 | 來源 | 用途 |
|---|---|---|---|
| `qwen3:4b` | 2.5 GB | **這次下載** | 測試 |
| `qwen3.5:4b` | 3.3 GB | **這次下載** | 測試（建議的備選） |
| `bge-m3` | 1.2 GB | **這次下載** | 測試（**建議保留**） |
| `qwen3-embedding:0.6b` | 639 MB | **這次下載** | 測試 |
| `qwen3:8b`、`qwen3.5:9b`、`quentinz/bge-large-zh-v1.5`、`qwen3-embedding:8b` | — | 使用者原本就有 | 直接拿來測，沒有改動 |

- **這次新增**：合計約 **7.6 GB**，存放在 `~/.ollama/models`（Ollama 的模型目錄目前共 87 GB，磁碟剩餘約 105 GB）。
- **不需要的話可以刪除**：

```bash
ollama rm qwen3:4b
ollama rm qwen3-embedding:0.6b
ollama rm qwen3.5:4b     # 如果決定只用 9B
# bge-m3 建議保留；如果不採用向量檢索才執行：ollama rm bge-m3
```

- **Ollama 服務**：測試前 Ollama.app 就已經在執行（PID 2201），這次沒有另外啟動或停止任何服務。測試時載入的模型會在閒置 15 分鐘後自動卸載。

---

## 8. 重現方式

```bash
cd docs/local-llm-eval
python3 retrieval.py bge-m3                      # 檢索測試（STRIP=1 → 去提示版）
python3 bigram.py                                # 現行雙字詞法基準
python3 mkctx.py                                 # 重建共用上下文 contexts.json
python3 qa.py qwen3.5:9b                         # 問答測試（加 think 參數 → thinking 模式）
python3 intent.py qwen3.5:4b qwen3.5:9b          # 意圖分類
swiftc -o /tmp/fm fm.swift && /tmp/fm "$PWD"     # Apple 內建模型對照（需要 sys.txt、contexts.json）
```

---

## 資料來源

- Qwen3.5 小模型發布（0.8B/2B/4B/9B、Apache 2.0、2026-03-02）：[Artificial Analysis](https://artificialanalysis.ai/articles/qwen3-5-small-models)、[NYU Shanghai RITS](https://rits.shanghai.nyu.edu/ai/qwen-3-5-small-models-9b-parameters-that-beat-120b)、[InsiderLLM](https://insiderllm.com/guides/qwen-3-5-small-models-9b-beats-30b/)
- Ollama 模型 tag 與檔案大小：[ollama.com/library/qwen3.5/tags](https://ollama.com/library/qwen3.5/tags)、[ollama.com/library/qwen3.6/tags](https://ollama.com/library/qwen3.6/tags)
- Qwen3.6（27B、35B-A3B）：[llmreference.com](https://www.llmreference.com/model-family/qwen3.6)、[datalearner](https://www.datalearner.com/en/ai-models/pretrained-models/qwen3-6-27b)
- Qwen3.7／3.8 只有 API（第三方資料，未經官方證實）：[apisrouter.com](https://apisrouter.com/qwen3-7-release-date)
- Qwen3-2507（Instruct 只有 non-thinking）：[QwenLM/Qwen3 GitHub](https://github.com/QwenLM/Qwen3)、[Unsloth Qwen3-2507 指南](https://unsloth.ai/docs/models/tutorials/qwen3-how-to-run-and-fine-tune/qwen3-2507)、[IT之家](https://www.ithome.com/0/871/660.htm)
- M4 Pro 24 GB 社群 benchmark（Qwen3.5-9B 4bit：PP 361 / TG 49.7）：[omlx.ai benchmarks](https://omlx.ai/benchmarks?page=817)、[techplained](https://www.techplained.com/qwen-3-5-apple-silicon)
- Ollama 在 Qwen3.5 上 think=false 讓 format 失效的 bug（0.17.6）：[ollama/ollama#14645](https://github.com/ollama/ollama/issues/14645)；`/v1` 端點不會傳 think 參數：[tidyverse/ellmer#940](https://github.com/tidyverse/ellmer/issues/940)；LM Studio 的 Qwen3.5 thinking bug：[lmstudio-bug-tracker#1990](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1990)
- llama.cpp `--reasoning-budget 0`：[llama.cpp commit](https://cdn04132025.gitlink.org.cn/replica/llama.cpp/commit/e121edc4324a640be11b7e567edd39b721b0f8e4)
- LM Studio 免費商用、llmster：[LM Studio blog](https://www.lmstudio.ai/blog/free-for-work)、[Simon Willison](https://simonwillison.net/2025/Jul/8/lm-studio-is-free-for-use-at-work)
- mlx-swift-lm（MLXGuidedGeneration）：[ml-explore/mlx-swift-lm](https://docsearch.algolia.com/mcp/docs/repo/ml-explore/mlx-swift-lm)
- swift-embeddings（MLTensor，支援 BERT 和 XLM-RoBERTa）：[Swift Package Registry](https://swiftpackageregistry.com/jkrukowski/swift-embeddings)
- bge-m3（MIT、8192 tok、dense/sparse/multi-vector）：[huggingface.co/BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3)；bge-reranker-v2-m3（Apache 2.0）：[huggingface.co/BAAI/bge-reranker-v2-m3](https://huggingface.co/BAAI/bge-reranker-v2-m3/tree/refs%2Fpr%2F19)；BGE 系列：[FlagEmbedding (PyPI)](https://pypi.org/project/FlagEmbedding/1.2.2)
- 實測原始資料：`docs/local-llm-eval/qa_*.json`、`docs/local-llm-eval/retrieval_final.txt`
