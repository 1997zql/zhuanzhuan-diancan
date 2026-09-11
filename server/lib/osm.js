'use strict';

// OpenStreetMap 开放数据源（无需注册任何账号）
// - Overpass API：查询任意坐标周边的真实餐饮 POI（WGS-84 坐标系）
// - 数据为开放数据，覆盖度不如商业地图，名称/位置真实但评分、营业时间等常缺失

// 镜像按「数据完整度 + 速度」排序（overpass-api.de 数据全但常 504；osm.ch 数据不全已弃用）
const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const TIMEOUT_MS = 25000;
const UA = 'ZhuanZhuanWheel/1.0 (demo; contact: local)';

const enabled = () => true; // 无需 Key，始终可用

async function fetchWithTimeout(url, options = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ac.signal, headers: { 'User-Agent': UA, ...(options.headers || {}) } });
  } finally {
    clearTimeout(timer);
  }
}

/** 周边餐饮 POI 查询（lat/lng 为 WGS-84） */
async function around(lat, lng, radius = 3000) {
  const q = `[out:json][timeout:25];
(
  node["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:${radius},${lat},${lng});
  way["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:${radius},${lat},${lng});
);
out center 60;`;
  let lastErr = null;
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) {
        lastErr = new Error(`Overpass 响应异常（HTTP ${res.status}）`);
        lastErr.code = 'OSM_HTTP';
        continue;
      }
      const data = await res.json();
      if (!data.elements) {
        lastErr = new Error('Overpass 返回数据为空');
        lastErr.code = 'OSM_API';
        continue;
      }
      return data.elements;
    } catch (e) {
      lastErr = e.code ? e : Object.assign(new Error('Overpass 连接失败'), { code: 'OSM_NETWORK' });
    }
  }
  throw lastErr || new Error('Overpass 不可用');
}

// ===== Photon（OSM 免注册地址搜索 / 逆地理，komoot 提供）=====

const PHOTON = 'https://photon.komoot.io';

/** 地址关键字搜索 → [{ id, name, district, lat, lng }]（WGS-84）
 *  bias = { lat, lng } 时传给 Photon 做就近偏置，避免全国同名地点挤掉身边结果 */
async function photonSearch(keywords, bias, limit = 6) {
  let url = `${PHOTON}/api?q=${encodeURIComponent(keywords)}&limit=${limit}`;
  if (bias && isFinite(bias.lat) && isFinite(bias.lng)) {
    url += `&lat=${bias.lat}&lon=${bias.lng}`;
  }
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    const err = new Error(`Photon 响应异常（HTTP ${res.status}）`);
    err.code = 'OSM_HTTP';
    throw err;
  }
  const data = await res.json();
  return (data.features || [])
    .filter((f) => f.geometry && f.geometry.coordinates)
    .map((f) => {
      const p = f.properties || {};
      const [lng, lat] = f.geometry.coordinates;
      const district = [p.city, p.district, p.street].filter(Boolean).join('') || p.country || '';
      return { id: 'p' + (p.osm_type || '') + (p.osm_id || Math.random()), name: p.name || district, district, lat, lng };
    })
    .filter((s) => s.name);
}

/** 逆地理：坐标 → 地址名（WGS-84） */
async function photonReverse(lat, lng) {
  const res = await fetchWithTimeout(`${PHOTON}/reverse?lat=${lat}&lon=${lng}`);
  if (!res.ok) {
    const err = new Error(`Photon 响应异常（HTTP ${res.status}）`);
    err.code = 'OSM_HTTP';
    throw err;
  }
  const data = await res.json();
  const f = (data.features || [])[0];
  if (!f) return null;
  const p = f.properties || {};
  return [p.street, p.district, p.city].filter(Boolean).join('') || p.name || null;
}

module.exports = { enabled, around, photonSearch, photonReverse };
