// 浏览器定位（超时 / 拒绝授权时回退 null，由调用方走预设地址）

export function locate(timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: timeoutMs, maximumAge: 5 * 60 * 1000 }
    );
  });
}

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineM(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 距离最近的预设地址（用于判断真实定位是否落在演示商圈附近） */
export function nearestPreset(pos, presets) {
  let best = null;
  for (const p of presets) {
    const d = haversineM(pos.lat, pos.lng, p.lat, p.lng);
    if (!best || d < best.distM) best = { preset: p, distM: d };
  }
  return best || { preset: null, distM: Infinity };
}
