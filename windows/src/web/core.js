// 共用：資料狀態、API、共用元件
/* global Vue */
(function () {
  const { reactive, computed, ref, watch, nextTick, onMounted, onBeforeUnmount } = Vue;

  const S = reactive({
    state: null,        // /api/state
    data: null,         // /api/data（選取中的帳號）
    section: 'overview',
    needLogin: false,
    focusedConversation: null,
    showWizard: false,
    wizardFromStep: 0,
    toasts: [],
    menuOpen: false,
  });

  const COLORS = {
    blue: 'var(--blue)', green: 'var(--green)', teal: 'var(--teal)', orange: 'var(--orange)', red: 'var(--red)', purple: 'var(--purple)',
    pink: 'var(--pink)', indigo: 'var(--indigo)', gray: 'var(--gray)', line: 'var(--green)',
  };

  const SECTIONS = {
    overview: { title: '總覽', icon: 'gauge', tint: 'blue', subtitle: '服務狀態、今日數據與最近活動' },
    conversations: { title: '客服對話', icon: 'messages-square', tint: 'green', subtitle: '顧客對話與真人接手' },
    reservations: { title: '預約', icon: 'calendar', tint: 'red', subtitle: 'AI 收好的預約單，按一下接受或婉拒，顧客馬上收到確認' },
    usage: { title: '使用量', icon: 'chart-column', tint: 'indigo', subtitle: '近 14 天的處理量，全部在本機運算，沒有 token 費用' },
    milModels: { title: '軍規機種', icon: 'shield-check', tint: 'teal', subtitle: '目前收錄的機種與通過的測試，新增後一鍵產生知識庫' },
    knowledge: { title: '知識庫', icon: 'library-big', tint: 'orange', subtitle: '常見問題直接回標準答案，其他問題 AI 依這裡的資料回答，沒資料就老實說沒有' },
    store: { title: '店家資訊', icon: 'store', tint: 'pink', subtitle: 'AI 回答時一定會參考的基本資料' },
    rules: { title: '回覆規則', icon: 'message-square-text', tint: 'purple', subtitle: '語氣、轉人工、預約與通知' },
    line: { title: 'LINE 連線', icon: 'link', tint: 'teal', subtitle: 'LINE 官方帳號、Cloudflare Tunnel 與你的 LINE 綁定' },
    accounts: { title: '帳號管理', icon: 'users', tint: 'indigo', subtitle: '多個官方帳號同時跑，分店各有自己的知識庫' },
    system: { title: '系統', icon: 'settings', tint: 'gray', subtitle: '本機服務、區網連入、本機模型與資料位置' },
  };

  function groups() {
    const mil = S.state && S.state.edition === 'mil';
    return [
      { title: '營運', items: ['overview', 'conversations', 'reservations', 'usage'] },
      { title: '內容', items: (mil ? ['milModels'] : []).concat(['knowledge', 'store', 'rules']) },
      { title: '設定', items: ['line'] },
      { title: S.state && S.state.cloud ? '系統' : '這台電腦', items: ['accounts', 'system'] },
    ];
  }

  // MARK: API

  async function request(method, path, body) {
    const opts = { method, headers: { 'X-MLB': '1' }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts);
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && json.login) { S.needLogin = true; throw new Error('請先登入'); }
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }
  const get = (path) => request('GET', path);
  const accountId = () => (S.state && S.state.selectedAccountId) || '';

  /// 送出修改；失敗顯示錯誤。account 預設帶目前選取的帳號
  async function post(path, body = {}, { quiet = false, success } = {}) {
    try {
      const r = await request('POST', path, { account: accountId(), ...body });
      if (success) toast(success);
      refreshSoon();
      return r;
    } catch (e) {
      if (!quiet) toast(e.message, true);
      throw e;
    }
  }

  let refreshing = false, again = false;
  async function refresh() {
    if (refreshing) { again = true; return; }
    refreshing = true;
    try {
      S.state = await get('/api/state');
      if (S.state.cloud) {
        // 雲端版的頁面說明
        SECTIONS.line.subtitle = 'LINE 官方帳號、Webhook、圖文選單與你的 LINE 綁定';
        SECTIONS.system.subtitle = '雲端運作狀態與 AI 模型';
        SECTIONS.accounts.subtitle = '多個官方帳號同時跑，各有自己的知識庫';
      }
      S.needLogin = false;
      const id = S.state.selectedAccountId;
      S.data = id ? await get(`/api/data?account=${encodeURIComponent(id)}`) : null;
      document.title = S.state.productName + (S.state.platform === 'win32' ? '' : '（Windows 版）');
    } catch (e) {
      // 登入畫面或暫時斷線
    } finally {
      refreshing = false;
      if (again) { again = false; refresh(); }
    }
  }
  let timer = null;
  const refreshSoon = () => { clearTimeout(timer); timer = setTimeout(refresh, 80); };
  const listeners = new Set();
  const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  function connectEvents() {
    let es;
    const open = () => {
      es = new EventSource('/api/events');
      es.onmessage = () => { refreshSoon(); for (const fn of listeners) fn(); };
      es.onerror = () => { es.close(); setTimeout(open, 3000); };
    };
    open();
    // 保險：SSE 斷掉時也每 15 秒更新一次
    setInterval(refresh, 15000);
  }

  function toast(text, error = false) {
    const t = { id: Math.random(), text, error };
    S.toasts.push(t);
    setTimeout(() => { const i = S.toasts.indexOf(t); if (i >= 0) S.toasts.splice(i, 1); }, error ? 5000 : 2600);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('已複製'); } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); toast('已複製');
    }
  }

  // MARK: 時間

  const pad = (n) => String(n).padStart(2, '0');
  const isToday = (d) => new Date(d).toDateString() === new Date().toDateString();
  function shortDisplay(v) {
    if (!v) return '';
    const d = new Date(v);
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return isToday(d) ? t : `${d.getMonth() + 1}/${d.getDate()} ${t}`;
  }
  const timeDisplay = (v) => { const d = new Date(v); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  function dayLabel(v) {
    const d = new Date(v);
    if (isToday(d)) return '今天';
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return '昨天';
    return `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`;
  }

  // MARK: 共用元件

  const C = {};

  C.Icon = {
    props: { name: String, size: { type: Number, default: 16 } },
    template: `<i class="ic" :style="{ '--ic': 'url(/icons/' + name + '.svg)', width: size + 'px', height: size + 'px' }"></i>`,
  };

  C.IconBadge = {
    props: { name: String, color: { type: String, default: 'blue' }, size: { type: Number, default: 22 } },
    template: `<span class="badge-ic" :style="{ width: size + 'px', height: size + 'px', background: col, borderRadius: Math.round(size * 0.28) + 'px' }"><Icon :name="name" :size="Math.round(size * 0.6)"/></span>`,
    computed: { col() { return COLORS[this.color] || this.color; } },
  };

  C.Dot = {
    props: { color: { type: String, default: 'green' }, sm: Boolean },
    template: `<span class="dot" :class="{ sm }" :style="{ background: c }"></span>`,
    computed: { c() { return COLORS[this.color] || this.color; } },
  };

  C.Tag = {
    props: { text: String, color: { type: String, default: 'gray' } },
    template: `<span class="tag" :style="{ color: c, background: bg }">{{ text }}</span>`,
    computed: {
      c() { return COLORS[this.color] || this.color; },
      bg() { return `color-mix(in srgb, ${this.c} 14%, transparent)`; },
    },
  };

  C.Toggle = {
    props: { modelValue: Boolean, label: String, sm: Boolean, disabled: Boolean },
    emits: ['update:modelValue'],
    template: `<label class="switch" :class="{ sm }" :style="disabled ? 'opacity:.5;pointer-events:none' : ''">
      <input type="checkbox" :checked="modelValue" @change="$emit('update:modelValue', $event.target.checked)">
      <span class="track"></span><span v-if="label">{{ label }}</span><slot/></label>`,
  };

  C.Seg = {
    props: { modelValue: [String, Number, Boolean, null], options: Array },
    emits: ['update:modelValue'],
    template: `<div class="seg"><button v-for="o in options" :key="String(o.value)" :class="{ on: o.value === modelValue }" @click="$emit('update:modelValue', o.value)">{{ o.label }}</button></div>`,
  };

  C.Avatar = {
    props: { name: String, url: String, size: { type: Number, default: 32 } },
    template: `<span class="avatar" :style="{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.42) + 'px' }">
      <img v-if="url && !broken" :src="url" @error="broken = true" referrerpolicy="no-referrer"><template v-else>{{ (name || '?').slice(0, 1) }}</template></span>`,
    data: () => ({ broken: false }),
  };

  C.Empty = {
    props: { icon: String, title: String, message: String },
    template: `<div class="empty"><Icon :name="icon || 'inbox'" :size="34"/><div class="t">{{ title }}</div><div class="small">{{ message }}</div><slot/></div>`,
  };

  C.StatTile = {
    props: { icon: String, color: String, value: [String, Number], label: String },
    template: `<div class="card stat"><IconBadge :name="icon" :color="color" :size="34"/><div><div class="val">{{ value }}</div><div class="lbl">{{ label }}</div></div></div>`,
  };

  C.PageHead = {
    props: { section: String, subtitle: String },
    template: `<div class="page-head"><IconBadge :name="s.icon" :color="s.tint" :size="34"/><div class="grow"><h1>{{ s.title }}</h1><p>{{ subtitle || s.subtitle }}</p></div><slot/></div>`,
    computed: { s() { return SECTIONS[this.section]; } },
  };

  C.Modal = {
    props: { title: String, size: { type: String, default: '' } },
    emits: ['close'],
    template: `<div class="overlay" @mousedown.self="$emit('close')"><div class="modal" :class="size">
      <div class="m-head" v-if="title">{{ title }}</div><div class="m-body"><slot/></div>
      <div class="m-foot" v-if="$slots.foot"><slot name="foot"/></div></div></div>`,
    mounted() { this.onKey = (e) => { if (e.key === 'Escape') this.$emit('close'); }; window.addEventListener('keydown', this.onKey); },
    unmounted() { window.removeEventListener('keydown', this.onKey); },
  };

  /// 關鍵字輸入：Enter 或逗號新增，點 × 刪除
  C.KeywordField = {
    props: { modelValue: Array, placeholder: { type: String, default: '輸入後按 Enter' } },
    emits: ['update:modelValue'],
    data: () => ({ text: '' }),
    template: `<div class="chips"><span class="chip" v-for="(k, i) in modelValue" :key="k + i">{{ k }}<button @click="remove(i)" title="移除">×</button></span>
      <input v-model="text" :placeholder="placeholder" @keydown.enter.prevent="add" @keydown.backspace="back" @blur="add" @input="comma"></div>`,
    methods: {
      add() {
        const parts = this.text.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
        if (parts.length) this.$emit('update:modelValue', [...(this.modelValue || []), ...parts.filter((p) => !(this.modelValue || []).includes(p))]);
        this.text = '';
      },
      comma() { if (/[,，、]/.test(this.text)) this.add(); },
      back() { if (!this.text && (this.modelValue || []).length) this.remove(this.modelValue.length - 1); },
      remove(i) { const v = [...this.modelValue]; v.splice(i, 1); this.$emit('update:modelValue', v); },
    },
  };

  C.CheckRow = {
    props: { ok: Boolean, text: String },
    template: `<div class="check-row"><Icon :name="ok ? 'circle-check' : 'circle-dashed'" :style="{ color: ok ? 'var(--green)' : 'var(--orange)' }"/><span class="ellipsis">{{ text }}</span><slot/></div>`,
  };

  /// 自動存檔的表單：改了 600ms 後送出
  function autosave(source, save) {
    const form = ref(null);
    let t = null, lastKey = null, saved = null;
    const load = () => {
      const src = source();
      const key = src ? src.key : null;
      if (key !== lastKey || form.value == null) {
        lastKey = key;
        saved = src ? JSON.stringify(src.value) : null;
        form.value = src ? JSON.parse(saved) : null;
      }
    };
    watch(source, load, { immediate: true });
    watch(form, (v) => {
      if (v == null) return;
      const json = JSON.stringify(v);
      if (json === saved) return;
      clearTimeout(t);
      t = setTimeout(() => { saved = json; save(JSON.parse(json)); }, 600);
    }, { deep: true });
    return form;
  }

  window.MLB = {
    S, COLORS, SECTIONS, groups, get, post, request, refresh, refreshSoon, onChange, connectEvents, toast, copy,
    shortDisplay, timeDisplay, dayLabel, isToday, accountId, autosave, components: C, pages: {},
  };
})();
