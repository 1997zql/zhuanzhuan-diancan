// 应用入口：启动流程（元数据 → 定位解析）+ hash 路由
import { api } from './api.js';
import { runtime, restoreLocation, setPresetLocation, setCustomLocation } from './state.js';
import { locate, nearestPreset } from './geo.js';
import { toast, esc, closeSheet } from './ui.js';
import { track } from './track.js';
import { refreshTopbar, bindTopbar } from './topbar.js';
import { RADIUS } from './config.js';
import * as home from './views/home.js';
import * as shops from './views/shops.js';
import * as shop from './views/shop.js';
import * as orders from './views/orders.js';
import * as me from './views/me.js';

const routes = { home, shops, shop, orders, me };
let currentName = 'home';

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'home';
  const qIdx = raw.indexOf('?');
  const path = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const query = new URLSearchParams(qIdx === -1 ? '' : raw.slice(qIdx + 1));
  const seg = path.split('/').filter(Boolean);
  return { name: seg[0] || 'home', arg: seg[1] || '', query };
}

function setTab(name) {
  document.querySelectorAll('#tabbar .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
}

async function render() {
  const prev = routes[currentName];
  if (prev && prev.onLeave) prev.onLeave();
  closeSheet(); // 路由切换时关闭遗留弹层

  const { name, arg, query } = parseHash();
  currentName = name;
  setTab(name);
  refreshTopbar();
  track('page_view', { view: name });

  const root = document.getElementById('view');
  root.innerHTML = '';
  try {
    // hasOwn 防原型链命中（如 #/constructor），未知路由回首页
    const route = Object.prototype.hasOwnProperty.call(routes, name) ? routes[name] : home;
    await route.render(root, { arg, query });
  } catch (e) {
    root.innerHTML = `<div class="card empty-card"><div class="big">😵</div><h3>页面出错了</h3><p>${esc(e.message)}</p></div>`;
  }
}



/** 微信内打开引导：转发到微信群的主要场景，微信 webview 里体验受限 */
function showWechatTip() {
  if (!/MicroMessenger/i.test(navigator.userAgent)) return;
  const tip = document.createElement('div');
  tip.id = 'wechat-tip';
  tip.innerHTML = '点击右上角 <b>···</b> → 选择「在浏览器打开」，转盘体验更佳';
  tip.addEventListener('click', () => tip.remove());
  document.getElementById('app').prepend(tip);
}
async function boot() {
  bindTopbar(render);
  try {
    runtime.meta = await api.meta();
  } catch (e) {
    document.getElementById('view').innerHTML =
      `<div class="card empty-card"><div class="big">📡</div><h3>服务连接失败</h3><p>请确认服务已启动：node server/server.js</p></div>`;
    return;
  }

  // 恢复持久化地址；没有则尝试真实定位；最终回退第一个预设地址
  if (!restoreLocation(runtime.meta.addresses)) {
    const pos = await locate(4000);
    const isAmap = runtime.meta.dataMode === 'amap';
    if (pos) {
      if (isAmap) {
        setCustomLocation(pos); // amap 模式：真实定位直接可用（名称后续由逆地理补齐）
      } else {
        const { preset, distM } = nearestPreset(pos, runtime.meta.addresses);
        if (distM <= RADIUS) setCustomLocation(pos);
        else {
          setPresetLocation(preset || runtime.meta.addresses[0]);
          toast('当前定位不在演示商圈，已使用演示地址，可在顶栏切换');
        }
      }
    } else {
      setPresetLocation(runtime.meta.addresses[0]);
    }
  }

  showWechatTip();
  window.addEventListener('hashchange', render);
  render();
}

boot();
