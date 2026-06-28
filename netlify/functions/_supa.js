// Helpers partagés pour les Netlify Functions PageLab
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function json(body, statusCode = 200) {
  return { statusCode, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function redirect(url) {
  return { statusCode: 302, headers: { ...cors, Location: url }, body: '' };
}

// Client "service role" : bypass RLS, lit les secrets. Côté serveur uniquement.
function service() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Identifie l'utilisateur via le JWT Supabase puis renvoie son company_id
async function resolveCompany(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return { error: 'non authentifié' };
  const svc = service();
  const { data: u, error } = await svc.auth.getUser(token);
  if (error || !u.user) return { error: 'session invalide' };
  const { data: prof } = await svc.from('profiles').select('company_id, email, full_name').eq('id', u.user.id).single();
  if (!prof || !prof.company_id) return { error: 'aucune entreprise' };
  return { svc, userId: u.user.id, companyId: prof.company_id, profile: prof };
}

// State OAuth signé (anti-falsification du company_id)
function signState(companyId) {
  const sig = crypto.createHmac('sha256', process.env.STATE_SECRET || 'change-me').update(companyId).digest('hex');
  return `${companyId}.${sig}`;
}
function verifyState(state) {
  const cid = String(state || '').split('.')[0];
  return signState(cid) === state ? cid : null;
}

// Appel Claude (rédaction). Renvoie du texte, avec repli si pas de clé.
async function claude(system, user, maxTokens = 400) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

// Gabarit HTML d'email brandé (au nom de l'entreprise de l'artisan)
function emailHtml(text, senderName) {
  const safe = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
  const name = senderName || 'PageLab';
  return `<!doctype html><html><body style="margin:0;background:#f4f2ee;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#15202e">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e7e2d8">
    <tr><td style="background:#15202e;padding:18px 24px"><span style="color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:-0.5px">&#9707; ${name}</span></td></tr>
    <tr><td style="padding:26px 24px;font-size:15px;line-height:1.65;color:#41506a">${safe}</td></tr>
    <tr><td style="padding:0 24px 24px"><div style="border-top:1px solid #e7e2d8;padding-top:14px;font-size:13px;color:#6b7689"><strong style="color:#15202e">${name}</strong></div></td></tr>
  </table>
  <div style="font-size:11px;color:#9aa3b0;margin-top:12px">Envoyé via PageLab</div>
  </td></tr></table></body></html>`;
}

// Envoi email via Resend (HTML brandé + texte en repli)
async function sendEmail(to, subject, text, replyTo, senderName) {
  const key = process.env.RESEND_API_KEY;
  const from = senderName
    ? `${senderName} <${(process.env.MAIL_FROM || 'PageLab <onboarding@resend.dev>').replace(/.*<|>.*/g, '')}>`
    : (process.env.MAIL_FROM || 'PageLab <onboarding@resend.dev>');
  if (!key) return { ok: false, error: 'RESEND_API_KEY manquante' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text, html: emailHtml(text, senderName), reply_to: replyTo }),
  });
  if (!r.ok) return { ok: false, error: `Resend: ${await r.text()}` };
  return { ok: true };
}

const QUOTAS = { starter: 50, pro: 250, premium: 1000 };

// Générations IA du mois (= actions créées). C'est le seul vrai compteur de coût.
async function usageThisMonth(svc, companyId) {
  const m = new Date(); m.setDate(1); m.setHours(0, 0, 0, 0);
  const { count } = await svc.from('pending_actions').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).gte('created_at', m.toISOString());
  return count || 0;
}

module.exports = { cors, json, redirect, service, resolveCompany, signState, verifyState, claude, sendEmail, QUOTAS, usageThisMonth };
