// sync-stripe — bouton "Synchroniser" : relance les factures impayées
// du compte Stripe connecté de l'artisan connecté.
const { cors, json, resolveCompany, syncStripeForCompany } = require('./_supa');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  const ctx = await resolveCompany(event);
  if (ctx.error) return json({ error: ctx.error }, 401);
  const r = await syncStripeForCompany(ctx.svc, ctx.companyId);
  if (r.stripe === false) return json({ error: 'Stripe non connecté' }, 400);
  if (r.error) return json({ error: 'Lecture Stripe refusée' }, 400);
  return json({ ok: true, created: r.created });
};
