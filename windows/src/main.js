'use strict';
// Electron 主程式：開視窗、右下角通知區域圖示、開機自動啟動、關視窗後在背景繼續運作

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, safeStorage, powerSaveBlocker, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const edition = require('../edition.json');
const { createCore } = require('./core');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(1);
const flag = (name) => { const a = argv.find((x) => x.startsWith(`--${name}`)); return a ? (a.split('=')[1] || true) : null; };
const screenshotDir = flag('screenshots');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId(`com.hoyoboy.maclinebot.windows.${edition.edition}`);

let core = null, win = null, tray = null, quitting = false, hintShown = false;

const icon = (name) => nativeImage.createFromPath(path.join(ROOT, 'build', name));

function adminURL() { return `http://127.0.0.1:${core.app.settings.adminPort}/`; }

function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 980, minHeight: 640, show: false,
    title: edition.productName, icon: icon('icon.png'), autoHideMenuBar: true,
    backgroundColor: '#f3f4f7',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.removeMenu();
  // 外部連結用預設瀏覽器開
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${core.app.settings.adminPort}`)) { e.preventDefault(); shell.openExternal(url); }
  });
  win.webContents.on('did-fail-load', () => setTimeout(() => win && win.loadURL(adminURL()), 1500));
  win.loadURL(adminURL());
  win.once('ready-to-show', () => { if (show) win.show(); });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!hintShown && Notification.isSupported()) {
      hintShown = true;
      new Notification({ title: edition.productName, body: '仍在背景運作中，LINE 訊息會繼續自動回覆。從右下角的圖示可以再打開。' }).show();
    }
  });
}

function showWindow() {
  if (!win) createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function trayMenu() {
  const a = core.app;
  const h = a.health();
  return Menu.buildFromTemplate([
    { label: `${edition.productName}：${h.level === 'ok' ? '正常運作' : h.title}`, enabled: false },
    { type: 'separator' },
    { label: `打開 ${edition.productName}`, click: showWindow },
    { label: 'AI 自動回覆', type: 'checkbox', checked: a.settings.aiAutoReply, click: (item) => a.updateSettings({ aiAutoReply: item.checked }) },
    { label: '重啟 Tunnel', click: () => a.startTunnel() },
    { type: 'separator' },
    { label: '結束', click: () => { quitting = true; app.quit(); } },
  ]);
}

let trayTimer = null;
function updateTray() {
  if (!tray || trayTimer) return;
  trayTimer = setTimeout(() => {
    trayTimer = null;
    const h = core.app.health();
    tray.setToolTip(`${edition.productName}\n${h.level === 'ok' ? '正常運作' : h.title}`);
    tray.setContextMenu(trayMenu());
  }, 500);
}

function createTray() {
  tray = new Tray(icon(process.platform === 'darwin' ? 'tray-mac.png' : 'tray.png'));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  updateTray();
}

/// 測試用：依序打開每一頁並截圖（CI 在 Windows 上跑，讓我們看到真正的畫面）
async function takeScreenshots(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const wc = win.webContents;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  win.setSize(1280, 860);
  win.show();
  await wait(2500);
  const shot = async (name) => { const img = await wc.capturePage(); fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG()); };
  const js = (code) => wc.executeJavaScript(code, true);
  if (await js('MLB.S.showWizard')) {
    for (let i = 0; i < 7; i++) {
      await js(`MLB.wizard.step = ${i}`);
      await wait(600);
      await shot(`wizard-${i + 1}`);
    }
    await js('MLB.S.showWizard = false');
  }
  const sections = ['overview', 'conversations', 'reservations', 'usage', 'milModels', 'knowledge', 'store', 'rules', 'line', 'accounts', 'system'];
  for (const s of sections) {
    if (s === 'milModels' && edition.edition !== 'mil') continue;
    await js(`MLB.S.section = '${s}'`);
    await wait(1200);
    await shot(s);
    // 軍規機種：新增選單與編輯畫面
    if (s === 'milModels' && await js(`!!document.querySelector('td.model')`)) {
      await js(`[...document.querySelectorAll('.page button')].find((b) => b.textContent.includes('新增機種')).click()`);
      await wait(500);
      await shot('milModels-add');
      await js(`document.querySelector('.menu button').click()`);
      await wait(800);
      await shot('milModels-new');
      await js(`[...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === '取消').click()`);
      await wait(500);
      await js(`document.querySelector('td.model').click()`);
      await wait(800);
      await shot('milModels-edit');
      await js(`document.querySelector('.modal .m-body').scrollTop = 520`);
      await wait(400);
      await shot('milModels-edit2');
      await js(`[...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === '取消').click()`);
      await wait(500);
      await js(`document.querySelector('.main').scrollTop = 900`);
      await wait(500);
      await shot('milModels-tests');
      await js(`[...document.querySelectorAll('.page button')].find((b) => b.textContent.includes('新增測試項目')).click()`);
      await wait(800);
      await shot('milModels-test-new');
      await js(`[...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === '取消').click()`);
      await wait(500);
      // 測試排程表 Excel 匯入的識別結果（--screenshot-xlsx=檔案）
      const xlsx = flag('screenshot-xlsx');
      if (xlsx && fs.existsSync(xlsx)) {
        const b64 = fs.readFileSync(xlsx).toString('base64');
        await js(`(() => { const bin = atob('${b64}'); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
          const dt = new DataTransfer(); dt.items.add(new File([u], '${path.basename(xlsx)}'));
          const input = document.querySelector('input[accept^=".xlsx"]'); input.files = dt.files; input.dispatchEvent(new Event('change')); })()`);
        await wait(1500);
        await shot('milModels-excel');
        await js(`[...document.querySelectorAll('.modal .seg button')].find((b) => b.textContent.includes('需要留意')).click()`);
        await wait(400);
        await shot('milModels-excel2');
        await js(`[...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === '取消').click()`);
        await wait(500);
      }
    }
  }
  win.setMinimumSize(320, 400);
  win.setSize(420, 860);
  await js(`MLB.S.section = 'overview'`);
  await wait(1200);
  await shot('mobile-overview');
  quitting = true;
  app.quit();
}

app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; if (core) core.stop(); });
app.on('window-all-closed', (e) => { if (!quitting) e.preventDefault(); });

app.whenReady().then(async () => {
  const dataDir = process.env.MLB_DATA_DIR || path.join(app.getPath('userData'), 'data');
  // Windows 用 DPAPI 加密 LINE 金鑰；其他平台（開發測試）用一般檔案
  const cipher = process.platform === 'win32' && safeStorage.isEncryptionAvailable()
    ? { encrypt: (s) => safeStorage.encryptString(s), decrypt: (b) => safeStorage.decryptString(b) } : null;
  core = createCore({ dataDir, cipher });
  core.app.hooks = {
    openPath: (p) => shell.openPath(p),
    getLoginItem: () => app.getLoginItemSettings().openAtLogin,
    setLoginItem: (v) => app.setLoginItemSettings({ openAtLogin: v, args: ['--hidden'] }),
  };
  await core.start();
  powerSaveBlocker.start('prevent-app-suspension');
  createWindow(!argv.includes('--hidden'));
  createTray();
  core.app.on('change', updateTray);
  if (screenshotDir) win.webContents.once('did-finish-load', () => takeScreenshots(screenshotDir).catch((e) => { console.error(e); app.exit(1); }));
});
