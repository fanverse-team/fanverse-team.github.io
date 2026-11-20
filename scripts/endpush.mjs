// FANVERSE 散場通知（GitHub Actions 每 15 分鐘執行一次）
// 收藏或在周邊交換刊登了某一場的人，在預估散場時間收到「去看看這場的周邊交換」推播。
// 預估散場：開演時間 + 3 小時（舞台劇等表演 + 2 小時）；沒有開演時間就當 19:00。
// 同一場同一天只送一次：送過的記在 Firestore 的 pushlog（只有服務帳戶能讀寫）。
import { readFile } from 'node:fs/promises';
import { googleToken, subscribers, sendAll } from './push.mjs';

const ROOT = new URL('../', import.meta.url);
const SITE = 'https://fanverse-team.github.io/';
const read = async f => { try { return JSON.parse(await readFile(new URL(f, ROOT), 'utf8')).events || []; } catch { return []; } };
const twDay = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
// 回傳預估散場時間落在 (now - 45 分, now] 的場次
export function ending(events, now = Date.now()) {
  const out = [], days = new Set([twDay(now), twDay(now - 6 * 3600e3)]);
  for (const e of events) {
    if (!e || !e.id || !Array.isArray(e.d) || e.k === 'expo') continue;
    for (const [day, time] of e.d) {
      if (!days.has(day)) continue;
      const t = /^\d\d:\d\d$/.test(time || '') ? time : '19:00';
      const end = Date.parse(day + 'T' + t + ':00+08:00') + (e.k === 'show' ? 2 : 3) * 3600e3;
      if (end <= now && end > now - 45 * 60e3) out.push({ e, day });
    }
  }
  return out;
}
async function logged(project, tok, id) {
  const r = await fetch('https://firestore.googleapis.com/v1/projects/' + project + '/databases/(default)/documents/pushlog?documentId=' + id, {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { at: { timestampValue: new Date().toISOString() } } })
  });
  return r.status === 409; // 已經送過
}
async function main() {
  const raw = process.env.FCM_SA; if (!raw) return console.log('沒有設定 FCM_SA，跳過');
  const list = ending([].concat(await read('concerts.json'), await read('arts.json')));
  if (!list.length) return console.log('目前沒有剛散場的場次');
  let sa; try { sa = JSON.parse(raw); } catch { return console.log('✘ FCM_SA 不是正確的 JSON'); }
  const project = sa.project_id || 'fanverse-team', tok = await googleToken(sa);
  const subs = await subscribers(project, tok), msgs = [];
  for (const { e, day } of list) {
    const who = subs.filter(s => s.cids.includes(e.id)); if (!who.length) continue;
    if (await logged(project, tok, 'end_' + e.id + '_' + day)) continue;
    const name = e.artist || e.title;
    for (const s of who) msgs.push({ token: s.token, name: s.name, title: '🎤 ' + name + ' 散場了', body: '看看這場的周邊交換，現場就能換', url: SITE + '#t/' + e.id, tag: 'end-' + e.id + '-' + day });
  }
  const { ok } = await sendAll(project, tok, msgs);
  console.log('✔ 散場通知：' + list.length + ' 場、送出 ' + ok + ' 則');
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main().catch(e => console.log('✘ 散場通知失敗：' + e.message));
