'use strict';

// 本地模拟高德 Web 服务接口，仅用于开发联调（无真实 Key 时验证 amap 适配层）。
// 启动：node server/test/mock-amap.js   （默认 8790 端口）
// 联调：AMAP_KEY=test AMAP_BASE=http://127.0.0.1:8790 node server/server.js
// key 传 "INVALID" 时返回错误，用于测试失败路径。

const http = require('http');
const { URL } = require('url');

const NAMES = [
  { name: '老王麻辣烫', type: '餐饮服务;特色美食;麻辣烫', rating: '4.2', cost: '28', open: '10:00-22:00' },
  { name: '川味轩(旗舰店)', type: '餐饮服务;中餐厅;四川菜(川菜)', rating: '4.6', cost: '42', open: '10:30-21:30' },
  { name: '樱花寿司·日料', type: '餐饮服务;外国餐厅;日本料理', rating: '4.7', cost: '55', open: '11:00-21:00' },
  { name: '鸿毛饺子馆', type: '餐饮服务;中餐厅;饺子', rating: '4.3', cost: '22', open: '07:30-20:30' },
  { name: '蓝瓶子咖啡', type: '餐饮服务;咖啡厅', rating: '4.5', cost: '35', open: '08:00-22:00' },
  { name: '甜心甜品屋', type: '餐饮服务;甜品店', rating: '', cost: '', open: '' },
  { name: '小龙坎火锅', type: '餐饮服务;特色美食;火锅', rating: '4.4', cost: '88', open: '11:00-23:00' },
  { name: '豪门烤肉店', type: '餐饮服务;特色美食;烧烤', rating: '4.1', cost: '76', open: '11:00-23:30' },
  { name: '山西面馆', type: '餐饮服务;中餐厅;面馆', rating: '4.0', cost: '19', open: '06:30-20:00' },
  { name: '绿光轻食沙拉', type: '餐饮服务;中餐厅;其他中餐厅', rating: '4.6', cost: '38', open: '09:00-20:00' },
  { name: '肯德基宅急送', type: '餐饮服务;快餐厅;肯德基', rating: '4.0', cost: '33', open: '00:00-23:59' },
  { name: '韩香石锅拌饭', type: '餐饮服务;外国餐厅;韩国料理', rating: '4.5', cost: '36', open: '10:30-21:00' },
];

function rnd(n) {
  return (Math.sin(n) + 1) / 2;
}

function makePois(lat, lng) {
  const seed = Math.round((lat + lng) * 1e4);
  return NAMES.map((n, i) => {
    const jitter = (k) => (rnd(seed + i * 13 + k) - 0.5) * 0.02; // ±约1公里
    const biz = n.rating || n.cost || n.open ? { rating: n.rating, cost: n.cost, open_time: n.open } : {};
    return {
      id: 'MOCK' + (seed + i),
      name: n.name,
      type: n.type,
      typecode: '050000',
      address: `模拟路 ${i + 1} 号院 ${i + 1} 层`,
      location: `${(lng + jitter(1)).toFixed(6)},${(lat + jitter(2)).toFixed(6)}`,
      tel: '010-6' + String(100000 + i * 7).slice(0, 6),
      pname: '北京市',
      cityname: '北京市',
      adname: '朝阳区',
      biz_ext: biz,
    };
  });
}

const json = (res, code, data) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const key = u.searchParams.get('key') || '';

  if (!key || key === 'INVALID') {
    return json(res, 200, { status: '0', info: 'INVALID_USER_KEY', infocode: '10001' });
  }

  const location = (u.searchParams.get('location') || '0,0').split(',');
  const lng = parseFloat(location[0]);
  const lat = parseFloat(location[1]);

  if (u.pathname === '/v3/place/around') {
    return json(res, 200, { status: '1', info: 'OK', count: String(NAMES.length), pois: makePois(lat, lng) });
  }

  if (u.pathname === '/v3/place/text') {
    const kw = u.searchParams.get('keywords') || '';
    const pois = makePois(lat || 39.9, lng || 116.46).filter(
      (p) => p.name.includes(kw) || p.type.includes(kw) || !kw
    );
    return json(res, 200, { status: '1', info: 'OK', count: String(pois.length), pois });
  }

  if (u.pathname === '/v3/geocode/regeo') {
    return json(res, 200, {
      status: '1',
      info: 'OK',
      regeocode: {
        formatted_address: `北京市朝阳区模拟街道 ${Math.abs(Math.round(lng * 1000) % 100)} 号楼`,
        addressComponent: { province: '北京市', city: '北京市', district: '朝阳区' },
      },
    });
  }

  json(res, 404, { status: '0', info: 'NOT_FOUND' });
});

const port = Number(process.env.PORT) || 8790;
server.listen(port, '127.0.0.1', () => console.log(`mock-amap 已启动: http://127.0.0.1:${port}`));
