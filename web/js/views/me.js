// 我的：常用地址、点餐偏好（忌口/预算）、黑名单、运营漏斗
import { runtime, prefs, savePrefs, setPresetLocation } from '../state.js';
import { locate, nearestPreset } from '../geo.js';
import { toast, esc } from '../ui.js';
import { api } from '../api.js';
import { RADIUS } from '../config.js';

export async function render(root) {
  const addresses = runtime.meta.addresses;
  const usingCustom = prefs.addressId === null && prefs.custom;
  const amapMode = runtime.meta.dataMode === 'amap';

  root.innerHTML = `
    <div class="card me-section">
      <h3>常用地址</h3>
      ${amapMode ? `<button class="me-row" id="searchAddrRow" style="width:100%;text-align:left;background:#fff">
        <span class="r-main">
          <span style="font-weight:700">🔍 搜索办公地址</span>
          <span class="r-sub">基于高德 POI，全国范围</span>
        </span>
        <span style="color:#adb5bd">›</span>
      </button>` : ''}
      <button class="me-row" id="gpsRow" style="width:100%;text-align:left;background:#fff">
        <span class="r-main">
          <span style="font-weight:700">📍 使用当前定位</span>
          <span class="r-sub">${usingCustom ? `当前使用：我的位置（${Number(prefs.custom.lat).toFixed(4)}, ${Number(prefs.custom.lng).toFixed(4)}）` : '点击定位当前位置'}</span>
        </span>
        <span style="color:#adb5bd">›</span>
      </button>
      ${addresses
        .map(
          (a) => `
        <button class="me-row" data-addr="${a.id}" style="width:100%;text-align:left;background:#fff">
          <span class="r-main">
            <span style="font-weight:700">${esc(a.name)}</span>
            <span class="r-sub">${esc(a.detail)}</span>
          </span>
          <span class="radio">${prefs.addressId === a.id ? '●' : '○'}</span>
        </button>`
        )
        .join('')}
    </div>

    <div class="card me-section">
      <h3>点餐偏好 <span style="font-weight:400">（只影响转盘候选）</span></h3>
      <div class="me-row"><span>人均上限</span></div>
      <div class="tag-wrap" id="priceTags">
        ${[['不限', 0], ['≤30', 30], ['≤50', 50], ['≤100', 100]]
          .map(([lab, v]) => `<button class="tag ${prefs.maxPrice === v ? 'active' : ''}" data-price="${v}">${lab}</button>`)
          .join('')}
      </div>
      ${
        runtime.meta.avoidTags.length
          ? `<div class="me-row"><span>忌口 / 不想吃</span></div>
      <div class="tag-wrap" id="avoidTags">
        ${runtime.meta.avoidTags
          .map((t) => `<button class="tag ${prefs.avoidTags.includes(t) ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`)
          .join('')}
      </div>`
          : ''
      }
      <div class="me-note">${amapMode ? '人均未知（高德未返回）的店铺不受预算上限限制。' : '设置后，转盘不再推荐命中忌口或超出预算的店铺。'}</div>
    </div>

    <div class="card me-section">
      <h3>黑名单 · 不再推荐</h3>
      ${
        prefs.blacklist.length > 0
          ? prefs.blacklist
              .map(
                (b, i) => `
        <div class="me-row">
          <span class="r-main">${esc(b.name || b.id)}</span>
          <button class="del" data-del="${i}">移除</button>
        </div>`
              )
              .join('')
          : '<div class="me-note">暂无。可在转盘结果中选择「不再推荐此店」加入。</div>'
      }
    </div>

    <div class="card me-section">
      <h3>运营数据 · 转化漏斗</h3>
      <div id="statsBox" class="me-note">加载中…</div>
    </div>

    <div class="card me-section">
      <h3>关于</h3>
      <div class="about-row">${amapMode ? '转转点餐 V1.1 · 店铺数据来自高德地图（AMAP_KEY 已配置）' : '转转点餐 V1.0（MVP）· 演示数据覆盖北京三大商圈周边 3 公里'}</div>
      <div class="about-row">下单与支付均为模拟，不产生真实交易</div>
      <div class="about-row">产品依据：MRD.md · 开发计划.md</div>
    </div>`;

  document.getElementById('gpsRow').addEventListener('click', async () => {
    toast('正在定位…');
    const pos = await locate(8000);
    if (!pos) return toast('定位失败或未授权，请选择下方预设地址');
    if (amapMode) {
      let name = '我的位置';
      try {
        const { reverse } = await import('../api.js');
        const { address } = await reverse(pos.lat, pos.lng);
        if (address) name = address.length > 14 ? address.slice(0, 14) + '…' : address;
      } catch (e) {
        /* 逆地理失败不阻塞 */
      }
      const { setCustomLocation } = await import('../state.js');
      setCustomLocation(pos, name);
      toast('已使用当前定位');
    } else {
      const { preset, distM } = nearestPreset(pos, addresses);
      if (distM <= RADIUS) {
        // 真实定位落在演示商圈附近：直接使用真实坐标
        const { setCustomLocation } = await import('../state.js');
        setCustomLocation(pos);
        toast('已使用当前定位');
      } else {
        setPresetLocation(preset || addresses[0]);
        toast('当前定位不在演示商圈，已切换到演示地址');
      }
    }
    render(root);
  });

  const searchRow = document.getElementById('searchAddrRow');
  if (searchRow)
    searchRow.addEventListener('click', () => {
      import('../topbar.js').then(({ openAddressSheet }) => openAddressSheet(() => render(root)));
    });

  document.querySelectorAll('[data-addr]').forEach((btn) =>
    btn.addEventListener('click', () => {
      setPresetLocation(addresses.find((a) => a.id === btn.dataset.addr));
      toast('已切换地址');
      render(root);
    })
  );

  document.querySelectorAll('#priceTags .tag').forEach((tag) =>
    tag.addEventListener('click', () => {
      prefs.maxPrice = Number(tag.dataset.price);
      savePrefs();
      render(root);
    })
  );

  document.querySelectorAll('#avoidTags .tag').forEach((tag) =>
    tag.addEventListener('click', () => {
      const t = tag.dataset.tag;
      prefs.avoidTags = prefs.avoidTags.includes(t) ? prefs.avoidTags.filter((x) => x !== t) : [...prefs.avoidTags, t];
      savePrefs();
      render(root);
    })
  );

  document.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', () => {
      prefs.blacklist.splice(Number(btn.dataset.del), 1);
      savePrefs();
      render(root);
    })
  );

  renderStats();
}

