import { io } from 'socket.io-client';
export const SERVER = import.meta.env.VITE_SERVER_URL || '';
const STUN = { urls: 'stun:stun.l.google.com:19302' };
const AC = () => window.AudioContext || window.webkitAudioContext;

export const supported = () => !!(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection && AC());

export async function getMic() {
  if (!window.isSecureContext) throw new Error('HTTPS is required for microphone access (localhost is exempt during development).');
  if (!supported()) throw new Error('This browser does not support voice meetings. Please use a recent Chrome, Firefox or Safari.');
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  } catch (e) {
    const denied = 'Microphone access was denied. Please enable microphone permission in your browser settings.';
    const m = { NotAllowedError: denied, PermissionDeniedError: denied,
      NotFoundError: 'No microphone was found on this device.', NotReadableError: 'Microphone is unavailable. Another app may be using it.' };
    throw new Error(m[e.name] || 'Microphone is unavailable.');
  }
}

// Real voice-activity detection from the audio stream (RMS level via AnalyserNode).
export function meter(stream, cb) {
  const ctx = new (AC())(); const an = ctx.createAnalyser(); an.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize); let on = false, raf, last = 0;
  const tick = () => {
    an.getByteTimeDomainData(buf);
    let s = 0; for (const v of buf) { const x = (v - 128) / 128; s += x * x; }
    const now = performance.now();
    if (Math.sqrt(s / buf.length) > 0.02) last = now;
    const v = now - last < 300;
    if (v !== on) { on = v; cb(v); }
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => { cancelAnimationFrame(raf); ctx.close().catch(() => {}); };
}

export function createMeeting(h) {
  const socket = io(SERVER || undefined, { transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
  const peers = {}, audios = {}, stops = {}, states = {};
  let local = null, args = null, ice = { iceServers: [STUN] }, done = false;
  const push = () => h.peerStates({ ...states });
  const emitJoin = () => socket.emit('join-room', { ...args, muted: !local.getAudioTracks()[0]?.enabled });

  function closePeer(id) {
    peers[id]?.close(); delete peers[id];
    audios[id]?.remove(); delete audios[id];
    stops[id]?.(); delete stops[id];
    if (id in states) { delete states[id]; push(); }
    h.speaking(id, false);
  }
  async function sendOffer(id, opts) {
    const pc = peers[id]; if (!pc) return;
    await pc.setLocalDescription(await pc.createOffer(opts));
    socket.emit('offer', { target: id, offer: pc.localDescription });
  }
  function peer(id, offerer) {
    if (peers[id]) return peers[id];
    const pc = new RTCPeerConnection(ice); pc.q = []; pc.offerer = offerer; peers[id] = pc;
    local.getTracks().forEach((t) => pc.addTrack(t, local));
    pc.onicecandidate = (e) => e.candidate && socket.emit('ice-candidate', { target: id, candidate: e.candidate });
    pc.ontrack = (e) => {
      const s = e.streams[0];
      let a = audios[id];
      if (!a) { a = document.createElement('audio'); a.autoplay = true; a.playsInline = true; document.body.appendChild(a); audios[id] = a; }
      a.srcObject = s;
      a.play().catch(() => h.autoplayBlocked());
      stops[id]?.(); stops[id] = meter(s, (v) => h.speaking(id, v));
    };
    const upd = () => {
      if (peers[id] !== pc || pc.connectionState === 'closed') return;
      const c = pc.connectionState, i = pc.iceConnectionState;
      const st = c === 'failed' || i === 'failed' ? 'failed' : c === 'disconnected' || i === 'disconnected' ? 'disconnected'
        : c === 'connected' || i === 'connected' || i === 'completed' ? 'connected' : 'connecting';
      states[id] = st; push();
      const restart = () => { if (pc.offerer && peers[id] === pc) { pc.restartIce?.(); sendOffer(id, { iceRestart: true }).catch(() => {}); } };
      if (st === 'failed') restart();
      if (st === 'disconnected') setTimeout(() => states[id] === 'disconnected' && restart(), 4000);
    };
    pc.onconnectionstatechange = upd; pc.oniceconnectionstatechange = upd;
    states[id] = 'connecting'; push();
    return pc;
  }
  const flush = async (pc) => { for (const c of pc.q.splice(0)) await pc.addIceCandidate(c).catch(() => {}); };

  socket.on('room-joined', async (d) => {
    h.joined(d);
    for (const p of d.participants) if (p.id !== d.selfId) { peer(p.id, true); await sendOffer(p.id).catch(console.error); }
  });
  socket.on('participant-joined', h.added);
  socket.on('participant-left', ({ participantId }) => { closePeer(participantId); h.removed(participantId); });
  socket.on('offer', async ({ from, offer }) => {
    try {
      const pc = peer(from, false);
      await pc.setRemoteDescription(offer); await flush(pc);
      await pc.setLocalDescription(await pc.createAnswer());
      socket.emit('answer', { target: from, answer: pc.localDescription });
    } catch (e) { console.error(e); }
  });
  socket.on('answer', async ({ from, answer }) => {
    const pc = peers[from]; if (!pc) return;
    try { await pc.setRemoteDescription(answer); await flush(pc); } catch (e) { console.error(e); }
  });
  socket.on('ice-candidate', async ({ from, candidate }) => {
    const pc = peers[from]; if (!pc) return;
    if (pc.remoteDescription) await pc.addIceCandidate(candidate).catch(() => {}); else pc.q.push(candidate);
  });
  socket.on('mute-status', ({ participantId, muted }) => h.muteChanged(participantId, muted));
  socket.on('room-ended', () => h.ended());
  socket.on('error', (e) => h.error(e));
  socket.on('disconnect', () => h.socketState(false));
  socket.on('connect_error', () => h.socketState(false));
  socket.on('connect', () => {
    h.socketState(true);
    if (args && !done) { Object.keys(peers).forEach(closePeer); emitJoin(); } // restore state after reconnect
  });

  return {
    async join(a) {
      ice = await fetch(SERVER + '/api/ice').then((r) => r.json()).catch(() => ice);
      local = a.stream; args = { roomId: a.roomId, name: a.name, hostToken: a.hostToken };
      if (socket.connected) emitJoin();
    },
    mute(m) {
      const t = local?.getAudioTracks()[0]; if (t) t.enabled = !m;
      socket.emit('mute-status', { participantId: socket.id, muted: m });
    },
    end() { socket.emit('end-room'); },
    resumeAudio() { Object.values(audios).forEach((a) => a.play().catch(() => {})); },
    leave() {
      if (done) return; done = true;
      socket.emit('leave-room');
      Object.keys(peers).forEach(closePeer);
      local?.getTracks().forEach((t) => t.stop());
      socket.disconnect();
    },
  };
}
