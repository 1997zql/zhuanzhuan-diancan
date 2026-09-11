// 附近店铺列表：品类筛选 + 距离/评分/人均排序 + 营业状态
import { api } from '../api.js?v=c5a29c5';
import { runtime } from '../state.js?v=c5a29c5';
import { esc, fmt, fmtOr, distText } from '../ui.js?v=c5a29c5';

const filters = { category: '', sort: 'distance', openOnly: true };

export async function render(root) {
  const cats = ['全部', ...runtime.meta.cuisines];
  root.innerHTML = `
    <div class="chips" id="catChips">
      ${cats.map((c) => `<button class="chip ${filters.category === c || (filters.category === '' && c === '全部') ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
    <div class="list-toolbar">
      <div class="seg" id="sortSeg">
        ${['distance', 'rating', 'price']
          .map((k) => `<button data-sort="${k}" class="${filters.sort === k ? 'active' : ''}">${{ distance: '距离', rating: '评分', price: '人均' }[k]}</button>`)
          .join('')}
      </div>
      <label class="switch"><input type="checkbox" id="openOnly" ${filters.openOnly ? 'checked' : ''}/> 仅看可下单</label>
    </div>
    <div class="shop-list" id="shopList">
      <div class="card" style="text-align:center;color:var(--text-2)">加载中…</div>
    </div>`;

  document.querySelectorAll('#catChips .chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      filters.category = chip.dataset.cat === '全部' ? '' : chip.dataset.cat;
      render(root);
    })
  );
  document.querySelectorAll('#sortSeg button').forEach((b) =>
    b.addEventListener('click', () => {
      filters.sort = b.dataset.sort;
      render(root);
    })
  );
  document.getElementById('openOnly').addEventListener('change', (e) => {
    filters.openOnly = e.target.checked;
    loadList();
  });

  await loadList();
}

async function loadList() {
  const loc = runtime.location;
  const { shops } = await api.shops({
    lat: loc.lat,
    lng: loc.lng,
    category: filters.category,
    sort: filters.sort,
    openOnly: filters.openOnly ? 1 : 0,
  });
  const listEl = document.getElementById('shopList');
  if (!listEl) return;
  listEl.innerHTML =
    shops.length > 0
      ? shops.map(itemHtml).join('')
      : `<div class="card empty-card"><div class="big">🔍</div><h3>没有符合条件的店铺</h3><p>试试放宽筛选，或在顶栏切换地址</p></div>`;

  listEl.querySelectorAll('.shop-item').forEach((el) =>
    el.addEventListener('click', () => (location.hash = `#/shop/${el.dataset.id}`))
  );
}

function itemHtml(s) {
  const badges = [
    s.isNew ? '<span class="badge b-new">新店</span>' : '',
    s.openStatus === 'closingSoon' ? '<span class="badge b-closing">即将打烊</span>' : '',
    s.openStatus === 'closed' ? '<span class="badge b-closed">休息中</span>' : '',
  ].join('');
  return `
    <div class="card shop-item" data-id="${s.id}">
      <div class="emoji-box">${s.emoji}</div>
      <div class="info">
        <div class="name-row"><span class="name">${esc(s.name)}</span>${badges}</div>
        <div class="sub">${s.rating != null ? `★${s.rating} · ` : ''}${esc(s.cuisine)}${s.address ? ' · ' + esc(s.address) : ''}</div>
        <div class="meta">${s.avgPrice != null ? `人均${fmt(s.avgPrice)}` : '人均未收录'} · 约${s.deliveryMinutes ?? Math.max(10, Math.round(s.distanceM / 200 + 10))}分钟可达</div>
      </div>
      <div class="right">
        <div class="dist">${distText(s.distanceM)}</div>
        <button class="enter">进店</button>
      </div>
    </div>`;
}
