'use strict';
// 雲端版不需要 Cloudflare Tunnel：Worker 本身就有固定的公開網址。
// 保留 TunnelManager 的介面，狀態永遠是「運作中」，publicURL 由 Durable Object 依第一個請求的網址設定。

const { EventEmitter } = require('events');

const STATE_LABEL = { stopped: '已停止', starting: '連線中', running: '雲端運作中', failed: '連線失敗' };

class TunnelManager extends EventEmitter {
  constructor() {
    super();
    this.state = 'running';
    this.error = '';
    this.publicURL = null;
    this.pid = null;
  }
  start() { this.state = 'running'; this.emit('change'); }
  stop() {}
  restart() {}
}

const locate = () => 'Cloudflare Workers';
const install = async () => locate();
const cleanHost = (h) => String(h || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const bundledPath = () => '';

module.exports = { TunnelManager, locate, install, cleanHost, STATE_LABEL, bundledPath };
