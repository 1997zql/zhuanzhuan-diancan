// Canvas 随机转盘：扇区绘制 / 缓动动画 / 落点计算 / 转动音效
import { sfx } from './ui.js';

const PALETTE = ['#FF7A45', '#FFB84D', '#4DABF7', '#69DB7C', '#B197FC', '#FF8FAB', '#3BC9DB', '#FFA94D'];
const TAU = Math.PI * 2;

// rAF 在部分嵌入式 WebView / 后台标签中不触发：首次转动前探测一次，
// 不可用时改用 setTimeout(16ms) 驱动动画，保证转动流程永不卡死
let rafSupported = null;
function probeRaf() {
  if (rafSupported !== null) return Promise.resolve(rafSupported);
  return new Promise((resolve) => {
    let fired = false;
    requestAnimationFrame(() => {
      fired = true;
    });
    setTimeout(() => {
      rafSupported = fired;
      resolve(rafSupported);
    }, 120);
  });
}

function scheduleFrame(fn, useRaf) {
  if (useRaf) requestAnimationFrame(fn);
  else setTimeout(() => fn(performance.now()), 16);
}

export class Wheel {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onLand?: (sector: object, index: number) => void}} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts;
    this.sectors = [];
    this.rotation = 0;
    this.spinning = false;
    this._setupSize();
  }

  _setupSize() {
    const cssSize = this.canvas.clientWidth > 0 ? this.canvas.clientWidth : 300;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = cssSize * dpr;
    this.canvas.height = cssSize * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = cssSize;
  }

  setSectors(sectors) {
    this.sectors = sectors;
    this.rotation = 0;
    this.draw();
  }

  /** 指针（画布顶部 -π/2）当前指向的扇区下标 */
  _sectorAt(rot) {
    const n = this.sectors.length;
    if (!n) return -1;
    const a = ((-Math.PI / 2 - rot) % TAU + TAU) % TAU;
    return Math.floor(a / (TAU / n)) % n;
  }

  draw() {
    const { ctx, size } = this;
    const n = this.sectors.length;
    if (!n) return;
    const c = size / 2;
    const R = c - 4;
    const seg = TAU / n;
    ctx.clearRect(0, 0, size, size);

    for (let i = 0; i < n; i++) {
      const a0 = this.rotation + i * seg;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, R, a0, a0 + seg);
      ctx.closePath();
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = 2;
      ctx.stroke();

      const s = this.sectors[i];
      const label = s.type === 'shop' ? s.shop.short || s.shop.name : s.cuisine;
      const emoji = s.type === 'shop' ? s.shop.emoji : s.emoji;
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(a0 + seg / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = '600 11px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText(label, R * 0.44, 4, R * 0.5);
      ctx.font = '18px serif';
      ctx.fillText(emoji, R * 0.72, 6);
      ctx.restore();
    }

    // 外圈描边
    ctx.beginPath();
    ctx.arc(c, c, R, 0, TAU);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
  }

  /**
   * 转动：随机选中目标扇区 → 目标角度 + 4~5 整圈 → easeOutQuart 减速
   * @returns {Promise<{index: number, sector: object}|null>} spin 中重复调用返回 null
   */
  spin() {
    if (this.spinning || this.sectors.length === 0) return Promise.resolve(null);
    this.spinning = true;

    const run = (useRaf) => {
      const n = this.sectors.length;
      const seg = TAU / n;
      const target = Math.floor(Math.random() * n);
      const jitter = (Math.random() * 0.56 - 0.28) * seg;
      const desired = -Math.PI / 2 - target * seg - seg / 2 + jitter;
      const current = this.rotation;
      const delta = ((desired - current) % TAU + TAU) % TAU;
      const final = current + delta + TAU * (4 + Math.floor(Math.random() * 2));

      const startT = performance.now();
      const dur = 4200 + Math.random() * 800;
      const ease = (t) => 1 - Math.pow(1 - t, 4);
      let lastIdx = this._sectorAt(current);

      return new Promise((resolve) => {
        const frame = (now) => {
          const t = Math.min(1, (now - startT) / dur);
          this.rotation = current + (final - current) * ease(t);
          const idx = this._sectorAt(this.rotation);
          if (idx !== lastIdx) {
            lastIdx = idx;
            sfx.tick();
          }
          this.draw();
          if (t < 1) {
            scheduleFrame(frame, useRaf);
          } else {
            const landed = this._sectorAt(this.rotation);
            const sector = this.sectors[landed];
            this.spinning = false;
            sfx.win();
            resolve({ index: landed, sector });
            if (this.opts.onLand) this.opts.onLand(sector, landed);
          }
        };
        scheduleFrame(frame, useRaf);
      });
    };

    return probeRaf().then(run);
  }
}
