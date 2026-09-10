// 店铺详情 + 菜单 + 购物车 + 提交订单（模拟支付）
import { api } from '../api.js';
import { runtime, addToCart, decFromCart, getCart, clearCart, cartSummary } from '../state.js';
import { openSheet, closeSheet, toast, esc, fmt, priceText, distText, sfx } from '../ui.js';
import { track } from '../track.js';

let shop = null;
let fromWheel = false;

export async function render(root, { arg, query }) {
  const loc = runtime.location;
  fromWheel = query.get('from') === 'wheel';
  try {
    shop = (await api.shop(arg, { lat: loc.lat, lng: loc.lng })).shop;
  } catch (e) {
    root.innerHTML = `<div class="card empty-card"><div class="big">😵</div><h3>店铺加载失败</h3><p>${esc(e.message)}</p><a class="btn-primary" href="#/shops">返回店铺列表</a></div>`;
    return;
  }

  const isPoi = shop.sourcedFrom === 'poi';
  const badges = [
    shop.isNew ? '<span class="badge b-new">新店</span>' : '',
    shop.openStatus === 'closingSoon' ? '<span class="badge b-closing">即将打烊</span>' : '',
    shop.openStatus === 'closed' ? '<span class="badge b-closed">休息中</span>' : '',
  ].join('');

  const heroChips = [
    isPoi ? null : `<span class="mchip">起送 ${fmt(shop.minOrder)}</span>`,
    shop.deliveryFee != null ? `<span class="mchip">配送费 ${fmt(shop.deliveryFee)}</span>` : null,
    shop.deliveryMinutes != null ? `<span class="mchip">约 ${shop.deliveryMinutes} 分钟送达</span>` : null,
    ...(shop.openTime ? [`<span class="mchip">营业 ${shop.openTime}-${shop.closeTime}</span>`] : []),
    ...shop.tags.map((t) => `<span class="mchip">${esc(t)}</span>`),
  ]
    .filter(Boolean)
    .join('');

  const licenseLine = isPoi
    ? shop.tel
      ? `<div class="license">📞 ${esc(shop.tel)}</div>`
      : ''
    : `<div class="license">食品经营许可 ${esc(shop.license)} <span class="ok">✓ 已核验</span></div>`;

  const body = isPoi
    ? `
    <div class="card empty-card" style="margin-top:12px">
      <div class="big">🛵</div>
      <h3>该店来自地图真实数据</h3>
      <p>暂未接入菜单与在线交易：通过外卖 App 搜索下单即可</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <a class="btn-primary" id="cpsEleme" href="/api/cps/go?${new URLSearchParams({ platform: 'eleme', name: shop.name, shopId: shop.id, source: 'page' })}" target="_blank" rel="noopener">淘宝闪购下单</a>
        <a class="btn-ghost" id="cpsMeituan" href="/api/cps/go?${new URLSearchParams({ platform: 'meituan', name: shop.name, shopId: shop.id, source: 'page' })}" target="_blank" rel="noopener">美团外卖</a>
        <button class="btn-ghost" id="copyShopName">复制店名</button>
      </div>
    </div>`
    : `
    <div class="menu-title">菜单</div>
    <div class="dish-list" id="dishList">
      ${shop.dishes.map((d) => dishHtml(d)).join('')}
    </div>
    <div class="cartbar" id="cartbar"></div>`;

  root.innerHTML = `
    ${fromWheel && !isPoi ? '<div class="from-wheel">🎯 来自转盘推荐 · 转到哪家吃哪家</div>' : ''}
    ${fromWheel && isPoi ? '<div class="from-wheel">🎯 来自转盘推荐 · 去外卖平台完成下单</div>' : ''}
    <div class="card shop-hero">
      <div class="top">
        <div class="emoji-big">${shop.emoji}</div>
        <div style="flex:1;min-width:0">
          <h2>${esc(shop.name)}</h2>
          <div class="sub">★${shop.rating ?? '暂无评分'}${shop.monthlySales != null ? ` · 月售${shop.monthlySales}` : ''} · ${esc(shop.cuisine)} ${badges}</div>
          <div class="addr">📍 ${esc(shop.address || shop.zone || '')} · ${distText(shop.distanceM)}</div>
          ${licenseLine}
        </div>
      </div>
      <div class="chip-row">${heroChips}</div>
    </div>
    ${body}`;

  if (isPoi) {
    document.getElementById('cpsMeituan').addEventListener('click', () =>
      track('order_click', { shopId: shop.id, platform: 'meituan', source: 'page' })
    );
    document.getElementById('cpsEleme').addEventListener('click', () =>
      track('order_click', { shopId: shop.id, platform: 'eleme', source: 'page' })
    );
    document.getElementById('copyShopName').addEventListener('click', () => {
      track('shop_copy', { shopId: shop.id });
      if (navigator.clipboard) {
        navigator.clipboard.writeText(shop.name).then(() => toast('店名已复制，去外卖 App 搜索下单')).catch(() => toast(`请搜索：${shop.name}`));
      } else toast(`请搜索：${shop.name}`);
    });
    return;
  }

  bindDishes();
  updateCartbar();
}

