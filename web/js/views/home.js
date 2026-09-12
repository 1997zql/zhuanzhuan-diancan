// 转盘页：加载候选 → 转动 → 结果卡片 → 排除/换一批/分享/下单
import { api, platformJumpUrl, isStatic } from '../api.js?v=c5a29c5';
import { runtime, prefs, savePrefs, session, pushSeen } from '../state.js?v=c5a29c5';
import { openSheet, closeSheet, toast, esc, fmt, fmtOr, distText, sfx } from '../ui.js?v=c5a29c5';
import { Wheel } from '../wheel.js?v=c5a29c5';
import { openAddressSheet } from '../topbar.js?v=c5a29c5';
import { track } from '../track.js?v=c5a29c5';

let wheel = null;
let wheelData = null;
let spinning = false;

export async function render(root) {
  const mode = runtime.meta.dataMode;
  const tips =
    mode === 'amap'
      ? `🎯 店铺来自<b>高德地图真实数据</b>：营业中 + 3 公里内的餐饮 POI。<br>
         🙂 不满意可「排除此店再转」（单次最多 5 家），或一键换一批。<br>
         🛵 暂未接入菜单与配送：转到后复制店名，去美团 / 饿了么下单。`
      : mode === 'osm'
        ? `🎯 店铺来自<b>OpenStreetMap 开放数据</b>：周边真实餐饮店（评分/营业信息可能缺失，首次加载约数秒）。<br>
           🙂 不满意可「排除此店再转」（单次最多 5 家），或一键换一批。<br>
           🛵 下单：跳转淘宝闪购 / 外卖平台搜索店名下单。`
        : `🎯 转盘只放<b>当前真实可下单</b>的附近店铺，高分店与新店有适度加权。<br>
           🙂 不满意可「排除此店再转」（单次最多 5 家），或一键换一批。<br>
           ✅ 转到哪家就在哪家下单，所见即所得。`;

  root.innerHTML = `
    <section class="hero" id="hero">
      <div class="hero-sub">今天中午吃什么？</div>
      <div class="hero-sub-sub">转一转，附近能下单的店直接安排</div>
      <div class="wheel-zone">
        <div class="pointer"></div>
        <canvas id="wheelCanvas"></canvas>
        <button class="hub" id="hubBtn">转<br>一下</button>
      </div>
      <div class="wheel-meta" id="wheelMeta">正在加载附近店铺…</div>
      <div class="hero-actions"><button class="btn-spin" id="spinBtn">🎲 开转</button></div>
    </section>
    <div class="card" style="margin-top:12px">
      <div style="font-size:12px;color:var(--text-2);line-height:1.9">${tips}</div>
    </div>`;

  wheel = new Wheel(document.getElementById('wheelCanvas'));
  document.getElementById('hubBtn').addEventListener('click', doSpin);
  document.getElementById('spinBtn').addEventListener('click', doSpin);
  await loadSectors(false);
}

function setMeta(text) {
  const el = document.getElementById('wheelMeta');
  if (el) el.textContent = text;
}

function setSpinEnabled(on) {
  const hub = document.getElementById('hubBtn');
  const btn = document.getElementById('spinBtn');
  if (hub) hub.disabled = !on;
  if (btn) btn.disabled = !on;
}

function poolMetaText(d) {
  return d.mode === 'shop'
    ? `候选池 ${d.poolSize} 家可下单 · 高分与新店加权随机`
    : '品类模式 · 店铺候选不足 6 家，转出品类再为你挑店';
}

async function loadSectors(autoSpin) {
  const loc = runtime.location;
  hideEmpty();
  setMeta('正在搜索周边真实餐馆…');
  document.querySelector('.wheel-zone')?.classList.add('loading');
  try {
    wheelData = await api.wheel({
      lat: loc.lat,
      lng: loc.lng,
      excludeIds: [...session.seen, ...session.excluded.map((e) => e.id)],
      maxPrice: prefs.maxPrice,
      avoidTags: prefs.avoidTags,
      blacklistIds: prefs.blacklist.map((b) => b.id),
    });
  } catch (e) {
    document.querySelector('.wheel-zone')?.classList.remove('loading');
    const z = document.querySelector('.wheel-zone');
    const a = document.querySelector('.hero-actions');
    if (z) z.style.display = 'none';
    if (a) a.style.display = 'none';
    const noData = e.code === 'NO_OSM_DATA';
    setMeta(noData ? '附近暂无 OpenStreetMap 餐饮数据' : '数据服务暂时不可用');
    showLoadFail(noData, e.message);
    return;
  }

  const d = wheelData;
  const zone = document.querySelector('.wheel-zone');
  zone?.classList.remove('loading');
  const actions = document.querySelector('.hero-actions');

  if (d.mode === 'empty') {
    zone.style.display = 'none';
    actions.style.display = 'none';
    setMeta(d.poolSize === 0 ? '附近 3 公里暂无可下单店铺' : '附近的店都试过啦');
    showEmpty(d.poolSize === 0);
    return;
  }

  zone.style.display = '';
  actions.style.display = '';
  wheel.setSectors(d.sectors);
  setMeta(poolMetaText(d));
  track('wheel_load', { mode: d.mode, poolSize: d.poolSize });
  if (autoSpin) doSpin();
}

