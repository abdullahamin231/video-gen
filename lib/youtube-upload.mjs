import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile, writeFile, mkdir, stat, chmod} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {cacheDir} from './media.mjs';

const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const CHUNK_SIZE = 8 * 1024 * 1024; // Google resumable uploads require chunks in 256 KiB multiples.

function authPaths(root) {
  const dir = path.join(cacheDir(), 'youtube-oauth');
  return {dir, credentials: path.join(dir, 'credentials.json'), token: path.join(dir, 'token.json')};
}

async function loadClient(root) {
  const p = authPaths(root);
  let parsed;
  try { parsed = JSON.parse(await readFile(p.credentials, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`OAuth credentials not found. Save Google's Desktop app JSON to ${path.relative(root, p.credentials)}.`);
    throw new Error(`Could not read OAuth credentials JSON: ${error.message}`);
  }
  const client = parsed.installed;
  if (!client?.client_id || !client?.client_secret)
    throw new Error('Expected a Google Desktop app credentials file with an installed client.');
  return {p, client};
}

async function writePrivate(file, data) {
  await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  await chmod(path.dirname(file), 0o700).catch(() => {});
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, {mode: 0o600});
  await chmod(file, 0o600).catch(() => {});
}

function codeFromBrowser(server, callbackPath, expectedState) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      server.close();
      error ? reject(error) : resolve(code);
    };
    const timeout = setTimeout(() => finish(new Error('Google sign-in timed out. Run youtube-auth again.')), 5 * 60_000);
    server.on('request', (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== callbackPath) { res.writeHead(404).end('Not found'); return; }
      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400, {'content-type': 'text/plain; charset=utf-8'}).end('Google authorization was not completed. You may close this tab.');
        finish(new Error(`Google authorization failed: ${error}`));
        return;
      }
      const actualState = url.searchParams.get('state') || '';
      const a = Buffer.from(actualState), b = Buffer.from(expectedState);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        res.writeHead(400, {'content-type': 'text/plain; charset=utf-8'}).end('Authorization state did not match.');
        finish(new Error('OAuth state check failed. Run youtube-auth again.'));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400, {'content-type': 'text/plain; charset=utf-8'}).end('Google did not return an authorization code.');
        finish(new Error('Google did not return an authorization code.'));
        return;
      }
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}).end('<!doctype html><title>Authorized</title><p>Authorization complete. You may close this tab.</p>');
      finish(null, code);
    });
  });
}

async function tokenRequest(body) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google token request failed (${response.status}): ${data.error_description || data.error || 'unknown error'}`);
  return data;
}

export async function youtubeAuth(root) {
  const {p, client} = await loadClient(root);
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${address.port}/`;
  const state = randomBytes(24).toString('hex');
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state
  }).toString();

  console.log('Open this URL, sign in with the Google account that owns the abdupdates YouTube channel, and approve video uploads:');
  console.log(authUrl.href);
  console.log(`Local callback: 127.0.0.1:${address.port}. For server auth from a laptop, forward this port over Tailscale SSH.`);
  console.log('Waiting up to 5 minutes for the local sign-in callback…');
  const code = await codeFromBrowser(server, '/', state);
  const result = await tokenRequest({
    code,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });
  if (!result.refresh_token) throw new Error('Google did not issue a refresh token. Revoke this app in your Google Account permissions, then run youtube-auth again.');
  await writePrivate(p.token, {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    token_type: result.token_type,
    scope: result.scope,
    expiry_date: Date.now() + Number(result.expires_in || 3600) * 1000
  });
  console.log(`Authorization saved privately to ${path.relative(root, p.token)}.`);
}

