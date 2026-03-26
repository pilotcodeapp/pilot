const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || require('os').homedir();

// Use node-pty if available, fall back to child_process.spawn (for MAS sandbox)
let pty = null;
try { pty = require('node-pty'); } catch (e) {
  console.log('node-pty not available — using child_process.spawn fallback');
}

const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Remote authentication ──
const AUTH_CONFIG_PATH = path.join(process.env.HOME || require('os').homedir(), '.pilot', 'auth.json');

function loadAuth() {
  try { return JSON.parse(fs.readFileSync(AUTH_CONFIG_PATH, 'utf-8')); }
  catch { return null; }
}

function saveAuth(config) {
  const dir = path.dirname(AUTH_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(AUTH_CONFIG_PATH, JSON.stringify(config, null, 2));
  fs.chmodSync(AUTH_CONFIG_PATH, 0o600);
}

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, stored) {
  const { hash } = hashPassword(password, stored.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(stored.hash, 'hex'));
}

// Active sessions: Map<sessionToken, { createdAt, ip }>
const authSessions = new Map();

function createAuthSession(ip) {
  const token = crypto.randomBytes(32).toString('hex');
  authSessions.set(token, { createdAt: Date.now(), ip });
  return token;
}

function isLocalRequest(req) {
  // Cloudflare tunnel sets CF-Connecting-IP — if present, request came from the tunnel (remote)
  if (req.headers['cf-connecting-ip'] || req.headers['cf-ipcountry']) return false;
  const ip = req.ip || req.connection?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const [key, ...rest] = c.trim().split('=');
    if (key) cookies[key] = rest.join('=');
  });
  return cookies;
}

// Auth endpoints (before middleware so they're always accessible)
app.post('/auth/login', (req, res) => {
  const { password } = req.body;
  const auth = loadAuth();
  if (!auth?.hash) return res.status(400).json({ error: 'No password configured' });
  if (!verifyPassword(password, auth)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  const token = createAuthSession(req.ip);
  res.cookie('pilot_session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
  res.json({ ok: true });
});

app.get('/auth/status', (req, res) => {
  const auth = loadAuth();
  if (!auth?.hash) return res.json({ status: 'no_password', local: isLocalRequest(req) });
  if (isLocalRequest(req)) return res.json({ status: 'authenticated', local: true });
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.pilot_session;
  if (token && authSessions.has(token)) return res.json({ status: 'authenticated', local: false });
  return res.json({ status: 'login_required', local: false });
});

app.post('/auth/set-password', (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  // Only allow from local or if already authenticated
  if (!isLocalRequest(req)) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.pilot_session;
    if (!token || !authSessions.has(token)) {
      return res.status(403).json({ error: 'Cannot set password remotely without authentication' });
    }
  }
  const { hash, salt } = hashPassword(password);
  saveAuth({ hash, salt, createdAt: new Date().toISOString() });
  res.json({ ok: true });
});

app.post('/auth/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.pilot_session;
  if (token) authSessions.delete(token);
  res.clearCookie('pilot_session');
  res.json({ ok: true });
});

// ── Self-service registration ──
const ADMIN_CONFIG_PATH = path.join(process.env.HOME || require('os').homedir(), '.pilot', 'admin.json');

function loadAdminConfig() {
  try { return JSON.parse(fs.readFileSync(ADMIN_CONFIG_PATH, 'utf-8')); }
  catch { return null; }
}

function cfAPI(method, endpoint, apiToken, body) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.cloudflare.com/client/v4${endpoint}`);
    const options = {
      method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ success: false, errors: [{ message: data }] }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Rate limiting: track registrations by IP
const registerAttempts = new Map();
const REGISTER_RATE_LIMIT = 3; // max per hour per IP
const REGISTER_RATE_WINDOW = 60 * 60 * 1000; // 1 hour

app.post('/api/register', async (req, res) => {
  const admin = loadAdminConfig();
  if (!admin?.apiToken || !admin?.accountId || !admin?.zoneId || !admin?.domain) {
    return res.status(503).json({ error: 'Registration is not configured on this server.' });
  }

  // Rate limit
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const attempts = registerAttempts.get(clientIp) || [];
  const recentAttempts = attempts.filter(t => now - t < REGISTER_RATE_WINDOW);
  if (recentAttempts.length >= REGISTER_RATE_LIMIT) {
    return res.status(429).json({ error: 'Too many registrations. Try again later.' });
  }
  recentAttempts.push(now);
  registerAttempts.set(clientIp, recentAttempts);

  const { username } = req.body;
  if (!username || !/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-32 characters, lowercase letters, numbers, and hyphens only.' });
  }

  const { apiToken, accountId, zoneId, domain } = admin;
  const tunnelName = `pilot-${username}`;
  const subdomain = `${username}.${domain}`;

  try {
    // Check if tunnel already exists
    const existing = await cfAPI('GET', `/accounts/${accountId}/tunnels?name=${tunnelName}&is_deleted=false`, apiToken);
    if (existing.result?.length > 0) {
      return res.status(409).json({ error: `Username "${username}" is already taken.` });
    }

    // Create tunnel with random secret
    const secret = crypto.randomBytes(32).toString('base64');
    const createResult = await cfAPI('POST', `/accounts/${accountId}/tunnels`, apiToken, {
      name: tunnelName,
      tunnel_secret: secret,
    });

    if (!createResult.success || !createResult.result?.id) {
      const msg = createResult.errors?.[0]?.message || 'Failed to create tunnel';
      return res.status(500).json({ error: msg });
    }

    const tunnelId = createResult.result.id;

    // Configure ingress (remote config for token-based tunnels)
    await cfAPI('PUT', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, apiToken, {
      config: {
        ingress: [
          { hostname: subdomain, service: 'http://localhost:3001' },
          { service: 'http_status:404' },
        ],
      },
    });

    // Create DNS CNAME record
    const existingDns = await cfAPI('GET', `/zones/${zoneId}/dns_records?type=CNAME&name=${subdomain}`, apiToken);
    if (existingDns.result?.length > 0) {
      await cfAPI('PUT', `/zones/${zoneId}/dns_records/${existingDns.result[0].id}`, apiToken, {
        type: 'CNAME', name: subdomain, content: `${tunnelId}.cfargotunnel.com`, proxied: true,
      });
    } else {
      await cfAPI('POST', `/zones/${zoneId}/dns_records`, apiToken, {
        type: 'CNAME', name: subdomain, content: `${tunnelId}.cfargotunnel.com`, proxied: true,
      });
    }

    // Generate token (same format as cloudflared)
    const tokenData = JSON.stringify({ a: accountId, t: tunnelId, s: secret });
    const token = Buffer.from(tokenData).toString('base64');

    res.json({
      ok: true,
      username,
      url: `https://${subdomain}`,
      token,
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// Serve registration page
app.get('/register', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// ── Admin panel API (local-only) ──
app.get('/api/admin/users', async (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Admin panel is local-only' });
  const admin = loadAdminConfig();
  if (!admin?.apiToken || !admin?.accountId) return res.json({ users: [], error: 'Admin not configured' });

  try {
    const { apiToken, accountId, domain } = admin;
    const tunnels = await cfAPI('GET', `/accounts/${accountId}/tunnels?is_deleted=false`, apiToken);
    const users = (tunnels.result || [])
      .filter(t => t.name.startsWith('pilot-'))
      .map(t => ({
        username: t.name.replace('pilot-', ''),
        tunnelId: t.id,
        subdomain: `${t.name.replace('pilot-', '')}.${domain}`,
        url: `https://${t.name.replace('pilot-', '')}.${domain}`,
        createdAt: t.created_at,
        active: !!(t.connections && t.connections.length > 0),
        connections: (t.connections || []).length,
      }));
    res.json({ users, domain });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users', details: err.message });
  }
});

app.delete('/api/admin/users/:username', async (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Admin panel is local-only' });
  const admin = loadAdminConfig();
  if (!admin?.apiToken) return res.status(503).json({ error: 'Admin not configured' });

  const { username } = req.params;
  const { apiToken, accountId, zoneId, domain } = admin;
  const tunnelName = `pilot-${username}`;
  const subdomain = `${username}.${domain}`;

  try {
    // Find and delete tunnel
    const tunnels = await cfAPI('GET', `/accounts/${accountId}/tunnels?name=${tunnelName}&is_deleted=false`, apiToken);
    const tunnel = tunnels.result?.[0];
    if (tunnel) {
      await cfAPI('DELETE', `/accounts/${accountId}/tunnels/${tunnel.id}?cascade=true`, apiToken);
    }

    // Remove DNS record
    const dns = await cfAPI('GET', `/zones/${zoneId}/dns_records?type=CNAME&name=${subdomain}`, apiToken);
    if (dns.result?.[0]) {
      await cfAPI('DELETE', `/zones/${zoneId}/dns_records/${dns.result[0].id}`, apiToken);
    }

    res.json({ ok: true, username });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove user', details: err.message });
  }
});

// Serve admin page
app.get('/admin', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).send('Admin panel is local-only');
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// ── Accounts (central user registry) ──
const ACCOUNTS_DIR = path.join(HOME, '.pilot', 'accounts');
if (!fs.existsSync(ACCOUNTS_DIR)) fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });

