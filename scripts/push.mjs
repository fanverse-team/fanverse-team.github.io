// FANVERSE 手機推播（GitHub Actions 在更新資料後執行）
// 1. 追蹤的藝人出現新場次 → 通知
// 2. 收藏的活動在接下來 13 小時內開賣 → 提醒
// 需要 GitHub Secrets 裡的 FCM_SA（Firebase 服務帳戶金鑰 JSON）；沒有設定就跳過。金鑰只在 GitHub 的執行環境使用。
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { createSign } from 'node:crypto';

const ROOT = new URL('../', import.meta.url);
const SITE = 'https://fanverse-team.github.io/';
const b64 = x => Buffer.from(x).toString('base64url');
export async function googleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000 }));
  const sig = createSign('RSA-SHA256').update(head + '.' + body).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + body + '.' + sig }) });
  if (!r.ok) throw new Error('取得授權失敗 HTTP ' + r.status);
  return (await r.json()).access_token;
}
const vals = f => ((f && f.arrayValue && f.arrayValue.values) || []).map(v => v.stringValue).filter(Boolean);
export async function subscribers(project, tok) {
  const out = []; let page = '';
  for (let i = 0; i < 20; i++) {
    const r = await fetch('https://firestore.googleapis.com/v1/projects/' + project + '/databases/(default)/documents/push?pageSize=300' + (page ? '&pageToken=' + page : ''), { headers: { Authorization: 'Bearer ' + tok } });
    if (!r.ok) throw new Error('讀取訂閱失敗 HTTP ' + r.status);
    const j = await r.json();
    for (const d of j.documents || []) { const f = d.fields || {}; if (f.token && f.token.stringValue) out.push({ name: d.name, token: f.token.stringValue, artists: vals(f.artists), cids: vals(f.cids) }); }
    if (!j.nextPageToken) break; page = j.nextPageToken;
  }
  return out;
}
const readNow = async f => { try { return JSON.parse(await readFile(new URL(f, ROOT), 'utf8')).events || []; } catch { return []; } };
const readOld = f => { try { return JSON.parse(execSync('git show HEAD:' + f, { cwd: new URL('.', ROOT).pathname, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64e6 }).toString()).events || []; } catch { return null; } };
// 「11/22（日）12:00」這類開賣時間 → 毫秒
export function saleAt(text, now = Date.now()) {
  const m = String(text || '').match(/(\d{1,2})\/(\d{1,2})[^0-9]{0,6}?(\d{1,2}):(\d{2})/); if (!m) return null;
  const tw = new Date(now + 8 * 3600e3), y = tw.getUTCFullYear(), mo = +m[1], yr = mo < tw.getUTCMonth() + 1 ? y + 1 : y;
  const t = Date.parse(yr + '-' + String(mo).padStart(2, '0') + '-' + String(+m[2]).padStart(2, '0') + 'T' + String(+m[3]).padStart(2, '0') + ':' + m[4] + ':00+08:00');
  return Number.isFinite(t) ? t : null;
}
export function plan(subs, oldEv, newEv, now = Date.now()) {
  const oldIds = oldEv ? new Set(oldEv.map(e => e.id)) : null;
  const fresh = oldIds ? newEv.filter(e => !oldIds.has(e.id)) : [];
  const out = [];
  for (const s of subs) {
    const msgs = [];
    for (const e of fresh) if (e.artist && s.artists.includes(e.artist)) msgs.push({ title: '🎉 ' + e.artist + ' 公布新場次', body: (e.title || '') + '・' + e.venue, url: SITE + '#c/' + e.id, tag: 'new-' + e.id });
    for (const e of newEv) {
      if (!s.cids.includes(e.id)) continue;
      const t = saleAt(e.sale, now); if (t && t > now && t <= now + 13 * 3600e3) msgs.push({ title: '⏰ ' + (e.artist || e.title) + ' 快開賣了', body: e.sale + (e.platform ? '｜' + e.platform : '') + '，記得先登入售票網站', url: SITE + '#c/' + e.id, tag: 'sale-' + e.id });
    }
    for (const m of msgs.slice(0, 3)) out.push(Object.assign({ token: s.token, name: s.name }, m));
  }
  return out;
}
async function main() {
  const raw = process.env.FCM_SA; if (!raw) return console.log('沒有設定 FCM_SA，跳過推播');
  let sa; try { sa = JSON.parse(raw); } catch { return console.log('✘ FCM_SA 不是正確的 JSON'); }
  const project = sa.project_id || 'fanverse-team';
  const tok = await googleToken(sa);
  const subs = await subscribers(project, tok);
  const oldEv = [].concat(readOld('concerts.json') || [], readOld('arts.json') || []);
  const newEv = [].concat(await readNow('concerts.json'), await readNow('arts.json'));
  const msgs = plan(subs, oldEv.length ? oldEv : null, newEv);
  const { ok, gone } = await sendAll(project, tok, msgs);
  console.log('✔ 推播：' + subs.length + ' 位訂閱、送出 ' + ok + ' 則' + (gone ? '、清掉 ' + gone + ' 個失效裝置' : ''));
}
export async function sendAll(project, tok, msgs) {
  let ok = 0, gone = 0;
  for (const m of msgs.slice(0, 500)) {
    const r = await fetch('https://fcm.googleapis.com/v1/projects/' + project + '/messages:send', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { token: m.token, data: { url: m.url, tag: m.tag }, webpush: { notification: { title: m.title, body: m.body, icon: SITE + 'icon-192.png' }, fcm_options: { link: m.url } } } }) });
    if (r.ok) ok++;
    else if (r.status === 404 || r.status === 400) { gone++; await fetch('https://firestore.googleapis.com/v1/' + m.name, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } }).catch(() => { }); }
  }
  return { ok, gone };
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main().catch(e => console.log('✘ 推播失敗：' + e.message));