function dishHtml(d) {
  const line = getCart(shop.id).items.find((i) => i.dishId === d.id);
  const qty = line ? line.qty : 0;
  return `
    <div class="card dish-row">
      <div class="d-info">
        <div class="d-name">${esc(d.name)}${d.isSignature ? '<span class="sig">招牌</span>' : ''}</div>
        <div class="d-desc">${esc(d.desc)}</div>
        <div class="d-price">${priceText(d.price)}</div>
      </div>
      <div class="stepper">
        <button data-dec="${d.id}" ${qty === 0 ? 'disabled' : ''}>−</button>
        <span class="qty" data-qty="${d.id}">${qty}</span>
        <button data-add="${d.id}">＋</button>
      </div>
    </div>`;
}

function bindDishes() {
  document.querySelectorAll('[data-add]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const d = shop.dishes.find((x) => x.id === btn.dataset.add);
      addToCart(shop.id, shop.name, shop.emoji, d);
      refreshDish(d.id);
      updateCartbar();
    })
  );
  document.querySelectorAll('[data-dec]').forEach((btn) =>
    btn.addEventListener('click', () => {
      decFromCart(shop.id, btn.dataset.dec);
      refreshDish(btn.dataset.dec);
      updateCartbar();
    })
  );
}

function refreshDish(dishId) {
  const line = getCart(shop.id).items.find((i) => i.dishId === dishId);
  const qtyEl = document.querySelector(`[data-qty="${dishId}"]`);
  const decBtn = document.querySelector(`[data-dec="${dishId}"]`);
  if (qtyEl) qtyEl.textContent = line ? line.qty : 0;
  if (decBtn) decBtn.disabled = !line;
}

function updateCartbar() {
  const bar = document.getElementById('cartbar');
  if (!bar) return;
  const { count, subtotal } = cartSummary(shop.id);

  if (count === 0) {
    bar.innerHTML = `<span class="cart-emoji">🛒</span><div class="cart-info">${fmt(shop.minOrder)} 起送 · 点「＋」加入购物车</div><button class="go" disabled>去结算</button>`;
    return;
  }
  if (subtotal < shop.minOrder) {
    bar.innerHTML = `<span class="cart-emoji">🛒</span><div class="cart-info">已选 ${count} 件 · 合计 ${fmt(subtotal)}</div><button class="go" disabled>还差${fmt(shop.minOrder - subtotal)}起送</button>`;
    return;
  }
  bar.innerHTML = `<span class="cart-emoji">🛒</span><div class="cart-info">已选 ${count} 件</div><div class="cart-total">${fmt(subtotal)}</div><button class="go" id="goCheckout">去结算</button>`;
  document.getElementById('goCheckout').addEventListener('click', () => {
    track('order_click', { shopId: shop.id, platform: 'in_app', source: 'page' });
    checkoutSheet();
  });
}

function checkoutSheet() {
  const { items, subtotal, count } = cartSummary(shop.id);
  const loc = runtime.location;
  openSheet(`
    <div class="result-head">确认订单 · ${esc(shop.name)}</div>
    <div style="margin-top:10px">
      ${items.map((i) => `<div class="co-row"><span class="lab">${esc(i.name)} × ${i.qty}</span><span class="val">${fmt(i.price * i.qty)}</span></div>`).join('')}
    </div>
    <div style="border-bottom:1px dashed var(--line)"></div>
    <div class="co-row"><span class="lab">配送费</span><span class="val">${fmt(shop.deliveryFee)}</span></div>
    <div class="co-row"><span class="lab">送达地址</span><span class="val">${esc(loc.name)}</span></div>
    <div class="co-row"><span class="lab">期望时间</span><span class="val">尽快送达（约 ${shop.deliveryMinutes} 分钟）</span></div>
    <input class="co-input" id="remarkInput" maxlength="50" placeholder="备注（可选）：如不要辣、放到前台" />
    <div class="co-row"><span class="lab">共 ${count} 件 · 合计</span><span class="co-total">${fmt(subtotal + shop.deliveryFee)}</span></div>
    <button class="btn-primary co-submit" id="submitOrder">提交订单（模拟支付）</button>
  `);

  document.getElementById('submitOrder').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '正在下单…';
    try {
      const { order } = await api.createOrder({
        shopId: shop.id,
        items: items.map(({ dishId, qty }) => ({ dishId, qty })),
        fromWheel,
        addressName: loc.name,
        remark: document.getElementById('remarkInput').value.trim(),
      });
      clearCart(shop.id);
      sfx.win();
      showSuccess(order);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '提交订单（模拟支付）';
      toast(err.message);
      if (err.code === 'MIN_ORDER') closeSheet();
      updateCartbar();
    }
  });
}

function showSuccess(order) {
  openSheet(`
    <div class="success">
      <div class="ok-emoji">✅</div>
      <h3>下单成功</h3>
      <p>订单号 ${esc(order.id)} · 合计 ${fmt(order.total)}</p>
      <p>订单状态会随时间自动推进，可在「订单」页查看</p>
      <button class="btn-primary co-submit" id="viewOrders">查看订单</button>
    </div>
  `);
  document.getElementById('viewOrders').addEventListener('click', () => {
    closeSheet();
    location.hash = '#/orders';
  });
}
