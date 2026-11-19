// FANVERSE 行程規劃用的外部資料（GitHub Actions 每天執行）
// 1. 天氣：氣象署「縣市未來 1 週天氣預報」（F-D0047-091），需要 GitHub Secrets 裡的 CWA_KEY → weather.json
// 2. 班次：交通部 TDX 高鐵、台鐵定期時刻表，需要 GitHub Secrets 裡的 TDX_ID、TDX_SECRET → rail.json
// 金鑰只在 GitHub 的執行環境裡使用，不會寫進網站或資料檔；沒有設定金鑰時就跳過，網站改用估算。
import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const UA = 'FanverseBot/1.0 (+https://fanverse-team.github.io/; student project)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, init = {}) {
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(90000) }, init, { headers: Object.assign({ 'User-Agent': UA }, init.headers || {}) }));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { err = e; await sleep(4000 * (i + 1)); }
  }
  throw err;
}
const tw = s => String(s || '').replace(/臺/g, '台').replace(/站$/, '').trim();
// 縣市名稱 → 網站用的簡稱（新竹市、新竹縣都算「新竹」，取市的資料）
const CITY = { 台北市: '台北', 新北市: '新北', 基隆市: '基隆', 桃園市: '桃園', 新竹市: '新竹', 新竹縣: '新竹', 苗栗縣: '苗栗', 台中市: '台中', 彰化縣: '彰化', 南投縣: '南投', 雲林縣: '雲林', 嘉義市: '嘉義', 嘉義縣: '嘉義', 台南市: '台南', 高雄市: '高雄', 屏東縣: '屏東', 宜蘭縣: '宜蘭', 花蓮縣: '花蓮', 台東縣: '台東', 澎湖縣: '澎湖', 金門縣: '金門', 連江縣: '連江' };

/* ---------- 天氣 ---------- */
// 把一個時段的值（新版 ElementValue 物件或舊版 elementValue 陣列）攤平成 { 欄位: 值 }
function flatVal(t) {
  const out = {};
  for (const v of [].concat(t.ElementValue || t.elementValue || t.parameter || [])) {
    if (!v || typeof v !== 'object') continue;
    for (const [k, x] of Object.entries(v)) out[k] = x;
  }
  return out;
}
export function parseWeather(j) {
  const recs = j.records || j.Records || {};
  const groups = recs.Locations || recs.locations || [];
  const locs = [].concat(...[].concat(groups).map(g => g.Location || g.location || [])).concat(recs.location || []);
  const cities = {};
  for (const L of locs) {
    const name = CITY[tw(L.LocationName || L.locationName)]; if (!name || cities[name] && /縣$/.test(L.LocationName || '')) continue;
    const days = {};
    for (const el of L.WeatherElement || L.weatherElement || []) {
      const en = el.ElementName || el.elementName || '';
      for (const t of el.Time || el.time || []) {
        const st = String(t.StartTime || t.startTime || t.DataTime || ''); const d = st.slice(0, 10), h = Number(st.slice(11, 13));
        if (!/^20\d\d-\d\d-\d\d$/.test(d)) continue;
        const v = flatVal(t), day = days[d] || (days[d] = {}), daytime = h >= 6 && h < 18;
        const wx = v.Weather || (/天氣現象|Wx/.test(en) ? v.value : undefined);
        const pop = v.ProbabilityOfPrecipitation ?? (/降雨機率|PoP/.test(en) ? v.value : undefined);
        const hi = v.MaxTemperature ?? (/最高溫|MaxT/.test(en) ? v.value : undefined);
        const lo = v.MinTemperature ?? (/最低溫|MinT/.test(en) ? v.value : undefined);
        if (wx && (daytime || !day.wx)) day.wx = String(wx).slice(0, 20);
        if (pop !== undefined && pop !== '' && pop !== '-' && !isNaN(+pop)) day.pop = Math.max(day.pop || 0, +pop);
        if (hi !== undefined && !isNaN(+hi)) day.hi = Math.max(day.hi ?? -99, +hi);
        if (lo !== undefined && !isNaN(+lo)) day.lo = Math.min(day.lo ?? 99, +lo);
      }
    }
    const clean = {}; for (const [d, x] of Object.entries(days)) if (d >= TODAY && (x.wx || x.pop !== undefined)) clean[d] = x;
    if (Object.keys(clean).length) cities[name] = clean;
  }
  return cities;
}
async function weather() {
  const key = process.env.CWA_KEY; if (!key) { console.log('沒有設定 CWA_KEY，跳過天氣'); return; }
  try {
    const j = await get('https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-091?format=JSON&Authorization=' + encodeURIComponent(key));
    const cities = parseWeather(j);
    if (Object.keys(cities).length < 10) throw new Error('只解析到 ' + Object.keys(cities).length + ' 個縣市');
    await writeFile(new URL('weather.json', ROOT), JSON.stringify({ updated: TODAY, source: '中央氣象署開放資料（政府資料開放授權條款－第1版）', cities }) + '\n');
    console.log('✔ 天氣：' + Object.keys(cities).length + ' 個縣市');
  } catch (e) { console.log('✘ 天氣抓取失敗，沿用舊資料：' + e.message.replace(key, '***')); }
}

