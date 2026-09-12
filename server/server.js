'use strict';

// 轻量 .env 加载（零依赖）：启动前把项目根目录 .env 合并进 process.env
// 必须先于各 service 加载执行（service 在 require 时读取环境变量）
const fs = require('fs');
const path = require('path');
(function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (e) {
    /* 无 .env 文件则忽略 */
  }
})();

const http = require('http');
const { URL } = require('url');

const shopService = require('./services/shopService');
const wheelService = require('./services/wheelService');
const orderService = require('./services/orderService');
const cpsService = require('./services/cpsService');
const { wgs2gcj } = require('./lib/geo');
const track = require('./lib/track');

const WEB_DIR = path.join(__dirname, '..', 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, code, data, type = 'application/json; charset=utf-8') {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        const err = new Error('请求体不是合法 JSON');
        err.code = 'BAD_JSON';
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function apiError(res, err, fallbackCode = 500) {
  const code = err.code || 'SERVER_ERROR';
  const map = {
    MIN_ORDER: 400,
    BAD_JSON: 400,
    EMPTY_CART: 400,
    SHOP_NOT_FOUND: 404,
    DISH_NOT_FOUND: 400,
    POI_NO_ORDER: 400,
    AMAP_NOT_CONFIGURED: 400,
    AMAP_NETWORK: 502,
    AMAP_HTTP: 502,
    AMAP_API: 502,
    OSM_HTTP: 502,
    OSM_API: 502,
    OSM_NETWORK: 502,
  };
  const known = map[code];
  if (!known) {
    // 未归类的异常：记日志，但不把内部报错细节透给客户端
    console.error('[server]', err);
    return send(res, fallbackCode, { error: code, message: '服务开小差了，请稍后再试' });
  }
  send(res, known, { error: code, message: err.message, needMore: err.needMore });
}

/** 客户端坐标按数据源归一：amap 数据为 GCJ-02（需 WGS→GCJ 转换）；osm/demo 为 WGS-84（原样使用） */
function parseCoords(u) {
  const lat = parseFloat(u.searchParams.get('lat'));
  const lng = parseFloat(u.searchParams.get('lng'));
  if (!isFinite(lat) || !isFinite(lng)) return { lat: NaN, lng: NaN };
  return shopService.DATA_MODE === 'amap' ? wgs2gcj(lat, lng) : { lat, lng };
}

/** POST body 里的 id/tag 类字段统一收敛为字符串数组（脏数据不再引发 500） */
function toStrArray(v) {
  if (Array.isArray(v)) return [...new Set(v.map((x) => String(x).trim().slice(0, 64)).filter(Boolean))];
  if (typeof v === 'string' && v.trim()) return [v.trim().slice(0, 64)];
  return [];
}

async function handleApi(req, res, u) {
  const p = u.pathname;

  if (req.method === 'GET' && p === '/api/meta') {
    return send(res, 200, shopService.meta());
  }

  if (req.method === 'GET' && p === '/api/shops') {
    const q = u.searchParams;
    const { lat, lng } = parseCoords(u);
    const shops = await shopService.listNearby({
      lat,
      lng,
      category: q.get('category') || '',
      sort: q.get('sort') || 'distance',
      openOnly: q.get('openOnly') === '1',
      maxPrice: parseFloat(q.get('maxPrice')) || 0,
    });
    return send(res, 200, { shops });
  }

  const shopMatch = p.match(/^\/api\/shops\/([\w-]+)$/);
  if (req.method === 'GET' && shopMatch) {
    const { lat, lng } = parseCoords(u);
    const shop = await shopService.detail(shopMatch[1], lat, lng);
    if (!shop) return send(res, 404, { error: 'SHOP_NOT_FOUND', message: '店铺不存在' });
    return send(res, 200, { shop });
  }

  if (req.method === 'POST' && p === '/api/wheel') {
    const body = await readBody(req);
    const rawLat = parseFloat(body.lat);
    const rawLng = parseFloat(body.lng);
    const gcj = shopService.DATA_MODE === 'amap' ? wgs2gcj(rawLat, rawLng) : { lat: rawLat, lng: rawLng };
    const wheel = await wheelService.buildWheel({
      lat: gcj.lat,
      lng: gcj.lng,
      excludeIds: toStrArray(body.excludeIds),
      maxPrice: Number(body.maxPrice) > 0 ? Number(body.maxPrice) : 0,
      avoidTags: toStrArray(body.avoidTags),
      blacklistIds: toStrArray(body.blacklistIds),
    });
    return send(res, 200, wheel);
  }

  if (req.method === 'POST' && p === '/api/orders') {
    const body = await readBody(req);
    try {
      const order = await orderService.createOrder(body);
      return send(res, 200, { order });
    } catch (err) {
      return apiError(res, err);
    }
  }

  if (req.method === 'GET' && p === '/api/orders') {
    const cid = (u.searchParams.get('cid') || '').slice(0, 64);
    return send(res, 200, { orders: orderService.list(cid) });
  }

  // 埋点上报（sendBeacon / fetch，失败静默）
  // 只收客户端事件白名单：order_submit / cps_redirect 由服务端产生，防漏斗被伪造
  if (req.method === 'POST' && p === '/api/track') {
    try {
      const body = await readBody(req);
      const event = String(body.event || '');
      if (track.CLIENT_EVENTS.has(event)) track.track(event, body);
    } catch (err) {
      /* 埋点数据异常直接丢弃，不影响业务 */
    }
    return send(res, 204, '');
  }

  // 运营漏斗汇总
  if (req.method === 'GET' && p === '/api/stats') {
    return send(res, 200, track.stats());
  }

  // CPS 302 跳转：服务端记录点击归因后重定向到联盟链接/平台入口
  if (req.method === 'GET' && p === '/api/cps/go') {
    const platform = u.searchParams.get('platform') || '';
    const name = (u.searchParams.get('name') || '').slice(0, 40);
    const shopId = (u.searchParams.get('shopId') || '').slice(0, 40);
    const source = (u.searchParams.get('source') || '').slice(0, 20);
    const target = cpsService.buildUrl(platform, name);
    if (!target) return send(res, 400, { error: 'BAD_PLATFORM', message: '不支持的平台' });
    track.track('cps_redirect', { platform, shopId, name, source });
    res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
    return res.end();
  }

  // 地址联想：amap 模式走高德，osm 模式走 Photon（均免扫码）
  if (req.method === 'GET' && p === '/api/geocode/suggest') {
    if (shopService.DATA_MODE === 'demo') {
      return send(res, 400, { error: 'GEOCODE_UNSUPPORTED', message: '演示模式不支持地址搜索，请切换数据源' });
    }
    const keywords = (u.searchParams.get('keywords') || '').trim();
    if (!keywords) return send(res, 200, { suggestions: [] });
    const biasLat = parseFloat(u.searchParams.get('lat'));
    const biasLng = parseFloat(u.searchParams.get('lng'));
    // amap 侧 location 需要 GCJ-02（与 parseCoords 同规则）；osm/Photon 用 WGS-84 原样
    const bias = isFinite(biasLat) && isFinite(biasLng)
      ? (shopService.DATA_MODE === 'amap' ? wgs2gcj(biasLat, biasLng) : { lat: biasLat, lng: biasLng })
      : null;
    try {
      const suggestions =
        shopService.DATA_MODE === 'amap'
          ? await shopService.suggest(keywords, u.searchParams.get('city'), bias)
          : await shopService.suggestOsm(keywords, bias);
      return send(res, 200, { suggestions });
    } catch (err) {
      return apiError(res, err);
    }
  }

  if (req.method === 'GET' && p === '/api/geocode/reverse') {
    if (shopService.DATA_MODE === 'demo') {
      return send(res, 400, { error: 'GEOCODE_UNSUPPORTED', message: '演示模式不支持逆地理编码' });
    }
    const { lat, lng } = parseCoords(u);
    try {
      const address =
        shopService.DATA_MODE === 'amap'
          ? await shopService.reverseGeocode(lat, lng)
          : await shopService.reverseGeocodeOsm(lat, lng);
      return send(res, 200, { address });
    } catch (err) {
      return apiError(res, err);
    }
  }

  return send(res, 404, { error: 'NOT_FOUND', message: '接口不存在' });
}

/** 分享元信息注入：把 index.html 里的 __OG_BASE__ 替换为本次请求的绝对地址，
 *  og:url / og:image 必须是绝对 URL 才能被微信、Telegram 等抓取成卡片 */
function ogBaseOf(req) {
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

function staticFile(res, u, req) {
  const reqPath = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname);
  const file = path.normalize(path.join(WEB_DIR, reqPath));
  if (!file.startsWith(WEB_DIR)) return send(res, 403, { error: 'FORBIDDEN' });

  fs.readFile(file, (err, buf) => {
    if (err) {
      // SPA 回退：无扩展名的路径一律回首页
      if (!path.extname(reqPath)) {
        return fs.readFile(path.join(WEB_DIR, 'index.html'), (e2, b2) => {
          if (e2) return send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
          res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
          res.end(b2.toString('utf8').replace(/__OG_BASE__/g, ogBaseOf(req)));
        });
      }
      return send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
    }
    const ext = path.extname(file).toLowerCase();
    const body = ext === '.html' ? buf.toString('utf8').replace(/__OG_BASE__/g, ogBaseOf(req)) : buf;
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
    });
    res.end(body);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (u.pathname.startsWith('/api/')) return await handleApi(req, res, u);
    return staticFile(res, u, req);
  } catch (err) {
    return apiError(res, err);
  }
});

let port = Number(process.env.PORT) || 8787;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && port < 3010 + 6000) {
    port += 1;
    console.log(`端口被占用，改用 ${port}`);
    server.listen(port, '0.0.0.0');
  } else {
    console.error('服务启动失败:', err.message);
    process.exit(1);
  }
});
server.listen(port, '0.0.0.0', () => {
  console.log(`转转点餐已启动：http://localhost:${port}（数据模式：${shopService.DATA_MODE}）`);
});