app.post('/api/accounts/register', (req, res) => {
  const { email, name, installId } = req.body;
  if (!email || !name || !installId) return res.status(400).json({ error: 'Email, name, and installId required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });

  const accountFile = path.join(ACCOUNTS_DIR, `${installId}.json`);

  // Check if email already registered under a different install
  try {
    const files = fs.readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const existing = JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, f), 'utf-8'));
      if (existing.email === email && existing.installId !== installId) {
        // Same email, different install — update the install ID
        fs.unlinkSync(path.join(ACCOUNTS_DIR, f));
        break;
      }
    }
  } catch {}

  const account = {
    installId,
    email,
    name,
    plan: 'free',
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    remoteConfigured: false,
  };
  fs.writeFileSync(accountFile, JSON.stringify(account, null, 2));
  res.json({ ok: true, plan: 'free' });
});

app.post('/api/accounts/heartbeat', (req, res) => {
  const { installId, version, remoteConfigured } = req.body;
  if (!installId) return res.status(400).json({ error: 'installId required' });

  const accountFile = path.join(ACCOUNTS_DIR, `${installId}.json`);
  try {
    const account = JSON.parse(fs.readFileSync(accountFile, 'utf-8'));
    account.lastSeen = new Date().toISOString();
    if (version) account.version = version;
    if (remoteConfigured !== undefined) account.remoteConfigured = remoteConfigured;
    fs.writeFileSync(accountFile, JSON.stringify(account, null, 2));
    res.json({ ok: true, plan: account.plan });
  } catch {
    res.status(404).json({ error: 'Account not found' });
  }
});

// Admin: list all accounts
app.get('/api/admin/accounts', (req, res) => {
  if (!isLocalRequest(req)) return res.status(403).json({ error: 'Admin panel is local-only' });
  try {
    const files = fs.readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith('.json'));
    const accounts = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, f), 'utf-8')); }
      catch { return null; }
    }).filter(Boolean);
    accounts.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));
    res.json(accounts);
  } catch { res.json([]); }
});

// Auth middleware — protect all routes for remote access
app.use((req, res, next) => {
  // Local requests always pass
  if (isLocalRequest(req)) return next();
  // Auth, registration, accounts, and health endpoints are public
  if (req.path.startsWith('/auth/')) return next();
  if (req.path === '/register' || req.path.startsWith('/api/register')) return next();
  if (req.path.startsWith('/api/accounts/')) return next();
  // Health check is public (for setup screen)
  if (req.path === '/health') return next();
  // No password set — allow access (first-time setup)
  const auth = loadAuth();
  if (!auth?.hash) return next();
  // Check session cookie
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.pilot_session;
  if (token && authSessions.has(token)) return next();
  // Unauthenticated remote request — serve the app (frontend handles login screen)
  // but block API access
  if (req.path.startsWith('/sessions') || req.path.startsWith('/tunnel') ||
      req.path.startsWith('/open') || req.path.startsWith('/filetree') ||
      req.path.startsWith('/projects') || req.path.startsWith('/config') ||
      req.path.startsWith('/network-info') || req.path.startsWith('/dev-server') ||
      req.path.startsWith('/push') || req.path.startsWith('/setup') ||
      req.path.startsWith('/preview')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  // Let static files through so login screen can render
  next();
});

// Serve built frontend (registered after API routes set up below)
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const CLAUDE_PATH = process.env.CLAUDE_PATH || path.join(HOME, '.local', 'bin', 'claude');
const CLAUDE_ENV = {
  ...process.env,
  PATH: `${path.join(HOME, '.local', 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
  TERM: 'xterm-256color'
};

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
}

const os = require('os');

function getLanIP() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

const UPLOAD_DIR = path.join(os.tmpdir(), 'pilot-uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Dev server management ──────────────────────────────────────────
let devServer = null; // { proc, projectDir, port, status, command }

function broadcastDevServer(extra = {}) {
  const msg = JSON.stringify({
    type: 'dev_server',
    status: devServer ? devServer.status : 'stopped',
    port: devServer?.port || null,
    url: devServer?.port ? `http://localhost:${devServer.port}` : null,
    projectDir: devServer?.projectDir || null,
    command: devServer?.command || null,
    ...extra
  });
  wss.clients.forEach(ws => { try { ws.send(msg); } catch {} });
}

