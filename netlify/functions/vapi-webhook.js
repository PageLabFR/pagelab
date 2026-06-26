// vapi-webhook — reçoit le compte-rendu de fin d'appel de Vapi.
// URL à mettre dans l'assistant Vapi (Server URL) :
//   https://pagelab.fr/.netlify/functions/vapi-webhook?token=LE_WEBSITE_TOKEN_DE_LARTISAN
// Crée un appel + un prospect, et prépare la notification.
const { cors, json, service } = require('./_supa');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json({ error: 'POST attendu' }, 405);

  const token = (event.queryStringParameters || {}).token;
  if (!token) return json({ error: 'token requis' }, 400);

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch (e) {}
  const msg = payload.message || payload;
  // On ne traite que le rapport de fin d'appel
  if (msg.type && msg.type !== 'end-of-call-report') return json({ ok: true, ignored: msg.type });

  const svc = service();
  const { data: company } = await svc.from('companies').select('id').eq('website_token', token).single();
  if (!company) return json({ error: 'token inconnu' }, 404);

  // Champs extraits par l'assistant (structured data) ou résumé brut
  const a = msg.analysis || {};
  const sd = a.structuredData || {};
  const summary = a.summary || msg.summary || '';
  const caller = (msg.customer && msg.customer.number) || sd.telephone || 'inconnu';

  const { data: lead } = await svc.from('leads').insert({
    company_id: company.id, name: sd.nom || null, phone: caller,
    project_type: sd.travaux || null, budget_estimate: sd.budget || null, urgency: sd.urgence || null,
    message: summary, source: 'phone', status: 'qualified', qualification: sd,
  }).select('id').single();

  await svc.from('calls').insert({
    company_id: company.id, caller, summary, project_type: sd.travaux || null, urgency: sd.urgence || null,
    lead_id: lead ? lead.id : null,
  });

  return json({ ok: true });
};
