// 全局状态：持久化偏好（localStorage）+ 会话级数据 + 购物车

const STATE_KEY = 'zzdc.state.v1';
const CART_KEY = 'zzdc.cart.v1';

const savedState = JSON.parse(localStorage.getItem(STATE_KEY) || 'null') || {};
export const prefs = {
  addressId: savedState.addressId || null, // 预设地址 id；null = 使用自定义定位
  custom: savedState.custom || null,       // { lat, lng, name } 真实定位/搜索地址
  maxPrice: savedState.maxPrice || 0,      // 人均上限，0 = 不限
  avoidTags: savedState.avoidTags || [],   // 忌口标签
  blacklist: (savedState.blacklist || []).map((b) => (typeof b === 'string' ? { id: b, name: b } : b)), // [{id, name}]
};

export function savePrefs() {
  localStorage.setItem(
    STATE_KEY,
    JSON.stringify({ addressId: prefs.addressId, custom: prefs.custom, maxPrice: prefs.maxPrice, avoidTags: prefs.avoidTags, blacklist: prefs.blacklist })
  );
}

// ===== 运行时（不持久化） =====
export const runtime = { meta: null, location: null };
// location: { lat, lng, name, isPreset, addressId? }

export function setPresetLocation(addr) {
  prefs.addressId = addr.id;
  savePrefs();
  runtime.location = { lat: addr.lat, lng: addr.lng, name: addr.name, isPreset: true, addressId: addr.id };
}

export function setCustomLocation(pos, name = '我的位置') {
  prefs.addressId = null;
  prefs.custom = { lat: pos.lat, lng: pos.lng, name };
  savePrefs();
  runtime.location = { lat: pos.lat, lng: pos.lng, name, isPreset: false };
}

/** 根据持久化偏好恢复 location；返回是否恢复成功 */
export function restoreLocation(addresses) {
  if (prefs.addressId) {
    const addr = addresses.find((a) => a.id === prefs.addressId);
    if (addr) {
      runtime.location = { lat: addr.lat, lng: addr.lng, name: addr.name, isPreset: true, addressId: addr.id };
      return true;
    }
  }
  if (prefs.custom && isFinite(prefs.custom.lat)) {
    runtime.location = {
      lat: prefs.custom.lat,
      lng: prefs.custom.lng,
      name: prefs.custom.name || '我的位置',
      isPreset: false,
    };
    return true;
  }
  return false;
}

/** 当前坐标与显示名 */
export function currentLocation() {
  return runtime.location;
}

// ===== 会话级转盘排除（不持久化，页面刷新即重置） =====
export const session = {
  seen: [],      // 最近转出过的店铺（自动排除，重转不重复，上限 5 条记忆）
  excluded: [],  // 手动排除的店铺（计入 5 家上限）
};
export function pushSeen(shopId) {
  session.seen = [shopId, ...session.seen.filter((id) => id !== shopId)].slice(0, 5);
}

// ===== 购物车（按店铺隔离，持久化） =====
let cart = JSON.parse(localStorage.getItem(CART_KEY) || 'null') || {};
function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

export function getCart(shopId) {
  return cart[shopId] || { name: '', emoji: '', items: [] };
}

export function addToCart(shopId, shopName, shopEmoji, dish) {
  const c = getCart(shopId);
  c.name = shopName;
  c.emoji = shopEmoji;
  const line = c.items.find((i) => i.dishId === dish.id);
  if (line) line.qty += 1;
  else c.items.push({ dishId: dish.id, name: dish.name, price: dish.price, qty: 1 });
  cart[shopId] = c;
  saveCart();
}

export function decFromCart(shopId, dishId) {
  const c = getCart(shopId);
  const line = c.items.find((i) => i.dishId === dishId);
  if (!line) return;
  line.qty -= 1;
  if (line.qty <= 0) c.items = c.items.filter((i) => i.dishId !== dishId);
  if (c.items.length === 0) delete cart[shopId];
  saveCart();
}

export function clearCart(shopId) {
  delete cart[shopId];
  saveCart();
}

export function cartSummary(shopId) {
  const c = getCart(shopId);
  const count = c.items.reduce((acc, i) => acc + i.qty, 0);
  const subtotal = c.items.reduce((acc, i) => acc + i.qty * i.price, 0);
  return { count, subtotal, items: c.items };
}
