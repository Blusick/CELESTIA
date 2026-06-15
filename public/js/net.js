// ── WebSocket + REST client ─────────────────────────────────
export const net = {
  ws: null, ready: false, handlers: {}, cfg: null,
};

export function on(type, fn) { (net.handlers[type] ||= []).push(fn); }
function emit(type, msg) { (net.handlers[type] || []).forEach(fn => fn(msg)); }

export function connectWS(wsUrl) {
  const url = wsUrl || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  net.ws = new WebSocket(url);
  net.ws.onopen = () => { net.ready = true; emit('open'); };
  net.ws.onclose = () => { net.ready = false; emit('close'); setTimeout(() => connectWS(wsUrl), 1500); };
  net.ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } emit(m.type, m); };
}

export function send(obj) { if (net.ready) net.ws.send(JSON.stringify(obj)); }

export async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}
