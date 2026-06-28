// cron-sync — fonction PLANIFIÉE (voir netlify.toml : schedule).
// Chaque nuit, parcourt toutes les entreprises connectées à Stripe et prépare
// automatiquement les relances d'impayés. Rien n'est envoyé : tout reste à valider.
const { service, syncStripeForCompany } = require('./_supa');

exports.handler = async () => {
  const svc = service();

  // Entreprises ayant un compte Stripe connecté
  const { data: toks } = await svc.from('integration_tokens').select('company_id').eq('provider', 'stripe');
  const ids = [...new Set((toks || []).map((t) => t.company_id))];

  let created = 0, done = 0;
  for (const id of ids) {
    try {
      const r = await syncStripeForCompany(svc, id);
      created += r.created || 0; done++;
    } catch (e) { /* on continue avec les autres entreprises */ }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, companies: done, relances: created }) };
};