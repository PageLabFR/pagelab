// lead-intake — endpoint PUBLIC où le formulaire du site de l'artisan envoie les demandes.
// Identifie l'entreprise par son website_token, qualifie le lead avec Claude,
// crée la fiche prospect + une "réponse à valider" dans la file.
const { cors, json, service, claude, QUOTAS, usageThisMonth } = require('./_supa');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json({ error: 'POST attendu' }, 405);

  let p = {};
  try { p = JSON.parse(event.body || '{}'); } catch (e) {}
  const token = p.website_token;
  if (!token) return json({ error: 'website_token requis' }, 400);
  if (!p.name && !p.email && !p.phone) return json({ error: 'coordonnées requises' }, 400);

  const svc = service();
  const { data: company } = await svc.from('companies').select('id, name, plan').eq('website_token', token).single();
  if (!company) return json({ error: 'token inconnu' }, 404);

  // Garde-fou de coût : on n'appelle Claude que sous le quota mensuel de générations.
  const limit = QUOTAS[company.plan || 'pro'] || 300;
  const used = await usageThisMonth(svc, company.id);
  const underQuota = used < limit;

  // Qualification IA -> JSON strict
  let q = { project_type: null, budget_estimate: null, urgency: null, reply: null };
  const raw = underQuota ? await claude(
    "Tu qualifies une demande de travaux reçue par un artisan du BTP. Réponds UNIQUEMENT en JSON, sans texte autour, avec les clés : project_type (string court), budget_estimate (fourchette en € ou null), urgency ('faible'|'moyenne'|'élevée'), reply (un brouillon de réponse courtois en français, 3 phrases max, proposant un rendez-vous).",
    `Nom: ${p.name || ''}\nMessage: ${p.message || ''}`
  ) : null;
  if (raw) {
    try { q = { ...q, ...JSON.parse(raw.replace(/```json|```/g, '').trim()) }; } catch (e) {}
  }
  if (!q.reply) {
    q.reply = `Bonjour ${p.name || ''}, merci pour votre demande${p.message ? '' : ''}. Je reviens vers vous très vite pour convenir d'un rendez-vous et évaluer vos travaux. Quel créneau vous conviendrait ?`;
  }

  const { data: lead } = await svc.from('leads').insert({
    company_id: company.id, name: p.name, email: p.email, phone: p.phone, message: p.message,
    project_type: q.project_type, budget_estimate: q.budget_estimate, urgency: q.urgency,
    source: p.source || 'form', status: 'qualified', qualification: q,
  }).select('id').single();

  if (lead) {
    await svc.from('pending_actions').insert({
      company_id: company.id, agent: 'commercial', type: 'reponse_lead',
      target_table: 'leads', target_id: lead.id, draft_text: q.reply, status: 'pending',
    });
  }

  return json({ ok: true });
};
