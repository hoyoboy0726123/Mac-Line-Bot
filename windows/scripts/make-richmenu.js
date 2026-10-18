'use strict';
// 產生圖文選單圖片（2500×843）：npx electron scripts/make-richmenu.js
// 會寫出 src/core/assets/richmenu-<edition>.png；MIL 版另外寫一份給 Mac 版用的 Swift 檔（--swift=<路徑>）

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const edition = require('../edition.json');
const { buttons } = require('../src/core/richmenu');

const ROOT = path.join(__dirname, '..');
const iconsDir = path.join(path.dirname(require.resolve('lucide-static/package.json')), 'icons');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 300, height: 300 });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const list = buttons().map((b) => ({ ...b, svg: fs.readFileSync(path.join(iconsDir, `${b.icon}.svg`), 'utf8').replace(/<!--.*?-->/s, '').replace(/currentColor/g, '#FFFFFF') }));
  const url = await win.webContents.executeJavaScript(`(async () => {
    const W = 2500, H = 843, items = ${JSON.stringify(list)};
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#F4F6F8'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#06C755'; g.fillRect(0, 0, W, 10);
    const w = W / items.length;
    for (let i = 0; i < items.length; i++) {
      const b = items[i], x = i * w;
      g.fillStyle = '#FFFFFF'; g.beginPath(); g.roundRect(x + 24, 44, w - 48, H - 84, 44); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.06)'; g.lineWidth = 3; g.stroke();
      const cx = x + w / 2, cy = 290, r = 140;
      g.fillStyle = b.color; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(b.svg.replace('width="24"', 'width="160"').replace('height="24"', 'height="160"'));
      await img.decode();
      g.drawImage(img, cx - 80, cy - 80, 160, 160);
      g.fillStyle = '#1D1D1F'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.font = 'bold 104px "PingFang TC", "Microsoft JhengHei", sans-serif'; g.fillText(b.label, cx, 590);
      g.fillStyle = '#8C8C8C'; g.font = '56px "Helvetica Neue", "Segoe UI", sans-serif'; g.fillText(b.sub, cx, 680);
    }
    return c.toDataURL('image/png');
  })()`);
  const png = Buffer.from(url.split(',')[1], 'base64');
  const out = path.join(ROOT, 'src', 'core', 'assets', `richmenu-${edition.edition === 'mil' ? 'mil' : 'base'}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png);
  console.log('寫出', out, png.length, 'bytes');
  const swift = process.argv.find((a) => a.startsWith('--swift='));
  if (swift) {
    const file = swift.split('=')[1];
    fs.writeFileSync(file, `// 自動產生（windows/scripts/make-richmenu.js），請勿手動修改\nimport Foundation\n\nenum RichMenuImage {\n    static let png = Data(base64Encoded: "${png.toString('base64')}")!\n}\n`);
    console.log('寫出', file);
  }
  app.quit();
});
