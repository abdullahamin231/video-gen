// Password access for when the workspace listens beyond loopback (a server reached from a phone or laptop).
// The session cookie is an HMAC of the password, so it survives restarts and changing the password signs out every device.
import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'vw_session';
const MAX_AGE = 60 * 60 * 24 * 30;
const WINDOW = 15 * 60 * 1000, MAX_FAILURES = 5;

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const escape = text => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export const isLoopback = host => /^(127\.\d+\.\d+\.\d+|localhost|::1|\[::1\])$/.test(host);

export function createAccess(password) {
  if (!password) return null;
  if (password.length < 12) throw new Error('VG_UI_PASSWORD must be at least 12 characters');
  const token = createHmac('sha256', password).update('video-workspace-session-v1').digest('hex');
  const failures = new Map();
  const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=')).filter(([k, v]) => k && v));
  const secure = req => req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  const client = req => req.socket.remoteAddress || '';
  const locked = ip => { const entry = failures.get(ip); if (!entry || Date.now() - entry.first > WINDOW) { failures.delete(ip); return false; } return entry.count >= MAX_FAILURES; };
  const setCookie = (req, value, age) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure(req) ? '; Secure' : ''}`;

  return {
    authenticated: req => same(cookies(req)[COOKIE] || '', token),
    page(res, message = '', status = 200) {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#151515"><title>Video workspace</title>
<style>:root{color-scheme:dark}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#151515;color:#e7e7e7;font:15px system-ui,sans-serif}form{display:grid;gap:14px;width:min(340px,calc(100vw - 32px))}h1{margin:0 0 6px;font-size:22px}input,button{font:inherit;font-size:16px;border-radius:8px;padding:13px 14px}input{background:#161616;color:#e7e7e7;border:1px solid #393939}button{border:0;background:#c4f58b;color:#141613;font-weight:600;cursor:pointer}p{margin:0;color:#e9a0a0}</style></head>
<body><form method="post" action="/login"><h1>Video workspace</h1>${message ? `<p role="alert">${escape(message)}</p>` : ''}<input type="password" name="password" placeholder="Password" autocomplete="current-password" required><button type="submit">Sign in</button></form></body></html>`);
    },
    async login(req, res) {
      const ip = client(req);
      if (locked(ip)) return this.page(res, 'Too many attempts. Try again in 15 minutes.', 429);
      // Count the attempt before any waiting, so parallel guesses cannot all slip in under the limit.
      if (failures.size > 10000) failures.clear();
      const entry = failures.get(ip) || { count: 0, first: Date.now() }; entry.count++; failures.set(ip, entry);
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4096) return this.page(res, 'Request too large', 413); }
      const given = new URLSearchParams(body).get('password') || '';
      if (!same(createHmac('sha256', given).update('video-workspace-session-v1').digest('hex'), token)) {
        await new Promise(resolve => setTimeout(resolve, 800));
        return this.page(res, 'Wrong password', 401);
      }
      failures.delete(ip);
      res.writeHead(303, { Location: '/', 'Set-Cookie': setCookie(req, token, MAX_AGE), 'Cache-Control': 'no-store' }); res.end();
    },
    logout(req, res) { res.writeHead(303, { Location: '/login', 'Set-Cookie': setCookie(req, '', 0) }); res.end(); },
  };
}
