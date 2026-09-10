// UI 基础设施：弹层 / Toast / 音效 / 格式化

export const fmt = (n) => (Number(n) === 0 ? '¥0' : `¥${Number.isInteger(Number(n)) ? n : Number(n).toFixed(1)}`);

/** 金额展示：0 → 免费 */
export const priceText = (n) => (Number(n) === 0 ? '免费' : fmt(n));

/** 数值缺失（高德 POI 未返回评分/人均等）时的占位展示 */
export const fmtOr = (v, dash = '—') => (v == null ? dash : fmt(v));
export const numOr = (v, dash = '—') => (v == null ? dash : String(v));

export function distText(m) {
  return m >= 1000 ? (m / 1000).toFixed(1) + 'km' : m + 'm';
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function stars(rating) {
  const full = Math.round(Number(rating) || 0);
  return `<span style="color:#ff922b">★★★★★</span>`.replace(
    '★★★★★',
    '★'.repeat(full) + '<span style="color:#e9ecf0">' + '★'.repeat(5 - full) + '</span>'
  );
}

// ===== Toast =====
let toastTimer = null;
export function toast(msg, ms = 2400) {
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="toast">${esc(msg)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (root.innerHTML = ''), ms);
}

// ===== 底部弹层 =====
export function openSheet(innerHTML, { locked = false } = {}) {
  closeSheet();
  const root = document.getElementById('sheet-root');
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.innerHTML = `<div class="sheet-panel">${innerHTML}</div>`;
  mask.addEventListener('click', (e) => {
    if (!locked && e.target === mask) closeSheet();
  });
  root.appendChild(mask);
  return mask;
}

export function closeSheet() {
  const root = document.getElementById('sheet-root');
  if (root) root.innerHTML = '';
}

// ===== 音效（WebAudio，用户手势后初始化；失败静默） =====
let actx = null;
function ensureCtx() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  } catch (e) {
    return null;
  }
}

function beep(freq, dur, gain = 0.03, type = 'square', when = 0) {
  const ctx = ensureCtx();
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g);
  g.connect(ctx.destination);
  const t = ctx.currentTime + when;
  o.start(t);
  o.stop(t + dur);
}

export const sfx = {
  tick: () => beep(760, 0.025, 0.02),
  win: () => {
    beep(523, 0.1, 0.05, 'sine', 0);
    beep(659, 0.1, 0.05, 'sine', 0.09);
    beep(784, 0.16, 0.05, 'sine', 0.18);
  },
};
