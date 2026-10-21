// 主畫面：側邊欄 + 頁面 + 設定精靈 + 區網登入
/* global Vue, MLB */
(function () {
  const { S, SECTIONS, groups, post, toast } = MLB;

  const Sidebar = {
    data: () => ({ open: false }),
    computed: {
      st() { return S.state; },
      groups,
      acct() { return this.st.accounts.find((a) => a.id === this.st.selectedAccountId) || null; },
      health() { return this.st.health; },
      aiAuto: {
        get() { return this.st.settings.aiAutoReply; },
        set(v) { post('/api/settings', { aiAutoReply: v }); },
      },
    },
    methods: {
      s: (k) => SECTIONS[k],
      go(k) { S.section = k; S.menuOpen = false; },
      badge(k) {
        const a = this.acct;
        if (!a) return 0;
        return { conversations: a.counts.waiting, reservations: a.counts.pendingReservations, knowledge: a.counts.pending }[k] || 0;
      },
      select(a) { this.open = false; post('/api/select-account', { id: a.id }); },
      manage() { this.open = false; this.go('accounts'); },
      add() { this.open = false; S.wizardFromStep = 1; S.showWizard = true; },
      color(l) { return { ok: 'green', warning: 'orange', error: 'red' }[l]; },
    },
    template: `<aside class="sidebar" :class="{ open: S.menuOpen }">
      <button class="account-switch" @click="open = !open">
        <span class="init">{{ acct ? acct.displayName.slice(0, 1).toUpperCase() : 'A' }}</span>
        <span class="grow" style="min-width:0"><div class="name">{{ acct ? acct.displayName : '尚未設定帳號' }}</div>
          <div class="sub"><Dot :color="st.tunnel.state === 'running' ? 'green' : 'orange'" sm/>{{ acct && acct.basicId ? acct.basicId : '未連線' }}</div></span>
        <Icon name="chevrons-up-down" :size="13" style="color:var(--muted)"/>
        <div class="menu" v-if="open" style="top:46px;left:0" @click.stop @mouseleave="open = false">
          <button v-for="a in st.accounts" :key="a.id" @click="select(a)"><Icon :name="a.id === st.selectedAccountId ? 'check' : 'user'"/>{{ a.displayName }}</button>
          <hr><button @click="manage"><Icon name="users"/>管理帳號…</button><button @click="add"><Icon name="plus"/>新增官方帳號…</button>
        </div>
      </button>
      <nav>
        <template v-for="g in groups" :key="g.title">
          <div class="group-title">{{ g.title }}</div>
          <button v-for="k in g.items" :key="k" class="nav-item" :class="{ active: S.section === k }" @click="go(k)">
            <IconBadge :name="s(k).icon" :color="s(k).tint" :size="20"/>{{ s(k).title }}
            <span v-if="badge(k)" class="count">{{ badge(k) }}</span>
          </button>
        </template>
      </nav>
      <div class="status-footer col" style="gap:8px">
        <div class="row"><IconBadge name="store" color="green" :size="26"/>
          <div class="grow" style="min-width:0"><div class="small bold ellipsis">{{ st.productName }}</div>
            <div class="tiny muted row ellipsis" style="gap:4px"><Dot :color="color(health.level)" sm/>{{ health.level === 'ok' ? '正常運作' : health.title }}</div></div></div>
        <Toggle v-model="aiAuto" label="AI 自動回覆" sm class="small"/>
        <div v-if="!st.local" class="tiny muted">區網連線中</div>
      </div>
    </aside>`,
    setup() { return { S }; },
  };

  const Login = {
    data: () => ({ password: '', error: '', busy: false }),
    methods: {
      async login() {
        this.busy = true; this.error = '';
        try {
          const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: this.password }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || '登入失敗');
          S.needLogin = false;
          await MLB.refresh();
          MLB.connectEvents();
        } catch (e) { this.error = e.message; }
        this.busy = false;
      },
    },
    template: `<div class="login"><div class="card">
      <div><IconBadge name="store" color="green" :size="46"/></div>
      <div style="font-size:18px;font-weight:700">Mac-Line-Bot 管理登入</div>
      <div class="small muted">請輸入管理密碼</div>
      <input type="password" v-model="password" placeholder="密碼" @keydown.enter="login" autofocus>
      <div v-if="error" class="small err">{{ error }}</div>
      <button class="btn primary" :disabled="!password || busy" @click="login"><Icon name="log-in"/>登入</button>
    </div></div>`,
  };

  const Root = {
    components: { Sidebar, Login },
    setup() { return { S }; },
    computed: {
      page() {
        if (!S.state) return null;
        if (S.section === 'milModels' && S.state.edition !== 'mil') return MLB.pages.overview;
        return MLB.pages[S.section] || MLB.pages.overview;
      },
      title() { return SECTIONS[S.section] ? SECTIONS[S.section].title : ''; },
    },
    template: `<Login v-if="S.needLogin"/>
      <div v-else-if="!S.state" class="boot">連線中…</div>
      <template v-else>
        <div class="mobile-bar"><button class="btn plain" @click="S.menuOpen = !S.menuOpen"><Icon name="list" :size="20"/></button><b>{{ title }}</b></div>
        <div class="shell">
          <Sidebar/>
          <main class="main"><component :is="page" :key="S.section + (S.state.selectedAccountId || '')"/></main>
        </div>
        <SetupWizard v-if="S.showWizard"/>
      </template>
      <div class="toast-box"><div v-for="t in S.toasts" :key="t.id" class="toast" :class="{ error: t.error }">{{ t.text }}</div></div>`,
  };

  const app = Vue.createApp(Root);
  for (const [name, c] of Object.entries(MLB.components)) app.component(name, c);
  app.mount('#app');

  (async () => {
    await MLB.refresh();
    if (S.needLogin) return;
    MLB.connectEvents();
    const s = S.state;
    // 第一次使用（或還沒有帳號）自動打開設定精靈
    if (s && (!s.settings.onboardingCompleted || !s.accounts.length)) { S.wizardFromStep = 0; S.showWizard = true; }
    const hash = location.hash.slice(1);
    if (hash && SECTIONS[hash]) S.section = hash;
  })();
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (SECTIONS[h]) S.section = h; });
})();
