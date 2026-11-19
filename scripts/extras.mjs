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

/* ---------- 場館周邊交通：捷運（站、出口、首末班）、公車路線、YouBike；國道客運時刻 ---------- */
const dist = (a, b) => { const R = 6371000, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(x))); };
const pos = p => p && Number.isFinite(+p.PositionLat) && Number.isFinite(+p.PositionLon) ? [+p.PositionLat, +p.PositionLon] : null;
const zh = x => tw(x && (x.Zh_tw || x)) || '';
const zr = x => String((x && (x.Zh_tw || x)) || '').replace(/臺/g, '台').trim();
const TDX = 'https://tdx.transportdata.tw/api/basic/';
// 縣市代碼 → 網站用的縣市簡稱；縣市簡稱 → TDX 的 City 參數
export const CODE = { TPE: '台北', NWT: '新北', KEE: '基隆', TAO: '桃園', HSZ: '新竹', HSQ: '新竹', MIA: '苗栗', TXG: '台中', CHA: '彰化', NAN: '南投', YUN: '雲林', CYI: '嘉義', CYQ: '嘉義', TNN: '台南', KHH: '高雄', PIF: '屏東', ILA: '宜蘭', HUA: '花蓮', TTT: '台東', PEN: '澎湖', KIN: '金門', LIE: '連江' };
const TDXCITY = { 台北: ['Taipei'], 新北: ['NewTaipei'], 基隆: ['Keelung'], 桃園: ['Taoyuan'], 新竹: ['Hsinchu', 'HsinchuCounty'], 苗栗: ['MiaoliCounty'], 台中: ['Taichung'], 彰化: ['ChanghuaCounty'], 南投: ['NantouCounty'], 雲林: ['YunlinCounty'], 嘉義: ['Chiayi', 'ChiayiCounty'], 台南: ['Tainan'], 高雄: ['Kaohsiung'], 屏東: ['PingtungCounty'], 宜蘭: ['YilanCounty'], 花蓮: ['HualienCounty'], 台東: ['TaitungCounty'], 澎湖: ['PenghuCounty'], 金門: ['KinmenCounty'], 連江: ['LienchiangCounty'] };
const METRO = { TRTC: '台北捷運', NTMC: '新北捷運', NTDLRT: '淡海輕軌', NTALRT: '安坑輕軌', TYMC: '桃園捷運', TMRT: '台中捷運', KRTC: '高雄捷運', KLRT: '高雄輕軌' };
// 需要周邊交通資料的場館：有座標、近期有活動
async function venueList() {
  const read = async f => { try { return JSON.parse(await readFile(new URL(f, ROOT), 'utf8')); } catch { return null; } };
  const [vj, cj, aj] = await Promise.all([read('venues.json'), read('concerts.json'), read('arts.json')]);
  let geo = {}; try { geo = (await import('./update.mjs')).VENUE_GEO || {}; } catch { }
  const used = new Set([].concat((cj && cj.events) || [], (aj && aj.events) || []).filter(e => e && e.venue).map(e => e.venue));
  const out = {};
  for (const [n, x] of Object.entries((vj && vj.venues) || {})) if (x && Array.isArray(x.at) && used.has(n)) out[n] = { at: x.at, city: x.city || '' };
  for (const [n, x] of Object.entries(geo)) out[n] = { at: x.at, city: n.startsWith('高雄') ? '高雄' : '台北' };
  return Object.entries(out).slice(0, 160);
}
export function buildMetro(stations, exits, firstLast, at) {
  const near = stations.map(s => ({ s, d: dist(at, s.p) })).filter(x => x.d <= 1500).sort((a, b) => a.d - b.d).slice(0, 2);
  return near.map(({ s, d }) => {
    const ex = exits.filter(e => e.sys === s.sys && e.id === s.id).map(e => ({ e, d: dist(at, e.p) })).sort((a, b) => a.d - b.d);
    const best = ex[0], lift = ex.find(x => x.e.lift);
    const last = {};
    for (const f of firstLast) if (f.sys === s.sys && f.id === s.id && f.last) { const k = f.head; if (!last[k] || (f.last < '04:00' ? '24' + f.last : f.last) > (last[k][1] < '04:00' ? '24' + last[k][1] : last[k][1])) last[k] = [f.first, f.last]; }
    return { n: s.name, sys: METRO[s.sys], d, ex: best ? [best.e.no, best.d] : null, lift: lift ? [lift.e.no, lift.d] : null, last: Object.entries(last).slice(0, 6).map(([h, t]) => [h, t[0], t[1]]) };
  });
}
async function transit(auth) {
  const venues = await venueList(); if (!venues.length) return console.log('沒有場館座標，跳過周邊交通');
  const stations = [], exits = [], firstLast = [];
  for (const sys of Object.keys(METRO)) {
    try {
      for (const x of await get(TDX + 'v2/Rail/Metro/Station/' + sys + '?%24format=JSON', auth)) { const p = pos(x.StationPosition); if (p) stations.push({ sys, id: x.StationID, name: zh(x.StationName) + '站', p }); }
      await sleep(400);
      for (const x of await get(TDX + 'v2/Rail/Metro/StationExit/' + sys + '?%24format=JSON', auth)) { const p = pos(x.ExitPosition); if (p) exits.push({ sys, id: x.StationID, no: String(x.ExitID || '').slice(0, 6), p, lift: !!x.Elevator }); }
      await sleep(400);
      for (const x of await get(TDX + 'v2/Rail/Metro/FirstLastTimetable/' + sys + '?%24format=JSON', auth)) if (x.ServiceDay ? x.ServiceDay.Saturday !== false : true) firstLast.push({ sys, id: x.StationID, head: String(x.TripHeadSign || ('往' + zh(x.DestinationStationName))).slice(0, 14), first: String(x.FirstTrainTime || '').slice(0, 5), last: String(x.LastTrainTime || '').slice(0, 5) });
      await sleep(400);
    } catch (e) { console.log('捷運 ' + sys + ' 略過：' + e.message); }
  }
  const out = {};
  for (const [name, v] of venues) {
    const o = { mrt: buildMetro(stations, exits, firstLast, v.at), bus: [], bike: [] };
    for (const city of TDXCITY[v.city] || []) {
      const sf = '?%24spatialFilter=nearby(' + v.at[0] + ',' + v.at[1] + ',400)&%24format=JSON';
      try {
        for (const st of await get(TDX + 'v2/Bus/Station/City/' + city + sf, auth)) {
          const p = pos(st.StationPosition), routes = [...new Set((st.Stops || []).map(x => zr(x.RouteName)).filter(Boolean))];
          if (p && routes.length) o.bus.push([zr(st.StationName), dist(v.at, p), routes.slice(0, 12)]);
        }
      } catch (e) { }
      await sleep(250);
      try {
        for (const b of await get(TDX + 'v2/Bike/Station/City/' + city + sf.replace(',400)', ',600)'), auth)) { const p = pos(b.StationPosition); if (p) o.bike.push([zr(b.StationName).replace(/^YouBike\d\.\d_/, ''), dist(v.at, p), +b.BikesCapacity || 0]); }
      } catch (e) { }
      await sleep(250);
    }
    // 同名站牌合併，留最近的；路線合併
    const bus = {}; for (const [n, d, r] of o.bus) { if (!bus[n]) bus[n] = [n, d, []]; bus[n][1] = Math.min(bus[n][1], d); bus[n][2] = [...new Set(bus[n][2].concat(r))].slice(0, 14); }
    o.bus = Object.values(bus).sort((a, b) => a[1] - b[1]).slice(0, 4);
    o.bike = o.bike.sort((a, b) => a[1] - b[1]).slice(0, 3);
    if (o.mrt.length || o.bus.length || o.bike.length) out[name] = o;
  }
  if (Object.keys(out).length < 5) throw new Error('周邊交通只有 ' + Object.keys(out).length + ' 個場館');
  await writeFile(new URL('transit.json', ROOT), JSON.stringify({ updated: TODAY, source: '交通部 TDX 運輸資料流通服務（捷運、市區公車、公共自行車）', venues: out }) + '\n');
  console.log('✔ 周邊交通：' + Object.keys(out).length + ' 個場館');
}
// 國道客運：每班車只留各縣市第一個停靠站與時間 → 跟火車一樣可以查「A 縣市幾點開、B 縣市幾點到」
export function compactBus(sched, stopCity) {
  const DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], out = [];
  for (const r of sched) {
    const name = zr(r.RouteName) || zr(r.SubRouteName); if (!name) continue;
    for (const t of r.Timetables || []) {
      const sd = t.ServiceDay || {}, w = DAY.map(d => (sd[d] === undefined ? 1 : +sd[d] ? 1 : 0)).join('');
      const s = [], seen = new Set();
      for (const st of (t.StopTimes || []).slice().sort((a, b) => a.StopSequence - b.StopSequence)) {
        const city = stopCity[st.StopUID], tm = String(st.DepartureTime || st.ArrivalTime || '').slice(0, 5);
        if (!city || !/^\d\d:\d\d$/.test(tm)) continue;
        if (seen.has(city)) continue; seen.add(city); s.push([city, tm, zr(st.StopName).slice(0, 12)]);
      }
      if (s.length >= 2) out.push({ n: name.slice(0, 8), t: '', w, s });
    }
  }
  return out.slice(0, 6000);
}
async function intercity(auth) {
  const stopCity = {};
  for (const x of await get(TDX + 'v2/Bus/Stop/InterCity?%24select=StopUID,LocationCityCode&%24format=JSON', auth)) if (CODE[x.LocationCityCode]) stopCity[x.StopUID] = CODE[x.LocationCityCode];
  await sleep(1000);
  const bus = compactBus(await get(TDX + 'v2/Bus/Schedule/InterCity?%24format=JSON', auth), stopCity);
  if (bus.length < 200) throw new Error('國道客運班次太少：' + bus.length);
  await writeFile(new URL('bus.json', ROOT), JSON.stringify({ updated: TODAY, source: '交通部 TDX 運輸資料流通服務（公路客運時刻表）', bus }) + '\n');
  console.log('✔ 國道客運：' + bus.length + ' 班');
}
async function tdxAuth() {
  const id = process.env.TDX_ID, secret = process.env.TDX_SECRET; if (!id || !secret) return null;
  const tok = await get('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }).toString() });
  return { headers: { Authorization: 'Bearer ' + tok.access_token, 'Accept-Encoding': 'gzip' } };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  await weather(); await rail();
  try {
    const auth = await tdxAuth();
    if (auth) {
      try { await transit(auth); } catch (e) { console.log('✘ 周邊交通失敗，沿用舊資料：' + e.message); }
      try { await intercity(auth); } catch (e) { console.log('✘ 國道客運失敗，沿用舊資料：' + e.message); }
    }
  } catch (e) { console.log('✘ TDX 登入失敗：' + String(e.message).replace(process.env.TDX_SECRET || '\u0000', '***')); }
}
