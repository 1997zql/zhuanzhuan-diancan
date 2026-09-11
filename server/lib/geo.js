'use strict';

const EARTH_RADIUS_M = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

/** 两经纬度坐标间的球面距离（米） */
function haversineM(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * 营业状态：当前是否营业、距打烊分钟数
 * 距打烊 <= 30 分钟即视为「即将打烊」（由调用方标注）
 */
function openStatusOf(openTime, closeTime, now = new Date()) {
  const cur = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = openTime.split(':').map(Number);
  const [ch, cm] = closeTime.split(':').map(Number);
  const open = oh * 60 + om;
  const close = ch * 60 + cm;
  const overnight = close <= open;
  const isOpen = overnight ? cur >= open || cur < close : cur >= open && cur < close;
  // 跨夜店（如 18:00-02:00）：半夜侧直接差值，晚间侧经过 0 点折算
  const closingInMin = !isOpen
    ? null
    : overnight
      ? (cur < close ? close - cur : 1440 - cur + close)
      : close - cur;
  return { open: isOpen, closingInMin };
}

/**
 * WGS-84（GPS 原始坐标）→ GCJ-02（火星坐标，高德/腾讯系地图使用）
 * 高德 POI 坐标均为 GCJ-02；用户浏览器定位为 WGS-84，计算距离前必须统一坐标系，
 * 否则在国内会出现 100~600 米的系统性偏差
 */
const A = 6378245;
const EE = 0.00669342162296594323; // 第一偏心率平方

function outOfChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret =
    -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return ret;
}

function transformLng(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return ret;
}

function wgs2gcj(lat, lng) {
  if (outOfChina(lat, lng)) return { lat, lng };
  const dLat = transformLat(lng - 105, lat - 35);
  const dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  return {
    lat: lat + (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI),
    lng: lng + (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI),
  };
}

/** GCJ-02 → WGS-84 近似逆变换（在 GCJ 点位上取偏移做一次镜像折返，国内误差约 1~2 米） */
function gcj2wgs(lat, lng) {
  if (outOfChina(lat, lng)) return { lat, lng };
  const gcj = wgs2gcj(lat, lng);
  return { lat: lat * 2 - gcj.lat, lng: lng * 2 - gcj.lng };
}

module.exports = { haversineM, openStatusOf, wgs2gcj, gcj2wgs };
