// 打包：把共用核心（../windows/src/core）和雲端替換模組（src/shims）打成一個 Worker 檔
// 另外把管理介面網頁複製到 dist/public（Workers Static Assets）
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const here = path.dirname(new URL(import.meta.url).pathname);
const core = path.join(here, '../windows/src/core');
const web = path.join(here, '../windows/src/web');
const shims = path.join(here, 'src/shims');
const require = createRequire(import.meta.url);

// 核心模組裡要換成雲端版的
const REPLACE = { './store': 'store.cjs', './vectors': 'vectors.cjs', './ollama': 'ollama.cjs', './tunnel': 'tunnel.cjs', './servers': 'servers.cjs' };
const BUILTIN = ['crypto', 'events', 'zlib', 'path', 'url', 'buffer', 'util', 'stream'];
const EMPTY = ['os', 'http', 'https', 'child_process', 'net', 'tls'];

const cloudPlugin = {
  name: 'cloud',
  setup(b) {
    b.onResolve({ filter: /^\.\/(store|vectors|ollama|tunnel|servers)$/ }, (a) => (a.importer.startsWith(core) ? { path: path.join(shims, REPLACE[a.path]) } : undefined));
    b.onResolve({ filter: /^(node:)?fs$/ }, () => ({ path: path.join(shims, 'fs.js') }));
    b.onResolve({ filter: new RegExp(`^(node:)?(${BUILTIN.join('|')})$`) }, (a) => (a.namespace === 'builtin' ? { path: a.path, external: true } : { path: a.path.replace(/^node:/, ''), namespace: 'builtin' }));
    b.onLoad({ filter: /.*/, namespace: 'builtin' }, (a) => ({ contents: `export * from 'node:${a.path}'; export { default } from 'node:${a.path}';`, loader: 'js', resolveDir: here }));
    b.onResolve({ filter: new RegExp(`^(node:)?(${EMPTY.join('|')})$`) }, () => ({ path: 'empty', namespace: 'empty' }));
    b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'export default {};', loader: 'js' }));
  },
};

await build({
  entryPoints: [path.join(here, 'src/worker.js')],
  outfile: path.join(here, 'dist/worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  mainFields: ['module', 'main'],
  external: ['cloudflare:*', 'node:*'],
  loader: { '.png': 'binary' },
  // 核心有用 __dirname 找圖文選單圖片；雲端版由 shims/fs.js 依檔名提供內嵌的圖片
  define: { __dirname: '"/bundle/core"', __filename: '"/bundle/core/index.js"' },
  plugins: [cloudPlugin],
  logLevel: 'warning',
  legalComments: 'none',
});

// MARK: 靜態網頁
const pub = path.join(here, 'dist/public');
fs.rmSync(pub, { recursive: true, force: true });
fs.mkdirSync(path.join(pub, 'vendor'), { recursive: true });
fs.mkdirSync(path.join(pub, 'icons'), { recursive: true });
for (const f of fs.readdirSync(web)) fs.copyFileSync(path.join(web, f), path.join(pub, f));
fs.copyFileSync(require.resolve('vue/dist/vue.global.prod.js'), path.join(pub, 'vendor/vue.js'));
const icons = path.join(path.dirname(require.resolve('lucide-static/package.json')), 'icons');
for (const f of fs.readdirSync(icons)) if (f.endsWith('.svg')) fs.copyFileSync(path.join(icons, f), path.join(pub, 'icons', f));
fs.copyFileSync(path.join(core, 'assets/richmenu-mil.png'), path.join(pub, 'richmenu.png'));
const size = (fs.statSync(path.join(here, 'dist/worker.js')).size / 1024).toFixed(0);
console.log(`✅ 打包完成：dist/worker.js ${size} KB、網頁 ${fs.readdirSync(pub).length} 項`);
