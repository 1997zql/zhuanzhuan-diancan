'use strict';

// 转化埋点：全链路漏斗（曝光 → 转动 → 出结果 → 点下单 → 平台跳转）
// 内存环形缓冲 + JSONL 文件持久化（重启不丢），/api/stats 输出漏斗汇总

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'events.jsonl');
const MAX = 5000;
/** JSONL 超过该字节数轮转为 events.jsonl.1（可用 TRACK_MAX_FILE_BYTES 覆盖，便于测试/调优） */
const MAX_FILE_BYTES = Number(process.env.TRACK_MAX_FILE_BYTES) || 2 * 1024 * 1024;

let fileBytes = 0;
try {
  fileBytes = fs.statSync(FILE).size;
} catch (err) {
  /* 首次运行无文件 */
}

/** 允许上报的事件（白名单，防垃圾数据） */
const EVENTS = new Set([
  'session_start', // 启动
  'page_view',     // 页面浏览
  'wheel_load',    // 转盘候选池加载
  'wheel_spin',    // 点击转动
  'wheel_result',  // 转出结果
  'order_click',   // 点击下单/跳转（意向）
  'order_submit',  // 站内下单成功（仅服务端产生）
  'cps_redirect',  // CPS 302 跳转（仅服务端产生）
  'shop_copy',     // 复制店名
  'shop_exclude',  // 排除此店
  'shop_batch',    // 换一批
  'shop_ban',      // 拉黑
  'share_open',    // 打开分享卡片
]);

/** 客户端可上报子集：order_submit / cps_redirect 由服务端产生，
 *  开放给 /api/track 会让转化漏斗被任意伪造 */
const CLIENT_EVENTS = new Set([...EVENTS].filter((e) => e !== 'order_submit' && e !== 'cps_redirect'));

/** 埋点属性白名单（防止任意字段写入） */
const PROP_KEYS = new Set(['sid', 'cid', 'view', 'mode', 'poolSize', 'shopId', 'shopName', 'isPoi', 'category', 'platform', 'source', 'total', 'fromWheel']);

const events = [];

// 启动时从 JSONL 恢复最近事件
try {
  const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean);
  for (const line of lines.slice(-MAX)) {
    try {
      const e = JSON.parse(line);
      if (e && e.event && EVENTS.has(e.event)) events.push(e);
    } catch (err) {
      /* 跳过坏行 */
    }
  }
} catch (err) {
  /* 首次运行无文件 */
}

function track(event, props = {}) {
  if (!EVENTS.has(event)) return null;
  const e = { ts: Date.now(), event };
  for (const [k, v] of Object.entries(props)) {
    if (!PROP_KEYS.has(k) || v == null) continue;
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (s.length <= 60) e[k] = s;
  }
  events.push(e);
  if (events.length > MAX) events.splice(0, events.length - MAX);
  try {
    if (fileBytes >= MAX_FILE_BYTES) {
      fs.rmSync(FILE + '.1', { force: true });
      fs.renameSync(FILE, FILE + '.1');
      fileBytes = 0;
    }
    const line = JSON.stringify(e) + '\n';
    fs.appendFileSync(FILE, line);
    fileBytes += Buffer.byteLength(line);
  } catch (err) {
    /* 磁盘异常不阻塞业务 */
  }
  return e;
}

const isToday = (ts) => new Date(ts).toDateString() === new Date().toDateString();
const countOf = (list, name) => list.filter((e) => e.event === name).length;

function stats() {
  const today = events.filter((e) => isToday(e.ts));
  const funnelKeys = ['wheel_load', 'wheel_spin', 'wheel_result', 'order_click', 'cps_redirect', 'order_submit'];
  const counts = {};
  for (const k of funnelKeys) counts[k] = { total: countOf(events, k), today: countOf(today, k) };

  const byPlatform = {};
  for (const e of events.filter((x) => x.event === 'cps_redirect')) {
    byPlatform[e.platform] = (byPlatform[e.platform] || 0) + 1;
  }

  return {
    total: events.length,
    counts,
    cpsByPlatform: byPlatform,
    recent: events.slice(-15).reverse(),
  };
}

module.exports = { track, stats, EVENTS, CLIENT_EVENTS };
