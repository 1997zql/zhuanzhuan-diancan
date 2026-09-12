'use strict';

const fs = require('fs');
const path = require('path');
const { haversineM, openStatusOf, gcj2wgs } = require('../lib/geo');
const amap = require('../lib/amap');
const osm = require('../lib/osm');

/**
 * 双数据源模式：
 * - demo：server/data/shops.json 演示数据（DATA_SOURCE=demo 时使用）
 * - amap：设置环境变量 AMAP_KEY 后，实时调用高德「周边 POI 搜索」获取真实餐饮店铺。
 *   POI 只有店铺维度信息（名称/位置/评分/人均/营业时间），没有菜单与配送属性，
 *   下单在产品上引导跳转外卖平台（见 orderService 的 POI 守卫与前端店铺页）。
 * - osm：OpenStreetMap 开放数据（无需注册任何账号），真实名称/位置，评分与营业时间常缺失。
 * 三个模式输出同构的 Shop 摘要，API 契约不变，前端按 meta().dataMode 做展示适配。
 * 默认 osm（公开部署即真实数据）；本地开发可用 DATA_SOURCE=demo 切回演示数据。
 */
const DATA_MODE = amap.enabled() ? 'amap' : (process.env.DATA_SOURCE === 'demo' ? 'demo' : 'osm');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'shops.json'), 'utf8'));
const DEMO_SHOPS = data.shops;
const ADDRESSES = data.meta.addresses;
const AVOID_TAGS = data.meta.avoidTags;

/** 默认匹配半径（米），对应 MRD「3 公里内可下单店铺」 */
const DEFAULT_RADIUS_M = 3000;

const COMMON_CUISINES = ['川菜', '粤式', '日料', '韩式', '快餐西式', '麻辣火锅', '烧烤', '面食小吃', '茶饮甜品', '轻食'];

// ===== 公共：营业状态 =====

function statusOf(openTime, closeTime) {
  if (!openTime || !closeTime) {
    // 营业时间未知（高德未返回）：按营业中处理，不标注打烊
    return { open: true, openStatus: 'open', closingInMin: null };
  }
  const { open, closingInMin } = openStatusOf(openTime, closeTime);
  let openStatus = 'closed';
  if (open) openStatus = closingInMin !== null && closingInMin <= 30 ? 'closingSoon' : 'open';
  return { open, openStatus, closingInMin };
}

function attachDistance(s, lat, lng) {
  return { ...s, distanceM: Math.round(haversineM(lat, lng, s.lat, s.lng)) };
}

// ===== demo 模式 =====

function demoSummary(shop) {
  const st = statusOf(shop.openTime, shop.closeTime);
  return {
    id: shop.id,
    name: shop.name,
    short: shop.short,
    emoji: shop.emoji,
    cuisine: shop.cuisine,
    rating: shop.rating,
    monthlySales: shop.monthlySales,
    avgPrice: shop.avgPrice,
    isNew: shop.isNew,
    zone: shop.zone,
    address: shop.address,
    tags: shop.tags,
    deliveryFee: shop.deliveryFee,
    minOrder: shop.minOrder,
    deliveryMinutes: shop.deliveryMinutes,
    lat: shop.lat,
    lng: shop.lng,
    openTime: shop.openTime,
    closeTime: shop.closeTime,
    license: shop.license,
    sourcedFrom: 'demo',
    ...st,
  };
}

function demoList() {
  return DEMO_SHOPS.map(demoSummary);
}

// ===== amap 模式 =====

// 缓存：坐标网格（约 110 米）→ POI 摘要列表，避免每次转动都打高德接口
// 网格数量与请求坐标相关（公网可被扫坐标撑爆内存），超过上限整体清空重建
const poiCache = new Map();
const POI_CACHE_MAX = 500;
const CACHE_TTL = 10 * 60 * 1000;

// 注册表：POI id → 摘要，让 detail / 下单守卫不依赖坐标即可定位店铺
const poiRegistry = new Map();

const gridKey = (lat, lng) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

