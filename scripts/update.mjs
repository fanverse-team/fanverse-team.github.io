// FANVERSE 場次自動更新
// 由 GitHub Actions 每天執行：抓取場館官網與維基百科的演唱會列表，合併進 concerts.json。
// 原則：任何一個來源失敗都不影響其他來源；失敗時保留原有資料；人工整理的場次不會被自動刪除。
import { readFile, writeFile } from 'node:fs/promises';

// 已知藝人 → 分類（用於自動分類與從標題辨識藝人）
const K = '防彈少年團|少女時代|東方神起|李泳知|李昇基|BTS|BLACKPINK|BABYMONSTER|MAMAMOO|Stray Kids|SEVENTEEN|JEONGHAN|JOSHUA|NCT 127|NCT DREAM|NCT WISH|NCT|TWICE|aespa|IVE|LE SSERAFIM|NewJeans|ITZY|TOMORROW X TOGETHER|TXT|ENHYPEN|ATEEZ|TREASURE|BIGBANG|G-DRAGON|T.O.P|TAEYANG|Super Junior|SHINee|EXO|D.O.|都敬秀|伯賢|BAEKHYUN|Red Velvet|i-dle|(G)I-DLE|IU|李知恩|ZEROBASEONE|RIIZE|BOYNEXTDOOR|CORTIS|KISS OF LIFE|ILLIT|MEOVV|DAY6|CNBLUE|FTISLAND|2PM|GOT7|MONSTA X|THE BOYZ|PSY|ZICO|Jay Park|朴寶劍|金秀賢|李俊昊|車銀優|邊佑錫|TAEYEON|太妍|KARA|2NE1|HYUKOH|JANNABI|KIM JAE JOONG|金在中|MISAMO|10CM|Kep1er|STAYC|fromis_9|PLAVE|P1Harmony|xikers|WayV|BTOB|INFINITE|Highlight|Wanna One|KAI|LISA|JENNIE|JISOO|Jung Kook|Jimin|SUGA|j-hope';
const J = '米津玄師|YOASOBI|Mr.Children|Mr. Children|Atarayo|あたらよ|ONE OK ROCK|Ado|King Gnu|Official髭男dism|髭男|Vaundy|藤井風|Fujii Kaze|back number|RADWIMPS|Aimer|LiSA|Perfume|Creepy Nuts|Mrs. GREEN APPLE|優里|imase|Eve|ヨルシカ|Yorushika|ZUTOMAYO|緑黄色社会|SEKAI NO OWARI|X JAPAN|YOSHIKI|HYDE|GLAY|嵐|ARASHI|Snow Man|SixTONES|King & Prince|Number_i|JO1|INI|BE:FIRST|乃木坂46|櫻坂46|日向坂46|AKB48|ATARASHII GAKKO|中島美嘉|宇多田光|濱崎步|安室奈美惠|椎名林檎|東京事變|星野源|菅田將暉|秦基博|福山雅治|Aqours|LoveLive|hololive|羊文學|Hitsujibungaku|SPYAIR|MAN WITH A MISSION|UVERworld|BUMP OF CHICKEN|ASIAN KUNG-FU|YUKI|aiko|あいみょん|Aimyon|夏川里美|久石讓|坂本龍一|小田和正|玉置浩二|中島美雪|LUNA SEA|SCANDAL|BAND-MAID|BABYMETAL|花譜|ReoNa|Kenshi Yonezu';
const W = '火星人布魯諾|魔力紅|西城男孩|酷玩樂團|紅髮艾德|泰勒絲|小賈斯汀|女神卡卡|聯合公園|年輕歲月|槍與玫瑰|金屬製品|新好男孩|謬思|綠洲合唱團|亞瑟小子|愛黛兒|共和世代|謎幻樂團|威肯|Maroon 5|Westlife|JOJI|Bruno Mars|Coldplay|Ed Sheeran|Taylor Swift|Dua Lipa|Billie Eilish|Olivia Rodrigo|Charlie Puth|LANY|OneRepublic|Imagine Dragons|Backstreet Boys|Lady Gaga|The Weeknd|Justin Bieber|Ariana Grande|Sam Smith|Adele|Linkin Park|Green Day|Oasis|Muse|Guns N|Metallica|Foo Fighters|Keshi|Lauv|HONNE|Troye Sivan|Shawn Mendes|Harry Styles|Post Malone|Travis Scott|Kanye|Kendrick|Doja Cat|Sabrina Carpenter|Tate McRae|Conan Gray|Jason Mraz|John Legend|Mariah Carey|Alicia Keys|Andrea Bocelli|Il Divo|Air Supply|Boyz II Men|Simple Plan|Avril Lavigne|Fall Out Boy|My Chemical Romance|Paramore|Dream Theater|Bryan Adams|Sting|Rod Stewart|Elton John|Cigarettes After Sex|The Script|5 Seconds of Summer|Diana Krall|Niall Horan|Louis Tomlinson|Katy Perry|Pitbull|Christina Aguilera|Jessie J|Calum Scott|Anne-Marie|ZAYN|Kodaline|Hans Zimmer';
const split = s => s.split('|').sort((a, b) => b.length - a.length);
const KNOWN = [['韓流', split(K)], ['日本', split(J)], ['歐美', split(W)]];
const low = s => s.toLowerCase();
function hasName(text, name) {
  const t = low(text), n = low(name), i = t.indexOf(n);
  if (i < 0) return false;
  if (!/^[\x00-\x7f]+$/.test(n)) return true;          // 非英文名稱：直接比對
  const b = t[i - 1], a = t[i + n.length];             // 英文名稱：前後不能再接英數字
  return !(b && /[a-z0-9]/.test(b)) && !(a && /[a-z0-9]/.test(a));
}
function knownArtist(text) {
  for (const [g, list] of KNOWN) for (const n of list) if (hasName(text, n)) return { name: n, genre: g };
  return null;
}
function classify(artist, title, hint) {
  const all = artist + ' ' + title + ' ' + (hint || '');
  if (/頒獎|Awards|音樂節|Festival|FESTIVAL|民歌|慈善|超過\d+組|跨年|主持人|拼盤|群星/.test(all)) return '綜合';
  if ((artist.match(/、/g) || []).length >= 2) return '綜合';
  if (/韓國|大韓民國|大韩民国/.test(hint || '')) return '韓流';
  if (/日本/.test(hint || '')) return '日本';
  if (/臺灣|台灣|中華民國|香港|新加坡|馬來西亞|中國|中华|澳門/.test(hint || '')) return '華語';
  if (/美國|英國|加拿大|澳洲|愛爾蘭|瑞典|法國|德國|義大利/.test(hint || '')) return '歐美';
  const k = knownArtist(all); if (k) return k.genre;
  if (/[가-힯]/.test(all)) return '韓流';
  if (/[぀-ヿ]/.test(all)) return '日本';
  if (/[一-鿿]/.test(artist)) return '華語';
  return '其他';
}
function guessArtist(title) {
  const k = knownArtist(title); if (k) return k.name;
  let t = title.replace(/^[《「『【\s]+/, '').replace(/^\S*(銀行|人壽|電信|證券|集團)\s+/, '').replace(/^20\d\d\s*/, '');
  const m = t.match(/^[一-鿿·・]{2,8}/); if (m) return m[0].replace(/(演唱會|巡迴|世界|台北|臺北|高雄).*$/, '') || m[0];
  const words = t.split(/\s+/), out = [];
  for (const w of words) { if (/^(20\d\d|world|tour|live|concert|asia|in|the\s*$|fan|fanmeeting|演唱會)/i.test(w) || /[一-鿿《「『]/.test(w)) break; out.push(w); if (out.length >= 4) break; }
  return out.join(' ') || t.slice(0, 20);
}

