// 订单列表：状态时间线按当前时间实时推进（10 秒自动刷新）
import { api } from '../api.js?v=c5a29c5';
import { cid } from '../track.js?v=c5a29c5';
import { esc, fmt } from '../ui.js?v=c5a29c5';

let timer = null;

export function onLeave() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function render(root) {
  root.innerHTML = `<div class="order-list" id="orderList"><div class="card" style="text-align:center;color:var(--text-2)">加载中…</div></div>`;
  onLeave();
  await load();
  timer = setInterval(load, 10000);
}

async function load() {
  const el = document.getElementById('orderList');
  if (!el) return;
  const { orders } = await api.orders({ cid });
  el.innerHTML =
    orders.length > 0
      ? orders.map(orderHtml).join('')
      : `<div class="card empty-card"><div class="big">🧾</div><h3>还没有订单</h3><p>去转盘转一下，10 秒决定午饭</p><a class="btn-primary" href="#/home">去转转</a></div>`;
}

function statusOf(o, now = Date.now()) {
  const t = o.timeline;
  if (now < t.accepted) return { cls: 'st-placed', text: '已下单' };
  if (now < t.delivering) return { cls: 'st-accepted', text: '商家已接单' };
  if (now < t.delivered) return { cls: 'st-delivering', text: '配送中' };
  return { cls: 'st-done', text: '已送达' };
}

const hm = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function orderHtml(o) {
  const st = statusOf(o);
  const first = o.items[0];
  const summary = o.items.length === 1 ? `${esc(first.name)} × ${first.qty}` : `${esc(first.name)} × ${first.qty} 等${o.items.length}种`;
  const eta =
    st.text === '已下单'
      ? '等待商家接单…'
      : st.text === '商家已接单'
        ? '商家备餐中…'
        : st.text === '配送中'
          ? `预计 ${hm(o.timeline.delivered)} 送达`
          : '已送达 · 慢用 🍚';
  return `
    <div class="card order-card">
      <div class="o-head">
        <span style="font-size:20px">${o.shopEmoji}</span>
        <span class="o-shop">${esc(o.shopName)}</span>
        ${o.fromWheel ? '<span class="badge b-wheel">🎯 转盘</span>' : ''}
        <span class="status ${st.cls}">${st.text}</span>
      </div>
      <div class="o-items">${summary}</div>
      <div class="o-foot">
        <span>${hm(o.createdAt)} 下单 · ${esc(o.addressName)}${o.remark ? ' · 备注：' + esc(o.remark) : ''}</span>
        <span class="o-total">${fmt(o.total)}</span>
      </div>
      <div class="o-eta">${eta}</div>
    </div>`;
}
