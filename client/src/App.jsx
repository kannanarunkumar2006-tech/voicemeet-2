import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { SERVER, supported, getMic, meter, createMeeting } from './meeting.js';

const P = {
  mic: 'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v4',
  micoff: 'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v4M2 2l20 20',
  speaker: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  share: 'M4 12v8h16v-8M16 6l-4-4-4 4M12 2v13',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  end: 'M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
};
const Icon = ({ n, s = 22 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[n]} /></svg>
);
const useMode = () => {
  const [m, s] = useState(localStorage.getItem('vm-mode') || 'headphone');
  return [m, (v) => { localStorage.setItem('vm-mode', v); s(v); }];
};
const WARN = 'Using speakers on multiple phones in the same room may cause echo. Use headphones for the best experience.';
const Mode = ({ mode, set }) => (
  <div className="seg">
    <div className="row">{['headphone', 'speaker'].map((k) => (
      <button key={k} className={'btn' + (mode === k ? ' pri' : '')} onClick={() => set(k)}>{k === 'speaker' ? 'Speaker Mode' : 'Headphone Mode'}</button>
    ))}</div>
    <p className="hint">{mode === 'speaker' ? WARN : 'Headphones recommended for the best audio experience.'}</p>
  </div>
);

function ShareBar({ id }) {
  const [msg, setMsg] = useState('');
  const link = `${location.origin}/meeting/${id}`;
  const toast = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2000); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast('Meeting link copied.'); } catch { window.prompt('Copy this meeting link', link); }
  };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'VoiceMeet', text: 'Join my VoiceMeet meeting', url: link }); } catch {} } else copy();
  };
  return (<>
    <p className="link">{link}</p>
    <div className="row"><button className="btn" onClick={copy}><Icon n="copy" />Copy Link</button><button className="btn" onClick={share}><Icon n="share" />Share</button></div>
    {msg && <div className="toast">{msg}</div>}
  </>);
}

