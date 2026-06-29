// stripe-webhook — reçoit les évènements Stripe (paiement, annulation) et
// active automatiquement le bon forfait + les agents correspondants.
// À configurer dans Stripe : un endpoint webhook vers
//   https://pagelab.fr/.netlify/functions/stripe-webhook
// puis mettre sa clé de signature dans STRIPE_WEBHOOK_SECRET.
const { service } = require('./_supa');

const PLAN_AGENTS = {
  starter: ['commercial'],
  pro: ['commercial', 'devis_facturation'],
  premium: ['commercial', 'devis_facturation', 'telephone'],
};

async function applyPlan(svc, companyId, plan) {
  await svc.from('companies').update({ plan }).eq('id', companyId);
  const { data: agents } = await svc.from('agents').select('id,slug');
  const allowed = PLAN_AGENTS[plan] || [];
  for (const a of agents || []) {
    await svc.from('company_agents').upsert(
      { company_id: companyId, agent_id: a.id, active: allowed.includes(a.slug) },
      { onConflict: 'company_id,agent_id' }
    );
  }
}

exports.handler = async (event) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : (event.body || '');

  let evt;
  try {
    evt = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return { statusCode: 400, body: `Signature invalide` };
  }

  const svc = service();
  try {
    if (evt.type === 'checkout.session.completed') {
      const s = evt.data.object;
      const companyId = (s.metadata && s.metadata.company_id) || s.client_reference_id;
      const plan = s.metadata && s.metadata.plan;
      if (companyId && plan) await applyPlan(svc, companyId, plan);
    } else if (evt.type === 'customer.subscription.deleted') {
      const sub = evt.data.object;
      const companyId = sub.metadata && sub.metadata.company_id;
      if (companyId) await applyPlan(svc, companyId, 'starter');
    }
  } catch (e) { /* on renvoie 200 quand même pour ne pas faire boucler Stripe */ }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