function detectDevCommand(projectDir) {
  // Check for package.json with dev script
  // Skip scripts that launch Electron — those are desktop apps, not dev servers,
  // and would spawn a competing instance of Pilot fighting over the same port
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8'));
    if (pkg.scripts?.dev && !pkg.scripts.dev.includes('electron')) return { cmd: 'npm', args: ['run', 'dev'], label: `npm run dev` };
    if (pkg.scripts?.start && !pkg.scripts.start.includes('electron')) return { cmd: 'npm', args: ['run', 'start'], label: `npm run start` };
  } catch {}
  // Check subdirectories (monorepo — e.g. ~/pilot/frontend has the dev script)
  try {
    const subs = fs.readdirSync(projectDir, { withFileTypes: true });
    for (const sub of subs) {
      if (!sub.isDirectory() || sub.name.startsWith('.') || sub.name === 'node_modules') continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, sub.name, 'package.json'), 'utf-8'));
        if (pkg.scripts?.dev) return { cmd: 'npm', args: ['run', 'dev'], label: `npm run dev`, subdir: sub.name };
        if (pkg.scripts?.start) return { cmd: 'npm', args: ['run', 'start'], label: `npm run start`, subdir: sub.name };
      } catch {}
    }
  } catch {}
  // Python (manage.py runserver, flask, uvicorn, etc.)
  if (fs.existsSync(path.join(projectDir, 'manage.py'))) {
    return { cmd: 'python', args: ['manage.py', 'runserver'], label: 'python manage.py runserver' };
  }
  return null;
}