function pickNum(v) {
  if (v == null) return null;
  const m = String(v).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

function normalizeBiz(biz) {
  return biz && typeof biz === 'object' && !Array.isArray(biz) ? biz : {};
}

/** 解析 "10:00-22:00" / "营业时间 11:00-21:30" 等，取第一段 HH:MM-HH:MM */
function parseOpenTime(str) {
  const m = String(str || '').match(/(\d{1,2})[:：](\d{2})\s*[-~—至到]\s*(\d{1,2})[:：](\d{2})/);
  if (!m) return { openTime: null, closeTime: null };
  const pad = (h, mm) => `${String(h).padStart(2, '0')}:${mm}`;
  return { openTime: pad(m[1], m[2]), closeTime: pad(m[3], m[4]) };
}

/** 高德 type / 店名 → 统一品类与 emoji */
const CUISINE_RULES = [
  [/川菜|四川|湘菜|贵州菜/, '川菜', '🌶️'],
  [/粤菜|烧腊|茶餐厅|港式|潮汕/, '粤式', '🍗'],
  [/日本|日料|寿司|丼|居酒|刺身/, '日料', '🍣'],
  [/韩国|韩式|石锅拌饭/, '韩式', '🍚'],
  [/西餐|意大利|披萨|比萨|牛排|汉堡|快餐|肯德基|麦当劳|必胜客|德克士/, '快餐西式', '🍔'],
  [/火锅|麻辣烫|冒菜|香锅/, '麻辣火锅', '🍲'],
  [/烧烤|烤肉|烤串|串串/, '烧烤', '🍢'],
  [/面馆|拉面|米线|米粉|饺子|馄饨|包子|小吃|早点/, '面食小吃', '🍜'],
  [/奶茶|咖啡|茶艺|甜品|蛋糕|面包|糕点|烘焙|冰淇淋/, '茶饮甜品', '🧋'],
  [/轻食|沙拉|素食/, '轻食', '🥗'],
  [/自助餐|自助/, '自助餐', '🍽️'],
];

function mapCuisine(type, name) {
  const s = `${type || ''}${name || ''}`;
  for (const [re, label, emoji] of CUISINE_RULES) {
    if (re.test(s)) return { label, emoji };
  }
  return { label: '中华美食', emoji: '🍽️' };
}

function shortName(name) {
  const base = String(name || '').replace(/[（(].*?[)）]/g, '').split(/[·—-]/)[0].trim();
  return (base || String(name || '')).slice(0, 5);
}

function mapPoi(poi, lat, lng) {
  const [lngS, latS] = String(poi.location || '').split(',');
  const shopLng = parseFloat(lngS);
  const shopLat = parseFloat(latS);
  if (!isFinite(shopLat) || !isFinite(shopLng)) return null;

  const biz = normalizeBiz(poi.biz_ext);
  const rating = pickNum(biz.rating);
  const avgPrice = pickNum(biz.cost);
  const { openTime, closeTime } = parseOpenTime(biz.open_time || poi.opentime);
  const st = statusOf(openTime, closeTime);
  const cuisine = mapCuisine(poi.type, poi.name);

  return {
    id: 'a' + poi.id,
    name: poi.name,
    short: shortName(poi.name),
    emoji: cuisine.emoji,
    cuisine: cuisine.label,
    rating,
    monthlySales: null,
    avgPrice,
    isNew: false,
    zone: [poi.pname, poi.cityname, poi.adname].filter(Boolean).join('') || null,
    address: poi.address || null,
    tel: poi.tel || null,
    lat: shopLat,
    lng: shopLng,
    openTime,
    closeTime,
    deliveryFee: null,
    minOrder: 0,
    deliveryMinutes: null,
    license: null,
    tags: [],
    sourcedFrom: 'poi',
    ...st,
  };
}

async function amapList(lat, lng) {
  const key = gridKey(lat, lng);
  const hit = poiCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.list;

  // 拉两页共 ~50 家（第 2 页失败不影响第 1 页）
  const [p1, p2] = await Promise.all([
    amap.around(lat, lng, { radius: DEFAULT_RADIUS_M, page: 1 }),
    amap.around(lat, lng, { radius: DEFAULT_RADIUS_M, page: 2 }).catch(() => null),
  ]);
  const pois = [...(p1.pois || []), ...((p2 && p2.pois) || [])];
  const seen = new Set(); // 分页边界可能返回重复 POI，按 id 去重
  const list = pois
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    .map((p) => mapPoi(p, lat, lng))
    .filter(Boolean)
    .map((s) => attachDistance(s, lat, lng))
    .filter((s) => s.distanceM <= DEFAULT_RADIUS_M);
  list.forEach((s) => {
    poiRegistry.set(s.id, s);
    if (poiRegistry.size > 5000) poiRegistry.clear();
  });
  if (poiCache.size >= POI_CACHE_MAX) poiCache.clear();
  poiCache.set(key, { list, ts: Date.now() });
  return list;
}

// ===== osm 模式（OpenStreetMap 开放数据，WGS-84，无需注册）=====

/** OSM cuisine/amenity/店名 → 统一品类与 emoji */
const OSM_CUISINE_RULES = [
  [/japanese|sushi|ramen/i, '日料', '🍣'],
  [/italian|pizza|pasta/i, '西式', '🍝'],
  [/burger/i, '快餐西式', '🍔'],
  [/coffee/i, '咖啡', '☕'],
  [/bubble_tea|tea_house|teahouse|boba/i, '茶饮甜品', '🧋'],
  [/kebab|barbecue|bbq/i, '烧烤', '🍢'],
  [/noodle|ramen|dumpling|noodles|rice_noodle/i, '面食小吃', '🍜'],
  [/chinese|sichuan|cantonese|hunan|hot_pot|hotpot/i, '中餐', '🍲'],
  [/korean/i, '韩式', '🍚'],
  [/thai|vietnamese|asian/i, '亚洲料理', '🍛'],
  [/salad|vegetarian|vegan/i, '轻食', '🥗'],
];

function mapOsmCuisine(tags, name) {
  // 店名并入匹配：OSM 国内 cuisine 标签稀疏，"GuiLin Rice Noodles" 这类
  // 英文名店靠名字才能落到正确品类
  const s = `${tags.cuisine || ''}${tags.amenity || ''}${name || ''}`;
  for (const [re, label, emoji] of OSM_CUISINE_RULES) {
    if (re.test(s)) return { label, emoji };
  }
  if (tags.amenity === 'cafe') return { label: '咖啡', emoji: '☕' };
  if (tags.amenity === 'fast_food') return { label: '快餐西式', emoji: '🍔' };
  if (tags.amenity === 'food_court') return { label: '美食广场', emoji: '🍽️' };
  return { label: '餐厅', emoji: '🍽️' };
}

function shortOsmName(name) {
  const base = String(name || '').replace(/[（(].*?[)）]/g, '').trim();
  return (base || String(name || '')).slice(0, 5);
}

/** Overpass element → Shop 摘要（sourcedFrom='poi'，复用前端 POI 展示与下单引导） */
function mapOsmElement(el, lat, lng) {
  const tags = el.tags || {};
  // 国内 OSM 的 name 常是拼音/英文，优先取中文标签，避免转盘转出"Najia Xiaoguan"
  const name = tags["name:zh"] || tags["name:zh-Hans"] || tags.name || tags["name:en"];
  if (!name) return null;
  const shopLat = el.lat ?? el.center?.lat;
  const shopLng = el.lon ?? el.center?.lon;
  if (!isFinite(shopLat) || !isFinite(shopLng)) return null;

  const { openTime, closeTime } = (() => {
    const m = String(tags.opening_hours || '').match(/(\d{1,2})[:：](\d{2})\s*[-~—至到]\s*(\d{1,2})[:：](\d{2})/);
    if (!m) return { openTime: null, closeTime: null };
    const pad = (h, mm) => `${String(h).padStart(2, '0')}:${mm}`;
    return { openTime: pad(m[1], m[2]), closeTime: pad(m[3], m[4]) };
  })();
  const st = statusOf(openTime, closeTime);
  const cuisine = mapOsmCuisine(tags, name);
  const address = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join('') || null;

  return {
    id: 'o' + (el.type || 'n') + el.id,
    name,
    short: shortOsmName(name),
    emoji: cuisine.emoji,
    cuisine: cuisine.label,
    rating: null,
    monthlySales: null,
    avgPrice: null,
    isNew: false,
    zone: null,
    address,
    tel: tags.phone || tags["contact:phone"] || null,
    lat: shopLat,
    lng: shopLng,
    openTime,
    closeTime,
    deliveryFee: null,
    minOrder: 0,
    deliveryMinutes: null,
    license: null,
    tags: [],
    sourcedFrom: 'poi',
    ...st,
  };
}

async function osmList(lat, lng) {
  const key = gridKey(lat, lng);
  const hit = poiCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.list;

  const elements = await osm.around(lat, lng, DEFAULT_RADIUS_M);
  const seen = new Set();
  const list = elements
    .map((el) => mapOsmElement(el, lat, lng))
    .filter(Boolean)
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .map((s) => attachDistance(s, lat, lng))
    .filter((s) => s.distanceM <= DEFAULT_RADIUS_M)
    .sort((a, b) => a.distanceM - b.distanceM);
  list.forEach((s) => {
    poiRegistry.set(s.id, s);
    if (poiRegistry.size > 5000) poiRegistry.clear();
  });
  if (poiCache.size >= POI_CACHE_MAX) poiCache.clear();
  poiCache.set(key, { list, ts: Date.now() });
  return list;
}

// ===== 统一出口（两个模式同构；amap 模式均为 async）=====

const SORTERS = {
  distance: (a, b) => a.distanceM - b.distanceM,
  rating: (a, b) => (b.rating || 0) - (a.rating || 0) || a.distanceM - b.distanceM,
  price: (a, b) => (a.avgPrice ?? Infinity) - (b.avgPrice ?? Infinity),
};

/** 按模式取「全量本地候选」（amap/osm 为实时拉取，demo 为静态数据） */
async function sourceList(lat, lng) {
  if (DATA_MODE === 'amap') return amapList(lat, lng);
  if (DATA_MODE === 'osm') return osmList(lat, lng);
  return demoList().map((s) => attachDistance(s, lat, lng));
}

/** 附近店铺列表 */
async function listNearby(opts = {}) {
  const { lat, lng } = opts;
  if (!isFinite(lat) || !isFinite(lng)) return [];
  const radius = Number(opts.radius) > 0 ? Number(opts.radius) : DEFAULT_RADIUS_M;
  let list = await sourceList(lat, lng);
  list = list.filter((s) => s.distanceM <= radius);
  if (opts.category) list = list.filter((s) => s.cuisine === opts.category);
  if (opts.openOnly) list = list.filter((s) => s.openStatus !== 'closed');
  if (Number(opts.maxPrice) > 0) {
    // 人均未知（高德未返回）的店铺不因预算过滤被排除
    list = list.filter((s) => s.avgPrice == null || s.avgPrice <= Number(opts.maxPrice));
  }
  list.sort(SORTERS[opts.sort] || SORTERS.distance);
  return list;
}

/** 店铺详情（含菜单；POI 模式无菜单，dishes 为空数组） */
async function detail(id, lat, lng) {
  if (DATA_MODE !== 'demo') {
    // 优先查注册表（下单守卫等场景只有 shopId、没有坐标）
    if (poiRegistry.has(id)) {
      const s = poiRegistry.get(id);
      return { ...(isFinite(lat) && isFinite(lng) ? attachDistance(s, lat, lng) : s), license: s.license || null, dishes: [] };
    }
    if (!isFinite(lat) || !isFinite(lng)) return null;
    const list = await sourceList(lat, lng);
    const found = list.find((s) => s.id === id);
    return found ? { ...found, license: found.license || null, dishes: [] } : null;
  }
  const shop = DEMO_SHOPS.find((s) => s.id === id);
  if (!shop) return null;
  return { ...attachDistance(demoSummary(shop), lat, lng), license: shop.license, dishes: shop.dishes };
}

/**
 * 转盘候选池：「当前可下单」+ 偏好 + 排除过滤（MRD §5.1）
 * POI 模式下「可下单」解释为：营业中 + 距离内（配送属性不可知）
 */
async function wheelPool(opts = {}) {
  const { lat, lng } = opts;
  if (!isFinite(lat) || !isFinite(lng)) return [];
  const exclude = new Set([].concat(opts.excludeIds || [], opts.blacklistIds || []));
  const avoid = new Set(opts.avoidTags || []);
  const maxPrice = Number(opts.maxPrice) > 0 ? Number(opts.maxPrice) : 0;

  const base = await sourceList(lat, lng);

  return base
    .filter((s) => s.distanceM <= DEFAULT_RADIUS_M && s.openStatus !== 'closed')
    .filter((s) => !exclude.has(s.id))
    .filter((s) => !(maxPrice > 0 && s.avgPrice != null && s.avgPrice > maxPrice))
    .filter((s) => ![...avoid].some((t) => s.tags.includes(t)));
}

/** 品类转盘数据源：同半径内全部营业中店铺（不做偏好过滤，保证降级可用） */
async function categoryPool(lat, lng) {
  if (!isFinite(lat) || !isFinite(lng)) return [];
  const base = await sourceList(lat, lng);
  return base.filter((s) => s.distanceM <= DEFAULT_RADIUS_M && s.openStatus !== 'closed');
}

function meta() {
  return {
    dataMode: DATA_MODE,
    addresses: ADDRESSES,
    cuisines: DATA_MODE === 'demo' ? [...new Set(DEMO_SHOPS.map((s) => s.cuisine))] : COMMON_CUISINES,
    avoidTags: DATA_MODE === 'demo' ? AVOID_TAGS : [],
    radius: DEFAULT_RADIUS_M,
  };
}

/** 逆地理编码仅 amap 模式可用（demo 模式无真实地址服务）
 *  入参 lat/lng 已由 server.js parseCoords 统一转为 GCJ-02，这里不能再转一次 */
async function reverseGeocode(lat, lng) {
  const data = await amap.regeo(lat, lng);
  return data.regeocode && data.regeocode.formatted_address;
}

/** 地址关键字联想（amap 模式）
 *  高德返回的是 GCJ-02 坐标，必须转回 WGS-84 再下发——
 *  前端契约是「客户端只上报 WGS-84」，否则会被 parseCoords 二次转换造成约 500 米偏移
 *  bias: { lat, lng } 当前位置，用于结果就近排序 */
async function suggest(keywords, city, bias) {
  const data = await amap.textSearch(keywords, city, bias);
  return (data.pois || [])
    .map((p) => {
      const [lngS, latS] = String(p.location || '').split(',');
      const gcjLat = parseFloat(latS);
      const gcjLng = parseFloat(lngS);
      if (!isFinite(gcjLat) || !isFinite(gcjLng)) return null;
      const { lat, lng } = gcj2wgs(gcjLat, gcjLng);
      const district = [p.pname, p.cityname, p.adname].filter(Boolean).join('');
      return { id: 'a' + p.id, name: p.name, district, lat, lng };
    })
    .filter(Boolean)
    .slice(0, 8);
}

/** 逆地理（osm 模式，Photon，WGS-84 原样使用） */
async function reverseGeocodeOsm(lat, lng) {
  return osm.photonReverse(lat, lng);
}

/** 地址关键字联想（osm 模式，Photon，免注册；bias 为当前位置，用于结果就近排序） */
async function suggestOsm(keywords, bias) {
  return osm.photonSearch(keywords, bias);
}

module.exports = {
  DATA_MODE,
  listNearby,
  detail,
  wheelPool,
  categoryPool,
  meta,
  reverseGeocode,
  suggest,
  reverseGeocodeOsm,
  suggestOsm,
  DEFAULT_RADIUS_M,
};
