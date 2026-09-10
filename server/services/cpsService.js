'use strict';

// CPS 跳转链接生成
// 联盟推广位（美团联盟 / 淘宝联盟-饿了么）通过环境变量配置，无真实 PID 时
// 回退到平台官方入口，保证"跳转 + 归因 + 漏斗"链路先跑通。
//
//   CPS_SOURCE_ID            联盟推广位/sid，会拼进链接用于归因
//   CPS_MEITUAN_TEMPLATE     美团跳转模板，{keyword} 替换为店名、{sid} 替换为推广位
//   CPS_ELEME_TEMPLATE       饿了么跳转模板，同上
//
// 拿到联盟真实链接后示例：
//   CPS_SOURCE_ID=你的推广位ID \
//   CPS_MEITUAN_TEMPLATE='https://你的联盟跳转链接?sid={sid}&qhclick={keyword}' \
//   node server/server.js

const SOURCE_ID = process.env.CPS_SOURCE_ID || '';

const TEMPLATES = {
  meituan: process.env.CPS_MEITUAN_TEMPLATE || 'https://h5.waimai.meituan.com?keyword={keyword}',
  eleme: process.env.CPS_ELEME_TEMPLATE || 'https://h5.ele.me?keyword={keyword}',
};

const PLATFORMS = Object.keys(TEMPLATES);

/** 生成跳转目标 URL；平台不支持返回 null。
 *  模板含 {sid} 时替换为推广位；否则配置了 SOURCE_ID 时自动追加 &sid= 归因参数 */
function buildUrl(platform, keyword) {
  const tpl = TEMPLATES[platform];
  if (!tpl) return null;
  let url = tpl.replace('{keyword}', encodeURIComponent(keyword || '')).replace('{sid}', encodeURIComponent(SOURCE_ID));
  if (SOURCE_ID && !url.includes(SOURCE_ID)) {
    url += (url.includes('?') ? '&' : '?') + 'sid=' + encodeURIComponent(SOURCE_ID);
  }
  return url;
}

module.exports = { SOURCE_ID, PLATFORMS, buildUrl };