async function accessToken(root) {
  const {p, client} = await loadClient(root);
  let token;
  try { token = JSON.parse(await readFile(p.token, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Not authorized yet. Run: npm run video -- youtube-auth');
    throw new Error(`Could not read saved OAuth token: ${error.message}`);
  }
  if (token.access_token && Number(token.expiry_date) > Date.now() + 60_000) return token.access_token;
  if (!token.refresh_token) throw new Error('No refresh token is saved. Run: npm run video -- youtube-auth');
  const refreshed = await tokenRequest({
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token'
  });
  token.access_token = refreshed.access_token;
  token.token_type = refreshed.token_type || token.token_type;
  token.expiry_date = Date.now() + Number(refreshed.expires_in || 3600) * 1000;
  await writePrivate(p.token, token);
  return token.access_token;
}

async function apiError(response) {
  const data = await response.json().catch(() => ({}));
  const message = data.error?.message || data.error_description || `HTTP ${response.status}`;
  if (data.error?.errors?.some(item => item.reason === 'invalidCredentials'))
    return new Error(`${message}. Reauthorize with npm run video -- youtube-auth.`);
  return new Error(`YouTube upload failed (${response.status}): ${message}`);
}

function mimeFor(file) {
  return ({'.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/x-m4v', '.avi': 'video/x-msvideo', '.mpeg': 'video/mpeg', '.mpg': 'video/mpeg'}[path.extname(file).toLowerCase()] || 'application/octet-stream');
}

async function initiateUpload(token, size, mime, metadata) {
  const url = new URL('https://www.googleapis.com/upload/youtube/v3/videos');
  url.search = new URLSearchParams({uploadType: 'resumable', part: 'snippet,status'}).toString();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(size),
      'x-upload-content-type': mime
    },
    body: JSON.stringify(metadata)
  });
  if (!response.ok) throw await apiError(response);
  const location = response.headers.get('location');
  if (!location) throw new Error('YouTube did not return a resumable upload URL.');
  return location;
}

async function uploadChunk(url, token, file, start, end, size) {
  const body = createReadStream(file, {start, end});
  let response;
  try {
    response = await fetch(url, {
      method: 'PUT',
      redirect: 'manual',
      duplex: 'half',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': mimeFor(file),
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${size}`
      },
      body
    });
  } catch (error) {
    body.destroy();
    throw error;
  }
  if (response.status === 308) {
    const range = response.headers.get('range');
    const match = range && /bytes=0-(\d+)/i.exec(range);
    return {next: match ? Number(match[1]) + 1 : start};
  }
  if (response.ok) return {result: await response.json()};
  throw await apiError(response);
}

export async function youtubeUpload(root, opts) {
  if (!opts.file || !opts.title?.trim()) throw new Error('youtube-upload requires --file <video.mp4> and --title "Video title".');
  const file = path.resolve(root, opts.file);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size <= 0) throw new Error(`Video file is missing or empty: ${opts.file}`);
  const privacy = opts.privacy || 'unlisted';
  if (!['private', 'unlisted', 'public'].includes(privacy)) throw new Error('--privacy must be private, unlisted, or public.');
  const tags = (opts.tag || []).flatMap(value => String(value).split(',')).map(value => value.trim()).filter(Boolean);
  const metadata = {
    snippet: {
      title: opts.title.trim(),
      description: opts.description || '',
      categoryId: opts.category || '28',
      ...(tags.length ? {tags} : {})
    },
    status: {privacyStatus: privacy}
  };
  const token = await accessToken(root);
  const location = await initiateUpload(token, info.size, mimeFor(file), metadata);
  console.log(`Uploading ${path.relative(root, file)} (${(info.size / 1024 / 1024).toFixed(1)} MiB) as ${privacy}…`);
  let offset = 0, video = null;
  while (offset < info.size) {
    const end = Math.min(offset + CHUNK_SIZE, info.size) - 1;
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const chunk = await uploadChunk(location, token, file, offset, end, info.size);
        if (chunk.result) { video = chunk.result; offset = info.size; break; }
        if (chunk.next <= offset && end >= offset) {
          // A server that reports no accepted range may need the same chunk retried.
          if (attempt < 4) { await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); continue; }
          throw new Error('YouTube did not accept the upload chunk.');
        }
        offset = chunk.next;
        const pct = Math.min(100, Math.floor(offset / info.size * 100));
        console.log(`  ${pct}%`);
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    if (!video && lastError && offset >= info.size) throw lastError;
  }
  const id = video?.id;
  if (!id) throw new Error('Upload finished without a YouTube video ID.');
  console.log(`Uploaded ${video.snippet?.title || metadata.snippet.title}: https://youtu.be/${id} (${video.status?.privacyStatus || privacy})`);
}
