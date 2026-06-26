// stripe-oauth — Stripe Connect (Standard). L'artisan clique "Connecter Stripe",
// autorise chez Stripe, et on stocke l'id de son compte connecté. Aucune clé à coller.
//   ?action=start    (POST, JWT)  -> renvoie l'URL d'autorisation Stripe
//   ?action=callback (GET, Stripe) -> échange le code, stocke le compte
const { cors, json, redirect, service, resolveCompany, signState, verifyState } = require('./_supa');

function callbackUrl() {
  return `${process.env.SITE_URL || 'https://pagelab.fr'}/.netlify/functions/stripe-oauth?action=callback`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  const action = (event.queryStringParameters || {}).action;

  // START
  if (event.httpMethod === 'POST' || action === 'start') {
    const ctx = await resolveCompany(event);
    if (ctx.error) return json({ error: ctx.error }, 401);
    const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
    if (!clientId) return json({ error: 'STRIPE_CONNECT_CLIENT_ID manquant' }, 500);
    const u = new URL('https://connect.stripe.com/oauth/authorize');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', clientId);
    u.searchParams.set('scope', 'read_only');
    u.searchParams.set('redirect_uri', callbackUrl());
    u.searchParams.set('state', signState(ctx.companyId));
    return json({ url: u.toString() });
  }

  // CALLBACK
  if (action === 'callback') {
    const q = event.queryStringParameters || {};
    const site = process.env.SITE_URL || 'https://pagelab.fr';
    const companyId = verifyState(q.state);
    if (!q.code || !companyId) return redirect(`${site}/dashboard.html?stripe=error`);

    const r = await fetch('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_secret: process.env.STRIPE_SECRET_KEY,
        code: q.code,
        grant_type: 'authorization_code',
      }),
    });
    const data = await r.json();
    if (!r.ok || !data.stripe_user_id) return redirect(`${site}/dashboard.html?stripe=error`);

    const svc = service();
    await svc.from('integration_tokens').upsert({
      company_id: companyId,
      provider: 'stripe',
      access_token: data.stripe_user_id, // l'id du compte connecté (acct_...)
      meta: data,
    }, { onConflict: 'company_id,provider' });

    return redirect(`${site}/dashboard.html?stripe=ok`);
  }

  return json({ error: 'action inconnue' }, 400);
};
