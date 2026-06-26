// sync-stripe — lit les factures échues du compte Stripe CONNECTÉ de l'artisan
// (via Stripe Connect, header Stripe-Account) et crée les relances rédigées par Claude.
const { cors, json, resolveCompany, claude, QUOTAS, usageThisMonth } = require('./_supa');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  const ctx = await resolveCompany(event);
  if (ctx.error) return json({ error: ctx.error }, 401);
  const { svc, companyId } = ctx;

  const { data: tok } = await svc.from('integration_tokens')
    .select('access_token').eq('company_id', companyId).eq('provider', 'stripe').single();
  if (!tok || !tok.access_token) return json({ error: 'Stripe non connecté' }, 400);
  const account = tok.access_token; // acct_...

  const { data: company } = await svc.from('companies').select('plan').eq('id', companyId).single();
  const limit = QUOTAS[(company && company.plan) || 'pro'] || 300;
  let used = await usageThisMonth(svc, companyId);

  const res = await fetch('https://api.stripe.com/v1/invoices?status=open&limit=50', {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Stripe-Account': account },
  });
  if (!res.ok) return json({ error: 'Lecture Stripe refusée' }, 400);
  const { data: invoices } = await res.json();

  const now = Date.now() / 1000;
  let created = 0;
  for (const inv of invoices || []) {
    if (!inv.due_date || inv.due_date >= now) continue;
    const ref = `stripe_${inv.id}`;
    const { data: exists } = await svc.from('invoices').select('id').eq('company_id', companyId).eq('ref', ref).maybeSingle();
    if (exists) continue;

    const amount = (inv.amount_due || 0) / 100;
    const days = Math.floor((now - inv.due_date) / 86400);
    const client = inv.customer_name || inv.customer_email || 'Client';

    const { data: row } = await svc.from('invoices').insert({
      company_id: companyId, client_name: client, client_email: inv.customer_email,
      ref, amount_cents: inv.amount_due || 0,
      due_date: new Date(inv.due_date * 1000).toISOString().slice(0, 10), status: 'unpaid', source: 'stripe',
    }).select('id').single();
    if (!row) continue;

    const draft = ((used < limit) ? await claude(
      "Tu rédiges une relance de facture impayée pour un artisan du BTP, en français. Ton ferme mais courtois, 4 phrases max, mentionne l'indemnité forfaitaire légale de 40 € entre professionnels. Donne uniquement le corps du message.",
      `Facture ${inv.number || ref}, client ${client}, montant ${amount} €, retard ${days} jours.`
    ) : null) || `Bonjour, je reviens vers vous concernant la facture ${inv.number || ref} (${amount.toLocaleString('fr-FR')} €), échue depuis ${days} jours. Merci de régulariser sous 8 jours. Une indemnité forfaitaire de 40 € s'applique entre professionnels.`;
    used++;

    await svc.from('pending_actions').insert({
      company_id: companyId, agent: 'devis_facturation', type: 'relance_facture',
      target_table: 'invoices', target_id: row.id, draft_text: draft, status: 'pending',
    });
    created++;
  }
  return json({ ok: true, created });
};
