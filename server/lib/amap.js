'use strict';

// 高德 Web 服务 API 客户端
// Key 只保存在服务端环境变量 AMAP_KEY，绝不下发前端；AMAP_BASE 供本地 mock 联调覆盖

const KEY = process.env.AMAP_KEY || '';
const BASE = process.env.AMAP_BASE || 'https://restapi.amap.com';
const TIMEOUT_MS = 5000;

const enabled = () => !!KEY;

async function get(path, params) {
  const u = new URL(BASE + path);
  u.searchParams.set('key', KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') u.searchParams.set(k, v);
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(u, { signal: ac.signal });
  } catch (e) {
    const err = new Error('高德服务连接失败或超时');
    err.code = 'AMAP_NETWORK';
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = new Error(`高德服务响应异常（HTTP ${res.status}）`);
    err.code = 'AMAP_HTTP';
    throw err;
  }
  const data = await res.json();
  if (String(data.status) !== '1') {
    const err = new Error(`高德接口错误：${data.info || '未知'}`);
    err.code = 'AMAP_API';
    throw err;
  }
  return data;
}

/** 周边搜索（注意：高德 location 参数为 "经度,纬度" 顺序，GCJ-02 坐标系） */
const around = (lat, lng, { radius = 3000, page = 1 } = {}) =>
  get('/v3/place/around', {
    location: `${lng},${lat}`,
    radius,
    types: '050000', // 餐饮服务
    offset: 25,
    page,
    extensions: 'all',
  });

/** 关键字搜索（地址联想）；bias = { lat, lng } 时按距用户远近排序，避免全国同名地标挤掉身边结果 */
const textSearch = (keywords, city, bias) =>
  get('/v3/place/text', {
    keywords,
    city,
    citylimit: city ? 'true' : 'false',
    location: bias && isFinite(bias.lat) && isFinite(bias.lng) ? `${bias.lng},${bias.lat}` : null,
    sortdistance: bias ? '1' : null,
    offset: 10,
    page: 1,
    extensions: 'all',
  });

/** 逆地理编码：坐标 → 地址文本 */
const regeo = (lat, lng) => get('/v3/geocode/regeo', { location: `${lng},${lat}` });

module.exports = { enabled, around, textSearch, regeo };
