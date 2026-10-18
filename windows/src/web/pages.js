// 各頁面（對照 Mac 版 Views/*.swift）
/* global Vue, MLB */
(function () {
  const { S, post, get, toast, copy, shortDisplay, timeDisplay, dayLabel, autosave, onChange } = MLB;
  const P = MLB.pages;
  const st = () => S.state;
  const d = () => S.data;
  const acct = () => (S.state ? S.state.accounts.find((a) => a.id === S.state.selectedAccountId) : null);
  const go = (s) => { S.section = s; S.menuOpen = false; };
  const srcLabel = (s) => (S.state && S.state.sourceLabels[s]) || s;

  // MARK: - 總覽

  P.overview = {
    data: () => ({ warningsOnly: false, checking: false }),
    computed: {
      st, d, acct,
      health() { return st().health; },
      hColor() { return { ok: 'green', warning: 'orange', error: 'red' }[this.health.level]; },
      nodes() {
        const s = st();
        const synced = !!(this.acct && this.acct.webhookStatus && this.acct.webhookStatus.synced);
        return [
          { icon: 'monitor', title: '本機服務', sub: `127.0.0.1:${s.settings.port}`, ok: s.serverRunning },
          { icon: 'network', title: 'Cloudflare Tunnel', sub: s.tunnel.label, ok: s.tunnel.state === 'running' },
          { icon: 'message-circle', title: 'LINE Webhook', sub: synced ? '已同步' : '未同步', ok: synced },
          { icon: 'cpu', title: 'Qwen 本機模型', sub: s.ollama.ready ? s.settings.chatModel : s.ollama.label, ok: s.ollama.ready },
        ];
      },
      logs() { return st().logs.filter((e) => !this.warningsOnly || e.level !== 'info').slice(0, 14); },
      t() { return d() ? d().today : {}; },
    },
    methods: {
      shortDisplay, timeDisplay, srcLabel,
      async check() { this.checking = true; try { await post('/api/webhook/check', { id: this.acct.id }); } finally { this.checking = false; } },
      openChat(c) { S.focusedConversation = c.id; go('conversations'); },
      start: () => post('/api/tunnel/start'), stop: () => post('/api/tunnel/stop'), copy,
    },
    template: `<div class="page">
      <PageHead section="overview"/>
      <div class="card" style="padding:20px">
        <div class="row top">
          <span class="avatar" :style="{ width: '46px', height: '46px', background: 'var(--' + hColor + ')' }"><Icon :name="health.level === 'ok' ? 'check' : 'triangle-alert'" :size="22"/></span>
          <div class="grow">
            <div style="font-size:18px;font-weight:700">{{ health.title }}</div>
            <div class="muted">{{ health.detail }}</div>
            <div class="small muted row" style="gap:5px;margin-top:3px"><Icon name="inbox" :size="13"/>上次收到顧客訊息：{{ st.lastEventAt ? shortDisplay(st.lastEventAt) : '尚未收到' }}</div>
          </div>
          <button v-if="st.tunnel.state === 'stopped'" class="btn primary" @click="start"><Icon name="play"/>啟動</button>
          <template v-else>
            <button class="btn" @click="start"><Icon name="refresh-cw"/>重啟 Tunnel</button>
            <button class="btn" @click="stop"><Icon name="square"/>停止</button>
          </template>
        </div>
        <div class="pipeline">
          <template v-for="(n, i) in nodes" :key="n.title">
            <div class="node">
              <div class="circle" :style="{ background: n.ok ? 'rgba(5,199,84,.15)' : 'rgba(255,149,0,.15)', color: n.ok ? 'var(--green)' : 'var(--orange)' }">
                <Icon :name="n.icon" :size="18"/><Dot :color="n.ok ? 'green' : 'orange'"/>
              </div>
              <div class="small bold">{{ n.title }}</div><div class="tiny muted ellipsis" style="max-width:130px">{{ n.sub }}</div>
            </div>
            <div v-if="i < nodes.length - 1" class="link" :style="{ background: n.ok && nodes[i + 1].ok ? 'rgba(5,199,84,.5)' : 'var(--line)' }"></div>
          </template>
        </div>
      </div>

      <div class="card tight row" v-if="acct">
        <IconBadge name="globe" color="indigo" :size="32"/>
        <div class="grow">
          <div class="small muted">公開 Webhook 網址</div>
          <div class="row" style="gap:6px"><span class="mono ellipsis">{{ acct.webhookURL || 'Tunnel 尚未建立' }}</span>
            <button v-if="acct.webhookURL" class="btn plain" title="複製" @click="copy(acct.webhookURL)"><Icon name="copy"/></button></div>
        </div>
        <span v-if="acct.webhookStatus && acct.webhookStatus.lastCheck" class="tag" :style="{ background: acct.webhookStatus.reachable ? 'rgba(5,199,84,.12)' : 'rgba(255,59,48,.12)' }">
          <Dot :color="acct.webhookStatus.reachable ? 'green' : 'red'" sm/>&nbsp;{{ acct.webhookStatus.reachable ? '外部可連線' : '外部無法連線' }}・{{ shortDisplay(acct.webhookStatus.lastCheck) }}</span>
        <button class="btn" :disabled="!acct.webhookURL || checking" @click="check">{{ checking ? '檢查中…' : '檢查' }}</button>
      </div>

      <h3 style="margin:6px 0 0">今日數據</h3>
      <div class="grid3">
        <StatTile icon="inbox" color="blue" :value="t.received || 0" label="收到訊息"/>
        <StatTile icon="send" color="green" :value="t.replied || 0" label="已回覆"/>
        <StatTile icon="list" color="teal" :value="t.faq || 0" label="FAQ 直接回答"/>
        <StatTile icon="sparkles" color="purple" :value="t.ai || 0" label="AI 生成回覆"/>
        <StatTile icon="user" color="orange" :value="t.handoff || 0" label="轉人工"/>
        <StatTile icon="arrow-left-right" color="gray" :value="t.urlChanges || 0" label="網址變動"/>
      </div>

      <div class="grid2">
        <div class="card">
          <div class="row" style="margin-bottom:8px"><IconBadge name="clock" color="blue"/><b>最近處理</b></div>
          <Empty v-if="!d || !d.recent.length" icon="messages-square" title="還沒有對話" message="顧客傳訊息給官方帳號後會出現在這裡"/>
          <div v-for="c in (d ? d.recent : [])" :key="c.id" class="row top" style="padding:6px 0;cursor:pointer" @click="openChat(c)">
            <Avatar :name="c.displayName" :url="c.pictureURL" :size="26"/>
            <div class="grow">
              <div class="row" style="gap:6px"><b class="small">{{ c.displayName }}</b>
                <Tag v-if="c.mode === 'human'" text="轉人工" color="orange"/>
                <Tag v-else-if="c.lastMessage && c.lastMessage.source && c.lastMessage.source !== 'owner'" :text="srcLabel(c.lastMessage.source)"/></div>
              <div class="small muted ellipsis">{{ c.lastMessage ? c.lastMessage.text : '' }}</div>
            </div>
            <span class="tiny faint">{{ c.lastMessage ? shortDisplay(c.lastMessage.date) : '' }}</span>
          </div>
        </div>
        <div class="card">
          <div class="row" style="margin-bottom:8px"><IconBadge name="file-text" color="gray"/><b>系統日誌</b><span class="spacer"></span><Toggle v-model="warningsOnly" label="只看警告" sm class="small"/></div>
          <div v-for="e in logs" :key="e.id" class="row top tiny" style="gap:6px;padding:2px 0">
            <Dot :color="e.level === 'info' ? 'green' : e.level === 'warning' ? 'orange' : 'red'" sm style="margin-top:5px"/>
            <span class="faint mono">{{ timeDisplay(e.date) }}</span><span class="clamp2" style="user-select:text">{{ e.message }}</span>
          </div>
        </div>
      </div>
    </div>`,
  };

  // MARK: - 客服對話

  P.conversations = {
    data: () => ({ filter: 'all', search: '', list: [], conv: null, draft: '', sending: false }),
    computed: { st, focused() { return S.focusedConversation; } },
    watch: {
      filter() { this.load(); }, search() { this.load(); },
      focused() { this.loadConv(true); },
    },
    mounted() {
      this.load(); this.loadConv(true);
      this.off = onChange(() => { this.load(); this.loadConv(false); });
    },
    unmounted() { this.off && this.off(); },
    methods: {
      shortDisplay, dayLabel, srcLabel,
      async load() {
        const q = new URLSearchParams({ account: MLB.accountId(), q: this.search, filter: this.filter === 'human' ? 'human' : '' });
        try { this.list = await get('/api/conversations?' + q); } catch { /* 略過 */ }
      },
      async loadConv(scroll) {
        if (!this.focused) { this.conv = null; return; }
        try {
          const c = await get(`/api/conversation?account=${encodeURIComponent(MLB.accountId())}&uid=${encodeURIComponent(this.focused)}`);
          const grew = !this.conv || this.conv.id !== c.id || c.messages.length !== this.conv.messages.length;
          this.conv = c;
          if (c.unread > 0) post('/api/conversation/read', { uid: c.id }, { quiet: true });
          if (scroll || grew) this.$nextTick(() => { const b = this.$refs.body; if (b) b.scrollTop = b.scrollHeight; });
        } catch { this.conv = null; }
      },
      open(c) { S.focusedConversation = c.id; },
      back() { S.focusedConversation = null; },
      newDay(i) { const m = this.conv.messages; return i === 0 || new Date(m[i].date).toDateString() !== new Date(m[i - 1].date).toDateString(); },
      async send() {
        const text = this.draft.trim();
        if (!text) return;
        this.sending = true;
        try { await post('/api/conversation/send', { uid: this.conv.id, text }); this.draft = ''; } catch { /* 已顯示 */ }
        this.sending = false;
      },
      key(e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); } },
      resume() { post('/api/conversation/resume', { uid: this.conv.id }); },
      takeover() { post('/api/conversation/takeover', { uid: this.conv.id }); },
    },
    template: `<div class="chat-wrap" :class="{ 'has-chat': !!conv }">
      <div class="chat-list">
        <div style="padding:14px" class="col">
          <PageHead section="conversations"/>
          <Seg v-model="filter" :options="[{ value: 'all', label: '全部' }, { value: 'human', label: '等待真人' }]"/>
          <input type="text" v-model="search" placeholder="搜尋顧客或訊息">
        </div>
        <div class="items">
          <Empty v-if="!list.length" icon="messages-square" title="還沒有對話" message="顧客傳訊息給官方帳號後會出現在這裡"/>
          <div v-for="c in list" :key="c.id" class="chat-row" :class="{ active: c.id === focused }" @click="open(c)">
            <Avatar :name="c.displayName" :url="c.pictureURL" :size="36"/>
            <div class="grow">
              <div class="row" style="gap:6px"><b class="ellipsis small">{{ c.displayName }}</b>
                <Tag v-if="c.mode === 'human'" text="轉人工" color="orange"/><Tag v-if="c.reserving" text="預約中" color="red"/>
                <span class="spacer"></span><span class="tiny faint">{{ c.lastMessage ? shortDisplay(c.lastMessage.date) : '' }}</span></div>
              <div class="row"><span class="small muted ellipsis grow">{{ c.lastMessage ? c.lastMessage.text : '' }}</span>
                <span v-if="c.unread" class="tag" style="background:var(--green);color:#fff">{{ c.unread }}</span></div>
            </div>
          </div>
        </div>
      </div>
      <div class="chat-pane">
        <template v-if="conv">
          <div class="chat-head">
            <button class="btn plain mobile-only" @click="back" title="返回">‹</button>
            <Avatar :name="conv.displayName" :url="conv.pictureURL" :size="34"/>
            <div class="grow"><b>{{ conv.displayName }}</b>
              <div class="small" :class="conv.mode === 'human' ? 'warn' : 'muted'">{{ conv.mode === 'human' ? '真人接手中・代碼 #' + conv.handoffCode : 'AI 自動回覆中' }}</div></div>
            <button v-if="conv.mode === 'human'" class="btn" @click="resume"><Icon name="sparkles"/>交還 AI</button>
            <button v-else class="btn" @click="takeover"><Icon name="user"/>我來接手</button>
          </div>
          <div class="chat-body" ref="body">
            <template v-for="(m, i) in conv.messages" :key="m.id">
              <div v-if="newDay(i)" class="sys-pill">{{ dayLabel(m.date) }}</div>
              <div v-if="m.role === 'system'" class="sys-pill">{{ m.text }}</div>
              <div v-else-if="m.role === 'customer'" class="msg theirs">
                <Avatar :name="conv.displayName" :url="conv.pictureURL" :size="30"/>
                <div class="bubble">{{ m.text }}</div>
                <div class="meta"><span>{{ shortDisplay(m.date) }}</span></div>
              </div>
              <div v-else class="msg mine">
                <div class="meta"><span v-if="m.source">{{ srcLabel(m.source) }}{{ m.card ? '・卡片' : '' }}{{ m.latency != null ? ' ' + m.latency.toFixed(1) + 's' : '' }}</span><span>{{ shortDisplay(m.date) }}</span></div>
                <div class="bubble">{{ m.text }}</div>
              </div>
            </template>
          </div>
          <div class="chat-input">
            <textarea v-model="draft" rows="1" placeholder="輸入訊息（以店家身分傳送，Enter 送出、Shift+Enter 換行）" @keydown="key"></textarea>
            <button class="btn green" :disabled="!draft.trim() || sending" @click="send"><Icon name="send"/></button>
          </div>
        </template>
        <Empty v-else icon="message-square-text" title="選一個對話" message="可以直接在這裡回覆顧客，回覆後 AI 會自動閃開" style="margin:auto"/>
      </div>
    </div>`,
  };

  // MARK: - 預約

  P.reservations = {
    data: () => ({ filter: 'pending', busy: null }),
    computed: {
      d, labels() { return st().reservationLabels; },
      items() { return d() ? d().reservations.filter((r) => this.filter === 'all' || r.status === this.filter) : []; },
      enabled: {
        get() { return d() ? d().rules.reservationEnabled : false; },
        set(v) { post('/api/rules', { rules: { reservationEnabled: v } }); },
      },
    },
    methods: {
      shortDisplay,
      color: (s) => ({ pending: 'orange', accepted: 'green', declined: 'red', cancelled: 'gray' }[s]),
      async decide(r, accept) {
        this.busy = r.id;
        try { const x = await post('/api/reservation/decide', { rid: r.id, accept }); toast(x.message); } finally { this.busy = null; }
      },
      cancel(r) { post('/api/reservation/cancel', { rid: r.id }); },
      remove(r) { if (confirm('確定刪除這筆預約？')) post('/api/reservation/delete', { rid: r.id }); },
      chat(r) { S.focusedConversation = r.userId; go('conversations'); },
    },
    template: `<div class="page">
      <PageHead section="reservations"/>
      <div class="row wrap">
        <Seg v-model="filter" :options="[{ value: 'pending', label: '待確認' }, { value: 'accepted', label: '已接受' }, { value: 'declined', label: '已婉拒' }, { value: 'all', label: '全部' }]"/>
        <span class="spacer"></span><Toggle v-model="enabled" label="啟用預約收單"/>
      </div>
      <div class="card" v-if="!items.length"><Empty icon="calendar-clock" title="沒有預約" message="顧客說「我想預約」時，AI 會問完日期、時間、人數，整理成一筆放在這裡"/></div>
      <div class="card tight" v-for="r in items" :key="r.id">
        <div class="row top wrap">
          <div style="width:110px;text-align:center;background:rgba(255,59,48,.08);border-radius:10px;padding:6px 0">
            <div class="bold">{{ r.date }}</div><div style="font-size:18px;font-weight:700">{{ r.time }}</div>
          </div>
          <div class="grow">
            <div class="row" style="gap:6px"><b>{{ r.customerName }}</b><Tag :text="labels[r.status]" :color="color(r.status)"/><span class="small faint">#{{ r.code }}</span></div>
            <div>👥 {{ r.people }} 位<span v-if="r.contactName">・🙋 {{ r.contactName }}</span><span v-if="r.phone">・📞 {{ r.phone }}</span></div>
            <div class="small muted">建立於 {{ shortDisplay(r.createdAt) }}<span v-if="r.decidedAt">・處理於 {{ shortDisplay(r.decidedAt) }}</span></div>
          </div>
          <div class="row">
            <template v-if="r.status === 'pending'">
              <button class="btn" :disabled="busy === r.id" @click="decide(r, false)">婉拒</button>
              <button class="btn green" :disabled="busy === r.id" @click="decide(r, true)">接受</button>
            </template>
            <button v-else class="btn plain" title="查看對話" @click="chat(r)"><Icon name="message-circle"/></button>
            <button v-if="r.status !== 'cancelled'" class="btn plain small" title="標記為已取消" @click="cancel(r)">取消</button>
            <button class="btn plain danger" title="刪除" @click="remove(r)"><Icon name="trash-2"/></button>
          </div>
        </div>
      </div>
    </div>`,
  };

  // MARK: - 使用量

  P.usage = {
    data: () => ({ quota: null, quotaError: null }),
    computed: {
      d,
      days() { return d() ? d().days : []; },
      total() {
        const t = { received: 0, replied: 0, faq: 0, ai: 0, handoff: 0, reservations: 0, unanswered: 0, aiMilliseconds: 0 };
        for (const s of this.days) for (const k of Object.keys(t)) t[k] += s[k] || 0;
        return t;
      },
      rate() { const a = this.total.faq + this.total.ai; const all = a + this.total.handoff + this.total.unanswered; return all ? Math.round((a / all) * 100) + '%' : '—'; },
      latency() { return this.total.ai ? (this.total.aiMilliseconds / this.total.ai / 1000).toFixed(1) + 's' : '0.0s'; },
      max() { return Math.max(1, ...this.days.map((s) => s.faq + s.ai + s.handoff)); },
    },
    mounted() { this.loadQuota(); },
    methods: {
      label: (k) => k.slice(5).replace('-', '/'),
      async loadQuota() {
        try { this.quota = await get('/api/quota?account=' + encodeURIComponent(MLB.accountId())); this.quotaError = null; } catch (e) { this.quotaError = e.message; }
      },
    },
    template: `<div class="page">
      <PageHead section="usage"/>
      <div class="grid3">
        <StatTile icon="inbox" color="blue" :value="total.received" label="收到訊息"/>
        <StatTile icon="send" color="green" :value="total.replied" label="已回覆"/>
        <StatTile icon="calendar" color="red" :value="total.reservations" label="預約單"/>
        <StatTile icon="zap" color="teal" :value="rate" label="自動處理率"/>
        <StatTile icon="clock" color="purple" :value="latency" label="AI 平均回覆時間"/>
        <StatTile icon="circle-help" color="orange" :value="total.unanswered" label="答不出來"/>
      </div>
      <div class="card">
        <div class="row"><h3 class="grow" style="margin:0">每日回覆來源</h3>
          <div class="legend"><span><Dot color="teal"/>FAQ</span><span><Dot color="purple"/>AI</span><span><Dot color="orange"/>轉人工</span></div></div>
        <div class="bars">
          <div class="day" v-for="s in days" :key="s.dateKey" :title="label(s.dateKey) + '：FAQ ' + s.faq + '、AI ' + s.ai + '、轉人工 ' + s.handoff">
            <div class="stack" :style="{ height: ((s.faq + s.ai + s.handoff) / max * 170) + 'px' }">
              <div :style="{ flex: s.faq, background: 'var(--teal)' }"></div>
              <div :style="{ flex: s.ai, background: 'var(--purple)' }"></div>
              <div :style="{ flex: s.handoff, background: 'var(--orange)' }"></div>
            </div>
            <span class="lbl">{{ label(s.dateKey) }}</span>
          </div>
        </div>
      </div>
      <div class="card col">
        <div class="row"><h3 class="grow" style="margin:0">LINE 訊息額度</h3><button class="btn" @click="loadQuota">重新整理</button></div>
        <div class="small muted">回覆（reply）不計費；推播通知、預約確認、真人回覆使用 push，會算進官方帳號的每月額度。</div>
        <div v-if="quotaError" class="small err">{{ quotaError }}</div>
        <template v-else-if="quota">
          <div>本月已用 {{ quota.consumption }} 則{{ quota.quota.value != null ? ' / 上限 ' + quota.quota.value + ' 則' : '（無上限）' }}</div>
          <div class="progress" v-if="quota.quota.value"><div :style="{ width: Math.min(100, quota.consumption / quota.quota.value * 100) + '%', background: quota.consumption / quota.quota.value > 0.8 ? 'var(--red)' : 'var(--green)' }"></div></div>
        </template>
        <div v-else class="small muted">讀取中…</div>
      </div>
    </div>`,
  };

  // MARK: - 知識庫

  const FAQEditor = {
    props: { faq: Object },
    emits: ['close'],
    data() { return { f: JSON.parse(JSON.stringify(this.faq)) }; },
    methods: {
      async save() { await post('/api/faq/save', { faq: this.f }, { success: '已儲存' }); this.$emit('close'); },
    },
    template: `<Modal :title="faq.id ? '編輯常見問題' : '新增常見問題'" @close="$emit('close')">
      <label class="field"><span>問題</span><input type="text" v-model="f.question"></label>
      <label class="field"><span>關鍵字</span><KeywordField v-model="f.keywords"/></label>
      <div class="small muted">關鍵字用「+」代表要同時出現，例如「P5+低溫」只會在顧客同時提到 P5 和低溫時命中</div>
      <Toggle v-model="f.isEnabled" label="啟用"/>
      <label class="field"><span>標準答案</span><textarea v-model="f.answer" rows="7"></textarea></label>
      <template #foot><button class="btn" @click="$emit('close')">取消</button><button class="btn primary" :disabled="!f.question || !f.answer" @click="save">儲存</button></template>
    </Modal>`,
  };

  const DocEditor = {
    props: { doc: Object },
    emits: ['close'],
    data() { return { x: JSON.parse(JSON.stringify(this.doc)) }; },
    methods: { async save() { await post('/api/doc/save', { doc: this.x }, { success: '已儲存' }); this.$emit('close'); } },
    template: `<Modal title="文件資料" size="lg" @close="$emit('close')">
      <input type="text" v-model="x.title" placeholder="標題（例如：菜單、價目表）">
      <textarea v-model="x.content" rows="16"></textarea>
      <template #foot><span class="small muted spacer">{{ [...(x.content || '')].length }} 字</span><button class="btn" @click="$emit('close')">取消</button>
        <button class="btn primary" :disabled="!x.content" @click="save">儲存</button></template>
    </Modal>`,
  };

  const TryAnswer = {
    data: () => ({ q: '', result: null, running: false }),
    methods: {
      srcLabel,
      async run() {
        if (!this.q || this.running) return;
        this.running = true;
        try { this.result = await post('/api/preview', { text: this.q }); } catch { /* 已顯示 */ }
        this.running = false;
      },
    },
    template: `<div class="card col">
      <b>模擬顧客提問</b>
      <div class="row"><input type="text" v-model="q" placeholder="例如：請問你們的營業時間？" @keydown.enter="run">
        <button class="btn primary" :disabled="!q || running" @click="run">{{ running ? '思考中…' : '試答' }}</button></div>
      <template v-if="result">
        <div class="row"><Tag :text="srcLabel(result.source)" color="purple"/><span v-if="result.latency != null" class="small muted">{{ result.latency.toFixed(1) }}s</span></div>
        <div class="pre" style="padding:12px;border-radius:14px;background:color-mix(in srgb, var(--bubble) 60%, transparent);user-select:text">{{ result.text }}</div>
      </template>
    </div>`,
  };

  P.knowledge = {
    components: { FAQEditor, DocEditor, TryAnswer },
    data: () => ({ tab: 'faq', editingFAQ: null, editingDoc: null, filter: '' }),
    computed: {
      d,
      faqs() {
        if (!d()) return [];
        const q = this.filter.trim().toLowerCase();
        return q ? d().faqs.filter((f) => (f.question + f.answer + (f.keywords || []).join(' ')).toLowerCase().includes(q)) : d().faqs;
      },
      pending() { return d() ? [...d().pending].sort((a, b) => b.count - a.count) : []; },
    },
    methods: {
      shortDisplay,
      newFAQ(q = '') { this.editingFAQ = { question: q, answer: '', keywords: [], isEnabled: true }; },
      delFAQ(f) { if (confirm(`刪除「${f.question}」？`)) post('/api/faq/delete', { id: f.id }); },
      delDoc(x) { if (confirm(`刪除「${x.title || '未命名'}」？`)) post('/api/doc/delete', { id: x.id }); },
      ignore(p) { post('/api/pending/delete', { id: p.id }); },
      pick() { this.$refs.file.click(); },
      async importFiles(e) {
        const files = await Promise.all([...e.target.files].map((f) => f.text().then((text) => ({ name: f.name, text }))));
        e.target.value = '';
        if (!files.length) return;
        const r = await post('/api/import', { files });
        toast(`匯入完成：FAQ ${r.faqs} 筆、文件 ${r.docs} 份`);
      },
      count: (s) => [...(s || '')].length,
      kw: (f) => (f.keywords || []).filter((k) => !k.startsWith('#')).slice(0, 12).join('、') + ((f.keywords || []).length > 12 ? '…' : ''),
    },
    template: `<div class="page">
      <PageHead section="knowledge"/>
      <Seg v-model="tab" v-if="d" :options="[{ value: 'faq', label: '常見問題 ' + d.faqs.length }, { value: 'docs', label: '文件資料 ' + d.docs.length }, { value: 'pending', label: '待補清單 ' + d.pending.length }, { value: 'try', label: '試答' }]"/>
      <input type="file" ref="file" multiple accept=".csv,.txt,.md,text/plain,text/csv" style="display:none" @change="importFiles">

      <template v-if="d && tab === 'faq'">
        <div class="row wrap"><span class="small muted grow">顧客問題跟這裡的問題或關鍵字相符，就直接回標準答案，不經過 AI。</span>
          <input type="text" v-model="filter" placeholder="搜尋" style="width:160px">
          <button class="btn" @click="pick"><Icon name="upload"/>匯入 CSV</button>
          <button class="btn primary" @click="newFAQ()"><Icon name="plus"/>新增</button></div>
        <div class="card" v-if="!d.faqs.length"><Empty icon="list" title="還沒有常見問題" message="新增營業時間、價格、地址等最常被問的問題"/></div>
        <div class="card tight" v-for="f in faqs.slice(0, 300)" :key="f.id">
          <div class="row top">
            <div class="grow col" style="gap:4px">
              <div class="row wrap" style="gap:6px"><b>{{ f.question }}</b><Tag v-if="f.isEnabled === false" text="停用"/>
                <Tag v-if="f.hitCount" :text="'命中 ' + f.hitCount" color="teal"/><Tag v-if="(f.keywords || []).includes('#MIL自動產生')" text="自動產生" color="indigo"/></div>
              <div class="small muted clamp3">{{ f.answer }}</div>
              <div v-if="kw(f)" class="tiny faint">關鍵字：{{ kw(f) }}</div>
            </div>
            <button class="btn sm" @click="editingFAQ = f">編輯</button>
            <button class="btn plain danger" title="刪除" @click="delFAQ(f)"><Icon name="trash-2"/></button>
          </div>
        </div>
        <div v-if="faqs.length > 300" class="small muted">只顯示前 300 筆，請用搜尋找其他題目</div>
      </template>

      <template v-if="d && tab === 'docs'">
        <div class="row wrap"><span class="small muted grow">菜單、價目表、服務說明、注意事項…貼進來，AI 會挑相關段落來回答。</span>
          <button class="btn" @click="pick"><Icon name="upload"/>匯入文字檔</button>
          <button class="btn primary" @click="editingDoc = { title: '', content: '' }"><Icon name="plus"/>新增</button></div>
        <div class="card" v-if="!d.docs.length"><Empty icon="file-text" title="還沒有文件" message="把菜單、價目表或服務說明貼進來"/></div>
        <div class="card tight" v-for="x in d.docs" :key="x.id">
          <div class="row top">
            <div class="grow col" style="gap:4px"><b>{{ x.title || '未命名' }}</b><div class="small muted clamp3">{{ x.content }}</div>
              <div class="tiny faint">{{ count(x.content) }} 字・更新於 {{ shortDisplay(x.updatedAt) }}</div></div>
            <button class="btn sm" @click="editingDoc = x">編輯</button>
            <button class="btn plain danger" title="刪除" @click="delDoc(x)"><Icon name="trash-2"/></button>
          </div>
        </div>
      </template>

      <template v-if="d && tab === 'pending'">
        <div class="small muted">AI 答不出來的問題會自動整理在這裡，一鍵補成 FAQ，越用越準。</div>
        <div class="card" v-if="!pending.length"><Empty icon="circle-check" title="沒有待補問題 🎉" message="目前的知識庫都答得出來"/></div>
        <div class="card tight row" v-for="p in pending" :key="p.id">
          <div class="grow"><div class="bold">{{ p.question }}</div>
            <div class="small muted">被問 {{ p.count }} 次・最近 {{ shortDisplay(p.lastAskedAt) }}<span v-if="p.askedBy">・{{ p.askedBy }}</span></div></div>
          <button class="btn" @click="ignore(p)">忽略</button>
          <button class="btn primary" @click="newFAQ(p.question)"><Icon name="plus"/>補成 FAQ</button>
        </div>
      </template>

      <TryAnswer v-if="tab === 'try'"/>
      <FAQEditor v-if="editingFAQ" :faq="editingFAQ" @close="editingFAQ = null"/>
      <DocEditor v-if="editingDoc" :doc="editingDoc" @close="editingDoc = null"/>
    </div>`,
  };

  // MARK: - 店家資訊

  P.store = {
    setup() {
      const form = autosave(() => (S.data ? { key: S.state.selectedAccountId, value: S.data.store } : null),
        (v) => post('/api/store', { store: v }, { quiet: true }));
      return { form };
    },
    template: `<div class="page">
      <PageHead section="store"/>
      <div class="card" v-if="form">
        <div class="form-grid">
          <span class="lbl">店名</span><input type="text" v-model="form.name">
          <span class="lbl">一句話介紹</span><textarea v-model="form.intro" rows="2"></textarea>
          <span class="lbl">地址</span><input type="text" v-model="form.address">
          <span class="lbl">電話</span><input type="text" v-model="form.phone">
          <span class="lbl">網站 / 社群</span><input type="text" v-model="form.website">
          <span class="lbl">付款方式</span><input type="text" v-model="form.payment">
          <span class="lbl">停車資訊</span><input type="text" v-model="form.parking">
        </div>
      </div>
      <div class="card col" v-if="form"><b>營業時間</b><textarea v-model="form.businessHours" rows="4"></textarea>
        <span class="small muted">例如：週二至週五 9:00–20:00，每週一公休</span></div>
      <div class="card col" v-if="form"><b>其他注意事項</b><textarea v-model="form.extraNotes" rows="5"></textarea>
        <span class="small muted">例如：寵物友善、低消規定、包場方式…（修改後會自動儲存）</span></div>
    </div>`,
  };

  // MARK: - 回覆規則

  P.rules = {
    setup() {
      const form = autosave(() => (S.data ? { key: S.state.selectedAccountId, value: S.data.rules } : null),
        (v) => post('/api/rules', { rules: v }, { quiet: true }));
      const tones = Vue.computed(() => Object.entries(S.state.tones).map(([value, label]) => ({ value, label })));
      const hours = Array.from({ length: 24 }, (_, i) => i);
      return { form, tones, hours };
    },
    template: `<div class="page" v-if="form">
      <PageHead section="rules"/>
      <div class="card col">
        <h3>回覆風格</h3>
        <div class="row"><span class="muted small" style="width:40px">語氣</span><Seg v-model="form.tone" :options="tones"/></div>
        <Toggle v-model="form.useEmoji" label="可以使用表情符號"/>
        <Toggle v-model="form.useFlex" label="用卡片呈現（Flex Message）：型號比較表、測試條件、型號總覽"/>
        <div class="row"><span>回覆字數上限</span><input type="number" min="50" max="400" step="25" v-model.number="form.maxReplyLength" style="width:90px"> 字</div>
        <label class="field"><span>加好友歡迎訊息</span><textarea v-model="form.greetingMessage" rows="2"></textarea></label>
        <label class="field"><span>答不出來時的回覆（同時加入待補清單）</span><textarea v-model="form.fallbackMessage" rows="2"></textarea></label>
      </div>
      <div class="card col">
        <h3>轉人工</h3>
        <div class="small muted">顧客要找專人、或問到不該由 AI 回的問題，AI 會停手並推播通知你。你回覆後它會自動閃開。</div>
        <label class="field"><span>轉人工關鍵字</span><KeywordField v-model="form.handoffKeywords"/></label>
        <label class="field"><span>敏感問題（AI 不回）</span><KeywordField v-model="form.blockedKeywords"/></label>
        <label class="field"><span>轉人工時回覆顧客</span><textarea v-model="form.handoffMessage" rows="2"></textarea></label>
        <div class="row">你回覆後 <input type="number" min="5" max="240" step="5" v-model.number="form.humanModeMinutes" style="width:80px"> 分鐘沒動靜，自動交還 AI</div>
      </div>
      <div class="card col">
        <h3>預約收單</h3>
        <Toggle v-model="form.reservationEnabled" label="啟用預約收單"/>
        <label class="field"><span>預約關鍵字</span><KeywordField v-model="form.reservationKeywords"/></label>
        <Toggle v-model="form.askName" label="詢問訂位大名"/>
        <Toggle v-model="form.askPhone" label="詢問聯絡電話"/>
        <div class="row">人數上限 <input type="number" min="1" max="200" v-model.number="form.maxPartySize" style="width:80px"> 位（超過轉人工）</div>
      </div>
      <div class="card col">
        <h3>推播到你的 LINE</h3>
        <div class="row"><Toggle v-model="form.dailySummaryEnabled" label="每日摘要"/><span class="spacer"></span>
          <select v-model.number="form.dailySummaryHour" style="width:100px" :disabled="!form.dailySummaryEnabled"><option v-for="h in hours" :value="h">{{ h }}:00</option></select></div>
        <div class="row"><Toggle v-model="form.pendingReminderEnabled" label="待回覆提醒"/><span class="spacer"></span>
          顧客等 <input type="number" min="1" max="120" v-model.number="form.pendingReminderMinutes" style="width:70px" :disabled="!form.pendingReminderEnabled"> 分鐘</div>
        <Toggle v-model="form.disconnectNotifyEnabled" label="斷線通知"/>
        <Toggle v-model="form.notifyUnanswered" label="AI 答不出來時通知我"/>
        <div class="small muted">修改後會自動儲存。</div>
      </div>
    </div>`,
  };

  // MARK: - LINE 連線

  P.line = {
    data: () => ({ secret: '', token: '', busy: false, message: '', hostname: '', tunnelToken: '', checking: false, menu: null, menuError: '', applying: false }),
    computed: { st, acct, current() { return this.menu && this.menu.menus.find((m) => m.isDefault); } },
    mounted() { this.loadMenu(); },
    watch: { 'st.settings.namedHostname': { handler(v) { this.hostname = v || ''; }, immediate: true } },
    methods: {
      copy,
      async saveCreds() {
        this.busy = true; this.message = '';
        try { await post('/api/accounts/credentials', { id: this.acct.id, secret: this.secret, token: this.token }); this.message = '✅ 連線成功'; this.secret = ''; this.token = ''; }
        catch (e) { this.message = '❌ ' + e.message; }
        this.busy = false;
      },
      install() { post('/api/tunnel/install', {}, { success: 'cloudflared 已安裝' }); },
      mode(m) { post('/api/settings', { tunnelMode: m }); },
      saveNamed() {
        post('/api/settings', { namedHostname: this.hostname });
        if (this.tunnelToken) { post('/api/settings/tunnel-token', { token: this.tunnelToken }, { success: '已儲存 Tunnel Token' }); this.tunnelToken = ''; }
      },
      start: () => post('/api/tunnel/start'), stop: () => post('/api/tunnel/stop'),
      async check() { this.checking = true; try { await post('/api/webhook/check', { id: this.acct.id }); } finally { this.checking = false; } },
      sync() { post('/api/webhook/sync', { id: this.acct.id }); },
      newCode() { post('/api/accounts/bindcode', { id: this.acct.id }); },
      testPush() { post('/api/accounts/test-push', { id: this.acct.id }, { success: '已送出測試推播' }); },
      unbind(uid) { if (confirm('解除這個綁定？')) post('/api/accounts/unbind', { id: this.acct.id, uid }); },
      wizard() { S.wizardFromStep = 0; S.showWizard = true; },
      async loadMenu() {
        if (!this.acct || !this.acct.hasCredentials) return;
        try { this.menu = await get('/api/richmenu?account=' + encodeURIComponent(this.acct.id)); this.menuError = ''; } catch (e) { this.menuError = e.message; }
      },
      async applyMenu() {
        const others = this.menu ? this.menu.menus.filter((m) => !m.ours).length : 0;
        if (others && !confirm(`會用我們的選單取代目前的 ${others} 個舊選單（舊選單會刪除）。確定嗎？`)) return;
        this.applying = true;
        try { const r = await post('/api/richmenu/apply', { id: this.acct.id }); toast(`已套用新選單${r.deleted.length ? `，取代 ${r.deleted.length} 個舊選單` : ''} 🎉`); await this.loadMenu(); } catch { /* 已顯示 */ }
        this.applying = false;
      },
    },
    template: `<div class="page">
      <PageHead section="line"/>
      <template v-if="acct">
        <div class="card col">
          <div class="row"><h3 class="grow" style="margin:0">Messaging API</h3><a href="https://developers.line.biz/console/" target="_blank" class="small">開啟 LINE Developers</a></div>
          <div class="form-grid">
            <span class="lbl">Channel secret</span><input type="password" v-model="secret" :placeholder="acct.hasCredentials ? '已設定（要更換才需要重新輸入）' : '貼上 Channel secret'">
            <span class="lbl">Channel access token</span><input type="password" v-model="token" :placeholder="acct.hasCredentials ? '已設定（要更換才需要重新輸入）' : '貼上 Channel access token'">
          </div>
          <div class="row">
            <template v-if="acct.basicId"><Avatar :name="acct.displayName" :url="acct.pictureURL" :size="24"/><span>{{ acct.displayName }}　{{ acct.basicId }}</span></template>
            <span class="small muted">{{ message }}</span><span class="spacer"></span>
            <button class="btn primary" :disabled="busy || (!secret && !token && acct.hasCredentials) || (!acct.hasCredentials && (!secret || !token))" @click="saveCreds">{{ busy ? '驗證中…' : '儲存並驗證' }}</button>
          </div>
        </div>

        <div class="card col">
          <div class="row"><h3 style="margin:0">Cloudflare Tunnel</h3><Tag :text="st.tunnel.label" :color="st.tunnel.state === 'running' ? 'green' : 'orange'"/><span class="spacer"></span>
            <span v-if="st.tunnel.pid" class="small faint">pid {{ st.tunnel.pid }}</span></div>
          <div class="small muted">讓 LINE 可以從外部連進這台電腦，不用開 port、不用固定 IP。</div>
          <div v-if="st.tunnel.error" class="small err">{{ st.tunnel.error }}</div>
          <div class="row">
            <Icon :name="st.tunnel.binary ? 'circle-check' : 'circle-alert'" :style="{ color: st.tunnel.binary ? 'var(--green)' : 'var(--red)' }"/>
            <span class="mono small grow ellipsis">{{ st.tunnel.binary || '尚未安裝 cloudflared' }}</span>
            <button v-if="!st.tunnel.binary" class="btn" :disabled="st.installing" @click="install">{{ st.installing ? '下載中…' : '一鍵安裝' }}</button>
          </div>
          <div class="col" style="gap:6px">
            <label class="row"><input type="radio" :checked="st.settings.tunnelMode === 'quick'" @change="mode('quick')"> Quick Tunnel（免設定，網址會變）</label>
            <label class="row"><input type="radio" :checked="st.settings.tunnelMode === 'named'" @change="mode('named')"> 自訂網域（固定網址）</label>
          </div>
          <div v-if="st.settings.tunnelMode === 'named'" class="col">
            <div class="small muted">在 Cloudflare Zero Trust 建立 Tunnel，Public Hostname 指到 http://127.0.0.1:{{ st.settings.port }}，再把 Token 和網域貼進來。同一個網域可以開很多子網域，例如 bot.你的網域.com。</div>
            <input type="text" v-model="hostname" placeholder="自訂網域（例如 bot.mydomain.com）">
            <input type="password" v-model="tunnelToken" :placeholder="st.hasTunnelToken ? 'Tunnel Token 已設定（要更換才需要重新輸入）' : 'Tunnel Token'">
            <div><button class="btn" @click="saveNamed">儲存自訂網域設定</button></div>
          </div>
          <div class="row"><span class="spacer"></span>
            <button class="btn" :disabled="st.tunnel.state === 'stopped'" @click="stop">停止</button>
            <button class="btn primary" :disabled="!st.tunnel.binary" @click="start">{{ st.tunnel.state === 'stopped' ? '啟動 Tunnel' : '重啟 Tunnel' }}</button></div>
        </div>

        <div class="card col">
          <div class="row"><h3 style="margin:0">Webhook</h3><Tag v-if="acct.webhookStatus" :text="acct.webhookStatus.synced ? '已同步' : '未同步'" :color="acct.webhookStatus.synced ? 'green' : 'orange'"/></div>
          <div class="row"><span class="mono grow" style="user-select:text;word-break:break-all">{{ acct.webhookURL || 'Tunnel 建立後會自動產生，並自動設定到 LINE 後台' }}</span>
            <button v-if="acct.webhookURL" class="btn plain" @click="copy(acct.webhookURL)"><Icon name="copy"/></button></div>
          <div v-if="acct.webhookStatus && acct.webhookStatus.message" class="small muted">{{ acct.webhookStatus.message }}</div>
          <div class="small warn">記得在 LINE Official Account Manager 把「回應設定 → 自動回應訊息」關掉、「Webhook」打開，不然會有兩則回覆。</div>
          <div class="row"><span class="spacer"></span>
            <button class="btn" :disabled="!acct.webhookURL || checking" @click="check">{{ checking ? '檢查中…' : '檢查' }}</button>
            <button class="btn primary" :disabled="!acct.webhookURL || !acct.hasCredentials" @click="sync">重新設定到 LINE</button></div>
        </div>

        <div class="card col">
          <div class="row"><h3 class="grow" style="margin:0">圖文選單</h3><button class="btn plain" title="重新整理" @click="loadMenu"><Icon name="refresh-cw"/></button></div>
          <div class="small muted">LINE 聊天室下方的按鈕選單。套用後，顧客點按鈕就會送出對應的問題，由 FAQ 直接回答。</div>
          <img src="/richmenu.png" style="width:100%;max-width:520px;border-radius:8px;border:1px solid var(--line)" alt="選單預覽">
          <div v-if="menu" class="small">
            <div v-if="current">目前顯示：<b>{{ current.ours ? '我們的選單' : (current.name || '未命名選單') }}</b>（{{ current.buttons.join('、') }}）</div>
            <div v-else class="muted">目前沒有預設選單</div>
            <div v-if="menu.menus.filter((m) => !m.ours).length" class="warn">另有 {{ menu.menus.filter((m) => !m.ours).length }} 個舊選單（{{ menu.menus.filter((m) => !m.ours).map((m) => m.name || '未命名').join('、') }}），套用時會一起取代</div>
          </div>
          <div v-if="menuError" class="small err">{{ menuError }}</div>
          <div class="row"><span class="small muted grow">按鈕：{{ menu ? menu.planned.map((b) => b.label + '→「' + b.text + '」').join('　') : '' }}</span>
            <button class="btn primary" :disabled="!acct.hasCredentials || applying" @click="applyMenu">{{ applying ? '套用中…' : (current && current.ours ? '重新套用' : '套用我們的選單') }}</button></div>
        </div>

        <div class="card col">
          <h3>綁定你的 LINE</h3>
          <div class="small muted">用你自己的 LINE 加官方帳號好友，傳送下面這句就完成綁定。之後轉人工、預約、每日摘要、待回覆提醒、斷線通知都會推播給你，也可以直接在 LINE 按接受/婉拒預約、用「#代碼 內容」回覆顧客。</div>
          <div class="row"><span class="bind-code" style="font-size:22px;padding:6px 14px">綁定 {{ acct.bindCode }}</span>
            <button class="btn plain" @click="copy('綁定 ' + acct.bindCode)"><Icon name="copy"/></button><span class="spacer"></span>
            <button class="btn" @click="newCode">換一組</button></div>
          <div v-if="!acct.ownerUserIds.length" class="row warn"><Icon name="triangle-alert"/>尚未綁定任何人</div>
          <div v-for="uid in acct.ownerUserIds" :key="uid" class="row">
            <Icon name="circle-check" style="color:var(--green)"/><span class="grow">已綁定 …{{ uid.slice(-8) }}</span>
            <button class="btn" @click="testPush">測試推播</button><button class="btn danger" @click="unbind(uid)">解除</button>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="card"><Empty icon="link" title="還沒有帳號" message="先用設定精靈新增一個 LINE 官方帳號"/></div>
        <div><button class="btn primary" @click="wizard">開啟設定精靈</button></div>
      </template>
    </div>`,
  };

  // MARK: - 帳號管理

  P.accounts = {
    computed: { st },
    methods: {
      add() { S.wizardFromStep = 1; S.showWizard = true; },
      toggle(a, v) { post('/api/accounts/update', { id: a.id, isEnabled: v }); },
      select(a) { post('/api/select-account', { id: a.id }); go('overview'); },
      remove(a) { if (confirm(`確定刪除「${a.displayName}」？對話與知識庫都會移除。`)) post('/api/accounts/delete', { id: a.id }, { success: '已刪除' }); },
    },
    template: `<div class="page">
      <PageHead section="accounts"/>
      <div class="row"><span class="small muted grow">所有帳號共用同一個 Tunnel，用不同的 webhook 路徑區分。</span>
        <button class="btn primary" @click="add"><Icon name="plus"/>新增官方帳號</button></div>
      <div class="card tight row" v-for="a in st.accounts" :key="a.id">
        <Avatar :name="a.displayName" :url="a.pictureURL" :size="40"/>
        <div class="grow">
          <div class="row" style="gap:6px"><b>{{ a.displayName }}</b><Tag v-if="a.id === st.selectedAccountId" text="目前" color="blue"/>
            <Tag v-if="!a.isEnabled" text="已暫停"/><Tag v-if="!a.hasCredentials" text="缺金鑰" color="red"/></div>
          <div class="small mono muted">{{ a.basicId || '—' }}・/webhook/{{ a.slug }}</div>
          <div class="tiny faint">FAQ {{ a.counts.faqs }}・文件 {{ a.counts.docs }}・對話 {{ a.counts.conversations }}・今日 {{ a.counts.today }} 則</div>
        </div>
        <Toggle :modelValue="a.isEnabled" @update:modelValue="toggle(a, $event)" title="啟用"/>
        <button class="btn" :disabled="a.id === st.selectedAccountId" @click="select(a)">切換</button>
        <button class="btn plain danger" @click="remove(a)"><Icon name="trash-2"/></button>
      </div>
    </div>`,
  };

  // MARK: - 系統

  P.system = {
    data: () => ({ port: 0, adminPort: 0, password: '', prompt: '用一句話介紹你自己', aiResult: '', aiRunning: false, rebuilding: false, models: {} }),
    computed: { st, s() { return st().settings; }, o() { return st().ollama; },
      lanURLs() { return st().lanAddresses.map((ip) => `http://${ip}:${this.s.adminPort}`); } },
    created() { this.port = this.s.port; this.adminPort = this.s.adminPort; this.models = { chatModel: this.s.chatModel, embedModel: this.s.embedModel, ollamaURL: this.s.ollamaURL }; },
    methods: {
      copy, timeDisplay,
      set(patch) { post('/api/settings', patch); },
      async ports() {
        const r = await post('/api/settings/ports', { port: this.port, adminPort: this.adminPort }, { success: '已套用並重啟服務' });
        if (r.adminChanged && st().local) setTimeout(() => { location.port = String(this.adminPort); }, 1200);
      },
      async lan(v) { await post('/api/settings/lan', { lanAccess: v }); },
      async savePassword() { await post('/api/settings/lan', { password: this.password }, { success: '已設定區網密碼' }); this.password = ''; },
      saveModels() { post('/api/settings', this.models, { success: '已儲存，重新檢查模型中' }); },
      pull() { post('/api/ollama/pull', {}); },
      refreshOllama() { post('/api/ollama/refresh', {}, { success: '已重新檢查' }); },
      async rebuild() { this.rebuilding = true; try { await post('/api/vectors/rebuild', {}, { success: '向量索引已重建' }); } finally { this.rebuilding = false; } },
      async tryAI() {
        this.aiRunning = true;
        try { this.aiResult = (await post('/api/ai/try', { prompt: this.prompt }, { quiet: true })).text; } catch (e) { this.aiResult = '❌ ' + e.message; }
        this.aiRunning = false;
      },
      open(what) { post('/api/system/open', { what }); },
      loginItem(v) { post('/api/settings/login-item', { enabled: v }); },
      wizard() { S.wizardFromStep = 0; S.showWizard = true; },
    },
    template: `<div class="page">
      <PageHead section="system"/>
      <div class="card col">
        <h3>本機服務</h3>
        <div class="row wrap"><Dot :color="st.serverRunning ? 'green' : 'red'"/>
          <span class="grow">{{ st.serverRunning ? 'Webhook 服務 127.0.0.1:' + s.port + ' 執行中' : (st.serverError || '未啟動') }}</span></div>
        <div class="row wrap"><span class="small muted">Webhook 連接埠</span><input type="number" v-model.number="port" style="width:90px">
          <span class="small muted">管理介面連接埠</span><input type="number" v-model.number="adminPort" style="width:90px">
          <button class="btn" @click="ports">套用並重啟</button></div>
        <Toggle :modelValue="s.autoStart" @update:modelValue="set({ autoStart: $event })" label="開啟 App 時自動啟動 Tunnel"/>
        <Toggle v-if="st.loginItem !== null" :modelValue="st.loginItem" @update:modelValue="loginItem" label="登入 Windows 時自動開啟"/>
        <div class="small muted">長期跑的話，建議到 Windows「設定 → 系統 → 電源」把睡眠設成「永不」，App 執行時也會防止系統自動睡眠。關掉視窗後 App 會縮到右下角通知區域繼續運作。</div>
      </div>

      <div class="card col">
        <div class="row"><h3 style="margin:0">區網網頁管理</h3><Tag :text="s.lanAccess && st.adminHost === '0.0.0.0' ? '區網可連入' : '只限本機'" :color="s.lanAccess && st.adminHost === '0.0.0.0' ? 'green' : 'gray'"/></div>
        <div class="small muted">開啟後，同一個區網（公司或店裡 Wi-Fi）的電腦和手機，用瀏覽器打開下面的網址、輸入密碼，就能管理知識庫、回覆顧客、處理預約。顧客的 LINE 不會經過這裡。</div>
        <template v-if="st.local">
          <div class="row wrap"><input type="password" v-model="password" :placeholder="st.hasAdminPassword ? '已設定密碼（輸入新密碼可更換）' : '設定區網登入密碼（至少 6 個字）'" style="max-width:320px">
            <button class="btn" :disabled="[...password].length < 6" @click="savePassword">{{ st.hasAdminPassword ? '更換密碼' : '設定密碼' }}</button></div>
          <Toggle :modelValue="s.lanAccess" :disabled="!st.hasAdminPassword" @update:modelValue="lan" label="允許區網連入"/>
        </template>
        <div v-else class="small muted">區網設定只能在主機上修改。</div>
        <div v-if="s.lanAccess" class="col" style="gap:4px">
          <div v-for="u in lanURLs" :key="u" class="row"><Icon name="globe"/><span class="mono grow">{{ u }}</span><button class="btn plain" @click="copy(u)"><Icon name="copy"/></button></div>
          <div class="small muted">第一次開啟時，Windows 可能會詢問是否允許網路存取，請選「允許」（私人網路）。</div>
        </div>
        <div v-if="st.adminError" class="small err">{{ st.adminError }}</div>
      </div>

      <div class="card col">
        <div class="row"><h3 style="margin:0">本機大模型（Ollama）</h3><Tag :text="s.useOllama ? o.label : '已關閉'" :color="o.ready ? 'green' : 'orange'"/><span class="spacer"></span>
          <button class="btn" @click="refreshOllama">重新檢查</button></div>
        <Toggle :modelValue="s.useOllama" @update:modelValue="set({ useOllama: $event })" label="使用 Qwen 回答、bge-m3 語意檢索"/>
        <div class="small muted">回答與檢索都在這台電腦上執行，不用 API key。Ollama 沒開時只會用常見問題（FAQ）回答，其他問題加入待補清單。</div>
        <div class="form-grid">
          <span class="lbl">回答模型</span><input type="text" v-model="models.chatModel" placeholder="qwen3.5:9b">
          <span class="lbl">向量模型</span><input type="text" v-model="models.embedModel" placeholder="bge-m3">
          <span class="lbl">Ollama 網址</span><input type="text" v-model="models.ollamaURL" placeholder="http://127.0.0.1:11434">
        </div>
        <div class="row"><span class="small muted grow">顯示卡記憶體 8 GB 以上建議用 qwen3.5:9b；沒有獨立顯示卡可以改用較輕量的 qwen3.5:4b。</span><button class="btn" @click="saveModels">儲存模型設定</button></div>
        <Toggle :modelValue="s.agentMode" @update:modelValue="set({ agentMode: $event })" label="Agent 模式：反覆查詢知識庫，查齊資料後才回覆"/>
        <div class="small muted">開啟後回覆約 10～30 秒，會自動拆解多項問題逐一查詢，並檢查數字都有出處；關閉則只查一次。常見問題（FAQ）一樣秒回。</div>
        <div v-if="o.state === 'notRunning'" class="small warn">請先安裝並打開 Ollama：<a href="https://ollama.com/download/windows" target="_blank">ollama.com/download</a></div>
        <div v-if="o.state === 'missing'" class="row wrap"><span class="small warn grow">缺少模型：{{ o.missing.join('、') }}</span>
          <button class="btn primary" :disabled="!!o.pulling" @click="pull"><Icon name="download"/>下載模型</button></div>
        <div v-if="o.pulling" class="col" style="gap:4px"><div class="small">下載 {{ o.pulling.model }}：{{ o.pulling.status }} {{ o.pulling.ratio ? Math.round(o.pulling.ratio * 100) + '%' : '' }}</div>
          <div class="progress"><div :style="{ width: Math.round((o.pulling.ratio || 0) * 100) + '%' }"></div></div></div>
        <div class="row"><span class="grow">向量索引：{{ st.vectorCount }} 段</span>
          <button class="btn" :disabled="!o.ready || rebuilding" @click="rebuild">{{ rebuilding ? '重建中…' : '重建向量索引' }}</button></div>
        <div class="row"><input type="text" v-model="prompt" placeholder="試問模型"><button class="btn" :disabled="aiRunning || !o.ready" @click="tryAI">{{ aiRunning ? '生成中…' : '試跑' }}</button></div>
        <div v-if="aiResult" class="pre small" style="user-select:text">{{ aiResult }}</div>
      </div>

      <div class="card col">
        <h3>資料</h3>
        <div class="mono small" style="user-select:text;word-break:break-all">{{ st.dataDir }}</div>
        <div class="row wrap" v-if="st.local"><button class="btn" @click="open('data')"><Icon name="folder-open"/>打開資料夾</button>
          <button class="btn" @click="open('log')"><Icon name="file-text"/>打開日誌檔</button><span class="spacer"></span>
          <button class="btn" @click="wizard">重新執行設定精靈</button></div>
      </div>

      <div class="card col" style="gap:2px">
        <h3>系統日誌</h3>
        <div v-for="e in st.logs.slice(0, 80)" :key="e.id" class="row top tiny" style="gap:6px">
          <Dot :color="e.level === 'info' ? 'green' : e.level === 'warning' ? 'orange' : 'red'" sm style="margin-top:5px"/>
          <span class="faint mono">{{ timeDisplay(e.date) }}</span><span style="user-select:text">{{ e.message }}</span>
        </div>
      </div>
    </div>`,
  };
})();
