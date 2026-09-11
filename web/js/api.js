// API 层：自动适配「有后端」与「纯静态托管（GitHub Pages 等）」两种环境
// 静态模式下，店铺/转盘/地址搜索全部由前端直连开放数据（Overpass/Photon，免注册）
import { fetchShops, searchAddress, reverseName, buildWheelStatic } from './staticSource.js';

let STATIC = false;
export function enableStatic() { STATIC = true; }
export const isStatic = () => STATIC;

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));

/** 静态模式元数据（预设地址与应用内一致） */
function staticMeta() {
  return {
    dataMode: 'osm',
    addresses: [
      { id: 'z-guomao', name: '国贸CBD', detail: '北京市朝阳区 · 建国门外大街1号', lat: 39.9087, lng: 116.4614 },
      { id: 'z-wangjing', name: '望京SOHO', detail: '北京市朝阳区 · 望京街10号', lat: 39.9957, lng: 116.4808 },
      { id: 'z-zgc', name: '中关村', detail: '北京市海淀区 · 中关村大街27号', lat: 39.9847, lng: 116.3059 },
    ],
    cuisines: ['中餐', '日料', '西式', '快餐西式', '咖啡', '茶饮甜品', '面食小吃', '烧烤', '韩式', '轻食', '亚洲料理'],
    avoidTags: [],
    radius: 1500,
  };
}

async function req(path, opts = {}) {
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch (e) { /* 非 JSON 响应 */ }
  if (!res.ok) {
    const err = new Error(data.message || `请求失败（${res.status}）`);
    err.code = data.error;
    err.data = data;
    throw err;
  }
  return data;
}

/** 客户端筛选/排序（静态模式用） */
function filterShops(shops, { category, sort, openOnly, maxPrice }) {
  let list = shops.slice();
  if (category) list = list.filter((s) => s.cuisine === category);
  if (openOnly) list = list.filter((s) => s.openStatus !== 'closed');
  if (Number(maxPrice) > 0) list = list.filter((s) => s.avgPrice == null || s.avgPrice <= Number(maxPrice));
  const sorters = {
    distance: (a, b) => a.distanceM - b.distanceM,
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || a.distanceM - b.distanceM,
    price: (a, b) => (a.avgPrice ?? Infinity) - (b.avgPrice ?? Infinity),
  };
  list.sort(sorters[sort] || sorters.distance);
  return list;
}

export const api = {
  async meta() {
    if (STATIC) return staticMeta();
    try {
      const res = await fetch('/api/meta');
      if (!res.ok) throw new Error('no backend');
      const data = await res.json();
      if (!data.dataMode) throw new Error('not api');
      return data;
    } catch (e) {
      enableStatic();
      return staticMeta();
    }
  },
  async shops(q = {}) {
    if (STATIC) {
      const lat = parseFloat(q.lat) || 39.9087, lng = parseFloat(q.lng) || 116.4614;
      const shops = await fetchShops(lat, lng, 3000);
      return { shops: filterShops(shops, q) };
    }
    return req(`/api/shops?${new URLSearchParams(clean(q))}`);
  },
  async shop(id, q = {}) {
    if (STATIC) {
      const lat = parseFloat(q.lat) || 39.9087, lng = parseFloat(q.lng) || 116.4614;
      const shops = await fetchShops(lat, lng, 3000);
      const found = shops.find((s) => s.id === id);
      if (!found) { const err = new Error('店铺不存在'); err.code = 'SHOP_NOT_FOUND'; throw err; }
      return { shop: { ...found, license: null, dishes: [] } };
    }
    return req(`/api/shops/${id}?${new URLSearchParams(clean(q))}`);
  },
  async wheel(body) {
    if (STATIC) {
      return buildWheelStatic({
        lat: parseFloat(body.lat) || 39.9087,
        lng: parseFloat(body.lng) || 116.4614,
        excludeIds: body.excludeIds,
        maxPrice: body.maxPrice,
        avoidTags: body.avoidTags,
        blacklistIds: body.blacklistIds,
      });
    }
    return req('/api/wheel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  createOrder: (body) =>
    req('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  orders: () => req('/api/orders'),
  stats: () => req('/api/stats'),
  async suggest(keywords) {
    if (STATIC) return searchAddress(keywords);
    return req(`/api/geocode/suggest?${new URLSearchParams({ keywords })}`);
  },
  async reverse(lat, lng) {
    if (STATIC) return { address: await reverseName(lat, lng) };
    return req(`/api/geocode/reverse?${new URLSearchParams({ lat, lng })}`);
  },
};

/** 静态模式下的外卖平台直达链接 */
export function platformJumpUrl(platform, name) {
  const kw = encodeURIComponent(name || '');
  if (platform === 'eleme') return `https://h5.ele.me?keyword=${kw}`;
  if (platform === 'meituan') return `https://h5.waimai.meituan.com?keyword=${kw}`;
  return '#';
}
