# VoiceMeet — real-time WebRTC group voice meetings

React + Vite client, Node/Express + Socket.IO signaling server. Audio travels **only** over WebRTC (peer-to-peer mesh); Socket.IO carries signaling and room state.

## Setup
```bash
npm install
cp .env.example .env
npm run dev        # server :3000 + Vite :5173
```
Production (one app, one domain):
```bash
npm run build && npm start     # Express serves client/dist and the Socket.IO server on :3000
```
`render.yaml` is included for one-click Render deploys (HTTPS provided).

## Mobile testing (important: HTTPS)
Browsers allow microphone access only on HTTPS (or `localhost`). Opening `http://192.168.x.x:5173` on a phone will **not** work. Either deploy (Render, Railway, Fly) or tunnel:
```bash
npm run build && npm start
cloudflared tunnel --url http://localhost:3000     # or: ngrok http 3000
```
Open the printed `https://…` URL on Phone A → Create Meeting → Join → Allow mic. Send the link to Phone B/C, enter a name, join. Use headphones when phones are in the same room.

## How WebRTC works here
Every pair of participants has its own `RTCPeerConnection` (full mesh; fine for ~8 people, set `MAX_PARTICIPANTS`). A new joiner receives the current participant list and sends an **offer** to each existing participant; they reply with an **answer**; both sides trade **ICE candidates**. Remote streams play in dynamically created `<audio autoplay playsinline>` elements. Failed/disconnected links trigger an ICE restart by the original offerer; Socket.IO reconnects rejoin the room and rebuild peers.

## Socket.IO events
| Client → Server | Payload |
|---|---|
| `create-room` | `{ name }` → `room-created {roomId, hostToken}` |
| `join-room` | `{ roomId, name, hostToken?, muted }` → `room-joined {roomId, selfId, hostId, participants[]}` |
| `offer` / `answer` | `{ target, offer }` / `{ target, answer }` → relayed with `from` |
| `ice-candidate` | `{ target, candidate }` |
| `mute-status` | `{ muted }` → broadcast `{ participantId, muted }` |
| `participant-state`, `connection-status` | broadcast `{ participantId, state/status }` |
| `leave-room`, `end-room` | host-only end, validated on the server via `hostId` |

Server → Client: `room-created`, `room-joined`, `participant-joined`, `participant-left`, `offer`, `answer`, `ice-candidate`, `mute-status`, `participant-state`, `connection-status`, `room-ended`, `error {code,message}`.
The host is whoever joins with the secret `hostToken` issued at creation (kept in that tab's `sessionStorage`).

## STUN / TURN
STUN (Google, default) works on many networks. **TURN is strongly recommended in production**: users behind symmetric NAT, corporate firewalls or some mobile carriers cannot connect peer-to-peer. Set `TURN_URL` (comma-separate multiple, e.g. `turn:host:3478,turns:host:443`), `TURN_USERNAME`, `TURN_CREDENTIAL` in the environment; the server adds them to `/api/ice`. Works with coturn, Metered, Twilio, Cloudflare. Browsers must receive TURN credentials to use them, so prefer short-lived provider credentials.

## Troubleshooting
- **Mic prompt never appears / "HTTPS required"** → use HTTPS or a tunnel.
- **Connected but no sound** → tap "Tap to enable audio" (autoplay policy); check phone volume; configure TURN.
- **Stuck on "Connecting…"** → restrictive network; add TURN.
- **Echo** → use headphones.
- **State lost on server restart** → rooms are in memory; swap `server/rooms.js` for Redis to persist/scale.

## Layout
`server/` (Express, Socket.IO handlers, `rooms.js` store/validation) · `client/src/App.jsx` (pages, room UI) · `client/src/meeting.js` (WebRTC + signaling client) · `client/src/styles.css`.
