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

  P.milModels = {
    components: { Editor, FamilyRow },
    data: () => ({ editing: null, isNew: false, generating: false, result: '', error: '', menu: false, urlDialog: false, url: '', importing: false }),
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
          this.result = `已產生 ${r.faqs} 題 FAQ（取代舊的 ${r.removed} 題）、背景知識 ${r.paragraphs} 段，向量索引已更新`;
          toast('知識庫已更新 🎉');
        } finally { this.generating = false; }
      },
      addFamily() { post('/api/mil/family/save', { family: { name: '新系列', aliases: [] } }); },
      members(f) { return this.c.models.filter((m) => m.family === f.name).length; },
    },
    template: `<div class="page wide" style="max-width:1240px">
      <PageHead section="milModels" subtitle="華碩商用筆電 MIL-STD-810H 機種與測試項目，改完按「產生」就會更新 FAQ 與背景知識"/>
      <input type="file" ref="pdf" accept="application/pdf,.pdf" style="display:none" @change="fromFile">
      <div class="card tight row wrap" v-if="mil">
        <div class="grow col" style="gap:3px">
          <b>共 {{ c.models.length }} 款機種</b>
          <div v-if="mil.needsRegenerate" class="small warn row" style="gap:5px"><Icon name="circle-alert" :size="14"/>機種資料有變更，按「產生知識庫」才會更新到客服回答</div>
          <div v-else-if="c.lastGenerated" class="small ok-text row" style="gap:5px"><Icon name="circle-check" :size="14"/>知識庫已是最新（{{ shortDisplay(c.lastGenerated) }} 產生）</div>
          <div v-if="result" class="small muted">{{ result }}</div>
        </div>
        <div style="position:relative">
          <button class="btn" :disabled="importing" @click="menu = !menu"><Icon name="plus"/>{{ importing ? '讀取報告中…' : '新增機種' }}</button>
          <div class="menu" v-if="menu" style="right:0;top:36px" @mouseleave="menu = false">
            <button @click="manual"><Icon name="pencil"/>手動新增</button>
            <button @click="pickPDF"><Icon name="file-up"/>從報告 PDF 檔新增…</button>
            <button @click="menu = false; urlDialog = true"><Icon name="link-2"/>從報告網址新增…</button>
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
        <div class="row wrap"><h3 style="margin:0">系列</h3>
          <span class="small muted grow">同一系列有好幾份報告時（例如 B1400／B1500 與 B1400CBA），顧客問「B1 有沒有…」會把各款結果一起列出</span>
          <button class="btn" @click="addFamily">新增系列</button></div>
        <FamilyRow v-for="f in c.families" :key="f.id" :f="f" :members="members(f)"/>
      </div>

      <Editor v-if="editing" :model="editing" :tests="tests" :families="c.families.map((f) => f.name)" :isNew="isNew" @close="editing = null"/>
      <Modal v-if="urlDialog" title="從報告網址新增" @close="urlDialog = false">
        <div class="small muted">貼上華碩官方 MIL-STD-810H 測試報告 PDF 的網址，例如 https://www.asus.com/event/militarygradereport/….pdf</div>
        <input type="url" v-model="url" placeholder="https://" @keydown.enter="fromURL">
        <template #foot><button class="btn" @click="urlDialog = false">取消</button><button class="btn primary" :disabled="!url.trim()" @click="fromURL">讀取報告</button></template>
      </Modal>
    </div>`,
  };
})();
