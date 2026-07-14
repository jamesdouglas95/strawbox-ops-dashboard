// Vercel serverless proxy to the Shopify Admin GraphQL API.
// Uses the client-credentials grant (app + store owned by the same org).
// Env vars required in Vercel:
//   SHOPIFY_STORE          e.g. hfkh3g-9q  (the part before .myshopify.com)
//   SHOPIFY_CLIENT_ID      the app's Client ID from Dev Dashboard > Settings
//   SHOPIFY_CLIENT_SECRET  the app's Secret from Dev Dashboard > Settings (keep secret)
const API_VERSION = '2026-01';
let cachedToken = null;
let cachedExp = 0;

async function getToken(store, clientId, clientSecret) {
  const now = Date.now();
  if (cachedToken && now < cachedExp) return cachedToken;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  });
  const r = await fetch('https://' + store + '.myshopify.com/admin/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    throw new Error('Token request failed (' + r.status + '): ' + JSON.stringify(j));
  }
  cachedToken = j.access_token;
  cachedExp = now + ((j.expires_in || 86399) - 120) * 1000; // refresh 2 min early
  return cachedToken;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const store = process.env.SHOPIFY_STORE;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!store || !clientId || !clientSecret) {
    res.status(500).json({ error: 'Missing SHOPIFY_STORE, SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET env var in Vercel project settings.' });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const args = (body && body.args) || {};
  const query = args.query;
  const variables = args.variables || {};
  if (!query) { res.status(400).json({ error: 'No GraphQL query in request.' }); return; }
  try {
    const token = await getToken(store, clientId, clientSecret);
    const r = await fetch('https://' + store + '.myshopify.com/admin/api/' + API_VERSION + '/graphql.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query: query, variables: variables })
    });
    const json = await r.json();
    res.status(r.status).json(json);
  } catch (e) {
    res.status(502).json({ error: 'Shopify proxy error: ' + e.message });
  }
}