/* ---------- 班次 ---------- */
// 台鐵只留主要車站，檔案才不會太大
const TRA_KEEP = new Set(['基隆', '南港', '松山', '台北', '板橋', '桃園', '中壢', '新竹', '竹南', '苗栗', '豐原', '台中', '彰化', '員林', '斗六', '嘉義', '新營', '台南', '新左營', '高雄', '屏東', '宜蘭', '羅東', '花蓮', '玉里', '台東']);
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// 從各種包法裡找出每一班車：{ 車次, 方向, 車種, 行駛日, 停靠站 }
function collectTrains(j) {
  const out = [], seen = new Set();
  const walk = o => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (Array.isArray(o.StopTimes) && !seen.has(o)) {
      seen.add(o);
      const info = o.GeneralTrainInfo || o.TrainInfo || o.DailyTrainInfo || o;
      const sd = o.ServiceDay || info.ServiceDay || {};
      const w = DAYS.map(d => (sd[d] === undefined ? 1 : +sd[d] ? 1 : 0)).join('');
      out.push({ n: String(info.TrainNo || ''), dir: +info.Direction || 0, t: tw((info.TrainTypeName && (info.TrainTypeName.Zh_tw || info.TrainTypeName)) || ''), w, stops: o.StopTimes });
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(j);
  return out;
}
function compact(trains, keep) {
  return trains.map(x => {
    const s = x.stops.map(st => [tw(st.StationName && (st.StationName.Zh_tw || st.StationName)), String(st.DepartureTime || st.ArrivalTime || '').slice(0, 5)])
      .filter(s => /^\d\d:\d\d$/.test(s[1]) && (!keep || keep.has(s[0])));
    return s.length >= 2 && x.n ? { n: x.n, t: x.t.replace(/\(.*\)/, '').slice(0, 6), w: x.w, s } : null;
  }).filter(Boolean);
}
async function rail() {
  const id = process.env.TDX_ID, secret = process.env.TDX_SECRET;
  if (!id || !secret) { console.log('沒有設定 TDX_ID／TDX_SECRET，跳過班次'); return; }
  try {
    const tok = await get('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }).toString() });
    const auth = { headers: { Authorization: 'Bearer ' + tok.access_token, 'Accept-Encoding': 'gzip' } };
    const thsr = compact(collectTrains(await get('https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/GeneralTimetable?%24format=JSON', auth)));
    await sleep(1500);
    const tra = compact(collectTrains(await get('https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/GeneralTrainTimetable?%24format=JSON', auth)), TRA_KEEP);
    if (thsr.length < 50 || tra.length < 100) throw new Error('班次太少（高鐵 ' + thsr.length + '、台鐵 ' + tra.length + '）');
    await writeFile(new URL('rail.json', ROOT), JSON.stringify({ updated: TODAY, source: '交通部 TDX 運輸資料流通服務（高鐵、台鐵定期時刻表）', thsr, tra }) + '\n');
    console.log('✔ 班次：高鐵 ' + thsr.length + ' 班、台鐵 ' + tra.length + ' 班');
  } catch (e) { console.log('✘ 班次抓取失敗，沿用舊資料：' + String(e.message).replace(secret, '***')); }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) { await weather(); await rail(); }
