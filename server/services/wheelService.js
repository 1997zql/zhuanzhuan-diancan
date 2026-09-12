'use strict';

const shopService = require('./shopService');

const SECTOR_MIN = 6;
const SECTOR_MAX = 8;

/** 加权：评分 ≥ 4.5 与 30 天内新店获得适度曝光（MRD §5.1 加权随机） */
function weightOf(shop) {
  let w = 1;
  if (shop.rating >= 4.5) w *= 1.6;
  if (shop.isNew) w *= 1.5;
  return w;
}

/** 加权随机、不放回抽样 */
function weightedSample(pool, k) {
  const items = pool.map((s) => ({ s, w: weightOf(s) }));
  const picked = [];
  while (picked.length < k && items.length > 0) {
    const total = items.reduce((acc, it) => acc + it.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < items.length; idx++) {
      r -= items[idx].w;
      if (r <= 0) break;
    }
    idx = Math.min(idx, items.length - 1);
    picked.push(items[idx].s);
    items.splice(idx, 1);
  }
  return picked;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 生成转盘扇区
 * - 候选池 ≥ 6 家：店铺转盘（加权随机抽 6–8 家）
 * - 候选池 < 6 家：降级为品类转盘（同半径营业中店铺的品类去重）
 * - 连可下单店铺都不足 2 家：空态
 * opts: { lat, lng, excludeIds?, maxPrice?, avoidTags?, blacklistIds? }
 */
async function buildWheel(opts = {}) {
  const pool = await shopService.wheelPool(opts);
  if (pool.length >= SECTOR_MIN) {
    // 扇区重名去重：同名店铺只保留距离最近的一家，避免转盘出现多个"星巴克"
    const byShort = new Map();
    for (const s of pool) if (!byShort.has(s.short)) byShort.set(s.short, s);
    const deduped = [...byShort.values()];
    const picked = weightedSample(deduped, Math.min(SECTOR_MAX, deduped.length));
    return { mode: 'shop', sectors: picked.map((s) => ({ type: 'shop', shop: s })), poolSize: pool.length };
  }

  // 品类扇区只保留「通过偏好过滤的候选池中仍存在店铺」的品类，
  // 保证转出任意品类后都能挑到符合偏好的可下单店铺
  const okCuisines = new Set(pool.map((s) => s.cuisine));
  const byCuisine = new Map();
  for (const s of await shopService.categoryPool(opts.lat, opts.lng)) {
    if (!okCuisines.has(s.cuisine) || byCuisine.has(s.cuisine)) continue;
    byCuisine.set(s.cuisine, { cuisine: s.cuisine, emoji: s.emoji });
  }
  const cats = shuffle([...byCuisine.values()]).slice(0, SECTOR_MAX);
  if (cats.length >= 2) {
    return { mode: 'category', sectors: cats.map((c) => ({ type: 'category', ...c })), poolSize: pool.length };
  }
  return { mode: 'empty', sectors: [], poolSize: pool.length };
}

module.exports = { buildWheel };
