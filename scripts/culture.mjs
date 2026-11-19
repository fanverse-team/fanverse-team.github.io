// FANVERSE 全台藝文資料
// 由 GitHub Actions 每天執行：從文化部「藝文活動」開放資料抓全台的演唱會、音樂、戲劇、舞蹈、親子、綜藝與展覽，
// 產生 arts.json（活動）與 venues.json（場館：縣市、地址、座標、最近的車站），並替有演出的場館補上附近住宿（hotels.json）。
// 資料授權：政府資料開放授權條款－第 1 版；來源：文化部文化資料開放服務網 https://cloud.culture.tw/
// 原則：任何一步失敗都保留舊資料；座標、車站、住宿都會快取，不會每天重查。
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { classify, guessArtist } from './update.mjs';

const UA = 'FanverseBot/1.0 (+https://fanverse-team.github.io/; student project, once a day)';
const ROOT = new URL('../', import.meta.url);
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const API = c => 'https://cloud.culture.tw/frontsite/trans/SearchShowAction.do?method=doFindTypeJ&category=' + c;
// 類別代碼 → [種類, 顯示名稱]
export const CATS = { 17: ['concert', '演唱會'], 5: ['concert', '獨立音樂'], 1: ['show', '音樂'], 2: ['show', '戲劇'], 3: ['show', '舞蹈'], 4: ['show', '親子'], 11: ['show', '綜藝'], 6: ['expo', '展覽'] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

async function get(url, opt = {}) {
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, Object.assign({ headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9' }, signal: AbortSignal.timeout(opt.timeout || 60000) }, opt.init || {}));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { err = e; await sleep(4000 * (i + 1)); }
  }
  throw err;
}
async function readJson(name, def) { try { return JSON.parse(await readFile(new URL(name, ROOT), 'utf8')); } catch (e) { return def; } }

/* ---------- 縣市與場館名稱整理 ---------- */
export const COUNTY = [['台北', /^(臺北|台北)/], ['新北', /^新北/], ['基隆', /^基隆/], ['桃園', /^桃園/], ['新竹', /^新竹/], ['苗栗', /^苗栗/], ['台中', /^(臺中|台中)/], ['彰化', /^彰化/], ['南投', /^南投/], ['雲林', /^雲林/], ['嘉義', /^嘉義/], ['台南', /^(臺南|台南)/], ['高雄', /^高雄/], ['屏東', /^屏東/], ['宜蘭', /^宜蘭/], ['花蓮', /^花蓮/], ['台東', /^(臺東|台東)/], ['澎湖', /^澎湖/], ['金門', /^金門/], ['連江', /^(連江|馬祖)/]];
// 地址沒寫縣市時，用只出現在一個縣市的行政區判斷
const DISTRICT = {
  台北: '大同 萬華 士林 北投 內湖 南港 文山 大安 松山', 新北: '板橋 三重 中和 永和 新莊 新店 樹林 鶯歌 三峽 淡水 汐止 瑞芳 土城 蘆洲 五股 泰山 林口 深坑 石碇 坪林 三芝 石門 八里 平溪 雙溪 貢寮 金山 萬里 烏來',
  高雄: '鹽埕 鼓山 左營 楠梓 三民 新興 前金 苓雅 前鎮 旗津 小港 鳳山 林園 大寮 大樹 大社 仁武 鳥松 岡山 橋頭 燕巢 田寮 阿蓮 路竹 湖內 茄萣 永安 彌陀 梓官 旗山 美濃 六龜 甲仙 杉林 內門 茂林 桃源 那瑪夏',
  台中: '北屯 西屯 南屯 太平 大里 霧峰 烏日 豐原 后里 石岡 東勢 和平 新社 潭子 大雅 神岡 大肚 沙鹿 龍井 梧棲 清水 大甲 外埔 大安區台中',
  台南: '安平 安南 永康 歸仁 新化 左鎮 玉井 楠西 南化 仁德 關廟 龍崎 官田 麻豆 佳里 西港 七股 將軍 學甲 北門 新營 後壁 白河 東山 六甲 下營 柳營 鹽水 善化 大內 山上 新市 安定'
};
export function cityOf(...texts) {
  for (const t0 of texts) {
    const t = String(t0 || '').replace(/^\s*\d{3,6}\s*/, '').trim(); if (!t) continue;
    for (const [c, re] of COUNTY) if (re.test(t)) return c;
    const m = t.match(/[（(](臺北|台北|新北|基隆|桃園|新竹|苗栗|臺中|台中|彰化|南投|雲林|嘉義|臺南|台南|高雄|屏東|宜蘭|花蓮|臺東|台東|澎湖|金門|連江)[市縣]?[)）]/);
    if (m) return cityOf(m[1]);
    const d = t.match(/^([一-鿿]{2})區/);
    if (d) for (const [c, list] of Object.entries(DISTRICT)) if (list.split(' ').includes(d[1])) return c;
  }
  return '';
}
// 同一個場館的不同廳合併成一個場館，廳名另外顯示
export const MAJOR = [
  ['台北大巨蛋', /^(台北|臺北)?大巨蛋/], ['台北小巨蛋', /^(台北|臺北)?小巨蛋/], ['台北流行音樂中心', /^(台北|臺北)流行音樂中心/],
  ['高雄巨蛋', /^高雄巨蛋/], ['高雄國家體育場', /^(高雄國家體育場|國家體育場)(﹝[^﹞]*﹞)?|^世運主場館/],
  ['國家兩廳院', /^國家兩廳院|^(?=國家音樂廳|國家戲劇院)/], ['臺中國家歌劇院', /^(臺中|台中)國家歌劇院/], ['衛武營國家藝術文化中心', /^衛武營(國家藝術文化中心)?/],
  ['臺北表演藝術中心', /^(臺北|台北)表演藝術中心/], ['臺灣戲曲中心', /^(臺灣|台灣)戲曲中心/], ['高雄流行音樂中心', /^高雄流行音樂中心/],
  ['台北國際會議中心', /^(台北|臺北)國際會議中心/], ['中興大學惠蓀堂', /^(台中)?(國立)?中興大學惠蓀堂/], ['奇美博物館', /^(臺南市|台南市)?奇美博物館/],
  ['駁二藝術特區', /^(高雄市)?駁二(藝術特區)?/], ['華山1914文化創意產業園區', /^華山(1914|文創)/], ['松山文創園區', /^松山文創園區/],
  ['國立自然科學博物館', /^國立自然科學博物館/], ['國立故宮博物院', /^國立故宮博物院/], ['國立臺灣美術館', /^國立臺灣美術館/],
  ['臺北市立美術館', /^臺北市立美術館/], ['高雄市立美術館', /^高雄市立美術館/], ['臺南市美術館', /^臺南市美術館/],
  ['內惟藝術中心', /^內惟藝術中心/], ['國立歷史博物館', /^國立歷史博物館/], ['國立傳統藝術中心宜蘭園區', /^國立傳統藝術中心宜蘭園區/]
];
// 場地名稱其實是活動名稱時，用地址找出場館
const BY_ADDR = [[/光復南路\s*133/, '松山文創園區'], [/中山南路\s*21-1/, '國家兩廳院'], [/(臺中|台中|北區)[^,]*館前路\s*(1|一)號/, '國立自然科學博物館'], [/文華路二段\s*66/, '奇美博物館'], [/惠來路二段\s*101/, '臺中國家歌劇院'], [/三多一路\s*1\s*號/, '衛武營國家藝術文化中心'], [/南海路\s*(47|四十七)\s*號/, '國立臺灣藝術教育館'], [/南海路\s*49\s*號/, '國立歷史博物館']];
export function normVenue(name0, addr0) {
  let name = String(name0 || '').replace(/[=＝]+\s*$/, '').replace(/\s+/g, ' ').trim();
  const addr = String(addr0 || '').replace(/\s+/g, ' ').trim();
  if (!name && !addr) return null;
  if (/線上|網路展|online/i.test(name + ' ' + addr)) return null;            // 線上活動不是場館
  const place = name.match(/^([一-鿿]{1,4}[區鄉鎮市])[（(]([一-鿿]{2,3}[市縣])[)）]$/);  // 「鼓山區（高雄市）」：只知道行政區
  if (place) return { venue: place[2].replace(/^臺/, '台') + place[1], hall: '', vague: true };
  for (const [v, re] of MAJOR) {
    if (re.test(name)) { const hall = name.replace(re, '').replace(/^[\s\-－_、·・【\[(（]+|[】\])）\s]+$/g, '').trim(); return { venue: v, hall: hall === v ? '' : hall.slice(0, 24) }; }
  }
  for (const [re, v] of BY_ADDR) if (re.test(addr)) { const hall = /[《》「」]|展覽$|特展|博覽會|^20\d\d/.test(name) ? '' : name.slice(0, 24); return { venue: v, hall: hall === v ? '' : hall }; }
  const looksLikeEvent = /[《》「」]|——|展覽|特展|攝影展|博覽會|^20\d\d/.test(name) && !/館|中心|劇場|劇院|廳|堂|園區|藝廊|畫廊|空間|書店/.test(name.replace(/展覽廳/, '廳'));
  if (looksLikeEvent || !name) {
    for (const [re, v] of BY_ADDR) if (re.test(addr)) return { venue: v, hall: '' };
    if (!addr) return null;
    return { venue: addr.replace(/\d+鄰/, '').slice(0, 30), hall: '', vague: true };
  }
  return { venue: name.slice(0, 40), hall: '' };
}

/* ---------- 活動整理 ---------- */
const dateOf = t => { const m = String(t || '').match(/^(\d{4})\/(\d{2})\/(\d{2})(?:\s+(\d{2}):(\d{2}))?/); return m ? { d: m[1] + '-' + m[2] + '-' + m[3], t: m[4] && !(m[4] === '00' && m[5] === '00') ? m[4] + ':' + m[5] : '' } : null; };
const clean = (s, n) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const httpsUrl = u => { try { const x = new URL(String(u).trim()); return x.protocol === 'https:' && !x.username ? x.href.slice(0, 300) : ''; } catch (e) { return ''; } };
export function priceText(p0, onSales) {
  const p = clean(p0, 200);
  if (!p) return onSales === 'N' ? '免費' : '';
  if (/免費|免門票|免票|自由入場|免費參觀/.test(p)) return '免費';
  const nums = p.split(/[、,，\/;；]\s*/).map(x => x.replace(/[^\d]/g, '')).filter(Boolean).map(Number);
  if (nums.length && p.replace(/[\d、,，\/;；\s元]/g, '') === '') { const lo = Math.min(...nums), hi = Math.max(...nums); return lo === hi ? 'NT$' + lo.toLocaleString('en-US') : 'NT$' + lo.toLocaleString('en-US') + '–' + hi.toLocaleString('en-US'); }
  return p.replace(/\s*\+\s*(\d)/g, ' $1').replace(/;\s*/g, '、').replace(/\s+/g, ' ').slice(0, 80);
}
function unitName(x) {
  const s = clean(x.showUnit, 200).split(/[;；]/)[0].replace(/^[（(][^)）]{1,8}[)）]/, '').trim();
  const parts = s.split(/[,，、]/).map(t => t.trim()).filter(Boolean);
  if (parts.length > 2) return parts.slice(0, 2).join('、') + ' 等';
  return s.slice(0, 60) || clean((x.masterUnit || [])[0], 40);
}
const ADDON = /加購|升級加購|upgrade|停車|寄物|周邊預購/i;
// 文化部的類別常常標錯（展覽放在演唱會、VR 影片放在音樂）：依標題、介紹和檔期重新判斷
const EXPO_RE = /展覽|特展|展出|聯展|個展|策展|典藏|常設|博覽|書展|攝影展|藝術展|文物|裝置|沉浸式|VR|虛擬實境|影像展|互動展|展區|展間|開放參觀|觀展/i;
const MUSIC_RE = /演唱會|音樂會|演奏會|獨奏|獨唱|巡迴|巡演|專場|音樂節|音樂祭|livehouse|\blive\b|concert|tour|showcase|fan ?meeting|見面會|歌友會/i;
const STAGE_RE = /舞劇|音樂劇|歌劇|話劇|戲劇|劇團|劇場|舞蹈|舞團|馬戲|魔術|相聲|脫口秀|親子劇|偶戲|京劇|歌仔戲|布袋戲|演出/;
// 規則判斷不出來、由人工確認過的活動：標題含這些字就直接用指定的分類
const KIND_FIX = [['鯨嶼紀', 'show']];
export function kindOf(k, title, desc, ranged, sessions) {
  const t = String(title || ''), d = String(desc || '');
  for (const [w, kk] of KIND_FIX) if (t.includes(w)) return kk;
  // 演唱會類別裡，標題是「XX—副標」這種故事型、又沒有音樂字眼的，多半是劇場表演
  if (k === 'concert' && !MUSIC_RE.test(t) && /[—–]|──/.test(t) && !EXPO_RE.test(t)) return 'show';
  if (k === 'expo') return MUSIC_RE.test(t) && !ranged ? 'concert' : 'expo';
  if (MUSIC_RE.test(t)) return k;
  if (EXPO_RE.test(t) || /市集|限時集/.test(t)) return 'expo';
  if (k === 'concert' && /節目|工作坊|講座|課程|體驗|導覽|研習/.test(t)) return 'show';
  // 演唱會不會連開十幾場：場次很多又看不出是音樂演出的，多半是展覽或放映
  if (k === 'concert' && sessions >= 12) return 'expo';
  if (STAGE_RE.test(t)) return k === 'concert' ? 'show' : k;
  // 標題看不出來時：連續好幾天都開放、或場次很多，介紹又提到展覽 → 展覽
  if (ranged && (EXPO_RE.test(d) || !STAGE_RE.test(d))) return 'expo';
  if (sessions >= 15 && EXPO_RE.test(d)) return 'expo';
  if (EXPO_RE.test(d) && !STAGE_RE.test(d) && !/音樂|樂團|歌手|演唱/.test(d)) return 'expo';
  return k;
}
const KIND_LABEL = { concert: '演唱會', show: '表演', expo: '展覽' };
export function buildEvents(raw, majors) {
  const out = [], seen = new Set();
  for (const x of raw) {
    const cat = CATS[x._c]; if (!cat || !x.title || ADDON.test(x.title)) continue;
    const title = clean(x.title, 120).replace(/^「(.+)」$/, '$1');
    const groups = new Map();
    for (const s of x.showInfo || []) {
      const v = normVenue(s.locationName, s.location); if (!v) continue;
      const key = v.venue; if (!groups.has(key)) groups.set(key, { v, list: [] });
      groups.get(key).list.push(s);
    }
    for (const { v, list } of groups.values()) {
      const id = 'k' + createHash('sha1').update(String(x.UID) + '|' + v.venue).digest('hex').slice(0, 12);
      if (seen.has(id)) continue; seen.add(id);
      const spans = list.map(s => ({ a: dateOf(s.time), b: dateOf(s.endTime) || dateOf(s.time) })).filter(s => s.a);
      if (!spans.length) continue;
      const ranged = cat[0] === 'expo' || spans.some(s => s.b && s.b.d > s.a.d);
      const s0 = list[0], addr = clean(s0.location, 60), at = +s0.latitude && +s0.longitude ? [+(+s0.latitude).toFixed(5), +(+s0.longitude).toFixed(5)] : null;
      const k = kindOf(cat[0], title, x.descriptionFilterHtml, ranged, spans.length);
      const e = { id, k, cat: k === cat[0] ? cat[1] : KIND_LABEL[k], title, venue: v.venue, city: cityOf(addr, s0.locationName, v.venue) };
      if (v.hall) e.hall = v.hall;
      if (ranged) {
        const a = spans.map(s => s.a.d).sort()[0], b = spans.map(s => (s.b || s.a).d).sort().pop();
        if (b < TODAY) continue;
        e.r = [a, b];
        const t1 = spans[0].a.t, t2 = spans[0].b && spans[0].b.t;
        if (t1 && t2 && t1 < t2) e.hours = t1 + '–' + t2;
      } else {
        const d = [...new Map(spans.map(s => [s.a.d + ' ' + s.a.t, [s.a.d, s.a.t]])).values()].filter(z => z[0] >= TODAY).sort((p, q) => (p[0] + p[1] < q[0] + q[1] ? -1 : 1));
        if (!d.length) continue;
        // 同一天有時間和沒時間兩筆時，留有時間的
        e.d = d.filter((z, i) => z[1] || !d.some((w, j) => j !== i && w[0] === z[0] && w[1])).slice(0, 40);
      }
      const unit = unitName(x);
      if (k === 'concert') { e.artist = (unit && unit.length <= 30 ? unit : guessArtist(title.replace(/^20\d\d\s*年?\s*/, '').replace(/^[「『《【]/, ''))).slice(0, 60); e.genre = classify(e.artist, title, ''); }
      else { e.artist = unit.slice(0, 60); e.genre = k === cat[0] ? cat[1] : k === 'expo' ? '展覽' : '綜藝'; }
      const price = priceText(s0.price, s0.onSales); if (price) e.price = price;
      const url = httpsUrl(x.webSales) && !/^https:\/\/[^/]+\/?$/.test(httpsUrl(x.webSales)) ? httpsUrl(x.webSales) : httpsUrl(x.sourceWebPromote) || httpsUrl(x.webSales);
      if (url) e.url = url;
      if (x.sourceWebName) e.sn = clean(x.sourceWebName, 30);
      const desc = clean(x.descriptionFilterHtml, 160); if (desc) e.desc = desc;
      if (addr) e.addr = addr;
      if (at) e.at = at;
      // 五大場館的演唱會已經由 update.mjs 從官網整理，同一天同場館的就不重複放
      if (e.k === 'concert' && majors[e.venue] && e.d && e.d.some(z => majors[e.venue].has(z[0]))) continue;
      out.push(e);
    }
  }
  return out.sort((a, b) => ((a.d ? a.d[0][0] : a.r[0]) < (b.d ? b.d[0][0] : b.r[0]) ? -1 : 1));
}

/* ---------- 場館：座標（沒附座標的用 OpenStreetMap Nominatim 查地址）與最近的車站 ---------- */
const distM = (a, b) => { const R = 6371000, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(x))); };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function overpass(q) {
  let err;
  for (const u of OVERPASS) { try { return JSON.parse(await get(u, { timeout: 200000, init: { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' } } })); } catch (e) { err = e; } }
  throw err;
}
async function geocode(addr) {
  const q = addr.replace(/\d+鄰/g, '').replace(/[（(].*?[)）]/g, '').replace(/(\d+)號.*$/, '$1號');
  const j = JSON.parse(await get('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=tw&accept-language=zh-TW&q=' + encodeURIComponent(q), { timeout: 30000 }));
  return j && j[0] ? [+(+j[0].lat).toFixed(5), +(+j[0].lon).toFixed(5)] : null;
}
function stationType(t) {
  if (t.station === 'subway' || /捷運|Metro|MRT/i.test((t.network || '') + (t.operator || ''))) return '捷運站';
  if (t.station === 'light_rail' || /輕軌/.test(t.network || '')) return '輕軌站';
  if (/高鐵|High Speed/i.test((t.operator || '') + (t.network || '') + (t.name || ''))) return '高鐵站';
  return '火車站';
}
export function nearestStations(at, stations) {
  const list = stations.map(s => [s.n, s.t, distM(at, s.p)]).sort((a, b) => a[2] - b[2]);
  const out = [];
  const first = list.find(s => s[2] <= 3000); if (first) out.push(first);
  const rail = list.find(s => (s[1] === '火車站' || s[1] === '高鐵站') && s[2] <= 8000 && (!first || s[0] !== first[0]));
  if (rail && (!first || first[1] === '捷運站' || first[1] === '輕軌站')) out.push(rail);
  return out;
}

/* ---------- 住宿：有演出的場館才找（展覽多半當天來回） ---------- */
const HTYPE = { hotel: '飯店', hostel: '青年旅館', guest_house: '民宿', motel: '汽車旅館', apartment: '公寓式住宿' };

export async function run() {
  // 1. 抓資料：任何一類失敗都沿用舊資料裡同一類的活動
  const old = await readJson('arts.json', { events: [] });
  const raw = [], failed = new Set();
  for (const c of Object.keys(CATS)) {
    try {
      const j = JSON.parse(await get(API(c)));
      if (!Array.isArray(j)) throw new Error('格式不對');
      j.forEach(x => { x._c = +c; raw.push(x); });
      console.log('✔ 文化部類別 ' + c + '（' + CATS[c][1] + '）：' + j.length + ' 筆');
    } catch (e) { failed.add(CATS[c][1]); console.log('✘ 文化部類別 ' + c + ' 抓取失敗，沿用舊資料：' + e.message); }
    await sleep(800);
  }
  const concerts = await readJson('concerts.json', { events: [] });
  const majors = {}; (concerts.events || []).forEach(e => { (majors[e.venue] = majors[e.venue] || new Set()); e.d.forEach(x => majors[e.venue].add(x[0])); });
  let events = buildEvents(raw, majors);
  const keep = (old.events || []).filter(e => failed.has(e.cat) && ((e.d && e.d[e.d.length - 1][0] >= TODAY) || (e.r && e.r[1] >= TODAY)));
  events = events.concat(keep);
  if (!raw.length && !keep.length) { console.log('沒有抓到任何資料，保留舊檔案'); return; }

  // 2. 場館資料：沿用快取，只補新場館
  const vj = await readJson('venues.json', { venues: {} }), V = vj.venues || {};
  for (const e of events) {
    const x = V[e.venue] || (V[e.venue] = {});
    if (!x.city && e.city) x.city = e.city;
    if (!x.addr && e.addr) x.addr = e.addr;
    if (!x.at && e.at) x.at = e.at;
    x.seen = TODAY;
  }
  // 太久沒有活動的場館移除，檔案不會無限長大
  for (const [k, x] of Object.entries(V)) if (x.seen && daysBetween(x.seen, TODAY) > 400) delete V[k];
  // 沒有座標的場館：用地址查（每次最多 60 個，Nominatim 規定每秒最多 1 次）
  let geo = 0;
  for (const [k, x] of Object.entries(V)) {
    if (x.at || !x.addr || geo >= 60 || (x.gf && daysBetween(x.gf, TODAY) < 30)) continue;
    geo++;
    try { const p = await geocode((x.city && !cityOf(x.addr) ? x.city : '') + x.addr); if (p) { x.at = p; delete x.gf; } else x.gf = TODAY; } catch (e) { x.gf = TODAY; }
    await sleep(1200);
  }
  console.log('地址查座標：' + geo + ' 個場館');
  // 縣市：地址判斷不出來時，用座標附近的場館推
  for (const e of events) { const x = V[e.venue]; e.city = x.city || e.city || ''; delete e.addr; delete e.at; }

  // 3. 最近的車站：每週用 OpenStreetMap 全台車站重算一次；有新場館時也算
  const needSt = Object.values(V).some(x => x.at && !x.st);
  if (needSt || !vj.stAt || daysBetween(vj.stAt, TODAY) >= 7) {
    try {
      const j = await overpass('[out:json][timeout:180];area["ISO3166-1"="TW"][admin_level=2]->.tw;(node["railway"~"^(station|halt)$"](area.tw);node["public_transport"="station"]["station"~"subway|light_rail"](area.tw););out;');
      const seenN = new Set(), stations = [];
      for (const el of j.elements || []) {
        const t = el.tags || {}; let n = t['name:zh'] || t.name; if (!n || !el.lat) continue;
        n = n.replace(/\s*\(.*\)$/, ''); if (!/站$/.test(n)) n += '站';
        const ty = stationType(t), key = n + ty; if (seenN.has(key)) continue; seenN.add(key);
        stations.push({ n, t: ty, p: [el.lat, el.lon] });
      }
      if (stations.length > 200) {
        for (const x of Object.values(V)) if (x.at) x.st = nearestStations(x.at, stations);
        vj.stAt = TODAY; console.log('✔ 車站：' + stations.length + ' 個，已更新各場館最近車站');
      } else console.log('✘ 車站資料太少（' + stations.length + '），沿用舊資料');
    } catch (e) { console.log('✘ 車站資料抓取失敗，沿用舊資料：' + e.message); }
  }

  // 4. 住宿：每週一次，替有演出的場館（含五大場館）找住宿：場館周邊 800 公尺內，加上離場館最近 3 個捷運／輕軌站各 500 公尺內
  const hj = await readJson('hotels.json', { venues: {} });
  if (!hj.m3At || daysBetween(hj.m3At, TODAY) >= 7) {
    let big = {}; try { big = (await import('./update.mjs')).VENUE_GEO || {}; } catch { }
    for (const [n, g] of Object.entries(big)) if (!V[n]) V[n] = { at: (hj.venues[n] && hj.venues[n].at) || g.at, city: n.startsWith('高雄') ? '高雄' : '台北' }; else if (!V[n].at) V[n].at = g.at;
    const want = [...new Set(events.filter(e => e.k !== 'expo' && !e.r).map(e => e.venue).concat(Object.keys(big)))].filter(v => V[v] && V[v].at).slice(0, 160);
    if (want.length) {
      try {
        const j = await overpass('[out:json][timeout:180];area["ISO3166-1"="TW"][admin_level=2]->.tw;(nwr["tourism"~"^(hotel|hostel|guest_house|motel)$"]["name"](area.tw);node["public_transport"="station"]["station"~"subway|light_rail"](area.tw);node["railway"="station"]["station"~"subway|light_rail"](area.tw););out center tags;');
        const all = [], metro = [], seenM = new Set();
        for (const el of j.elements || []) {
          const t = el.tags || {}, p = [el.lat || (el.center && el.center.lat), el.lon || (el.center && el.center.lon)]; if (!p[0]) continue;
          if (t.tourism && t.name) all.push({ n: t.name.slice(0, 60), en: (t['name:en'] || '').slice(0, 60), t: HTYPE[t.tourism] || '住宿', s: /^[1-5]$/.test(t.stars || '') ? +t.stars : 0, p: [+(+p[0]).toFixed(5), +(+p[1]).toFixed(5)] });
          else if (t.station) { let n = (t['name:zh'] || t.name || '').replace(/\s*\(.*\)$/, ''); if (!n) continue; if (!/站$/.test(n)) n += '站'; if (seenM.has(n)) continue; seenM.add(n); metro.push({ n, p: [+p[0], +p[1]] }); }
        }
        if (all.length > 500) {
          for (const v of want) {
            const at = V[v].at, seen = new Set();
            const sts = metro.map(m => Object.assign({ d: distM(at, m.p) }, m)).filter(m => m.d <= 6000).sort((a, b) => a.d - b.d).slice(0, 3);
            const pick = [];
            for (const h of all) {
              const d = distM(at, h.p); let m = null;
              for (const st of sts) { const sd = distM(st.p, h.p); if (sd <= 500 && (!m || sd < m[1])) m = [st.n, sd]; }
              if (d <= 800 || m) pick.push(Object.assign({}, h, { d }, d > 800 && m ? { m } : {}));
            }
            // 場館周邊最多 10 間，每個捷運站周邊最多 5 間
            pick.sort((a, b) => a.d - b.d);
            const per = {}, list = pick.filter(h => !seen.has(h.n) && seen.add(h.n)).filter(h => { const k = h.m ? h.m[0] : ''; per[k] = (per[k] || 0) + 1; return per[k] <= (k ? 5 : 10); }).slice(0, 25);
            if (list.length) hj.venues[v] = { at, list, st: sts.map(m => [m.n, m.d]), auto: !big[v], m3: true }; else delete hj.venues[v];
          }
          hj.m3At = TODAY; hj.artsAt = TODAY; hj.updated = TODAY; hj.source = 'OpenStreetMap（© OpenStreetMap contributors，ODbL）';
          await writeFile(new URL('hotels.json', ROOT), JSON.stringify(hj, null, 1) + '\n');
          console.log('✔ 住宿：' + want.length + ' 個場館（含最近 3 個捷運站周邊），全台住宿 ' + all.length + ' 筆、捷運站 ' + metro.length + ' 個');
        } else console.log('✘ 住宿資料太少，沿用舊資料');
      } catch (e) { console.log('✘ 住宿資料抓取失敗，沿用舊資料：' + e.message); }
    }
  }

  // 5. 寫檔：場館只留有活動或五大場館的；活動精簡欄位
  const used = new Set(events.map(e => e.venue));
  const outV = {}; Object.keys(V).sort().forEach(k => { const x = V[k]; outV[k] = Object.fromEntries(Object.entries({ city: x.city, addr: x.addr, at: x.at, st: x.st, seen: x.seen, gf: x.gf }).filter(([, v]) => v !== undefined && v !== '')); });
  await writeFile(new URL('venues.json', ROOT), JSON.stringify({ updated: TODAY, stAt: vj.stAt || '', source: '場館座標與車站：文化部開放資料、OpenStreetMap（© OpenStreetMap contributors，ODbL）', venues: outV }, null, 0).replace(/\},"/g, '},\n"') + '\n');
  await writeFile(new URL('arts.json', ROOT), '{"updated":"' + TODAY + '","source":"文化部文化資料開放服務網（政府資料開放授權條款－第1版）","events":[\n' + events.map(e => JSON.stringify(e)).join(',\n') + '\n]}\n');
  const byK = {}; events.forEach(e => byK[e.k] = (byK[e.k] || 0) + 1);
  console.log('完成：活動 ' + events.length + ' 筆（' + Object.entries(byK).map(x => x.join(' ')).join('、') + '），場館 ' + used.size + ' 個');
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await run();
