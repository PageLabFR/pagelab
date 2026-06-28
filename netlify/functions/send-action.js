// send-action — envoie l'email d'une action validée (relance/réponse/avis),
// vérifie le quota mensuel côté serveur, marque l'action envoyée.
const { cors, json, resolveCompany, sendEmail, QUOTAS, usageThisMonth } = require('./_supa');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const ctx = await resolveCompany(event);
  if (ctx.error) return json({ error: ctx.error }, 401);
  const { svc, companyId, profile } = ctx;

  let id;
  try { id = JSON.parse(event.body || '{}').id; } catch (e) {}
  if (!id) return json({ error: 'id requis' }, 400);

  const { data: action } = await svc.from('pending_actions').select('*').eq('id', id).eq('company_id', companyId).single();
  if (!action) return json({ error: 'action introuvable' }, 404);
  if (action.status !== 'pending') return json({ error: 'action déjà traitée' }, 400);

  const { data: company } = await svc.from('companies').select('plan, name, google_review_link').eq('id', companyId).single();
  // Pas de blocage à l'envoi : l'email est quasi gratuit. Le garde-fou de coût
  // est placé sur la GÉNÉRATION IA (lead-intake / sync-stripe).

  const replyTo = (profile && profile.email) || undefined;
  let to = '', subject = '', body = action.draft_text || '';

  if (action.type === 'relance_facture') {
    const { data: inv } = await svc.from('invoices').select('client_email, ref').eq('id', action.target_id).single();
    if (!inv || !inv.client_email) return json({ error: "Pas d'email client sur cette facture" }, 400);
    to = inv.client_email; subject = `Relance — facture ${inv.ref || ''}`.trim();

  } else if (action.type === 'relance_devis') {
    const { data: d } = await svc.from('devis').select('client_email, title').eq('id', action.target_id).single();
    if (!d || !d.client_email) return json({ error: "Pas d'email client sur ce devis" }, 400);
    to = d.client_email; subject = `Votre devis — ${d.title || ''}`.trim();
    await svc.from('devis').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', action.target_id);

  } else if (action.type === 'reponse_lead') {
    const { data: l } = await svc.from('leads').select('email').eq('id', action.target_id).single();
    if (!l || !l.email) return json({ error: "Pas d'email sur ce prospect" }, 400);
    to = l.email; subject = 'Votre demande';
    await svc.from('leads').update({ status: 'replied' }).eq('id', action.target_id);

  } else if (action.type === 'demande_avis') {
    const { data: a } = await svc.from('avis_requests').select('client_email').eq('id', action.target_id).single();
    if (!a || !a.client_email) return json({ error: "Pas d'email client" }, 400);
    if (!company || !company.google_review_link) return json({ error: 'Configurez votre lien Google (onglet Commercial)' }, 400);
    to = a.client_email; subject = 'Votre avis compte pour nous';
    body = body.replace('{lien}', company.google_review_link);
    await svc.from('avis_requests').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', action.target_id);

  } else {
    return json({ error: "type d'action inconnu" }, 400);
  }

  const sent = await sendEmail(to, subject, body, replyTo, (company && company.name) || 'PageLab');
  if (!sent.ok) return json({ error: sent.error }, 502);

  await svc.from('pending_actions').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id);
  return json({ ok: true });
};
