// 静态托管模式数据源（GitHub Pages 等无后端环境）
// 浏览器直接查 Overpass（周边真实餐馆）与 Photon（地址搜索），均支持 CORS、无需任何账号

const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const PHOTON = 'https://photon.komoot.io';

const RADIUS = 1500; // 午餐步行圈：查询快（数据量降 75%）且够用
const cache = new Map();
const TTL = 10 * 60 * 1000;

const OSM_CUISINE_RULES = [
  [/japanese|sushi|ramen/, '日料', '🍣'],
  [/italian|pizza|pasta/, '西式', '🍝'],
  [/burger/, '快餐西式', '🍔'],
  [/coffee/, '咖啡', '☕'],
  [/tea|bubble_tea/, '茶饮甜品', '🧋'],
  [/kebab|barbecue|bbq/, '烧烤', '🍢'],
  [/noodle|dumpling/, '面食小吃', '🍜'],
  [/chinese|sichuan|cantonese|hot_pot|hotpot/, '中餐', '🍲'],
  [/korean/, '韩式', '🍚'],
  [/thai|vietnamese|asian/, '亚洲料理', '🍛'],
  [/salad|vegetarian|vegan/, '轻食', '🥗'],
];

function mapCuisine(tags) {
  const s = `${tags.cuisine || ''}${tags.amenity || ''}`;
  for (const [re, label, emoji] of OSM_CUISINE_RULES) {
    if (re.test(s)) return { label, emoji };
  }
  if (tags.amenity === 'cafe') return { label: '咖啡', emoji: '☕' };
  if (tags.amenity === 'fast_food') return { label: '快餐西式', emoji: '🍔' };
  if (tags.amenity === 'food_court') return { label: '美食广场', emoji: '🍽️' };
  return { label: '餐厅', emoji: '🍽️' };
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function statusOf(openTime, closeTime) {
  if (!openTime || !closeTime) return { open: true, openStatus: 'open', closingInMin: null };
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = openTime.split(':').map(Number);
  const [ch, cm] = closeTime.split(':').map(Number);
  const o = oh * 60 + om, c = ch * 60 + cm;
  const isOpen = cur >= o && cur < c;
  return {
    open: isOpen,
    openStatus: !isOpen ? 'closed' : c - cur <= 30 ? 'closingSoon' : 'open',
    closingInMin: isOpen ? c - cur : null,
  };
}

function mapElement(el, lat, lng) {
  const tags = el.tags || {};
  const name = tags.name || tags['name:zh'] || tags['name:en'];
  if (!name) return null;
  const sLat = el.lat ?? el.center?.lat;
  const sLng = el.lon ?? el.center?.lon;
  if (!isFinite(sLat) || !isFinite(sLng)) return null;
  const oh = String(tags.opening_hours || '').match(/(\d{1,2}):(\d{2})\s*[-~—至到]\s*(\d{1,2}):(\d{2})/);
  const openTime = oh ? `${oh[1].padStart(2, '0')}:${oh[2]}` : null;
  const closeTime = oh ? `${oh[3].padStart(2, '0')}:${oh[4]}` : null;
  const st = statusOf(openTime, closeTime);
  const cuisine = mapCuisine(tags);
  const short = (name.replace(/[（(].*?[)）]/g, '').trim() || name).slice(0, 5);
  return {
    id: 'o' + (el.type || 'n') + el.id,
    name,
    short,
    emoji: cuisine.emoji,
    cuisine: cuisine.label,
    rating: null,
    monthlySales: null,
    avgPrice: null,
    isNew: false,
    zone: null,
    address: [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join('') || null,
    tel: tags.phone || tags['contact:phone'] || null,
    lat: sLat,
    lng: sLng,
    openTime,
    closeTime,
    deliveryFee: null,
    minOrder: 0,
    deliveryMinutes: null,
    license: null,
    tags: [],
    sourcedFrom: 'poi',
    distanceM: Math.round(haversineM(lat, lng, sLat, sLng)),
    ...st,
  };
}

async function fetchOne(ep, q) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch(ep, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const data = await res.json();
    if (!data.elements || data.elements.length === 0) throw new Error('empty');
    return data.elements;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOverpass(lat, lng, radius) {
  const q = `[out:json][timeout:15];
(
  node["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:${radius},${lat},${lng});
  way["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:${radius},${lat},${lng});
);
out center 40;`;
  // 双镜像竞速：谁先返回有效数据用谁
  return Promise.any(ENDPOINTS.map((ep) => fetchOne(ep, q))).catch(() => null);
}

/** 周边真实店铺（带网格缓存） */
export async function fetchShops(lat, lng, radius = RADIUS) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.list;
  // sessionStorage：刷新页面不重复查询
  try {
    const ss = sessionStorage.getItem('zzdc.osm.' + key);
    if (ss) {
      const saved = JSON.parse(ss);
      if (Date.now() - saved.ts < TTL) { cache.set(key, { list: saved.list, ts: saved.ts }); return saved.list; }
    }
  } catch (e) { /* 忽略 */ }
  const elements = (await fetchOverpass(lat, lng, radius)) || [];
  if (elements.length === 0) throw new Error('周边暂无 OpenStreetMap 餐饮数据');
  const seen = new Set();
  const list = elements
    .map((el) => mapElement(el, lat, lng))
    .filter(Boolean)
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .filter((s) => s.distanceM <= radius)
    .sort((a, b) => a.distanceM - b.distanceM);
  cache.set(key, { list, ts: Date.now() });
  try { sessionStorage.setItem('zzdc.osm.' + key, JSON.stringify({ list, ts: Date.now() })); } catch (e) { /* 忽略 */ }
  return list;
}

/** 地址关键字搜索（Photon） */
export async function searchAddress(keywords) {
  const res = await fetch(`${PHOTON}/api?q=${encodeURIComponent(keywords)}&limit=6`);
  if (!res.ok) throw new Error('地址搜索服务暂时不可用');
  const data = await res.json();
  return (data.features || [])
    .filter((f) => f.geometry && f.geometry.coordinates)
    .map((f) => {
      const p = f.properties || {};
      const [lng, lat] = f.geometry.coordinates;
      const district = [p.city, p.district, p.street].filter(Boolean).join('') || '';
      return { id: 'p' + (p.osm_id || Math.random()), name: p.name || district, district, lat, lng };
    })
    .filter((s) => s.name);
}

/** 逆地理（坐标 → 地址名） */
export async function reverseName(lat, lng) {
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lng}`);
    const data = await res.json();
    const p = data.features?.[0]?.properties || {};
    return [p.street, p.district, p.city].filter(Boolean).join('') || null;
  } catch (e) {
    return null;
  }
}

/** 加权随机（不放回） */
function weightedSample(pool, k) {
  const items = pool.map((s) => ({ s, w: s.rating >= 4.5 ? 1.6 : 1 }));
  const picked = [];
  while (picked.length < k && items.length) {
    const total = items.reduce((acc, it) => acc + it.w, 0);
    let r = Math.random() * total, idx = 0;
    for (; idx < items.length; idx++) { r -= items[idx].w; if (r <= 0) break; }
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

/** 转盘候选生成（与服务端 wheelService 同构）：加权随机 + 品类降级 */
export async function buildWheelStatic({ lat, lng, excludeIds = [], maxPrice = 0, avoidTags = [], blacklistIds = [] }) {
  const all = await fetchShops(lat, lng, RADIUS);
  const exclude = new Set([].concat(excludeIds || [], blacklistIds || []));
  const avoid = new Set(avoidTags || []);
  const mp = Number(maxPrice) > 0 ? Number(maxPrice) : 0;

  const pool = all
    .filter((s) => s.distanceM <= RADIUS && s.openStatus !== 'closed')
    .filter((s) => !exclude.has(s.id))
    .filter((s) => !(mp > 0 && s.avgPrice != null && s.avgPrice > mp))
    .filter((s) => ![...avoid].some((t) => s.tags.includes(t)));

  if (pool.length >= 6) {
    const picked = weightedSample(pool, Math.min(8, pool.length));
    return { mode: 'shop', sectors: picked.map((s) => ({ type: 'shop', shop: s })), poolSize: pool.length };
  }

  // 品类降级：品类只保留「偏好过滤后仍有店」的
  const okCuisines = new Set(pool.map((s) => s.cuisine));
  const byCuisine = new Map();
  for (const s of all) {
    if (s.distanceM > RADIUS || s.openStatus === 'closed') continue;
    if (!okCuisines.has(s.cuisine) || byCuisine.has(s.cuisine)) continue;
    byCuisine.set(s.cuisine, { type: 'category', cuisine: s.cuisine, emoji: s.emoji });
  }
  const cats = shuffle([...byCuisine.values()]).slice(0, 8);
  if (cats.length >= 2) return { mode: 'category', sectors: cats, poolSize: pool.length };
  return { mode: 'empty', sectors: [], poolSize: pool.length };
}
