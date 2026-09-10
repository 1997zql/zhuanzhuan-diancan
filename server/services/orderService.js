'use strict';

const shopService = require('./shopService');
const { track } = require('../lib/track');

/** 订单状态时间线（毫秒）：下单 → 商家接单 → 配送中 → 已送达 */
const T = {
  ACCEPTED_MS: 2 * 60 * 1000,
  DELIVERING_MS: 7 * 60 * 1000,
  DELIVERED_MS: 38 * 60 * 1000,
};

/** 内存订单表：重启即清空，演示环境可接受 */
const orders = new Map();

function newOrderId() {
  return 'W' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100);
}

/**
 * 创建订单
 * - 校验店铺存在、菜品存在
 * - 价格以服务端菜单为准（不信任客户端价格）
 * - 校验起送价（MRD §5.1：转盘候选池只含满足起送价的店铺）
 */
async function createOrder(payload = {}) {
  const shop = await shopService.detail(payload.shopId);
  if (!shop) {
    const err = new Error('店铺不存在或暂不服务当前地址');
    err.code = 'SHOP_NOT_FOUND';
    throw err;
  }
  if (shop.sourcedFrom === 'poi') {
    const err = new Error('该店铺来自地图真实数据，暂未接入交易，请复制店名到外卖 App 下单');
    err.code = 'POI_NO_ORDER';
    throw err;
  }
  const itemsIn = Array.isArray(payload.items) ? payload.items : [];
  const items = [];
  for (const it of itemsIn) {
    const qty = Math.max(1, Math.min(99, Math.floor(Number(it.qty) || 0)));
    const dish = shop.dishes.find((d) => d.id === it.dishId);
    if (!dish) {
      const err = new Error(`菜品不存在：${it.dishId}`);
      err.code = 'DISH_NOT_FOUND';
      throw err;
    }
    if (qty > 0) items.push({ dishId: dish.id, name: dish.name, price: dish.price, qty });
  }
  if (items.length === 0) {
    const err = new Error('购物车为空');
    err.code = 'EMPTY_CART';
    throw err;
  }

  const subtotal = items.reduce((acc, it) => acc + it.price * it.qty, 0);
  if (subtotal < shop.minOrder) {
    const err = new Error(`未达起送价 ¥${shop.minOrder}`);
    err.code = 'MIN_ORDER';
    err.needMore = Number((shop.minOrder - subtotal).toFixed(1));
    throw err;
  }

  const now = Date.now();
  const order = {
    id: newOrderId(),
    shopId: shop.id,
    shopName: shop.name,
    shopEmoji: shop.emoji,
    items,
    subtotal: Number(subtotal.toFixed(1)),
    deliveryFee: shop.deliveryFee,
    total: Number((subtotal + shop.deliveryFee).toFixed(1)),
    fromWheel: !!payload.fromWheel,
    addressName: String(payload.addressName || '').slice(0, 40) || '未填写地址',
    remark: String(payload.remark || '').slice(0, 100),
    createdAt: now,
    timeline: {
      accepted: now + T.ACCEPTED_MS,
      delivering: now + T.DELIVERING_MS,
      delivered: now + T.DELIVERED_MS,
    },
  };
  orders.set(order.id, order);
  track('order_submit', {
    shopId: shop.id,
    shopName: shop.name,
    total: order.total,
    fromWheel: order.fromWheel,
  });
  return order;
}

/** 按下单时间倒序 */
function list() {
  return [...orders.values()].sort((a, b) => b.createdAt - a.createdAt);
}

module.exports = { createOrder, list };
