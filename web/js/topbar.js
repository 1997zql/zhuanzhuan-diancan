// 顶栏：地址展示 + 地址切换弹层
// demo 模式：定位回退 + 预设办公地址
// amap 模式：定位 + 逆地理编码 + 高德关键字搜索真实地址
import { locate, nearestPreset } from './geo.js?v=c5a29c5';
import { runtime, setPresetLocation, setCustomLocation } from './state.js?v=c5a29c5';
import { openSheet, closeSheet, toast, esc } from './ui.js?v=c5a29c5';
import { api } from './api.js?v=c5a29c5';
import { RADIUS } from './config.js?v=c5a29c5';

export function refreshTopbar() {
  const el = document.getElementById('addrName');
  if (runtime.location) el.textContent = runtime.location.name;
}

export function bindTopbar(onChange) {
  document.getElementById('addrBtn').addEventListener('click', () => openAddressSheet(onChange));
}

const isAmap = () => runtime.meta && runtime.meta.dataMode === 'amap';
const isOsm = () => runtime.meta && runtime.meta.dataMode === 'osm';

export function openAddressSheet(onChange) {
  const addresses = runtime.meta.addresses;
  const cur = runtime.location;
  const rows = addresses
    .map(
      (a) => `
      <button class="me-row" data-addr="${a.id}" style="width:100%;text-align:left;background:#fff">
        <span class="r-main">
          <span style="font-weight:700">${esc(a.name)}</span>
          <span class="r-sub">${esc(a.detail)}</span>
        </span>
        <span class="radio">${cur && cur.addressId === a.id ? '●' : '○'}</span>
      </button>`
    )
    .join('');

  const searchHtml = isAmap() || isOsm()
    ? `<input class="co-input" id="addrSearch" placeholder="搜索办公楼 / 地标，如：望京SOHO" style="margin-top:10px" />
       <div id="suggestList"></div>`
    : '';
  const manualHtml = isOsm()
    ? `<div style="display:flex;gap:8px;margin-top:10px">
         <input class="co-input" id="latInput" placeholder="纬度 lat，如 39.9087" style="margin:0" />
         <input class="co-input" id="lngInput" placeholder="经度 lng，如 116.4614" style="margin:0" />
       </div>
       <button class="btn-ghost" id="useCoords" style="width:100%;margin-top:8px">使用该坐标</button>
       <div class="me-note">坐标获取：打开 lbs.amap.com/tools/picker（高德坐标拾取器，无需登录）点击你的位置，把坐标粘贴到上面（可能有数百米偏移）。</div>`
    : '';

  openSheet(`
    <div class="result-head">选择用餐地址</div>
    ${searchHtml}
    ${manualHtml}
    <button class="me-row" id="useGps" style="width:100%;text-align:left;background:#fff;margin-top:8px">
      <span class="r-main">
        <span style="font-weight:700">📍 使用当前定位</span>
        <span class="r-sub">${isAmap() ? '定位后将自动解析地址名称' : isOsm() ? '手机浏览器定位最准确' : '真实定位可能不在演示商圈内'}</span>
      </span>
      <span style="color:#adb5bd">›</span>
    </button>
    ${rows}
    <div class="me-note">${isAmap() ? '店铺数据来自高德地图（餐饮 POI，营业中 + 3 公里内）。' : isOsm() ? '店铺数据来自 OpenStreetMap 开放数据（周边 1.5 公里真实餐饮）。' : '演示数据覆盖：国贸CBD / 望京SOHO / 中关村 周边 3 公里。'}</div>
  `);

  if (isAmap() || isOsm()) bindAddressSearch();
  if (isOsm()) bindManualCoords(onChange);
  bindGpsRow(onChange);
  bindPresetRows(addresses, onChange);
}

/** osm 模式：手动输入坐标（无 GPS 的 PC 场景） */
function bindManualCoords(onChange) {
  document.getElementById('useCoords').addEventListener('click', () => {
    const lat = parseFloat(document.getElementById('latInput').value);
    const lng = parseFloat(document.getElementById('lngInput').value);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      toast('请输入正确的经纬度');
      return;
    }
    setCustomLocation({ lat, lng }, '自定义坐标');
    closeSheet();
    toast('已使用自定义坐标');
    onChange && onChange();
  });
}

function bindAddressSearch() {
  const input = document.getElementById('addrSearch');
  const listBox = document.getElementById('suggestList');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const kw = input.value.trim();
    if (!kw) {
      listBox.innerHTML = '';
      return;
    }
    timer = setTimeout(async () => {
      try {
        // 带上当前坐标做就近偏置，避免全国同名地标挤掉身边结果
        const bias = runtime.location ? { lat: runtime.location.lat, lng: runtime.location.lng } : {};
        const { suggestions } = await api.suggest(kw, bias);
        listBox.innerHTML = suggestions
          .map(
            (s, i) => `
            <button class="me-row" data-sug="${i}" style="width:100%;text-align:left;background:#fff">
              <span class="r-main">
                <span style="font-weight:700">${esc(s.name)}</span>
                <span class="r-sub">${esc(s.district || '')}</span>
              </span>
              <span style="color:#adb5bd">›</span>
            </button>`
          )
          .join('');
        listBox.querySelectorAll('[data-sug]').forEach((btn) =>
          btn.addEventListener('click', () => {
            const s = suggestions[Number(btn.dataset.sug)];
            setCustomLocation({ lat: s.lat, lng: s.lng }, s.name);
            closeSheet();
            toast(`已切换到「${s.name}」`);
            onChange && onChange();
          })
        );
      } catch (e) {
        listBox.innerHTML = `<div class="me-note">搜索失败：${esc(e.message)}</div>`;
      }
    }, 400);
  });
}

async function bindGpsRow(onChange) {
  document.getElementById('useGps').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.querySelector('.r-sub').textContent = '正在定位…';
    const pos = await locate(8000);
    if (!pos) {
      toast('定位失败或未授权，请选择下方地址');
      btn.disabled = false;
      btn.querySelector('.r-sub').textContent = isAmap() ? '定位后将自动解析地址名称' : '真实定位可能不在演示商圈内';
      return;
    }

    if (isAmap() || isOsm()) {
      let name = '我的位置';
      try {
        const { address } = await api.reverse(pos.lat, pos.lng);
        if (address) name = address.length > 14 ? address.slice(0, 14) + '…' : address;
      } catch (err) {
        /* 逆地理失败不阻塞，用默认名 */
      }
      setCustomLocation(pos, name);
      closeSheet();
      onChange && onChange();
      return;
    }

    // demo 模式：真实定位需要落在演示商圈附近
    const { preset, distM } = nearestPreset(pos, runtime.meta.addresses);
    if (distM <= RADIUS) {
      setCustomLocation(pos);
    } else {
      setPresetLocation(preset || runtime.meta.addresses[0]);
      toast('当前定位不在演示商圈，已切换到演示地址');
    }
    closeSheet();
    onChange && onChange();
  });
}

function bindPresetRows(addresses, onChange) {
  document.querySelectorAll('[data-addr]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const addr = addresses.find((a) => a.id === btn.dataset.addr);
      setPresetLocation(addr);
      closeSheet();
      onChange && onChange();
    });
  });
}
