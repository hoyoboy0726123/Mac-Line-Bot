'use strict';
// 產生 App 圖示：npx electron scripts/make-icon.js
// 綠色圓角方塊 + 白色店面圖示（MIL 版右下角加一個盾牌）

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const edition = require('../edition.json');

const ROOT = path.join(__dirname, '..');
const storePaths = [
  'M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5',
  'M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244',
  'M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05',
];
const shield = 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z';

function draw(size, { tray = false } = {}) {
  return `(() => {
    const s = ${size}; const c = document.createElement('canvas'); c.width = s; c.height = s; const g = c.getContext('2d');
    const r = s * ${tray ? 0.22 : 0.23}, pad = s * ${tray ? 0.02 : 0.06};
    g.beginPath(); g.roundRect(pad, pad, s - pad * 2, s - pad * 2, r);
    const grad = g.createLinearGradient(0, 0, 0, s); grad.addColorStop(0, '#2fe07a'); grad.addColorStop(1, '#04a847');
    g.fillStyle = grad; g.fill();
    const k = (s - pad * 2) * 0.6 / 24, o = (s - 24 * k) / 2;
    g.save(); g.translate(o, o * 1.02); g.scale(k, k);
    g.strokeStyle = '#fff'; g.lineWidth = ${tray ? 2.6 : 2}; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const d of ${JSON.stringify(storePaths)}) g.stroke(new Path2D(d));
    g.restore();
    if (${edition.edition === 'mil' && !tray}) {
      const b = s * 0.36, x = s - b - pad * 0.6, y = s - b - pad * 0.6, q = b / 24;
      g.save(); g.translate(x, y); g.scale(q, q);
      g.fillStyle = '#0f8fa8'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.lineJoin = 'round';
      const p = new Path2D('${shield}'); g.fill(p); g.stroke(p);
      g.strokeStyle = '#fff'; g.lineWidth = 2.4; g.lineCap = 'round'; g.stroke(new Path2D('m9 12 2 2 4-4'));
      g.restore();
    }
    return c.toDataURL('image/png');
  })()`;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 200, height: 200 });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const save = async (file, size, opts) => {
    const url = await win.webContents.executeJavaScript(draw(size, opts));
    fs.writeFileSync(path.join(ROOT, file), Buffer.from(url.split(',')[1], 'base64'));
    console.log('寫出', file);
  };
  await save('build/icon.png', 512);
  await save('build/tray.png', 32, { tray: true });
  await save('build/tray-mac.png', 22, { tray: true });
  await save('src/web/icon.png', 128);
  app.quit();
});
