// 軍規機種管理（MIL 版，對照 Mac 版 MILModelsView.swift）
/* global MLB */
(function () {
  const { S, post, toast, shortDisplay } = MLB;
  const P = MLB.pages;

  const passes = (m, t) => (m.passed && m.passed[t.id]) || [];
  const described = (m, t) => (m.describedOnly && m.describedOnly[t.id]) || [];
  const label = (t, id) => (t.procedures.find((p) => p.id === id) || {}).label || id;

  const Editor = {
    props: { model: Object, tests: Array, families: Array, isNew: Boolean },
    emits: ['close'],
    data() {
      const m = JSON.parse(JSON.stringify(this.model));
      m.passed = m.passed || {};
      m.describedOnly = m.describedOnly || {};
      m.aliases = m.aliases || [];
      return { m };
    },
    computed: { count() { return this.tests.filter((t) => passes(this.m, t).length).length; } },
    methods: {
      state(t, p) { return passes(this.m, t).includes(p.id) ? 'passed' : described(this.m, t).includes(p.id) ? 'described' : 'none'; },
      set(t, p, v) {
        const order = (list) => t.procedures.map((x) => x.id).filter((id) => list.includes(id));
        const pass = passes(this.m, t).filter((x) => x !== p.id), desc = described(this.m, t).filter((x) => x !== p.id);
        if (v === 'passed') pass.push(p.id);
        if (v === 'described') desc.push(p.id);
        if (pass.length) this.m.passed[t.id] = order(pass); else delete this.m.passed[t.id];
        if (desc.length) this.m.describedOnly[t.id] = order(desc); else delete this.m.describedOnly[t.id];
      },
      all(t) { this.m.passed[t.id] = t.procedures.map((p) => p.id); delete this.m.describedOnly[t.id]; },
      clear(t) { delete this.m.passed[t.id]; delete this.m.describedOnly[t.id]; },
      async save() {
        this.m.code = this.m.code.trim();
        if (!this.m.display) this.m.display = this.m.code;
        await post('/api/mil/model/save', { model: this.m }, { success: '已儲存，記得按「產生知識庫」' });
        this.$emit('close');
      },
      async remove() {
        if (!confirm(`確定刪除 ${this.m.code}？\n刪除後記得按「產生知識庫」，客服回答才會更新。`)) return;
        await post('/api/mil/model/delete', { mid: this.m.id });
        this.$emit('close');
      },
    },
    template: `<Modal size="lg" @close="$emit('close')">
      <div class="row" style="margin-top:8px"><b style="font-size:17px" class="grow">{{ isNew ? '新增機種' : '編輯 ' + model.code }}</b><span class="muted small">通過 {{ count }} 大類</span></div>
      <div class="form-grid">
        <span class="lbl">型號代碼</span><input type="text" v-model="m.code" placeholder="例如 B5302C">
        <span class="lbl">顯示名稱</span><input type="text" v-model="m.display" placeholder="例如 ExpertBook B5（B5302C）">
        <span class="lbl">顧客的叫法</span><div><KeywordField v-model="m.aliases"/><div class="tiny muted" style="margin-top:3px">例如 B5302C, B5302, ExpertBook B5, B5。留空代表只透過「系列」回答</div></div>
        <span class="lbl">系列（可留空）</span><div class="row"><input type="text" v-model="m.family" placeholder="例如 ExpertBook B1" list="mil-families">
          <datalist id="mil-families"><option v-for="f in families" :value="f"></option></datalist></div>
        <span class="lbl">官方報告網址</span><input type="text" v-model="m.reportURL">
      </div>
      <div><b>通過的測試程序</b><div class="small muted">「說明另列」＝只出現在報告的測試說明、結果總表沒有列；客服會照實說明</div></div>
      <div class="card tight" v-for="t in tests" :key="t.id">
        <div class="row"><b class="grow small">{{ t.code }} {{ t.short }}</b>
          <button class="btn plain small" @click="all(t)">全部通過</button><button class="btn plain small" @click="clear(t)">清除</button></div>
        <div class="proc-row" v-for="p in t.procedures" :key="p.id">
          <div><div class="small">{{ p.label }}</div><div class="tiny muted">{{ p.detail }}</div></div>
          <Seg :modelValue="state(t, p)" @update:modelValue="set(t, p, $event)" :options="[{ value: 'passed', label: '通過' }, { value: 'described', label: '說明另列' }, { value: 'none', label: '無' }]"/>
        </div>
      </div>
      <template #foot>
        <button v-if="!isNew" class="btn danger" @click="remove">刪除機種</button><span class="spacer"></span>
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn primary" :disabled="!m.code.trim()" @click="save">儲存</button>
      </template>
    </Modal>`,
  };

  /// 編輯測試項目：名稱、Method 編號、顧客的說法、各程序的條件
  const TestEditor = {
    props: { test: Object, isNew: Boolean, used: Number },
    emits: ['close'],
    data() {
      const t = JSON.parse(JSON.stringify(this.test));
      t.procedures = t.procedures.length ? t.procedures : [{ id: 'I', label: '', detail: '' }];
      return { t, autoName: this.isNew };
    },
    watch: {
      't.short'() { if (this.autoName) this.t.name = this.composed(); },
      't.code'() { if (this.autoName) this.t.name = this.composed(); },
    },
    methods: {
      composed() { return this.t.short && this.t.code ? `${this.t.short}測試（Method ${this.t.code}）` : ''; },
      addProc() {
        const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
        const next = romans.find((r) => !this.t.procedures.some((p) => p.id === r)) || `P${this.t.procedures.length + 1}`;
        this.t.procedures.push({ id: next, label: '', detail: '' });
      },
      removeProc(i) { this.t.procedures.splice(i, 1); },
      move(i, d) { const p = this.t.procedures; const j = i + d; if (j < 0 || j >= p.length) return; [p[i], p[j]] = [p[j], p[i]]; },
      async save() {
        this.t.procedures = this.t.procedures.filter((p) => p.id.trim()).map((p) => ({ ...p, id: p.id.trim(), label: p.label.trim() || `程序 ${p.id.trim()}` }));
        await post('/api/mil/test/save', { test: this.t }, { success: '已儲存，記得按「產生知識庫」' });
        this.$emit('close');
      },
      async remove() {
        if (!confirm(`刪除「${this.t.short}」？${this.used ? `\n有 ${this.used} 款機種勾選了這項，勾選紀錄會一起清掉。` : ''}\n刪除後記得按「產生知識庫」。`)) return;
        await post('/api/mil/test/delete', { tid: this.t.id });
        this.$emit('close');
      },
    },
    template: `<Modal size="lg" @close="$emit('close')">
      <b style="font-size:17px;margin-top:8px">{{ isNew ? '新增測試項目' : '編輯「' + test.short + '」' }}</b>
      <div class="form-grid">
        <span class="lbl">簡稱</span><input type="text" v-model="t.short" placeholder="例如 淋雨（顧客看到的名稱，會出現在表格與卡片）">
        <span class="lbl">Method 編號</span><input type="text" v-model="t.code" placeholder="例如 506.6（PDF 匯入時用這個編號自動勾選）">
        <span class="lbl">完整名稱</span><input type="text" v-model="t.name" @input="autoName = false" placeholder="例如 淋雨測試（Method 506.6）">
        <span class="lbl">顧客的說法</span><div><KeywordField v-model="t.aliases"/><div class="tiny muted" style="margin-top:3px">例如 淋雨、下雨、防水。顧客的問題裡出現這些字，就會對到這個測試</div></div>
      </div>
      <div class="row"><b class="grow">測試程序與條件</b><button class="btn sm" @click="addProc"><Icon name="plus"/>新增程序</button></div>
      <div class="small muted">程序代號對應報告裡的「Procedure I／II…」，PDF 匯入時會自動勾選。條件會原文出現在客服回答裡，數字請照報告填寫。</div>
      <div class="card tight col" v-for="(p, i) in t.procedures" :key="i" style="gap:6px">
        <div class="row">
          <input type="text" v-model="p.id" placeholder="代號" style="width:80px" title="程序代號，例如 I、II">
          <input type="text" v-model="p.label" placeholder="程序名稱，例如 降雨（程序 I）" class="grow">
          <button class="btn plain" title="上移" :disabled="i === 0" @click="move(i, -1)">↑</button>
          <button class="btn plain" title="下移" :disabled="i === t.procedures.length - 1" @click="move(i, 1)">↓</button>
          <button class="btn plain danger" title="刪除程序" :disabled="t.procedures.length === 1" @click="removeProc(i)"><Icon name="trash-2"/></button>
        </div>
        <input type="text" v-model="p.detail" placeholder="條件，例如 降雨率 1.7 mm/min、風速 18 m/s，30 分鐘">
      </div>
      <template #foot>
        <button v-if="!isNew" class="btn danger" @click="remove">刪除測試項目</button><span class="spacer"></span>
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn primary" :disabled="!t.short.trim() || !t.code.trim() || !t.procedures.some((p) => p.id.trim())" @click="save">儲存</button>
      </template>
    </Modal>`,
  };

  const FamilyRow = {
    props: { f: Object, members: Number },
    data() { return { name: this.f.name, aliases: [...(this.f.aliases || [])] }; },
    watch: { f(v) { this.name = v.name; this.aliases = [...(v.aliases || [])]; } },
    methods: {
      save() { if (this.name.trim()) post('/api/mil/family/save', { family: { id: this.f.id, name: this.name.trim(), aliases: this.aliases } }, { quiet: true }); },
      remove() { if (confirm(`刪除系列「${this.f.name}」？`)) post('/api/mil/family/delete', { fid: this.f.id }); },
    },
    template: `<div class="row wrap">
      <input type="text" v-model="name" placeholder="系列名稱" style="width:180px" @change="save">
      <div class="grow" style="min-width:240px"><KeywordField v-model="aliases" placeholder="顧客的叫法，輸入後按 Enter" @update:modelValue="$nextTick(save)"/></div>
      <span class="small muted">{{ members }} 款</span>
      <button class="btn plain danger" @click="remove"><Icon name="trash-2"/></button>
    </div>`,
  };


  /// 測試排程表 Excel 的識別結果總覽：勾選要匯入的專案，確認後才存
  const ExcelImport = {
    props: { result: Object, tests: Array, file: String },
    emits: ['close', 'done'],
    data() { return { items: this.result.projects.map((p) => ({ ...p })), filter: 'all', saving: false }; },
    computed: {
      chosen() { return this.items.filter((p) => p.include); },
      shown() {
        if (this.filter === 'warn') return this.items.filter((p) => p.warnings.length || p.unmapped.length);
        if (this.filter === 'change') return this.items.filter((p) => p.action !== 'same');
        return this.items;
      },
      counts() {
        const n = (a) => this.items.filter((p) => p.action === a).length;
        return { new: n('new'), update: n('update'), same: n('same'), warn: this.items.filter((p) => p.warnings.length || p.unmapped.length).length };
      },
      allOn() { return this.shown.length > 0 && this.shown.every((p) => p.include); },
      sheetNote() { return this.result.sheets.map((s) => s.projects ? `${s.name}：${s.projects} 個專案` : `${s.name}：${s.note}`).join('；'); },
    },
    methods: {
      toggleAll() { const v = !this.allOn; for (const p of this.shown) p.include = v; },
      testsOf(p) { return this.tests.filter((t) => p.passed[t.id]).map((t) => t.short + (t.procedures.length > 1 && p.passed[t.id].length < t.procedures.length ? ` ${p.passed[t.id].length}/${t.procedures.length}` : '')).join('、') || '沒有可對應的通過項目'; },
      actionTag(p) { return { new: ['新增', 'green'], update: ['更新', 'orange'], same: ['相同', 'gray'] }[p.action]; },
      async apply() {
        this.saving = true;
        try {
          const r = await post('/api/mil/excel/apply', { items: this.chosen.map((p) => ({ code: p.code, series: p.series, passed: p.passed })) }, { quiet: true });
          this.$emit('done', r);
        } catch (e) { toast('匯入失敗：' + e.message, true); }
        this.saving = false;
      },
    },
    template: `<Modal size="xl" @close="$emit('close')">
      <div class="row" style="margin-top:8px"><Icon name="file-spreadsheet" :size="20" style="color:var(--green)"/><b style="font-size:17px" class="grow">測試排程表識別結果</b><span class="small muted ellipsis" style="max-width:300px">{{ file }}</span></div>
      <div class="small muted">{{ sheetNote }}</div>
      <div class="row wrap" style="gap:18px">
        <div><span class="bold" style="font-size:20px">{{ items.length }}</span> <span class="small muted">個專案</span></div>
        <div><span class="bold" style="font-size:20px;color:var(--green)">{{ counts.new }}</span> <span class="small muted">新增</span></div>
        <div><span class="bold" style="font-size:20px;color:var(--orange)">{{ counts.update }}</span> <span class="small muted">更新（通過項目有變）</span></div>
        <div><span class="bold" style="font-size:20px" class="muted">{{ counts.same }}</span> <span class="small muted">已是最新</span></div>
        <div v-if="counts.warn"><span class="bold" style="font-size:20px;color:var(--red)">{{ counts.warn }}</span> <span class="small muted">需要留意</span></div>
      </div>
      <div v-if="result.unmapped.length" class="card tight col" style="background:color-mix(in srgb, var(--orange) 10%, transparent);gap:4px">
        <b class="small warn row" style="gap:5px"><Icon name="triangle-alert" :size="14"/>這些測試目前沒有對應的測試項目，不會匯入</b>
        <div v-for="u in result.unmapped" :key="u.label" class="small">・{{ u.label }}（{{ u.code }}）— {{ u.projects }} 個專案通過</div>
        <div class="tiny muted">可以先到「測試項目」新增同一個 Method 編號的項目，再重新上傳一次。</div>
      </div>
      <div class="row"><Seg v-model="filter" :options="[{ value: 'all', label: '全部' }, { value: 'change', label: '只看有變更' }, { value: 'warn', label: '只看需要留意' }]"/>
        <span class="spacer"></span><span class="small muted">「通過」＝標示 1 的項目數 ／ 測試總數</span></div>
      <div style="max-height:46vh;overflow:auto;border:1px solid var(--line);border-radius:10px">
        <table class="matrix" style="font-size:12.5px">
          <thead><tr><th style="width:34px"><input type="checkbox" :checked="allOn" @change="toggleAll"></th>
            <th class="model">型號（專案）</th><th>工作表</th><th>系列</th><th>類別</th><th>通過</th><th>結果</th><th style="text-align:left">提醒</th></tr></thead>
          <tbody>
            <tr v-for="p in shown" :key="p.sheet + p.column" :style="p.include ? '' : 'opacity:.55'">
              <td><input type="checkbox" v-model="p.include"></td>
              <td class="model" style="min-width:240px;white-space:normal"><div class="bold">{{ p.code }}</div>
                <div class="tiny muted" style="max-width:300px">{{ testsOf(p) }}</div>
                <div v-if="p.existingDisplay" class="tiny faint">目前資料：{{ p.existingDisplay }}</div></td>
              <td class="small muted">{{ p.sheet }} {{ p.column }}</td>
              <td>{{ p.series || '—' }}</td>
              <td class="small">{{ p.status }}<div class="tiny muted">{{ p.year }}</div></td>
              <td><span class="bold">{{ p.ones }}</span><span class="muted"> / {{ p.total == null ? '?' : p.total }}</span>
                <Icon v-if="p.total === p.ones" name="circle-check" :size="13" style="color:var(--green);margin-left:3px"/>
                <Icon v-else name="circle-alert" :size="13" style="color:var(--red);margin-left:3px"/></td>
              <td><Tag :text="actionTag(p)[0]" :color="actionTag(p)[1]"/></td>
              <td class="small" style="text-align:left;white-space:normal;min-width:200px">
                <div v-for="w in p.warnings" :key="w" class="warn">{{ w }}</div>
                <div v-if="p.unmapped.length" class="warn">未對應：{{ p.unmapped.join('、') }}</div>
                <span v-if="!p.warnings.length && !p.unmapped.length" class="faint">—</span></td>
            </tr>
          </tbody>
        </table>
        <Empty v-if="!shown.length" icon="sheet" title="沒有符合的專案" message=""/>
      </div>
      <div class="tiny muted">匯入只會更新型號的「通過項目」；已經有的型號，名稱、別名、系列等資料不會變。匯入後按「產生知識庫」才會更新客服回答。</div>
      <template #foot><span class="small muted grow">已選 {{ chosen.length }} 款</span>
        <button class="btn" @click="$emit('close')">取消</button>
        <button class="btn primary" :disabled="!chosen.length || saving" @click="apply"><Icon name="check"/>{{ saving ? '匯入中…' : '確認匯入 ' + chosen.length + ' 款' }}</button></template>
    </Modal>`,
  };

  P.milModels = {
    components: { Editor, FamilyRow, TestEditor, ExcelImport },
    data: () => ({ editingTest: null, testIsNew: false, editing: null, isNew: false, generating: false, result: '', error: '', menu: false, urlDialog: false, url: '', importing: false, excel: null, excelFile: '' }),
    computed: {
      mil() { return S.data && S.data.mil; },
      c() { return this.mil ? this.mil.catalog : { models: [], families: [] }; },
      tests() { return this.mil ? this.mil.tests : []; },
    },
    methods: {
      shortDisplay, passes, described,
      tip(m, t) {
        const p = passes(m, t), d = described(m, t);
        if (p.length) return p.map((x) => label(t, x)).join('\n');
        if (d.length) return '只在測試說明中列出：' + d.map((x) => label(t, x)).join('、');
        return '報告中沒有';
      },
      count(m) { return this.tests.filter((t) => passes(m, t).length).length; },
      edit(m) { this.isNew = false; this.editing = m; },
      manual() { this.menu = false; this.isNew = true; this.editing = { code: '', display: '', aliases: [], family: '', passed: {}, describedOnly: {}, reportURL: '', standard: 'MIL-STD-810H' }; },
      pickPDF() { this.menu = false; this.$refs.pdf.click(); },
      pickExcel() { this.menu = false; this.$refs.xlsx.click(); },
      async fromExcel(e) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        this.error = '';
        this.importing = true;
        try {
          const buf = new Uint8Array(await file.arrayBuffer());
          let bin = '';
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
          const r = await post('/api/mil/excel/parse', { base64: btoa(bin) }, { quiet: true });
          if (!r.projects.length) this.error = '這份 Excel 沒有讀到任何專案：請確認是測試排程表格式（D 欄有「Project」與「Method …」）';
          else { this.excelFile = file.name; this.excel = r; }
        } catch (err) {
          this.error = '讀取 Excel 失敗：' + err.message;
        }
        this.importing = false;
      },
      excelDone(r) {
        this.excel = null;
        this.result = `已從 Excel 匯入：新增 ${r.added} 款、更新 ${r.updated} 款，按「產生知識庫」就會更新客服回答`;
        toast('已匯入 🎉');
      },
      async fromFile(e) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const buf = new Uint8Array(await file.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        await this.importReport({ base64: btoa(bin) });
      },
      async fromURL() {
        const url = this.url.trim();
        if (!/^https?:\/\//.test(url)) { toast('請貼上 http(s) 開頭的網址', true); return; }
        this.urlDialog = false;
        await this.importReport({ url });
        this.url = '';
      },
      async importReport(body) {
        this.error = '';
        this.importing = true;
        try {
          const r = await post('/api/mil/parse', body, { quiet: true });
          const code = r.codeGuess || '';
          this.isNew = true;
          this.editing = {
            code, display: code ? `ExpertBook（${code}）` : '', aliases: code ? [code] : [], family: '',
            passed: r.passed || {}, describedOnly: r.describedOnly || {}, reportURL: body.url || '', standard: 'MIL-STD-810H',
          };
          if (!Object.keys(r.passed || {}).length) this.error = '這份 PDF 讀不到測試項目，請手動勾選';
          else toast('已讀取報告，請確認勾選結果後儲存');
        } catch (e) {
          this.error = '匯入失敗：' + e.message;
        }
        this.importing = false;
      },
      async generate() {
        this.generating = true;
        try {
          const r = await post('/api/mil/generate');
          this.result = `已產生 ${r.faqs} 題 FAQ（取代舊的 ${r.removed} 題${r.kept ? `，保留你手動修改的 ${r.kept} 題` : ''}）、背景知識 ${r.paragraphs} 段，向量索引已更新`;
          toast('知識庫已更新 🎉');
        } finally { this.generating = false; }
      },
      newTest() { this.testIsNew = true; this.editingTest = { id: '', code: '', name: '', short: '', procedures: [], aliases: [] }; },
      editTest(t) { this.testIsNew = false; this.editingTest = t; },
      usedBy(t) { return this.c.models.filter((m) => passes(m, t).length || described(m, t).length).length; },
      moveTest(t, dir) { post('/api/mil/test/move', { tid: t.id, dir }, { quiet: true }); },
      resetTests() {
        if (confirm('把測試項目還原成內建的 13 項？\n自己新增的項目會刪除，機種上對應的勾選也會清掉。')) post('/api/mil/tests/reset', {}, { success: '已還原預設測試項目' });
      },
      addFamily() { post('/api/mil/family/save', { family: { name: '新系列', aliases: [] } }); },
      members(f) { return this.c.models.filter((m) => m.family === f.name).length; },
    },
    template: `<div class="page wide" style="max-width:1240px">
      <PageHead section="milModels" subtitle="華碩商用筆電 MIL-STD-810H 機種與測試項目，改完按「產生」就會更新 FAQ 與背景知識"/>
      <input type="file" ref="pdf" accept="application/pdf,.pdf" style="display:none" @change="fromFile">
      <input type="file" ref="xlsx" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" @change="fromExcel">
      <div class="card tight row wrap" v-if="mil">
        <div class="grow col" style="gap:3px">
          <b>共 {{ c.models.length }} 款機種</b>
          <div v-if="mil.needsRegenerate" class="small warn row" style="gap:5px"><Icon name="circle-alert" :size="14"/>機種資料有變更，按「產生知識庫」才會更新到客服回答</div>
          <div v-else-if="c.lastGenerated" class="small ok-text row" style="gap:5px"><Icon name="circle-check" :size="14"/>知識庫已是最新（{{ shortDisplay(c.lastGenerated) }} 產生）</div>
          <div v-if="result" class="small muted">{{ result }}</div>
        </div>
        <div style="position:relative">
          <button class="btn" :disabled="importing" @click="menu = !menu"><Icon name="plus"/>{{ importing ? '讀取中…' : '新增機種' }}</button>
          <div class="menu" v-if="menu" style="right:0;top:36px" @mouseleave="menu = false">
            <button @click="manual"><Icon name="pencil"/>手動新增</button>
            <button @click="pickPDF"><Icon name="file-up"/>從報告 PDF 檔新增…</button>
            <button @click="menu = false; urlDialog = true"><Icon name="link-2"/>從報告網址新增…</button>
            <button @click="pickExcel"><Icon name="file-spreadsheet"/>從測試排程表 Excel 匯入…</button>
          </div>
        </div>
        <button class="btn" :class="mil.needsRegenerate ? '' : 'primary'" :style="mil.needsRegenerate ? 'background:var(--orange);color:#fff;border-color:transparent' : ''"
          :disabled="generating || !c.models.length" @click="generate"><Icon name="wand-sparkles"/>{{ generating ? '產生中…' : '產生知識庫' }}</button>
      </div>
      <div v-if="error" class="err">{{ error }}</div>

      <div class="card" style="padding:0">
        <div class="matrix-wrap">
          <table class="matrix">
            <thead><tr><th class="model" style="padding-left:12px">機種</th>
              <th v-for="t in tests" :key="t.id"><div>{{ t.short }}</div><div class="tiny faint" style="font-weight:400">{{ t.code }}</div></th><th>項目</th></tr></thead>
            <tbody>
              <tr v-for="m in c.models" :key="m.id">
                <td class="model" style="padding-left:12px;cursor:pointer;min-width:220px" title="點一下編輯" @click="edit(m)">
                  <div class="bold">{{ m.code }}</div><div class="tiny muted ellipsis" style="max-width:220px">{{ m.display }}</div>
                  <Tag v-if="m.family" :text="m.family" color="indigo"/></td>
                <td v-for="t in tests" :key="t.id" :title="tip(m, t)">
                  <template v-if="passes(m, t).length"><Icon name="circle-check" style="color:var(--green)"/>
                    <div v-if="t.procedures.length > 1" class="partial">{{ passes(m, t).length }}/{{ t.procedures.length }}</div></template>
                  <Icon v-else-if="described(m, t).length" name="file-text" style="color:var(--orange)"/>
                  <span v-else class="faint">—</span>
                </td>
                <td class="bold">{{ count(m) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Empty v-if="!c.models.length" icon="shield-check" title="還沒有機種" message="按「新增機種」，可以直接匯入華碩官方測試報告 PDF"/>
      </div>
      <div class="row wrap small">
        <span class="row" style="gap:4px;color:var(--green)"><Icon name="circle-check" :size="14"/>通過（數字＝通過的程序數）</span>
        <span class="row" style="gap:4px;color:var(--orange)"><Icon name="file-text" :size="14"/>只在測試說明中列出</span>
        <span class="muted">— 報告中沒有</span><span class="spacer"></span><span class="muted">點機種名稱可以編輯</span>
      </div>

      <div class="card col">
        <div class="row wrap"><h3 style="margin:0">測試項目</h3>
          <span class="small muted grow">表格的每一欄。可以新增報告裡的新測試，或修改條件文字與顧客的說法；改完按「產生知識庫」就會更新回答</span>
          <button v-if="mil && mil.customTests" class="btn" @click="resetTests">還原預設</button>
          <button class="btn primary" @click="newTest"><Icon name="plus"/>新增測試項目</button></div>
        <div v-for="(t, i) in tests" :key="t.id" class="row" style="padding:6px 0;border-bottom:1px solid var(--line)">
          <span class="tag" style="background:var(--hover);min-width:52px;justify-content:center">{{ t.code }}</span>
          <div class="grow" style="min-width:0"><b>{{ t.short }}</b>
            <div class="tiny muted ellipsis">{{ t.procedures.map((p) => p.label).join('、') }}</div></div>
          <span class="small muted">{{ usedBy(t) }} 款</span>
          <button class="btn plain" title="上移" :disabled="i === 0" @click="moveTest(t, -1)">↑</button>
          <button class="btn plain" title="下移" :disabled="i === tests.length - 1" @click="moveTest(t, 1)">↓</button>
          <button class="btn sm" @click="editTest(t)"><Icon name="pencil"/>編輯</button>
        </div>
      </div>

      <div class="card col">
        <div class="row wrap"><h3 style="margin:0">系列</h3>
          <span class="small muted grow">同一系列有好幾份報告時（例如 B1400／B1500 與 B1400CBA），顧客問「B1 有沒有…」會把各款結果一起列出</span>
          <button class="btn" @click="addFamily">新增系列</button></div>
        <FamilyRow v-for="f in c.families" :key="f.id" :f="f" :members="members(f)"/>
      </div>

      <TestEditor v-if="editingTest" :test="editingTest" :isNew="testIsNew" :used="usedBy(editingTest)" @close="editingTest = null"/>
      <Editor v-if="editing" :model="editing" :tests="tests" :families="c.families.map((f) => f.name)" :isNew="isNew" @close="editing = null"/>
      <ExcelImport v-if="excel" :result="excel" :tests="tests" :file="excelFile" @close="excel = null" @done="excelDone"/>
      <Modal v-if="urlDialog" title="從報告網址新增" @close="urlDialog = false">
        <div class="small muted">貼上華碩官方 MIL-STD-810H 測試報告 PDF 的網址，例如 https://www.asus.com/event/militarygradereport/….pdf</div>
        <input type="url" v-model="url" placeholder="https://" @keydown.enter="fromURL">
        <template #foot><button class="btn" @click="urlDialog = false">取消</button><button class="btn primary" :disabled="!url.trim()" @click="fromURL">讀取報告</button></template>
      </Modal>
    </div>`,
  };
})();
