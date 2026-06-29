// create-checkout — crée une session Stripe Checkout (abonnement) pour l'offre choisie.
// L'artisan paie PageLab. Au paiement, stripe-webhook active son forfait.
const { cors, json, resolveCompany } = require('./_supa');

// ⚠️ Price IDs de TEST. À remplacer par les price IDs LIVE au lancement réel.
const PRICES = {
  starter: 'price_1TnI9a1FzE1O4WqOVNzRgpEZ',
  pro:     'price_1TnIAG1FzE1O4WqOHMfnMFYI',
  premium: 'price_1TnIB41FzE1O4WqOzHBfK3hl',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  const ctx = await resolveCompany(event);
  if (ctx.error) return json({ error: ctx.error }, 401);

  let plan;
  try { plan = JSON.parse(event.body || '{}').plan; } catch (e) {}
  if (!PRICES[plan]) return json({ error: 'Offre inconnue' }, 400);

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const site = process.env.SITE_URL || 'https://pagelab.fr';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: PRICES[plan], quantity: 1 }],
      customer_email: ctx.profile && ctx.profile.email,
      client_reference_id: ctx.companyId,
      metadata: { company_id: ctx.companyId, plan },
      subscription_data: { metadata: { company_id: ctx.companyId, plan } },
      allow_promotion_codes: true,
      success_url: `${site}/dashboard.html?checkout=success`,
      cancel_url: `${site}/dashboard.html?checkout=cancel`,
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
};
