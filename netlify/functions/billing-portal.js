// billing-portal — ouvre le portail client Stripe (voir facture, changer de carte, résilier).
// Retrouve le client Stripe par email (créé lors du Checkout) et crée une session de portail.
const { cors, json, service } = require('./_supa');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return json({ error: 'non authentifié' }, 401);

  const svc = service();
  const { data: u, error } = await svc.auth.getUser(token);
  if (error || !u.user) return json({ error: 'session invalide' }, 401);
  const email = u.user.email;
  if (!email) return json({ error: "Pas d'email" }, 400);

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const site = process.env.SITE_URL || 'https://pagelab.fr';

  try {
    const list = await stripe.customers.list({ email, limit: 1 });
    if (!list.data.length) return json({ error: 'Aucun abonnement actif trouvé' }, 404);
    const s = await stripe.billingPortal.sessions.create({
      customer: list.data[0].id,
      return_url: `${site}/dashboard.html?tab=abo`,
    });
    return json({ url: s.url });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
};