function Home({ go, notice }) {
  return (
    <main className="wrap center">
      <div className="logo"><Icon n="mic" s={30} /></div>
      <h1>VoiceMeet</h1>
      <p className="sub">Real-time voice meetings, anywhere.</p>
      {!supported() && <div className="note">Your browser doesn't support WebRTC voice. Please use a recent Chrome, Firefox or Safari.</div>}
      {notice && <div className="note">{notice}</div>}
      <div className="row"><button className="btn pri" onClick={() => go('/create')}>Create Meeting</button><button className="btn" onClick={() => go('/join')}>Join Meeting</button></div>
      <div className="grid">{['Real-time WebRTC Audio', 'Private Meeting Rooms', 'Mobile Friendly', 'Secure Signaling'].map((t) => <div className="card" key={t}>{t}</div>)}</div>
    </main>
  );
}

function Create({ go }) {
  const [name, setName] = useState(localStorage.getItem('vm-name') || '');
  const [id, setId] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const create = () => {
    setBusy(true); setErr('');
    const s = io(SERVER || undefined, { transports: ['websocket', 'polling'] });
    const fail = (m) => { setErr(m); setBusy(false); s.disconnect(); };
    s.on('connect', () => s.emit('create-room', { name }));
    s.once('room-created', (d) => { sessionStorage.setItem('vm-host-' + d.roomId, d.hostToken); localStorage.setItem('vm-name', name.trim()); setId(d.roomId); setBusy(false); s.disconnect(); });
    s.once('error', (e) => fail(e.message));
    s.once('connect_error', () => fail('Cannot reach the server.'));
  };
  return (
    <main className="wrap">
      <h2>Create Voice Meeting</h2>
      {!id ? (<>
        <input value={name} maxLength={24} placeholder="Your name" onChange={(e) => setName(e.target.value)} />
        {err && <div className="note">{err}</div>}
        <button className="btn pri" disabled={busy || !name.trim()} onClick={create}>{busy ? 'Creating...' : 'Create Meeting'}</button>
      </>) : (<div className="card col">
        <span className="hint">Meeting ID</span><div className="code">{id}</div>
        <ShareBar id={id} />
        <button className="btn pri" onClick={() => go('/meeting/' + id)}>Join Meeting</button>
      </div>)}
      <button className="btn ghost" onClick={() => go('/')}>Back</button>
    </main>
  );
}

function JoinPage({ go }) {
  const [name, setName] = useState(localStorage.getItem('vm-name') || '');
  const [code, setCode] = useState(''); const [err, setErr] = useState('');
  const submit = () => {
    const c = code.trim().toUpperCase();
    if (!name.trim()) return setErr('Please enter your name.');
    if (!/^[A-Z]{3}-\d{3}-[A-Z]{3}$/.test(c)) return setErr('Enter a valid meeting code like ABC-123-XYZ.');
    localStorage.setItem('vm-name', name.trim()); go('/meeting/' + c);
  };
  return (
    <main className="wrap">
      <h2>Join Voice Meeting</h2>
      <input value={name} maxLength={24} placeholder="Your name" onChange={(e) => setName(e.target.value)} />
      <input value={code} placeholder="Meeting code (ABC-123-XYZ)" autoCapitalize="characters" onChange={(e) => setCode(e.target.value)} />
      {err && <div className="note">{err}</div>}
      <button className="btn pri" onClick={submit}>Join Meeting</button>
      <button className="btn ghost" onClick={() => go('/')}>Back</button>
    </main>
  );
}

function Prejoin({ id, go, onJoin }) {
  const [name, setName] = useState(localStorage.getItem('vm-name') || '');
  const [mode, setMode] = useMode();
  const [stream, setStream] = useState(null); const [err, setErr] = useState(''); const [talk, setTalk] = useState(false);
  const sref = useRef(null); const joined = useRef(false);
  useEffect(() => { sref.current = stream; return stream ? meter(stream, setTalk) : undefined; }, [stream]);
  useEffect(() => () => { if (!joined.current) sref.current?.getTracks().forEach((t) => t.stop()); }, []);
  const enable = async () => { setErr(''); try { setStream(await getMic()); } catch (e) { setErr(e.message); } };
  const join = async () => {
    if (!name.trim()) return setErr('Please enter your name.');
    let s = stream;
    if (!s) { try { s = await getMic(); } catch (e) { return setErr(e.message); } }
    localStorage.setItem('vm-name', name.trim()); joined.current = true;
    onJoin({ id, name: name.trim(), stream: s });
  };
  return (
    <main className="wrap">
      <h2>Ready to join?</h2><div className="code">{id}</div>
      <input value={name} maxLength={24} placeholder="Display name" onChange={(e) => setName(e.target.value)} />
      <div className="card col">
        <b>Microphone: {stream ? 'Allowed' : 'Not enabled yet'}</b>
        {stream ? <span className={'mini' + (talk ? ' live' : '')}><Icon n="mic" s={14} />{talk ? 'Speaking (mic test OK)' : 'Say something to test your mic'}</span>
          : <button className="btn" onClick={enable}>Allow microphone access</button>}
        {!stream && <span className="hint">Microphone permission is required to join the voice meeting.</span>}
      </div>
      <Mode mode={mode} set={setMode} />
      <p className="warn">{WARN}</p>
      {err && <div className="note">{err}</div>}
      <button className="btn pri" onClick={join}>Join Meeting</button>
      <button className="btn ghost" onClick={() => go('/')}>Back</button>
    </main>
  );
}

const Ctl = ({ i, l, f, on, bad }) => (
  <button className={'ctl' + (on ? ' on' : '') + (bad ? ' bad' : '')} onClick={f}><Icon n={i} /><span>{l}</span></button>
);

function Room({ s, onExit }) {
  const [people, setPeople] = useState([]); const [self, setSelf] = useState(null); const [muted, setMuted] = useState(false);
  const [talk, setTalk] = useState({}); const [peerSt, setPeerSt] = useState({}); const [sock, setSock] = useState(true);
  const [blocked, setBlocked] = useState(false); const [panel, setPanel] = useState(''); const [err, setErr] = useState('');
  const [mode, setMode] = useMode(); const mt = useRef(null);

  useEffect(() => {
    const stopLocal = meter(s.stream, (v) => setTalk((t) => ({ ...t, self: v })));
    const exit = (m) => { mt.current?.leave(); onExit(m); };
    const m = createMeeting({
      joined: (d) => { setSelf(d.selfId); setPeople(d.participants); },
      added: (p) => setPeople((l) => (l.some((x) => x.id === p.id) ? l : [...l, p])),
      removed: (id) => setPeople((l) => l.filter((x) => x.id !== id)),
      muteChanged: (id, mu) => setPeople((l) => l.map((x) => (x.id === id ? { ...x, muted: mu } : x))),
      speaking: (id, v) => setTalk((t) => ({ ...t, [id]: v })),
      peerStates: setPeerSt, socketState: setSock, autoplayBlocked: () => setBlocked(true),
      ended: () => exit('Meeting ended by the host.'),
      error: (e) => (['room-not-found', 'room-ended', 'invalid-room', 'room-full'].includes(e.code) ? exit(e.message) : setErr(e.message)),
    });
    mt.current = m;
    m.join({ roomId: s.id, name: s.name, hostToken: sessionStorage.getItem('vm-host-' + s.id), stream: s.stream });
    const bye = () => m.leave();
    addEventListener('pagehide', bye); addEventListener('beforeunload', bye);
    return () => { removeEventListener('pagehide', bye); removeEventListener('beforeunload', bye); m.leave(); stopLocal(); };
  }, []);

  const toggle = () => {
    const n = !muted; mt.current.mute(n); setMuted(n);
    setPeople((l) => l.map((x) => (x.id === self ? { ...x, muted: n } : x)));
  };
  const vals = Object.values(peerSt);
  const status = !sock || vals.includes('disconnected') ? 'Reconnecting...' : vals.includes('failed') ? 'Connection Failed'
    : vals.includes('connecting') ? 'Connecting...' : 'Connected';
  const isHost = people.find((p) => p.id === self)?.isHost;
  const leave = () => { mt.current?.leave(); onExit(''); };

  return (
    <div className="room">
      <header>
        <b>VoiceMeet</b><span className="pill">{s.id}</span>
        <span className="pill">{people.length} participant{people.length === 1 ? '' : 's'}</span>
        <span className={'pill ' + (status === 'Connected' ? 'ok' : status === 'Connection Failed' ? 'bad' : 'warnp')}>{status}</span>
      </header>
      {err && <div className="note m">{err}</div>}
      {blocked && <button className="btn pri m" onClick={() => { mt.current.resumeAudio(); setBlocked(false); }}>Tap to enable audio</button>}
      <main className="people">
        {people.map((p) => {
          const me = p.id === self; const sp = talk[me ? 'self' : p.id] && !p.muted;
          return (
            <div key={p.id} className={'pcard' + (sp ? ' sp' : '')}>
              <div className="av">{(p.name[0] || '?').toUpperCase()}</div>
              <b>{p.name}{me ? ' (You)' : ''}</b>
              <span className={'mini' + (sp ? ' live' : '')}><Icon n={p.muted ? 'micoff' : 'mic'} s={14} />{p.muted ? 'Muted' : sp ? 'Speaking' : 'Listening'}</span>
              {p.isHost && <span className="tag">Host</span>}
            </div>
          );
        })}
      </main>
      {panel && (
        <div className="sheet">
          <button className="btn ghost" onClick={() => setPanel('')}>Close</button>
          {panel === 'people' && <><h3>Participants</h3>{people.map((p) => (
            <div className="li" key={p.id}><span>{p.name}{p.id === self ? ' (You)' : ''}{p.isHost ? ' · Host' : ''}</span><span className="mini"><Icon n={p.muted ? 'micoff' : 'mic'} s={14} />{p.muted ? 'Muted' : talk[p.id === self ? 'self' : p.id] ? 'Speaking' : 'Listening'}</span></div>
          ))}</>}
          {panel === 'audio' && <><h3>Audio output</h3><Mode mode={mode} set={setMode} /></>}
          {panel === 'share' && <><h3>Share meeting</h3><div className="code">{s.id}</div><ShareBar id={s.id} /></>}
        </div>
      )}
      <nav className="bar">
        <Ctl i={muted ? 'micoff' : 'mic'} l={muted ? 'Unmute' : 'Mute'} on={muted} f={toggle} />
        <Ctl i="speaker" l="Speaker" f={() => setPanel('audio')} />
        <Ctl i="users" l="People" f={() => setPanel('people')} />
        <Ctl i="share" l="Share" f={() => setPanel('share')} />
        <Ctl i="out" l="Leave" bad f={leave} />
        {isHost && <Ctl i="end" l="End" bad f={() => confirm('End the meeting for everyone?') && mt.current.end()} />}
      </nav>
    </div>
  );
}

export default function App() {
  const [path, setPath] = useState(location.pathname); const [session, setSession] = useState(null); const [notice, setNotice] = useState('');
  useEffect(() => { const f = () => setPath(location.pathname); addEventListener('popstate', f); return () => removeEventListener('popstate', f); }, []);
  const go = (p) => { history.pushState({}, '', p); setPath(p); window.scrollTo(0, 0); };
  const m = path.match(/^\/meeting\/([A-Za-z0-9-]+)\/?$/);
  const id = m?.[1].toUpperCase();
  const exit = (msg) => { setSession(null); setNotice(msg); go('/'); };
  return (
    <div className="app">
      {m ? (session?.id === id ? <Room s={session} onExit={exit} /> : <Prejoin id={id} go={go} onJoin={setSession} />)
        : path === '/create' ? <Create go={go} /> : path === '/join' ? <JoinPage go={go} /> : <Home go={go} notice={notice} />}
    </div>
  );
}
