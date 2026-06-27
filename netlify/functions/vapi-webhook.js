// vapi-webhook — reçoit le compte-rendu de fin d'appel de Vapi.
// URL (Server URL de l'assistant Vapi) :
//   https://pagelab.fr/.netlify/functions/vapi-webhook?token=WEBSITE_TOKEN
// Claude lit le résumé + la transcription pour extraire les infos du prospect,
// puis crée la fiche prospect, l'historique d'appel, et une réponse à valider.
const { cors, json, service, claude } = require('./_supa');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json({ error: 'POST attendu' }, 405);

  const token = (event.queryStringParameters || {}).token;
  if (!token) return json({ error: 'token requis' }, 400);

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch (e) {}
  const msg = payload.message || payload;
  if (msg.type && msg.type !== 'end-of-call-report') return json({ ok: true, ignored: msg.type });

  const svc = service();
  const { data: company } = await svc.from('companies').select('id').eq('website_token', token).single();
  if (!company) return json({ error: 'token inconnu' }, 404);

  const a = msg.analysis || {};
  const summary = a.summary || msg.summary || '';
  const transcript = (msg.artifact && msg.artifact.transcript) || msg.transcript || '';
  const sd = a.structuredData || {};

  // Extraction des infos par Claude à partir du résumé + transcription
  let info = { nom: null, telephone: null, email: null, travaux: null, ville: null, urgence: null, budget: null, reply: null };
  const raw = await claude(
    "Tu analyses la transcription d'un appel reçu par un artisan du BTP. Réponds UNIQUEMENT en JSON, sans texte autour, avec les clés : nom, telephone, email, travaux (nature des travaux, court), ville, urgence ('faible'|'moyenne'|'élevée'), budget (ou null), reply (un brouillon de réponse chaleureux et professionnel en français, 3 phrases max, qui remercie l'appelant, montre qu'on a bien compris son besoin, et propose de convenir d'un rendez-vous). Mets null si une information est absente.",
    `Résumé: ${summary}\n\nTranscription:\n${transcript}`
  );
  if (raw) { try { info = { ...info, ...JSON.parse(raw.replace(/```json|```/g, '').trim()) }; } catch (e) {} }

  // Repli sur les éventuelles données structurées Vapi
  const name = info.nom || sd.nom || null;
  const phone = info.telephone || sd.telephone || (msg.customer && msg.customer.number) || null;
  const email = info.email || sd.email || null;
  const travaux = info.travaux || sd.travaux || null;
  const urgence = info.urgence || sd.urgence || null;

  const { data: lead } = await svc.from('leads').insert({
    company_id: company.id, name, email, phone,
    project_type: travaux, budget_estimate: info.budget || null, urgency: urgence,
    message: summary || transcript.slice(0, 500), source: 'phone', status: 'qualified',
    qualification: { ...info, ville: info.ville },
  }).select('id').single();

  await svc.from('calls').insert({
    company_id: company.id, caller: phone || 'inconnu', summary: summary || transcript.slice(0, 500),
    project_type: travaux, urgency: urgence, lead_id: lead ? lead.id : null,
  });

  // Réponse à valider (seulement si on a un email pour répondre)
  if (lead && email && info.reply) {
    await svc.from('pending_actions').insert({
      company_id: company.id, agent: 'commercial', type: 'reponse_lead',
      target_table: 'leads', target_id: lead.id, draft_text: info.reply, status: 'pending',
    });
  }

  return json({ ok: true });
};
