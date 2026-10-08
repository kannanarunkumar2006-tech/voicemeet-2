import crypto from 'crypto';
const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ', D = '23456789';
const pick = (s, n) => Array.from({ length: n }, () => s[crypto.randomInt(s.length)]).join('');
export const MAX = Number(process.env.MAX_PARTICIPANTS || 8);
export const ID_RE = /^[A-Z]{3}-\d{3}-[A-Z]{3}$/;
// In-memory store. Swap this Map for Redis/DB calls to scale horizontally.
export const rooms = new Map();
export function createRoom() {
  let id;
  do id = `${pick(L, 3)}-${pick(D, 3)}-${pick(L, 3)}`; while (rooms.has(id));
  const r = { meetingId: id, hostToken: crypto.randomBytes(16).toString('hex'), hostId: null,
    participants: new Map(), createdAt: Date.now(), emptySince: Date.now(), active: true };
  rooms.set(id, r);
  return r;
}
export const cleanName = (n) => typeof n === 'string' ? n.replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24) : '';
export const publicList = (r) => [...r.participants.values()].map(({ id, name, muted }) => ({ id, name, muted, isHost: id === r.hostId }));
setInterval(() => {
  for (const [id, r] of rooms) if (!r.participants.size && Date.now() - r.emptySince > 15 * 60e3) rooms.delete(id);
}, 60e3).unref();