/** 数据服务失败时的重试态（区别于真实空态） */
function showLoadFail(noData, message) {
  removeEmpty();
  const el = document.createElement('div');
  el.id = 'homeEmpty';
  el.className = 'card empty-card';
  el.style.marginTop = '12px';
  el.innerHTML = `
    <div class="big">${noData ? '🗺️' : '📡'}</div>
    <h3>${noData ? '附近暂无开放地图餐饮数据' : '数据服务暂时不可用'}</h3>
    <p>${noData ? '这个区域 OpenStreetMap 覆盖有限，换个地标试试，或稍后再来。' : esc(message || '网络波动，稍后再试')}</p>
    <button class="btn-primary" id="retryLoad">重新加载</button>`;
  document.getElementById('hero').after(el);
  el.querySelector('#retryLoad').addEventListener('click', async () => {
    el.remove();
    const z = document.querySelector('.wheel-zone');
    if (z) z.style.display = '';
    const a = document.querySelector('.hero-actions');
    if (a) a.style.display = '';
    await loadSectors(false);
  });
}

function showEmpty(noShops) {
  removeEmpty();
  const el = document.createElement('div');
  el.id = 'homeEmpty';
  el.className = 'card empty-card';
  el.style.marginTop = '12px';
  el.innerHTML = noShops
    ? `<div class="big">🏜️</div><h3>附近 3 公里暂无演示数据</h3>
       <p>演示数据覆盖国贸CBD / 望京SOHO / 中关村周边，切换地址后即可开转。</p>
       <button class="btn-primary" id="emptyAddr">切换地址</button>`
    : `<div class="big">🎉</div><h3>附近的店都试过啦</h3>
       <p>排除的店铺有点多，重新开始一轮，或调整偏好换换口味。</p>
       <div style="display:flex;gap:10px;justify-content:center">
         <button class="btn-ghost" id="emptyReset">重新开始</button>
         <button class="btn-primary" id="emptyPref">调整偏好</button>
       </div>`;
  document.getElementById('hero').after(el);
  const on = el.querySelector('#emptyAddr');
  const reset = el.querySelector('#emptyReset');
  const pref = el.querySelector('#emptyPref');
  if (on) on.addEventListener('click', () => openAddressSheet(() => window.dispatchEvent(new Event('hashchange'))));
  if (reset) reset.addEventListener('click', async () => { session.seen = []; session.excluded = []; await loadSectors(false); });
  if (pref) pref.addEventListener('click', () => (location.hash = '#/me'));
}

function removeEmpty() {
  document.getElementById('homeEmpty')?.remove();
}

function hideEmpty() {
  const el = document.getElementById('homeEmpty');
  if (el) el.style.display = 'none';
}

async function doSpin() {
  if (spinning || !wheel || wheel.sectors.length === 0) return;
  spinning = true;
  setSpinEnabled(false);
  track('wheel_spin', { mode: wheelData ? wheelData.mode : '' });
  const r = await wheel.spin();
  spinning = false;
  setSpinEnabled(true);
  if (!r) return;

  const s = r.sector;
  if (s.type === 'category') {
    setMeta(`转出「${s.cuisine}」，正在随机挑店…`);
    const shop = await pickShopOfCategory(s.cuisine);
    if (!shop) {
      toast(`「${s.cuisine}」下暂无符合偏好的可下单店铺，自动重转`);
      await loadSectors(true);
      return;
    }
    if (wheelData) setMeta(poolMetaText(wheelData));
    track('wheel_result', { shopId: shop.id, isPoi: shop.sourcedFrom === 'poi', category: s.cuisine });
    showResult(shop, s.cuisine);
  } else {
    if (wheelData) setMeta(poolMetaText(wheelData));
    track('wheel_result', { shopId: s.shop.id, isPoi: s.shop.sourcedFrom === 'poi' });
    showResult(s.shop, null);
  }
}

