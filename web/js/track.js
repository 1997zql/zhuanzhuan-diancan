// 前端埋点：会话/设备标识 + 全链路事件上报（sendBeacon 优先，失败静默）
let sid;
try {
  sid = crypto.randomUUID ? crypto.randomUUID() : `s${Date.now()}${Math.floor(Math.random() * 1e6)}`;
} catch (e) {
  sid = `s${Date.now()}`;
}

export let cid = localStorage.getItem('zzdc.cid');
if (!cid) {
  try {
    cid = crypto.randomUUID ? crypto.randomUUID() : `c${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  } catch (e) {
    cid = `c${Date.now()}`;
  }
  localStorage.setItem('zzdc.cid', cid);
}

const STATIC_KEY = 'zzdc.localfunnel.v1';

/** 静态模式本地漏斗：无后端时把关键事件累计在本地 */
function bumpLocalFunnel(event) {
  try {
    const f = JSON.parse(localStorage.getItem(STATIC_KEY) || '{}');
    f[event] = (f[event] || 0) + 1;
    f._last = Date.now();
    localStorage.setItem(STATIC_KEY, JSON.stringify(f));
  } catch (e) { /* 忽略 */ }
}

export function localFunnel() {
  try { return JSON.parse(localStorage.getItem(STATIC_KEY) || '{}'); } catch (e) { return {}; }
}

export function track(event, props = {}) {
  const payload = { event, sid, cid, ...props };
  bumpLocalFunnel(event);
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    } else {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    }
  } catch (e) {
    /* 埋点失败静默，不影响业务 */
  }
}
