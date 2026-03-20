export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    // POST /api/accounts/register
    if (url.pathname === '/api/accounts/register' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { name, email, installId, plan } = body;
        if (!installId) {
          return new Response(JSON.stringify({ error: 'installId required' }), { status: 400, headers });
        }
        const account = {
          name: name || '',
          email: email || '',
          installId,
          plan: plan || 'free',
          registeredAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        };
        await env.ACCOUNTS.put(`account:${installId}`, JSON.stringify(account));
        return new Response(JSON.stringify({ ok: true, installId }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers });
      }
    }

    // POST /api/accounts/heartbeat
    if (url.pathname === '/api/accounts/heartbeat' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { installId, version, remote } = body;
        if (!installId) {
          return new Response(JSON.stringify({ error: 'installId required' }), { status: 400, headers });
        }
        const existing = await env.ACCOUNTS.get(`account:${installId}`);
        if (existing) {
          const account = JSON.parse(existing);
          account.lastSeen = new Date().toISOString();
          if (version) account.version = version;
          if (remote !== undefined) account.remote = remote;
          await env.ACCOUNTS.put(`account:${installId}`, JSON.stringify(account));
        }
        return new Response(JSON.stringify({ ok: true }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers });
      }
    }

    // GET /api/admin/accounts (list all accounts)
    if (url.pathname === '/api/admin/accounts' && request.method === 'GET') {
      const list = await env.ACCOUNTS.list({ prefix: 'account:' });
      const accounts = [];
      for (const key of list.keys) {
        const data = await env.ACCOUNTS.get(key.name);
        if (data) accounts.push(JSON.parse(data));
      }
      return new Response(JSON.stringify(accounts), { headers });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
  },
};