/** 品类落点 → 该品类下符合偏好（忌口/预算/黑名单）的可下单店铺中随机一家 */
async function pickShopOfCategory(cuisine) {
  const loc = runtime.location;
  const { shops } = await api.shops({
    lat: loc.lat,
    lng: loc.lng,
    category: cuisine,
    openOnly: 1,
    maxPrice: prefs.maxPrice,
  });
  const avoid = new Set(prefs.avoidTags);
  const ban = new Set(prefs.blacklist.map((b) => b.id));
  const seen = new Set([...session.seen, ...session.excluded.map((e) => e.id)]);
  const ok = (s) => !ban.has(s.id) && !s.tags.some((t) => avoid.has(t));
  let pool = shops.filter((s) => ok(s) && !seen.has(s.id));
  // 全部被本会话排除时放宽 seen，保证品类落点必有结果
  if (pool.length === 0) pool = shops.filter(ok);
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function showResult(shop, category) {
  pushSeen(shop.id);
  const isPoi = shop.sourcedFrom === 'poi';
  const cpsHref = (platform) =>
    isStatic()
      ? platformJumpUrl(platform, shop.name)
      : `/api/cps/go?${new URLSearchParams({ platform, name: shop.name, shopId: shop.id, source: 'wheel' })}`;
  const primaryAction = isPoi
    ? `<a class="btn-primary" data-act="order" href="${cpsHref('eleme')}" target="_blank" rel="noopener">去淘宝闪购下单</a>`
    : `<button class="btn-primary" data-act="order">去下单 · ${esc(shop.short || shop.name)}</button>`;
  const poiLinks = isPoi
    ? `<a data-act="meituan" href="${cpsHref('meituan')}" target="_blank" rel="noopener">美团外卖</a>
       <a data-act="copy">复制店名</a>`
    : '';
  const badges = [
    shop.isNew ? '<span class="badge b-new">新店</span>' : '',
    shop.openStatus === 'closingSoon' ? '<span class="badge b-closing">即将打烊</span>' : '',
  ].join('');
  const statLine = isPoi
    ? [
        distText(shop.distanceM),
        shop.avgPrice != null ? `人均${fmt(shop.avgPrice)}` : '',
        shop.rating != null ? `★${shop.rating}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : `${distText(shop.distanceM)} · 人均${fmt(shop.avgPrice)} · 配送费${fmt(shop.deliveryFee)} · 约${shop.deliveryMinutes}分钟`;

  const mask = openSheet(`
    <div class="result-head">🎯 转盘结果 · 中午就吃它</div>
    <div class="result-shop">
      <div class="emoji-big">${shop.emoji}</div>
      <div style="flex:1;min-width:0">
        <div class="name">${esc(shop.name)} ${badges}</div>
        <div class="sub">${shop.rating != null ? `★${shop.rating} · ` : ''}${esc(shop.cuisine)}</div>
        <div class="sub">${statLine}</div>
      </div>
    </div>
    ${category ? `<div class="result-cate">品类转盘：已在「${esc(category)}」中随机挑出这家可下单好店</div>` : ''}
    <div class="result-actions">
      ${primaryAction}
      <button class="btn-ghost" data-act="exclude" ${session.excluded.length >= 5 ? 'disabled' : ''}>
        排除此店再转（${session.excluded.length}/5）
      </button>
      <button class="btn-ghost" data-act="batch">换一批店铺</button>
    </div>
    <div class="result-links">
      ${poiLinks}
      <a data-act="share">🎁 生成分享卡片</a>
      <a data-act="ban">不再推荐此店</a>
    </div>
    <div class="result-tip">${isPoi ? '下单在外卖平台完成 · 通过本站跳转可支持我们' : '转到哪家就在哪家下单 · 所见即所得'}</div>
  `);

  mask.querySelector('[data-act="order"]').addEventListener('click', () => {
    track('order_click', { shopId: shop.id, platform: isPoi ? 'eleme' : 'in_app', source: 'wheel' });
    if (!isPoi) {
      closeSheet();
      location.hash = `#/shop/${shop.id}?from=wheel`;
    }
    // POI 模式：CPS 链接新开页跳转，弹层保留
  });
  const meituanLink = mask.querySelector('[data-act="meituan"]');
  if (meituanLink)
    meituanLink.addEventListener('click', () =>
      track('order_click', { shopId: shop.id, platform: 'meituan', source: 'wheel' })
    );
  const copyLink = mask.querySelector('[data-act="copy"]');
  if (copyLink)
    copyLink.addEventListener('click', () => {
      track('shop_copy', { shopId: shop.id });
      if (navigator.clipboard) {
        navigator.clipboard.writeText(shop.name).then(() => toast('店名已复制，打开外卖 App 搜索下单')).catch(() => toast(`请搜索：${shop.name}`));
      } else toast(`请搜索：${shop.name}`);
    });
  mask.querySelector('[data-act="exclude"]').addEventListener('click', async () => {
    if (session.excluded.length >= 5) {
      toast('已达单次排除上限（5 家），试试换一批');
      return;
    }
    track('shop_exclude', { shopId: shop.id });
    session.excluded.push({ id: shop.id, name: shop.name });
    closeSheet();
    await loadSectors(true);
  });
  mask.querySelector('[data-act="batch"]').addEventListener('click', () => {
    track('shop_batch', { shopId: shop.id });
    closeSheet();
    loadSectors(false);
  });
  mask.querySelector('[data-act="share"]').addEventListener('click', () => {
    track('share_open', { shopId: shop.id });
    shareCard(shop);
  });
  mask.querySelector('[data-act="ban"]').addEventListener('click', () => {
    track('shop_ban', { shopId: shop.id });
    if (!prefs.blacklist.some((b) => b.id === shop.id)) {
      prefs.blacklist.push({ id: shop.id, name: shop.name });
      savePrefs();
    }
    toast(`「${shop.short || shop.name}」已加入黑名单，不再推荐`);
    closeSheet();
  });
}