function startDevServer(projectDir) {
  if (devServer?.proc) stopDevServer();

  const detected = detectDevCommand(projectDir);
  if (!detected) return { error: 'No dev server detected' };

  const cwd = detected.subdir ? path.join(projectDir, detected.subdir) : projectDir;
  const proc = spawn(detected.cmd, detected.args, {
    cwd,
    env: { ...CLAUDE_ENV, BROWSER: 'none', PORT: undefined }, // BROWSER=none prevents auto-open
    shell: true,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  devServer = {
    proc,
    projectDir,
    port: null,
    status: 'starting',
    command: detected.label + (detected.subdir ? ` (${detected.subdir}/)` : ''),
    output: ''
  };
  broadcastDevServer();

  const PORT_RE = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/;

  function handleOutput(chunk) {
    const text = chunk.toString();
    devServer.output += text;
    // Try to detect port from output
    if (!devServer.port) {
      const match = text.match(PORT_RE);
      if (match) {
        devServer.port = parseInt(match[1]);
        devServer.status = 'running';
        console.log(`Dev server ready on port ${devServer.port}`);
        broadcastDevServer();
      }
    }
  }

  proc.stdout.on('data', handleOutput);
  proc.stderr.on('data', handleOutput);

  proc.on('exit', (code) => {
    console.log(`Dev server exited with code ${code}`);
    const wasRunning = devServer?.status === 'running';
    devServer = null;
    broadcastDevServer(wasRunning ? { error: `Dev server exited (code ${code})` } : {});
  });

  proc.on('error', (err) => {
    console.error('Dev server spawn error:', err);
    devServer = null;
    broadcastDevServer({ error: err.message });
  });

  // Timeout: if no port detected in 30s, mark as running anyway (some servers are slow)
  setTimeout(() => {
    if (devServer && devServer.status === 'starting') {
      devServer.status = 'running';
      broadcastDevServer({ warning: 'Port not auto-detected — enter URL manually' });
    }
  }, 30000);

  return { ok: true, command: devServer.command };
}

function stopDevServer() {
  if (!devServer?.proc) return;
  try {
    // Kill the process group to catch child processes (e.g. Vite spawns sub-processes)
    process.kill(-devServer.proc.pid, 'SIGTERM');
  } catch {
    try { devServer.proc.kill('SIGTERM'); } catch {}
  }
  devServer = null;
  broadcastDevServer();
}

wss.on('connection', (ws, req) => {
  // Auth check for remote WebSocket connections
  const wsIp = req.socket.remoteAddress || '';
  const wsTunneled = !!(req.headers['cf-connecting-ip'] || req.headers['cf-ipcountry']);
  const wsLocal = !wsTunneled && (wsIp === '127.0.0.1' || wsIp === '::1' || wsIp === '::ffff:127.0.0.1');
  if (!wsLocal) {
    const auth = loadAuth();
    if (auth?.hash) {
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies.pilot_session;
      if (!token || !authSessions.has(token)) {
        ws.close(4001, 'Authentication required');
        return;
      }
    }
  }

  console.log('Pilot frontend connected');
  let claudeProcess = null;
  let lineBuffer = '';
  let pendingFilePath = null;

  // Message buffer — stores messages while Claude is working so reconnecting clients can catch up
  const messageBuffer = [];
  const MAX_BUFFER = 500;

  function bufferAndSend(msg) {
    const json = typeof msg === 'string' ? msg : JSON.stringify(msg);
    messageBuffer.push(json);
    if (messageBuffer.length > MAX_BUFFER) messageBuffer.shift();
    try { ws.send(json); } catch {}
  }

  function processLine(line) {
    line = line.trim();
    if (!line) return;
    try {
      const parsed = JSON.parse(line);
      console.log('Claude event:', parsed.type);
      bufferAndSend({ type: 'claude_event', event: parsed });
    } catch (e) {
      // not valid JSON
    }
  }

  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch (e) {
      console.error('Bad message:', e);
      return;
    }

    console.log('Received message type:', message.type);

    if (message.type === 'replay') {
      // Client reconnected and wants missed messages since index
      const since = message.since || 0;
      const missed = messageBuffer.slice(since);
      console.log(`Replaying ${missed.length} buffered messages (since ${since})`);
      missed.forEach(msg => { try { ws.send(msg); } catch {} });
      ws.send(JSON.stringify({ type: 'replay_done', bufferSize: messageBuffer.length }));
      return;
    }

    if (message.type === 'upload_file') {
      try {
        const safeName = message.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(UPLOAD_DIR, `${Date.now()}-${safeName}`);
        fs.writeFileSync(filePath, Buffer.from(message.fileData, 'base64'));
        pendingFilePath = filePath;
        console.log('File saved:', filePath);
      } catch (e) {
        console.error('File upload failed:', e);
      }
      return;
    }

    if (message.type === 'send_message') {
      const projectDir = message.projectDir || process.env.HOME;
      console.log('Running claude in:', projectDir);
      console.log('Prompt:', message.prompt);

      if (claudeProcess) {
        claudeProcess.kill();
        claudeProcess = null;
      }

      lineBuffer = '';

      let prompt = message.prompt;
      if (pendingFilePath) {
        prompt = `${message.prompt}\n\nThe attached file has been saved to: ${pendingFilePath}\nPlease read it using that path.`;
        pendingFilePath = null;
      }

      // If frontend sent conversation history (resumed session, no active Claude process),
      // prepend it so Claude has context from prior turns
      if (message.history && message.history.length > 0 && !message.sessionId) {
        const transcript = message.history
          .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n\n');
        prompt = `Here is the conversation history from this session so far:\n\n${transcript}\n\n---\n\nNow continuing the conversation. The user's new message:\n\n${prompt}`;
      }

      const args = [
        '--output-format', 'stream-json',
        '--verbose',
        '--dangerously-skip-permissions',
        '--append-system-prompt', `IMPORTANT: You are running inside Pilot (the app at ~/pilot), NOT in a regular terminal. Pilot is a conversational desktop app built by the user that wraps Claude Code in a chat UI. Key things to know:
- The user is chatting with you through Pilot's web-based chat interface, not a terminal
- They can see rendered markdown, syntax-highlighted code blocks, and an activity log of your tool use
- There is a file tree panel on the right showing the project structure with read/created/edited badges
- There is a live preview panel that auto-renders HTML files and JSX/TSX components (via a sandbox) as you create/edit them
- The preview panel also shows localhost URLs when a dev server is running
- You should reference these UI features naturally (e.g. "you can see the file in your preview panel" or "check the file tree")
- When you create or edit .jsx/.tsx components, they will auto-preview in the sandbox — let the user know
- The user built Pilot and may ask you to work on Pilot itself (~/pilot). The continuity doc is at ~/pilot/pilot_continuity_doc.html`,
        '-p', prompt
      ];

      if (message.sessionId) {
        args.push('--resume', message.sessionId, '--continue');
      }

      try {
        if (pty) {
          // PTY mode — full terminal emulation (default for DMG distribution)
          claudeProcess = pty.spawn(CLAUDE_PATH, args, {
            name: 'xterm-256color',
            cols: 220,
            rows: 50,
            cwd: projectDir,
            env: CLAUDE_ENV
          });
          claudeProcess.onData((data) => {
            const clean = stripAnsi(data);
            lineBuffer += clean;
            const lines = lineBuffer.split('\n');
            lineBuffer = lines.pop();
            lines.forEach(line => processLine(line));
          });
          claudeProcess.onExit(({ exitCode }) => {
            console.log('Claude exited with code:', exitCode);
            if (lineBuffer.trim()) processLine(lineBuffer);
            lineBuffer = '';
            bufferAndSend({ type: 'session_end', code: exitCode });
            claudeProcess = null;
          });
        } else {
          // Pipe mode — child_process.spawn fallback (for MAS sandbox)
          claudeProcess = spawn(CLAUDE_PATH, args, {
            cwd: projectDir,
            env: CLAUDE_ENV,
            stdio: ['pipe', 'pipe', 'pipe']
          });
          claudeProcess.stdout.on('data', (data) => {
            lineBuffer += data.toString();
            const lines = lineBuffer.split('\n');
            lineBuffer = lines.pop();
            lines.forEach(line => processLine(line));
          });
          claudeProcess.stderr.on('data', (data) => {
            console.error('Claude stderr:', data.toString());
          });
          claudeProcess.on('close', (exitCode) => {
            console.log('Claude exited with code:', exitCode);
            if (lineBuffer.trim()) processLine(lineBuffer);
            lineBuffer = '';
            bufferAndSend({ type: 'session_end', code: exitCode });
            claudeProcess = null;
          });
        }
      } catch (err) {
        console.error('Failed to spawn Claude:', err);
        bufferAndSend({ type: 'error', message: `Failed to start Claude Code: ${err.message}` });
        return;
      }
    }

    if (message.type === 'cancel') {
      if (claudeProcess) {
        claudeProcess.kill();
        claudeProcess = null;
      }
      bufferAndSend({ type: 'cancelled' });
    }

    if (message.type === 'dev_server_start') {
      const result = startDevServer(message.projectDir);
      ws.send(JSON.stringify({ type: 'dev_server', ...result, status: devServer?.status || 'stopped' }));
    }

    if (message.type === 'dev_server_stop') {
      stopDevServer();
    }

    if (message.type === 'dev_server_status') {
      broadcastDevServer();
    }
  });

  ws.on('close', () => {
    console.log('Frontend disconnected');
    if (claudeProcess) claudeProcess.kill();
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

app.get('/health', async (req, res) => {
  const checks = { status: 'ok', node: { installed: false, version: null }, claude: { installed: false, authenticated: false, path: null } };

  // Check Node.js (if we're running, Node exists — but report version for the frontend)
  try {
    const { execFileSync } = require('child_process');
    const nodeVersion = execFileSync('node', ['--version'], { timeout: 3000, env: CLAUDE_ENV, encoding: 'utf-8' }).trim();
    checks.node.installed = true;
    checks.node.version = nodeVersion;
    const major = parseInt(nodeVersion.replace('v', ''), 10);
    if (major < 20) {
      checks.node.versionWarning = 'Node.js v20+ is required. You have ' + nodeVersion;
    }
  } catch {
    // We're running in Electron which bundles its own Node, but system node may not be available
    // npm install -g needs system node
    checks.node.installed = false;
  }

  // Check if claude binary exists — try `which` first (respects user's full PATH via shell),
  // then fall back to known locations for cases where shell isn't available (e.g. Electron)
  const { execFileSync, execSync } = require('child_process');

  // Try shell-based lookup first (finds claude regardless of install method: nvm, Homebrew, etc.)
  try {
    const whichResult = execSync('which claude', { timeout: 3000, encoding: 'utf-8', shell: true }).trim();
    if (whichResult && fs.existsSync(whichResult)) {
      checks.claude.installed = true;
      checks.claude.path = whichResult;
    }
  } catch {}

  // Fall back to known paths if `which` didn't find it
  if (!checks.claude.installed) {
    const possiblePaths = [
      process.env.CLAUDE_PATH,
      path.join(HOME, '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      path.join(HOME, '.npm-global', 'bin', 'claude'),
      path.join(HOME, '.nvm', 'versions', 'node'),  // nvm — checked below
    ].filter(Boolean);

    // For nvm, scan the active version's bin directory
    try {
      const nvmDir = path.join(HOME, '.nvm', 'versions', 'node');
      if (fs.existsSync(nvmDir)) {
        const versions = fs.readdirSync(nvmDir).sort().reverse();
        for (const v of versions) {
          const p = path.join(nvmDir, v, 'bin', 'claude');
          if (fs.existsSync(p)) { possiblePaths.unshift(p); break; }
        }
      }
    } catch {}

    for (const p of possiblePaths) {
      if (p && fs.existsSync(p)) {
        checks.claude.installed = true;
        checks.claude.path = p;
        break;
      }
    }
  }

  // Check if Claude works by running --version
  if (checks.claude.installed) {
    try {
      const output = execFileSync(checks.claude.path, ['--version'], {
        timeout: 5000, env: CLAUDE_ENV, encoding: 'utf-8'
      });
      checks.claude.version = output.trim();
      checks.claude.authenticated = true;
    } catch (e) {
      // Binary exists but --version failed — could be permissions or broken install
      checks.claude.version = null;
    }
  }

  if (!checks.claude.installed || !checks.claude.authenticated) {
    checks.status = 'setup_required';
  }

  res.json(checks);
});

// Install Claude Code
app.post('/setup/install-claude', async (req, res) => {
  try {
    const { exec } = require('child_process');
    // Use shell: true via exec so nvm/Homebrew/custom PATH are available
    exec('npm install -g @anthropic-ai/claude-code', {
      timeout: 120000,
      shell: true,
    }, (err, stdout, stderr) => {
      if (err) {
        console.error('Claude Code install failed:', stderr || err.message);
        res.json({ success: false, error: stderr || err.message });
      } else {
        console.log('Claude Code installed:', stdout);
        res.json({ success: true });
      }
    });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Dev server detection endpoint
app.get('/dev-server/detect', (req, res) => {
  const dir = req.query.dir;
  if (!dir) return res.json({ available: false });
  const detected = detectDevCommand(dir);
  res.json({
    available: !!detected,
    command: detected?.label || null,
    subdir: detected?.subdir || null,
    running: devServer?.projectDir === dir && devServer?.status !== 'stopped',
    port: devServer?.port || null,
    status: devServer?.projectDir === dir ? devServer?.status : null
  });
});

// Open file in VS Code or URL in browser
app.post('/open', (req, res) => {
  const { type, target } = req.body;
  const { execSync } = require('child_process');
  try {
    if (type === 'vscode') {
      execSync(`code "${target}"`);
    } else if (type === 'browser') {
      execSync(`open "${target}"`);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Proxy endpoint for preview panel — avoids cross-origin iframe issues
app.use('/preview-proxy', (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('Missing url param');

  try {
    const targetUrl = new URL(target);
    // Only allow proxying to local addresses
    const allowedHosts = ['localhost', '127.0.0.1', '0.0.0.0'];
    if (!allowedHosts.includes(targetUrl.hostname)) {
      return res.status(403).send('Only local URLs allowed');
    }

    const subPath = req.url.replace(/^\/?\?.*/, '').replace(/^\/?/, '/');
    const proxyUrl = `${targetUrl.origin}${subPath === '/' ? targetUrl.pathname : subPath}`;

    const httpModule = require('http');
    const proxyReq = httpModule.get(proxyUrl, (proxyRes) => {
      // Remove x-frame-options to allow iframe embedding
      const headers = { ...proxyRes.headers };
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      res.status(502).send(`Cannot connect to ${target}: ${err.message}`);
    });
  } catch (e) {
    res.status(400).send('Invalid URL');
  }
});

function decodeClaudePath(encoded) {
  // Claude encodes /Users/alex/my-project as -Users-alex-my-project
  // We need to figure out which dashes are path separators vs literal hyphens
  const parts = encoded.replace(/^-/, '').split('-');
  function resolve(idx, current) {
    if (idx >= parts.length) {
      try { return fs.statSync(current).isDirectory() ? current : null; }
      catch { return null; }
    }
    // Try as path separator first: current / parts[idx]
    const asDir = path.join(current, parts[idx]);
    const result = resolve(idx + 1, asDir);
    if (result) return result;
    // Try as hyphen: current-parts[idx]  (append to last component)
    if (current !== '/') {
      const asHyphen = current + '-' + parts[idx];
      return resolve(idx + 1, asHyphen);
    }
    return null;
  }
  return resolve(0, '/');
}

// ── Push notification device token registry ──
const pushTokens = new Set();

app.post('/push/register', (req, res) => {
  const { token } = req.body || {};
  if (token) {
    pushTokens.add(token);
    console.log(`Push token registered (${pushTokens.size} devices)`);
  }
  res.json({ ok: true });
});

app.get('/config', (req, res) => {
  res.json({ home: HOME });
});

app.get('/network-info', (req, res) => {
  const lanIp = getLanIP();
  const port = server.address()?.port || PORT;
  res.json({
    lanIp,
    port,
    lanUrl: lanIp ? `http://${lanIp}:${port}` : null,
  });
});

app.get('/projects', (req, res) => {
  const home = process.env.HOME;
  const seen = new Set();
  const projects = [];

  // Source 1: ~/.claude/projects (projects used with Claude Code)
  try {
    const projectsDir = path.join(home, '.claude', 'projects');
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || !e.name.startsWith('-')) continue;
      const dirPath = decodeClaudePath(e.name);
      if (dirPath && dirPath !== home && !seen.has(dirPath)) {
        seen.add(dirPath);
        projects.push({ path: dirPath, name: dirPath.split('/').pop() });
      }
    }
  } catch {}

  // Source 2: scan ~/ and common project directories for project markers
  const markers = ['package.json', '.git', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'Makefile'];
  const scanRoots = [
    home,
    ...[
      'Developer', 'Documents', 'Desktop', 'code', 'repos',
      'projects', 'workspace', 'src', 'Sites', 'Work', 'dev'
    ].map(d => path.join(home, d))
  ];
  for (const scanRoot of scanRoots) {
    let homeDirs;
    try { homeDirs = fs.readdirSync(scanRoot, { withFileTypes: true }); }
    catch { continue; }
    for (const e of homeDirs) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dirPath = path.join(scanRoot, e.name);
      if (seen.has(dirPath)) continue;
      const hasMarker = markers.some(m => {
        try { return fs.existsSync(path.join(dirPath, m)); }
        catch { return false; }
      });
      if (hasMarker) {
        seen.add(dirPath);
        projects.push({ path: dirPath, name: e.name });
      } else {
        // Check one level deeper — catches projects like ~/pilot with subdirectory markers
        try {
          const subDirs = fs.readdirSync(dirPath, { withFileTypes: true });
          const hasSubMarker = subDirs.some(sub =>
            sub.isDirectory() && !sub.name.startsWith('.') &&
            markers.some(m => { try { return fs.existsSync(path.join(dirPath, sub.name, m)); } catch { return false; } })
          );
          if (hasSubMarker) {
            seen.add(dirPath);
            projects.push({ path: dirPath, name: e.name });
          }
        } catch {}
      }
    }
  }

  projects.sort((a, b) => a.name.localeCompare(b.name));
  res.json(projects);
});

// File tree endpoint — returns directory structure for a project
app.get('/filetree', (req, res) => {
  const dir = req.query.dir;
  if (!dir || !fs.existsSync(dir)) return res.json([]);

  const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '.turbo', '__pycache__', '.venv', 'venv', '.DS_Store', 'coverage', '.swc']);
  const DOTFILE_ALLOW = new Set(['.gitignore', '.env', '.env.local', '.env.example', '.env.development', '.env.production', '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.cjs', '.prettierrc', '.prettierrc.js', '.prettierrc.json', '.babelrc', '.editorconfig', '.npmrc', '.nvmrc', '.dockerignore', '.github']);
  const MAX_DEPTH = 6;
  const MAX_FILES = 2000;
  let count = 0;

  function scan(dirPath, depth) {
    if (depth > MAX_DEPTH || count > MAX_FILES) return [];
    let entries;
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
    catch { return []; }

    const result = [];
    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      // Allow whitelisted dotfiles, skip all other dotfiles
      if (entry.name.startsWith('.') && !DOTFILE_ALLOW.has(entry.name)) continue;
      if (count > MAX_FILES) break;
      count++;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        result.push({ name: entry.name, type: 'dir', path: fullPath, children: scan(fullPath, depth + 1) });
      } else {
        result.push({ name: entry.name, type: 'file', path: fullPath });
      }
    }
    return result;
  }

  const tree = scan(dir, 0);
  res.json({ tree, truncated: count > MAX_FILES, fileCount: count });
});

// Serve a local file for preview (renders HTML, images, markdown, etc.)
app.get('/preview-file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }
  // Only allow files under home directory for safety
  const home = process.env.HOME;
  if (!filePath.startsWith(home) && !filePath.startsWith('/tmp')) {
    return res.status(403).send('Access denied');
  }

  const ext = path.extname(filePath).toLowerCase();

  // Render markdown files as styled HTML
  if (ext === '.md' || ext === '.markdown') {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const html = renderMarkdownToHtml(raw, filePath);
      res.type('html').send(html);
    } catch (e) {
      res.status(500).send('Failed to render markdown');
    }
    return;
  }

  res.sendFile(filePath);
});

// Simple markdown to HTML renderer (no external deps)
function renderMarkdownToHtml(md, filePath) {
  let html = md
    // Fenced code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre style="background:#161616;border:1px solid #2a2a2a;border-radius:8px;padding:14px;overflow-x:auto;font-size:13px;line-height:1.5"><code>${escaped}</code></pre>`;
    })
    // Headings
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:#1e1e1e;padding:1px 5px;border-radius:4px;font-size:12px">$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#6ea8fe">$1</a>')
    // Images (relative paths resolved against file location)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      const resolved = src.startsWith('http') ? src : `/preview-file?path=${encodeURIComponent(path.resolve(path.dirname(filePath), src))}`;
      return `<img src="${resolved}" alt="${alt}" style="max-width:100%;border-radius:8px">`;
    })
    // Unordered lists
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #2a2a2a;margin:16px 0">')
    // Paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p>');

  // Wrap consecutive <li> elements in <ul>
  html = html.replace(/(<li>.*?<\/li>\s*)+/g, '<ul style="padding-left:20px;margin:8px 0">$&</ul>');

  const fileName = path.basename(filePath);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${fileName}</title></head>