/** 运营漏斗：曝光 → 转动 → 出结果 → 点下单 → 平台跳转（/api/stats） */
async function renderStats() {
  const box = document.getElementById('statsBox');
  if (!box) return;
  if (runtime.meta.dataMode !== 'demo') {
    // 静态托管模式：展示本机漏斗（无后端统计）
    const { localFunnel } = await import('../track.js');
    const f = localFunnel();
    const row = (label, k) => `<div class="co-row"><span class="lab">${label}</span><span class="val">${f[k] || 0}</span></div>`;
    box.innerHTML = `
      ${row('🎯 转盘加载', 'wheel_load')}
      ${row('🔄 转动', 'wheel_spin')}
      ${row('🍽️ 转出结果', 'wheel_result')}
      ${row('🛒 点击下单', 'order_click')}
      <div class="me-note" style="padding:4px 0 0">静态版漏斗仅记录本机数据。</div>`;
    return;
  }
  try {
    const s = await api.stats();
    const c = s.counts;
    const row = (label, k) =>
      `<div class="co-row"><span class="lab">${label}</span><span class="val">今日 ${c[k].today} · 累计 ${c[k].total}</span></div>`;
    const platformTxt =
      Object.entries(s.cpsByPlatform)
        .map(([p, n]) => `${p}×${n}`)
        .join(' / ') || '—';
    box.innerHTML = `
      ${row('🎯 转盘加载', 'wheel_load')}
      ${row('🔄 转动', 'wheel_spin')}
      ${row('🍽️ 转出结果', 'wheel_result')}
      ${row('🛒 点击下单', 'order_click')}
      ${row('🛵 平台跳转', 'cps_redirect')}
      ${row('✅ 站内下单', 'order_submit')}
      <div class="co-row"><span class="lab">跳转平台分布</span><span class="val">${esc(platformTxt)}</span></div>
      <div class="me-note" style="padding:4px 0 0">口径：出结果 → 点击下单 即转化。数据持久化于 server/data/events.jsonl。</div>`;
  } catch (e) {
    box.textContent = '统计加载失败';
  }
}