/* ---------- 日期 ---------- */
// 「12月30-31日」「7月3-5、8、10-12日」「1月31日-2月1日」「5月15、17日」→ ISO 日期陣列
function parseCnDates(text, year) {
  const out = []; let month = null;
  const s = text.replace(/[日號\s]/g, '').replace(/[~～–—至]/g, '-').replace(/[,，]/g, '、');
  for (const part of s.split('、')) {
    const m = part.match(/^(?:(\d{1,2})月)?(\d{1,2})(?:-(?:(\d{1,2})月)?(\d{1,2}))?$/);
    if (!m) continue;
    if (m[1]) month = +m[1];
    if (!month) continue;
    const a = new Date(Date.UTC(year, month - 1, +m[2]));
    let b = a;
    if (m[4]) { const m2 = m[3] ? +m[3] : month; b = new Date(Date.UTC(m2 < month ? year + 1 : year, m2 - 1, +m[4])); if (m[3]) month = m2; }
    if ((b - a) / 864e5 > 20 || b < a) b = a;
    for (let t = +a; t <= +b; t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
// 「2026/12/12、12/13、12/15」「2027/1/16、1/17」「2026/12/31-2027/1/1」
function parseSlashDates(text) {
  const out = []; let year = null, month = null;
  const s = text.replace(/\s/g, '').replace(/[~～–—至]/g, '-').replace(/[,，]/g, '、').replace(/\([^)]*\)|（[^）]*）/g, '');
  const one = p => { const m = p.match(/^(?:(20\d\d)\/)?(?:(\d{1,2})\/)?(\d{1,2})$/); if (!m) return null; if (m[1]) year = +m[1]; if (m[2]) month = +m[2]; if (!year || !month) return null; return new Date(Date.UTC(year, month - 1, +m[3])); };
  for (const part of s.split('、')) {
    const [l, r] = part.split('-'); const a = one(l); if (!a) continue; let b = r ? one(r) : a; if (!b || b < a || (b - a) / 864e5 > 20) b = a;
    for (let t = +a; t <= +b; t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/* ---------- 維基百科 wikitext 表格 ---------- */
function cleanWiki(s) {
  return s.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/\{\{le\|([^|}]*)\|[^|}]*(?:\|([^}]*))?\}\}/g, (m, a, c) => c || a)
    .replace(/\{\{[^{}]*\}\}/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/'{2,}/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
// order：日期之後的欄位意義，例如 ['artist','title']、['title','artist']、['both']
function parseWikiTable(wikitext, heading, order) {
  const a = wikitext.search(heading); if (a < 0) return [];
  const rest = wikitext.slice(a), nextH = rest.slice(5).search(/\n==[^=]/);
  const sec = nextH < 0 ? rest : rest.slice(0, nextH + 5);
  const events = []; let year = null, last = null;
  for (const row of sec.split(/\n\|-/)) {
    const hy = row.match(/\n!\s*(?:colspan="?\d+"?\s*\|)?\s*(20\d\d)\s*年?/); if (hy) year = +hy[1];
    let cells = [];
    for (const line of row.split('\n')) { if (!line.startsWith('|') || line.startsWith('|}') || line.startsWith('|+')) continue; for (const c of line.slice(1).split('||')) cells.push(c); }
    cells = cells.map(c => { const m = c.match(/^\s*(?:(?:rowspan|colspan|style|align|class|width|bgcolor)\s*=\s*"?[^|"]*"?\s*)+\|(?!\|)([\s\S]*)$/); return (m ? m[1] : c).trim(); });
    if (cells.length && /^(20\d\d)年?$/.test(cleanWiki(cells[0]))) { year = +cleanWiki(cells[0]).slice(0, 4); cells.shift(); }
    if (!cells.length || !year) continue;
    const dates = parseCnDates(cleanWiki(cells[0]), year); if (!dates.length) continue;
    const others = cells.slice(1);
    const hint = others.join(' ');
    const txt = others.map(cleanWiki).filter(c => c && !/^[\d.,]+\s*(場|萬|人)?$/.test(c));
    if (!txt.length) { if (last) last.dates.push(...dates); continue; }
    let artist = '', title = '';
    if (order[0] === 'both') { const m = txt[0].match(/^(.*?)\s*(《.*)$/); artist = m ? m[1] : guessArtist(txt[0]); title = txt[0]; }
    else { const o = {}; order.forEach((k, i) => o[k] = txt[i] || ''); artist = o.artist; title = o.title; }
    artist = artist.replace(/\s*[（(][^（）()]*[）)]\s*$/, '').trim();
    if (!artist) artist = guessArtist(title);
    if (!title) title = artist;
    last = { year, dates, artist, title, hint: hint.replace(/\[\[[^\]|]*\|/g, '[[') };
    events.push(last);
  }
  return events.map(e => ({ dates: [...new Set(e.dates)].sort(), artist: e.artist, title: e.title, hint: e.hint }));
}

/* ---------- 台北小巨蛋官網活動列表 ---------- */
const decode = s => s.replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
function parseArena(html) {
  const out = [], seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
    const t = decode(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    const mm = t.match(/^((?:20\d\d\/)?\d{1,2}\/\d{1,2}[\d\/、,，\-~～至\s()（）一二三四五六日]*?)\s*[《「『【](.+)[》」』】]\s*$/);
    if (!mm || seen.has(t)) continue; seen.add(t);
    const title = mm[2].trim();
    if (!/演唱會|巡迴|巡演|tour|live|concert|fan\s*-?(meeting|con)|見面會|音樂會|showcase/i.test(title)) continue;
    if (/籃球|排球|冰上|錦標賽|聯賽|博覽|展覽/.test(title)) continue;
    const dates = parseSlashDates(mm[1]); if (!dates.length) continue;
    out.push({ dates, artist: guessArtist(title), title, hint: '' });
  }
  return out;
}

/* ---------- 台北流行音樂中心節目列表 ---------- */
function parseTmc(html) {
  const out = [];
  for (const blk of html.split(/<a\b(?=[^>]*c-card-clip-wrap)/).slice(1)) {
    const g = re => { const m = blk.match(re); return m ? decode(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : ''; };
    const title = g(/c-card-clip__title[^>]*>([\s\S]*?)<\/h3>/), date = g(/class="[^"]*\bdate\b[^"]*"[^>]*>([\s\S]*?)<\//), loc = g(/class="[^"]*\blocation\b[^"]*"[^>]*>([\s\S]*?)<\//);
    const tags = [...blk.matchAll(/c-tag[^>]*>([\s\S]*?)<\//g)].map(x => x[1].replace(/<[^>]+>/g, '').trim()).join(' ');
    if (!title || !/表演廳/.test(loc) || !/演唱會/.test(tags + title)) continue;
    const ds = [...date.matchAll(/(20\d\d)\.(\d{1,2})\.(\d{1,2})/g)].map(x => new Date(Date.UTC(+x[1], +x[2] - 1, +x[3])));
    if (!ds.length) continue;
    const a = ds[0], b = ds[1] && ds[1] >= a && (ds[1] - a) / 864e5 <= 20 ? ds[1] : a, dates = [];
    for (let t = +a; t <= +b; t += 864e5) dates.push(new Date(t).toISOString().slice(0, 10));
    out.push({ dates, artist: guessArtist(title), title, hint: '' });
  }
  return out;
}

/* ================= 抓取與合併 ================= */
const FILE = new URL('../concerts.json', import.meta.url);
const UA = 'FanverseBot/1.0 (+https://fanverse-team.github.io/; student project, twice a day)';
const todayTW = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

async function getText(url) {
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { err = e; await new Promise(s => setTimeout(s, 3000 * (i + 1))); }
  }
  throw err;
}
const wiki = async page => JSON.parse(await getText('https://zh.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&page=' + encodeURIComponent(page))).parse.wikitext['*'];
const tmcUrl = n => 'https://www.tmc.taipei/tw/blog/show?filter=' + Buffer.from(JSON.stringify({ pages: n, category: '', year: '', month: '', keyword: '', direction: 'latest' })).toString('base64');

export const SOURCES = [
  { key: 'arena', venue: '台北小巨蛋', get: async g => parseArena(await g('https://www.arena.taipei/News.aspx?n=2E1489AFE4B1BEA1&sms=F9A95D3F5A5C2C68')) },
  { key: 'tmc', venue: '台北流行音樂中心', get: async g => { const out = []; for (let n = 1; n <= 6; n++) { const h = await g(tmcUrl(n)); if (!/c-card-clip-wrap/.test(h)) break; out.push(...parseTmc(h)); } return out; } },
  { key: 'wikiDome', venue: '台北大巨蛋', wiki: '臺北大巨蛋', heading: /===\s*演唱會\s*===/, order: ['artist', 'title'] },
  { key: 'wikiKH', venue: '高雄巨蛋', wiki: '高雄巨蛋', heading: /==\s*演唱會\s*==/, order: ['both'] },
  { key: 'wikiStadium', venue: '高雄國家體育場', wiki: '國家體育場 (高雄市)', heading: /===\s*演唱會\s*===/, order: ['title', 'artist'] }
];

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9぀-ヿ一-鿿가-힯]/g, '');
function sameAct(ev, sc) {
  const hay = norm(sc.artist + sc.title);
  const tokens = ev.artist.split(/[\s（）()、,，/×xX&]+/).map(norm).filter(t => /[぀-鿿가-힯]/.test(t) ? t.length >= 2 : t.length >= 3);
  if (norm(ev.artist).length >= 2 && hay.includes(norm(ev.artist))) return true;
  if (tokens.some(t => hay.includes(t))) return true;
  const a = norm(sc.artist); return a.length >= 2 && norm(ev.artist + ev.title).includes(a);
}
const dayGap = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
function niceTitle(sc) {
  const inner = sc.title.replace(/^《(.*)》$/, '$1').trim();
  if (norm(inner).includes(norm(sc.artist)) || !sc.artist) return inner;
  return /《/.test(sc.title) ? (sc.title.startsWith(sc.artist) ? sc.title : sc.artist + sc.title) : sc.artist + '《' + inner + '》';
}

export function merge(data, key, venue, scraped, today) {
  const log = [];
  const mine = data.events.filter(e => e.venue === venue);
  const used = new Set();
  for (const sc of scraped) {
    if (sc.dates[sc.dates.length - 1] < today) continue;                 // 只處理尚未結束的場次
    let ev = mine.find(e => !used.has(e.id) && e.d.some(x => sc.dates.includes(x[0])) && (sameAct(e, sc) || e.d.length === sc.dates.length))
      || mine.find(e => !used.has(e.id) && sameAct(e, sc) && dayGap(e.d[0][0], sc.dates[0]) <= 45);
    if (ev) {
      used.add(ev.id);
      const old = ev.d.map(x => x[0]).join(','), neu = sc.dates.join(',');
      if (old !== neu) {
        const past = ev.d.filter(x => x[0] < today && !sc.dates.includes(x[0]));   // 已演出的日期保留
        const t0 = ev.d[0][1], sameTime = ev.d.every(x => x[1] === t0);
        ev.d = past.concat(sc.dates.map(d => { const o = ev.d.find(x => x[0] === d); return [d, o ? o[1] : (sameTime ? t0 : '')]; })).sort((a, b) => a[0] < b[0] ? -1 : 1);
        log.push('日期更新 ' + ev.id + ' ' + ev.artist + '：' + old + ' → ' + neu);
      }
      if (!ev.src.includes(key)) ev.src.push(key);
    } else {
      const genre = classify(sc.artist, sc.title, sc.hint);
      const title = niceTitle(sc).slice(0, 80);
      const artist = (genre === '綜合' && (sc.artist.length > 24 || /、/.test(sc.artist)) ? title.replace(/^.*《(.*)》.*$/, '$1') : sc.artist).slice(0, 40) || guessArtist(title);
      data.seq += 1;
      const id = 'e' + String(data.seq).padStart(2, '0');
      const neu = { id, artist, genre, title, venue, d: sc.dates.map(d => [d, '']), src: [key], auto: true };
      data.events.push(neu); used.add(id);
      log.push('新增 ' + id + ' ' + artist + '｜' + title + '｜' + sc.dates.join(',') + '｜' + genre);
    }
  }
  // 自動新增、尚未開演、且已從來源消失的場次 → 視為取消或改期，移除
  if (scraped.length) {
    for (const e of mine) if (e.auto && e.src.length === 1 && e.src[0] === key && !used.has(e.id) && e.d[0][0] > today) {
      data.events.splice(data.events.indexOf(e), 1); log.push('移除（來源已無此場次）' + e.id + ' ' + e.artist);
    }
  }
  return log;
}

export async function run(g, data, today) {
  data.status = data.status || {};
  for (const s of SOURCES) {
    try {
      const list = s.get ? await s.get(g) : parseWikiTable(await g('wiki:' + s.wiki), s.heading, s.order);
      const upcoming = list.filter(e => e.dates[e.dates.length - 1] >= today);
      const log = merge(data, s.key, s.venue, list, today);
      data.status[s.key] = { ok: true, at: today, count: upcoming.length };
      console.log('✔ ' + s.key + '（' + s.venue + '）：來源列出 ' + list.length + ' 筆，未來場次 ' + upcoming.length + ' 筆' + (log.length ? '\n   ' + log.join('\n   ') : '，無異動'));
    } catch (e) {
      data.status[s.key] = Object.assign({}, data.status[s.key], { ok: false, failedAt: today });
      console.log('✘ ' + s.key + '（' + s.venue + '）抓取失敗，沿用原有資料：' + (e && e.message));
    }
  }
  data.events.sort((a, b) => a.d[0][0] < b.d[0][0] ? -1 : a.d[0][0] > b.d[0][0] ? 1 : 0);
  if (Object.values(data.status).some(s => s.ok && s.at === today)) data.updated = today;
  return data;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  let data;
  try { data = JSON.parse(await readFile(FILE, 'utf8')); }
  catch (e) {   // 第一次執行：從 index.html 內建的場次清單建立 concerts.json
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const a = html.indexOf('let CONCERTS = ['), b = html.indexOf('\n];', a);
    if (a < 0 || b < 0) { console.error('index.html 還不是新版（找不到內建場次清單），先不建立資料'); process.exit(1); }
    const events = new Function('return ' + html.slice(a + 15, b + 2))();
    data = { updated: todayTW(), seq: Math.max(...events.map(x => +x.id.slice(1))), status: {}, events };
    console.log('已從 index.html 建立初始資料，共 ' + events.length + ' 筆');
  }
  const before = data.events.length;
  await run(u => u.startsWith('wiki:') ? wiki(u.slice(5)) : getText(u), data, todayTW());
  if (!Array.isArray(data.events) || data.events.length < Math.min(before, 5)) { console.error('資料異常，放棄寫入'); process.exit(1); }
  const head = { updated: data.updated, seq: data.seq, status: data.status };
  await writeFile(FILE, JSON.stringify(head, null, 1).replace(/\n\}$/, ',\n "events": [\n') + data.events.map(e => '  ' + JSON.stringify(e)).join(',\n') + '\n ]\n}\n');
  console.log('完成：共 ' + data.events.length + ' 筆場次，資料日期 ' + data.updated);
}
