'use strict';
// 管理 cloudflared：Quick Tunnel（xxx.trycloudflare.com）或自訂網域的 named tunnel（對照 Mac 版 TunnelManager.swift）

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const store = require('./store');

const isWin = process.platform === 'win32';
const exeName = isWin ? 'cloudflared.exe' : 'cloudflared';

const STATE_LABEL = { stopped: '已停止', starting: '連線中', running: '已連線', failed: '連線失敗' };

function bundledPath() { return path.join(store.binDir(), exeName); }

function isExecutable(p) {
  try {
    fs.accessSync(p, isWin ? fs.constants.F_OK : fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch { return false; }
}

/// 找 cloudflared：自訂路徑 → App 資料夾 → 常見安裝位置 → PATH
function locate(custom = '') {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = isWin
    ? [custom, bundledPath(), path.join(pf86, 'cloudflared', 'cloudflared.exe'), path.join(pf, 'cloudflared', 'cloudflared.exe')]
    : [custom, bundledPath(), '/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared', '/usr/bin/cloudflared'];
  const found = candidates.find((p) => p && isExecutable(p));
  if (found) return found;
  try {
    const out = execFileSync(isWin ? 'where' : 'which', ['cloudflared'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const first = out.split(/\r?\n/).find((l) => l.trim());
    if (first && isExecutable(first.trim())) return first.trim();
  } catch { /* 沒有安裝 */ }
  return null;
}

/// 直接從 Cloudflare 官方 GitHub 下載 cloudflared 放到 App 資料夾
async function install() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const asset = isWin ? 'cloudflared-windows-amd64.exe'
    : process.platform === 'darwin' ? `cloudflared-darwin-${arch}.tgz` : `cloudflared-linux-${arch}`;
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (res.status !== 200) throw new Error('下載 cloudflared 失敗');
  const data = Buffer.from(await res.arrayBuffer());
  const target = bundledPath();
  if (asset.endsWith('.tgz')) {
    const tmp = path.join(store.binDir(), 'cloudflared.tgz');
    fs.writeFileSync(tmp, data);
    execFileSync('tar', ['-xzf', tmp, '-C', store.binDir()]);
    fs.unlinkSync(tmp);
  } else {
    fs.writeFileSync(target + '.download', data);
    fs.renameSync(target + '.download', target);
  }
  if (!fs.existsSync(target)) throw new Error('解壓縮 cloudflared 失敗');
  if (!isWin) fs.chmodSync(target, 0o755);
  return target;
}

function cleanHost(host) {
  let h = (host || '').trim();
  for (const p of ['https://', 'http://']) if (h.startsWith(p)) h = h.slice(p.length);
  return h.replace(/\/+$/, '');
}

/// cloudflared 格式：2024-01-01T00:00:00Z INF xxx
function shorten(line) {
  const parts = line.split(' ');
  return parts.length >= 3 ? parts.slice(2).join(' ') : line;
}

const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

class TunnelManager extends EventEmitter {
  constructor() {
    super();
    this.state = 'stopped';
    this.error = '';
    this.publicURL = null;
    this.connectionCount = 0;
    this.pid = null;
    this.proc = null;
    this.shouldRun = false;
    this.restartDelay = 3;
    this.lastConfig = null;
    this.restartTimer = null;
  }

  log(level, msg) { this.emit('log', level, msg); }
  setState(s, error = '') { this.state = s; this.error = error; this.emit('change'); }

  start({ port, mode, token, hostname, customPath }) {
    this.stopProcess();
    this.shouldRun = true;
    this.lastConfig = { port, mode, token, hostname, customPath };
    const binary = locate(customPath);
    if (!binary) {
      this.setState('failed', '找不到 cloudflared，請到「LINE 連線」頁面一鍵安裝');
      this.log('error', '找不到 cloudflared');
      return;
    }
    let args;
    if (mode === 'named') {
      if (!token || !hostname) { this.setState('failed', '自訂網域模式需要 Tunnel Token 與網域'); return; }
      args = ['tunnel', '--no-autoupdate', 'run', '--token', token];
      this.publicURL = 'https://' + cleanHost(hostname);
    } else {
      args = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`];
    }

    this.connectionCount = 0;
    this.setState('starting');
    let p;
    try {
      p = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      this.setState('failed', e.message);
      this.log('error', `cloudflared 啟動失敗：${e.message}`);
      return;
    }
    this.proc = p;
    this.pid = p.pid;
    this.log('info', `cloudflared 已啟動 pid ${p.pid}`);
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) if (p === this.proc) this.consume(line);
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => {
      if (p !== this.proc) return;
      this.setState('failed', e.message);
      this.log('error', `cloudflared 啟動失敗：${e.message}`);
    });
    p.on('exit', (code) => this.handleExit(p, code));
  }

  restart() { if (this.lastConfig) this.start(this.lastConfig); }

  stop() {
    this.shouldRun = false;
    this.stopProcess();
    if (this.lastConfig && this.lastConfig.mode === 'quick') this.publicURL = null;
    this.setState('stopped');
  }

  stopProcess() {
    clearTimeout(this.restartTimer);
    const p = this.proc;
    this.proc = null;
    this.pid = null;
    if (p && p.exitCode == null) { try { p.kill(); } catch { /* 已結束 */ } }
  }

  consume(line) {
    const m = QUICK_URL.exec(line);
    if (m && m[0] !== this.publicURL && !m[0].includes('api.trycloudflare.com')) {
      this.publicURL = m[0];
      this.log('info', `Quick Tunnel 網址：${m[0]}，等待 DNS 生效`);
      this.emit('url', m[0]);
      this.emit('change');
    }
    if (line.includes('Registered tunnel connection')) {
      this.connectionCount += 1;
      this.restartDelay = 3;
      this.setState('running');
      this.log('info', shorten(line));
      if (this.lastConfig && this.lastConfig.mode === 'named' && this.connectionCount === 1 && this.publicURL) this.emit('url', this.publicURL);
    } else if (line.includes(' ERR ')) {
      this.log('warning', shorten(line));
    }
  }

  handleExit(p, code) {
    if (p !== this.proc) return;
    this.proc = null;
    this.pid = null;
    const message = `cloudflared 已結束（代碼 ${code}）`;
    this.log('warning', message);
    if (!this.shouldRun) { this.setState('stopped'); return; }
    this.setState('failed', message);
    this.emit('disconnect', message);
    const delay = this.restartDelay;
    this.restartDelay = Math.min(this.restartDelay * 2, 60);
    this.restartTimer = setTimeout(() => {
      if (!this.shouldRun || this.proc) return;
      this.log('info', '嘗試重新連線 Tunnel…');
      this.restart();
    }, delay * 1000);
  }
}

module.exports = { TunnelManager, locate, install, cleanHost, STATE_LABEL, bundledPath };
