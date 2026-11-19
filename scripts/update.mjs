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
export function classify(artist, title, hint) {
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
export function guessArtist(title) {
  const k = knownArtist(title); if (k) return k.name;
  const br = title.match(/^\s*[《「『【][^》」』】]{1,20}[》」』】]\s*([\s\S]+)$/);
  if (br && /^[\u4e00-\u9fff]{2}/.test(br[1])) title = br[1];
  let t = title.replace(/^[《「『【\s]+/, '').replace(/^\S*(銀行|人壽|電信|證券|集團)\s+/, '').replace(/^20\d\d\s*/, '');
  const m = t.match(/^[一-鿿·・]{2,8}/); if (m) return m[0].replace(/([\d一二三四五六七八九十]+週年|演唱會|巡迴|世界|台北|臺北|高雄).*$/, '') || m[0];
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
  const events = []; let year = null, last = null, prevOthers = [];
  for (const row of sec.split(/\n\|-/)) {
    const hy = row.match(/\n!\s*(?:colspan="?\d+"?\s*\|)?\s*(20\d\d)\s*年?/); if (hy) year = +hy[1];
    let cells = [];
    for (const line of row.split('\n')) { if (!line.startsWith('|') || line.startsWith('|}') || line.startsWith('|+')) continue; for (const c of line.slice(1).split('||')) cells.push(c); }
    cells = cells.map(c => { const m = c.match(/^\s*(?:(?:rowspan|colspan|style|align|class|width|bgcolor)\s*=\s*"?[^|"]*"?\s*)+\|(?!\|)([\s\S]*)$/); return (m ? m[1] : c).trim(); });
    if (cells.length && /^(20\d\d)年?$/.test(cleanWiki(cells[0]))) { year = +cleanWiki(cells[0]).slice(0, 4); cells.shift(); }
    if (!cells.length || !year) continue;
    if (/<del>|<s>/i.test(cells[0])) continue;                          // 已取消的場次
    const dates = parseCnDates(cleanWiki(cells[0].replace(/<br\s*\/?>/gi, '、')), year); if (!dates.length) continue;
    let others = cells.slice(1);
    if (others.length && prevOthers.length > others.length && others.length < order.length + (order[0] === 'both' ? 0 : 1)) others = prevOthers.slice(0, prevOthers.length - others.length).concat(others);   // 上一列 rowspan 合併的欄位
    prevOthers = others;
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
  const merged = [];
  for (const e of events) { const p = merged[merged.length - 1]; if (p && p.title === e.title && p.year === e.year) p.dates.push(...e.dates); else merged.push(e); }   // 同一活動分列多天
  return merged.map(e => ({ dates: [...new Set(e.dates)].sort(), artist: e.artist, title: e.title, hint: e.hint }));
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

/* ---------- 從新聞擷取票價、售票平台、售票頁 ---------- */
// 從新聞文章 HTML 擷取某一場（場館＋日期）的票價、售票平台、售票頁連結
const VENUE_ALIAS = {
  '台北大巨蛋': ['台北大巨蛋', '臺北大巨蛋', 'Taipei Dome'],
  '台北小巨蛋': ['台北小巨蛋', '臺北小巨蛋', 'Taipei Arena'],
  '台北流行音樂中心': ['台北流行音樂中心', '臺北流行音樂中心', '北流', 'Taipei Music Center'],
  '高雄巨蛋': ['高雄巨蛋', 'K-ARENA', 'Kaohsiung Arena'],
  '高雄國家體育場': ['高雄國家體育場', '國家體育場', '世運主場館', '高雄世運']
};
const PLAT_KEYS = [[/拓元|tixcraft/i, '拓元售票'], [/KKTIX|KKLIVE/i, 'KKTIX'], [/遠大|Ticket ?Plus/i, '遠大售票 Ticket Plus'], [/ibon/i, 'ibon 售票'], [/寬宏|kham/i, '寬宏售票'], [/年代售票|ticket\.com\.tw/i, '年代售票']];
const TICKET_HOST = /^https:\/\/(tixcraft\.com\/activity\/(detail|game)\/[\w-]+|[\w-]+\.kktix\.cc\/events\/[\w-]+|kktix\.com\/events\/[\w-]+|ticketplus\.com\.tw\/activity\/[\w-]+|ticket\.ibon\.com\.tw\/ActivityInfo\/Details\/\d+|www\.kham\.com\.tw\/application\/UTK02\/UTK0201_\.aspx\?PRODUCT_ID=\w+|www\.ticket\.com\.tw\/application\/UTK02\/UTK0201_\.aspx\?PRODUCT_ID=\w+)/;
function htmlToText(html) {
  const links = [];
  let h = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ');
  h = h.replace(/<a\b[^>]*href="([^"]+)"[^>]*>/gi, (m, u) => { links.push(u.replace(/&amp;/g, '&')); return ' ⟦L' + (links.length - 1) + '⟧ '; });
  h = h.replace(/<br\s*\/?>|<\/(p|li|h\d|div|tr|td|section|figcaption)>/gi, '\n').replace(/<[^>]+>/g, ' ');
  h = h.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&quot;/g, '"');
  h = h.replace(/[ \t　]+/g, ' ').replace(/\n\s*\n+/g, '\n');
  return { text: h, links };
}
const NUM = /(?:NT\$|NTD|TWD|\$)?\s*(\d{1,2},\d{3}|\d{3,5})(?!\d|\s*(?:年|月|日|號|人|萬|席次|個|張|分|場|名|公尺|公里))/g;
function findVenueMentions(text) {
  const out = [];
  for (const [v, al] of Object.entries(VENUE_ALIAS)) for (const a of al) { let i = -1; while ((i = text.indexOf(a, i + 1)) >= 0) out.push({ i, v, len: a.length }); }
  // 「高雄國家體育場」裡的「國家體育場」不重複算
  return out.sort((x, y) => x.i - y.i).filter((m, k, arr) => !arr.some(o => o !== m && o.i <= m.i && o.i + o.len >= m.i + m.len && o.len > m.len));
}
function extractPrice(html, ev) {
  const { text, links } = htmlToText(html);
  const artistKeys = ev.artist.split(/[\s（）()、,，/]+/).filter(t => t.length >= 2);
  if (!artistKeys.some(k => text.includes(k))) return null;
  const vm = findVenueMentions(text);
  const dates = ev.d.map(x => { const [y, m, d] = x[0].split('-').map(Number); return [m + '/' + d, m + '月' + d + '日', String(m).padStart(2, '0') + '/' + String(d).padStart(2, '0'), y + '/' + String(m).padStart(2, '0') + '/' + String(d).padStart(2, '0'), y + '.' + String(m).padStart(2, '0') + '.' + String(d).padStart(2, '0')]; }).flat();
  const lines = text.split('\n');
  let pos = 0; const cands = [];
  const SPECIAL = /VIP|身障|輪椅|陪同|愛心|敬老|學生|兒童|早鳥|優待|優惠/i;
  const starts = []; for (const line of lines) { starts.push(pos); pos += line.length + 1; }
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const k = line.search(/票價|票種|門票價|票券價格/); if (k < 0) continue;
    // 價格可能寫在同一行或接下來兩行
    let block = line.slice(k), endLi = li;
    while (endLi < li + 2 && endLi + 1 < lines.length && [...block.matchAll(NUM)].length < 2) { endLi++; block += ' / ' + lines[endLi]; }
    block = block.replace(/NT\$|NTD|TWD/g, '$');
    const regular = [], special = []; let carry = '', last = 0;
    const ms = [...block.matchAll(NUM)];
    ms.forEach((m, idx) => {
      const n = +m[1].replace(',', ''); if (n < 300 || n > 30000) { last = m.index + m[0].length; return; }
      const gap = block.slice(last, m.index), tailEnd = idx + 1 < ms.length ? ms[idx + 1].index : block.length;
      const tail = block.slice(m.index + m[0].length, tailEnd).split('/')[0];
      const gl = gap.replace(/[$\s:：]/g, '');
      if (SPECIAL.test(gl)) carry = gl.replace(/^[\/｜|、，,]+|[\/｜|、，,]+$/g, '').replace(/[\/]/g, '／').slice(0, 24);
      else if (/[｜|]|一般|全票/.test(gap)) carry = '';
      const tl = (tail.match(/[（(]([^）)]*)[）)]/) || [])[1];
      const lab = tl && SPECIAL.test(tl) ? tl : carry;
      if (lab) { const ex = special.find(x => x[0] === lab); if (ex) ex[1] += '／' + n.toLocaleString('en-US'); else special.push([lab, n.toLocaleString('en-US')]); }
      else regular.push(n);
      last = m.index + m[0].length;
    });
    if (regular.length < 2 && !(regular.length === 1 && special.length)) continue;
    const start = starts[li], end = starts[endLi] + lines[endLi].length + 1;
    const before = vm.filter(m => m.i < start && start - m.i < 2500);
    const near = before[before.length - 1];
    if (!near || near.v !== ev.venue) continue;
    const prevOther = [...vm].reverse().find(m => m.i < near.i && m.v !== ev.venue);
    const ctx = text.slice(prevOther ? prevOther.i + prevOther.len : Math.max(0, near.i - 800), end);
    const dateHit = dates.some(d => ctx.includes(d));
    cands.push({ start, end, regular, special, dateHit, near });
  }
  if (!cands.length) return null;
  const c = cands.find(x => x.dateHit) || (cands.length === 1 ? cands[0] : null);
  if (!c) return null;
  const lo = Math.min(...c.regular), hi = Math.max(...c.regular);
  const res = { price: 'NT$' + lo.toLocaleString('en-US') + (hi > lo ? '–' + hi.toLocaleString('en-US') : ''), confident: c.dateHit };
  if (hi === lo && c.special.length) res.price += '（全票）';
  if (c.special.length) res.prices = c.special.slice(0, 6);
  // 售票平台與售票頁：同一段（這個場館名稱之後到下一個不同場館名稱之前）
  const next = vm.find(m => m.i > c.end && m.v !== ev.venue);
  const sec = text.slice(c.near.i, next ? next.i : c.end + 1500);
  const pl = sec.match(/(售票(平台|系統|網站|網址|連結)|購票(平台|連結|網址|方式))[:：]?[^\n]{0,60}/);
  if (pl) { const hit = PLAT_KEYS.find(p => p[0].test(pl[0])); if (hit) res.platform = hit[1]; }
  for (const m of sec.matchAll(/⟦L(\d+)⟧/g)) { const u = links[+m[1]]; if (TICKET_HOST.test(u)) { res.ticketUrl = u.slice(0, 200); if (!res.platform) { const hit = PLAT_KEYS.find(p => p[0].test(u)); if (hit) res.platform = hit[1]; } break; } }
  return res;
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

async function postText(url, body) {
  let err;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { method: 'POST', body, headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(90000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { err = e; await new Promise(s => setTimeout(s, 8000 * (i + 1))); }
  }
  throw err;
}
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function overpass(q) {
  let err;
  for (const u of OVERPASS) { try { return JSON.parse(await postText(u, 'data=' + encodeURIComponent(q))); } catch (e) { err = e; } }
  throw err;
}
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/* ---------- 票價：每天挑尚未有票價的場次，用新聞搜尋補上 ---------- */
const VSHORT = { '台北大巨蛋': '大巨蛋', '台北小巨蛋': '小巨蛋', '台北流行音樂中心': '北流', '高雄巨蛋': '高雄巨蛋', '高雄國家體育場': '世運' };
async function bingNews(q, g) {
  const x = await g('https://www.bing.com/news/search?format=rss&setlang=zh-hant&cc=TW&q=' + encodeURIComponent(q));
  return [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const get = k => ((m[1].match(new RegExp('<' + k + '>([\\s\\S]*?)</' + k + '>')) || [])[1] || '').replace(/&amp;/g, '&');
    let u = get('link'); try { const p = new URL(u).searchParams.get('url'); if (p) u = p; } catch (e) { }
    return { title: decode(get('title').replace(/<[^>]+>/g, '')), url: u };
  });
}
export async function enrichPrices(data, g, today, max = 10) {
  const due = e => !e.priceCheckedAt || daysBetween(e.priceCheckedAt, today) >= (e.price && !e.autoPrice ? 7 : e.price ? 14 : 3);
  const list = data.events.filter(e => e.d[e.d.length - 1][0] >= today && (!e.price || e.autoPrice || !e.ticketUrl) && due(e))
    .sort((a, b) => a.d[0][0] < b.d[0][0] ? -1 : 1).slice(0, max);
  const log = [];
  for (const e of list) {
    e.priceCheckedAt = today;
    const who = e.artist.split(/[\s（(]/)[0];
    let items;
    try { items = await bingNews(who + ' ' + VSHORT[e.venue] + ' 票價', g); } catch (err) { log.push('✘ 新聞搜尋失敗 ' + e.id + '：' + err.message); continue; }
    for (const it of items.slice(0, 6)) {
      if (!/^https:\/\//.test(it.url)) continue;
      let html; try { html = await g(it.url); } catch (err) { continue; }
      const r = extractPrice(html, e);
      if (!r || !r.confident) continue;
      const manual = e.price && !e.autoPrice;
      if (!manual) {
        e.price = r.price; if (r.prices) e.prices = r.prices; else delete e.prices;
        e.autoPrice = true; e.priceSrc = [it.title.slice(0, 80), it.url.slice(0, 300)];
      }
      if (r.platform && !e.platform) e.platform = r.platform;
      if (r.ticketUrl && !e.ticketUrl) e.ticketUrl = r.ticketUrl;
      log.push('✔ ' + e.id + ' ' + e.artist + '：' + (manual ? '（保留人工票價）' : r.price) + (r.platform ? '｜' + r.platform : '') + (r.ticketUrl ? '｜售票頁' : '') + '｜' + it.title.slice(0, 30));
      break;
    }
  }
  return log;
}

/* ---------- 住宿：每週用 OpenStreetMap 找各場館附近的旅館 ---------- */
export const VENUE_GEO = {
  '台北大巨蛋': { at: [25.0437, 121.5606], name: '大巨蛋', r: 1200 },
  '台北小巨蛋': { at: [25.0515, 121.5497], name: '小巨蛋', r: 1000 },
  '台北流行音樂中心': { at: [25.0522, 121.6003], name: '流行音樂中心', r: 1500 },
  '高雄巨蛋': { at: [22.6694, 120.3025], name: '巨蛋', r: 1200 },
  '高雄國家體育場': { at: [22.7020, 120.2955], name: '國家體育場|世運', r: 2500 }
};
const HFILE = new URL('../hotels.json', import.meta.url);
const distM = (a, b) => { const R = 6371000, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(x))); };
const HTYPE = { hotel: '飯店', hostel: '青年旅館', guest_house: '民宿', motel: '汽車旅館', apartment: '公寓式住宿' };
export async function updateHotels(today, force) {
  let old = { updated: '', venues: {} };
  try { old = JSON.parse(await readFile(HFILE, 'utf8')); } catch (e) { }
  if (!force && old.updated && daysBetween(old.updated, today) < 7) { console.log('住宿資料 ' + old.updated + ' 更新過，本次略過'); return false; }
  let changed = false;
  for (const [v, cfg] of Object.entries(VENUE_GEO)) {
    try {
      let at = (old.venues[v] && old.venues[v].at) || null;
      if (!at) {
        const j = await overpass('[out:json][timeout:60];nwr["name"~"' + cfg.name + '"]["building"!~"^(apartments|residential|house)$"](around:1500,' + cfg.at.join(',') + ');out center 5;');
        const el = (j.elements || []).map(e => [e.lat || (e.center && e.center.lat), e.lon || (e.center && e.center.lon)]).filter(x => x[0]).sort((x, y) => distM(x, cfg.at) - distM(y, cfg.at))[0];
        at = el ? [+el[0].toFixed(5), +el[1].toFixed(5)] : cfg.at;
      }
      const j = await overpass('[out:json][timeout:90];nwr["tourism"~"^(hotel|hostel|guest_house|motel|apartment)$"]["name"](around:' + cfg.r + ',' + at.join(',') + ');out center tags;');
      const seen = new Set();
      const list = (j.elements || []).map(e => {
        const t = e.tags || {}, p = [e.lat || (e.center && e.center.lat), e.lon || (e.center && e.center.lon)];
        if (!p[0] || !t.name) return null;
        return { n: t.name.slice(0, 60), en: (t['name:en'] || '').slice(0, 60), t: HTYPE[t.tourism] || '住宿', s: /^[1-5]$/.test(t.stars || '') ? +t.stars : 0, d: distM(at, p), p: [+p[0].toFixed(5), +p[1].toFixed(5)] };
      }).filter(Boolean).filter(h => !seen.has(h.n) && seen.add(h.n)).sort((a, b) => a.d - b.d).slice(0, 20);
      if (list.length >= 3) { old.venues[v] = { at, list }; changed = true; console.log('✔ 住宿 ' + v + '：' + list.length + ' 間，最近 ' + list[0].n + '（' + list[0].d + ' 公尺）'); }
      else console.log('✘ 住宿 ' + v + '：只找到 ' + list.length + ' 間，沿用舊資料');
    } catch (e) { console.log('✘ 住宿 ' + v + ' 抓取失敗，沿用舊資料：' + e.message); }
  }
  if (changed) { old.updated = today; old.source = 'OpenStreetMap（© OpenStreetMap contributors，ODbL）'; await writeFile(HFILE, JSON.stringify(old, null, 1) + '\n'); }
  return changed;
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
  try { const pl = await enrichPrices(data, g, today); console.log('票價擷取：' + (pl.length ? '\n   ' + pl.join('\n   ') : '這次沒有可更新的場次')); } catch (e) { console.log('✘ 票價擷取失敗：' + e.message); }
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
  await updateHotels(todayTW(), process.argv.includes('--hotels'));
}
