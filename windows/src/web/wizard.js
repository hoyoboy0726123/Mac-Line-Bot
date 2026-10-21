// 設定精靈：走完七步，LINE 官方帳號就會開始自己回訊息（對照 Mac 版 SetupWizardView.swift）
/* global MLB */
(function () {
  const { S, post, toast } = MLB;
  const TITLES = ['歡迎', '建立官方帳號', '填入金鑰', '店家資訊', '常見問題', '建立連線', '綁定你的 LINE'];

  MLB.components.SetupWizard = {
    data: () => ({ step: 0, secret: '', token: '', accountId: null, verifying: false, error: '', newQ: '', newA: '', store: null, storeTimer: null }),
    computed: {
      st() { return S.state; },
      titles: () => TITLES,
      account() { return this.st.accounts.find((a) => a.id === this.accountId) || null; },
      d() { return S.data && S.state.selectedAccountId === this.accountId ? S.data : null; },
      canContinue() { return this.step !== 2 || (this.secret.trim() && this.token.trim()) || (this.account && this.account.hasCredentials); },
      canSkip() { return this.st.settings.onboardingCompleted || this.st.accounts.length > 0; },
      o() { return this.st.ollama; },
      isWin() { return this.st.platform === 'win32'; },
      status() { return this.account && this.account.webhookStatus; },
    },
    created() {
      MLB.wizard = this; // 截圖測試用
      const s = this.st;
      // 已有帳號時是「新增另一個帳號」，從第 2 步開始
      if (s.accounts.length && s.settings.onboardingCompleted) this.step = Math.max(1, S.wizardFromStep || 1);
      if (S.wizardFromStep === 0 && s.settings.onboardingCompleted) this.step = 0;
      // 上次精靈沒走完：接續同一個帳號，避免重複建立
      if (!s.settings.onboardingCompleted && s.accounts.length) this.accountId = s.accounts[0].id;
    },
    watch: {
      d: { handler(v) { if (v && !this.store) this.store = JSON.parse(JSON.stringify(v.store)); }, immediate: true },
      store: {
        deep: true,
        handler(v, old) {
          if (!old || !v) return;
          clearTimeout(this.storeTimer);
          this.storeTimer = setTimeout(() => post('/api/store', { account: this.accountId, store: v }, { quiet: true }), 500);
        },
      },
    },
    methods: {
      close() { S.showWizard = false; },
      back() { this.step -= 1; this.error = ''; },
      async next() {
        this.error = '';
        if (this.step === 2) {
          this.verifying = true;
          try {
            if (this.accountId && (this.secret || this.token)) {
              await post('/api/accounts/credentials', { id: this.accountId, secret: this.secret, token: this.token }, { quiet: true });
            } else if (!this.accountId) {
              const r = await post('/api/accounts/add', { secret: this.secret, token: this.token }, { quiet: true });
              this.accountId = r.id;
            }
            await post('/api/select-account', { id: this.accountId }, { quiet: true });
            await MLB.refresh();
            this.store = null;
            this.step += 1;
          } catch (e) {
            this.error = e.message;
          }
          this.verifying = false;
          return;
        }
        if (this.step === 4) {
          this.step += 1;
          if (this.st.tunnel.state === 'stopped' || !this.st.tunnel.publicURL) post('/api/tunnel/start', {}, { quiet: true });
          else if (this.accountId) post('/api/webhook/sync', { id: this.accountId }, { quiet: true });
          return;
        }
        if (this.step === TITLES.length - 1) {
          await post('/api/settings', { onboardingCompleted: true });
          S.section = 'overview';
          this.close();
          toast('設定完成 🎉 AI 客服開始上班了！');
          return;
        }
        this.step += 1;
      },
      install() { post('/api/tunnel/install', {}, { success: 'cloudflared 已安裝' }); },
      startTunnel() { post('/api/tunnel/start'); },
      sync() { post('/api/webhook/sync', { id: this.accountId }); },
      pull() { post('/api/ollama/pull', {}); },
      refreshOllama() { post('/api/ollama/refresh', {}, { quiet: true }); },
      addFAQ() {
        post('/api/faq/save', { account: this.accountId, faq: { question: this.newQ, answer: this.newA, keywords: [] } });
        this.newQ = ''; this.newA = '';
      },
      delFAQ(f) { post('/api/faq/delete', { account: this.accountId, id: f.id }); },
    },
    template: `<div class="overlay"><div class="modal wizard">
      <div style="padding:18px 20px 12px;border-bottom:1px solid var(--line)">
        <div class="row"><IconBadge name="store" color="green" :size="30"/><b style="font-size:17px" class="grow">{{ st.productName }} 設定精靈</b>
          <span class="small muted">第 {{ step + 1 }} / {{ titles.length }} 步</span></div>
        <div class="steps"><div class="s" v-for="(t, i) in titles" :key="t"><div class="bar" :class="{ on: i <= step }"></div><div class="t" :class="{ cur: i === step }">{{ t }}</div></div></div>
      </div>
      <div class="m-body" style="padding:20px 24px;flex:1">

        <template v-if="step === 0">
          <div style="font-size:21px;font-weight:700">讓電腦幫你顧好 LINE 客服 👋</div>
          <div v-if="st.cloud" class="muted">{{ st.productName }} 在 Cloudflare 雲端運作，用 Workers AI（Qwen 回答、bge-m3 搜尋知識庫）回覆 LINE 官方帳號的訊息。不用開著電腦，網址固定，管理介面用密碼登入，任何地方都能管理。</div>
          <div v-else class="muted">{{ st.productName }} 用這台電腦上的本機大模型（Ollama 的 Qwen 回答、bge-m3 搜尋知識庫）回覆 LINE 官方帳號的訊息。不用 API key、沒有 token 費用，顧客的對話和你的資料都留在自己的電腦上。</div>
          <div class="card col">
            <CheckRow v-if="st.cloud" :ok="true" text="Cloudflare 雲端運作（不用開著電腦）"/>
            <CheckRow v-else :ok="isWin" :text="isWin ? 'Windows 10 / 11' : '目前不是 Windows（開發測試模式）'"/>
            <CheckRow v-if="!st.cloud" :ok="o.state === 'ready' || o.state === 'missing'" :text="'Ollama：' + o.label">
              <a v-if="o.state === 'notRunning'" href="https://ollama.com/download/windows" target="_blank" class="small">下載 Ollama</a>
              <button class="btn sm" @click="refreshOllama">重新檢查</button></CheckRow>
            <CheckRow :ok="o.ready" :text="'模型：' + st.settings.chatModel + ' + ' + st.settings.embedModel">
              <button v-if="o.state === 'missing'" class="btn sm primary" :disabled="!!o.pulling" @click="pull">下載模型</button></CheckRow>
            <div v-if="o.pulling" class="col" style="gap:3px"><div class="tiny muted">下載 {{ o.pulling.model }}：{{ o.pulling.status }} {{ o.pulling.ratio ? Math.round(o.pulling.ratio * 100) + '%' : '' }}</div>
              <div class="progress"><div :style="{ width: Math.round((o.pulling.ratio || 0) * 100) + '%' }"></div></div></div>
            <CheckRow v-if="!st.cloud" :ok="st.serverRunning" :text="'本機服務 127.0.0.1:' + st.settings.port"/>
          </div>
          <template v-if="!st.cloud">
          <div v-if="!o.ready" class="small warn">本機模型還沒準備好也可以先繼續，期間只會用常見問題回答。第一次下載模型約 7 GB，需要一點時間。</div>
          <div class="small muted">建議：記憶體 16 GB 以上；有 8 GB 以上顯示卡（NVIDIA / AMD）回答會快很多。沒有顯示卡可以到「系統」改用 qwen3.5:4b。長期跑的話放在一台不關機的電腦最好 💡</div>
          </template>
        </template>

        <template v-if="step === 1">
          <div style="font-size:21px;font-weight:700">準備 LINE 官方帳號</div>
          <div class="row top"><span class="num">1</span><div>到 LINE Official Account Manager 建立官方帳號（已經有就跳過）<br><a href="https://manager.line.biz/" target="_blank" class="small">https://manager.line.biz/</a></div></div>
          <div class="row top"><span class="num">2</span><div>在官方帳號的「設定 → Messaging API」按「啟用 Messaging API」</div></div>
          <div class="row top"><span class="num">3</span><div>到 LINE Developers 找到這個 Channel<br><a href="https://developers.line.biz/console/" target="_blank" class="small">https://developers.line.biz/console/</a></div></div>
          <div class="row top"><span class="num">4</span><div>在「Basic settings」複製 Channel secret</div></div>
          <div class="row top"><span class="num">5</span><div>在「Messaging API」最下面發行 Channel access token（long-lived）</div></div>
          <div class="row top"><span class="num">6</span><div>在官方帳號的「回應設定」關閉「自動回應訊息」，開啟「Webhook」</div></div>
        </template>

        <template v-if="step === 2">
          <div style="font-size:21px;font-weight:700">填入 Messaging API 金鑰</div>
          <div class="small muted">金鑰只存在這台電腦（Windows 會用系統加密保護）。</div>
          <label class="field"><span>Channel secret</span><input type="password" v-model="secret" :placeholder="account && account.hasCredentials ? '已設定（要更換才需要重新輸入）' : ''"></label>
          <label class="field"><span>Channel access token</span><input type="password" v-model="token" :placeholder="account && account.hasCredentials ? '已設定（要更換才需要重新輸入）' : ''"></label>
          <div v-if="verifying" class="small muted">驗證中…</div>
          <div v-if="error" class="err small">{{ error }}</div>
          <div v-if="account && account.basicId" class="row"><Avatar :name="account.displayName" :url="account.pictureURL" :size="36"/>
            <div><b>{{ account.displayName }}</b><div class="small muted">{{ account.basicId }}</div></div><Icon name="circle-check" style="color:var(--green)"/></div>
        </template>

        <template v-if="step === 3">
          <div style="font-size:21px;font-weight:700">店家資訊</div>
          <div class="small muted">AI 回答時一定會參考這些資料，之後都可以在「店家資訊」修改。</div>
          <div class="form-grid" v-if="store">
            <span class="lbl">店名</span><input type="text" v-model="store.name">
            <span class="lbl">地址</span><input type="text" v-model="store.address">
            <span class="lbl">電話</span><input type="text" v-model="store.phone">
            <span class="lbl">營業時間</span><textarea v-model="store.businessHours" rows="3"></textarea>
            <span class="lbl">一句話介紹</span><textarea v-model="store.intro" rows="2"></textarea>
          </div>
          <div v-else class="muted">載入中…</div>
        </template>

        <template v-if="step === 4">
          <div style="font-size:21px;font-weight:700">常見問題</div>
          <div class="small muted">先放幾題最常被問的，常見問題會直接回標準答案；之後 AI 答不出來的問題會自動整理成待補清單。</div>
          <div v-for="f in (d ? d.faqs.slice(0, 20) : [])" :key="f.id" class="row top">
            <div class="grow"><div class="bold small">{{ f.question }}</div><div class="tiny muted clamp2">{{ f.answer }}</div></div>
            <button class="btn plain danger" @click="delFAQ(f)" title="移除"><Icon name="x"/></button>
          </div>
          <div v-if="d && d.faqs.length > 20" class="tiny muted">還有 {{ d.faqs.length - 20 }} 題，可以在「知識庫」查看</div>
          <hr style="border:0;border-top:1px solid var(--line);width:100%">
          <input type="text" v-model="newQ" placeholder="問題，例如：可以帶寵物嗎">
          <textarea v-model="newA" rows="2" placeholder="答案"></textarea>
          <div><button class="btn" :disabled="!newQ || !newA" @click="addFAQ">加入</button></div>
        </template>

        <template v-if="step === 5">
          <div style="font-size:21px;font-weight:700">建立連線</div>
          <div class="small muted">{{ st.productName }} 會用 Cloudflare Tunnel 產生一個公開網址，並自動設定到 LINE 的 webhook，不用開 port、不用固定 IP。</div>
          <div class="card col">
            <CheckRow v-if="!st.cloud" :ok="!!st.tunnel.binary" text="cloudflared"><span class="spacer"></span>
              <button v-if="!st.tunnel.binary" class="btn sm" :disabled="st.installing" @click="install">{{ st.installing ? '下載中…' : '一鍵安裝' }}</button></CheckRow>
            <CheckRow v-if="!st.cloud" :ok="st.tunnel.state === 'running'" :text="'Tunnel：' + st.tunnel.label"/>
            <CheckRow :ok="!!st.tunnel.publicURL" :text="'公開網址：' + (st.tunnel.publicURL || '等待中')"/>
            <CheckRow :ok="!!(status && status.synced)" :text="'LINE Webhook：' + (status && status.synced ? '已同步並測試通過' : (status && status.message) || '等待中')"/>
          </div>
          <div class="row"><button v-if="!st.cloud" class="btn" :disabled="!st.tunnel.binary" @click="startTunnel">{{ st.tunnel.state === 'stopped' ? '開始連線' : '重新連線' }}</button>
            <button v-if="st.tunnel.publicURL" class="btn" @click="sync">重新設定 Webhook</button>
            <span v-if="st.tunnel.state === 'starting'" class="small muted">連線中…</span></div>
          <div v-if="st.tunnel.error" class="small err">{{ st.tunnel.error }}</div>
          <div v-if="st.cloud" class="small muted">雲端版的網址是固定的，設定一次就好。</div>
          <div v-else class="small muted">Quick Tunnel 每次重啟網址會變，{{ st.productName }} 會自動幫你更新 LINE 後台。想要固定網址，之後可以在「LINE 連線」改用自訂網域。</div>
        </template>

        <template v-if="step === 6">
          <div style="font-size:21px;font-weight:700">最後一步：綁定你的 LINE</div>
          <div class="muted">用你自己的 LINE 加官方帳號為好友，然後傳送：</div>
          <div v-if="account"><span class="bind-code">綁定 {{ account.bindCode }}</span></div>
          <div v-if="account && !account.ownerUserIds.length" class="muted">⏳ 等待綁定中…</div>
          <div v-else-if="account" class="ok-text bold row"><Icon name="circle-check"/>綁定成功！</div>
          <div class="card col small" style="gap:4px">
            <b>綁定後你會在 LINE 收到：</b>
            <div>・顧客要找專人、問到不該回的問題時的通知（傳「#代碼 內容」直接回覆）</div>
            <div>・預約單，按一下接受或婉拒，顧客馬上收到確認</div>
            <div>・每日摘要、待回覆提醒、斷線通知</div>
          </div>
          <div class="small muted">也可以先跳過，之後在「LINE 連線」頁面綁定。</div>
        </template>
      </div>
      <div class="m-foot">
        <button v-if="canSkip" class="btn" @click="close">稍後再說</button><span class="spacer"></span>
        <button v-if="step > 0" class="btn" @click="back">上一步</button>
        <button class="btn green" :disabled="!canContinue || verifying" @click="next">{{ step === titles.length - 1 ? '完成 🎉' : verifying ? '驗證中…' : '下一步' }}</button>
      </div>
    </div></div>`,
  };
})();