/** 分享卡片：Canvas 绘制 → 预览图 + 保存 / 复制文案 */
function shareCard(shop) {
  const c = document.createElement('canvas');
  c.width = 600;
  c.height = 760;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 600, 760);
  g.addColorStop(0, '#ff7a45');
  g.addColorStop(1, '#e8481a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 600, 760);

  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(28, 28, 544, 704, 24);
    ctx.fill();
  } else {
    ctx.fillRect(28, 28, 544, 704);
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = '700 36px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText('今天中午吃什么？', 300, 118);
  ctx.globalAlpha = 0.9;
  ctx.font = '26px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText('转盘说了算 👇', 300, 164);
  ctx.globalAlpha = 1;

  ctx.font = '110px serif';
  ctx.fillText(shop.emoji, 300, 340);
  ctx.font = '800 46px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(shop.short || shop.name, 300, 440, 500);
  ctx.font = '28px -apple-system, "PingFang SC", sans-serif';
  const shareStat = [
    shop.rating != null ? `★${shop.rating}` : '',
    shop.avgPrice != null ? `人均${fmt(shop.avgPrice)}` : '',
    shop.cuisine,
  ]
    .filter(Boolean)
    .join(' · ');
  ctx.fillText(shareStat, 300, 500, 520);
  ctx.font = '26px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(`距你 ${distText(shop.distanceM)}${shop.deliveryMinutes != null ? ` · 约${shop.deliveryMinutes}分钟送达` : ''}`, 300, 552);

  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(120, 600);
  ctx.lineTo(480, 600);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '700 32px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(`中午不见不散！`, 300, 656);
  ctx.globalAlpha = 0.78;
  ctx.font = '22px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText('转转点餐 · 转一转就决定', 300, 698);
  ctx.fillText(location.origin, 300, 730);
  ctx.globalAlpha = 1;

  const url = c.toDataURL('image/png');
  openSheet(`
    <div class="result-head">分享卡片</div>
    <img class="share-img" src="${url}" alt="转盘结果分享卡片" style="margin-top:12px" />
    <div class="share-actions" style="flex-wrap:wrap">
      <a class="btn-primary" id="saveImg" download="转转点餐-${esc(shop.short || shop.name)}.png" href="${url}">保存图片</a>
      <button class="btn-ghost" id="copyText">复制文案</button>
      <button class="btn-ghost" id="copyLink">复制应用链接</button>
    </div>
  `);
  document.getElementById('copyText').addEventListener('click', () => {
    const text = `我中午被转盘安排了「${shop.name}」！转一转就决定，10 秒搞定选择困难 🎯 ${location.origin}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => toast('文案已复制（含链接）')).catch(() => toast(text));
    } else toast(text);
  });
  document.getElementById('copyLink').addEventListener('click', () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(location.origin).then(() => toast('链接已复制')).catch(() => toast(location.origin));
    } else toast(location.origin);
  });
}
