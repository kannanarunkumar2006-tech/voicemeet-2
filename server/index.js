import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { rooms, createRoom, cleanName, publicList, ID_RE, MAX } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : false }, maxHttpBufferSize: 1e5 });
app.disable('x-powered-by');

// ICE config. TURN comes from env vars; browsers need the credential to use TURN, so prefer short-lived credentials.
app.get('/api/ice', (_q, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) iceServers.push({ urls: process.env.TURN_URL.split(',').map((s) => s.trim()), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  res.set('Cache-Control', 'no-store').json({ iceServers });
});
app.get('/healthz', (_q, r) => r.send('ok'));
const dist = path.join(__dirname, '../client/dist');
app.use(express.static(dist));
app.get('*', (_q, r) => r.sendFile(path.join(dist, 'index.html')));

const err = (s, code, message) => s.emit('error', { code, message });

io.on('connection', (socket) => {
  let roomId = null;
  const room = () => rooms.get(roomId);
  const on = (ev, fn) => socket.on(ev, (p) => { try { fn(p && typeof p === 'object' ? p : {}); } catch (e) { console.error(e); err(socket, 'server', 'Something went wrong.'); } });

  function leave() {
    const r = room();
    if (!r) return;
    r.participants.delete(socket.id);
    socket.leave(roomId);
    io.to(roomId).emit('participant-left', { participantId: socket.id });
    if (r.hostId === socket.id) r.hostId = null;
    if (!r.participants.size) r.emptySince = Date.now();
    roomId = null;
  }

  on('create-room', ({ name }) => {
    if (!cleanName(name)) return err(socket, 'invalid-name', 'Please enter a valid name.');
    const r = createRoom();
    socket.emit('room-created', { roomId: r.meetingId, hostToken: r.hostToken });
  });

  on('join-room', ({ roomId: id, name, hostToken, muted }) => {
    id = typeof id === 'string' ? id.trim().toUpperCase() : '';
    if (!ID_RE.test(id)) return err(socket, 'invalid-room', 'That meeting ID is not valid.');
    const r = rooms.get(id);
    if (!r) return err(socket, 'room-not-found', 'Meeting not found. Check the code and try again.');
    if (!r.active) return err(socket, 'room-ended', 'This meeting has ended.');
    name = cleanName(name);
    if (!name) return err(socket, 'invalid-name', 'Please enter a valid name.');
    if (roomId) leave();
    if (r.participants.size >= MAX) return err(socket, 'room-full', 'This meeting is full.');
    const p = { id: socket.id, name, muted: !!muted };
    r.participants.set(p.id, p);
    roomId = id;
    socket.join(id);
    if (typeof hostToken === 'string' && hostToken === r.hostToken) r.hostId = p.id; // host validated server-side
    socket.emit('room-joined', { roomId: id, selfId: p.id, hostId: r.hostId, participants: publicList(r) });
    socket.to(id).emit('participant-joined', { id: p.id, name, muted: p.muted, isHost: p.id === r.hostId });
  });

  // Signaling relay only. No media ever touches the server.
  for (const [ev, key] of [['offer', 'offer'], ['answer', 'answer'], ['ice-candidate', 'candidate']]) {
    on(ev, (p) => {
      const r = room();
      if (!r || typeof p.target !== 'string' || !r.participants.has(p.target) || !p[key]) return;
      io.to(p.target).emit(ev, { from: socket.id, [key]: p[key] });
    });
  }
  const broadcast = (ev, build) => on(ev, (p) => {
    const me = room()?.participants.get(socket.id);
    if (me) socket.to(roomId).emit(ev, { participantId: socket.id, ...build(p, me) });
  });
  broadcast('mute-status', (p, me) => ({ muted: (me.muted = !!p.muted) }));
  broadcast('participant-state', (p) => ({ state: String(p.state || '').slice(0, 20) }));
  broadcast('connection-status', (p) => ({ status: String(p.status || '').slice(0, 20) }));

  on('leave-room', leave);
  on('end-room', () => {
    const r = room();
    if (!r) return;
    if (r.hostId !== socket.id) return err(socket, 'forbidden', 'Only the host can end the meeting.');
    r.active = false;
    io.to(roomId).emit('room-ended');
    io.in(roomId).socketsLeave(roomId);
    r.participants.clear();
    r.emptySince = Date.now();
    roomId = null;
  });
  socket.on('disconnect', leave);
});

server.listen(process.env.PORT || 3000, () => console.log(`VoiceMeet on :${process.env.PORT || 3000}`));
