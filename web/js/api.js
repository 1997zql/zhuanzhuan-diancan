const BASE = '';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    const err = new Error(data.message || `请求失败（${res.status}）`);
    err.code = data.error;
    err.data = data;
    throw err;
  }
  return data;
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));

export const api = {
  meta: () => req('/api/meta'),
  shops: (q = {}) => req(`/api/shops?${new URLSearchParams(clean(q))}`),
  shop: (id, q = {}) => req(`/api/shops/${id}?${new URLSearchParams(clean(q))}`),
  wheel: (body) =>
    req('/api/wheel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  createOrder: (body) =>
    req('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  orders: () => req('/api/orders'),
  suggest: (keywords) => req(`/api/geocode/suggest?${new URLSearchParams({ keywords })}`),
  reverse: (lat, lng) => req(`/api/geocode/reverse?${new URLSearchParams({ lat, lng })}`),
  stats: () => req('/api/stats'),
};