<body style="margin:0;padding:24px 32px;background:#0f0f0f;color:#e8e8e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.7">
<div style="max-width:720px">
<p>${html}</p>
</div></body></html>`;
}

// Component sandbox preview — renders JSX/TSX in a live sandbox
app.get('/preview-component', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }
  const home = process.env.HOME;
  if (!filePath.startsWith(home) && !filePath.startsWith('/tmp')) {
    return res.status(403).send('Access denied');
  }

  const source = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);

  // Strip import/export statements that Babel standalone can't resolve
  const cleaned = source
    .replace(/^\s*import\s+.*$/gm, '')
    .replace(/^\s*export\s+default\s+function\s+(\w+)/gm, 'function $1')
    .replace(/^\s*export\s+default\s+/gm, 'const __Component__ = ')
    .replace(/^\s*export\s+/gm, '');

  // Find the component name from "export default function Foo" pattern
  const namedMatch = source.match(/export\s+default\s+function\s+(\w+)/);
  const componentRef = namedMatch ? namedMatch[1] : '__Component__';

  // Escape for embedding in a script tag
  const escaped = cleaned.replace(/<\/script>/gi, '<\\/script>');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${fileName}</title>
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0; padding: 16px;
      background: #0f0f0f; color: #e8e8e8;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px; line-height: 1.6;
    }
    .sandbox-error {
      background: #2a1a1a; border: 1px solid #5a2a2a; border-radius: 8px;
      padding: 16px; color: #e57373; font-family: monospace; font-size: 13px;
      white-space: pre-wrap; margin: 16px;
    }
    .sandbox-info {
      position: fixed; bottom: 8px; right: 12px;
      font-size: 11px; color: #444; pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <div class="sandbox-info">${fileName}</div>
  <script type="text/babel" data-type="module">
    const { useState, useEffect, useRef, useMemo, useCallback, useContext, createContext, Fragment } = React;

    ${escaped}

    // Try to find the component to render
    const __Render__ = typeof ${componentRef} !== 'undefined' ? ${componentRef} : null;

    if (__Render__) {
      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(React.createElement(__Render__));
    } else {
      document.getElementById('root').innerHTML =
        '<div class="sandbox-error">No default export found. Export a component as default to preview it.</div>';
    }
  </script>
  <script>
    // Catch Babel transpilation errors
    window.addEventListener('error', function(e) {
      const root = document.getElementById('root');
      if (root && !root.hasChildNodes()) {
        root.innerHTML = '<div class="sandbox-error">' +
          (e.message || 'Component failed to render') + '</div>';
      }
    });
  </script>
</body>
</html>`;

  res.type('html').send(html);
});

