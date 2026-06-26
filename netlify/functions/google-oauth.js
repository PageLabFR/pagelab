// google-oauth — OAuth Google (Gmail readonly + Agenda).
//   ?action=start    (POST, JWT)   -> renvoie l'URL de consentement
//   ?action=callback (GET, Google) -> échange le code, stocke le refresh_token
const { cors, json, redirect, service, resolveCompany, signState, verifyState } = require('./_supa');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'openid', 'email',
].join(' ');

function callbackUrl() {
  return `${process.env.SITE_URL || 'https://pagelab.fr'}/.netlify/functions/google-oauth?action=callback`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  const action = (event.queryStringParameters || {}).action;

  if (event.httpMethod === 'POST' || action === 'start') {
    const ctx = await resolveCompany(event);
    if (ctx.error) return json({ error: ctx.error }, 401);
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
    u.searchParams.set('redirect_uri', callbackUrl());
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', SCOPES);
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    u.searchParams.set('state', signState(ctx.companyId));
    return json({ url: u.toString() });
  }

  if (action === 'callback') {
    const q = event.queryStringParameters || {};
    const site = process.env.SITE_URL || 'https://pagelab.fr';
    const companyId = verifyState(q.state);
    if (!q.code || !companyId) return redirect(`${site}/dashboard.html?google=error`);

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: q.code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: callbackUrl(),
        grant_type: 'authorization_code',
      }),
    });
    const t = await r.json();
    if (!r.ok) return redirect(`${site}/dashboard.html?google=error`);

    const svc = service();
    await svc.from('integration_tokens').upsert({
      company_id: companyId, provider: 'google',
      refresh_token: t.refresh_token || null, access_token: t.access_token || null,
      expiry: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
      scopes: SCOPES,
    }, { onConflict: 'company_id,provider' });

    return redirect(`${site}/dashboard.html?google=ok`);
  }

  return json({ error: 'action inconnue' }, 400);
};