// ── Session store (file-based, shared across devices) ──
const SESSIONS_DIR = path.join(HOME, '.pilot', 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

function sessionPath(id) { return path.join(SESSIONS_DIR, `${id}.json`); }

app.get('/sessions', (req, res) => {
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
    const sessions = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8')); }
      catch { return null; }
    }).filter(Boolean);
    sessions.sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
    res.json(sessions);
  } catch { res.json([]); }
});

app.put('/sessions/:id', (req, res) => {
  const session = req.body;
  if (!session || !session.id) return res.status(400).json({ error: 'Missing session data' });
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(sessionPath(session.id), JSON.stringify(session));
  res.json({ ok: true });
});

app.delete('/sessions/:id', (req, res) => {
  const fp = sessionPath(req.params.id);
  try { fs.unlinkSync(fp); } catch {}
  res.json({ ok: true });
});

// Tunnel routes
function checkCloudflared() {
  const cfPath = findCloudflared();
  try {
    require('child_process').execSync(`"${cfPath}" --version`, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

app.get('/tunnel/status', (req, res) => {
  const config = loadTunnelConfig();
  const configured = !!(config?.tunnelId || config?.token);
  res.json({
    status: tunnelStatus, url: tunnelUrl, mode: tunnelMode,
    configured,
    persistent: configured,
    hasToken: !!config?.token,
    autoStart: !!config?.autoStart,
    loggedIn: isCloudflareLoggedIn(),
    tunnelUrl: config?.url || null,
    cloudflaredInstalled: checkCloudflared(),
  });
});

app.post('/tunnel/start', (req, res) => {
  const config = loadTunnelConfig();
  const installed = checkCloudflared();

  // If not ready, return what's needed instead of failing
  if (!installed) {
    return res.json({ status: 'setup_needed', reason: 'no_cloudflared' });
  }
  if (!config?.tunnelId && !config?.token) {
    return res.json({ status: 'setup_needed', reason: 'no_config' });
  }

  const port = server.address()?.port || PORT;
  startTunnel(port);
  res.json({ status: tunnelStatus });
});

app.post('/tunnel/stop', (req, res) => {
  stopTunnel();
  res.json({ status: 'stopped' });
});

// Persistent tunnel setup: step 1 — login to Cloudflare
app.post('/tunnel/setup/login', (req, res) => {
  const cfPath = findCloudflared();
  const loginProc = spawn(cfPath, ['tunnel', 'login'], { stdio: ['ignore', 'pipe', 'pipe'] });

  let output = '';
  loginProc.stderr.on('data', d => { output += d.toString(); });
  loginProc.stdout.on('data', d => { output += d.toString(); });

  // cloudflared prints a URL the user must visit
  const checkUrl = setInterval(() => {
    const match = output.match(/https:\/\/dash\.cloudflare\.com\/[^\s]+/);
    if (match) {
      clearInterval(checkUrl);
      res.json({ status: 'waiting', authUrl: match[0] });
    }
  }, 200);

  loginProc.on('close', (code) => {
    clearInterval(checkUrl);
    if (!res.headersSent) {
      res.json({ status: code === 0 ? 'success' : 'error', loggedIn: isCloudflareLoggedIn() });
    }
  });

  // Timeout after 5s — if no URL found, something is wrong
  setTimeout(() => {
    clearInterval(checkUrl);
    if (!res.headersSent) {
      // Maybe already logged in
      if (isCloudflareLoggedIn()) {
        loginProc.kill();
        res.json({ status: 'already_logged_in' });
      } else {
        res.json({ status: 'error', message: 'Could not start login flow' });
      }
    }
  }, 5000);
});

// Check if login completed (poll after user visits auth URL)
app.get('/tunnel/setup/login-status', (req, res) => {
  res.json({ loggedIn: isCloudflareLoggedIn() });
});

// Persistent tunnel setup: step 2 — create named tunnel
app.post('/tunnel/setup/create', async (req, res) => {
  if (!isCloudflareLoggedIn()) {
    return res.json({ status: 'error', message: 'Not logged in to Cloudflare' });
  }

  const cfPath = findCloudflared();
  const tunnelName = 'pilot';

  // Check if tunnel already exists
  const existing = loadTunnelConfig();
  if (existing?.tunnelId) {
    return res.json({ status: 'exists', tunnelId: existing.tunnelId, url: existing.url });
  }

  // Create the tunnel
  const createProc = spawn(cfPath, ['tunnel', 'create', tunnelName], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '', stderr = '';
  createProc.stdout.on('data', d => { stdout += d.toString(); });
  createProc.stderr.on('data', d => { stderr += d.toString(); });

  createProc.on('close', (code) => {
    const combined = stdout + stderr;
    // Extract tunnel ID from output like "Created tunnel pilot with id xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    const idMatch = combined.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (idMatch) {
      const tunnelId = idMatch[1];
      const url = `https://${tunnelId}.cfargotunnel.com`;
      saveTunnelConfig({ tunnelId, tunnelName, url, createdAt: new Date().toISOString() });
      res.json({ status: 'created', tunnelId, url });
    } else {
      // Might already exist — try to list tunnels
      const listProc = spawn(cfPath, ['tunnel', 'list', '-o', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let listOut = '';
      listProc.stdout.on('data', d => { listOut += d.toString(); });
      listProc.on('close', () => {
        try {
          const tunnels = JSON.parse(listOut);
          const pilotTunnel = tunnels.find(t => t.name === tunnelName && !t.deleted_at);
          if (pilotTunnel) {
            const url = `https://${pilotTunnel.id}.cfargotunnel.com`;
            saveTunnelConfig({ tunnelId: pilotTunnel.id, tunnelName, url, createdAt: new Date().toISOString() });
            return res.json({ status: 'exists', tunnelId: pilotTunnel.id, url });
          }
        } catch {}
        res.json({ status: 'error', message: combined.trim() || 'Failed to create tunnel' });
      });
    }
  });
});

// Token-based tunnel setup: paste a token from admin
app.post('/tunnel/setup/token', (req, res) => {
  const { token, url } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  // Verify cloudflared is installed
  const cfPath = findCloudflared();
  try {
    require('child_process').execSync(`${cfPath} --version`, { stdio: 'ignore' });
  } catch {
    return res.json({ status: 'error', message: 'cloudflared not installed. Run: brew install cloudflared' });
  }

  saveTunnelConfig({ token, url: url || null, autoStart: true, createdAt: new Date().toISOString() });

  // Auto-start the tunnel
  const port = server.address()?.port || PORT;
  stopTunnel();
  setTimeout(() => startTunnel(port), 500);

  res.json({ status: 'ok' });
});

// Toggle auto-start
app.post('/tunnel/setup/auto-start', (req, res) => {
  const config = loadTunnelConfig();
  if (!config) return res.json({ status: 'error', message: 'No tunnel configured' });
  config.autoStart = !!req.body.enabled;
  saveTunnelConfig(config);
  res.json({ status: 'ok', autoStart: config.autoStart });
});

// Static files and SPA fallback — MUST be after all API routes
app.use(express.static(frontendDist));
app.use((req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// ── Bonjour/mDNS advertisement for iOS discovery ──
let bonjourProc = null;
function advertisePilot(port) {
  try {
    bonjourProc = spawn('dns-sd', ['-R', 'Pilot', '_pilot._tcp', 'local', String(port)], {
      stdio: 'ignore',
      detached: true,
    });
    bonjourProc.unref();
    console.log(`Bonjour: advertising _pilot._tcp on port ${port}`);
  } catch (e) {
    console.log('Bonjour advertisement unavailable:', e.message);
  }
}

// ── Cloudflare Tunnel for remote access ──
let tunnelProc = null;
let tunnelUrl = null;
let tunnelStatus = 'stopped'; // stopped | starting | running | error
let tunnelMode = 'persistent'; // token | persistent

const TUNNEL_CONFIG_PATH = path.join(HOME, '.pilot', 'tunnel.json');

function findCloudflared() {
  const candidates = ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared'];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return 'cloudflared';
}

function loadTunnelConfig() {
  try { return JSON.parse(fs.readFileSync(TUNNEL_CONFIG_PATH, 'utf-8')); }
  catch { return null; }
}

function saveTunnelConfig(config) {
  const dir = path.dirname(TUNNEL_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TUNNEL_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function isCloudflareLoggedIn() {
  return fs.existsSync(path.join(HOME, '.cloudflared', 'cert.pem'));
}

let caffeinateProc = null;

function startCaffeinate() {
  if (caffeinateProc) return;
  try {
    caffeinateProc = spawn('caffeinate', ['-s'], { stdio: 'ignore' });
    caffeinateProc.on('close', () => { caffeinateProc = null; });
    console.log('Sleep prevention enabled (caffeinate)');
  } catch {}
}

function stopCaffeinate() {
  if (caffeinateProc) {
    try { caffeinateProc.kill(); } catch {}
    caffeinateProc = null;
    console.log('Sleep prevention disabled');
  }
}

function startTunnel(port) {
  if (tunnelProc) return;
  const config = loadTunnelConfig();
  if (!config?.token && !config?.tunnelId) return; // No config — nothing to start

  startCaffeinate();
  tunnelStatus = 'starting';
  tunnelUrl = config.url;
  const cfPath = findCloudflared();

  if (config.token) {
    // Token-based tunnel — managed remotely, no local config needed
    tunnelMode = 'token';
    tunnelProc = spawn(cfPath, ['tunnel', 'run', '--token', config.token], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    // Named tunnel — persistent URL, admin's own tunnel
    tunnelMode = 'persistent';
    tunnelProc = spawn(cfPath, [
      'tunnel', '--config', path.join(HOME, '.cloudflared', 'config.yml'),
      'run', config.tunnelId
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TUNNEL_ORIGIN_CERT: path.join(HOME, '.cloudflared', 'cert.pem') },
    });
  }

  broadcastTunnel();

  let started = false;
  tunnelProc.stderr.on('data', (data) => {
    const line = data.toString();
    if (!started && (line.includes('Registered tunnel connection') || line.includes('Connection registered'))) {
      started = true;
      tunnelStatus = 'running';
      console.log('Tunnel active at ' + tunnelUrl);
      broadcastTunnel();
    }
  });

  tunnelProc.on('error', (err) => {
    console.log('Tunnel failed:', err.message);
    tunnelStatus = 'error';
    tunnelProc = null;
    broadcastTunnel();
  });

  tunnelProc.on('close', () => {
    tunnelProc = null;
    if (tunnelStatus !== 'stopped') {
      tunnelStatus = 'stopped';
      tunnelUrl = null;
      broadcastTunnel();
    }
  });
}

function stopTunnel() {
  if (tunnelProc) {
    try { tunnelProc.kill(); } catch {}
    tunnelProc = null;
  }
  stopCaffeinate();
  tunnelStatus = 'stopped';
  tunnelUrl = null;
  broadcastTunnel();
}

function broadcastTunnel() {
  const config = loadTunnelConfig();
  const msg = JSON.stringify({
    type: 'tunnel', status: tunnelStatus, url: tunnelUrl,
    mode: tunnelMode,
    persistent: !!(config?.tunnelId || config?.token),
    hasToken: !!config?.token,
    autoStart: !!config?.autoStart,
  });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

// Clean up dev server, Bonjour, and tunnel on exit
function cleanup() {
  stopDevServer();
  if (bonjourProc) { try { bonjourProc.kill(); } catch {} }
  if (tunnelProc) { try { tunnelProc.kill(); } catch {} }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(); });
process.on('SIGTERM', () => { cleanup(); process.exit(); });

const PORT = 3001;

// Only auto-listen when run directly (not when required by Electron)
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    const lanIp = getLanIP();
    console.log('Pilot running at http://localhost:' + PORT);
    if (lanIp) console.log('LAN access at http://' + lanIp + ':' + PORT);
    advertisePilot(PORT);
    // Auto-start tunnel if configured
    const tc = loadTunnelConfig();
    if (tc?.autoStart && (tc.token || tc.tunnelId)) {
      console.log('Auto-starting tunnel...');
      startTunnel(PORT);
    }
  });
}

module.exports = { server, app, wss, PORT, advertisePilot, startTunnel, loadTunnelConfig };
